import { DEFAULT_PAGE_LIMIT } from '@mycelium/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

function encodeCursor(note) {
  return Buffer.from(JSON.stringify({ rank: Number(note.rank), id: note.id })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.id === 'string' && Number.isFinite(Number(parsed.rank))) {
      return { id: parsed.id, rank: Number(parsed.rank) };
    }
  } catch {
    // Fall back below for cursors produced before compound search pagination.
  }
  return { id: cursor, rank: null };
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

    // Cursor-based pagination
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      conditions.push(
        cursor.rank === null
          ? Prisma.sql`n."id" < ${cursor.id}`
          : Prisma.sql`(${rankSql} < ${cursor.rank} OR (${rankSql} = ${cursor.rank} AND n."id" < ${cursor.id}))`,
      );
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
      SELECT n."id", n."slug", n."title", n."excerpt", n."status",
             ${rankSql} AS rank
      FROM "Note" n
      ${joinClause}
      ${whereClause}
      ORDER BY rank DESC, n."id" DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = results.length > limit;
    if (hasMore) results.pop();

    return {
      notes: results,
      nextCursor: hasMore ? encodeCursor(results[results.length - 1]) : null,
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
   * @returns {Promise<Array<{ id: string, slug: string, title: string, excerpt: string | null, score: number | null, snippet: string | null, tags: string[], updatedAt: string }>>}
   */
  async getContext(userId, opts = {}) {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;

    if (!opts.topic) {
      const notes = await prisma.note.findMany({
        where: { userId, status: { not: 'ARCHIVED' } },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: { tags: true },
      });

      return notes.map((note) => ({
        id: note.id,
        slug: note.slug,
        title: note.title,
        excerpt: note.excerpt,
        score: null,
        snippet: note.excerpt,
        tags: note.tags.map((tag) => tag.name),
        updatedAt: note.updatedAt.toISOString(),
      }));
    }

    const tsQuery = Prisma.sql`websearch_to_tsquery('english', ${opts.topic})`;
    let results = await prisma.$queryRaw`
      SELECT n."id", n."slug", n."title", n."excerpt", n."updatedAt",
             ts_rank(n."searchVector", ${tsQuery}) AS score,
             ts_headline('english', n."content", ${tsQuery},
               'MaxFragments=2, MaxWords=30') AS snippet
      FROM "Note" n
      WHERE n."userId" = ${userId}
        AND n."status" != 'ARCHIVED'
        AND n."searchVector" @@ ${tsQuery}
      ORDER BY score DESC, n."updatedAt" DESC
      LIMIT ${limit}
    `;

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
      score: note.score == null ? null : Number(note.score),
      snippet: note.snippet ?? note.excerpt,
      tags: tagMap.get(note.id) ?? [],
      updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt,
    }));
  },
};
