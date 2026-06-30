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
import { SearchService } from './search.service.js';
import { DirectoryService } from './directory.service.js';
import { sanitizeMarkdown } from '../utils/sanitize.js';

/** Max number of semantic auto-link edges created per new note. */
const AUTO_LINK_TOP_K = 5;
/** Minimum `ts_rank` a candidate must reach to be auto-linked. */
const AUTO_LINK_MIN_RANK = 0.01;

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
   * @param {{ title: string, content: string, status?: string, tags?: string[], directoryId?: string | null, authType?: string, apiKeyId?: string, apiKeyName?: string, metadata?: { source?: string, confidence?: number, importance?: number } }} data
   * @returns {Promise<import('@prisma/client').Note>} The created note with tags.
   */
  async createNote(userId, data) {
    const { title, status, tags, directoryId, authType, apiKeyId, apiKeyName } = data;
    const meta = normalizeMetadata(data.metadata);
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

    if (directoryId) {
      const directory = await prisma.directory.findFirst({
        where: { id: directoryId, userId },
        select: { id: true },
      });
      if (!directory) {
        throw { statusCode: 404, message: 'Directory not found' };
      }
    }

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
          directoryId: directoryId ?? null,
          ...meta,
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
        include: { tags: true, revisions: true, directory: { select: { id: true, name: true, parentId: true } } },
      });

      // Reconcile links inside the transaction
      await LinkService.reconcileLinks(created.id, wikilinks, { tx, userId });

      // Resolve any unresolved links that match this note's title
      await resolveUnresolvedLinks(tx, created.id, title, userId);

      return created;
    });

    // Best-effort semantic auto-linking, outside the write transaction.
    await autoLinkSemantic(userId, note.id, title);

    return note;
  },

  /**
   * Recall-then-upsert a durable agent memory.
   *
   * Resolves an existing memory by EXACT title within the caller's own notes
   * that carry the `agent-memory` tag — matched on title, never slug (slugs are
   * globally unique and the collision check is not user-scoped). When a match
   * is found:
   *   - mode 'append' (default): append a timestamped section to the note
   *   - mode 'replace' (explicit only): overwrite the existing content
   * When no match is found, or mode is 'new', a fresh PUBLISHED memory note is
   * created in the user's `memories` directory. The `agent-memory` tag is always
   * applied and de-duplicated.
   *
   * @param {string} userId
   * @param {{ title: string, content: string, tags?: string[], mode?: 'append'|'replace'|'new', authType?: string, apiKeyId?: string, apiKeyName?: string }} data
   * @returns {Promise<{ id: string, slug: string, action: 'created'|'updated', excerpt: string }>}
   */
  async upsertMemory(userId, data) {
    const { title, content, tags = [], mode = 'append', metadata, authType, apiKeyId, apiKeyName } = data;
    const auth = { authType, apiKeyId, apiKeyName };
    const memoryTags = [...new Set([...tags, 'agent-memory'])];
    const memoriesDirectory = await DirectoryService.findOrCreateMemoriesDirectory(userId);

    // mode 'new' preserves the legacy always-create behavior.
    if (mode === 'new') {
      const created = await NoteService.createNote(userId, {
        title,
        content,
        status: 'PUBLISHED',
        tags: memoryTags,
        directoryId: memoriesDirectory.id,
        metadata,
        ...auth,
      });
      return { id: created.id, slug: created.slug, action: 'created', excerpt: created.excerpt };
    }

    // Recall: resolve an existing agent-memory by EXACT title, scoped to the
    // owning user. findFirst on title (NOT slug). orderBy keeps the freshest.
    const existing = await prisma.note.findFirst({
      where: {
        userId,
        title,
        status: { not: 'ARCHIVED' },
        tags: { some: { name: 'agent-memory' } },
      },
      orderBy: { updatedAt: 'desc' },
      include: { tags: true },
    });

    // Nothing to consolidate → create a new memory.
    if (!existing) {
      const created = await NoteService.createNote(userId, {
        title,
        content,
        status: 'PUBLISHED',
        tags: memoryTags,
        directoryId: memoriesDirectory.id,
        metadata,
        ...auth,
      });
      return { id: created.id, slug: created.slug, action: 'created', excerpt: created.excerpt };
    }

    // Consolidate into the existing memory.
    const nextContent =
      mode === 'replace'
        ? content
        : `${existing.content}\n\n## Update ${new Date().toISOString()}\n\n${content}`;
    const mergedTags = [...new Set([...existing.tags.map((t) => t.name), ...memoryTags])];

    const { note } = await NoteService.updateNote(userId, existing.slug, {
      content: nextContent,
      tags: mergedTags,
      metadata,
      ...auth,
    });
    return { id: note.id, slug: note.slug, action: 'updated', excerpt: note.excerpt };
  },

  /**
   * List notes with cursor-based pagination and optional filters.
   *
   * @param {string} userId - ID of the owning user.
   * @param {{ cursor?: string, limit?: number, status?: string, tag?: string, q?: string, directoryId?: string, unfiled?: boolean, pinned?: boolean }} opts
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

    if (opts.unfiled === true) {
      where.directoryId = null;
    } else if (opts.directoryId) {
      where.directoryId = opts.directoryId;
    }

    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { content: { contains: opts.q, mode: 'insensitive' } },
      ];
    }

    if (opts.pinned === true) {
      where.pinned = true;
    }

    const notes = await prisma.note.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
      include: { tags: true, directory: { select: { id: true, name: true, parentId: true } } },
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
      include: { tags: true, directory: { select: { id: true, name: true, parentId: true } } },
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
   * @param {{ title?: string, content?: string, status?: string, tags?: string[], directoryId?: string | null, message?: string, pinned?: boolean, authType?: string, apiKeyId?: string, apiKeyName?: string, metadata?: { source?: string, confidence?: number, importance?: number } }} data
   * @returns {Promise<{ note: import('@prisma/client').Note, before: { title: string, status: string, tags: string[], content: string } }>}
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
    const meta = normalizeMetadata(data.metadata);

    if (data.directoryId) {
      const directory = await prisma.directory.findFirst({
        where: { id: data.directoryId, userId },
        select: { id: true },
      });
      if (!directory) {
        throw { statusCode: 404, message: 'Directory not found' };
      }
    }

    const before = {
      title: existing.title,
      status: existing.status,
      tags: existing.tags.map((t) => t.name),
      content: existing.content,
    };

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
      ...(data.pinned !== undefined && { pinned: data.pinned }),
      ...(Object.hasOwn(data, 'directoryId') && { directoryId: data.directoryId }),
      ...meta,
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
        include: { tags: true, revisions: true, directory: { select: { id: true, name: true, parentId: true } } },
      });

      // Reconcile links
      await LinkService.reconcileLinks(updated.id, wikilinks, { tx, userId });

      // Resolve unresolved links matching the (possibly new) title
      await resolveUnresolvedLinks(tx, updated.id, title, userId);

      return updated;
    });

    return { note, before };
  },

  /**
   * Soft-delete a note by setting its status to ARCHIVED.
   *
   * @param {string} userId - ID of the owning user.
   * @param {string} slug - Note slug.
   * @returns {Promise<{ id: string, title: string }>}
   * @throws {{ statusCode: number, message: string }} 404 if not found.
   */
  async archiveNote(userId, slug) {
    const note = await prisma.note.findFirst({
      where: { slug, userId },
      select: { id: true, title: true },
    });
    if (!note) {
      throw { statusCode: 404, message: 'Note not found' };
    }

    await prisma.note.update({
      where: { id: note.id },
      data: { status: 'ARCHIVED' },
    });

    return note;
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
   * @returns {Promise<{ title: string }>}
   */
  async deleteNote(userId, slug) {
    const note = await prisma.note.findFirst({
      where: { slug, userId },
      select: { id: true, title: true },
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

    return { title: note.title };
  },
};

/**
 * Normalize and clamp agent-supplied memory metadata.
 *
 * Returns ONLY the keys that were supplied (and finite), so callers can spread
 * the result into a Prisma create/update without overwriting existing values
 * with nulls. `confidence` is clamped to [0, 1]; `importance` to an integer in
 * [1, 5]. `importance` is agent-supplied and gameable, hence the hard clamp.
 *
 * @param {{ source?: string|null, confidence?: number|null, importance?: number|null } | undefined} metadata
 * @returns {{ source?: string, confidence?: number, importance?: number }}
 */
function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  /** @type {{ source?: string, confidence?: number, importance?: number }} */
  const out = {};
  if (metadata.source !== undefined && metadata.source !== null) {
    out.source = String(metadata.source);
  }
  if (metadata.confidence !== undefined && metadata.confidence !== null) {
    const c = Number(metadata.confidence);
    if (Number.isFinite(c)) out.confidence = Math.min(1, Math.max(0, c));
  }
  if (metadata.importance !== undefined && metadata.importance !== null) {
    const i = Number(metadata.importance);
    if (Number.isFinite(i)) out.importance = Math.min(5, Math.max(1, Math.round(i)));
  }
  return out;
}

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

/**
 * Auto-link a freshly created note to its top semantic neighbours.
 *
 * Runs a full-text search for the note's title, keeps the top-K candidates
 * above {@link AUTO_LINK_MIN_RANK} (excluding the note itself), and creates
 * derived `related-to`/`semantic` edges. Best-effort: a search failure must
 * never fail note creation.
 *
 * @param {string} userId
 * @param {string} noteId
 * @param {string} title
 */
async function autoLinkSemantic(userId, noteId, title) {
  try {
    const { notes } = await SearchService.search(userId, title, {
      limit: AUTO_LINK_TOP_K + 1,
    });
    const targetIds = notes
      .filter((n) => n.id !== noteId && Number(n.rank) >= AUTO_LINK_MIN_RANK)
      .slice(0, AUTO_LINK_TOP_K)
      .map((n) => n.id);
    if (targetIds.length) {
      await LinkService.autoLink(noteId, targetIds, {
        relation: 'related-to',
        source: 'semantic',
      });
    }
  } catch {
    // Auto-linking is best-effort; swallow so note creation always succeeds.
  }
}
