import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNoteService = {
  getNote: mock(() => null),
};
const mockLinkService = {
  getBacklinks: mock(() => []),
};

mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));
mock.module('@mycelium/api/services/link.service.js', () => ({
  LinkService: mockLinkService,
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
    mockNoteService.getNote.mockReset();
    mockLinkService.getBacklinks.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('get_backlinks');
  });

  test('returns backlinks with correct shape', async () => {
    mockNoteService.getNote.mockImplementation(() => ({ id: 'n1' }));
    mockLinkService.getBacklinks.mockImplementation(() => [
      { id: 'n2', slug: 'note-2', title: 'Note 2', tags: [{ name: 'tag1' }], relation: 'refines', weight: 2 },
      { id: 'n3', slug: 'note-3', title: 'Note 3', tags: [], relation: null, weight: 1 },
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
    expect(parsed[0].relation).toBe('refines');
    expect(parsed[0].weight).toBe(2);
  });

  test('returns not-found error for missing note', async () => {
    mockNoteService.getNote.mockImplementation(() => null);

    const result = await handler({ slug: 'nonexistent' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Note not found');
  });

  test('returns empty array when no backlinks', async () => {
    mockNoteService.getNote.mockImplementation(() => ({ id: 'n1' }));
    mockLinkService.getBacklinks.mockImplementation(() => []);

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
