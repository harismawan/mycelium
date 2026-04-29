/**
 * Shared Redis client module for Mycelium services.
 *
 * Uses Bun's built-in RedisClient — no external Redis dependencies.
 * Provides a lazy singleton connection with exponential backoff retry,
 * structured logging for connection state changes, and a configurable
 * key prefix to namespace all keys.
 *
 * @module @mycelium/shared/redis
 */

import { RedisClient } from 'bun';

/** @type {string} Redis connection URL. */
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/** @type {string} Key prefix applied to every Redis key. */
const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'mycelium:';

/** Maximum number of connection retry attempts. */
const MAX_RETRIES = 5;

/** Base delay in ms for exponential backoff. */
const BASE_DELAY_MS = 500;

/** @type {RedisClient | null} Singleton Redis client instance. */
let client = null;

/** @type {boolean} Tracks whether the client is connected. */
let connected = false;

/**
 * Log a structured JSON entry for a Redis connection state change.
 *
 * @param {'connect' | 'disconnect' | 'reconnect' | 'error'} event
 * @param {string} message
 * @param {object} [extra]
 */
function logConnectionEvent(event, message, extra = {}) {
  console.log(
    JSON.stringify({
      service: 'redis',
      event,
      message,
      timestamp: new Date().toISOString(),
      ...extra,
    }),
  );
}

/**
 * Create the RedisClient singleton (lazy — does not connect).
 *
 * @returns {RedisClient}
 */
function createClient() {
  const instance = new RedisClient(REDIS_URL, {
    autoReconnect: true,
    enableOfflineQueue: true,
  });

  instance.onconnect = () => {
    connected = true;
    logConnectionEvent('connect', 'Redis connection established');
  };

  instance.onclose = (error) => {
    const wasConnected = connected;
    connected = false;
    if (wasConnected) {
      logConnectionEvent('disconnect', 'Redis connection lost', {
        error: error?.message,
      });
    }
  };

  return instance;
}

/**
 * Sleep for the given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the Redis client instance (lazy singleton).
 *
 * Throws if `connectRedis()` has not been called yet.
 *
 * @returns {RedisClient}
 * @throws {Error} If the client has not been initialised via `connectRedis`.
 */
export function getRedisClient() {
  if (!client) {
    throw new Error(
      'Redis client not connected. Call connectRedis() first.',
    );
  }
  return client;
}

/**
 * Prefix a key with the configured namespace.
 *
 * @param {string} key — the bare key, e.g. `"session:abc123"`
 * @returns {string} Prefixed key, e.g. `"mycelium:session:abc123"`
 */
export function prefixKey(key) {
  return `${KEY_PREFIX}${key}`;
}

/**
 * Connect to Redis with exponential backoff retry (up to 5 attempts).
 *
 * Creates the singleton client on first call, then attempts to connect.
 * Logs every connection state change. Throws if all retries are exhausted
 * so the calling application can refuse to start.
 *
 * @returns {Promise<void>}
 * @throws {Error} If connection fails after all retry attempts.
 */
export async function connectRedis() {
  if (!client) {
    client = createClient();
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.connect();
      connected = true;
      logConnectionEvent('connect', 'Redis connected successfully', {
        url: REDIS_URL.replace(/\/\/.*@/, '//<credentials>@'),
        attempt,
      });
      return;
    } catch (err) {
      lastError = err;
      logConnectionEvent('error', `Redis connection attempt ${attempt}/${MAX_RETRIES} failed`, {
        error: err.message,
        attempt,
        nextRetryMs: attempt < MAX_RETRIES ? BASE_DELAY_MS * 2 ** (attempt - 1) : null,
      });

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        logConnectionEvent('reconnect', `Retrying in ${delay}ms…`, { attempt, delay });
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — prevent app startup.
  const msg = `Redis connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`;
  logConnectionEvent('error', msg);
  throw new Error(msg);
}

/**
 * Disconnect from Redis gracefully.
 *
 * @returns {Promise<void>}
 */
export async function disconnectRedis() {
  if (client) {
    try {
      client.close();
    } catch {
      // close may throw if already disconnected — safe to ignore
    }
    connected = false;
    client = null;
    logConnectionEvent('disconnect', 'Redis disconnected by application');
  }
}

/**
 * Check whether the Redis client is currently connected.
 *
 * @returns {boolean}
 */
export function isRedisConnected() {
  if (!client) return false;
  // Prefer the native `connected` property when available, fall back to our flag.
  return client.connected ?? connected;
}
