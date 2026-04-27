/**
 * Attach structured request logging hooks directly to an Elysia app instance.
 *
 * Must be called on the root app so hooks apply to all routes.
 * Registers `onRequest` to stamp start time and `onAfterResponse` to log.
 *
 * Output format:
 * ```json
 * {"method":"GET","path":"/api/v1/notes","status":200,"responseTime":12}
 * ```
 *
 * @param {import('elysia').Elysia} app - The root Elysia app instance.
 * @returns {import('elysia').Elysia} The same app instance (for chaining).
 */
export function applyLogger(app) {
  return app
    .onRequest((/** @type {{ request: Request }} */ ctx) => {
      // @ts-ignore — stamp start time on request
      ctx.request._startTime = performance.now();
    })
    .onAfterResponse(
      (/** @type {{ request: Request, set: { status?: number } }} */ ctx) => {
        // @ts-ignore
        const start = ctx.request._startTime;
        const responseTime = start != null ? Math.round(performance.now() - start) : -1;

        let pathname;
        try {
          pathname = new URL(ctx.request.url).pathname;
        } catch {
          pathname = ctx.request.url;
        }

        console.log(
          JSON.stringify({
            method: ctx.request.method,
            path: pathname,
            status: ctx.set.status ?? 200,
            responseTime,
          }),
        );
      },
    );
}
