import Elysia, { t } from 'elysia';
import { AuthService } from '../services/auth.service.js';
import { SessionService } from '../services/session.service.js';
import { authMiddleware, AUTH_COOKIE_OPTIONS, REFRESH_COOKIE_OPTIONS, clearAuthCookies } from '../middleware/auth.js';
import { isRedisConnected } from '@mycelium/shared/redis';

/**
 * Auth route group — `/api/v1/auth`
 *
 * Public routes: register, login, refresh
 * Protected routes: logout, me, change-password
 *
 * @type {Elysia}
 */
export const authRoutes = new Elysia({ prefix: '/api/v1/auth' })
  // ── Public routes ──────────────────────────────────────────────

  .post(
    '/register',
    async (/** @type {{ body: { email: string, password: string, displayName: string }, set: any }} */ ctx) => {
      try {
        const { email, password, displayName } = ctx.body;
        const user = await AuthService.register(email, password, displayName);
        ctx.set.status = 201;
        return user;
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8 }),
        displayName: t.String({ minLength: 1 }),
      }),
    },
  )

  .post(
    '/login',
    async (/** @type {{ body: { email: string, password: string }, cookie: Record<string, any>, set: any }} */ ctx) => {
      try {
        const { email, password } = ctx.body;
        const { user } = await AuthService.login(email, password);

        // Check Redis availability before creating session
        if (!isRedisConnected()) {
          ctx.set.status = 503;
          return { error: 'Service temporarily unavailable: session creation failed' };
        }

        // Create server-side session and issue token pair
        const { tokens } = await SessionService.createSession(user.id, user.email);

        // Set access token cookie (1-day TTL)
        ctx.cookie.auth.set({
          ...AUTH_COOKIE_OPTIONS,
          value: tokens.accessToken,
        });

        // Set refresh token cookie (7-day TTL, scoped to /api/v1/auth)
        ctx.cookie.refresh.set({
          ...REFRESH_COOKIE_OPTIONS,
          value: tokens.refreshToken,
        });

        return { user, accessToken: tokens.accessToken };
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        // Redis or other infrastructure error during session creation
        ctx.set.status = 503;
        return { error: 'Service temporarily unavailable: session creation failed' };
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 1 }),
      }),
    },
  )

  // ── Refresh endpoint (public — does NOT require valid access token) ────
  .post(
    '/refresh',
    async (/** @type {{ cookie: Record<string, any>, set: any }} */ ctx) => {
      try {
        // Read refresh cookie
        const refreshCookie = ctx.cookie?.refresh;
        const refreshToken = refreshCookie?.value ?? refreshCookie?.toString?.() ?? null;

        if (!refreshToken || refreshToken === 'undefined' || refreshToken === '') {
          ctx.set.status = 401;
          return { error: 'Unauthorized' };
        }

        if (!isRedisConnected()) {
          ctx.set.status = 503;
          return { error: 'Service temporarily unavailable' };
        }

        // Attempt to refresh the access token
        const result = await SessionService.refreshAccessToken(String(refreshToken));

        if (!result) {
          // Refresh token invalid or expired — clear both cookies
          clearAuthCookies(ctx);
          ctx.set.status = 401;
          return { error: 'Unauthorized' };
        }

        // Set new access token cookie
        ctx.cookie.auth.set({
          ...AUTH_COOKIE_OPTIONS,
          value: result.accessToken,
        });

        return { token: result.accessToken };
      } catch (err) {
        ctx.set.status = 503;
        return { error: 'Service temporarily unavailable' };
      }
    },
  )

  // ── Protected routes ───────────────────────────────────────────

  .use(authMiddleware)

  .post('/logout', async (/** @type {{ cookie: Record<string, any>, set: any }} */ ctx) => {
    try {
      // Extract session ID from the access token (decode without full verification)
      const authCookie = ctx.cookie?.auth;
      const accessToken = authCookie?.value ?? authCookie?.toString?.() ?? null;

      if (accessToken && accessToken !== 'undefined' && accessToken !== '') {
        const decoded = SessionService.decodeToken(String(accessToken));
        if (decoded?.sid) {
          await SessionService.revokeSession(decoded.sid);
        }
      }
    } catch {
      // Best-effort revocation — continue to clear cookies even if Redis fails
    }

    // Clear both cookies
    ctx.cookie.auth.set({
      ...AUTH_COOKIE_OPTIONS,
      value: '',
      maxAge: 0,
    });
    ctx.cookie.refresh.set({
      ...REFRESH_COOKIE_OPTIONS,
      value: '',
      maxAge: 0,
    });

    return { message: 'Logged out' };
  })

  .get('/me', (/** @type {{ user: any }} */ ctx) => {
    return ctx.user;
  })

  .patch(
    '/me',
    async (/** @type {{ body: { displayName?: string }, user: { id: string }, set: any }} */ ctx) => {
      try {
        const user = await AuthService.updateProfile(ctx.user.id, ctx.body);
        return { user };
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        displayName: t.Optional(t.String({ minLength: 1 })),
      }),
    },
  )

  .post(
    '/change-password',
    async (/** @type {{ body: { currentPassword: string, newPassword: string }, user: { id: string }, set: any }} */ ctx) => {
      try {
        await AuthService.changePassword(ctx.user.id, ctx.body.currentPassword, ctx.body.newPassword);
        return { message: 'Password changed' };
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err) {
          ctx.set.status = /** @type {any} */ (err).statusCode;
          return { error: /** @type {any} */ (err).message };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 8 }),
      }),
    },
  );
