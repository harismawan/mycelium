import { createHash } from 'crypto';
import { prisma } from './db.js';

/**
 * Hash an API key using SHA-256.
 * @param {string} key - The plaintext API key.
 * @returns {string} The hex-encoded SHA-256 hash.
 */
function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Verify an API key by hashing it and looking up the hash in the database.
 * Returns the owning user and the key's scopes if valid.
 *
 * @param {string} key - The plaintext API key.
 * @returns {Promise<{ user: { id: string, email: string, displayName: string }, scopes: string[] } | null>}
 */
async function verifyApiKey(key) {
  const keyHash = hashApiKey(key);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      user: {
        select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
      },
    },
  });

  if (!apiKey) {
    return null;
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return { user: apiKey.user, scopes: apiKey.scopes };
}

/**
 * Resolve auth context from environment (stdio) or request header (HTTP).
 *
 * @param {'stdio' | 'http'} transport
 * @param {Request} [request] - HTTP request (only for HTTP transport)
 * @returns {Promise<{ userId: string, scopes: string[] }>}
 * @throws {Error} If API key is missing or invalid
 */
export async function resolveAuth(transport, request) {
  let key;

  if (transport === 'stdio') {
    key = process.env.MYCELIUM_API_KEY;
    if (!key) {
      throw new Error('MYCELIUM_API_KEY environment variable is required for stdio transport');
    }
  } else {
    const authHeader = request?.headers?.get?.('authorization') ?? request?.headers?.['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Authorization: Bearer <key> header is required for HTTP transport');
    }
    key = authHeader.slice(7);
  }

  const result = await verifyApiKey(key);
  if (!result) {
    throw new Error('Invalid API key');
  }

  return { userId: result.user.id, scopes: result.scopes };
}

/**
 * Check whether the user's scopes satisfy the required scopes for a tool.
 * Returns an MCP error content object if scopes are insufficient, or null if OK.
 *
 * @param {string[]} requiredScopes - Scopes required by the tool.
 * @param {string[]} userScopes - Scopes granted to the user's API key.
 * @returns {{ content: Array<{ type: string, text: string }>, isError: true } | null}
 */
export function checkScopes(requiredScopes, userScopes) {
  const missing = requiredScopes.filter((s) => !userScopes.includes(s));
  if (missing.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'Insufficient permissions', required: requiredScopes }),
        },
      ],
      isError: true,
    };
  }
  return null;
}
