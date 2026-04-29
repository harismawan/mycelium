import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — mock the db module directly to avoid global PrismaClient conflicts
// ---------------------------------------------------------------------------
const mockActivityLog = {
  create: mock(() => ({})),
  findMany: mock(() => []),
};

const mockPrisma = { activityLog: mockActivityLog };

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));

// Mock @mycelium/shared for DEFAULT_PAGE_LIMIT
mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
}));

// ---------------------------------------------------------------------------
// Import ActivityLogService AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { ActivityLogService } = await import('../../src/services/activity-log.service.js');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const baseParams = {
  userId: 'user_1',
  apiKeyId: 'key_1',
  apiKeyName: 'my-agent',
  action: 'note:create',
  targetResourceId: 'note_1',
  targetResourceSlug: 'my-note',
  details: { title: 'My Note' },
  status: 'success',
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockActivityLog.create.mockReset();
  mockActivityLog.findMany.mockReset();

  // Restore defaults
  mockActivityLog.create.mockResolvedValue({});
  mockActivityLog.findMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// logAction
// ---------------------------------------------------------------------------
describe('ActivityLogService.logAction', () => {
  /** Validates: Requirements 1.1, 1.2 */
  test('persists an activity log record with all fields', async () => {
    await ActivityLogService.logAction(baseParams);

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const createArg = mockActivityLog.create.mock.calls[0][0];
    expect(createArg.data.userId).toBe('user_1');
    expect(createArg.data.apiKeyId).toBe('key_1');
    expect(createArg.data.apiKeyName).toBe('my-agent');
    expect(createArg.data.action).toBe('note:create');
    expect(createArg.data.targetResourceId).toBe('note_1');
    expect(createArg.data.targetResourceSlug).toBe('my-note');
    expect(createArg.data.details).toEqual({ title: 'My Note' });
    expect(createArg.data.status).toBe('success');
  });

  /** Validates: Requirements 1.3 */
  test('persists error status when action fails', async () => {
    await ActivityLogService.logAction({
      ...baseParams,
      status: 'error',
      details: { error: 'Validation failed' },
    });

    expect(mockActivityLog.create).toHaveBeenCalledTimes(1);
    const createArg = mockActivityLog.create.mock.calls[0][0];
    expect(createArg.data.status).toBe('error');
    expect(createArg.data.details).toEqual({ error: 'Validation failed' });
  });

  test('defaults status to success when not provided', async () => {
    const { status, ...paramsWithoutStatus } = baseParams;
    await ActivityLogService.logAction(paramsWithoutStatus);

    const createArg = mockActivityLog.create.mock.calls[0][0];
    expect(createArg.data.status).toBe('success');
  });

  test('defaults details to empty object when not provided', async () => {
    const { details, ...paramsWithoutDetails } = baseParams;
    await ActivityLogService.logAction(paramsWithoutDetails);

    const createArg = mockActivityLog.create.mock.calls[0][0];
    expect(createArg.data.details).toEqual({});
  });

  test('defaults targetResourceId and targetResourceSlug to null when not provided', async () => {
    const { targetResourceId, targetResourceSlug, ...minimalParams } = baseParams;
    await ActivityLogService.logAction(minimalParams);

    const createArg = mockActivityLog.create.mock.calls[0][0];
    expect(createArg.data.targetResourceId).toBeNull();
    expect(createArg.data.targetResourceSlug).toBeNull();
  });

  /** Validates: Requirements 1.5 */
  test('does not throw when database write fails (fire-and-forget)', async () => {
    const consoleSpy = mock(() => {});
    const originalError = console.error;
    console.error = consoleSpy;

    mockActivityLog.create.mockRejectedValue(new Error('DB connection lost'));

    // Should not throw
    await ActivityLogService.logAction(baseParams);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toBe('Failed to persist activity log:');

    console.error = originalError;
  });
});

// ---------------------------------------------------------------------------
// listEntries
// ---------------------------------------------------------------------------
describe('ActivityLogService.listEntries', () => {
  /** Validates: Requirements 4.1 */
  test('returns entries ordered by createdAt descending', async () => {
    const entries = [
      { id: 'log_2', createdAt: new Date('2026-01-02') },
      { id: 'log_1', createdAt: new Date('2026-01-01') },
    ];
    mockActivityLog.findMany.mockResolvedValue(entries);

    const result = await ActivityLogService.listEntries('user_1');

    expect(result.entries).toHaveLength(2);
    const findCall = mockActivityLog.findMany.mock.calls[0][0];
    expect(findCall.orderBy).toEqual({ createdAt: 'desc' });
  });

  /** Validates: Requirements 4.2 */
  test('supports cursor-based pagination', async () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      id: `log_${i}`,
      createdAt: new Date(),
    }));
    mockActivityLog.findMany.mockResolvedValue(entries);

    const result = await ActivityLogService.listEntries('user_1', { limit: 2 });

    expect(result.entries).toHaveLength(2);
    expect(result.nextCursor).toBe('log_1');
  });

  test('returns null nextCursor when no more results', async () => {
    mockActivityLog.findMany.mockResolvedValue([
      { id: 'log_0', createdAt: new Date() },
    ]);

    const result = await ActivityLogService.listEntries('user_1', { limit: 5 });

    expect(result.entries).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  test('passes cursor for pagination', async () => {
    mockActivityLog.findMany.mockResolvedValue([]);

    await ActivityLogService.listEntries('user_1', { cursor: 'cursor_abc' });

    const findCall = mockActivityLog.findMany.mock.calls[0][0];
    expect(findCall.cursor).toEqual({ id: 'cursor_abc' });
    expect(findCall.skip).toBe(1);
  });

  test('uses DEFAULT_PAGE_LIMIT when no limit provided', async () => {
    mockActivityLog.findMany.mockResolvedValue([]);

    await ActivityLogService.listEntries('user_1');

    const findCall = mockActivityLog.findMany.mock.calls[0][0];
    // DEFAULT_PAGE_LIMIT is 20, so take should be 21
    expect(findCall.take).toBe(21);
  });

  /** Validates: Requirements 4.3 */
  test('applies action filter', async () => {
    mockActivityLog.findMany.mockResolvedValue([]);

    await ActivityLogService.listEntries('user_1', { action: 'note:create' });

    const findCall = mockActivityLog.findMany.mock.calls[0][0];
    expect(findCall.where.action).toBe('note:create');
  });

  /** Validates: Requirements 4.3 */
  test('applies apiKeyName filter', async () => {
    mockActivityLog.findMany.mockResolvedValue([]);

    await ActivityLogService.listEntries('user_1', { apiKeyName: 'my-agent' });

    const findCall = mockActivityLog.findMany.mock.calls[0][0];
    expect(findCall.where.apiKeyName).toBe('my-agent');
  });

  test('applies both action and apiKeyName filters together', async () => {
    mockActivityLog.findMany.mockResolvedValue([]);

    await ActivityLogService.listEntries('user_1', {
      action: 'note:update',
      apiKeyName: 'agent-2',
    });

    const findCall = mockActivityLog.findMany.mock.calls[0][0];
    expect(findCall.where.action).toBe('note:update');
    expect(findCall.where.apiKeyName).toBe('agent-2');
    expect(findCall.where.userId).toBe('user_1');
  });

  test('scopes queries to the given userId', async () => {
    mockActivityLog.findMany.mockResolvedValue([]);

    await ActivityLogService.listEntries('user_42');

    const findCall = mockActivityLog.findMany.mock.calls[0][0];
    expect(findCall.where.userId).toBe('user_42');
  });
});
