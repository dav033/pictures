-- Parte D4: trazabilidad de búsquedas con intención abierta.
-- Metadata acotada; no guarda prompts, imágenes ni payloads de proveedores.
-- rollback: DROP INDEX ix_rag_query_log_outcome; DROP INDEX ix_rag_query_log_event_label; ALTER TABLE rag_query_log DROP COLUMN latency_planning_ms; ALTER TABLE rag_query_log DROP COLUMN outcome; ALTER TABLE rag_query_log DROP COLUMN selected_match_levels; ALTER TABLE rag_query_log DROP COLUMN candidate_counts_by_tier; ALTER TABLE rag_query_log DROP COLUMN component_queries; ALTER TABLE rag_query_log DROP COLUMN closed_occasion_recognized; ALTER TABLE rag_query_log DROP COLUMN event_label;
-- El rollback elimina la observabilidad de intención abierta; exportar rag_query_log y detener escritores o consumidores de estas columnas.
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS event_label TEXT;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS closed_occasion_recognized BOOLEAN;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS component_queries JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS candidate_counts_by_tier JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS selected_match_levels JSONB;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE rag_query_log ADD COLUMN IF NOT EXISTS latency_planning_ms INTEGER;

CREATE INDEX IF NOT EXISTS ix_rag_query_log_event_label ON rag_query_log(event_label, created_at);
CREATE INDEX IF NOT EXISTS ix_rag_query_log_outcome ON rag_query_log(outcome, created_at);
