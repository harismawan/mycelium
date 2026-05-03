import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// Mock Redis — in-memory sorted set simulation
// ---------------------------------------------------------------------------

/** @type {Map<string, Map<string, number>>} key → (member → score) */
let sortedSets = new Map();
/** @type {Map<string, number>} key → TTL */
let ttls = new Map();

function resetStore() {
  sortedSets = new Map();
  ttls = new Map();
}

const mockRedisClient = {
  zadd: async (key, score, member) => {
    if (!sortedSets.has(key)) sortedSets.set(key, new Map());
    sortedSets.get(key).set(member, score);
  },
  zcard: async (key) => {
    const set = sortedSets.get(key);
    return set ? set.size : 0;
  },
  zrange: async (key, start, stop) => {
    const set = sortedSets.get(key);
    if (!set || set.size === 0) return [];
    const sorted = [...set.entries()].sort((a, b) => a[1] - b[1]);
    const slice = sorted.slice(start, stop + 1);
    return slice.map(([member]) => member);
  },
  zremrangebyscore: async (key, min, max) => {
    const set = sortedSets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const [member, score] of set.entries()) {
      if (score >= min && score <= max) {
        set.delete(member);
        removed++;
      }
    }
    return removed;
  },
  expire: async (key, seconds) => {
    ttls.set(key, seconds);
    return 1;
  },
};

mock.module('@mycelium/shared/redis', () => ({
  getRedisClient: () => mockRedisClient,
  prefixKey: (key) => `mycelium:${key}`,
  isRedisConnected: () => true,
}));

const { rateLimiter } = await import('../../src/middleware/rate-limiter.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(config) {
  return new Elysia()
    .derive((ctx) => {
      const authType = ctx.request.headers.get('x-test-auth-type') || null;
      const apiKeyId = ctx.request.headers.get('x-test-api-key-id') || null;
      return { authType, apiKeyId };
    })
    .use(rateLimiter(config))
    .get('/test', () => ({ ok: true }));
}

async function makeRequest(app, opts = {}) {
  const headers = {};
  if (opts.authType) headers['x-test-auth-type'] = opts.authType;
  if (opts.apiKeyId) headers['x-test-api-key-id'] = opts.apiKeyId;
  return app.handle(new Request('http://localhost/test', { headers }));
}

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// Property 6: Sliding window rate limiting enforcement
// **Validates: Requirements 6.1, 6.2**
// ---------------------------------------------------------------------------

describe('Property 6: Sliding window rate limiting enforcement', () => {
  test('exactly maxRequests requests are allowed, the next is rejected (limit=1)', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });
    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res1.status).toBe(200);
    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res2.status).toBe(429);
  });

  test('exactly maxRequests requests are allowed, the next is rejected (limit=5)', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
      expect(res.status).toBe(200);
    }
    const rejected = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(rejected.status).toBe(429);
  });

  test('exactly maxRequests requests are allowed, the next is rejected (limit=20)', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 20 });
    for (let i = 0; i < 20; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
      expect(res.status).toBe(200);
    }
    const rejected = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(rejected.status).toBe(429);
  });

  test('requests older than the window are pruned and do not count', async () => {
    const app = buildApp({ windowMs: 80, maxRequests: 2 });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    const rejected = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(rejected.status).toBe(429);
    await new Promise((r) => setTimeout(r, 120));
    const allowed = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(allowed.status).toBe(200);
  });

  test('different API keys have independent sliding windows', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-a' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-a' });
    const rejectedA = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-a' });
    expect(rejectedA.status).toBe(429);
    const resB = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-b' });
    expect(resB.status).toBe(200);
  });

  test('multiple keys can each make exactly maxRequests before being limited', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 3 });
    for (const key of ['alpha', 'beta', 'gamma']) {
      for (let i = 0; i < 3; i++) {
        const res = await makeRequest(app, { authType: 'apikey', apiKeyId: key });
        expect(res.status).toBe(200);
      }
      const rejected = await makeRequest(app, { authType: 'apikey', apiKeyId: key });
      expect(rejected.status).toBe(429);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 7: Rate limit headers present on API key responses
// **Validates: Requirements 6.4**
// ---------------------------------------------------------------------------

describe('Property 7: Rate limit headers present on API key responses', () => {
  test('Remaining decreases with each request', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe(String(4 - i));
    }
  });

  test('Limit header matches configured maxRequests', async () => {
    for (const maxRequests of [1, 10, 50, 100]) {
      resetStore();
      const app = buildApp({ windowMs: 60_000, maxRequests });
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: `k-${maxRequests}` });
      expect(res.headers.get('X-RateLimit-Limit')).toBe(String(maxRequests));
    }
  });

  test('429 responses also include rate limit headers', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property 8: JWT requests bypass rate limiting
// **Validates: Requirements 6.5**
// ---------------------------------------------------------------------------

describe('Property 8: JWT requests bypass rate limiting', () => {
  test('JWT requests are never rejected regardless of count', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });
    for (let i = 0; i < 20; i++) {
      const res = await makeRequest(app, { authType: 'jwt' });
      expect(res.status).toBe(200);
    }
  });

  test('JWT requests do not include rate limit headers', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      const res = await makeRequest(app, { authType: 'jwt' });
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    }
  });

  test('JWT requests do not affect API key rate limits', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 3 });
    for (let i = 0; i < 10; i++) {
      await makeRequest(app, { authType: 'jwt' });
    }
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('2');
  });
});
