import { z } from "zod";
import { makeRememberHandler } from "./remember.js";

/**
 * Register the `save_memory` tool — a thin alias for `remember` that omits the
 * `mode` parameter, so it defaults to append-on-duplicate consolidation.
 *
 * Kept for backward compatibility with existing OpenClaw session-end flows.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[], apiKeyId?: string, apiKeyName?: string }} auth
 */
export function register(server, auth) {
  server.tool(
    "save_memory",
    'Alias for `remember` (append-on-duplicate). Save a finding or summary as a durable memory note: auto-tagged "agent-memory", filed in the memories directory, and published. Consolidates into an existing memory with the same title instead of creating duplicates.',
    {
      title: z.string().min(1, "title is required"),
      content: z.string(),
      tags: z.array(z.string()).optional(),
      metadata: z
        .object({
          source: z.string().optional(),
          confidence: z.number().min(0).max(1).optional(),
          importance: z.number().int().min(1).max(5).optional(),
        })
        .optional(),
    },
    makeRememberHandler(auth, "save_memory"),
  );
}
