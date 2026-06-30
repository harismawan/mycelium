import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { prisma } from './db.js';
import { resolveAuth } from './auth.js';
import { createServer } from './server.js';
import { log } from './logger.js';
import { destroySession } from './session.js';
import { connectRedis } from '@mycelium/shared/redis';

/**
 * Determine the transport mode from CLI args or environment variable.
 * Supports `--transport=stdio` / `--transport=http` flags and `MCP_TRANSPORT` env var.
 * Defaults to `stdio`.
 *
 * @returns {'stdio' | 'http'}
 */
function getTransport() {
  const flag = process.argv.find((a) => a.startsWith('--transport='));
  if (flag) {
    const value = flag.split('=')[1];
    if (value === 'http' || value === 'stdio') return value;
  }
  const env = process.env.MCP_TRANSPORT;
  if (env === 'http' || env === 'stdio') return env;
  return 'stdio';
}

/**
 * Validate database connectivity. Exits with code 1 on failure.
 */
async function ensureDatabase() {
  try {
    await prisma.$connect();
    log('info', 'Database connected');
  } catch (err) {
    log('error', 'Database connection failed', { error: err.message });
    process.exit(1);
  }
}

/**
 * Start the MCP server with stdio transport.
 * Auth is resolved once at startup from the MYCELIUM_API_KEY env var.
 */
async function startStdio() {
  const auth = await resolveAuth('stdio');
  const server = createServer(auth);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'MCP server started', { transport: 'stdio' });

  const cleanup = async () => {
    await destroySession(auth.apiKeyId);
    log('info', 'Session destroyed', { apiKeyId: auth.apiKeyId, reason: 'stdio close' });
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.stdin.on('end', cleanup);
}

// NOTE: Do not cache McpServer instances across HTTP requests.
// An McpServer can only be connected to a single transport instance; reusing it
// causes "Already connected to a transport" errors on subsequent requests.

/**
 * Start the MCP server with Streamable HTTP transport using Bun.serve.
 * Auth is resolved per incoming request from the Authorization header.
 * Server instances are cached by apiKeyId and reused across serial requests.
 */
async function startHttp() {
  const port = parseInt(process.env.MCP_PORT || '3001', 10);

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname !== '/mcp') {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
        return new Response(
          JSON.stringify({ error: 'Method not allowed. Use POST for Streamable HTTP transport.' }),
          { status: 405, headers: { 'Content-Type': 'application/json' } },
        );
      }

      try {
        const auth = await resolveAuth('http', req);

        // Create a fresh server per request/connection.
        // Reusing a connected server instance across transports is invalid.
        const server = createServer(auth);

        const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        transport.onclose = async () => {
          await destroySession(auth.apiKeyId);
          log('info', 'Session destroyed', { apiKeyId: auth.apiKeyId, reason: 'http close' });
        };

        await server.connect(transport);
        return await transport.handleRequest(req);
      } catch (err) {
        const message = err?.message || 'Unknown error';
        const isAuthError =
          message.includes('Authorization: Bearer <key>') || message.includes('Invalid API key');

        log('error', 'HTTP connection error', { error: message, status: isAuthError ? 401 : 500 });
        return new Response(JSON.stringify({ error: message }), {
          status: isAuthError ? 401 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    },
  });

  log('info', 'MCP server started', { transport: 'http', port });
}

/**
 * Main entry point.
 */
async function main() {
  const transport = getTransport();
  log('info', 'Starting MCP server', { transport });

  await ensureDatabase();

  // Connect to Redis for session context storage
  try {
    await connectRedis();
  } catch (err) {
    log('error', 'Redis connection failed', { error: err.message });
    process.exit(1);
  }

  if (transport === 'stdio') {
    await startStdio();
  } else {
    await startHttp();
  }
}

main().catch((err) => {
  log('error', 'Fatal startup error', { error: err.message });
  process.exit(1);
});
