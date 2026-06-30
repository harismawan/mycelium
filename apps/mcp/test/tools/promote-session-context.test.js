import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNoteService = {
  createNote: mock(() => ({})),
};
const mockDirectoryService = {
  findOrCreateMemoryNamespace: mock(() => ({ id: 'ns-key-A' })),
};
const mockListSessionValues = mock(() => []);

mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));
mock.module('@mycelium/api/services/directory.service.js', () => ({
  DirectoryService: mockDirectoryService,
}));
mock.module('../../src/session.js', () => ({
  listSessionValues: mockListSessionValues,
}));
mock.module('../../src/db.js', () => ({
  prisma: { activityLog: { create: mock(() => ({})) } },
}));

const { register } = await import('../../src/tools/promote-session-context.js');

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

describe('promote_session_context', () => {
  let handler;
  const auth = { userId: 'u1', apiKeyId: 'key-A', apiKeyName: 'agent-1', scopes: ['notes:write'] };

  beforeEach(() => {
    mockNoteService.createNote.mockReset();
    mockDirectoryService.findOrCreateMemoryNamespace.mockReset();
    mockListSessionValues.mockReset();

    mockDirectoryService.findOrCreateMemoryNamespace.mockImplementation(() => ({ id: 'ns-key-A' }));
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('promote_session_context');
  });

  test('composes selected session entries into a namespaced agent-memory note', async () => {
    mockListSessionValues.mockImplementation(() => [
      { key: 'decision', value: 'use pgvector' },
      { key: 'todo', value: 'write migration' },
    ]);
    mockNoteService.createNote.mockImplementation((userId, data) => ({
      id: 'n1',
      slug: 'session-summary',
      title: data.title,
    }));

    const result = await handler({ title: 'Session Summary', keys: ['decision'] });
    expect(result.isError).toBeUndefined();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      id: 'n1',
      slug: 'session-summary',
      action: 'created',
      promotedKeys: ['decision'],
    });

    // Reads scratch via the apiKeyId-scoped store.
    expect(mockListSessionValues).toHaveBeenCalledWith('key-A');

    // Writes to the namespace subtree with agent-memory tag + provenance.
    expect(mockDirectoryService.findOrCreateMemoryNamespace).toHaveBeenCalledWith('u1', 'key-A');
    const createArg = mockNoteService.createNote.mock.calls[0][1];
    expect(createArg.directoryId).toBe('ns-key-A');
    expect(createArg.status).toBe('PUBLISHED');
    expect(createArg.tags).toContain('agent-memory');
    expect(createArg.apiKeyId).toBe('key-A');
    expect(createArg.content).toBe('## decision\n\nuse pgvector');
  });

  test('promotes all keys when none are specified', async () => {
    mockListSessionValues.mockImplementation(() => [
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    mockNoteService.createNote.mockImplementation(() => ({ id: 'n2', slug: 'all' }));

    const result = await handler({ title: 'All' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.promotedKeys).toEqual(['a', 'b']);
    expect(mockNoteService.createNote.mock.calls[0][1].content).toBe('## a\n\n1\n\n## b\n\n2');
  });

  test('errors when there is no session context to promote', async () => {
    mockListSessionValues.mockImplementation(() => []);

    const result = await handler({ title: 'Empty' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('No session context to promote');
    expect(mockNoteService.createNote).not.toHaveBeenCalled();
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', apiKeyId: 'key-A', scopes: ['agent:read'] });
    const noScopeHandler = server.getHandler('promote_session_context');

    const result = await noScopeHandler({ title: 'X' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });
});
