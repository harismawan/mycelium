import { describe, test, expect, mock, beforeEach } from 'bun:test';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Mock Redis implementation — in-memory Map simulating Redis commands
// ---------------------------------------------------------------------------

/** @type {Map<string, any>} Main key-value store */
let store = new Map();
/** @type {Map<string, number>} TTL tracking */
let ttls = new Map();
/** @type {Map<string, Set<string>>} Set data type storage */
let sets = new Map();
/** @type {Map<string, Map<string, string>>} Hash data type storage */
let hashes = new Map();

function resetStore() {
  store = new Map();
  ttls = new Map();
  sets = new Map();
  hashes = new Map();
}

const mockRedisClient = {
  get: async (key) => store.get(key) ?? null,
  set: async (key, value) => { store.set(key, value); },
  del: async (...keys) => {
    let count = 0;
    for (const key of keys) {
      if (store.has(key) || hashes.has(key) || sets.has(key)) count++;
      store.delete(key);
      hashes.delete(key);
      sets.delete(key);
      ttls.delete(key);
    }
    return count;
  },
  exists: async (key) => (store.has(key) || hashes.has(key) || sets.has(key)) ? 1 : 0,
  hset: async (key, obj) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    const h = hashes.get(key);
    for (const [field, value] of Object.entries(obj)) {
      h.set(field, value);
    }
  },
  hgetall: async (key) => {
    const h = hashes.get(key);
    if (!h || h.size === 0) return null;
    const result = {};
    for (const [field, value] of h.entries()) {
      result[field] = value;
    }
    return result;
  },
  sadd: async (key, ...members) => {
    if (!sets.has(key)) sets.set(key, new Set());
    const s = sets.get(key);
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) { s.add(m); added++; }
    }
    return added;
  },
  smembers: async (key) => {
    const s = sets.get(key);
    return s ? [...s] : [];
  },
  srem: async (key, ...members) => {
    const s = sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) {
      if (s.delete(m)) removed++;
    }
    return removed;
  },
  expire: async (key, seconds) => {
    ttls.set(key, seconds);
    return 1;
  },
  ttl: async (key) => ttls.get(key) ?? -1,
};

// ---------------------------------------------------------------------------
// Mock the redis module before importing the service
// ---------------------------------------------------------------------------
mock.module('@mycelium/shared/redis', () => ({
  getRedisClient: () => mockRedisClient,
  prefixKey: (key) => `mycelium:${key}`,
  isRedisConnected: () => true,
}));

// ---------------------------------------------------------------------------
// Import SessionService AFTER mocks are registered
// ---------------------------------------------------------------------------
const { SessionService } = await import('../../src/services/session.service.js');

const JWT_SECRET = process.env.JWT_SECRET || 'mycelium-dev-secret-change-in-production';

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// Unit Tests for Session Service
// ---------------------------------------------------------------------------

describe('SessionService.createSession', () => {
  /** Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6 */
  test('stores all expected keys in Redis', async () => {
    const userId = 'user_unit_test_001';
    const email = 'unit@example.com';

    const { session, tokens } = await SessionService.createSession(userId, email);

    // Session hash exists
    const sessionKey = `mycelium:session:${session.sessionId}`;
    const sessionData = await mockRedisClient.hgetall(sessionKey);
    expect(sessionData).not.toBeNull();
    expect(sessionData.userId).toBe(userId);
    expect(sessionData.createdAt).toBeDefined();
    expect(sessionData.lastActivity).toBeDefined();
    expect(sessionData.refreshToken).toBe(tokens.refreshToken);

    // jti key exists
    const decoded = jwt.decode(tokens.accessToken);
    const jtiKey = `mycelium:jti:${decoded.jti}`;
    expect(await mockRedisClient.get(jtiKey)).toBe(`${session.sessionId}:${userId}`);

    // Refresh token key exists
    const refreshKey = `mycelium:refresh:${tokens.refreshToken}`;
    expect(await mockRedisClient.get(refreshKey)).toBe(`${session.sessionId}:${userId}`);

    // jti set exists and contains the jti
    const jtiSetKey = `mycelium:session:${session.sessionId}:jtis`;
    const jtis = await mockRedisClient.smembers(jtiSetKey);
    expect(jtis).toContain(decoded.jti);
  });

  test('access token contains correct JWT claims', async () => {
    const userId = 'user_jwt_claims';
    const email = 'claims@example.com';

    const { session, tokens } = await SessionService.createSession(userId, email);
    const decoded = jwt.verify(tokens.accessToken, JWT_SECRET);

    expect(decoded.sub).toBe(userId);
    expect(decoded.email).toBe(email);
    expect(decoded.sid).toBe(session.sessionId);
    expect(decoded.jti).toBeDefined();
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
  });
});

describe('SessionService.validateSession', () => {
  /** Validates: Requirements 4.1, 4.2 */
  test('returns null for non-existent session', async () => {
    const result = await SessionService.validateSession('nonexistent_session_id_1234567890abcdef');
    expect(result).toBeNull();
  });

  test('returns session data for existing session', async () => {
    const { session } = await SessionService.createSession('user_validate', 'validate@example.com');

    const result = await SessionService.validateSession(session.sessionId);
    expect(result).not.toBeNull();
    expect(result.userId).toBe('user_validate');
    expect(typeof result.createdAt).toBe('number');
    expect(typeof result.lastActivity).toBe('number');
  });
});

describe('SessionService.isTokenActive', () => {
  /** Validates: Requirements 3.3, 3.4 */
  test('returns false for non-existent jti', async () => {
    const result = await SessionService.isTokenActive('nonexistent_jti_abcdef1234567890');
    expect(result).toBe(false);
  });

  test('returns true for active jti', async () => {
    const { tokens } = await SessionService.createSession('user_active', 'active@example.com');
    const decoded = jwt.decode(tokens.accessToken);

    const result = await SessionService.isTokenActive(decoded.jti);
    expect(result).toBe(true);
  });
});

describe('SessionService.revokeSession', () => {
  /** Validates: Requirements 3.6, 3.8, 6.1, 6.2, 6.4 */
  test('cleans up all keys associated with the session', async () => {
    const { session, tokens } = await SessionService.createSession('user_revoke', 'revoke@example.com');
    const decoded = jwt.decode(tokens.accessToken);

    // Verify keys exist before revocation
    expect(await mockRedisClient.exists(`mycelium:session:${session.sessionId}`)).toBe(1);
    expect(await mockRedisClient.exists(`mycelium:jti:${decoded.jti}`)).toBe(1);
    expect(await mockRedisClient.exists(`mycelium:refresh:${tokens.refreshToken}`)).toBe(1);

    await SessionService.revokeSession(session.sessionId);

    // All keys should be deleted
    expect(await mockRedisClient.exists(`mycelium:session:${session.sessionId}`)).toBe(0);
    expect(await mockRedisClient.exists(`mycelium:session:${session.sessionId}:jtis`)).toBe(0);
    expect(await mockRedisClient.exists(`mycelium:jti:${decoded.jti}`)).toBe(0);
    expect(await mockRedisClient.exists(`mycelium:refresh:${tokens.refreshToken}`)).toBe(0);
  });

  test('revokeSession is safe to call on already-revoked session', async () => {
    const { session } = await SessionService.createSession('user_double_revoke', 'double@example.com');

    await SessionService.revokeSession(session.sessionId);
    // Should not throw on second call
    await SessionService.revokeSession(session.sessionId);
  });
});

describe('SessionService.refreshAccessToken', () => {
  /** Validates: Requirements 5.5 */
  test('returns null for invalid refresh token', async () => {
    const result = await SessionService.refreshAccessToken('invalid_refresh_token_that_does_not_exist');
    expect(result).toBeNull();
  });

  test('returns new access token for valid refresh token', async () => {
    const { session, tokens } = await SessionService.createSession('user_refresh', 'refresh@example.com');
    const oldDecoded = jwt.decode(tokens.accessToken);

    const result = await SessionService.refreshAccessToken(tokens.refreshToken, oldDecoded.jti);
    expect(result).not.toBeNull();
    expect(result.sessionId).toBe(session.sessionId);
    expect(result.userId).toBe('user_refresh');

    const newDecoded = jwt.decode(result.accessToken);
    expect(newDecoded.sub).toBe('user_refresh');
    expect(newDecoded.sid).toBe(session.sessionId);
    expect(newDecoded.jti).not.toBe(oldDecoded.jti);
  });
});

describe('SessionService.revokeByRefreshToken', () => {
  test('revokes session when given a valid refresh token', async () => {
    const { session, tokens } = await SessionService.createSession('user_revoke_rt', 'rrt@example.com');

    await SessionService.revokeByRefreshToken(tokens.refreshToken);

    expect(await mockRedisClient.exists(`mycelium:session:${session.sessionId}`)).toBe(0);
    expect(await mockRedisClient.exists(`mycelium:refresh:${tokens.refreshToken}`)).toBe(0);
  });

  test('does not throw for non-existent refresh token', async () => {
    // Should not throw
    await SessionService.revokeByRefreshToken('nonexistent_refresh_token');
  });
});

describe('SessionService.decodeToken', () => {
  /** Validates: decodeToken works on expired tokens */
  test('decodes a valid JWT without verification', async () => {
    const { tokens } = await SessionService.createSession('user_decode', 'decode@example.com');

    const decoded = SessionService.decodeToken(tokens.accessToken);
    expect(decoded).not.toBeNull();
    expect(decoded.sub).toBe('user_decode');
    expect(decoded.sid).toBeDefined();
    expect(decoded.jti).toBeDefined();
  });

  test('decodes an expired JWT without throwing', () => {
    // Create a token that expired 1 hour ago
    const expiredToken = jwt.sign(
      { sub: 'user_expired', sid: 'session_123', jti: 'jti_456' },
      JWT_SECRET,
      { expiresIn: -3600 },
    );

    const decoded = SessionService.decodeToken(expiredToken);
    expect(decoded).not.toBeNull();
    expect(decoded.sub).toBe('user_expired');
    expect(decoded.sid).toBe('session_123');
    expect(decoded.jti).toBe('jti_456');
  });

  test('returns null for completely invalid token string', () => {
    const decoded = SessionService.decodeToken('not-a-jwt-at-all');
    // jwt.decode returns null for non-JWT strings
    expect(decoded).toBeNull();
  });
});

describe('SessionService.verifyToken', () => {
  test('verifies a valid JWT and returns payload', async () => {
    const { tokens } = await SessionService.createSession('user_verify', 'verify@example.com');

    const payload = SessionService.verifyToken(tokens.accessToken);
    expect(payload).not.toBeNull();
    expect(payload.sub).toBe('user_verify');
  });

  test('returns null for expired JWT', () => {
    const expiredToken = jwt.sign(
      { sub: 'user_expired', sid: 'session_123', jti: 'jti_456' },
      JWT_SECRET,
      { expiresIn: -3600 },
    );

    const result = SessionService.verifyToken(expiredToken);
    expect(result).toBeNull();
  });

  test('returns null for invalid JWT', () => {
    const result = SessionService.verifyToken('invalid.jwt.token');
    expect(result).toBeNull();
  });
});
