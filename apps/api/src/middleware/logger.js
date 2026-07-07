import { logger } from '../utils/logger.js';

const perRequest = new WeakMap();

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
    .onRequest(({ request }) => {
      perRequest.set(request, {
        startedAt: Date.now(),
        path: (() => {
          try {
            return new URL(request.url).pathname;
          } catch {
            return request.url;
          }
        })(),
        method: request.method,
        requestBody: undefined,
        responseBody: undefined,
        client: (request.headers.get('x-mycelium-client') || 'web').toLowerCase().slice(0, 32),
        appVersion: (request.headers.get('app-version') || '').slice(0, 32) || null,
      });
    })
    // Empty hook so @elysia/opentelemetry emits a Parse span.
    .onParse(() => {})
    .onTransform(({ body, request }) => {
      const state = perRequest.get(request);
      if (state) {
        state.requestBody = body;
      }
    })
    .onAfterHandle(({ response, request }) => {
      const state = perRequest.get(request);
      if (state) {
        state.responseBody = response;
      }
    })
    // Empty hook so @elysia/opentelemetry emits a MapResponse span.
    .mapResponse(() => {})
    .onAfterResponse((ctx) => {
      const { set, request, requestId } = ctx;
      const state = perRequest.get(request) ?? {};
      const responseTime = Date.now() - (state.startedAt ?? Date.now());
      perRequest.delete(request);
      logger.info(
        {
          requestId,
          method: state.method,
          path: state.path,
          status: set.status ?? 200,
          responseTime,
          client: state.client ?? 'web',
          appVersion: state.appVersion ?? null,
          userId: ctx.user?.id ?? null,
          requestBody: logBody ? state.requestBody : undefined,
          responseBody: logBody ? state.responseBody : undefined,
        },
        'http',
      );
    });
}
