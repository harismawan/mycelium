import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNoteService = {
  getNote: mock(() => null),
};
const mockLinkService = {
  getOutgoingLinks: mock(() => ({ resolved: [], unresolved: [] })),
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

const { register } = await import('../../src/tools/get-outgoing-links.js');

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

describe('get_outgoing_links', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockNoteService.getNote.mockReset();
    mockLinkService.getOutgoingLinks.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('get_outgoing_links');
  });

  test('returns resolved and unresolved links', async () => {
    mockNoteService.getNote.mockImplementation(() => ({ id: 'n1' }));
    mockLinkService.getOutgoingLinks.mockImplementation(() => ({
      resolved: [{ id: 'n2', slug: 'linked-note', title: 'Linked Note' }],
      unresolved: [{ title: 'Missing Note' }],
    }));

    const result = await handler({ slug: 'source-note' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.resolved).toHaveLength(1);
    expect(parsed.resolved[0]).toEqual({ id: 'n2', slug: 'linked-note', title: 'Linked Note' });
    expect(parsed.unresolved).toHaveLength(1);
    expect(parsed.unresolved[0]).toEqual({ title: 'Missing Note' });
  });

  test('returns not-found error for missing note', async () => {
    mockNoteService.getNote.mockImplementation(() => null);

    const result = await handler({ slug: 'nonexistent' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Note not found');
  });

  test('returns empty resolved and unresolved when no links', async () => {
    mockNoteService.getNote.mockImplementation(() => ({ id: 'n1' }));
    mockLinkService.getOutgoingLinks.mockImplementation(() => ({ resolved: [], unresolved: [] }));

    const result = await handler({ slug: 'no-links' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.resolved).toEqual([]);
    expect(parsed.unresolved).toEqual([]);
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('get_outgoing_links');

    const result = await noScopeHandler({ slug: 'test' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });
});
