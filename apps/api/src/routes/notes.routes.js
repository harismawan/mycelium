import Elysia, { t } from 'elysia';
import { NoteStatus } from '@mycelium/shared';
import { authMiddleware } from '../middleware/auth.js';
import { csrfMiddleware } from '../middleware/csrf.js';
import { rateLimiter } from '../middleware/rate-limiter.js';
import { NoteService } from '../services/note.service.js';
import { LinkService } from '../services/link.service.js';
import { RevisionService } from '../services/revision.service.js';
import { SearchService } from '../services/search.service.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import {
  ErrorResponse,
  MessageResponse,
  NoteResponse,
  PaginatedNotesResponse,
  NoteCountResponse,
  SearchResponse,
  RevisionResponse,
  RevisionListResponse,
  BacklinksResponse,
} from '../schemas/responses.js';

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
  .use(csrfMiddleware)
  .use(rateLimiter())

  // POST / — create a new note
  .post(
    '/',
    async (/** @type {{ body: { title: string, content: string, status?: string, tags?: string[] }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
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
          details: { noteTitle: ctx.body.title },
          status: 'success',
        });
      }

      return note;
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
      response: {
        201: NoteResponse,
        400: ErrorResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'Create a new note',
        description: 'Creates a new note with the given title, content, status, and tags. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'createNote',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // GET /count — note counts by status
  .get(
    '/count',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      return NoteService.countNotes(ctx.user.id);
    },
    {
      response: {
        200: NoteCountResponse,
      },
      detail: {
        summary: 'Get note counts by status',
        description: 'Returns the number of draft, published, and archived notes for the authenticated user. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'countNotes',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // GET / — list notes with optional filters and cursor pagination
  .get(
    '/',
    async (/** @type {{ query: { cursor?: string, limit?: string, status?: string, tag?: string, q?: string, pinned?: string }, user: { id: string } }} */ ctx) => {
      const { cursor, limit, status, tag, q, pinned } = ctx.query;
      const result = await NoteService.listNotes(ctx.user.id, {
        cursor: cursor || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        status: status || undefined,
        tag: tag || undefined,
        q: q || undefined,
        pinned: pinned === 'true' ? true : undefined,
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
        pinned: t.Optional(t.String()),
      }),
      response: {
        200: PaginatedNotesResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'List notes with filters and pagination',
        description: 'Returns a paginated list of notes for the authenticated user. Supports filtering by status, tag, and full-text search. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'listNotes',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // GET /search — full-text search using PostgreSQL tsvector
  .get(
    '/search',
    async (/** @type {{ query: { q: string, cursor?: string, limit?: string, status?: string, tag?: string }, user: { id: string } }} */ ctx) => {
      const { q, cursor, limit, status, tag } = ctx.query;
      return SearchService.search(ctx.user.id, q, {
        cursor: cursor || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        status: status || undefined,
        tag: tag || undefined,
      });
    },
    {
      query: t.Object({
        q: t.String({ minLength: 1, description: 'Search query' }),
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
      }),
      response: {
        200: SearchResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'Full-text search notes',
        description: 'Searches notes using PostgreSQL tsvector full-text search with ts_rank relevance scoring. Results are sorted by rank descending. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'searchNotes',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // GET /:slug — get a single note; supports ?format=md for raw Markdown
  .get(
    '/:slug',
    async (/** @type {{ params: { slug: string }, query: { format?: string }, user: { id: string }, set: any }} */ ctx) => {
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
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      query: t.Object({
        format: t.Optional(t.String()),
      }),
      response: {
        200: NoteResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get a note by slug',
        description: 'Retrieves a single note by its slug. Supports ?format=md for raw Markdown output. Returns 404 if the note does not exist. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'getNote',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // PATCH /:slug — partial update
  .patch(
    '/:slug',
    async (/** @type {{ params: { slug: string }, body: { title?: string, content?: string, status?: string, tags?: string[], message?: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      const { note, before } = await NoteService.updateNote(ctx.user.id, ctx.params.slug, {
        ...ctx.body,
        authType: ctx.authType,
        apiKeyId: ctx.apiKeyId,
        apiKeyName: ctx.apiKeyName,
      });

      if (ctx.authType === 'apikey') {
        const changes = {};
        if (ctx.body.title !== undefined && ctx.body.title !== before.title) {
          changes.title = { from: before.title, to: note.title };
        }
        if (ctx.body.status !== undefined && ctx.body.status !== before.status) {
          changes.status = { from: before.status, to: note.status };
        }
        if (ctx.body.tags !== undefined) {
          const fromTags = [...before.tags].sort();
          const toTags = note.tags.map((t) => t.name).sort();
          if (JSON.stringify(fromTags) !== JSON.stringify(toTags)) {
            changes.tags = { from: fromTags, to: toTags };
          }
        }
        if (ctx.body.content !== undefined) {
          changes.content = { charsBefore: before.content.length, charsAfter: note.content.length };
        }

        await ActivityLogService.logAction({
          userId: ctx.user.id,
          apiKeyId: ctx.apiKeyId,
          apiKeyName: ctx.apiKeyName,
          action: 'note:update',
          targetResourceId: note.id,
          targetResourceSlug: ctx.params.slug,
          details: { noteTitle: note.title, changes },
          status: 'success',
        });
      }

      return note;
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
        pinned: t.Optional(t.Boolean()),
      }),
      response: {
        200: NoteResponse,
        400: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update a note',
        description: 'Partially updates a note by slug. Supports updating title, content, status, tags, pinned, and revision message. Creates a revision on content changes. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'updateNote',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // DELETE /:slug — archive (soft delete)
  .delete(
    '/:slug',
    async (/** @type {{ params: { slug: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      const archivedNote = await NoteService.archiveNote(ctx.user.id, ctx.params.slug);

      if (ctx.authType === 'apikey') {
        await ActivityLogService.logAction({
          userId: ctx.user.id,
          apiKeyId: ctx.apiKeyId,
          apiKeyName: ctx.apiKeyName,
          action: 'note:archive',
          targetResourceId: archivedNote.id,
          targetResourceSlug: ctx.params.slug,
          details: { noteTitle: archivedNote.title },
          status: 'success',
        });
      }

      return { message: 'Note archived' };
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      response: {
        200: MessageResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Archive a note',
        description: 'Soft-deletes a note by setting its status to ARCHIVED. The note can be restored later. Returns 404 if the note does not exist. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'archiveNote',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // DELETE /:slug/permanent — hard delete
  .delete(
    '/:slug/permanent',
    async (/** @type {{ params: { slug: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
      const deletedNote = await NoteService.deleteNote(ctx.user.id, ctx.params.slug);

      if (ctx.authType === 'apikey') {
        await ActivityLogService.logAction({
          userId: ctx.user.id,
          apiKeyId: ctx.apiKeyId,
          apiKeyName: ctx.apiKeyName,
          action: 'note:delete',
          targetResourceId: null,
          targetResourceSlug: ctx.params.slug,
          details: { noteTitle: deletedNote.title },
          status: 'success',
        });
      }

      return { message: 'Note deleted permanently' };
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      response: {
        200: MessageResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Permanently delete a note',
        description: 'Permanently deletes a note and all its revisions. This action cannot be undone. Returns 404 if the note does not exist. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'deleteNotePermanently',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  )

  // POST /:slug/revert — revert note to a specific revision
  .post(
    '/:slug/revert',
    async (/** @type {{ params: { slug: string }, body: { revisionId: string }, user: { id: string }, authType: string, apiKeyId: string|null, apiKeyName: string|null, set: any }} */ ctx) => {
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
          details: { noteTitle: note.title, revisionId: ctx.body.revisionId },
          status: 'success',
        });
      }

      return note;
    },
    {
      params: t.Object({
        slug: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        revisionId: t.String({ minLength: 1 }),
      }),
      response: {
        200: NoteResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Revert a note to a previous revision',
        description: 'Reverts a note to the content of a specified revision. Creates a new revision recording the revert. Returns 404 if the note or revision does not exist. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'revertNote',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
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
      response: {
        200: RevisionListResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'List revisions for a note',
        description: 'Returns a paginated list of revisions for a note identified by slug. Returns 404 if the note does not exist. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'listNoteRevisions',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
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
      response: {
        200: RevisionResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get a specific note revision',
        description: 'Retrieves a single revision by ID for a note identified by slug. Returns 404 if the note or revision does not exist. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'getNoteRevision',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
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
      response: {
        200: BacklinksResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get backlinks for a note',
        description: 'Returns all notes that contain wikilinks pointing to the specified note. Returns 404 if the target note does not exist. Requires JWT cookie or Bearer API key authentication.',
        tags: ['Notes'],
        operationId: 'getNoteBacklinks',
        security: [{ cookieAuth: [] }, { bearerApiKey: [] }],
      },
    },
  );
