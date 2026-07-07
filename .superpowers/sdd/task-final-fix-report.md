# Final Fix Report

## Diff Summary

- Replaced shared Elysia `store.__*` logger request state with a module-level `WeakMap` keyed by each request object in `apps/api/src/middleware/logger.js`.
- Kept the emitted `http` log record keys and value sources unchanged, including `requestId`, `method`, `path`, `status`, `responseTime`, `client`, `appVersion`, `userId`, and conditional body fields.
- Preserved the empty `onParse(() => {})` and `mapResponse(() => {})` hooks for OTel span coverage.

## New Test

- Added `keeps access log state isolated across concurrent requests` in `apps/api/test/middleware/logger.test.js`.
- The test drives concurrent `/a` and `/b` requests with interleaved handlers and asserts each emitted `msg: 'http'` record keeps its own request method/path/status.
- Red check before the fix failed because `concurrent-a` logged `POST /b` instead of `GET /a`.

## Verification

- `bun test --isolate --cwd apps/api test/middleware/logger.test.js`: 3 pass, 0 fail, 23 expect calls.
- `bun test --isolate --cwd apps/api`: 439 pass, 0 fail, 8155 expect calls.
