-- Fase 8.3: provenance required by the Python offline embedding job.
-- rollback: ALTER TABLE catalog_embeddings DROP COLUMN embedding_task_type;
-- ALTER TABLE catalog_embeddings DROP COLUMN embedding_dimensions;
-- DROP TABLE catalog_embedding_job_lock;

ALTER TABLE catalog_embeddings
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER,
  ADD COLUMN IF NOT EXISTS embedding_task_type TEXT;

-- Existing rows were produced by the TypeScript document-embedding job, which
-- already fixed this task and the VECTOR(768) column. Backfill provenance from
-- the stored vector instead of forcing a full paid reindex on first run.
UPDATE catalog_embeddings
SET embedding_dimensions = vector_dims(embedding),
    embedding_task_type = 'RETRIEVAL_DOCUMENT'
WHERE embedding_dimensions IS NULL
  AND embedding_task_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_embeddings_dimensions_check'
      AND conrelid = 'public.catalog_embeddings'::regclass
  ) THEN
    ALTER TABLE catalog_embeddings
      ADD CONSTRAINT catalog_embeddings_dimensions_check
      CHECK (embedding_dimensions IS NULL OR embedding_dimensions = 768);
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_embeddings_task_type_check'
      AND conrelid = 'public.catalog_embeddings'::regclass
  ) THEN
    ALTER TABLE catalog_embeddings
      ADD CONSTRAINT catalog_embeddings_task_type_check
      CHECK (embedding_task_type IS NULL OR embedding_task_type = 'RETRIEVAL_DOCUMENT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS catalog_embedding_job_lock (
  lock_name   TEXT PRIMARY KEY,
  owner_id    UUID NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_catalog_embedding_job_lock_expires
  ON catalog_embedding_job_lock (expires_at);
