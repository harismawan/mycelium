import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNote = {
  create: mock(() => ({})),
  findMany: mock(() => []),
  findFirst: mock(() => null),
  update: mock(() => ({})),
};
const mockLink = { findMany: mock(() => []), updateMany: mock(() => ({ count: 0 })) };
const mockTag = { findMany: mock(() => []) };
const mockRevision = { create: mock(() => ({})) };
const mockExecuteRaw = mock(() => 1);
const mockTransaction = mock(async (arg) => {
  if (Array.isArray(arg)) return Promise.all(arg);
  return arg({ note: mockNote, link: mockLink, tag: mockTag, revision: mockRevision });
});

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.note = mockNote;
      this.link = mockLink;
      this.tag = mockTag;
      this.revision = mockRevision;
      this.$transaction = mockTransaction;
      this.$executeRaw = mockExecuteRaw;
    }
  },
}));

const mockEmbedText = mock(async () => null);
mock.module('../../src/services/embedding.service.js', () => ({ embedText: mockEmbedText }));
mock.module('../../src/services/link.service.js', () => ({
  LinkService: { reconcileLinks: mock(async () => {}), autoLink: mock(async () => {}) },
}));
mock.module('../../src/services/search.service.js', () => ({
  SearchService: { search: mock(async () => ({ notes: [], nextCursor: null })) },
}));

const { NoteService } = await import('../../src/services/note.service.js');

const userId = 'user_1';
const vector = Array.from({ length: 1024 }, () => 0.02);

beforeEach(() => {
  mockNote.create.mockReset();
  mockNote.findMany.mockReset();
  mockNote.findFirst.mockReset();
  mockNote.update.mockReset();
  mockLink.findMany.mockReset();
  mockLink.updateMany.mockReset();
  mockExecuteRaw.mockReset();
  mockExecuteRaw.mockReturnValue(1);
  mockEmbedText.mockReset();
  mockTransaction.mockClear();
});

describe('NoteService.createNote — embedding', () => {
  test('writes the embedding via $executeRaw outside the transaction', async () => {
    mockEmbedText.mockResolvedValue(vector);
    mockNote.findMany.mockResolvedValue([]);
    mockNote.create.mockResolvedValue({ id: 'note_1', slug: 'my-note', title: 'My Note', tags: [], revisions: [] });
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, { title: 'My Note', content: 'Hello world' });

    expect(mockEmbedText).toHaveBeenCalledWith('My Note\n\nHello world');
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    // Raw UPDATE carries the pgvector literal and the new note id as params.
    const callArgs = JSON.stringify(mockExecuteRaw.mock.calls[0]);
    expect(callArgs).toContain('note_1');
    expect(callArgs).toContain('[0.02,');
  });

  test('does not write a vector when embedText returns null (arm disabled)', async () => {
    mockEmbedText.mockResolvedValue(null);
    mockNote.findMany.mockResolvedValue([]);
    mockNote.create.mockResolvedValue({ id: 'note_1', slug: 'my-note', title: 'My Note', tags: [], revisions: [] });
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.createNote(userId, { title: 'My Note', content: 'Hello world' });

    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

describe('NoteService.updateNote — embedding', () => {
  const existing = {
    id: 'note_1', slug: 'my-note', title: 'My Note', status: 'DRAFT',
    content: 'Original body', tags: [{ name: 'test' }],
  };

  test('recomputes and writes when content changes', async () => {
    mockEmbedText.mockResolvedValue(vector);
    mockNote.findFirst.mockResolvedValue({ ...existing });
    mockNote.findMany.mockResolvedValue([]);
    mockNote.update.mockResolvedValue({ id: 'note_1', slug: 'my-note', tags: [], revisions: [] });
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.updateNote(userId, 'my-note', { content: 'New body text' });

    expect(mockEmbedText).toHaveBeenCalledWith('My Note\n\nNew body text');
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  test('does NOT recompute when neither title nor content changed', async () => {
    mockNote.findFirst.mockResolvedValue({ ...existing });
    mockNote.findMany.mockResolvedValue([]);
    mockNote.update.mockResolvedValue({ id: 'note_1', slug: 'my-note', tags: [], revisions: [] });
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    await NoteService.updateNote(userId, 'my-note', { pinned: true });

    expect(mockEmbedText).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});
