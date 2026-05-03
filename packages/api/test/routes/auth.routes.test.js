import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock state — controls what the mocked modules return
// ---------------------------------------------------------------------------

let redisConnected = true;

const mockUser = {
  id: 'user_1',
  email: 'test@example.com',
  displayName: 'Test User',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

let loginResult = null;
let createSessionResult = null;
let refreshResult = null;
let decodeTokenResult = null;
let revokeSessionCalls = [];

// ---------------------------------------------------------------------------
// Mock modules before importing the routes
// ---------------------------------------------------------------------------

mock.module('@mycelium/shared/redis', () => ({
  getRedisClient: () => ({}),
  prefixKey: (key) => `mycelium:${key}`,
  isRedisConnected: () => redisConnected,
}));

let verifyTokenResult = null;
let tokenActive = true;
let sessionValid = { userId: 'user_1', createdAt: 1000, lastActivity: 2000 };

mock.module('../../src/services/session.service.js', () => ({
  SessionService: {
    createSession: async (...args) => {
      if (!redisConnected) throw new Error('Redis unavailable');
      return createSessionResult;
    },
    refreshAccessToken: async (...args) => {
      if (!redisConnected) throw new Error('Redis unavailable');
      return refreshResult;
    },
    revokeSession: async (...args) => {
      revokeSessionCalls.push(args);
    },
    decodeToken: (...args) => {
      return decodeTokenResult;
    },
    verifyToken: () => verifyTokenResult,
    isTokenActive: async () => tokenActive,
    validateSession: async () => sessionValid,
  },
}));

mock.module('../../src/services/auth.service.js', () => ({
  AuthService: {
    login: async (...args) => {
      if (loginResult instanceof Error) throw loginResult;
      return loginResult;
    },
    register: async () => mockUser,
    verifyJwt: async () => mockUser,
    verifyApiKey: async () => null,
    updateProfile: async () => mockUser,
    changePassword: async () => {},
  },
}));

// ---------------------------------------------------------------------------
// Import the routes AFTER mocks are registered
// ---------------------------------------------------------------------------
const { authRoutes } = await import('../../src/routes/auth.routes.js');
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  return new Elysia().use(authRoutes);
}

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  redisConnected = true;
  revokeSessionCalls = [];
  verifyTokenResult = null;
  tokenActive = true;
  sessionValid = { userId: 'user_1', createdAt: 1000, lastActivity: 2000 };
  loginResult = {
    user: mockUser,
    token: 'legacy_token',
  };
  createSessionResult = {
    session: { sessionId: 'session_abc', userId: 'user_1', createdAt: 1000, lastActivity: 1000 },
    tokens: { accessToken: 'access_token_jwt', refreshToken: 'refresh_token_opaque' },
  };
  refreshResult = null;
  decodeTokenResult = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auth Routes — Login', () => {
  /** Validates: Requirements 2.7 */
  test('login sets both auth and refresh cookies', async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      }),
    );

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe('user_1');
    expect(body.token).toBe('access_token_jwt');

    // Verify both cookies are set
    const setCookieHeaders = res.headers.getAll('set-cookie');
    const authCookie = setCookieHeaders.find((c) => c.startsWith('auth='));
    const refreshCookie = setCookieHeaders.find((c) => c.startsWith('refresh='));

    expect(authCookie).toBeDefined();
    expect(authCookie).toContain('access_token_jwt');
    expect(authCookie).toContain('HttpOnly');

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('refresh_token_opaque');
    expect(refreshCookie).toContain('HttpOnly');
  });

  /** Validates: Requirements 9.3 */
  test('login returns 503 when Redis is unavailable', async () => {
    redisConnected = false;

    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      }),
    );

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('Service temporarily unavailable');
  });
});

describe('Auth Routes — Logout', () => {
  /** Validates: Requirements 6.3 */
  test('logout clears both cookies and revokes session in Redis', async () => {
    // Set up auth state so the middleware authenticates the user
    verifyTokenResult = { sub: 'user_1', sid: 'session_abc', jti: 'jti_123' };
    decodeTokenResult = { sub: 'user_1', sid: 'session_abc', jti: 'jti_123' };

    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'cookie': 'auth=valid_access_token; refresh=valid_refresh_token',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Logged out');

    // Verify revokeSession was called with the session ID
    expect(revokeSessionCalls.length).toBeGreaterThanOrEqual(1);
    expect(revokeSessionCalls[0][0]).toBe('session_abc');

    // Verify both cookies are cleared (maxAge=0)
    const setCookieHeaders = res.headers.getAll('set-cookie');
    const authClear = setCookieHeaders.find(
      (c) => c.includes('auth=') && c.includes('Max-Age=0'),
    );
    const refreshClear = setCookieHeaders.find(
      (c) => c.includes('refresh=') && c.includes('Max-Age=0'),
    );

    expect(authClear).toBeDefined();
    expect(refreshClear).toBeDefined();
  });
});

describe('Auth Routes — Refresh', () => {
  /** Validates: Requirements 5.7 */
  test('POST /api/v1/auth/refresh returns new access token cookie', async () => {
    refreshResult = {
      accessToken: 'new_access_token_jwt',
      sessionId: 'session_abc',
      userId: 'user_1',
      email: 'test@example.com',
    };

    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'cookie': 'refresh=valid_refresh_token' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('new_access_token_jwt');

    // Verify new auth cookie is set
    const setCookieHeaders = res.headers.getAll('set-cookie');
    const authCookie = setCookieHeaders.find((c) => c.startsWith('auth='));
    expect(authCookie).toBeDefined();
    expect(authCookie).toContain('new_access_token_jwt');
  });

  /** Validates: Requirements 5.7 */
  test('POST /api/v1/auth/refresh with invalid refresh token returns 401', async () => {
    refreshResult = null; // Refresh fails

    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'cookie': 'refresh=invalid_refresh_token' },
      }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });
});
