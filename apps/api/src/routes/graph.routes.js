import Elysia, { t } from 'elysia';
import { authMiddleware } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { LinkService } from '../services/link.service.js';
import { GraphResponse } from '../schemas/responses.js';

/**
 * Graph route group — `/api/v1/graph`
 *
 * All routes require authentication (JWT or API key).
 *
 * @type {Elysia}
 */
export const graphRoutes = new Elysia({ prefix: '/api/v1/graph' })
  .use(authMiddleware)
  .use(csrfMiddleware)

  // GET / — full knowledge graph
  .get(
    '/',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      const graph = await LinkService.getGraph(ctx.user.id, {});
      return graph;
    },
    {
      response: {
        200: GraphResponse,
      },
      detail: {
        summary: 'Get the full knowledge graph',
        description: 'Returns all nodes and edges in the authenticated user\'s knowledge graph. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Graph'],
        operationId: 'getFullGraph',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // GET /:slug — ego-subgraph with optional depth param
  .get(
    '/:slug',
    async (/** @type {{ params: { slug: string }, query: { depth?: string }, user: { id: string } }} */ ctx) => {
      const depth = ctx.query.depth ? parseInt(ctx.query.depth, 10) : 1;
      const graph = await LinkService.getGraph(ctx.user.id, {
        slug: ctx.params.slug,
        depth,
      });
      return graph;
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      query: t.Object({
        depth: t.Optional(
          t.String({
            pattern: '^[1-9][0-9]*$',
            description: 'BFS depth as a positive integer; clamped to MAX_GRAPH_DEPTH server-side',
          }),
        ),
      }),
      response: {
        200: GraphResponse,
      },
      detail: {
        summary: 'Get a subgraph around a note',
        description: 'Returns the ego-subgraph centered on the specified note with configurable BFS depth. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Graph'],
        operationId: 'getSubgraph',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  );
