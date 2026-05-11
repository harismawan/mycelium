import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";
import { databaseError, toDirectoryTreeNode } from "../directories.js";

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
        const directories = await prisma.directory.findMany({
          where: { userId: auth.userId },
          include: {
            _count: {
              select: {
                notes: {
                  where: { status: { not: "ARCHIVED" } },
                },
              },
            },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });

        const nodes = new Map(directories.map((directory) => [directory.id, toDirectoryTreeNode(directory)]));
        const roots = [];
        for (const directory of directories) {
          const node = nodes.get(directory.id);
          if (directory.parentId && nodes.has(directory.parentId)) {
            nodes.get(directory.parentId).children.push(node);
          } else {
            roots.push(node);
          }
        }

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
        return { content: [{ type: "text", text: JSON.stringify({ directories: roots }) }] };
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
