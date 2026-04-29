<p align="center">
  <img src="assets/logo.svg" alt="Mycelium" width="400" />
</p>

<p align="center">
  <strong>A Markdown-first knowledge base for humans and AI agents</strong>
</p>

<p align="center">
  <img src="assets/screenshot.png" alt="Mycelium Screenshot" width="800" />
</p>

<p align="center">
  Mycelium serves two audiences from a single source of truth: human users interact through a React SPA with a block editor, while AI agents connect via a REST API and MCP server. Content is stored as Markdown with wikilinks and backlinks treated as first-class graph relationships.
</p>

---

## Key Features

- **Block editor** — Rich editing with BlockNote, wikilink autocomplete, and instant Markdown export
- **Knowledge graph** — Force-directed visualization of note connections with ego-subgraph exploration
- **Dual auth** — JWT cookies (access + refresh tokens) for humans, scoped API keys for agents, Redis-backed session management
- **Agent API** — NDJSON bundle streaming, paginated listings, and full-text search for AI consumers
- **MCP server** — 14 tools exposing the knowledge base to Claude, Cursor, Kiro, and OpenClaw
- **Activity audit trail** — Every agent action logged with API key identity, filterable feed, and per-key rate limiting
- **Revision history** — Immutable snapshots with diff view, agent/human badges, and one-click revert
- **Full-text search** — PostgreSQL tsvector-powered search across all note content
- **Wikilinks & backlinks** — Bidirectional linking with automatic resolution and graph traversal

---

## System Architecture

```mermaid
graph TB
    subgraph Clients
        Browser[Browser / React SPA]
        Agent[AI Agent]
        MCP_Client[MCP Client<br/>Claude / Cursor / Kiro]
    end

    subgraph Infrastructure
        Nginx[nginx :80]
        API[Elysia API :3000]
        MCP_Server[MCP Server :3001]
        Redis[(Redis 8)]
        DB[(PostgreSQL 16)]
    end

    Browser -->|SPA assets| Nginx
    Browser -->|/api/* proxy| API
    Agent -->|REST + Bearer key| API
    MCP_Client -->|stdio / HTTP| MCP_Server

    API --> DB
    API --> Redis
    MCP_Server --> DB
    MCP_Server --> Redis
    Nginx -->|reverse proxy| API
```

### Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant RateLimiter
    participant Auth
    participant Redis
    participant Routes
    participant Services
    participant DB

    Client->>RateLimiter: Request
    RateLimiter->>Auth: Resolve credentials
    alt JWT cookie auth
        Auth->>Auth: Verify JWT signature
        Auth->>Redis: Check jti exists (token active?)
        Auth->>Redis: Check session exists
        Redis-->>Auth: Session valid
        Auth->>DB: Fetch user by ID
    else API key auth
        Auth->>DB: Lookup API key by hash
    end
    Auth->>Routes: Attach user + authType + scopes
    Routes->>Services: Business logic
    Services->>DB: Prisma query
    DB-->>Services: Result
    Services-->>Routes: Response
    Routes-->>Client: JSON + rate limit headers
```

### Data Model

```mermaid
erDiagram
    User ||--o{ Note : owns
    User ||--o{ ApiKey : has
    User ||--o{ ActivityLog : generates
    Note ||--o{ Revision : has
    Note ||--o{ Link : "links from"
    Note }o--o{ Tag : tagged
    Note ||--o{ Link : "links to"

    User {
        string id PK
        string email UK
        string displayName
    }
    Note {
        string id PK
        string slug UK
        string title
        string content
        enum status
    }
    Revision {
        string id PK
        string content
        string authType
        string apiKeyName
    }
    ActivityLog {
        string id PK
        string action
        string apiKeyName
        string status
    }
    ApiKey {
        string id PK
        string name
        string[] scopes
    }
    Link {
        string id PK
        string fromId FK
        string toId FK
    }
    Tag {
        string id PK
        string name UK
    }
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh/) |
| API Framework | [Elysia](https://elysiajs.com/) |
| Database | PostgreSQL 16 + [Prisma](https://www.prisma.io/) ORM |
| Session Store | Redis 8 (Bun built-in client) |
| Frontend | React 19, Vite, [BlockNote](https://www.blocknotejs.org/), styled-components |
| State | Zustand + TanStack Query |
| Graph Viz | react-force-graph-2d |
| MCP | [@modelcontextprotocol/sdk](https://modelcontextprotocol.io/) |
| Auth | JWT dual-token (access + refresh) + Redis sessions (humans), SHA-256 hashed API keys (agents) |
| Search | PostgreSQL tsvector full-text search |
| Icons | Lucide React |

---

## Monorepo Structure

```
mycelium/
├── apps/
│   ├── api/          # Elysia REST server, Prisma, JWT + Redis sessions + API key auth
│   ├── web/          # React 19 + Vite SPA, BlockNote editor
│   └── mcp/          # MCP server (stdio + HTTP transport), Redis-backed session context
├── packages/
│   └── shared/       # Markdown pipeline, slug helpers, constants, Redis client
├── docker-compose.yml          # Dev: PostgreSQL + Redis
├── docker-compose.prod.yml     # Production: full stack
├── AGENTS.md                   # Agent API + MCP documentation
└── package.json                # Bun workspace root
```

---

## Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) and Docker Compose (for PostgreSQL + Redis)

---

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Start PostgreSQL + Redis
docker compose up -d

# 3. Run migrations
bunx --cwd apps/api prisma migrate dev

# 4. Seed demo data
bunx --cwd apps/api prisma db seed

# 5. Start the API
bun run --cwd apps/api src/index.js

# 6. Start the SPA (separate terminal)
bun run --cwd apps/web dev
```

The SPA runs at `http://localhost:5173`, API at `http://localhost:3000`.

### Start the MCP server (optional)

```bash
MYCELIUM_API_KEY=myc_demo_agent_key_for_testing \
DATABASE_URL=postgresql://mycelium:mycelium@localhost:5432/mycelium \
REDIS_URL=redis://localhost:6379 \
bun run apps/mcp/src/index.js
```

---

## Production Deployment

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

This starts PostgreSQL, Redis, the API server, nginx (serving the SPA), and runs migrations automatically.

```bash
# Seed after first deploy
docker compose -f docker-compose.prod.yml exec api bunx prisma db seed
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://mycelium:mycelium@localhost:5432/mycelium` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | `change-this-in-production` | JWT signing secret |
| `PORT` | `3000` | API server port |
| `MYCELIUM_API_KEY` | — | API key for MCP stdio transport |
| `MCP_TRANSPORT` | `stdio` | MCP transport (`stdio` or `http`) |
| `MCP_PORT` | `3001` | MCP HTTP port |

---

## Demo Credentials

| Credential | Value |
|------------|-------|
| Email | `demo@mycelium.local` |
| Password | `mycelium123` |
| Agent API Key | `myc_demo_agent_key_for_testing` |

---

## Agent API

REST endpoints for AI agents under `/api/v1/agent`. Full docs in [AGENTS.md](./AGENTS.md).

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/agent/manifest` | API discovery and schema |
| `GET /api/v1/agent/bundle` | NDJSON stream of all published notes |
| `GET /api/v1/agent/notes` | Paginated note listing |

---

## MCP Server

Exposes the knowledge base to AI agents via the [Model Context Protocol](https://modelcontextprotocol.io/).

### Connect from an MCP client

```json
{
  "mcpServers": {
    "mycelium": {
      "command": "bun",
      "args": ["run", "apps/mcp/src/index.js"],
      "env": {
        "MYCELIUM_API_KEY": "myc_demo_agent_key_for_testing",
        "DATABASE_URL": "postgresql://mycelium:mycelium@localhost:5432/mycelium"
      }
    }
  }
}
```

### Tools (14)

| Tool | Scope | Description |
|------|-------|-------------|
| `search_notes` | `agent:read` | Full-text search |
| `read_note` | `agent:read` | Read note by slug |
| `list_notes` | `agent:read` | Paginated list with filters |
| `list_tags` | `agent:read` | All tags with counts |
| `get_backlinks` | `agent:read` | Inbound links |
| `get_outgoing_links` | `agent:read` | Outbound wikilinks |
| `get_graph` | `agent:read` | Knowledge graph / ego-subgraph |
| `create_note` | `notes:write` | Create a note |
| `update_note` | `notes:write` | Update a note |
| `get_context` | `agent:read` | Load relevant notes for a topic |
| `save_memory` | `notes:write` | File a finding as a note |
| `set_session_context` | `agent:read` | Store ephemeral key-value |
| `get_session_context` | `agent:read` | Retrieve ephemeral value |
| `list_session_context` | `agent:read` | List session store |

---

## Testing

```bash
# API unit + property tests
bun test --cwd apps/api

# MCP server tests
bun test --cwd apps/mcp

# Shared package tests
bun test --cwd packages/shared
```

---

## License

MIT
