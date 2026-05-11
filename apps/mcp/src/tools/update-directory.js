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
        const existing = await prisma.directory.findFirst({
          where: { id, userId: auth.userId },
          select: { id: true, name: true, parentId: true },
        });
        if (!existing) return businessError("Directory not found");

        const name = rawName !== undefined ? rawName.trim() : existing.name;
        const parentId = rawParentId !== undefined ? rawParentId : existing.parentId;
        if (!name) return businessError("Directory name is required");
        if (parentId === id) return businessError("Cannot move a directory into itself");

        await ensureDirectory(auth.userId, parentId);

        if (parentId !== existing.parentId && parentId) {
          const directories = await prisma.directory.findMany({
            where: { userId: auth.userId },
            select: { id: true, parentId: true },
          });
          const byId = new Map(directories.map((directory) => [directory.id, directory]));
          let cursor = byId.get(parentId);
          while (cursor) {
            if (cursor.id === id || cursor.parentId === id) {
              return businessError("Cannot move a directory into its descendant");
            }
            cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
          }
        }

        await ensureUniqueSibling(auth.userId, name, parentId, id);
        const directory = await prisma.directory.update({
          where: { id },
          data: { name, parentId },
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
