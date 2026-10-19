-- Fase 8.2: preserve the optional rerank branch outcome with the durable RAG log.
-- rollback: ALTER TABLE rag_query_log DROP COLUMN rerank_status;

ALTER TABLE rag_query_log
  ADD COLUMN IF NOT EXISTS rerank_status TEXT;

ALTER TABLE rag_query_log
  DROP CONSTRAINT IF EXISTS rag_query_log_rerank_status_check;

ALTER TABLE rag_query_log
  ADD CONSTRAINT rag_query_log_rerank_status_check
  CHECK (rerank_status IS NULL OR rerank_status IN ('READY', 'SKIPPED_OPTIONAL', 'ERROR'));
