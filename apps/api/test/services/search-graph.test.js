import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { GRAPH_DECAY, MAX_GRAPH_NODES, MAX_GRAPH_DEPTH, MEMORY_DECAY_RATE } from '@mycelium/shared';

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
const mockExecuteRaw = mock(() => 0);
const mockDirectory = {
  findFirst: mock(() => null),
};

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.link = mockLink;
      this.$queryRaw = mockQueryRaw;
      this.$executeRaw = mockExecuteRaw;
      this.directory = mockDirectory;
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
  mockExecuteRaw.mockReset();
  mockDirectory.findFirst.mockReset();
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

  /** Validates: Requirements 6.4 + R4 (3-key cursor) */
  test('cursor-based pagination — hasMore true', async () => {
    // Return limit+1 items to signal more results
    const results = Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`,
      slug: `note-${i}`,
      title: `Note ${i}`,
      excerpt: null,
      status: 'DRAFT',
      updatedAt: `2026-06-0${i + 1}T00:00:00.000Z`,
      rank: 1 - i * 0.1,
    }));
    mockQueryRaw.mockResolvedValue(results);

    const out = await SearchService.search(userId, 'test', { limit: 3 });

    expect(out.notes).toHaveLength(3);
    expect(out.notes[0]).not.toHaveProperty('updatedAt');
    expect(decodeCursor(out.nextCursor)).toEqual({
      rank: 0.8,
      updatedAt: '2026-06-03T00:00:00.000Z',
      id: 'n2',
    });
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
      id: `n${i}`, slug: `s${i}`, title: `T${i}`, excerpt: null, status: 'DRAFT',
      updatedAt: '2026-06-29T00:00:00.000Z', rank: 1,
    }));
    mockQueryRaw.mockResolvedValue(results);

    const out = await SearchService.search(userId, 'test');

    expect(out.notes).toHaveLength(20);
    expect(decodeCursor(out.nextCursor)).toEqual({
      rank: 1, updatedAt: '2026-06-29T00:00:00.000Z', id: 'n19',
    });
  });

  /** Validates: R4 — keyset carries {rank, updatedAt, id}; no skips/dupes across tied ranks */
  test('pagination keyset carries {rank, updatedAt, id} across tied ranks', async () => {
    const t0 = '2026-06-01T00:00:00.000Z';
    const t1 = '2026-06-02T00:00:00.000Z';
    // limit 2, 3 rows -> hasMore. n0/n1 tie on rank 0.5 but differ on updatedAt,
    // so the tiebreak (updatedAt DESC) decides their order and the cursor boundary.
    const page1 = [
      { id: 'n0', slug: 'a', title: 'A', excerpt: null, status: 'DRAFT', updatedAt: t1, rank: 0.5 },
      { id: 'n1', slug: 'b', title: 'B', excerpt: null, status: 'DRAFT', updatedAt: t0, rank: 0.5 },
      { id: 'n2', slug: 'c', title: 'C', excerpt: null, status: 'DRAFT', updatedAt: t0, rank: 0.4 },
    ];
    mockQueryRaw.mockResolvedValueOnce(page1).mockResolvedValueOnce([page1[2]]);

    const out1 = await SearchService.search(userId, 'tie', { limit: 2 });
    expect(out1.notes).toHaveLength(2);
    // public shape must not leak the ordering-only updatedAt column
    expect(out1.notes[0]).not.toHaveProperty('updatedAt');
    // cursor points at the last returned row (n1) and carries all three keys
    expect(decodeCursor(out1.nextCursor)).toEqual({ rank: 0.5, updatedAt: t0, id: 'n1' });

    // page 2: feed the cursor back; the keyset WHERE must reference rank + updatedAt + id
    const out2 = await SearchService.search(userId, 'tie', { limit: 2, cursor: out1.nextCursor });
    const page2Call = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(page2Call).toContain('0.5'); // rank from cursor
    expect(page2Call).toContain(t0);    // updatedAt from cursor (Date -> ISO when serialized)
    expect(page2Call).toContain('n1');  // id from cursor
    expect(out2.notes[0].id).toBe('n2');
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
    expect(graph.edges[0]).toEqual({ fromId: 'n1', toId: 'n2', relation: 'references', weight: 1 });
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
  /** Validates: Requirements 7.2, 10.1, 10.2 */
  test('returns subgraph with depth=1 annotated with hop and decayed score', async () => {
    const startNote = { id: 'n1', slug: 'center', title: 'Center', status: 'PUBLISHED' };
    const neighborNote = { id: 'n2', slug: 'neighbor', title: 'Neighbor', status: 'DRAFT' };
    const edgeCreatedAt = new Date('2026-01-01T00:00:00.000Z');

    mockNote.findFirst.mockResolvedValue(startNote);

    mockLink.findMany
      .mockResolvedValueOnce([
        { fromId: 'n1', toId: 'n2', relation: null, weight: 1, createdAt: edgeCreatedAt },
      ]) // outLinks
      .mockResolvedValueOnce([]); // inLinks

    mockNote.findMany.mockResolvedValue([neighborNote]);

    const graph = await LinkService.getGraph(userId, { slug: 'center', depth: 1 });

    expect(graph.nodes).toHaveLength(2);
    const center = graph.nodes.find((n) => n.id === 'n1');
    const neighbor = graph.nodes.find((n) => n.id === 'n2');
    expect(center.hop).toBe(0);
    expect(neighbor.hop).toBe(1);
    // score = weight(1) * GRAPH_DECAY ** hop(1)
    expect(neighbor.score).toBeCloseTo(GRAPH_DECAY ** 1);
    // the ego center always ranks first
    expect(graph.nodes[0].id).toBe('n1');
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({
      fromId: 'n1',
      toId: 'n2',
      relation: null,
      weight: 1,
      createdAt: edgeCreatedAt,
    });
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

  /** Validates: R7.5 — ego dedup key is `fromId->toId::relation`, not `fromId->toId` */
  test('dedup key includes relation — same pair with distinct relations produces two edges', async () => {
    const startNote = { id: 'n1', slug: 'center', title: 'Center', status: 'PUBLISHED' };
    const neighborNote = { id: 'n2', slug: 'neighbor', title: 'Neighbor', status: 'DRAFT' };

    mockNote.findFirst.mockResolvedValue(startNote);

    // Two links between the same pair (n1 → n2) but with different relations.
    // Under the old dedup key (`${fromId}->${toId}`) the second would be collapsed
    // into the first, leaving only 1 edge.  The current key (`…::${relation}`)
    // must preserve both.
    mockLink.findMany
      .mockResolvedValueOnce([
        { fromId: 'n1', toId: 'n2', relation: 'supports', weight: 1 },
        { fromId: 'n1', toId: 'n2', relation: 'refines', weight: 2 },
      ])  // outLinks
      .mockResolvedValueOnce([]);  // inLinks (none)

    mockNote.findMany.mockResolvedValue([neighborNote]);

    const graph = await LinkService.getGraph(userId, { slug: 'center', depth: 1 });

    expect(graph.edges).toHaveLength(2);
    const relations = graph.edges.map((e) => e.relation);
    expect(relations).toContain('supports');
    expect(relations).toContain('refines');
  });
});

// ===========================================================================
// SearchService.getContext — metadata surface + importance ranking
// ===========================================================================
describe('SearchService.getContext metadata', () => {
  test('topic path: surfaces metadata and applies importance-weighted ORDER BY', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          id: 'n1', slug: 'alpha', title: 'Alpha', excerpt: 'ex',
          source: 'session:1', confidence: 0.9, importance: 4,
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([]); // tag lookup ($queryRaw is called a second time)

    const out = await SearchService.getContext(userId, { topic: 'alpha', limit: 5 });

    expect(out[0]).toMatchObject({
      id: 'n1', source: 'session:1', confidence: 0.9, importance: 4,
    });

    // calls[0][0] = raw template strings (real quotes); calls[0].slice(1) = bound values.
    const call = mockQueryRaw.mock.calls[0];
    const rawSql = call[0].join('');
    expect(rawSql).toContain('n."source"');                 // metadata columns selected
    expect(rawSql).toContain('COALESCE(n."importance", 0)'); // importance-weighted ranking
    expect(call.slice(1)).toContain(0.15);                  // IMPORTANCE_BOOST bound as a parameter
  });

  test('no-topic path: surfaces metadata from findMany', async () => {
    mockNote.findMany.mockResolvedValue([
      {
        id: 'n2', slug: 'beta', title: 'Beta', excerpt: null,
        source: null, confidence: null, importance: 2,
        tags: [{ name: 'x' }], updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    const out = await SearchService.getContext(userId, { limit: 5 });

    expect(out[0]).toMatchObject({
      id: 'n2', source: null, confidence: null, importance: 2, tags: ['x'],
    });
  });
});

// ===========================================================================
// LinkService._expandNeighbors — multi-seed co-citation BFS (R9)
// ===========================================================================
describe('LinkService._expandNeighbors', () => {
  /** Validates: Requirements 9.1 */
  test('counts distinct seeds each neighbor links to (outgoing)', async () => {
    // s1 -> c1, s2 -> c1, s1 -> c2  (c1 co-cited by both seeds)
    mockLink.findMany
      .mockResolvedValueOnce([
        { fromId: 's1', toId: 'c1' },
        { fromId: 's2', toId: 'c1' },
        { fromId: 's1', toId: 'c2' },
      ]) // outLinks for frontier [s1, s2]
      .mockResolvedValueOnce([]); // inLinks

    mockNote.findMany.mockResolvedValue([
      { id: 'c1', slug: 'c1', title: 'C1', excerpt: null, updatedAt: new Date('2026-01-02') },
      { id: 'c2', slug: 'c2', title: 'C2', excerpt: 'ex', updatedAt: new Date('2026-01-01') },
    ]);

    const out = await LinkService._expandNeighbors('user_1', ['s1', 's2'], 1);

    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    expect(out).toHaveLength(2);
    expect(byId.c1.seedLinks).toBe(2);
    expect(byId.c2.seedLinks).toBe(1);
    // full getContext field set carried through
    expect(byId.c1).toMatchObject({ id: 'c1', slug: 'c1', title: 'C1', excerpt: null });
  });

  /** Validates: Requirements 9.1 */
  test('counts incoming links to seeds as co-citations', async () => {
    // c1 -> s1 (incoming to the seed frontier)
    mockLink.findMany
      .mockResolvedValueOnce([]) // outLinks
      .mockResolvedValueOnce([{ fromId: 'c1', toId: 's1' }]); // inLinks

    mockNote.findMany.mockResolvedValue([
      { id: 'c1', slug: 'c1', title: 'C1', excerpt: null, updatedAt: new Date('2026-01-02') },
    ]);

    const out = await LinkService._expandNeighbors('user_1', ['s1', 's2'], 1);

    expect(out).toHaveLength(1);
    expect(out[0].seedLinks).toBe(1);
  });

  test('returns empty array for no seeds without touching the database', async () => {
    const out = await LinkService._expandNeighbors('user_1', [], 1);
    expect(out).toEqual([]);
    expect(mockLink.findMany).not.toHaveBeenCalled();
    expect(mockNote.findMany).not.toHaveBeenCalled();
  });

  /** Validates: Requirements 9.2 */
  test('excludes ARCHIVED neighbors (filtered by note.findMany)', async () => {
    mockLink.findMany
      .mockResolvedValueOnce([{ fromId: 's1', toId: 'c1' }])
      .mockResolvedValueOnce([]);
    // c1 is ARCHIVED, so the status-filtered findMany returns nothing
    mockNote.findMany.mockResolvedValue([]);

    const out = await LinkService._expandNeighbors('user_1', ['s1'], 1);

    expect(out).toEqual([]);
    const noteWhere = mockNote.findMany.mock.calls[0][0].where;
    expect(noteWhere.status).toEqual({ not: 'ARCHIVED' });
    expect(noteWhere.userId).toBe('user_1');
  });

  test('depth=1 issues exactly one BFS level (out + in)', async () => {
    mockLink.findMany
      .mockResolvedValueOnce([{ fromId: 's1', toId: 'c1' }])
      .mockResolvedValueOnce([]);
    mockNote.findMany.mockResolvedValue([
      { id: 'c1', slug: 'c1', title: 'C1', excerpt: null, updatedAt: new Date() },
    ]);

    await LinkService._expandNeighbors('user_1', ['s1'], 1);

    expect(mockLink.findMany).toHaveBeenCalledTimes(2); // out + in, one level only
  });

  /** Validates: Requirements 9.1 — Set idempotency for duplicate links */
  test('same seed linking a candidate twice counts that seed once', async () => {
    // s1 -> c1 appears twice in the link table; seedLinks must be 1 (Set dedup)
    mockLink.findMany
      .mockResolvedValueOnce([
        { fromId: 's1', toId: 'c1' },
        { fromId: 's1', toId: 'c1' },
      ]) // outLinks
      .mockResolvedValueOnce([]); // inLinks

    mockNote.findMany.mockResolvedValue([
      { id: 'c1', slug: 'c1', title: 'C1', excerpt: null, updatedAt: new Date('2026-01-01') },
    ]);

    const out = await LinkService._expandNeighbors('user_1', ['s1'], 1);

    expect(out).toHaveLength(1);
    expect(out[0].seedLinks).toBe(1);
  });

  /** Validates: Requirements 9.1 — multi-hop BFS */
  test('depth=2 traverses a second hop', async () => {
    // s1 -> c1 (hop 1), c1 -> c2 (hop 2)
    mockLink.findMany
      .mockResolvedValueOnce([{ fromId: 's1', toId: 'c1' }]) // outLinks level 1
      .mockResolvedValueOnce([])                               // inLinks  level 1
      .mockResolvedValueOnce([{ fromId: 'c1', toId: 'c2' }]) // outLinks level 2
      .mockResolvedValueOnce([]);                              // inLinks  level 2

    mockNote.findMany
      .mockResolvedValueOnce([
        { id: 'c1', slug: 'c1', title: 'C1', excerpt: null, updatedAt: new Date('2026-01-01') },
      ]) // neighbors found at hop 1
      .mockResolvedValueOnce([
        { id: 'c2', slug: 'c2', title: 'C2', excerpt: null, updatedAt: new Date('2026-01-02') },
      ]); // neighbors found at hop 2

    const out = await LinkService._expandNeighbors('user_1', ['s1'], 2);

    const ids = out.map((n) => n.id);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
    expect(mockLink.findMany).toHaveBeenCalledTimes(4); // 2 levels × {out, in}
  });

  /** Validates: Requirements 9.1 — MAX_GRAPH_NODES cap */
  test('caps returned candidates at MAX_GRAPH_NODES, highest seedLinks first', async () => {
    const over = MAX_GRAPH_NODES + 1;
    // Generate over candidates: c0..cN, all linked from s1
    const outLinks = Array.from({ length: over }, (_, i) => ({ fromId: 's1', toId: `c${i}` }));
    mockLink.findMany
      .mockResolvedValueOnce(outLinks) // outLinks
      .mockResolvedValueOnce([]);      // inLinks

    const notes = Array.from({ length: over }, (_, i) => ({
      id: `c${i}`,
      slug: `c${i}`,
      title: `C${i}`,
      excerpt: null,
      updatedAt: new Date('2026-01-01'),
    }));
    mockNote.findMany.mockResolvedValue(notes);

    const out = await LinkService._expandNeighbors('user_1', ['s1'], 1);

    expect(out.length).toBe(MAX_GRAPH_NODES);
    // All returned items should have seedLinks >= those not returned (trivially 1 here)
    expect(out.every((n) => n.seedLinks === 1)).toBe(true);
  });
});

// ===========================================================================
// SearchService.getContext — graph-aware expansion (R9)
// ===========================================================================
describe('SearchService.getContext — expand', () => {
  /** Validates: Requirements 9.3 */
  test('expand=false returns the flat lexical array unchanged (no rank, no expansion)', async () => {
    const date = new Date('2026-01-05');
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 's1', slug: 's1', title: 'S1', excerpt: 'ex1', updatedAt: date, rank: 0.9 },
      ]) // seed query
      .mockResolvedValueOnce([{ noteId: 's1', name: 'tag-a' }]); // tag hydration

    const out = await SearchService.getContext(userId, { topic: 'hello', limit: 10 });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 's1',
      slug: 's1',
      title: 'S1',
      excerpt: 'ex1',
      tags: ['tag-a'],
      updatedAt: date.toISOString(),
    });
    expect(out[0]).not.toHaveProperty('rank');
    // No graph traversal on the flat path
    expect(mockLink.findMany).not.toHaveBeenCalled();
  });

  /** Validates: Requirements 9.1, 9.2 */
  test('expand=true surfaces a co-cited neighbor above a weak seed', async () => {
    const date = new Date('2026-01-05');
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 's1', slug: 's1', title: 'S1', excerpt: null, updatedAt: date, rank: 0.9 },
        { id: 's2', slug: 's2', title: 'S2', excerpt: null, updatedAt: date, rank: 0.1 },
      ]) // seed query
      .mockResolvedValueOnce([]); // tag hydration

    // c1 linked from both seeds -> seedLinks = 2 -> boost = 0.3 * (2/2) = 0.3
    mockLink.findMany
      .mockResolvedValueOnce([
        { fromId: 's1', toId: 'c1' },
        { fromId: 's2', toId: 'c1' },
      ]) // outLinks
      .mockResolvedValueOnce([]); // inLinks
    mockNote.findMany.mockResolvedValue([
      { id: 'c1', slug: 'c1', title: 'C1', excerpt: null, updatedAt: date },
    ]);

    const out = await SearchService.getContext(userId, {
      topic: 'hello',
      limit: 10,
      expand: true,
      expandDepth: 1,
    });

    // scores: s1=1.0 (norm), c1=0.3 (graph), s2=0.0 (norm) -> c1 beats s2
    expect(out.map((n) => n.id)).toEqual(['s1', 'c1', 's2']);
    // shape is identical to the flat path (no score/seedLinks leak)
    expect(out[1]).toEqual({
      id: 'c1',
      slug: 'c1',
      title: 'C1',
      excerpt: null,
      tags: [],
      updatedAt: date.toISOString(),
    });
  });

  test('expand=true trims to limit after re-ranking', async () => {
    const date = new Date('2026-01-05');
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 's1', slug: 's1', title: 'S1', excerpt: null, updatedAt: date, rank: 0.9 },
        { id: 's2', slug: 's2', title: 'S2', excerpt: null, updatedAt: date, rank: 0.1 },
      ])
      .mockResolvedValueOnce([]);
    mockLink.findMany
      .mockResolvedValueOnce([
        { fromId: 's1', toId: 'c1' },
        { fromId: 's2', toId: 'c1' },
      ])
      .mockResolvedValueOnce([]);
    mockNote.findMany.mockResolvedValue([
      { id: 'c1', slug: 'c1', title: 'C1', excerpt: null, updatedAt: date },
    ]);

    const out = await SearchService.getContext(userId, {
      topic: 'hello',
      limit: 2,
      expand: true,
    });

    // s1 (1.0), c1 (0.3) kept; weak seed s2 (0.0) trimmed
    expect(out.map((n) => n.id)).toEqual(['s1', 'c1']);
  });

  test('expand=true with no seed matches returns empty array without expanding', async () => {
    mockQueryRaw.mockResolvedValueOnce([]); // no seeds
    const out = await SearchService.getContext(userId, { topic: 'nope', expand: true });
    expect(out).toEqual([]);
    expect(mockLink.findMany).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// SearchService.getContext — namespace filter (R11.3)
// ===========================================================================
describe('SearchService.getContext — namespace filter', () => {
  test('filters the no-topic branch to the memories/<apiKeyId> subtree', async () => {
    mockDirectory.findFirst
      .mockResolvedValueOnce({ id: 'mem-root' })   // memories root
      .mockResolvedValueOnce({ id: 'ns-key-A' });  // memories/key-A
    mockNote.findMany.mockResolvedValue([]);

    await SearchService.getContext(userId, { namespace: 'key-A' });

    const where = mockNote.findMany.mock.calls[0][0].where;
    expect(where.directoryId).toBe('ns-key-A');
  });

  test('returns [] without querying notes when the namespace dir is absent', async () => {
    mockDirectory.findFirst.mockResolvedValue(null); // no memories root

    const res = await SearchService.getContext(userId, { namespace: 'key-A' });

    expect(res).toEqual([]);
    expect(mockNote.findMany).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// LinkService.getGraph — ego-subgraph ranking, decay, direction & cap (R10)
// ===========================================================================
describe('LinkService.getGraph — ego ranking & decay (R10)', () => {
  /** Validates: Requirements 10.1, 10.2 */
  test('accumulates score across multiple paths and assigns deeper hops', async () => {
    const n1 = { id: 'n1', slug: 'a', title: 'A', status: 'PUBLISHED' };
    const n2 = { id: 'n2', slug: 'b', title: 'B', status: 'PUBLISHED' };
    const n3 = { id: 'n3', slug: 'c', title: 'C', status: 'PUBLISHED' };
    const n4 = { id: 'n4', slug: 'd', title: 'D', status: 'PUBLISHED' };
    const at = new Date('2026-02-02T00:00:00.000Z');

    mockNote.findFirst.mockResolvedValue(n1);

    mockLink.findMany
      // level 0 (frontier [n1]): out, in
      .mockResolvedValueOnce([
        { fromId: 'n1', toId: 'n2', relation: null, weight: 1, createdAt: at },
        { fromId: 'n1', toId: 'n3', relation: null, weight: 1, createdAt: at },
      ])
      .mockResolvedValueOnce([])
      // level 1 (frontier [n2, n3]): out, in
      .mockResolvedValueOnce([
        { fromId: 'n2', toId: 'n4', relation: null, weight: 1, createdAt: at },
        { fromId: 'n3', toId: 'n4', relation: null, weight: 1, createdAt: at },
      ])
      .mockResolvedValueOnce([]);

    mockNote.findMany
      .mockResolvedValueOnce([n2, n3]) // level 0 neighbors
      .mockResolvedValueOnce([n4]); // level 1 neighbors

    const graph = await LinkService.getGraph(userId, { slug: 'a', depth: 2 });

    const node4 = graph.nodes.find((n) => n.id === 'n4');
    expect(node4.hop).toBe(2);
    // two paths (n2->n4 and n3->n4), each contributing weight(1) * GRAPH_DECAY ** 2
    expect(node4.score).toBeCloseTo(2 * GRAPH_DECAY ** 2);
  });

  /** Validates: Requirements 10.3 */
  test('direction "out" follows only outgoing edges (single link query per level)', async () => {
    const n1 = { id: 'n1', slug: 'a', title: 'A', status: 'PUBLISHED' };
    const n2 = { id: 'n2', slug: 'b', title: 'B', status: 'PUBLISHED' };
    const at = new Date('2026-03-03T00:00:00.000Z');

    mockNote.findFirst.mockResolvedValue(n1);
    // Only the outgoing query runs; the incoming side resolves to [] without hitting the mock.
    mockLink.findMany.mockResolvedValueOnce([
      { fromId: 'n1', toId: 'n2', relation: null, weight: 1, createdAt: at },
    ]);
    mockNote.findMany.mockResolvedValue([n2]);

    const graph = await LinkService.getGraph(userId, { slug: 'a', depth: 1, direction: 'out' });

    expect(mockLink.findMany).toHaveBeenCalledTimes(1);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
  });

  /** Validates: Requirements 10.1 (+ R5 node cap / truncated) */
  test('ranks by score and trims to MAX_GRAPH_NODES while keeping the ego center', async () => {
    const center = { id: 'n0', slug: 'center', title: 'Center', status: 'PUBLISHED' };
    const at = new Date('2026-04-04T00:00:00.000Z');

    // MAX_GRAPH_NODES + 1 distinct one-hop neighbors → the cap must drop some.
    const neighbors = Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, i) => ({
      id: `m${i}`,
      slug: `m-${i}`,
      title: `M${i}`,
      status: 'PUBLISHED',
    }));
    const outLinks = neighbors.map((m) => ({
      fromId: 'n0',
      toId: m.id,
      relation: null,
      weight: 1,
      createdAt: at,
    }));

    mockNote.findFirst.mockResolvedValue(center);
    mockLink.findMany
      .mockResolvedValueOnce(outLinks) // outLinks
      .mockResolvedValueOnce([]); // inLinks
    mockNote.findMany.mockResolvedValue(neighbors);

    const graph = await LinkService.getGraph(userId, { slug: 'center', depth: 1 });

    expect(graph.nodes).toHaveLength(MAX_GRAPH_NODES);
    expect(graph.truncated).toBe(true);
    // ego center is always retained even though many neighbors tie on score
    expect(graph.nodes.some((n) => n.id === 'n0')).toBe(true);
    // no dangling edges: every surviving edge connects two retained nodes
    const keptIds = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(keptIds.has(e.fromId)).toBe(true);
      expect(keptIds.has(e.toId)).toBe(true);
    }
    // center + (MAX-1) neighbors kept ⇒ MAX-1 surviving edges
    expect(graph.edges).toHaveLength(MAX_GRAPH_NODES - 1);
  });
});

// ===========================================================================
// SearchService.getContext — write-on-read salience (R14.3)
// ===========================================================================
describe('SearchService.getContext — write-on-read salience', () => {
  /** Validates: R14.3 — bump recency via raw UPDATE, never via prisma.note.update */
  test('issues a raw UPDATE of lastAccessedAt/accessCount that never touches updatedAt', async () => {
    mockNote.findMany.mockResolvedValue([
      { id: 'n1', slug: 's1', title: 'A', excerpt: null, source: null, confidence: null, importance: null, tags: [], updatedAt: new Date('2026-01-01') },
      { id: 'n2', slug: 's2', title: 'B', excerpt: null, source: null, confidence: null, importance: null, tags: [], updatedAt: new Date('2026-01-02') },
    ]);

    await SearchService.getContext(userId, { limit: 10 });

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const [strings] = mockExecuteRaw.mock.calls[0];
    const sql = strings.join(' ');
    expect(sql).toContain('UPDATE "Note"');
    expect(sql).toContain('"lastAccessedAt" = now()');
    expect(sql).toContain('"accessCount" = "accessCount" + 1');
    // Critical: must NOT bump @updatedAt
    expect(sql).not.toContain('"updatedAt"');
  });

  test('does not issue an UPDATE when no notes are returned', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await SearchService.getContext(userId, { limit: 10 });

    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('topic path: issues a raw UPDATE for the returned note ids', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 'n3', slug: 's3', title: 'C', excerpt: null, source: null, confidence: null, importance: null, updatedAt: new Date('2026-01-03'), score: 0.8, snippet: null },
      ])
      .mockResolvedValueOnce([]); // tag lookup

    await SearchService.getContext(userId, { topic: 'test', limit: 5 });

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const [strings] = mockExecuteRaw.mock.calls[0];
    const sql = strings.join(' ');
    expect(sql).toContain('UPDATE "Note"');
    expect(sql).toContain('"lastAccessedAt" = now()');
    expect(sql).toContain('"accessCount" = "accessCount" + 1');
    expect(sql).not.toContain('"updatedAt"');
  });

  test('getContext still returns results even if the salience bump rejects', async () => {
    mockNote.findMany.mockResolvedValue([
      { id: 'n1', slug: 's1', title: 'A', excerpt: null, source: null, confidence: null, importance: null, tags: [], updatedAt: new Date('2026-01-01') },
    ]);
    mockExecuteRaw.mockRejectedValue(new Error('DB unavailable'));

    const result = await SearchService.getContext(userId, { limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
  });
});

// ===========================================================================
// SearchService.getContext — decay-weighted topic recall (R14.4)
// ===========================================================================
describe('SearchService.getContext — decay-weighted topic recall', () => {
  /** Validates: R14.4 — decay term on COALESCE(lastAccessedAt, createdAt) */
  test('ORDER BY multiplies ts_rank by exp-decay on last-access recency', async () => {
    // Empty results from the primary query trigger the fuzzy fallback (second call).
    // We only assert the shape of the primary ranking query (calls[0]).
    mockQueryRaw.mockResolvedValue([]);

    await SearchService.getContext(userId, { topic: 'kubernetes', limit: 5 });

    expect(mockQueryRaw).toHaveBeenCalledTimes(2); // primary + fuzzy fallback
    const [strings, ...values] = mockQueryRaw.mock.calls[0];
    const sql = strings.join('');
    expect(sql).toContain('ts_rank(n."searchVector"');
    expect(sql).toContain('exp(');
    expect(sql).toContain('COALESCE(n."lastAccessedAt", n."createdAt")');
    // negative rate is interpolated as a bound parameter
    expect(values).toContain(-MEMORY_DECAY_RATE);
    // recency, not updatedAt, is the tiebreak
    expect(sql).toContain('ORDER BY');
    expect(sql).not.toMatch(/ORDER BY[\s\S]*n\."updatedAt" DESC/);
  });
});
