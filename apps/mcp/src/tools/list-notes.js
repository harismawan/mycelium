import { z } from "zod";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

/**
 * Register the `list_notes` tool on the MCP server.
 *
 * Lists notes with cursor-based pagination and optional filters.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "list_notes",
    "List notes with optional filters and cursor-based pagination",
    {
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      tag: z.string().optional(),
      query: z.string().optional(),
      directoryId: z.string().optional(),
      unfiled: z.boolean().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ status, tag, query, directoryId, unfiled, cursor, limit }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const { notes, nextCursor } = await NoteService.listNotes(auth.userId, {
          status,
          tag,
          q: query,
          directoryId,
          unfiled,
          cursor,
          limit,
        });

        const result = {
          notes: notes.map((n) => ({
            id: n.id,
            slug: n.slug,
            title: n.title,
            excerpt: n.excerpt,
            status: n.status,
            tags: n.tags.map((t) => t.name),
            directoryId: n.directoryId,
            directory: n.directory
              ? { id: n.directory.id, name: n.directory.name, parentId: n.directory.parentId }
              : null,
            updatedAt: n.updatedAt.toISOString(),
          })),
          nextCursor,
        };

        await logMcpAction(auth, {
          action: "mcp:list_notes",
          status: "success",
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "list_notes",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:list_notes",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "list_notes",
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
