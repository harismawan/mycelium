import Elysia, { t } from 'elysia';
import { authMiddleware } from '../middleware/auth.js';
import { LinkService } from '../services/link.service.js';

/**
 * Graph route group — `/api/v1/graph`
 *
 * All routes require authentication (JWT or API key).
 *
 * @type {Elysia}
 */
export const graphRoutes = new Elysia({ prefix: '/api/v1/graph' })
  .use(authMiddleware)

  // GET / — full knowledge graph
  .get(
    '/',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      const graph = await LinkService.getGraph(ctx.user.id, {});
      return graph;
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
        depth: t.Optional(t.String()),
      }),
    },
  );
