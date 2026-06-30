import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — must happen before any import that touches Prisma
// ---------------------------------------------------------------------------
const mockNote = {
  create: mock(() => ({})),
  findMany: mock(() => []),
  findFirst: mock(() => null),
  update: mock(() => ({})),
};
const mockDirectory = {
  findFirst: mock(() => null),
  create: mock(() => ({})),
};
const mockLink = {
  findMany: mock(() => []),
  deleteMany: mock(() => ({ count: 0 })),
  create: mock(() => ({})),
  createMany: mock(() => ({ count: 0 })),
  updateMany: mock(() => ({ count: 0 })),
};
const mockTag = { findMany: mock(() => []) };
const mockRevision = { create: mock(() => ({})) };

const mockTransaction = mock(async (arg) => {
  if (Array.isArray(arg)) return Promise.all(arg);
  return arg({
    note: mockNote,
    directory: mockDirectory,
    link: mockLink,
    tag: mockTag,
    revision: mockRevision,
  });
});

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.directory = mockDirectory;
      this.link = mockLink;
      this.tag = mockTag;
      this.revision = mockRevision;
      this.$transaction = mockTransaction;
    }
  },
}));

const { NoteService } = await import('../../src/services/note.service.js');

const userId = 'user_1';

beforeEach(() => {
  mockNote.create.mockReset();
  mockNote.findMany.mockReset();
  mockNote.findFirst.mockReset();
  mockNote.update.mockReset();
  mockDirectory.findFirst.mockReset();
  mockDirectory.create.mockReset();
  mockLink.findMany.mockReset();
  mockLink.deleteMany.mockReset();
  mockLink.create.mockReset();
  mockLink.createMany.mockReset();
  mockLink.updateMany.mockReset();
  mockTag.findMany.mockReset();
  mockRevision.create.mockReset();
  mockTransaction.mockReset();

  mockTransaction.mockImplementation(async (arg) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg({
      note: mockNote,
      directory: mockDirectory,
      link: mockLink,
      tag: mockTag,
      revision: mockRevision,
    });
  });

  // Safe defaults for the create/update pipelines
  mockNote.findMany.mockResolvedValue([]); // slug-collision + resolveUnresolvedLinks user-notes lookups
  mockLink.findMany.mockResolvedValue([]); // reconcileLinks (no wikilinks)
  mockLink.updateMany.mockResolvedValue({ count: 0 });
  // findOrCreateMemoriesDirectory + createNote directory validation both resolve here
  mockDirectory.findFirst.mockResolvedValue({ id: 'memories-dir' });
});

describe('NoteService.upsertMemory', () => {
  test('creates a new published agent-memory when no exact-title match exists', async () => {
    mockNote.findFirst.mockResolvedValue(null); // recall → no match
    mockNote.create.mockResolvedValue({
      id: 'n1',
      slug: 'api-auth-decision',
      excerpt: 'We chose JWT.',
      title: 'API Auth Decision',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
      revisions: [],
    });

    const result = await NoteService.upsertMemory(userId, {
      title: 'API Auth Decision',
      content: 'We chose JWT.',
    });

    expect(result).toEqual({
      id: 'n1',
      slug: 'api-auth-decision',
      action: 'created',
      excerpt: 'We chose JWT.',
    });
    expect(mockNote.create).toHaveBeenCalledTimes(1);
    expect(mockNote.update).not.toHaveBeenCalled();

    const createData = mockNote.create.mock.calls[0][0].data;
    expect(createData.status).toBe('PUBLISHED');
    expect(createData.directoryId).toBe('memories-dir');
    expect(createData.tags.connectOrCreate.map((t) => t.where.name)).toContain('agent-memory');
  });

  test('resolves the existing memory by exact title + agent-memory tag, never by slug', async () => {
    mockNote.findFirst.mockResolvedValue(null);
    mockNote.create.mockResolvedValue({ id: 'n1', slug: 's', excerpt: 'e', tags: [], revisions: [] });

    await NoteService.upsertMemory(userId, { title: 'API Auth Decision', content: 'body' });

    // First findFirst call is the recall query (createNote uses findMany, not findFirst).
    const where = mockNote.findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe(userId);
    expect(where.title).toBe('API Auth Decision');
    expect(where.tags).toEqual({ some: { name: 'agent-memory' } });
    expect(where.slug).toBeUndefined();
  });

  test('append mode (default) appends a timestamped section to the resolved memory', async () => {
    const existing = {
      id: 'n1',
      slug: 'api-auth-decision',
      title: 'API Auth Decision',
      content: 'Original decision body.',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
    };
    // findFirst is hit twice: recall (upsertMemory) and lookup (updateNote).
    mockNote.findFirst.mockResolvedValue(existing);
    mockNote.update.mockResolvedValue({
      id: 'n1',
      slug: 'api-auth-decision',
      excerpt: 'Original decision body.',
      title: 'API Auth Decision',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
      revisions: [],
    });

    const result = await NoteService.upsertMemory(userId, {
      title: 'API Auth Decision',
      content: 'Also rotate keys every 90 days.',
    });

    expect(result).toEqual({
      id: 'n1',
      slug: 'api-auth-decision',
      action: 'updated',
      excerpt: 'Original decision body.',
    });
    expect(mockNote.create).not.toHaveBeenCalled();
    expect(mockNote.update).toHaveBeenCalledTimes(1);

    const updateContent = mockNote.update.mock.calls[0][0].data.content;
    expect(updateContent.startsWith('Original decision body.')).toBe(true);
    expect(updateContent).toContain('Also rotate keys every 90 days.');
    expect(updateContent).toMatch(/## Update \d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  });

  test('replace mode overwrites the resolved memory content exactly', async () => {
    const existing = {
      id: 'n1',
      slug: 'api-auth-decision',
      title: 'API Auth Decision',
      content: 'Stale body.',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
    };
    mockNote.findFirst.mockResolvedValue(existing);
    mockNote.update.mockResolvedValue({
      id: 'n1',
      slug: 'api-auth-decision',
      excerpt: 'Fresh body.',
      title: 'API Auth Decision',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
      revisions: [],
    });

    const result = await NoteService.upsertMemory(userId, {
      title: 'API Auth Decision',
      content: 'Fresh body.',
      mode: 'replace',
    });

    expect(result.action).toBe('updated');
    expect(mockNote.update.mock.calls[0][0].data.content).toBe('Fresh body.');
  });

  test('new mode always creates a fresh note even when a match exists', async () => {
    const existing = {
      id: 'old',
      slug: 'api-auth-decision',
      title: 'API Auth Decision',
      content: 'Old.',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
    };
    mockNote.findFirst.mockResolvedValue(existing);
    mockNote.create.mockResolvedValue({
      id: 'n2',
      slug: 'api-auth-decision-1',
      excerpt: 'New copy.',
      title: 'API Auth Decision',
      status: 'PUBLISHED',
      tags: [{ name: 'agent-memory' }],
      revisions: [],
    });

    const result = await NoteService.upsertMemory(userId, {
      title: 'API Auth Decision',
      content: 'New copy.',
      mode: 'new',
    });

    expect(result).toEqual({
      id: 'n2',
      slug: 'api-auth-decision-1',
      action: 'created',
      excerpt: 'New copy.',
    });
    expect(mockNote.create).toHaveBeenCalledTimes(1);
    expect(mockNote.update).not.toHaveBeenCalled();
    // 'new' short-circuits before recall, so the resolution query never runs.
    // (createNote uses note.findMany for slug collisions, never note.findFirst.)
    expect(mockNote.findFirst).not.toHaveBeenCalled();
  });

  test('always applies the agent-memory tag exactly once', async () => {
    mockNote.findFirst.mockResolvedValue(null);
    mockNote.create.mockResolvedValue({ id: 'n1', slug: 's', excerpt: 'e', tags: [], revisions: [] });

    await NoteService.upsertMemory(userId, {
      title: 'X',
      content: 'y',
      tags: ['agent-memory', 'research'],
    });

    const tagNames = mockNote.create.mock.calls[0][0].data.tags.connectOrCreate.map((t) => t.where.name);
    expect(tagNames.filter((n) => n === 'agent-memory')).toHaveLength(1);
    expect(tagNames).toContain('research');
  });
});
