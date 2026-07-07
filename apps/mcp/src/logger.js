/**
 * Structured JSON logger.
 * Outputs one JSON object per line to STDERR.
 * STDOUT is reserved for stdio protocol frames.
 *
 * @param {'info' | 'warn' | 'error' | 'debug'} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
import { withTraceContext } from '@mycelium/shared/logger-otel';

export function log(level, message, meta = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
  const record = withTraceContext(entry, 'mycelium-mcp');
  console.error(JSON.stringify(record));
}
