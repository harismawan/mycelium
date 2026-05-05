import Elysia from 'elysia';
import { prisma } from '../db.js';
import { StatusResponse, UnavailableResponse } from '../schemas/responses.js';

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
  }, {
    response: {
      200: StatusResponse,
    },
    detail: {
      summary: 'Check service health',
      description: 'Returns the current health status of the API service. Always responds 200 when the process is running. No authentication required.',
      tags: ['Health'],
      operationId: 'checkHealth',
      security: [],
    },
  })

  .get('/ready', async (/** @type {{ set: any }} */ ctx) => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'ok' };
    } catch {
      ctx.set.status = 503;
      return { status: 'unavailable' };
    }
  }, {
    response: {
      200: StatusResponse,
      503: UnavailableResponse,
    },
    detail: {
      summary: 'Check service readiness',
      description: 'Returns 200 when the database is reachable, 503 otherwise. Used as a readiness probe for orchestrators. No authentication required.',
      tags: ['Health'],
      operationId: 'checkReadiness',
      security: [],
    },
  });
