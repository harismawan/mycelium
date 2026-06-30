import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { MAX_LINK_RESULTS } from '@mycelium/shared';

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
  createMany: mock(() => ({ count: 0 })),
  update: mock(() => ({})),
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
  mockLink.createMany.mockReset();
  mockLink.update.mockReset();
  mockLink.updateMany.mockReset();
});

// ---------------------------------------------------------------------------
// reconcileLinks
// ---------------------------------------------------------------------------
describe('LinkService.reconcileLinks', () => {
  test('creates new resolved links with relation, weight, and source', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([]); // no existing wikilink edges
    mockNote.findMany.mockResolvedValue([{ id: 'target_1', title: 'Target Note' }]);

    await LinkService.reconcileLinks('note_1', [
      { title: 'Target Note', relation: null, count: 1 },
    ]);

    expect(mockLink.createMany).toHaveBeenCalledWith({
      data: [
        {
          fromId: 'note_1',
          toId: 'target_1',
          toTitle: null,
          relation: null,
          weight: 1,
          source: 'wikilink',
        },
      ],
    });
  });

  test('scopes the existing-edge lookup to source=wikilink', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([]);
    mockNote.findMany.mockResolvedValue([]);

    await LinkService.reconcileLinks('note_1', []);

    expect(mockLink.findMany).toHaveBeenCalledWith({
      where: { fromId: 'note_1', source: 'wikilink' },
      select: { id: true, toTitle: true, toId: true, relation: true, weight: true },
    });
  });

  test('creates unresolved link when target note not found', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([]);
    mockNote.findMany.mockResolvedValue([]);

    await LinkService.reconcileLinks('note_1', [
      { title: 'Missing Note', relation: null, count: 1 },
    ]);

    expect(mockLink.createMany).toHaveBeenCalledWith({
      data: [
        {
          fromId: 'note_1',
          toId: null,
          toTitle: 'Missing Note',
          relation: null,
          weight: 1,
          source: 'wikilink',
        },
      ],
    });
  });

  test('writes the parsed relation and count-as-weight', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([]);
    mockNote.findMany.mockResolvedValue([{ id: 'target_1', title: 'Target' }]);

    await LinkService.reconcileLinks('note_1', [
      { title: 'Target', relation: 'supports', count: 3 },
    ]);

    const { data } = mockLink.createMany.mock.calls[0][0];
    expect(data[0]).toEqual({
      fromId: 'note_1',
      toId: 'target_1',
      toTitle: null,
      relation: 'supports',
      weight: 3,
      source: 'wikilink',
    });
  });

  test('UPDATE pass: bumps weight when an existing edge count changes', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([
      { id: 'link_1', toTitle: 'Existing', toId: null, relation: null, weight: 1 },
    ]);
    mockNote.findMany.mockResolvedValue([]);

    await LinkService.reconcileLinks('note_1', [
      { title: 'Existing', relation: null, count: 3 },
    ]);

    expect(mockLink.update).toHaveBeenCalledWith({
      where: { id: 'link_1' },
      data: { weight: 3 },
    });
    expect(mockLink.createMany).not.toHaveBeenCalled();
    expect(mockLink.deleteMany).not.toHaveBeenCalled();
  });

  test('does not update when weight is unchanged', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([
      { id: 'link_1', toTitle: 'Existing', toId: null, relation: null, weight: 1 },
    ]);
    mockNote.findMany.mockResolvedValue([]);

    await LinkService.reconcileLinks('note_1', [
      { title: 'Existing', relation: null, count: 1 },
    ]);

    expect(mockLink.update).not.toHaveBeenCalled();
    expect(mockLink.createMany).not.toHaveBeenCalled();
    expect(mockLink.deleteMany).not.toHaveBeenCalled();
  });

  test('removes stale wikilink edges no longer in content', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([
      { id: 'link_1', toTitle: 'Old Link', toId: null, relation: null, weight: 1 },
    ]);
    mockNote.findMany.mockResolvedValue([]);

    await LinkService.reconcileLinks('note_1', []);

    expect(mockLink.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['link_1'] } },
    });
  });

  test('treats a relation change as remove-then-create (distinct keys)', async () => {
    mockNote.findUnique.mockResolvedValue({ userId: 'user_1' });
    mockLink.findMany.mockResolvedValue([
      { id: 'link_1', toTitle: 'X', toId: null, relation: null, weight: 1 },
    ]);
    mockNote.findMany.mockResolvedValue([]);

    await LinkService.reconcileLinks('note_1', [
      { title: 'X', relation: 'supports', count: 1 },
    ]);

    expect(mockLink.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['link_1'] } } });
    const { data } = mockLink.createMany.mock.calls[0][0];
    expect(data[0].relation).toBe('supports');
  });

  test('does nothing when source note not found', async () => {
    mockNote.findUnique.mockResolvedValue(null);

    await LinkService.reconcileLinks('nonexistent', [
      { title: 'Some Link', relation: null, count: 1 },
    ]);

    expect(mockLink.createMany).not.toHaveBeenCalled();
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
      select: { fromId: true, relation: true, weight: true },
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
      orderBy: { updatedAt: 'desc' },
      take: MAX_LINK_RESULTS,
    });
    expect(result).toHaveLength(1);
  });

  /** Validates: R5 — backlinks capped and ordered by recency */
  test('caps backlinks to MAX_LINK_RESULTS ordered by recency', async () => {
    mockLink.findMany.mockResolvedValue([{ fromId: 'note_a' }]);
    mockNote.findMany.mockResolvedValue([
      { id: 'note_a', title: 'A', slug: 'a', tags: [] },
    ]);

    await LinkService.getBacklinks('note_target');

    const call = mockNote.findMany.mock.calls[0][0];
    expect(call.take).toBe(MAX_LINK_RESULTS);
    expect(call.orderBy).toEqual({ updatedAt: 'desc' });
  });
});

// ---------------------------------------------------------------------------
// getOutgoingLinks
// ---------------------------------------------------------------------------
describe('LinkService.getOutgoingLinks', () => {
  /** Validates: R5 — resolved targets capped and ordered by recency */
  test('caps resolved targets to MAX_LINK_RESULTS ordered by recency', async () => {
    mockLink.findMany.mockResolvedValue([{ toId: 'note_x', toTitle: null }]);
    mockNote.findMany.mockResolvedValue([{ id: 'note_x', slug: 'x', title: 'X' }]);

    await LinkService.getOutgoingLinks('note_src');

    const call = mockNote.findMany.mock.calls[0][0];
    expect(call.take).toBe(MAX_LINK_RESULTS);
    expect(call.orderBy).toEqual({ updatedAt: 'desc' });
  });

  /** Validates: R5 — unresolved list capped */
  test('caps unresolved links to MAX_LINK_RESULTS', async () => {
    const links = Array.from({ length: MAX_LINK_RESULTS + 5 }, (_, i) => ({
      toId: null,
      toTitle: `Missing ${i}`,
    }));
    mockLink.findMany.mockResolvedValue(links);

    const result = await LinkService.getOutgoingLinks('note_src');

    expect(result.unresolved).toHaveLength(MAX_LINK_RESULTS);
    expect(result.resolved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// autoLink
// ---------------------------------------------------------------------------
describe('LinkService.autoLink', () => {
  test('creates semantic edges for new targets with weight 1', async () => {
    mockLink.findMany.mockResolvedValue([]); // no existing edges to these targets

    await LinkService.autoLink('note_1', ['t1', 't2'], {
      relation: 'related-to',
      source: 'semantic',
    });

    expect(mockLink.createMany).toHaveBeenCalledWith({
      data: [
        { fromId: 'note_1', toId: 't1', toTitle: null, relation: 'related-to', weight: 1, source: 'semantic' },
        { fromId: 'note_1', toId: 't2', toTitle: null, relation: 'related-to', weight: 1, source: 'semantic' },
      ],
      skipDuplicates: true,
    });
  });

  test('skips targets that already have an edge from this note', async () => {
    mockLink.findMany.mockResolvedValue([{ toId: 't1' }]);

    await LinkService.autoLink('note_1', ['t1', 't2'], {
      relation: 'related-to',
      source: 'semantic',
    });

    const { data } = mockLink.createMany.mock.calls[0][0];
    expect(data).toEqual([
      { fromId: 'note_1', toId: 't2', toTitle: null, relation: 'related-to', weight: 1, source: 'semantic' },
    ]);
  });

  test('excludes self-references and dedupes targets', async () => {
    mockLink.findMany.mockResolvedValue([]);

    await LinkService.autoLink('note_1', ['note_1', 't1', 't1'], {
      relation: 'related-to',
      source: 'semantic',
    });

    const { data } = mockLink.createMany.mock.calls[0][0];
    expect(data).toHaveLength(1);
    expect(data[0].toId).toBe('t1');
  });

  test('is a no-op for empty target lists', async () => {
    await LinkService.autoLink('note_1', [], { relation: 'related-to', source: 'semantic' });
    expect(mockLink.createMany).not.toHaveBeenCalled();
  });
});

describe('LinkService.getOutgoingLinks — relation/weight', () => {
  test('surfaces relation and weight on resolved and unresolved edges', async () => {
    mockLink.findMany.mockResolvedValue([
      { toId: 'n2', toTitle: null, relation: 'supports', weight: 2 },
      { toId: null, toTitle: 'Ghost', relation: 'refines', weight: 1 },
    ]);
    mockNote.findMany.mockResolvedValue([{ id: 'n2', slug: 'beta', title: 'Beta' }]);

    const result = await LinkService.getOutgoingLinks('n1');

    expect(result.resolved).toEqual([
      { id: 'n2', slug: 'beta', title: 'Beta', relation: 'supports', weight: 2 },
    ]);
    expect(result.unresolved).toEqual([
      { title: 'Ghost', relation: 'refines', weight: 1 },
    ]);
  });
});

describe('LinkService.getBacklinks — relation/weight', () => {
  test('attaches the linking edge relation and weight to each source note', async () => {
    mockLink.findMany.mockResolvedValue([{ fromId: 'note_a', relation: 'derived-from', weight: 4 }]);
    mockNote.findMany.mockResolvedValue([
      { id: 'note_a', title: 'Note A', slug: 'note-a', tags: [] },
    ]);

    const result = await LinkService.getBacklinks('note_target');

    expect(result[0].relation).toBe('derived-from');
    expect(result[0].weight).toBe(4);
  });
});
