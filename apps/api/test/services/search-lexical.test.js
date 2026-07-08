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
  mockLink.findMany.mockReset();
  mockLink.findMany.mockResolvedValue([]);
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

  test('strips quotes so a quoted long query still relaxes to OR', async () => {
    mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'n1',
        slug: 'api-deploy',
        title: 'API deployment',
        excerpt: 'x',
        status: 'PUBLISHED',
        updatedAt: new Date('2026-05-05T00:00:00.000Z'),
        rank: 0.3,
      },
    ]);

    const out = await SearchService.search(userId, '"api localhost mycelium deployment"');

    const orSql = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(orSql).toContain('api OR localhost OR mycelium OR deployment');
    expect(orSql).not.toContain('\\"api');
    expect(orSql).not.toContain('deployment\\"');
    expect(out.notes).toHaveLength(1);
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

describe('SearchService trigram fallback (search)', () => {
  test('falls back to title similarity when strict and OR both miss', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // tier 1 strict miss
      .mockResolvedValueOnce([]) // tier 2 OR miss
      .mockResolvedValueOnce([
        // tier 3 trigram hit
        {
          id: 'n1',
          slug: 'deploymnt',
          title: 'Deploymnt notes',
          excerpt: 'typo title',
          status: 'PUBLISHED',
          updatedAt: new Date('2026-06-06T00:00:00.000Z'),
          rank: 0.42,
        },
      ]);

    const out = await SearchService.search(userId, 'deployment mycelium');

    expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    const trgSql = JSON.stringify(mockQueryRaw.mock.calls[2]);
    expect(trgSql).toContain('similarity');
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].slug).toBe('deploymnt');
    expect(out.nextCursor).toBeNull();
  });

  test('trigram fallback carries a status filter', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // strict miss
      .mockResolvedValueOnce([]) // OR miss
      .mockResolvedValueOnce([
        {
          id: 'n1',
          slug: 'deploymnt',
          title: 'Deploymnt',
          excerpt: 'x',
          status: 'PUBLISHED',
          updatedAt: new Date('2026-06-06T00:00:00.000Z'),
          rank: 0.42,
        },
      ]);

    const out = await SearchService.search(userId, 'deployment mycelium', { status: 'PUBLISHED' });

    const trgSql = JSON.stringify(mockQueryRaw.mock.calls[2]);
    expect(trgSql).toContain('similarity');
    expect(trgSql).toContain('PUBLISHED');
    expect(out.notes).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });

  test('single-token query with empty strict skips OR and hits trigram', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // strict miss
      .mockResolvedValueOnce([
        {
          id: 'n1',
          slug: 'xyzzy',
          title: 'Xyzzy',
          excerpt: 'x',
          status: 'DRAFT',
          updatedAt: new Date('2026-06-06T00:00:00.000Z'),
          rank: 0.4,
        },
      ]);

    const out = await SearchService.search(userId, 'xyzzy');

    expect(mockQueryRaw).toHaveBeenCalledTimes(2); // strict + trigram, no OR
    const trgSql = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(trgSql).toContain('similarity');
    expect(out.notes[0].slug).toBe('xyzzy');
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

describe('SearchService.getContext OR relaxation', () => {
  test('relaxes topic to OR when strict misses, before trigram', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // tier 1 strict topic: miss
      .mockResolvedValueOnce([
        // tier 2 OR: hit
        {
          id: 'n1',
          slug: 'api-deploy',
          title: 'API deployment',
          excerpt: 'localhost mycelium',
          source: null,
          confidence: null,
          importance: null,
          updatedAt: new Date('2026-05-05T00:00:00.000Z'),
          score: 0.3,
          snippet: '<b>api</b>',
        },
      ])
      .mockResolvedValueOnce([]); // tag rows

    const out = await SearchService.getContext(userId, {
      topic: 'api localhost mycelium deployment',
    });

    // strict + OR + tagRows = 3 calls; trigram NOT reached.
    expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    const orSql = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(orSql).toContain('api OR localhost OR mycelium OR deployment');
    const allSql = JSON.stringify(mockQueryRaw.mock.calls);
    expect(allSql).not.toContain('similarity'); // trigram skipped
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('api-deploy');
  });
});

describe('SearchService.getContext expand OR relaxation', () => {
  test('relaxes expand seed to OR when strict seed query misses', async () => {
    // seed strict miss -> seed OR hit. Neighbors + tags follow via LinkService/_attachTags.
    mockQueryRaw
      .mockResolvedValueOnce([]) // strict seed: miss
      .mockResolvedValueOnce([
        // OR seed: hit
        {
          id: 'n1',
          slug: 'api-deploy',
          title: 'API deployment',
          excerpt: 'localhost mycelium',
          updatedAt: new Date('2026-05-05T00:00:00.000Z'),
          rank: 0.3,
        },
      ])
      .mockResolvedValueOnce([]); // _attachTags tag rows

    const out = await SearchService.getContext(userId, {
      topic: 'api localhost mycelium deployment',
      expand: true,
    });

    expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    expect(mockLink.findMany).toHaveBeenCalledTimes(2);
    const orSql = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(orSql).toContain('api OR localhost OR mycelium OR deployment');
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('api-deploy');
  });
});

// ===========================================================================
// _tieredMatch — shared tier helper (ranked ids under arbitrary conditions)
// ===========================================================================
describe('SearchService._tieredMatch', () => {
  test('strict hit returns ids + cursor, no relaxation', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { id: 'n1', updatedAt: new Date('2026-05-05T00:00:00.000Z'), rank: 0.9 },
    ]);

    const out = await SearchService._tieredMatch(userId, 'exact term', { limit: 20 });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(out.rows).toEqual([{ id: 'n1', rank: 0.9 }]);
  });

  test('OR-relax on empty strict first page', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // strict miss
      .mockResolvedValueOnce([   // OR hit
        { id: 'n2', updatedAt: new Date('2026-05-05T00:00:00.000Z'), rank: 0.3 },
      ]);

    const out = await SearchService._tieredMatch(userId, 'api localhost mycelium deployment', { limit: 20 });

    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    const orSql = JSON.stringify(mockQueryRaw.mock.calls[1]);
    expect(orSql).toContain('api OR localhost OR mycelium OR deployment');
    expect(out.rows).toEqual([{ id: 'n2', rank: 0.3 }]);
    expect(out.nextCursor).toBeNull();
  });

  test('trigram tier on strict+OR double miss', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // strict
      .mockResolvedValueOnce([]) // OR
      .mockResolvedValueOnce([{ id: 'n3', rank: 0.42 }]); // trigram

    const out = await SearchService._tieredMatch(userId, 'mycellium deploymnt', { limit: 20 });

    expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    const trgSql = JSON.stringify(mockQueryRaw.mock.calls[2]);
    expect(trgSql).toContain('similarity');
    expect(out.rows).toEqual([{ id: 'n3', rank: 0.42 }]);
    expect(out.nextCursor).toBeNull();
  });

  test('cursor page does not relax', async () => {
    mockQueryRaw.mockResolvedValueOnce([]); // strict miss, cursor present
    const cursor = Buffer.from(
      JSON.stringify({ rank: 0.5, updatedAt: '2026-01-01T00:00:00.000Z', id: 'n9' }),
    ).toString('base64url');

    const out = await SearchService._tieredMatch(userId, 'api localhost', { limit: 20, cursor });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(out.rows).toEqual([]);
  });

  test('threads conditions into every tier WHERE', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // strict
      .mockResolvedValueOnce([]) // OR
      .mockResolvedValueOnce([]); // trigram

    await SearchService._tieredMatch(userId, 'api localhost mycelium', {
      limit: 20,
      conditions: [{ strings: [`n."directoryId" = `, ``], values: ['dir_42'], type: 'sql' }],
    });

    const all = JSON.stringify(mockQueryRaw.mock.calls);
    // the bound condition value appears in strict, OR, and trigram SQL
    expect((all.match(/dir_42/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
