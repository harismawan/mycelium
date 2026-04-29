import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — mock the db module directly to avoid global PrismaClient conflicts
// ---------------------------------------------------------------------------
const createdRecords = [];
const storedEntries = [];

const mockActivityLog = {
  create: mock(async ({ data }) => {
    const record = { id: `log_${createdRecords.length}`, ...data, createdAt: new Date() };
    createdRecords.push(record);
    return record;
  }),
  findMany: mock(async ({ where, take, orderBy, cursor, skip }) => {
    // Filter stored entries by where clause
    let filtered = storedEntries.filter((e) => e.userId === where.userId);
    if (where.action) {
      filtered = filtered.filter((e) => e.action === where.action);
    }
    if (where.apiKeyName) {
      filtered = filtered.filter((e) => e.apiKeyName === where.apiKeyName);
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Handle cursor-based pagination
    if (cursor) {
      const cursorIndex = filtered.findIndex((e) => e.id === cursor.id);
      if (cursorIndex >= 0) {
        filtered = filtered.slice(cursorIndex + (skip || 0));
      }
    }

    // Apply take limit
    if (take) {
      filtered = filtered.slice(0, take);
    }

    return filtered;
  }),
};

const mockPrisma = { activityLog: mockActivityLog };

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));

mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
}));

// ---------------------------------------------------------------------------
// Import ActivityLogService AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { ActivityLogService } = await import('../../src/services/activity-log.service.js');

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  createdRecords.length = 0;
  storedEntries.length = 0;
  mockActivityLog.create.mockClear();
  mockActivityLog.findMany.mockClear();

  // Restore create implementation
  mockActivityLog.create.mockImplementation(async ({ data }) => {
    const record = { id: `log_${createdRecords.length}`, ...data, createdAt: new Date() };
    createdRecords.push(record);
    return record;
  });
});

// ---------------------------------------------------------------------------
// Property 1: Activity log completeness
// **Validates: Requirements 1.1, 1.3**
// ---------------------------------------------------------------------------
describe('Feature: agent-activity-log, Property 1: activity log completeness', () => {
  test('persists a note:create action with success status and all fields', async () => {
    const params = {
      userId: 'user_abc123def456ghij',
      apiKeyId: 'key_xyz789abc012defg',
      apiKeyName: 'my-agent-key',
      action: 'note:create',
      targetResourceId: 'res_aaa111bbb222ccc33',
      targetResourceSlug: 'my-new-note',
      details: { title: 'My New Note' },
      status: 'success',
    };

    await ActivityLogService.logAction(params);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const data = mockActivityLog.create.mock.calls[0][0].data;
    expect(data.userId).toBe(params.userId);
    expect(data.apiKeyId).toBe(params.apiKeyId);
    expect(data.apiKeyName).toBe(params.apiKeyName);
    expect(data.action).toBe('note:create');
    expect(data.targetResourceId).toBe(params.targetResourceId);
    expect(data.targetResourceSlug).toBe(params.targetResourceSlug);
    expect(data.details).toEqual({ title: 'My New Note' });
    expect(data.status).toBe('success');
  });

  test('persists a note:update action with error status', async () => {
    const params = {
      userId: 'user_updatetest00001',
      apiKeyId: 'key_updatetest00001',
      apiKeyName: 'updater-bot',
      action: 'note:update',
      targetResourceId: 'res_update123456789',
      targetResourceSlug: 'updated-note',
      details: { error: 'Conflict detected' },
      status: 'error',
    };

    await ActivityLogService.logAction(params);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const data = mockActivityLog.create.mock.calls[0][0].data;
    expect(data.userId).toBe(params.userId);
    expect(data.apiKeyId).toBe(params.apiKeyId);
    expect(data.apiKeyName).toBe(params.apiKeyName);
    expect(data.action).toBe('note:update');
    expect(data.status).toBe('error');
    expect(data.details).toEqual({ error: 'Conflict detected' });
  });

  test('persists a note:archive action with null target resource fields', async () => {
    const params = {
      userId: 'user_archivetest0001',
      apiKeyId: 'key_archivetest0001',
      apiKeyName: 'archive-agent',
      action: 'note:archive',
      targetResourceId: null,
      targetResourceSlug: null,
      details: {},
      status: 'success',
    };

    await ActivityLogService.logAction(params);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const data = mockActivityLog.create.mock.calls[0][0].data;
    expect(data.action).toBe('note:archive');
    expect(data.targetResourceId).toBeNull();
    expect(data.targetResourceSlug).toBeNull();
    expect(data.details).toEqual({});
  });

  test('persists a note:delete action with empty details', async () => {
    const params = {
      userId: 'user_deletetest00001',
      apiKeyId: 'key_deletetest00001',
      apiKeyName: 'cleanup-bot',
      action: 'note:delete',
      targetResourceId: 'res_todelete12345678',
      targetResourceSlug: 'old-note-to-delete',
      details: {},
      status: 'success',
    };

    await ActivityLogService.logAction(params);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const data = mockActivityLog.create.mock.calls[0][0].data;
    expect(data.action).toBe('note:delete');
    expect(data.targetResourceId).toBe(params.targetResourceId);
    expect(data.targetResourceSlug).toBe(params.targetResourceSlug);
  });

  test('persists a note:search action with success status', async () => {
    const params = {
      userId: 'user_searchtest00001',
      apiKeyId: 'key_searchtest00001',
      apiKeyName: 'search-agent',
      action: 'note:search',
      targetResourceId: null,
      targetResourceSlug: null,
      details: { title: 'search query terms' },
      status: 'success',
    };

    await ActivityLogService.logAction(params);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const data = mockActivityLog.create.mock.calls[0][0].data;
    expect(data.action).toBe('note:search');
    expect(data.userId).toBe(params.userId);
    expect(data.details).toEqual({ title: 'search query terms' });
  });

  test('persists a note:revert action with error details', async () => {
    const params = {
      userId: 'user_reverttest00001',
      apiKeyId: 'key_reverttest00001',
      apiKeyName: 'revert-agent',
      action: 'note:revert',
      targetResourceId: 'res_revert1234567890',
      targetResourceSlug: 'reverted-note',
      details: { error: 'Revision not found' },
      status: 'error',
    };

    await ActivityLogService.logAction(params);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const data = mockActivityLog.create.mock.calls[0][0].data;
    expect(data.action).toBe('note:revert');
    expect(data.status).toBe('error');
    expect(data.details).toEqual({ error: 'Revision not found' });
  });

  test('persists a bundle:read action with undefined optional fields defaulting correctly', async () => {
    const params = {
      userId: 'user_bundletest00001',
      apiKeyId: 'key_bundletest00001',
      apiKeyName: 'bundle-reader',
      action: 'bundle:read',
      targetResourceId: undefined,
      targetResourceSlug: undefined,
      details: undefined,
      status: undefined,
    };

    await ActivityLogService.logAction(params);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const data = mockActivityLog.create.mock.calls[0][0].data;
    expect(data.action).toBe('bundle:read');
    expect(data.targetResourceId).toBeNull();
    expect(data.targetResourceSlug).toBeNull();
    expect(data.details).toEqual({});
    expect(data.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Property 3: Ordering and pagination completeness
// **Validates: Requirements 4.1, 4.2**
// ---------------------------------------------------------------------------
describe('Feature: agent-activity-log, Property 3: ordering and pagination', () => {
  /**
   * Helper: seed N entries with distinct timestamps and paginate through them.
   */
  async function seedAndPaginate(numEntries, pageSize) {
    storedEntries.length = 0;
    const userId = 'user_pagination';
    const baseTime = new Date('2026-01-01T00:00:00Z').getTime();

    for (let i = 0; i < numEntries; i++) {
      storedEntries.push({
        id: `log_${i}`,
        userId,
        apiKeyId: 'key_1',
        apiKeyName: 'agent',
        action: 'note:create',
        targetResourceId: null,
        targetResourceSlug: null,
        details: {},
        status: 'success',
        createdAt: new Date(baseTime + i * 1000),
      });
    }

    const allCollected = [];
    let cursor = undefined;

    for (let page = 0; page < numEntries + 1; page++) {
      const result = await ActivityLogService.listEntries(userId, {
        limit: pageSize,
        cursor,
      });
      allCollected.push(...result.entries);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    return allCollected;
  }

  test('1 entry with page size 1 returns exactly 1 entry', async () => {
    const collected = await seedAndPaginate(1, 1);
    expect(collected).toHaveLength(1);
  });

  test('5 entries with page size 2 returns all 5 entries in descending order', async () => {
    const collected = await seedAndPaginate(5, 2);
    expect(collected).toHaveLength(5);

    const ids = new Set(collected.map((e) => e.id));
    expect(ids.size).toBe(5);

    for (let i = 1; i < collected.length; i++) {
      expect(collected[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        collected[i].createdAt.getTime(),
      );
    }
  });

  test('10 entries with page size 3 returns all 10 entries exactly once', async () => {
    const collected = await seedAndPaginate(10, 3);
    expect(collected).toHaveLength(10);

    const ids = new Set(collected.map((e) => e.id));
    expect(ids.size).toBe(10);

    for (let i = 1; i < collected.length; i++) {
      expect(collected[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        collected[i].createdAt.getTime(),
      );
    }
  });

  test('20 entries with page size 7 returns all 20 entries in order', async () => {
    const collected = await seedAndPaginate(20, 7);
    expect(collected).toHaveLength(20);

    const ids = new Set(collected.map((e) => e.id));
    expect(ids.size).toBe(20);

    for (let i = 1; i < collected.length; i++) {
      expect(collected[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        collected[i].createdAt.getTime(),
      );
    }
  });

  test('50 entries with page size 20 returns all 50 entries', async () => {
    const collected = await seedAndPaginate(50, 20);
    expect(collected).toHaveLength(50);

    const ids = new Set(collected.map((e) => e.id));
    expect(ids.size).toBe(50);
  });

  test('15 entries with page size 15 returns all in a single page', async () => {
    const collected = await seedAndPaginate(15, 15);
    expect(collected).toHaveLength(15);

    const ids = new Set(collected.map((e) => e.id));
    expect(ids.size).toBe(15);

    for (let i = 1; i < collected.length; i++) {
      expect(collected[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        collected[i].createdAt.getTime(),
      );
    }
  });

  test('30 entries with page size 1 returns all 30 entries one at a time', async () => {
    const collected = await seedAndPaginate(30, 1);
    expect(collected).toHaveLength(30);

    const ids = new Set(collected.map((e) => e.id));
    expect(ids.size).toBe(30);

    for (let i = 1; i < collected.length; i++) {
      expect(collected[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        collected[i].createdAt.getTime(),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Property 4: Filtering correctness
// **Validates: Requirements 4.3**
// ---------------------------------------------------------------------------
describe('Feature: agent-activity-log, Property 4: filtering correctness', () => {
  /**
   * Helper: seed entries with given specs and query with filters.
   */
  async function seedAndFilter(entrySpecs, filterAction, filterApiKeyName) {
    storedEntries.length = 0;
    const userId = 'user_filter';
    const baseTime = new Date('2026-01-01T00:00:00Z').getTime();

    for (let i = 0; i < entrySpecs.length; i++) {
      storedEntries.push({
        id: `log_${i}`,
        userId,
        apiKeyId: 'key_1',
        apiKeyName: entrySpecs[i].apiKeyName,
        action: entrySpecs[i].action,
        targetResourceId: null,
        targetResourceSlug: null,
        details: {},
        status: 'success',
        createdAt: new Date(baseTime + i * 1000),
      });
    }

    // Compute expected matches
    let expected = storedEntries.filter((e) => e.userId === userId);
    if (filterAction) {
      expected = expected.filter((e) => e.action === filterAction);
    }
    if (filterApiKeyName) {
      expected = expected.filter((e) => e.apiKeyName === filterApiKeyName);
    }

    const result = await ActivityLogService.listEntries(userId, {
      limit: 100,
      action: filterAction,
      apiKeyName: filterApiKeyName,
    });

    return { result, expected };
  }

  test('filter by action only returns matching entries', async () => {
    const specs = [
      { action: 'note:create', apiKeyName: 'agent-a' },
      { action: 'note:update', apiKeyName: 'agent-a' },
      { action: 'note:create', apiKeyName: 'agent-b' },
      { action: 'note:delete', apiKeyName: 'agent-c' },
      { action: 'note:create', apiKeyName: 'agent-c' },
    ];

    const { result, expected } = await seedAndFilter(specs, 'note:create', undefined);

    expect(result.entries).toHaveLength(expected.length);
    expect(result.entries).toHaveLength(3);
    for (const entry of result.entries) {
      expect(entry.action).toBe('note:create');
    }
  });

  test('filter by apiKeyName only returns matching entries', async () => {
    const specs = [
      { action: 'note:create', apiKeyName: 'agent-a' },
      { action: 'note:update', apiKeyName: 'agent-b' },
      { action: 'note:archive', apiKeyName: 'agent-a' },
      { action: 'note:delete', apiKeyName: 'agent-c' },
      { action: 'note:search', apiKeyName: 'agent-a' },
    ];

    const { result, expected } = await seedAndFilter(specs, undefined, 'agent-a');

    expect(result.entries).toHaveLength(expected.length);
    expect(result.entries).toHaveLength(3);
    for (const entry of result.entries) {
      expect(entry.apiKeyName).toBe('agent-a');
    }
  });

  test('filter by both action and apiKeyName returns intersection', async () => {
    const specs = [
      { action: 'note:create', apiKeyName: 'agent-a' },
      { action: 'note:create', apiKeyName: 'agent-b' },
      { action: 'note:update', apiKeyName: 'agent-a' },
      { action: 'note:create', apiKeyName: 'agent-a' },
      { action: 'note:delete', apiKeyName: 'agent-a' },
    ];

    const { result, expected } = await seedAndFilter(specs, 'note:create', 'agent-a');

    expect(result.entries).toHaveLength(expected.length);
    expect(result.entries).toHaveLength(2);
    for (const entry of result.entries) {
      expect(entry.action).toBe('note:create');
      expect(entry.apiKeyName).toBe('agent-a');
    }
  });

  test('no filters returns all entries', async () => {
    const specs = [
      { action: 'note:create', apiKeyName: 'agent-a' },
      { action: 'note:update', apiKeyName: 'agent-b' },
      { action: 'note:archive', apiKeyName: 'agent-c' },
    ];

    const { result, expected } = await seedAndFilter(specs, undefined, undefined);

    expect(result.entries).toHaveLength(expected.length);
    expect(result.entries).toHaveLength(3);
  });

  test('filter with no matching entries returns empty array', async () => {
    const specs = [
      { action: 'note:create', apiKeyName: 'agent-a' },
      { action: 'note:update', apiKeyName: 'agent-b' },
    ];

    const { result } = await seedAndFilter(specs, 'note:delete', undefined);

    expect(result.entries).toHaveLength(0);
  });

  test('filter by action that matches all entries returns all', async () => {
    const specs = [
      { action: 'note:search', apiKeyName: 'agent-a' },
      { action: 'note:search', apiKeyName: 'agent-b' },
      { action: 'note:search', apiKeyName: 'agent-c' },
    ];

    const { result } = await seedAndFilter(specs, 'note:search', undefined);

    expect(result.entries).toHaveLength(3);
    for (const entry of result.entries) {
      expect(entry.action).toBe('note:search');
    }
  });

  test('returned entry IDs match expected entry IDs exactly', async () => {
    const specs = [
      { action: 'note:create', apiKeyName: 'agent-a' },
      { action: 'note:revert', apiKeyName: 'agent-b' },
      { action: 'note:create', apiKeyName: 'agent-b' },
      { action: 'bundle:read', apiKeyName: 'agent-a' },
      { action: 'note:create', apiKeyName: 'agent-c' },
      { action: 'note:update', apiKeyName: 'agent-b' },
    ];

    const { result, expected } = await seedAndFilter(specs, 'note:create', 'agent-b');

    expect(result.entries).toHaveLength(expected.length);
    const returnedIds = new Set(result.entries.map((e) => e.id));
    for (const exp of expected) {
      expect(returnedIds.has(exp.id)).toBe(true);
    }
  });
});
