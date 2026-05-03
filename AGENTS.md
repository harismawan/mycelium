# Mycelium Agent API

Mycelium exposes a set of machine-friendly REST endpoints designed for AI agent consumption. These endpoints live under `/api/v1/agent` and provide discovery, bulk export, and simplified note listing for programmatic access to the knowledge base.

## Authentication

All agent endpoints require an API key passed as a Bearer token in the `Authorization` header.

```
Authorization: Bearer <api_key>
```

API keys are scoped. Agent endpoints require the `agent:read` scope. Keys are created by authenticated human users through the `POST /api/v1/api-keys` endpoint and can be revoked at any time.

### Required Scopes

| Scope | Description |
|---|---|
| `agent:read` | Access agent-specific endpoints (manifest, bundle, notes) |

### Demo API Key

A demo key is created by the seed script for local development and testing:

```
myc_demo_agent_key_for_testing
```

This key has `notes:read` and `agent:read` scopes.

## Endpoints

### GET /api/v1/agent/manifest

Returns a JSON manifest describing the agent API — available endpoints, content schema, and authentication requirements. Use this as a discovery endpoint to understand what the API offers before making further requests.

#### Response Schema

```json
{
  "apiVersion": "v1",
  "endpoints": [
    {
      "path": "/api/v1/agent/manifest",
      "method": "GET",
      "description": "Returns this manifest describing the agent API."
    },
    {
      "path": "/api/v1/agent/bundle",
      "method": "GET",
      "description": "Streams all PUBLISHED notes as newline-delimited JSON (NDJSON).",
      "contentType": "application/x-ndjson"
    },
    {
      "path": "/api/v1/agent/notes",
      "method": "GET",
      "description": "Returns a simplified paginated list of notes for agent consumption.",
      "contentType": "application/json"
    }
  ],
  "contentSchema": {
    "note": {
      "id": "string",
      "slug": "string",
      "title": "string",
      "excerpt": "string | null",
      "tags": "string[]",
      "updatedAt": "ISO 8601 datetime"
    }
  },
  "auth": {
    "type": "Bearer",
    "header": "Authorization",
    "description": "Requires a valid API key with the \"agent:read\" scope passed as a Bearer token.",
    "requiredScopes": ["agent:read"]
  }
}
```

#### Example

```bash
curl -s http://localhost:3000/api/v1/agent/manifest \
  -H "Authorization: Bearer myc_demo_agent_key_for_testing"
```

---

### GET /api/v1/agent/bundle

Streams all PUBLISHED notes as newline-delimited JSON (NDJSON). Each line is a self-contained JSON object representing a single note. This allows agents to process notes incrementally without buffering the entire knowledge base in memory.

Notes are ordered by creation date (ascending) and streamed in batches.

#### Response

- Content-Type: `application/x-ndjson`
- Each line is a valid JSON object terminated by `\n`

#### Response Schema (per line)

```json
{
  "id": "string",
  "slug": "string",
  "title": "string",
  "content": "string (pure Markdown body, no frontmatter)",
  "excerpt": "string | null",
  "frontmatter": "object | null",
  "tags": ["string"],
  "updatedAt": "ISO 8601 datetime"
}
```

#### Example

```bash
curl -s http://localhost:3000/api/v1/agent/bundle \
  -H "Authorization: Bearer myc_demo_agent_key_for_testing"
```

Sample output (each line is a separate JSON object):

```
{"id":"clx...","slug":"getting-started-with-mycelium","title":"Getting Started with Mycelium","content":"# Getting Started with Mycelium\n\nWelcome to Mycelium...","excerpt":"Welcome to Mycelium...","frontmatter":null,"tags":["guide","onboarding"],"updatedAt":"2026-04-27T00:00:00.000Z"}
{"id":"clx...","slug":"how-wikilinks-work","title":"How Wikilinks Work","content":"# How Wikilinks Work\n\nWikilinks let you connect...","excerpt":"Wikilinks let you connect...","frontmatter":null,"tags":["guide","linking"],"updatedAt":"2026-04-27T00:00:00.000Z"}
```

---

### GET /api/v1/agent/notes

Returns a simplified paginated list of PUBLISHED notes optimized for agent consumption. Only includes fields useful for agents: id, slug, title, excerpt, tags, and updatedAt. Uses cursor-based pagination.

#### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `cursor` | string | — | ID of the last item from the previous page. Omit for the first page. |
| `limit` | string (integer) | `20` | Number of notes to return per page (max determined by server). |

#### Response Schema

```json
{
  "notes": [
    {
      "id": "string",
      "slug": "string",
      "title": "string",
      "excerpt": "string | null",
      "tags": ["string"],
      "updatedAt": "ISO 8601 datetime"
    }
  ],
  "nextCursor": "string | null"
}
```

When `nextCursor` is `null`, there are no more pages.

#### Example

Fetch the first page:

```bash
curl -s http://localhost:3000/api/v1/agent/notes \
  -H "Authorization: Bearer myc_demo_agent_key_for_testing"
```

Fetch the next page using the cursor from the previous response:

```bash
curl -s "http://localhost:3000/api/v1/agent/notes?cursor=clx...&limit=10" \
  -H "Authorization: Bearer myc_demo_agent_key_for_testing"
```

## Error Responses

All agent endpoints return standard error responses:

| Status | Meaning |
|---|---|
| `401 Unauthorized` | Missing, invalid, or revoked API key |
| `403 Forbidden` | API key lacks the required `agent:read` scope |
| `500 Internal Server Error` | Unexpected server error |

---

# Mycelium MCP Server

In addition to the REST agent API, Mycelium ships an [MCP](https://modelcontextprotocol.io/) server (`packages/mcp/`) that exposes the knowledge base to AI agents (Claude Desktop, Cursor, Kiro, etc.) over JSON-RPC. The MCP server reuses the existing services and API key authentication — no separate credential system.

## Connecting

The server supports two transports:

| Transport | When to use | API key source |
|---|---|---|
| `stdio` (default) | Local clients (Claude Desktop, Cursor, Kiro) that spawn the server as a subprocess | `MYCELIUM_API_KEY` env var |
| `http` (Streamable HTTP) | Remote clients or shared deployments | `Authorization: Bearer <key>` header |

### stdio (auto-configuration)

MCP clients can auto-discover the server using the `packages/mcp/mcp.json` config:

```json
{
  "mcpServers": {
    "mycelium": {
      "command": "bun",
      "args": ["run", "packages/mcp/src/index.js"],
      "env": {
        "MYCELIUM_API_KEY": "",
        "DATABASE_URL": ""
      }
    }
  }
}
```

Copy the entry into your client's MCP config, fill in `MYCELIUM_API_KEY` and `DATABASE_URL`, and restart the client.

Equivalent manual command:

```bash
MYCELIUM_API_KEY=myc_... DATABASE_URL=postgres://... bun run packages/mcp/src/index.js
```

### Streamable HTTP

```bash
MCP_TRANSPORT=http MCP_PORT=3001 DATABASE_URL=postgres://... bun run packages/mcp/src/index.js
```

Clients POST JSON-RPC to `http://<host>:3001/mcp` with `Authorization: Bearer <key>`.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `MYCELIUM_API_KEY` | stdio only | — | API key for stdio transport |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` or `http` |
| `MCP_PORT` | http only | `3001` | HTTP listen port |

## Authentication and Scopes

Every tool invocation is authenticated against the existing `ApiKey` table and authorized by scope.

| Scope | Grants |
|---|---|
| `agent:read` | All read tools (search, read, list, graph, links, tags) |
| `notes:write` | `create_note`, `update_note` |

Missing or invalid keys cause the server to refuse tool execution. Insufficient scopes return a JSON-RPC error.

## Tools

All tools accept a JSON object as input and return MCP `text` content containing JSON. Validation errors return JSON-RPC code `-32602`. Not-found errors are returned as tool-level errors with `isError: true`.

### `search_notes` — full-text search

Required scopes: `agent:read`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string (min 1) | yes | Full-text search query |
| `tag` | string | no | Filter by tag name |
| `status` | `DRAFT` \| `PUBLISHED` \| `ARCHIVED` | no | Filter by status |
| `limit` | integer (1–100) | no | Max results (default 20) |

Returns: array of `{ id, slug, title, excerpt, status, rank }`.

### `read_note` — fetch a note by slug

Required scopes: `agent:read`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string (min 1) | yes | Note slug |
| `format` | `json` \| `markdown` | no | Response format (default `json`) |

Returns (`json`): `{ id, slug, title, content, excerpt, status, tags, updatedAt }`.
Returns (`markdown`): raw Markdown string with YAML frontmatter.

### `list_notes` — paginated list with filters

Required scopes: `agent:read`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `status` | `DRAFT` \| `PUBLISHED` \| `ARCHIVED` | no | Filter by status |
| `tag` | string | no | Filter by tag name |
| `query` | string | no | Title/content substring search |
| `cursor` | string | no | Pagination cursor |
| `limit` | integer (1–100) | no | Page size (default 20) |

Returns: `{ notes: [{ id, slug, title, excerpt, status, tags, updatedAt }], nextCursor }`.

### `list_tags` — all tags with note counts

Required scopes: `agent:read`. No parameters.

Returns: `{ tags: [{ name, noteCount }] }`, sorted alphabetically by name.

### `get_backlinks` — notes that link to a target

Required scopes: `agent:read`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string (min 1) | yes | Target note slug |

Returns: array of `{ id, slug, title, tags }`.

### `get_outgoing_links` — wikilinks from a note

Required scopes: `agent:read`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string (min 1) | yes | Source note slug |

Returns: `{ resolved: [{ id, slug, title }], unresolved: [{ title }] }`.

### `get_graph` — knowledge graph or ego-subgraph

Required scopes: `agent:read`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | no | Center note for ego-subgraph (omit for full graph) |
| `depth` | integer (1–5) | no | BFS depth from center note (default 1) |

Returns: `{ nodes: [{ id, slug, title, status }], edges: [{ fromId, toId, relation }] }`.

### `create_note` — create a new note

Required scopes: `notes:write`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string (min 1) | yes | Note title |
| `content` | string | yes | Markdown body |
| `status` | `DRAFT` \| `PUBLISHED` \| `ARCHIVED` | no | Status (default `DRAFT`) |
| `tags` | string[] | no | Tag names |

Returns: `{ id, slug, title, status, tags }`.

### `update_note` — update an existing note

Required scopes: `notes:write`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string (min 1) | yes | Note slug to update |
| `title` | string | no | New title |
| `content` | string | no | New Markdown body |
| `status` | `DRAFT` \| `PUBLISHED` \| `ARCHIVED` | no | New status |
| `tags` | string[] | no | Replacement tag set |
| `message` | string | no | Revision message |

Returns: `{ id, slug, title, status, tags }`.

## Error Codes

| Code | Meaning |
|---|---|
| `-32700` | Malformed JSON-RPC |
| `-32601` | Unknown JSON-RPC method |
| `-32602` | Validation error (invalid params) |
| `-32603` | Auth, scope, or database error |

Database errors set `isRetryable: true` in the error payload. Tool-level errors (e.g. note not found) return `isError: true` MCP content with a descriptive payload.

---

# OpenClaw Integration

Mycelium works as a persistent knowledge store for [OpenClaw](https://openclaw.dev) agents. Install it as a skill and your agent gets full read-write access to the knowledge base — search, create, link, and recall notes across sessions.

## Installation

### Via ClawHub

```bash
claw install mycelium-knowledge-base
```

### Manual

Copy the `packages/mcp/skill.json` manifest into your OpenClaw skills directory, or add the MCP entry directly to your agent config:

```json
{
  "mcpServers": {
    "mycelium": {
      "command": "bun",
      "args": ["run", "packages/mcp/src/index.js"],
      "env": {
        "MYCELIUM_API_KEY": "<your_api_key>",
        "DATABASE_URL": "<your_postgres_connection_string>"
      }
    }
  }
}
```

## Configuration

Two environment variables are required:

| Variable | Required | Description |
|---|---|---|
| `MYCELIUM_API_KEY` | yes | API key with `agent:read` and `notes:write` scopes |
| `DATABASE_URL` | yes | PostgreSQL connection string (e.g. `postgres://user:pass@localhost:5432/mycelium`) |

Create an API key through the Mycelium web UI or via the REST API:

```bash
curl -s -X POST http://localhost:3000/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user_token>" \
  -d '{"name": "openclaw-agent", "scopes": ["agent:read", "notes:write"]}'
```

## Verify Connection

After configuring the skill, verify the MCP server connects and tools are available:

```bash
# Start the server manually to test
MYCELIUM_API_KEY=myc_... DATABASE_URL=postgres://... bun run packages/mcp/src/index.js
```

From your OpenClaw agent, invoke `list_notes` with an empty filter. A successful response confirms authentication, database connectivity, and tool registration:

```json
{ "notes": [], "nextCursor": null }
```

If the API key is missing or invalid, the server returns a JSON-RPC error with code `-32603`. If the database is unreachable, the server exits with a non-zero exit code at startup.

## Convenience Tools

These tools are optimized for OpenClaw's read-write memory loop: load context at session start, do work, file findings at session end.

### `get_context` — load relevant notes

Fetches the most relevant notes for a topic via full-text search, or the most recently updated notes if no topic is provided. Designed for session-start context loading.

Required scopes: `agent:read`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `topic` | string | no | — | Topic to search for. If omitted, returns most recently updated notes. |
| `limit` | integer (1–20) | no | `10` | Maximum number of notes to return |

Returns: array of note objects.

```json
[
  {
    "id": "clx...",
    "slug": "project-alpha-notes",
    "title": "Project Alpha Notes",
    "excerpt": "Summary of findings...",
    "tags": ["research", "agent-memory"],
    "updatedAt": "2026-04-27T12:00:00.000Z"
  }
]
```

Example usage pattern:

```
1. Session start → get_context({ topic: "project alpha" })
2. Agent reads returned notes for background context
3. Agent proceeds with its task using the loaded context
```

### `save_memory` — file a finding as a note

Creates a published note auto-tagged with `agent-memory`. Designed for session-end memory filing.

Required scopes: `notes:write`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string (min 1) | yes | Note title |
| `content` | string | yes | Markdown body |
| `tags` | string[] | no | Additional tags (merged with `agent-memory`) |

The `agent-memory` tag is always included regardless of the `tags` parameter. The note is created with status `PUBLISHED`.

Returns: the created note's id and slug.

```json
{
  "id": "clx...",
  "slug": "research-findings-2026-04-27"
}
```

## Session Context Tools

Ephemeral key-value storage scoped to the current MCP connection. Use this for working memory that doesn't need to persist in the knowledge base — scratchpad values, intermediate results, agent state.

Session data is discarded when the MCP connection closes. It is never written to the database.

Required scopes: `agent:read`

### `set_session_context` — store a key-value pair

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string (min 1) | yes | Storage key |
| `value` | string | yes | Value to store |

Limits: maximum 100 keys per session, maximum 10KB per value. Exceeding either limit returns a validation error.

Returns:

```json
{ "success": true }
```

### `get_session_context` — retrieve a value by key

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string (min 1) | yes | Storage key to look up |

Returns the stored value, or `null` if the key does not exist:

```json
{ "value": "stored string value" }
```

```json
{ "value": null }
```

### `list_session_context` — list all session key-value pairs

No parameters.

Returns all entries in the current session store:

```json
{
  "entries": [
    { "key": "current_task", "value": "investigate auth bug" },
    { "key": "findings_count", "value": "3" }
  ]
}
```

> **Note:** Session context is ephemeral. All data is discarded when the MCP connection closes. For persistent storage, use `save_memory` or `create_note` instead.
