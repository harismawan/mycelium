import Elysia from 'elysia';
import { AuthService } from '../services/auth.service.js';
import { SessionService } from '../services/session.service.js';
import { isRedisConnected } from '@mycelium/shared/redis';
import { prisma } from '../db.js';

/**
 * @typedef {Object} AuthContext
 * @property {{ id: string, email: string, displayName: string, createdAt: Date, updatedAt: Date }} user
 * @property {'jwt' | 'apikey'} authType
 * @property {string[]} scopes
 * @property {string|null} apiKeyId
 * @property {string|null} apiKeyName
 */

/**
 * Cookie configuration for the access token.
 */
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 86400, // 1 day
};

/**
 * Cookie configuration for the refresh token.
 */
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth',
  maxAge: 604800, // 7 days
};

/**
 * Extract a cookie value from the request context.
 * Handles both Elysia Cookie objects and raw strings.
 *
 * @param {any} ctx - Elysia request context
 * @param {string} name - Cookie name
 * @returns {string | null}
 */
function getCookieValue(ctx, name) {
  // Try Elysia cookie object first
  const cookie = ctx.cookie?.[name];
  const value = cookie?.value ?? cookie?.toString?.() ?? null;
  if (value && value !== 'undefined' && value !== '') {
    return String(value);
  }

  // Fallback: parse cookie header manually
  const rawCookie = ctx.request.headers.get('cookie') ?? '';
  const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (match && match[1]) {
    return match[1];
  }

  return null;
}

/**
 * Clear both auth and refresh cookies.
 *
 * @param {any} ctx - Elysia request context
 */
function clearAuthCookies(ctx) {
  if (ctx.cookie?.auth) {
    ctx.cookie.auth.set({ ...AUTH_COOKIE_OPTIONS, maxAge: 0, value: '' });
  }
  if (ctx.cookie?.refresh) {
    ctx.cookie.refresh.set({ ...REFRESH_COOKIE_OPTIONS, maxAge: 0, value: '' });
  }
}

/**
 * Attempt to authenticate via JWT access token with Redis validation.
 *
 * Flow:
 * 1. Verify JWT signature and expiration
 * 2. Check jti exists in Redis (mandatory — Redis is source of truth)
 * 3. Check session exists in Redis
 * 4. Update session activity
 *
 * @param {any} ctx - Elysia request context
 * @param {string} token - JWT access token
 * @returns {Promise<{ user: any, authType: string, scopes: string[], apiKeyId: string|null, apiKeyName: string|null } | { error: string, status: number } | null>}
 */
async function authenticateWithJwt(ctx, token) {
  // Check Redis availability for JWT auth
  if (!isRedisConnected()) {
    return { error: 'Service temporarily unavailable', status: 503 };
  }

  // Verify JWT signature and expiration
  const payload = SessionService.verifyToken(token);
  if (!payload) {
    return null; // JWT invalid or expired — will try refresh
  }

  const { sub: userId, sid: sessionId, jti } = payload;
  if (!userId || !sessionId || !jti) {
    return null;
  }

  // MANDATORY: Check jti exists in Redis (source of truth)
  try {
    const tokenActive = await SessionService.isTokenActive(jti);
    if (!tokenActive) {
      // Token has been revoked — reject regardless of JWT validity
      return { error: 'Unauthorized', status: 401 };
    }

    // Check session exists in Redis
    const session = await SessionService.validateSession(sessionId);
    if (!session) {
      // Session revoked — clear cookies
      clearAuthCookies(ctx);
      return { error: 'Unauthorized', status: 401 };
    }

    // Fetch user from database using the userId from the token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });
    if (!user) {
      return { error: 'Unauthorized', status: 401 };
    }

    return { user, authType: 'jwt', scopes: ['*'], apiKeyId: null, apiKeyName: null };
  } catch (err) {
    // Redis error during validation
    return { error: 'Service temporarily unavailable', status: 503 };
  }
}

/**
 * Attempt to refresh the access token using the refresh token cookie.
 *
 * @param {any} ctx - Elysia request context
 * @param {string} refreshToken - Refresh token value
 * @param {string} [oldJti] - jti from the expired access token
 * @returns {Promise<{ user: any, authType: string, scopes: string[], apiKeyId: string|null, apiKeyName: string|null } | { error: string, status: number } | null>}
 */
async function attemptRefresh(ctx, refreshToken, oldJti) {
  if (!isRedisConnected()) {
    return { error: 'Service temporarily unavailable', status: 503 };
  }

  try {
    const result = await SessionService.refreshAccessToken(refreshToken, oldJti);
    if (!result) {
      // Refresh token invalid or expired — clear both cookies
      clearAuthCookies(ctx);
      return { error: 'Unauthorized', status: 401 };
    }

    // Set new access token cookie
    if (ctx.cookie?.auth) {
      ctx.cookie.auth.set({ ...AUTH_COOKIE_OPTIONS, value: result.accessToken });
    }

    // Fetch user from database using the userId from the refresh result
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });
    if (!user) {
      return { error: 'Unauthorized', status: 401 };
    }

    return { user, authType: 'jwt', scopes: ['*'], apiKeyId: null, apiKeyName: null };
  } catch (err) {
    return { error: 'Service temporarily unavailable', status: 503 };
  }
}

/**
 * Resolve auth credentials from the request.
 *
 * Authentication paths:
 * 1. JWT cookie → verify signature → check jti in Redis → check session in Redis
 * 2. If JWT expired but refresh cookie present → attempt refresh
 * 3. Bearer header → API key lookup (no Redis involved)
 *
 * @param {{ cookie?: Record<string, any>, request: Request, set: any }} ctx
 * @returns {Promise<{ user: any, authType: string | null, scopes: string[], apiKeyId: string | null, apiKeyName: string | null }>}
 */
async function resolveAuth(ctx) {
  // 1. Check JWT cookie (access token)
  const accessToken = getCookieValue(ctx, 'auth');
  const refreshToken = getCookieValue(ctx, 'refresh');

  if (accessToken) {
    const jwtResult = await authenticateWithJwt(ctx, accessToken);

    if (jwtResult) {
      if (jwtResult.error) {
        // Error response (401 or 503)
        ctx.set.status = jwtResult.status;
        return { user: null, authType: null, scopes: [], apiKeyId: null, apiKeyName: null, _error: jwtResult };
      }
      return jwtResult;
    }

    // JWT invalid/expired — try refresh if refresh token is available
    if (refreshToken) {
      // Decode the expired token to get the old jti
      const decoded = SessionService.decodeToken(accessToken);
      const oldJti = decoded?.jti || undefined;

      const refreshResult = await attemptRefresh(ctx, refreshToken, oldJti);
      if (refreshResult) {
        if (refreshResult.error) {
          ctx.set.status = refreshResult.status;
          return { user: null, authType: null, scopes: [], apiKeyId: null, apiKeyName: null, _error: refreshResult };
        }
        return refreshResult;
      }
    }
  } else if (refreshToken) {
    // No access token but refresh token present — attempt refresh
    const refreshResult = await attemptRefresh(ctx, refreshToken, undefined);
    if (refreshResult) {
      if (refreshResult.error) {
        ctx.set.status = refreshResult.status;
        return { user: null, authType: null, scopes: [], apiKeyId: null, apiKeyName: null, _error: refreshResult };
      }
      return refreshResult;
    }
  }

  // 2. Check Bearer header (API key — no Redis involved)
  const authHeader = ctx.request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7).trim();
    if (apiKey) {
      const result = await AuthService.verifyApiKey(apiKey);
      if (result) {
        return { user: result.user, authType: 'apikey', scopes: result.scopes, apiKeyId: result.apiKeyId, apiKeyName: result.apiKeyName };
      }
    }
  }

  // 3. No valid credentials
  return { user: null, authType: null, scopes: [], apiKeyId: null, apiKeyName: null };
}

/**
 * Auth middleware — Elysia plugin using `as('plugin')` to propagate
 * the derived context to the parent instance's routes.
 */
export const authMiddleware = new Elysia({ name: 'auth-middleware' })
  .derive({ as: 'scoped' }, async (ctx) => {
    return resolveAuth(ctx);
  })
  .onBeforeHandle({ as: 'scoped' }, (ctx) => {
    // If resolveAuth set an error response, return it
    if (ctx._error) {
      ctx.set.status = ctx._error.status;
      return { error: ctx._error.error };
    }
    if (!ctx.user) {
      ctx.set.status = 401;
      return { error: 'Unauthorized' };
    }
  });

/**
 * Helper that returns an Elysia plugin enforcing the given scopes.
 * Use after `authMiddleware` in the plugin chain.
 *
 * @param {...string} requiredScopes - Scopes the route requires.
 * @returns {Elysia}
 */
export function requireScopes(...requiredScopes) {
  return new Elysia({ name: `require-scopes-${requiredScopes.join(',')}` }).onBeforeHandle(
    { as: 'scoped' },
    (/** @type {{ user: any, authType: string, scopes: string[], set: any }} */ ctx) => {
      if (ctx.authType === 'jwt') return;

      const userScopes = ctx.scopes || [];
      if (userScopes.includes('*')) return;

      const missing = requiredScopes.filter((s) => !userScopes.includes(s));
      if (missing.length > 0) {
        ctx.set.status = 403;
        return { error: `Forbidden: missing scopes: ${missing.join(', ')}` };
      }
    },
  );
}

// Export cookie options for use in auth routes
export { AUTH_COOKIE_OPTIONS, REFRESH_COOKIE_OPTIONS, clearAuthCookies };
