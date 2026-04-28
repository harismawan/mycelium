import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  $queryRaw: mock(() => []),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) => t.toLowerCase().replace(/\s+/g, '-'),
  serializeFrontmatter: (fm, content) => `---\n---\n${content}`,
}));

const { register } = await import('../../src/tools/search-notes.js');

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

describe('search_notes', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockPrisma.$queryRaw.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('search_notes');
  });

  test('returns results with correct shape', async () => {
    const sampleResults = [
      { id: 'n1', slug: 'hello-world', title: 'Hello World', excerpt: 'A greeting', status: 'PUBLISHED', rank: 0.85 },
      { id: 'n2', slug: 'test-note', title: 'Test Note', excerpt: null, status: 'DRAFT', rank: 0.5 },
    ];
    mockPrisma.$queryRaw.mockImplementation(() => sampleResults);

    const result = await handler({ query: 'hello', tag: undefined, status: undefined, limit: undefined });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('slug');
    expect(parsed[0]).toHaveProperty('title');
    expect(parsed[0]).toHaveProperty('excerpt');
    expect(parsed[0]).toHaveProperty('status');
    expect(parsed[0]).toHaveProperty('rank');
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('search_notes');

    const result = await noScopeHandler({ query: 'test' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('returns empty array for no matches', async () => {
    mockPrisma.$queryRaw.mockImplementation(() => []);

    const result = await handler({ query: 'nonexistent' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  test('handles database error gracefully', async () => {
    mockPrisma.$queryRaw.mockImplementation(() => { throw new Error('Connection lost'); });

    const result = await handler({ query: 'test' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
