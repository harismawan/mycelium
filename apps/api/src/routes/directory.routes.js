import Elysia, { t } from 'elysia';
import { authMiddleware } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { DirectoryService } from '../services/directory.service.js';
import { DirectoryResponse, DirectoryTreeResponse, ErrorResponse, MessageResponse } from '../schemas/responses.js';

export const directoryRoutes = new Elysia({ prefix: '/api/v1/directories' })
  .use(authMiddleware)
  .use(csrfMiddleware)

  .get(
    '/',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      return DirectoryService.listTree(ctx.user.id);
    },
    {
      response: {
        200: DirectoryTreeResponse,
      },
      detail: {
        summary: 'List directories',
        description: 'Returns the authenticated user’s nested directory tree with direct note counts.',
        tags: ['Directories'],
        operationId: 'listDirectories',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  .post(
    '/',
    async (/** @type {{ body: { name: string, parentId?: string | null }, user: { id: string }, set: any }} */ ctx) => {
      const directory = await DirectoryService.createDirectory(ctx.user.id, ctx.body);
      ctx.set.status = 201;
      return directory;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        parentId: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
      }),
      response: {
        201: DirectoryResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Create directory',
        description: 'Creates a directory for the authenticated user, optionally nested under another directory.',
        tags: ['Directories'],
        operationId: 'createDirectory',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  .patch(
    '/:id',
    async (/** @type {{ params: { id: string }, body: { name?: string, parentId?: string | null }, user: { id: string } }} */ ctx) => {
      return DirectoryService.updateDirectory(ctx.user.id, ctx.params.id, ctx.body);
    },
    {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        parentId: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
      }),
      response: {
        200: DirectoryResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Update directory',
        description: 'Renames or moves a directory. Moving a directory into itself or a descendant is rejected.',
        tags: ['Directories'],
        operationId: 'updateDirectory',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  .delete(
    '/:id',
    async (/** @type {{ params: { id: string }, user: { id: string } }} */ ctx) => {
      return DirectoryService.deleteDirectory(ctx.user.id, ctx.params.id);
    },
    {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: {
        200: MessageResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
      },
      detail: {
        summary: 'Delete directory',
        description: 'Deletes an empty directory. Directories with child directories or notes cannot be deleted.',
        tags: ['Directories'],
        operationId: 'deleteDirectory',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  );
