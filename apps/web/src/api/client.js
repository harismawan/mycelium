/**
 * Fetch wrapper for Mycelium API calls.
 *
 * All requests include `credentials: 'include'` so the httpOnly JWT cookie
 * is sent automatically. Every request sends an `x-request-id` header
 * generated client-side for end-to-end tracing. Non-ok responses throw
 * an `ApiError`.
 */

const BASE = '/api/v1';

/**
 * @typedef {object} ApiError
 * @property {number} status
 * @property {string} message
 * @property {string} [requestId]
 */

/**
 * Generate a client-side request ID (UUID v4).
 * @returns {string}
 */
function generateRequestId() {
  return crypto.randomUUID();
}

/**
 * Throw a structured error for non-ok responses.
 * @param {Response} res
 * @returns {Promise<never>}
 */
async function handleError(res) {
  let message = res.statusText;
  try {
    const body = await res.json();
    if (body.error) message = body.error;
  } catch {
    // body wasn't JSON — keep statusText
  }
  const err = new Error(message);
  /** @type {any} */ (err).status = res.status;
  /** @type {any} */ (err).requestId = res.headers.get('x-request-id');
  throw err;
}

/**
 * GET request.
 * @param {string} path — path relative to `/api/v1`, e.g. `'/notes'`
 * @returns {Promise<any>}
 */
export async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-request-id': generateRequestId() },
    credentials: 'include',
  });
  if (!res.ok) return handleError(res);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/markdown')) return res.text();
  return res.json();
}

/**
 * POST request.
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<any>}
 */
export async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': generateRequestId(),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) return handleError(res);
  return res.json();
}

/**
 * PATCH request.
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<any>}
 */
export async function apiPatch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': generateRequestId(),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) return handleError(res);
  return res.json();
}

/**
 * DELETE request.
 * @param {string} path
 * @returns {Promise<any>}
 */
export async function apiDelete(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'x-request-id': generateRequestId() },
    credentials: 'include',
  });
  if (!res.ok) return handleError(res);
  return res.json();
}
