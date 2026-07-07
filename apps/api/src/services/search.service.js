import { DEFAULT_PAGE_LIMIT, MEMORY_DECAY_RATE, MEMORY_NAMESPACE_DIR, RRF_K } from '@mycelium/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { LinkService } from './link.service.js';
import { embedText } from './embedding.service.js';

/** Per-arm candidate-pool size before fusion. */
const RRF_CANDIDATE_LIMIT = 100;

// Minimum pg_trgm title similarity for the fuzzy fallback when the
// websearch_to_tsquery lexical query returns zero rows.
const TRIGRAM_SIMILARITY_THRESHOLD = 0.3;

/**
 * Multiplier applied per `importance` point when ranking topic results.
 * `importance` is agent-supplied and gameable — keep this weight low and tunable.
 */
const IMPORTANCE_BOOST = 0.15;

/** Weight applied to the normalized graph (co-citation) boost in expanded recall. */
const GRAPH_BOOST_WEIGHT = 0.3;
/** Hard cap on BFS depth for graph-aware expansion (defensive; mirrors the tool's zod max). */
const MAX_EXPAND_DEPTH = 3;

/** Clamp an arbitrary expandDepth input to [1, MAX_EXPAND_DEPTH]. */
function clampExpandDepth(depth) {
  const d = Math.trunc(Number(depth) || 1);
  return Math.min(Math.max(d, 1), MAX_EXPAND_DEPTH);
}

/** tsquery operator tokens that must never survive into a rebuilt OR query. */
const TSQUERY_OPERATOR_TOKENS = new Set(['OR', 'AND', 'NOT', '-', '|', '&', '!', '<->']);

/**
 * Rebuild a natural-language query as an OR-of-terms string for a wider,
 * recall-first pass. The result is passed as a bound parameter to
 * `websearch_to_tsquery`, which treats a literal `OR` between words as
 * disjunction — so `"api localhost mycelium"` becomes `"api OR localhost OR
 * mycelium"` and matches notes containing *any* term (ranked by ts_rank).
 *
 * Operator-only tokens are dropped so a user-supplied `OR`/`-`/`|` cannot
 * inject stray tsquery syntax. Returns `null` when fewer than 2 usable tokens
 * remain (the OR variant would be identical to the strict query).
 *
 * @param {string} query
 * @returns {string | null}
 */
function buildOrQuery(query) {
  const tokens = String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TSQUERY_OPERATOR_TOKENS.has(t));
  if (tokens.length < 2) return null;
  return tokens.join(' OR ');
}

/** Min-max normalize a value into 0..1; returns 1 when all values are equal. */
function minMaxNormalize(value, min, max) {
  if (max === min) return 1;
  return (value - min) / (max - min);
}

function encodeCursor(note) {
  const updatedAt =
    note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt ?? null;
  return Buffer.from(
    JSON.stringify({ rank: Number(note.rank), updatedAt, id: note.id }),
  ).toString('base64url');
}

/**
 * Resolve the directory id for the memories/<apiKeyId> namespace subtree.
 * Read-only: returns null (never creates) when the subtree does not exist.
 *
 * @param {string} userId
 * @param {string} apiKeyId
 * @returns {Promise<string | null>}
 */
async function resolveNamespaceDirId(userId, apiKeyId) {
  const root = await prisma.directory.findFirst({
    where: { userId, parentId: null, name: MEMORY_NAMESPACE_DIR },
    select: { id: true },
  });
  if (!root) return null;

  const child = await prisma.directory.findFirst({
    where: { userId, parentId: root.id, name: apiKeyId },
    select: { id: true },
  });
  return child?.id ?? null;
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
 * Fuse ranked candidate lists with Reciprocal Rank Fusion.
 *
 * A document's fused score is `Σ 1/(k + rank)` over every list it appears in
 * (rank 0-based). RRF compares only ordinal positions, so the lexical
 * `ts_rank` float and the vector cosine distance never need to be normalized
 * onto a common scale. Output is sorted by fused score desc, then id desc
 * (matching the lexical path's `n."id" DESC` tiebreak); `rank` carries the
 * fused score so the existing `{rank,id}` cursor still works.
 *
 * @template {{ id: string }} T
 * @param {T[][]} lists - Candidate lists, each already sorted best-first.
 * @param {number} k - RRF constant.
 * @returns {Array<T & { rank: number }>}
 */
function rrfFuse(lists, k) {
  const scores = new Map();
  const rows = new Map();
  for (const list of lists) {
    list.forEach((rowItem, idx) => {
      scores.set(rowItem.id, (scores.get(rowItem.id) ?? 0) + 1 / (k + idx));
      if (!rows.has(rowItem.id)) rows.set(rowItem.id, rowItem);
    });
  }
  return [...rows.values()]
    .map((rowItem) => ({ ...rowItem, rank: scores.get(rowItem.id) }))
    .sort((a, b) => b.rank - a.rank || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
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

    // Embed the query once. null => arm disabled or provider failed => fall
    // through to the lexical-only path (byte-identical to pre-pgvector).
    const queryVector = await embedText(query).catch(() => null);

    if (!queryVector) {
      const runLexical = async (tsQuery) => {
        const rankSql = Prisma.sql`ts_rank(n."searchVector", ${tsQuery})`;

        const conditions = [
          Prisma.sql`n."userId" = ${userId}`,
          Prisma.sql`n."searchVector" @@ ${tsQuery}`,
        ];

        if (filters.status) {
          conditions.push(Prisma.sql`n."status" = ${filters.status}::"NoteStatus"`);
        } else {
          conditions.push(Prisma.sql`n."status" != 'ARCHIVED'`);
        }

        if (filters.cursor) {
          const cursor = decodeCursor(filters.cursor);
          if (cursor.rank === null) {
            conditions.push(Prisma.sql`n."id" < ${cursor.id}`);
          } else if (cursor.updatedAt === null) {
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
        const nextCursor = hasMore ? encodeCursor(results[results.length - 1]) : null;

        return {
          notes: results.map(({ updatedAt, ...note }) => note),
          nextCursor,
        };
      };

      const strictOut = await runLexical(tsQuery);
      // Strict hit, or a cursor page (cursors are only ever minted by the strict
      // tier) → stay strict. Relaxation only fires on an empty first page.
      if (strictOut.notes.length > 0 || filters.cursor) return strictOut;

      // Tier 2: OR-relax. Single-page rescue (nextCursor null) so a later page
      // can never mix the OR ts_rank scale with the strict keyset.
      const orText = buildOrQuery(query);
      if (orText) {
        const orOut = await runLexical(Prisma.sql`websearch_to_tsquery('english', ${orText})`);
        if (orOut.notes.length > 0) return { notes: orOut.notes, nextCursor: null };
      }

      // Tier 3: pg_trgm fuzzy fallback on title (typo / paraphrase). Single page.
      const statusCondition = filters.status
        ? Prisma.sql`n."status" = ${filters.status}::"NoteStatus"`
        : Prisma.sql`n."status" != 'ARCHIVED'`;
      let trgJoin = Prisma.empty;
      if (filters.tag) {
        trgJoin = Prisma.sql`
          INNER JOIN "_NoteToTag" nt ON nt."A" = n."id"
          INNER JOIN "Tag" t ON t."id" = nt."B" AND t."name" = ${filters.tag}`;
      }
      const fuzzy = await prisma.$queryRaw`
        SELECT n."id", n."slug", n."title", n."excerpt", n."status",
               similarity(n."title", ${query}) AS rank
        FROM "Note" n
        ${trgJoin}
        WHERE n."userId" = ${userId}
          AND ${statusCondition}
          AND similarity(n."title", ${query}) > ${TRIGRAM_SIMILARITY_THRESHOLD}
        ORDER BY rank DESC, n."updatedAt" DESC, n."id" DESC
        LIMIT ${limit}
      `;
      return { notes: fuzzy, nextCursor: null };
    }

    // ---- fused RRF path -------------------------------------------------------
    // Run lexical and vector candidate queries independently, then fuse in memory
    // with Reciprocal Rank Fusion. Paginate over the materialized fused list using
    // the same {rank,id} cursor wire-format; `rank` carries the RRF score.
    const vecLiteral = `[${queryVector.join(',')}]`;
    const statusCondition = filters.status
      ? Prisma.sql`n."status" = ${filters.status}::"NoteStatus"`
      : Prisma.sql`n."status" != 'ARCHIVED'`;
    let joinClause = Prisma.empty;
    if (filters.tag) {
      joinClause = Prisma.sql`
        INNER JOIN "_NoteToTag" nt ON nt."A" = n."id"
        INNER JOIN "Tag" t ON t."id" = nt."B" AND t."name" = ${filters.tag}`;
    }

    const lexicalRows = await prisma.$queryRaw`
      SELECT n."id", n."slug", n."title", n."excerpt", n."status"
      FROM "Note" n
      ${joinClause}
      WHERE n."userId" = ${userId}
        AND ${statusCondition}
        AND n."searchVector" @@ ${tsQuery}
      ORDER BY ts_rank(n."searchVector", ${tsQuery}) DESC, n."id" DESC
      LIMIT ${RRF_CANDIDATE_LIMIT}
    `;

    const vectorRows = await prisma.$queryRaw`
      SELECT n."id", n."slug", n."title", n."excerpt", n."status"
      FROM "Note" n
      ${joinClause}
      WHERE n."userId" = ${userId}
        AND ${statusCondition}
        AND n."embedding" IS NOT NULL
      ORDER BY n."embedding" <=> ${vecLiteral}::vector ASC
      LIMIT ${RRF_CANDIDATE_LIMIT}
    `;

    let fused = rrfFuse([lexicalRows, vectorRows], RRF_K);

    // Keyset pagination over the in-memory fused list. The cursor stays
    // {rank,id}; `rank` now carries the fused RRF score, so the wire-format is
    // unchanged. A cursor minted on the lexical path has an updatedAt component
    // that is simply ignored here (the fused list is sorted by RRF score, not
    // updatedAt), and a cursor minted on the fused path has updatedAt=null which
    // causes decodeCursor to return updatedAt=null — also harmless.
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      fused = cursor.rank === null
        ? fused.filter((r) => r.id < cursor.id)
        : fused.filter((r) => r.rank < cursor.rank || (r.rank === cursor.rank && r.id < cursor.id));
    }

    const hasMore = fused.length > limit;
    const page = fused.slice(0, limit);

    return {
      notes: page,
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    };
  },

  /**
   * Return notes useful for session-start context loading.
   *
   * With a topic, this uses the same full-text search ranking as `search`.
   * Without a topic, this returns the most recently updated non-archived notes.
   *
   * When `expand` is true and a topic is given, the lexical seeds are augmented
   * with graph neighbors that the seeds co-cite (`_expandNeighbors`), then the
   * combined set is re-ranked with a min-max-normalized lexical + co-citation
   * blend. Note: expand=false returns the full agent-facing shape with ranking
   * metadata, while expand=true returns a minimal shape for context hydration.
   *
   * @param {string} userId
   * @param {{ topic?: string, limit?: number, expand?: boolean, expandDepth?: number, namespace?: string }} [opts={}]
   * @returns {Promise<Array<{ id: string, slug: string, title: string, excerpt: string | null, tags: string[], updatedAt: string } | { id: string, slug: string, title: string, excerpt: string | null, source: string | null, confidence: number | null, importance: number | null, score: number | null, snippet: string | null, tags: string[], updatedAt: string }>>} — expand=false returns rich shape (with source, confidence, importance, score, snippet); expand=true returns minimal shape (id, slug, title, excerpt, tags, updatedAt only)
   */
  async getContext(userId, opts = {}) {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;

    // Optional namespace filter: scope to the memories/<apiKeyId> subtree.
    let namespaceDirId;
    if (opts.namespace) {
      namespaceDirId = await resolveNamespaceDirId(userId, opts.namespace);
      if (!namespaceDirId) return [];
    }

    if (!opts.topic) {
      const notes = await prisma.note.findMany({
        where: {
          userId,
          status: { not: 'ARCHIVED' },
          ...(namespaceDirId ? { directoryId: namespaceDirId } : {}),
        },
        take: limit,
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
        include: { tags: true },
      });

      // Fire-and-forget salience bump: never block or fail the read on it.
      void this._touchAccess(notes.map((note) => note.id)).catch(() => {});

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

    // Graph-aware expansion: use a lean seed query (ts_rank AS rank), blend with
    // graph co-citation scores, then return the minimal canonical shape.
    if (opts.expand) {
      const runSeed = (seedTsQuery) => prisma.$queryRaw`
        SELECT n."id", n."slug", n."title", n."excerpt", n."updatedAt",
               ts_rank(n."searchVector", ${seedTsQuery}) AS rank
        FROM "Note" n
        WHERE n."userId" = ${userId}
          AND n."status" != 'ARCHIVED'
          ${namespaceDirId ? Prisma.sql`AND n."directoryId" = ${namespaceDirId}` : Prisma.empty}
          AND n."searchVector" @@ ${seedTsQuery}
        ORDER BY rank DESC, n."updatedAt" DESC
        LIMIT ${limit}
      `;

      let seedRows = await runSeed(tsQuery);
      if (seedRows.length === 0) {
        const orText = buildOrQuery(opts.topic);
        if (orText) {
          seedRows = await runSeed(Prisma.sql`websearch_to_tsquery('english', ${orText})`);
        }
      }

      if (seedRows.length === 0) return [];

      const depth = clampExpandDepth(opts.expandDepth ?? 1);
      const seedIds = seedRows.map((r) => r.id);
      const numSeeds = seedIds.length;
      const neighbors = await LinkService._expandNeighbors(userId, seedIds, depth);

      const ranks = seedRows.map((r) => Number(r.rank));
      const minRank = Math.min(...ranks);
      const maxRank = Math.max(...ranks);

      const scored = [
        ...seedRows.map((row) => ({
          note: row,
          score: minMaxNormalize(Number(row.rank), minRank, maxRank),
        })),
        ...neighbors.map((neighbor) => ({
          note: neighbor,
          score: GRAPH_BOOST_WEIGHT * (neighbor.seedLinks / numSeeds),
        })),
      ];

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const at = new Date(a.note.updatedAt).getTime();
        const bt = new Date(b.note.updatedAt).getTime();
        if (bt !== at) return bt - at;
        return a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0;
      });

      // Fire-and-forget salience bump for expanded memories.
      void this._touchAccess(scored.slice(0, limit).map((entry) => entry.note.id)).catch(() => {});

      return this._attachTags(scored.slice(0, limit).map((entry) => entry.note));
    }

    // Embed the query once for the flat lexical path. null => arm disabled or
    // provider failed => fall through to the unchanged lexical-only path.
    const queryVector = await embedText(opts.topic).catch(() => null);

    if (queryVector) {
      // Fused RRF path: run lexical and vector candidate queries, fuse in memory,
      // then return the minimal canonical shape via _attachTags (same as expand=true).
      const vecLiteral = `[${queryVector.join(',')}]`;
      const lexicalRows = await prisma.$queryRaw`
        SELECT n."id", n."slug", n."title", n."excerpt", n."updatedAt"
        FROM "Note" n
        WHERE n."userId" = ${userId}
          AND n."status" != 'ARCHIVED'
          ${namespaceDirId ? Prisma.sql`AND n."directoryId" = ${namespaceDirId}` : Prisma.empty}
          AND n."searchVector" @@ ${tsQuery}
        ORDER BY ts_rank(n."searchVector", ${tsQuery}) DESC, n."updatedAt" DESC
        LIMIT ${RRF_CANDIDATE_LIMIT}
      `;
      const vectorRows = await prisma.$queryRaw`
        SELECT n."id", n."slug", n."title", n."excerpt", n."updatedAt"
        FROM "Note" n
        WHERE n."userId" = ${userId}
          AND n."status" != 'ARCHIVED'
          ${namespaceDirId ? Prisma.sql`AND n."directoryId" = ${namespaceDirId}` : Prisma.empty}
          AND n."embedding" IS NOT NULL
        ORDER BY n."embedding" <=> ${vecLiteral}::vector ASC
        LIMIT ${RRF_CANDIDATE_LIMIT}
      `;
      // Fuse, then keep the top `limit`. The extra `rank` field is dropped by
      // _attachTags, so getContext's return shape is unchanged.
      const fused = rrfFuse([lexicalRows, vectorRows], RRF_K).slice(0, limit);

      // Fire-and-forget salience bump for fused RRF memories.
      void this._touchAccess(fused.map((n) => n.id)).catch(() => {});

      return this._attachTags(fused);
    }

    // Flat lexical path (expand=false / default): preserve the original behavior.
    const runFlatLexical = (flatTsQuery) => prisma.$queryRaw`
      SELECT n."id", n."slug", n."title", n."excerpt", n."source", n."confidence", n."importance", n."updatedAt",
             n."pinned",
             ts_rank(n."searchVector", ${flatTsQuery}) AS score,
             ts_headline('english', n."content", ${flatTsQuery},
               'MaxFragments=2, MaxWords=30') AS snippet
      FROM "Note" n
      WHERE n."userId" = ${userId}
        AND n."status" != 'ARCHIVED'
        ${namespaceDirId ? Prisma.sql`AND n."directoryId" = ${namespaceDirId}` : Prisma.empty}
        AND n."searchVector" @@ ${flatTsQuery}
      ORDER BY n."pinned" DESC, ts_rank(n."searchVector", ${flatTsQuery}) * (1 + COALESCE(n."importance", 0) * ${IMPORTANCE_BOOST}) * exp(${-MEMORY_DECAY_RATE}::float8 * EXTRACT(EPOCH FROM (now() - COALESCE(n."lastAccessedAt", n."createdAt"))) / 86400.0) DESC, COALESCE(n."lastAccessedAt", n."createdAt") DESC
      LIMIT ${limit}
    `;

    let results = await runFlatLexical(tsQuery);

    // Tier 2: OR-relax before the fuzzy fallback.
    if (results.length === 0) {
      const orText = buildOrQuery(opts.topic);
      if (orText) {
        results = await runFlatLexical(Prisma.sql`websearch_to_tsquery('english', ${orText})`);
      }
    }

    // Tier 3: lexical miss (typo / paraphrase) → pg_trgm fuzzy fallback on title.
    if (results.length === 0) {
      results = await prisma.$queryRaw`
        SELECT n."id", n."slug", n."title", n."excerpt", n."source", n."confidence", n."importance", n."updatedAt",
               similarity(n."title", ${opts.topic}) AS score,
               n."excerpt" AS snippet
        FROM "Note" n
        WHERE n."userId" = ${userId}
          AND n."status" != 'ARCHIVED'
          ${namespaceDirId ? Prisma.sql`AND n."directoryId" = ${namespaceDirId}` : Prisma.empty}
          AND similarity(n."title", ${opts.topic}) > ${TRIGRAM_SIMILARITY_THRESHOLD}
        ORDER BY score DESC, n."updatedAt" DESC
        LIMIT ${limit}
      `;
    }

    const noteIds = results.map((note) => note.id);

    // Fire-and-forget salience bump for the matched memories.
    void this._touchAccess(noteIds).catch(() => {});

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

  /**
   * Hydrate tags onto a list of note rows and project them into the canonical
   * getContext shape for the expand=true path: `{ id, slug, title, excerpt, tags, updatedAt }`.
   *
   * Drops internal fields (e.g. `rank`, `seedLinks`) so the returned shape is
   * consistent for seeds and graph-expanded neighbors alike.
   *
   * @param {Array<{ id: string, slug: string, title: string, excerpt: string|null, updatedAt: Date|string }>} rows
   * @returns {Promise<Array<{ id: string, slug: string, title: string, excerpt: string|null, tags: string[], updatedAt: string }>>}
   * @private
   */
  async _attachTags(rows) {
    const noteIds = rows.map((note) => note.id);
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

    return rows.map((note) => ({
      id: note.id,
      slug: note.slug,
      title: note.title,
      excerpt: note.excerpt,
      tags: tagMap.get(note.id) ?? [],
      updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt,
    }));
  },

  /**
   * Best-effort recency/usage bump for the notes a read just returned.
   *
   * Uses a raw UPDATE — NOT `prisma.note.update` — so Prisma's `@updatedAt`
   * mapping does not fire. Bumping `updatedAt` would corrupt both the recency
   * signal this feature ranks on AND the human SPA's last-edited column.
   *
   * @param {string[]} noteIds
   * @returns {Promise<void>}
   * @private
   */
  async _touchAccess(noteIds) {
    if (!noteIds.length) return;
    await prisma.$executeRaw`
      UPDATE "Note"
      SET "lastAccessedAt" = now(),
          "accessCount" = "accessCount" + 1
      WHERE "id" IN (${Prisma.join(noteIds)})
    `;
  },
};
