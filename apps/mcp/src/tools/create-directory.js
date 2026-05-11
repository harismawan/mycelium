import { z } from "zod";
import { DirectoryService } from "@mycelium/api/services/directory.service.js";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { handleDirectoryError, toDirectoryResponse } from "../directories.js";

export function register(server, auth) {
  server.tool(
    "create_directory",
    "Create a directory, optionally nested under another directory",
    {
      name: z.string().min(1, "name is required"),
      parentId: z.string().nullable().optional(),
    },
    async ({ name: rawName, parentId: rawParentId }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const directory = await DirectoryService.createDirectory(auth.userId, {
          name: rawName,
          parentId: rawParentId ?? null,
        });

        await logMcpAction(auth, {
          action: "mcp:create_directory",
          status: "success",
          targetResourceId: directory.id,
          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "create_directory",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(toDirectoryResponse(directory)) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:create_directory",
          status: "error",
          details: { durationMs: performance.now() - start, success: false, error: err.message },
        });

        log("error", "tool.call", {
          tool: "create_directory",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return handleDirectoryError(err);
      }
    },
  );
}
