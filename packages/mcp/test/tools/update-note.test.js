import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  note: {
    findFirst: mock(() => null),
    findMany: mock(() => []),
    update: mock(() => ({})),
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

const { register } = await import('../../src/tools/update-note.js');

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

describe('update_note', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['notes:write'], apiKeyId: 'ak1', apiKeyName: 'test-key' };

  beforeEach(() => {
    mockPrisma.note.findFirst.mockReset();
    mockPrisma.note.findMany.mockReset();
    mockPrisma.note.update.mockReset();
    mockPrisma.link.findMany.mockReset();
    mockPrisma.link.create.mockReset();
    mockPrisma.link.deleteMany.mockReset();
    mockPrisma.link.updateMany.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('update_note');
  });

  test('returns updated note with correct shape', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      content: 'Old content',
      status: 'DRAFT',
      tags: [{ name: 'old-tag' }],
    }));
    mockPrisma.note.update.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      content: 'New content',
      status: 'PUBLISHED',
      tags: [{ name: 'new-tag' }],
    }));

    const result = await handler({ slug: 'my-note', content: 'New content', status: 'PUBLISHED', tags: ['new-tag'] });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('my-note');
    expect(parsed.title).toBe('My Note');
    expect(parsed.status).toBe('PUBLISHED');
    expect(parsed.tags).toEqual(['new-tag']);
  });

  test('returns not-found error for missing note', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => null);

    const result = await handler({ slug: 'nonexistent' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Note not found');
    expect(parsed.slug).toBe('nonexistent');
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScopeHandler = server.getHandler('update_note');

    const result = await noScopeHandler({ slug: 'test' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('handles database error gracefully', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1', slug: 'my-note', title: 'My Note', content: 'Old', status: 'DRAFT', tags: [],
    }));
    mockPrisma.$transaction.mockImplementation(() => { throw new Error('DB error'); });

    const result = await handler({ slug: 'my-note', content: 'New' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
