import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  tag: {
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

const { register } = await import('../../src/tools/list-tags.js');

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

describe('list_tags', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockPrisma.tag.findMany.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('list_tags');
  });

  test('returns tags with name and noteCount', async () => {
    mockPrisma.tag.findMany.mockImplementation(() => [
      { name: 'alpha', _count: { notes: 3 } },
      { name: 'beta', _count: { notes: 1 } },
      { name: 'gamma', _count: { notes: 5 } },
    ]);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tags).toHaveLength(3);
    expect(parsed.tags[0]).toEqual({ name: 'alpha', noteCount: 3 });
    expect(parsed.tags[1]).toEqual({ name: 'beta', noteCount: 1 });
    expect(parsed.tags[2]).toEqual({ name: 'gamma', noteCount: 5 });
  });

  test('returns tags sorted alphabetically', async () => {
    mockPrisma.tag.findMany.mockImplementation(() => [
      { name: 'aaa', _count: { notes: 1 } },
      { name: 'bbb', _count: { notes: 2 } },
      { name: 'ccc', _count: { notes: 3 } },
    ]);

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.tags.map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  test('returns empty array when no tags', async () => {
    mockPrisma.tag.findMany.mockImplementation(() => []);

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tags).toEqual([]);
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('list_tags');

    const result = await noScopeHandler({});
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });
});
