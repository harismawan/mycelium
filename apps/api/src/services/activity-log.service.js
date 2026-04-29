import { DEFAULT_PAGE_LIMIT } from '@mycelium/shared';
import { prisma } from '../db.js';

/**
 * Service responsible for creating and querying activity log records.
 * Activity logs track agent actions for audit and observability.
 */
export const ActivityLogService = {
  /**
   * Create an activity log record. Errors are caught and logged,
   * never thrown to the caller (fire-and-forget).
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.apiKeyId
   * @param {string} params.apiKeyName
   * @param {string} params.action
   * @param {string|null} [params.targetResourceId]
   * @param {string|null} [params.targetResourceSlug]
   * @param {Object} [params.details]
   * @param {string} [params.status]
   * @returns {Promise<void>}
   */
  async logAction(params) {
    try {
      await prisma.activityLog.create({
        data: {
          userId: params.userId,
          apiKeyId: params.apiKeyId,
          apiKeyName: params.apiKeyName,
          action: params.action,
          targetResourceId: params.targetResourceId ?? null,
          targetResourceSlug: params.targetResourceSlug ?? null,
          details: params.details ?? {},
          status: params.status ?? 'success',
        },
      });
    } catch (error) {
      console.error('Failed to persist activity log:', error);
    }
  },

  /**
   * List activity log entries with cursor-based pagination and optional filters.
   *
   * @param {string} userId
   * @param {{ cursor?: string, limit?: number, action?: string, apiKeyName?: string }} [opts]
   * @returns {Promise<{ entries: Object[], nextCursor: string|null }>}
   */
  async listEntries(userId, opts = {}) {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;

    /** @type {Record<string, unknown>} */
    const where = { userId };

    if (opts.action) {
      where.action = opts.action;
    }

    if (opts.apiKeyName) {
      where.apiKeyName = opts.apiKeyName;
    }

    const entries = await prisma.activityLog.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = entries.length > limit;
    if (hasMore) entries.pop();

    return {
      entries,
      nextCursor: hasMore ? entries[entries.length - 1].id : null,
    };
  },
};
