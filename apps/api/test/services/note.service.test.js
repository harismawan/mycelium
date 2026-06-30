import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — must happen before any import that touches Prisma
// ---------------------------------------------------------------------------
const mockNote = {
  create: mock(() => ({})),
  findMany: mock(() => []),
  findFirst: mock(() => null),
  update: mock(() => ({})),
};
const mockDirectory = {
  findFirst: mock(() => null),
};
const mockLink = {
  findMany: mock(() => []),
  deleteMany: mock(() => ({ count: 0 })),
  create: mock(() => ({})),
  createMany: mock(() => ({ count: 0 })),
  updateMany: mock(() => ({ count: 0 })),
};
const mockTag = {
  findMany: mock(() => []),
};
const mockRevision = {
  create: mock(() => ({})),
};
const mockSearchService = {
  search: mock(() => ({ notes: [], nextCursor: null })),
};

/** Tracks the callback/array passed to $transaction so we can inspect calls */
const mockTransaction = mock(async (arg) => {
  if (Array.isArray(arg)) {
    return Promise.all(arg);
  }
  return arg({
    note: mockNote,
    directory: mockDirectory,
    link: mockLink,
    tag: mockTag,
    revision: mockRevision,
  });
});

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.directory = mockDirectory;
      this.link = mockLink;
      this.tag = mockTag;
      this.revision = mockRevision;
      this.$transaction = mockTransaction;
    }
  },
}));

mock.module('../../src/services/search.service.js', () => ({
  SearchService: mockSearchService,
}));

// ---------------------------------------------------------------------------
// Import NoteService AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { NoteService } = await import('../../src/services/note.service.js');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const userId = 'user_1';
const now = new Date();

const baseNote = {
  id: 'note_1',
  slug: 'my-note',
  title: 'My Note',
  content: '---\ntags: [test]\n---\nHello world',
  frontmatter: { tags: ['test'] },
  excerpt: 'Hello world',
  status: 'DRAFT',
  pinned: false,
  userId,
  createdAt: now,
  updatedAt: now,
  tags: [{ id: 'tag_1', name: 'test' }],
  revisions: [{ id: 'rev_1', content: '---\ntags: [test]\n---\nHello world', createdAt: now }],
};

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockNote.create.mockReset();
  mockNote.findMany.mockReset();
  mockNote.findFirst.mockReset();
  mockNote.update.mockReset();
  mockDirectory.findFirst.mockReset();
  mockLink.findMany.mockReset();
  mockLink.deleteMany.mockReset();
  mockLink.create.mockReset();
  mockLink.createMany.mockReset();
  mockLink.updateMany.mockReset();
  mockTag.findMany.mockReset();
  mockRevision.create.mockReset();
  mockSearchService.search.mockReset();
  mockSearchService.search.mockResolvedValue({ notes: [], nextCursor: null });
  mockTransaction.mockReset();

  // Restore default $transaction implementation
  mockTransaction.mockImplementation(async (arg) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg({
      note: mockNote,
      directory: mockDirectory,
      link: mockLink,
      tag: mockTag,
      revision: mockRevision,
    });
  });

  // Default: no existing slugs
  mockNote.findMany.mockResolvedValue([]);
  // Default: link.findMany returns empty (no existing links)
  mockLink.findMany.mockResolvedValue([]);
  // Default: link.updateMany returns count 0
  mockLink.updateMany.mockResolvedValue({ count: 0 });
  mockDirectory.findFirst.mockResolvedValue(null);
});


// ---------------------------------------------------------------------------
// createNote
// ---------------------------------------------------------------------------
describe('NoteService.createNote', () => {
  /** Validates: Requirements 1.1, 1.2, 1.3, 1.4 */
  test('runs full pipeline: frontmatter, slug, excerpt, revision', async () => {
    const content = '---\ntags: [test]\n---\nHello world';
    mockNote.create.mockResolvedValue({ ...baseNote });
    // No existing slugs
    mockNote.findMany.mockResolvedValue([]);
    // No existing links for reconciliation
    mockLink.findMany.mockResolvedValue([]);
    // No unresolved links to resolve
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    const result = await NoteService.createNote(userId, {
      title: 'My Note',
      content,
      tags: ['test'],
    });

    // Transaction was used
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // note.create was called inside the transaction
    expect(mockNote.create).toHaveBeenCalledTimes(1);
    const createArg = mockNote.create.mock.calls[0][0];

    // Slug derived from title
    expect(createArg.data.slug).toBe('my-note');
    // Frontmatter parsed from content
    expect(createArg.data.frontmatter).toEqual({ tags: ['test'] });
    // Excerpt generated
    expect(createArg.data.excerpt).toBe('Hello world');
    // Revision created inline
    expect(createArg.data.revisions).toEqual({ create: { content } });
    // Default status
    expect(createArg.data.status).toBe('DRAFT');
    // Tags connect-or-create
    expect(createArg.data.tags).toEqual({
      connectOrCreate: [{ where: { name: 'test' }, create: { name: 'test' } }],
    });
    // Includes tags and revisions
    expect(createArg.include.tags).toBe(true);
    expect(createArg.include.revisions).toBe(true);

    expect(result.id).toBe('note_1');
  });

  /** Validates: Requirements 1.5 */
  test('generates unique slug when base slug already exists', async () => {
    const content = 'Hello';
    // Existing slugs that collide
    mockNote.findMany.mockResolvedValueOnce([
      { slug: 'my-note' },
      { slug: 'my-note-1' },
    ]);
    mockNote.create.mockResolvedValue({ ...baseNote, slug: 'my-note-2' });
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, { title: 'My Note', content });

    const createArg = mockNote.create.mock.calls[0][0];
    expect(createArg.data.slug).toBe('my-note-2');
  });

  /** Validates: Requirements 2.1, 2.2, 2.3 */
  test('extracts wikilinks and creates link records via reconcileLinks', async () => {
    const content = 'See [[Other Note]] and [[Missing Note]]';
    mockNote.create.mockResolvedValue({ ...baseNote, id: 'note_new' });
    // First findMany: slug collision check (no collisions)
    // Second findMany: batch target lookup — "Other Note" found, "Missing Note" not
    mockNote.findMany
      .mockResolvedValueOnce([])  // slug lookup
      .mockResolvedValueOnce([{ id: 'note_other', title: 'Other Note' }]); // batch target lookup
    // No existing links
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, { title: 'My Note', content });

    // Single createMany call with both links
    expect(mockLink.createMany).toHaveBeenCalledTimes(1);
    const { data } = mockLink.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);

    const resolved = data.find((l) => l.toId === 'note_other');
    expect(resolved).toBeDefined();
    expect(resolved.fromId).toBe('note_new');
    expect(resolved.toTitle).toBeNull();
    expect(resolved.relation).toBeNull();
    expect(resolved.weight).toBe(1);
    expect(resolved.source).toBe('wikilink');

    const unresolved = data.find((l) => l.toTitle === 'Missing Note');
    expect(unresolved).toBeDefined();
    expect(unresolved.fromId).toBe('note_new');
    expect(unresolved.toId).toBeNull();
    expect(unresolved.source).toBe('wikilink');
  });

  /** Validates: Requirements 2.4 */
  test('resolves unresolved links when new note title matches', async () => {
    const content = 'Hello';
    mockNote.create.mockResolvedValue({ ...baseNote, id: 'note_new', title: 'Target Title' });
    mockNote.findMany.mockResolvedValue([]);
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 2 });

    await NoteService.createNote(userId, { title: 'Target Title', content });

    // resolveUnresolvedLinks called with the new note's id and title
    expect(mockLink.updateMany).toHaveBeenCalled();
    const updateCall = mockLink.updateMany.mock.calls[0][0];
    expect(updateCall.where.toId).toBeNull();
    expect(updateCall.where.toTitle).toBe('Target Title');
    expect(updateCall.data.toId).toBe('note_new');
    expect(updateCall.data.toTitle).toBeNull();
  });

  test('uses DRAFT as default status when none provided', async () => {
    mockNote.create.mockResolvedValue(baseNote);
    mockNote.findMany.mockResolvedValue([]);
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, { title: 'Test', content: 'body' });

    const createArg = mockNote.create.mock.calls[0][0];
    expect(createArg.data.status).toBe('DRAFT');
  });

  test('auto-links semantically similar notes after the create transaction', async () => {
    const content = 'No wikilinks here';
    mockNote.create.mockResolvedValue({ ...baseNote, id: 'note_new' });
    mockNote.findMany.mockResolvedValue([]); // slug + resolveUnresolved lookups
    mockLink.findMany.mockResolvedValue([]); // reconcile + autoLink existing-edge lookup
    mockLink.updateMany.mockResolvedValue({ count: 0 });
    mockSearchService.search.mockResolvedValue({
      notes: [
        { id: 'note_new', rank: 0.9 }, // self — excluded
        { id: 'sem_1', rank: 0.5 },
        { id: 'sem_2', rank: 0.005 }, // below threshold — excluded
      ],
      nextCursor: null,
    });

    await NoteService.createNote(userId, { title: 'My Note', content });

    const semanticCall = mockLink.createMany.mock.calls.find((call) =>
      call[0].data.some((d) => d.source === 'semantic'),
    );
    expect(semanticCall).toBeDefined();
    expect(semanticCall[0].data).toEqual([
      {
        fromId: 'note_new',
        toId: 'sem_1',
        toTitle: null,
        relation: 'related-to',
        weight: 1,
        source: 'semantic',
      },
    ]);
  });

  test('persists clamped memory metadata (source/confidence/importance)', async () => {
    mockNote.create.mockResolvedValue({ ...baseNote });
    mockNote.findMany.mockResolvedValue([]);
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, {
      title: 'My Note',
      content: 'Hello',
      metadata: { source: 'session:abc', confidence: 1.7, importance: 9 },
    });

    const createArg = mockNote.create.mock.calls[0][0];
    expect(createArg.data.source).toBe('session:abc');
    expect(createArg.data.confidence).toBe(1); // clamped to [0,1]
    expect(createArg.data.importance).toBe(5); // clamped to [1,5]
  });

  test('omits metadata keys that were not provided on create', async () => {
    mockNote.create.mockResolvedValue({ ...baseNote });
    mockNote.findMany.mockResolvedValue([]);
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, { title: 'My Note', content: 'Hello' });

    const createArg = mockNote.create.mock.calls[0][0];
    expect('source' in createArg.data).toBe(false);
    expect('confidence' in createArg.data).toBe(false);
    expect('importance' in createArg.data).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createNote — injected transaction + shared slug reservation (R12.1)
// ---------------------------------------------------------------------------
describe('NoteService.createNote with injected tx', () => {
  test('does not open a nested transaction and writes through the injected tx', async () => {
    mockNote.findMany.mockResolvedValue([]); // slug lookup -> no collisions
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });
    mockNote.create.mockResolvedValue({ ...baseNote, id: 'note_tx', slug: 'my-note' });

    const tx = { note: mockNote, link: mockLink, directory: mockDirectory };

    const result = await NoteService.createNote(
      userId,
      { title: 'My Note', content: 'body' },
      { tx },
    );

    // The whole point: no inner $transaction is opened when one is injected.
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockNote.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('note_tx');
  });

  test('reservedSlugs dedups across in-flight items with no extra DB hit', async () => {
    mockNote.findMany.mockResolvedValue([]); // DB reports no collisions for either call
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });
    mockNote.create.mockResolvedValue({ ...baseNote });

    const tx = { note: mockNote, link: mockLink, directory: mockDirectory };
    const reservedSlugs = new Set();

    await NoteService.createNote(userId, { title: 'My Note', content: 'a' }, { tx, reservedSlugs });
    await NoteService.createNote(userId, { title: 'My Note', content: 'b' }, { tx, reservedSlugs });

    expect(mockNote.create.mock.calls[0][0].data.slug).toBe('my-note');
    expect(mockNote.create.mock.calls[1][0].data.slug).toBe('my-note-1');
    expect(reservedSlugs.has('my-note')).toBe(true);
    expect(reservedSlugs.has('my-note-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listNotes
// ---------------------------------------------------------------------------
describe('NoteService.listNotes', () => {
  /** Validates: Requirements 5.2 */
  test('returns cursor-based paginated notes', async () => {
    const notes = Array.from({ length: 3 }, (_, i) => ({
      id: `note_${i}`,
      slug: `note-${i}`,
      title: `Note ${i}`,
      tags: [],
    }));
    // Return 3 items (limit+1 to signal hasMore)
    mockNote.findMany.mockResolvedValue(notes);

    const result = await NoteService.listNotes(userId, { limit: 2 });

    expect(result.notes).toHaveLength(2);
    expect(result.nextCursor).toBe('note_1');
  });

  test('returns null nextCursor when no more results', async () => {
    mockNote.findMany.mockResolvedValue([
      { id: 'note_0', slug: 'a', title: 'A', tags: [] },
    ]);

    const result = await NoteService.listNotes(userId, { limit: 5 });

    expect(result.notes).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  /** Validates: Requirements 5.3 */
  test('applies status filter', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId, { status: 'PUBLISHED' });

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.where.status).toBe('PUBLISHED');
  });

  test('applies tag filter', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId, { tag: 'javascript' });

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.where.tags).toEqual({ some: { name: 'javascript' } });
  });

  test('applies search query filter', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId, { q: 'hello' });

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.where.OR).toBeDefined();
    expect(findCall.where.OR).toHaveLength(2);
  });

  test('passes cursor for pagination', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId, { cursor: 'cursor_abc' });

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.cursor).toEqual({ id: 'cursor_abc' });
    expect(findCall.skip).toBe(1);
  });

  test('sorts pinned notes first, then by most recently updated', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId);

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.orderBy).toEqual([
      { pinned: 'desc' },
      { updatedAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  test('uses DEFAULT_PAGE_LIMIT when no limit provided', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId);

    const findCall = mockNote.findMany.mock.calls[0][0];
    // DEFAULT_PAGE_LIMIT is 20, so take should be 21
    expect(findCall.take).toBe(21);
  });

  test('filters by directoryId', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId, { directoryId: 'dir_1' });

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.where.directoryId).toBe('dir_1');
  });

  test('filters unfiled notes', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId, { unfiled: true });

    const findCall = mockNote.findMany.mock.calls[0][0];
    expect(findCall.where.directoryId).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// getNote
// ---------------------------------------------------------------------------
describe('NoteService.getNote', () => {
  /** Validates: Requirements 5.4 */
  test('returns note by slug', async () => {
    mockNote.findFirst.mockResolvedValue(baseNote);

    const result = await NoteService.getNote(userId, 'my-note');

    expect(result).toEqual(baseNote);
    expect(mockNote.findFirst).toHaveBeenCalledWith({
      where: { slug: 'my-note', userId },
      include: { tags: true, directory: { select: { id: true, name: true, parentId: true } } },
    });
  });

  test('returns null when note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    const result = await NoteService.getNote(userId, 'nonexistent');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getNoteMarkdown
// ---------------------------------------------------------------------------
describe('NoteService.getNoteMarkdown', () => {
  /** Validates: Requirements 5.5 */
  test('returns raw markdown content', async () => {
    mockNote.findFirst.mockResolvedValue({ content: '# Hello\nWorld' });

    const result = await NoteService.getNoteMarkdown(userId, 'my-note');

    expect(result).toBe('# Hello\nWorld');
    expect(mockNote.findFirst).toHaveBeenCalledWith({
      where: { slug: 'my-note', userId },
      select: { content: true },
    });
  });

  test('throws 404 for missing note', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    try {
      await NoteService.getNoteMarkdown(userId, 'missing');
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Note not found');
    }
  });
});


// ---------------------------------------------------------------------------
// updateNote
// ---------------------------------------------------------------------------
describe('NoteService.updateNote', () => {
  beforeEach(() => {
    // Default: existing note found
    mockNote.findFirst.mockResolvedValue({ ...baseNote });
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });
  });

  /** Validates: Requirements 5.6, 1.2, 1.3, 1.4 */
  test('re-runs full pipeline on update', async () => {
    const updatedContent = '---\ntags: [updated]\n---\nUpdated body';
    mockNote.update.mockResolvedValue({
      ...baseNote,
      content: updatedContent,
      title: 'My Note',
      tags: [{ id: 'tag_2', name: 'updated' }],
      revisions: [{ id: 'rev_2', content: updatedContent }],
    });

    const result = await NoteService.updateNote(userId, 'my-note', {
      content: updatedContent,
      message: 'updated content',
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockNote.update).toHaveBeenCalledTimes(1);

    const updateArg = mockNote.update.mock.calls[0][0];
    // Frontmatter re-parsed
    expect(updateArg.data.frontmatter).toEqual({ tags: ['updated'] });
    // Excerpt re-generated
    expect(updateArg.data.excerpt).toBe('Updated body');
    // Revision created with message
    expect(updateArg.data.revisions).toEqual({
      create: { content: updatedContent, message: 'updated content' },
    });
  });

  test('updates slug when title changes', async () => {
    // No other notes with the new slug
    mockNote.findMany
      .mockResolvedValueOnce([])  // first call: slug lookup for updateNote
    ;
    mockNote.update.mockResolvedValue({
      ...baseNote,
      title: 'New Title',
      slug: 'new-title',
    });

    await NoteService.updateNote(userId, 'my-note', {
      title: 'New Title',
    });

    const updateArg = mockNote.update.mock.calls[0][0];
    expect(updateArg.data.slug).toBe('new-title');
  });

  test('throws 404 when note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    try {
      await NoteService.updateNote(userId, 'nonexistent', { content: 'x' });
      expect(true).toBe(false);
    } catch (err) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Note not found');
    }
  });

  /** Validates: Requirements 2.1, 2.2 */
  test('reconciles links on update', async () => {
    const content = 'Link to [[Another Note]]';
    mockNote.update.mockResolvedValue({ ...baseNote, content });
    // No existing links
    mockLink.findMany.mockResolvedValue([]);
    mockNote.findFirst.mockResolvedValueOnce(baseNote); // findFirst for existing note lookup

    await NoteService.updateNote(userId, 'my-note', { content });

    // createMany called for the wikilink (batch creation replaces per-link create)
    expect(mockLink.createMany).toHaveBeenCalled();
  });

  test('moves note into a directory', async () => {
    mockDirectory.findFirst.mockResolvedValue({ id: 'dir_1', userId });
    mockNote.update.mockResolvedValue({
      ...baseNote,
      directoryId: 'dir_1',
      directory: { id: 'dir_1', name: 'Projects' },
    });

    await NoteService.updateNote(userId, 'my-note', { directoryId: 'dir_1' });

    const updateArg = mockNote.update.mock.calls[0][0];
    expect(updateArg.data.directoryId).toBe('dir_1');
  });

  test('moves note back to unfiled', async () => {
    mockNote.findFirst.mockResolvedValueOnce({ ...baseNote, directoryId: 'dir_1' });
    mockNote.update.mockResolvedValue({ ...baseNote, directoryId: null, directory: null });

    await NoteService.updateNote(userId, 'my-note', { directoryId: null });

    const updateArg = mockNote.update.mock.calls[0][0];
    expect(updateArg.data.directoryId).toBeNull();
  });

  test('rejects assigning a note to another user directory', async () => {
    mockDirectory.findFirst.mockResolvedValue(null);

    await expect(NoteService.updateNote(userId, 'my-note', { directoryId: 'other_dir' }))
      .rejects.toMatchObject({ statusCode: 404, message: 'Directory not found' });
  });

  test('updates only the provided metadata fields', async () => {
    mockNote.findFirst.mockResolvedValue({ ...baseNote });
    mockNote.findMany.mockResolvedValue([]);
    mockNote.update.mockResolvedValue({ ...baseNote });
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.updateNote(userId, 'my-note', {
      content: 'Updated body',
      metadata: { importance: 4 },
    });

    const updateArg = mockNote.update.mock.calls[0][0];
    expect(updateArg.data.importance).toBe(4);
    expect('source' in updateArg.data).toBe(false);
    expect('confidence' in updateArg.data).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// archiveNote
// ---------------------------------------------------------------------------
describe('NoteService.archiveNote', () => {
  /** Validates: Requirements 5.7 */
  test('sets status to ARCHIVED (soft delete)', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1', title: 'My Note' });
    mockNote.update.mockResolvedValue({});

    await NoteService.archiveNote(userId, 'my-note');

    expect(mockNote.findFirst).toHaveBeenCalledWith({
      where: { slug: 'my-note', userId },
      select: { id: true, title: true },
    });
    expect(mockNote.update).toHaveBeenCalledWith({
      where: { id: 'note_1' },
      data: { status: 'ARCHIVED' },
    });
  });

  test('throws 404 for missing note', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    try {
      await NoteService.archiveNote(userId, 'nonexistent');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Note not found');
    }
  });

  test('returns the archived note title', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1', title: 'My Note' });
    mockNote.update.mockResolvedValue({ id: 'note_1', title: 'My Note', status: 'ARCHIVED' });

    const result = await NoteService.archiveNote('user_1', 'my-note');

    expect(result).toEqual({ id: 'note_1', title: 'My Note' });
  });

  test('throws 404 when note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    await expect(NoteService.archiveNote('user_1', 'ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// countNotes
// ---------------------------------------------------------------------------
describe('NoteService.countNotes', () => {
  test('returns counts grouped by status', async () => {
    // Mock prisma.note.count — need to add it to the mock
    mockNote.count = mock(() => Promise.resolve(0));
    mockNote.count
      .mockResolvedValueOnce(10)  // total (non-archived)
      .mockResolvedValueOnce(5)   // draft
      .mockResolvedValueOnce(3)   // published
      .mockResolvedValueOnce(2);  // archived

    const result = await NoteService.countNotes(userId);

    expect(result).toEqual({ total: 10, draft: 5, published: 3, archived: 2 });
    expect(mockNote.count).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------
describe('NoteService.deleteNote', () => {
  test('deletes note and all associated links and revisions', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1' });
    mockLink.deleteMany.mockResolvedValue({ count: 0 });
    mockRevision.deleteMany = mock(() => Promise.resolve({ count: 0 }));
    mockNote.delete = mock(() => Promise.resolve({}));

    await NoteService.deleteNote(userId, 'my-note');

    expect(mockNote.findFirst).toHaveBeenCalledWith({
      where: { slug: 'my-note', userId },
      select: { id: true, title: true },
    });
    // Links from this note deleted
    expect(mockLink.deleteMany).toHaveBeenCalledWith({ where: { fromId: 'note_1' } });
    // Links to this note deleted
    expect(mockLink.deleteMany).toHaveBeenCalledWith({ where: { toId: 'note_1' } });
    // Revisions deleted
    expect(mockRevision.deleteMany).toHaveBeenCalledWith({ where: { noteId: 'note_1' } });
    // Note deleted
    expect(mockNote.delete).toHaveBeenCalledWith({ where: { id: 'note_1' } });
  });

  test('throws 404 for missing note', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    try {
      await NoteService.deleteNote(userId, 'nonexistent');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Note not found');
    }
  });
});

// ---------------------------------------------------------------------------
// revertNote
// ---------------------------------------------------------------------------
describe('NoteService.revertNote', () => {
  test('reverts note content to a specific revision', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1' });
    mockRevision.findFirst = mock(() => Promise.resolve({
      id: 'rev_old',
      content: 'Old content',
      noteId: 'note_1',
    }));
    mockNote.update.mockResolvedValue({
      ...baseNote,
      content: 'Old content',
      revisions: [{ id: 'rev_new', content: 'Old content', message: 'Reverted to revision rev_old' }],
    });

    const result = await NoteService.revertNote(userId, 'my-note', 'rev_old', {
      authType: 'apikey',
      apiKeyId: 'key_1',
      apiKeyName: 'test-key',
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockNote.update).toHaveBeenCalledTimes(1);

    const updateArg = mockNote.update.mock.calls[0][0];
    expect(updateArg.data.content).toBe('Old content');
    expect(updateArg.data.revisions.create.message).toContain('rev_old');
    expect(updateArg.data.revisions.create.authType).toBe('apikey');
    expect(updateArg.data.revisions.create.apiKeyId).toBe('key_1');
    expect(updateArg.data.revisions.create.apiKeyName).toBe('test-key');
  });

  test('throws 404 when note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    try {
      await NoteService.revertNote(userId, 'missing', 'rev_1');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Note not found');
    }
  });

  test('throws 404 when revision not found', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1' });
    mockRevision.findFirst = mock(() => Promise.resolve(null));

    try {
      await NoteService.revertNote(userId, 'my-note', 'rev_missing');
      expect(true).toBe(false);
    } catch (err) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Revision not found');
    }
  });
});

describe('NoteService.deleteNote', () => {
  test('returns the deleted note title', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1', title: 'My Note' });
    // deleteMany and delete are called via $transaction array
    mockLink.deleteMany.mockResolvedValue({ count: 0 });

    const result = await NoteService.deleteNote('user_1', 'my-note');

    expect(result).toEqual({ title: 'My Note' });
  });

  test('throws 404 when note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    await expect(NoteService.deleteNote('user_1', 'ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// createMemories — batch save (R12.2)
// ---------------------------------------------------------------------------
describe('NoteService.createMemories', () => {
  test('creates all items in one transaction with per-item created results', async () => {
    // createMemories delegates to upsertMemory — mock it to control results
    // without pulling in the full upsertMemory pipeline (directories, recalls).
    const originalUpsert = NoteService.upsertMemory;
    const upsert = mock()
      .mockResolvedValueOnce({ id: 'n1', slug: 'alpha', action: 'created', excerpt: 'a' })
      .mockResolvedValueOnce({ id: 'n2', slug: 'beta', action: 'created', excerpt: 'b' });
    NoteService.upsertMemory = upsert;
    try {
      const results = await NoteService.createMemories(userId, [
        { title: 'Alpha', content: 'a' },
        { title: 'Beta', content: 'b' },
      ]);

      // One transaction wraps the whole batch; inner upsertMemory calls reuse it.
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { index: 0, id: 'n1', slug: 'alpha', action: 'created', error: null },
        { index: 1, id: 'n2', slug: 'beta', action: 'created', error: null },
      ]);
    } finally {
      NoteService.upsertMemory = originalUpsert;
    }
  });

  test('is best-effort: a bad item is captured without aborting the rest', async () => {
    const originalUpsert = NoteService.upsertMemory;
    const upsert = mock()
      .mockResolvedValueOnce({ id: 'ok', slug: 'ok', action: 'created', excerpt: 'e' })
      .mockRejectedValueOnce({ statusCode: 404, message: 'Directory not found' });
    NoteService.upsertMemory = upsert;
    try {
      const results = await NoteService.createMemories(userId, [
        { title: 'Good', content: 'a' },
        { title: 'Bad', content: 'b', directoryId: 'missing-dir' },
      ]);

      expect(results[0]).toEqual({ index: 0, id: 'ok', slug: 'ok', action: 'created', error: null });
      expect(results[1].index).toBe(1);
      expect(results[1].id).toBeNull();
      expect(results[1].action).toBeNull();
      expect(results[1].error).toBe('Directory not found');
    } finally {
      NoteService.upsertMemory = originalUpsert;
    }
  });

  test('delegates to upsertMemory when present, forwarding the shared tx', async () => {
    const upsert = mock(async () => ({ id: 'up1', slug: 'consolidated', action: 'updated', excerpt: 'x' }));
    NoteService.upsertMemory = upsert;
    try {
      const results = await NoteService.createMemories(userId, [
        { title: 'Topic', content: 'c', tags: ['t'], mode: 'append' },
      ]);

      expect(upsert).toHaveBeenCalledTimes(1);
      const [calledUserId, calledData, calledOpts] = upsert.mock.calls[0];
      expect(calledUserId).toBe(userId);
      expect(calledData).toEqual({ title: 'Topic', content: 'c', tags: ['t'], mode: 'append' });
      expect(calledOpts.tx).toBeDefined();
      expect(calledOpts.reservedSlugs instanceof Set).toBe(true);
      expect(results[0]).toEqual({
        index: 0, id: 'up1', slug: 'consolidated', action: 'updated', error: null,
      });
    } finally {
      delete NoteService.upsertMemory;
    }
  });
});

describe('NoteService.updateNote — returns before snapshot', () => {
  test('returns { note, before } with pre-update field values', async () => {
    const existing = {
      id: 'note_1',
      slug: 'my-note',
      title: 'Old Title',
      content: 'Old content here',
      status: 'DRAFT',
      tags: [{ id: 'tag_1', name: 'old-tag' }],
    };
    mockNote.findFirst.mockResolvedValue(existing);
    mockNote.findMany.mockResolvedValue([]); // no slug collisions
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    const updatedNote = {
      id: 'note_1',
      slug: 'new-title',
      title: 'New Title',
      content: 'New content here',
      status: 'PUBLISHED',
      tags: [{ id: 'tag_2', name: 'new-tag' }],
      revisions: [],
    };
    mockNote.update.mockResolvedValue(updatedNote);

    const result = await NoteService.updateNote('user_1', 'my-note', {
      title: 'New Title',
      content: 'New content here',
      status: 'PUBLISHED',
      tags: ['new-tag'],
    });

    expect(result).toHaveProperty('note');
    expect(result).toHaveProperty('before');
    expect(result.before.title).toBe('Old Title');
    expect(result.before.status).toBe('DRAFT');
    expect(result.before.tags).toEqual(['old-tag']);
    expect(result.before.content).toBe('Old content here');
  });
});
