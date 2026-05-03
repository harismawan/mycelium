import { z } from "zod";
import { generateExcerpt, extractWikilinks, slugify } from "@mycelium/shared";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { prisma } from "../db.js";
import { reconcileLinks, resolveUnresolvedLinks } from "../links.js";

/**
 * Register the `update_note` tool on the MCP server.
 *
 * Updates an existing note running the full save pipeline:
 * slug regeneration (if title changed), excerpt, wikilink reconciliation,
 * conditional revision creation.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId: string, apiKeyName: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "update_note",
    "Update an existing note by slug",
    {
      slug: z.string().min(1, "slug is required"),
      title: z.string().optional(),
      content: z.string().optional(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
      tags: z.array(z.string()).optional(),
      message: z.string().optional(),
    },
    async ({
      slug,
      title: newTitle,
      content: newContent,
      status: newStatus,
      tags,
      message,
    }) => {
      const scopeError = checkScopes(["notes:write"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        // Find existing note
        const existing = await prisma.note.findFirst({
          where: { slug, userId: auth.userId },
          include: { tags: true },
        });

        if (!existing) {
          await logMcpAction(auth, {
            action: "mcp:update_note",

            status: "success",

            details: { durationMs: performance.now() - start, success: true },
          });

          log("info", "tool.call", {
            tool: "update_note",
            durationMs: performance.now() - start,
            success: true,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Note not found", slug }),
              },
            ],
            isError: true,
          };
        }

        // Merge fields
        const title = newTitle ?? existing.title;
        const content = newContent ?? existing.content;
        const status = newStatus ?? existing.status;

        const excerpt = generateExcerpt(content);
        const wikilinks = extractWikilinks(content);

        // Re-generate slug if title changed
        let updatedSlug = existing.slug;
        if (newTitle && newTitle !== existing.title) {
          const baseSlug = slugify(newTitle);
          const others = await prisma.note.findMany({
            where: { slug: { startsWith: baseSlug }, id: { not: existing.id } },
            select: { slug: true },
          });
          const existingSlugs = new Set(others.map((n) => n.slug));
          updatedSlug = baseSlug;
          if (existingSlugs.has(updatedSlug)) {
            let counter = 1;
            while (existingSlugs.has(`${updatedSlug}-${counter}`)) counter++;
            updatedSlug = `${updatedSlug}-${counter}`;
          }
        }

        /** @type {Record<string, unknown>} */
        const updateData = {
          title,
          content,
          slug: updatedSlug,
          excerpt,
          status,
        };

        // Handle tags: disconnect all existing, then connect-or-create new ones
        if (tags !== undefined) {
          updateData.tags = {
            set: [],
            connectOrCreate: tags.map((name) => ({
              where: { name },
              create: { name },
            })),
          };
        }

        const contentChanged = content !== existing.content;

        const note = await prisma.$transaction(async (tx) => {
          const updated = await tx.note.update({
            where: { id: existing.id },
            data: {
              ...updateData,
              ...(contentChanged
                ? {
                    revisions: {
                      create: {
                        content,
                        message,
                        authType: "apikey",
                        apiKeyId: auth.apiKeyId,
                        apiKeyName: auth.apiKeyName,
                      },
                    },
                  }
                : {}),
            },
            include: { tags: true },
          });

          await reconcileLinks(tx, updated.id, wikilinks, auth.userId);
          await resolveUnresolvedLinks(tx, updated.id, title);

          return updated;
        });

        const result = {
          id: note.id,
          slug: note.slug,
          title: note.title,
          status: note.status,
          tags: note.tags.map((t) => t.name),
        };

        await logMcpAction(auth, {
          action: "mcp:update_note",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "update_note",
          durationMs: performance.now() - start,
          success: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:update_note",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "update_note",
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
