import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock the db module before importing auth
const mockPrisma = {
  apiKey: {
    findUnique: mock(() => null),
    update: mock(() => ({})),
  },
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));

const { resolveAuth, checkScopes } = await import('../../src/auth.js');

describe('resolveAuth', () => {
  beforeEach(() => {
    mockPrisma.apiKey.findUnique.mockReset();
    mockPrisma.apiKey.update.mockReset();
  });

  const savedEnv = process.env.MYCELIUM_API_KEY;
  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.MYCELIUM_API_KEY = savedEnv;
    } else {
      delete process.env.MYCELIUM_API_KEY;
    }
  });

  test('resolves auth with valid API key (stdio)', async () => {
    process.env.MYCELIUM_API_KEY = 'test-key-123';
    mockPrisma.apiKey.findUnique.mockImplementation(() => ({
      id: 'ak1',
      scopes: ['agent:read', 'notes:write'],
      user: { id: 'u1', email: 'test@example.com', displayName: 'Test' },
    }));
    mockPrisma.apiKey.update.mockImplementation(() => ({}));

    const result = await resolveAuth('stdio');
    expect(result.userId).toBe('u1');
    expect(result.scopes).toEqual(['agent:read', 'notes:write']);
  });

  test('throws with invalid API key (stdio)', async () => {
    process.env.MYCELIUM_API_KEY = 'bad-key';
    mockPrisma.apiKey.findUnique.mockImplementation(() => null);

    await expect(resolveAuth('stdio')).rejects.toThrow('Invalid API key');
  });

  test('throws with missing env var (stdio)', async () => {
    delete process.env.MYCELIUM_API_KEY;

    await expect(resolveAuth('stdio')).rejects.toThrow('MYCELIUM_API_KEY environment variable is required');
  });

  test('resolves auth with valid Bearer header (HTTP)', async () => {
    mockPrisma.apiKey.findUnique.mockImplementation(() => ({
      id: 'ak2',
      scopes: ['agent:read'],
      user: { id: 'u2', email: 'http@example.com', displayName: 'HTTP User' },
    }));
    mockPrisma.apiKey.update.mockImplementation(() => ({}));

    const request = { headers: { get: (name) => (name === 'authorization' ? 'Bearer http-key-456' : null) } };
    const result = await resolveAuth('http', request);
    expect(result.userId).toBe('u2');
    expect(result.scopes).toEqual(['agent:read']);
  });

  test('throws with missing Authorization header (HTTP)', async () => {
    const request = { headers: { get: () => null } };
    await expect(resolveAuth('http', request)).rejects.toThrow('Authorization: Bearer <key> header is required');
  });

  test('throws with invalid Authorization header format (HTTP)', async () => {
    const request = { headers: { get: (name) => (name === 'authorization' ? 'Basic abc' : null) } };
    await expect(resolveAuth('http', request)).rejects.toThrow('Authorization: Bearer <key> header is required');
  });
});

describe('checkScopes', () => {
  test('returns null when scopes match', () => {
    const result = checkScopes(['agent:read'], ['agent:read', 'notes:write']);
    expect(result).toBeNull();
  });

  test('returns null when all required scopes present', () => {
    const result = checkScopes(['agent:read', 'notes:write'], ['agent:read', 'notes:write', 'admin']);
    expect(result).toBeNull();
  });

  test('returns error object when scopes are missing', () => {
    const result = checkScopes(['notes:write'], ['agent:read']);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
    expect(parsed.required).toEqual(['notes:write']);
  });

  test('returns error when multiple scopes are missing', () => {
    const result = checkScopes(['agent:read', 'notes:write'], []);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.required).toEqual(['agent:read', 'notes:write']);
  });
});
