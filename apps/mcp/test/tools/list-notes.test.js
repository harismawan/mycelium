import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNoteService = {
  listNotes: mock(() => ({ notes: [], nextCursor: null })),
};

mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
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
    mockNoteService.listNotes.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('list_notes');
  });

  test('returns notes with correct output shape', async () => {
    const now = new Date();
    mockNoteService.listNotes.mockImplementation(() => ({
      notes: [
        { id: 'n1', slug: 'note-1', title: 'Note 1', excerpt: 'Excerpt 1', status: 'PUBLISHED', directoryId: 'dir1', directory: { id: 'dir1', name: 'Projects', parentId: null }, tags: [{ name: 'tag1' }], updatedAt: now },
        { id: 'n2', slug: 'note-2', title: 'Note 2', excerpt: null, status: 'DRAFT', directoryId: null, directory: null, tags: [], updatedAt: now },
      ],
      nextCursor: null,
    }));

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
    expect(parsed.notes[0]).toHaveProperty('directoryId');
    expect(parsed.notes[0]).toHaveProperty('directory');
    expect(parsed.notes[0]).toHaveProperty('updatedAt');
    expect(parsed.nextCursor).toBeNull();
  });

  test('returns nextCursor when more results available', async () => {
    const now = new Date();
    const notes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      slug: `note-${i}`,
      title: `Note ${i}`,
      excerpt: null,
      status: 'PUBLISHED',
      tags: [],
      updatedAt: now,
    }));
    mockNoteService.listNotes.mockImplementation(() => ({ notes, nextCursor: 'n19' }));

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
    mockNoteService.listNotes.mockImplementation(() => ({ notes: [], nextCursor: null }));

    const result = await handler({ status: 'DRAFT', tag: 'test', query: 'hello' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.notes).toEqual([]);
    expect(parsed.nextCursor).toBeNull();
    expect(mockNoteService.listNotes).toHaveBeenCalledWith('u1', {
      status: 'DRAFT',
      tag: 'test',
      q: 'hello',
      directoryId: undefined,
      unfiled: undefined,
      cursor: undefined,
      limit: undefined,
    });
  });

  test('filters by directory and unfiled notes', async () => {
    mockNoteService.listNotes.mockImplementation(() => ({ notes: [], nextCursor: null }));

    await handler({ directoryId: 'dir1' });
    expect(mockNoteService.listNotes.mock.calls[0][1].directoryId).toBe('dir1');

    await handler({ unfiled: true });
    expect(mockNoteService.listNotes.mock.calls[1][1].unfiled).toBe(true);
  });
});
