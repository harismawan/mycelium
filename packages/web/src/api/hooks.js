/**
 * TanStack Query hooks for Mycelium API.
 *
 * Provides query and mutation hooks that wrap the fetch-based API client.
 * Query keys follow the factory pattern from the design document.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from './client.js';

// ---------------------------------------------------------------------------
// Query key factories
// ---------------------------------------------------------------------------

/** @type {{ all: string[], lists: (filters?: object) => unknown[], detail: (slug: string) => string[], md: (slug: string) => string[] }} */
export const noteKeys = {
  all: ['notes'],
  lists: (filters) => ['notes', 'list', filters],
  detail: (slug) => ['notes', 'detail', slug],
  md: (slug) => ['notes', 'md', slug],
};

export const tagKeys = { all: /** @type {const} */ (['tags']) };

/** @type {{ all: string[], ego: (slug: string, depth: number) => (string | number)[] }} */
export const graphKeys = {
  all: ['graph'],
  ego: (slug, depth) => ['graph', slug, depth],
};

/** @type {{ list: (noteId: string) => string[] }} */
export const revKeys = { list: (noteId) => ['revisions', noteId] };

/** @type {{ query: (q: string) => string[] }} */
export const searchKeys = { query: (q) => ['search', q] };

/** @type {{ all: string[] }} */
export const apiKeyKeys = { all: ['api-keys'] };

/** @type {{ all: string[], lists: (filters?: object) => unknown[] }} */
export const activityKeys = {
  all: ['activity-log'],
  lists: (filters) => ['activity-log', 'list', filters],
};

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * Fetch paginated notes list with optional filters.
 * @param {object} [filters]
 * @param {string} [filters.cursor]
 * @param {number} [filters.limit]
 * @param {string} [filters.status]
 * @param {string} [filters.tag]
 * @param {string} [filters.q]
 */
export function useNotes(filters = {}) {
  const params = new URLSearchParams();
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  return useQuery({
    queryKey: noteKeys.lists(filters),
    queryFn: () => apiGet(`/notes${qs ? `?${qs}` : ''}`),
  });
}

/**
 * Fetch note counts by status.
 */
export function useNoteCounts() {
  return useQuery({
    queryKey: [...noteKeys.all, 'count'],
    queryFn: () => apiGet('/notes/count'),
  });
}

/**
 * Fetch a single note by slug (JSON).
 * @param {string} slug
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 */
export function useNote(slug, options = {}) {
  return useQuery({
    queryKey: noteKeys.detail(slug),
    queryFn: () => apiGet(`/notes/${slug}`),
    enabled: options.enabled ?? !!slug,
  });
}

/**
 * Fetch a note's raw Markdown by slug.
 * @param {string} slug
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 */
export function useNoteMd(slug, options = {}) {
  return useQuery({
    queryKey: noteKeys.md(slug),
    queryFn: () => apiGet(`/notes/${slug}?format=md`),
    enabled: options.enabled ?? !!slug,
  });
}

/**
 * Fetch all tags with note counts.
 */
export function useTags() {
  return useQuery({
    queryKey: tagKeys.all,
    queryFn: () => apiGet('/tags'),
  });
}

/**
 * Fetch the knowledge graph.
 * When `slug` is provided, returns the ego-subgraph at the given depth.
 * @param {string} [slug]
 * @param {number} [depth]
 */
export function useGraph(slug, depth) {
  const key = slug ? graphKeys.ego(slug, depth ?? 1) : graphKeys.all;
  const path = slug
    ? `/graph/${slug}${depth != null ? `?depth=${depth}` : ''}`
    : '/graph';
  return useQuery({ queryKey: key, queryFn: () => apiGet(path) });
}

/**
 * Fetch revision history for a note.
 * @param {string} slug
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 */
export function useRevisions(slug, options = {}) {
  return useQuery({
    queryKey: revKeys.list(slug),
    queryFn: () => apiGet(`/notes/${slug}/revisions`),
    enabled: options.enabled ?? !!slug,
  });
}

/**
 * Full-text search across notes.
 * @param {string} query
 * @param {object} [options]
 * @param {boolean} [options.enabled]
 */
export function useSearch(query, options = {}) {
  return useQuery({
    queryKey: searchKeys.query(query),
    queryFn: () => apiGet(`/notes?q=${encodeURIComponent(query)}`),
    enabled: options.enabled ?? !!query,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Create a new note.
 * Invalidates the notes list and tags on success.
 */
export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ title: string, content: string, status?: string, tags?: string[] }} data */
    mutationFn: (data) => apiPost('/notes', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: noteKeys.all });
      qc.invalidateQueries({ queryKey: tagKeys.all });
      qc.invalidateQueries({ queryKey: graphKeys.all });
    },
  });
}

/**
 * Update an existing note.
 * Invalidates the note detail, list, tags, and graph on success.
 * @param {string} slug
 */
export function useUpdateNote(slug) {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ title?: string, content?: string, status?: string, tags?: string[], message?: string }} data */
    mutationFn: (data) => apiPatch(`/notes/${slug}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: noteKeys.detail(slug) });
      qc.invalidateQueries({ queryKey: noteKeys.md(slug) });
      qc.invalidateQueries({ queryKey: noteKeys.all });
      qc.invalidateQueries({ queryKey: tagKeys.all });
      qc.invalidateQueries({ queryKey: graphKeys.all });
      qc.invalidateQueries({ queryKey: revKeys.list(slug) });
      qc.invalidateQueries({ queryKey: ['backlinks', slug] });
    },
  });
}

/**
 * Archive (soft-delete) a note.
 * Invalidates notes list, tags, and graph on success.
 * @param {string} slug
 */
export function useArchiveNote(slug) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/notes/${slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: noteKeys.all });
      qc.invalidateQueries({ queryKey: tagKeys.all });
      qc.invalidateQueries({ queryKey: graphKeys.all });
    },
  });
}

/**
 * Fetch paginated activity log entries with optional filters.
 * @param {object} [filters]
 * @param {string} [filters.cursor]
 * @param {number} [filters.limit]
 * @param {string} [filters.action]
 * @param {string} [filters.apiKeyName]
 */
export function useActivityLog(filters = {}) {
  const params = new URLSearchParams();
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.action) params.set('action', filters.action);
  if (filters.apiKeyName) params.set('apiKeyName', filters.apiKeyName);
  const qs = params.toString();
  return useQuery({
    queryKey: activityKeys.lists(filters),
    queryFn: () => apiGet(`/activity-log${qs ? `?${qs}` : ''}`),
  });
}

/**
 * Revert a note to a specific revision.
 * Invalidates note, revision, and activity log queries on success.
 * @param {string} slug
 */
export function useRevertNote(slug) {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ revisionId: string }} data */
    mutationFn: (data) => apiPost(`/notes/${slug}/revert`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: noteKeys.all });
      qc.invalidateQueries({ queryKey: noteKeys.detail(slug) });
      qc.invalidateQueries({ queryKey: noteKeys.md(slug) });
      qc.invalidateQueries({ queryKey: revKeys.list(slug) });
      qc.invalidateQueries({ queryKey: activityKeys.all });
      qc.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// API Key hooks
// ---------------------------------------------------------------------------

/**
 * Fetch all API keys for the authenticated user.
 */
export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.all,
    queryFn: () => apiGet('/api-keys'),
  });
}

/**
 * Create a new API key.
 * Invalidates the API keys list on success.
 */
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {{ name: string, scopes?: string[] }} data */
    mutationFn: (data) => apiPost('/api-keys', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apiKeyKeys.all });
    },
  });
}

/**
 * Delete an API key by ID.
 * Invalidates the API keys list on success.
 */
export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    /** @param {string} id */
    mutationFn: (id) => apiDelete(`/api-keys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apiKeyKeys.all });
    },
  });
}
