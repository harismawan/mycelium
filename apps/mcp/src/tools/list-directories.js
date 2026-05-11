import { DirectoryService } from "@mycelium/api/services/directory.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { databaseError } from "../directories.js";

export function register(server, auth) {
  server.tool(
    "list_directories",
    "List nested directories with direct non-archived note counts",
    {},
    async () => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const result = await DirectoryService.listTree(auth.userId);

        await logMcpAction(auth, {
          action: "mcp:list_directories",
          status: "success",
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "list_directories",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:list_directories",
          status: "error",
          details: { durationMs: performance.now() - start, success: false, error: err.message },
        });

        log("error", "tool.call", {
          tool: "list_directories",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return databaseError(err);
      }
    },
  );
}
