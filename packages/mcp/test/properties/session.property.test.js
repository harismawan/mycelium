import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock Redis implementation — in-memory Map simulating Redis commands
// ---------------------------------------------------------------------------

let store = new Map();
let sets = new Map();
let ttls = new Map();

function resetStore() {
  store = new Map();
  sets = new Map();
  ttls = new Map();
}

const mockRedisClient = {
  get: async (key) => store.get(key) ?? null,
  set: async (key, value) => { store.set(key, value); },
  del: async (...keys) => {
    for (const k of keys) {
      store.delete(k);
      sets.delete(k);
      ttls.delete(k);
    }
  },
  exists: async (key) => (store.has(key) || sets.has(key)) ? 1 : 0,
  sadd: async (key, ...members) => {
    if (!sets.has(key)) sets.set(key, new Set());
    const s = sets.get(key);
    for (const m of members) s.add(m);
  },
  smembers: async (key) => {
    const s = sets.get(key);
    return s ? [...s] : [];
  },
  expire: async (key, seconds) => {
    ttls.set(key, seconds);
    return 1;
  },
  ttl: async (key) => ttls.get(key) ?? -1,
};

mock.module('@mycelium/shared/redis', () => ({
  getRedisClient: () => mockRedisClient,
  prefixKey: (key) => `mycelium:${key}`,
  isRedisConnected: () => true,
}));

const {
  getSessionValue,
  setSessionValue,
  listSessionValues,
  destroySession,
  validateSessionLimits,
} = await import('../../src/session.js');

// ---------------------------------------------------------------------------
// Helpers — simple random generators (no fast-check)
// ---------------------------------------------------------------------------

function randomString(minLen = 1, maxLen = 20) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function randomConnectionId() {
  return `conn-${randomString(8, 16)}`;
}

function randomKey() {
  return randomString(1, 30);
}

function randomValue(maxBytes = 1024) {
  const len = 1 + Math.floor(Math.random() * Math.min(maxBytes, 1024));
  return randomString(len, len);
}

// ---------------------------------------------------------------------------
// Property 9: MCP session context round-trip
// **Validates: Requirements 7.7**
// ---------------------------------------------------------------------------

describe('Feature: session-management-redis, Property 9: MCP session context round-trip', () => {
  beforeEach(() => resetStore());

  test('storing then retrieving a value returns the original value unchanged (100 iterations)', async () => {
    for (let i = 0; i < 100; i++) {
      resetStore();
      const connId = randomConnectionId();
      const key = randomKey();
      const value = randomValue(512);

      const err = await setSessionValue(connId, key, value);
      expect(err).toBeNull();

      const retrieved = await getSessionValue(connId, key);
      expect(retrieved).toBe(value);
    }
  });

  test('multiple keys in the same session each round-trip independently', async () => {
    const connId = randomConnectionId();
    const pairs = [];

    for (let i = 0; i < 20; i++) {
      const key = `key-${i}-${randomString(3, 8)}`;
      const value = randomValue(256);
      pairs.push({ key, value });

      const err = await setSessionValue(connId, key, value);
      expect(err).toBeNull();
    }

    for (const { key, value } of pairs) {
      const retrieved = await getSessionValue(connId, key);
      expect(retrieved).toBe(value);
    }
  });

  test('overwriting a key returns the new value', async () => {
    for (let i = 0; i < 20; i++) {
      resetStore();
      const connId = randomConnectionId();
      const key = randomKey();
      const value1 = randomValue(256);
      const value2 = randomValue(256);

      await setSessionValue(connId, key, value1);
      await setSessionValue(connId, key, value2);

      const retrieved = await getSessionValue(connId, key);
      expect(retrieved).toBe(value2);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 10: MCP session context TTL management
// **Validates: Requirements 7.2, 7.3**
// ---------------------------------------------------------------------------

describe('Feature: session-management-redis, Property 10: MCP session context TTL management', () => {
  beforeEach(() => resetStore());

  test('after a write, TTL is set to 86400 seconds (50 iterations)', async () => {
    for (let i = 0; i < 50; i++) {
      resetStore();
      const connId = randomConnectionId();
      const key = randomKey();
      const value = randomValue(256);

      await setSessionValue(connId, key, value);

      // Check TTL on the value key
      const redisKey = `mycelium:mcp:${connId}:${key}`;
      const valueTtl = ttls.get(redisKey);
      expect(valueTtl).toBe(86400);

      // Check TTL on the tracking set
      const trackingKey = `mycelium:mcp:${connId}:_keys`;
      const trackingTtl = ttls.get(trackingKey);
      expect(trackingTtl).toBe(86400);
    }
  });

  test('after a read, TTL is reset to 86400 seconds (50 iterations)', async () => {
    for (let i = 0; i < 50; i++) {
      resetStore();
      const connId = randomConnectionId();
      const key = randomKey();
      const value = randomValue(256);

      await setSessionValue(connId, key, value);

      // Simulate TTL decay by setting a lower value
      const redisKey = `mycelium:mcp:${connId}:${key}`;
      const trackingKey = `mycelium:mcp:${connId}:_keys`;
      ttls.set(redisKey, 1000);
      ttls.set(trackingKey, 1000);

      // Read should reset TTL
      await getSessionValue(connId, key);

      expect(ttls.get(redisKey)).toBe(86400);
      expect(ttls.get(trackingKey)).toBe(86400);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 11: MCP session context limit enforcement
// **Validates: Requirements 7.4, 7.5**
// ---------------------------------------------------------------------------

describe('Feature: session-management-redis, Property 11: MCP session context limit enforcement', () => {
  beforeEach(() => resetStore());

  test('at 100 keys, adding a new key is rejected', async () => {
    const connId = randomConnectionId();

    // Fill up to 100 keys
    for (let i = 0; i < 100; i++) {
      const err = await setSessionValue(connId, `key-${i}`, `val-${i}`);
      expect(err).toBeNull();
    }

    // 101st key should be rejected
    for (let attempt = 0; attempt < 10; attempt++) {
      const newKey = `overflow-${randomString(5, 10)}`;
      const err = await setSessionValue(connId, newKey, 'nope');
      expect(err).not.toBeNull();
      expect(err).toContain('100');
    }
  });

  test('updating an existing key at 100 keys is allowed', async () => {
    const connId = randomConnectionId();

    for (let i = 0; i < 100; i++) {
      await setSessionValue(connId, `key-${i}`, `val-${i}`);
    }

    // Updating an existing key should succeed
    const err = await setSessionValue(connId, 'key-50', 'updated-value');
    expect(err).toBeNull();

    const retrieved = await getSessionValue(connId, 'key-50');
    expect(retrieved).toBe('updated-value');
  });

  test('a value exceeding 10KB is rejected regardless of key count', async () => {
    for (let i = 0; i < 10; i++) {
      resetStore();
      const connId = randomConnectionId();
      // Create a value that exceeds 10KB
      const bigValue = 'x'.repeat(10 * 1024 + 1 + Math.floor(Math.random() * 1000));

      const err = await setSessionValue(connId, randomKey(), bigValue);
      expect(err).not.toBeNull();
      expect(err).toContain('10KB');
    }
  });

  test('a value exactly at 10KB is accepted', async () => {
    resetStore();
    const connId = randomConnectionId();
    const exactValue = 'a'.repeat(10 * 1024);

    const err = await setSessionValue(connId, 'exact-limit', exactValue);
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property 12: MCP session destroy cleanup
// **Validates: Requirements 7.6**
// ---------------------------------------------------------------------------

describe('Feature: session-management-redis, Property 12: MCP session destroy cleanup', () => {
  beforeEach(() => resetStore());

  test('destroySession removes all keys and the tracking set (20 iterations)', async () => {
    for (let i = 0; i < 20; i++) {
      resetStore();
      const connId = randomConnectionId();
      const numKeys = 1 + Math.floor(Math.random() * 15);

      // Store N key-value pairs
      for (let j = 0; j < numKeys; j++) {
        const err = await setSessionValue(connId, `key-${j}`, `value-${j}`);
        expect(err).toBeNull();
      }

      // Verify keys exist before destroy
      const entriesBefore = await listSessionValues(connId);
      expect(entriesBefore.length).toBe(numKeys);

      // Destroy the session
      await destroySession(connId);

      // Verify all keys are gone
      const entriesAfter = await listSessionValues(connId);
      expect(entriesAfter.length).toBe(0);

      // Verify individual keys return null
      for (let j = 0; j < numKeys; j++) {
        const val = await getSessionValue(connId, `key-${j}`);
        expect(val).toBeNull();
      }

      // Verify the tracking set is gone
      const trackingKey = `mycelium:mcp:${connId}:_keys`;
      expect(sets.has(trackingKey)).toBe(false);
    }
  });

  test('destroySession on an empty session is a no-op', async () => {
    const connId = randomConnectionId();

    // Should not throw
    await destroySession(connId);

    const entries = await listSessionValues(connId);
    expect(entries.length).toBe(0);
  });

  test('after destroy, new keys can be stored in the same connectionId', async () => {
    const connId = randomConnectionId();

    await setSessionValue(connId, 'before', 'data');
    await destroySession(connId);

    const err = await setSessionValue(connId, 'after', 'new-data');
    expect(err).toBeNull();

    const val = await getSessionValue(connId, 'after');
    expect(val).toBe('new-data');

    // Old key should still be gone
    const oldVal = await getSessionValue(connId, 'before');
    expect(oldVal).toBeNull();
  });
});
