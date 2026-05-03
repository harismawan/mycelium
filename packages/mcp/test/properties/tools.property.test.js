import { describe, test, expect, mock } from 'bun:test';
import fc from 'fast-check';

// ─── Shared mocks ────────────────────────────────────────────────────────────
// All tool handlers use the same mockPrisma via mock.module.
// To avoid cross-test interference, each property callback sets up
// exactly the mock implementations it needs before invoking the handler.

const mockPrisma = {
  note: {
    findFirst: mock(() => null),
    findMany: mock(() => []),
    create: mock(() => ({})),
    update: mock(() => ({})),
  },
  tag: {
    findMany: mock(() => []),
  },
  link: {
    findMany: mock(() => []),
    create: mock(() => ({})),
    deleteMany: mock(() => ({})),
    updateMany: mock(() => ({})),
  },
  apiKey: {
    findUnique: mock(() => null),
    update: mock(() => ({})),
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

const { checkScopes } = await import('../../src/auth.js');
const { register: registerSearch } = await import('../../src/tools/search-notes.js');
const { register: registerRead } = await import('../../src/tools/read-note.js');
const { register: registerCreate } = await import('../../src/tools/create-note.js');
const { register: registerUpdate } = await import('../../src/tools/update-note.js');
const { register: registerListTags } = await import('../../src/tools/list-tags.js');
const { register: registerGetGraph } = await import('../../src/tools/get-graph.js');

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

const ALL_SCOPES = ['agent:read', 'notes:write'];
const ALL_TOOLS = [
  'search_notes', 'read_note', 'list_notes', 'list_tags',
  'get_backlinks', 'get_outgoing_links', 'get_graph',
  'create_note', 'update_note',
];
const TOOL_REQUIRED_SCOPES = {
  search_notes: ['agent:read'],
  read_note: ['agent:read'],
  list_notes: ['agent:read'],
  list_tags: ['agent:read'],
  get_backlinks: ['agent:read'],
  get_outgoing_links: ['agent:read'],
  get_graph: ['agent:read'],
  create_note: ['notes:write'],
  update_note: ['notes:write'],
};

const arbToolName = fc.constantFrom(...ALL_TOOLS);
const arbScopeSubset = fc.subarray(ALL_SCOPES, { minLength: 0, maxLength: ALL_SCOPES.length });
const arbAlpha = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/);
const arbNoteStatus = fc.constantFrom('DRAFT', 'PUBLISHED', 'ARCHIVED');
const arbUuid = fc.uuid();
const arbSlug = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}[a-z0-9]$/);

// ─── Property 1: Scope enforcement gates tool execution ──────────────────────
// **Validates: Requirements 2.5, 2.6, 2.7**

describe('Feature: mcp-server, Property 1: Scope enforcement gates tool execution', () => {
  test('checkScopes returns null iff all required scopes present', () => {
    fc.assert(
      fc.property(
        fc.subarray(['agent:read', 'notes:write', 'admin:all'], { minLength: 0, maxLength: 3 }),
        fc.subarray(['agent:read', 'notes:write', 'admin:all'], { minLength: 0, maxLength: 3 }),
        (required, user) => {
          const result = checkScopes(required, user);
          const allPresent = required.every((s) => user.includes(s));
          if (allPresent) {
            expect(result).toBeNull();
          } else {
            expect(result).not.toBeNull();
            expect(result.isError).toBe(true);
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.error).toBe('Insufficient permissions');
            expect(parsed.required).toEqual(required);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('per-tool scope mapping is enforced correctly', () => {
    fc.assert(
      fc.property(arbToolName, arbScopeSubset, (toolName, scopes) => {
        const required = TOOL_REQUIRED_SCOPES[toolName];
        const result = checkScopes(required, scopes);
        const allPresent = required.every((s) => scopes.includes(s));
        if (allPresent) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(result.isError).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Search results contain all required fields ──────────────────
// **Validates: Requirements 3.3, 3.4**

describe('Feature: mcp-server, Property 2: Search results contain all required fields', () => {
  test('every result has id, slug, title, excerpt, status, rank', async () => {
    const arbSearchResult = fc.record({
      id: arbUuid,
      slug: arbSlug,
      title: arbAlpha,
      excerpt: fc.option(fc.string({ maxLength: 50 }), { nil: null }),
      status: arbNoteStatus,
      rank: fc.float({ min: 0, max: 1, noNaN: true }),
    });

    await fc.assert(
      fc.asyncProperty(
        arbAlpha,
        fc.array(arbSearchResult, { minLength: 0, maxLength: 10 }),
        async (query, mockResults) => {
          mockPrisma.$queryRaw.mockImplementation(() => mockResults);

          const server = createMockServer();
          registerSearch(server, { userId: 'u1', scopes: ['agent:read'] });
          const handler = server.getHandler('search_notes');

          const result = await handler({ query });
          expect(result.isError).toBeUndefined();

          const parsed = JSON.parse(result.content[0].text);
          expect(parsed).toHaveLength(mockResults.length);
          for (const item of parsed) {
            expect(item).toHaveProperty('id');
            expect(item).toHaveProperty('slug');
            expect(item).toHaveProperty('title');
            expect(item).toHaveProperty('excerpt');
            expect(item).toHaveProperty('status');
            expect(item).toHaveProperty('rank');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Read note round-trip preserves note data ────────────────────
// **Validates: Requirements 4.2**

describe('Feature: mcp-server, Property 3: Read note round-trip preserves note data', () => {
  test('read_note output matches stored fields exactly', async () => {
    const arbTag = fc.record({ name: arbAlpha });
    const arbNote = fc.record({
      id: arbUuid,
      slug: arbSlug,
      title: arbAlpha,
      content: fc.string({ maxLength: 200 }),
      excerpt: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
      status: arbNoteStatus,
      tags: fc.array(arbTag, { minLength: 0, maxLength: 5 }),
      updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    });

    await fc.assert(
      fc.asyncProperty(arbNote, async (note) => {
        mockPrisma.note.findFirst.mockImplementation(() => note);

        const server = createMockServer();
        registerRead(server, { userId: 'u1', scopes: ['agent:read'] });
        const handler = server.getHandler('read_note');

        const result = await handler({ slug: note.slug, format: 'json' });
        expect(result.isError).toBeUndefined();

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe(note.id);
        expect(parsed.slug).toBe(note.slug);
        expect(parsed.title).toBe(note.title);
        expect(parsed.content).toBe(note.content);
        expect(parsed.excerpt).toBe(note.excerpt);
        expect(parsed.status).toBe(note.status);
        expect(parsed.tags).toEqual(note.tags.map((t) => t.name));
        expect(parsed.updatedAt).toBe(note.updatedAt.toISOString());
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Create note output reflects created state ───────────────────
// **Validates: Requirements 5.3, 5.4**

describe('Feature: mcp-server, Property 4: Create note output reflects created state', () => {
  test('create_note output has id, slug, title, status, tags matching mock', async () => {
    const arbTagNames = fc.array(arbAlpha, { minLength: 0, maxLength: 5 });

    await fc.assert(
      fc.asyncProperty(
        arbAlpha,
        fc.string({ maxLength: 200 }),
        fc.option(arbNoteStatus, { nil: undefined }),
        arbTagNames,
        async (title, content, status, tagNames) => {
          const mockCreatedNote = {
            id: 'gen-id-1',
            slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'note',
            title,
            status: status ?? 'DRAFT',
            tags: tagNames.map((n) => ({ name: n })),
          };

          // Set up mocks for create_note flow
          mockPrisma.note.findMany.mockImplementation(() => []);
          mockPrisma.note.create.mockImplementation(() => mockCreatedNote);
          mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

          const server = createMockServer();
          registerCreate(server, { userId: 'u1', scopes: ['notes:write'] });
          const handler = server.getHandler('create_note');

          const result = await handler({ title, content, status, tags: tagNames });
          expect(result.isError).toBeUndefined();

          const parsed = JSON.parse(result.content[0].text);
          expect(parsed.id).toBe(mockCreatedNote.id);
          expect(parsed.slug).toBe(mockCreatedNote.slug);
          expect(parsed.title).toBe(mockCreatedNote.title);
          expect(parsed.status).toBe(mockCreatedNote.status);
          expect(parsed.tags).toEqual(tagNames);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: Update note output reflects updated state ───────────────────
// **Validates: Requirements 6.3, 6.4**

describe('Feature: mcp-server, Property 5: Update note output reflects updated state', () => {
  test('update_note output matches the mock return', async () => {
    const arbUpdatePayload = fc.record({
      title: fc.option(arbAlpha, { nil: undefined }),
      content: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
      status: fc.option(arbNoteStatus, { nil: undefined }),
      tags: fc.option(fc.array(arbAlpha, { minLength: 0, maxLength: 5 }), { nil: undefined }),
      message: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
    });

    await fc.assert(
      fc.asyncProperty(arbSlug, arbUpdatePayload, async (slug, payload) => {
        const existingNote = {
          id: 'existing-id',
          slug,
          title: 'Original Title',
          content: 'Original content',
          excerpt: 'Original',
          status: 'DRAFT',
          tags: [{ name: 'old-tag' }],
        };

        const updatedNote = {
          id: existingNote.id,
          slug: payload.title
            ? payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || slug
            : slug,
          title: payload.title ?? existingNote.title,
          status: payload.status ?? existingNote.status,
          tags: payload.tags ? payload.tags.map((n) => ({ name: n })) : existingNote.tags,
        };

        mockPrisma.note.findFirst.mockImplementation(() => existingNote);
        mockPrisma.note.findMany.mockImplementation(() => []);
        mockPrisma.note.update.mockImplementation(() => updatedNote);
        mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

        const server = createMockServer();
        registerUpdate(server, { userId: 'u1', scopes: ['notes:write'] });
        const handler = server.getHandler('update_note');

        const result = await handler({ slug, ...payload });
        expect(result.isError).toBeUndefined();

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe(updatedNote.id);
        expect(parsed.slug).toBe(updatedNote.slug);
        expect(parsed.title).toBe(updatedNote.title);
        expect(parsed.status).toBe(updatedNote.status);
        expect(parsed.tags).toEqual(updatedNote.tags.map((t) => t.name));
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Tag list is complete, correctly shaped, and sorted ──────────
// **Validates: Requirements 7.2, 7.3**

describe('Feature: mcp-server, Property 6: Tag list is complete, correctly shaped, and sorted', () => {
  test('output is sorted alphabetically and each tag has name and noteCount', async () => {
    const arbTagWithCount = fc.record({
      name: arbAlpha,
      _count: fc.record({ notes: fc.nat({ max: 100 }) }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbTagWithCount, { minLength: 0, maxLength: 20 }),
        async (tags) => {
          const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name));
          mockPrisma.tag.findMany.mockImplementation(() => sortedTags);

          const server = createMockServer();
          registerListTags(server, { userId: 'u1', scopes: ['agent:read'] });
          const handler = server.getHandler('list_tags');

          const result = await handler({});
          expect(result.isError).toBeUndefined();

          const parsed = JSON.parse(result.content[0].text);
          expect(parsed.tags).toHaveLength(sortedTags.length);

          for (const tag of parsed.tags) {
            expect(tag).toHaveProperty('name');
            expect(typeof tag.name).toBe('string');
            expect(tag).toHaveProperty('noteCount');
            expect(typeof tag.noteCount).toBe('number');
          }

          const names = parsed.tags.map((t) => t.name);
          const expectedSorted = [...names].sort((a, b) => a.localeCompare(b));
          expect(names).toEqual(expectedSorted);
          expect(parsed.tags.length).toBe(tags.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7: Graph output contains correctly shaped nodes and edges ──────
// **Validates: Requirements 10.4, 10.5, 10.6**

describe('Feature: mcp-server, Property 7: Graph output contains correctly shaped nodes and edges', () => {
  test('every node has id/slug/title/status and every edge has fromId/toId/relation', async () => {
    const arbNode = fc.record({
      id: arbUuid,
      slug: arbSlug,
      title: arbAlpha,
      status: fc.constantFrom('DRAFT', 'PUBLISHED'),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbNode, { minLength: 0, maxLength: 10 }),
        async (nodes) => {
          const edges = [];
          for (let i = 0; i < nodes.length - 1; i++) {
            edges.push({ fromId: nodes[i].id, toId: nodes[i + 1].id, relation: null });
          }

          mockPrisma.note.findMany.mockImplementation(() => nodes);
          mockPrisma.link.findMany.mockImplementation(() => edges);

          const server = createMockServer();
          registerGetGraph(server, { userId: 'u1', scopes: ['agent:read'] });
          const handler = server.getHandler('get_graph');

          const result = await handler({ slug: undefined, depth: 1 });
          expect(result.isError).toBeUndefined();

          const parsed = JSON.parse(result.content[0].text);

          for (const node of parsed.nodes) {
            expect(node).toHaveProperty('id');
            expect(node).toHaveProperty('slug');
            expect(node).toHaveProperty('title');
            expect(node).toHaveProperty('status');
          }

          for (const edge of parsed.edges) {
            expect(edge).toHaveProperty('fromId');
            expect(edge).toHaveProperty('toId');
            expect(edge).toHaveProperty('relation');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Validation errors produce JSON-RPC error code -32602 ────────
// **Validates: Requirements 13.2**

describe('Feature: mcp-server, Property 8: Validation errors produce JSON-RPC error code -32602', () => {
  test('checkScopes with random scope sets always returns correct result', () => {
    const arbScopeSet = fc.subarray(
      ['agent:read', 'notes:write', 'admin:all', 'notes:read', 'agent:write'],
      { minLength: 0, maxLength: 5 },
    );

    fc.assert(
      fc.property(arbScopeSet, arbScopeSet, (required, user) => {
        const result = checkScopes(required, user);
        const missing = required.filter((s) => !user.includes(s));

        if (missing.length === 0) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(result.isError).toBe(true);
          expect(result.content).toHaveLength(1);
          expect(result.content[0].type).toBe('text');
          const parsed = JSON.parse(result.content[0].text);
          expect(parsed.error).toBe('Insufficient permissions');
          expect(parsed.required).toEqual(required);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('read_note returns isError for not-found slugs', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, async (slug) => {
        mockPrisma.note.findFirst.mockImplementation(() => null);

        const server = createMockServer();
        registerRead(server, { userId: 'u1', scopes: ['agent:read'] });
        const handler = server.getHandler('read_note');

        const result = await handler({ slug, format: 'json' });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toBe('Note not found');
        expect(parsed.slug).toBe(slug);
      }),
      { numRuns: 100 },
    );
  });

  test('update_note returns isError for not-found slugs', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, async (slug) => {
        mockPrisma.note.findFirst.mockImplementation(() => null);

        const server = createMockServer();
        registerUpdate(server, { userId: 'u1', scopes: ['notes:write'] });
        const handler = server.getHandler('update_note');

        const result = await handler({ slug });
        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toBe('Note not found');
      }),
      { numRuns: 100 },
    );
  });
});
