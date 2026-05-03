import { randomBytes, timingSafeEqual, createHash } from 'crypto';

/**
 * Cookie configuration for the CSRF token.
 *
 * - httpOnly: false — SPA JavaScript must be able to read this cookie
 * - sameSite: lax — prevents cross-site POST but allows top-level navigations
 * - path: / — available to all routes
 * - maxAge: 86400 — matches the access token cookie (1 day)
 * - secure: true in production, false in development
 */
export const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 86400,
};

/**
 * Generate a cryptographically secure CSRF token.
 *
 * Produces 32 bytes of randomness (256 bits of entropy) encoded as a
 * base64url string (43 characters, no padding). The result contains
 * only URL-safe characters: A-Z, a-z, 0-9, -, _.
 *
 * @returns {string} URL-safe CSRF token (43+ characters)
 */
export function generateCsrfToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Compare two CSRF tokens using constant-time equality.
 *
 * Both tokens are hashed with SHA-256 before comparison so that:
 * 1. The comparison always operates on fixed-length (32-byte) buffers
 * 2. No timing information leaks about token length or content
 * 3. timingSafeEqual never throws due to length mismatch
 *
 * @param {string} a - Token from the x-csrf-token header
 * @param {string} b - Token from the csrf cookie
 * @returns {boolean} True if the tokens match
 */
export function csrfTokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
