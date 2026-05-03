import Elysia from 'elysia';
import { prisma } from '../db.js';

/**
 * Health and readiness route group — root-level (no prefix).
 *
 * Public routes (no auth required):
 * - GET /health  — liveness probe, always returns 200 when the process is running
 * - GET /ready   — readiness probe, returns 200 when the database is reachable, 503 otherwise
 *
 * @type {Elysia}
 */
export const healthRoutes = new Elysia()
  .get('/health', () => {
    return { status: 'ok' };
  })

  .get('/ready', async (/** @type {{ set: any }} */ ctx) => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'ok' };
    } catch {
      ctx.set.status = 503;
      return { status: 'unavailable' };
    }
  });
