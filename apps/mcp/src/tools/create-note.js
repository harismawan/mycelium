import { z } from "zod";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { handleDirectoryError, toDirectorySummary } from "../directories.js";

/**
 * Register the `create_note` tool on the MCP server.
 *
 * Creates a new note running the full save pipeline:
 * slug generation, excerpt, wikilink reconciliation, revision creation.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId: string, apiKeyName: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "create_note",
    "Create a new note in the knowledge base",
    {
      title: z.string().min(1, "title is required"),
      content: z.string(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      tags: z.array(z.string()).optional(),
      directoryId: z.string().nullable().optional(),
    },
    async ({ title, content, status, tags, directoryId }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const note = await NoteService.createNote(auth.userId, {
          title,
          content,
          status,
          tags,
          directoryId,
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
          action: "mcp:create_note",
          status: "success",
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "create_note",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:create_note",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "create_note",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return handleDirectoryError(err);
      }
    },
  );
}
