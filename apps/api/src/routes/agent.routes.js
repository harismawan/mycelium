import Elysia, { t } from 'elysia';
import { SCOPES } from '@mycelium/shared';
import { authMiddleware, requireScopes } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { AgentService } from '../services/agent.service.js';
import { AgentManifestResponse, AgentNotesResponse } from '../schemas/responses.js';

/**
 * Agent route group — `/api/v1/agent`
 *
 * All routes require API key authentication with the `agent:read` scope.
 * Rate limiting is applied after auth for API-key-authenticated requests.
 * Provides machine-friendly endpoints for AI agent consumption:
 * manifest discovery, NDJSON bundle streaming, and simplified note listing.
 *
 * @type {Elysia}
 */
export const agentRoutes = new Elysia({ prefix: '/api/v1/agent' })
  .use(authMiddleware)
  .use(csrfMiddleware)
  .use(rateLimiter())
  .use(requireScopes(SCOPES.AGENT_READ))

  // GET /manifest — return JSON manifest describing the agent API
  .get('/manifest', () => {
    return AgentService.getManifest();
  }, {
    response: {
      200: AgentManifestResponse,
    },
    detail: {
      summary: 'Get the agent API manifest',
      description: 'Returns a JSON manifest describing available agent endpoints, content schema, and authentication requirements. Requires Bearer API key with agent:read scope.',
      tags: ['Agent'],
      operationId: 'getAgentManifest',
      security: [{ bearerApiKey: [] }],
    },
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
    {
      detail: {
        summary: 'Stream all published notes as NDJSON',
        description: 'Streams all PUBLISHED notes as newline-delimited JSON. Each line is a self-contained JSON object. Requires Bearer API key with agent:read scope.',
        tags: ['Agent'],
        operationId: 'getAgentBundle',
        security: [{ bearerApiKey: [] }],
      },
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
      response: {
        200: AgentNotesResponse,
      },
      detail: {
        summary: 'List notes for agent consumption',
        description: 'Returns a simplified paginated list of published notes optimized for agent consumption. Requires Bearer API key with agent:read scope.',
        tags: ['Agent'],
        operationId: 'listAgentNotes',
        security: [{ bearerApiKey: [] }],
      },
    },
  );
