import { DEFAULT_PAGE_LIMIT } from '@mycelium/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

// Minimum pg_trgm title similarity for the fuzzy fallback when the
// websearch_to_tsquery lexical query returns zero rows.
const TRIGRAM_SIMILARITY_THRESHOLD = 0.3;

/**
 * Multiplier applied per `importance` point when ranking topic results.
 * `importance` is agent-supplied and gameable — keep this weight low and tunable.
 */
const IMPORTANCE_BOOST = 0.15;

function encodeCursor(note) {
  const updatedAt =
    note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt ?? null;
  return Buffer.from(
    JSON.stringify({ rank: Number(note.rank), updatedAt, id: note.id }),
  ).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.id === 'string' && Number.isFinite(Number(parsed.rank))) {
      return {
        id: parsed.id,
        rank: Number(parsed.rank),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    }
  } catch {
    // Fall back below for cursors produced before recency-aware pagination.
  }
  return { id: cursor, rank: null, updatedAt: null };
}

/**
 * Search service providing full-text search over notes using
 * PostgreSQL tsvector indexes with optional status and tag filters.
 */
export const SearchService = {
  /**
   * Search notes using PostgreSQL full-text search with optional filters.
   *
   * Uses `plainto_tsquery` for safe query parsing and `ts_rank` for
   * relevance scoring. Supports cursor-based pagination, optional status
   * filtering, and optional tag filtering via the implicit join table.
   *
   * @param {string} userId - ID of the owning user.
   * @param {string} query - Search query string.
   * @param {{ status?: string, tag?: string, cursor?: string, limit?: number }} [filters={}]
   * @returns {Promise<{ notes: Array<{ id: string, slug: string, title: string, excerpt: string | null, status: string, rank: number }>, nextCursor: string | null }>}
   */
  async search(userId, query, filters = {}) {
    const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
    const tsQuery = Prisma.sql`websearch_to_tsquery('english', ${query})`;
    const rankSql = Prisma.sql`ts_rank(n."searchVector", ${tsQuery})`;

    // Build dynamic WHERE clauses
    const conditions = [
      Prisma.sql`n."userId" = ${userId}`,
      Prisma.sql`n."searchVector" @@ ${tsQuery}`,
    ];

    // Status filter: use provided status or default to excluding ARCHIVED
    if (filters.status) {
      conditions.push(Prisma.sql`n."status" = ${filters.status}::"NoteStatus"`);
    } else {
      conditions.push(Prisma.sql`n."status" != 'ARCHIVED'`);
    }

    // Cursor-based pagination. The keyset MUST mirror the ORDER BY tuple
    // (rank DESC, updatedAt DESC, id DESC) or pagination skips/duplicates rows.
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      if (cursor.rank === null) {
        // Legacy id-only cursor (pre-compound pagination).
        conditions.push(Prisma.sql`n."id" < ${cursor.id}`);
      } else if (cursor.updatedAt === null) {
        // Transitional cursor issued before the recency tiebreak shipped:
        // fall back to the 2-key (rank, id) keyset.
        conditions.push(
          Prisma.sql`(${rankSql} < ${cursor.rank} OR (${rankSql} = ${cursor.rank} AND n."id" < ${cursor.id}))`,
        );
      } else {
        const cursorUpdatedAt = new Date(cursor.updatedAt);
        conditions.push(
          Prisma.sql`(
            ${rankSql} < ${cursor.rank}
            OR (${rankSql} = ${cursor.rank} AND n."updatedAt" < ${cursorUpdatedAt})
            OR (${rankSql} = ${cursor.rank} AND n."updatedAt" = ${cursorUpdatedAt} AND n."id" < ${cursor.id})
          )`,
        );
      }
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    // Tag filter: join with the implicit _NoteToTag and Tag tables
    let joinClause = Prisma.empty;
    if (filters.tag) {
      joinClause = Prisma.sql`
        INNER JOIN "_NoteToTag" nt ON nt."A" = n."id"
        INNER JOIN "Tag" t ON t."id" = nt."B" AND t."name" = ${filters.tag}`;
    }

    const results = await prisma.$queryRaw`
      SELECT n."id", n."slug", n."title", n."excerpt", n."status", n."updatedAt",
             ${rankSql} AS rank
      FROM "Note" n
      ${joinClause}
      ${whereClause}
      ORDER BY rank DESC, n."updatedAt" DESC, n."id" DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = results.length > limit;
    if (hasMore) results.pop();

    // Encode the cursor from the full row (needs updatedAt) BEFORE stripping it.
    const nextCursor = hasMore ? encodeCursor(results[results.length - 1]) : null;

    // updatedAt is selected only to drive ordering + the keyset cursor; strip it
    // so the public SearchResponse shape (id/slug/title/excerpt/status/rank) is unchanged.
    return {
      notes: results.map(({ updatedAt, ...note }) => note),
      nextCursor,
    };
  },

  /**
   * Return notes useful for session-start context loading.
   *
   * With a topic, this uses the same full-text search ranking as `search`.
   * Without a topic, this returns the most recently updated non-archived notes.
   *
   * @param {string} userId
   * @param {{ topic?: string, limit?: number }} [opts={}]
   * @returns {Promise<Array<{ id: string, slug: string, title: string, excerpt: string | null, source: string | null, confidence: number | null, importance: number | null, score: number | null, snippet: string | null, tags: string[], updatedAt: string }>>}
   */
  async getContext(userId, opts = {}) {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;

    if (!opts.topic) {
      const notes = await prisma.note.findMany({
        where: { userId, status: { not: 'ARCHIVED' } },
        take: limit,
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
        include: { tags: true },
      });

      return notes.map((note) => ({
        id: note.id,
        slug: note.slug,
        title: note.title,
        excerpt: note.excerpt,
        source: note.source,
        confidence: note.confidence,
        importance: note.importance,
        score: null,
        snippet: note.excerpt,
        tags: note.tags.map((tag) => tag.name),
        updatedAt: note.updatedAt.toISOString(),
      }));
    }

    const tsQuery = Prisma.sql`websearch_to_tsquery('english', ${opts.topic})`;
    let results = await prisma.$queryRaw`
      SELECT n."id", n."slug", n."title", n."excerpt", n."source", n."confidence", n."importance", n."updatedAt",
             n."pinned",
             ts_rank(n."searchVector", ${tsQuery}) AS score,
             ts_headline('english', n."content", ${tsQuery},
               'MaxFragments=2, MaxWords=30') AS snippet
      FROM "Note" n
      WHERE n."userId" = ${userId}
        AND n."status" != 'ARCHIVED'
        AND n."searchVector" @@ ${tsQuery}
      ORDER BY n."pinned" DESC, ts_rank(n."searchVector", ${tsQuery}) * (1 + COALESCE(n."importance", 0) * ${IMPORTANCE_BOOST}) DESC, n."updatedAt" DESC
      LIMIT ${limit}
    `;

    // Lexical miss (typo / paraphrase) → pg_trgm fuzzy fallback on title.
    if (results.length === 0) {
      results = await prisma.$queryRaw`
        SELECT n."id", n."slug", n."title", n."excerpt", n."source", n."confidence", n."importance", n."updatedAt",
               similarity(n."title", ${opts.topic}) AS score,
               n."excerpt" AS snippet
        FROM "Note" n
        WHERE n."userId" = ${userId}
          AND n."status" != 'ARCHIVED'
          AND similarity(n."title", ${opts.topic}) > ${TRIGRAM_SIMILARITY_THRESHOLD}
        ORDER BY score DESC, n."updatedAt" DESC
        LIMIT ${limit}
      `;
    }

    const noteIds = results.map((note) => note.id);
    const tagRows = noteIds.length
      ? await prisma.$queryRaw`
          SELECT nt."A" AS "noteId", t."name"
          FROM "_NoteToTag" nt
          INNER JOIN "Tag" t ON t."id" = nt."B"
          WHERE nt."A" IN (${Prisma.join(noteIds)})
        `
      : [];

    const tagMap = new Map();
    for (const row of tagRows) {
      const tags = tagMap.get(row.noteId) ?? [];
      tags.push(row.name);
      tagMap.set(row.noteId, tags);
    }

    return results.map((note) => ({
      id: note.id,
      slug: note.slug,
      title: note.title,
      excerpt: note.excerpt,
      source: note.source,
      confidence: note.confidence,
      importance: note.importance,
      score: note.score == null ? null : Number(note.score),
      snippet: note.snippet ?? note.excerpt,
      tags: tagMap.get(note.id) ?? [],
      updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt,
    }));
  },
};
