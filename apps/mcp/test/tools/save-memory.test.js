import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  directory: {
    findFirst: mock(() => null),
    create: mock(() => ({})),
  },
  note: {
    create: mock(() => ({})),
  },
  activityLog: {
    create: mock(() => ({})),
  },
};
const mockNoteService = {
  createNote: mock(() => ({})),
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

describe('save_memory', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['notes:write'] };

  beforeEach(() => {
    mockPrisma.directory.findFirst.mockReset();
    mockPrisma.directory.create.mockReset();
    mockPrisma.note.create.mockReset();
    mockPrisma.activityLog.create.mockReset();
    mockNoteService.createNote.mockReset();
    mockDirectoryService.findOrCreateMemoriesDirectory.mockReset();

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('save_memory');
  });

  test('creates note with PUBLISHED status and agent-memory tag', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'memories-dir' }));
    mockNoteService.createNote.mockImplementation((userId, data) => ({
      id: 'n1',
      slug: 'my-finding',
      title: data.title,
      status: data.status,
      tags: data.tags.map((name) => ({ name })),
    }));

    const result = await handler({ title: 'My Finding', content: 'Some research notes' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('my-finding');

    const createCall = mockNoteService.createNote.mock.calls[0];
    expect(createCall[1].status).toBe('PUBLISHED');
    expect(createCall[1].directoryId).toBe('memories-dir');
    expect(createCall[1].tags).toContain('agent-memory');
  });

  test('merges custom tags with agent-memory', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'memories-dir' }));
    mockNoteService.createNote.mockImplementation((userId, data) => ({
      id: 'n2',
      slug: 'tagged-memory',
      title: data.title,
      status: data.status,
      tags: data.tags.map((name) => ({ name })),
    }));

    await handler({ title: 'Tagged Memory', content: 'body', tags: ['research', 'project'] });

    const tagNames = mockNoteService.createNote.mock.calls[0][1].tags;
    expect(tagNames).toContain('research');
    expect(tagNames).toContain('project');
    expect(tagNames).toContain('agent-memory');
    expect(tagNames.length).toBe(3);
  });

  test('deduplicates agent-memory when already provided in tags', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'memories-dir' }));
    mockNoteService.createNote.mockImplementation((userId, data) => ({
      id: 'n3',
      slug: 'dedup-memory',
      title: data.title,
      status: data.status,
      tags: data.tags.map((name) => ({ name })),
    }));

    await handler({ title: 'Dedup Memory', content: 'body', tags: ['agent-memory', 'other'] });

    const tagNames = mockNoteService.createNote.mock.calls[0][1].tags;
    const agentMemoryCount = tagNames.filter((n) => n === 'agent-memory').length;
    expect(agentMemoryCount).toBe(1);
    expect(tagNames).toContain('other');
    expect(tagNames.length).toBe(2);
  });

  test('echoes the full persisted shape', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'memories-dir' }));
    mockNoteService.createNote.mockImplementation(() => ({
      id: 'n4',
      slug: 'shape-check',
      title: 'Shape Check',
      status: 'PUBLISHED',
      directoryId: 'memories-dir',
      excerpt: 'A sanitized excerpt',
      tags: [{ name: 'agent-memory' }, { name: 'research' }],
    }));

    const result = await handler({ title: 'Shape Check', content: 'body' });
    const parsed = JSON.parse(result.content[0].text);
    expect(Object.keys(parsed).sort()).toEqual([
      'directoryId',
      'excerpt',
      'id',
      'slug',
      'status',
      'tags',
      'title',
    ]);
    expect(parsed.id).toBe('n4');
    expect(parsed.slug).toBe('shape-check');
    expect(parsed.title).toBe('Shape Check');
    expect(parsed.status).toBe('PUBLISHED');
    expect(parsed.directoryId).toBe('memories-dir');
    expect(parsed.excerpt).toBe('A sanitized excerpt');
    expect(parsed.tags).toEqual(['agent-memory', 'research']);
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScopeHandler = server.getHandler('save_memory');

    const result = await noScopeHandler({ title: 'Test', content: 'body' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('creates the memories directory when missing', async () => {
    mockDirectoryService.findOrCreateMemoriesDirectory.mockImplementation(() => ({ id: 'new-memories-dir' }));
    mockNoteService.createNote.mockImplementation((userId, data) => ({
      id: 'n5',
      slug: 'memory',
      title: data.title,
      status: data.status,
      tags: data.tags.map((name) => ({ name })),
    }));

    const result = await handler({ title: 'Memory', content: 'body' });
    expect(result.isError).toBeUndefined();
    expect(mockDirectoryService.findOrCreateMemoriesDirectory).toHaveBeenCalledWith('u1');
    expect(mockNoteService.createNote.mock.calls[0][1].directoryId).toBe('new-memories-dir');
  });

  test('rejects empty title with validation error', () => {
    const server = createMockServer();
    register(server, auth);
    const schema = server.getSchema('save_memory');
    // Zod schema should reject empty title
    const titleSchema = schema.title;
    const result = titleSchema.safeParse('');
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('title is required');
  });
});
