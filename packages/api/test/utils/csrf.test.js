import { describe, test, expect } from 'bun:test';
import { generateCsrfToken, csrfTokensMatch, CSRF_COOKIE_OPTIONS } from '../../src/utils/csrf.js';

// ---------------------------------------------------------------------------
// generateCsrfToken
// ---------------------------------------------------------------------------

describe('generateCsrfToken', () => {
  test('returns a string of at least 43 characters', () => {
    const token = generateCsrfToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  test('contains only URL-safe base64 characters', () => {
    const token = generateCsrfToken();
    // base64url alphabet: A-Z, a-z, 0-9, -, _
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('does not contain padding characters', () => {
    const token = generateCsrfToken();
    expect(token).not.toContain('=');
  });

  test('produces distinct tokens on successive calls', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// csrfTokensMatch
// ---------------------------------------------------------------------------

describe('csrfTokensMatch', () => {
  test('returns true for identical tokens', () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  test('returns true for equal string values', () => {
    const value = 'abc123-test_token';
    expect(csrfTokensMatch(value, value)).toBe(true);
  });

  test('returns false for different tokens', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(csrfTokensMatch(a, b)).toBe(false);
  });

  test('returns false for tokens of different lengths', () => {
    expect(csrfTokensMatch('short', 'a-much-longer-token-value')).toBe(false);
  });

  test('returns false when first argument is empty', () => {
    expect(csrfTokensMatch('', 'some-token')).toBe(false);
  });

  test('returns false when second argument is empty', () => {
    expect(csrfTokensMatch('some-token', '')).toBe(false);
  });

  test('returns false for non-string inputs', () => {
    expect(csrfTokensMatch(null, 'token')).toBe(false);
    expect(csrfTokensMatch('token', undefined)).toBe(false);
    expect(csrfTokensMatch(123, 'token')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CSRF_COOKIE_OPTIONS
// ---------------------------------------------------------------------------

describe('CSRF_COOKIE_OPTIONS', () => {
  test('httpOnly is false (SPA must read the cookie)', () => {
    expect(CSRF_COOKIE_OPTIONS.httpOnly).toBe(false);
  });

  test('sameSite is lax', () => {
    expect(CSRF_COOKIE_OPTIONS.sameSite).toBe('lax');
  });

  test('path is /', () => {
    expect(CSRF_COOKIE_OPTIONS.path).toBe('/');
  });

  test('maxAge is 86400 (1 day, same as access token)', () => {
    expect(CSRF_COOKIE_OPTIONS.maxAge).toBe(86400);
  });

  test('secure depends on NODE_ENV', () => {
    // In test environment, NODE_ENV is typically not 'production'
    expect(typeof CSRF_COOKIE_OPTIONS.secure).toBe('boolean');
  });
});
