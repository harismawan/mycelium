import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

// Mock crypto.randomUUID before importing the client
const MOCK_REQUEST_ID = '00000000-0000-0000-0000-000000000001';
globalThis.crypto = /** @type {any} */ ({
  ...globalThis.crypto,
  randomUUID: () => MOCK_REQUEST_ID,
});

// Mock document.cookie for CSRF token reading
globalThis.document = /** @type {any} */ ({
  cookie: 'csrf=test-csrf-token',
});

const { apiGet, apiPost, apiPatch, apiDelete } = await import('../../src/api/client.js');

/** @type {ReturnType<typeof mock>} */
let fetchMock;

beforeEach(() => {
  fetchMock = mock();
  globalThis.fetch = /** @type {any} */ (fetchMock);
  // Reset document.cookie to include CSRF token
  /** @type {any} */ (globalThis.document).cookie = 'csrf=test-csrf-token';
});

afterEach(() => {
  // @ts-ignore
  delete globalThis.fetch;
});

/**
 * Helper to create a mock Response.
 * @param {number} status
 * @param {any} body
 * @param {Record<string, string>} [headers]
 */
function mockResponse(status, body, headers = {}) {
  const h = new Headers({ 'content-type': 'application/json', ...headers });
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: h,
    json: mock(() => Promise.resolve(body)),
    text: mock(() => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))),
  };
}

describe('apiGet', () => {
  test('sends GET with credentials and returns JSON', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { id: '1' }));

    const result = await apiGet('/notes');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/notes', {
      headers: { 'x-request-id': MOCK_REQUEST_ID },
      credentials: 'include',
    });
    expect(result).toEqual({ id: '1' });
  });

  test('returns text for markdown content-type', async () => {
    const res = mockResponse(200, '# Hello', { 'content-type': 'text/markdown; charset=utf-8' });
    fetchMock.mockResolvedValue(res);

    const result = await apiGet('/notes/hello?format=md');

    expect(result).toBe('# Hello');
  });

  test('throws on non-ok response with error message from body', async () => {
    fetchMock.mockResolvedValue(mockResponse(404, { error: 'Note not found' }));

    try {
      await apiGet('/notes/missing');
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(/** @type {any} */ (err).status).toBe(404);
      expect(/** @type {any} */ (err).message).toBe('Note not found');
    }
  });
});

describe('apiGet — no CSRF header', () => {
  test('GET requests do not include x-csrf-token header', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { id: '1' }));

    await apiGet('/notes');

    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['x-csrf-token']).toBeUndefined();
  });
});

describe('apiPost', () => {
  test('sends POST with JSON body and credentials', async () => {
    const body = { title: 'Test', content: '# Test' };
    fetchMock.mockResolvedValue(mockResponse(201, { id: '1', ...body }));

    const result = await apiPost('/notes', body);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': MOCK_REQUEST_ID,
        'x-csrf-token': 'test-csrf-token',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    expect(result.title).toBe('Test');
  });

  test('throws on validation error', async () => {
    fetchMock.mockResolvedValue(mockResponse(400, { error: 'Validation failed' }));

    try {
      await apiPost('/notes', {});
      expect(true).toBe(false);
    } catch (err) {
      expect(/** @type {any} */ (err).status).toBe(400);
    }
  });
});

describe('apiPatch', () => {
  test('sends PATCH with JSON body and credentials', async () => {
    const body = { title: 'Updated' };
    fetchMock.mockResolvedValue(mockResponse(200, { id: '1', title: 'Updated' }));

    const result = await apiPatch('/notes/test', body);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/notes/test', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': MOCK_REQUEST_ID,
        'x-csrf-token': 'test-csrf-token',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    expect(result.title).toBe('Updated');
  });
});

describe('apiDelete', () => {
  test('sends DELETE with credentials', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { message: 'Note archived' }));

    const result = await apiDelete('/notes/test');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/notes/test', {
      method: 'DELETE',
      headers: {
        'x-request-id': MOCK_REQUEST_ID,
        'x-csrf-token': 'test-csrf-token',
      },
      credentials: 'include',
    });
    expect(result.message).toBe('Note archived');
  });
});
