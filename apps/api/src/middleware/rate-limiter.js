import Elysia from 'elysia';
import { getRedisClient, prefixKey, isRedisConnected } from '@mycelium/shared/redis';

/**
 * @typedef {Object} RateLimiterConfig
 * @property {number} [windowMs=60000] - Sliding window size in milliseconds
 * @property {number} [maxRequests=60] - Max requests per window
 */

// Atomic Lua script: prune expired entries, check limit, add new entry, return result.
// Returns ['limited', count, oldestMember] if rate limited, ['ok', count, oldestMember] otherwise.
// Executes in a single Redis round-trip instead of 4–5 sequential calls.
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local window_start = ARGV[1]
local max_requests = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]
local window_seconds = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
local count = redis.call('ZCARD', key)

if count >= max_requests then
  local oldest = redis.call('ZRANGE', key, 0, 0)
  return {'limited', count, oldest[1] or ''}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, window_seconds)
local oldest = redis.call('ZRANGE', key, 0, 0)
return {'ok', count, oldest[1] or ''}
`;

/**
 * Creates an Elysia plugin that rate-limits API key requests using a
 * sliding window algorithm backed by Redis sorted sets.
 *
 * Each API key gets a sorted set where members are unique request IDs
 * and scores are timestamps. The entire check-and-increment is executed
 * atomically via a Lua script in a single Redis round-trip.
 *
 * JWT-authenticated requests pass through without rate limiting or headers.
 * On Redis errors the middleware fails open (logs a warning, allows the request).
 *
 * @param {RateLimiterConfig} [config]
 * @returns {Elysia}
 */
export function rateLimiter(config = {}) {
  const windowMs = config.windowMs ?? 60_000;
  const maxRequests = config.maxRequests ?? 60;
  const windowSeconds = Math.ceil(windowMs / 1000);

  return new Elysia({ name: 'rate-limiter' }).onBeforeHandle(
    { as: 'scoped' },
    async (ctx) => {
      try {
        // Skip JWT-authenticated requests entirely — no headers, no limiting
        if (ctx.authType === 'jwt') {
          return;
        }

        const apiKeyId = ctx.apiKeyId;
        if (!apiKeyId) {
          return;
        }

        // If Redis is unavailable, fail open
        if (!isRedisConnected()) {
          console.warn('[rate-limiter] Redis unavailable, failing open');
          return;
        }

        const redis = getRedisClient();
        const key = prefixKey(`ratelimit:${apiKeyId}`);
        const now = Date.now();
        const windowStart = now - windowMs;
        const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

        // Single atomic round-trip: prune + count + conditionally add
        const result = await redis.eval(
          RATE_LIMIT_SCRIPT,
          1,
          key,
          windowStart,
          maxRequests,
          now,
          member,
          windowSeconds + 1,
        );
        const [status, count, oldestMember] = result;
        const oldestTs = oldestMember ? Number(oldestMember.split(':')[0]) : now;

        if (status === 'limited') {
          const resetTime = oldestTs + windowMs;
          const retryAfterSeconds = Math.ceil((resetTime - now) / 1000);

          ctx.set.status = 429;
          ctx.set.headers['X-RateLimit-Limit'] = String(maxRequests);
          ctx.set.headers['X-RateLimit-Remaining'] = '0';
          ctx.set.headers['X-RateLimit-Reset'] = String(Math.ceil(resetTime / 1000));

          return {
            error: 'Rate limit exceeded',
            retryAfter: retryAfterSeconds,
          };
        }

        // Request allowed — count is the pre-add count
        const remaining = maxRequests - count - 1;
        const resetEpoch = Math.ceil((oldestTs + windowMs) / 1000);

        ctx.set.headers['X-RateLimit-Limit'] = String(maxRequests);
        ctx.set.headers['X-RateLimit-Remaining'] = String(Math.max(0, remaining));
        ctx.set.headers['X-RateLimit-Reset'] = String(resetEpoch);
      } catch (err) {
        // Fail open — log warning and allow request through
        console.warn('[rate-limiter] Error during rate limiting, failing open:', err);
      }
    },
  );
}
