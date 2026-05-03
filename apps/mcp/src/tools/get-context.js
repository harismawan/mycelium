import { z } from "zod";
import { Prisma } from "@prisma/client";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";

/**
 * Register the `get_context` tool on the MCP server.
 *
 * Optimized for OpenClaw's session-start context loading. Returns the most
 * relevant notes for a topic (via full-text search), or the most recently
 * updated notes if no topic is provided.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "get_context",
    "Load relevant notes for a topic (or recent notes). Optimized for session-start context loading.",
    {
      topic: z
        .string()
        .optional()
        .describe(
          "Topic to search for. If omitted, returns most recently updated notes.",
        ),
      limit: z.number().int().min(1).max(20).optional().default(10),
    },
    async ({ topic, limit }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        /** @type {Array<{ id: string, slug: string, title: string, excerpt: string | null, tags: string[], updatedAt: string }>} */
        let notes;

        if (topic) {
          // Full-text search path
          const results = await prisma.$queryRaw`
            SELECT n."id", n."slug", n."title", n."excerpt", n."updatedAt"
            FROM "Note" n
            WHERE n."userId" = ${auth.userId}
              AND n."status" != 'ARCHIVED'
              AND n."searchVector" @@ plainto_tsquery('english', ${topic})
            ORDER BY ts_rank(n."searchVector", plainto_tsquery('english', ${topic})) DESC, n."updatedAt" DESC
            LIMIT ${limit}
          `;

          // Fetch tags for the returned notes
          const noteIds = results.map((r) => r.id);
          const tagRows =
            noteIds.length > 0
              ? await prisma.$queryRaw`
                SELECT nt."A" AS "noteId", t."name"
                FROM "_NoteToTag" nt
                INNER JOIN "Tag" t ON t."id" = nt."B"
                WHERE nt."A" IN (${Prisma.join(noteIds)})
              `
              : [];

          /** @type {Map<string, string[]>} */
          const tagMap = new Map();
          for (const row of tagRows) {
            const arr = tagMap.get(row.noteId) ?? [];
            arr.push(row.name);
            tagMap.set(row.noteId, arr);
          }

          notes = results.map((r) => ({
            id: r.id,
            slug: r.slug,
            title: r.title,
            excerpt: r.excerpt,
            tags: tagMap.get(r.id) ?? [],
            updatedAt:
              r.updatedAt instanceof Date
                ? r.updatedAt.toISOString()
                : r.updatedAt,
          }));
        } else {
          // Recent notes path
          const results = await prisma.note.findMany({
            where: { userId: auth.userId, status: { not: "ARCHIVED" } },
            take: limit,
            orderBy: { updatedAt: "desc" },
            include: { tags: true },
          });

          notes = results.map((n) => ({
            id: n.id,
            slug: n.slug,
            title: n.title,
            excerpt: n.excerpt,
            tags: n.tags.map((t) => t.name),
            updatedAt: n.updatedAt.toISOString(),
          }));
        }

        await logMcpAction(auth, {
          action: "mcp:get_context",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "get_context",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(notes) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:get_context",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "get_context",
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
