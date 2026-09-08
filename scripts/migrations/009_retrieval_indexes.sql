-- Retrieval indexes selected for the actual SQL branches. Every statement is
-- additive/idempotent. We intentionally do not create HNSW/IVFFlat here:
-- catalog_embeddings is small and an ANN index needs a measured recall/latency
-- decision from the benchmark before it can become a production dependency.

-- rollback: no reversible, requiere restore de backup. Elimina un índice previo cuya definición no está en el repositorio y cambia columnas cuyo estado o datos anteriores no pueden reconstruirse con certeza.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Variant-level color evidence is separate from product-level facets. An
-- empty array means unknown, never "all colors sold by this product".
ALTER TABLE catalog_variants
  ADD COLUMN IF NOT EXISTS derived_colors TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE catalog_variants_staging
  ADD COLUMN IF NOT EXISTS derived_colors TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ix_catalog_variants_derived_colors_gin_v2
  ON catalog_variants USING GIN (derived_colors);

-- FTS is backed by the generated spanish_unaccent tsvector from 002. The
-- existing ix_catalog_products_tsv is reused; do not create a duplicate GIN.

-- Trigram fallback for title/handle and the original SKU. Exact
-- SKU lookup uses btree expression indexes below; three SKU GIN indexes were
-- measured as redundant for this catalog and would add write cost.
DROP INDEX IF EXISTS ix_catalog_products_search_text_trgm_v2;
CREATE INDEX IF NOT EXISTS ix_catalog_products_title_trgm_v2
  ON catalog_products USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_catalog_products_handle_trgm_v2
  ON catalog_products USING GIN (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_catalog_variants_sku_original_trgm_v2
  ON catalog_variants USING GIN (sku_original gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_catalog_variants_sku_original_upper_v2
  ON catalog_variants (UPPER(sku_original))
  WHERE sku_original IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_catalog_variants_sku_canonical_upper_v2
  ON catalog_variants (UPPER(sku_canonical))
  WHERE sku_canonical IS NOT NULL;

-- Hard filters must be executable on the same variant row before ranking.
CREATE INDEX IF NOT EXISTS ix_catalog_variants_hard_filters_v2
  ON catalog_variants (product_id, available, price, forma, diam_pulg);
CREATE INDEX IF NOT EXISTS ix_catalog_products_status_available_v2
  ON catalog_products (status, available, product_id);
CREATE INDEX IF NOT EXISTS ix_catalog_products_derived_colors_gin_v2
  ON catalog_products USING GIN ((derived->'colors'));
CREATE INDEX IF NOT EXISTS ix_catalog_products_derived_occasions_gin_v2
  ON catalog_products USING GIN ((derived->'occasions'));
CREATE INDEX IF NOT EXISTS ix_catalog_products_derived_category_btree_v2
  ON catalog_products ((derived->>'category'));

-- Demand is only a weak post-RRF tie-breaker and never a hard filter.
CREATE INDEX IF NOT EXISTS ix_rag_order_demand_product_weight_v2
  ON rag_order_demand_aggregates (product_id, weighted_units DESC);
