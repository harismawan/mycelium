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
