import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

const { embedText } = await import('../../src/services/embedding.service.js');

/** A well-formed 1024-dim response body. */
function okBody(dim = 1024) {
  return { data: [{ embedding: Array.from({ length: dim }, () => 0.01) }] };
}

let fetchMock;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.EMBEDDING_PROVIDER = 'openai';
  process.env.EMBEDDING_API_KEY = 'sk-test';
  fetchMock = mock(async () => ({ ok: true, json: async () => okBody() }));
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
});

describe('embedText', () => {
  test('returns null and never calls fetch when EMBEDDING_PROVIDER is unset', async () => {
    delete process.env.EMBEDDING_PROVIDER;
    const out = await embedText('hello world');
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns null for empty / whitespace input without calling fetch', async () => {
    expect(await embedText('')).toBeNull();
    expect(await embedText('   ')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns the embedding vector on a valid response', async () => {
    const out = await embedText('semantic memory');
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1024);
    expect(out[0]).toBe(0.01);
  });

  test('sends model, dimensions and bearer auth in the request', async () => {
    process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    await embedText('payload');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.dimensions).toBe(1024);
    expect(body.input).toBe('payload');
  });

  test('returns null on a non-200 response', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    expect(await embedText('x')).toBeNull();
  });

  test('returns null when the vector dimension does not match', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => okBody(512) }));
    expect(await embedText('x')).toBeNull();
  });

  test('returns null when fetch throws (network failure)', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    expect(await embedText('x')).toBeNull();
  });
});
