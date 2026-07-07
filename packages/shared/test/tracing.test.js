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
