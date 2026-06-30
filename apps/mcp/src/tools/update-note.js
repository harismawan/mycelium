import { z } from "zod";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { handleDirectoryError, toDirectorySummary } from "../directories.js";

/**
 * Register the `update_note` tool on the MCP server.
 *
 * Updates an existing note running the full save pipeline:
 * slug regeneration (if title changed), excerpt, wikilink reconciliation,
 * conditional revision creation.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId: string, apiKeyName: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "update_note",
    "Update an existing note by slug",
    {
      slug: z.string().min(1, "slug is required"),
      title: z.string().optional(),
      content: z.string().optional(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      tags: z.array(z.string()).optional(),
      directoryId: z.string().nullable().optional(),
      message: z.string().optional(),
      metadata: z
        .object({
          source: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
          importance: z.number().int().min(1).max(5).optional(),
        })
        .optional(),
    },
    async ({
      slug,
      title: newTitle,
      content: newContent,
      status: newStatus,
      tags,
      directoryId,
      message,
      metadata,
    }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const { note } = await NoteService.updateNote(auth.userId, slug, {
          title: newTitle,
          content: newContent,
          status: newStatus,
          tags,
          directoryId,
          message,
          metadata,
          authType: "apikey",
          apiKeyId: auth.apiKeyId,
          apiKeyName: auth.apiKeyName,
        });

        const result = {
          id: note.id,
          slug: note.slug,
          title: note.title,
          status: note.status,
          directoryId: note.directoryId,
          directory: toDirectorySummary(note.directory),
          tags: note.tags.map((t) => t.name),
        };

        await logMcpAction(auth, {
          action: "mcp:update_note",
          status: "success",
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "update_note",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        if (err.statusCode === 404 && err.message === "Note not found") {
          await logMcpAction(auth, {
            action: "mcp:update_note",
            status: "success",
            details: { durationMs: performance.now() - start, success: true },
          });

          log("info", "tool.call", {
            tool: "update_note",
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

        await logMcpAction(auth, {
          action: "mcp:update_note",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "update_note",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return handleDirectoryError(err);
      }
    },
  );
}
