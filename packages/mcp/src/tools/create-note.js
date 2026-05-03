import { z } from "zod";
import { generateExcerpt, extractWikilinks, slugify } from "@mycelium/shared";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";
import { reconcileLinks, resolveUnresolvedLinks } from "../links.js";

/**
 * Register the `create_note` tool on the MCP server.
 *
 * Creates a new note running the full save pipeline:
 * slug generation, excerpt, wikilink reconciliation, revision creation.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId: string, apiKeyName: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "create_note",
    "Create a new note in the knowledge base",
    {
      title: z.string().min(1, "title is required"),
      content: z.string(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ title, content, status, tags }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
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
        const tagOps = (tags ?? []).map((name) => ({
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
              status: status ?? "DRAFT",
              userId: auth.userId,
              tags: tagOps.length ? { connectOrCreate: tagOps } : undefined,
              revisions: {
                create: {
                  content,
                  authType: "apikey",
                  apiKeyId: auth.apiKeyId,
                  apiKeyName: auth.apiKeyName,
                },
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
          title: note.title,
          status: note.status,
          tags: note.tags.map((t) => t.name),
        };

        await logMcpAction(auth, {
          action: "mcp:create_note",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "create_note",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:create_note",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "create_note",
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
