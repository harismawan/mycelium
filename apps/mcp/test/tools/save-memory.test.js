import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  activityLog: { create: mock(() => ({})) },
};
const mockNoteService = {
  upsertMemory: mock(() => ({})),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));

const { register } = await import('../../src/tools/save-memory.js');

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

describe('save_memory (thin alias for remember)', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['notes:write'], apiKeyId: 'k1', apiKeyName: 'cli' };

  beforeEach(() => {
    mockPrisma.activityLog.create.mockReset();
    mockNoteService.upsertMemory.mockReset();

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('save_memory');
  });

  test('delegates to upsertMemory with no mode (service defaults to append)', async () => {
    mockNoteService.upsertMemory.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-finding',
      action: 'created',
      excerpt: 'Some research notes',
    }));

    const result = await handler({ title: 'My Finding', content: 'Some research notes' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      id: 'n1',
      slug: 'my-finding',
      action: 'created',
      excerpt: 'Some research notes',
    });

    const [uid, payload] = mockNoteService.upsertMemory.mock.calls[0];
    expect(uid).toBe('u1');
    expect(payload.title).toBe('My Finding');
    expect(payload.content).toBe('Some research notes');
    expect(payload.mode).toBeUndefined();
  });

  test('forwards user-supplied tags to upsertMemory', async () => {
    mockNoteService.upsertMemory.mockImplementation(() => ({ id: 'n2', slug: 's', action: 'created', excerpt: 'e' }));

    await handler({ title: 'Tagged Memory', content: 'body', tags: ['research', 'project'] });

    expect(mockNoteService.upsertMemory.mock.calls[0][1].tags).toEqual(['research', 'project']);
  });

  test('returns id, slug, action, and excerpt', async () => {
    mockNoteService.upsertMemory.mockImplementation(() => ({
      id: 'n4',
      slug: 'shape-check',
      action: 'updated',
      excerpt: 'body',
    }));

    const result = await handler({ title: 'Shape Check', content: 'body' });
    const parsed = JSON.parse(result.content[0].text);
    expect(Object.keys(parsed).sort()).toEqual(['action', 'excerpt', 'id', 'slug']);
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScope = server.getHandler('save_memory');

    const result = await noScope({ title: 'Test', content: 'body' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('Insufficient permissions');
  });

  test('rejects empty title with validation error', () => {
    const server = createMockServer();
    register(server, auth);
    const schema = server.getSchema('save_memory');
    const result = schema.title.safeParse('');
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('title is required');
  });

  test('does not expose a mode parameter', () => {
    const server = createMockServer();
    register(server, auth);
    const schema = server.getSchema('save_memory');
    expect(schema.mode).toBeUndefined();
  });
});
