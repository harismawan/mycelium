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
import { graphRoutes } from './routes/graph.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
import { activityLogRoutes } from './routes/activity-log.routes.js';

const port = process.env.PORT || 3000;

// Connect to Redis before starting the server
try {
  await connectRedis();
} catch (err) {
  console.error('❌ Failed to connect to Redis:', err.message);
  process.exit(1);
}

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
          { name: 'Graph', description: 'Knowledge graph and link traversal' },
          { name: 'Agent', description: 'Machine-friendly endpoints for AI agent consumption' },
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
  .use(graphRoutes)
  .use(agentRoutes)
  .use(activityLogRoutes)
  .listen(port);

console.log(`🍄 Mycelium API listening on http://localhost:${port}`);

export { app };
