import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------
const mockNote = {
  findUnique: mock(() => null),
  findMany: mock(() => []),
  findFirst: mock(() => null),
};
const mockLink = {
  findMany: mock(() => []),
  deleteMany: mock(() => ({ count: 0 })),
  create: mock(() => ({})),
  updateMany: mock(() => ({ count: 0 })),
};

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.link = mockLink;
    }
  },
}));

const { LinkService } = await import('../../src/services/link.service.js');

// ---------------------------------------------------------------------------
// Reset mocks
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockNote.findUnique.mockReset();
  mockNote.findMany.mockReset();
  mockNote.findFirst.mockReset();
  mockLink.findMany.mockReset();
  mockLink.deleteMany.mockReset();
  mockLink.create.mockReset();
  mockLink.updateMany.mockReset();
});

// ---------------------------------------------------------------------------
// reconcileLinks
// ---------------------------------------------------------------------------
describe('LinkService.reconcileLinks', () => {
  test('creates new links for wikilinks not already in the database', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([]); // no existing links
    mockNote.findFirst.mockResolvedValue({ id: 'target_1' }); // target found

    await LinkService.reconcileLinks('note_1', ['Target Note']);

    expect(mockLink.create).toHaveBeenCalledWith({
      data: {
        fromId: 'note_1',
        toId: 'target_1',
        toTitle: null,
      },
    });
  });

  test('creates unresolved link when target note not found', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([]);
    mockNote.findFirst.mockResolvedValue(null); // target not found

    await LinkService.reconcileLinks('note_1', ['Missing Note']);

    expect(mockLink.create).toHaveBeenCalledWith({
      data: {
        fromId: 'note_1',
        toId: null,
        toTitle: 'Missing Note',
      },
    });
  });

  test('removes stale links no longer in content', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([
      { id: 'link_1', toTitle: 'Old Link', toId: null },
    ]);
    mockNote.findMany.mockResolvedValue([]); // no resolved notes to look up

    await LinkService.reconcileLinks('note_1', []); // no wikilinks in content

    expect(mockLink.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['link_1'] } },
    });
  });

  test('does nothing when source note not found', async () => {
    mockNote.findUnique.mockResolvedValue(null);

    await LinkService.reconcileLinks('nonexistent', ['Some Link']);

    expect(mockLink.create).not.toHaveBeenCalled();
    expect(mockLink.deleteMany).not.toHaveBeenCalled();
  });

  test('does not recreate existing links', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([
      { id: 'link_1', toTitle: 'Existing', toId: null },
    ]);
    mockNote.findMany.mockResolvedValue([]); // no resolved IDs to look up

    await LinkService.reconcileLinks('note_1', ['Existing']);

    expect(mockLink.create).not.toHaveBeenCalled();
    expect(mockLink.deleteMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveUnresolvedLinks
// ---------------------------------------------------------------------------
describe('LinkService.resolveUnresolvedLinks', () => {
  test('updates unresolved links matching the title', async () => {
    mockLink.updateMany.mockResolvedValue({ count: 2 });

    await LinkService.resolveUnresolvedLinks('note_new', 'My New Note');

    expect(mockLink.updateMany).toHaveBeenCalledWith({
      where: { toId: null, toTitle: 'My New Note' },
      data: { toId: 'note_new', toTitle: null },
    });
  });
});

// ---------------------------------------------------------------------------
// getBacklinks
// ---------------------------------------------------------------------------
describe('LinkService.getBacklinks', () => {
  test('returns notes that link to the given note', async () => {
    mockLink.findMany.mockResolvedValue([
      { fromId: 'note_a' },
      { fromId: 'note_b' },
    ]);
    mockNote.findMany.mockResolvedValue([
      { id: 'note_a', title: 'Note A', slug: 'note-a', tags: [] },
      { id: 'note_b', title: 'Note B', slug: 'note-b', tags: [] },
    ]);

    const result = await LinkService.getBacklinks('note_target');

    expect(mockLink.findMany).toHaveBeenCalledWith({
      where: { toId: 'note_target' },
      select: { fromId: true },
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('note_a');
    expect(result[1].id).toBe('note_b');
  });

  test('returns empty array when no backlinks exist', async () => {
    mockLink.findMany.mockResolvedValue([]);

    const result = await LinkService.getBacklinks('note_lonely');

    expect(result).toEqual([]);
    expect(mockNote.findMany).not.toHaveBeenCalled();
  });

  test('deduplicates fromIds', async () => {
    mockLink.findMany.mockResolvedValue([
      { fromId: 'note_a' },
      { fromId: 'note_a' }, // duplicate
    ]);
    mockNote.findMany.mockResolvedValue([
      { id: 'note_a', title: 'Note A', slug: 'note-a', tags: [] },
    ]);

    const result = await LinkService.getBacklinks('note_target');

    // Should query with deduplicated IDs
    expect(mockNote.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['note_a'] } },
      include: { tags: true },
    });
    expect(result).toHaveLength(1);
  });
});
