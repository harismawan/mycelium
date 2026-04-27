import { prisma } from '../db.js';
import {
  API_VERSION_PREFIX,
  DEFAULT_PAGE_LIMIT,
  NoteStatus,
  SCOPES,
} from '@mycelium/shared';

/**
 * Agent service providing machine-friendly endpoints for AI agent consumption.
 *
 * Exposes a manifest describing the agent API, an NDJSON bundle stream
 * for bulk-fetching all published notes, and a simplified note listing
 * optimised for agent consumption.
 */
export const AgentService = {
  /**
   * Return a JSON manifest describing available agent endpoints,
   * content schema, and authentication requirements.
   *
   * @returns {{ apiVersion: string, endpoints: object[], contentSchema: object, auth: object }}
   */
  getManifest() {
    const prefix = `${API_VERSION_PREFIX}/agent`;

    return {
      apiVersion: 'v1',
      endpoints: [
        {
          path: `${prefix}/manifest`,
          method: 'GET',
          description: 'Returns this manifest describing the agent API.',
        },
        {
          path: `${prefix}/bundle`,
          method: 'GET',
          description:
            'Streams all PUBLISHED notes as newline-delimited JSON (NDJSON).',
          contentType: 'application/x-ndjson',
        },
        {
          path: `${prefix}/notes`,
          method: 'GET',
          description:
            'Returns a simplified paginated list of notes for agent consumption.',
          contentType: 'application/json',
        },
      ],
      contentSchema: {
        note: {
          id: 'string',
          slug: 'string',
          title: 'string',
          excerpt: 'string | null',
          tags: 'string[]',
          updatedAt: 'ISO 8601 datetime',
        },
      },
      auth: {
        type: 'Bearer',
        header: 'Authorization',
        description:
          'Requires a valid API key with the "agent:read" scope passed as a Bearer token.',
        requiredScopes: [SCOPES.AGENT_READ],
      },
    };
  },

  /**
   * Stream all PUBLISHED notes for a user as newline-delimited JSON (NDJSON).
   *
   * Each line is a self-contained JSON object with note fields optimised for
   * agent consumption. The stream allows agents to process notes incrementally
   * without buffering the entire knowledge base in memory.
   *
   * @param {string} userId - ID of the owning user.
   * @returns {ReadableStream} A ReadableStream emitting NDJSON lines.
   */
  streamBundle(userId) {
    return new ReadableStream({
      async start(controller) {
        try {
          const encoder = new TextEncoder();
          const batchSize = 100;
          let cursor = undefined;

          while (true) {
            const notes = await prisma.note.findMany({
              where: { userId, status: NoteStatus.PUBLISHED },
              select: {
                id: true,
                slug: true,
                title: true,
                content: true,
                excerpt: true,
                frontmatter: true,
                tags: { select: { name: true } },
                updatedAt: true,
              },
              take: batchSize,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
              orderBy: { createdAt: 'asc' },
            });

            if (notes.length === 0) break;

            for (const note of notes) {
              const line = JSON.stringify({
                id: note.id,
                slug: note.slug,
                title: note.title,
                content: note.content,
                excerpt: note.excerpt,
                frontmatter: note.frontmatter,
                tags: note.tags.map((t) => t.name),
                updatedAt: note.updatedAt,
              });
              controller.enqueue(encoder.encode(line + '\n'));
            }

            if (notes.length < batchSize) break;
            cursor = notes[notes.length - 1].id;
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  },

  /**
   * Return a simplified paginated list of notes for agent consumption.
   *
   * Only includes fields useful for agents: id, slug, title, excerpt, tags,
   * and updatedAt. Supports cursor-based pagination.
   *
   * @param {string} userId - ID of the owning user.
   * @param {{ cursor?: string, limit?: number }} [opts={}]
   * @returns {Promise<{ notes: Array<{ id: string, slug: string, title: string, excerpt: string | null, tags: string[], updatedAt: Date }>, nextCursor: string | null }>}
   */
  async listAgentNotes(userId, opts = {}) {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;

    const notes = await prisma.note.findMany({
      where: { userId, status: NoteStatus.PUBLISHED },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        tags: { select: { name: true } },
        updatedAt: true,
      },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = notes.length > limit;
    if (hasMore) notes.pop();

    return {
      notes: notes.map((note) => ({
        id: note.id,
        slug: note.slug,
        title: note.title,
        excerpt: note.excerpt,
        tags: note.tags.map((t) => t.name),
        updatedAt: note.updatedAt,
      })),
      nextCursor: hasMore ? notes[notes.length - 1].id : null,
    };
  },
};
