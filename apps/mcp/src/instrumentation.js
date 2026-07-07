/**
 * Loaded via bunfig.toml `preload`. MUST run before the MCP server imports
 * the api services / Prisma so OTel auto-instrumentation attaches correctly.
 */
import { startOtel } from '@mycelium/shared/otel';
import pkg from '../package.json' with { type: 'json' };

const { shutdown } = startOtel({
  serviceName: 'mycelium-mcp',
  serviceVersion: pkg.version,
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    shutdown().finally(() => process.exit(0));
  });
}
