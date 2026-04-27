import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client instance.
 * Reuses a single connection pool across the application lifetime.
 * In development, the instance is cached on `globalThis` to survive
 * hot-reloads without leaking database connections.
 *
 * @type {PrismaClient}
 */
const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export { prisma };
