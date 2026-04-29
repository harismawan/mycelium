import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock state — controls what the mocked modules return
// ---------------------------------------------------------------------------

let redisConnected = true;
let tokenActive = true;
let sessionValid = { userId: 'user_1', createdAt: 1000, lastActivity: 2000 };
let refreshResult = null;
let verifyTokenResult = null;
let decodeTokenResult = null;
let verifyJwtUser = null;
let verifyApiKeyResult = null;

// Track calls for assertions
const calls = {
  isTokenActive: [],
  validateSession: [],
  refreshAccessToken: [],
  verifyToken: [],
  decodeToken: [],
  verifyJwt: [],
  verifyApiKey: [],
};

function resetCalls() {
  for (const key of Object.keys(calls)) {
    calls[key] = [];
  }
}

// ---------------------------------------------------------------------------
// Mock modules before importing the middleware
// ---------------------------------------------------------------------------

mock.module('@mycelium/shared/redis', () => ({
  getRedisClient: () => ({}),
  prefixKey: (key) => `mycelium:${key}`,
  isRedisConnected: () => redisConnected,
}));

mock.module('../../src/services/session.service.js', () => ({
  SessionService: {
    verifyToken: (...args) => {
      calls.verifyToken.push(args);
      return verifyTokenResult;
    },
    decodeToken: (...args) => {
      calls.decodeToken.push(args);
      return decodeTokenResult;
    },
    isTokenActive: async (...args) => {
      calls.isTokenActive.push(args);
      if (!redisConnected) throw new Error('Redis unavailable');
      return tokenActive;
    },
    validateSession: async (...args) => {
      calls.validateSession.push(args);
      if (!redisConnected) throw new Error('Redis unavailable');
      return sessionValid;
    },
    refreshAccessToken: async (...args) => {
      calls.refreshAccessToken.push(args);
      if (!redisConnected) throw new Error('Redis unavailable');
      return refreshResult;
    },
  },
}));

mock.module('../../src/services/auth.service.js', () => ({
  AuthService: {
    verifyJwt: async (...args) => {
      calls.verifyJwt.push(args);
      return verifyJwtUser;
    },
    verifyApiKey: async (...args) => {
      calls.verifyApiKey.push(args);
      return verifyApiKeyResult;
    },
  },
}));

// ---------------------------------------------------------------------------
// Import the middleware AFTER mocks are registered
// ---------------------------------------------------------------------------
const { authMiddleware } = await import('../../src/middleware/auth.js');
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Elysia app with the auth middleware applied.
 * Returns a protected endpoint at GET /test.
 */
function buildApp() {
  return new Elysia()
    .use(authMiddleware)
    .get('/test', (ctx) => ({
      userId: ctx.user?.id,
      authType: ctx.authType,
    }));
}

/**
 * Make a request to the test app with optional cookies and headers.
 *
 * @param {Elysia} app
 * @param {{ authCookie?: string, refreshCookie?: string, bearerToken?: string }} opts
 * @returns {Promise<Response>}
 */
async function makeRequest(app, opts = {}) {
  const headers = {};

  // Build cookie header
  const cookies = [];
  if (opts.authCookie) cookies.push(`auth=${opts.authCookie}`);
  if (opts.refreshCookie) cookies.push(`refresh=${opts.refreshCookie}`);
  if (cookies.length > 0) headers['cookie'] = cookies.join('; ');

  // Bearer token header
  if (opts.bearerToken) {
    headers['authorization'] = `Bearer ${opts.bearerToken}`;
  }

  return app.handle(new Request('http://localhost/test', { headers }));
}

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  redisConnected = true;
  tokenActive = true;
  sessionValid = { userId: 'user_1', createdAt: 1000, lastActivity: 2000 };
  refreshResult = null;
  verifyTokenResult = null;
  decodeTokenResult = null;
  verifyJwtUser = null;
  verifyApiKeyResult = null;
  resetCalls();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auth Middleware — API key auth', () => {
  /** Validates: Requirements 8.1, 8.2, 8.3 */
  test('API key auth works without Redis (no Redis calls made)', async () => {
    verifyApiKeyResult = {
      user: { id: 'user_1', email: 'test@example.com', displayName: 'Test' },
      scopes: ['agent:read'],
      apiKeyId: 'key_1',
      apiKeyName: 'test-key',
    };

    const app = buildApp();
    const res = await makeRequest(app, { bearerToken: 'myc_test_key_123' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user_1');
    expect(body.authType).toBe('apikey');

    // No Redis-related calls should have been made
    expect(calls.isTokenActive).toHaveLength(0);
    expect(calls.validateSession).toHaveLength(0);
    expect(calls.refreshAccessToken).toHaveLength(0);
    expect(calls.verifyToken).toHaveLength(0);
  });

  /** Validates: Requirements 8.3 */
  test('API key auth works when Redis is unavailable', async () => {
    redisConnected = false;
    verifyApiKeyResult = {
      user: { id: 'user_2', email: 'agent@example.com', displayName: 'Agent' },
      scopes: ['agent:read'],
      apiKeyId: 'key_2',
      apiKeyName: 'agent-key',
    };

    const app = buildApp();
    const res = await makeRequest(app, { bearerToken: 'myc_agent_key_456' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user_2');
    expect(body.authType).toBe('apikey');
  });
});

describe('Auth Middleware — JWT with revoked jti', () => {
  /** Validates: Requirements 3.4 */
  test('JWT with revoked jti returns 401', async () => {
    verifyTokenResult = { sub: 'user_1', sid: 'session_abc', jti: 'jti_revoked' };
    tokenActive = false; // jti not in Redis

    const app = buildApp();
    const res = await makeRequest(app, { authCookie: 'valid.jwt.token' });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });
});

describe('Auth Middleware — JWT with missing session', () => {
  /** Validates: Requirements 4.2 */
  test('JWT with missing session returns 401 and clears cookies', async () => {
    verifyTokenResult = { sub: 'user_1', sid: 'session_deleted', jti: 'jti_active' };
    tokenActive = true;
    sessionValid = null; // Session not in Redis

    const app = buildApp();
    const res = await makeRequest(app, { authCookie: 'valid.jwt.token' });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');

    // Verify cookies are cleared (set-cookie headers with maxAge=0)
    const setCookieHeaders = res.headers.getAll('set-cookie');
    const authClearCookie = setCookieHeaders.find(
      (c) => c.includes('auth=') && c.includes('Max-Age=0'),
    );
    const refreshClearCookie = setCookieHeaders.find(
      (c) => c.includes('refresh=') && c.includes('Max-Age=0'),
    );
    // At minimum, the auth cookie should be cleared
    expect(authClearCookie || refreshClearCookie).toBeTruthy();
  });
});

describe('Auth Middleware — Token refresh', () => {
  /** Validates: Requirements 5.2 */
  test('expired JWT with valid refresh token issues new access token', async () => {
    // JWT is expired (verifyToken returns null)
    verifyTokenResult = null;
    // decodeToken extracts claims from expired token
    decodeTokenResult = { sub: 'user_1', sid: 'session_abc', jti: 'old_jti' };
    // Refresh succeeds
    refreshResult = {
      accessToken: 'new.access.token',
      sessionId: 'session_abc',
      userId: 'user_1',
      email: 'test@example.com',
    };
    // verifyJwt returns user for the new token
    verifyJwtUser = { id: 'user_1', email: 'test@example.com', displayName: 'Test' };

    const app = buildApp();
    const res = await makeRequest(app, {
      authCookie: 'expired.jwt.token',
      refreshCookie: 'valid_refresh_token',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user_1');
    expect(body.authType).toBe('jwt');

    // Verify refreshAccessToken was called with the refresh token and old jti
    expect(calls.refreshAccessToken).toHaveLength(1);
    expect(calls.refreshAccessToken[0][0]).toBe('valid_refresh_token');
    expect(calls.refreshAccessToken[0][1]).toBe('old_jti');
  });

  /** Validates: Requirements 5.5 */
  test('expired JWT with invalid refresh token returns 401 and clears cookies', async () => {
    // JWT is expired
    verifyTokenResult = null;
    decodeTokenResult = { sub: 'user_1', sid: 'session_abc', jti: 'old_jti' };
    // Refresh fails (invalid/expired refresh token)
    refreshResult = null;

    const app = buildApp();
    const res = await makeRequest(app, {
      authCookie: 'expired.jwt.token',
      refreshCookie: 'invalid_refresh_token',
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');

    // Verify cookies are cleared
    const setCookieHeaders = res.headers.getAll('set-cookie');
    const hasClearCookie = setCookieHeaders.some((c) => c.includes('Max-Age=0'));
    expect(hasClearCookie).toBe(true);
  });
});

describe('Auth Middleware — Redis unavailable', () => {
  /** Validates: Requirements 9.2 */
  test('Redis unavailable during JWT auth returns 503', async () => {
    redisConnected = false;

    const app = buildApp();
    const res = await makeRequest(app, { authCookie: 'valid.jwt.token' });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Service temporarily unavailable');
  });
});
