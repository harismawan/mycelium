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
