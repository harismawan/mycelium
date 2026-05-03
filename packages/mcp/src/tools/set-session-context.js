import { z } from "zod";
import { checkScopes } from "../auth.js";
import { log } from "../logger.js";
import { logMcpAction } from "../activity-log.js";
import { setSessionValue, validateSessionLimits } from "../session.js";

/**
 * Register the `set_session_context` tool on the MCP server.
 *
 * Stores a key-value pair in the Redis-backed session store scoped to the
 * current connection. Enforces max 100 keys and 10KB per value.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.tool(
    "set_session_context",
    "Store a key-value pair in the ephemeral session context for this connection.",
    {
      key: z.string().min(1, "key is required"),
      value: z.string(),
    },
    async ({ key, value }) => {
      const scopeError = checkScopes(["agent:read"], auth.scopes);
      if (scopeError) return scopeError;

      const start = performance.now();
      try {
        const limitError = await setSessionValue(auth.userId, key, value);
        if (limitError) {
          await logMcpAction(auth, {
            action: "mcp:set_session_context",
            status: "error",
            details: {
              durationMs: performance.now() - start,
              success: false,
              error: limitError,
            },
          });

          log("warn", "tool.call", {
            tool: "set_session_context",
            durationMs: performance.now() - start,
            success: false,
            error: limitError,
          });
          return {
            content: [
              { type: "text", text: JSON.stringify({ error: limitError }) },
            ],
            isError: true,
          };
        }

        await logMcpAction(auth, {
          action: "mcp:set_session_context",

          status: "success",

          details: { durationMs: performance.now() - start, success: true },
        });

        log("info", "tool.call", {
          tool: "set_session_context",
          durationMs: performance.now() - start,
          success: true,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true }) }],
        };
      } catch (err) {
        await logMcpAction(auth, {
          action: "mcp:set_session_context",

          status: "error",

          details: {
            durationMs: performance.now() - start,
            success: false,
            error: err.message,
          },
        });

        log("error", "tool.call", {
          tool: "set_session_context",
          durationMs: performance.now() - start,
          success: false,
          error: err.message,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Internal error",
                message: err.message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
