import { describe, test, expect } from 'bun:test';
import { generateCsrfToken, csrfTokensMatch } from '../../src/utils/csrf.js';

const ITERATIONS = 100;

// ---------------------------------------------------------------------------
// Feature: csrf-protection, Property 1: Token format validity
//
// For any generated CSRF token, the token SHALL be at least 43 characters
// long and consist exclusively of URL-safe characters (letters, digits,
// hyphens, and underscores).
// Validates: Requirements 1.1, 1.2
// ---------------------------------------------------------------------------

describe('Property 1: Token format validity', () => {
  test(`all ${ITERATIONS} generated tokens meet format requirements`, () => {
    const urlSafePattern = /^[A-Za-z0-9_-]+$/;

    for (let i = 0; i < ITERATIONS; i++) {
      const token = generateCsrfToken();

      // Must be a string
      expect(typeof token).toBe('string');

      // Must be at least 43 characters (32 bytes base64url = 43 chars)
      expect(token.length).toBeGreaterThanOrEqual(43);

      // Must contain only URL-safe characters
      expect(token).toMatch(urlSafePattern);

      // Must not contain base64 padding
      expect(token).not.toContain('=');

      // Must not contain non-URL-safe base64 characters
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
    }
  });
});

// ---------------------------------------------------------------------------
// Feature: csrf-protection, Property 2: Token uniqueness
//
// For any two CSRF tokens generated in sequence, the two tokens SHALL be
// distinct values.
// Validates: Requirements 1.3, 10.1, 10.2
// ---------------------------------------------------------------------------

describe('Property 2: Token uniqueness', () => {
  test(`all ${ITERATIONS} sequential token pairs are distinct`, () => {
    let previous = generateCsrfToken();

    for (let i = 0; i < ITERATIONS; i++) {
      const current = generateCsrfToken();
      expect(current).not.toBe(previous);
      previous = current;
    }
  });

  test(`${ITERATIONS} tokens are all unique (no collisions in set)`, () => {
    const tokens = new Set();

    for (let i = 0; i < ITERATIONS; i++) {
      const token = generateCsrfToken();
      expect(tokens.has(token)).toBe(false);
      tokens.add(token);
    }

    expect(tokens.size).toBe(ITERATIONS);
  });
});
