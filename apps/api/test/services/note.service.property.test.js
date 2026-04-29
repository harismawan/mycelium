import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock setup — mock the db module before importing NoteService
// ---------------------------------------------------------------------------

// Storage for created records
const createdNotes = [];
const createdRevisions = [];
const updatedNotes = [];
let noteIdCounter = 0;
let revisionIdCounter = 0;

const mockNote = {
  create: mock(async ({ data, include }) => {
    const id = `note_${noteIdCounter++}`;
    // Extract revision data from nested create
    const revData = data.revisions?.create;
    let revisions = [];
    if (revData) {
      const revId = `rev_${revisionIdCounter++}`;
      const rev = { id: revId, noteId: id, ...revData, createdAt: new Date() };
      createdRevisions.push(rev);
      revisions = [rev];
    }
    const note = {
      id,
      slug: data.slug,
      title: data.title,
      content: data.content,
      excerpt: data.excerpt,
      status: data.status || 'DRAFT',
      userId: data.userId,
      tags: [],
      revisions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    createdNotes.push(note);
    return note;
  }),
  findMany: mock(async () => []),
  findFirst: mock(async () => null),
  update: mock(async ({ where, data, include }) => {
    // Extract revision data from nested create
    const revData = data.revisions?.create;
    let revisions = [];
    if (revData) {
      const revId = `rev_${revisionIdCounter++}`;
      const rev = { id: revId, noteId: where.id, ...revData, createdAt: new Date() };
      createdRevisions.push(rev);
      revisions = [rev];
    }
    const note = {
      id: where.id,
      slug: data.slug || 'test-slug',
      title: data.title || 'Test',
      content: data.content,
      excerpt: data.excerpt,
      status: data.status || 'DRAFT',
      tags: [],
      revisions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    updatedNotes.push(note);
    return note;
  }),
};

const mockRevision = {
  findFirst: mock(async () => null),
  create: mock(async ({ data }) => {
    const id = `rev_${revisionIdCounter++}`;
    const rev = { id, ...data, createdAt: new Date() };
    createdRevisions.push(rev);
    return rev;
  }),
};

const mockLink = {
  findMany: mock(async () => []),
  deleteMany: mock(async () => ({ count: 0 })),
  create: mock(async () => ({})),
  updateMany: mock(async () => ({ count: 0 })),
};

const mockTransaction = mock(async (cb) => cb({
  note: mockNote,
  link: mockLink,
  revision: mockRevision,
}));

const mockPrisma = {
  note: mockNote,
  revision: mockRevision,
  link: mockLink,
  $transaction: mockTransaction,
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));

// ---------------------------------------------------------------------------
// Import NoteService AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { NoteService } = await import('../../src/services/note.service.js');

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  createdNotes.length = 0;
  createdRevisions.length = 0;
  updatedNotes.length = 0;
  noteIdCounter = 0;
  revisionIdCounter = 0;

  mockNote.create.mockClear();
  mockNote.findMany.mockClear();
  mockNote.findFirst.mockClear();
  mockNote.update.mockClear();
  mockRevision.findFirst.mockClear();
  mockRevision.create.mockClear();
  mockLink.findMany.mockClear();
  mockLink.deleteMany.mockClear();
  mockLink.create.mockClear();
  mockLink.updateMany.mockClear();
  mockTransaction.mockClear();

  // Restore default implementations
  mockNote.findMany.mockImplementation(async () => []);
  mockLink.findMany.mockImplementation(async () => []);
  mockLink.updateMany.mockImplementation(async () => ({ count: 0 }));
  mockNote.findFirst.mockImplementation(async () => null);
  mockRevision.findFirst.mockImplementation(async () => null);

  mockNote.create.mockImplementation(async ({ data, include }) => {
    const id = `note_${noteIdCounter++}`;
    const revData = data.revisions?.create;
    let revisions = [];
    if (revData) {
      const revId = `rev_${revisionIdCounter++}`;
      const rev = { id: revId, noteId: id, ...revData, createdAt: new Date() };
      createdRevisions.push(rev);
      revisions = [rev];
    }
    const note = {
      id,
      slug: data.slug,
      title: data.title,
      content: data.content,
      excerpt: data.excerpt,
      status: data.status || 'DRAFT',
      userId: data.userId,
      tags: [],
      revisions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    createdNotes.push(note);
    return note;
  });

  mockNote.update.mockImplementation(async ({ where, data, include }) => {
    const revData = data.revisions?.create;
    let revisions = [];
    if (revData) {
      const revId = `rev_${revisionIdCounter++}`;
      const rev = { id: revId, noteId: where.id, ...revData, createdAt: new Date() };
      createdRevisions.push(rev);
      revisions = [rev];
    }
    const note = {
      id: where.id,
      slug: data.slug || 'test-slug',
      title: data.title || 'Test',
      content: data.content,
      excerpt: data.excerpt,
      status: data.status || 'DRAFT',
      tags: [],
      revisions,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    updatedNotes.push(note);
    return note;
  });

  mockTransaction.mockImplementation(async (cb) => cb({
    note: mockNote,
    link: mockLink,
    revision: mockRevision,
  }));
});

// ---------------------------------------------------------------------------
// Property 2: Revision identity reflects auth context
// **Validates: Requirements 2.1, 2.2, 2.3**
// ---------------------------------------------------------------------------
describe('Feature: agent-activity-log, Property 2: revision identity reflects auth context', () => {
  // --- createNote tests ---

  test('createNote with apikey auth sets matching apiKeyId and apiKeyName on revision', async () => {
    await NoteService.createNote('user_abc123', {
      title: 'Agent Note',
      content: 'Content from agent',
      authType: 'apikey',
      apiKeyId: 'key_agent001',
      apiKeyName: 'my-agent',
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const rev = createdRevisions[createdRevisions.length - 1];
    expect(rev.authType).toBe('apikey');
    expect(rev.apiKeyId).toBe('key_agent001');
    expect(rev.apiKeyName).toBe('my-agent');
  });

  test('createNote with jwt auth has undefined apiKeyId and apiKeyName on revision', async () => {
    await NoteService.createNote('user_jwt001', {
      title: 'Human Note',
      content: 'Content from human',
      authType: 'jwt',
      apiKeyId: undefined,
      apiKeyName: undefined,
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const rev = createdRevisions[createdRevisions.length - 1];
    expect(rev.authType).toBe('jwt');
    expect(rev.apiKeyId).toBeUndefined();
    expect(rev.apiKeyName).toBeUndefined();
  });

  test('createNote with apikey auth and different key names preserves identity', async () => {
    await NoteService.createNote('user_multi001', {
      title: 'Multi Key Note',
      content: 'Testing different key names',
      authType: 'apikey',
      apiKeyId: 'key_special_chars_123',
      apiKeyName: 'agent-with-dashes_and_underscores',
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const rev = createdRevisions[createdRevisions.length - 1];
    expect(rev.authType).toBe('apikey');
    expect(rev.apiKeyId).toBe('key_special_chars_123');
    expect(rev.apiKeyName).toBe('agent-with-dashes_and_underscores');
  });

  test('createNote with apikey auth and short key name', async () => {
    await NoteService.createNote('user_short001', {
      title: 'Short Key Note',
      content: 'Short key name test',
      authType: 'apikey',
      apiKeyId: 'key_s',
      apiKeyName: 'a',
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const rev = createdRevisions[createdRevisions.length - 1];
    expect(rev.authType).toBe('apikey');
    expect(rev.apiKeyId).toBe('key_s');
    expect(rev.apiKeyName).toBe('a');
  });

  // --- updateNote tests ---

  test('updateNote with apikey auth sets matching identity on revision', async () => {
    const existingNote = {
      id: 'existing_note_1',
      slug: 'test-note',
      title: 'Test Note',
      content: 'old content that differs',
      status: 'DRAFT',
      tags: [],
    };
    mockNote.findFirst.mockImplementation(async () => existingNote);

    await NoteService.updateNote('user_update001', 'test-note', {
      content: 'new content from agent',
      authType: 'apikey',
      apiKeyId: 'key_update_agent001',
      apiKeyName: 'update-agent',
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const rev = createdRevisions[createdRevisions.length - 1];
    expect(rev.authType).toBe('apikey');
    expect(rev.apiKeyId).toBe('key_update_agent001');
    expect(rev.apiKeyName).toBe('update-agent');
  });

  test('updateNote with jwt auth has undefined apiKeyId and apiKeyName on revision', async () => {
    const existingNote = {
      id: 'existing_note_2',
      slug: 'jwt-note',
      title: 'JWT Note',
      content: 'original content here',
      status: 'PUBLISHED',
      tags: [],
    };
    mockNote.findFirst.mockImplementation(async () => existingNote);

    await NoteService.updateNote('user_jwt_update', 'jwt-note', {
      content: 'updated by human via jwt',
      authType: 'jwt',
      apiKeyId: undefined,
      apiKeyName: undefined,
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const rev = createdRevisions[createdRevisions.length - 1];
    expect(rev.authType).toBe('jwt');
    expect(rev.apiKeyId).toBeUndefined();
    expect(rev.apiKeyName).toBeUndefined();
  });

  test('updateNote with apikey auth and long key name preserves full identity', async () => {
    const existingNote = {
      id: 'existing_note_3',
      slug: 'long-key-note',
      title: 'Long Key Note',
      content: 'some old content',
      status: 'DRAFT',
      tags: [],
    };
    mockNote.findFirst.mockImplementation(async () => existingNote);

    await NoteService.updateNote('user_longkey001', 'long-key-note', {
      content: 'updated content with long key',
      authType: 'apikey',
      apiKeyId: 'key_abcdefghijklmnopqrstuvwxyz',
      apiKeyName: 'my-very-long-agent-key-name',
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const rev = createdRevisions[createdRevisions.length - 1];
    expect(rev.authType).toBe('apikey');
    expect(rev.apiKeyId).toBe('key_abcdefghijklmnopqrstuvwxyz');
    expect(rev.apiKeyName).toBe('my-very-long-agent-key-name');
  });
});

// ---------------------------------------------------------------------------
// Property 5: Revert preserves target revision content
// **Validates: Requirements 5.3**
// ---------------------------------------------------------------------------
describe('Feature: agent-activity-log, Property 5: revert preserves target revision content', () => {
  /**
   * Helper: set up mocks for a revert scenario and execute revertNote.
   */
  async function setupAndRevert({ userId, slug, noteId, revisions, targetIndex, authContext }) {
    const targetRevision = revisions[targetIndex];

    mockNote.findFirst.mockImplementation(async ({ where }) => {
      if (where.slug === slug && where.userId === userId) {
        return { id: noteId };
      }
      return null;
    });

    mockRevision.findFirst.mockImplementation(async ({ where }) => {
      if (where.id === targetRevision.id && where.noteId === noteId) {
        return targetRevision;
      }
      return null;
    });

    let capturedUpdateData = null;
    mockNote.update.mockImplementation(async ({ where, data }) => {
      capturedUpdateData = data;
      const revData = data.revisions?.create;
      let revs = [];
      if (revData) {
        const revId = `rev_revert_${revisionIdCounter++}`;
        const rev = { id: revId, noteId: where.id, ...revData, createdAt: new Date() };
        createdRevisions.push(rev);
        revs = [rev];
      }
      return {
        id: where.id,
        slug,
        title: 'Test',
        content: data.content,
        tags: [],
        revisions: revs,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    const result = await NoteService.revertNote(userId, slug, targetRevision.id, authContext);
    return { result, capturedUpdateData, targetRevision };
  }

  test('revert to first revision sets content to that revision content', async () => {
    const revisions = [
      { id: 'rev_0', noteId: 'note_r1', content: 'First draft', message: null, createdAt: new Date('2026-01-01') },
      { id: 'rev_1', noteId: 'note_r1', content: 'Second edit', message: 'edit 1', createdAt: new Date('2026-01-02') },
      { id: 'rev_2', noteId: 'note_r1', content: 'Third edit', message: 'edit 2', createdAt: new Date('2026-01-03') },
    ];

    const { result, capturedUpdateData, targetRevision } = await setupAndRevert({
      userId: 'user_revert001',
      slug: 'revert-test-1',
      noteId: 'note_r1',
      revisions,
      targetIndex: 0,
      authContext: { authType: 'apikey', apiKeyId: 'key_rv1', apiKeyName: 'revert-agent' },
    });

    expect(result.content).toBe('First draft');
    expect(capturedUpdateData.content).toBe('First draft');
  });

  test('revert creates a new revision with target content', async () => {
    const revisions = [
      { id: 'rev_a', noteId: 'note_r2', content: 'Alpha content', message: null, createdAt: new Date('2026-02-01') },
      { id: 'rev_b', noteId: 'note_r2', content: 'Beta content', message: 'update', createdAt: new Date('2026-02-02') },
    ];

    const { targetRevision } = await setupAndRevert({
      userId: 'user_revert002',
      slug: 'revert-test-2',
      noteId: 'note_r2',
      revisions,
      targetIndex: 0,
      authContext: {},
    });

    expect(createdRevisions.length).toBeGreaterThanOrEqual(1);
    const revertRev = createdRevisions[createdRevisions.length - 1];
    expect(revertRev.content).toBe('Alpha content');
  });

  test('revert revision message references the target revision ID', async () => {
    const revisions = [
      { id: 'rev_msg_0', noteId: 'note_r3', content: 'Original', message: null, createdAt: new Date('2026-03-01') },
      { id: 'rev_msg_1', noteId: 'note_r3', content: 'Changed', message: 'edit', createdAt: new Date('2026-03-02') },
    ];

    await setupAndRevert({
      userId: 'user_revert003',
      slug: 'revert-test-3',
      noteId: 'note_r3',
      revisions,
      targetIndex: 0,
      authContext: {},
    });

    const revertRev = createdRevisions[createdRevisions.length - 1];
    expect(revertRev.message).toBe('Reverted to revision rev_msg_0');
  });

  test('revert to middle revision of 5 preserves that revision content', async () => {
    const revisions = [
      { id: 'rev_m0', noteId: 'note_r4', content: 'Version 1', message: null, createdAt: new Date('2026-04-01') },
      { id: 'rev_m1', noteId: 'note_r4', content: 'Version 2', message: 'edit 1', createdAt: new Date('2026-04-02') },
      { id: 'rev_m2', noteId: 'note_r4', content: 'Version 3', message: 'edit 2', createdAt: new Date('2026-04-03') },
      { id: 'rev_m3', noteId: 'note_r4', content: 'Version 4', message: 'edit 3', createdAt: new Date('2026-04-04') },
      { id: 'rev_m4', noteId: 'note_r4', content: 'Version 5', message: 'edit 4', createdAt: new Date('2026-04-05') },
    ];

    const { result, capturedUpdateData } = await setupAndRevert({
      userId: 'user_revert004',
      slug: 'revert-test-4',
      noteId: 'note_r4',
      revisions,
      targetIndex: 2,
      authContext: { authType: 'jwt' },
    });

    expect(result.content).toBe('Version 3');
    expect(capturedUpdateData.content).toBe('Version 3');

    const revertRev = createdRevisions[createdRevisions.length - 1];
    expect(revertRev.content).toBe('Version 3');
    expect(revertRev.message).toBe('Reverted to revision rev_m2');
  });

  test('revert with apikey auth context passes identity to revert revision', async () => {
    const revisions = [
      { id: 'rev_auth0', noteId: 'note_r5', content: 'Auth test v1', message: null, createdAt: new Date('2026-05-01') },
      { id: 'rev_auth1', noteId: 'note_r5', content: 'Auth test v2', message: 'edit', createdAt: new Date('2026-05-02') },
    ];

    await setupAndRevert({
      userId: 'user_revert005',
      slug: 'revert-test-5',
      noteId: 'note_r5',
      revisions,
      targetIndex: 0,
      authContext: { authType: 'apikey', apiKeyId: 'key_revert_agent', apiKeyName: 'revert-bot' },
    });

    const revertRev = createdRevisions[createdRevisions.length - 1];
    expect(revertRev.authType).toBe('apikey');
    expect(revertRev.apiKeyId).toBe('key_revert_agent');
    expect(revertRev.apiKeyName).toBe('revert-bot');
  });

  test('revert with empty auth context does not set auth fields', async () => {
    const revisions = [
      { id: 'rev_noauth0', noteId: 'note_r6', content: 'No auth v1', message: null, createdAt: new Date('2026-06-01') },
      { id: 'rev_noauth1', noteId: 'note_r6', content: 'No auth v2', message: 'edit', createdAt: new Date('2026-06-02') },
    ];

    await setupAndRevert({
      userId: 'user_revert006',
      slug: 'revert-test-6',
      noteId: 'note_r6',
      revisions,
      targetIndex: 0,
      authContext: {},
    });

    const revertRev = createdRevisions[createdRevisions.length - 1];
    expect(revertRev.content).toBe('No auth v1');
    expect(revertRev.authType).toBeUndefined();
    expect(revertRev.apiKeyId).toBeUndefined();
    expect(revertRev.apiKeyName).toBeUndefined();
  });

  test('revert to second-to-last revision with long content preserves it exactly', async () => {
    const longContent = 'A'.repeat(500) + '\n\nSome markdown **bold** and [links](http://example.com)';
    const revisions = [
      { id: 'rev_long0', noteId: 'note_r7', content: 'Short', message: null, createdAt: new Date('2026-07-01') },
      { id: 'rev_long1', noteId: 'note_r7', content: longContent, message: 'added long content', createdAt: new Date('2026-07-02') },
      { id: 'rev_long2', noteId: 'note_r7', content: 'Replaced with short', message: 'trimmed', createdAt: new Date('2026-07-03') },
    ];

    const { result } = await setupAndRevert({
      userId: 'user_revert007',
      slug: 'revert-test-7',
      noteId: 'note_r7',
      revisions,
      targetIndex: 1,
      authContext: {},
    });

    expect(result.content).toBe(longContent);
    const revertRev = createdRevisions[createdRevisions.length - 1];
    expect(revertRev.content).toBe(longContent);
    expect(revertRev.message).toBe('Reverted to revision rev_long1');
  });
});
