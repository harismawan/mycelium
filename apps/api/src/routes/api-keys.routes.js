import { createHash, randomBytes } from 'crypto';
import Elysia, { t } from 'elysia';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

/**
 * Generate a new API key with `myc_` prefix and its SHA-256 hash.
 * @returns {{ plaintext: string, hash: string }}
 */
function generateApiKey() {
  const plaintext = `myc_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash };
}

/**
 * Guard that rejects non-JWT auth. API key management is JWT-only.
 * @param {{ authType: string, set: any }} ctx
 */
function requireJwt(ctx) {
  if (ctx.authType !== 'jwt') {
    ctx.set.status = 403;
    throw new Error('Forbidden: API key management requires JWT authentication');
  }
}

/**
 * API key route group — `/api/v1/api-keys`
 *
 * All routes require JWT authentication (not API key auth).
 *
 * @type {Elysia}
 */
export const apiKeyRoutes = new Elysia({ prefix: '/api/v1/api-keys' })
  .use(authMiddleware)
  .onBeforeHandle(requireJwt)

  // POST / — create a new API key
  .post(
    '/',
    async (/** @type {{ body: { name: string, scopes?: string[] }, user: { id: string }, set: any }} */ ctx) => {
      const { name, scopes = ['notes:read'] } = ctx.body;
      const { plaintext, hash } = generateApiKey();

      const record = await prisma.apiKey.create({
        data: {
          name,
          keyHash: hash,
          scopes,
          userId: ctx.user.id,
        },
        select: {
          id: true,
          name: true,
          scopes: true,
          createdAt: true,
        },
      });

      ctx.set.status = 201;
      return { ...record, key: plaintext };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        scopes: t.Optional(t.Array(t.String({ minLength: 1 }))),
      }),
    },
  )

  // GET / — list all API keys for the current user (no hashes)
  .get(
    '/',
    async (/** @type {{ user: { id: string } }} */ ctx) => {
      const keys = await prisma.apiKey.findMany({
        where: { userId: ctx.user.id },
        select: {
          id: true,
          name: true,
          scopes: true,
          lastUsedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return { keys };
    },
  )

  // DELETE /:id — revoke (delete) an API key
  .delete(
    '/:id',
    async (/** @type {{ params: { id: string }, user: { id: string }, set: any }} */ ctx) => {
      const { id } = ctx.params;

      const existing = await prisma.apiKey.findFirst({
        where: { id, userId: ctx.user.id },
      });

      if (!existing) {
        ctx.set.status = 404;
        return { error: 'API key not found' };
      }

      await prisma.apiKey.delete({ where: { id } });

      return { message: 'API key revoked' };
    },
    {
      params: t.Object({
        id: t.String({ minLength: 1 }),
      }),
    },
  );
