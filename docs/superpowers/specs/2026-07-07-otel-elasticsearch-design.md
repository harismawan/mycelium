# OpenTelemetry + Elastic APM Integration — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Reference implementation:** `~/code/receh` (mirror its proven setup)

## Goal

Ship distributed traces, metrics, and trace-correlated structured logs from
mycelium's **api** and **mcp** servers to receh's existing Elastic APM /
Elasticsearch backend (OTLP/gRPC `http://192.168.100.31:8200`).

The whole path is **env-gated on `OTEL_ENABLED`**: when it is not exactly
`"true"`, every telemetry entry point is a no-op with zero runtime overhead, so
tests and un-instrumented local runs pay nothing.

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **api + mcp only** | mycelium has no worker; web SPA (browser RUM) is explicitly out of scope. Matches receh exactly. |
| Backend | **Reuse receh's Elastic APM** | Same OTLP/gRPC endpoint. mycelium appears as separate services `mycelium-api` / `mycelium-mcp`. Zero new infra. |
| Prisma | **Bump v6 → v7 + `@prisma/adapter-pg`** | v7 driver adapter makes `PgInstrumentation` meaningful (real DB spans). Accepted larger blast radius. |
| Log schema | **Byte-identical field keys to receh** | Existing Elastic index templates/mappings apply unchanged — no new field mappings. |

## Non-goals

- No browser Real User Monitoring (web SPA).
- No new Elasticsearch index templates or field mappings.
- No custom sampling strategy beyond `always_on` (env-overridable).
- No refactor of unrelated code.

---

## Architecture

Two Bun servers, one shared telemetry module. Instrumentation is loaded via
per-app `bunfig.toml` **preload** so the OTel SDK attaches *before* `index.js`
imports Prisma / undici (auto-instrumentation must wrap those modules at load
time).

```
packages/shared/
  otel.js         startOtel({serviceName, serviceVersion})  -> NodeSDK bootstrap
  logger-otel.js  traceContextMixin(name) + withTraceContext(fields, name)
  tracing.js      traceFn(name, attrs, fn) + tracedService(prefix, methods)

apps/api/
  bunfig.toml            preload = ["./src/instrumentation.js"]
  src/instrumentation.js startOtel({serviceName:'mycelium-api', ...}) + shutdown
  src/index.js           app.use(opentelemetry({serviceName:'mycelium-api'}))
  src/middleware/logger.js   pino + traceContextMixin('mycelium-api')
  src/db.js              PrismaClient({ adapter: new PrismaPg(...) })

apps/mcp/
  bunfig.toml            preload = ["./src/instrumentation.js"]
  src/instrumentation.js startOtel({serviceName:'mycelium-mcp', ...}) + shutdown
  src/server.js          stderr logs via withTraceContext(..., 'mycelium-mcp')
```

---

## Component 1 — Shared telemetry module (`packages/shared/`)

Flat layout (mycelium shared has no `src/`). Three new files ported from
receh's `packages/shared/src/{otel,logger-otel,tracing}.js`.

### `otel.js` — `startOtel({ serviceName, serviceVersion })`

- If `process.env.OTEL_ENABLED !== 'true'` → return `{ sdk: null, shutdown: async () => {} }`.
- Otherwise build:
  - **Resource:** `defaultResource().merge(resourceFromAttributes({...}))` — the
    merge onto `defaultResource()` keeps `telemetry.sdk.*` so Elastic APM detects
    agent name/version/language (otherwise a generic `otlp` agent). Attributes:
    - `ATTR_SERVICE_NAME` = `OTEL_SERVICE_NAME || serviceName`
    - `ATTR_SERVICE_VERSION` = `serviceVersion`
    - `ATTR_SERVICE_INSTANCE_ID` = `HOSTNAME || os.hostname()`
    - `ATTR_DEPLOYMENT_ENVIRONMENT_NAME` = `OTEL_DEPLOYMENT_ENVIRONMENT || NODE_ENV || 'development'`
  - **Traces:** `OTLPTraceExporter` (gRPC) wrapped in `BatchSpanProcessor`
    (`maxQueueSize: 2048, maxExportBatchSize: 512, exportTimeoutMillis: 10_000, scheduledDelayMillis: 5_000`).
  - **Metrics:** `PeriodicExportingMetricReader` with `OTLPMetricExporter` (gRPC),
    `exportIntervalMillis = OTEL_METRIC_EXPORT_INTERVAL || 60_000`, timeout 10s.
  - **Instrumentations:** `UndiciInstrumentation`, `PgInstrumentation({ enhancedDatabaseReporting: true, requireParentSpan: false })`, `PrismaInstrumentation`.
  - `sdk.start()`, then `HostMetrics({ name, meterProvider: metrics.getMeterProvider() }).start()`.
  - `diag.setLogger(new DiagConsoleLogger(), <OTEL_LOG_LEVEL|error>)`.
  - **shutdown:** `Promise.race([sdk.shutdown(), timeout(5000)])`, swallow errors
    (APM unreachable must never block pod termination).

### `logger-otel.js`

- `traceContextMixin(serviceName)` → pino `mixin`. Per record: read active span;
  if a real (non-zero) trace id, emit `{ 'trace.id', 'span.id', 'service.name' }`,
  else `{ 'service.name' }`. Zero-trace-id (`00…0`) is skipped.
- `withTraceContext(fields, serviceName)` → imperative variant for the MCP stderr
  logger; returns `{ ...fields, 'service.name', ['trace.id','span.id' if active] }`.
- **Dotted keys are intentional** — they flatten in Elasticsearch to the exact
  `trace.id` / `span.id` fields the APM UI queries.

### `tracing.js`

- `traceFn(name, attrs, fn)` — run `fn(span)` inside an active span; on throw
  `recordException` + `setStatus(ERROR)` + rethrow; always `end()`. When
  `OTEL_ENABLED !== 'true'`, call `fn(noopSpan)` directly (no tracer cost).
- `tracedService(prefix, methods)` — wrap each function on `methods` so calls
  emit `${prefix}.${method}` spans; `this` bound to the wrapped object so
  intra-service calls keep tracing. Non-functions pass through.

### `packages/shared/package.json`

- Add dependencies (versions from receh, current at time of writing):
  ```
  @opentelemetry/api                          ^1.9.1
  @opentelemetry/sdk-node                      ^0.218.0
  @opentelemetry/resources                     ^2.7.1
  @opentelemetry/semantic-conventions          ^1.41.1
  @opentelemetry/sdk-trace-node                ^2.7.1
  @opentelemetry/sdk-metrics                   ^2.7.1
  @opentelemetry/exporter-trace-otlp-grpc      ^0.218.0
  @opentelemetry/exporter-metrics-otlp-grpc    ^0.218.0
  @opentelemetry/instrumentation-undici        ^0.28.0
  @opentelemetry/instrumentation-pg            ^0.70.0
  @opentelemetry/host-metrics                  ^0.38.3
  @prisma/instrumentation                      ^7
  ```
  devDependency: `@opentelemetry/context-async-hooks ^2.7.1` (test).
- Extend `exports` map: `"./otel"`, `"./tracing"`, `"./logger-otel"`. Also
  re-export the public helpers from `index.js` (`startOtel`, `traceFn`,
  `tracedService`, `traceContextMixin`, `withTraceContext`) to match how receh
  imports from the package root.

> Pin exact resolved versions to whatever `bun install` locks; the `^` ranges
> above mirror receh so the two repos stay on one OTel line.

---

## Component 2 — Prisma v6 → v7 (prerequisite)

v7 retired the binary query-engine path and **requires a driver adapter**. This
is also what gives `PgInstrumentation` real spans to attach to.

- `apps/api/package.json`: `@prisma/client ^6 → ^7`, add `@prisma/adapter-pg`,
  bump `prisma` (devDep) to `^7`.
- `apps/api/src/db.js`:
  ```js
  import { PrismaPg } from '@prisma/adapter-pg';
  import { PrismaClient } from '@prisma/client';

  const prisma =
    globalThis.__mycelium_prisma ??
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

  if (process.env.NODE_ENV !== 'production') globalThis.__mycelium_prisma = prisma;
  ```
  Add a `checkConnection()` boot probe (`SELECT 1`) returning `{ ok, ms, err? }`
  so misconfig surfaces as a structured log, not first-traffic 500s. Keep the
  existing `__prisma` global name OR migrate to `__mycelium_prisma` consistently
  across tests — pick `__mycelium_prisma` and update any test that swaps it.
- `apps/api/prisma/schema.prisma`: verify the `prisma-client-js` generator and
  `previewFeatures = ["postgresqlExtensions"]` under v7; run `bunx prisma generate`.
  **Confirm `pgTrgm` + `vector` extensions still resolve through the pg adapter**
  (full-text search + vector columns are load-bearing here). Migrations dir is
  untouched.
- **Schema-change cascade (AGENTS.md §8):** regenerate client → smoke every
  service `select`/`include` → `db:seed` → run the full `bun test --isolate`
  suite for api. This bump is the primary risk in the whole project.

---

## Component 3 — Per-app instrumentation + preload

- `apps/api/src/instrumentation.js` and `apps/mcp/src/instrumentation.js`:
  ```js
  import { startOtel } from '@mycelium/shared';
  import pkg from '../package.json' with { type: 'json' };

  const { shutdown } = startOtel({ serviceName: 'mycelium-api', serviceVersion: pkg.version });
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.once(sig, () => shutdown().finally(() => process.exit(0)));
  ```
  (mcp variant: `serviceName: 'mycelium-mcp'`.)
- `apps/api/bunfig.toml` + `apps/mcp/bunfig.toml`, top-level (pre-section) key:
  ```toml
  preload = ["./src/instrumentation.js"]
  ```
  Bun resolves `bunfig.toml` from cwd; `bun run --cwd apps/api dev` picks up
  `apps/api/bunfig.toml`. Top-level `preload` applies to `bun run`; a `[test]`
  section can override if a mock preload is ever needed.
- **Tests:** the preload also runs under `bun test`, but `startOtel` is a no-op
  when `OTEL_ENABLED` is unset, so no SDK boots and tests are unaffected. Only
  add a `[test] preload` override if an explicit test-preload file becomes
  necessary.

---

## Component 4 — HTTP + logging wiring (api)

- **HTTP spans:** `bun add @elysia/opentelemetry` in api; register **early** in
  `index.js`: `app.use(opentelemetry({ serviceName: 'mycelium-api' }))`.
- **Logger → pino:** replace the `console.log` logger in
  `apps/api/src/middleware/logger.js`. `bun add pino`; `pino-pretty` as devDep,
  lazily imported only in dev. Config mirrors receh (see Component 5). Add the
  empty `onParse` and `mapResponse` hooks so `@elysia/opentelemetry` emits Parse
  and MapResponse spans (without a registered handler those phases are skipped
  and their time hides in the Root span).
- **mcp stderr:** route diagnostic logs through
  `withTraceContext(fields, 'mycelium-mcp')`. **stdout stays pure MCP protocol
  frames** — never write logs to stdout in stdio transport.

---

## Component 5 — Log schema parity (no new ES mapping)

Field **keys** must be byte-identical to receh so existing Elasticsearch index
templates/mappings apply unchanged. Only `service.name` *values* differ
(`mycelium-api` / `mycelium-mcp`) — a value, not a mapping.

**pino base config (replicate exactly):**
```js
{
  base: null,
  messageKey: 'msg',
  timestamp: () => `,"t":"${new Date().toISOString()}"`,   // field: t
  formatters: { level: (label) => ({ lvl: label }) },       // field: lvl (not level)
  mixin: traceContextMixin('mycelium-api'),                 // trace.id, span.id, service.name
  redact: {
    paths: ['*.password','*.currentPassword','*.newPassword','*.token',
            '*.accessToken','*.refreshToken','*.apiKey','*.secret','*.authorization'],
    censor: '[REDACTED]',
  },
}
```

**Access-log record (`msg: "http"`) — identical keys:**
```
requestId, method, path, status, responseTime, client, appVersion,
userId, requestBody, responseBody
```

Parity rules:
- Keep keys even where the value source differs. `client` ← `x-mycelium-client`
  header (receh: `x-receh-client`), lowercased, `.slice(0,32)`, default `'web'`.
  Key stays `client`.
- `appVersion` ← `app-version` header, `.slice(0,32)`, else `null`.
- `userId` ← `ctx.user?.id ?? null`.
- `requestBody` / `responseBody` captured via `onTransform` / `onAfterHandle`
  into `store`, emitted only when `env.LOG_BODY` is set; redaction via the
  compiled pino `redact` paths above.
- `responseTime` is **integer milliseconds** — switch mycelium's current
  `performance.now()` to a `Date.now()` delta to match receh's shape/type.

---

## Component 6 — Deploy (k8s / gitops)

- **api + mcp configmaps** (values from receh):
  ```
  OTEL_ENABLED: "true"
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://192.168.100.31:8200"
  OTEL_EXPORTER_OTLP_PROTOCOL: "grpc"
  OTEL_TRACES_SAMPLER: "always_on"
  OTEL_METRIC_EXPORT_INTERVAL: "60000"
  OTEL_LOG_LEVEL: "error"
  OTEL_DEPLOYMENT_ENVIRONMENT: "production"
  ```
- **secret:** `OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20<elastic-apm-token>"`
  (URL-encode the space after `Bearer`; leave blank if intake is unauthenticated).
- `.env.example`: add the OTEL_* keys (default `OTEL_ENABLED=false`).
- Local dev: add `docker-compose.otel.yml` running
  `otel/opentelemetry-collector-contrib` (OTLP gRPC 4317 / HTTP 4318) for
  offline trace inspection, mirroring receh's file.

---

## Testing

`bun test --isolate` throughout (shared module state leaks otherwise).

- **shared:**
  - `otel.test.js` — disabled → `{ sdk: null }` no-op; enabled → SDK constructed
    with expected resource attrs / processors (port receh's).
  - `logger-otel.test.js` — no active span → only `service.name`; zero-trace-id
    skipped; active span → correct dotted `trace.id` / `span.id`.
  - `tracing.test.js` — `traceFn` span lifecycle, error sets ERROR status + records
    exception + rethrows; `tracedService` wraps functions, passes non-functions,
    binds `this`.
- **api:**
  - Logger emits the exact envelope (`t`, `lvl`, `msg`) + `trace.id` under an
    active span; access-log record has all parity keys.
  - Instrumentation preload no-ops with `OTEL_ENABLED` unset (no SDK, no export).
  - Full existing suite green after the Prisma v7 bump (regression gate).

---

## Risks & call-outs

1. **Prisma v7 bump is the real risk**, not OTel. Driver-adapter swap +
   `pgTrgm` / `vector` extension compatibility + full schema-cascade retest.
   Land and verify this *before* wiring telemetry.
2. OTel itself is inert until `OTEL_ENABLED=true` — safe to merge disabled, flip
   on in k8s once verified against a local collector.
3. Without the pg adapter, DB spans disappear — the v7 adapter is precisely what
   keeps `PgInstrumentation` producing spans.
4. stdio MCP: any log to stdout corrupts the protocol. All mcp diagnostics go to
   stderr through `withTraceContext`.

---

## Implementation order (for the plan)

1. Prisma v6 → v7 + adapter, `db.js`, schema verify, full cascade retest. **(gate)**
2. Shared telemetry (`otel.js`, `logger-otel.js`, `tracing.js`) + package deps/exports + tests.
3. Per-app `instrumentation.js` + `bunfig.toml` preload.
4. api: `@elysia/opentelemetry` + pino logger parity + Parse/MapResponse hooks.
5. mcp: stderr `withTraceContext`.
6. k8s configmaps/secrets + `.env.example` + `docker-compose.otel.yml`.
7. Verify against local collector; then flip `OTEL_ENABLED=true` in prod.
