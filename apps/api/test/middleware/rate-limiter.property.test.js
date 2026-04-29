import { describe, test, expect, beforeEach } from 'bun:test';
import { rateLimiter, _clearStore } from '../../src/middleware/rate-limiter.js';
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Elysia app with simulated auth context and rate limiter.
 *
 * @param {object} [config] - Rate limiter config
 * @returns {Elysia}
 */
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
// Reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearStore();
});

// ---------------------------------------------------------------------------
// Property 6: Sliding window rate limiting enforcement
//
// For any API key and any sequence of requests, the rate limiter SHALL allow
// requests when the count of requests within the trailing window is at or
// below maxRequests, and SHALL reject requests with HTTP 429 when the count
// exceeds maxRequests. Requests older than the window SHALL NOT count.
//
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
    const body = await rejected.json();
    expect(body.error).toBe('Rate limit exceeded');
    expect(typeof body.retryAfter).toBe('number');
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

    // Use up the limit
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });

    // Should be rejected
    const rejected = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(rejected.status).toBe(429);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 120));

    // Should be allowed again
    const allowed = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(allowed.status).toBe(200);
  });

  test('sliding window allows new requests as old ones expire', async () => {
    const app = buildApp({ windowMs: 100, maxRequests: 1 });

    // First request allowed
    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res1.status).toBe(200);

    // Immediately rejected
    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res2.status).toBe(429);

    // Wait for window to slide
    await new Promise((r) => setTimeout(r, 150));

    // Allowed again
    const res3 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res3.status).toBe(200);
  });

  test('different API keys have independent sliding windows', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    // Exhaust key-a
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-a' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-a' });
    const rejectedA = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-a' });
    expect(rejectedA.status).toBe(429);

    // key-b is independent and should be allowed
    const resB1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-b' });
    expect(resB1.status).toBe(200);
    const resB2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-b' });
    expect(resB2.status).toBe(200);

    // key-b also hits its own limit
    const rejectedB = await makeRequest(app, { authType: 'apikey', apiKeyId: 'key-b' });
    expect(rejectedB.status).toBe(429);
  });

  test('429 response body contains retryAfter as a positive number of seconds', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });

    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBe('Rate limit exceeded');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(60);
  });

  test('multiple keys can each make exactly maxRequests before being limited', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 3 });
    const keys = ['alpha', 'beta', 'gamma'];

    for (const key of keys) {
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
//
// For any request authenticated via API key that is not rate-limited, the
// response SHALL include X-RateLimit-Limit, X-RateLimit-Remaining, and
// X-RateLimit-Reset headers, where Remaining equals Limit minus the current
// window count and Reset is a valid future Unix epoch timestamp.
//
// **Validates: Requirements 6.4**
// ---------------------------------------------------------------------------

describe('Property 7: Rate limit headers present on API key responses', () => {
  test('first request has Remaining = maxRequests - 1', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 10 });

    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
  });

  test('Remaining decreases with each request', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 5 });

    for (let i = 0; i < 5; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Remaining')).toBe(String(4 - i));
    }
  });

  test('Remaining is 0 when at the limit boundary', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 3 });

    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  test('Reset header is a valid future Unix epoch timestamp', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 10 });

    const beforeEpoch = Math.floor(Date.now() / 1000);
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    const afterEpoch = Math.ceil(Date.now() / 1000);

    const resetEpoch = parseInt(res.headers.get('X-RateLimit-Reset'), 10);
    expect(resetEpoch).toBeGreaterThanOrEqual(beforeEpoch);
    // Reset should be approximately now + windowMs/1000
    expect(resetEpoch).toBeLessThanOrEqual(afterEpoch + 61);
  });

  test('Limit header matches configured maxRequests', async () => {
    for (const maxRequests of [1, 10, 50, 100]) {
      _clearStore();
      const app = buildApp({ windowMs: 60_000, maxRequests });

      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: `k-${maxRequests}` });
      expect(res.headers.get('X-RateLimit-Limit')).toBe(String(maxRequests));
    }
  });

  test('headers are present on every successful API key request', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 10 });

    for (let i = 0; i < 10; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).not.toBeNull();
      expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
      expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();
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

  test('Remaining is consistent: Limit - windowCount for various request counts', async () => {
    const maxRequests = 8;
    const app = buildApp({ windowMs: 60_000, maxRequests });

    for (let i = 1; i <= maxRequests; i++) {
      const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
      const remaining = parseInt(res.headers.get('X-RateLimit-Remaining'), 10);
      expect(remaining).toBe(maxRequests - i);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 8: JWT requests bypass rate limiting
//
// For any number of requests authenticated via JWT within any time window,
// the rate limiter SHALL never reject the request and SHALL NOT include
// rate limit headers in the response.
//
// **Validates: Requirements 6.5**
// ---------------------------------------------------------------------------

describe('Property 8: JWT requests bypass rate limiting', () => {
  test('JWT requests are never rejected regardless of count', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    // Make many more requests than the limit
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
      expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
      expect(res.headers.get('X-RateLimit-Reset')).toBeNull();
    }
  });

  test('JWT requests do not affect API key rate limits', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 3 });

    // Make JWT requests
    for (let i = 0; i < 10; i++) {
      await makeRequest(app, { authType: 'jwt' });
    }

    // API key should still have its full quota
    const res = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('2');
  });

  test('API key rate limiting does not affect JWT requests', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });

    // Exhaust API key limit
    await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    const rejected = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(rejected.status).toBe(429);

    // JWT should still work
    const jwtRes = await makeRequest(app, { authType: 'jwt' });
    expect(jwtRes.status).toBe(200);
  });

  test('JWT bypass works with very small window and limit', async () => {
    const app = buildApp({ windowMs: 1, maxRequests: 1 });

    for (let i = 0; i < 10; i++) {
      const res = await makeRequest(app, { authType: 'jwt' });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    }
  });

  test('interleaved JWT and API key requests: JWT never limited', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 2 });

    // Interleave JWT and API key requests
    const res1 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res1.status).toBe(200);

    const jwtRes1 = await makeRequest(app, { authType: 'jwt' });
    expect(jwtRes1.status).toBe(200);

    const res2 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res2.status).toBe(200);

    // API key is now at limit
    const res3 = await makeRequest(app, { authType: 'apikey', apiKeyId: 'k1' });
    expect(res3.status).toBe(429);

    // JWT still works
    const jwtRes2 = await makeRequest(app, { authType: 'jwt' });
    expect(jwtRes2.status).toBe(200);
    expect(jwtRes2.headers.get('X-RateLimit-Limit')).toBeNull();
  });

  test('many JWT requests with maxRequests=1 never get 429', async () => {
    const app = buildApp({ windowMs: 60_000, maxRequests: 1 });

    for (let i = 0; i < 50; i++) {
      const res = await makeRequest(app, { authType: 'jwt' });
      expect(res.status).toBe(200);
    }
  });
});
