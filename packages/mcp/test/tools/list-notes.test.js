import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
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

const { register } = await import('../../src/tools/list-notes.js');

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

describe('list_notes', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockPrisma.note.findMany.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('list_notes');
  });

  test('returns notes with correct output shape', async () => {
    const now = new Date();
    mockPrisma.note.findMany.mockImplementation(() => [
      { id: 'n1', slug: 'note-1', title: 'Note 1', excerpt: 'Excerpt 1', status: 'PUBLISHED', tags: [{ name: 'tag1' }], updatedAt: now },
      { id: 'n2', slug: 'note-2', title: 'Note 2', excerpt: null, status: 'DRAFT', tags: [], updatedAt: now },
    ]);

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0]).toHaveProperty('id');
    expect(parsed.notes[0]).toHaveProperty('slug');
    expect(parsed.notes[0]).toHaveProperty('title');
    expect(parsed.notes[0]).toHaveProperty('excerpt');
    expect(parsed.notes[0]).toHaveProperty('status');
    expect(parsed.notes[0]).toHaveProperty('tags');
    expect(parsed.notes[0]).toHaveProperty('updatedAt');
    expect(parsed.nextCursor).toBeNull();
  });

  test('returns nextCursor when more results available', async () => {
    const now = new Date();
    // Return 21 items (take + 1) to indicate more results
    const notes = Array.from({ length: 21 }, (_, i) => ({
      id: `n${i}`,
      slug: `note-${i}`,
      title: `Note ${i}`,
      excerpt: null,
      status: 'PUBLISHED',
      tags: [],
      updatedAt: now,
    }));
    mockPrisma.note.findMany.mockImplementation(() => notes);

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.notes).toHaveLength(20);
    expect(parsed.nextCursor).toBe('n19');
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('list_notes');

    const result = await noScopeHandler({});
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('passes filter parameters to query', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);

    const result = await handler({ status: 'DRAFT', tag: 'test', query: 'hello' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.notes).toEqual([]);
    expect(parsed.nextCursor).toBeNull();
    // Verify findMany was called (filter delegation)
    expect(mockPrisma.note.findMany).toHaveBeenCalled();
  });
});
