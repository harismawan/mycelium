import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  note: {
    findFirst: mock(() => null),
    findMany: mock(() => []),
  },
  link: {
    findMany: mock(() => []),
  },
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/shared', () => ({
  DEFAULT_PAGE_LIMIT: 20,
  generateExcerpt: (c) => c?.slice(0, 100) ?? '',
  extractWikilinks: () => [],
  slugify: (t) => t.toLowerCase().replace(/\s+/g, '-'),
  serializeFrontmatter: (fm, content) => `---\n---\n${content}`,
}));

const { register } = await import('../../src/tools/get-graph.js');

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

describe('get_graph', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['agent:read'] };

  beforeEach(() => {
    mockPrisma.note.findFirst.mockReset();
    mockPrisma.note.findMany.mockReset();
    mockPrisma.link.findMany.mockReset();
    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('get_graph');
  });

  test('returns full graph with nodes and edges', async () => {
    mockPrisma.note.findMany.mockImplementationOnce(() => [
      { id: 'n1', slug: 'note-1', title: 'Note 1', status: 'PUBLISHED' },
      { id: 'n2', slug: 'note-2', title: 'Note 2', status: 'DRAFT' },
    ]);
    mockPrisma.link.findMany.mockImplementationOnce(() => [
      { fromId: 'n1', toId: 'n2', relation: null },
    ]);

    const result = await handler({ slug: undefined, depth: 1 });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.nodes[0]).toHaveProperty('id');
    expect(parsed.nodes[0]).toHaveProperty('slug');
    expect(parsed.nodes[0]).toHaveProperty('title');
    expect(parsed.nodes[0]).toHaveProperty('status');
    expect(parsed.edges[0]).toHaveProperty('fromId');
    expect(parsed.edges[0]).toHaveProperty('toId');
    expect(parsed.edges[0]).toHaveProperty('relation');
  });

  test('returns ego-subgraph when slug provided', async () => {
    // findFirst for the start note
    mockPrisma.note.findFirst.mockImplementation(() => ({
      id: 'n1', slug: 'center', title: 'Center', status: 'PUBLISHED',
    }));
    // First call: outgoing links from frontier
    // Second call: incoming links to frontier
    let linkCallCount = 0;
    mockPrisma.link.findMany.mockImplementation(() => {
      linkCallCount++;
      if (linkCallCount === 1) return [{ fromId: 'n1', toId: 'n2', relation: 'related' }];
      return [];
    });
    // Neighbor notes
    mockPrisma.note.findMany.mockImplementation(() => [
      { id: 'n2', slug: 'neighbor', title: 'Neighbor', status: 'PUBLISHED' },
    ]);

    const result = await handler({ slug: 'center', depth: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(1);
    expect(parsed.edges.length).toBeGreaterThanOrEqual(0);
  });

  test('returns empty graph when no notes', async () => {
    mockPrisma.note.findMany.mockImplementation(() => []);

    const result = await handler({ slug: undefined, depth: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });

  test('rejects without agent:read scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: [] });
    const noScopeHandler = server.getHandler('get_graph');

    const result = await noScopeHandler({ depth: 1 });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Insufficient permissions');
  });

  test('handles database error gracefully', async () => {
    mockPrisma.note.findMany.mockImplementation(() => { throw new Error('Connection lost'); });

    const result = await handler({ slug: undefined, depth: 1 });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });
});
