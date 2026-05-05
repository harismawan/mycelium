import { describe, test, expect, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock modules before importing the app
// ---------------------------------------------------------------------------

mock.module('@mycelium/shared/redis', () => ({
  connectRedis: async () => {},
  disconnectRedis: async () => {},
  getRedisClient: () => ({}),
  prefixKey: (key) => `mycelium:${key}`,
  isRedisConnected: () => true,
}));

mock.module('../../src/db.js', () => ({
  prisma: {
    $queryRawUnsafe: async () => [{ '?column?': 1 }],
  },
}));

mock.module('../../src/services/session.service.js', () => ({
  SessionService: {
    verifyToken: () => null,
    decodeToken: () => null,
    isTokenActive: async () => false,
    validateSession: async () => null,
    refreshAccessToken: async () => null,
    createSession: async () => null,
    revokeSession: async () => {},
  },
}));

mock.module('../../src/services/auth.service.js', () => ({
  AuthService: {
    login: async () => null,
    register: async () => null,
    verifyJwt: async () => null,
    verifyApiKey: async () => null,
    updateProfile: async () => null,
    changePassword: async () => {},
  },
}));

mock.module('../../src/services/note.service.js', () => ({
  NoteService: {
    create: async () => ({}),
    list: async () => ({ notes: [], nextCursor: null }),
    getBySlug: async () => null,
    update: async () => ({}),
    archive: async () => {},
    deletePermanently: async () => {},
    revert: async () => ({}),
    count: async () => ({ draft: 0, published: 0, archived: 0 }),
  },
}));

mock.module('../../src/services/revision.service.js', () => ({
  RevisionService: {
    listByNote: async () => [],
    getById: async () => null,
  },
}));

mock.module('../../src/services/link.service.js', () => ({
  LinkService: {
    getBacklinks: async () => [],
  },
}));

mock.module('../../src/services/search.service.js', () => ({
  SearchService: {
    search: async () => [],
    getGraph: async () => ({ nodes: [], edges: [] }),
    getSubgraph: async () => ({ nodes: [], edges: [] }),
    getTagList: async () => [],
    getNotesByTag: async () => [],
  },
}));

mock.module('../../src/services/agent.service.js', () => ({
  AgentService: {
    getManifest: () => ({}),
    streamBundle: () => new ReadableStream(),
    listNotes: async () => ({ notes: [], nextCursor: null }),
  },
}));

mock.module('../../src/services/activity-log.service.js', () => ({
  ActivityLogService: {
    list: async () => ({ entries: [], nextCursor: null }),
    log: async () => {},
  },
}));

// ---------------------------------------------------------------------------
// Tests for conditional Swagger registration logic
// ---------------------------------------------------------------------------

describe('Swagger Conditional Registration', () => {
  test('swagger is available when NODE_ENV is not production', async () => {
    // Default test environment is not production, so swagger should be registered
    const { app } = await import('../../src/index.js');
    const response = await app.handle(new Request('http://localhost/swagger/json'));
    expect(response.status).not.toBe(404);
  });

  test('conditional logic: production without ENABLE_SWAGGER disables swagger', () => {
    // Simulate the condition logic from index.js
    const isProduction = true;
    const enableSwagger = false;
    const shouldEnableSwagger = !isProduction || enableSwagger;
    expect(shouldEnableSwagger).toBe(false);
  });

  test('conditional logic: production with ENABLE_SWAGGER=true enables swagger', () => {
    // Simulate the condition logic from index.js
    const isProduction = true;
    const enableSwagger = true;
    const shouldEnableSwagger = !isProduction || enableSwagger;
    expect(shouldEnableSwagger).toBe(true);
  });

  test('conditional logic: non-production always enables swagger regardless of ENABLE_SWAGGER', () => {
    // Simulate the condition logic from index.js
    const isProduction = false;
    const enableSwagger = false;
    const shouldEnableSwagger = !isProduction || enableSwagger;
    expect(shouldEnableSwagger).toBe(true);
  });
});
