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
  ACTIVITY_LOG_WRITE: 'activity-log:read',
});
