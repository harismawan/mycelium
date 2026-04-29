import Elysia from 'elysia';

/**
 * @typedef {Object} RateLimiterConfig
 * @property {number} [windowMs=60000] - Sliding window size in milliseconds
 * @property {number} [maxRequests=60] - Max requests per window
 */

/**
 * In-memory sliding window rate limiter state.
 * Key: apiKeyId, Value: array of request timestamps (ms).
 * @type {Map<string, number[]>}
 */
const store = new Map();

/**
 * Prune timestamps older than the window from the array.
 *
 * @param {number[]} timestamps
 * @param {number} now
 * @param {number} windowMs
 * @returns {number[]}
 */
function pruneExpired(timestamps, now, windowMs) {
  const cutoff = now - windowMs;
  // Find the first index that is within the window
  let i = 0;
  while (i < timestamps.length && timestamps[i] <= cutoff) {
    i++;
  }
  return i === 0 ? timestamps : timestamps.slice(i);
}

/**
 * Creates an Elysia plugin that rate-limits API key requests using a
 * sliding window algorithm backed by an in-memory Map.
 *
 * JWT-authenticated requests pass through without rate limiting or headers.
 * On internal errors the middleware fails open (logs a warning, allows the request).
 *
 * @param {RateLimiterConfig} [config]
 * @returns {Elysia}
 */
export function rateLimiter(config = {}) {
  const windowMs = config.windowMs ?? 60_000;
  const maxRequests = config.maxRequests ?? 60;

  return new Elysia({ name: 'rate-limiter' }).onBeforeHandle(
    { as: 'scoped' },
    (ctx) => {
      try {
        // Skip JWT-authenticated requests entirely — no headers, no limiting
        if (ctx.authType === 'jwt') {
          return;
        }

        const apiKeyId = ctx.apiKeyId;
        if (!apiKeyId) {
          // No API key context — skip (shouldn't happen after auth, but be safe)
          return;
        }

        const now = Date.now();

        // Get or create the timestamps array for this key
        let timestamps = store.get(apiKeyId) || [];

        // Prune expired timestamps
        timestamps = pruneExpired(timestamps, now, windowMs);

        // Check if limit exceeded BEFORE adding the current request
        if (timestamps.length >= maxRequests) {
          // Reject — 429
          const oldestTimestamp = timestamps[0];
          const resetTime = oldestTimestamp + windowMs;
          const retryAfterSeconds = Math.ceil((resetTime - now) / 1000);

          // Update the store with pruned timestamps (don't add current request)
          store.set(apiKeyId, timestamps);

          ctx.set.status = 429;
          ctx.set.headers['X-RateLimit-Limit'] = String(maxRequests);
          ctx.set.headers['X-RateLimit-Remaining'] = '0';
          ctx.set.headers['X-RateLimit-Reset'] = String(Math.ceil(resetTime / 1000));

          return {
            error: 'Rate limit exceeded',
            retryAfter: retryAfterSeconds,
          };
        }

        // Push current timestamp
        timestamps.push(now);
        store.set(apiKeyId, timestamps);

        // Add rate limit headers
        const remaining = maxRequests - timestamps.length;
        const oldestTimestamp = timestamps[0];
        const resetEpoch = Math.ceil((oldestTimestamp + windowMs) / 1000);

        ctx.set.headers['X-RateLimit-Limit'] = String(maxRequests);
        ctx.set.headers['X-RateLimit-Remaining'] = String(remaining);
        ctx.set.headers['X-RateLimit-Reset'] = String(resetEpoch);
      } catch (err) {
        // Fail open — log warning and allow request through
        console.warn('[rate-limiter] Error during rate limiting, failing open:', err);
      }
    },
  );
}

/**
 * Expose the store for testing purposes.
 * @returns {Map<string, number[]>}
 */
export function _getStore() {
  return store;
}

/**
 * Clear the rate limiter store. Useful for testing.
 */
export function _clearStore() {
  store.clear();
}
