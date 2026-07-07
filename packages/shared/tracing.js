/**
 * Generic OpenTelemetry span helper for tracing arbitrary app-level operations
 * (service-method calls, business workflows). When OTEL_ENABLED !== 'true' the
 * function is invoked directly with a no-op span shim, so callers never pay
 * tracing overhead in test or non-instrumented environments.
 */
import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('mycelium-shared/app');

/** @type {any} */
const noopSpan = {
  setAttribute() {},
  setAttributes() {},
  recordException() {},
  setStatus() {},
  end() {},
};

/**
 * Execute `fn` inside an active OTel span named `name`.
 * @template T
 * @param {string} name
 * @param {Record<string, unknown>} attrs
 * @param {(span: import('@opentelemetry/api').Span) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function traceFn(name, attrs, fn) {
  if (process.env.OTEL_ENABLED !== 'true') return fn(noopSpan);
  return tracer.startActiveSpan(name, async (span) => {
    if (attrs) span.setAttributes(/** @type {any} */ (attrs));
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Wrap each method on `methods` so every call emits a span named
 * `${prefix}.${methodName}`. Non-function values pass through untouched.
 * `this` inside wrapped methods refers to the wrapped object so intra-service
 * calls continue to trace.
 * @template {Record<string, any>} T
 * @param {string} prefix
 * @param {T} methods
 * @returns {T}
 */
export function tracedService(prefix, methods) {
  /** @type {any} */
  const wrapped = {};
  for (const [key, value] of Object.entries(methods)) {
    if (typeof value !== 'function') {
      wrapped[key] = value;
      continue;
    }
    const spanName = `${prefix}.${key}`;
    wrapped[key] = function tracedMethod(...args) {
      return traceFn(spanName, {}, () => value.apply(wrapped, args));
    };
  }
  return wrapped;
}
