# Implementation Plan: Mycelium (Dual-Audience Knowledge Base)

## Overview

Incremental build of a Bun monorepo knowledge base with Elysia API, React SPA, and shared Markdown pipeline. Each task builds on the previous, wiring components together as we go. All code is plain JavaScript (ESM) with JSDoc annotations.

## Tasks

- [x] 1. Monorepo scaffolding, Prisma schema, and database setup
  - [x] 1.1 Initialize Bun workspace root with `package.json` workspaces config pointing to `apps/api`, `apps/web`, and `packages/shared`
    - Create root `package.json` with `"workspaces"` field
    - Create `apps/api/package.json`, `apps/web/package.json`, `packages/shared/package.json`
    - _Requirements: 25.1, 25.3_

  - [x] 1.2 Set up Prisma schema and initial migration
    - Install Prisma in `apps/api`
    - Create `prisma/schema.prisma` with User, Note, Link, Tag, Revision, ApiKey models and NoteStatus enum exactly as specified in the design
    - Define all indexes (slug, status, userId, fromId, toId, name, email, keyHash)
    - Run `prisma migrate dev` to generate the initial migration
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [x] 1.3 Add custom SQL migration for full-text search tsvector
    - Create a custom migration adding the `searchVector` generated tsvector column on Note
    - Add GIN index `Note_searchVector_idx`
    - Use the weighted `setweight` approach from the design (title=A, content=B)
    - _Requirements: 6.1, 6.5_

  - [x] 1.4 Create Docker Compose configuration for PostgreSQL 16
    - Create `docker-compose.yml` with a PostgreSQL 16 service, preconfigured database name, user, and password
    - Expose the PostgreSQL port for local dev tool access
    - _Requirements: 23.1, 23.2_

  - [x] 1.5 Create Prisma client singleton and database connection helper in `apps/api`
    - Export a shared Prisma client instance from `apps/api/src/db.js`
    - _Requirements: 21.1_

- [x] 2. Shared packages — Markdown pipeline, slug helpers, enums, and constants
  - [x] 2.1 Implement Markdown pipeline in `packages/shared/markdown.js`
    - Install remark, rehype, remark-frontmatter, remark-parse, remark-stringify, rehype-stringify, remark-rehype, yaml (for frontmatter parsing)
    - Implement `parseFrontmatter(markdown)`, `serializeFrontmatter(frontmatter, body)`, `extractWikilinks(markdown)`, `generateExcerpt(markdown, maxLength)`, `parseMarkdown(markdown)`, `serializeMarkdown(mdastTree)`, `renderToHtml(markdown)`
    - Add JSDoc annotations on all exported functions
    - _Requirements: 20.1, 20.2, 20.3, 20.5, 20.6, 25.2, 25.4_

  - [x] 2.2 Implement slug helpers in `packages/shared/slug.js`
    - Implement `slugify(title)` and `uniqueSlug(title, existingSlugs)`
    - Add JSDoc annotations
    - _Requirements: 1.5, 25.2, 25.4_

  - [x] 2.3 Create shared enums and constants in `packages/shared/constants.js`
    - Export `NoteStatus` enum object (`DRAFT`, `PUBLISHED`, `ARCHIVED`)
    - Export default pagination limits, API version prefix, scope constants
    - Add JSDoc annotations
    - _Requirements: 1.7, 25.2, 25.4_

  - [x] 2.4 Create `packages/shared/index.js` barrel export
    - Re-export all public functions from markdown, slug, and constants modules
    - _Requirements: 25.2_

  - [x]* 2.5 Write unit tests for Markdown pipeline
    - Test `parseFrontmatter` / `serializeFrontmatter` round-trip
    - Test `extractWikilinks` with various `[[Link]]` patterns
    - Test `generateExcerpt` truncation
    - Test `renderToHtml` output
    - _Requirements: 20.1, 20.2, 20.3, 20.5, 1.8_

  - [x]* 2.6 Write unit tests for slug helpers
    - Test `slugify` with special characters, unicode, spaces
    - Test `uniqueSlug` suffix generation
    - _Requirements: 1.5_

- [x] 3. Checkpoint — Shared packages and database
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Authentication — JWT for humans, API keys for agents
  - [x] 4.1 Implement AuthService in `apps/api/src/services/auth.service.js`
    - Implement `register(email, password, displayName)` with bcrypt password hashing
    - Implement `login(email, password)` returning JWT token
    - Implement `verifyJwt(token)` and `verifyApiKey(key)` using SHA-256 hash lookup
    - Handle duplicate email (409), invalid credentials (401)
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 4.2, 4.5, 4.7_

  - [x] 4.2 Implement auth middleware in `apps/api/src/middleware/auth.js`
    - Create Elysia `derive` plugin that checks JWT cookie first, then Bearer header
    - Attach resolved user and auth type (jwt/apikey) to request context
    - Return 401 for missing/invalid credentials
    - For API key auth, enforce scopes and update `lastUsedAt`
    - _Requirements: 3.4, 3.7, 4.2, 4.3, 4.5_

  - [x] 4.3 Implement auth routes in `apps/api/src/routes/auth.routes.js`
    - `POST /api/v1/auth/register` — validate with Elysia `t()`, call AuthService.register
    - `POST /api/v1/auth/login` — validate, call AuthService.login, set httpOnly cookie
    - `POST /api/v1/auth/logout` — clear JWT cookie
    - `GET /api/v1/auth/me` — return current user (protected)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 11.1, 11.2_

  - [x] 4.4 Implement API key routes in `apps/api/src/routes/api-keys.routes.js`
    - `POST /api/v1/api-keys` — generate key, store hash, return plaintext once (JWT-only)
    - `GET /api/v1/api-keys` — list user's keys without hashes (JWT-only)
    - `DELETE /api/v1/api-keys/:id` — revoke key (JWT-only)
    - _Requirements: 4.1, 4.4, 4.6_

  - [x]* 4.5 Write unit tests for AuthService
    - Test registration, login, JWT verification, API key verification
    - Test error cases (duplicate email, wrong password, revoked key)
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 4.2, 4.7_

- [x] 5. Notes CRUD with Markdown parsing, wikilink reconciliation, and revisions
  - [x] 5.1 Implement NoteService in `apps/api/src/services/note.service.js`
    - Implement `createNote(userId, data)` — parse frontmatter, generate slug, extract wikilinks, generate excerpt, create Note + Revision in a Prisma transaction, reconcile links, resolve unresolved links
    - Implement `listNotes(userId, opts)` — cursor-based pagination with status/tag/search filters
    - Implement `getNote(userId, slug)` and `getNoteMarkdown(userId, slug)`
    - Implement `updateNote(userId, slug, data)` — re-run full pipeline in transaction
    - Implement `archiveNote(userId, slug)` — soft delete by setting status to ARCHIVED
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.2 Implement LinkService in `apps/api/src/services/link.service.js`
    - Implement `reconcileLinks(noteId, wikilinks)` — diff existing links, create new, remove stale
    - Implement `resolveUnresolvedLinks(noteId, title)` — update null `toId` links matching title
    - Implement `getBacklinks(noteId)` — return notes linking to this note
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 5.3 Implement RevisionService in `apps/api/src/services/revision.service.js`
    - Implement `listRevisions(noteId, opts)` — cursor-based pagination, descending by createdAt
    - Implement `getRevision(revisionId)`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 5.4 Implement note routes in `apps/api/src/routes/notes.routes.js`
    - `POST /api/v1/notes` — create note with Elysia `t()` validation
    - `GET /api/v1/notes` — list with cursor, limit, status, tag, q params
    - `GET /api/v1/notes/:slug` — get note, support `?format=md`
    - `PATCH /api/v1/notes/:slug` — partial update
    - `DELETE /api/v1/notes/:slug` — archive
    - `GET /api/v1/notes/:slug/revisions` — list revisions
    - `GET /api/v1/notes/:slug/revisions/:revisionId` — get single revision
    - `GET /api/v1/notes/:slug/backlinks` — get backlinks
    - Return 400 for validation failures, 404 for not found
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 11.1, 11.2, 11.3_

  - [x]* 5.5 Write unit tests for NoteService
    - Test create note pipeline (frontmatter, slug, excerpt, revision)
    - Test wikilink extraction and link reconciliation
    - Test unresolved link resolution on new note creation
    - Test archive (soft delete)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.7, 5.1, 5.7_

- [x] 6. Search, tags, and graph endpoints
  - [x] 6.1 Implement SearchService in `apps/api/src/services/search.service.js`
    - Implement `search(userId, query, filters)` using raw SQL with `plainto_tsquery`, `ts_rank`, cursor pagination
    - Combine FTS with status and tag filters
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Implement graph endpoint logic in LinkService
    - Implement `getGraph(userId, opts)` — return nodes (id, slug, title, status) and edges (fromId, toId, relation)
    - Support ego-subgraph with configurable depth from a given note
    - Exclude ARCHIVED notes by default
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.3 Implement tag and graph routes
    - `GET /api/v1/tags` — list all tags with note counts
    - `GET /api/v1/tags/:name/notes` — paginated notes by tag
    - `GET /api/v1/graph` — full graph
    - `GET /api/v1/graph/:slug` — ego-subgraph with `?depth=` param
    - Search route: `GET /api/v1/notes` with `q` param already handled in 5.4
    - _Requirements: 8.1, 8.2, 8.3, 7.1, 7.2, 7.3_

  - [x]* 6.4 Write unit tests for SearchService and graph
    - Test FTS ranking and filtering
    - Test graph node/edge structure
    - Test ego-subgraph depth limiting
    - _Requirements: 6.2, 6.3, 7.1, 7.2_

- [x] 7. Checkpoint — Full API backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Health, observability, and Elysia server wiring
  - [x] 8.1 Implement health and readiness routes
    - `GET /health` — return 200 OK
    - `GET /ready` — check Prisma `$queryRaw('SELECT 1')`, return 200 or 503
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 8.2 Add structured request logging middleware
    - Log method, path, status code, and response time as JSON for every request
    - _Requirements: 12.4_

  - [x] 8.3 Wire all route groups into the main Elysia app in `apps/api/src/index.js`
    - Import and `.use()` all route groups (auth, notes, tags, graph, agent, apiKeys, health)
    - Apply auth middleware, validation, Swagger plugin, CORS
    - Start server on configured port
    - _Requirements: 11.1, 24.2_

- [x] 9. Agent-specific endpoints
  - [x] 9.1 Implement AgentService in `apps/api/src/services/agent.service.js`
    - Implement `getManifest()` — return JSON describing endpoints, schema, auth requirements
    - Implement `streamBundle(userId)` — stream all PUBLISHED notes as NDJSON using ReadableStream
    - Implement `listAgentNotes(userId, opts)` — simplified JSON format for agent consumption
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 9.2 Implement agent routes in `apps/api/src/routes/agent.routes.js`
    - `GET /api/v1/agent/manifest` — return manifest
    - `GET /api/v1/agent/bundle` — stream NDJSON with `Content-Type: application/x-ndjson`
    - `GET /api/v1/agent/notes` — simplified note list
    - All routes require API key auth with appropriate scopes
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x]* 9.3 Write unit tests for AgentService
    - Test manifest structure
    - Test NDJSON stream output format
    - Test scope enforcement
    - _Requirements: 10.1, 10.2, 10.4_

- [x] 10. SPA shell, routing, auth flows, and Zustand stores
  - [x] 10.1 Initialize React + Vite app in `apps/web`
    - Set up Vite config with proxy to API server
    - Install React 18, react-router-dom, Zustand, @tanstack/react-query, zod
    - Create `apps/web/src/main.jsx` entry point with QueryClientProvider and RouterProvider
    - _Requirements: 13.2, 13.7_

  - [x] 10.2 Implement Zustand stores
    - Create `useAuthStore` with `user`, `isAuthenticated`, `login()`, `logout()`, `checkAuth()`
    - Create `useNotesStore` with `selectedSlug`, `pinnedSlugs`, `selectNote()`, `togglePin()`
    - Create `useEditorStore` with `isDirty`, `content`, `setContent()`, `resetDirty()`
    - Create `useUIStore` with `theme`, `sidebarOpen`, `rightPaneOpen`, `readingMode`, `setTheme()`, `toggleSidebar()` — use persist middleware
    - _Requirements: 13.3, 13.4, 13.5, 13.6_

  - [x] 10.3 Implement TanStack Query hooks and API client
    - Create `apps/web/src/api/client.js` with fetch wrapper for API calls
    - Create query hooks using the key factory from the design: `useNotes`, `useNote`, `useNoteMd`, `useTags`, `useGraph`, `useRevisions`, `useSearch`
    - Create mutation hooks: `useCreateNote`, `useUpdateNote`, `useArchiveNote`
    - _Requirements: 13.7_

  - [x] 10.4 Implement auth pages and protected route wrapper
    - Create `LoginPage` and `RegisterPage` components with Zod form validation
    - Create `ProtectedRoute` wrapper that redirects to login if not authenticated
    - Wire auth flows to `useAuthStore`
    - _Requirements: 13.3, 19.1, 19.2_

  - [x] 10.5 Implement three-pane AppLayout shell
    - Create `AppLayout` with sidebar, center pane, and right pane
    - Sidebar and right pane visibility controlled by `useUIStore`
    - Set up client-side routes: `/notes/:slug`, `/graph`, `/search`, `/settings`
    - _Requirements: 13.1, 13.2_

- [x] 11. Block editor with wikilink autocomplete
  - [x] 11.1 Set up TipTap editor in `apps/web/src/components/editor/TipTapEditor.jsx`
    - Install `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`, `tiptap-markdown`
    - Configure editor with StarterKit extensions (paragraphs, headings, lists, code blocks, blockquotes)
    - Wire editor content to `useEditorStore`
    - Serialize to Markdown on save using tiptap-markdown
    - _Requirements: 14.1, 14.6_

  - [x] 11.2 Implement slash command menu
    - Create `SlashCommandMenu` component triggered by `/` at block start
    - Support inserting: heading, bullet list, ordered list, code block, blockquote, image
    - _Requirements: 14.2_

  - [x] 11.3 Implement wikilink autocomplete extension
    - Create custom TipTap extension that triggers on `[[` input
    - Fetch note titles from API for autocomplete suggestions
    - On selection, insert `[[Note Title]]` wikilink syntax
    - _Requirements: 14.3, 14.4_

  - [x] 11.4 Implement drag-and-drop image upload
    - Handle image drop/paste events in the editor
    - Upload image to API (or local storage endpoint) and insert Markdown image reference
    - _Requirements: 14.5_

  - [x] 11.5 Create EditorView container with toolbar
    - Wire `EditorToolbar` with save button, status selector, tag input
    - Connect save action to `useUpdateNote` mutation
    - Show unsaved changes indicator from `useEditorStore.isDirty`
    - _Requirements: 14.6, 13.5_

- [x] 12. Checkpoint — Editor and SPA core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Right pane — relationships, revisions, and graph view
  - [x] 13.1 Implement right pane components
    - Create `OutgoingLinks` — display note's wikilinks as clickable items
    - Create `BacklinksList` — fetch and display backlinks as clickable items
    - Create `TagList` — display note's tags
    - Create `RevisionHistory` — list revisions with timestamps, click to view full content
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 13.2 Implement graph visualization page
    - Install `react-force-graph-2d`
    - Create `GraphPage` component fetching graph data from API
    - Render nodes (notes) and edges (links) as force-directed graph
    - Color/shape nodes by NoteStatus
    - Click node to navigate to note in editor
    - Support zoom and pan
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [x] 14. Sidebar — tags, pinned notes, search, and command palette
  - [x] 14.1 Implement sidebar components
    - Create `TagTree` — expandable tag list with note counts, click to filter
    - Create `PinnedNotes` — list of pinned notes from `useNotesStore.pinnedSlugs`
    - Create `SearchInput` — search box that queries API and displays results in sidebar
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 14.2 Implement command palette
    - Create `CommandPalette` component activated by Cmd/Ctrl-K
    - Search notes, tags, and actions
    - Support keyboard navigation within the palette
    - _Requirements: 15.4, 15.5_

- [x] 15. Theming, reading view, and client-side validation
  - [x] 15.1 Implement theme support
    - Detect OS preferred color scheme and apply matching theme
    - Allow manual theme toggle, persist in `useUIStore`
    - Apply light/dark CSS variables or class-based theming
    - _Requirements: 18.1, 18.2, 18.3_

  - [x] 15.2 Implement reading view
    - Create `ReadingView` component that hides sidebar and right pane
    - Render note content as HTML using `renderToHtml` from shared pipeline
    - Centered, readable layout
    - _Requirements: 18.4, 20.4_

  - [x] 15.3 Implement client-side Zod validation
    - Create Zod schemas for note creation/update forms, login, registration
    - Display inline error messages on validation failure
    - Check note title uniqueness against API before save
    - _Requirements: 19.1, 19.2, 19.3_

- [x] 16. Checkpoint — Full SPA
  - Ensure all tests pass, ask the user if questions arise.

- [-] 17. Seed script, AGENTS.md, README, and final wiring
  - [x] 17.1 Create seed script in `apps/api/prisma/seed.js`
    - Create demo user with known email/password
    - Create at least 10 interlinked notes with varied statuses, tags, and wikilinks
    - Create example API key with known plaintext for agent testing
    - Make script idempotent
    - _Requirements: 22.1, 22.2, 22.3, 22.4_

  - [x] 17.2 Create AGENTS.md documentation
    - Document all agent-specific endpoints (`/agent/manifest`, `/agent/bundle`, `/agent/notes`)
    - Document API key authentication, request/response schemas, usage examples
    - _Requirements: 24.1_

  - [x] 17.3 Create README.md
    - Document project overview, architecture, prerequisites
    - Instructions for starting Docker Compose, running migrations, seeding, starting API and SPA
    - _Requirements: 23.3_

  - [x]* 17.4 Write smoke tests for critical API flows
    - Test auth flow (register → login → access protected route)
    - Test note CRUD flow (create → read → update → archive)
    - Test wikilink/backlink reconciliation flow
    - Test agent bundle NDJSON streaming
    - _Requirements: 5.1, 5.7, 2.1, 2.5, 10.2_

- [x] 18. Final checkpoint — Full system
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirement acceptance criteria for traceability
- All code is plain JavaScript (ESM) with JSDoc annotations — no TypeScript
- Checkpoints at tasks 3, 7, 12, 16, and 18 ensure incremental validation
- The build order prioritizes backend-first so the SPA can develop against real API endpoints
