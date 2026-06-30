import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  activityLog: { create: mock(() => ({})) },
};
const mockNoteService = {
  upsertMemory: mock(() => ({})),
};

mock.module('../../src/db.js', () => ({ prisma: mockPrisma }));
mock.module('@mycelium/api/services/note.service.js', () => ({
  NoteService: mockNoteService,
}));

const { register } = await import('../../src/tools/remember.js');

function createMockServer() {
  const tools = new Map();
  return {
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler });
    },
    getHandler(name) {
      return tools.get(name)?.handler;
    },
    getSchema(name) {
      return tools.get(name)?.schema;
    },
  };
}

describe('remember', () => {
  let handler;
  const auth = { userId: 'u1', scopes: ['notes:write'], apiKeyId: 'k1', apiKeyName: 'cli' };

  beforeEach(() => {
    mockPrisma.activityLog.create.mockReset();
    mockNoteService.upsertMemory.mockReset();

    const server = createMockServer();
    register(server, auth);
    handler = server.getHandler('remember');
  });

  test('delegates to NoteService.upsertMemory and returns its result verbatim', async () => {
    mockNoteService.upsertMemory.mockImplementation(() => ({
      id: 'n1',
      slug: 'api-auth-decision',
      action: 'updated',
      excerpt: 'the body',
    }));

    const result = await handler({ title: 'API Auth Decision', content: 'rotate keys', mode: 'append' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ id: 'n1', slug: 'api-auth-decision', action: 'updated', excerpt: 'the body' });

    const [uid, payload] = mockNoteService.upsertMemory.mock.calls[0];
    expect(uid).toBe('u1');
    expect(payload.title).toBe('API Auth Decision');
    expect(payload.content).toBe('rotate keys');
    expect(payload.mode).toBe('append');
    expect(payload.apiKeyId).toBe('k1');
    expect(payload.authType).toBe('apikey');
  });

  test('forwards the new mode verbatim', async () => {
    mockNoteService.upsertMemory.mockImplementation(() => ({ id: 'n2', slug: 's', action: 'created', excerpt: 'e' }));

    await handler({ title: 'T', content: 'c', mode: 'new' });

    expect(mockNoteService.upsertMemory.mock.calls[0][1].mode).toBe('new');
  });

  test('rejects without notes:write scope', async () => {
    const server = createMockServer();
    register(server, { userId: 'u1', scopes: ['agent:read'] });
    const noScope = server.getHandler('remember');

    const result = await noScope({ title: 'T', content: 'c' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('Insufficient permissions');
  });

  test('returns a retryable error envelope when the service throws', async () => {
    mockNoteService.upsertMemory.mockImplementation(() => {
      throw new Error('DB down');
    });

    const result = await handler({ title: 'T', content: 'c' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('Database error');
    expect(parsed.isRetryable).toBe(true);
  });

  test('exposes mode as an optional append/replace/new enum and requires a title', () => {
    const server = createMockServer();
    register(server, auth);
    const schema = server.getSchema('remember');

    expect(schema.mode.safeParse('append').success).toBe(true);
    expect(schema.mode.safeParse('replace').success).toBe(true);
    expect(schema.mode.safeParse('new').success).toBe(true);
    expect(schema.mode.safeParse('delete').success).toBe(false);
    expect(schema.mode.safeParse(undefined).success).toBe(true);
    expect(schema.title.safeParse('').success).toBe(false);
  });
});
