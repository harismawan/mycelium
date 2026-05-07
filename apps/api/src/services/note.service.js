import {
  parseFrontmatter,
  serializeFrontmatter,
  extractWikilinks,
  generateExcerpt,
  slugify,
  DEFAULT_PAGE_LIMIT,
} from '@mycelium/shared';
import { prisma } from '../db.js';
import { LinkService } from './link.service.js';
import { sanitizeMarkdown } from '../utils/sanitize.js';

/**
 * Note service handling CRUD operations, the Markdown save pipeline,
 * wikilink reconciliation, and revision management.
 */
export const NoteService = {
  /**
   * Create a new note, running the full save pipeline inside a transaction.
   *
   * Pipeline: parse frontmatter → generate slug → extract wikilinks →
   * generate excerpt → create Note + Revision → reconcile links →
   * resolve unresolved links.
   *
   * @param {string} userId - ID of the owning user.
   * @param {{ title: string, content: string, status?: string, tags?: string[], authType?: string, apiKeyId?: string, apiKeyName?: string }} data
   * @returns {Promise<import('@prisma/client').Note>} The created note with tags.
   */
  async createNote(userId, data) {
    const { title, status, tags, authType, apiKeyId, apiKeyName } = data;
    const content = sanitizeMarkdown(data.content);
    const { frontmatter } = parseFrontmatter(content);
    const excerpt = generateExcerpt(content);
    const wikilinks = extractWikilinks(content);

    // Generate a unique slug
    const baseSlug = slugify(title);
    const existing = await prisma.note.findMany({
      where: { slug: { startsWith: baseSlug } },
      select: { slug: true },
    });
    const existingSlugs = new Set(existing.map((n) => n.slug));
    let slug = baseSlug;
    if (existingSlugs.has(slug)) {
      let counter = 1;
      while (existingSlugs.has(`${slug}-${counter}`)) counter++;
      slug = `${slug}-${counter}`;
    }

    // Build tag connect-or-create operations
    const tagOps = (tags ?? []).map((name) => ({
      where: { name },
      create: { name },
    }));

    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          title,
          content,
          slug,
          excerpt,
          frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : undefined,
          status: status ?? 'DRAFT',
          userId,
          tags: tagOps.length ? { connectOrCreate: tagOps } : undefined,
          revisions: {
            create: {
              content,
              ...(authType ? { authType } : {}),
              ...(apiKeyId ? { apiKeyId } : {}),
              ...(apiKeyName ? { apiKeyName } : {}),
            },
          },
        },
        include: { tags: true, revisions: true },
      });

      // Reconcile links inside the transaction
      await LinkService.reconcileLinks(created.id, wikilinks, { tx, userId });

      // Resolve any unresolved links that match this note's title
      await resolveUnresolvedLinks(tx, created.id, title, userId);

      return created;
    });

    return note;
  },

  /**
   * List notes with cursor-based pagination and optional filters.
   *
   * @param {string} userId - ID of the owning user.
   * @param {{ cursor?: string, limit?: number, status?: string, tag?: string, q?: string }} opts
   * @returns {Promise<{ notes: import('@prisma/client').Note[], nextCursor: string | null }>}
   */
  async listNotes(userId, opts = {}) {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;

    /** @type {Record<string, unknown>} */
    const where = { userId };

    if (opts.status) {
      where.status = opts.status;
    } else {
      // Exclude archived by default
      where.status = { not: 'ARCHIVED' };
    }

    if (opts.tag) {
      where.tags = { some: { name: opts.tag } };
    }

    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { content: { contains: opts.q, mode: 'insensitive' } },
      ];
    }

    const notes = await prisma.note.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { tags: true },
    });

    const hasMore = notes.length > limit;
    if (hasMore) notes.pop();

    return {
      notes,
      nextCursor: hasMore ? notes[notes.length - 1].id : null,
    };
  },

  /**
   * Get note counts grouped by status.
   *
   * @param {string} userId
   * @returns {Promise<{ total: number, draft: number, published: number, archived: number }>}
   */
  async countNotes(userId) {
    const [total, draft, published, archived] = await Promise.all([
      prisma.note.count({ where: { userId, status: { not: 'ARCHIVED' } } }),
      prisma.note.count({ where: { userId, status: 'DRAFT' } }),
      prisma.note.count({ where: { userId, status: 'PUBLISHED' } }),
      prisma.note.count({ where: { userId, status: 'ARCHIVED' } }),
    ]);
    return { total, draft, published, archived };
  },

  /**
   * Get a single note by slug (JSON format).
   *
   * @param {string} userId - ID of the owning user.
   * @param {string} slug - Note slug.
   * @returns {Promise<import('@prisma/client').Note | null>}
   */
  async getNote(userId, slug) {
    return prisma.note.findFirst({
      where: { slug, userId },
      include: { tags: true },
    });
  },

  /**
   * Get a note's raw Markdown content (with frontmatter).
   *
   * @param {string} userId - ID of the owning user.
   * @param {string} slug - Note slug.
   * @returns {Promise<string>} Raw Markdown content.
   * @throws {{ statusCode: number, message: string }} 404 if not found.
   */
  async getNoteMarkdown(userId, slug) {
    const note = await prisma.note.findFirst({
      where: { slug, userId },
      select: { content: true },
    });
    if (!note) {
      throw { statusCode: 404, message: 'Note not found' };
    }
    return note.content;
  },

  /**
   * Update a note, re-running the full save pipeline in a transaction.
   *
   * @param {string} userId - ID of the owning user.
   * @param {string} slug - Current note slug.
   * @param {{ title?: string, content?: string, status?: string, tags?: string[], message?: string, authType?: string, apiKeyId?: string, apiKeyName?: string }} data
   * @returns {Promise<import('@prisma/client').Note>} The updated note.
   * @throws {{ statusCode: number, message: string }} 404 if not found.
   */
  async updateNote(userId, slug, data) {
    const existing = await prisma.note.findFirst({
      where: { slug, userId },
      include: { tags: true },
    });
    if (!existing) {
      throw { statusCode: 404, message: 'Note not found' };
    }

    const title = data.title ?? existing.title;
    const content = data.content !== undefined ? sanitizeMarkdown(data.content) : existing.content;
    const status = data.status ?? existing.status;
    const tags = data.tags;
    const message = data.message;
    const { authType, apiKeyId, apiKeyName } = data;

    const excerpt = generateExcerpt(content);
    const wikilinks = extractWikilinks(content);
    const { frontmatter } = parseFrontmatter(content);

    // Re-generate slug if title changed
    let newSlug = existing.slug;
    if (data.title && data.title !== existing.title) {
      const baseSlug = slugify(data.title);
      const others = await prisma.note.findMany({
        where: { slug: { startsWith: baseSlug }, id: { not: existing.id } },
        select: { slug: true },
      });
      const existingSlugs = new Set(others.map((n) => n.slug));
      newSlug = baseSlug;
      if (existingSlugs.has(newSlug)) {
        let counter = 1;
        while (existingSlugs.has(`${newSlug}-${counter}`)) counter++;
        newSlug = `${newSlug}-${counter}`;
      }
    }

    // Build update data
    /** @type {Record<string, unknown>} */
    const updateData = {
      title,
      content,
      slug: newSlug,
      excerpt,
      frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : undefined,
      status,
    };

    // Handle tags: disconnect all existing, then connect-or-create new ones
    if (tags !== undefined) {
      updateData.tags = {
        set: [], // disconnect all
        connectOrCreate: tags.map((name) => ({
          where: { name },
          create: { name },
        })),
      };
    }

    const note = await prisma.$transaction(async (tx) => {
      // Only create a revision if content actually changed
      const contentChanged = content !== existing.content;

      const updated = await tx.note.update({
        where: { id: existing.id },
        data: {
          ...updateData,
          ...(contentChanged ? {
            revisions: {
              create: {
                content,
                message,
                ...(authType ? { authType } : {}),
                ...(apiKeyId ? { apiKeyId } : {}),
                ...(apiKeyName ? { apiKeyName } : {}),
              },
            },
          } : {}),
        },
        include: { tags: true, revisions: true },
      });

      // Reconcile links
      await LinkService.reconcileLinks(updated.id, wikilinks, { tx, userId });

      // Resolve unresolved links matching the (possibly new) title
      await resolveUnresolvedLinks(tx, updated.id, title, userId);

      return updated;
    });

    return note;
  },

  /**
   * Soft-delete a note by setting its status to ARCHIVED.
   *
   * @param {string} userId - ID of the owning user.
   * @param {string} slug - Note slug.
   * @returns {Promise<void>}
   * @throws {{ statusCode: number, message: string }} 404 if not found.
   */
  async archiveNote(userId, slug) {
    const note = await prisma.note.findFirst({
      where: { slug, userId },
      select: { id: true },
    });
    if (!note) {
      throw { statusCode: 404, message: 'Note not found' };
    }

    await prisma.note.update({
      where: { id: note.id },
      data: { status: 'ARCHIVED' },
    });
  },

  /**
   * Revert a note to a specific revision's content.
   *
   * @param {string} userId
   * @param {string} slug
   * @param {string} revisionId
   * @param {{ authType?: string, apiKeyId?: string, apiKeyName?: string }} [authContext={}]
   * @returns {Promise<import('@prisma/client').Note>}
   * @throws {{ statusCode: number, message: string }} 404 if note or revision not found.
   */
  async revertNote(userId, slug, revisionId, authContext = {}) {
    const note = await prisma.note.findFirst({
      where: { slug, userId },
      select: { id: true },
    });
    if (!note) {
      throw { statusCode: 404, message: 'Note not found' };
    }

    const revision = await prisma.revision.findFirst({
      where: { id: revisionId, noteId: note.id },
    });
    if (!revision) {
      throw { statusCode: 404, message: 'Revision not found' };
    }

    const { authType, apiKeyId, apiKeyName } = authContext;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.note.update({
        where: { id: note.id },
        data: {
          content: revision.content,
          excerpt: generateExcerpt(revision.content),
          revisions: {
            create: {
              content: revision.content,
              message: `Reverted to revision ${revisionId}`,
              ...(authType ? { authType } : {}),
              ...(apiKeyId ? { apiKeyId } : {}),
              ...(apiKeyName ? { apiKeyName } : {}),
            },
          },
        },
        include: { tags: true, revisions: true },
      });

      return result;
    });

    return updated;
  },

  /**
   * Permanently delete a note and all its links/revisions.
   *
   * @param {string} userId
   * @param {string} slug
   */
  async deleteNote(userId, slug) {
    const note = await prisma.note.findFirst({
      where: { slug, userId },
      select: { id: true },
    });
    if (!note) {
      throw { statusCode: 404, message: 'Note not found' };
    }

    // Delete links, revisions, and the note inside a single transaction to
    // prevent orphaned records if the process crashes mid-delete.
    await prisma.$transaction([
      prisma.link.deleteMany({ where: { fromId: note.id } }),
      prisma.link.deleteMany({ where: { toId: note.id } }),
      prisma.revision.deleteMany({ where: { noteId: note.id } }),
      prisma.note.delete({ where: { id: note.id } }),
    ]);
  },
};

/**
 * Resolve any existing unresolved links whose `toTitle` matches the given title.
 *
 * Called after creating or updating a note so that previously dangling links
 * now point to the correct note.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx - Prisma transaction client.
 * @param {string} noteId - The newly created/updated note ID.
 * @param {string} title - The note's title to match against unresolved `toTitle` values.
 */
async function resolveUnresolvedLinks(tx, noteId, title, userId) {
  const userNotes = await tx.note.findMany({
    where: { userId },
    select: { id: true },
  });
  const noteIds = userNotes.map((n) => n.id);

  await tx.link.updateMany({
    where: {
      toId: null,
      toTitle: title,
      fromId: { in: noteIds },
    },
    data: {
      toId: noteId,
      toTitle: null,
    },
  });
}
