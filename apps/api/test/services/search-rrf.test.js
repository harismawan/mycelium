import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNote = { findMany: mock(() => []) };
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

const { SearchService } = await import('../../src/services/search.service.js');

const userId = 'user_1';
const row = (id, rank) => ({ id, slug: id, title: id.toUpperCase(), excerpt: null, status: 'DRAFT', ...(rank != null ? { rank } : {}) });

function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
}

beforeEach(() => {
  mockNote.findMany.mockReset();
  mockQueryRaw.mockReset();
  mockEmbedText.mockReset();
  mockEmbedText.mockResolvedValue(null);
});

describe('SearchService.search — lexical-only when arm disabled', () => {
  test('embedText null => one query, unchanged shape', async () => {
    mockQueryRaw.mockResolvedValue([row('n1', 0.9), row('n2', 0.5)]);

    const out = await SearchService.search(userId, 'q');

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(out.notes).toHaveLength(2);
    expect(out.notes[0].rank).toBe(0.9);
    expect(out.nextCursor).toBeNull();
  });
});

describe('SearchService.search — fused RRF path', () => {
  beforeEach(() => mockEmbedText.mockResolvedValue(Array.from({ length: 1024 }, () => 0.1)));

  test('runs two candidate queries and fuses by reciprocal rank', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([row('a'), row('b'), row('c')]) // lexical: ranks 0,1,2
      .mockResolvedValueOnce([row('c'), row('a'), row('d')]); // vector: ranks 0,1,2

    const out = await SearchService.search(userId, 'q');

    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    // a: 1/60+1/61, c: 1/62+1/60, b: 1/61, d: 1/62  ->  a, c, b, d
    expect(out.notes.map((n) => n.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(out.notes[0].rank).toBeCloseTo(1 / 60 + 1 / 61, 6);
  });

  test('paginates the fused list with the {rank,id} cursor', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([row('a'), row('b'), row('c')])
      .mockResolvedValueOnce([row('c'), row('a'), row('d')]);

    const page1 = await SearchService.search(userId, 'q', { limit: 2 });
    expect(page1.notes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(decodeCursor(page1.nextCursor).id).toBe('c');

    mockQueryRaw
      .mockResolvedValueOnce([row('a'), row('b'), row('c')])
      .mockResolvedValueOnce([row('c'), row('a'), row('d')]);

    const page2 = await SearchService.search(userId, 'q', { limit: 2, cursor: page1.nextCursor });
    expect(page2.notes.map((n) => n.id)).toEqual(['b', 'd']);
    expect(page2.nextCursor).toBeNull();
  });
});

describe('SearchService.getContext — fused topic branch', () => {
  test('embedText null => single lexical query (unchanged)', async () => {
    mockEmbedText.mockResolvedValue(null);
    mockQueryRaw
      .mockResolvedValueOnce([{ id: 'n1', slug: 's1', title: 'T1', excerpt: null, updatedAt: new Date() }])
      .mockResolvedValueOnce([]); // tag lookup
    const out = await SearchService.getContext(userId, { topic: 't' });
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty('rank');
  });

  test('embedText vector => fuses candidates, output shape unchanged', async () => {
    mockEmbedText.mockResolvedValue(Array.from({ length: 1024 }, () => 0.1));
    const ctxRow = (id) => ({ id, slug: id, title: id.toUpperCase(), excerpt: null, updatedAt: new Date() });
    mockQueryRaw
      .mockResolvedValueOnce([ctxRow('a'), ctxRow('b')]) // lexical candidates
      .mockResolvedValueOnce([ctxRow('b'), ctxRow('a')]) // vector candidates
      .mockResolvedValueOnce([]); // tag lookup
    const out = await SearchService.getContext(userId, { topic: 't' });
    expect(out.map((n) => n.id)).toEqual(['b', 'a']); // b ranked 0 in vector list
    expect(out[0]).not.toHaveProperty('rank');
    expect(Object.keys(out[0]).sort()).toEqual(['excerpt', 'id', 'slug', 'tags', 'title', 'updatedAt']);
  });
});
