import { z } from "zod";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";

/**
 * Build the recall-then-upsert handler shared by the `remember` and
 * `save_memory` tools. Both call NoteService.upsertMemory; only the logged
 * tool name differs.
 *
 * @param {{ userId: string, scopes: string[], apiKeyId?: string, apiKeyName?: string }} auth
 * @param {string} toolName - Tool name used for activity logging.
 * @returns {(args: { title: string, content: string, tags?: string[], mode?: 'append'|'replace'|'new' }) => Promise<object>}
 */
export function makeRememberHandler(auth, toolName) {
  return async ({ title, content, tags, mode }) => {
    const scopeError = checkScopes(["notes:write"], auth.scopes);
    if (scopeError) return scopeError;

    const start = performance.now();
    try {
      const result = await NoteService.upsertMemory(auth.userId, {
        title,
        content,
        tags,
        mode,
        authType: "apikey",
        apiKeyId: auth.apiKeyId,
        apiKeyName: auth.apiKeyName,
      });

      await logMcpAction(auth, {
        action: `mcp:${toolName}`,
        status: "success",
        details: { durationMs: performance.now() - start, success: true, action: result.action },
      });

      log("info", "tool.call", {
        tool: toolName,
        durationMs: performance.now() - start,
        success: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      await logMcpAction(auth, {
        action: `mcp:${toolName}`,
        status: "error",
        details: {
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        },
      });

      log("error", "tool.call", {
        tool: toolName,
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
  };
}

/**
 * Register the `remember` tool: recall-then-upsert consolidation for durable
 * agent memories.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId?: string, apiKeyName?: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "remember",
    'Consolidate a durable memory. Recalls an existing "agent-memory" note by exact title and either appends a timestamped update (mode "append", the default), overwrites it (mode "replace"), or always creates a new note (mode "new"). Auto-tagged "agent-memory", filed in the memories directory, and published.',
    {
      title: z.string().min(1, "title is required"),
      content: z.string(),
      tags: z.array(z.string()).optional(),
      mode: z.enum(["append", "replace", "new"]).optional(),
    },
    makeRememberHandler(auth, "remember"),
  );
}
