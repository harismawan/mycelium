import { prisma } from '../src/db.js';
import { embedText } from '../src/services/embedding.service.js';

/**
 * Backfill embeddings for notes that don't have one yet.
 *
 * Resumable & idempotent: each pass selects only `embedding IS NULL` rows, so
 * re-running picks up where it stopped (just-embedded rows leave the NULL set).
 * Exits early if the provider is disabled (embedText -> null) rather than
 * looping forever.
 *
 * Run with: bun run apps/api/scripts/backfill-embeddings.js
 */
const BATCH = 50;
let processed = 0;

for (;;) {
  const notes = await prisma.$queryRaw`
    SELECT "id", "title", "content"
    FROM "Note"
    WHERE "embedding" IS NULL AND "status" != 'ARCHIVED'
    ORDER BY "updatedAt" DESC
    LIMIT ${BATCH}
  `;
  if (notes.length === 0) break;

  for (const note of notes) {
    const embedding = await embedText(`${note.title}\n\n${note.content}`);
    if (!embedding) {
      process.stderr.write('embedText returned null (provider unset or failing); aborting\n');
      await prisma.$disconnect();
      process.exit(1);
    }
    const literal = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`UPDATE "Note" SET "embedding" = ${literal}::vector WHERE "id" = ${note.id}`;
    processed += 1;
  }
  process.stdout.write(`backfilled ${processed} notes...\n`);
}

process.stdout.write(`done: ${processed} notes embedded\n`);
await prisma.$disconnect();
