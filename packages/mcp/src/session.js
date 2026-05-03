// @ts-check
import { getRedisClient, prefixKey } from '@mycelium/shared/redis';

/** Max number of keys allowed per session */
const MAX_KEYS = 100;

/** Max value size in bytes (10KB) */
const MAX_VALUE_BYTES = 10 * 1024;

/** TTL for MCP session context keys: 24 hours in seconds */
const SESSION_CONTEXT_TTL = 86400;

/**
 * Get a value from the session store.
 * Resets TTL to 24h on access.
 *
 * @param {string} connectionId
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function getSessionValue(connectionId, key) {
  const redis = getRedisClient();
  const redisKey = prefixKey(`mcp:${connectionId}:${key}`);

  const value = await redis.get(redisKey);
  if (value !== null && value !== undefined) {
    // Reset TTL on access (sliding window)
    await redis.expire(redisKey, SESSION_CONTEXT_TTL);
    // Also reset the tracking set TTL
    const trackingKey = prefixKey(`mcp:${connectionId}:_keys`);
    await redis.expire(trackingKey, SESSION_CONTEXT_TTL);
  }

  return value ?? null;
}

/**
 * Set a value in the session store.
 * Validates limits (100 keys, 10KB per value). Resets TTL to 24h.
 *
 * @param {string} connectionId
 * @param {string} key
 * @param {string} value
 * @returns {Promise<string | null>} Error message or null on success
 */
export async function setSessionValue(connectionId, key, value) {
  // Validate limits first
  const error = await validateSessionLimits(connectionId, key, value);
  if (error) return error;

  const redis = getRedisClient();
  const redisKey = prefixKey(`mcp:${connectionId}:${key}`);
  const trackingKey = prefixKey(`mcp:${connectionId}:_keys`);

  // Store the value with TTL
  await redis.set(redisKey, value);
  await redis.expire(redisKey, SESSION_CONTEXT_TTL);

  // Track the key in the session's key set
  await redis.sadd(trackingKey, key);
  await redis.expire(trackingKey, SESSION_CONTEXT_TTL);

  return null;
}

/**
 * List all key-value pairs for a session.
 *
 * @param {string} connectionId
 * @returns {Promise<Array<{key: string, value: string}>>}
 */
export async function listSessionValues(connectionId) {
  const redis = getRedisClient();
  const trackingKey = prefixKey(`mcp:${connectionId}:_keys`);

  const keys = await redis.smembers(trackingKey);
  if (!keys || keys.length === 0) return [];

  const entries = [];
  for (const key of keys) {
    const redisKey = prefixKey(`mcp:${connectionId}:${key}`);
    const value = await redis.get(redisKey);
    if (value !== null && value !== undefined) {
      entries.push({ key, value });
    }
  }

  return entries;
}

/**
 * Destroy all session context keys for a connection.
 * Called on MCP connection close.
 *
 * @param {string} connectionId
 * @returns {Promise<void>}
 */
export async function destroySession(connectionId) {
  const redis = getRedisClient();
  const trackingKey = prefixKey(`mcp:${connectionId}:_keys`);

  const keys = await redis.smembers(trackingKey);
  const keysToDelete = [trackingKey];

  if (keys && keys.length > 0) {
    for (const key of keys) {
      keysToDelete.push(prefixKey(`mcp:${connectionId}:${key}`));
    }
  }

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
}

/**
 * Validate that adding/updating a key-value pair won't exceed session limits.
 *
 * @param {string} connectionId
 * @param {string} key
 * @param {string} value
 * @returns {Promise<string | null>} Error message if limits exceeded, null if OK
 */
export async function validateSessionLimits(connectionId, key, value) {
  // Check value size (10KB max)
  const valueBytes = new TextEncoder().encode(value).byteLength;
  if (valueBytes > MAX_VALUE_BYTES) {
    return `Value exceeds maximum size of 10KB (got ${valueBytes} bytes)`;
  }

  // Check key count (100 max) — only counts if this is a new key
  const redis = getRedisClient();
  const trackingKey = prefixKey(`mcp:${connectionId}:_keys`);
  const existingKeys = await redis.smembers(trackingKey);
  const keyCount = existingKeys ? existingKeys.length : 0;

  // If the key already exists, it's an update (doesn't count toward limit)
  const isNewKey = !existingKeys || !existingKeys.includes(key);
  if (isNewKey && keyCount >= MAX_KEYS) {
    return `Session store limit of ${MAX_KEYS} keys exceeded`;
  }

  return null;
}
