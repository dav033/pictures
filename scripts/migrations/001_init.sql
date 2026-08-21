-- Fase 1 + Fase 2: infraestructura RAG del catálogo (paralela a SQLite, ver plan.md).
-- Shopify es la fuente de verdad: los campos factuales viven tal cual salen de Shopify;
-- "derived" guarda todo lo inferido (estilos, colores visuales, etc.) por separado.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS catalog_products (
  product_id           TEXT PRIMARY KEY,
  handle                TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description_text      TEXT,
  vendor                TEXT,
  product_type          TEXT,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  image_urls            TEXT[] NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  available             BOOLEAN NOT NULL DEFAULT FALSE,
  price_min             NUMERIC,
  price_max             NUMERIC,
  derived               JSONB NOT NULL DEFAULT '{}',
  source_payload        JSONB NOT NULL,
  search_text           TEXT,
  embedding_source_hash TEXT,
  search_tsv            TSVECTOR GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(search_text, ''))) STORED,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_catalog_products_tsv ON catalog_products USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS ix_catalog_products_type ON catalog_products (product_type);
CREATE INDEX IF NOT EXISTS ix_catalog_products_available ON catalog_products (available);

CREATE TABLE IF NOT EXISTS catalog_variants (
  variant_id          TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES catalog_products(product_id) ON DELETE CASCADE,
  sku                  TEXT,
  title                TEXT,
  price                NUMERIC NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'COP',
  inventory_quantity   INTEGER,
  inventory_source     TEXT,
  available            BOOLEAN NOT NULL DEFAULT FALSE,
  options              JSONB NOT NULL DEFAULT '{}',
  image_url            TEXT,
  source_payload       JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_catalog_variants_product ON catalog_variants (product_id);
CREATE INDEX IF NOT EXISTS ix_catalog_variants_sku ON catalog_variants (sku);

-- Búsqueda vectorial exacta (sin HNSW/IVFFlat todavía, ver plan §3.6): catálogo
-- pequeño, no vale la pena cambiar recall por velocidad todavía.
CREATE TABLE IF NOT EXISTS catalog_embeddings (
  product_id            TEXT PRIMARY KEY REFERENCES catalog_products(product_id) ON DELETE CASCADE,
  embedding             VECTOR(768) NOT NULL,
  embedding_source_hash TEXT NOT NULL,
  model                 TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_rejections (
  id           SERIAL PRIMARY KEY,
  source_id    TEXT,
  reason       TEXT NOT NULL,
  raw_payload  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_sync_log (
  id                   SERIAL PRIMARY KEY,
  started_at           TIMESTAMPTZ NOT NULL,
  finished_at          TIMESTAMPTZ,
  raw_products         INTEGER,
  normalized_products  INTEGER,
  normalized_variants  INTEGER,
  rejected_products    INTEGER,
  error                TEXT
);
