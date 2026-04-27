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
const mockLink = {
  findMany: mock(() => []),
  deleteMany: mock(() => ({ count: 0 })),
  create: mock(() => ({})),
  updateMany: mock(() => ({ count: 0 })),
};
const mockTag = {
  findMany: mock(() => []),
};
const mockRevision = {
  create: mock(() => ({})),
};

/** Tracks the callback passed to $transaction so we can inspect calls */
const mockTransaction = mock(async (cb) => cb({
  note: mockNote,
  link: mockLink,
  tag: mockTag,
  revision: mockRevision,
}));

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.link = mockLink;
      this.tag = mockTag;
      this.revision = mockRevision;
      this.$transaction = mockTransaction;
    }
  },
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
  mockLink.findMany.mockReset();
  mockLink.deleteMany.mockReset();
  mockLink.create.mockReset();
  mockLink.updateMany.mockReset();
  mockTag.findMany.mockReset();
  mockRevision.create.mockReset();
  mockTransaction.mockReset();

  // Restore default $transaction implementation
  mockTransaction.mockImplementation(async (cb) => cb({
    note: mockNote,
    link: mockLink,
    tag: mockTag,
    revision: mockRevision,
  }));

  // Default: no existing slugs
  mockNote.findMany.mockResolvedValue([]);
  // Default: link.findMany returns empty (no existing links)
  mockLink.findMany.mockResolvedValue([]);
  // Default: link.updateMany returns count 0
  mockLink.updateMany.mockResolvedValue({ count: 0 });
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
    // No existing slugs
    mockNote.findMany.mockResolvedValue([]);
    // No existing links
    mockLink.findMany.mockResolvedValue([]);
    // First wikilink target found, second not found
    mockNote.findFirst
      .mockResolvedValueOnce({ id: 'note_other' })  // "Other Note" found
      .mockResolvedValueOnce(null);                   // "Missing Note" not found
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, { title: 'My Note', content });

    // Two link.create calls for the two wikilinks
    expect(mockLink.create).toHaveBeenCalledTimes(2);

    // First link: resolved
    const link1 = mockLink.create.mock.calls[0][0];
    expect(link1.data.fromId).toBe('note_new');
    expect(link1.data.toId).toBe('note_other');
    expect(link1.data.toTitle).toBeNull();

    // Second link: unresolved (toId null, toTitle stored)
    const link2 = mockLink.create.mock.calls[1][0];
    expect(link2.data.fromId).toBe('note_new');
    expect(link2.data.toId).toBeNull();
    expect(link2.data.toTitle).toBe('Missing Note');
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

  test('uses DEFAULT_PAGE_LIMIT when no limit provided', async () => {
    mockNote.findMany.mockResolvedValue([]);

    await NoteService.listNotes(userId);

    const findCall = mockNote.findMany.mock.calls[0][0];
    // DEFAULT_PAGE_LIMIT is 20, so take should be 21
    expect(findCall.take).toBe(21);
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
      include: { tags: true },
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
    // Target note found
    mockNote.findFirst
      .mockResolvedValueOnce(baseNote)       // findFirst for existing note lookup
      .mockResolvedValueOnce({ id: 'note_target' }); // findFirst for wikilink target

    await NoteService.updateNote(userId, 'my-note', { content });

    // link.create called for the wikilink
    expect(mockLink.create).toHaveBeenCalled();
  });
});


// ---------------------------------------------------------------------------
// archiveNote
// ---------------------------------------------------------------------------
describe('NoteService.archiveNote', () => {
  /** Validates: Requirements 5.7 */
  test('sets status to ARCHIVED (soft delete)', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1' });
    mockNote.update.mockResolvedValue({});

    await NoteService.archiveNote(userId, 'my-note');

    expect(mockNote.findFirst).toHaveBeenCalledWith({
      where: { slug: 'my-note', userId },
      select: { id: true },
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
});
