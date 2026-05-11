import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockTagService = {
  listTags: mock(() => ({ tags: [] })),
};

mock.module('@mycelium/api/services/tag.service.js', () => ({
  TagService: mockTagService,
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
    mockTagService.listTags.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('list_tags');
  });

  test('returns tags with name and noteCount', async () => {
    mockTagService.listTags.mockImplementation(() => ({
      tags: [
        { id: 't1', name: 'alpha', noteCount: 3 },
        { id: 't2', name: 'beta', noteCount: 1 },
        { id: 't3', name: 'gamma', noteCount: 5 },
      ],
    }));

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tags).toHaveLength(3);
    expect(parsed.tags[0]).toEqual({ name: 'alpha', noteCount: 3 });
    expect(parsed.tags[1]).toEqual({ name: 'beta', noteCount: 1 });
    expect(parsed.tags[2]).toEqual({ name: 'gamma', noteCount: 5 });
  });

  test('returns tags sorted alphabetically', async () => {
    mockTagService.listTags.mockImplementation(() => ({
      tags: [
        { id: 't1', name: 'aaa', noteCount: 1 },
        { id: 't2', name: 'bbb', noteCount: 2 },
        { id: 't3', name: 'ccc', noteCount: 3 },
      ],
    }));

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.tags.map((t) => t.name);
    expect(names).toEqual([...names].sort());
  });

  test('returns empty array when no tags', async () => {
    mockTagService.listTags.mockImplementation(() => ({ tags: [] }));

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
