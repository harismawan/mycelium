import { z } from "zod";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";

/**
 * Register the `get_backlinks` tool on the MCP server.
 *
 * Returns all notes that link to the specified note (backlinks),
 * each with id, slug, title, and tags.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "get_backlinks",
    "Get all notes that link to a given note (backlinks)",
    {
      slug: z.string().min(1, "slug is required"),
    },
    async ({ slug }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const note = await prisma.note.findFirst({
          where: { slug, userId: auth.userId },
          select: { id: true },
        });

        if (!note) {
          await logMcpAction(auth, {
            action: "mcp:get_backlinks",

            status: "success",

            details: { durationMs: performance.now() - start, success: true },
          });

          log("info", "tool.call", {
            tool: "get_backlinks",
            durationMs: performance.now() - start,
            success: true,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Note not found", slug }),
              },
            ],
            isError: true,
          };
        }

        const links = await prisma.link.findMany({
          where: { toId: note.id },
          select: { fromId: true },
        });

        if (!links.length) {
          await logMcpAction(auth, {
            action: "mcp:get_backlinks",

            status: "success",

            details: { durationMs: performance.now() - start, success: true },
          });

          log("info", "tool.call", {
            tool: "get_backlinks",
            durationMs: performance.now() - start,
            success: true,
          });
          return { content: [{ type: "text", text: JSON.stringify([]) }] };
        }

        const fromIds = [...new Set(links.map((l) => l.fromId))];

        const notes = await prisma.note.findMany({
          where: { id: { in: fromIds } },
          include: { tags: true },
        });

        const result = notes.map((n) => ({
          id: n.id,
          slug: n.slug,
          title: n.title,
          tags: n.tags.map((t) => t.name),
        }));

        await logMcpAction(auth, {
          action: "mcp:get_backlinks",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "get_backlinks",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:get_backlinks",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "get_backlinks",
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
