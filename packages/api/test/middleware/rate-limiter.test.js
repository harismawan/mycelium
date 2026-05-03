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

let redisConnected = true;

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
    // Sort by score, return members in range
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
  isRedisConnected: () => redisConnected,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
  redisConnected = true;
});

describe('rateLimiter (Redis-backed)', () => {
  test('requests under limit pass through successfully', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 5 });

    for (let i = 0; i < 5; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });

  test('request exceeding limit returns 429 with correct body', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 3 });

    for (let i = 0; i < 3; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
      expect(res.status).toBe(200);
    }

    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBe('Rate limit exceeded');
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  test('JWT requests bypass rate limiting entirely', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    for (let i = 0; i < 10; i++) {
      const res = await makeRequest(app, { authType: 'jwt' });
      expect(res.status).toBe(200);
    }

    const res = await makeRequest(app, { authType: 'jwt' });
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  test('rate limit headers are present on API key responses', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 10 });

    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(res1.headers.get('X-RateLimit-Reset')).toBeTruthy();

    const resetEpoch = parseInt(res1.headers.get('X-RateLimit-Reset'), 10);
    const nowEpoch = Math.floor(Date.now() / 1000);
    expect(resetEpoch).toBeGreaterThanOrEqual(nowEpoch);

    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('8');
  });

  test('headers show 0 remaining at the limit boundary', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });

    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  test('different API keys have independent rate limits', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res1.status).toBe(429);

    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-2' });
    expect(res2.status).toBe(200);
  });

  test('429 response includes rate limit headers', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });

    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });

    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  test('uses default config values when none provided', async () => {
    const app = buildApp();

    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('59');
  });

  test('fails open when Redis is unavailable', async () => {
    redisConnected = false;
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);

    try {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
      expect(res.status).toBe(200);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0][0]).toContain('[rate-limiter]');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('expired timestamps do not count toward the limit', async () => {
    const app = buildApp({ windowMs: 100, maxRequests: 2 });

    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });

    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res1.status).toBe(429);

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res2.status).toBe(200);
  });
});
