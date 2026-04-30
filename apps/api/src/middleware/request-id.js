/**
 * Request ID middleware plugin for Elysia.
 *
 * Assigns a unique identifier to every incoming request. If the client sends
 * a valid `X-Request-ID` header the value is reused; otherwise a UUID v4 is
 * generated via `crypto.randomUUID()`.
 *
 * The request ID is:
 * - Derived onto the Elysia context as `ctx.requestId` (global scope)
 * - Returned to the client in the `X-Request-ID` response header
 *
 * @module request-id
 */
import Elysia from 'elysia';
import crypto from 'node:crypto';

/** Validation pattern for incoming X-Request-ID values. */
export const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Validate an incoming X-Request-ID header value.
 *
 * @param {string | null | undefined} value
 * @returns {boolean} `true` if the value is a non-null string matching the pattern.
 */
export function isValidRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/**
 * Generate a new request ID (UUID v4).
 *
 * @returns {string}
 */
export function generateRequestId() {
  return crypto.randomUUID();
}

/**
 * Elysia plugin that assigns a request ID to every request.
 * Must be registered before all other middleware.
 */
export const requestIdMiddleware = new Elysia({ name: 'request-id' })
  .derive({ as: 'global' }, (ctx) => {
    const incoming = ctx.request.headers.get('x-request-id');
    const requestId = isValidRequestId(incoming) ? incoming : generateRequestId();

    ctx.set.headers['x-request-id'] = requestId;

    return { requestId };
  });
