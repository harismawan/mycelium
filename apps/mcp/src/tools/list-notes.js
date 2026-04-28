import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT } from '@mycelium/shared';
import { checkScopes } from '../auth.js';
import { log } from '../logger.js';
import { prisma } from '../db.js';

/**
 * Register the `list_notes` tool on the MCP server.
 *
 * Lists notes with cursor-based pagination and optional filters.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    'list_notes',
    'List notes with optional filters and cursor-based pagination',
    {
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
      tag: z.string().optional(),
      query: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ status, tag, query, cursor, limit }) => {
      const scopeError = checkScopes(['agent:read'], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const take = limit ?? DEFAULT_PAGE_LIMIT;

        /** @type {Record<string, unknown>} */
        const where = { userId: auth.userId };

        if (status) {
          where.status = status;
        } else {
          where.status = { not: 'ARCHIVED' };
        }

        if (tag) {
          where.tags = { some: { name: tag } };
        }

        if (query) {
          where.OR = [
            { title: { contains: query, mode: 'insensitive' } },
            { content: { contains: query, mode: 'insensitive' } },
          ];
        }

        const notes = await prisma.note.findMany({
          where,
          take: take + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: { createdAt: 'desc' },
          include: { tags: true },
        });

        const hasMore = notes.length > take;
        if (hasMore) notes.pop();

        const result = {
          notes: notes.map((n) => ({
            id: n.id,
            slug: n.slug,
            title: n.title,
            excerpt: n.excerpt,
            status: n.status,
            tags: n.tags.map((t) => t.name),
            updatedAt: n.updatedAt.toISOString(),
          })),
          nextCursor: hasMore ? notes[notes.length - 1].id : null,
        };

        log('info', 'tool.call', { tool: 'list_notes', durationMs: performance.now() - start, success: true });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        log('error', 'tool.call', { tool: 'list_notes', durationMs: performance.now() - start, success: false, error: err.message });
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Database error', message: err.message, isRetryable: true }) }],
          isError: true,
        };
      }
    },
  );
}
