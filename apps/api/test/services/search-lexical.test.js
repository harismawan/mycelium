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

// ---------------------------------------------------------------------------
// Import service AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { SearchService } = await import('../../src/services/search.service.js');

const userId = 'user_1';

beforeEach(() => {
  mockNote.findMany.mockReset();
  mockNote.findFirst.mockReset();
  mockQueryRaw.mockReset();
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

  test('recent-notes branch returns id, slug, title, excerpt, tags, updatedAt (no score/snippet)', async () => {
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
    expect(out[0].score).toBeUndefined();
    expect(out[0].snippet).toBeUndefined();
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
