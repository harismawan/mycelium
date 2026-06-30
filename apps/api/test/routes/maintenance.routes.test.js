import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
let forgetStaleArgs = null;
let forgetStaleResult = { archived: 0 };

// ---------------------------------------------------------------------------
// Mock the service + auth middleware before importing the routes.
// csrfMiddleware is intentionally NOT mocked — it no-ops for apikey auth.
// ---------------------------------------------------------------------------
mock.module('../../src/services/note.service.js', () => ({
  NoteService: {
    forgetStale: async (userId, options) => {
      forgetStaleArgs = { userId, options };
      return forgetStaleResult;
    },
  },
}));

mock.module('../../src/middleware/auth.js', () => ({
  authMiddleware: new Elysia({ name: 'auth-middleware' }).derive({ as: 'scoped' }, () => ({
    user: { id: 'user_1' },
    authType: 'apikey',
    scopes: ['notes:write'],
    apiKeyId: 'key_1',
    apiKeyName: 'cron',
  })),
  requireScopes: () => new Elysia({ name: 'require-scopes-stub' }),
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are registered
// ---------------------------------------------------------------------------
const { maintenanceRoutes } = await import('../../src/routes/maintenance.routes.js');
const app = new Elysia().use(maintenanceRoutes);

beforeEach(() => {
  forgetStaleArgs = null;
  forgetStaleResult = { archived: 0 };
});

describe('POST /api/v1/maintenance/forget-stale', () => {
  test('passes the authenticated user and body cutoff to forgetStale', async () => {
    forgetStaleResult = { archived: 4 };

    const res = await app.handle(
      new Request('http://localhost/api/v1/maintenance/forget-stale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 30 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archived: 4 });
    expect(forgetStaleArgs).toEqual({ userId: 'user_1', options: { olderThanDays: 30 } });
  });

  test('empty body leaves olderThanDays undefined (service applies its default)', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/maintenance/forget-stale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(200);
    expect(forgetStaleArgs.options.olderThanDays).toBeUndefined();
  });
});
