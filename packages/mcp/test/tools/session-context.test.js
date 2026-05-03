import { describe, test, expect, beforeEach, mock } from 'bun:test';

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

// Import session module AFTER mocking Redis
const { destroySession } = await import('../../src/session.js');
const { register: registerSet } = await import('../../src/tools/set-session-context.js');
const { register: registerGet } = await import('../../src/tools/get-session-context.js');
const { register: registerList } = await import('../../src/tools/list-session-context.js');

function createMockServer() {
  const tools = new Map();
  return {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
    getHandler(name) {
      return tools.get(name)?.handler;
    },
  };
}

const USER_ID = 'test-session-user';
const auth = { userId: USER_ID, scopes: ['agent:read'] };

describe('session context tools', () => {
  let setHandler, getHandler, listHandler;

  beforeEach(async () => {
    resetStore();
    await destroySession(USER_ID);

    const server = createMockServer();
    registerSet(server, auth);
    registerGet(server, auth);
    registerList(server, auth);
    setHandler = server.getHandler('set_session_context');
    getHandler = server.getHandler('get_session_context');
    listHandler = server.getHandler('list_session_context');
  });

  test('set_session_context stores a key-value pair and returns success', async () => {
    const result = await setHandler({ key: 'color', value: 'blue' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ success: true });
  });

  test('get_session_context retrieves a stored value by key', async () => {
    await setHandler({ key: 'lang', value: 'javascript' });
    const result = await getHandler({ key: 'lang' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ value: 'javascript' });
  });

  test('get_session_context returns null for non-existent key', async () => {
    const result = await getHandler({ key: 'missing' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ value: null });
  });

  test('list_session_context returns all stored entries', async () => {
    await setHandler({ key: 'a', value: '1' });
    await setHandler({ key: 'b', value: '2' });
    const result = await listHandler();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.entries).toEqual(
      expect.arrayContaining([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ]),
    );
    expect(parsed.entries.length).toBe(2);
  });

  test('list_session_context returns empty entries when no data stored', async () => {
    const result = await listHandler();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ entries: [] });
  });

  test('rejects 101st key when 100 keys already stored', async () => {
    // Fill 100 keys via the Redis-backed session store
    for (let i = 0; i < 100; i++) {
      const err = await setHandler({ key: `key-${i}`, value: `val-${i}` });
      expect(err.isError).toBeUndefined();
    }

    const result = await setHandler({ key: 'overflow', value: 'nope' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('100');
  });

  test('rejects value exceeding 10KB', async () => {
    const bigValue = 'x'.repeat(10 * 1024 + 1);
    const result = await setHandler({ key: 'big', value: bigValue });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('10KB');
  });

  test('session cleanup: destroySession clears all keys', async () => {
    await setHandler({ key: 'temp', value: 'data' });
    await destroySession(USER_ID);

    const result = await getHandler({ key: 'temp' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ value: null });
  });

  describe('scope enforcement', () => {
    test('set_session_context requires agent:read scope', async () => {
      const server = createMockServer();
      registerSet(server, { userId: USER_ID, scopes: [] });
      const noScopeHandler = server.getHandler('set_session_context');

      const result = await noScopeHandler({ key: 'k', value: 'v' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Insufficient permissions');
    });

    test('get_session_context requires agent:read scope', async () => {
      const server = createMockServer();
      registerGet(server, { userId: USER_ID, scopes: [] });
      const noScopeHandler = server.getHandler('get_session_context');

      const result = await noScopeHandler({ key: 'k' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Insufficient permissions');
    });

    test('list_session_context requires agent:read scope', async () => {
      const server = createMockServer();
      registerList(server, { userId: USER_ID, scopes: [] });
      const noScopeHandler = server.getHandler('list_session_context');

      const result = await noScopeHandler();
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Insufficient permissions');
    });
  });
});
