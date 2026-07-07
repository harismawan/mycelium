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
