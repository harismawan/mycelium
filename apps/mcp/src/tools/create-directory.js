import { z } from "zod";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";
import {
  businessError,
  ensureDirectory,
  ensureUniqueSibling,
  handleDirectoryError,
  toDirectoryResponse,
} from "../directories.js";

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
        const name = rawName.trim();
        const parentId = rawParentId ?? null;
        if (!name) return businessError("Directory name is required");

        await ensureDirectory(auth.userId, parentId);
        await ensureUniqueSibling(auth.userId, name, parentId);

        const directory = await prisma.directory.create({
          data: { name, parentId, userId: auth.userId },
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
