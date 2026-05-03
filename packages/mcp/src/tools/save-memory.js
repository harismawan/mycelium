import { z } from "zod";
import { generateExcerpt, extractWikilinks, slugify } from "@mycelium/shared";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";
import { reconcileLinks, resolveUnresolvedLinks } from "../links.js";

/**
 * Register the `save_memory` tool on the MCP server.
 *
 * Optimized for OpenClaw's session-end memory filing. Creates a published
 * note auto-tagged with `agent-memory`.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "save_memory",
    'Save a finding or summary as a note. Auto-tagged with "agent-memory" and published immediately.',
    {
      title: z.string().min(1, "title is required"),
      content: z.string(),
      tags: z.array(z.string()).optional(),
    },
    async ({ title, content, tags }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        // Merge agent-memory tag, deduplicate via Set
        const allTags = [...new Set([...(tags ?? []), "agent-memory"])];

        const excerpt = generateExcerpt(content);
        const wikilinks = extractWikilinks(content);

        // Generate a unique slug
        const baseSlug = slugify(title);
        const existing = await prisma.note.findMany({
          where: { slug: { startsWith: baseSlug } },
          select: { slug: true },
        });
        const existingSlugs = new Set(existing.map((n) => n.slug));
        let slug = baseSlug;
        if (existingSlugs.has(slug)) {
          let counter = 1;
          while (existingSlugs.has(`${slug}-${counter}`)) counter++;
          slug = `${slug}-${counter}`;
        }

        // Build tag connect-or-create operations
        const tagOps = allTags.map((name) => ({
          where: { name },
          create: { name },
        }));

        const note = await prisma.$transaction(async (tx) => {
          const created = await tx.note.create({
            data: {
              title,
              content,
              slug,
              excerpt,
              status: "PUBLISHED",
              userId: auth.userId,
              tags: { connectOrCreate: tagOps },
              revisions: {
                create: { content },
              },
            },
            include: { tags: true },
          });

          await reconcileLinks(tx, created.id, wikilinks, auth.userId);
          await resolveUnresolvedLinks(tx, created.id, title);

          return created;
        });

        const result = {
          id: note.id,
          slug: note.slug,
        };

        await logMcpAction(auth, {
          action: "mcp:save_memory",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "save_memory",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:save_memory",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "save_memory",
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
