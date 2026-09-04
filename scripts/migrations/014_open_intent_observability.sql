-- Parte D4: trazabilidad de búsquedas con intención abierta.
-- Metadata acotada; no guarda prompts, imágenes ni payloads de proveedores.
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS event_label TEXT;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS closed_occasion_recognized BOOLEAN;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS component_queries JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS candidate_counts_by_tier JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS selected_match_levels JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS latency_planning_ms INTEGER;

CREATE INDEX IF NOT EXISTS ix_rag_query_log_event_label ON rag_query_log(event_label, created_at);
CREATE INDEX IF NOT EXISTS ix_rag_query_log_outcome ON rag_query_log(outcome, created_at);
