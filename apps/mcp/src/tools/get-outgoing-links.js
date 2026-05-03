import { z } from "zod";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";

/**
 * Register the `get_outgoing_links` tool on the MCP server.
 *
 * Returns all outgoing wikilinks from a note, split into resolved
 * (target note exists) and unresolved (dangling title only).
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "get_outgoing_links",
    "Get all outgoing wikilinks from a note (resolved and unresolved)",
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
            action: "mcp:get_outgoing_links",

            status: "success",

            details: { durationMs: performance.now() - start, success: true },
          });

          log("info", "tool.call", {
            tool: "get_outgoing_links",
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
          where: { fromId: note.id },
          select: { toId: true, toTitle: true },
        });

        // Split into resolved (toId present) and unresolved (toId null, has toTitle)
        const resolvedLinks = links.filter((l) => l.toId !== null);
        const unresolvedLinks = links.filter(
          (l) => l.toId === null && l.toTitle,
        );

        // Fetch target notes for resolved links
        let resolved = [];
        if (resolvedLinks.length) {
          const toIds = [...new Set(resolvedLinks.map((l) => l.toId))];
          const targetNotes = await prisma.note.findMany({
            where: { id: { in: toIds } },
            select: { id: true, slug: true, title: true },
          });
          resolved = targetNotes.map((n) => ({
            id: n.id,
            slug: n.slug,
            title: n.title,
          }));
        }

        const unresolved = unresolvedLinks.map((l) => ({ title: l.toTitle }));

        const result = { resolved, unresolved };

        await logMcpAction(auth, {
          action: "mcp:get_outgoing_links",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "get_outgoing_links",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:get_outgoing_links",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "get_outgoing_links",
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
