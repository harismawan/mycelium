import { z } from "zod";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";

/**
 * Register the `get_graph` tool on the MCP server.
 *
 * Returns the knowledge graph as nodes and edges.
 * - Without a slug: full graph of all non-archived notes and resolved links.
 * - With a slug: ego-subgraph via BFS from the note up to `depth` levels.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "get_graph",
    "Get the knowledge graph or an ego-subgraph centered on a note",
    {
      slug: z.string().optional(),
      depth: z.number().int().min(1).max(5).optional().default(1),
    },
    async ({ slug, depth }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        /** @type {{ nodes: Array<{ id: string, slug: string, title: string, status: string }>, edges: Array<{ fromId: string, toId: string, relation: string | null }> }} */
        let result;

        if (!slug) {
          result = await getFullGraph(auth.userId);
        } else {
          result = await getEgoSubgraph(auth.userId, slug, depth);
        }

        await logMcpAction(auth, {
          action: "mcp:get_graph",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "get_graph",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:get_graph",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "get_graph",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Database error",
                message: err.message,
                isRetryable: true,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * Return the full graph of non-archived notes for a user.
 *
 * @param {string} userId
 * @returns {Promise<{ nodes: Array<{ id: string, slug: string, title: string, status: string }>, edges: Array<{ fromId: string, toId: string, relation: string | null }> }>}
 */
async function getFullGraph(userId) {
  const notes = await prisma.note.findMany({
    where: { userId, status: { not: "ARCHIVED" } },
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
    .map((l) => ({
      fromId: l.fromId,
      toId: l.toId,
      relation: l.relation ?? null,
    }));

  return { nodes: notes, edges };
}

/**
 * Return an ego-subgraph starting from a note, traversing links up to
 * `depth` levels via BFS (following both outgoing and incoming links).
 *
 * @param {string} userId
 * @param {string} slug
 * @param {number} depth
 * @returns {Promise<{ nodes: Array<{ id: string, slug: string, title: string, status: string }>, edges: Array<{ fromId: string, toId: string, relation: string | null }> }>}
 */
async function getEgoSubgraph(userId, slug, depth) {
  const startNote = await prisma.note.findFirst({
    where: { slug, userId, status: { not: "ARCHIVED" } },
    select: { id: true, slug: true, title: true, status: true },
  });

  if (!startNote) {
    return { nodes: [], edges: [] };
  }

  /** @type {Map<string, { id: string, slug: string, title: string, status: string }>} */
  const visited = new Map();
  visited.set(startNote.id, startNote);

  /** @type {Array<{ fromId: string, toId: string, relation: string | null }>} */
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
        edges.push({
          fromId: link.fromId,
          toId: link.toId,
          relation: link.relation ?? null,
        });
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
        status: { not: "ARCHIVED" },
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
  const validEdges = edges.filter(
    (e) => visited.has(e.fromId) && visited.has(e.toId),
  );

  return { nodes: [...visited.values()], edges: validEdges };
}
