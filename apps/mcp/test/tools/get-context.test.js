import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockSearchService = {
  getContext: mock(() => []),
};

mock.module('@mycelium/api/services/search.service.js', () => ({
  SearchService: mockSearchService,
}));
mock.module('../../src/db.js', () => ({
  prisma: { activityLog: { create: mock(() => ({})) } },
}));
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
    mockSearchService.getContext.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('get_context');
  });

  test('with topic: runs full-text search and returns correct shape', async () => {
    const now = new Date();
    mockSearchService.getContext.mockImplementation(() => [
        { id: 'n1', slug: 'alpha', title: 'Alpha', excerpt: 'About alpha', updatedAt: now },
        { id: 'n2', slug: 'beta', title: 'Beta', excerpt: null, updatedAt: now.toISOString(), tags: ['draft'] },
      ].map((note) => ({
        ...note,
        tags: note.tags ?? ['science', 'research'],
        updatedAt: note.updatedAt instanceof Date ? note.updatedAt.toISOString() : note.updatedAt,
      })));

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
    expect(mockSearchService.getContext).toHaveBeenCalledWith('u1', { topic: 'alpha', limit: 10 });
  });

  test('without topic: delegates to SearchService.getContext', async () => {
    const now = new Date();
    mockSearchService.getContext.mockImplementation(() => [
      { id: 'n1', slug: 'recent-1', title: 'Recent 1', excerpt: 'Exc 1', tags: ['tag1'], updatedAt: now.toISOString() },
      { id: 'n2', slug: 'recent-2', title: 'Recent 2', excerpt: null, tags: [], updatedAt: now.toISOString() },
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

    expect(mockSearchService.getContext).toHaveBeenCalledWith('u1', { topic: undefined, limit: 10 });
  });

  test('limit is respected for search path', async () => {
    mockSearchService.getContext.mockImplementation(() => [
      { id: 'n1', slug: 's1', title: 'S1', excerpt: null, tags: [], updatedAt: new Date().toISOString() },
    ]);

    const result = await handler({ topic: 'test', limit: 3 });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
  });

  test('limit is respected for recent notes path', async () => {
    mockSearchService.getContext.mockImplementation(() => []);

    await handler({ limit: 5 });
    expect(mockSearchService.getContext.mock.calls[0][1].limit).toBe(5);
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
    mockSearchService.getContext.mockImplementation(() => { throw new Error('Connection lost'); });

    const result = await handler({ limit: 10 });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
