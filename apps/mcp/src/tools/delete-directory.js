import { z } from "zod";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";
import { businessError, databaseError } from "../directories.js";

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
        const existing = await prisma.directory.findFirst({
          where: { id, userId: auth.userId },
          select: { id: true },
        });
        if (!existing) return businessError("Directory not found");

        const [noteCount, childCount] = await Promise.all([
          prisma.note.count({ where: { userId: auth.userId, directoryId: id } }),
          prisma.directory.count({ where: { userId: auth.userId, parentId: id } }),
        ]);
        if (noteCount > 0 || childCount > 0) return businessError("Directory is not empty");

        await prisma.directory.delete({ where: { id } });

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
        return { content: [{ type: "text", text: JSON.stringify({ message: "Directory deleted" }) }] };
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
        return databaseError(err);
      }
    },
  );
}
