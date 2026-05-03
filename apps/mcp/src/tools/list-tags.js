import { z } from "zod";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";

/**
 * Register the `list_tags` tool on the MCP server.
 *
 * Returns all tags with note counts for the authenticated user's
 * non-archived notes, sorted alphabetically.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool("list_tags", "List all tags with note counts", {}, async () => {
    const scopeError = checkScopes(["agent:read"], auth.scopes);
    if (scopeError) return scopeError;

    const start = performance.now();
    try {
      const tags = await prisma.tag.findMany({
        where: {
          notes: {
            some: {
              userId: auth.userId,
              status: { not: "ARCHIVED" },
            },
          },
        },
        include: {
          _count: {
            select: {
              notes: {
                where: {
                  userId: auth.userId,
                  status: { not: "ARCHIVED" },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      });

      const result = {
        tags: tags.map((t) => ({
          name: t.name,
          noteCount: t._count.notes,
        })),
      };

      await logMcpAction(auth, {
        action: "mcp:list_tags",

        status: "success",

        details: { durationMs: performance.now() - start, success: true },
      });

      log("info", "tool.call", {
        tool: "list_tags",
        durationMs: performance.now() - start,
        success: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      await logMcpAction(auth, {
        action: "mcp:list_tags",

        status: "error",

        details: {
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        },
      });

      log("error", "tool.call", {
        tool: "list_tags",
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
  });
}
