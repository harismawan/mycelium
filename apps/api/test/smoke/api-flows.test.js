import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Mock setup — must happen before any import that touches Prisma / bcrypt / jwt
// ---------------------------------------------------------------------------
const mockUser = {
  findUnique: mock(() => null),
  create: mock(() => ({})),
};
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
const mockApiKey = {
  findUnique: mock(() => null),
  update: mock(() => ({})),
};

const mockTransaction = mock(async (cb) =>
  cb({ note: mockNote, link: mockLink, tag: mockTag, revision: mockRevision }),
);

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.user = mockUser;
      this.note = mockNote;
      this.link = mockLink;
      this.tag = mockTag;
      this.revision = mockRevision;
      this.apiKey = mockApiKey;
      this.$transaction = mockTransaction;
    }
  },
}));

const mockBcrypt = {
  hash: mock((pw) => Promise.resolve(`hashed_${pw}`)),
  compare: mock((plain, hashed) => Promise.resolve(hashed === `hashed_${plain}`)),
};
mock.module('bcryptjs', () => ({ default: mockBcrypt }));

const mockJwt = {
  sign: mock((payload) => `token_${payload.sub}`),
  verify: mock((token) => {
    if (token.startsWith('token_')) {
      return { sub: token.replace('token_', ''), email: 'smoke@example.com' };
    }
    throw new Error('invalid token');
  }),
};
mock.module('jsonwebtoken', () => ({ default: mockJwt }));

// ---------------------------------------------------------------------------
// Import services AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { AuthService } = await import('../../src/services/auth.service.js');
const { NoteService } = await import('../../src/services/note.service.js');
const { LinkService } = await import('../../src/services/link.service.js');
const { AgentService } = await import('../../src/services/agent.service.js');

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const now = new Date();
const userId = 'user_smoke';

const registeredUser = {
  id: userId,
  email: 'smoke@example.com',
  displayName: 'Smoke Tester',
  createdAt: now,
  updatedAt: now,
};

const baseNote = {
  id: 'note_smoke_1',
  slug: 'smoke-note',
  title: 'Smoke Note',
  content: '---\ntags: [smoke]\n---\nSmoke test body',
  frontmatter: { tags: ['smoke'] },
  excerpt: 'Smoke test body',
  status: 'DRAFT',
  pinned: false,
  userId,
  createdAt: now,
  updatedAt: now,
  tags: [{ id: 'tag_s1', name: 'smoke' }],
  revisions: [{ id: 'rev_s1', content: '---\ntags: [smoke]\n---\nSmoke test body', createdAt: now }],
};

// ---------------------------------------------------------------------------
// Reset all mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  for (const m of [mockUser, mockNote, mockLink, mockTag, mockRevision, mockApiKey]) {
    for (const fn of Object.values(m)) {
      if (typeof fn.mockReset === 'function') fn.mockReset();
    }
  }
  mockTransaction.mockReset();
  mockBcrypt.hash.mockReset();
  mockBcrypt.compare.mockReset();
  mockJwt.sign.mockReset();
  mockJwt.verify.mockReset();

  // Restore default implementations
  mockTransaction.mockImplementation(async (cb) =>
    cb({ note: mockNote, link: mockLink, tag: mockTag, revision: mockRevision }),
  );
  mockBcrypt.hash.mockImplementation((pw) => Promise.resolve(`hashed_${pw}`));
  mockBcrypt.compare.mockImplementation((plain, hashed) =>
    Promise.resolve(hashed === `hashed_${plain}`),
  );
  mockJwt.sign.mockImplementation((payload) => `token_${payload.sub}`);
  mockJwt.verify.mockImplementation((token) => {
    if (token.startsWith('token_')) {
      return { sub: token.replace('token_', ''), email: 'smoke@example.com' };
    }
    throw new Error('invalid token');
  });

  // Sensible defaults
  mockNote.findMany.mockResolvedValue([]);
  mockLink.findMany.mockResolvedValue([]);
  mockLink.updateMany.mockResolvedValue({ count: 0 });
});

// ---------------------------------------------------------------------------
// 1. Auth flow: register → login → verify JWT
//    Validates: Requirements 5.1, 5.7
// ---------------------------------------------------------------------------
describe('Smoke: Auth flow (register → login → verify JWT)', () => {
  test('register returns user without password', async () => {
    mockUser.findUnique.mockResolvedValue(null);
    mockUser.create.mockResolvedValue(registeredUser);

    const user = await AuthService.register('smoke@example.com', 'password123', 'Smoke Tester');

    expect(user.id).toBe(userId);
    expect(user.email).toBe('smoke@example.com');
    expect(user).not.toHaveProperty('password');
    expect(mockBcrypt.hash).toHaveBeenCalledWith('password123', 10);
  });

  test('login with same credentials returns JWT token', async () => {
    const storedUser = { ...registeredUser, password: 'hashed_password123' };
    mockUser.findUnique.mockResolvedValue(storedUser);

    const result = await AuthService.login('smoke@example.com', 'password123');

    expect(result.token).toBe(`token_${userId}`);
    expect(result.user.id).toBe(userId);
    expect(result.user).not.toHaveProperty('password');
  });

  test('verifyJwt with issued token returns the user', async () => {
    mockUser.findUnique.mockResolvedValue(registeredUser);

    const user = await AuthService.verifyJwt(`token_${userId}`);

    expect(user).not.toBeNull();
    expect(user.id).toBe(userId);
    expect(user.email).toBe('smoke@example.com');
  });
});

// ---------------------------------------------------------------------------
// 2. Note CRUD flow: create → read → update → archive
//    Validates: Requirements 5.1, 5.7
// ---------------------------------------------------------------------------
describe('Smoke: Note CRUD flow (create → read → update → archive)', () => {
  test('createNote returns note with slug, excerpt, and revision', async () => {
    mockNote.create.mockResolvedValue(baseNote);
    mockNote.findMany.mockResolvedValue([]);

    const note = await NoteService.createNote(userId, {
      title: 'Smoke Note',
      content: '---\ntags: [smoke]\n---\nSmoke test body',
      tags: ['smoke'],
    });

    expect(note.id).toBe('note_smoke_1');
    expect(note.slug).toBe('smoke-note');
    expect(note.excerpt).toBe('Smoke test body');
    expect(note.revisions).toHaveLength(1);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  test('getNote returns the created note', async () => {
    mockNote.findFirst.mockResolvedValue(baseNote);

    const note = await NoteService.getNote(userId, 'smoke-note');

    expect(note).not.toBeNull();
    expect(note.slug).toBe('smoke-note');
    expect(note.title).toBe('Smoke Note');
  });

  test('updateNote returns updated fields', async () => {
    mockNote.findFirst.mockResolvedValue(baseNote);
    const updatedNote = {
      ...baseNote,
      title: 'Updated Smoke Note',
      slug: 'updated-smoke-note',
      content: '---\ntags: [smoke]\n---\nUpdated body',
      excerpt: 'Updated body',
    };
    mockNote.update.mockResolvedValue(updatedNote);
    mockNote.findMany.mockResolvedValue([]); // no slug collisions

    const note = await NoteService.updateNote(userId, 'smoke-note', {
      title: 'Updated Smoke Note',
      content: '---\ntags: [smoke]\n---\nUpdated body',
    });

    expect(note.title).toBe('Updated Smoke Note');
    expect(note.excerpt).toBe('Updated body');
    expect(mockTransaction).toHaveBeenCalled();
  });

  test('archiveNote sets status to ARCHIVED', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_smoke_1' });
    mockNote.update.mockResolvedValue({});

    await NoteService.archiveNote(userId, 'smoke-note');

    expect(mockNote.update).toHaveBeenCalledWith({
      where: { id: 'note_smoke_1' },
      data: { status: 'ARCHIVED' },
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Wikilink / backlink reconciliation flow
//    Validates: Requirements 2.1, 2.5
// ---------------------------------------------------------------------------
describe('Smoke: Wikilink/backlink reconciliation flow', () => {
  test('creating a note with wikilinks produces Link records', async () => {
    const content = 'See [[Target Note]] and [[Missing Note]]';
    mockNote.create.mockResolvedValue({
      ...baseNote,
      id: 'note_src',
      content,
    });
    mockNote.findMany.mockResolvedValue([]); // no slug collisions
    mockLink.findMany.mockResolvedValue([]); // no existing links

    // First wikilink target found, second not found
    mockNote.findFirst
      .mockResolvedValueOnce({ id: 'note_target' }) // "Target Note" resolved
      .mockResolvedValueOnce(null);                   // "Missing Note" unresolved

    await NoteService.createNote(userId, { title: 'Source Note', content });

    // Two link.create calls for the two wikilinks
    expect(mockLink.create).toHaveBeenCalledTimes(2);

    const link1 = mockLink.create.mock.calls[0][0];
    expect(link1.data.toId).toBe('note_target');
    expect(link1.data.toTitle).toBeNull();

    const link2 = mockLink.create.mock.calls[1][0];
    expect(link2.data.toId).toBeNull();
    expect(link2.data.toTitle).toBe('Missing Note');
  });

  test('creating target note resolves unresolved links', async () => {
    mockNote.create.mockResolvedValue({
      ...baseNote,
      id: 'note_target_new',
      title: 'Missing Note',
    });
    mockNote.findMany.mockResolvedValue([]);
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 1 });

    await NoteService.createNote(userId, {
      title: 'Missing Note',
      content: 'Now I exist',
    });

    // resolveUnresolvedLinks should have been called
    expect(mockLink.updateMany).toHaveBeenCalled();
    const call = mockLink.updateMany.mock.calls[0][0];
    expect(call.where.toId).toBeNull();
    expect(call.where.toTitle).toBe('Missing Note');
    expect(call.data.toId).toBe('note_target_new');
    expect(call.data.toTitle).toBeNull();
  });

  test('getBacklinks returns notes linking to a given note', async () => {
    mockLink.findMany.mockResolvedValue([
      { fromId: 'note_a' },
      { fromId: 'note_b' },
    ]);
    mockNote.findMany.mockResolvedValue([
      { id: 'note_a', slug: 'a', title: 'Note A', tags: [] },
      { id: 'note_b', slug: 'b', title: 'Note B', tags: [] },
    ]);

    const backlinks = await LinkService.getBacklinks('note_target');

    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((n) => n.id).sort()).toEqual(['note_a', 'note_b']);
  });
});

// ---------------------------------------------------------------------------
// 4. Agent bundle NDJSON streaming
//    Validates: Requirements 10.2
// ---------------------------------------------------------------------------
describe('Smoke: Agent bundle NDJSON streaming', () => {
  const publishedNotes = [
    {
      id: 'note_p1',
      slug: 'published-one',
      title: 'Published One',
      content: '# One\nBody one',
      excerpt: 'Body one',
      frontmatter: null,
      tags: [{ name: 'alpha' }],
      updatedAt: now,
    },
    {
      id: 'note_p2',
      slug: 'published-two',
      title: 'Published Two',
      content: '# Two\nBody two',
      excerpt: 'Body two',
      frontmatter: { key: 'val' },
      tags: [{ name: 'beta' }, { name: 'gamma' }],
      updatedAt: now,
    },
  ];

  test('streamBundle returns a ReadableStream of valid NDJSON lines', async () => {
    mockNote.findMany
      .mockResolvedValueOnce(publishedNotes)
      .mockResolvedValueOnce([]); // end stream

    const stream = AgentService.streamBundle(userId);
    expect(stream).toBeInstanceOf(ReadableStream);

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
      expect(parsed).toHaveProperty('tags');
      expect(parsed).toHaveProperty('updatedAt');
    }

    // Verify tag flattening
    const first = JSON.parse(lines[0]);
    expect(first.tags).toEqual(['alpha']);

    const second = JSON.parse(lines[1]);
    expect(second.tags).toEqual(['beta', 'gamma']);
  });

  test('streamBundle produces empty output when no published notes', async () => {
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
