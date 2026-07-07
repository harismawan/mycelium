import { pino } from 'pino';
import { traceContextMixin } from '@mycelium/shared/logger-otel';

const isDev = process.env.NODE_ENV === 'development';

// Async stdio destination batches writes off the hot path. Dev wires
// pino-pretty in-process (avoids worker_threads under Bun) for readable logs;
// import it lazily so production images can prune the devDependency.
const destination = isDev
  ? (await import('pino-pretty')).default({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      messageKey: 'msg',
      ignore: 'pid,hostname,t,lvl',
      singleLine: false,
    })
  : pino.destination({ sync: false, minLength: 4096 });

export const logger = pino(
  {
    base: null,
    level: isDev ? 'debug' : 'info',
    messageKey: 'msg',
    timestamp: () => `,"t":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ lvl: label }),
    },
    mixin: traceContextMixin('mycelium-api'),
    redact: {
      paths: [
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.apiKey',
        '*.secret',
        '*.authorization',
      ],
      censor: '[REDACTED]',
    },
  },
  destination,
);

const flush = () => {
  try {
    destination.flushSync?.();
  } catch {
    // ignore
  }
};
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, flush);
