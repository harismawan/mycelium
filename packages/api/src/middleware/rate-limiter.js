import Elysia from 'elysia';
import { getRedisClient, prefixKey, isRedisConnected } from '@mycelium/shared/redis';

/**
 * @typedef {Object} RateLimiterConfig
 * @property {number} [windowMs=60000] - Sliding window size in milliseconds
 * @property {number} [maxRequests=60] - Max requests per window
 */

/**
 * Creates an Elysia plugin that rate-limits API key requests using a
 * sliding window algorithm backed by Redis sorted sets.
 *
 * Each API key gets a sorted set where members are unique request IDs
 * and scores are timestamps. Expired entries are pruned on each request
 * using ZREMRANGEBYSCORE, and the current count is checked with ZCARD.
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

        // Remove expired entries outside the sliding window
        await redis.zremrangebyscore(key, 0, windowStart);

        // Count remaining entries in the window
        const count = await redis.zcard(key);

        if (count >= maxRequests) {
          // Get the oldest member to calculate reset time
          const oldest = await redis.zrange(key, 0, 0);
          const oldestTs = oldest?.length ? Number(oldest[0].split(':')[0]) : now;
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

        // Add current request — use timestamp + random suffix as member to ensure uniqueness
        const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
        await redis.zadd(key, now, member);

        // Set TTL on the key so it auto-expires after the window
        await redis.expire(key, windowSeconds + 1);

        // Add rate limit headers
        const remaining = maxRequests - count - 1;
        const oldestEntries = await redis.zrange(key, 0, 0);
        const oldestTs = oldestEntries?.length ? Number(oldestEntries[0].split(':')[0]) : now;
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
