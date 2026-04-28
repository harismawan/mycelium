import { checkScopes } from '../auth.js';
import { log } from '../logger.js';
import { getSessionStore } from '../session.js';

/**
 * Register the `list_session_context` tool on the MCP server.
 *
 * Returns all key-value pairs in the current session store.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    'list_session_context',
    'List all key-value pairs in the ephemeral session context.',
    {},
    async () => {
      const scopeError = checkScopes(['agent:read'], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const store = getSessionStore(auth.userId);
        const entries = Array.from(store.entries()).map(([key, value]) => ({ key, value }));

        log('info', 'tool.call', { tool: 'list_session_context', durationMs: performance.now() - start, success: true });
        return { content: [{ type: 'text', text: JSON.stringify({ entries }) }] };
      } catch (err) {
        log('error', 'tool.call', { tool: 'list_session_context', durationMs: performance.now() - start, success: false, error: err.message });
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Internal error', message: err.message }) }],
          isError: true,
        };
      }
    },
  );
}
