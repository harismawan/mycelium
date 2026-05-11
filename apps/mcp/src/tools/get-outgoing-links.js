import { z } from "zod";
import { LinkService } from "@mycelium/api/services/link.service.js";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

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
        const note = await NoteService.getNote(auth.userId, slug);

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

        const result = await LinkService.getOutgoingLinks(note.id);

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
