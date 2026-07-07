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
