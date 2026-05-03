import { prisma } from '../db.js';

/**
 * Link service providing standalone wikilink reconciliation,
 * unresolved-link resolution, and backlink queries.
 *
 * The reconcileLinks and resolveUnresolvedLinks logic mirrors what
 * NoteService uses inline within transactions, but exposed here as
 * a public API for direct use by routes and other services.
 */
export const LinkService = {
  /**
   * Reconcile the Link table for a note after content changes.
   *
   * Diffs the current wikilinks in the content against existing Link records:
   * - Creates new Link records for newly added wikilinks
   * - Removes Link records for wikilinks no longer present
   *
   * For each new wikilink, looks up the target note by title. If found,
   * sets `toId`; otherwise stores the unresolved title in `toTitle`.
   *
   * @param {string} noteId - The source note ID.
   * @param {string[]} wikilinks - Deduplicated wikilink titles extracted from content.
   * @returns {Promise<void>}
   *
   * Validates: Requirements 2.1, 2.2, 2.3, 2.6, 2.7
   */
  async reconcileLinks(noteId, wikilinks) {
    // Fetch the source note to scope target lookups to the same user
    const sourceNote = await prisma.note.findUnique({
      where: { id: noteId },
      select: { userId: true },
    });
    if (!sourceNote) return;

    const { userId } = sourceNote;

    // Get existing outgoing links for this note
    const existingLinks = await prisma.link.findMany({
      where: { fromId: noteId },
      select: { id: true, toTitle: true, toId: true },
    });

    // Resolve existing links that have toId to get their titles
    const resolvedIds = existingLinks
      .filter((l) => l.toId)
      .map((l) => l.toId);
    const resolvedNotes = resolvedIds.length
      ? await prisma.note.findMany({
          where: { id: { in: resolvedIds } },
          select: { id: true, title: true },
        })
      : [];
    const idToTitle = new Map(resolvedNotes.map((n) => [n.id, n.title]));

    // Build full set of existing link target titles
    const existingTargetTitles = new Set();
    for (const link of existingLinks) {
      if (link.toTitle) {
        existingTargetTitles.add(link.toTitle);
      } else if (link.toId) {
        const t = idToTitle.get(link.toId);
        if (t) existingTargetTitles.add(t);
      }
    }

    // Determine new and removed wikilinks
    const currentSet = new Set(wikilinks);
    const toCreate = wikilinks.filter((t) => !existingTargetTitles.has(t));
    const toRemove = existingLinks.filter((link) => {
      const title = link.toTitle ?? idToTitle.get(link.toId);
      return title && !currentSet.has(title);
    });

    // Remove stale links
    if (toRemove.length) {
      await prisma.link.deleteMany({
        where: { id: { in: toRemove.map((l) => l.id) } },
      });
    }

    // Create new links
    for (const title of toCreate) {
      const target = await prisma.note.findFirst({
        where: { title, userId },
        select: { id: true },
      });

      await prisma.link.create({
        data: {
          fromId: noteId,
          toId: target?.id ?? null,
          toTitle: target ? null : title,
        },
      });
    }
  },

  /**
   * Resolve any existing unresolved links whose `toTitle` matches the given title.
   *
   * Called after creating or updating a note so that previously dangling links
   * now point to the correct note.
   *
   * @param {string} noteId - The newly created/updated note ID.
   * @param {string} title - The note's title to match against unresolved `toTitle` values.
   * @returns {Promise<void>}
   *
   * Validates: Requirements 2.4
   */
  async resolveUnresolvedLinks(noteId, title) {
    await prisma.link.updateMany({
      where: {
        toId: null,
        toTitle: title,
      },
      data: {
        toId: noteId,
        toTitle: null,
      },
    });
  },

  /**
   * Get all notes that link to the given note (backlinks).
   *
   * Returns the source notes of all Link records where `toId` matches
   * the provided noteId.
   *
   * @param {string} noteId - The target note ID.
   * @returns {Promise<import('@prisma/client').Note[]>} Notes linking to this note.
   *
   * Validates: Requirements 2.5
   */
  async getBacklinks(noteId) {
    const links = await prisma.link.findMany({
      where: { toId: noteId },
      select: { fromId: true },
    });

    if (!links.length) return [];

    const fromIds = [...new Set(links.map((l) => l.fromId))];

    const notes = await prisma.note.findMany({
      where: { id: { in: fromIds } },
      include: { tags: true },
    });

    return notes;
  },

  /**
   * @typedef {Object} GraphNode
   * @property {string} id
   * @property {string} slug
   * @property {string} title
   * @property {string} status
   */

  /**
   * @typedef {Object} GraphEdge
   * @property {string} fromId
   * @property {string} toId
   * @property {string|null} relation
   */

  /**
   * Return the knowledge graph for a user as nodes and edges.
   *
   * - Full graph (no slug): all non-ARCHIVED notes as nodes, all resolved
   *   links between them as edges.
   * - Ego-subgraph (slug provided): BFS from the given note up to `depth`
   *   levels, collecting reachable nodes and the edges between them.
   *
   * ARCHIVED notes are excluded by default.
   *
   * @param {string} userId - The owning user's ID.
   * @param {{ slug?: string, depth?: number }} [opts={}] - Options.
   * @returns {Promise<{ nodes: GraphNode[], edges: GraphEdge[] }>}
   *
   * Validates: Requirements 7.1, 7.2, 7.3
   */
  async getGraph(userId, opts = {}) {
    const { slug, depth = 1 } = opts;

    if (!slug) {
      return this._getFullGraph(userId);
    }

    return this._getEgoSubgraph(userId, slug, depth);
  },

  /**
   * Return the full graph of non-ARCHIVED notes for a user.
   *
   * @param {string} userId
   * @returns {Promise<{ nodes: GraphNode[], edges: GraphEdge[] }>}
   * @private
   */
  async _getFullGraph(userId) {
    const notes = await prisma.note.findMany({
      where: { userId, status: { not: 'ARCHIVED' } },
      select: { id: true, slug: true, title: true, status: true },
    });

    if (!notes.length) {
      return { nodes: [], edges: [] };
    }

    const noteIds = new Set(notes.map((n) => n.id));

    const links = await prisma.link.findMany({
      where: {
        fromId: { in: [...noteIds] },
        toId: { not: null },
      },
      select: { fromId: true, toId: true, relation: true },
    });

    // Only include edges where both endpoints are in the node set
    const edges = links
      .filter((l) => noteIds.has(l.toId))
      .map((l) => ({ fromId: l.fromId, toId: l.toId, relation: l.relation ?? null }));

    return { nodes: notes, edges };
  },

  /**
   * Return an ego-subgraph starting from a note, traversing links up to
   * `depth` levels via BFS (following both outgoing and incoming links).
   *
   * @param {string} userId
   * @param {string} slug
   * @param {number} depth
   * @returns {Promise<{ nodes: GraphNode[], edges: GraphEdge[] }>}
   * @private
   */
  async _getEgoSubgraph(userId, slug, depth) {
    const startNote = await prisma.note.findFirst({
      where: { slug, userId, status: { not: 'ARCHIVED' } },
      select: { id: true, slug: true, title: true, status: true },
    });

    if (!startNote) {
      return { nodes: [], edges: [] };
    }

    /** @type {Map<string, GraphNode>} */
    const visited = new Map();
    visited.set(startNote.id, startNote);

    /** @type {GraphEdge[]} */
    const edges = [];
    const edgeSet = new Set();

    let frontier = [startNote.id];

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      // Fetch outgoing and incoming links for the current frontier
      const [outLinks, inLinks] = await Promise.all([
        prisma.link.findMany({
          where: { fromId: { in: frontier }, toId: { not: null } },
          select: { fromId: true, toId: true, relation: true },
        }),
        prisma.link.findMany({
          where: { toId: { in: frontier }, fromId: { not: undefined } },
          select: { fromId: true, toId: true, relation: true },
        }),
      ]);

      const neighborIds = new Set();

      for (const link of [...outLinks, ...inLinks]) {
        const edgeKey = `${link.fromId}->${link.toId}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push({ fromId: link.fromId, toId: link.toId, relation: link.relation ?? null });
        }

        if (!visited.has(link.toId)) neighborIds.add(link.toId);
        if (!visited.has(link.fromId)) neighborIds.add(link.fromId);
      }

      if (!neighborIds.size) break;

      // Fetch neighbor notes, excluding ARCHIVED
      const neighborNotes = await prisma.note.findMany({
        where: {
          id: { in: [...neighborIds] },
          userId,
          status: { not: 'ARCHIVED' },
        },
        select: { id: true, slug: true, title: true, status: true },
      });

      frontier = [];
      for (const note of neighborNotes) {
        if (!visited.has(note.id)) {
          visited.set(note.id, note);
          frontier.push(note.id);
        }
      }
    }

    // Filter edges to only include those where both endpoints are in visited set
    const validEdges = edges.filter((e) => visited.has(e.fromId) && visited.has(e.toId));

    return { nodes: [...visited.values()], edges: validEdges };
  },
};
