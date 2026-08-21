-- Fase 5: sincronización continua. `source_updated_at` permite descartar un
-- webhook que llegue desordenado sin pisar datos más recientes (plan §5.5).
-- `catalog_webhook_log` da idempotencia (§5.4) y deduplicación (§5.3) — un
-- mismo X-Shopify-Webhook-Id procesado dos veces no debe cambiar el estado
-- final ni reprocesar de más.

ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS catalog_webhook_log (
  webhook_id        TEXT PRIMARY KEY,
  topic             TEXT NOT NULL,
  shopify_product_id TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'received',
  detail            TEXT
);

CREATE INDEX IF NOT EXISTS ix_catalog_webhook_log_product ON catalog_webhook_log(shopify_product_id);
