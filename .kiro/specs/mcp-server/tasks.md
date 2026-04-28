# Implementation Plan: Mycelium MCP Server

## Overview

Build the `apps/mcp/` workspace — a Model Context Protocol server that exposes the Mycelium knowledge base to AI agents. The server reuses existing Prisma models and service-layer logic (NoteService, SearchService, LinkService, AuthService) via thin MCP tool wrappers. Plain JavaScript ESM with JSDoc, Bun runtime, `@modelcontextprotocol/sdk` for protocol handling, Zod for input validation.

## Tasks

- [x] 1. Scaffold the `apps/mcp` workspace and core infrastructure
  - [x] 1.1 Create `apps/mcp/package.json` with dependencies (`@modelcontextprotocol/sdk`, `@mycelium/shared`, `@prisma/client`, `zod`, `express`) and devDependencies (`fast-check`, `prisma`)
    - Add `start`, `start:http`, and `test` scripts as specified in the design
    - _Requirements: 1.7_
  - [x] 1.2 Add `"apps/mcp"` to the root `package.json` workspaces array
    - _Requirements: 1.7_
  - [x] 1.3 Create `apps/mcp/src/db.js` — Prisma client singleton
    - Same pattern as `apps/api/src/db.js` (globalThis caching for dev)
    - _Requirements: 1.7, 13.3_
  - [x] 1.4 Create `apps/mcp/src/logger.js` — structured JSON logger
    - Implement `log(level, message, meta)` function outputting JSON to stdout
    - _Requirements: 13.4_
  - [x] 1.5 Create `apps/mcp/src/auth.js` — API key resolution and scope checking
    - Implement `resolveAuth(transport, request)` that reads key from `MYCELIUM_API_KEY` env var (stdio) or `Authorization: Bearer` header (HTTP)
    - Delegate to `AuthService.verifyApiKey()` logic (local implementation using the Prisma client)
    - Implement `checkScopes(requiredScopes, userScopes)` helper returning MCP error content if scopes are insufficient
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 2. Implement the server factory and entry point
  - [x] 2.1 Create `apps/mcp/src/server.js` — McpServer factory
    - Implement `createServer(authContext)` that instantiates `McpServer` with name `"mycelium-mcp"` and version from package.json
    - Import and call each tool's `register(server, authContext)` function
    - _Requirements: 1.3_
  - [x] 2.2 Create `apps/mcp/src/index.js` — entry point
    - Parse `--transport=stdio|http` CLI flag (default: `stdio`)
    - For stdio: resolve auth from env, create server, connect via `StdioServerTransport`
    - For HTTP: set up Express with Streamable HTTP transport on `MCP_PORT` (default 3001), resolve auth per connection
    - Validate database connectivity at startup via `prisma.$connect()`; exit with code 1 on failure
    - Log startup info as structured JSON
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 13.3_

- [x] 3. Implement read-only tools (search, read, list)
  - [x] 3.1 Create `apps/mcp/src/tools/search-notes.js`
    - Register `search_notes` tool with Zod input schema: required `query`, optional `tag`, `status`, `limit`
    - Check `agent:read` scope, delegate to `SearchService.search()`, return results as MCP text content
    - Wrap handler with timing logger and database error catch
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 2.5, 13.1, 13.2, 13.4_
  - [x] 3.2 Create `apps/mcp/src/tools/read-note.js`
    - Register `read_note` tool with Zod input schema: required `slug`, optional `format` (json|markdown)
    - Check `agent:read` scope, delegate to `NoteService.getNote()` or `NoteService.getNoteMarkdown()`
    - Return not-found error with `isError: true` when note doesn't exist
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 2.5_
  - [x] 3.3 Create `apps/mcp/src/tools/list-notes.js`
    - Register `list_notes` tool with Zod input schema: optional `status`, `tag`, `query`, `cursor`, `limit`
    - Check `agent:read` scope, delegate to `NoteService.listNotes()`
    - Return paginated results with `nextCursor`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 2.5_
  - [x] 3.4 Create `apps/mcp/src/tools/list-tags.js`
    - Register `list_tags` tool with no required parameters
    - Check `agent:read` scope, query tags with note counts via Prisma, sort alphabetically
    - _Requirements: 7.1, 7.2, 7.3, 2.5_

- [x] 4. Implement graph and link tools
  - [x] 4.1 Create `apps/mcp/src/tools/get-backlinks.js`
    - Register `get_backlinks` tool with Zod input schema: required `slug`
    - Check `agent:read` scope, resolve note by slug, delegate to `LinkService.getBacklinks()`
    - Return backlink notes with id, slug, title, tags; return not-found error if slug doesn't exist
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 2.5_
  - [x] 4.2 Create `apps/mcp/src/tools/get-outgoing-links.js`
    - Register `get_outgoing_links` tool with Zod input schema: required `slug`
    - Check `agent:read` scope, resolve note by slug, query Link table for `fromId`
    - Return `{ resolved: [...], unresolved: [...] }` shape
    - _Requirements: 9.1, 9.2, 9.3, 2.5_
  - [x] 4.3 Create `apps/mcp/src/tools/get-graph.js`
    - Register `get_graph` tool with Zod input schema: optional `slug`, optional `depth` (1–5, default 1)
    - Check `agent:read` scope, delegate to `LinkService.getGraph()`
    - Return `{ nodes: [...], edges: [...] }` shape
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 2.5_

- [x] 5. Implement write tools
  - [x] 5.1 Create `apps/mcp/src/tools/create-note.js`
    - Register `create_note` tool with Zod input schema: required `title` and `content`, optional `status`, `tags`
    - Check `notes:write` scope, delegate to `NoteService.createNote()`
    - Return created note's id, slug, title, status, tags
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 2.6_
  - [x] 5.2 Create `apps/mcp/src/tools/update-note.js`
    - Register `update_note` tool with Zod input schema: required `slug`, optional `title`, `content`, `status`, `tags`, `message`
    - Check `notes:write` scope, delegate to `NoteService.updateNote()`
    - Return updated note's id, slug, title, status, tags; return not-found error if slug doesn't exist
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 2.6_

- [x] 6. Checkpoint — Verify all tools register and basic flows work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Unit tests for auth and tools
  - [x] 7.1 Create `apps/mcp/test/tools/auth.test.js`
    - Test `resolveAuth` with valid/invalid/missing API keys for both transports
    - Test `checkScopes` with matching and insufficient scope sets
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 7.2 Create `apps/mcp/test/tools/search-notes.test.js`
    - Mock SearchService, verify delegation with correct args, verify output shape, verify empty query error
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 7.3 Create `apps/mcp/test/tools/read-note.test.js`
    - Mock NoteService, verify JSON and Markdown format paths, verify not-found error
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 7.4 Create `apps/mcp/test/tools/create-note.test.js`
    - Mock NoteService, verify delegation, verify output shape, verify empty title error
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [x] 7.5 Create `apps/mcp/test/tools/update-note.test.js`
    - Mock NoteService, verify delegation, verify output shape, verify not-found error
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 7.6 Create `apps/mcp/test/tools/list-notes.test.js`
    - Mock NoteService, verify pagination and filter delegation
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 7.7 Create `apps/mcp/test/tools/list-tags.test.js`
    - Mock Prisma, verify tag query, sort order, and output shape
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 7.8 Create `apps/mcp/test/tools/get-backlinks.test.js`
    - Mock NoteService and LinkService, verify delegation and not-found error
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 7.9 Create `apps/mcp/test/tools/get-outgoing-links.test.js`
    - Mock Prisma, verify resolved/unresolved split and not-found error
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 7.10 Create `apps/mcp/test/tools/get-graph.test.js`
    - Mock LinkService, verify full graph and ego-subgraph delegation, verify output shape
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 8. Property-based tests
  - [x] 8.1 Write property test for scope enforcement
    - **Property 1: Scope enforcement gates tool execution**
    - Generate random tool names and scope sets; verify tools succeed only when required scopes are present
    - **Validates: Requirements 2.5, 2.6, 2.7**
  - [x] 8.2 Write property test for search results shape
    - **Property 2: Search results contain all required fields**
    - Generate random query strings and mock SearchService results; verify every result has id, slug, title, excerpt, status, rank
    - **Validates: Requirements 3.3, 3.4**
  - [x] 8.3 Write property test for read note round-trip
    - **Property 3: Read note round-trip preserves note data**
    - Generate random note objects; verify read_note output matches stored fields
    - **Validates: Requirements 4.2**
  - [x] 8.4 Write property test for create note output
    - **Property 4: Create note output reflects created state**
    - Generate random title/content/tags; verify create_note output matches NoteService return
    - **Validates: Requirements 5.3, 5.4**
  - [x] 8.5 Write property test for update note output
    - **Property 5: Update note output reflects updated state**
    - Generate random update payloads; verify update_note output matches NoteService return
    - **Validates: Requirements 6.3, 6.4**
  - [x] 8.6 Write property test for tag list shape and sort
    - **Property 6: Tag list is complete, correctly shaped, and sorted**
    - Generate random tag arrays; verify output is sorted alphabetically and each tag has name and noteCount
    - **Validates: Requirements 7.2, 7.3**
  - [x] 8.7 Write property test for graph output shape
    - **Property 7: Graph output contains correctly shaped nodes and edges**
    - Generate random graph structures; verify every node has id/slug/title/status and every edge has fromId/toId/relation
    - **Validates: Requirements 10.4, 10.5, 10.6**
  - [x] 8.8 Write property test for validation error codes
    - **Property 8: Validation errors produce JSON-RPC error code -32602**
    - Generate invalid parameter objects for each tool; verify error code is -32602 with descriptive message
    - **Validates: Requirements 13.2**

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Agent discovery and configuration files
  - [x] 10.1 Create `apps/mcp/mcp.json` — MCP client auto-configuration file
    - Include `command`, `args`, and `env` fields as specified in the design
    - _Requirements: 12.3_
  - [x] 10.2 Update `AGENTS.md` at the repository root with MCP Server documentation
    - Document connection instructions, available tools (name, parameters, return values), authentication, and transport options
    - _Requirements: 12.1, 12.2_

- [x] 11. Final checkpoint — Ensure all tests pass and workspace is wired
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. OpenClaw convenience tools
  - [x] 12.1 Create `apps/mcp/src/tools/get-context.js`
    - Register `get_context` tool with Zod input schema: optional `topic` string, optional `limit` (1-20, default 10)
    - If `topic` provided: delegate to `SearchService.search()` for full-text search
    - If no `topic`: delegate to `NoteService.listNotes()` ordered by updatedAt desc
    - Check `agent:read` scope
    - Return array of notes with id, slug, title, excerpt, tags, updatedAt
    - _Requirements: 14.3, 14.5_
  - [x] 12.2 Create `apps/mcp/src/tools/save-memory.js`
    - Register `save_memory` tool with Zod input schema: required `title` and `content`, optional `tags`
    - Always merge `agent-memory` into tags array, set status to PUBLISHED
    - Check `notes:write` scope, delegate to `NoteService.createNote()`
    - Return created note's slug and id
    - _Requirements: 14.4, 14.5_

- [x] 13. Session context store
  - [x] 13.1 Create `apps/mcp/src/session.js` — in-memory session store
    - Implement `getSessionStore(connectionId)` returning a `Map<string, string>`
    - Implement `destroySession(connectionId)` to clean up on disconnect
    - Enforce max 100 keys per session and max 10KB per value
    - _Requirements: 15.1, 15.4, 15.6_
  - [x] 13.2 Create `apps/mcp/src/tools/set-session-context.js`
    - Register `set_session_context` tool with Zod input schema: required `key` and `value` strings
    - Store in session map, enforce limits, return `{ success: true }`
    - Check `agent:read` scope
    - _Requirements: 15.1, 15.5, 15.6_
  - [x] 13.3 Create `apps/mcp/src/tools/get-session-context.js`
    - Register `get_session_context` tool with Zod input schema: required `key` string
    - Return `{ value: string | null }`
    - Check `agent:read` scope
    - _Requirements: 15.2, 15.5_
  - [x] 13.4 Create `apps/mcp/src/tools/list-session-context.js`
    - Register `list_session_context` tool with no required parameters
    - Return `{ entries: [{ key, value }] }`
    - Check `agent:read` scope
    - _Requirements: 15.3, 15.5_
  - [x] 13.5 Wire session lifecycle into server — call `destroySession()` on connection close
    - For stdio: on process exit / stdin close
    - For HTTP: on SSE connection close
    - _Requirements: 15.4_

- [x] 14. OpenClaw skill manifest and documentation
  - [x] 14.1 Create `apps/mcp/skill.json` — ClawHub-compatible skill manifest
    - Include name, version, description, category (knowledge), mcp config, clawHub section, tool list
    - _Requirements: 14.1, 14.6_
  - [x] 14.2 Update `AGENTS.md` with OpenClaw Integration section
    - Step-by-step setup: install as skill, configure API key, verify connection
    - Document `get_context` and `save_memory` convenience tools
    - Document session context tools
    - _Requirements: 14.7_

- [x] 15. OpenClaw tests
  - [x] 15.1 Create `apps/mcp/test/tools/get-context.test.js`
    - Test with topic (search delegation), without topic (recent notes), limit enforcement
    - _Requirements: 14.3_
  - [x] 15.2 Create `apps/mcp/test/tools/save-memory.test.js`
    - Test agent-memory tag always included, status always PUBLISHED, custom tags merged
    - _Requirements: 14.4_
  - [x] 15.3 Create `apps/mcp/test/tools/session-context.test.js`
    - Test set/get/list, key limit (100), value size limit (10KB), session cleanup on destroy
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.6_
  - [x] 15.4 Write property tests for OpenClaw tools
    - **Property 9:** get_context returns relevant or recent notes within limit
    - **Property 10:** save_memory always includes agent-memory tag and PUBLISHED status
    - **Property 11:** Session context is bounded and connection-scoped
    - _Requirements: 14.3, 14.4, 15.1, 15.4, 15.6_

- [x] 16. Final checkpoint — Full MCP server with OpenClaw integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code is plain JavaScript ESM with JSDoc — no TypeScript
- Bun is the runtime; `bun test` is the test runner
- The MCP server reuses existing services — no new database tables or business logic
