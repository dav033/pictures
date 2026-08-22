-- RAG regeneration: source snapshots, isolated staging and provenance.
-- This migration is intentionally additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS rag_source_snapshots (
  source_snapshot_id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('products_catalog', 'order_data')),
  source_url TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  fetched_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'published', 'rejected')),
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  published_products INTEGER NOT NULL DEFAULT 0 CHECK (published_products >= 0),
  published_variants INTEGER NOT NULL DEFAULT 0 CHECK (published_variants >= 0),
  rejected_records INTEGER NOT NULL DEFAULT 0 CHECK (rejected_records >= 0),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_kind, source_sha256)
);

CREATE INDEX IF NOT EXISTS idx_rag_source_snapshots_status
  ON rag_source_snapshots (source_kind, status, fetched_at DESC);

CREATE TABLE IF NOT EXISTS catalog_products_staging (
  source_snapshot_id TEXT NOT NULL REFERENCES rag_source_snapshots(source_snapshot_id) ON DELETE CASCADE,
  product_id TEXT NOT NULL CHECK (BTRIM(product_id) <> ''),
  source_product_id TEXT NOT NULL CHECK (BTRIM(source_product_id) <> ''),
  handle TEXT NOT NULL CHECK (BTRIM(handle) <> ''),
  title TEXT NOT NULL CHECK (BTRIM(title) <> ''),
  description_text TEXT,
  vendor TEXT,
  product_type TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  source_status TEXT NOT NULL,
  available BOOLEAN NOT NULL,
  price_min NUMERIC,
  price_max NUMERIC,
  derived JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribute_states JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_payload JSONB NOT NULL,
  search_text TEXT NOT NULL,
  embedding_source_hash TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ,
  staged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_snapshot_id, product_id),
  UNIQUE (source_snapshot_id, handle),
  CHECK (price_min IS NULL OR price_min >= 0),
  CHECK (price_max IS NULL OR price_max >= 0),
  CHECK (price_min IS NULL OR price_max IS NULL OR price_min <= price_max)
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_staging_snapshot_status
  ON catalog_products_staging (source_snapshot_id, source_status, available);

CREATE TABLE IF NOT EXISTS catalog_variants_staging (
  source_snapshot_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL CHECK (BTRIM(variant_id) <> ''),
  source_variant_id TEXT NOT NULL CHECK (BTRIM(source_variant_id) <> ''),
  sku TEXT,
  sku_original TEXT,
  sku_canonical TEXT,
  sku_ambiguous BOOLEAN NOT NULL DEFAULT FALSE,
  title TEXT,
  price NUMERIC NOT NULL CHECK (price > 0),
  currency TEXT NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  inventory_quantity INTEGER,
  inventory_source TEXT DEFAULT 'cdn' CHECK (inventory_source IS NULL OR inventory_source = 'cdn'),
  available BOOLEAN NOT NULL,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  image_url TEXT,
  source_payload JSONB NOT NULL,
  codigo_tamano TEXT,
  forma TEXT,
  diam_pulg NUMERIC,
  largo_pulg NUMERIC,
  ancho_cm NUMERIC,
  alto_cm NUMERIC,
  attribute_states JSONB NOT NULL DEFAULT '{}'::jsonb,
  staged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_snapshot_id, variant_id),
  FOREIGN KEY (source_snapshot_id, product_id)
    REFERENCES catalog_products_staging(source_snapshot_id, product_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_catalog_variants_staging_snapshot_sku
  ON catalog_variants_staging (source_snapshot_id, sku_canonical, sku_ambiguous);

ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS source_snapshot_id TEXT;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS source_product_id TEXT;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS source_status TEXT;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS publication_reason TEXT;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS attribute_states JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS source_snapshot_id TEXT;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS source_variant_id TEXT;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS sku_original TEXT;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS sku_canonical TEXT;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS sku_ambiguous BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE catalog_variants ADD COLUMN IF NOT EXISTS attribute_states JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_catalog_products_source_snapshot
  ON catalog_products (source_snapshot_id, source_status);
CREATE INDEX IF NOT EXISTS idx_catalog_variants_source_snapshot_sku
  ON catalog_variants (source_snapshot_id, sku_canonical, sku_ambiguous);

ALTER TABLE catalog_rejections ADD COLUMN IF NOT EXISTS source_snapshot_id TEXT;
ALTER TABLE catalog_rejections ADD COLUMN IF NOT EXISTS record_type TEXT;
CREATE INDEX IF NOT EXISTS idx_catalog_rejections_snapshot
  ON catalog_rejections (source_snapshot_id, record_type);
