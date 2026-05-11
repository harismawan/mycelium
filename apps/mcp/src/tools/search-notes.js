import { z } from "zod";
import { SearchService } from "@mycelium/api/services/search.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

/**
 * Register the `search_notes` tool on the MCP server.
 *
 * Full-text search across the authenticated user's notes using
 * PostgreSQL tsvector indexes with optional status and tag filters.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "search_notes",
    "Full-text search across the knowledge base",
    {
      query: z.string().min(1, "query is required"),
      tag: z.string().optional(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, tag, status, cursor, limit }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const result = await SearchService.search(auth.userId, query, {
          tag,
          status,
          cursor,
          limit,
        });

        await logMcpAction(auth, {
          action: "mcp:search_notes",
          status: "success",
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "search_notes",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:search_notes",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "search_notes",
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
