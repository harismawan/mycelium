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
