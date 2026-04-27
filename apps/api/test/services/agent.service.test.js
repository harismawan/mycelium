import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — must happen before any import that touches Prisma
// ---------------------------------------------------------------------------
const mockNote = {
  findMany: mock(() => []),
};

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
    }
  },
}));

// ---------------------------------------------------------------------------
// Import AgentService AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { AgentService } = await import('../../src/services/agent.service.js');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const userId = 'user_1';
const now = new Date();

const publishedNotes = [
  {
    id: 'note_1',
    slug: 'first-note',
    title: 'First Note',
    content: '# First\nHello world',
    excerpt: 'Hello world',
    frontmatter: { tags: ['test'] },
    tags: [{ name: 'test' }],
    updatedAt: now,
  },
  {
    id: 'note_2',
    slug: 'second-note',
    title: 'Second Note',
    content: '# Second\nGoodbye world',
    excerpt: 'Goodbye world',
    frontmatter: null,
    tags: [{ name: 'demo' }, { name: 'test' }],
    updatedAt: now,
  },
];

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockNote.findMany.mockReset();
  mockNote.findMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// getManifest
// ---------------------------------------------------------------------------
describe('AgentService.getManifest', () => {
  /** Validates: Requirements 10.1 */
  test('returns object with apiVersion, endpoints, contentSchema, and auth', () => {
    const manifest = AgentService.getManifest();

    expect(manifest.apiVersion).toBe('v1');
    expect(Array.isArray(manifest.endpoints)).toBe(true);
    expect(manifest.contentSchema).toBeDefined();
    expect(manifest.auth).toBeDefined();
  });

  test('endpoints include manifest, bundle, and notes', () => {
    const manifest = AgentService.getManifest();
    const paths = manifest.endpoints.map((e) => e.path);

    expect(paths.some((p) => p.includes('manifest'))).toBe(true);
    expect(paths.some((p) => p.includes('bundle'))).toBe(true);
    expect(paths.some((p) => p.includes('notes'))).toBe(true);
  });

  /** Validates: Requirements 10.4 */
  test('auth requires agent:read scope', () => {
    const manifest = AgentService.getManifest();

    expect(manifest.auth.requiredScopes).toContain('agent:read');
  });
});

// ---------------------------------------------------------------------------
// streamBundle
// ---------------------------------------------------------------------------
describe('AgentService.streamBundle', () => {
  /** Validates: Requirements 10.2 */
  test('returns a ReadableStream', () => {
    mockNote.findMany.mockResolvedValue([]);

    const stream = AgentService.streamBundle(userId);

    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('produces valid NDJSON with expected note fields', async () => {
    // Return notes on first call, empty on second to end the stream
    mockNote.findMany
      .mockResolvedValueOnce(publishedNotes)
      .mockResolvedValueOnce([]);

    const stream = AgentService.streamBundle(userId);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(2);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('slug');
      expect(parsed).toHaveProperty('title');
      expect(parsed).toHaveProperty('content');
      expect(parsed).toHaveProperty('excerpt');
      expect(parsed).toHaveProperty('frontmatter');
      expect(parsed).toHaveProperty('tags');
      expect(parsed).toHaveProperty('updatedAt');
    }
  });

  test('each NDJSON line is independently parseable JSON', async () => {
    mockNote.findMany
      .mockResolvedValueOnce([publishedNotes[0]])
      .mockResolvedValueOnce([]);

    const stream = AgentService.streamBundle(userId);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(1);

    // Should not throw
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe('note_1');
    expect(parsed.slug).toBe('first-note');
    expect(parsed.tags).toEqual(['test']);
  });

  test('flattens tag objects to tag name strings', async () => {
    mockNote.findMany
      .mockResolvedValueOnce([publishedNotes[1]])
      .mockResolvedValueOnce([]);

    const stream = AgentService.streamBundle(userId);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    const parsed = JSON.parse(output.trim());
    expect(parsed.tags).toEqual(['demo', 'test']);
  });

  test('produces empty output when no published notes exist', async () => {
    mockNote.findMany.mockResolvedValue([]);

    const stream = AgentService.streamBundle(userId);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    expect(output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// listAgentNotes
// ---------------------------------------------------------------------------
describe('AgentService.listAgentNotes', () => {
  /** Validates: Requirements 10.3 */
  test('returns simplified notes with correct fields', async () => {
    mockNote.findMany.mockResolvedValue([publishedNotes[0]]);

    const result = await AgentService.listAgentNotes(userId);

    expect(result.notes).toHaveLength(1);
    const note = result.notes[0];
    expect(note.id).toBe('note_1');
    expect(note.slug).toBe('first-note');
    expect(note.title).toBe('First Note');
    expect(note.excerpt).toBe('Hello world');
    expect(note.tags).toEqual(['test']);
    expect(note.updatedAt).toBe(now);
    // Should NOT include content or frontmatter (simplified format)
    expect(note).not.toHaveProperty('content');
    expect(note).not.toHaveProperty('frontmatter');
  });

  test('supports cursor-based pagination', async () => {
    // Return limit+1 items to signal hasMore
    const threeNotes = [
      { ...publishedNotes[0], id: 'note_a' },
      { ...publishedNotes[1], id: 'note_b' },
      { id: 'note_c', slug: 'third', title: 'Third', excerpt: null, tags: [], updatedAt: now },
    ];
    mockNote.findMany.mockResolvedValue(threeNotes);

    const result = await AgentService.listAgentNotes(userId, { limit: 2 });

    expect(result.notes).toHaveLength(2);
    expect(result.nextCursor).toBe('note_b');
  });

  test('returns null nextCursor when no more results', async () => {
    mockNote.findMany.mockResolvedValue([publishedNotes[0]]);

    const result = await AgentService.listAgentNotes(userId, { limit: 20 });

    expect(result.notes).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  /** Validates: Requirements 10.4 */
  test('only queries PUBLISHED notes', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await AgentService.listAgentNotes(userId);

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.where.status).toBe('PUBLISHED');
    expect(findCall.where.userId).toBe(userId);
  });

  test('passes cursor for pagination', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await AgentService.listAgentNotes(userId, { cursor: 'cursor_abc' });

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.cursor).toEqual({ id: 'cursor_abc' });
    expect(findCall.skip).toBe(1);
  });

  test('uses default page limit when none provided', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await AgentService.listAgentNotes(userId);

    const findCall = mockNote.findMany.mock.calls[0][0];
    // DEFAULT_PAGE_LIMIT is 20, so take should be 21
    expect(findCall.take).toBe(21);
  });
});
