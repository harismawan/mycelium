import { describe, test, expect } from 'bun:test';
import { prefixKey } from '../redis.js';

// ---------------------------------------------------------------------------
// Property 1: Key prefix invariant
//
// For any key string and any configured prefix, prefixKey(key) SHALL return
// a string that starts with the configured prefix followed by the original
// key, and the original key SHALL be recoverable by stripping the prefix.
//
// Feature: session-management-redis, Property 1: Key prefix invariant
// Validates: Requirements 1.6
// ---------------------------------------------------------------------------

const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'mycelium:';

/**
 * Generate a random string of given length using printable ASCII characters.
 */
function randomString(maxLen = 64) {
  const len = Math.floor(Math.random() * maxLen) + 1;
  const chars = [];
  for (let i = 0; i < len; i++) {
    chars.push(String.fromCharCode(32 + Math.floor(Math.random() * 95)));
  }
  return chars.join('');
}

describe('Property 1: Key prefix invariant', () => {
  test('prefixKey(key) starts with the configured prefix for 200 random keys', () => {
    for (let i = 0; i < 200; i++) {
      const key = randomString();
      const prefixed = prefixKey(key);
      expect(prefixed.startsWith(KEY_PREFIX)).toBe(true);
    }
  });

  test('original key is recoverable by stripping the prefix for 200 random keys', () => {
    for (let i = 0; i < 200; i++) {
      const key = randomString();
      const prefixed = prefixKey(key);
      const recovered = prefixed.slice(KEY_PREFIX.length);
      expect(recovered).toBe(key);
    }
  });

  test('prefixKey produces prefix + key concatenation (no extra characters)', () => {
    for (let i = 0; i < 200; i++) {
      const key = randomString();
      const prefixed = prefixKey(key);
      expect(prefixed).toBe(`${KEY_PREFIX}${key}`);
      expect(prefixed.length).toBe(KEY_PREFIX.length + key.length);
    }
  });

  test('prefixKey works with empty string', () => {
    const prefixed = prefixKey('');
    expect(prefixed).toBe(KEY_PREFIX);
  });

  test('prefixKey works with keys containing colons and special characters', () => {
    const specialKeys = [
      'session:abc123',
      'jti:xyz-456',
      'mcp:conn1:mykey',
      'refresh:token/with/slashes',
      'key with spaces',
      'key:with:many:colons:nested',
    ];
    for (const key of specialKeys) {
      const prefixed = prefixKey(key);
      expect(prefixed).toBe(`${KEY_PREFIX}${key}`);
      expect(prefixed.slice(KEY_PREFIX.length)).toBe(key);
    }
  });
});
