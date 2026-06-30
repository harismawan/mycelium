import { prisma } from '../db.js';
import { GRAPH_DECAY, MAX_GRAPH_NODES, MAX_GRAPH_DEPTH, MAX_LINK_RESULTS } from '@mycelium/shared';

/**
 * Record that `candidateId` is directly linked to `seedId` in a
 * candidate -> set-of-seeds map (used for co-citation degree counting).
 *
 * @param {Map<string, Set<string>>} map
 * @param {string} candidateId
 * @param {string} seedId
 */
function addSeedLink(map, candidateId, seedId) {
  let set = map.get(candidateId);
  if (!set) {
    set = new Set();
    map.set(candidateId, set);
  }
  set.add(seedId);
}

/**
 * Coerce and clamp a requested BFS depth into the safe range [1, MAX_GRAPH_DEPTH].
 *
 * Non-numeric, non-finite, or absent values fall back to the default depth of 1.
 * Values above MAX_GRAPH_DEPTH are clamped down; values below 1 are clamped up.
 *
 * @param {unknown} depth - Raw depth from a caller (route query, MCP arg, etc.).
 * @returns {number} A safe integer depth in [1, MAX_GRAPH_DEPTH].
 */
function clampDepth(depth) {
  const n = Number(depth);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_GRAPH_DEPTH);
}

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
   * Reconcile wikilink-sourced edges for a note after content changes.
   *
   * Keys the diff on `relation::title`:
   * - CREATE edges for typed wikilinks with no existing match
   * - UPDATE `weight` when an existing edge's occurrence count drifts
   * - DELETE wikilink edges no longer present in content
   *
   * Find/delete are scoped to `source='wikilink'` so derived edges (e.g.
   * `source='semantic'` from auto-link) are never clobbered. `weight` is the
   * occurrence count of each `relation::title` pair.
   *
   * @param {string} noteId - The source note ID.
   * @param {Array<{ title: string, relation: string|null, count: number }>} wikilinks
   *   Typed wikilinks extracted from content (see `extractWikilinks`).
   * @param {{ tx?: import('@prisma/client').Prisma.TransactionClient, userId?: string }} [opts]
   * @returns {Promise<void>}
   *
   * Validates: Requirements 2.1, 2.2, 2.3, 2.6, 2.7
   */
  async reconcileLinks(noteId, wikilinks, opts = {}) {
    const db = opts.tx ?? prisma;
    let { userId } = opts;

    if (!userId) {
      const sourceNote = await db.note.findUnique({
        where: { id: noteId },
        select: { userId: true },
      });
      if (!sourceNote) return;
      userId = sourceNote.userId;
    }

    // Only wikilink-sourced edges participate in reconciliation.
    const existingLinks = await db.link.findMany({
      where: { fromId: noteId, source: 'wikilink' },
      select: { id: true, toTitle: true, toId: true, relation: true, weight: true },
    });

    // Resolve titles for edges that already point at a real note.
    const resolvedIds = existingLinks.filter((l) => l.toId).map((l) => l.toId);
    const resolvedNotes = resolvedIds.length
      ? await db.note.findMany({
          where: { id: { in: resolvedIds } },
          select: { id: true, title: true },
        })
      : [];
    const idToTitle = new Map(resolvedNotes.map((n) => [n.id, n.title]));

    const keyOf = (relation, title) => `${relation ?? ''}::${title}`;

    /** @type {Map<string, { id: string, weight: number }>} */
    const existingByKey = new Map();
    for (const link of existingLinks) {
      const title = link.toTitle ?? idToTitle.get(link.toId);
      if (!title) continue;
      existingByKey.set(keyOf(link.relation, title), { id: link.id, weight: link.weight });
    }

    /** @type {Map<string, { title: string, relation: string|null, count: number }>} */
    const incomingByKey = new Map();
    for (const wl of wikilinks) {
      incomingByKey.set(keyOf(wl.relation, wl.title), wl);
    }

    // UPDATE pass: existing edges whose weight drifted from the new count.
    for (const [key, wl] of incomingByKey) {
      const existing = existingByKey.get(key);
      if (existing && existing.weight !== wl.count) {
        await db.link.update({
          where: { id: existing.id },
          data: { weight: wl.count },
        });
      }
    }

    // DELETE pass: wikilink edges absent from the new content.
    const toRemove = existingLinks.filter((link) => {
      const title = link.toTitle ?? idToTitle.get(link.toId);
      return title && !incomingByKey.has(keyOf(link.relation, title));
    });
    if (toRemove.length) {
      await db.link.deleteMany({
        where: { id: { in: toRemove.map((l) => l.id) } },
      });
    }

    // CREATE pass: incoming edges with no existing match.
    const toCreate = [...incomingByKey.entries()]
      .filter(([key]) => !existingByKey.has(key))
      .map(([, wl]) => wl);

    if (toCreate.length) {
      const titles = [...new Set(toCreate.map((wl) => wl.title))];
      const targets = await db.note.findMany({
        where: { title: { in: titles }, userId },
        select: { id: true, title: true },
      });
      const titleToId = new Map(targets.map((n) => [n.title, n.id]));

      await db.link.createMany({
        data: toCreate.map((wl) => ({
          fromId: noteId,
          toId: titleToId.get(wl.title) ?? null,
          toTitle: titleToId.has(wl.title) ? null : wl.title,
          relation: wl.relation,
          weight: wl.count,
          source: 'wikilink',
        })),
      });
    }
  },

  /**
   * Create derived (non-wikilink) edges from a note to a set of target notes,
   * skipping targets already linked from this note and self-references.
   *
   * @param {string} noteId - The source note ID.
   * @param {string[]} targetIds - Candidate target note IDs.
   * @param {{ relation?: string, source?: string }} [opts]
   * @returns {Promise<void>}
   */
  async autoLink(noteId, targetIds, opts = {}) {
    const { relation = 'related-to', source = 'semantic' } = opts;
    if (!Array.isArray(targetIds) || targetIds.length === 0) return;

    const uniqueTargets = [...new Set(targetIds)].filter((id) => id && id !== noteId);
    if (!uniqueTargets.length) return;

    // Skip any target we already link to (regardless of source) to avoid dupes.
    const existing = await prisma.link.findMany({
      where: { fromId: noteId, toId: { in: uniqueTargets } },
      select: { toId: true },
    });
    const existingIds = new Set(existing.map((l) => l.toId));
    const toCreate = uniqueTargets.filter((id) => !existingIds.has(id));
    if (!toCreate.length) return;

    await prisma.link.createMany({
      data: toCreate.map((toId) => ({
        fromId: noteId,
        toId,
        toTitle: null,
        relation,
        weight: 1,
        source,
      })),
      skipDuplicates: true,
    });
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
   * @returns {Promise<Array<import('@prisma/client').Note & { relation: string|null, weight: number }>>} Source notes linking to this note, each decorated with the linking edge's relation and weight.
   *
   * Validates: Requirements 2.5
   */
  async getBacklinks(noteId) {
    const links = await prisma.link.findMany({
      where: { toId: noteId },
      select: { fromId: true, relation: true, weight: true },
    });

    if (!links.length) return [];

    const fromIds = [...new Set(links.map((l) => l.fromId))];

    const notes = await prisma.note.findMany({
      where: { id: { in: fromIds } },
      include: { tags: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_LINK_RESULTS,
    });

    // Attach the linking edge's relation/weight to each source note.
    const edgeByFrom = new Map(links.map((l) => [l.fromId, l]));
    return notes.map((note) => {
      const edge = edgeByFrom.get(note.id);
      return { ...note, relation: edge?.relation ?? null, weight: edge?.weight ?? 1 };
    });
  },

  /**
   * Get all outgoing wikilinks from a note, split into resolved and unresolved.
   *
   * @param {string} noteId - The source note ID.
   * @returns {Promise<{ resolved: Array<{ id: string, slug: string, title: string }>, unresolved: Array<{ title: string }> }>}
   */
  async getOutgoingLinks(noteId) {
    const links = await prisma.link.findMany({
      where: { fromId: noteId },
      select: { toId: true, toTitle: true, relation: true, weight: true },
    });

    const resolvedLinks = links.filter((link) => link.toId !== null);
    const unresolved = links
      .filter((link) => link.toId === null && link.toTitle)
      .map((link) => ({ title: link.toTitle, relation: link.relation ?? null, weight: link.weight ?? 1 }))
      .slice(0, MAX_LINK_RESULTS);

    if (!resolvedLinks.length) {
      return { resolved: [], unresolved };
    }

    const toIds = [...new Set(resolvedLinks.map((link) => link.toId))];
    const targetNotes = await prisma.note.findMany({
      where: { id: { in: toIds } },
      select: { id: true, slug: true, title: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_LINK_RESULTS,
    });
    const byId = new Map(targetNotes.map((n) => [n.id, n]));

    const resolved = [];
    for (const link of resolvedLinks) {
      const note = byId.get(link.toId);
      if (!note) continue;
      resolved.push({
        id: note.id,
        slug: note.slug,
        title: note.title,
        relation: link.relation ?? null,
        weight: link.weight ?? 1,
      });
    }

    return { resolved, unresolved };
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
   * @property {number} weight
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
   * @param {{ slug?: string, depth?: number, direction?: 'out'|'in'|'both' }} [opts={}] - Options.
   * @returns {Promise<{ nodes: GraphNode[], edges: GraphEdge[], truncated: boolean }>}
   *
   * Validates: Requirements 7.1, 7.2, 7.3, 10.1, 10.2, 10.3
   */
  async getGraph(userId, opts = {}) {
    const { slug, direction = 'both' } = opts;
    const depth = clampDepth(opts.depth);

    if (!slug) {
      return this._getFullGraph(userId);
    }

    return this._getEgoSubgraph(userId, slug, depth, direction);
  },

  /**
   * Return the full graph of non-ARCHIVED notes for a user.
   *
   * @param {string} userId
   * @returns {Promise<{ nodes: GraphNode[], edges: GraphEdge[] }>}
   * @private
   */
  async _getFullGraph(userId) {
    // Fetch one more than the cap so truncation is detectable, ordered by recency
    // so the most recently touched notes survive the cap.
    const fetched = await prisma.note.findMany({
      where: { userId, status: { not: 'ARCHIVED' } },
      select: { id: true, slug: true, title: true, status: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_GRAPH_NODES + 1,
    });

    if (!fetched.length) {
      return { nodes: [], edges: [], truncated: false };
    }

    const truncated = fetched.length > MAX_GRAPH_NODES;
    const notes = truncated ? fetched.slice(0, MAX_GRAPH_NODES) : fetched;

    const noteIds = new Set(notes.map((n) => n.id));

    const links = await prisma.link.findMany({
      where: {
        fromId: { in: [...noteIds] },
        toId: { not: null },
      },
      select: { fromId: true, toId: true, relation: true, weight: true },
    });

    // Only include edges where both endpoints are in the (possibly capped) node set,
    // which also trims edges dangling to nodes dropped by the cap.
    const edges = links
      .filter((l) => noteIds.has(l.toId))
      .map((l) => ({ fromId: l.fromId, toId: l.toId, relation: l.relation ?? null, weight: l.weight ?? 1 }));

    return { nodes: notes, edges, truncated };
  },

  /**
   * Return a ranked ego-subgraph starting from a note, traversing links up to
   * `depth` levels via BFS.
   *
   * Each reached node is annotated with:
   *  - `hop`   — BFS distance from the ego center (center = 0)
   *  - `score` — distance-decayed relevance, accumulated across paths as
   *              `Σ edgeWeight * GRAPH_DECAY ** hop`. When `Link.weight` is
   *              absent (pre-R7) every edge weighs 1, so the score degrades to
   *              `GRAPH_DECAY ** hop * pathCount`.
   *
   * Nodes are returned sorted by `score` (descending, center pinned first) and
   * capped to `MAX_GRAPH_NODES` (R5 cap); `truncated` is true when the cap drops
   * nodes. Edges left dangling by the cap are removed. Edges carry `createdAt`
   * for temporal ordering.
   *
   * @param {string} userId
   * @param {string} slug
   * @param {number} depth
   * @param {'out'|'in'|'both'} [direction='both'] - Which edge directions to follow.
   * @returns {Promise<{ nodes: Array<GraphNode & { hop: number, score: number }>, edges: Array<GraphEdge & { createdAt: Date }>, truncated: boolean }>}
   * @private
   */
  async _getEgoSubgraph(userId, slug, depth, direction = 'both') {
    const startNote = await prisma.note.findFirst({
      where: { slug, userId, status: { not: 'ARCHIVED' } },
      select: { id: true, slug: true, title: true, status: true },
    });

    if (!startNote) {
      return { nodes: [], edges: [], truncated: false };
    }

    /** @type {Map<string, GraphNode & { hop: number, score: number }>} */
    const visited = new Map();
    visited.set(startNote.id, { ...startNote, hop: 0, score: 1 });

    /** @type {Array<GraphEdge & { createdAt: Date }>} */
    const edges = [];
    const edgeSet = new Set();

    let frontier = [startNote.id];

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const frontierSet = new Set(frontier);

      // Follow outgoing and/or incoming links from the current frontier.
      const [outLinks, inLinks] = await Promise.all([
        direction === 'in'
          ? Promise.resolve([])
          : prisma.link.findMany({
              where: { fromId: { in: frontier }, toId: { not: null } },
              select: { fromId: true, toId: true, relation: true, weight: true, createdAt: true },
            }),
        direction === 'out'
          ? Promise.resolve([])
          : prisma.link.findMany({
              where: { toId: { in: frontier } },
              select: { fromId: true, toId: true, relation: true, weight: true, createdAt: true },
            }),
      ]);

      // Score contributions for nodes first discovered at this level (hop d+1).
      const levelScore = new Map();

      for (const link of [...outLinks, ...inLinks]) {
        // Dedup edges on direction + relation (relation matters once R7 types edges).
        const edgeKey = `${link.fromId}->${link.toId}:${link.relation ?? ''}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push({
            fromId: link.fromId,
            toId: link.toId,
            relation: link.relation ?? null,
            createdAt: link.createdAt,
          });
        }

        // The neighbor is the endpoint that is NOT in the current frontier.
        const neighborId = frontierSet.has(link.fromId) ? link.toId : link.fromId;
        if (!neighborId || visited.has(neighborId)) continue;

        // score = edgeWeight * GRAPH_DECAY ** hop ; weight defaults to 1 pre-R7.
        const contribution = (link.weight ?? 1) * GRAPH_DECAY ** (d + 1);
        levelScore.set(neighborId, (levelScore.get(neighborId) ?? 0) + contribution);
      }

      const neighborIds = [...levelScore.keys()];
      if (!neighborIds.length) break;

      // Fetch neighbor notes, excluding ARCHIVED.
      const neighborNotes = await prisma.note.findMany({
        where: {
          id: { in: neighborIds },
          userId,
          status: { not: 'ARCHIVED' },
        },
        select: { id: true, slug: true, title: true, status: true },
      });

      frontier = [];
      for (const note of neighborNotes) {
        if (!visited.has(note.id)) {
          visited.set(note.id, { ...note, hop: d + 1, score: levelScore.get(note.id) ?? 0 });
          frontier.push(note.id);
        }
      }
    }

    // Rank by score (desc), pin the ego center first, then cap to MAX_GRAPH_NODES.
    const allNodes = [...visited.values()];
    const center = allNodes.find((n) => n.id === startNote.id);
    const rest = allNodes
      .filter((n) => n.id !== startNote.id)
      .sort((a, b) => b.score - a.score || a.hop - b.hop || a.id.localeCompare(b.id));
    const ranked = [center, ...rest];
    const truncated = ranked.length > MAX_GRAPH_NODES;
    const rankedNodes = ranked.slice(0, MAX_GRAPH_NODES);
    const keptIds = new Set(rankedNodes.map((n) => n.id));

    // Drop edges whose endpoints didn't survive the cap (or were never visited,
    // e.g. links to ARCHIVED neighbors that findMany excluded).
    const validEdges = edges.filter((e) => keptIds.has(e.fromId) && keptIds.has(e.toId));

    return { nodes: rankedNodes, edges: validEdges, truncated };
  },

  /**
   * Multi-seed BFS expansion used by graph-aware recall (R9).
   *
   * Starting from a set of lexical-search seed note IDs, traverse resolved
   * links (both directions) up to `depth` levels, collecting reachable
   * non-seed, non-ARCHIVED notes with the full getContext field set. For each
   * collected neighbor, report `seedLinks`: the number of DISTINCT seeds it is
   * directly linked to (co-citation degree).
   *
   * Mirrors the level-step BFS of `_getEgoSubgraph`, generalised to multiple
   * roots and instrumented with co-citation counts.
   *
   * @param {string} userId
   * @param {string[]} seedIds - Seed note IDs (lexical matches).
   * @param {number} [depth=1] - BFS depth.
   * @returns {Promise<Array<{ id: string, slug: string, title: string, excerpt: string|null, updatedAt: Date|string, seedLinks: number }>>}
   *
   * Validates: Requirements 9.1, 9.2
   */
  async _expandNeighbors(userId, seedIds, depth = 1) {
    if (!seedIds.length) return [];

    const seedSet = new Set(seedIds);
    const visited = new Set(seedIds);
    /** @type {Map<string, { id: string, slug: string, title: string, excerpt: string|null, updatedAt: Date|string }>} */
    const candidates = new Map();
    /** @type {Map<string, Set<string>>} candidateId -> set of directly-linked seedIds */
    const seedLinkMap = new Map();

    let frontier = [...seedIds];

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const [outLinks, inLinks] = await Promise.all([
        prisma.link.findMany({
          where: { fromId: { in: frontier }, toId: { not: null } },
          select: { fromId: true, toId: true },
        }),
        prisma.link.findMany({
          where: { toId: { in: frontier } },
          select: { fromId: true, toId: true },
        }),
      ]);

      const neighborIds = new Set();
      for (const link of [...outLinks, ...inLinks]) {
        const { fromId, toId } = link;
        // Direct seed -> candidate connections feed the co-citation count.
        if (seedSet.has(fromId) && !seedSet.has(toId)) addSeedLink(seedLinkMap, toId, fromId);
        if (seedSet.has(toId) && !seedSet.has(fromId)) addSeedLink(seedLinkMap, fromId, toId);
        if (!visited.has(toId)) neighborIds.add(toId);
        if (!visited.has(fromId)) neighborIds.add(fromId);
      }

      if (!neighborIds.size) break;

      const neighborNotes = await prisma.note.findMany({
        where: { id: { in: [...neighborIds] }, userId, status: { not: 'ARCHIVED' } },
        select: { id: true, slug: true, title: true, excerpt: true, updatedAt: true },
      });

      frontier = [];
      for (const note of neighborNotes) {
        if (!visited.has(note.id)) {
          visited.add(note.id);
          candidates.set(note.id, note);
          frontier.push(note.id);
        }
      }
    }

    const result = [...candidates.values()].map((note) => ({
      ...note,
      seedLinks: seedLinkMap.get(note.id)?.size ?? 0,
    }));
    // Cap to MAX_GRAPH_NODES, keeping the most co-cited candidates first so
    // that R9.2 ranking has the highest-value entries even when truncated.
    result.sort((a, b) => b.seedLinks - a.seedLinks);
    return result.slice(0, MAX_GRAPH_NODES);
  },
};
