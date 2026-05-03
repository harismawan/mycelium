import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — must happen before any import that touches Prisma
// ---------------------------------------------------------------------------
const mockNote = {
  findMany: mock(() => []),
  findFirst: mock(() => null),
};
const mockLink = {
  findMany: mock(() => []),
};
const mockQueryRaw = mock(() => []);

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.link = mockLink;
      this.$queryRaw = mockQueryRaw;
    }
  },
  Prisma: {
    sql: (strings, ...values) => ({ strings, values, type: 'sql' }),
    join: (items, sep) => ({ items, sep, type: 'join' }),
    empty: { type: 'empty' },
  },
}));

// ---------------------------------------------------------------------------
// Import services AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { SearchService } = await import('../../src/services/search.service.js');
const { LinkService } = await import('../../src/services/link.service.js');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const userId = 'user_1';

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockNote.findMany.mockReset();
  mockNote.findFirst.mockReset();
  mockLink.findMany.mockReset();
  mockQueryRaw.mockReset();
});

// ===========================================================================
// SearchService
// ===========================================================================
describe('SearchService.search', () => {
  /** Validates: Requirements 6.2 */
  test('returns ranked search results from $queryRaw', async () => {
    const results = [
      { id: 'n1', slug: 'alpha', title: 'Alpha', excerpt: 'ex1', status: 'PUBLISHED', rank: 0.9 },
      { id: 'n2', slug: 'beta', title: 'Beta', excerpt: 'ex2', status: 'DRAFT', rank: 0.5 },
    ];
    mockQueryRaw.mockResolvedValue(results);

    const out = await SearchService.search(userId, 'test query');

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(out.notes).toHaveLength(2);
    expect(out.notes[0].rank).toBe(0.9);
    expect(out.notes[1].rank).toBe(0.5);
    expect(out.nextCursor).toBeNull();
  });

  /** Validates: Requirements 6.3 */
  test('applies status filter', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await SearchService.search(userId, 'hello', { status: 'PUBLISHED' });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  /** Validates: Requirements 6.3 */
  test('applies tag filter', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await SearchService.search(userId, 'hello', { tag: 'javascript' });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  /** Validates: Requirements 6.4 */
  test('cursor-based pagination — hasMore true', async () => {
    // Return limit+1 items to signal more results
    const results = Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`,
      slug: `note-${i}`,
      title: `Note ${i}`,
      excerpt: null,
      status: 'DRAFT',
      rank: 1 - i * 0.1,
    }));
    mockQueryRaw.mockResolvedValue(results);

    const out = await SearchService.search(userId, 'test', { limit: 3 });

    expect(out.notes).toHaveLength(3);
    expect(out.nextCursor).toBe('n2');
  });

  /** Validates: Requirements 6.4 */
  test('cursor-based pagination — hasMore false', async () => {
    const results = [
      { id: 'n1', slug: 'a', title: 'A', excerpt: null, status: 'DRAFT', rank: 0.8 },
    ];
    mockQueryRaw.mockResolvedValue(results);

    const out = await SearchService.search(userId, 'test', { limit: 5 });

    expect(out.notes).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });

  test('passes cursor filter when cursor is provided', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await SearchService.search(userId, 'test', { cursor: 'cursor_abc' });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  test('uses DEFAULT_PAGE_LIMIT when no limit provided', async () => {
    // Return 21 items (DEFAULT_PAGE_LIMIT + 1) to trigger hasMore
    const results = Array.from({ length: 21 }, (_, i) => ({
      id: `n${i}`, slug: `s${i}`, title: `T${i}`, excerpt: null, status: 'DRAFT', rank: 1,
    }));
    mockQueryRaw.mockResolvedValue(results);

    const out = await SearchService.search(userId, 'test');

    expect(out.notes).toHaveLength(20);
    expect(out.nextCursor).toBe('n19');
  });
});

// ===========================================================================
// LinkService.getGraph — full graph
// ===========================================================================
describe('LinkService.getGraph — full graph', () => {
  /** Validates: Requirements 7.1 */
  test('returns correct nodes and edges structure', async () => {
    const notes = [
      { id: 'n1', slug: 'alpha', title: 'Alpha', status: 'PUBLISHED' },
      { id: 'n2', slug: 'beta', title: 'Beta', status: 'DRAFT' },
    ];
    const links = [
      { fromId: 'n1', toId: 'n2', relation: 'references' },
    ];
    mockNote.findMany.mockResolvedValue(notes);
    mockLink.findMany.mockResolvedValue(links);

    const graph = await LinkService.getGraph(userId);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toEqual({ id: 'n1', slug: 'alpha', title: 'Alpha', status: 'PUBLISHED' });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ fromId: 'n1', toId: 'n2', relation: 'references' });
  });

  /** Validates: Requirements 7.3 */
  test('excludes ARCHIVED notes', async () => {
    mockNote.findMany.mockResolvedValue([]);
    mockLink.findMany.mockResolvedValue([]);

    await LinkService.getGraph(userId);

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.where.status).toEqual({ not: 'ARCHIVED' });
  });

  test('returns empty graph when no notes exist', async () => {
    mockNote.findMany.mockResolvedValue([]);

    const graph = await LinkService.getGraph(userId);

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    // link.findMany should not be called when there are no notes
    expect(mockLink.findMany).not.toHaveBeenCalled();
  });

  test('filters edges to only include nodes in the graph', async () => {
    const notes = [
      { id: 'n1', slug: 'a', title: 'A', status: 'PUBLISHED' },
    ];
    // Link points to a note not in the graph (e.g. archived)
    const links = [
      { fromId: 'n1', toId: 'n_archived', relation: null },
    ];
    mockNote.findMany.mockResolvedValue(notes);
    mockLink.findMany.mockResolvedValue(links);

    const graph = await LinkService.getGraph(userId);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });
});

// ===========================================================================
// LinkService.getGraph — ego-subgraph
// ===========================================================================
describe('LinkService.getGraph — ego-subgraph', () => {
  /** Validates: Requirements 7.2 */
  test('returns subgraph with depth=1', async () => {
    const startNote = { id: 'n1', slug: 'center', title: 'Center', status: 'PUBLISHED' };
    const neighborNote = { id: 'n2', slug: 'neighbor', title: 'Neighbor', status: 'DRAFT' };

    // findFirst returns the start note
    mockNote.findFirst.mockResolvedValue(startNote);

    // BFS depth 1: outgoing links from n1
    mockLink.findMany
      .mockResolvedValueOnce([{ fromId: 'n1', toId: 'n2', relation: null }])  // outLinks
      .mockResolvedValueOnce([]);  // inLinks

    // Neighbor notes fetched
    mockNote.findMany.mockResolvedValue([neighborNote]);

    const graph = await LinkService.getGraph(userId, { slug: 'center', depth: 1 });

    expect(graph.nodes).toHaveLength(2);
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain('n1');
    expect(nodeIds).toContain('n2');
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ fromId: 'n1', toId: 'n2', relation: null });
  });

  test('returns empty graph when start note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    const graph = await LinkService.getGraph(userId, { slug: 'nonexistent', depth: 1 });

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  test('depth limiting stops BFS expansion', async () => {
    const n1 = { id: 'n1', slug: 'a', title: 'A', status: 'PUBLISHED' };
    const n2 = { id: 'n2', slug: 'b', title: 'B', status: 'DRAFT' };

    mockNote.findFirst.mockResolvedValue(n1);

    // Depth 1: n1 -> n2
    mockLink.findMany
      .mockResolvedValueOnce([{ fromId: 'n1', toId: 'n2', relation: null }])  // outLinks
      .mockResolvedValueOnce([]);  // inLinks

    mockNote.findMany.mockResolvedValue([n2]);

    // With depth=1, BFS should stop after one level — n3 should NOT be reached
    const graph = await LinkService.getGraph(userId, { slug: 'a', depth: 1 });

    expect(graph.nodes).toHaveLength(2);
    // link.findMany should only be called for the first frontier (2 calls: out + in)
    expect(mockLink.findMany).toHaveBeenCalledTimes(2);
  });

  test('defaults depth to 1 when not specified', async () => {
    const n1 = { id: 'n1', slug: 'a', title: 'A', status: 'PUBLISHED' };
    mockNote.findFirst.mockResolvedValue(n1);
    mockLink.findMany.mockResolvedValue([]);

    const graph = await LinkService.getGraph(userId, { slug: 'a' });

    // Only the start node, no expansion beyond depth 1
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe('n1');
  });

  /** Validates: Requirements 7.3 */
  test('excludes ARCHIVED notes from ego-subgraph', async () => {
    const n1 = { id: 'n1', slug: 'a', title: 'A', status: 'PUBLISHED' };
    mockNote.findFirst.mockResolvedValue(n1);

    // n1 links to n2 (which is archived and won't be returned by findMany)
    mockLink.findMany
      .mockResolvedValueOnce([{ fromId: 'n1', toId: 'n2', relation: null }])
      .mockResolvedValueOnce([]);

    // findMany returns empty because n2 is ARCHIVED (filtered by status != ARCHIVED)
    mockNote.findMany.mockResolvedValue([]);

    const graph = await LinkService.getGraph(userId, { slug: 'a', depth: 1 });

    // Only the start node
    expect(graph.nodes).toHaveLength(1);
    // Edge to archived note should be filtered out
    expect(graph.edges).toHaveLength(0);
  });
});
