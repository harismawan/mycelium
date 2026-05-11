import { z } from "zod";
import { DirectoryService } from "@mycelium/api/services/directory.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { handleDirectoryError, toDirectoryResponse } from "../directories.js";

export function register(server, auth) {
  server.tool(
    "update_directory",
    "Rename or move a directory. Rejects moving into itself or descendants.",
    {
      id: z.string().min(1, "id is required"),
      name: z.string().min(1).optional(),
      parentId: z.string().nullable().optional(),
    },
    async ({ id, name: rawName, parentId: rawParentId }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const directory = await DirectoryService.updateDirectory(auth.userId, id, {
          name: rawName,
          parentId: rawParentId,
        });

        await logMcpAction(auth, {
          action: "mcp:update_directory",
          status: "success",
          targetResourceId: directory.id,
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "update_directory",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(toDirectoryResponse(directory)) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:update_directory",
          status: "error",
          targetResourceId: id,
          details: { durationMs: performance.now() - start, success: false, error: err.message },
        });

        log("error", "tool.call", {
          tool: "update_directory",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return handleDirectoryError(err);
      }
    },
  );
}
