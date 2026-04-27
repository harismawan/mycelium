import Elysia, { t } from 'elysia';
import { AuthService } from '../services/auth.service.js';
import { authMiddleware } from '../middleware/auth.js';

/**
 * Auth route group — `/api/v1/auth`
 *
 * Public routes: register, login
 * Protected routes: logout, me
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
        const { user, token } = await AuthService.login(email, password);

        ctx.cookie.auth.set({
          value: token,
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return { user, token };
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
        password: t.String({ minLength: 1 }),
      }),
    },
  )

  // ── Protected routes ───────────────────────────────────────────

  .use(authMiddleware)

  .post('/logout', (/** @type {{ cookie: Record<string, any> }} */ ctx) => {
    ctx.cookie.auth.set({
      value: '',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
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
