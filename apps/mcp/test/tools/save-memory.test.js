import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  note: {
    findMany: mock(() => []),
    create: mock(() => ({})),
  },
  link: {
    findMany: mock(() => []),
    create: mock(() => ({})),
    deleteMany: mock(() => ({})),
    updateMany: mock(() => ({})),
  },
  $transaction: mock((fn) => fn(mockPrisma)),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('../../src/links.js', () => ({
  reconcileLinks: mock(() => Promise.resolve()),
  resolveUnresolvedLinks: mock(() => Promise.resolve()),
}));
mock.module('@mycelium/shared', () => ({
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) => t.toLowerCase().replace(/\s+/g, '-'),
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
    mockPrisma.note.findMany.mockReset();
    mockPrisma.note.create.mockReset();
    mockPrisma.link.findMany.mockReset();
    mockPrisma.link.create.mockReset();
    mockPrisma.link.deleteMany.mockReset();
    mockPrisma.link.updateMany.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('save_memory');
  });

  test('creates note with PUBLISHED status and agent-memory tag', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);
    mockPrisma.note.create.mockImplementation(({ data }) => ({
      id: 'n1',
      slug: data.slug,
      title: data.title,
      status: data.status,
      tags: data.tags.connectOrCreate.map((t) => ({ name: t.create.name })),
    }));

    const result = await handler({ title: 'My Finding', content: 'Some research notes' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('my-finding');

    // Verify the create call used PUBLISHED status and agent-memory tag
    const createCall = mockPrisma.note.create.mock.calls[0][0];
    expect(createCall.data.status).toBe('PUBLISHED');
    const tagNames = createCall.data.tags.connectOrCreate.map((t) => t.create.name);
    expect(tagNames).toContain('agent-memory');
  });

  test('merges custom tags with agent-memory', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);
    mockPrisma.note.create.mockImplementation(({ data }) => ({
      id: 'n2',
      slug: 'tagged-memory',
      title: data.title,
      status: data.status,
      tags: data.tags.connectOrCreate.map((t) => ({ name: t.create.name })),
    }));

    await handler({ title: 'Tagged Memory', content: 'body', tags: ['research', 'project'] });

    const createCall = mockPrisma.note.create.mock.calls[0][0];
    const tagNames = createCall.data.tags.connectOrCreate.map((t) => t.create.name);
    expect(tagNames).toContain('research');
    expect(tagNames).toContain('project');
    expect(tagNames).toContain('agent-memory');
    expect(tagNames.length).toBe(3);
  });

  test('deduplicates agent-memory when already provided in tags', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);
    mockPrisma.note.create.mockImplementation(({ data }) => ({
      id: 'n3',
      slug: 'dedup-memory',
      title: data.title,
      status: data.status,
      tags: data.tags.connectOrCreate.map((t) => ({ name: t.create.name })),
    }));

    await handler({ title: 'Dedup Memory', content: 'body', tags: ['agent-memory', 'other'] });

    const createCall = mockPrisma.note.create.mock.calls[0][0];
    const tagNames = createCall.data.tags.connectOrCreate.map((t) => t.create.name);
    const agentMemoryCount = tagNames.filter((n) => n === 'agent-memory').length;
    expect(agentMemoryCount).toBe(1);
    expect(tagNames).toContain('other');
    expect(tagNames.length).toBe(2);
  });

  test('returns only id and slug', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);
    mockPrisma.note.create.mockImplementation(() => ({
      id: 'n4',
      slug: 'shape-check',
      title: 'Shape Check',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
    }));

    const result = await handler({ title: 'Shape Check', content: 'body' });
    const parsed = JSON.parse(result.content[0].text);
    expect(Object.keys(parsed).sort()).toEqual(['id', 'slug']);
    expect(parsed.id).toBe('n4');
    expect(parsed.slug).toBe('shape-check');
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
