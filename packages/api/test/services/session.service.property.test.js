import { describe, test, expect, mock, beforeEach } from 'bun:test';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Mock Redis implementation — in-memory Map simulating Redis commands
// ---------------------------------------------------------------------------

/** @type {Map<string, any>} Main key-value store */
let store = new Map();
/** @type {Map<string, number>} TTL tracking (key → expiry timestamp in seconds) */
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
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random user ID string */
function randomUserId() {
  const len = 8 + Math.floor(Math.random() * 16);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  let id = 'user_';
  for (let i = 0; i < len; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/** Generate a random email */
function randomEmail() {
  const len = 5 + Math.floor(Math.random() * 10);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let local = '';
  for (let i = 0; i < len; i++) {
    local += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${local}@example.com`;
}

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  resetStore();
});


// ---------------------------------------------------------------------------
// Property 2: Session creation completeness
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2**
// ---------------------------------------------------------------------------
describe('Feature: session-management-redis, Property 2: Session creation completeness', () => {
  test('createSession produces correct session record, access token, and refresh token for 100 random users', async () => {
    for (let i = 0; i < 100; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const result = await SessionService.createSession(userId, email);
      const { session, tokens } = result;

      // Session record has correct userId
      expect(session.userId).toBe(userId);

      // sessionId is 64 hex chars (32 bytes)
      expect(session.sessionId).toMatch(/^[0-9a-f]{64}$/);

      // Timestamps are present and reasonable
      expect(typeof session.createdAt).toBe('number');
      expect(typeof session.lastActivity).toBe('number');
      expect(session.createdAt).toBe(session.lastActivity);

      // Session hash stored in Redis with correct data
      const sessionKey = `mycelium:session:${session.sessionId}`;
      const sessionData = await mockRedisClient.hgetall(sessionKey);
      expect(sessionData).not.toBeNull();
      expect(sessionData.userId).toBe(userId);

      // Session TTL is ~7 days (604800 seconds)
      const sessionTtl = await mockRedisClient.ttl(sessionKey);
      expect(sessionTtl).toBeGreaterThanOrEqual(604795);
      expect(sessionTtl).toBeLessThanOrEqual(604805);

      // Access token is a valid JWT
      const decoded = jwt.verify(tokens.accessToken, JWT_SECRET);
      expect(decoded.sub).toBe(userId);
      expect(decoded.sid).toBe(session.sessionId);
      expect(decoded.jti).toMatch(/^[0-9a-f]{64}$/);

      // JWT expiration is ~1 day from now
      const nowSec = Math.floor(Date.now() / 1000);
      expect(decoded.exp - nowSec).toBeGreaterThanOrEqual(86390);
      expect(decoded.exp - nowSec).toBeLessThanOrEqual(86410);

      // Refresh token is 64 hex chars
      expect(tokens.refreshToken).toMatch(/^[0-9a-f]{64}$/);

      // Refresh token stored in Redis
      const refreshKey = `mycelium:refresh:${tokens.refreshToken}`;
      const refreshMapping = await mockRedisClient.get(refreshKey);
      expect(refreshMapping).toBe(`${session.sessionId}:${userId}`);

      // Refresh token TTL is ~7 days
      const refreshTtl = await mockRedisClient.ttl(refreshKey);
      expect(refreshTtl).toBeGreaterThanOrEqual(604795);
      expect(refreshTtl).toBeLessThanOrEqual(604805);

      // jti stored in Redis with TTL ~1 day
      const jtiKey = `mycelium:jti:${decoded.jti}`;
      const jtiMapping = await mockRedisClient.get(jtiKey);
      expect(jtiMapping).toBe(`${session.sessionId}:${userId}`);
      const jtiTtl = await mockRedisClient.ttl(jtiKey);
      expect(jtiTtl).toBeGreaterThanOrEqual(86395);
      expect(jtiTtl).toBeLessThanOrEqual(86405);

      // jti is tracked in the session's jti set
      const jtiSetKey = `mycelium:session:${session.sessionId}:jtis`;
      const jtis = await mockRedisClient.smembers(jtiSetKey);
      expect(jtis).toContain(decoded.jti);
    }
  });

  test('each createSession call produces unique sessionId, jti, and refreshToken', async () => {
    const sessionIds = new Set();
    const jtis = new Set();
    const refreshTokens = new Set();

    for (let i = 0; i < 50; i++) {
      resetStore();
      const result = await SessionService.createSession(randomUserId(), randomEmail());
      sessionIds.add(result.session.sessionId);
      refreshTokens.add(result.tokens.refreshToken);

      const decoded = jwt.decode(result.tokens.accessToken);
      jtis.add(decoded.jti);
    }

    expect(sessionIds.size).toBe(50);
    expect(jtis.size).toBe(50);
    expect(refreshTokens.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Property 3: Revoked jti means rejection
// **Validates: Requirements 3.3, 3.4, 3.5**
// ---------------------------------------------------------------------------
describe('Feature: session-management-redis, Property 3: Revoked jti means rejection', () => {
  test('after removing jti from Redis, isTokenActive returns false for 100 random sessions', async () => {
    for (let i = 0; i < 100; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const { tokens } = await SessionService.createSession(userId, email);
      const decoded = jwt.decode(tokens.accessToken);
      const jti = decoded.jti;

      // jti should be active initially
      const activeBefore = await SessionService.isTokenActive(jti);
      expect(activeBefore).toBe(true);

      // Remove the jti from Redis (simulating revocation)
      const jtiKey = `mycelium:jti:${jti}`;
      await mockRedisClient.del(jtiKey);

      // jti should now be inactive
      const activeAfter = await SessionService.isTokenActive(jti);
      expect(activeAfter).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 4: Session revocation completeness
// **Validates: Requirements 3.6, 3.8, 6.1, 6.2**
// ---------------------------------------------------------------------------
describe('Feature: session-management-redis, Property 4: Session revocation completeness', () => {
  test('revokeSession removes all associated keys for 50 random sessions', async () => {
    for (let i = 0; i < 50; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const { session, tokens } = await SessionService.createSession(userId, email);
      const decoded = jwt.decode(tokens.accessToken);

      const sessionKey = `mycelium:session:${session.sessionId}`;
      const jtiSetKey = `mycelium:session:${session.sessionId}:jtis`;
      const jtiKey = `mycelium:jti:${decoded.jti}`;
      const refreshKey = `mycelium:refresh:${tokens.refreshToken}`;

      // All keys should exist before revocation
      expect(await mockRedisClient.exists(sessionKey)).toBe(1);
      expect(await mockRedisClient.exists(jtiKey)).toBe(1);
      expect(await mockRedisClient.exists(refreshKey)).toBe(1);

      // Revoke the session
      await SessionService.revokeSession(session.sessionId);

      // All keys should be gone after revocation
      expect(await mockRedisClient.exists(sessionKey)).toBe(0);
      expect(await mockRedisClient.exists(jtiSetKey)).toBe(0);
      expect(await mockRedisClient.exists(jtiKey)).toBe(0);
      expect(await mockRedisClient.exists(refreshKey)).toBe(0);
    }
  });

  test('revokeSession removes all jtis after multiple refreshes', async () => {
    for (let i = 0; i < 20; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const { session, tokens } = await SessionService.createSession(userId, email);
      let currentDecoded = jwt.decode(tokens.accessToken);
      const allJtis = [currentDecoded.jti];

      // Perform 2-3 refreshes to accumulate multiple jtis
      const numRefreshes = 2 + Math.floor(Math.random() * 2);
      let currentRefreshToken = tokens.refreshToken;
      let oldJti = currentDecoded.jti;

      for (let r = 0; r < numRefreshes; r++) {
        const refreshResult = await SessionService.refreshAccessToken(currentRefreshToken, oldJti);
        expect(refreshResult).not.toBeNull();
        const newDecoded = jwt.decode(refreshResult.accessToken);
        allJtis.push(newDecoded.jti);
        oldJti = newDecoded.jti;
      }

      // Revoke the session
      await SessionService.revokeSession(session.sessionId);

      // All jti keys should be gone
      for (const jti of allJtis) {
        const jtiKey = `mycelium:jti:${jti}`;
        expect(await mockRedisClient.exists(jtiKey)).toBe(0);
      }

      // Session and refresh keys should be gone
      expect(await mockRedisClient.exists(`mycelium:session:${session.sessionId}`)).toBe(0);
      expect(await mockRedisClient.exists(`mycelium:refresh:${tokens.refreshToken}`)).toBe(0);
      expect(await mockRedisClient.exists(`mycelium:session:${session.sessionId}:jtis`)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 5: Missing session means rejection
// **Validates: Requirements 4.1, 4.2**
// ---------------------------------------------------------------------------
describe('Feature: session-management-redis, Property 5: Missing session means rejection', () => {
  test('after deleting session hash, validateSession returns null for 100 random sessions', async () => {
    for (let i = 0; i < 100; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const { session } = await SessionService.createSession(userId, email);

      // Session should be valid initially
      const validBefore = await SessionService.validateSession(session.sessionId);
      expect(validBefore).not.toBeNull();
      expect(validBefore.userId).toBe(userId);

      // Delete the session hash from Redis
      const sessionKey = `mycelium:session:${session.sessionId}`;
      hashes.delete(sessionKey);

      // Session should now return null
      const validAfter = await SessionService.validateSession(session.sessionId);
      expect(validAfter).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Property 6: Session touch updates activity and resets TTL
// **Validates: Requirements 4.3, 5.1**
// ---------------------------------------------------------------------------
describe('Feature: session-management-redis, Property 6: Session touch updates activity and resets TTL', () => {
  test('validateSession updates lastActivity and resets TTL for 100 random sessions', async () => {
    for (let i = 0; i < 100; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const { session } = await SessionService.createSession(userId, email);
      const sessionKey = `mycelium:session:${session.sessionId}`;

      // Record the initial lastActivity
      const initialData = await mockRedisClient.hgetall(sessionKey);
      const initialLastActivity = Number(initialData.lastActivity);

      // Validate the session (this should touch it)
      const validated = await SessionService.validateSession(session.sessionId);
      expect(validated).not.toBeNull();
      expect(validated.userId).toBe(userId);

      // lastActivity should be updated to approximately now
      const nowSec = Math.floor(Date.now() / 1000);
      expect(validated.lastActivity).toBeGreaterThanOrEqual(initialLastActivity);
      expect(validated.lastActivity).toBeGreaterThanOrEqual(nowSec - 2);
      expect(validated.lastActivity).toBeLessThanOrEqual(nowSec + 2);

      // TTL should be reset to ~7 days
      const sessionTtl = await mockRedisClient.ttl(sessionKey);
      expect(sessionTtl).toBeGreaterThanOrEqual(604795);
      expect(sessionTtl).toBeLessThanOrEqual(604805);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 7: Token refresh preserves session and rotates access token
// **Validates: Requirements 5.2, 5.3, 5.4, 5.6**
// ---------------------------------------------------------------------------
describe('Feature: session-management-redis, Property 7: Token refresh preserves session and rotates access token', () => {
  test('refreshAccessToken issues new token with new jti, removes old jti, keeps same session for 50 random sessions', async () => {
    for (let i = 0; i < 50; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const { session, tokens } = await SessionService.createSession(userId, email);
      const oldDecoded = jwt.decode(tokens.accessToken);
      const oldJti = oldDecoded.jti;

      // Refresh the access token
      const refreshResult = await SessionService.refreshAccessToken(tokens.refreshToken, oldJti);
      expect(refreshResult).not.toBeNull();

      // New access token should be a valid JWT
      const newDecoded = jwt.decode(refreshResult.accessToken);
      expect(newDecoded.sub).toBe(userId);
      expect(newDecoded.sid).toBe(session.sessionId);

      // New jti should be different from old jti
      expect(newDecoded.jti).not.toBe(oldJti);
      expect(newDecoded.jti).toMatch(/^[0-9a-f]{64}$/);

      // New jti should be registered in Redis
      const newJtiKey = `mycelium:jti:${newDecoded.jti}`;
      expect(await mockRedisClient.exists(newJtiKey)).toBe(1);

      // Old jti should be removed from Redis
      const oldJtiKey = `mycelium:jti:${oldJti}`;
      expect(await mockRedisClient.exists(oldJtiKey)).toBe(0);

      // Same sessionId is retained
      expect(refreshResult.sessionId).toBe(session.sessionId);

      // Refresh token key still exists with reset TTL
      const refreshKey = `mycelium:refresh:${tokens.refreshToken}`;
      expect(await mockRedisClient.exists(refreshKey)).toBe(1);
      const refreshTtl = await mockRedisClient.ttl(refreshKey);
      expect(refreshTtl).toBeGreaterThanOrEqual(604795);
      expect(refreshTtl).toBeLessThanOrEqual(604805);

      // Session TTL is also reset
      const sessionKey = `mycelium:session:${session.sessionId}`;
      const sessionTtl = await mockRedisClient.ttl(sessionKey);
      expect(sessionTtl).toBeGreaterThanOrEqual(604795);
      expect(sessionTtl).toBeLessThanOrEqual(604805);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 8: Invalid refresh token means rejection
// **Validates: Requirements 5.5**
// ---------------------------------------------------------------------------
describe('Feature: session-management-redis, Property 8: Invalid refresh token means rejection', () => {
  test('refreshAccessToken with non-existent refresh token returns null and registers no new jti for 100 random tokens', async () => {
    for (let i = 0; i < 100; i++) {
      resetStore();

      // Generate a random fake refresh token (64 hex chars)
      const fakeRefreshToken = Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      // Count existing jti keys before the attempt
      const keysBefore = new Set();
      for (const key of store.keys()) {
        if (key.startsWith('mycelium:jti:')) keysBefore.add(key);
      }

      // Attempt to refresh with the fake token
      const result = await SessionService.refreshAccessToken(fakeRefreshToken, 'fake-old-jti');
      expect(result).toBeNull();

      // No new jti keys should have been registered
      const keysAfter = new Set();
      for (const key of store.keys()) {
        if (key.startsWith('mycelium:jti:')) keysAfter.add(key);
      }
      expect(keysAfter.size).toBe(keysBefore.size);
    }
  });

  test('refreshAccessToken returns null after refresh token is deleted from Redis', async () => {
    for (let i = 0; i < 50; i++) {
      resetStore();
      const userId = randomUserId();
      const email = randomEmail();

      const { tokens } = await SessionService.createSession(userId, email);
      const decoded = jwt.decode(tokens.accessToken);

      // Delete the refresh token from Redis
      const refreshKey = `mycelium:refresh:${tokens.refreshToken}`;
      await mockRedisClient.del(refreshKey);

      // Attempt to refresh should fail
      const result = await SessionService.refreshAccessToken(tokens.refreshToken, decoded.jti);
      expect(result).toBeNull();
    }
  });
});
