# Tasks: Agent Activity Log

## Task 1: Database Schema Changes

- [x] 1.1 Add `authType`, `apiKeyId`, and `apiKeyName` nullable columns to the `Revision` model in `apps/api/prisma/schema.prisma`
- [x] 1.2 Add the `ActivityLog` model to `apps/api/prisma/schema.prisma` with fields: `id`, `userId`, `apiKeyId`, `apiKeyName`, `action`, `targetResourceId`, `targetResourceSlug`, `details` (Json), `status`, `createdAt`, and indexes on `[userId, createdAt]`, `[userId, action]`, `[userId, apiKeyName]`
- [x] 1.3 Add `activityLogs ActivityLog[]` relation to the `User` model in `apps/api/prisma/schema.prisma`
- [x] 1.4 Generate and apply the Prisma migration by running `bunx prisma migrate dev --name add_activity_log_and_revision_identity`
- [x] 1.5 Regenerate the Prisma client by running `bunx prisma generate`

## Task 2: Extend Auth Middleware to Expose API Key Identity

- [x] 2.1 Update `AuthService.verifyApiKey` in `apps/api/src/services/auth.service.js` to return `apiKeyId` (the `ApiKey.id`) and `apiKeyName` (the `ApiKey.name`) alongside the existing `user` and `scopes`
- [x] 2.2 Update `resolveAuth` in `apps/api/src/middleware/auth.js` to include `apiKeyId` and `apiKeyName` in the derived context (set to `null` for JWT auth)
- [x] 2.3 Add `ACTIVITY_LOG_WRITE` scope constant `'activity-log:read'` to `SCOPES` in `packages/shared/constants.js` for the activity log listing endpoint

## Task 3: ActivityLogService

- [x] 3.1 Create `apps/api/src/services/activity-log.service.js` with `logAction(params)` method that persists an `ActivityLog` record via Prisma, wrapped in try/catch that logs errors to console.error without throwing
- [x] 3.2 Add `listEntries(userId, opts)` method to `ActivityLogService` with cursor-based pagination (consistent with `NoteService.listNotes` pattern), ordered by `createdAt` descending, supporting optional `action` and `apiKeyName` filters
- [x] 3.3 Write unit tests in `apps/api/test/services/activity-log.service.test.js` covering: successful log creation, error status logging, DB failure resilience (mocked Prisma throw), listing with filters, pagination
- [x] 3.4 Write property-based tests in `apps/api/test/services/activity-log.service.property.test.js` for Property 1 (activity log completeness), Property 3 (ordering and pagination), and Property 4 (filtering correctness) using fast-check with minimum 100 iterations each

## Task 4: Extend NoteService with Agent Identity on Revisions

- [x] 4.1 Update `NoteService.createNote` in `apps/api/src/services/note.service.js` to accept optional `authType`, `apiKeyId`, `apiKeyName` parameters and pass them to the revision `create` call
- [x] 4.2 Update `NoteService.updateNote` in `apps/api/src/services/note.service.js` to accept optional `authType`, `apiKeyId`, `apiKeyName` parameters and pass them to the revision `create` call
- [x] 4.3 Add `revertNote(userId, slug, revisionId, authContext)` method to `NoteService` that: verifies the note and revision exist, updates the note content to the revision's content, creates a new revision with message `Reverted to revision {revisionId}` and the auth context fields
- [x] 4.4 Update `RevisionService.listRevisions` in `apps/api/src/services/revision.service.js` to include `authType`, `apiKeyId`, and `apiKeyName` in the query select
- [x] 4.5 Update `RevisionService.getRevision` to include `authType`, `apiKeyId`, and `apiKeyName` in the returned record
- [x] 4.6 Write property-based tests in `apps/api/test/services/note.service.property.test.js` for Property 2 (revision identity reflects auth context) and Property 5 (revert preserves target revision content) using fast-check with minimum 100 iterations each

## Task 5: Activity Log API Routes

- [x] 5.1 Create `apps/api/src/routes/activity-log.routes.js` with `GET /api/v1/activity-log` endpoint that calls `ActivityLogService.listEntries` with query params: `cursor`, `limit`, `action`, `apiKeyName`; protected by `authMiddleware`
- [x] 5.2 Register the activity log routes in `apps/api/src/index.js` by importing and using `activityLogRoutes`

## Task 6: Extend Notes Routes with Activity Logging and Revert

- [x] 6.1 Update the POST (create), PATCH (update), and DELETE (archive/delete) handlers in `apps/api/src/routes/notes.routes.js` to call `ActivityLogService.logAction` after the operation when `authType === 'apikey'`, passing the auth context and action details
- [x] 6.2 Add `POST /api/v1/notes/:slug/revert` route to `apps/api/src/routes/notes.routes.js` that accepts `{ revisionId }` body, calls `NoteService.revertNote`, and logs a `note:revert` activity log entry
- [x] 6.3 Update the existing `GET /:slug/revisions` and `GET /:slug/revisions/:revisionId` routes to return the new `authType`, `apiKeyId`, `apiKeyName` fields (already handled by RevisionService changes in Task 4)

## Task 7: Rate Limiter Middleware

- [x] 7.1 Create `apps/api/src/middleware/rate-limiter.js` with a `rateLimiter(config)` function that returns an Elysia plugin implementing sliding window rate limiting using an in-memory `Map<string, number[]>`
- [x] 7.2 The rate limiter SHALL: skip JWT-authenticated requests, prune expired timestamps on each request, reject with 429 + JSON body when limit exceeded, add `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers on API key responses, and fail-open with console.warn on errors
- [x] 7.3 Apply the rate limiter middleware in `apps/api/src/index.js` before the auth middleware, or within the agent routes group so it applies to API-key-authenticated routes
- [x] 7.4 Write unit tests in `apps/api/test/middleware/rate-limiter.test.js` covering: requests under limit pass, 61st request returns 429 with correct body, JWT requests bypass, headers present with correct values, fail-open on error
- [x] 7.5 Write property-based tests in `apps/api/test/middleware/rate-limiter.property.test.js` for Property 6 (sliding window enforcement), Property 7 (rate limit headers), and Property 8 (JWT bypass) using fast-check with minimum 100 iterations each

## Task 8: Frontend API Hooks and Query Keys

- [x] 8.1 Add `activityKeys` query key factory to `apps/web/src/api/hooks.js`: `{ all: ['activity-log'], lists: (filters) => ['activity-log', 'list', filters] }`
- [x] 8.2 Add `useActivityLog(filters)` query hook that calls `GET /api/v1/activity-log` with optional `cursor`, `limit`, `action`, `apiKeyName` query params
- [x] 8.3 Add `useRevertNote(slug)` mutation hook that calls `POST /api/v1/notes/${slug}/revert` with `{ revisionId }` body and invalidates `noteKeys`, `revKeys`, and `activityKeys` on success

## Task 9: RevisionHistory Component Enhancement

- [x] 9.1 Update `RevisionHistory.jsx` to display an agent badge (styled `<span>` with distinct background color) showing "agent" text and the `apiKeyName` for revisions where `authType === 'apikey'`, with accessible color contrast (4.5:1 ratio)
- [x] 9.2 Add a "Revert to this version" button to each revision entry (both agent and human revisions), visible when a revision is selected (active)
- [x] 9.3 Implement a confirmation dialog (using the existing `ConfirmDialog` component pattern) that appears when the revert button is clicked, before calling the `useRevertNote` mutation
- [x] 9.4 After successful revert, close the diff view and invalidate relevant queries to refresh the note content and revision list

## Task 10: Activity Feed Page

- [x] 10.1 Create `apps/web/src/pages/ActivityFeedPage.jsx` with a chronological list of activity log entries, each showing API key name, action type, target resource slug, timestamp, and details summary
- [x] 10.2 Add filter controls to `ActivityFeedPage`: action type dropdown and API key name dropdown
- [x] 10.3 Add "Load more" pagination button using cursor-based pagination from the `useActivityLog` hook
- [x] 10.4 Add empty state display showing "No agent activity recorded yet" when no entries exist
- [x] 10.5 Add the `/activity` route to the router in `apps/web/src/main.jsx` as a lazy-loaded child of the protected layout

## Task 11: Sidebar Navigation Update

- [x] 11.1 Add an "Agent Activity" nav item to `Sidebar.jsx` between the "Graph" item and the Tags section, using the `Activity` icon from lucide-react, linking to `/activity`

## Task 12: Update MCP Tools with Agent Identity

- [x] 12.1 Update the MCP `create_note` tool in `apps/mcp/src/tools/create-note.js` to pass `authType: 'apikey'` and the resolved API key identity (`apiKeyId`, `apiKeyName`) to the revision creation, so MCP-created revisions are stamped with agent identity
- [x] 12.2 Update the MCP `update_note` tool in `apps/mcp/src/tools/update-note.js` to pass `authType: 'apikey'` and the resolved API key identity to the revision creation
- [x] 12.3 Update the MCP auth resolution in `apps/mcp/src/auth.js` to also return `apiKeyId` and `apiKeyName` from the `ApiKey` record so they are available to tools

## Task 13: Install fast-check Dependency

- [x] 13.1 Install `fast-check` as a dev dependency in `apps/api` by running `cd apps/api && bun add -d fast-check`
