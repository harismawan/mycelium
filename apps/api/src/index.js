import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { applyLogger } from './middleware/logger.js';
import { rateLimiter } from './middleware/rate-limiter.js';
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
const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      path: '/swagger',
      documentation: {
        info: {
          title: 'Mycelium API',
          version: '0.1.0',
          description:
            'Dual-audience knowledge base — REST API for humans and AI agents.',
        },
      },
    }),
  );

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
