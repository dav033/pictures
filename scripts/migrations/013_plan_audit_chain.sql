ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS rag_query_refs TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS quote_hash TEXT;
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS scene_spec_hash TEXT;
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS qa_hash TEXT;
ALTER TABLE plan_audit_log ADD COLUMN IF NOT EXISTS flag_snapshot JSONB;
CREATE INDEX IF NOT EXISTS plan_audit_log_quote_idx ON plan_audit_log (quote_hash, created_at DESC);
