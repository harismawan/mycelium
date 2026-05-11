# Agent Coding Guidelines

Rules for AI agents writing code in this repo. Optimize for: minimal diffs, no breaking changes, tests pass, conventions intact.

For runtime API docs (REST + MCP tools), see [README.md](./README.md).

---

## 1. Project Shape

Bun workspace monorepo:

```
apps/
  api/       Elysia REST server, Prisma, dual auth (JWT cookies + API keys)
  web/       React 19 + Vite SPA, BlockNote editor, Zustand + TanStack Query
  mcp/       MCP server (stdio + HTTP), reuses api services
packages/
  shared/    Markdown pipeline, slug helpers, Redis client, constants
```

- Runtime: **Bun** (not Node). Use `bun` / `bunx`, not `npm` / `npx`.
- Module system: ESM (`"type": "module"`). All imports use ESM syntax with `.js` extension.
- No TypeScript build step. Plain `.js` / `.jsx` files. Type-like guarantees come from Zod/Elysia `t.*` schemas and Prisma.

---

## 2. Workflow Before You Code

1. **Read first.** Find the closest existing pattern (sibling route/service/component) and mirror it. Do not invent new patterns.
2. **Locate the seam.** Most features touch: route schema → service → Prisma. Trace this path before editing.
3. **Run tests for the touched workspace** before changes to know baseline.
4. **Smallest diff that works.** No drive-by refactors. No reformatting unrelated lines.

---

## 3. Backend (apps/api)

### Layering

| Layer | Responsibility | Don't |
|---|---|---|
| `routes/*.routes.js` | HTTP shape: schema, auth guard, scope check, call service | Put business logic here |
| `services/*.service.js` | Business logic, Prisma queries, transactions | Touch `set.status`, cookies, headers |
| `middleware/` | Auth resolution, rate limit, CSRF, logging | Branch on route paths |
| `schemas/` | Shared Elysia/Zod schemas | Duplicate per route |
| `utils/` | Pure helpers | Hide I/O |

Routes return plain objects; Elysia serializes. Throw via `error(status, body)` from route handlers — services throw plain `Error` with codes, routes translate.

### Auth & Scopes

- Two auth types: `jwt` (human cookie) and `apikey` (agent bearer). Resolved in `middleware/auth.js`, attached as `ctx.user`, `ctx.authType`, `ctx.scopes`.
- Agent endpoints require explicit scope check (`agent:read`, `notes:write`). Never trust route path for authorization.
- Every agent mutation must call `activity-log.service` with `{ action, apiKeyName, status }`.

### Database

- Prisma client is a singleton from `apps/api/src/db.js`. Don't `new PrismaClient()` elsewhere.
- Schema lives in `apps/api/prisma/schema.prisma`. Migrations only via `bunx --cwd apps/api prisma migrate dev --name <slug>`. Never hand-edit migrations.
- Use transactions (`prisma.$transaction`) for multi-table writes that must be atomic (note + tags + links + revision).
- Use `select`/`include` explicitly. No `findMany` without projection on large tables.
- Slug generation: `packages/shared/slug.js`. Always go through it — collisions are handled there.

### Markdown & Links

- Markdown parsing/serialization is in `packages/shared/markdown.js`. Don't reimplement.
- Wikilinks (`[[Note Title]]`) are extracted by the markdown pipeline and persisted as `Link` rows by `link.service.js`. Any note write that changes content **must** re-run link extraction.

### Rate Limiting & Sessions

- Redis-backed. Client from `packages/shared/redis.js`.
- Session/JWT state in `session.service.js`. Token revocation is jti-based — don't bypass.

---

## 4. Frontend (apps/web)

- React 19, function components, hooks only. No class components.
- State split:
  - **Server state** → TanStack Query (`hooks/use*.js`). Always with a stable `queryKey`.
  - **Client/UI state** → Zustand stores in `stores/`. One store per concern.
  - **Local-only** → `useState`.
- Styling: `styled-components`. Use existing theme tokens from `styles/theme.css` / styled-components ThemeProvider. No inline style objects except dynamic positions.
- API calls go through `api/` modules — never `fetch` from a component.
- Editor: BlockNote. The serialization round-trip (blocks ↔ markdown) is fragile; route changes through existing helpers, do not bypass.

---

## 5. MCP (apps/mcp)

- Tools defined under `apps/mcp/src/tools/`. Each tool: input schema (zod), scope check, call the same `services/*` from the API workspace.
- Never duplicate business logic between MCP and REST. If you need shared behavior, lift it to a service.
- Tool errors: validation → JSON-RPC `-32602`; auth/db → `-32603`; tool-level "not found" → MCP content with `isError: true`.

---

## 6. Testing

- Test runner: `bun test --isolate` (root `bun test` script already passes `--isolate`). **Always use `--isolate`** — shared module state leaks across files otherwise.
- Tests colocated in `apps/<workspace>/test/`. Mirror the source tree.
- Each test file is responsible for its own mock setup; do not rely on a global setup file.
- For DB-touching tests: use the smoke/integration harness under `apps/api/test/` rather than mocking Prisma deeply.
- Run only the workspace you changed:
  ```bash
  bun test --isolate --cwd apps/api
  bun test --isolate --cwd apps/mcp
  bun test --isolate --cwd packages/shared
  ```

---

## 7. Conventions

### Code style

- No semicolons elision games; match the surrounding file.
- `async`/`await`, no raw `.then` chains in new code.
- Errors: throw `Error` with a message; attach `.code` for programmatic handling. Never return error sentinels.
- Logging: `utils/logger.js` (pino). No `console.log` in committed code (tests exempted).
- No comments restating code. Only comment non-obvious *why*.

### Naming

- Files: kebab-case (`note.service.js`, `auth.routes.js`).
- Exports: camelCase for functions, PascalCase for components/classes.
- Route paths: lowercase, plural resources (`/api/v1/notes`, `/api/v1/api-keys`).

### Imports

- Workspace imports use package names (`@mycelium/shared`), not relative paths across workspaces.
- Order: stdlib → external → workspace → local. Single blank line between groups.

---

## 8. Schema & Data Changes

A schema change is never "just a migration":

1. `prisma/schema.prisma` updated.
2. `bunx --cwd apps/api prisma migrate dev --name <slug>` to generate migration.
3. Update service queries (`select`/`include`/types).
4. Update Elysia route schemas if exposed.
5. Update seed (`apps/api/prisma/seed.js`) if a new required column lacks default.
6. Update tests.

If any step is skipped, the change is incomplete.

---

## 9. Security Non-Negotiables

- API keys: stored as SHA-256 hash + prefix. Never log the raw key. Never return it after creation response.
- JWTs: signed with `JWT_SECRET`. Access tokens short-lived; refresh tokens rotate. Do not extend lifetimes without an explicit ask.
- CSRF: state-changing JWT-auth routes require the CSRF middleware. API-key routes don't (different auth surface).
- Input: every route has an Elysia `body`/`query` schema. No route accepts unvalidated input.
- SQL: only via Prisma. No `$queryRawUnsafe` with interpolation.
- Secrets: never hardcode. Read from `process.env`. Update `.env.example` (not `.env`) when adding a var.

---

## 10. What To Avoid

- Adding dependencies for trivial helpers — check `packages/shared` first.
- New abstractions on first use. Inline twice, abstract on the third.
- Renaming existing files/symbols as a side effect of a feature.
- Generated files (`prisma/migrations/*` SQL, lockfiles) — never hand-edit.
- Touching `bun.lock` directly. Run `bun install` instead.
- Catching errors only to re-throw or log-and-swallow.
- Backwards-compat shims for code you control — just update the callers.

---

## 11. Definition of Done

Before declaring a task done:

- [ ] Tests for the touched workspace pass (`bun test --isolate --cwd <workspace>`)
- [ ] No new lint/format drift in unrelated files
- [ ] Migration generated (if schema changed) and seed still runs
- [ ] `.env.example` updated (if new env var)
- [ ] README/this file updated (only if user-facing behavior or guideline changed)
- [ ] Manual smoke check on the golden path if UI changed — type checks and unit tests do not verify feature correctness
