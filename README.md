# Mycelium

A Markdown-first knowledge base serving two audiences: human users through a React SPA with a block editor, and AI agents through a REST API and MCP server. Content is stored as Markdown with wikilinks and backlinks treated as first-class relationships.

## Architecture

Mycelium is a Bun monorepo with four workspaces:

```
mycelium/
├── apps/
│   ├── api/          # Elysia REST server, Prisma ORM, JWT + API key auth
│   ├── web/          # React 19 + Vite SPA, BlockNote editor, Zustand, TanStack Query
│   └── mcp/          # MCP server for AI agents (stdio + HTTP transport)
├── packages/
│   └── shared/       # Markdown pipeline (remark/rehype), slug helpers, constants
├── docker-compose.yml          # Dev: PostgreSQL only
├── docker-compose.prod.yml     # Production: full stack
├── AGENTS.md                   # Agent API + MCP server documentation
└── package.json                # Bun workspace root
```

- **apps/api** — Elysia REST server with Prisma ORM, JWT cookie auth for humans, Bearer API key auth for agents, structured JSON logging, and full-text search via PostgreSQL tsvector.
- **apps/web** — React 19 SPA built with Vite. BlockNote block editor with wikilink support, Zustand state management, TanStack Query, react-force-graph-2d for graph visualization, styled-components, and Lucide icons.
- **apps/mcp** — Model Context Protocol server exposing the knowledge base to AI agents (Claude, Cursor, Kiro, OpenClaw). Supports stdio and Streamable HTTP transports. 14 tools for search, read, create, update, graph traversal, session context, and memory filing.
- **packages/shared** — Shared Markdown processing pipeline (remark/rehype), slug generation, enums, and constants.

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)

## Quick Start (Development)

### 1. Install dependencies

```bash
bun install
```

### 2. Start PostgreSQL

```bash
docker compose up -d
```

### 3. Run database migrations

```bash
bunx --cwd apps/api prisma migrate dev
```

### 4. Seed the database

```bash
bunx --cwd apps/api prisma db seed
```

### 5. Start the API server

```bash
bun run --cwd apps/api src/index.js
```

The API runs at `http://localhost:3000`.

### 6. Start the SPA

```bash
bun run --cwd apps/web dev
```

The SPA runs at `http://localhost:5173` with a Vite proxy to the API.

### 7. Start the MCP server (optional)

```bash
MYCELIUM_API_KEY=myc_demo_agent_key_for_testing \
DATABASE_URL=postgresql://mycelium:mycelium@localhost:5432/mycelium \
bun run apps/mcp/src/index.js
```

Or with HTTP transport:

```bash
MYCELIUM_API_KEY=myc_demo_agent_key_for_testing \
DATABASE_URL=postgresql://mycelium:mycelium@localhost:5432/mycelium \
MCP_TRANSPORT=http bun run apps/mcp/src/index.js
```

## Production Deployment (Docker)

Deploy the full stack with a single command:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

This starts:
- **PostgreSQL 16** with health checks and persistent volume
- **API server** (Bun + Elysia) on port 3000
- **Web server** (nginx serving the built SPA) on port 80
- **Migrate service** (one-shot) that runs Prisma migrations on startup

### Post-deploy: seed the database

```bash
docker compose -f docker-compose.prod.yml exec api bunx prisma db seed
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://mycelium:mycelium@postgres:5432/mycelium` | PostgreSQL connection string |
| `JWT_SECRET` | `change-this-in-production` | Secret for signing JWT tokens |
| `PORT` | `3000` | API server port |
| `MYCELIUM_API_KEY` | — | API key for MCP stdio transport |
| `MCP_TRANSPORT` | `stdio` | MCP transport mode (`stdio` or `http`) |
| `MCP_PORT` | `3001` | MCP HTTP transport port |

### Architecture

```
┌─────────┐     ┌─────────┐     ┌──────────┐
│  nginx   │────▶│   API   │────▶│ Postgres │
│  (SPA)   │     │ (Elysia)│     │   (16)   │
│  :80     │     │  :3000  │     │  :5432   │
└─────────┘     └─────────┘     └──────────┘
     │                               ▲
     └── /api/* proxied to API       │
     └── /* serves SPA               │
                                     │
┌─────────┐                          │
│   MCP   │──────────────────────────┘
│ Server  │  (stdio or HTTP :3001)
└─────────┘
```

## Demo Credentials

| Credential | Value |
|---|---|
| Email | `demo@mycelium.local` |
| Password | `mycelium123` |
| Agent API Key | `myc_demo_agent_key_for_testing` |

## Agent API

Dedicated endpoints for AI agents under `/api/v1/agent`. See [AGENTS.md](./AGENTS.md) for full documentation:

- `GET /api/v1/agent/manifest` — API discovery
- `GET /api/v1/agent/bundle` — NDJSON stream of all published notes
- `GET /api/v1/agent/notes` — Simplified paginated note listing

## MCP Server

The MCP server (`apps/mcp/`) exposes the knowledge base to AI agents over the Model Context Protocol. See [AGENTS.md](./AGENTS.md) for full tool documentation.

### Connect from an MCP client

Add to your client's MCP config (Claude Desktop, Cursor, Kiro):

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

### Available tools

| Tool | Scope | Description |
|---|---|---|
| `search_notes` | `agent:read` | Full-text search |
| `read_note` | `agent:read` | Read a note by slug |
| `list_notes` | `agent:read` | Paginated list with filters |
| `list_tags` | `agent:read` | All tags with note counts |
| `get_backlinks` | `agent:read` | Inbound links to a note |
| `get_outgoing_links` | `agent:read` | Outbound wikilinks from a note |
| `get_graph` | `agent:read` | Knowledge graph or ego-subgraph |
| `create_note` | `notes:write` | Create a new note |
| `update_note` | `notes:write` | Update an existing note |
| `get_context` | `agent:read` | Load relevant notes for a topic |
| `save_memory` | `notes:write` | Save a finding as a published note |
| `set_session_context` | `agent:read` | Store ephemeral key-value pair |
| `get_session_context` | `agent:read` | Retrieve ephemeral value by key |
| `list_session_context` | `agent:read` | List all session key-value pairs |

## Testing

```bash
# API tests
bun test --cwd apps/api

# MCP server tests (unit + property-based)
bun test --cwd apps/mcp
```

## Project Structure

```
apps/api/
├── prisma/
│   ├── schema.prisma        # Database schema
│   ├── migrations/           # Prisma migrations + FTS migration
│   └── seed.js               # Demo data seed script
├── src/
│   ├── index.js              # Elysia server entry point
│   ├── db.js                 # Prisma client singleton
│   ├── middleware/            # Auth and logging middleware
│   ├── routes/               # Route groups (auth, notes, tags, graph, agent, api-keys)
│   └── services/             # Business logic
├── test/                     # API tests
└── Dockerfile

apps/mcp/
├── src/
│   ├── index.js              # Entry point (stdio + Bun.serve HTTP)
│   ├── server.js             # McpServer factory
│   ├── auth.js               # API key resolution and scope checking
│   ├── db.js                 # Prisma client singleton
│   ├── logger.js             # Structured JSON logger
│   ├── session.js            # In-memory session context store
│   ├── links.js              # Wikilink reconciliation
│   └── tools/                # MCP tool handlers (14 tools)
├── test/
│   ├── tools/                # Unit tests per tool
│   └── properties/           # Property-based tests (fast-check)
├── mcp.json                  # Client auto-configuration
└── skill.json                # OpenClaw/ClawHub skill manifest

apps/web/
├── src/
│   ├── main.jsx              # Entry point (lazy-loaded routes)
│   ├── api/                  # Fetch client and TanStack Query hooks
│   ├── components/           # UI components (editor, sidebar, right pane, layout)
│   ├── pages/                # Route pages (editor, graph, login, dashboard, reading)
│   ├── stores/               # Zustand stores (auth, notes, editor, UI)
│   ├── styles/               # Centralized styled-components
│   └── hooks/                # Custom hooks (theme)
├── nginx.conf                # Production nginx config
└── Dockerfile

packages/shared/
├── index.js                  # Barrel export
├── markdown.js               # Markdown pipeline
├── slug.js                   # Slug generation
├── constants.js              # Enums and constants
└── test/                     # Shared package tests
```
