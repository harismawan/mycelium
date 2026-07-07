import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client. Prisma 7 requires a driver adapter — the binary
 * query-engine path is retired. Cached on globalThis in non-production so
 * Bun's hot-reload does not leak connection pools.
 *
 * Uses the same global cache key as the API package so REST and MCP code share
 * one client when loaded in the same process.
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

export { prisma };
