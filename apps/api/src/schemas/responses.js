import { t } from 'elysia';

// ─── Generic Responses ───────────────────────────────────────────────────────

/** Standard error response body */
export const ErrorResponse = t.Object({
  error: t.String({ description: 'Human-readable error message', examples: ['Note not found'] }),
});

/** Health/readiness response */
export const StatusResponse = t.Object({
  status: t.String({ description: 'Service status', examples: ['ok'] }),
});

/** Unavailable response (readiness probe) */
export const UnavailableResponse = t.Object({
  status: t.String({ description: 'Service status', examples: ['unavailable'] }),
});

/** Message-only success response */
export const MessageResponse = t.Object({
  message: t.String({ description: 'Success message', examples: ['Operation completed'] }),
});

// ─── User / Auth Responses ───────────────────────────────────────────────────

/** User object returned by auth endpoints */
export const UserResponse = t.Object({
  id: t.String({ description: 'User ID' }),
  email: t.String({ format: 'email', description: 'User email address' }),
  displayName: t.String({ description: 'User display name' }),
  createdAt: t.Date({ description: 'Account creation timestamp' }),
  updatedAt: t.Date({ description: 'Last profile update timestamp' }),
});

/** Login response with user object and access token */
export const LoginResponse = t.Object({
  user: UserResponse,
  token: t.String({ description: 'JWT access token' }),
});

// ─── Note Responses ──────────────────────────────────────────────────────────

/** Full note object */
export const NoteResponse = t.Object({
  id: t.String({ description: 'Note ID' }),
  slug: t.String({ description: 'URL-friendly note slug' }),
  title: t.String({ description: 'Note title' }),
  content: t.String({ description: 'Markdown content body' }),
  frontmatter: t.Union([t.Object({}), t.Null()], { description: 'Parsed YAML frontmatter or null' }),
  excerpt: t.Union([t.String(), t.Null()], { description: 'Auto-generated excerpt or null' }),
  status: t.Union([t.Literal('DRAFT'), t.Literal('PUBLISHED'), t.Literal('ARCHIVED')], {
    description: 'Publication status',
  }),
  pinned: t.Boolean({ description: 'Whether the note is pinned' }),
  directoryId: t.Union([t.String(), t.Null()], { description: 'Containing directory ID or null' }),
  directory: t.Union([
    t.Object({
      id: t.String(),
      name: t.String(),
      parentId: t.Union([t.String(), t.Null()]),
    }),
    t.Null(),
  ], { description: 'Containing directory summary or null' }),
  createdAt: t.Date({ description: 'Creation timestamp' }),
  updatedAt: t.Date({ description: 'Last update timestamp' }),
  tags: t.Array(t.Object({ id: t.String(), name: t.String() }), {
    description: 'Tags attached to this note',
  }),
});

/** Paginated list of notes with cursor */
export const PaginatedNotesResponse = t.Object({
  notes: t.Array(NoteResponse, { description: 'Array of note objects' }),
  nextCursor: t.Union([t.String(), t.Null()], {
    description: 'Cursor for the next page, or null if no more results',
  }),
});

/** Note counts by status */
export const NoteCountResponse = t.Object({
  draft: t.Number({ description: 'Number of draft notes' }),
  published: t.Number({ description: 'Number of published notes' }),
  archived: t.Number({ description: 'Number of archived notes' }),
});

// ─── Directory Responses ────────────────────────────────────────────────────

export const DirectoryResponse = t.Object({
  id: t.String({ description: 'Directory ID' }),
  name: t.String({ description: 'Directory name' }),
  parentId: t.Union([t.String(), t.Null()], { description: 'Parent directory ID or null' }),
  userId: t.String({ description: 'Owning user ID' }),
  createdAt: t.Date({ description: 'Creation timestamp' }),
  updatedAt: t.Date({ description: 'Last update timestamp' }),
});

export const DirectoryTreeResponse = t.Object({
  directories: t.Array(t.Any(), { description: 'Nested directory tree with direct note counts' }),
});

/** Full-text search results with relevance rank */
export const SearchResponse = t.Object({
  notes: t.Array(
    t.Object({
      id: t.String(),
      slug: t.String(),
      title: t.String(),
      excerpt: t.Union([t.String(), t.Null()]),
      status: t.String(),
      rank: t.Number({ description: 'ts_rank relevance score' }),
    }),
    { description: 'Ranked search results' },
  ),
  nextCursor: t.Union([t.String(), t.Null()], {
    description: 'Cursor for the next page, or null if no more results',
  }),
});

// ─── Revision Responses ──────────────────────────────────────────────────────

/** Single revision object */
export const RevisionResponse = t.Object({
  id: t.String({ description: 'Revision ID' }),
  noteId: t.String({ description: 'Parent note ID' }),
  content: t.String({ description: 'Note content at this revision' }),
  message: t.Union([t.String(), t.Null()], { description: 'Revision message or null' }),
  authType: t.Union([t.String(), t.Null()], { description: 'Authentication type used (jwt or apikey)' }),
  apiKeyId: t.Union([t.String(), t.Null()], { description: 'API key ID if authenticated via API key' }),
  apiKeyName: t.Union([t.String(), t.Null()], { description: 'API key name if authenticated via API key' }),
  createdAt: t.Date({ description: 'Revision creation timestamp' }),
});

/** Paginated list of revisions */
export const RevisionListResponse = t.Object({
  revisions: t.Array(RevisionResponse, { description: 'Array of revision objects' }),
  nextCursor: t.Union([t.String(), t.Null()], {
    description: 'Cursor for the next page, or null if no more results',
  }),
});

// ─── Backlinks Response ──────────────────────────────────────────────────────

/** Backlinks for a note */
export const BacklinksResponse = t.Object({
  backlinks: t.Array(
    t.Object({
      id: t.String(),
      slug: t.String(),
      title: t.String(),
      tags: t.Array(t.Object({ id: t.String(), name: t.String() })),
      relation: t.Union([t.String(), t.Null()], { description: 'Edge relation type or null' }),
      weight: t.Number({ description: 'Edge weight (wikilink occurrence count)' }),
    }),
    { description: 'Notes that link to this note' },
  ),
});

// ─── Graph Responses ─────────────────────────────────────────────────────────

/** Knowledge graph with nodes and edges */
export const GraphResponse = t.Object({
  nodes: t.Array(
    t.Object({
      id: t.String(),
      slug: t.String(),
      title: t.String(),
      status: t.String(),
    }),
    { description: 'Graph nodes representing notes' },
  ),
  edges: t.Array(
    t.Object({
      fromId: t.String(),
      toId: t.Union([t.String(), t.Null()]),
      relation: t.Union([t.String(), t.Null()]),
      weight: t.Number({ description: 'Edge weight (wikilink occurrence count)' }),
    }),
    { description: 'Graph edges representing links between notes' },
  ),
  truncated: t.Optional(
    t.Boolean({
      description: 'True when the node set was capped at MAX_GRAPH_NODES; some nodes/edges omitted',
    }),
  ),
});

// ─── API Key Responses ───────────────────────────────────────────────────────

/** Response after creating an API key (includes plaintext key) */
export const ApiKeyCreatedResponse = t.Object({
  id: t.String({ description: 'API key ID' }),
  name: t.String({ description: 'API key name' }),
  scopes: t.Array(t.String(), { description: 'Granted scopes' }),
  createdAt: t.Date({ description: 'Creation timestamp' }),
  key: t.String({ description: 'Plaintext API key — shown only once' }),
});

/** List of API keys (without plaintext key) */
export const ApiKeyListResponse = t.Object({
  keys: t.Array(
    t.Object({
      id: t.String(),
      name: t.String(),
      scopes: t.Array(t.String()),
      lastUsedAt: t.Union([t.Date(), t.Null()]),
      createdAt: t.Date(),
    }),
    { description: 'Array of API key objects' },
  ),
});

// ─── Activity Log Responses ──────────────────────────────────────────────────

/** Paginated activity log entries */
export const ActivityLogResponse = t.Object({
  entries: t.Array(
    t.Object({
      id: t.String(),
      action: t.String(),
      apiKeyName: t.String(),
      targetResourceSlug: t.Union([t.String(), t.Null()]),
      details: t.Object({}),
      status: t.String(),
      createdAt: t.Date(),
    }),
    { description: 'Array of activity log entries' },
  ),
  nextCursor: t.Union([t.String(), t.Null()], {
    description: 'Cursor for the next page, or null if no more results',
  }),
});

// ─── Agent Responses ─────────────────────────────────────────────────────────

/** Agent manifest describing available endpoints and auth */
export const AgentManifestResponse = t.Object({
  apiVersion: t.String({ description: 'API version identifier' }),
  endpoints: t.Array(
    t.Object({
      path: t.String(),
      method: t.String(),
      description: t.String(),
      contentType: t.Optional(t.String()),
    }),
    { description: 'Available agent endpoints' },
  ),
  contentSchema: t.Object(
    {
      note: t.Object({
        id: t.String(),
        slug: t.String(),
        title: t.String(),
        excerpt: t.String(),
        tags: t.String(),
        updatedAt: t.String(),
      }),
    },
    { description: 'Schema descriptions for content types' },
  ),
  auth: t.Object({
    type: t.String(),
    header: t.String(),
    description: t.String(),
    requiredScopes: t.Array(t.String()),
  }),
});

/** Simplified paginated note list for agent consumption */
export const AgentNotesResponse = t.Object({
  notes: t.Array(
    t.Object({
      id: t.String(),
      slug: t.String(),
      title: t.String(),
      excerpt: t.Union([t.String(), t.Null()]),
      tags: t.Array(t.String()),
      updatedAt: t.String({ format: 'date-time' }),
    }),
    { description: 'Simplified note objects for agent consumption' },
  ),
  nextCursor: t.Union([t.String(), t.Null()], {
    description: 'Cursor for the next page, or null if no more results',
  }),
});

// ─── Tag Responses ───────────────────────────────────────────────────────────

/** List of tags with note counts */
export const TagListResponse = t.Object({
  tags: t.Array(
    t.Object({
      id: t.String(),
      name: t.String(),
      noteCount: t.Number({ description: 'Number of non-archived notes with this tag' }),
    }),
    { description: 'Array of tags with note counts' },
  ),
});

/** Paginated notes for a specific tag */
export const TagNotesResponse = t.Object({
  notes: t.Array(NoteResponse, { description: 'Notes with this tag' }),
  nextCursor: t.Union([t.String(), t.Null()], {
    description: 'Cursor for the next page, or null if no more results',
  }),
});
