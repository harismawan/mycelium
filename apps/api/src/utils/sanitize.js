/**
 * Strips dangerous HTML from Markdown content before storage.
 *
 * Targets the XSS vectors that matter in a Markdown context:
 * - <script> blocks (inline JS execution)
 * - Event handler attributes (onerror=, onclick=, etc.)
 * - javascript: protocol in href/src/action attributes
 * - <iframe>, <object>, <embed> tags (arbitrary content embedding)
 *
 * BlockNote handles rendering safely, but the raw ?format=md endpoint
 * and NDJSON bundle serve stored content verbatim — sanitize at write time.
 *
 * @param {string} content - Raw Markdown content from the user.
 * @returns {string} Sanitized content.
 */
export function sanitizeMarkdown(content) {
  return content
    // Strip <script>...</script> blocks (case-insensitive, across newlines)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    // Strip <iframe>, <object>, <embed> tags entirely
    .replace(/<\s*(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(iframe|object|embed)\b[^>]*/gi, '')
    // Remove event handler attributes (on* = "...")
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // Strip javascript: protocol from href/src/action/data attributes
    .replace(/(href|src|action|data)\s*=\s*["']\s*javascript:[^"']*/gi, '$1="#"');
}
