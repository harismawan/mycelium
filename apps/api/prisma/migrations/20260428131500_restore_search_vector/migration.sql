-- Restore searchVector generated column + GIN index for full-text search

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Note'
      AND column_name = 'searchVector'
  ) THEN
    ALTER TABLE "Note"
      ADD COLUMN "searchVector" tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'B')
      ) STORED;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Note_searchVector_idx"
  ON "Note" USING GIN ("searchVector");
