import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  $queryRaw: mock(() => []),
  note: {
    findMany: mock(() => []),
  },
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) => t.toLowerCase().replace(/\s+/g, '-'),
  serializeFrontmatter: (fm, content) => `---\n---\n${content}`,
}));

const { register } = await import('../../src/tools/get-context.js');

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

describe('get_context', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockPrisma.$queryRaw.mockReset();
    mockPrisma.note.findMany.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('get_context');
  });

  test('with topic: runs full-text search and returns correct shape', async () => {
    const now = new Date();
    // First $queryRaw call returns search results
    mockPrisma.$queryRaw
      .mockImplementationOnce(() => [
        { id: 'n1', slug: 'alpha', title: 'Alpha', excerpt: 'About alpha', updatedAt: now },
        { id: 'n2', slug: 'beta', title: 'Beta', excerpt: null, updatedAt: now },
      ])
      // Second $queryRaw call returns tags
      .mockImplementationOnce(() => [
        { noteId: 'n1', name: 'science' },
        { noteId: 'n1', name: 'research' },
        { noteId: 'n2', name: 'draft' },
      ]);

    const result = await handler({ topic: 'alpha', limit: 10 });
    expect(result.isError).toBeUndefined();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: 'n1',
      slug: 'alpha',
      title: 'Alpha',
      excerpt: 'About alpha',
      tags: ['science', 'research'],
      updatedAt: now.toISOString(),
    });
    expect(parsed[1].tags).toEqual(['draft']);
    // Verify $queryRaw was called (search + tags)
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  test('without topic: calls prisma.note.findMany ordered by updatedAt desc', async () => {
    const now = new Date();
    mockPrisma.note.findMany.mockImplementation(() => [
      { id: 'n1', slug: 'recent-1', title: 'Recent 1', excerpt: 'Exc 1', tags: [{ name: 'tag1' }], updatedAt: now },
      { id: 'n2', slug: 'recent-2', title: 'Recent 2', excerpt: null, tags: [], updatedAt: now },
    ]);

    const result = await handler({ limit: 10 });
    expect(result.isError).toBeUndefined();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: 'n1',
      slug: 'recent-1',
      title: 'Recent 1',
      excerpt: 'Exc 1',
      tags: ['tag1'],
      updatedAt: now.toISOString(),
    });
    expect(parsed[1].tags).toEqual([]);

    // Verify findMany was called with correct ordering
    expect(mockPrisma.note.findMany).toHaveBeenCalled();
    const callArgs = mockPrisma.note.findMany.mock.calls[0][0];
    expect(callArgs.orderBy).toEqual({ updatedAt: 'desc' });
    expect(callArgs.take).toBe(10);
  });

  test('limit is respected for search path', async () => {
    mockPrisma.$queryRaw
      .mockImplementationOnce(() => [
        { id: 'n1', slug: 's1', title: 'S1', excerpt: null, updatedAt: new Date() },
      ])
      .mockImplementationOnce(() => []);

    const result = await handler({ topic: 'test', limit: 3 });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
  });

  test('limit is respected for recent notes path', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);

    await handler({ limit: 5 });
    const callArgs = mockPrisma.note.findMany.mock.calls[0][0];
    expect(callArgs.take).toBe(5);
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('get_context');

    const result = await noScopeHandler({ limit: 10 });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('handles database error with isError and retryable flag', async () => {
    mockPrisma.note.findMany.mockImplementation(() => { throw new Error('Connection lost'); });

    const result = await handler({ limit: 10 });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
