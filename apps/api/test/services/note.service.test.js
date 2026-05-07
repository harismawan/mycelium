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
  createMany: mock(() => ({ count: 0 })),
  updateMany: mock(() => ({ count: 0 })),
};
const mockTag = {
  findMany: mock(() => []),
};
const mockRevision = {
  create: mock(() => ({})),
};

/** Tracks the callback/array passed to $transaction so we can inspect calls */
const mockTransaction = mock(async (arg) => {
  if (Array.isArray(arg)) {
    return Promise.all(arg);
  }
  return arg({
    note: mockNote,
    link: mockLink,
    tag: mockTag,
    revision: mockRevision,
  });
});

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
  mockLink.createMany.mockReset();
  mockLink.updateMany.mockReset();
  mockTag.findMany.mockReset();
  mockRevision.create.mockReset();
  mockTransaction.mockReset();

  // Restore default $transaction implementation
  mockTransaction.mockImplementation(async (arg) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg({
      note: mockNote,
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

    const unresolved = data.find((l) => l.toTitle === 'Missing Note');
    expect(unresolved).toBeDefined();
    expect(unresolved.fromId).toBe('note_new');
    expect(unresolved.toId).toBeNull();
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
    mockNote.findFirst.mockResolvedValueOnce(baseNote); // findFirst for existing note lookup

    await NoteService.updateNote(userId, 'my-note', { content });

    // createMany called for the wikilink (batch creation replaces per-link create)
    expect(mockLink.createMany).toHaveBeenCalled();
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
      select: { id: true },
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
