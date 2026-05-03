import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Mock setup — must happen before any import that touches Prisma
// ---------------------------------------------------------------------------
const mockUser = {
  findUnique: mock(() => null),
  create: mock(() => ({})),
};
const mockApiKey = {
  findUnique: mock(() => null),
  update: mock(() => ({})),
};

// Mock @prisma/client so PrismaClient constructor returns our mock
mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.user = mockUser;
      this.apiKey = mockApiKey;
    }
  },
}));

// Mock bcryptjs
const mockBcrypt = {
  hash: mock((pw, rounds) => Promise.resolve(`hashed_${pw}`)),
  compare: mock((plain, hashed) => Promise.resolve(hashed === `hashed_${plain}`)),
};
mock.module('bcryptjs', () => ({ default: mockBcrypt }));

// Mock jsonwebtoken
const mockJwt = {
  sign: mock((payload, secret, opts) => `token_${payload.sub}`),
  verify: mock((token, secret) => {
    if (token.startsWith('token_')) {
      return { sub: token.replace('token_', ''), email: 'test@example.com' };
    }
    throw new Error('invalid token');
  }),
};
mock.module('jsonwebtoken', () => ({ default: mockJwt }));

// ---------------------------------------------------------------------------
// Import AuthService AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { AuthService } = await import('../../src/services/auth.service.js');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const now = new Date();
const testUser = {
  id: 'user_1',
  email: 'test@example.com',
  password: 'hashed_secret123',
  displayName: 'Test User',
  createdAt: now,
  updatedAt: now,
};

const userWithoutPassword = {
  id: testUser.id,
  email: testUser.email,
  displayName: testUser.displayName,
  createdAt: testUser.createdAt,
  updatedAt: testUser.updatedAt,
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockUser.findUnique.mockReset();
  mockUser.create.mockReset();
  mockApiKey.findUnique.mockReset();
  mockApiKey.update.mockReset();
  mockBcrypt.hash.mockReset();
  mockBcrypt.compare.mockReset();
  mockJwt.sign.mockReset();
  mockJwt.verify.mockReset();

  // Restore default implementations
  mockBcrypt.hash.mockImplementation((pw) => Promise.resolve(`hashed_${pw}`));
  mockBcrypt.compare.mockImplementation((plain, hashed) =>
    Promise.resolve(hashed === `hashed_${plain}`),
  );
  mockJwt.sign.mockImplementation((payload) => `token_${payload.sub}`);
  mockJwt.verify.mockImplementation((token) => {
    if (token.startsWith('token_')) {
      return { sub: token.replace('token_', ''), email: 'test@example.com' };
    }
    throw new Error('invalid token');
  });
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------
describe('AuthService.register', () => {
  /** Validates: Requirements 3.1 */
  test('creates user with hashed password and returns user without password', async () => {
    mockUser.findUnique.mockResolvedValue(null);
    mockUser.create.mockResolvedValue(userWithoutPassword);

    const result = await AuthService.register('test@example.com', 'secret123', 'Test User');

    // bcrypt.hash was called with the plaintext password
    expect(mockBcrypt.hash).toHaveBeenCalledWith('secret123', 10);

    // prisma.user.create was called with hashed password
    const createCall = mockUser.create.mock.calls[0][0];
    expect(createCall.data.email).toBe('test@example.com');
    expect(createCall.data.password).toBe('hashed_secret123');
    expect(createCall.data.displayName).toBe('Test User');

    // select excludes password
    expect(createCall.select.password).toBeUndefined();
    expect(createCall.select.id).toBe(true);
    expect(createCall.select.email).toBe(true);

    // returned user has no password field
    expect(result).toEqual(userWithoutPassword);
    expect(result).not.toHaveProperty('password');
  });

  /** Validates: Requirements 3.5 */
  test('throws 409 for duplicate email', async () => {
    mockUser.findUnique.mockResolvedValue(testUser);

    try {
      await AuthService.register('test@example.com', 'secret123', 'Test User');
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err.statusCode).toBe(409);
      expect(err.message).toBe('Email already registered');
    }
  });
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------
describe('AuthService.login', () => {
  /** Validates: Requirements 3.2 */
  test('returns user and JWT token for valid credentials', async () => {
    mockUser.findUnique.mockResolvedValue(testUser);

    const result = await AuthService.login('test@example.com', 'secret123');

    expect(result.user).toEqual(userWithoutPassword);
    expect(result.token).toBe('token_user_1');
    expect(mockJwt.sign).toHaveBeenCalled();
    const signCall = mockJwt.sign.mock.calls[0];
    expect(signCall[0].sub).toBe('user_1');
    expect(signCall[0].email).toBe('test@example.com');
  });

  /** Validates: Requirements 3.6 */
  test('throws 401 for wrong password', async () => {
    mockUser.findUnique.mockResolvedValue(testUser);
    mockBcrypt.compare.mockResolvedValue(false);

    try {
      await AuthService.login('test@example.com', 'wrongpassword');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Invalid credentials');
    }
  });

  /** Validates: Requirements 3.6 */
  test('throws 401 for non-existent email', async () => {
    mockUser.findUnique.mockResolvedValue(null);

    try {
      await AuthService.login('nobody@example.com', 'secret123');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Invalid credentials');
    }
  });
});

// ---------------------------------------------------------------------------
// verifyJwt
// ---------------------------------------------------------------------------
describe('AuthService.verifyJwt', () => {
  /** Validates: Requirements 3.4 */
  test('returns user for valid token', async () => {
    mockUser.findUnique.mockResolvedValue(userWithoutPassword);

    const result = await AuthService.verifyJwt('token_user_1');

    expect(result).toEqual(userWithoutPassword);
    expect(mockJwt.verify).toHaveBeenCalled();
    expect(mockUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
    });
  });

  test('returns null for invalid token', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('bad');
    });

    const result = await AuthService.verifyJwt('garbage_token');
    expect(result).toBeNull();
  });

  test('returns null when user no longer exists', async () => {
    mockUser.findUnique.mockResolvedValue(null);

    const result = await AuthService.verifyJwt('token_deleted_user');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyApiKey
// ---------------------------------------------------------------------------
describe('AuthService.verifyApiKey', () => {
  const plainKey = 'myc_abc123';
  const keyHash = createHash('sha256').update(plainKey).digest('hex');

  /** Validates: Requirements 4.2, 4.5 */
  test('returns user, scopes, apiKeyId, and apiKeyName for valid key and updates lastUsedAt', async () => {
    mockApiKey.findUnique.mockResolvedValue({
      id: 'key_1',
      name: 'my-agent-key',
      keyHash,
      scopes: ['notes:read', 'agent:read'],
      user: userWithoutPassword,
    });
    mockApiKey.update.mockResolvedValue({});

    const result = await AuthService.verifyApiKey(plainKey);

    expect(result.user).toEqual(userWithoutPassword);
    expect(result.scopes).toEqual(['notes:read', 'agent:read']);
    expect(result.apiKeyId).toBe('key_1');
    expect(result.apiKeyName).toBe('my-agent-key');

    // Verify the key was looked up by hash
    expect(mockApiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, createdAt: true, updatedAt: true },
        },
      },
    });

    // Verify lastUsedAt was updated
    expect(mockApiKey.update).toHaveBeenCalledWith({
      where: { id: 'key_1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  /** Validates: Requirements 4.7 */
  test('returns null for non-existent key', async () => {
    mockApiKey.findUnique.mockResolvedValue(null);

    const result = await AuthService.verifyApiKey('myc_nonexistent');
    expect(result).toBeNull();
    expect(mockApiKey.update).not.toHaveBeenCalled();
  });
});
