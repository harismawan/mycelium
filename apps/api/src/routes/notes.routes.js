import Elysia, { t } from 'elysia';
import { NoteStatus } from '@mycelium/shared';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { NoteService } from '../services/note.service.js';
import { LinkService } from '../services/link.service.js';
import { RevisionService } from '../services/revision.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';

/**
 * Note route group — `/api/v1/notes`
 *
 * All routes require authentication (JWT or API key).
 * Rate limiting is applied after auth for API-key-authenticated requests.
 *
 * @type {Elysia}
 */
export const noteRoutes = new Elysia({ prefix: '/api/v1/notes' })
  .use(authMiddleware)
  .use(rateLimiter())

  // POST / — create a new note
  .post(
    '/',
    async (/** @type {{ body: { title: string, content: string, status?: string, tags?: string[] }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      try {
        const note = await NoteService.createNote(ctx.user.id, {
          ...ctx.body,
          authType: ctx.authType,
          apiKeyId: ctx.apiKeyId,
          apiKeyName: ctx.apiKeyName,
        });
        ctx.set.status = 201;

        if (ctx.authType === 'apikey') {
          await ActivityLogService.logAction({
            userId: ctx.user.id,
            apiKeyId: ctx.apiKeyId,
            apiKeyName: ctx.apiKeyName,
            action: 'note:create',
            targetResourceId: note.id,
            targetResourceSlug: note.slug,
            details: { title: ctx.body.title },
            status: 'success',
          });
        }

        return note;
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        content: t.String(),
        status: t.Optional(
          t.Union([
            t.Literal(NoteStatus.DRAFT),
            t.Literal(NoteStatus.PUBLISHED),
            t.Literal(NoteStatus.ARCHIVED),
          ]),
        ),
        tags: t.Optional(t.Array(t.String({ minLength: 1 }))),
      }),
    },
  )

  // GET /count — note counts by status
  .get(
    '/count',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      return NoteService.countNotes(ctx.user.id);
    },
  )

  // GET / — list notes with optional filters and cursor pagination
  .get(
    '/',
    async (/** @type {{ query: { cursor?: string, limit?: string, status?: string, tag?: string, q?: string }, user: { id: string } }} */ ctx) => {
      const { cursor, limit, status, tag, q } = ctx.query;
      const result = await NoteService.listNotes(ctx.user.id, {
        cursor: cursor || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        status: status || undefined,
        tag: tag || undefined,
        q: q || undefined,
      });
      return result;
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal(NoteStatus.DRAFT),
            t.Literal(NoteStatus.PUBLISHED),
            t.Literal(NoteStatus.ARCHIVED),
          ]),
        ),
        tag: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
    },
  )

  // GET /:slug — get a single note; supports ?format=md for raw Markdown
  .get(
    '/:slug',
    async (/** @type {{ params: { slug: string }, query: { format?: string }, user: { id: string }, set: any }} */ ctx) => {
      try {
        if (ctx.query.format === 'md') {
          const markdown = await NoteService.getNoteMarkdown(ctx.user.id, ctx.params.slug);
          ctx.set.headers['content-type'] = 'text/markdown; charset=utf-8';
          return markdown;
        }

        const note = await NoteService.getNote(ctx.user.id, ctx.params.slug);
        if (!note) {
          ctx.set.status = 404;
          return { error: 'Note not found' };
        }
        return note;
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      query: t.Object({
        format: t.Optional(t.String()),
      }),
    },
  )

  // PATCH /:slug — partial update
  .patch(
    '/:slug',
    async (/** @type {{ params: { slug: string }, body: { title?: string, content?: string, status?: string, tags?: string[], message?: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      try {
        const note = await NoteService.updateNote(ctx.user.id, ctx.params.slug, {
          ...ctx.body,
          authType: ctx.authType,
          apiKeyId: ctx.apiKeyId,
          apiKeyName: ctx.apiKeyName,
        });

        if (ctx.authType === 'apikey') {
          await ActivityLogService.logAction({
            userId: ctx.user.id,
            apiKeyId: ctx.apiKeyId,
            apiKeyName: ctx.apiKeyName,
            action: 'note:update',
            targetResourceId: note.id,
            targetResourceSlug: ctx.params.slug,
            details: { fields: Object.keys(ctx.body) },
            status: 'success',
          });
        }

        return note;
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1 })),
        content: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal(NoteStatus.DRAFT),
            t.Literal(NoteStatus.PUBLISHED),
            t.Literal(NoteStatus.ARCHIVED),
          ]),
        ),
        tags: t.Optional(t.Array(t.String({ minLength: 1 }))),
        message: t.Optional(t.String()),
      }),
    },
  )

  // DELETE /:slug — archive (soft delete)
  .delete(
    '/:slug',
    async (/** @type {{ params: { slug: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      try {
        await NoteService.archiveNote(ctx.user.id, ctx.params.slug);

        if (ctx.authType === 'apikey') {
          await ActivityLogService.logAction({
            userId: ctx.user.id,
            apiKeyId: ctx.apiKeyId,
            apiKeyName: ctx.apiKeyName,
            action: 'note:archive',
            targetResourceId: null,
            targetResourceSlug: ctx.params.slug,
            details: {},
            status: 'success',
          });
        }

        return { message: 'Note archived' };
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
    },
  )

  // DELETE /:slug/permanent — hard delete
  .delete(
    '/:slug/permanent',
    async (/** @type {{ params: { slug: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      try {
        await NoteService.deleteNote(ctx.user.id, ctx.params.slug);

        if (ctx.authType === 'apikey') {
          await ActivityLogService.logAction({
            userId: ctx.user.id,
            apiKeyId: ctx.apiKeyId,
            apiKeyName: ctx.apiKeyName,
            action: 'note:delete',
            targetResourceId: null,
            targetResourceSlug: ctx.params.slug,
            details: {},
            status: 'success',
          });
        }

        return { message: 'Note deleted permanently' };
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
    },
  )

  // POST /:slug/revert — revert note to a specific revision
  .post(
    '/:slug/revert',
    async (/** @type {{ params: { slug: string }, body: { revisionId: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      try {
        const note = await NoteService.revertNote(
          ctx.user.id,
          ctx.params.slug,
          ctx.body.revisionId,
          {
            authType: ctx.authType,
            apiKeyId: ctx.apiKeyId,
            apiKeyName: ctx.apiKeyName,
          },
        );

        if (ctx.authType === 'apikey') {
          await ActivityLogService.logAction({
            userId: ctx.user.id,
            apiKeyId: ctx.apiKeyId,
            apiKeyName: ctx.apiKeyName,
            action: 'note:revert',
            targetResourceId: note.id,
            targetResourceSlug: ctx.params.slug,
            details: { revisionId: ctx.body.revisionId },
            status: 'success',
          });
        }

        return note;
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        revisionId: t.String({ minLength: 1 }),
      }),
    },
  )

  // GET /:slug/revisions — list revisions for a note
  .get(
    '/:slug/revisions',
    async (/** @type {{ params: { slug: string }, query: { cursor?: string, limit?: string }, user: { id: string }, set: any }} */ ctx) => {
      const note = await NoteService.getNote(ctx.user.id, ctx.params.slug);
      if (!note) {
        ctx.set.status = 404;
        return { error: 'Note not found' };
      }

      const result = await RevisionService.listRevisions(note.id, {
        cursor: ctx.query.cursor || undefined,
        limit: ctx.query.limit ? parseInt(ctx.query.limit, 10) : undefined,
      });
      return result;
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  // GET /:slug/revisions/:revisionId — get a single revision
  .get(
    '/:slug/revisions/:revisionId',
    async (/** @type {{ params: { slug: string, revisionId: string }, user: { id: string }, set: any }} */ ctx) => {
      // Verify the note exists and belongs to the user
      const note = await NoteService.getNote(ctx.user.id, ctx.params.slug);
      if (!note) {
        ctx.set.status = 404;
        return { error: 'Note not found' };
      }

      const revision = await RevisionService.getRevision(ctx.params.revisionId);
      if (!revision || revision.noteId !== note.id) {
        ctx.set.status = 404;
        return { error: 'Revision not found' };
      }

      return revision;
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
        revisionId: t.String({ minLength: 1 }),
      }),
    },
  )

  // GET /:slug/backlinks — get notes linking to this note
  .get(
    '/:slug/backlinks',
    async (/** @type {{ params: { slug: string }, user: { id: string }, set: any }} */ ctx) => {
      const note = await NoteService.getNote(ctx.user.id, ctx.params.slug);
      if (!note) {
        ctx.set.status = 404;
        return { error: 'Note not found' };
      }

      const backlinks = await LinkService.getBacklinks(note.id);
      return { backlinks };
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
    },
  );
