import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { MAX_GRAPH_NODES, MAX_GRAPH_DEPTH } from '@mycelium/shared';

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
  function decodeCursor(cursor) {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  }

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
    expect(decodeCursor(out.nextCursor)).toEqual({ rank: 0.8, id: 'n2' });
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

  test('uses compound rank and id cursor filter when cursor is provided', async () => {
    mockQueryRaw.mockResolvedValue([]);

    const cursor = Buffer.from(JSON.stringify({ rank: 0.8, id: 'cursor_abc' })).toString('base64url');
    await SearchService.search(userId, 'test', { cursor });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const queryValues = JSON.stringify(mockQueryRaw.mock.calls[0]);
    expect(queryValues).toContain('0.8');
    expect(queryValues).toContain('cursor_abc');
  });

  test('uses DEFAULT_PAGE_LIMIT when no limit provided', async () => {
    // Return 21 items (DEFAULT_PAGE_LIMIT + 1) to trigger hasMore
    const results = Array.from({ length: 21 }, (_, i) => ({
      id: `n${i}`, slug: `s${i}`, title: `T${i}`, excerpt: null, status: 'DRAFT', rank: 1,
    }));
    mockQueryRaw.mockResolvedValue(results);

    const out = await SearchService.search(userId, 'test');

    expect(out.notes).toHaveLength(20);
    expect(decodeCursor(out.nextCursor)).toEqual({ rank: 1, id: 'n19' });
  });
});

// ===========================================================================
// SearchService.getContext — pinned + recency ordering (R4)
// ===========================================================================
describe('SearchService.getContext — ordering', () => {
  test('no-topic branch orders by pinned, recency, then id', async () => {
    const now = new Date('2026-06-29T00:00:00.000Z');
    mockNote.findMany.mockResolvedValue([
      { id: 'n1', slug: 'a', title: 'A', excerpt: null, tags: [{ name: 't' }], updatedAt: now },
    ]);

    const out = await SearchService.getContext(userId, {});

    const arg = mockNote.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }]);
    expect(arg.where).toEqual({ userId, status: { not: 'ARCHIVED' } });
    expect(out[0]).toEqual({
      id: 'n1',
      slug: 'a',
      title: 'A',
      excerpt: null,
      score: null,
      snippet: null,
      tags: ['t'],
      updatedAt: now.toISOString(),
    });
  });

  test('topic branch puts pinned DESC ahead of ts_rank in the ORDER BY', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 'n1', slug: 'a', title: 'A', excerpt: null, updatedAt: new Date('2026-06-29T00:00:00.000Z') },
      ])
      .mockResolvedValueOnce([]); // tag-fetch query

    await SearchService.getContext(userId, { topic: 'alpha' });

    const orderSql = JSON.stringify(mockQueryRaw.mock.calls[0][0]);
    expect(orderSql).toContain('pinned');
    // pinned must be the primary sort key, ahead of ts_rank
    expect(orderSql.indexOf('pinned')).toBeLessThan(orderSql.indexOf('ts_rank'));
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

  /** Validates: R5 — full-graph node cap */
  test('caps full graph to MAX_GRAPH_NODES and flags truncated', async () => {
    const fetched = Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, i) => ({
      id: `n${i}`, slug: `s${i}`, title: `T${i}`, status: 'PUBLISHED',
    }));
    mockNote.findMany.mockResolvedValue(fetched);
    mockLink.findMany.mockResolvedValue([]);

    const graph = await LinkService.getGraph(userId);

    expect(graph.nodes).toHaveLength(MAX_GRAPH_NODES);
    expect(graph.truncated).toBe(true);
  });

  /** Validates: R5 — recency ordering + over-fetch by one */
  test('orders full graph by recency and fetches one over the cap', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await LinkService.getGraph(userId);

    const call = mockNote.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ updatedAt: 'desc' });
    expect(call.take).toBe(MAX_GRAPH_NODES + 1);
  });

  /** Validates: R5 — no truncation under the cap */
  test('does not flag truncated when under the cap', async () => {
    mockNote.findMany.mockResolvedValue([
      { id: 'n1', slug: 'a', title: 'A', status: 'PUBLISHED' },
    ]);
    mockLink.findMany.mockResolvedValue([]);

    const graph = await LinkService.getGraph(userId);

    expect(graph.truncated).toBe(false);
  });

  /** Validates: R5 — dangling edges to capped-out nodes are trimmed */
  test('trims edges dangling to nodes dropped by the cap', async () => {
    const fetched = Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, i) => ({
      id: `n${i}`, slug: `s${i}`, title: `T${i}`, status: 'PUBLISHED',
    }));
    mockNote.findMany.mockResolvedValue(fetched);
    // Edge from the first kept node to the node the cap drops (index MAX_GRAPH_NODES).
    mockLink.findMany.mockResolvedValue([
      { fromId: 'n0', toId: `n${MAX_GRAPH_NODES}`, relation: null },
    ]);

    const graph = await LinkService.getGraph(userId);

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

  /** Validates: R5 — depth above MAX_GRAPH_DEPTH is clamped */
  test('clamps depth above MAX_GRAPH_DEPTH', async () => {
    const start = { id: 'n0', slug: 'a', title: 'A', status: 'PUBLISHED' };
    mockNote.findFirst.mockResolvedValue(start);

    let counter = 0;
    // Out-links query is the one whose `where.fromId` is `{ in: frontier }`.
    // The in-links query passes `where.fromId = { not: undefined }` (no `.in`),
    // so discriminate on `where.fromId?.in` — NOT on `where.fromId` (which is
    // truthy for BOTH queries and would make the in-links branch throw).
    mockLink.findMany.mockImplementation(({ where }) => {
      if (where.fromId?.in) {
        const from = where.fromId.in[0];
        counter += 1;
        return Promise.resolve([{ fromId: from, toId: `n${counter}`, relation: null }]);
      }
      return Promise.resolve([]); // inLinks
    });
    // Neighbor lookup returns the fresh node so BFS would otherwise expand forever.
    mockNote.findMany.mockImplementation(({ where }) => {
      const id = where.id.in[0];
      return Promise.resolve([{ id, slug: id, title: id, status: 'PUBLISHED' }]);
    });

    await LinkService.getGraph(userId, { slug: 'a', depth: 999 });

    // BFS must stop after MAX_GRAPH_DEPTH levels → 2 link.findMany calls per level.
    expect(mockLink.findMany).toHaveBeenCalledTimes(MAX_GRAPH_DEPTH * 2);
  });

  /** Validates: R5 — non-numeric depth coerces to the default of 1 */
  test('coerces non-numeric depth to 1', async () => {
    const start = { id: 'n0', slug: 'a', title: 'A', status: 'PUBLISHED' };
    mockNote.findFirst.mockResolvedValue(start);
    mockLink.findMany.mockResolvedValue([]); // no neighbors → BFS stops after level 1

    await LinkService.getGraph(userId, { slug: 'a', depth: 'not-a-number' });

    // depth coerced to 1 → exactly one BFS level → 2 link.findMany calls (out + in)
    expect(mockLink.findMany).toHaveBeenCalledTimes(2);
  });
});
