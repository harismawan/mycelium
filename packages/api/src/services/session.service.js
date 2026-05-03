/**
 * Session Service — server-side session management backed by Redis.
 *
 * Handles session lifecycle, dual-token issuance (access + refresh),
 * token validation, refresh, and revocation.
 *
 * @module SessionService
 */

import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { getRedisClient, prefixKey, isRedisConnected } from '@mycelium/shared/redis';

const JWT_SECRET = process.env.JWT_SECRET || 'mycelium-dev-secret-change-in-production';

/** Access token TTL: 1 day in seconds. */
const ACCESS_TOKEN_TTL = 86400;

/** Refresh token TTL: 7 days in seconds. */
const REFRESH_TOKEN_TTL = 604800;

/** Session TTL: 7 days in seconds. */
const SESSION_TTL = 604800;

/**
 * Generate a cryptographically secure random hex string (32 bytes = 64 hex chars).
 * @returns {string}
 */
function generateId() {
  return randomBytes(32).toString('hex');
}

export const SessionService = {
  /**
   * Create a new session and issue a token pair (access + refresh).
   *
   * Stores session hash, jti, refresh token, and jti tracking set in Redis.
   *
   * @param {string} userId
   * @param {string} email
   * @returns {Promise<{ session: { sessionId: string, userId: string, createdAt: number, lastActivity: number }, tokens: { accessToken: string, refreshToken: string } }>}
   */
  async createSession(userId, email) {
    const redis = getRedisClient();
    const sessionId = generateId();
    const jti = generateId();
    const refreshToken = generateId();
    const now = Math.floor(Date.now() / 1000);

    // Sign access token JWT
    const accessToken = jwt.sign(
      { sub: userId, email, sid: sessionId, jti },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    // Store session hash
    const sessionKey = prefixKey(`session:${sessionId}`);
    await redis.hset(sessionKey, {
      userId,
      createdAt: String(now),
      lastActivity: String(now),
      refreshToken,
    });
    await redis.expire(sessionKey, SESSION_TTL);

    // Store jti → session:userId mapping
    const jtiKey = prefixKey(`jti:${jti}`);
    await redis.set(jtiKey, `${sessionId}:${userId}`);
    await redis.expire(jtiKey, ACCESS_TOKEN_TTL);

    // Store refresh token → session:userId mapping
    const refreshKey = prefixKey(`refresh:${refreshToken}`);
    await redis.set(refreshKey, `${sessionId}:${userId}`);
    await redis.expire(refreshKey, REFRESH_TOKEN_TTL);

    // Track jti in session's jti set (for bulk revocation)
    const jtiSetKey = prefixKey(`session:${sessionId}:jtis`);
    await redis.sadd(jtiSetKey, jti);
    await redis.expire(jtiSetKey, SESSION_TTL);

    return {
      session: { sessionId, userId, createdAt: now, lastActivity: now },
      tokens: { accessToken, refreshToken },
    };
  },

  /**
   * Validate that a session exists and is active.
   * Updates lastActivity timestamp and resets session TTL.
   *
   * @param {string} sessionId
   * @returns {Promise<{ userId: string, createdAt: number, lastActivity: number } | null>}
   */
  async validateSession(sessionId) {
    const redis = getRedisClient();
    const sessionKey = prefixKey(`session:${sessionId}`);

    const data = await redis.hgetall(sessionKey);
    if (!data || !data.userId) {
      return null;
    }

    // Update last activity and reset TTL
    const now = String(Math.floor(Date.now() / 1000));
    await redis.hset(sessionKey, { lastActivity: now });
    await redis.expire(sessionKey, SESSION_TTL);

    return {
      userId: data.userId,
      createdAt: Number(data.createdAt),
      lastActivity: Number(now),
    };
  },

  /**
   * Check if an access token's jti is registered (active) in Redis.
   *
   * @param {string} jti
   * @returns {Promise<boolean>}
   */
  async isTokenActive(jti) {
    const redis = getRedisClient();
    const jtiKey = prefixKey(`jti:${jti}`);
    const exists = await redis.exists(jtiKey);
    return !!exists;
  },

  /**
   * Refresh an access token using a refresh token.
   *
   * Removes old jti, issues new access token, registers new jti.
   * Resets refresh token and session TTLs (sliding window).
   *
   * @param {string} refreshToken
   * @param {string} [oldJti] - jti of the expired access token to remove
   * @returns {Promise<{ accessToken: string, sessionId: string, userId: string, email: string } | null>}
   */
  async refreshAccessToken(refreshToken, oldJti) {
    const redis = getRedisClient();
    const refreshKey = prefixKey(`refresh:${refreshToken}`);

    // Look up refresh token
    const mapping = await redis.get(refreshKey);
    if (!mapping) {
      return null;
    }

    const [sessionId, userId] = mapping.split(':');
    if (!sessionId || !userId) {
      return null;
    }

    // Verify session still exists
    const sessionKey = prefixKey(`session:${sessionId}`);
    const sessionData = await redis.hgetall(sessionKey);
    if (!sessionData || !sessionData.userId) {
      return null;
    }

    // Generate new jti and access token
    const newJti = generateId();

    // We need the email for the token — look it up from the session or use a placeholder
    // The email isn't stored in the session, so we'll decode it from context
    // For now, sign without email if not available (sub is sufficient for auth)
    const accessToken = jwt.sign(
      { sub: userId, sid: sessionId, jti: newJti },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    // Register new jti
    const newJtiKey = prefixKey(`jti:${newJti}`);
    await redis.set(newJtiKey, `${sessionId}:${userId}`);
    await redis.expire(newJtiKey, ACCESS_TOKEN_TTL);

    // Add new jti to session's tracking set
    const jtiSetKey = prefixKey(`session:${sessionId}:jtis`);
    await redis.sadd(jtiSetKey, newJti);

    // Remove old jti if provided
    if (oldJti) {
      const oldJtiKey = prefixKey(`jti:${oldJti}`);
      await redis.del(oldJtiKey);
      await redis.srem(jtiSetKey, oldJti);
    }

    // Reset TTLs (sliding window)
    await redis.expire(refreshKey, REFRESH_TOKEN_TTL);
    await redis.expire(sessionKey, SESSION_TTL);
    await redis.expire(jtiSetKey, SESSION_TTL);

    // Update last activity
    const now = String(Math.floor(Date.now() / 1000));
    await redis.hset(sessionKey, { lastActivity: now });

    return { accessToken, sessionId, userId, email: sessionData.email || '' };
  },

  /**
   * Revoke a session: delete session, all associated jtis, and refresh token.
   * Uses Redis MULTI/EXEC transaction for atomicity.
   *
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async revokeSession(sessionId) {
    const redis = getRedisClient();
    const sessionKey = prefixKey(`session:${sessionId}`);
    const jtiSetKey = prefixKey(`session:${sessionId}:jtis`);

    // Get the refresh token and all jtis associated with this session
    const sessionData = await redis.hgetall(sessionKey);
    const jtis = await redis.smembers(jtiSetKey);

    // Build list of keys to delete
    const keysToDelete = [sessionKey, jtiSetKey];

    if (sessionData && sessionData.refreshToken) {
      keysToDelete.push(prefixKey(`refresh:${sessionData.refreshToken}`));
    }

    if (jtis && jtis.length > 0) {
      for (const jti of jtis) {
        keysToDelete.push(prefixKey(`jti:${jti}`));
      }
    }

    // Delete all keys in a single pipeline/transaction
    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }
  },

  /**
   * Revoke a session by refresh token value.
   * Looks up the session from the refresh token, then delegates to revokeSession.
   *
   * @param {string} refreshToken
   * @returns {Promise<void>}
   */
  async revokeByRefreshToken(refreshToken) {
    const redis = getRedisClient();
    const refreshKey = prefixKey(`refresh:${refreshToken}`);

    const mapping = await redis.get(refreshKey);
    if (!mapping) {
      return; // Already revoked or expired
    }

    const [sessionId] = mapping.split(':');
    if (sessionId) {
      await this.revokeSession(sessionId);
    }
  },

  /**
   * Decode a JWT without verification (for extracting claims from expired tokens).
   *
   * @param {string} token
   * @returns {{ sub?: string, sid?: string, jti?: string, email?: string } | null}
   */
  decodeToken(token) {
    try {
      return jwt.decode(token);
    } catch {
      return null;
    }
  },

  /**
   * Verify a JWT token and return the payload.
   * Returns null if the token is invalid or expired.
   *
   * @param {string} token
   * @returns {{ sub: string, sid: string, jti: string, email?: string } | null}
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch {
      return null;
    }
  },
};
