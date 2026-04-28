// @ts-check

/** Max number of keys allowed per session */
const MAX_KEYS = 100;

/** Max value size in bytes (10KB) */
const MAX_VALUE_BYTES = 10 * 1024;

/** @type {Map<string, Map<string, string>>} connectionId → key-value store */
const sessions = new Map();

/**
 * Get (or create) the session store for a connection.
 * @param {string} connectionId
 * @returns {Map<string, string>}
 */
export function getSessionStore(connectionId) {
  if (!sessions.has(connectionId)) sessions.set(connectionId, new Map());
  return /** @type {Map<string, string>} */ (sessions.get(connectionId));
}

/**
 * Destroy the session store for a connection (called on disconnect).
 * @param {string} connectionId
 */
export function destroySession(connectionId) {
  sessions.delete(connectionId);
}

/**
 * Validate that adding/updating a key-value pair won't exceed session limits.
 * @param {Map<string, string>} store - The session store map
 * @param {string} key - The key to set
 * @param {string} value - The value to set
 * @returns {string | null} Error message if limits exceeded, null if OK
 */
export function validateSessionLimits(store, key, value) {
  // Check value size (10KB max)
  const valueBytes = new TextEncoder().encode(value).byteLength;
  if (valueBytes > MAX_VALUE_BYTES) {
    return `Value exceeds maximum size of 10KB (got ${valueBytes} bytes)`;
  }

  // Check key count (100 max) — only counts if this is a new key
  if (!store.has(key) && store.size >= MAX_KEYS) {
    return `Session store limit of ${MAX_KEYS} keys exceeded`;
  }

  return null;
}
