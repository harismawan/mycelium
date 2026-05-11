import { z } from "zod";
import { DirectoryService } from "@mycelium/api/services/directory.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { handleDirectoryError } from "../directories.js";

export function register(server, auth) {
  server.tool(
    "delete_directory",
    "Delete an empty directory. Directories with notes or child directories are rejected.",
    {
      id: z.string().min(1, "id is required"),
    },
    async ({ id }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const result = await DirectoryService.deleteDirectory(auth.userId, id);

        await logMcpAction(auth, {
          action: "mcp:delete_directory",
          status: "success",
          targetResourceId: id,
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "delete_directory",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:delete_directory",
          status: "error",
          targetResourceId: id,
          details: { durationMs: performance.now() - start, success: false, error: err.message },
        });

        log("error", "tool.call", {
          tool: "delete_directory",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return handleDirectoryError(err);
      }
    },
  );
}
