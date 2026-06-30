import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

// ---------------------------------------------------------------------------
// Mock the auth/csrf middleware (inject a user via a scoped derive; csrf is a
// no-op for GET) and the LinkService, before importing the routes.
// ---------------------------------------------------------------------------
const mockGetGraph = mock(async () => ({ nodes: [], edges: [], truncated: false }));

mock.module('../../src/middleware/auth.js', () => ({
  authMiddleware: new Elysia({ name: 'auth-mock' }).derive({ as: 'scoped' }, () => ({
    user: { id: 'user_1' },
  })),
}));
mock.module('../../src/middleware/csrf.js', () => ({
  csrfMiddleware: new Elysia({ name: 'csrf-mock' }),
}));
mock.module('../../src/services/link.service.js', () => ({
  LinkService: { getGraph: mockGetGraph },
}));

const { graphRoutes } = await import('../../src/routes/graph.routes.js');

function buildApp() {
  return new Elysia().use(graphRoutes);
}

beforeEach(() => {
  mockGetGraph.mockReset();
  mockGetGraph.mockResolvedValue({ nodes: [], edges: [], truncated: false });
});

describe('Graph Routes — depth hardening', () => {
  /** Validates: R5 — non-numeric depth rejected at the edge */
  test('rejects non-numeric depth with 422', async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/graph/some-note?depth=abc'),
    );
    expect(res.status).toBe(422);
    expect(mockGetGraph).not.toHaveBeenCalled();
  });

  /** Validates: R5 — zero/negative depth rejected */
  test('rejects zero depth with 422', async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/graph/some-note?depth=0'),
    );
    expect(res.status).toBe(422);
  });

  /** Validates: R5 — valid integer depth forwarded to the service */
  test('accepts a valid integer depth and forwards it', async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/v1/graph/some-note?depth=3'),
    );
    expect(res.status).toBe(200);
    expect(mockGetGraph).toHaveBeenCalledWith('user_1', { slug: 'some-note', depth: 3 });
  });
});

describe('Graph Routes — truncated field', () => {
  /** Validates: R5 — full-graph path with truncated:true still validates */
  test('full-graph path returns truncated without failing response validation', async () => {
    mockGetGraph.mockResolvedValue({ nodes: [], edges: [], truncated: true });
    const app = buildApp();
    const res = await app.handle(new Request('http://localhost/api/v1/graph'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
  });
});
