# Design Document: Mycelium MCP Server

## Overview

The Mycelium MCP Server exposes the existing knowledge base as a [Model Context Protocol](https://modelcontextprotocol.io/) tool server. AI agents (Claude Desktop, Cursor, Kiro, etc.) connect over JSON-RPC via stdio or Streamable HTTP transport and invoke tools to search, read, create, update, and navigate notes, tags, and the knowledge graph.

The server is a new `apps/mcp/` workspace in the Bun monorepo. It reuses the existing Prisma client, service layer (`NoteService`, `SearchService`, `LinkService`, `AuthService`), and API key authentication — no new database tables or business logic are needed. Each MCP tool is a thin wrapper that validates input, checks scopes, delegates to an existing service method, and formats the response.

### Key Design Decisions

1. **Thin wrapper pattern** — MCP tools contain zero business logic. They validate parameters, enforce scopes, call existing services, and format output. This keeps the MCP server trivially testable and avoids duplicating logic.
2. **Shared Prisma client** — The MCP app imports `@prisma/client` and creates its own singleton, pointing at the same `DATABASE_URL`. No cross-app imports of `apps/api/src/db.js`.
3. **Plain JavaScript ESM with JSDoc** — Consistent with the rest of the monorepo. No TypeScript compilation step.
4. **`@modelcontextprotocol/sdk`** — Official MCP SDK handles JSON-RPC framing, transport negotiation, tool registration, and protocol compliance. We use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
5. **Zod for input schemas** — The MCP SDK uses Zod schemas for tool input validation. Zod is a required peer dependency.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Bun Monorepo                          │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  apps/api   │  │  apps/web   │  │    apps/mcp     │  │
│  │  (Elysia)   │  │  (React)    │  │  (MCP Server)   │  │
│  └──────┬──────┘  └─────────────┘  └────────┬────────┘  │
│         │                                    │           │
│         │         ┌─────────────┐            │           │
│         └────────▶│ packages/   │◀───────────┘           │
│                   │   shared    │                        │
│                   └─────────────┘                        │
│                          │                               │
│                   ┌──────┴──────┐                        │
│                   │   Prisma    │                        │
│                   │   Client    │                        │
│                   └──────┬──────┘                        │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ PostgreSQL  │
                    │   (5432)    │
                    └─────────────┘
```

### Transport Flow

```
┌─────────────┐   stdio (JSON-RPC)    ┌─────────────┐
│ MCP Client  │◀══════════════════════▶│  apps/mcp   │
│ (Claude,    │                        │  index.js   │
│  Cursor,    │   Streamable HTTP      │             │
│  Kiro)      │◀══════════════════════▶│  :3001      │
└─────────────┘                        └──────┬──────┘
                                              │
                                       ┌──────┴──────┐
                                       │  Services   │
                                       │ (Note,Link, │
                                       │ Search,Auth)│
                                       └──────┬──────┘
                                              │
                                       ┌──────┴──────┐
                                       │   Prisma    │
                                       └──────┬──────┘
                                              │
                                       ┌──────┴──────┐
                                       │ PostgreSQL  │
                                       └─────────────┘
```

### Workspace Layout

```
apps/mcp/
├── package.json
├── src/
│   ├── index.js          # Entry point — parse args, select transport, connect
│   ├── server.js         # McpServer factory — creates and configures the server
│   ├── auth.js           # API key resolution (env var or header)
│   ├── db.js             # Prisma client singleton (same pattern as apps/api)
│   ├── logger.js         # Structured JSON logger
│   └── tools/
│       ├── search-notes.js
│       ├── read-note.js
│       ├── create-note.js
│       ├── update-note.js
│       ├── list-notes.js
│       ├── list-tags.js
│       ├── get-backlinks.js
│       ├── get-outgoing-links.js
│       └── get-graph.js
├── test/
│   └── tools/
│       ├── search-notes.test.js
│       ├── read-note.test.js
│       ├── create-note.test.js
│       ├── update-note.test.js
│       ├── list-notes.test.js
│       ├── list-tags.test.js
│       ├── get-backlinks.test.js
│       ├── get-outgoing-links.test.js
│       ├── get-graph.test.js
│       └── auth.test.js
└── mcp.json              # Client auto-configuration
```

## Components and Interfaces

### 1. Entry Point (`src/index.js`)

Parses CLI arguments to determine transport mode, then starts the server.

```js
// Usage:
//   bun run apps/mcp/src/index.js                    → stdio (default)
//   bun run apps/mcp/src/index.js --transport=http   → Streamable HTTP on MCP_PORT
```

**Responsibilities:**
- Parse `--transport=stdio|http` flag (default: `stdio`)
- For stdio: create `StdioServerTransport`, connect server
- For HTTP: create Express app with Streamable HTTP transport on `MCP_PORT` (default 3001)
- Validate `DATABASE_URL` connectivity at startup; exit with code 1 on failure
- Log startup info as structured JSON

### 2. Server Factory (`src/server.js`)

Creates and configures the `McpServer` instance with all tools registered.

```js
/**
 * @param {{ userId: string, scopes: string[] }} authContext
 * @returns {McpServer}
 */
export function createServer(authContext) { ... }
```

**Responsibilities:**
- Instantiate `McpServer` with name `"mycelium-mcp"` and version from package.json
- Register all 9 tools via `server.registerTool()`
- Bind `authContext` (userId, scopes) into each tool handler's closure
- Return the configured server instance

### 3. Auth Handler (`src/auth.js`)

Resolves and validates the API key depending on transport.

```js
/**
 * Resolve auth context from environment (stdio) or request header (HTTP).
 *
 * @param {'stdio' | 'http'} transport
 * @param {Request} [request] - HTTP request (only for HTTP transport)
 * @returns {Promise<{ userId: string, scopes: string[] }>}
 * @throws {Error} If API key is missing or invalid
 */
export async function resolveAuth(transport, request) { ... }
```

| Transport | Key Source | Timing |
|-----------|-----------|--------|
| stdio | `MYCELIUM_API_KEY` env var | Once at startup |
| HTTP | `Authorization: Bearer <key>` header | Per HTTP connection |

Both paths delegate to `AuthService.verifyApiKey()` from the existing auth service code (copied into the MCP app as a local module to avoid cross-app imports).

### 4. Scope Enforcement

Each tool declares its required scopes. The tool handler checks scopes before executing:

```js
const TOOL_SCOPES = {
  search_notes:       ['agent:read'],
  read_note:          ['agent:read'],
  list_notes:         ['agent:read'],
  list_tags:          ['agent:read'],
  get_backlinks:      ['agent:read'],
  get_outgoing_links: ['agent:read'],
  get_graph:          ['agent:read'],
  create_note:        ['notes:write'],
  update_note:        ['notes:write'],
};
```

A shared `checkScopes(requiredScopes, userScopes)` helper returns an error result if any required scope is missing.

### 5. Tool Registry Pattern

Each tool file exports a `register(server, authContext)` function:

```js
// tools/search-notes.js
import { z } from 'zod';
import { SearchService } from '../services/search.service.js';
import { checkScopes } from '../auth.js';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ userId: string, scopes: string[] }} auth
 */
export function register(server, auth) {
  server.registerTool(
    'search_notes',
    {
      title: 'Search Notes',
      description: 'Full-text search across the knowledge base',
      inputSchema: {
        query: z.string().min(1, 'query is required'),
        tag: z.string().optional(),
        status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ query, tag, status, limit }) => {
      const scopeError = checkScopes(['agent:read'], auth.scopes);
      if (scopeError) return scopeError;

      const result = await SearchService.search(auth.userId, query, { tag, status, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify(result.notes) }],
      };
    },
  );
}
```

### 6. Database Client (`src/db.js`)

Same singleton pattern as `apps/api/src/db.js`:

```js
import { PrismaClient } from '@prisma/client';
const prisma = globalThis.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;
export { prisma };
```

### 7. Logger (`src/logger.js`)

Structured JSON logger consistent with the API's logging format:

```js
/**
 * @param {'info' | 'warn' | 'error' | 'debug'} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
export function log(level, message, meta = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
  console.log(JSON.stringify(entry));
}
```

Tool invocations are wrapped with timing:

```js
const start = performance.now();
try {
  const result = await handler(params);
  log('info', 'tool.call', { tool: name, durationMs: performance.now() - start, success: true });
  return result;
} catch (err) {
  log('error', 'tool.call', { tool: name, durationMs: performance.now() - start, success: false, error: err.message });
  throw err;
}
```

## Data Models

No new database tables are required. The MCP server operates on the existing Prisma schema:

### Existing Models Used

| Model | Used By Tools |
|-------|--------------|
| `Note` | search_notes, read_note, create_note, update_note, list_notes |
| `Tag` | list_tags, (embedded in note responses) |
| `Link` | get_backlinks, get_outgoing_links, get_graph |
| `ApiKey` | Auth resolution |
| `User` | Auth resolution (owner of API key) |

### Tool Input/Output Schemas


#### `search_notes`

- **Required scopes:** `agent:read`
- **Service method:** `SearchService.search(userId, query, { tag, status, limit })`

**Input Schema:**
```json
{
  "query": { "type": "string", "minLength": 1, "description": "Full-text search query" },
  "tag": { "type": "string", "description": "Filter by tag name (optional)" },
  "status": { "type": "string", "enum": ["DRAFT", "PUBLISHED", "ARCHIVED"], "description": "Filter by note status (optional)" },
  "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "Max results to return (optional, default 20)" }
}
```

**Output:** Array of matching notes:
```json
[
  { "id": "string", "slug": "string", "title": "string", "excerpt": "string|null", "status": "string", "rank": "number" }
]
```

#### `read_note`

- **Required scopes:** `agent:read`
- **Service method:** `NoteService.getNote(userId, slug)` or `NoteService.getNoteMarkdown(userId, slug)`

**Input Schema:**
```json
{
  "slug": { "type": "string", "minLength": 1, "description": "Note slug identifier" },
  "format": { "type": "string", "enum": ["json", "markdown"], "default": "json", "description": "Response format (optional)" }
}
```

**Output (json format):**
```json
{
  "id": "string", "slug": "string", "title": "string", "content": "string",
  "excerpt": "string|null", "status": "string", "tags": ["string"], "updatedAt": "ISO 8601"
}
```

**Output (markdown format):** Raw Markdown string with YAML frontmatter.

#### `create_note`

- **Required scopes:** `notes:write`
- **Service method:** `NoteService.createNote(userId, { title, content, status, tags })`

**Input Schema:**
```json
{
  "title": { "type": "string", "minLength": 1, "description": "Note title" },
  "content": { "type": "string", "description": "Markdown content body" },
  "status": { "type": "string", "enum": ["DRAFT", "PUBLISHED", "ARCHIVED"], "default": "DRAFT", "description": "Note status (optional)" },
  "tags": { "type": "array", "items": { "type": "string" }, "description": "Tag names (optional)" }
}
```

**Output:**
```json
{ "id": "string", "slug": "string", "title": "string", "status": "string", "tags": ["string"] }
```

#### `update_note`

- **Required scopes:** `notes:write`
- **Service method:** `NoteService.updateNote(userId, slug, { title, content, status, tags, message })`

**Input Schema:**
```json
{
  "slug": { "type": "string", "minLength": 1, "description": "Note slug to update" },
  "title": { "type": "string", "description": "New title (optional)" },
  "content": { "type": "string", "description": "New Markdown content (optional)" },
  "status": { "type": "string", "enum": ["DRAFT", "PUBLISHED", "ARCHIVED"], "description": "New status (optional)" },
  "tags": { "type": "array", "items": { "type": "string" }, "description": "Replace tags (optional)" },
  "message": { "type": "string", "description": "Revision message (optional)" }
}
```

**Output:**
```json
{ "id": "string", "slug": "string", "title": "string", "status": "string", "tags": ["string"] }
```

#### `list_notes`

- **Required scopes:** `agent:read`
- **Service method:** `NoteService.listNotes(userId, { status, tag, q, cursor, limit })`

**Input Schema:**
```json
{
  "status": { "type": "string", "enum": ["DRAFT", "PUBLISHED", "ARCHIVED"], "description": "Filter by status (optional)" },
  "tag": { "type": "string", "description": "Filter by tag name (optional)" },
  "query": { "type": "string", "description": "Title/content substring search (optional)" },
  "cursor": { "type": "string", "description": "Pagination cursor (optional)" },
  "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "Page size (optional, default 20)" }
}
```

**Output:**
```json
{
  "notes": [
    { "id": "string", "slug": "string", "title": "string", "excerpt": "string|null", "status": "string", "tags": ["string"], "updatedAt": "ISO 8601" }
  ],
  "nextCursor": "string|null"
}
```

#### `list_tags`

- **Required scopes:** `agent:read`
- **Service method:** Direct Prisma query (same as `tags.routes.js`)

**Input Schema:** *(no parameters)*

**Output:**
```json
{
  "tags": [
    { "name": "string", "noteCount": "number" }
  ]
}
```

#### `get_backlinks`

- **Required scopes:** `agent:read`
- **Service method:** `NoteService.getNote(userId, slug)` → `LinkService.getBacklinks(noteId)`

**Input Schema:**
```json
{
  "slug": { "type": "string", "minLength": 1, "description": "Target note slug" }
}
```

**Output:**
```json
[
  { "id": "string", "slug": "string", "title": "string", "tags": ["string"] }
]
```

#### `get_outgoing_links`

- **Required scopes:** `agent:read`
- **Service method:** Direct Prisma query on `Link` table for `fromId`

**Input Schema:**
```json
{
  "slug": { "type": "string", "minLength": 1, "description": "Source note slug" }
}
```

**Output:**
```json
{
  "resolved": [
    { "id": "string", "slug": "string", "title": "string" }
  ],
  "unresolved": [
    { "title": "string" }
  ]
}
```

#### `get_graph`

- **Required scopes:** `agent:read`
- **Service method:** `LinkService.getGraph(userId, { slug, depth })`

**Input Schema:**
```json
{
  "slug": { "type": "string", "description": "Center note slug for ego-subgraph (optional)" },
  "depth": { "type": "integer", "minimum": 1, "maximum": 5, "default": 1, "description": "BFS depth from center note (optional)" }
}
```

**Output:**
```json
{
  "nodes": [
    { "id": "string", "slug": "string", "title": "string", "status": "string" }
  ],
  "edges": [
    { "fromId": "string", "toId": "string", "relation": "string|null" }
  ]
}
```

## Data Flow

A complete tool invocation flows through these layers:

```
MCP Client (Claude/Cursor/Kiro)
  │
  │  JSON-RPC request: { method: "tools/call", params: { name: "search_notes", arguments: { query: "wikilinks" } } }
  ▼
Transport Layer (StdioServerTransport or Streamable HTTP)
  │
  │  Deserialize JSON-RPC → route to tool handler
  ▼
McpServer (SDK)
  │
  │  Match tool name → invoke registered handler
  ▼
Tool Handler (e.g. tools/search-notes.js)
  │
  │  1. checkScopes(['agent:read'], auth.scopes)
  │  2. SearchService.search(auth.userId, 'wikilinks', {})
  │  3. Format result as MCP content
  ▼
Service Layer (SearchService / NoteService / LinkService)
  │
  │  Business logic + Prisma queries
  ▼
Prisma Client
  │
  │  SQL query
  ▼
PostgreSQL
  │
  │  Result rows
  ▼
(Response bubbles back up through each layer)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Scope enforcement gates tool execution

*For any* tool invocation and *any* API key, the tool SHALL succeed only if the API key's scopes include all scopes required by that tool. Read tools require `agent:read`; write tools (`create_note`, `update_note`) require `notes:write`. If any required scope is missing, the tool SHALL return an error indicating insufficient permissions.

**Validates: Requirements 2.5, 2.6, 2.7**

### Property 2: Search results contain all required fields

*For any* valid `search_notes` invocation with a non-empty query, every note object in the result array SHALL contain the fields `id`, `slug`, `title`, `excerpt`, `status`, and `rank`, and the results SHALL match what `SearchService.search` returns for the authenticated user.

**Validates: Requirements 3.3, 3.4**

### Property 3: Read note round-trip preserves note data

*For any* note that exists in the database, invoking `read_note` with that note's slug SHALL return a JSON object whose `id`, `slug`, `title`, `content`, `excerpt`, `status`, `tags`, and `updatedAt` fields match the note as stored by `NoteService`.

**Validates: Requirements 4.2**

### Property 4: Create note output reflects created state

*For any* valid `title` (non-empty string) and `content` string, invoking `create_note` SHALL delegate to `NoteService.createNote` and return an object containing `id`, `slug`, `title`, `status`, and `tags` that match the created note.

**Validates: Requirements 5.3, 5.4**

### Property 5: Update note output reflects updated state

*For any* existing note slug and *any* valid update payload (optional title, content, status, tags, message), invoking `update_note` SHALL delegate to `NoteService.updateNote` and return an object containing `id`, `slug`, `title`, `status`, and `tags` that match the updated note.

**Validates: Requirements 6.3, 6.4**

### Property 6: Tag list is complete, correctly shaped, and sorted

*For any* authenticated user, invoking `list_tags` SHALL return all tags associated with that user's non-archived notes. Each tag object SHALL contain `name` (string) and `noteCount` (number), and the array SHALL be sorted alphabetically by `name`.

**Validates: Requirements 7.2, 7.3**

### Property 7: Graph output contains correctly shaped nodes and edges

*For any* `get_graph` invocation (with or without `slug` and `depth`), every node in the result SHALL contain `id`, `slug`, `title`, and `status`, and every edge SHALL contain `fromId`, `toId`, and `relation`. The result SHALL match what `LinkService.getGraph` returns for the authenticated user.

**Validates: Requirements 10.4, 10.5, 10.6**

### Property 8: Validation errors produce JSON-RPC error code -32602

*For any* tool invoked with parameters that violate its input schema (missing required fields, wrong types, out-of-range values), the server SHALL return a JSON-RPC error with code `-32602` (Invalid params) and a human-readable message describing the validation failure.

**Validates: Requirements 13.2**

## Error Handling

### Error Categories and Responses

| Error Type | JSON-RPC Code | `isError` | `isRetryable` | Example |
|-----------|--------------|-----------|---------------|---------|
| Validation error | -32602 | true | false | Missing required `query` param |
| Auth error (missing/invalid key) | -32603 | true | false | Invalid API key |
| Scope error (insufficient perms) | -32603 | true | false | Key lacks `notes:write` |
| Not found | N/A (tool-level) | true | false | Note slug doesn't exist |
| Database error | -32603 | true | true | Connection timeout |
| Parse error | -32700 | true | false | Malformed JSON-RPC |
| Method not found | -32601 | true | false | Unknown JSON-RPC method |

### Error Response Format

Tool-level errors (not found, scope errors) return MCP content with `isError: true`:

```js
return {
  content: [{ type: 'text', text: JSON.stringify({ error: 'Note not found', slug }) }],
  isError: true,
};
```

Protocol-level errors (parse, method not found, validation) are handled by the MCP SDK and returned as standard JSON-RPC error responses.

Database errors are caught by a wrapper around each tool handler that logs the error and returns a retryable error:

```js
return {
  content: [{ type: 'text', text: JSON.stringify({ error: 'Database error', message: err.message, isRetryable: true }) }],
  isError: true,
};
```

### Startup Validation

On startup, the server:
1. Validates `DATABASE_URL` by attempting a Prisma connection (`prisma.$connect()`)
2. For stdio: validates `MYCELIUM_API_KEY` env var is set and resolves to a valid API key
3. Exits with code 1 and a structured JSON log entry on any failure

## Testing Strategy

### Unit Tests (per tool)

Each tool gets a dedicated test file that mocks the underlying service and verifies:
- Correct delegation to the service method with the right arguments
- Output shape matches the expected schema
- Error cases (not found, empty required params) return appropriate errors
- Scope enforcement rejects unauthorized calls

### Property-Based Tests

Property-based testing is appropriate for this feature because the MCP tools are pure-function wrappers: given an auth context and input parameters, they produce deterministic output by delegating to services. The input space (various parameter combinations, scope sets, note data shapes) is large enough that PBT adds value over example-based tests alone.

**Library:** [fast-check](https://github.com/dubzzz/fast-check) (JavaScript PBT library, works with Bun test runner)

**Configuration:**
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: mcp-server, Property {N}: {description}`

**Properties to implement:**
1. Scope enforcement (Property 1) — generate random tool names and scope sets
2. Search results shape (Property 2) — generate random query strings and mock SearchService results
3. Read note round-trip (Property 3) — generate random note objects
4. Create note output (Property 4) — generate random title/content/tags
5. Update note output (Property 5) — generate random update payloads
6. Tag list shape and sort order (Property 6) — generate random tag arrays
7. Graph output shape (Property 7) — generate random graph structures
8. Validation error codes (Property 8) — generate invalid parameter objects for each tool

### Integration Tests

- Spawn the MCP server as a child process with stdio transport
- Send `initialize`, `ping`, and tool call requests over stdin
- Verify JSON-RPC responses on stdout
- Test with valid and invalid API keys
- Test with a real (test) database

### Smoke Tests

- Server starts successfully with valid config
- Server exits with code 1 when `DATABASE_URL` is invalid
- Server exits with code 1 when `MYCELIUM_API_KEY` is invalid (stdio mode)
- `mcp.json` is valid JSON with expected structure

## Configuration

### `mcp.json` (Client Auto-Configuration)

Located at `apps/mcp/mcp.json`, this file allows MCP clients to auto-discover and configure the Mycelium server:

```json
{
  "mcpServers": {
    "mycelium": {
      "command": "bun",
      "args": ["run", "apps/mcp/src/index.js"],
      "env": {
        "MYCELIUM_API_KEY": "",
        "DATABASE_URL": ""
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `MYCELIUM_API_KEY` | stdio only | — | API key for stdio transport auth |
| `MCP_PORT` | HTTP only | `3001` | HTTP port for Streamable HTTP transport |
| `MCP_TRANSPORT` | No | `stdio` | Transport mode: `stdio` or `http` |
| `NODE_ENV` | No | `development` | Environment mode |

### `package.json` for `apps/mcp`

```json
{
  "name": "@mycelium/mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun src/index.js",
    "start:http": "MCP_TRANSPORT=http bun src/index.js",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1",
    "@mycelium/shared": "workspace:*",
    "@prisma/client": "^6",
    "zod": "^3",
    "express": "^5"
  },
  "devDependencies": {
    "fast-check": "^4",
    "prisma": "^6"
  }
}
```

The root `package.json` workspaces array must be updated to include `"apps/mcp"`.


## OpenClaw Integration

### Architecture

OpenClaw agents connect to the Mycelium MCP Server as a "skill" — a plugin that provides tools the agent can invoke during its workflow. The integration adds three components:

1. **Convenience tools** (`get_context`, `save_memory`) — optimized for OpenClaw's read-write memory loop
2. **Session context store** (`set_session_context`, `get_session_context`, `list_session_context`) — ephemeral working memory per connection
3. **Skill manifest** (`skill.json`) — ClawHub-compatible descriptor for installation

```
OpenClaw Agent
  │
  │  1. Session start → get_context("project alpha")
  │  2. Work phase → read_note, search_notes, get_backlinks...
  │  3. Session end → save_memory("Research findings", "...")
  │
  ▼
Mycelium MCP Server
  │
  ├── get_context → SearchService.search() or NoteService.listNotes()
  ├── save_memory → NoteService.createNote() with tag "agent-memory"
  ├── set/get/list_session_context → in-memory Map per connection
  └── (all existing tools also available)
```

### Convenience Tools

#### `get_context`

Optimized for OpenClaw's session-start context loading. Returns the most relevant notes for a topic, or recent notes if no topic given.

```js
// tools/get-context.js
server.registerTool('get_context', {
  title: 'Get Context',
  description: 'Load relevant notes for a topic (or recent notes). Optimized for session-start context loading.',
  inputSchema: {
    topic: z.string().optional().describe('Topic to search for. If omitted, returns most recently updated notes.'),
    limit: z.number().int().min(1).max(20).optional().default(10),
  },
}, async ({ topic, limit }) => {
  // If topic provided: full-text search
  // If no topic: list notes ordered by updatedAt desc
});
```

**Required scopes:** `agent:read`

**Output:** Array of notes with id, slug, title, excerpt, tags, updatedAt.

#### `save_memory`

Optimized for OpenClaw's session-end memory filing. Creates a published note tagged with `agent-memory`.

```js
// tools/save-memory.js
server.registerTool('save_memory', {
  title: 'Save Memory',
  description: 'Save a finding or summary as a note. Auto-tagged with "agent-memory".',
  inputSchema: {
    title: z.string().min(1),
    content: z.string(),
    tags: z.array(z.string()).optional(),
  },
}, async ({ title, content, tags }) => {
  const allTags = [...new Set([...(tags ?? []), 'agent-memory'])];
  const note = await NoteService.createNote(userId, { title, content, status: 'PUBLISHED', tags: allTags });
  return { content: [{ type: 'text', text: JSON.stringify({ slug: note.slug, id: note.id }) }] };
});
```

**Required scopes:** `notes:write`

### Session Context Store

An in-memory `Map<string, string>` per MCP connection. Discarded when the connection closes.

```js
// src/session.js

/** @type {Map<string, Map<string, string>>} connectionId → key-value store */
const sessions = new Map();

export function getSessionStore(connectionId) {
  if (!sessions.has(connectionId)) sessions.set(connectionId, new Map());
  return sessions.get(connectionId);
}

export function destroySession(connectionId) {
  sessions.delete(connectionId);
}
```

**Limits:**
- Max 100 keys per session
- Max 10KB per value
- Validation errors returned if limits exceeded

**Tools:**
- `set_session_context({ key, value })` → stores key-value, returns `{ success: true }`
- `get_session_context({ key })` → returns `{ value: string | null }`
- `list_session_context()` → returns `{ entries: [{ key, value }] }`

**Required scopes:** `agent:read` (ephemeral, not persisted)

### Skill Manifest (`skill.json`)

Located at `apps/mcp/skill.json`, compatible with ClawHub:

```json
{
  "name": "mycelium-knowledge-base",
  "version": "0.1.0",
  "description": "Persistent knowledge base for AI agents. Search, read, create, and link notes.",
  "category": "knowledge",
  "author": "Mycelium",
  "license": "MIT",
  "mcp": {
    "command": "bun",
    "args": ["run", "apps/mcp/src/index.js"],
    "env": {
      "MYCELIUM_API_KEY": { "required": true, "description": "API key with agent:read and notes:write scopes" },
      "DATABASE_URL": { "required": true, "description": "PostgreSQL connection string" }
    },
    "transport": "stdio"
  },
  "clawHub": {
    "compatibleVersions": ">=2026.4.0",
    "installInstructions": "See AGENTS.md for setup guide"
  },
  "tools": [
    "search_notes", "read_note", "create_note", "update_note", "list_notes",
    "list_tags", "get_backlinks", "get_outgoing_links", "get_graph",
    "get_context", "save_memory",
    "set_session_context", "get_session_context", "list_session_context"
  ]
}
```

### Correctness Properties (additions)

#### Property 9: get_context returns relevant or recent notes

*For any* `get_context` invocation, if a `topic` is provided the results SHALL be ordered by search relevance, and if no `topic` is provided the results SHALL be ordered by `updatedAt` descending. The result count SHALL not exceed the `limit` parameter.

**Validates: Requirements 14.3**

#### Property 10: save_memory always includes agent-memory tag

*For any* `save_memory` invocation with valid title and content, the created note SHALL have status `PUBLISHED` and its tags SHALL include `"agent-memory"` regardless of whether additional tags were provided.

**Validates: Requirements 14.4**

#### Property 11: Session context is connection-scoped and bounded

*For any* session, the number of stored keys SHALL not exceed 100, and each value SHALL not exceed 10KB. After the connection closes, `get_session_context` for any key from that session SHALL return null.

**Validates: Requirements 15.1, 15.4, 15.6**
