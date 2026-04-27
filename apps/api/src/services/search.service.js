import { DEFAULT_PAGE_LIMIT } from '@mycelium/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

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

    // Build dynamic WHERE clauses
    const conditions = [
      Prisma.sql`n."userId" = ${userId}`,
      Prisma.sql`n."searchVector" @@ plainto_tsquery('english', ${query})`,
    ];

    // Status filter: use provided status or default to excluding ARCHIVED
    if (filters.status) {
      conditions.push(Prisma.sql`n."status" = ${filters.status}::"NoteStatus"`);
    } else {
      conditions.push(Prisma.sql`n."status" != 'ARCHIVED'`);
    }

    // Cursor-based pagination
    if (filters.cursor) {
      conditions.push(Prisma.sql`n."id" < ${filters.cursor}`);
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
             ts_rank(n."searchVector", plainto_tsquery('english', ${query})) AS rank
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
      nextCursor: hasMore ? results[results.length - 1].id : null,
    };
  },
};
