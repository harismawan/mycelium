import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  activityLog: {
    create: mock(() => ({})),
  },
};
const mockNoteService = {
  updateNote: mock(() => ({})),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));

const { register } = await import('../../src/tools/update-note.js');

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

describe('update_note', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['notes:write'], apiKeyId: 'ak1', apiKeyName: 'test-key' };

  beforeEach(() => {
    mockPrisma.activityLog.create.mockReset();
    mockNoteService.updateNote.mockReset();

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('update_note');
  });

  test('returns updated note with correct shape', async () => {
    mockNoteService.updateNote.mockImplementation(() => ({
      note: {
        id: 'n1',
        slug: 'my-note',
        title: 'My Note',
        content: 'New content',
        status: 'PUBLISHED',
        tags: [{ name: 'new-tag' }],
        directoryId: null,
        directory: null,
      },
    }));

    const result = await handler({ slug: 'my-note', content: 'New content', status: 'PUBLISHED', tags: ['new-tag'] });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('my-note');
    expect(parsed.title).toBe('My Note');
    expect(parsed.status).toBe('PUBLISHED');
    expect(parsed.tags).toEqual(['new-tag']);
    expect(mockNoteService.updateNote.mock.calls[0][0]).toBe('u1');
    expect(mockNoteService.updateNote.mock.calls[0][1]).toBe('my-note');
    expect(mockNoteService.updateNote.mock.calls[0][2]).toMatchObject({
      content: 'New content',
      status: 'PUBLISHED',
      tags: ['new-tag'],
      authType: 'apikey',
      apiKeyId: 'ak1',
      apiKeyName: 'test-key',
    });
  });

  test('moves note into a directory and back to unfiled', async () => {
    mockNoteService.updateNote.mockImplementation((userId, slug, data) => ({
      note: {
        id: 'n1',
        slug: 'my-note',
        title: 'My Note',
        content: 'Old content',
        status: 'DRAFT',
        directoryId: data.directoryId,
        directory: data.directoryId ? { id: data.directoryId, name: 'Projects', parentId: null } : null,
        tags: [],
      },
    }));

    const moved = await handler({ slug: 'my-note', directoryId: 'dir1' });
    expect(moved.isError).toBeUndefined();
    expect(JSON.parse(moved.content[0].text).directoryId).toBe('dir1');
    expect(mockNoteService.updateNote.mock.calls[0][2].directoryId).toBe('dir1');

    const cleared = await handler({ slug: 'my-note', directoryId: null });
    expect(cleared.isError).toBeUndefined();
    expect(JSON.parse(cleared.content[0].text).directoryId).toBeNull();
    expect(mockNoteService.updateNote.mock.calls[1][2].directoryId).toBeNull();
  });

  test('rejects assigning note to another user directory', async () => {
    mockNoteService.updateNote.mockImplementation(() => {
      throw { statusCode: 404, message: 'Directory not found' };
    });

    const result = await handler({ slug: 'my-note', directoryId: 'other-dir' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Directory not found');
  });

  test('returns not-found error for missing note', async () => {
    mockNoteService.updateNote.mockImplementation(() => {
      throw { statusCode: 404, message: 'Note not found' };
    });

    const result = await handler({ slug: 'nonexistent' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Note not found');
    expect(parsed.slug).toBe('nonexistent');
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScopeHandler = server.getHandler('update_note');

    const result = await noScopeHandler({ slug: 'test' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('handles database error gracefully', async () => {
    mockNoteService.updateNote.mockImplementation(() => { throw new Error('DB error'); });

    const result = await handler({ slug: 'my-note', content: 'New' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });

  test('forwards metadata to NoteService.updateNote', async () => {
    mockNoteService.updateNote.mockImplementation((userId, slug, data) => ({
      note: {
        id: 'n1', slug, title: 'My Note', content: 'body', status: 'DRAFT',
        tags: [], directoryId: null, directory: null, metadata: data.metadata,
      },
    }));

    await handler({ slug: 'my-note', metadata: { importance: 5 } });

    expect(mockNoteService.updateNote.mock.calls[0][2].metadata).toEqual({ importance: 5 });
  });
});
