/**
 * Adds trace.id / span.id / service.name to log records without changing the
 * rest of the log schema. Dotted keys flatten in Elasticsearch into the indexed
 * fields the APM UI queries (trace.id, span.id).
 */
import { trace } from '@opentelemetry/api';

const ZERO_TRACE_ID = '00000000000000000000000000000000';

function activeContext() {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  if (!ctx?.traceId || ctx.traceId === ZERO_TRACE_ID) return null;
  return { 'trace.id': ctx.traceId, 'span.id': ctx.spanId };
}

/**
 * pino `mixin` — called per log record. Adds correlation fields.
 * @param {string} serviceName
 * @returns {() => Record<string, unknown>}
 */
export function traceContextMixin(serviceName) {
  return function mixin() {
    const ctx = activeContext();
    return ctx ? { ...ctx, 'service.name': serviceName } : { 'service.name': serviceName };
  };
}

/**
 * Imperative helper for non-pino loggers (MCP stderr).
 * @template {Record<string, unknown>} T
 * @param {T} fields
 * @param {string} serviceName
 * @returns {T & { 'service.name': string, 'trace.id'?: string, 'span.id'?: string }}
 */
export function withTraceContext(fields, serviceName) {
  const ctx = activeContext();
  return { ...fields, 'service.name': serviceName, ...(ctx ?? {}) };
}
