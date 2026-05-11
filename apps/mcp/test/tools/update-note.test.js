import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  directory: {
    findFirst: mock(() => null),
  },
  note: {
    findFirst: mock(() => null),
    findMany: mock(() => []),
    update: mock(() => ({})),
  },
  link: {
    findMany: mock(() => []),
    create: mock(() => ({})),
    deleteMany: mock(() => ({})),
    updateMany: mock(() => ({})),
  },
  $transaction: mock((fn) => fn(mockPrisma)),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('../../src/links.js', () => ({
  reconcileLinks: mock(() => Promise.resolve()),
  resolveUnresolvedLinks: mock(() => Promise.resolve()),
}));
mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) => t.toLowerCase().replace(/\s+/g, '-'),
  serializeFrontmatter: (fm, content) => `---\n---\n${content}`,
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
    mockPrisma.directory.findFirst.mockReset();
    mockPrisma.note.findFirst.mockReset();
    mockPrisma.note.findMany.mockReset();
    mockPrisma.note.update.mockReset();
    mockPrisma.link.findMany.mockReset();
    mockPrisma.link.create.mockReset();
    mockPrisma.link.deleteMany.mockReset();
    mockPrisma.link.updateMany.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('update_note');
  });

  test('returns updated note with correct shape', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      content: 'Old content',
      status: 'DRAFT',
      tags: [{ name: 'old-tag' }],
    }));
    mockPrisma.note.update.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      content: 'New content',
      status: 'PUBLISHED',
      tags: [{ name: 'new-tag' }],
    }));

    const result = await handler({ slug: 'my-note', content: 'New content', status: 'PUBLISHED', tags: ['new-tag'] });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('my-note');
    expect(parsed.title).toBe('My Note');
    expect(parsed.status).toBe('PUBLISHED');
    expect(parsed.tags).toEqual(['new-tag']);
  });

  test('moves note into a directory and back to unfiled', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      content: 'Old content',
      status: 'DRAFT',
      directoryId: null,
      tags: [],
    }));
    mockPrisma.directory.findFirst.mockImplementation(() => ({ id: 'dir1' }));
    mockPrisma.note.update.mockImplementation(({ data }) => ({
      id: 'n1',
      slug: 'my-note',
      title: data.title,
      content: data.content,
      status: data.status,
      directoryId: data.directoryId,
      directory: data.directoryId ? { id: data.directoryId, name: 'Projects', parentId: null } : null,
      tags: [],
    }));

    const moved = await handler({ slug: 'my-note', directoryId: 'dir1' });
    expect(moved.isError).toBeUndefined();
    expect(JSON.parse(moved.content[0].text).directoryId).toBe('dir1');
    expect(mockPrisma.note.update.mock.calls[0][0].data.directoryId).toBe('dir1');

    const cleared = await handler({ slug: 'my-note', directoryId: null });
    expect(cleared.isError).toBeUndefined();
    expect(JSON.parse(cleared.content[0].text).directoryId).toBeNull();
    expect(mockPrisma.note.update.mock.calls[1][0].data.directoryId).toBeNull();
  });

  test('rejects assigning note to another user directory', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1',
      slug: 'my-note',
      title: 'My Note',
      content: 'Old content',
      status: 'DRAFT',
      tags: [],
    }));
    mockPrisma.directory.findFirst.mockImplementation(() => null);

    const result = await handler({ slug: 'my-note', directoryId: 'other-dir' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Directory not found');
    expect(mockPrisma.note.update).not.toHaveBeenCalled();
  });

  test('returns not-found error for missing note', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => null);

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
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1', slug: 'my-note', title: 'My Note', content: 'Old', status: 'DRAFT', tags: [],
    }));
    mockPrisma.$transaction.mockImplementation(() => { throw new Error('DB error'); });

    const result = await handler({ slug: 'my-note', content: 'New' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
