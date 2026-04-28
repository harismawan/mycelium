import { z } from 'zod';
import { checkScopes } from '../auth.js';
import { log } from '../logger.js';
import { getSessionStore } from '../session.js';

/**
 * Register the `get_session_context` tool on the MCP server.
 *
 * Retrieves a value from the ephemeral session store by key. Returns null
 * if the key does not exist.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    'get_session_context',
    'Retrieve a value from the ephemeral session context by key.',
    {
      key: z.string().min(1, 'key is required'),
    },
    async ({ key }) => {
      const scopeError = checkScopes(['agent:read'], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const store = getSessionStore(auth.userId);
        const value = store.get(key) ?? null;

        log('info', 'tool.call', { tool: 'get_session_context', durationMs: performance.now() - start, success: true });
        return { content: [{ type: 'text', text: JSON.stringify({ value }) }] };
      } catch (err) {
        log('error', 'tool.call', { tool: 'get_session_context', durationMs: performance.now() - start, success: false, error: err.message });
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Internal error', message: err.message }) }],
          isError: true,
        };
      }
    },
  );
}
