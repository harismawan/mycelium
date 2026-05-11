import Elysia, { t } from 'elysia';
import { DEFAULT_PAGE_LIMIT } from '@mycelium/shared';
import { authMiddleware } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { prisma } from '../db.js';
import { ErrorResponse, TagListResponse, TagNotesResponse } from '../schemas/responses.js';

/**
 * Tag route group — `/api/v1/tags`
 *
 * All routes require authentication (JWT or API key).
 *
 * @type {Elysia}
 */
export const tagRoutes = new Elysia({ prefix: '/api/v1/tags' })
  .use(authMiddleware)
  .use(csrfMiddleware)

  // GET / — list all tags with note counts
  .get(
    '/',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      const tags = await prisma.tag.findMany({
        where: {
          notes: {
            some: {
              userId: ctx.user.id,
              status: { not: 'ARCHIVED' },
            },
          },
        },
        include: {
          _count: {
            select: {
              notes: {
                where: {
                  userId: ctx.user.id,
                  status: { not: 'ARCHIVED' },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      return {
        tags: tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          noteCount: tag._count.notes,
        })),
      };
    },
    {
      response: {
        200: TagListResponse,
      },
      detail: {
        summary: 'List all tags',
        description: 'Returns all tags with their note counts for the authenticated user. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Tags'],
        operationId: 'listTags',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // GET /:name/notes — paginated notes by tag
  .get(
    '/:name/notes',
    async (/** @type {{ params: { name: string }, query: { cursor?: string, limit?: string }, user: { id: string }, set: any }} */ ctx) => {
      const { name } = ctx.params;
      const limit = ctx.query.limit ? parseInt(ctx.query.limit, 10) : DEFAULT_PAGE_LIMIT;
      const cursor = ctx.query.cursor || undefined;

      // Verify the tag exists
      const tag = await prisma.tag.findUnique({ where: { name } });
      if (!tag) {
        ctx.set.status = 404;
        return { error: 'Tag not found' };
      }

      const notes = await prisma.note.findMany({
        where: {
          userId: ctx.user.id,
          status: { not: 'ARCHIVED' },
          tags: { some: { name } },
        },
        include: { tags: true },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      });

      const hasMore = notes.length > limit;
      if (hasMore) notes.pop();

      return {
        notes,
        nextCursor: hasMore ? notes[notes.length - 1].id : null,
      };
    },
    {
      params: t.Object({
        name: t.String({ minLength: 1 }),
      }),
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      response: {
        200: TagNotesResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'List notes by tag',
        description: 'Returns a paginated list of notes with the specified tag. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Tags'],
        operationId: 'listNotesByTag',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  );
