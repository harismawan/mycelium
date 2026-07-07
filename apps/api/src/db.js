import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client. Prisma 7 requires a driver adapter — the binary
 * query-engine path is retired. Cached on globalThis in non-production so
 * Bun's hot-reload does not leak connection pools.
 *
 * Tests may swap this for a mock by setting `globalThis.__mycelium_prisma`
 * before any service module is imported.
 *
 * @type {import('@prisma/client').PrismaClient}
 */
const prisma =
  globalThis.__mycelium_prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__mycelium_prisma = prisma;
}

/**
 * Boot-time probe — `SELECT 1` against Postgres so misconfiguration surfaces
 * immediately as a structured log instead of first-traffic 500s.
 *
 * @returns {Promise<{ ok: boolean, ms: number, err?: Error }>}
 */
export async function checkConnection() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, ms: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      err: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export { prisma };
