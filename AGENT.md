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
  "content": "string (full Markdown with YAML frontmatter)",
  "excerpt": "string | null",
  "frontmatter": { "title": "string", "tags": ["string"] },
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
{"id":"clx...","slug":"getting-started-with-mycelium","title":"Getting Started with Mycelium","content":"---\ntitle: Getting Started...","excerpt":"Welcome to Mycelium...","frontmatter":{"title":"Getting Started with Mycelium","tags":["guide","onboarding"]},"tags":["guide","onboarding"],"updatedAt":"2025-01-01T00:00:00.000Z"}
{"id":"clx...","slug":"how-wikilinks-work","title":"How Wikilinks Work","content":"---\ntitle: How Wikilinks Work...","excerpt":"Wikilinks let you connect...","frontmatter":{"title":"How Wikilinks Work","tags":["guide","linking"]},"tags":["guide","linking"],"updatedAt":"2025-01-01T00:00:00.000Z"}
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
