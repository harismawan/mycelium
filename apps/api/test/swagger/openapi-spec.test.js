import { describe, test, expect, beforeAll, mock } from 'bun:test';

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

mock.module('../../src/services/directory.service.js', () => ({
  DirectoryService: {
    listTree: async () => ({ directories: [] }),
    createDirectory: async () => ({}),
    updateDirectory: async () => ({}),
    deleteDirectory: async () => ({ message: 'Directory deleted' }),
  },
}));

// ---------------------------------------------------------------------------
// Import the app AFTER mocks are registered
// ---------------------------------------------------------------------------
const { app } = await import('../../src/index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract all operations from the OpenAPI spec paths.
 * @param {object} spec - The OpenAPI spec JSON
 * @returns {Array<{path: string, method: string, [key: string]: any}>}
 */
function getAllOperations(spec) {
  const operations = [];
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        operations.push({ path, method, ...operation });
      }
    }
  }
  return operations;
}

/**
 * Get operations matching a path prefix.
 * @param {Array} operations
 * @param {string} prefix
 * @returns {Array}
 */
function getOperationsByPrefix(operations, prefix) {
  return operations.filter((op) => op.path.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Fetch the OpenAPI spec
// ---------------------------------------------------------------------------

let spec;

beforeAll(async () => {
  const response = await app.handle(new Request('http://localhost/swagger/json'));
  expect(response.status).toBe(200);
  spec = await response.json();
});

// ---------------------------------------------------------------------------
// Smoke Tests
// ---------------------------------------------------------------------------

describe('OpenAPI Spec — Smoke Tests', () => {
  test('generated spec has valid structure (info, paths, tags, components)', () => {
    expect(spec).toBeDefined();
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe('object');
    expect(spec.tags).toBeDefined();
    expect(Array.isArray(spec.tags)).toBe(true);
    expect(spec.components).toBeDefined();
  });

  test('info.description mentions both human and AI agent audiences', () => {
    const desc = spec.info.description;
    expect(desc).toBeDefined();
    expect(typeof desc).toBe('string');
    // Should mention human SPA
    expect(desc.toLowerCase()).toContain('human');
    // Should mention AI agents
    expect(desc.toLowerCase()).toContain('ai agent');
  });

  test('tags array contains all 10 tags in correct order', () => {
    const expectedTags = [
      'Health',
      'Auth',
      'Notes',
      'Tags',
      'Directories',
      'Graph',
      'Agent',
      'Maintenance',
      'API Keys',
      'Activity Log',
    ];

    expect(spec.tags.length).toBeGreaterThanOrEqual(expectedTags.length);

    const tagNames = spec.tags.map((t) => t.name);
    for (let i = 0; i < expectedTags.length; i++) {
      expect(tagNames[i]).toBe(expectedTags[i]);
    }
  });

  test('components.securitySchemes defines cookieAuth and bearerApiKey with correct types', () => {
    const schemes = spec.components?.securitySchemes;
    expect(schemes).toBeDefined();

    // cookieAuth
    expect(schemes.cookieAuth).toBeDefined();
    expect(schemes.cookieAuth.type).toBe('apiKey');
    expect(schemes.cookieAuth.in).toBe('cookie');
    expect(schemes.cookieAuth.name).toBe('auth');

    // bearerApiKey
    expect(schemes.bearerApiKey).toBeDefined();
    expect(schemes.bearerApiKey.type).toBe('http');
    expect(schemes.bearerApiKey.scheme).toBe('bearer');
  });

  test('servers array includes http://localhost:3000', () => {
    expect(spec.servers).toBeDefined();
    expect(Array.isArray(spec.servers)).toBe(true);

    const urls = spec.servers.map((s) => s.url);
    expect(urls).toContain('http://localhost:3000');
  });
});

// ---------------------------------------------------------------------------
// Example-Based Tag Tests
// ---------------------------------------------------------------------------

describe('OpenAPI Spec — Tag Assignment', () => {
  let operations;

  beforeAll(() => {
    operations = getAllOperations(spec);
  });

  test('all /api/v1/auth/* operations tagged "Auth"', () => {
    const authOps = getOperationsByPrefix(operations, '/api/v1/auth');
    expect(authOps.length).toBeGreaterThan(0);
    for (const op of authOps) {
      expect(op.tags).toContain('Auth');
    }
  });

  test('all /api/v1/notes/* operations tagged "Notes"', () => {
    const noteOps = getOperationsByPrefix(operations, '/api/v1/notes');
    expect(noteOps.length).toBeGreaterThan(0);
    for (const op of noteOps) {
      expect(op.tags).toContain('Notes');
    }
  });

  test('all /api/v1/tags/* operations tagged "Tags"', () => {
    const tagOps = getOperationsByPrefix(operations, '/api/v1/tags');
    expect(tagOps.length).toBeGreaterThan(0);
    for (const op of tagOps) {
      expect(op.tags).toContain('Tags');
    }
  });

  test('all /api/v1/directories/* operations tagged "Directories"', () => {
    const directoryOps = getOperationsByPrefix(operations, '/api/v1/directories');
    expect(directoryOps.length).toBeGreaterThan(0);
    for (const op of directoryOps) {
      expect(op.tags).toContain('Directories');
    }
  });

  test('all /api/v1/graph/* operations tagged "Graph"', () => {
    const graphOps = getOperationsByPrefix(operations, '/api/v1/graph');
    expect(graphOps.length).toBeGreaterThan(0);
    for (const op of graphOps) {
      expect(op.tags).toContain('Graph');
    }
  });

  test('all /api/v1/agent/* operations tagged "Agent"', () => {
    const agentOps = getOperationsByPrefix(operations, '/api/v1/agent');
    expect(agentOps.length).toBeGreaterThan(0);
    for (const op of agentOps) {
      expect(op.tags).toContain('Agent');
    }
  });

  test('all /api/v1/api-keys/* operations tagged "API Keys"', () => {
    const apiKeyOps = getOperationsByPrefix(operations, '/api/v1/api-keys');
    expect(apiKeyOps.length).toBeGreaterThan(0);
    for (const op of apiKeyOps) {
      expect(op.tags).toContain('API Keys');
    }
  });

  test('all /api/v1/activity-log/* operations tagged "Activity Log"', () => {
    const activityOps = getOperationsByPrefix(operations, '/api/v1/activity-log');
    expect(activityOps.length).toBeGreaterThan(0);
    for (const op of activityOps) {
      expect(op.tags).toContain('Activity Log');
    }
  });

  test('/health and /ready tagged "Health"', () => {
    const healthOps = operations.filter(
      (op) => op.path === '/health' || op.path === '/ready',
    );
    expect(healthOps.length).toBe(2);
    for (const op of healthOps) {
      expect(op.tags).toContain('Health');
    }
  });
});

// ---------------------------------------------------------------------------
// Example-Based Security Tests
// ---------------------------------------------------------------------------

describe('OpenAPI Spec — Security Assignment', () => {
  let operations;

  beforeAll(() => {
    operations = getAllOperations(spec);
  });

  test('public routes (register, login, refresh, health, ready) have empty security arrays', () => {
    const publicPaths = [
      { path: '/api/v1/auth/register', method: 'post' },
      { path: '/api/v1/auth/login', method: 'post' },
      { path: '/api/v1/auth/refresh', method: 'post' },
      { path: '/health', method: 'get' },
      { path: '/ready', method: 'get' },
    ];

    for (const { path, method } of publicPaths) {
      const op = operations.find((o) => o.path === path && o.method === method);
      expect(op).toBeDefined();
      expect(op.security).toEqual([]);
    }
  });

  test('API key management routes reference only cookieAuth', () => {
    const apiKeyOps = getOperationsByPrefix(operations, '/api/v1/api-keys');
    expect(apiKeyOps.length).toBeGreaterThan(0);

    for (const op of apiKeyOps) {
      expect(op.security).toBeDefined();
      expect(op.security).toEqual([{ cookieAuth: [] }]);
    }
  });

  test('Agent routes reference only bearerApiKey', () => {
    const agentOps = getOperationsByPrefix(operations, '/api/v1/agent');
    expect(agentOps.length).toBeGreaterThan(0);

    for (const op of agentOps) {
      expect(op.security).toBeDefined();
      expect(op.security).toEqual([{ bearerApiKey: [] }]);
    }
  });

  test('Notes, tags, directories, graph, activity-log routes reference both cookieAuth and bearerApiKey', () => {
    const prefixes = ['/api/v1/notes', '/api/v1/tags', '/api/v1/directories', '/api/v1/graph', '/api/v1/activity-log'];
    const expectedSecurity = [{ cookieAuth: [] }, { bearerApiKey: [] }];

    for (const prefix of prefixes) {
      const ops = getOperationsByPrefix(operations, prefix);
      expect(ops.length).toBeGreaterThan(0);

      for (const op of ops) {
        expect(op.security).toBeDefined();
        expect(op.security).toEqual(expectedSecurity);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// OperationId and Metadata Completeness Tests
// ---------------------------------------------------------------------------

describe('OpenAPI Spec — Operation Metadata Completeness', () => {
  let operations;

  beforeAll(() => {
    operations = getAllOperations(spec);
  });

  test('every operation has a non-empty summary (≤80 chars)', () => {
    for (const op of operations) {
      expect(op.summary).toBeDefined();
      expect(typeof op.summary).toBe('string');
      expect(op.summary.length).toBeGreaterThan(0);
      expect(op.summary.length).toBeLessThanOrEqual(80);
    }
  });

  test('every operation has a non-empty description', () => {
    for (const op of operations) {
      expect(op.description).toBeDefined();
      expect(typeof op.description).toBe('string');
      expect(op.description.length).toBeGreaterThan(0);
    }
  });

  test('every operation has an operationId matching camelCase pattern', () => {
    const camelCasePattern = /^[a-z][a-zA-Z0-9]*$/;
    for (const op of operations) {
      expect(op.operationId).toBeDefined();
      expect(typeof op.operationId).toBe('string');
      expect(op.operationId).toMatch(camelCasePattern);
    }
  });

  test('all operationIds are unique (no duplicates)', () => {
    const ids = operations.map((op) => op.operationId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('total count of operations matches expected (37 endpoints)', () => {
    expect(operations.length).toBe(37);
  });
});
