import { describe, test, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { csrfMiddleware } from '../../src/middleware/csrf.js';
import { generateCsrfToken } from '../../src/utils/csrf.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Elysia app that simulates auth context and applies CSRF middleware.
 * The `authType` is injected via derive so the CSRF middleware can read it.
 *
 * @param {{ authType?: string | null }} [defaults]
 * @returns {Elysia}
 */
function buildApp(defaults = {}) {
  const { authType = 'jwt' } = defaults;

  return new Elysia()
    // Simulate auth middleware by deriving authType
    .derive({ as: 'scoped' }, () => ({
      authType,
      user: authType ? { id: 'user_1' } : null,
    }))
    .use(csrfMiddleware)
    // Test endpoints for each method
    .get('/api/v1/notes', () => ({ ok: true }))
    .post('/api/v1/notes', () => ({ ok: true }))
    .patch('/api/v1/notes/test', () => ({ ok: true }))
    .delete('/api/v1/notes/test', () => ({ ok: true }))
    // Exempt endpoints
    .post('/api/v1/auth/login', () => ({ ok: true }))
    .post('/api/v1/auth/register', () => ({ ok: true }))
    .post('/api/v1/auth/refresh', () => ({ ok: true }));
}

/**
 * Make a request to the test app.
 *
 * @param {Elysia} app
 * @param {string} method
 * @param {string} path
 * @param {{ csrfHeader?: string, csrfCookie?: string }} [opts]
 * @returns {Promise<Response>}
 */
async function makeRequest(app, method, path, opts = {}) {
  const headers = {};
  const cookies = [];

  if (opts.csrfHeader) {
    headers['x-csrf-token'] = opts.csrfHeader;
  }
  if (opts.csrfCookie) {
    cookies.push(`csrf=${opts.csrfCookie}`);
  }
  // Always include an auth cookie to simulate JWT auth
  cookies.push('auth=fake-jwt-token');

  if (cookies.length > 0) {
    headers['cookie'] = cookies.join('; ');
  }

  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CSRF Middleware — GET request bypass', () => {
  test('GET requests pass without CSRF tokens', async () => {
    const app = buildApp();
    const res = await makeRequest(app, 'GET', '/api/v1/notes');
    expect(res.status).toBe(200);
  });
});

describe('CSRF Middleware — API key auth bypass', () => {
  test('POST with apikey auth passes without CSRF tokens', async () => {
    const app = buildApp({ authType: 'apikey' });
    const res = await makeRequest(app, 'POST', '/api/v1/notes');
    expect(res.status).toBe(200);
  });

  test('DELETE with apikey auth passes without CSRF tokens', async () => {
    const app = buildApp({ authType: 'apikey' });
    const res = await makeRequest(app, 'DELETE', '/api/v1/notes/test');
    expect(res.status).toBe(200);
  });

  test('PATCH with apikey auth passes without CSRF tokens', async () => {
    const app = buildApp({ authType: 'apikey' });
    const res = await makeRequest(app, 'PATCH', '/api/v1/notes/test');
    expect(res.status).toBe(200);
  });
});

describe('CSRF Middleware — unauthenticated request bypass', () => {
  test('POST without auth passes CSRF check (authType is null)', async () => {
    const app = buildApp({ authType: null });
    const res = await makeRequest(app, 'POST', '/api/v1/notes');
    expect(res.status).toBe(200);
  });
});

describe('CSRF Middleware — exempt path bypass', () => {
  test('POST to /api/v1/auth/login passes without CSRF tokens', async () => {
    const app = buildApp();
    const res = await makeRequest(app, 'POST', '/api/v1/auth/login');
    expect(res.status).toBe(200);
  });

  test('POST to /api/v1/auth/register passes without CSRF tokens', async () => {
    const app = buildApp();
    const res = await makeRequest(app, 'POST', '/api/v1/auth/register');
    expect(res.status).toBe(200);
  });

  test('POST to /api/v1/auth/refresh passes without CSRF tokens', async () => {
    const app = buildApp();
    const res = await makeRequest(app, 'POST', '/api/v1/auth/refresh');
    expect(res.status).toBe(200);
  });
});

describe('CSRF Middleware — successful validation', () => {
  test('POST with matching header and cookie tokens passes', async () => {
    const token = generateCsrfToken();
    const app = buildApp();
    const res = await makeRequest(app, 'POST', '/api/v1/notes', {
      csrfHeader: token,
      csrfCookie: token,
    });
    expect(res.status).toBe(200);
  });

  test('PATCH with matching tokens passes', async () => {
    const token = generateCsrfToken();
    const app = buildApp();
    const res = await makeRequest(app, 'PATCH', '/api/v1/notes/test', {
      csrfHeader: token,
      csrfCookie: token,
    });
    expect(res.status).toBe(200);
  });

  test('DELETE with matching tokens passes', async () => {
    const token = generateCsrfToken();
    const app = buildApp();
    const res = await makeRequest(app, 'DELETE', '/api/v1/notes/test', {
      csrfHeader: token,
      csrfCookie: token,
    });
    expect(res.status).toBe(200);
  });
});

describe('CSRF Middleware — missing header/cookie', () => {
  test('POST without x-csrf-token header returns 403 "CSRF token missing"', async () => {
    const token = generateCsrfToken();
    const app = buildApp();
    const res = await makeRequest(app, 'POST', '/api/v1/notes', {
      csrfCookie: token,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF token missing');
  });

  test('POST without csrf cookie returns 403 "CSRF token missing"', async () => {
    const token = generateCsrfToken();
    const app = buildApp();
    // Send header but no cookie
    const headers = {
      'x-csrf-token': token,
      cookie: 'auth=fake-jwt-token',
    };
    const res = await app.handle(
      new Request('http://localhost/api/v1/notes', {
        method: 'POST',
        headers,
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF token missing');
  });

  test('POST without both header and cookie returns 403 "CSRF token missing"', async () => {
    const app = buildApp();
    const headers = {
      cookie: 'auth=fake-jwt-token',
    };
    const res = await app.handle(
      new Request('http://localhost/api/v1/notes', {
        method: 'POST',
        headers,
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF token missing');
  });
});

describe('CSRF Middleware — mismatched tokens', () => {
  test('POST with different header and cookie tokens returns 403 "CSRF token invalid"', async () => {
    const app = buildApp();
    const res = await makeRequest(app, 'POST', '/api/v1/notes', {
      csrfHeader: generateCsrfToken(),
      csrfCookie: generateCsrfToken(),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF token invalid');
  });

  test('tokens of different lengths return 403 "CSRF token invalid"', async () => {
    const app = buildApp();
    const res = await makeRequest(app, 'POST', '/api/v1/notes', {
      csrfHeader: 'short',
      csrfCookie: 'a-much-longer-token-value-here',
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF token invalid');
  });
});
