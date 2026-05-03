import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Setup: mock `document.cookie` and `fetch` before importing the module
// ---------------------------------------------------------------------------

let mockCookie = '';
let fetchCalls = [];

// Mock the global document object
globalThis.document = globalThis.document || {};
Object.defineProperty(globalThis.document, 'cookie', {
  get: () => mockCookie,
  set: (v) => { mockCookie = v; },
  configurable: true,
});

// Mock fetch
const originalFetch = globalThis.fetch;
globalThis.fetch = mock(async (url, opts) => {
  fetchCalls.push({ url, opts });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

// Import after mocks are set up
const { getCsrfToken, apiPost, apiPatch, apiDelete, apiGet } = await import('../../src/api/client.js');

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCookie = '';
  fetchCalls = [];
  globalThis.fetch.mockClear?.();
});

// ---------------------------------------------------------------------------
// getCsrfToken
// ---------------------------------------------------------------------------

describe('getCsrfToken', () => {
  test('returns token value when csrf cookie is present', () => {
    mockCookie = 'csrf=abc123-test_token';
    expect(getCsrfToken()).toBe('abc123-test_token');
  });

  test('returns token when csrf cookie is among multiple cookies', () => {
    mockCookie = 'auth=jwt-token; csrf=my-csrf-token; other=value';
    expect(getCsrfToken()).toBe('my-csrf-token');
  });

  test('returns null when csrf cookie is absent', () => {
    mockCookie = 'auth=jwt-token; other=value';
    expect(getCsrfToken()).toBeNull();
  });

  test('returns null when cookie string is empty', () => {
    mockCookie = '';
    expect(getCsrfToken()).toBeNull();
  });

  test('does not match partial cookie names like "xcsrf"', () => {
    mockCookie = 'xcsrf=wrong-token';
    expect(getCsrfToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Header injection — unit tests
// ---------------------------------------------------------------------------

describe('apiPost — CSRF header injection', () => {
  test('includes x-csrf-token header when csrf cookie is present', async () => {
    mockCookie = 'csrf=test-token-123';
    await apiPost('/notes', { title: 'Test' });

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].opts.headers;
    expect(headers['x-csrf-token']).toBe('test-token-123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('omits x-csrf-token header when csrf cookie is absent', async () => {
    mockCookie = 'auth=jwt-only';
    await apiPost('/notes', { title: 'Test' });

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].opts.headers;
    expect(headers['x-csrf-token']).toBeUndefined();
  });
});

describe('apiPatch — CSRF header injection', () => {
  test('includes x-csrf-token header when csrf cookie is present', async () => {
    mockCookie = 'csrf=patch-token';
    await apiPatch('/notes/test', { title: 'Updated' });

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].opts.headers;
    expect(headers['x-csrf-token']).toBe('patch-token');
  });
});

describe('apiDelete — CSRF header injection', () => {
  test('includes x-csrf-token header when csrf cookie is present', async () => {
    mockCookie = 'csrf=delete-token';
    await apiDelete('/notes/test');

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].opts.headers;
    expect(headers['x-csrf-token']).toBe('delete-token');
  });

  test('does not include Content-Type header for DELETE', async () => {
    mockCookie = 'csrf=delete-token';
    await apiDelete('/notes/test');

    const headers = fetchCalls[0].opts.headers;
    expect(headers['Content-Type']).toBeUndefined();
  });
});

describe('apiGet — no CSRF header', () => {
  test('GET requests do not include x-csrf-token header', async () => {
    mockCookie = 'csrf=should-not-appear';
    await apiGet('/notes');

    expect(fetchCalls).toHaveLength(1);
    // apiGet doesn't pass custom headers, so opts.headers should be undefined
    expect(fetchCalls[0].opts.headers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Feature: csrf-protection, Property 6: SPA client attaches CSRF header
//
// For any CSRF token value present in the csrf cookie and any state-changing
// API client method (apiPost, apiPatch, apiDelete), the API client SHALL
// include the token in the x-csrf-token request header.
// Validates: Requirements 7.1, 7.2, 7.3
// ---------------------------------------------------------------------------

const ITERATIONS = 100;

describe('Property 6: SPA client attaches CSRF header for state-changing requests', () => {
  test(`${ITERATIONS} random tokens are correctly attached to state-changing requests`, async () => {
    const methods = [
      { fn: apiPost, args: ['/notes', { title: 'Test' }] },
      { fn: apiPatch, args: ['/notes/test', { title: 'Updated' }] },
      { fn: apiDelete, args: ['/notes/test'] },
    ];

    for (let i = 0; i < ITERATIONS; i++) {
      fetchCalls = [];
      const token = randomBytes(32).toString('base64url');
      mockCookie = `auth=jwt-token; csrf=${token}; other=value`;

      const { fn, args } = methods[i % methods.length];
      await fn(...args);

      expect(fetchCalls).toHaveLength(1);
      const headers = fetchCalls[0].opts.headers;
      expect(headers['x-csrf-token']).toBe(token);
    }
  });

  test(`${ITERATIONS} requests without csrf cookie omit the header`, async () => {
    const methods = [
      { fn: apiPost, args: ['/notes', { title: 'Test' }] },
      { fn: apiPatch, args: ['/notes/test', { title: 'Updated' }] },
      { fn: apiDelete, args: ['/notes/test'] },
    ];

    for (let i = 0; i < ITERATIONS; i++) {
      fetchCalls = [];
      mockCookie = 'auth=jwt-only';

      const { fn, args } = methods[i % methods.length];
      await fn(...args);

      expect(fetchCalls).toHaveLength(1);
      const headers = fetchCalls[0].opts.headers;
      expect(headers['x-csrf-token']).toBeUndefined();
    }
  });
});
