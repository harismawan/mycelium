import Elysia from 'elysia';
import { AuthService } from '../services/auth.service.js';

/**
 * @typedef {Object} AuthContext
 * @property {{ id: string, email: string, displayName: string, createdAt: Date, updatedAt: Date }} user
 * @property {'jwt' | 'apikey'} authType
 * @property {string[]} scopes
 */

/**
 * Resolve auth credentials from the request.
 * Checks JWT cookie first (with manual fallback), then Bearer header.
 *
 * @param {{ cookie?: Record<string, any>, request: Request, set: any }} ctx
 * @returns {Promise<{ user: any, authType: string | null, scopes: string[] }>}
 */
async function resolveAuth(ctx) {
  // 1. Check JWT cookie — handle both Elysia Cookie objects and raw strings
  const jwtCookie = ctx.cookie?.auth;
  const cookieValue = jwtCookie?.value ?? jwtCookie?.toString?.() ?? null;
  if (cookieValue && cookieValue !== 'undefined' && cookieValue !== '') {
    const user = await AuthService.verifyJwt(String(cookieValue));
    if (user) {
      return { user, authType: 'jwt', scopes: ['*'] };
    }
  }

  // 1b. Fallback: parse cookie header manually
  const rawCookie = ctx.request.headers.get('cookie') ?? '';
  const authMatch = rawCookie.match(/(?:^|;\s*)auth=([^;]+)/);
  if (authMatch && authMatch[1]) {
    const user = await AuthService.verifyJwt(authMatch[1]);
    if (user) {
      return { user, authType: 'jwt', scopes: ['*'] };
    }
  }

  // 2. Check Bearer header
  const authHeader = ctx.request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7).trim();
    if (apiKey) {
      const result = await AuthService.verifyApiKey(apiKey);
      if (result) {
        return { user: result.user, authType: 'apikey', scopes: result.scopes };
      }
    }
  }

  // 3. No valid credentials
  return { user: null, authType: null, scopes: [] };
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
