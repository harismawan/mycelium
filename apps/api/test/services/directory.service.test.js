import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockDirectory = {
  create: mock(() => ({})),
  findFirst: mock(() => null),
  findMany: mock(() => []),
  update: mock(() => ({})),
  delete: mock(() => ({})),
  count: mock(() => 0),
};

const mockNote = {
  count: mock(() => 0),
};

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.directory = mockDirectory;
      this.note = mockNote;
    }
  },
}));

const { DirectoryService } = await import('../../src/services/directory.service.js');

const userId = 'user_1';
const now = new Date();

beforeEach(() => {
  mockDirectory.create.mockReset();
  mockDirectory.findFirst.mockReset();
  mockDirectory.findMany.mockReset();
  mockDirectory.update.mockReset();
  mockDirectory.delete.mockReset();
  mockDirectory.count.mockReset();
  mockNote.count.mockReset();

  mockDirectory.findFirst.mockResolvedValue(null);
  mockDirectory.findMany.mockResolvedValue([]);
  mockDirectory.count.mockResolvedValue(0);
  mockNote.count.mockResolvedValue(0);
});

describe('DirectoryService.listTree', () => {
  test('returns nested directory tree with direct note counts', async () => {
    mockDirectory.findMany.mockResolvedValue([
      { id: 'root', name: 'Root', parentId: null, userId, createdAt: now, updatedAt: now, _count: { notes: 2 } },
      { id: 'child', name: 'Child', parentId: 'root', userId, createdAt: now, updatedAt: now, _count: { notes: 1 } },
    ]);

    const result = await DirectoryService.listTree(userId);

    expect(result.directories).toEqual([
      {
        id: 'root',
        name: 'Root',
        parentId: null,
        noteCount: 2,
        children: [
          {
            id: 'child',
            name: 'Child',
            parentId: 'root',
            noteCount: 1,
            children: [],
          },
        ],
      },
    ]);
  });
});

describe('DirectoryService.createDirectory', () => {
  test('rejects duplicate sibling names for the same user', async () => {
    mockDirectory.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(DirectoryService.createDirectory(userId, { name: 'Projects', parentId: null }))
      .rejects.toMatchObject({ statusCode: 409, message: 'Directory already exists' });
  });

  test('allows the same name under different parents', async () => {
    mockDirectory.findFirst
      .mockResolvedValueOnce({ id: 'parent' })
      .mockResolvedValueOnce(null);
    mockDirectory.create.mockResolvedValue({ id: 'dir_1', name: 'Projects', parentId: 'parent', userId });

    await DirectoryService.createDirectory(userId, { name: 'Projects', parentId: 'parent' });

    expect(mockDirectory.create).toHaveBeenCalledWith({
      data: { name: 'Projects', parentId: 'parent', userId },
    });
  });
});

describe('DirectoryService.updateDirectory', () => {
  test('rejects moving a directory under itself', async () => {
    mockDirectory.findFirst.mockResolvedValue({ id: 'dir_1', name: 'Projects', parentId: null, userId });

    await expect(DirectoryService.updateDirectory(userId, 'dir_1', { parentId: 'dir_1' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Cannot move a directory into itself' });
  });

  test('rejects moving a directory under a descendant', async () => {
    mockDirectory.findFirst
      .mockResolvedValueOnce({ id: 'root', name: 'Root', parentId: null, userId })
      .mockResolvedValueOnce({ id: 'child', name: 'Child', parentId: 'root', userId });
    mockDirectory.findMany.mockResolvedValue([{ id: 'child', parentId: 'root' }]);

    await expect(DirectoryService.updateDirectory(userId, 'root', { parentId: 'child' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Cannot move a directory into its descendant' });
  });
});

describe('DirectoryService.deleteDirectory', () => {
  test('rejects deleting a directory that contains notes', async () => {
    mockDirectory.findFirst.mockResolvedValue({ id: 'dir_1', parentId: null, userId });
    mockNote.count.mockResolvedValue(1);

    await expect(DirectoryService.deleteDirectory(userId, 'dir_1'))
      .rejects.toMatchObject({ statusCode: 409, message: 'Directory is not empty' });
  });
});

describe('DirectoryService.findOrCreateMemoryNamespace', () => {
  test('returns the existing namespace dir under the memories root', async () => {
    mockDirectory.findFirst
      .mockResolvedValueOnce({ id: 'mem-root' })  // memories root exists
      .mockResolvedValueOnce({ id: 'ns-key-A' }); // memories/key-A exists

    const res = await DirectoryService.findOrCreateMemoryNamespace(userId, 'key-A');

    expect(res).toEqual({ id: 'ns-key-A' });
    expect(mockDirectory.create).not.toHaveBeenCalled();
  });

  test('creates the memories root and namespace child when missing', async () => {
    mockDirectory.findFirst.mockResolvedValue(null); // nothing exists
    mockDirectory.create
      .mockResolvedValueOnce({ id: 'mem-root' })  // create memories root
      .mockResolvedValueOnce({ id: 'ns-key-A' }); // create memories/key-A

    const res = await DirectoryService.findOrCreateMemoryNamespace(userId, 'key-A');

    expect(res).toEqual({ id: 'ns-key-A' });
    expect(mockDirectory.create).toHaveBeenCalledTimes(2);
    expect(mockDirectory.create.mock.calls[1][0].data).toEqual({
      name: 'key-A',
      parentId: 'mem-root',
      userId,
    });
  });
});
