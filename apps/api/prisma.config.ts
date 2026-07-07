import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'bun prisma/seed.js',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
