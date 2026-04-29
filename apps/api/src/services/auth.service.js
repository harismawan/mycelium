import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { prisma } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mycelium-dev-secret-change-in-production';
const SALT_ROUNDS = 10;

/**
 * Hash an API key using SHA-256.
 * @param {string} key - The plaintext API key.
 * @returns {string} The hex-encoded SHA-256 hash.
 */
function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Authentication service handling user registration, login,
 * JWT verification, and API key verification.
 */
export const AuthService = {
  /**
   * Register a new user with hashed password.
   * @param {string} email - User email address.
   * @param {string} password - Plaintext password to hash.
   * @param {string} displayName - User display name.
   * @returns {Promise<{id: string, email: string, displayName: string, createdAt: Date, updatedAt: Date}>}
   * @throws {{ statusCode: number, message: string }} 409 if email already registered.
   */
  async register(email, password, displayName) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw { statusCode: 409, message: 'Email already registered' };
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, displayName },
      select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });

    return user;
  },

  /**
   * Authenticate a user by email and password, returning a JWT token.
   * @param {string} email - User email address.
   * @param {string} password - Plaintext password to verify.
   * @returns {Promise<{user: {id: string, email: string, displayName: string, createdAt: Date, updatedAt: Date}, token: string}>}
   * @throws {{ statusCode: number, message: string }} 401 if credentials are invalid.
   */
  async login(email, password) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw { statusCode: 401, message: 'Invalid credentials' };
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw { statusCode: 401, message: 'Invalid credentials' };
    }

    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: '7d',
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      token,
    };
  },

  /**
   * Verify a JWT token and return the associated user.
   * @param {string} token - The JWT token string.
   * @returns {Promise<{id: string, email: string, displayName: string, createdAt: Date, updatedAt: Date} | null>}
   */
  async verifyJwt(token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
      });
      return user || null;
    } catch {
      return null;
    }
  },

  /**
   * Verify an API key by hashing it and looking up the hash in the database.
   * Returns the owning user, the key's scopes, and the key identity if valid.
   * @param {string} key - The plaintext API key.
   * @returns {Promise<{user: {id: string, email: string, displayName: string, createdAt: Date, updatedAt: Date}, scopes: string[], apiKeyId: string, apiKeyName: string} | null>}
   */
  async verifyApiKey(key) {
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

    // Update lastUsedAt timestamp
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return { user: apiKey.user, scopes: apiKey.scopes, apiKeyId: apiKey.id, apiKeyName: apiKey.name };
  },

  /**
   * Update user profile.
   * @param {string} userId
   * @param {{ displayName?: string }} data
   */
  async updateProfile(userId, data) {
    const updateData = {};
    if (data.displayName) updateData.displayName = data.displayName;

    return prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });
  },

  /**
   * Change user password.
   * @param {string} userId
   * @param {string} currentPassword
   * @param {string} newPassword
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw { statusCode: 404, message: 'User not found' };

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw { statusCode: 401, message: 'Current password is incorrect' };

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
  },
};
