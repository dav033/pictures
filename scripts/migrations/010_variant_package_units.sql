-- Package-unit evidence for Postgres RAG variants.  NULL is intentional when
-- Shopify does not expose a parseable `PAQ X N` / `PAQUETE X N` value.
ALTER TABLE catalog_variants_staging
  ADD COLUMN IF NOT EXISTS unidades_paq INTEGER NULL
    CHECK (unidades_paq IS NULL OR unidades_paq > 0);

ALTER TABLE catalog_variants_staging
  ADD COLUMN IF NOT EXISTS unidades_inferidas BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE catalog_variants
  ADD COLUMN IF NOT EXISTS unidades_paq INTEGER NULL
    CHECK (unidades_paq IS NULL OR unidades_paq > 0);

ALTER TABLE catalog_variants
  ADD COLUMN IF NOT EXISTS unidades_inferidas BOOLEAN NOT NULL DEFAULT TRUE;
