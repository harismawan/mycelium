import { describe, test, expect } from 'bun:test';
import { randomBytes } from 'crypto';
import { Elysia } from 'elysia';
import { csrfMiddleware } from '../../src/middleware/csrf.js';
import { generateCsrfToken } from '../../src/utils/csrf.js';

const ITERATIONS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_CHANGING_METHODS = ['POST', 'PATCH', 'DELETE'];

/**
 * Build a minimal Elysia app with simulated auth context and CSRF middleware.
 *
 * @param {{ authType?: string | null }} [defaults]
 * @returns {Elysia}
 */
function buildApp(defaults = {}) {
  const { authType = 'jwt' } = defaults;

  return new Elysia()
    .derive({ as: 'scoped' }, () => ({
      authType,
      user: authType ? { id: 'user_1' } : null,
    }))
    .use(csrfMiddleware)
    .post('/api/v1/notes', () => ({ ok: true }))
    .patch('/api/v1/notes/test', () => ({ ok: true }))
    .delete('/api/v1/notes/test', () => ({ ok: true }));
}

/**
 * Pick a random element from an array.
 */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get the path for a given method.
 */
function pathForMethod(method) {
  if (method === 'POST') return '/api/v1/notes';
  return '/api/v1/notes/test';
}

/**
 * Generate a random string of random length (8-64 chars).
 */
function randomString() {
  const len = 8 + Math.floor(Math.random() * 57);
  return randomBytes(len).toString('base64url');
}

// ---------------------------------------------------------------------------
// Feature: csrf-protection, Property 3: Matching tokens allow request
//
// For any randomly generated token string and any state-changing HTTP method
// (POST, PATCH, DELETE), when a JWT-authenticated request carries that token
// in both the csrf cookie and the x-csrf-token header, the CSRF middleware
// SHALL allow the request to proceed.
// Validates: Requirements 4.1, 4.2, 4.3
// ---------------------------------------------------------------------------

describe('Property 3: Matching tokens allow request', () => {
  test(`${ITERATIONS} random token+method combinations pass validation`, async () => {
    const app = buildApp();

    for (let i = 0; i < ITERATIONS; i++) {
      const token = generateCsrfToken();
      const method = randomChoice(STATE_CHANGING_METHODS);
      const path = pathForMethod(method);

      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            'x-csrf-token': token,
            cookie: `auth=fake-jwt; csrf=${token}`,
          },
        }),
      );

      expect(res.status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature: csrf-protection, Property 4: Mismatched tokens reject request
//
// For any two distinct randomly generated token strings and any state-changing
// HTTP method (POST, PATCH, DELETE), when a JWT-authenticated request carries
// one token in the csrf cookie and a different token in the x-csrf-token
// header, the CSRF middleware SHALL reject the request with HTTP 403.
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------

describe('Property 4: Mismatched tokens reject request', () => {
  test(`${ITERATIONS} random mismatched token pairs are rejected with 403`, async () => {
    const app = buildApp();

    for (let i = 0; i < ITERATIONS; i++) {
      const headerToken = randomString();
      const cookieToken = randomString();

      // Ensure they are actually different
      if (headerToken === cookieToken) continue;

      const method = randomChoice(STATE_CHANGING_METHODS);
      const path = pathForMethod(method);

      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            'x-csrf-token': headerToken,
            cookie: `auth=fake-jwt; csrf=${cookieToken}`,
          },
        }),
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('CSRF token invalid');
    }
  });
});

// ---------------------------------------------------------------------------
// Feature: csrf-protection, Property 5: API key auth bypasses CSRF
//
// For any state-changing HTTP method (POST, PATCH, DELETE) and any
// API-key-authenticated request, the CSRF middleware SHALL allow the request
// to proceed regardless of whether CSRF tokens are present.
// Validates: Requirements 5.1, 5.2
// ---------------------------------------------------------------------------

describe('Property 5: API key auth bypasses CSRF', () => {
  test(`${ITERATIONS} random API key requests bypass CSRF validation`, async () => {
    const app = buildApp({ authType: 'apikey' });

    for (let i = 0; i < ITERATIONS; i++) {
      const method = randomChoice(STATE_CHANGING_METHODS);
      const path = pathForMethod(method);

      // Randomly decide whether to include CSRF tokens or not
      const includeTokens = Math.random() > 0.5;
      const headers = {};

      if (includeTokens) {
        const token = generateCsrfToken();
        headers['x-csrf-token'] = token;
        headers['cookie'] = `csrf=${token}`;
      }

      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers,
        }),
      );

      expect(res.status).toBe(200);
    }
  });
});
