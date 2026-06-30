/**
 * Shared enums and constants for the Mycelium knowledge base.
 *
 * @module @mycelium/shared/constants
 */

/**
 * Note lifecycle status values.
 *
 * @readonly
 * @enum {string}
 */
export const NoteStatus = Object.freeze({
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
});

/**
 * Default number of items returned per paginated request.
 *
 * @type {number}
 */
export const DEFAULT_PAGE_LIMIT = 20;

/**
 * Version prefix applied to all API routes.
 *
 * @type {string}
 */
export const API_VERSION_PREFIX = '/api/v1';

/**
 * API key scope identifiers used to restrict agent access.
 *
 * @readonly
 * @enum {string}
 */
export const SCOPES = Object.freeze({
  NOTES_READ: 'notes:read',
  NOTES_WRITE: 'notes:write',
  AGENT_READ: 'agent:read',
  ACTIVITY_LOG_READ: 'activity-log:read',
});

/**
 * Maximum number of nodes returned by a single graph read before truncation.
 * Caps the token cost of `LinkService.getGraph`, the `/api/v1/graph` routes,
 * and the `get_graph` MCP tool. The most recently updated nodes survive the cap.
 *
 * @type {number}
 */
export const MAX_GRAPH_NODES = 200;

/**
 * Maximum BFS depth honored by ego-subgraph traversal. Requested depths above
 * this are clamped down; non-numeric depths are rejected at the route edge and
 * coerced to the default of 1 in the service.
 *
 * @type {number}
 */
export const MAX_GRAPH_DEPTH = 5;

/**
 * Maximum number of rows returned by a single `LinkService.getBacklinks` /
 * `getOutgoingLinks` read (per list for outgoing links).
 *
 * @type {number}
 */
export const MAX_LINK_RESULTS = 25;

/**
 * Canonical relation vocabulary for typed wikilinks (`[[relation: Title]]`).
 *
 * `extractWikilinks` only splits an inner `[[...]]` segment on its first colon
 * when the prefix matches one of these values; otherwise the whole segment is
 * treated as the title (so `[[Chapter 1: Intro]]` is preserved).
 *
 * @type {readonly string[]}
 */
export const RELATION_VOCAB = Object.freeze([
  'supports',
  'contradicts',
  'derived-from',
  'refines',
  'related-to',
]);
