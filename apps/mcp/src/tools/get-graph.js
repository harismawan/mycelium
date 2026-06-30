import { z } from "zod";
import { LinkService } from "@mycelium/api/services/link.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

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
      direction: z.enum(["out", "in", "both"]).optional().default("both"),
    },
    async ({ slug, depth, direction }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const result = await LinkService.getGraph(auth.userId, { slug, depth, direction });

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
