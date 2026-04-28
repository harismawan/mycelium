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
  DEFAULT_PAGE_LIMIT: 20,
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) => t.toLowerCase().replace(/\s+/g, '-'),
  serializeFrontmatter: (fm, content) => `---\n---\n${content}`,
}));

const { register } = await import('../../src/tools/create-note.js');

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

describe('create_note', () => {
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
    handler = server.getHandler('create_note');
  });

  test('returns created note with correct shape', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);
    mockPrisma.note.create.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      status: 'DRAFT',
      tags: [{ name: 'test' }],
    }));

    const result = await handler({ title: 'My Note', content: 'Some content', tags: ['test'] });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('my-note');
    expect(parsed.title).toBe('My Note');
    expect(parsed.status).toBe('DRAFT');
    expect(parsed.tags).toEqual(['test']);
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScopeHandler = server.getHandler('create_note');

    const result = await noScopeHandler({ title: 'Test', content: 'body' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('creates note with tags', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);
    mockPrisma.note.create.mockImplementation(() => ({
      id: 'n2',
      slug: 'tagged-note',
      title: 'Tagged Note',
      status: 'PUBLISHED',
      tags: [{ name: 'alpha' }, { name: 'beta' }],
    }));

    const result = await handler({ title: 'Tagged Note', content: 'body', status: 'PUBLISHED', tags: ['alpha', 'beta'] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tags).toEqual(['alpha', 'beta']);
    expect(parsed.status).toBe('PUBLISHED');
  });

  test('handles database error gracefully', async () => {
    mockPrisma.$transaction.mockImplementation(() => { throw new Error('DB down'); });

    const result = await handler({ title: 'Fail', content: 'body' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
