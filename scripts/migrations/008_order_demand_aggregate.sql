-- Order history is an optional, weak ranking signal only. This table stores
-- one aggregate per catalog variant and source snapshot; it deliberately has
-- no customer, order, line-item, payload, price, stock, or inventory columns.
-- A repeat of the same source hash updates the same rows instead of adding
-- demand again.

-- rollback: DROP INDEX idx_rag_order_demand_snapshot; DROP INDEX idx_rag_order_demand_weak_rank; DROP INDEX idx_rag_order_demand_variant; DROP TABLE rag_order_demand_aggregates;
-- El rollback elimina los agregados históricos de demanda; exportarlos y confirmar que ningún consumidor activo los necesita antes de ejecutarlo.

CREATE TABLE IF NOT EXISTS rag_order_demand_aggregates (
  id                    BIGSERIAL PRIMARY KEY,
  source_snapshot_id    TEXT NOT NULL
    REFERENCES rag_source_snapshots(source_snapshot_id) ON DELETE CASCADE,
  source_url             TEXT NOT NULL,
  source_sha256          TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  variant_id             TEXT NOT NULL CHECK (BTRIM(variant_id) <> ''),
  product_id             TEXT NOT NULL CHECK (BTRIM(product_id) <> ''),
  sku_canonical          TEXT,
  sku_ambiguous          BOOLEAN NOT NULL DEFAULT FALSE,
  demand_class           TEXT NOT NULL DEFAULT 'observed_demand'
    CHECK (demand_class = 'observed_demand'),
  order_count            INTEGER NOT NULL CHECK (order_count >= 0),
  units_observed         BIGINT NOT NULL CHECK (units_observed >= 0),
  first_observed_at      TIMESTAMPTZ NOT NULL,
  last_observed_at       TIMESTAMPTZ NOT NULL,
  half_life_days         NUMERIC NOT NULL CHECK (half_life_days > 0),
  decay_factor            NUMERIC NOT NULL CHECK (decay_factor >= 0 AND decay_factor <= 1),
  weighted_units          NUMERIC NOT NULL CHECK (weighted_units >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_snapshot_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_rag_order_demand_variant
  ON rag_order_demand_aggregates (variant_id, demand_class);

CREATE INDEX IF NOT EXISTS idx_rag_order_demand_weak_rank
  ON rag_order_demand_aggregates (weighted_units DESC, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_order_demand_snapshot
  ON rag_order_demand_aggregates (source_snapshot_id, last_observed_at DESC);
