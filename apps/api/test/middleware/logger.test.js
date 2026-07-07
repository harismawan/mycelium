import { describe, expect, test } from 'bun:test';

describe('applyLogger', () => {
  test('emits an http access record with parity keys', async () => {
    const child = Bun.spawn({
      cmd: [
        'bun',
        '-e',
        `
          import { Elysia } from 'elysia';
          import { applyLogger } from './src/middleware/logger.js';
          import { requestIdMiddleware } from './src/middleware/request-id.js';
          import { logger } from './src/utils/logger.js';

          const app = new Elysia().use(requestIdMiddleware);
          applyLogger(app).get('/ping', () => 'ok');

          await app.handle(new Request('http://localhost/ping', {
            headers: {
              'app-version': '1.2.3',
              'x-mycelium-client': 'CLI',
              'x-request-id': 'logger-test-id',
            },
          }));
          logger.flush?.();
          await new Promise((r) => setTimeout(r, 50));
        `,
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOG_BODY: 'false',
        NODE_ENV: 'test',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode, stderr).toBe(0);

    const record = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((r) => r.msg === 'http');

    expect(record).toBeDefined();
    expect(record).toHaveProperty('requestId', 'logger-test-id');
    expect(record).toHaveProperty('method', 'GET');
    expect(record).toHaveProperty('path', '/ping');
    expect(record).toHaveProperty('status', 200);
    expect(record).toHaveProperty('client', 'cli');
    expect(record).toHaveProperty('appVersion', '1.2.3');
    expect(record).toHaveProperty('userId', null);
    expect(record['service.name']).toBe('mycelium-api');
    expect(Number.isInteger(record.responseTime)).toBe(true);
    expect(record.lvl).toBe('info');
    expect(typeof record.t).toBe('string');
    expect(record).not.toHaveProperty('requestBody');
    expect(record).not.toHaveProperty('responseBody');
  });
});
