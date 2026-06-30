import { z } from "zod";
import { DirectoryService } from "@mycelium/api/services/directory.service.js";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

/**
 * Register the `save_memories` tool on the MCP server.
 *
 * Batch session-end flush: files up to 25 findings as published notes
 * auto-tagged "agent-memory" in one transaction. Returns best-effort
 * per-item results so a single bad item does not fail the whole flush.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId?: string, apiKeyName?: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "save_memories",
    'Save up to 25 findings as notes in one call. Each is auto-tagged "agent-memory" and published. Returns per-item results ({index,id,slug,action,error}); one failure does not abort the rest.',
    {
      memories: z
        .array(
          z.object({
            title: z.string().min(1, "title is required"),
            content: z.string(),
            tags: z.array(z.string()).optional(),
          }),
        )
        .min(1, "at least one memory is required")
        .max(25, "at most 25 memories per call"),
    },
    async ({ memories }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const memoriesDirectory = await DirectoryService.findOrCreateMemoriesDirectory(auth.userId);

        const items = memories.map((m) => ({
          title: m.title,
          content: m.content,
          status: "PUBLISHED",
          // Merge agent-memory tag, deduplicate via Set
          tags: [...new Set([...(m.tags ?? []), "agent-memory"])],
          directoryId: memoriesDirectory.id,
          authType: "apikey",
          apiKeyId: auth.apiKeyId,
          apiKeyName: auth.apiKeyName,
        }));

        const results = await NoteService.createMemories(auth.userId, items);
        const succeeded = results.filter((r) => !r.error).length;

        await logMcpAction(auth, {
          action: "mcp:save_memories",
          status: "success",
          details: {
            durationMs: performance.now() - start,
            success: true,
            count: results.length,
            succeeded,
          },
        });

        log("info", "tool.call", {
          tool: "save_memories",
          durationMs: performance.now() - start,
          success: true,
          count: results.length,
          succeeded,
        });
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:save_memories",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "save_memories",
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
