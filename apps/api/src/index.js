import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { applyLogger } from './middleware/logger.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { connectRedis } from '@mycelium/shared/redis';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { apiKeyRoutes } from './routes/api-keys.routes.js';
import { noteRoutes } from './routes/notes.routes.js';
import { tagRoutes } from './routes/tags.routes.js';
import { directoryRoutes } from './routes/directory.routes.js';
import { graphRoutes } from './routes/graph.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
import { maintenanceRoutes } from './routes/maintenance.routes.js';
import { activityLogRoutes } from './routes/activity-log.routes.js';

const port = process.env.PORT || 3000;

/**
 * Main Elysia application.
 *
 * Wires together global middleware (CORS, logging, Swagger docs)
 * and all route groups, then starts listening on the configured port.
 *
 * @type {Elysia}
 */
// Conditional Swagger registration: disabled in production unless explicitly enabled
const isProduction = process.env.NODE_ENV === 'production';
const enableSwagger = process.env.ENABLE_SWAGGER === 'true';
const shouldEnableSwagger = !isProduction || enableSwagger;

const app = new Elysia()
  .onError(({ error, set, request }) => {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      set.status = /** @type {any} */ (error).statusCode;
      return { error: /** @type {any} */ (error).message };
    }
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: 'unhandled_error',
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    set.status = 500;
    return { error: 'Internal server error' };
  })
  .use(
    cors({
      origin: process.env.CORS_ORIGIN || true,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-request-id'],
      exposeHeaders: ['x-request-id'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

if (shouldEnableSwagger) {
  app.use(
    swagger({
      path: '/swagger',
      documentation: {
        info: {
          title: 'Mycelium API',
          version: '0.1.0',
          description: 'Dual-audience knowledge base — REST API for a human SPA and AI agents. '
            + 'Human users authenticate via JWT cookies; AI agents authenticate via Bearer API keys.',
        },
        tags: [
          { name: 'Health', description: 'Liveness and readiness probes' },
          { name: 'Auth', description: 'User registration, login, logout, and session management' },
          { name: 'Notes', description: 'CRUD operations for knowledge base notes' },
          { name: 'Tags', description: 'Tag listing and tag-based note filtering' },
          { name: 'Directories', description: 'Nested note directory organization' },
          { name: 'Graph', description: 'Knowledge graph and link traversal' },
          { name: 'Agent', description: 'Machine-friendly endpoints for AI agent consumption' },
          { name: 'Maintenance', description: 'Externally-scheduled upkeep (auto-archival of stale memories)' },
          { name: 'API Keys', description: 'API key creation, listing, and revocation' },
          { name: 'Activity Log', description: 'Audit log of API-key-authenticated actions' },
        ],
        servers: [
          { url: 'http://localhost:3000', description: 'Local development' },
        ],
        components: {
          securitySchemes: {
            cookieAuth: {
              type: 'apiKey',
              in: 'cookie',
              name: 'auth',
              description: 'JWT access token set as an HttpOnly cookie after login.',
            },
            bearerApiKey: {
              type: 'http',
              scheme: 'bearer',
              description: 'API key passed as a Bearer token in the Authorization header.',
            },
          },
        },
      },
    }),
  );
}

app.use(requestIdMiddleware);

// Apply logger directly on root app so hooks cover all routes
applyLogger(app);

app
  .use(healthRoutes)
  .use(authRoutes)
  .use(apiKeyRoutes)
  .use(noteRoutes)
  .use(tagRoutes)
  .use(directoryRoutes)
  .use(graphRoutes)
  .use(agentRoutes)
  .use(maintenanceRoutes)
  .use(activityLogRoutes);

// Boot the server only when this module is the entrypoint. Importing it
// (e.g. from tests) must not connect to Redis or bind a port — and keeping
// the top-level `await` out of the module body ensures `app` is fully
// initialized for importers (no temporal-dead-zone on the `app` export).
if (import.meta.main) {
  try {
    await connectRedis();
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err.message);
    process.exit(1);
  }
  app.listen(port);
  console.log(`🍄 Mycelium API listening on http://localhost:${port}`);
}

export { app };
