import { describe, test, expect, beforeEach } from 'bun:test';
import { rateLimiter, _getStore, _clearStore } from '../../src/middleware/rate-limiter.js';
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Elysia app with auth context derived and rate limiter applied.
 * The `authType` and `apiKeyId` are injected via custom headers for testing.
 *
 * @param {object} [config] - Rate limiter config
 * @returns {Elysia}
 */
function buildApp(config) {
  return new Elysia()
    .derive((ctx) => {
      // Simulate auth middleware by reading test headers
      const authType = ctx.request.headers.get('x-test-auth-type') || null;
      const apiKeyId = ctx.request.headers.get('x-test-api-key-id') || null;
      return { authType, apiKeyId };
    })
    .use(rateLimiter(config))
    .get('/test', () => ({ ok: true }));
}

/**
 * Make a request to the test app.
 *
 * @param {Elysia} app
 * @param {{ authType?: string, apiKeyId?: string }} [opts]
 * @returns {Promise<Response>}
 */
async function makeRequest(app, opts = {}) {
  const headers = {};
  if (opts.authType) headers['x-test-auth-type'] = opts.authType;
  if (opts.apiKeyId) headers['x-test-api-key-id'] = opts.apiKeyId;

  return app.handle(
    new Request('http://localhost/test', { headers }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearStore();
});

describe('rateLimiter', () => {
  /** Validates: Requirements 6.2 */
  test('requests under limit pass through successfully', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 5 });

    for (let i = 0; i < 5; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });

  /** Validates: Requirements 6.2, 6.3 */
  test('request exceeding limit returns 429 with correct body', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 3 });

    // Make 3 requests (at limit)
    for (let i = 0; i < 3; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
      expect(res.status).toBe(200);
    }

    // 4th request should be rejected
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBe('Rate limit exceeded');
    expect(typeof body.retryAfter).toBe('number');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  /** Validates: Requirements 6.5 */
  test('JWT requests bypass rate limiting entirely', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    // Make many JWT requests — none should be rate limited
    for (let i = 0; i < 10; i++) {
      const res = await makeRequest(app, { authType: 'jwt' });
      expect(res.status).toBe(200);
    }

    // Verify no rate limit headers on JWT responses
    const res = await makeRequest(app, { authType: 'jwt' });
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
    expect(res.headers.get('X-RateLimit-Reset')).toBeNull();
  });

  /** Validates: Requirements 6.4 */
  test('rate limit headers are present with correct values on API key responses', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 10 });

    // First request
    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(res1.headers.get('X-RateLimit-Reset')).toBeTruthy();

    // Verify Reset is a valid future Unix epoch timestamp
    const resetEpoch = parseInt(res1.headers.get('X-RateLimit-Reset'), 10);
    const nowEpoch = Math.floor(Date.now() / 1000);
    expect(resetEpoch).toBeGreaterThanOrEqual(nowEpoch);

    // Second request
    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('8');
  });

  /** Validates: Requirements 6.4 */
  test('headers show 0 remaining at the limit boundary', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    // First request: remaining = 1
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });

    // Second request: remaining = 0
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  /** Validates: Requirements 6.6 */
  test('fails open with console.warn on internal error', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 5 });

    // Corrupt the store to cause an error
    const store = _getStore();
    store.set = () => {
      throw new Error('Storage failure');
    };

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);

    try {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
      // Should pass through (fail open)
      expect(res.status).toBe(200);
      // Should have logged a warning
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0][0]).toContain('[rate-limiter]');
    } finally {
      console.warn = originalWarn;
      // Restore Map.prototype.set
      store.set = Map.prototype.set;
    }
  });

  /** Validates: Requirements 6.1 */
  test('expired timestamps do not count toward the limit', async () => {
    const app = buildApp({ windowMs: 100, maxRequests: 2 });

    // Make 2 requests (at limit)
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });

    // 3rd request should be rejected
    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res1.status).toBe(429);

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Now requests should be allowed again
    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res2.status).toBe(200);
  });

  /** Validates: Requirements 6.1 */
  test('different API keys have independent rate limits', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    // Exhaust key-1's limit
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res1.status).toBe(429);

    // key-2 should still be allowed
    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-2' });
    expect(res2.status).toBe(200);
  });

  test('429 response includes rate limit headers', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });

    // Use up the limit
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });

    // Next request should be 429 with headers
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  test('uses default config values when none provided', async () => {
    const app = buildApp(); // No config — defaults to 60 requests / 60s

    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('59');
  });
});
