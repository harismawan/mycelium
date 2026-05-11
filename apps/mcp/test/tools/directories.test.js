import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockDirectoryService = {
  listTree: mock(() => ({ directories: [] })),
  createDirectory: mock(() => ({})),
  updateDirectory: mock(() => ({})),
  deleteDirectory: mock(() => ({ message: 'Directory deleted' })),
};

mock.module('@mycelium/api/services/directory.service.js', () => ({
  DirectoryService: mockDirectoryService,
}));
mock.module('../../src/db.js', () => ({
  prisma: { activityLog: { create: mock(() => ({})) } },
}));

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
    mockDirectoryService.listTree.mockReset();
    mockDirectoryService.createDirectory.mockReset();
    mockDirectoryService.updateDirectory.mockReset();
    mockDirectoryService.deleteDirectory.mockReset();
  });

  test('list_directories returns a nested tree with direct note counts', async () => {
    mockDirectoryService.listTree.mockImplementation(() => ({
      directories: [
        {
          id: 'root',
          name: 'Projects',
          parentId: null,
          noteCount: 2,
          children: [{ id: 'child', name: 'Client', parentId: 'root', noteCount: 1, children: [] }],
        },
        { id: 'other', name: 'Archive', parentId: null, noteCount: 0, children: [] },
      ],
    }));

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
    mockDirectoryService.createDirectory.mockImplementation(() => {
      throw { statusCode: 409, message: 'Directory already exists' };
    });

    const server = createMockServer();
    registerCreateDirectory(server, writeAuth);
    const result = await server.getHandler('create_directory')({ name: 'Projects' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Directory already exists');
  });

  test('create_directory creates under an owned parent', async () => {
    mockDirectoryService.createDirectory.mockImplementation((userId, data) => ({
      id: 'child',
      name: data.name.trim(),
      parentId: data.parentId,
      userId,
    }));

    const server = createMockServer();
    registerCreateDirectory(server, writeAuth);
    const result = await server.getHandler('create_directory')({ name: ' Child ', parentId: 'parent' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({ id: 'child', name: 'Child', parentId: 'parent' });
    expect(mockDirectoryService.createDirectory).toHaveBeenCalledWith('u1', {
      name: ' Child ',
      parentId: 'parent',
    });
  });

  test('update_directory rejects moving a directory under its descendant', async () => {
    mockDirectoryService.updateDirectory.mockImplementation(() => {
      throw { statusCode: 400, message: 'Cannot move a directory into its descendant' };
    });

    const server = createMockServer();
    registerUpdateDirectory(server, writeAuth);
    const result = await server.getHandler('update_directory')({ id: 'root', parentId: 'child' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Cannot move a directory into its descendant');
  });

  test('delete_directory rejects non-empty directories', async () => {
    mockDirectoryService.deleteDirectory.mockImplementation(() => {
      throw { statusCode: 409, message: 'Directory is not empty' };
    });

    const server = createMockServer();
    registerDeleteDirectory(server, writeAuth);
    const result = await server.getHandler('delete_directory')({ id: 'dir' });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Directory is not empty');
    expect(mockDirectoryService.deleteDirectory).toHaveBeenCalledWith('u1', 'dir');
  });
});
