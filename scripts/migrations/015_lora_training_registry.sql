-- Registro auditable de datasets, corridas y slots LoRA.
-- Esta migración es aditiva e idempotente: scripts/migrate.ts puede ejecutarla
-- sobre una base nueva o existente sin borrar evidencia histórica.

-- rollback: DROP INDEX IF EXISTS ix_lora_jobs_claim; DROP INDEX IF EXISTS ix_lora_slot_history_slot; DROP INDEX IF EXISTS ix_lora_evaluations_run; DROP INDEX IF EXISTS ix_lora_training_runs_status; DROP INDEX IF EXISTS ix_lora_training_runs_dataset; DROP INDEX IF EXISTS ix_lora_dataset_stats_shopify; DROP INDEX IF EXISTS ix_lora_dataset_elements_variant; DROP INDEX IF EXISTS ix_lora_dataset_elements_lookup; DROP INDEX IF EXISTS ix_lora_dataset_images_source; DROP INDEX IF EXISTS ix_lora_dataset_images_review; DROP INDEX IF EXISTS ix_lora_datasets_coverage; DROP INDEX IF EXISTS ix_lora_datasets_status;
-- DROP TABLE IF EXISTS lora_jobs; DROP TABLE IF EXISTS lora_mode_slot_history; DROP TABLE IF EXISTS lora_evaluations; DROP TABLE IF EXISTS lora_mode_slots; DROP TABLE IF EXISTS lora_dataset_element_stats; DROP TABLE IF EXISTS lora_dataset_image_elements; DROP TABLE IF EXISTS lora_dataset_images; DROP TABLE IF EXISTS lora_training_runs; DROP TABLE IF EXISTS lora_datasets;
-- Pierde datasets, imágenes, elementos, corridas, evaluaciones, slots, su histórico y jobs de entrenamiento LoRA; exportar todas esas tablas antes y no revertir con trabajos activos.

CREATE TABLE IF NOT EXISTS lora_datasets (
  id                       TEXT PRIMARY KEY,
  label                    TEXT NOT NULL UNIQUE,
  schema_version           TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'building'
                           CHECK (status IN ('building', 'ready', 'failed', 'archived')),
  trigger_token             TEXT NOT NULL,
  source_definition         JSONB NOT NULL DEFAULT '{}',
  image_count               INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  caption_count             INTEGER NOT NULL DEFAULT 0 CHECK (caption_count >= 0),
  zip_storage_key           TEXT,
  zip_sha256                TEXT UNIQUE,
  zip_bytes                 BIGINT CHECK (zip_bytes IS NULL OR zip_bytes >= 0),
  manifest_storage_key      TEXT,
  manifest_sha256           TEXT,
  statistics                JSONB NOT NULL DEFAULT '{}',
  coverage_status           TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (coverage_status IN ('complete', 'partial', 'unknown')),
  coverage_reviewed_images  INTEGER NOT NULL DEFAULT 0 CHECK (coverage_reviewed_images >= 0),
  coverage_total_images     INTEGER NOT NULL DEFAULT 0 CHECK (coverage_total_images >= 0),
  error_message             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  exported_at               TIMESTAMPTZ,
  archived_at               TIMESTAMPTZ,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (coverage_reviewed_images <= coverage_total_images),
  CHECK (
    status <> 'ready'
    OR (
      zip_storage_key IS NOT NULL
      AND zip_sha256 IS NOT NULL
      AND manifest_storage_key IS NOT NULL
      AND manifest_sha256 IS NOT NULL
      AND image_count = caption_count
    )
  )
);

CREATE INDEX IF NOT EXISTS ix_lora_datasets_status ON lora_datasets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_lora_datasets_coverage ON lora_datasets(coverage_status, created_at DESC);

CREATE TABLE IF NOT EXISTS lora_dataset_images (
  dataset_id          TEXT NOT NULL REFERENCES lora_datasets(id) ON DELETE CASCADE,
  image_key           TEXT NOT NULL,
  image_sha256        TEXT NOT NULL,
  caption_sha256      TEXT NOT NULL,
  width               INTEGER CHECK (width IS NULL OR width > 0),
  height              INTEGER CHECK (height IS NULL OR height > 0),
  mime_type           TEXT,
  source_kind         TEXT NOT NULL
                      CHECK (source_kind IN ('order_feedback', 'approved_manifest', 'manual', 'legacy_import')),
  source_order        TEXT,
  source_photo_index  INTEGER CHECK (source_photo_index IS NULL OR source_photo_index >= 0),
  source_ref          TEXT,
  caption_word_count  INTEGER NOT NULL DEFAULT 0 CHECK (caption_word_count >= 0),
  review_status       TEXT NOT NULL DEFAULT 'pending'
                      CHECK (review_status IN ('confirmed', 'empty_confirmed', 'pending')),
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, image_key),
  UNIQUE (dataset_id, image_sha256)
);

CREATE INDEX IF NOT EXISTS ix_lora_dataset_images_review
  ON lora_dataset_images(dataset_id, review_status);
CREATE INDEX IF NOT EXISTS ix_lora_dataset_images_source
  ON lora_dataset_images(source_kind, source_order);

CREATE TABLE IF NOT EXISTS lora_dataset_image_elements (
  dataset_id    TEXT NOT NULL,
  image_key     TEXT NOT NULL,
  element_kind  TEXT NOT NULL
                CHECK (element_kind IN ('structure', 'shopify_variant', 'environment', 'spatial_relation')),
  canonical_id  TEXT NOT NULL,
  label         TEXT NOT NULL,
  product_id    TEXT,
  variant_id    TEXT,
  sku           TEXT,
  evidence_kind TEXT NOT NULL
                CHECK (evidence_kind IN ('feedback_confirmed', 'controlled_caption', 'manual_review', 'imported_snapshot')),
  evidence_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, image_key, element_kind, canonical_id),
  FOREIGN KEY (dataset_id, image_key)
    REFERENCES lora_dataset_images(dataset_id, image_key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_lora_dataset_elements_lookup
  ON lora_dataset_image_elements(dataset_id, element_kind, canonical_id);
CREATE INDEX IF NOT EXISTS ix_lora_dataset_elements_variant
  ON lora_dataset_image_elements(dataset_id, variant_id);

CREATE TABLE IF NOT EXISTS lora_dataset_element_stats (
  dataset_id         TEXT NOT NULL REFERENCES lora_datasets(id) ON DELETE CASCADE,
  element_kind       TEXT NOT NULL
                     CHECK (element_kind IN ('structure', 'shopify_variant', 'environment', 'spatial_relation')),
  canonical_id       TEXT NOT NULL,
  label              TEXT NOT NULL,
  product_id         TEXT,
  variant_id         TEXT,
  sku                TEXT,
  image_count        INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  representation_pct NUMERIC(7, 3) NOT NULL DEFAULT 0 CHECK (representation_pct >= 0 AND representation_pct <= 100),
  image_keys         JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (dataset_id, element_kind, canonical_id)
);

CREATE INDEX IF NOT EXISTS ix_lora_dataset_stats_shopify
  ON lora_dataset_element_stats(dataset_id, element_kind, variant_id, image_count DESC);

CREATE TABLE IF NOT EXISTS lora_training_runs (
  id                     TEXT PRIMARY KEY,
  label                  TEXT NOT NULL UNIQUE,
  dataset_id             TEXT NOT NULL REFERENCES lora_datasets(id),
  provider               TEXT NOT NULL DEFAULT 'fal',
  trainer_endpoint       TEXT NOT NULL,
  output_lora_format     TEXT NOT NULL,
  steps                  INTEGER NOT NULL CHECK (steps > 0),
  learning_rate          NUMERIC(12, 10) NOT NULL CHECK (learning_rate > 0),
  estimated_epochs       NUMERIC(12, 4),
  estimated_cost_usd     NUMERIC(12, 4),
  actual_cost_usd        NUMERIC(12, 4),
  status                 TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'uploading', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
  provider_request_id    TEXT UNIQUE,
  provider_status_url    TEXT,
  provider_response_url  TEXT,
  uploaded_dataset_url   TEXT,
  result_url             TEXT,
  weight_storage_key     TEXT,
  weight_sha256          TEXT,
  weight_bytes           BIGINT CHECK (weight_bytes IS NULL OR weight_bytes >= 0),
  rank                   INTEGER CHECK (rank IS NULL OR rank > 0),
  architecture           TEXT,
  artifact_status        TEXT NOT NULL DEFAULT 'pending'
                         CHECK (artifact_status IN ('pending', 'backed_up', 'invalid')),
  configuration_snapshot JSONB NOT NULL DEFAULT '{}',
  provider_result_snapshot JSONB NOT NULL DEFAULT '{}',
  error_message          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at           TIMESTAMPTZ,
  started_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  received_at            TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_lora_training_runs_dataset
  ON lora_training_runs(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_lora_training_runs_status
  ON lora_training_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS lora_evaluations (
  id                TEXT PRIMARY KEY,
  training_run_id   TEXT NOT NULL REFERENCES lora_training_runs(id) ON DELETE CASCADE,
  protocol_version  TEXT NOT NULL,
  lora_scale        NUMERIC(5, 3) NOT NULL CHECK (lora_scale >= 0 AND lora_scale <= 2),
  seeds             JSONB NOT NULL DEFAULT '[]',
  criteria          JSONB NOT NULL DEFAULT '{}',
  passed_count      INTEGER NOT NULL DEFAULT 0 CHECK (passed_count >= 0),
  total_count       INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  verdict           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (verdict IN ('pending', 'approved', 'rejected')),
  report_storage_key TEXT,
  result_snapshot   JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  UNIQUE (training_run_id, protocol_version, lora_scale),
  CHECK (passed_count <= total_count)
);

CREATE INDEX IF NOT EXISTS ix_lora_evaluations_run
  ON lora_evaluations(training_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lora_mode_slots (
  slug             TEXT PRIMARY KEY
                   CHECK (slug IN ('unlimited', 'training_1', 'training_2')),
  display_name     TEXT NOT NULL,
  training_run_id  TEXT REFERENCES lora_training_runs(id) ON DELETE SET NULL,
  enforce_dataset_allowlist BOOLEAN NOT NULL DEFAULT TRUE,
  lora_scale       NUMERIC(5, 3) NOT NULL DEFAULT 0.8 CHECK (lora_scale >= 0 AND lora_scale <= 2),
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lora_mode_slot_history (
  id                  BIGSERIAL PRIMARY KEY,
  slot_slug           TEXT NOT NULL REFERENCES lora_mode_slots(slug),
  previous_run_id     TEXT REFERENCES lora_training_runs(id) ON DELETE SET NULL,
  new_run_id          TEXT REFERENCES lora_training_runs(id) ON DELETE SET NULL,
  action              TEXT NOT NULL
                      CHECK (action IN ('assign', 'activate', 'disable', 'rollback')),
  lora_scale          NUMERIC(5, 3) NOT NULL CHECK (lora_scale >= 0 AND lora_scale <= 2),
  evaluation_snapshot JSONB NOT NULL DEFAULT '{}',
  actor               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_lora_slot_history_slot
  ON lora_mode_slot_history(slot_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS lora_jobs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL
               CHECK (kind IN ('dataset_export', 'training_sync', 'weight_backup', 'evaluation')),
  resource_id  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at    TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  error_message TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  UNIQUE (kind, resource_id)
);

CREATE INDEX IF NOT EXISTS ix_lora_jobs_claim
  ON lora_jobs(status, locked_at, created_at);

INSERT INTO lora_mode_slots (slug, display_name, enforce_dataset_allowlist, lora_scale, enabled)
VALUES
  ('unlimited', 'Unlimited', FALSE, 0.8, TRUE),
  ('training_1', 'LoRA Training 1', TRUE, 0.8, TRUE),
  ('training_2', 'LoRA Training 2', TRUE, 0.8, TRUE)
ON CONFLICT (slug) DO NOTHING;
