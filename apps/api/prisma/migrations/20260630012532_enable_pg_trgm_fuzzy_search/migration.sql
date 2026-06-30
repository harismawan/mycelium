-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "Note_title_trgm_idx" ON "Note" USING GIN ("title" gin_trgm_ops);
