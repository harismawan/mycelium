import { z } from "zod";
import { Prisma } from "@prisma/client";
import { DEFAULT_PAGE_LIMIT } from "@mycelium/shared";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";

/**
 * Register the `search_notes` tool on the MCP server.
 *
 * Full-text search across the authenticated user's notes using
 * PostgreSQL tsvector indexes with optional status and tag filters.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "search_notes",
    "Full-text search across the knowledge base",
    {
      query: z.string().min(1, "query is required"),
      tag: z.string().optional(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, tag, status, limit }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const take = limit ?? DEFAULT_PAGE_LIMIT;

        // Build dynamic WHERE conditions
        const conditions = [
          Prisma.sql`n."userId" = ${auth.userId}`,
          Prisma.sql`n."searchVector" @@ plainto_tsquery('english', ${query})`,
        ];

        if (status) {
          conditions.push(Prisma.sql`n."status" = ${status}::"NoteStatus"`);
        } else {
          conditions.push(Prisma.sql`n."status" != 'ARCHIVED'`);
        }

        const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

        // Optional tag join
        let joinClause = Prisma.empty;
        if (tag) {
          joinClause = Prisma.sql`
            INNER JOIN "_NoteToTag" nt ON nt."A" = n."id"
            INNER JOIN "Tag" t ON t."id" = nt."B" AND t."name" = ${tag}`;
        }

        /** @type {Array<{ id: string, slug: string, title: string, excerpt: string | null, status: string, rank: number }>} */
        const results = await prisma.$queryRaw`
          SELECT n."id", n."slug", n."title", n."excerpt", n."status",
                 ts_rank(n."searchVector", plainto_tsquery('english', ${query})) AS rank
          FROM "Note" n
          ${joinClause}
          ${whereClause}
          ORDER BY rank DESC, n."id" DESC
          LIMIT ${take}
        `;

        await logMcpAction(auth, {
          action: "mcp:search_notes",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "search_notes",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:search_notes",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "search_notes",
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
