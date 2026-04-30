import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import {
  REQUEST_ID_PATTERN,
  isValidRequestId,
  generateRequestId,
  requestIdMiddleware,
} from '../../src/middleware/request-id.js';
import { applyLogger } from '../../src/middleware/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Elysia app with request ID middleware and a test route.
 * Mirrors the pattern from auth.test.js.
 */
function buildApp() {
  return new Elysia()
    .use(requestIdMiddleware)
    .get('/test', (ctx) => ({ ok: true, requestId: ctx.requestId }));
}

/**
 * Build an app with both request ID middleware and logger applied.
 */
function buildAppWithLogger() {
  const app = new Elysia().use(requestIdMiddleware);
  applyLogger(app);
  app.get('/test', (ctx) => ({ ok: true, requestId: ctx.requestId }));
  return app;
}

/**
 * Build an app that returns error status codes for testing error responses.
 */
function buildAppWithErrors() {
  const app = new Elysia().use(requestIdMiddleware);
  applyLogger(app);
  app
    .get('/error-400', (ctx) => {
      ctx.set.status = 400;
      return { error: 'Bad Request' };
    })
    .get('/error-404', (ctx) => {
      ctx.set.status = 404;
      return { error: 'Not Found' };
    })
    .get('/error-500', (ctx) => {
      ctx.set.status = 500;
      return { error: 'Internal Server Error' };
    });
  return app;
}

/**
 * Make a request to the test app with optional X-Request-ID header.
 *
 * @param {Elysia} app
 * @param {string} path
 * @param {{ requestId?: string }} opts
 * @returns {Promise<Response>}
 */
async function makeRequest(app, path = '/test', opts = {}) {
  const headers = {};
  if (opts.requestId !== undefined) {
    headers['x-request-id'] = opts.requestId;
  }
  return app.handle(new Request(`http://localhost${path}`, { headers }));
}

// ---------------------------------------------------------------------------
// Validation tests — isValidRequestId
// ---------------------------------------------------------------------------

describe('isValidRequestId', () => {
  test('returns true for simple alphanumeric string', () => {
    expect(isValidRequestId('abc123')).toBe(true);
  });

  test('returns true for string with hyphens', () => {
    expect(isValidRequestId('req-abc-123')).toBe(true);
  });

  test('returns true for string with underscores', () => {
    expect(isValidRequestId('req_abc_123')).toBe(true);
  });

  test('returns true for mixed alphanumeric, hyphens, and underscores', () => {
    expect(isValidRequestId('Upstream_Trace-ID-42')).toBe(true);
  });

  test('returns true for single character', () => {
    expect(isValidRequestId('a')).toBe(true);
  });

  test('returns true for exactly 128 characters', () => {
    const id = 'a'.repeat(128);
    expect(isValidRequestId(id)).toBe(true);
  });

  test('returns true for UUID v4 string', () => {
    expect(isValidRequestId('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  test('returns false for null', () => {
    expect(isValidRequestId(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isValidRequestId(undefined)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isValidRequestId('')).toBe(false);
  });

  test('returns false for string with spaces', () => {
    expect(isValidRequestId('req abc')).toBe(false);
  });

  test('returns false for string with dots', () => {
    expect(isValidRequestId('req.abc')).toBe(false);
  });

  test('returns false for string with slashes', () => {
    expect(isValidRequestId('req/abc')).toBe(false);
  });

  test('returns false for string with colons', () => {
    expect(isValidRequestId('req:abc')).toBe(false);
  });

  test('returns false for string with special characters', () => {
    expect(isValidRequestId('req@abc!')).toBe(false);
  });

  test('returns false for string with newline', () => {
    expect(isValidRequestId('req\nabc')).toBe(false);
  });

  test('returns false for string longer than 128 characters', () => {
    const id = 'a'.repeat(129);
    expect(isValidRequestId(id)).toBe(false);
  });

  test('returns false for number input', () => {
    expect(isValidRequestId(12345)).toBe(false);
  });

  test('returns false for boolean input', () => {
    expect(isValidRequestId(true)).toBe(false);
  });

  test('returns false for object input', () => {
    expect(isValidRequestId({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation tests — generateRequestId
// ---------------------------------------------------------------------------

describe('generateRequestId', () => {
  test('returns a valid UUID v4 format', () => {
    const id = generateRequestId();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  test('returns unique values on consecutive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Validation tests — REQUEST_ID_PATTERN
// ---------------------------------------------------------------------------

describe('REQUEST_ID_PATTERN', () => {
  test('is a RegExp', () => {
    expect(REQUEST_ID_PATTERN).toBeInstanceOf(RegExp);
  });

  test('matches valid patterns', () => {
    expect(REQUEST_ID_PATTERN.test('abc')).toBe(true);
    expect(REQUEST_ID_PATTERN.test('ABC')).toBe(true);
    expect(REQUEST_ID_PATTERN.test('123')).toBe(true);
    expect(REQUEST_ID_PATTERN.test('a-b_c')).toBe(true);
  });

  test('rejects invalid patterns', () => {
    expect(REQUEST_ID_PATTERN.test('')).toBe(false);
    expect(REQUEST_ID_PATTERN.test('a b')).toBe(false);
    expect(REQUEST_ID_PATTERN.test('a.b')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Header round-trip tests
// ---------------------------------------------------------------------------

describe('Request ID Middleware — header round-trip', () => {
  test('valid X-Request-ID header is echoed back in response', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test', { requestId: 'my-custom-request-id' });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('my-custom-request-id');
  });

  test('missing X-Request-ID header generates a UUID v4 in response', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test');

    expect(res.status).toBe(200);
    const responseId = res.headers.get('x-request-id');
    expect(responseId).not.toBeNull();
    expect(responseId).toMatch(UUID_V4_REGEX);
  });

  test('invalid X-Request-ID header (special chars) generates a new UUID v4', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test', { requestId: 'invalid/request@id!' });

    expect(res.status).toBe(200);
    const responseId = res.headers.get('x-request-id');
    expect(responseId).not.toBeNull();
    expect(responseId).toMatch(UUID_V4_REGEX);
    expect(responseId).not.toBe('invalid/request@id!');
  });

  test('empty X-Request-ID header generates a new UUID v4', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test', { requestId: '' });

    expect(res.status).toBe(200);
    const responseId = res.headers.get('x-request-id');
    expect(responseId).not.toBeNull();
    expect(responseId).toMatch(UUID_V4_REGEX);
  });

  test('X-Request-ID header longer than 128 chars generates a new UUID v4', async () => {
    const app = buildApp();
    const longId = 'a'.repeat(129);
    const res = await makeRequest(app, '/test', { requestId: longId });

    expect(res.status).toBe(200);
    const responseId = res.headers.get('x-request-id');
    expect(responseId).not.toBeNull();
    expect(responseId).toMatch(UUID_V4_REGEX);
    expect(responseId).not.toBe(longId);
  });

  test('X-Request-ID with spaces generates a new UUID v4', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test', { requestId: 'has spaces in it' });

    expect(res.status).toBe(200);
    const responseId = res.headers.get('x-request-id');
    expect(responseId).toMatch(UUID_V4_REGEX);
  });

  test('valid X-Request-ID with hyphens and underscores is preserved', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test', { requestId: 'trace_id-2024-abc_DEF' });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('trace_id-2024-abc_DEF');
  });

  test('exactly 128-char valid X-Request-ID is preserved', async () => {
    const app = buildApp();
    const maxId = 'x'.repeat(128);
    const res = await makeRequest(app, '/test', { requestId: maxId });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe(maxId);
  });
});

// ---------------------------------------------------------------------------
// Elysia context tests
// ---------------------------------------------------------------------------

describe('Request ID Middleware — Elysia context', () => {
  test('ctx.requestId matches the X-Request-ID response header', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test', { requestId: 'ctx-test-id' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe('ctx-test-id');
    expect(res.headers.get('x-request-id')).toBe('ctx-test-id');
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
  });

  test('ctx.requestId is available in route handlers (generated ID)', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBeDefined();
    expect(body.requestId).toMatch(UUID_V4_REGEX);
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
  });

  test('ctx.requestId is available in route handlers (client-provided ID)', async () => {
    const app = buildApp();
    const res = await makeRequest(app, '/test', { requestId: 'client-provided-123' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe('client-provided-123');
  });
});

// ---------------------------------------------------------------------------
// Log enrichment tests
// ---------------------------------------------------------------------------

describe('Request ID Middleware — log enrichment', () => {
  let logs;
  let originalLog;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test('logger includes requestId in JSON output', async () => {
    const app = buildAppWithLogger();
    const res = await makeRequest(app, '/test', { requestId: 'log-test-id' });

    expect(res.status).toBe(200);

    // Wait a tick for onAfterResponse to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const logEntry = JSON.parse(logs[logs.length - 1]);
    expect(logEntry.requestId).toBe('log-test-id');
  });

  test('requestId in log matches the X-Request-ID response header', async () => {
    const app = buildAppWithLogger();
    const res = await makeRequest(app, '/test');

    expect(res.status).toBe(200);
    const responseId = res.headers.get('x-request-id');

    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const logEntry = JSON.parse(logs[logs.length - 1]);
    expect(logEntry.requestId).toBe(responseId);
  });

  test('log entry contains expected fields alongside requestId', async () => {
    const app = buildAppWithLogger();
    await makeRequest(app, '/test', { requestId: 'fields-test' });

    await new Promise((r) => setTimeout(r, 50));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const logEntry = JSON.parse(logs[logs.length - 1]);
    expect(logEntry.method).toBe('GET');
    expect(logEntry.path).toBe('/test');
    expect(logEntry.requestId).toBe('fields-test');
    expect(typeof logEntry.responseTime).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Error response tests
// ---------------------------------------------------------------------------

describe('Request ID Middleware — error responses', () => {
  let logs;
  let originalLog;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test('400 error response includes X-Request-ID header', async () => {
    const app = buildAppWithErrors();
    const res = await makeRequest(app, '/error-400', { requestId: 'err-400-id' });

    expect(res.status).toBe(400);
    expect(res.headers.get('x-request-id')).toBe('err-400-id');
  });

  test('404 error response includes X-Request-ID header', async () => {
    const app = buildAppWithErrors();
    const res = await makeRequest(app, '/error-404');

    expect(res.status).toBe(404);
    const responseId = res.headers.get('x-request-id');
    expect(responseId).not.toBeNull();
    expect(responseId).toMatch(UUID_V4_REGEX);
  });

  test('500 error response includes X-Request-ID header', async () => {
    const app = buildAppWithErrors();
    const res = await makeRequest(app, '/error-500', { requestId: 'err-500-id' });

    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBe('err-500-id');
  });

  test('error response JSON body does NOT contain requestId field', async () => {
    const app = buildAppWithErrors();
    const res = await makeRequest(app, '/error-400', { requestId: 'err-body-test' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.requestId).toBeUndefined();
    expect(body.error).toBe('Bad Request');
  });

  test('500 error response JSON body does NOT contain requestId field', async () => {
    const app = buildAppWithErrors();
    const res = await makeRequest(app, '/error-500', { requestId: 'err-500-body' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.requestId).toBeUndefined();
    expect(body.error).toBe('Internal Server Error');
  });

  test('error response X-Request-ID matches generated ID when no header sent', async () => {
    const app = buildAppWithErrors();
    const res = await makeRequest(app, '/error-500');

    expect(res.status).toBe(500);
    const responseId = res.headers.get('x-request-id');
    expect(responseId).not.toBeNull();
    expect(responseId).toMatch(UUID_V4_REGEX);
  });
});

// ---------------------------------------------------------------------------
// Middleware ordering test
// ---------------------------------------------------------------------------

describe('Request ID Middleware — middleware ordering in index.js', () => {
  test('requestIdMiddleware is registered before applyLogger in index.js', async () => {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const indexPath = path.resolve(import.meta.dir, '../../src/index.js');
    const indexSource = fs.readFileSync(indexPath, 'utf-8');

    // Find the position of requestIdMiddleware registration
    const requestIdPos = indexSource.indexOf('.use(requestIdMiddleware)');
    expect(requestIdPos).toBeGreaterThan(-1);

    // Find the position of applyLogger registration
    const loggerPos = indexSource.indexOf('applyLogger(app)');
    expect(loggerPos).toBeGreaterThan(-1);

    // requestIdMiddleware must come before applyLogger
    expect(requestIdPos).toBeLessThan(loggerPos);
  });

  test('requestIdMiddleware import exists in index.js', async () => {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const indexPath = path.resolve(import.meta.dir, '../../src/index.js');
    const indexSource = fs.readFileSync(indexPath, 'utf-8');

    expect(indexSource).toContain("import { requestIdMiddleware } from './middleware/request-id.js'");
  });

  test('requestIdMiddleware is registered before route groups in index.js', async () => {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const indexPath = path.resolve(import.meta.dir, '../../src/index.js');
    const indexSource = fs.readFileSync(indexPath, 'utf-8');

    const requestIdPos = indexSource.indexOf('.use(requestIdMiddleware)');
    const healthRoutesPos = indexSource.indexOf('.use(healthRoutes)');

    expect(requestIdPos).toBeGreaterThan(-1);
    expect(healthRoutesPos).toBeGreaterThan(-1);
    expect(requestIdPos).toBeLessThan(healthRoutesPos);
  });
});
