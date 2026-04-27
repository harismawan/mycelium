# Mycelium

A Markdown-first knowledge base serving two audiences: human users through a React SPA with a block editor, and AI agents through a stable REST/JSON API. Content is stored as Markdown with wikilinks and backlinks treated as first-class relationships.

## Architecture

Mycelium is a Bun monorepo with three workspaces:

```
mycelium/
├── apps/
│   ├── api/          # Elysia REST server, Prisma ORM, JWT + API key auth
│   └── web/          # React 19 + Vite SPA, BlockNote editor, Zustand, TanStack Query
├── packages/
│   └── shared/       # Markdown pipeline (remark/rehype), slug helpers, constants
├── docker-compose.yml          # Dev: PostgreSQL only
├── docker-compose.prod.yml     # Production: full stack
├── AGENT.md                    # Agent API documentation
└── package.json                # Bun workspace root
```

- **apps/api** — Elysia REST server with Prisma ORM, JWT cookie auth for humans, Bearer API key auth for agents, structured JSON logging, and full-text search via PostgreSQL tsvector.
- **apps/web** — React 19 SPA built with Vite. BlockNote block editor with wikilink support, Zustand state management, TanStack Query, react-force-graph-2d for graph visualization, styled-components, and Lucide icons.
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

### Architecture

```
┌─────────┐     ┌─────────┐     ┌──────────┐
│  nginx   │────▶│   API   │────▶│ Postgres │
│  (SPA)   │     │ (Elysia)│     │   (16)   │
│  :80     │     │  :3000  │     │  :5432   │
└─────────┘     └─────────┘     └──────────┘
     │
     └── /api/* proxied to API
     └── /* serves SPA with fallback to index.html
```

## Demo Credentials

| Credential | Value |
|---|---|
| Email | `demo@mycelium.local` |
| Password | `mycelium123` |
| Agent API Key | `myc_demo_agent_key_for_testing` |

## Agent API

Dedicated endpoints for AI agents under `/api/v1/agent`. See [AGENT.md](./AGENT.md) for full documentation:

- `GET /api/v1/agent/manifest` — API discovery
- `GET /api/v1/agent/bundle` — NDJSON stream of all published notes
- `GET /api/v1/agent/notes` — Simplified paginated note listing

## Postman Collection

Import `postman/Mycelium-API.postman_collection.json` into Postman for all 22+ API endpoints with pre-configured variables and test scripts.

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

apps/web/
├── src/
│   ├── main.jsx              # Entry point (lazy-loaded routes)
│   ├── api/                  # Fetch client and TanStack Query hooks
│   ├── components/           # UI components (editor, sidebar, right pane, layout)
│   ├── pages/                # Route pages (editor, graph, login, dashboard, reading)
│   ├── stores/               # Zustand stores (auth, notes, editor, UI)
│   ├── styles/               # Centralized styled-components
│   └── hooks/                # Custom hooks (theme)
├── test/                     # SPA tests
├── nginx.conf                # Production nginx config
└── Dockerfile

packages/shared/
├── index.js                  # Barrel export
├── markdown.js               # Markdown pipeline
├── slug.js                   # Slug generation
├── constants.js              # Enums and constants
└── test/                     # Shared package tests
```
