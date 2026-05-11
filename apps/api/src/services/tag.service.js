import { prisma } from '../db.js';

/**
 * Tag service handling tag listings and tag-scoped note lookups.
 */
export const TagService = {
  /**
   * @param {string} userId
   * @returns {Promise<{ tags: Array<{ id: string, name: string, noteCount: number }> }>}
   */
  async listTags(userId) {
    const tags = await prisma.tag.findMany({
      where: {
        notes: {
          some: {
            userId,
            status: { not: 'ARCHIVED' },
          },
        },
      },
      include: {
        _count: {
          select: {
            notes: {
              where: {
                userId,
                status: { not: 'ARCHIVED' },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        noteCount: tag._count.notes,
      })),
    };
  },
};
