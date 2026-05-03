import Elysia from 'elysia';
import { csrfTokensMatch } from '../utils/csrf.js';

/**
 * HTTP methods that are considered state-changing and require CSRF validation.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/**
 * Paths that are exempt from CSRF validation.
 * These are public endpoints where no CSRF cookie exists yet.
 */
const EXEMPT_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
]);

/**
 * Extract a cookie value from the raw Cookie header.
 *
 * @param {Request} request
 * @param {string} name - Cookie name
 * @returns {string | null}
 */
function getCookieFromHeader(request, name) {
  const raw = request.headers.get('cookie') ?? '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * CSRF middleware — Elysia plugin.
 *
 * Validates CSRF tokens on state-changing requests (POST, PATCH, DELETE)
 * that are authenticated via JWT cookies. Skips validation for:
 * - GET, HEAD, OPTIONS, PUT requests (non-state-changing per requirements)
 * - API key authenticated requests (Bearer token, not vulnerable to CSRF)
 * - Unauthenticated requests (no auth context)
 * - Exempt paths (login, register, refresh — no CSRF cookie exists yet)
 *
 * Must be registered AFTER authMiddleware so that `authType` is available
 * in the request context.
 */
export const csrfMiddleware = new Elysia({ name: 'csrf-middleware' }).onBeforeHandle(
  { as: 'scoped' },
  (ctx) => {
    const method = ctx.request.method.toUpperCase();

    // Only validate state-changing methods
    if (!STATE_CHANGING_METHODS.has(method)) {
      return;
    }

    // Skip if not JWT-authenticated (API key, unauthenticated)
    if (ctx.authType !== 'jwt') {
      return;
    }

    // Skip exempt paths
    let pathname;
    try {
      pathname = new URL(ctx.request.url).pathname;
    } catch {
      pathname = ctx.request.url;
    }
    if (EXEMPT_PATHS.has(pathname)) {
      return;
    }

    // Read CSRF token from header
    const headerToken = ctx.request.headers.get('x-csrf-token');

    // Read CSRF token from cookie
    const cookieToken = getCookieFromHeader(ctx.request, 'csrf');

    // Both must be present
    if (!headerToken || !cookieToken) {
      ctx.set.status = 403;
      return { error: 'CSRF token missing' };
    }

    // Constant-time comparison
    if (!csrfTokensMatch(headerToken, cookieToken)) {
      ctx.set.status = 403;
      return { error: 'CSRF token invalid' };
    }

    // Tokens match — allow request to proceed
  },
);
