import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  activityLog: {
    create: mock(() => ({})),
  },
};
const mockNoteService = {
  createNote: mock(() => ({})),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));

const { register } = await import('../../src/tools/create-note.js');

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

describe('create_note', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['notes:write'], apiKeyId: 'ak1', apiKeyName: 'test-key' };

  beforeEach(() => {
    mockPrisma.activityLog.create.mockReset();
    mockNoteService.createNote.mockReset();

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('create_note');
  });

  test('returns created note with correct shape', async () => {
    mockNoteService.createNote.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      status: 'DRAFT',
      tags: [{ name: 'test' }],
      directoryId: null,
      directory: null,
    }));

    const result = await handler({ title: 'My Note', content: 'Some content', tags: ['test'] });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('my-note');
    expect(parsed.title).toBe('My Note');
    expect(parsed.status).toBe('DRAFT');
    expect(parsed.tags).toEqual(['test']);
    expect(mockNoteService.createNote.mock.calls[0][0]).toBe('u1');
    expect(mockNoteService.createNote.mock.calls[0][1]).toMatchObject({
      title: 'My Note',
      content: 'Some content',
      tags: ['test'],
      authType: 'apikey',
      apiKeyId: 'ak1',
      apiKeyName: 'test-key',
    });
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScopeHandler = server.getHandler('create_note');

    const result = await noScopeHandler({ title: 'Test', content: 'body' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('creates note with tags', async () => {
    mockNoteService.createNote.mockImplementation(() => ({
      id: 'n2',
      slug: 'tagged-note',
      title: 'Tagged Note',
      status: 'PUBLISHED',
      tags: [{ name: 'alpha' }, { name: 'beta' }],
      directoryId: null,
      directory: null,
    }));

    const result = await handler({ title: 'Tagged Note', content: 'body', status: 'PUBLISHED', tags: ['alpha', 'beta'] });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tags).toEqual(['alpha', 'beta']);
    expect(parsed.status).toBe('PUBLISHED');
  });

  test('creates note in an owned directory', async () => {
    mockNoteService.createNote.mockImplementation((userId, data) => ({
      id: 'n3',
      slug: 'directory-note',
      title: 'Directory Note',
      status: 'DRAFT',
      directoryId: data.directoryId,
      directory: { id: 'dir1', name: 'Projects', parentId: null },
      tags: [],
    }));

    const result = await handler({ title: 'Directory Note', content: 'body', directoryId: 'dir1' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.directoryId).toBe('dir1');
    expect(parsed.directory).toEqual({ id: 'dir1', name: 'Projects', parentId: null });
    expect(mockNoteService.createNote.mock.calls[0][1].directoryId).toBe('dir1');
  });

  test('rejects another user directory', async () => {
    mockNoteService.createNote.mockImplementation(() => {
      throw { statusCode: 404, message: 'Directory not found' };
    });

    const result = await handler({ title: 'Bad Directory', content: 'body', directoryId: 'other-dir' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Directory not found');
  });

  test('handles database error gracefully', async () => {
    mockNoteService.createNote.mockImplementation(() => { throw new Error('DB down'); });

    const result = await handler({ title: 'Fail', content: 'body' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
