import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  note: {
    findFirst: mock(() => null),
    findMany: mock(() => []),
  },
  link: {
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

const { register } = await import('../../src/tools/get-backlinks.js');

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

describe('get_backlinks', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockPrisma.note.findFirst.mockReset();
    mockPrisma.note.findMany.mockReset();
    mockPrisma.link.findMany.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('get_backlinks');
  });

  test('returns backlinks with correct shape', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({ id: 'n1' }));
    mockPrisma.link.findMany.mockImplementation(() => [
      { fromId: 'n2' },
      { fromId: 'n3' },
    ]);
    mockPrisma.note.findMany.mockImplementation(() => [
      { id: 'n2', slug: 'note-2', title: 'Note 2', tags: [{ name: 'tag1' }] },
      { id: 'n3', slug: 'note-3', title: 'Note 3', tags: [] },
    ]);

    const result = await handler({ slug: 'target-note' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('slug');
    expect(parsed[0]).toHaveProperty('title');
    expect(parsed[0]).toHaveProperty('tags');
    expect(parsed[0].tags).toEqual(['tag1']);
  });

  test('returns not-found error for missing note', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => null);

    const result = await handler({ slug: 'nonexistent' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Note not found');
  });

  test('returns empty array when no backlinks', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({ id: 'n1' }));
    mockPrisma.link.findMany.mockImplementation(() => []);

    const result = await handler({ slug: 'lonely-note' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('get_backlinks');

    const result = await noScopeHandler({ slug: 'test' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });
});
