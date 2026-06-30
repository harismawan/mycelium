-- pgvector semantic-search arm (R13). The whole arm is optional: when
-- EMBEDDING_PROVIDER is unset no embeddings are written and search behaves
-- exactly as before, so this migration is safe to apply ahead of enabling a
-- provider. Existing rows keep embedding = NULL until backfilled.

CREATE EXTENSION IF NOT EXISTS vector;

-- Prisma Unsupported("vector(1024)") — 1024 dims to match EMBEDDING_DIMENSIONS.
ALTER TABLE "Note" ADD COLUMN "embedding" vector(1024);

-- Approximate-NN index for cosine distance (the `<=>` operator SearchService
-- uses). HNSW needs no training step and only indexes the non-NULL rows.
CREATE INDEX "Note_embedding_idx" ON "Note" USING hnsw ("embedding" vector_cosine_ops);
