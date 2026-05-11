import { prisma } from '../db.js';

function normalizeName(name) {
  return name.trim();
}

function toTreeNode(directory) {
  return {
    id: directory.id,
    name: directory.name,
    parentId: directory.parentId,
    noteCount: directory._count?.notes ?? 0,
    children: [],
  };
}

async function ensureParent(userId, parentId) {
  if (parentId == null) return;
  const parent = await prisma.directory.findFirst({
    where: { id: parentId, userId },
    select: { id: true },
  });
  if (!parent) {
    throw { statusCode: 404, message: 'Parent directory not found' };
  }
}

async function ensureUniqueSibling(userId, name, parentId, excludeId) {
  const existing = await prisma.directory.findFirst({
    where: {
      userId,
      name,
      parentId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw { statusCode: 409, message: 'Directory already exists' };
  }
}

/**
 * Directory service handling nested directory CRUD and tree shaping.
 */
export const DirectoryService = {
  /**
   * @param {string} userId
   * @returns {Promise<{ directories: Array<{ id: string, name: string, parentId: string | null, noteCount: number, children: any[] }> }>}
   */
  async listTree(userId) {
    const directories = await prisma.directory.findMany({
      where: { userId },
      include: {
        _count: {
          select: {
            notes: {
              where: { status: { not: 'ARCHIVED' } },
            },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const nodes = new Map(directories.map((directory) => [directory.id, toTreeNode(directory)]));
    const roots = [];

    for (const directory of directories) {
      const node = nodes.get(directory.id);
      if (directory.parentId && nodes.has(directory.parentId)) {
        nodes.get(directory.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return { directories: roots };
  },

  /**
   * @param {string} userId
   * @param {{ name: string, parentId?: string | null }} data
   */
  async createDirectory(userId, data) {
    const name = normalizeName(data.name);
    const parentId = data.parentId ?? null;
    if (!name) {
      throw { statusCode: 400, message: 'Directory name is required' };
    }

    await ensureParent(userId, parentId);
    await ensureUniqueSibling(userId, name, parentId);

    return prisma.directory.create({
      data: { name, parentId, userId },
    });
  },

  /**
   * @param {string} userId
   * @param {string} id
   * @param {{ name?: string, parentId?: string | null }} data
   */
  async updateDirectory(userId, id, data) {
    const existing = await prisma.directory.findFirst({
      where: { id, userId },
      select: { id: true, name: true, parentId: true },
    });
    if (!existing) {
      throw { statusCode: 404, message: 'Directory not found' };
    }

    const name = data.name !== undefined ? normalizeName(data.name) : existing.name;
    const parentId = data.parentId !== undefined ? data.parentId : existing.parentId;
    if (!name) {
      throw { statusCode: 400, message: 'Directory name is required' };
    }
    if (parentId === id) {
      throw { statusCode: 400, message: 'Cannot move a directory into itself' };
    }

    await ensureParent(userId, parentId);

    if (parentId !== existing.parentId && parentId) {
      const directories = await prisma.directory.findMany({
        where: { userId },
        select: { id: true, parentId: true },
      });
      const byId = new Map(directories.map((directory) => [directory.id, directory]));
      let cursor = byId.get(parentId);
      while (cursor) {
        if (cursor.parentId === id || cursor.id === id) {
          throw { statusCode: 400, message: 'Cannot move a directory into its descendant' };
        }
        cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
      }
    }

    await ensureUniqueSibling(userId, name, parentId, id);

    return prisma.directory.update({
      where: { id },
      data: { name, parentId },
    });
  },

  /**
   * @param {string} userId
   * @param {string} id
   */
  async deleteDirectory(userId, id) {
    const existing = await prisma.directory.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) {
      throw { statusCode: 404, message: 'Directory not found' };
    }

    const [noteCount, childCount] = await Promise.all([
      prisma.note.count({ where: { userId, directoryId: id } }),
      prisma.directory.count({ where: { userId, parentId: id } }),
    ]);
    if (noteCount > 0 || childCount > 0) {
      throw { statusCode: 409, message: 'Directory is not empty' };
    }

    await prisma.directory.delete({ where: { id } });
    return { message: 'Directory deleted' };
  },

  /**
   * Find or create the root memories directory used by agent memory tools.
   *
   * @param {string} userId
   * @returns {Promise<{ id: string }>}
   */
  async findOrCreateMemoriesDirectory(userId) {
    const existing = await prisma.directory.findFirst({
      where: { userId, parentId: null, name: 'memories' },
      select: { id: true },
    });
    if (existing) return existing;

    return prisma.directory.create({
      data: { name: 'memories', parentId: null, userId },
      select: { id: true },
    });
  },
};
