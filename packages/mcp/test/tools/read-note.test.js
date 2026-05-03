import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  note: {
    findFirst: mock(() => null),
  },
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) => t.toLowerCase().replace(/\s+/g, '-'),
  serializeFrontmatter: (fm, content) => `---\ntitle: ${fm.title}\nstatus: ${fm.status}\ntags: [${fm.tags.join(', ')}]\n---\n${content}`,
}));

const { register } = await import('../../src/tools/read-note.js');

function createMockServer() {
  const tools = new Map();
  return {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
    getHandler(name) {
      return tools.get(name)?.handler;
    },
  };
}

describe('read_note', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockPrisma.note.findFirst.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('read_note');
  });

  test('returns JSON format with correct fields', async () => {
    const now = new Date();
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1',
      slug: 'hello-world',
      title: 'Hello World',
      content: '# Hello\nWorld',
      excerpt: 'Hello World',
      status: 'PUBLISHED',
      tags: [{ name: 'greeting' }],
      updatedAt: now,
    }));

    const result = await handler({ slug: 'hello-world', format: 'json' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('n1');
    expect(parsed.slug).toBe('hello-world');
    expect(parsed.title).toBe('Hello World');
    expect(parsed.content).toBe('# Hello\nWorld');
    expect(parsed.excerpt).toBe('Hello World');
    expect(parsed.status).toBe('PUBLISHED');
    expect(parsed.tags).toEqual(['greeting']);
    expect(parsed.updatedAt).toBe(now.toISOString());
  });

  test('returns markdown format with frontmatter', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1',
      slug: 'hello-world',
      title: 'Hello World',
      content: '# Hello\nWorld',
      excerpt: 'Hello World',
      status: 'PUBLISHED',
      tags: [{ name: 'greeting' }],
      updatedAt: new Date(),
    }));

    const result = await handler({ slug: 'hello-world', format: 'markdown' });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('title: Hello World');
    expect(text).toContain('# Hello\nWorld');
  });

  test('returns isError for not-found note', async () => {
    mockPrisma.note.findFirst.mockImplementation(() => null);

    const result = await handler({ slug: 'nonexistent', format: 'json' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Note not found');
    expect(parsed.slug).toBe('nonexistent');
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('read_note');

    const result = await noScopeHandler({ slug: 'test', format: 'json' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });
});
