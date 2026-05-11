import { z } from "zod";
import { SearchService } from "@mycelium/api/services/search.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

/**
 * Register the `get_context` tool on the MCP server.
 *
 * Optimized for OpenClaw's session-start context loading. Returns the most
 * relevant notes for a topic (via full-text search), or the most recently
 * updated notes if no topic is provided.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "get_context",
    "Load relevant notes for a topic (or recent notes). Optimized for session-start context loading.",
    {
      topic: z
        .string()
        .optional()
        .describe(
          "Topic to search for. If omitted, returns most recently updated notes.",
        ),
      limit: z.number().int().min(1).max(20).optional().default(10),
    },
    async ({ topic, limit }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const notes = await SearchService.getContext(auth.userId, { topic, limit });

        await logMcpAction(auth, {
          action: "mcp:get_context",
          status: "success",
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "get_context",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(notes) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:get_context",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "get_context",
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
