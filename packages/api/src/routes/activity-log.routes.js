import Elysia, { t } from 'elysia';
import { authMiddleware } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { ActivityLogService } from '../services/activity-log.service.js';

/**
 * Activity log route group — `/api/v1/activity-log`
 *
 * All routes require authentication (JWT or API key).
 * Rate limiting is applied after auth for API-key-authenticated requests.
 *
 * @type {Elysia}
 */
export const activityLogRoutes = new Elysia({ prefix: '/api/v1/activity-log' })
  .use(authMiddleware)
  .use(csrfMiddleware)
  .use(rateLimiter())

  // GET / — list activity log entries with optional filters and cursor pagination
  .get(
    '/',
    async (/** @type {{ query: { cursor?: string, limit?: string, action?: string, apiKeyName?: string }, user: { id: string } }} */ ctx) => {
      const { cursor, limit, action, apiKeyName } = ctx.query;
      const result = await ActivityLogService.listEntries(ctx.user.id, {
        cursor: cursor || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        action: action || undefined,
        apiKeyName: apiKeyName || undefined,
      });
      return result;
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        action: t.Optional(t.String()),
        apiKeyName: t.Optional(t.String()),
      }),
    },
  );
