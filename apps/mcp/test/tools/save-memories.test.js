import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  activityLog: { create: mock(() => ({})) },
};
const mockNoteService = {
  createMemories: mock(() => []),
};
const mockDirectoryService = {
  findOrCreateMemoriesDirectory: mock(() => ({ id: 'memories-dir' })),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));
mock.module('@mycelium/api/services/directory.service.js', () => ({
  DirectoryService: mockDirectoryService,
}));

const { register } = await import('../../src/tools/save-memories.js');

function createMockServer() {
  const tools = new Map();
  return {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
    getHandler(name) {
      return tools.get(name)?.handler;
    },
    getSchema(name) {
      return tools.get(name)?.schema;
    },
  };
}

describe('save_memories', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['notes:write'], apiKeyId: 'k1', apiKeyName: 'key' };

  beforeEach(() => {
    mockPrisma.activityLog.create.mockReset();
    mockNoteService.createMemories.mockReset();
    mockDirectoryService.findOrCreateMemoriesDirectory.mockReset();

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('save_memories');
  });

  test('decorates each memory and returns per-item results', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'memories-dir' }));
    mockNoteService.createMemories.mockImplementation((userId, items) =>
      items.map((_, index) => ({ index, id: `n${index}`, slug: `s${index}`, action: 'created', error: null })),
    );

    const result = await handler({
      memories: [
        { title: 'Alpha', content: 'a' },
        { title: 'Beta', content: 'b', tags: ['proj'] },
      ],
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ index: 0, id: 'n0', slug: 's0', action: 'created', error: null });

    const [calledUserId, items] = mockNoteService.createMemories.mock.calls[0];
    expect(calledUserId).toBe('u1');
    expect(items[0].status).toBe('PUBLISHED');
    expect(items[0].directoryId).toBe('memories-dir');
    expect(items[0].tags).toContain('agent-memory');
    expect(items[0].authType).toBe('apikey');
    expect(items[0].apiKeyId).toBe('k1');
    expect(items[1].tags).toContain('proj');
    expect(items[1].tags).toContain('agent-memory');
  });

  test('deduplicates agent-memory when already provided', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'memories-dir' }));
    mockNoteService.createMemories.mockImplementation((userId, items) =>
      items.map((_, index) => ({ index, id: `n${index}`, slug: `s${index}`, action: 'created', error: null })),
    );

    await handler({ memories: [{ title: 'X', content: 'c', tags: ['agent-memory', 'k'] }] });

    const items = mockNoteService.createMemories.mock.calls[0][1];
    expect(items[0].tags.filter((t) => t === 'agent-memory').length).toBe(1);
    expect(items[0].tags).toContain('k');
  });

  test('passes through best-effort per-item errors without failing the call', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'memories-dir' }));
    mockNoteService.createMemories.mockImplementation(() => [
      { index: 0, id: 'n0', slug: 's0', action: 'created', error: null },
      { index: 1, id: null, slug: null, action: null, error: 'Directory not found' },
    ]);

    const result = await handler({
      memories: [{ title: 'A', content: 'a' }, { title: 'B', content: 'b' }],
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[1].error).toBe('Directory not found');
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScopeHandler = server.getHandler('save_memories');

    const result = await noScopeHandler({ memories: [{ title: 'A', content: 'a' }] });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('schema rejects an empty batch and more than 25 memories', () => {
    const server = createMockServer();
    register(server, auth);
    const schema = server.getSchema('save_memories');

    const over = Array.from({ length: 26 }, (_, i) => ({ title: `t${i}`, content: 'c' }));
    expect(schema.memories.safeParse(over).success).toBe(false);
    expect(schema.memories.safeParse([]).success).toBe(false);
    expect(schema.memories.safeParse([{ title: 't', content: 'c' }]).success).toBe(true);
  });
});
