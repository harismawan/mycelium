/**
 * Structured JSON logger.
 * Outputs one JSON object per line to stdout.
 *
 * @param {'info' | 'warn' | 'error' | 'debug'} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
export function log(level, message, meta = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
  console.log(JSON.stringify(entry));
}
