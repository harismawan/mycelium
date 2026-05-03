import { describe, test, expect, mock, beforeEach } from 'bun:test';
import fc from 'fast-check';

// ─── Shared mocks ────────────────────────────────────────────────────────────

const mockPrisma = {
  note: {
    findFirst: mock(() => null),
    findMany: mock(() => []),
    create: mock(() => ({})),
  },
  link: {
    findMany: mock(() => []),
    create: mock(() => ({})),
    deleteMany: mock(() => ({})),
    updateMany: mock(() => ({})),
  },
  $queryRaw: mock(() => []),
  $transaction: mock((fn) => fn(mockPrisma)),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('../../src/links.js', () => ({
  reconcileLinks: mock(() => Promise.resolve()),
  resolveUnresolvedLinks: mock(() => Promise.resolve()),
}));
mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, ''),
  serializeFrontmatter: (fm, content) =>
    `---\ntitle: ${fm.title}\nstatus: ${fm.status}\ntags: [${fm.tags.join(', ')}]\n---\n${content}`,
}));

const { register: registerGetContext } = await import('../../src/tools/get-context.js');
const { register: registerSaveMemory } = await import('../../src/tools/save-memory.js');

// Session imports — no mocking needed, uses real implementation
import { getSessionStore, destroySession, validateSessionLimits } from '../../src/session.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function createMockServer() {
  const tools = new Map();
  return {
    tool(name, desc, schema, handler) {
      tools.set(name, handler);
    },
    getHandler(name) {
      return tools.get(name);
    },
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbAlpha = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/);
const arbUuid = fc.uuid();
const arbSlug = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}[a-z0-9]$/);
const arbLimit = fc.integer({ min: 1, max: 20 });

// ─── Property 9: get_context returns relevant or recent notes within limit ───
// **Validates: Requirements 14.3, 14.4**

describe('Feature: mcp-server, Property 9: get_context returns relevant or recent notes within limit', () => {
  beforeEach(() => {
    mockPrisma.$queryRaw.mockReset();
    mockPrisma.note.findMany.mockReset();
  });

  test('result count never exceeds limit and each note has required fields (topic path)', async () => {
    const arbValidDate = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true });
    const arbNote = fc.record({
      id: arbUuid,
      slug: arbSlug,
      title: arbAlpha,
      excerpt: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
      updatedAt: arbValidDate,
    });

    await fc.assert(
      fc.asyncProperty(
        arbAlpha,
        arbLimit,
        fc.array(arbNote, { minLength: 0, maxLength: 20 }),
        async (topic, limit, mockNotes) => {
          // The real DB enforces LIMIT in SQL, so mock must also respect it.
          // We generate up to 20 notes but the DB would return at most `limit`.
          const dbResults = mockNotes.slice(0, limit);

          // Reset before each iteration to avoid stale mockImplementationOnce
          mockPrisma.$queryRaw.mockReset();

          // First $queryRaw: search results, second: tags
          mockPrisma.$queryRaw
            .mockImplementationOnce(() => dbResults)
            .mockImplementationOnce(() => []);

          const server = createMockServer();
          registerGetContext(server, { userId: 'u1', scopes: ['agent:read'] });
          const handler = server.getHandler('get_context');

          const result = await handler({ topic, limit });
          expect(result.isError).toBeUndefined();

          const parsed = JSON.parse(result.content[0].text);

          // Count never exceeds limit
          expect(parsed.length).toBeLessThanOrEqual(limit);

          // Each note has required fields
          for (const note of parsed) {
            expect(note).toHaveProperty('id');
            expect(note).toHaveProperty('slug');
            expect(note).toHaveProperty('title');
            expect(note).toHaveProperty('excerpt');
            expect(note).toHaveProperty('tags');
            expect(note).toHaveProperty('updatedAt');
            expect(Array.isArray(note.tags)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('result count never exceeds limit and each note has required fields (recent path)', async () => {
    const arbValidDate = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true });
    const arbTag = fc.record({ name: arbAlpha });
    const arbNote = fc.record({
      id: arbUuid,
      slug: arbSlug,
      title: arbAlpha,
      excerpt: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
      tags: fc.array(arbTag, { minLength: 0, maxLength: 5 }),
      updatedAt: arbValidDate,
    });

    await fc.assert(
      fc.asyncProperty(
        arbLimit,
        fc.array(arbNote, { minLength: 0, maxLength: 20 }),
        async (limit, mockNotes) => {
          // Simulate Prisma returning at most `limit` notes (as `take` would)
          const dbResults = mockNotes.slice(0, limit);
          mockPrisma.note.findMany.mockImplementation(() => dbResults);

          const server = createMockServer();
          registerGetContext(server, { userId: 'u1', scopes: ['agent:read'] });
          const handler = server.getHandler('get_context');

          const result = await handler({ limit });
          expect(result.isError).toBeUndefined();

          const parsed = JSON.parse(result.content[0].text);

          // Count never exceeds limit
          expect(parsed.length).toBeLessThanOrEqual(limit);

          // Each note has required fields
          for (const note of parsed) {
            expect(note).toHaveProperty('id');
            expect(note).toHaveProperty('slug');
            expect(note).toHaveProperty('title');
            expect(note).toHaveProperty('excerpt');
            expect(note).toHaveProperty('tags');
            expect(note).toHaveProperty('updatedAt');
            expect(Array.isArray(note.tags)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 10: save_memory always includes agent-memory tag and PUBLISHED status ─
// **Validates: Requirements 14.4**

describe('Feature: mcp-server, Property 10: save_memory always includes agent-memory tag and PUBLISHED status', () => {
  beforeEach(() => {
    mockPrisma.note.findMany.mockReset();
    mockPrisma.note.create.mockReset();
    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
  });

  test('tags always include agent-memory, status is always PUBLISHED, no duplicate agent-memory', async () => {
    const arbTagName = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
    const arbTags = fc.option(
      fc.array(arbTagName, { minLength: 0, maxLength: 5 }),
      { nil: undefined },
    );

    await fc.assert(
      fc.asyncProperty(
        arbAlpha,
        fc.string({ minLength: 1, maxLength: 200 }),
        arbTags,
        async (title, content, tags) => {
          // Track what gets passed to prisma.note.create
          let capturedData = null;
          mockPrisma.note.findMany.mockImplementation(() => []);
          mockPrisma.note.create.mockImplementation(({ data }) => {
            capturedData = data;
            return {
              id: 'gen-id',
              slug: data.slug,
              title: data.title,
              status: data.status,
              tags: data.tags.connectOrCreate.map((t) => ({ name: t.create.name })),
            };
          });

          const server = createMockServer();
          registerSaveMemory(server, { userId: 'u1', scopes: ['notes:write'] });
          const handler = server.getHandler('save_memory');

          const result = await handler({ title, content, tags });
          expect(result.isError).toBeUndefined();

          // Verify the create call
          expect(capturedData).not.toBeNull();

          // Status is always PUBLISHED
          expect(capturedData.status).toBe('PUBLISHED');

          // Tags always include agent-memory
          const tagNames = capturedData.tags.connectOrCreate.map((t) => t.create.name);
          expect(tagNames).toContain('agent-memory');

          // No duplicate agent-memory tags
          const agentMemoryCount = tagNames.filter((n) => n === 'agent-memory').length;
          expect(agentMemoryCount).toBe(1);

          // All user-provided tags are preserved
          if (tags) {
            for (const tag of tags) {
              if (tag !== 'agent-memory') {
                expect(tagNames).toContain(tag);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('agent-memory is deduplicated when user explicitly provides it', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAlpha,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/), { minLength: 0, maxLength: 4 }),
        async (title, content, extraTags) => {
          // Always include agent-memory in user tags
          const userTags = ['agent-memory', ...extraTags];

          let capturedData = null;
          mockPrisma.note.findMany.mockImplementation(() => []);
          mockPrisma.note.create.mockImplementation(({ data }) => {
            capturedData = data;
            return {
              id: 'gen-id',
              slug: data.slug,
              title: data.title,
              status: data.status,
              tags: data.tags.connectOrCreate.map((t) => ({ name: t.create.name })),
            };
          });

          const server = createMockServer();
          registerSaveMemory(server, { userId: 'u1', scopes: ['notes:write'] });
          const handler = server.getHandler('save_memory');

          const result = await handler({ title, content, tags: userTags });
          expect(result.isError).toBeUndefined();

          const tagNames = capturedData.tags.connectOrCreate.map((t) => t.create.name);
          const agentMemoryCount = tagNames.filter((n) => n === 'agent-memory').length;
          expect(agentMemoryCount).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 11: Session context is bounded and connection-scoped ───────────
// **Validates: Requirements 15.1, 15.4, 15.6**

describe('Feature: mcp-server, Property 11: Session context is bounded and connection-scoped', () => {
  test('max 100 keys enforced', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 95, max: 110 }),
        (keyCount) => {
          const connId = `prop11-keys-${keyCount}-${Date.now()}`;
          const store = getSessionStore(connId);

          let rejectedAt = null;
          for (let i = 0; i < keyCount; i++) {
            const err = validateSessionLimits(store, `key-${i}`, 'val');
            if (err) {
              rejectedAt = i;
              break;
            }
            store.set(`key-${i}`, 'val');
          }

          if (keyCount <= 100) {
            // All keys should have been accepted
            expect(rejectedAt).toBeNull();
            expect(store.size).toBe(keyCount);
          } else {
            // The 101st key should be rejected
            expect(rejectedAt).toBe(100);
            expect(store.size).toBe(100);
          }

          destroySession(connId);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('max 10KB per value enforced', () => {
    const MAX_VALUE_BYTES = 10 * 1024;

    fc.assert(
      fc.property(
        fc.integer({ min: MAX_VALUE_BYTES - 50, max: MAX_VALUE_BYTES + 50 }),
        (valueSize) => {
          const connId = `prop11-size-${valueSize}-${Date.now()}`;
          const store = getSessionStore(connId);
          const value = 'x'.repeat(valueSize);

          const err = validateSessionLimits(store, 'test-key', value);

          if (valueSize <= MAX_VALUE_BYTES) {
            expect(err).toBeNull();
          } else {
            expect(err).not.toBeNull();
            expect(err).toContain('10KB');
          }

          destroySession(connId);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('destroySession clears all data for a connection', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.stringMatching(/^[a-z]{1,10}$/),
            value: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (entries) => {
          const connId = `prop11-destroy-${Date.now()}-${Math.random()}`;
          const store = getSessionStore(connId);

          // Populate the store
          for (const { key, value } of entries) {
            store.set(key, value);
          }
          expect(store.size).toBeGreaterThan(0);

          // Destroy the session
          destroySession(connId);

          // Getting the store again should return an empty store
          const newStore = getSessionStore(connId);
          expect(newStore.size).toBe(0);

          // Clean up
          destroySession(connId);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('sessions are connection-scoped (isolated between connections)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.string({ minLength: 1, maxLength: 50 }),
        (connA, connB, key, value) => {
          // Ensure different connection IDs
          const idA = `prop11-iso-a-${connA}-${Date.now()}`;
          const idB = `prop11-iso-b-${connB}-${Date.now()}`;

          const storeA = getSessionStore(idA);
          const storeB = getSessionStore(idB);

          storeA.set(key, value);

          // Store B should not see store A's data
          expect(storeB.has(key)).toBe(false);

          // Destroying A should not affect B if B had data
          storeB.set('own-key', 'own-val');
          destroySession(idA);

          const storeB2 = getSessionStore(idB);
          expect(storeB2.get('own-key')).toBe('own-val');

          // Clean up
          destroySession(idA);
          destroySession(idB);
        },
      ),
      { numRuns: 100 },
    );
  });
});
