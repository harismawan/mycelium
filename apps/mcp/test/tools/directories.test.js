import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  directory: {
    findMany: mock(() => []),
    findFirst: mock(() => null),
    create: mock(() => ({})),
    update: mock(() => ({})),
    delete: mock(() => ({})),
    count: mock(() => 0),
  },
  note: {
    count: mock(() => 0),
  },
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));

const { register: registerListDirectories } = await import('../../src/tools/list-directories.js');
const { register: registerCreateDirectory } = await import('../../src/tools/create-directory.js');
const { register: registerUpdateDirectory } = await import('../../src/tools/update-directory.js');
const { register: registerDeleteDirectory } = await import('../../src/tools/delete-directory.js');

function createMockServer() {
  const tools = new Map();
  return {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
    getHandler(name) {
      return tools.get(name)?.handler;
    },
  };
}

describe('directory MCP tools', () => {
  const readAuth = { userId: 'u1', scopes: ['agent:read'] };
  const writeAuth = { userId: 'u1', scopes: ['notes:write'] };

  beforeEach(() => {
    mockPrisma.directory.findMany.mockReset();
    mockPrisma.directory.findFirst.mockReset();
    mockPrisma.directory.create.mockReset();
    mockPrisma.directory.update.mockReset();
    mockPrisma.directory.delete.mockReset();
    mockPrisma.directory.count.mockReset();
    mockPrisma.note.count.mockReset();
    mockPrisma.directory.count.mockImplementation(() => 0);
    mockPrisma.note.count.mockImplementation(() => 0);
  });

  test('list_directories returns a nested tree with direct note counts', async () => {
    const now = new Date();
    mockPrisma.directory.findMany.mockImplementation(() => [
      { id: 'root', name: 'Projects', parentId: null, createdAt: now, updatedAt: now, _count: { notes: 2 } },
      { id: 'child', name: 'Client', parentId: 'root', createdAt: now, updatedAt: now, _count: { notes: 1 } },
      { id: 'other', name: 'Archive', parentId: null, createdAt: now, updatedAt: now, _count: { notes: 0 } },
    ]);

    const server = createMockServer();
    registerListDirectories(server, readAuth);
    const result = await server.getHandler('list_directories')({});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.directories).toHaveLength(2);
    expect(parsed.directories[0]).toMatchObject({ id: 'root', name: 'Projects', noteCount: 2 });
    expect(parsed.directories[0].children).toEqual([
      expect.objectContaining({ id: 'child', name: 'Client', parentId: 'root', noteCount: 1 }),
    ]);
  });

  test('create_directory rejects duplicate sibling names', async () => {
    mockPrisma.directory.findFirst.mockImplementation(() => ({ id: 'existing' }));

    const server = createMockServer();
    registerCreateDirectory(server, writeAuth);
    const result = await server.getHandler('create_directory')({ name: 'Projects' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Directory already exists');
  });

  test('create_directory creates under an owned parent', async () => {
    mockPrisma.directory.findFirst
      .mockImplementationOnce(() => ({ id: 'parent' }))
      .mockImplementationOnce(() => null);
    mockPrisma.directory.create.mockImplementation(({ data }) => ({
      id: 'child',
      name: data.name,
      parentId: data.parentId,
      userId: data.userId,
    }));

    const server = createMockServer();
    registerCreateDirectory(server, writeAuth);
    const result = await server.getHandler('create_directory')({ name: ' Child ', parentId: 'parent' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({ id: 'child', name: 'Child', parentId: 'parent' });
    expect(mockPrisma.directory.create.mock.calls[0][0].data).toMatchObject({
      name: 'Child',
      parentId: 'parent',
      userId: 'u1',
    });
  });

  test('update_directory rejects moving a directory under its descendant', async () => {
    mockPrisma.directory.findFirst
      .mockImplementationOnce(() => ({ id: 'root', name: 'Root', parentId: null }))
      .mockImplementationOnce(() => ({ id: 'child' }))
      .mockImplementationOnce(() => null);
    mockPrisma.directory.findMany.mockImplementation(() => [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ]);

    const server = createMockServer();
    registerUpdateDirectory(server, writeAuth);
    const result = await server.getHandler('update_directory')({ id: 'root', parentId: 'child' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Cannot move a directory into its descendant');
  });

  test('delete_directory rejects non-empty directories', async () => {
    mockPrisma.directory.findFirst.mockImplementation(() => ({ id: 'dir' }));
    mockPrisma.note.count.mockImplementation(() => 1);

    const server = createMockServer();
    registerDeleteDirectory(server, writeAuth);
    const result = await server.getHandler('delete_directory')({ id: 'dir' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Directory is not empty');
    expect(mockPrisma.directory.delete).not.toHaveBeenCalled();
  });
});
