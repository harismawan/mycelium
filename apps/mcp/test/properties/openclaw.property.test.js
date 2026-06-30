import { describe, test, expect, mock, beforeEach } from 'bun:test';
import fc from 'fast-check';

// ─── Shared mocks ────────────────────────────────────────────────────────────

const mockPrisma = {
  directory: {
    findFirst: mock(() => ({ id: 'memories-dir' })),
    create: mock(() => ({ id: 'memories-dir' })),
  },
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
  activityLog: {
    create: mock(() => ({})),
  },
  $queryRaw: mock(() => []),
  $transaction: mock((fn) => fn(mockPrisma)),
};
const mockNoteService = {
  upsertMemory: mock(() => ({})),
};
const mockSearchService = {
  getContext: mock(() => []),
};
const mockDirectoryService = {
  findOrCreateMemoriesDirectory: mock(() => ({ id: 'memories-dir' })),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));
mock.module('@mycelium/api/services/search.service.js', () => ({
  SearchService: mockSearchService,
}));
mock.module('@mycelium/api/services/directory.service.js', () => ({
  DirectoryService: mockDirectoryService,
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
    mockSearchService.getContext.mockReset();
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

          mockSearchService.getContext.mockImplementation(() =>
            dbResults.map((note) => ({
              ...note,
              tags: [],
              updatedAt: note.updatedAt.toISOString(),
            })),
          );

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
          const dbResults = mockNotes.slice(0, limit);
          mockSearchService.getContext.mockImplementation(() =>
            dbResults.map((note) => ({
              ...note,
              tags: note.tags.map((tag) => tag.name),
              updatedAt: note.updatedAt.toISOString(),
            })),
          );

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


// ─── Property 10: save_memory delegates to upsertMemory and returns its result ─
// **Validates: Requirements 14.4**
// The agent-memory tag / PUBLISHED status / dedup invariants now live in the
// service and are covered by apps/api/test/services/upsert-memory.test.js.

describe('Feature: mcp-server, Property 10: save_memory delegates to upsertMemory and returns its result', () => {
  beforeEach(() => {
    mockNoteService.upsertMemory.mockReset();
  });

  test('forwards title, content, and raw tags (no mode) and returns the upsert result verbatim', async () => {
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
          let captured = null;
          mockNoteService.upsertMemory.mockImplementation((userId, payload) => {
            captured = { userId, payload };
            return { id: 'gen-id', slug: 'gen-slug', action: 'created', excerpt: content.slice(0, 200) };
          });

          const server = createMockServer();
          registerSaveMemory(server, { userId: 'u1', scopes: ['notes:write'], apiKeyId: 'k1', apiKeyName: 'cli' });
          const handler = server.getHandler('save_memory');

          const result = await handler({ title, content, tags });
          expect(result.isError).toBeUndefined();

          // Delegation: exact args forwarded, mode left unset (service defaults to append).
          expect(captured).not.toBeNull();
          expect(captured.userId).toBe('u1');
          expect(captured.payload.title).toBe(title);
          expect(captured.payload.content).toBe(content);
          expect(captured.payload.tags).toEqual(tags);
          expect(captured.payload.mode).toBeUndefined();

          // Return shape is the service payload verbatim.
          const parsed = JSON.parse(result.content[0].text);
          expect(Object.keys(parsed).sort()).toEqual(['action', 'excerpt', 'id', 'slug']);
        },
      ),
      { numRuns: 100 },
    );
  });
});
