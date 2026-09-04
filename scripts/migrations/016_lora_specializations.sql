-- Separación auditable de LoRA producto y estructura.
-- No borra ni fusiona pesos históricos. Requiere 015_lora_training_registry.sql.

ALTER TABLE lora_datasets
  ADD COLUMN IF NOT EXISTS specialization TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS structure_types JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS base_model TEXT NOT NULL DEFAULT 'FLUX.2 [dev]',
  ADD COLUMN IF NOT EXISTS tokenizer_revision TEXT NOT NULL DEFAULT 'provider-default',
  ADD COLUMN IF NOT EXISTS resolution INTEGER NOT NULL DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS caption_schema_version TEXT NOT NULL DEFAULT 'lora-caption-v1',
  ADD COLUMN IF NOT EXISTS caption_audit JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS license_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS evaluation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS split_policy JSONB NOT NULL DEFAULT '{}';

ALTER TABLE lora_datasets
  DROP CONSTRAINT IF EXISTS lora_datasets_specialization_check,
  DROP CONSTRAINT IF EXISTS lora_datasets_license_status_check,
  DROP CONSTRAINT IF EXISTS lora_datasets_evaluation_status_check;

ALTER TABLE lora_datasets
  ADD CONSTRAINT lora_datasets_specialization_check
    CHECK (specialization IN ('product', 'structure')),
  ADD CONSTRAINT lora_datasets_license_status_check
    CHECK (license_status IN ('pending', 'verified', 'rejected')),
  ADD CONSTRAINT lora_datasets_evaluation_status_check
    CHECK (evaluation_status IN ('pending', 'running', 'approved', 'rejected'));

ALTER TABLE lora_dataset_images
  ADD COLUMN IF NOT EXISTS split TEXT NOT NULL DEFAULT 'train',
  ADD COLUMN IF NOT EXISTS assembly_id TEXT,
  ADD COLUMN IF NOT EXISTS event_key TEXT,
  ADD COLUMN IF NOT EXISTS structure_types JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '[]';

ALTER TABLE lora_training_runs
  DROP CONSTRAINT IF EXISTS lora_training_runs_status_check;

ALTER TABLE lora_training_runs
  ADD COLUMN IF NOT EXISTS specialization TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS trigger_token TEXT NOT NULL DEFAULT 'eventdecor_style_v2',
  ADD COLUMN IF NOT EXISTS base_model TEXT NOT NULL DEFAULT 'FLUX.2 [dev]',
  ADD COLUMN IF NOT EXISTS tokenizer_revision TEXT NOT NULL DEFAULT 'provider-default',
  ADD COLUMN IF NOT EXISTS resolution INTEGER NOT NULL DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS caption_audit JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS license_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS evaluation_status TEXT NOT NULL DEFAULT 'pending';

UPDATE lora_training_runs SET status = 'completed' WHERE status = 'succeeded';

ALTER TABLE lora_training_runs
  ADD CONSTRAINT lora_training_runs_status_check
    CHECK (status IN ('draft', 'ready', 'uploading', 'queued', 'running', 'completed', 'succeeded', 'failed', 'cancelled')),
  ADD CONSTRAINT lora_training_runs_specialization_check
    CHECK (specialization IN ('product', 'structure')),
  ADD CONSTRAINT lora_training_runs_license_status_check
    CHECK (license_status IN ('pending', 'verified', 'rejected')),
  ADD CONSTRAINT lora_training_runs_evaluation_status_check
    CHECK (evaluation_status IN ('pending', 'running', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS ix_lora_datasets_specialization
  ON lora_datasets(specialization, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_lora_runs_specialization
  ON lora_training_runs(specialization, status, created_at DESC);

CREATE TABLE IF NOT EXISTS lora_artifacts (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT REFERENCES lora_training_runs(id) ON DELETE CASCADE,
  dataset_id         TEXT REFERENCES lora_datasets(id) ON DELETE CASCADE,
  specialization     TEXT NOT NULL CHECK (specialization IN ('product', 'structure')),
  kind               TEXT NOT NULL CHECK (kind IN ('dataset_zip', 'manifest', 'caption_bundle', 'checkpoint', 'weights', 'receipt', 'evaluation_report', 'log')),
  storage_key        TEXT NOT NULL,
  provider_url       TEXT,
  sha256             TEXT NOT NULL,
  bytes              BIGINT NOT NULL CHECK (bytes >= 0),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'backed_up', 'invalid')),
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (run_id IS NOT NULL OR dataset_id IS NOT NULL),
  UNIQUE (storage_key),
  UNIQUE (run_id, kind)
);

CREATE INDEX IF NOT EXISTS ix_lora_artifacts_lookup
  ON lora_artifacts(specialization, kind, status, created_at DESC);

CREATE TABLE IF NOT EXISTS lora_checkpoints (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES lora_training_runs(id) ON DELETE CASCADE,
  artifact_id        TEXT NOT NULL REFERENCES lora_artifacts(id) ON DELETE RESTRICT,
  step               INTEGER NOT NULL CHECK (step > 0),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'backed_up', 'invalid')),
  evaluation_status  TEXT NOT NULL DEFAULT 'pending' CHECK (evaluation_status IN ('pending', 'running', 'approved', 'rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, step)
);

CREATE TABLE IF NOT EXISTS lora_generation_profiles (
  id                   TEXT PRIMARY KEY,
  label                TEXT NOT NULL UNIQUE,
  base_model           TEXT NOT NULL,
  tokenizer_revision   TEXT NOT NULL,
  resolution           INTEGER NOT NULL CHECK (resolution > 0),
  product_artifact_id  TEXT REFERENCES lora_artifacts(id) ON DELETE SET NULL,
  structure_artifact_id TEXT REFERENCES lora_artifacts(id) ON DELETE SET NULL,
  product_scale        NUMERIC(5, 3) NOT NULL DEFAULT 0.3 CHECK (product_scale >= 0 AND product_scale <= 1.5),
  structure_scale      NUMERIC(5, 3) NOT NULL DEFAULT 0.6 CHECK (structure_scale >= 0 AND structure_scale <= 1.5),
  active               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (product_artifact_id IS NOT NULL OR structure_artifact_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lora_generation_profiles_active
  ON lora_generation_profiles(active) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS lora_idempotency_events (
  idempotency_key TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES lora_training_runs(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  response        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, action, idempotency_key)
);

CREATE TABLE IF NOT EXISTS lora_composition_events (
  id                   TEXT PRIMARY KEY,
  product_artifact_id  TEXT REFERENCES lora_artifacts(id) ON DELETE SET NULL,
  structure_artifact_id TEXT REFERENCES lora_artifacts(id) ON DELETE SET NULL,
  product_scale        NUMERIC(5, 3),
  structure_scale      NUMERIC(5, 3),
  base_model           TEXT NOT NULL,
  tokenizer_revision   TEXT NOT NULL,
  resolution           INTEGER NOT NULL,
  triggers             JSONB NOT NULL DEFAULT '[]',
  prompt_hash          TEXT,
  scene_spec_hash      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

