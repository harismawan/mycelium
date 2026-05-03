import { z } from "zod";
import { serializeFrontmatter } from "@mycelium/shared";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";

/**
 * Register the `read_note` tool on the MCP server.
 *
 * Retrieves a single note by slug in JSON or Markdown format.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "read_note",
    "Read the full content of a note by slug",
    {
      slug: z.string().min(1, "slug is required"),
      format: z.enum(["json", "markdown"]).optional().default("json"),
    },
    async ({ slug, format }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const note = await prisma.note.findFirst({
          where: { slug, userId: auth.userId },
          include: { tags: true },
        });

        if (!note) {
          await logMcpAction(auth, {
            action: "mcp:read_note",

            status: "success",

            details: { durationMs: performance.now() - start, success: true },
          });

          log("info", "tool.call", {
            tool: "read_note",
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

        /** @type {string} */
        let result;

        if (format === "markdown") {
          const fm = {
            title: note.title,
            status: note.status,
            tags: note.tags.map((t) => t.name),
          };
          result = serializeFrontmatter(fm, note.content);
        } else {
          result = JSON.stringify({
            id: note.id,
            slug: note.slug,
            title: note.title,
            content: note.content,
            excerpt: note.excerpt,
            status: note.status,
            tags: note.tags.map((t) => t.name),
            updatedAt: note.updatedAt.toISOString(),
          });
        }

        await logMcpAction(auth, {
          action: "mcp:read_note",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "read_note",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:read_note",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "read_note",
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
