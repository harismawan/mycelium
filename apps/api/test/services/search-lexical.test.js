import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — must happen before any import that touches Prisma
// ---------------------------------------------------------------------------
const mockNote = {
  findMany: mock(() => []),
  findFirst: mock(() => null),
};
const mockQueryRaw = mock(() => []);

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.$queryRaw = mockQueryRaw;
    }
  },
  Prisma: {
    sql: (strings, ...values) => ({ strings, values, type: 'sql' }),
    join: (items, sep) => ({ items, sep, type: 'join' }),
    empty: { type: 'empty' },
  },
}));

const mockEmbedText = mock(async () => null);
mock.module('../../src/services/embedding.service.js', () => ({ embedText: mockEmbedText }));

// ---------------------------------------------------------------------------
// Import service AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { SearchService } = await import('../../src/services/search.service.js');

const userId = 'user_1';

beforeEach(() => {
  mockNote.findMany.mockReset();
  mockNote.findFirst.mockReset();
  mockQueryRaw.mockReset();
  mockEmbedText.mockReset();
  mockEmbedText.mockResolvedValue(null);
});

// ===========================================================================
// Lexical operators — websearch_to_tsquery
// ===========================================================================
describe('SearchService lexical operators', () => {
  test('search() builds query with websearch_to_tsquery, not plainto_tsquery', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await SearchService.search(userId, 'graph -draft "agent memory"');

    const sql = JSON.stringify(mockQueryRaw.mock.calls[0]);
    expect(sql).toContain('websearch_to_tsquery');
    expect(sql).not.toContain('plainto_tsquery');
  });

  test('getContext() topic branch builds query with websearch_to_tsquery', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await SearchService.getContext(userId, { topic: 'agent memory' });

    const sql = JSON.stringify(mockQueryRaw.mock.calls[0]);
    expect(sql).toContain('websearch_to_tsquery');
    expect(sql).not.toContain('plainto_tsquery');
  });
});

// ===========================================================================
// Tier 2 — OR relaxation
// ===========================================================================
describe('SearchService OR relaxation (search)', () => {
  test('relaxes to an OR-joined query when strict returns zero rows (first page)', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // tier 1 strict: miss
      .mockResolvedValueOnce([
        {
          id: 'n1',
          slug: 'api-deploy',
          title: 'API deployment',
          excerpt: 'localhost mycelium',
          status: 'PUBLISHED',
          updatedAt: new Date('2026-05-05T00:00:00.000Z'),
          rank: 0.3,
        },
      ]);

    const out = await SearchService.search(userId, 'api localhost mycelium deployment');

    // Two lexical passes ran: strict then OR.
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    // The second pass bound an OR-joined query string.
    const orSql = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(orSql).toContain('api OR localhost OR mycelium OR deployment');
    // Relaxed tier is single-page.
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].slug).toBe('api-deploy');
    expect(out.nextCursor).toBeNull();
  });

  test('does not relax when strict returns rows', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      {
        id: 'n1',
        slug: 'exact',
        title: 'Exact',
        excerpt: 'e',
        status: 'PUBLISHED',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        rank: 0.9,
      },
    ]);

    const out = await SearchService.search(userId, 'exact match here');

    expect(mockQueryRaw).toHaveBeenCalledTimes(1); // strict only, no OR pass
    expect(out.notes).toHaveLength(1);
  });

  test('does not relax on a cursor page even when strict is empty', async () => {
    mockQueryRaw.mockResolvedValueOnce([]); // strict miss, but cursor supplied

    const cursor = Buffer.from(
      JSON.stringify({ rank: 0.5, updatedAt: '2026-01-01T00:00:00.000Z', id: 'n9' }),
    ).toString('base64url');
    const out = await SearchService.search(userId, 'api localhost mycelium', { cursor });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1); // no OR pass on cursor pages
    expect(out.notes).toHaveLength(0);
    expect(out.nextCursor).toBeNull();
  });
});

// ===========================================================================
// getContext — exposed score + ts_headline snippet
// ===========================================================================
describe('SearchService.getContext score + snippet', () => {
  test('topic branch returns ts_rank score and ts_headline snippet, and selects both', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          id: 'n1',
          slug: 'graph-memory',
          title: 'Graph memory',
          excerpt: 'old static excerpt',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          score: 0.42,
          snippet: '<b>graph</b> as agent <b>memory</b>',
        },
      ]) // main websearch query
      .mockResolvedValueOnce([{ noteId: 'n1', name: 'memory' }]); // tag rows

    const out = await SearchService.getContext(userId, { topic: 'graph memory' });

    const sql = JSON.stringify(mockQueryRaw.mock.calls[0]);
    expect(sql).toContain('ts_rank');
    expect(sql).toContain('ts_headline');

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: 'n1',
      slug: 'graph-memory',
      title: 'Graph memory',
      excerpt: 'old static excerpt',
      score: 0.42,
      snippet: '<b>graph</b> as agent <b>memory</b>',
      tags: ['memory'],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  test('recent-notes branch returns score:null and snippet=excerpt (uniform shape)', async () => {
    mockNote.findMany.mockResolvedValue([
      {
        id: 'n1',
        slug: 'recent-1',
        title: 'Recent 1',
        excerpt: 'recent excerpt',
        updatedAt: new Date('2026-02-02T00:00:00.000Z'),
        tags: [{ name: 't1' }],
      },
    ]);

    const out = await SearchService.getContext(userId, {});

    expect(out[0].tags).toEqual(['t1']);
    expect(out[0].updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(out[0].score).toBeNull();
    expect(out[0].snippet).toBe('recent excerpt');
  });
});

// ===========================================================================
// getContext — pg_trgm fuzzy fallback
// ===========================================================================
describe('SearchService.getContext fuzzy fallback', () => {
  test('falls back to trigram similarity when websearch returns zero rows', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // main websearch: lexical miss
      .mockResolvedValueOnce([
        {
          id: 'n1',
          slug: 'graff-theory',
          title: 'Graff theory',
          excerpt: 'about graphs',
          updatedAt: new Date('2026-03-03T00:00:00.000Z'),
          score: 0.5,
          snippet: 'about graphs',
        },
      ]) // fuzzy fallback hit
      .mockResolvedValueOnce([{ noteId: 'n1', name: 'math' }]); // tag rows

    const out = await SearchService.getContext(userId, { topic: 'graf' });

    expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    const fallbackSql = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(fallbackSql).toContain('similarity');

    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('graff-theory');
    expect(out[0].score).toBe(0.5);
    expect(out[0].tags).toEqual(['math']);
  });

  test('does not run the fallback when websearch returns rows', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          id: 'n1',
          slug: 'exact',
          title: 'Exact',
          excerpt: 'e',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          score: 0.9,
          snippet: '<b>exact</b>',
        },
      ]) // main websearch hit
      .mockResolvedValueOnce([]); // tag rows

    await SearchService.getContext(userId, { topic: 'exact' });

    expect(mockQueryRaw).toHaveBeenCalledTimes(2); // search + tagRows, NO fallback
    const allSql = JSON.stringify(mockQueryRaw.mock.calls);
    expect(allSql).not.toContain('similarity');
  });
});
