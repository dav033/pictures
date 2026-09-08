-- Deterministic plan audit trail. Content is bounded JSON metadata only:
-- no provider prompts, generated images, API keys, or raw catalog payloads.
-- rollback: DROP INDEX plan_audit_log_hash_idx; DROP INDEX plan_audit_log_request_idx; DROP TABLE plan_audit_log;
-- El rollback elimina todo el histórico de auditoría de planes; exportarlo y asegurar que no haya escritores activos antes de ejecutarlo.
CREATE TABLE IF NOT EXISTS plan_audit_log (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL,
  plan_hash TEXT,
  solicitud_original TEXT,
  restricciones JSONB,
  rag_query_ids UUID[] NOT NULL DEFAULT '{}',
  candidate_product_ids TEXT[] NOT NULL DEFAULT '{}',
  selected_product_ids TEXT[] NOT NULL DEFAULT '{}',
  geometry JSONB,
  cost_min_cop INTEGER,
  cost_chosen_cop INTEGER,
  ceiling_cop INTEGER,
  delta_cop INTEGER,
  packages JSONB,
  instances JSONB,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_audit_log_request_idx ON plan_audit_log (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plan_audit_log_hash_idx ON plan_audit_log (plan_hash, created_at DESC);
