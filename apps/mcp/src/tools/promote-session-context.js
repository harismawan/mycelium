import { z } from "zod";
import { DirectoryService } from "@mycelium/api/services/directory.service.js";
import { NoteService } from "@mycelium/api/services/note.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { listSessionValues } from "../session.js";

/**
 * Register the `promote_session_context` tool on the MCP server.
 *
 * Bridges ephemeral session scratch into a durable agent-memory note,
 * namespaced under `memories/<apiKeyId>` so it is recallable via
 * `getContext({ namespace })`. Requires notes:write.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId?: string, apiKeyName?: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "promote_session_context",
    "Promote ephemeral session context into a durable, namespaced agent-memory note. Requires notes:write.",
    {
      title: z.string().min(1, "title is required"),
      keys: z
        .array(z.string())
        .optional()
        .describe("Session keys to include. Omit to promote every key."),
      tags: z.array(z.string()).optional(),
    },
    async ({ title, keys, tags }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const entries = await listSessionValues(auth.apiKeyId);
        const selected =
          keys && keys.length ? entries.filter((e) => keys.includes(e.key)) : entries;

        if (selected.length === 0) {
          const error = "No session context to promote";
          await logMcpAction(auth, {
            action: "mcp:promote_session_context",
            status: "error",
            details: { durationMs: performance.now() - start, success: false, error },
          });
          log("warn", "tool.call", {
            tool: "promote_session_context",
            durationMs: performance.now() - start,
            success: false,
            error,
          });
          return {
            content: [{ type: "text", text: JSON.stringify({ error }) }],
            isError: true,
          };
        }

        const content = selected.map((e) => `## ${e.key}\n\n${e.value}`).join("\n\n");
        const allTags = [...new Set([...(tags ?? []), "agent-memory"])];
        const namespaceDir = await DirectoryService.findOrCreateMemoryNamespace(
          auth.userId,
          auth.apiKeyId,
        );

        const note = await NoteService.createNote(auth.userId, {
          title,
          content,
          status: "PUBLISHED",
          tags: allTags,
          directoryId: namespaceDir.id,
          authType: "apikey",
          apiKeyId: auth.apiKeyId,
          apiKeyName: auth.apiKeyName,
        });

        const result = {
          id: note.id,
          slug: note.slug,
          action: "created",
          promotedKeys: selected.map((e) => e.key),
        };

        await logMcpAction(auth, {
          action: "mcp:promote_session_context",
          status: "success",
          targetResourceId: note.id,
          targetResourceSlug: note.slug,
          details: { durationMs: performance.now() - start, success: true },
        });
        log("info", "tool.call", {
          tool: "promote_session_context",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:promote_session_context",
          status: "error",
          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });
        log("error", "tool.call", {
          tool: "promote_session_context",
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
