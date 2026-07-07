import { describe, expect, test } from 'bun:test';

import { captureLoggerRecord } from '../helpers/capture-logger.js';

describe('applyLogger', () => {
  test('emits an http access record with parity keys', async () => {
    const { logEntry: record } = await captureLoggerRecord({
      script: `
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
    });

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

  test('redacts password from logged request body when LOG_BODY is true', async () => {
    const { logEntry: record } = await captureLoggerRecord({
      script: `
          import { Elysia } from 'elysia';
          import { applyLogger } from './src/middleware/logger.js';
          import { requestIdMiddleware } from './src/middleware/request-id.js';
          import { logger } from './src/utils/logger.js';

          const app = new Elysia().use(requestIdMiddleware);
          applyLogger(app).post('/login', ({ body }) => ({ ok: true, email: body.email }));

          await app.handle(new Request('http://localhost/login', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'redact-test-id',
            },
            body: JSON.stringify({
              email: 'user@example.com',
              password: 'plaintext-password',
            }),
          }));
          logger.flush?.();
          await new Promise((r) => setTimeout(r, 50));
        `,
      env: {
        LOG_BODY: 'true',
      },
    });

    expect(record).toBeDefined();
    expect(record.requestBody.password).toBe('[REDACTED]');
    expect(record.requestBody.password).not.toBe('plaintext-password');
  });
});
