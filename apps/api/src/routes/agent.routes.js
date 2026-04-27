import Elysia, { t } from 'elysia';
import { SCOPES } from '@mycelium/shared';
import { authMiddleware, requireScopes } from '../middleware/auth.js';
import { AgentService } from '../services/agent.service.js';

/**
 * Agent route group — `/api/v1/agent`
 *
 * All routes require API key authentication with the `agent:read` scope.
 * Provides machine-friendly endpoints for AI agent consumption:
 * manifest discovery, NDJSON bundle streaming, and simplified note listing.
 *
 * @type {Elysia}
 */
export const agentRoutes = new Elysia({ prefix: '/api/v1/agent' })
  .use(authMiddleware)
  .use(requireScopes(SCOPES.AGENT_READ))

  // GET /manifest — return JSON manifest describing the agent API
  .get('/manifest', () => {
    return AgentService.getManifest();
  })

  // GET /bundle — stream all PUBLISHED notes as NDJSON
  .get(
    '/bundle',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      const stream = AgentService.streamBundle(ctx.user.id);
      return new Response(stream, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    },
  )

  // GET /notes — simplified paginated note list for agents
  .get(
    '/notes',
    async (/** @type {{ user: { id: string }, query: { cursor?: string, limit?: string } }} */ ctx) => {
      const limit = ctx.query.limit ? parseInt(ctx.query.limit, 10) : undefined;
      const cursor = ctx.query.cursor || undefined;

      return AgentService.listAgentNotes(ctx.user.id, { cursor, limit });
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  );
