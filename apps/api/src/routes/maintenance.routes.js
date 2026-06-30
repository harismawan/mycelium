import Elysia, { t } from 'elysia';
import { SCOPES } from '@mycelium/shared';
import { authMiddleware, requireScopes } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { NoteService } from '../services/note.service.js';
import { ForgetStaleResponse } from '../schemas/responses.js';

/**
 * Maintenance route group — `/api/v1/maintenance`
 *
 * OPERATIONAL SURFACE. These endpoints mutate stored data and are designed to
 * be driven by an EXTERNAL scheduler (system cron, k8s CronJob, etc.) using an
 * API key that holds the `notes:write` scope. No in-process scheduler is
 * registered by the app — see apps/mcp/SKILL.md "Forgetting & maintenance".
 *
 * @type {Elysia}
 */
export const maintenanceRoutes = new Elysia({ prefix: '/api/v1/maintenance' })
  .use(authMiddleware)
  .use(csrfMiddleware)
  .use(requireScopes(SCOPES.NOTES_WRITE))

  // POST /forget-stale — archive stale, low-salience memories (soft delete)
  .post(
    '/forget-stale',
    async (/** @type {{ body?: { olderThanDays?: number }, user: { id: string } }} */ ctx) => {
      const olderThanDays = ctx.body?.olderThanDays;
      return NoteService.forgetStale(ctx.user.id, { olderThanDays });
    },
    {
      body: t.Optional(
        t.Object({
          olderThanDays: t.Optional(
            t.Integer({ minimum: 1, description: 'Archive memories older (by last access) than this many days.' }),
          ),
        }),
      ),
      response: {
        200: ForgetStaleResponse,
      },
      detail: {
        summary: 'Archive stale, low-salience agent memories',
        description:
          'Soft-deletes (ARCHIVES) non-pinned, low-importance notes whose last access — or creation, if never accessed — predates the cutoff. Intended to be invoked by an external scheduler. Requires Bearer API key with notes:write scope.',
        tags: ['Maintenance'],
        operationId: 'forgetStale',
        security: [{ bearerApiKey: [] }],
      },
    },
  );
