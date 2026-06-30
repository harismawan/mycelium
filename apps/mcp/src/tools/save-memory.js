import { z } from "zod";
import { DirectoryService } from "@mycelium/api/services/directory.service.js";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

/**
 * Register the `save_memory` tool on the MCP server.
 *
 * Optimized for OpenClaw's session-end memory filing. Creates a published
 * note auto-tagged with `agent-memory`.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId?: string, apiKeyName?: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "save_memory",
    'Save a finding or summary as a note. Auto-tagged with "agent-memory" and published immediately.',
    {
      title: z.string().min(1, "title is required"),
      content: z.string(),
      tags: z.array(z.string()).optional(),
    },
    async ({ title, content, tags }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        // Merge agent-memory tag, deduplicate via Set
        const allTags = [...new Set([...(tags ?? []), "agent-memory"])];
        const memoriesDirectory = await DirectoryService.findOrCreateMemoriesDirectory(auth.userId);
        const note = await NoteService.createNote(auth.userId, {
          title,
          content,
          status: "PUBLISHED",
          tags: allTags,
          directoryId: memoriesDirectory.id,
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
          excerpt: note.excerpt,
          tags: note.tags.map((t) => t.name),
        };

        await logMcpAction(auth, {
          action: "mcp:save_memory",
          status: "success",
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "save_memory",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:save_memory",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "save_memory",
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
