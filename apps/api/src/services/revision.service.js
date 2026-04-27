import { DEFAULT_PAGE_LIMIT } from '@mycelium/shared';
import { prisma } from '../db.js';

/**
 * Revision service for listing and retrieving note revision history.
 */
export const RevisionService = {
  /**
   * List revisions for a note with cursor-based pagination, ordered by
   * creation date descending (newest first).
   *
   * @param {string} noteId - The note ID to list revisions for.
   * @param {{ cursor?: string, limit?: number }} [opts={}]
   * @returns {Promise<{ revisions: import('@prisma/client').Revision[], nextCursor: string | null }>}
   */
  async listRevisions(noteId, opts = {}) {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;

    const revisions = await prisma.revision.findMany({
      where: { noteId },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = revisions.length > limit;
    if (hasMore) revisions.pop();

    return {
      revisions,
      nextCursor: hasMore ? revisions[revisions.length - 1].id : null,
    };
  },

  /**
   * Get a single revision by ID.
   *
   * @param {string} revisionId - The revision ID.
   * @returns {Promise<import('@prisma/client').Revision | null>}
   */
  async getRevision(revisionId) {
    return prisma.revision.findUnique({
      where: { id: revisionId },
    });
  },
};
