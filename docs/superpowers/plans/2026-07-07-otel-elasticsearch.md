# OpenTelemetry + Elastic APM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship distributed traces, metrics, and trace-correlated structured logs from mycelium's `api` and `mcp` servers to receh's existing Elastic APM backend, env-gated on `OTEL_ENABLED`.

**Architecture:** A shared telemetry module in `@mycelium/shared` (`otel.js`, `logger-otel.js`, `tracing.js`) is loaded via per-app `bunfig.toml` preload before Prisma/undici import, so OTel auto-instrumentation attaches. Prisma bumps v6→v7 with a pg driver adapter (required for DB spans). The api logger becomes pino with field keys byte-identical to receh so no new Elasticsearch mappings are needed.

**Tech Stack:** Bun, Elysia, Prisma 7 + `@prisma/adapter-pg`, OpenTelemetry JS SDK 2.x, `@elysia/opentelemetry`, pino, OTLP/gRPC → Elastic APM.

**Spec:** `docs/superpowers/specs/2026-07-07-otel-elasticsearch-design.md`

## Global Constraints

- Runtime is **Bun**, not Node. Use `bun` / `bunx`, never `npm` / `npx`. ESM only; every relative import carries a `.js` extension.
- All tests run with `bun test --isolate` (shared module state leaks across files otherwise).
- Telemetry is **env-gated**: when `process.env.OTEL_ENABLED !== 'true'`, every entry point is a no-op with zero overhead. Tests run with `OTEL_ENABLED` unset.
- Log **field keys** must be byte-identical to receh (`t`, `lvl`, `msg`, `trace.id`, `span.id`, `service.name`, and the access-log keys) — only `service.name` *values* differ (`mycelium-api` / `mycelium-mcp`). No new Elasticsearch field mappings.
- Service names: `mycelium-api`, `mycelium-mcp`.
- OTel dependency version ranges mirror receh (pinned below) so both repos stay on one OTel line.
- stdio MCP: **never write logs to stdout** — protocol frames only. Diagnostics go to stderr.
- Prisma migrations only via `bunx prisma migrate dev --name <slug>`, never hand-edited.

---

## File Structure

**Created:**
- `packages/shared/otel.js` — `startOtel({serviceName, serviceVersion})` NodeSDK bootstrap.
- `packages/shared/logger-otel.js` — `traceContextMixin`, `withTraceContext`.
- `packages/shared/tracing.js` — `traceFn`, `tracedService`.
- `packages/shared/test/otel.test.js`, `test/logger-otel.test.js`, `test/tracing.test.js`.
- `apps/api/src/instrumentation.js`, `apps/api/bunfig.toml`.
- `apps/mcp/src/instrumentation.js`, `apps/mcp/bunfig.toml`.
- `docker-compose.otel.yml`, `bench/otel-collector.yaml`.

**Modified:**
- `packages/shared/package.json` — OTel deps + exports map.
- `packages/shared/index.js` — re-export telemetry symbols.
- `apps/api/package.json` — Prisma 7, adapter, `@elysia/opentelemetry`, pino.
- `apps/api/src/db.js` — pg driver adapter + `checkConnection()`.
- `apps/api/src/index.js` — register `opentelemetry()` plugin.
- `apps/api/src/middleware/logger.js` — pino with receh-parity fields.
- `apps/mcp/src/*` — stderr logs via `withTraceContext`.
- k8s manifests (api + mcp) — `OTEL_*` env; `.env.example`.

---

## Task 1: Bump Prisma v6 → v7 with pg driver adapter (GATE)

Prisma 7 retires the binary query engine and requires a driver adapter. This must land and pass the full existing suite **before** any telemetry work, because `PgInstrumentation` only produces spans through the adapter.

**Files:**
- Modify: `apps/api/package.json` (dependencies)
- Modify: `apps/api/src/db.js`
- Modify: `apps/api/prisma/schema.prisma` (verify only)
- Test: existing `apps/api/test/**` suite is the regression gate

**Interfaces:**
- Produces: `prisma` singleton (unchanged import: `import { prisma } from './db.js'`), new `checkConnection(): Promise<{ ok: boolean, ms: number, err?: Error }>`, and test-swap global `globalThis.__mycelium_prisma`.

- [ ] **Step 1: Install Prisma 7 + adapter**

```bash
cd apps/api
bun add @prisma/client@^7 @prisma/adapter-pg
bun add -d prisma@^7
```

- [ ] **Step 2: Rewrite `apps/api/src/db.js` to use the pg adapter**

```js
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client. Prisma 7 requires a driver adapter — the binary
 * query-engine path is retired. Cached on globalThis in non-production so
 * Bun's hot-reload does not leak connection pools.
 *
 * Tests may swap this for a mock by setting `globalThis.__mycelium_prisma`
 * before any service module is imported.
 *
 * @type {import('@prisma/client').PrismaClient}
 */
const prisma =
  globalThis.__mycelium_prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__mycelium_prisma = prisma;
}

/**
 * Boot-time probe — `SELECT 1` against Postgres so misconfiguration surfaces
 * immediately as a structured log instead of first-traffic 500s.
 *
 * @returns {Promise<{ ok: boolean, ms: number, err?: Error }>}
 */
export async function checkConnection() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, ms: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      err: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export { prisma };
```

- [ ] **Step 3: Verify schema compatibility and regenerate the client**

Confirm `apps/api/prisma/schema.prisma` still has:
```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgTrgm(map: "pg_trgm"), vector]
}
```
Then regenerate:
```bash
bun run --cwd apps/api generate
```
Expected: `Generated Prisma Client` with no error. If v7 rejects `prisma-client-js`, switch the generator `provider` to `prisma-client` and set an `output` path per the v7 upgrade notes, then re-run — but only if generation actually fails.

- [ ] **Step 4: Verify DB connectivity and extensions through the adapter**

```bash
docker compose up -d
bun run --cwd apps/api db:reset
```
Expected: migrations apply cleanly and seed runs — this exercises `pgTrgm` (full-text) and `vector` columns through the new adapter. If reset fails on an extension, stop and resolve before continuing.

- [ ] **Step 5: Run the full api regression suite**

```bash
bun test --isolate --cwd apps/api
```
Expected: PASS (same green baseline as before the bump). Investigate any new failure — it is a v7 regression, not a flake.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/db.js apps/api/prisma/schema.prisma bun.lock
git commit -m "feat(api): upgrade Prisma to v7 with pg driver adapter"
```

---

## Task 2: Shared `otel.js` — `startOtel` bootstrap

**Files:**
- Create: `packages/shared/otel.js`
- Test: `packages/shared/test/otel.test.js`

**Interfaces:**
- Produces: `startOtel({ serviceName: string, serviceVersion: string }): { sdk: NodeSDK | null, shutdown: () => Promise<void> }`. Returns `{ sdk: null, shutdown: async () => {} }` when `OTEL_ENABLED !== 'true'`.

- [ ] **Step 1: Add the OTel dependencies to `packages/shared/package.json`**

Add these to `"dependencies"` (verbatim ranges from receh):
```json
"@opentelemetry/api": "^1.9.1",
"@opentelemetry/sdk-node": "^0.218.0",
"@opentelemetry/resources": "^2.7.1",
"@opentelemetry/semantic-conventions": "^1.41.1",
"@opentelemetry/sdk-trace-node": "^2.7.1",
"@opentelemetry/sdk-metrics": "^2.7.1",
"@opentelemetry/exporter-trace-otlp-grpc": "^0.218.0",
"@opentelemetry/exporter-metrics-otlp-grpc": "^0.218.0",
"@opentelemetry/instrumentation-undici": "^0.28.0",
"@opentelemetry/instrumentation-pg": "^0.70.0",
"@opentelemetry/host-metrics": "^0.38.3",
"@prisma/instrumentation": "^7"
```
Add to `"devDependencies"` (create the block if absent):
```json
"@opentelemetry/context-async-hooks": "^2.7.1"
```
Then:
```bash
bun install
```

- [ ] **Step 2: Write the failing test — `packages/shared/test/otel.test.js`**

```js
import { beforeEach, describe, expect, it } from 'bun:test';
import { startOtel } from '../otel.js';

describe('startOtel', () => {
  beforeEach(() => {
    delete process.env.OTEL_ENABLED;
  });

  it('returns a no-op shutdown when OTEL_ENABLED is not true', async () => {
    process.env.OTEL_ENABLED = 'false';
    const { sdk, shutdown } = startOtel({ serviceName: 'svc', serviceVersion: '0.0.0' });
    expect(sdk).toBeNull();
    await expect(shutdown()).resolves.toBeUndefined();
  });

  it('returns an sdk and shutdown when enabled', async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
    const { sdk, shutdown } = startOtel({ serviceName: 'svc', serviceVersion: '0.0.0' });
    expect(sdk).not.toBeNull();
    const started = Date.now();
    await shutdown();
    expect(Date.now() - started).toBeLessThan(6000);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
bun test --isolate --cwd packages/shared test/otel.test.js
```
Expected: FAIL — `Cannot find module '../otel.js'`.

- [ ] **Step 4: Create `packages/shared/otel.js`**

```js
/**
 * OpenTelemetry bootstrap shared across mycelium apps.
 *
 *  - OTEL_ENABLED !== 'true'  -> no-op (returns { sdk:null, shutdown:async()=>{} })
 *  - Otherwise wires NodeSDK with OTLP/gRPC trace + metric exporters,
 *    Prisma + pg + undici instrumentations, host metrics, a bounded
 *    BatchSpanProcessor, and a 5s SIGTERM shutdown race.
 *
 * Env (OpenTelemetry conventions):
 *   OTEL_ENABLED                 "true" to activate
 *   OTEL_EXPORTER_OTLP_ENDPOINT  e.g. http://192.168.100.31:8200
 *   OTEL_EXPORTER_OTLP_HEADERS   "Authorization=Bearer%20<token>"
 *   OTEL_METRIC_EXPORT_INTERVAL  default 60000 (ms)
 *   OTEL_DEPLOYMENT_ENVIRONMENT  default NODE_ENV or "development"
 *   OTEL_LOG_LEVEL               default "error"
 *
 * The resource merge onto defaultResource() keeps telemetry.sdk.* attrs so
 * Elastic APM detects agent name/version/language (otherwise a generic "otlp"
 * agent). Stable ATTR_* constants come from @opentelemetry/semantic-conventions.
 */
import os from 'node:os';
import { DiagConsoleLogger, DiagLogLevel, diag, metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const DIAG_LEVELS = {
  error: DiagLogLevel.ERROR,
  warn: DiagLogLevel.WARN,
  info: DiagLogLevel.INFO,
  debug: DiagLogLevel.DEBUG,
};

function timeoutMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bootstrap OpenTelemetry. Call once at process startup before any other
 * imports that should be instrumented.
 *
 * @param {{ serviceName: string, serviceVersion: string }} opts
 * @returns {{ sdk: import('@opentelemetry/sdk-node').NodeSDK | null, shutdown: () => Promise<void> }}
 */
export function startOtel({ serviceName, serviceVersion }) {
  if (process.env.OTEL_ENABLED !== 'true') {
    return { sdk: null, shutdown: async () => {} };
  }

  const diagLevel =
    DIAG_LEVELS[(process.env.OTEL_LOG_LEVEL || 'error').toLowerCase()] ?? DiagLogLevel.ERROR;
  diag.setLogger(new DiagConsoleLogger(), diagLevel);

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      [ATTR_SERVICE_INSTANCE_ID]: process.env.HOSTNAME || os.hostname(),
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || 'development',
    }),
  );

  const traceExporter = new OTLPTraceExporter();
  const spanProcessor = new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    exportTimeoutMillis: 10_000,
    scheduledDelayMillis: 5_000,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 60_000),
    exportTimeoutMillis: 10_000,
  });

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [spanProcessor],
    metricReader,
    instrumentations: [
      new UndiciInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: true, requireParentSpan: false }),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();

  const hostMetrics = new HostMetrics({
    name: process.env.OTEL_SERVICE_NAME || serviceName,
    meterProvider: metrics.getMeterProvider(),
  });
  hostMetrics.start();

  const shutdown = async () => {
    try {
      await Promise.race([sdk.shutdown(), timeoutMs(5000)]);
    } catch {
      // swallow — APM unreachable must not block pod termination
    }
  };

  return { sdk, shutdown };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test --isolate --cwd packages/shared test/otel.test.js
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/otel.js packages/shared/test/otel.test.js packages/shared/package.json bun.lock
git commit -m "feat(shared): add startOtel OpenTelemetry bootstrap"
```

---

## Task 3: Shared `logger-otel.js` — trace-context helpers

**Files:**
- Create: `packages/shared/logger-otel.js`
- Test: `packages/shared/test/logger-otel.test.js`

**Interfaces:**
- Produces: `traceContextMixin(serviceName: string): () => Record<string, unknown>` (pino mixin), `withTraceContext(fields: object, serviceName: string): object`. Both emit dotted keys `trace.id`, `span.id`, `service.name`. Zero-trace-id (`00…0`) is skipped.

- [ ] **Step 1: Write the failing test — `packages/shared/test/logger-otel.test.js`**

```js
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { traceContextMixin, withTraceContext } from '../logger-otel.js';

/** @type {NodeTracerProvider} */
let provider;

beforeAll(() => {
  const cm = new AsyncLocalStorageContextManager();
  provider = new NodeTracerProvider();
  provider.register({ contextManager: cm });
});

afterAll(async () => {
  await provider.shutdown();
});

describe('traceContextMixin', () => {
  it('returns only service.name when no active span', () => {
    const mixin = traceContextMixin('svc-x');
    expect(mixin()).toEqual({ 'service.name': 'svc-x' });
  });

  it('includes trace.id and span.id when a span is active', () => {
    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('s', (span) => {
      const out = traceContextMixin('svc-x')();
      expect(out['service.name']).toBe('svc-x');
      expect(typeof out['trace.id']).toBe('string');
      expect(typeof out['span.id']).toBe('string');
      expect(out['trace.id'].length).toBeGreaterThan(0);
      span.end();
    });
  });
});

describe('withTraceContext', () => {
  it('merges trace context onto an arbitrary fields object', () => {
    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('s', (span) => {
      const merged = withTraceContext({ foo: 1 }, 'svc-y');
      expect(merged.foo).toBe(1);
      expect(merged['service.name']).toBe('svc-y');
      expect(typeof merged['trace.id']).toBe('string');
      span.end();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test --isolate --cwd packages/shared test/logger-otel.test.js
```
Expected: FAIL — `Cannot find module '../logger-otel.js'`.

- [ ] **Step 3: Create `packages/shared/logger-otel.js`**

```js
/**
 * Adds trace.id / span.id / service.name to log records without changing the
 * rest of the log schema. Dotted keys flatten in Elasticsearch into the indexed
 * fields the APM UI queries (trace.id, span.id).
 */
import { trace } from '@opentelemetry/api';

const ZERO_TRACE_ID = '00000000000000000000000000000000';

function activeContext() {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  if (!ctx?.traceId || ctx.traceId === ZERO_TRACE_ID) return null;
  return { 'trace.id': ctx.traceId, 'span.id': ctx.spanId };
}

/**
 * pino `mixin` — called per log record. Adds correlation fields.
 * @param {string} serviceName
 * @returns {() => Record<string, unknown>}
 */
export function traceContextMixin(serviceName) {
  return function mixin() {
    const ctx = activeContext();
    return ctx ? { ...ctx, 'service.name': serviceName } : { 'service.name': serviceName };
  };
}

/**
 * Imperative helper for non-pino loggers (MCP stderr).
 * @template {Record<string, unknown>} T
 * @param {T} fields
 * @param {string} serviceName
 * @returns {T & { 'service.name': string, 'trace.id'?: string, 'span.id'?: string }}
 */
export function withTraceContext(fields, serviceName) {
  const ctx = activeContext();
  return { ...fields, 'service.name': serviceName, ...(ctx ?? {}) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test --isolate --cwd packages/shared test/logger-otel.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/logger-otel.js packages/shared/test/logger-otel.test.js
git commit -m "feat(shared): add trace-context log helpers"
```

---

## Task 4: Shared `tracing.js` — app-level span helpers

**Files:**
- Create: `packages/shared/tracing.js`
- Test: `packages/shared/test/tracing.test.js`

**Interfaces:**
- Produces: `traceFn(name: string, attrs: object, fn: (span) => Promise<T>|T): Promise<T>` and `tracedService(prefix: string, methods: object): object`. When `OTEL_ENABLED !== 'true'`, `traceFn` calls `fn` with a no-op span shim (no tracer cost).

- [ ] **Step 1: Write the failing test — `packages/shared/test/tracing.test.js`**

```js
import { afterEach, describe, expect, it } from 'bun:test';
import { traceFn, tracedService } from '../tracing.js';

describe('traceFn (OTEL disabled)', () => {
  afterEach(() => {
    delete process.env.OTEL_ENABLED;
  });

  it('runs fn with a no-op span and returns its value', async () => {
    delete process.env.OTEL_ENABLED;
    const out = await traceFn('op', { a: 1 }, (span) => {
      span.setAttribute('x', 1); // must not throw on the shim
      return 42;
    });
    expect(out).toBe(42);
  });

  it('propagates thrown errors', async () => {
    delete process.env.OTEL_ENABLED;
    await expect(
      traceFn('op', {}, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('tracedService', () => {
  it('wraps functions and passes non-functions through, binding this', async () => {
    const svc = tracedService('svc', {
      CONST: 7,
      async add(a, b) {
        return a + b;
      },
      async addThenConst(a) {
        // intra-service call must resolve on the wrapped object
        return (await this.add(a, 1)) + this.CONST;
      },
    });
    expect(svc.CONST).toBe(7);
    expect(await svc.add(2, 3)).toBe(5);
    expect(await svc.addThenConst(1)).toBe(9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test --isolate --cwd packages/shared test/tracing.test.js
```
Expected: FAIL — `Cannot find module '../tracing.js'`.

- [ ] **Step 3: Create `packages/shared/tracing.js`**

```js
/**
 * Generic OpenTelemetry span helper for tracing arbitrary app-level operations
 * (service-method calls, business workflows). When OTEL_ENABLED !== 'true' the
 * function is invoked directly with a no-op span shim, so callers never pay
 * tracing overhead in test or non-instrumented environments.
 */
import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('mycelium-shared/app');

/** @type {any} */
const noopSpan = {
  setAttribute() {},
  setAttributes() {},
  recordException() {},
  setStatus() {},
  end() {},
};

/**
 * Execute `fn` inside an active OTel span named `name`.
 * @template T
 * @param {string} name
 * @param {Record<string, unknown>} attrs
 * @param {(span: import('@opentelemetry/api').Span) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function traceFn(name, attrs, fn) {
  if (process.env.OTEL_ENABLED !== 'true') return fn(noopSpan);
  return tracer.startActiveSpan(name, async (span) => {
    if (attrs) span.setAttributes(/** @type {any} */ (attrs));
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Wrap each method on `methods` so every call emits a span named
 * `${prefix}.${methodName}`. Non-function values pass through untouched.
 * `this` inside wrapped methods refers to the wrapped object so intra-service
 * calls continue to trace.
 * @template {Record<string, any>} T
 * @param {string} prefix
 * @param {T} methods
 * @returns {T}
 */
export function tracedService(prefix, methods) {
  /** @type {any} */
  const wrapped = {};
  for (const [key, value] of Object.entries(methods)) {
    if (typeof value !== 'function') {
      wrapped[key] = value;
      continue;
    }
    const spanName = `${prefix}.${key}`;
    wrapped[key] = function tracedMethod(...args) {
      return traceFn(spanName, {}, () => value.apply(wrapped, args));
    };
  }
  return wrapped;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test --isolate --cwd packages/shared test/tracing.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/tracing.js packages/shared/test/tracing.test.js
git commit -m "feat(shared): add traceFn and tracedService span helpers"
```

---

## Task 5: Export telemetry symbols from `@mycelium/shared`

**Files:**
- Modify: `packages/shared/package.json` (exports map)
- Modify: `packages/shared/index.js`

**Interfaces:**
- Consumes: `startOtel` (Task 2), `traceContextMixin`/`withTraceContext` (Task 3), `traceFn`/`tracedService` (Task 4).
- Produces: package-root imports `import { startOtel, traceContextMixin, withTraceContext, traceFn, tracedService } from '@mycelium/shared'` and subpath imports `@mycelium/shared/otel`, `/logger-otel`, `/tracing`.

> **Note on the barrel:** `index.js` currently omits `redis.js` because the web app's Vite build cannot bundle Bun's `RedisClient`. `otel.js` imports Node/OTel server-only modules and must **not** be pulled into any web bundle. It is safe to re-export from `index.js` because only the server apps import the barrel — but keep the subpath exports so server code can import `@mycelium/shared/otel` directly and avoid the barrel entirely.

- [ ] **Step 1: Add subpath exports to `packages/shared/package.json`**

In the `"exports"` object, add:
```json
"./otel": "./otel.js",
"./logger-otel": "./logger-otel.js",
"./tracing": "./tracing.js"
```

- [ ] **Step 2: Re-export telemetry symbols from `packages/shared/index.js`**

Append to the end of the file:
```js
export { startOtel } from './otel.js';
export { traceContextMixin, withTraceContext } from './logger-otel.js';
export { traceFn, tracedService } from './tracing.js';
```

- [ ] **Step 3: Verify the barrel resolves (smoke import)**

```bash
bun -e "import('@mycelium/shared').then(m => console.log(typeof m.startOtel, typeof m.traceFn, typeof m.traceContextMixin))"
```
Expected: `function function function`.

- [ ] **Step 4: Run the full shared suite (no regressions)**

```bash
bun test --isolate --cwd packages/shared
```
Expected: PASS (existing + the 3 new telemetry test files).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json packages/shared/index.js
git commit -m "feat(shared): export telemetry symbols from barrel and subpaths"
```

---

## Task 6: api instrumentation preload

**Files:**
- Create: `apps/api/src/instrumentation.js`
- Create: `apps/api/bunfig.toml`

**Interfaces:**
- Consumes: `startOtel` from `@mycelium/shared`.
- Produces: OTel SDK started (when enabled) before `src/index.js` runs, plus SIGTERM/SIGINT shutdown.

- [ ] **Step 1: Create `apps/api/src/instrumentation.js`**

```js
/**
 * Loaded via bunfig.toml `preload`. MUST run before src/index.js imports
 * Prisma / undici so OTel auto-instrumentation attaches correctly.
 */
import { startOtel } from '@mycelium/shared';
import pkg from '../package.json' with { type: 'json' };

const { shutdown } = startOtel({
  serviceName: 'mycelium-api',
  serviceVersion: pkg.version,
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    shutdown().finally(() => process.exit(0));
  });
}
```

- [ ] **Step 2: Create `apps/api/bunfig.toml`**

```toml
preload = ["./src/instrumentation.js"]
```

- [ ] **Step 3: Verify the app still boots with OTel disabled**

```bash
cd apps/api && OTEL_ENABLED=false bun src/index.js &
sleep 2 && curl -s localhost:3000/health && kill %1
```
Expected: health response returns; no OTel errors on stderr (preload is a no-op when disabled).

- [ ] **Step 4: Verify tests still pass (preload runs under `bun test`, must no-op)**

```bash
bun test --isolate --cwd apps/api
```
Expected: PASS — `OTEL_ENABLED` is unset so no SDK boots.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/instrumentation.js apps/api/bunfig.toml
git commit -m "feat(api): preload OpenTelemetry instrumentation via bunfig"
```

---

## Task 7: mcp instrumentation preload

**Files:**
- Create: `apps/mcp/src/instrumentation.js`
- Create: `apps/mcp/bunfig.toml`

**Interfaces:**
- Consumes: `startOtel` from `@mycelium/shared`.
- Produces: OTel SDK started (when enabled) before the MCP server imports services.

- [ ] **Step 1: Create `apps/mcp/src/instrumentation.js`**

```js
/**
 * Loaded via bunfig.toml `preload`. MUST run before the MCP server imports
 * the api services / Prisma so OTel auto-instrumentation attaches correctly.
 */
import { startOtel } from '@mycelium/shared';
import pkg from '../package.json' with { type: 'json' };

const { shutdown } = startOtel({
  serviceName: 'mycelium-mcp',
  serviceVersion: pkg.version,
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    shutdown().finally(() => process.exit(0));
  });
}
```

- [ ] **Step 2: Create `apps/mcp/bunfig.toml`**

```toml
preload = ["./src/instrumentation.js"]
```

- [ ] **Step 3: Verify the MCP server still starts (stdout stays clean)**

```bash
cd apps/mcp && OTEL_ENABLED=false timeout 3 bun start 2>/tmp/mcp.err 1>/tmp/mcp.out; echo "stdout bytes: $(wc -c </tmp/mcp.out)"
```
Expected: no OTel diagnostics leaked to stdout (protocol frames only; `stdout bytes` reflects only MCP output, not log lines).

- [ ] **Step 4: Verify mcp tests still pass**

```bash
bun test --isolate --cwd apps/mcp
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/src/instrumentation.js apps/mcp/bunfig.toml
git commit -m "feat(mcp): preload OpenTelemetry instrumentation via bunfig"
```

---

## Task 8: api HTTP spans via `@elysia/opentelemetry`

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/index.js`

**Interfaces:**
- Consumes: the running SDK from Task 6.
- Produces: HTTP request spans (Root/Handler) for every route; parent context for downstream Prisma/undici spans.

- [ ] **Step 1: Install the plugin**

```bash
bun add --cwd apps/api @elysia/opentelemetry
```

- [ ] **Step 2: Register the plugin early in `apps/api/src/index.js`**

Add the import at the top of the import block:
```js
import { opentelemetry } from '@elysia/opentelemetry';
```
Register it on the app **before** the route groups and before `applyLogger(app)` — insert immediately after `const app = new Elysia()...onError(...)` chain is assigned, e.g. right after the `app` is created and before other `.use(...)` calls:
```js
app.use(opentelemetry({ serviceName: 'mycelium-api' }));
```
(If `app` is built as a single chained expression, break the chain so `opentelemetry` is the first `.use()`.)

- [ ] **Step 3: Verify a span is produced against a local collector**

Start the collector (created in Task 11 — if not yet present, skip to Step 4 and rely on Task 11's end-to-end check):
```bash
docker compose -f docker-compose.otel.yml up -d
cd apps/api && OTEL_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 bun src/index.js &
sleep 2 && curl -s localhost:3000/health >/dev/null && sleep 6
docker compose -f docker-compose.otel.yml logs otel-collector | grep -i "mycelium-api" | head
kill %1; docker compose -f docker-compose.otel.yml down
```
Expected: collector debug log shows a span batch tagged `service.name=mycelium-api`.

- [ ] **Step 4: Verify tests still pass (plugin inert with OTel off)**

```bash
bun test --isolate --cwd apps/api
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/src/index.js bun.lock
git commit -m "feat(api): emit HTTP spans via @elysia/opentelemetry"
```

---

## Task 9: api pino logger with receh-parity fields

Replace the `console.log` access logger with pino, matching receh's exact envelope and access-log keys so existing Elasticsearch mappings apply unchanged.

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/utils/logger.js`
- Modify: `apps/api/src/middleware/logger.js`
- Test: `apps/api/test/middleware/logger.test.js`

**Interfaces:**
- Consumes: `traceContextMixin` from `@mycelium/shared`.
- Produces: `logger` (pino instance) exported from `apps/api/src/utils/logger.js`; `applyLogger(app)` emits one access-log record per request with keys `requestId, method, path, status, responseTime, client, appVersion, userId, requestBody, responseBody` under `msg: "http"`, plus the `t`/`lvl`/`service.name`/`trace.id` envelope.

- [ ] **Step 1: Install pino**

```bash
bun add --cwd apps/api pino
bun add -d --cwd apps/api pino-pretty
```

- [ ] **Step 2: Create `apps/api/src/utils/logger.js`**

```js
import { pino } from 'pino';
import { traceContextMixin } from '@mycelium/shared';

const isDev = process.env.NODE_ENV === 'development';

// Async stdio destination batches writes off the hot path. Dev wires
// pino-pretty in-process (avoids worker_threads under Bun) for readable logs;
// import it lazily so production images can prune the devDependency.
const destination = isDev
  ? (await import('pino-pretty')).default({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      messageKey: 'msg',
      ignore: 'pid,hostname,t,lvl',
      singleLine: false,
    })
  : pino.destination({ sync: false, minLength: 4096 });

export const logger = pino(
  {
    base: null,
    level: isDev ? 'debug' : 'info',
    messageKey: 'msg',
    timestamp: () => `,"t":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ lvl: label }),
    },
    mixin: traceContextMixin('mycelium-api'),
    redact: {
      paths: [
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.apiKey',
        '*.secret',
        '*.authorization',
      ],
      censor: '[REDACTED]',
    },
  },
  destination,
);

const flush = () => {
  try {
    destination.flushSync?.();
  } catch {
    // ignore
  }
};
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, flush);
```

- [ ] **Step 3: Write the failing test — `apps/api/test/middleware/logger.test.js`**

```js
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { applyLogger } from '../../src/middleware/logger.js';

// Capture stdout lines the pino destination writes.
function captureStdout(fn) {
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    lines.push(chunk.toString());
    return orig(chunk, ...rest);
  };
  return fn().finally(() => {
    process.stdout.write = orig;
  });
}

describe('applyLogger', () => {
  test('emits an http access record with parity keys', async () => {
    const app = applyLogger(new Elysia()).get('/ping', () => 'ok');

    const lines = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
      lines.push(chunk.toString());
      return orig(chunk, ...rest);
    };
    try {
      await app.handle(new Request('http://localhost/ping'));
      // pino async destination flushes on next tick
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.stdout.write = orig;
    }

    const record = lines
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((r) => r.msg === 'http');

    expect(record).toBeDefined();
    for (const key of ['method', 'path', 'status', 'responseTime']) {
      expect(record).toHaveProperty(key);
    }
    expect(record).toHaveProperty('service.name', 'mycelium-api');
    expect(record.path).toBe('/ping');
    expect(typeof record.responseTime).toBe('number');
    expect(record.lvl).toBe('info');
    expect(typeof record.t).toBe('string');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
bun test --isolate --cwd apps/api test/middleware/logger.test.js
```
Expected: FAIL — current `applyLogger` uses `console.log`, so no pino record with `service.name` / `t` / `lvl` is produced.

- [ ] **Step 5: Rewrite `apps/api/src/middleware/logger.js`**

```js
import { logger } from '../utils/logger.js';

/**
 * Structured JSON access log (pino). Field keys are byte-identical to receh so
 * existing Elasticsearch mappings apply unchanged. Redaction runs through
 * pino's compiled fast-redact paths (see utils/logger.js).
 *
 * Empty onParse / mapResponse hooks are registered so @elysia/opentelemetry
 * emits Parse and MapResponse spans — without a handler those phases are
 * skipped and their time hides inside the Root span.
 *
 * @param {import('elysia').Elysia} app - root Elysia app instance.
 * @returns {import('elysia').Elysia} the same app (for chaining).
 */
export function applyLogger(app) {
  const logBody = process.env.LOG_BODY === 'true';
  return app
    .onRequest(({ request, store }) => {
      store.__startedAt = Date.now();
      store.__path = (() => {
        try {
          return new URL(request.url).pathname;
        } catch {
          return request.url;
        }
      })();
      store.__method = request.method;
      store.__requestBody = undefined;
      store.__responseBody = undefined;
      store.__client = (request.headers.get('x-mycelium-client') || 'web')
        .toLowerCase()
        .slice(0, 32);
      store.__appVersion = (request.headers.get('app-version') || '').slice(0, 32) || null;
    })
    // Empty hook so @elysia/opentelemetry emits a Parse span.
    .onParse(() => {})
    .onTransform(({ body, store }) => {
      store.__requestBody = body;
    })
    .onAfterHandle(({ response, store }) => {
      store.__responseBody = response;
    })
    // Empty hook so @elysia/opentelemetry emits a MapResponse span.
    .mapResponse(() => {})
    .onAfterResponse((ctx) => {
      const { store, set, requestId } = ctx;
      const responseTime = Date.now() - (store.__startedAt ?? Date.now());
      logger.info(
        {
          requestId,
          method: store.__method,
          path: store.__path,
          status: set.status ?? 200,
          responseTime,
          client: store.__client ?? 'web',
          appVersion: store.__appVersion ?? null,
          userId: ctx.user?.id ?? null,
          requestBody: logBody ? store.__requestBody : undefined,
          responseBody: logBody ? store.__responseBody : undefined,
        },
        'http',
      );
    });
}
```

- [ ] **Step 6: Run the logger test to verify it passes**

```bash
bun test --isolate --cwd apps/api test/middleware/logger.test.js
```
Expected: PASS.

- [ ] **Step 7: Run the full api suite (no regressions)**

```bash
bun test --isolate --cwd apps/api
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/utils/logger.js apps/api/src/middleware/logger.js apps/api/test/middleware/logger.test.js bun.lock
git commit -m "feat(api): pino access logger with trace correlation and receh-parity fields"
```

---

## Task 10: mcp stderr logs with trace context

**Files:**
- Modify: `apps/mcp/src/server.js` (and any mcp module that logs diagnostics to stderr)

**Interfaces:**
- Consumes: `withTraceContext` from `@mycelium/shared`.
- Produces: mcp diagnostic log lines carry `service.name: 'mycelium-mcp'` plus `trace.id`/`span.id` when a span is active. stdout stays protocol-only.

- [ ] **Step 1: Locate mcp stderr diagnostic logging**

```bash
grep -rn "console.error\|process.stderr" apps/mcp/src
```
Note each diagnostic log site. (stdio transport writes protocol frames to stdout; only stderr carries diagnostics.)

- [ ] **Step 2: Wrap diagnostic payloads with `withTraceContext`**

At the top of each file that logs diagnostics:
```js
import { withTraceContext } from '@mycelium/shared';
```
Replace raw structured stderr logs of the form:
```js
console.error(JSON.stringify({ level: 'error', msg: 'tool_failed', tool, err: String(err) }));
```
with:
```js
console.error(
  JSON.stringify(withTraceContext({ level: 'error', msg: 'tool_failed', tool, err: String(err) }, 'mycelium-mcp')),
);
```
Do not touch any `stdout` writes.

- [ ] **Step 3: Verify stdout stays clean and stderr carries service.name**

```bash
cd apps/mcp && OTEL_ENABLED=false timeout 3 bun start 2>/tmp/mcp.err 1>/tmp/mcp.out
grep -q "mycelium-mcp" /tmp/mcp.err && echo "stderr tagged OK"
echo "stdout bytes: $(wc -c </tmp/mcp.out)"
```
Expected: `stderr tagged OK` (if any diagnostic fired); stdout contains only protocol output.

- [ ] **Step 4: Run mcp tests**

```bash
bun test --isolate --cwd apps/mcp
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/src
git commit -m "feat(mcp): tag stderr diagnostics with trace context"
```

---

## Task 11: Deploy config + local collector

**Files:**
- Create: `docker-compose.otel.yml`
- Create: `bench/otel-collector.yaml`
- Modify: `.env.example`
- Modify: k8s manifests for api + mcp (configmap + secret)

**Interfaces:**
- Consumes: nothing at runtime — provides the env the shared `otel.js` reads.
- Produces: `OTEL_*` env wired for local dev and k8s; a local collector for offline trace inspection.

- [ ] **Step 1: Create `bench/otel-collector.yaml`**

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      exporters: [debug]
```

- [ ] **Step 2: Create `docker-compose.otel.yml`**

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.110.0
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes:
      - ./bench/otel-collector.yaml:/etc/otelcol/config.yaml:ro
    ports:
      - "4317:4317" # OTLP gRPC
      - "4318:4318" # OTLP HTTP
```

- [ ] **Step 3: Add OTEL_* keys to `.env.example`**

Append:
```bash
# OpenTelemetry -> Elastic APM. Flip OTEL_ENABLED to "true" to start exporting.
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=http://192.168.100.31:8200
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_TRACES_SAMPLER=always_on
OTEL_METRIC_EXPORT_INTERVAL=60000
OTEL_LOG_LEVEL=error
OTEL_DEPLOYMENT_ENVIRONMENT=development
# OTLP Authorization header for Elastic APM. URL-encode the space after Bearer.
# OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20REPLACE_ME
LOG_BODY=false
```

- [ ] **Step 4: Wire k8s env (api + mcp)**

Locate the gitops/k8s manifests for the api and mcp deployments (search the deploy repo / `k8s/` dirs). Add to each **configmap**:
```yaml
OTEL_ENABLED: "true"
OTEL_EXPORTER_OTLP_ENDPOINT: "http://192.168.100.31:8200"
OTEL_EXPORTER_OTLP_PROTOCOL: "grpc"
OTEL_TRACES_SAMPLER: "always_on"
OTEL_METRIC_EXPORT_INTERVAL: "60000"
OTEL_LOG_LEVEL: "error"
OTEL_DEPLOYMENT_ENVIRONMENT: "production"
```
Add to each **secret** (example manifest, real token injected out-of-band):
```yaml
OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20REPLACE_ME"
```
> If the k8s/gitops manifests live in a separate repo, record the required keys here and hand them off; do not commit secrets.

- [ ] **Step 5: End-to-end verification against the local collector**

```bash
docker compose up -d
docker compose -f docker-compose.otel.yml up -d
cd apps/api && OTEL_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 bun src/index.js &
sleep 2
curl -s localhost:3000/health >/dev/null
curl -s localhost:3000/api/v1/notes -H 'Authorization: Bearer test' >/dev/null || true
sleep 7
docker compose -f docker-compose.otel.yml logs otel-collector | grep -iE "service.name|mycelium-api|http" | head
kill %1
docker compose -f docker-compose.otel.yml down
```
Expected: collector debug output shows spans with `service.name=mycelium-api`, an HTTP root span, and (on the notes call) a Prisma/pg child span.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.otel.yml bench/otel-collector.yaml .env.example
git commit -m "chore(otel): add local collector, env template, and k8s OTEL_* wiring"
```

---

## Self-Review Notes

- **Spec coverage:** C1 shared module → Tasks 2–5; C2 Prisma v7 → Task 1; C3 preload → Tasks 6–7; C4 HTTP+pino → Tasks 8–9; C5 log parity → Task 9 (keys) + Task 3 (correlation fields); C6 deploy → Task 11. All spec components mapped.
- **Type consistency:** `startOtel`, `traceContextMixin`, `withTraceContext`, `traceFn`, `tracedService`, `checkConnection`, `logger`, `applyLogger` names are consistent across producing and consuming tasks.
- **Gate ordering:** Task 1 (Prisma v7) lands and passes the full suite before any telemetry task, per spec risk call-out.
- **Field parity:** Task 9 reproduces receh's pino base config verbatim (`t`, `lvl`, `msg`, dotted correlation keys) and the exact access-log key set — no new Elasticsearch mappings.
