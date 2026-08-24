-- Scene catalog extension (Plan 02, Tarea 02.1 de PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md).
-- Purely additive: catalog_products and catalog_variants are never altered here
-- (no new/changed columns, no data deletion, no constraint added to them).
-- Everything below is a new extension table that references them by their
-- existing primary keys (catalog_products.product_id, catalog_variants.variant_id).
--
-- This migration must be safe to run twice: every statement uses
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, and no statement
-- drops or mutates existing rows in catalog_products/catalog_variants.

-- ---------------------------------------------------------------------------
-- catalog_items: stable physical identity, one row per sellable physical
-- thing. Sits on top of catalog_products (required) and, when the physical
-- identity is variant-specific (e.g. a specific size/color), catalog_variants
-- (optional). NOTE: we deliberately do not add a composite FK enforcing that
-- variant_id belongs to product_id, because that would require a new unique
-- index on catalog_variants(product_id, variant_id) -- i.e. touching the core
-- table's structure, which is out of scope for this migration. Ingestion code
-- (Tarea 02.2/03.1) is responsible for keeping that pairing correct; the test
-- script for this migration checks it does not silently break.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_items (
  item_id      TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES catalog_products(product_id) ON DELETE CASCADE,
  variant_id   TEXT REFERENCES catalog_variants(variant_id) ON DELETE SET NULL,
  -- Canonical family list lives in code (src/lib/rag/taxonomy/v3.ts, Tarea 02.2):
  -- balloon_material, balloon_structure, backdrop_surface, altar_frame,
  -- floral_foliage, aisle_decor, ambient_lighting, floor_lighting, furniture,
  -- linen, table_setting, centerpiece, signage, plinth_pedestal, service_support.
  -- Left as free text here (not a CHECK enum) so the taxonomy can evolve
  -- without a migration; validation happens in the Zod layer.
  category_v3  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One product-level item per product, one variant-level item per (product, variant).
CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_items_product_only
  ON catalog_items (product_id) WHERE variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_items_product_variant
  ON catalog_items (product_id, variant_id) WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_catalog_items_product ON catalog_items (product_id);
CREATE INDEX IF NOT EXISTS ix_catalog_items_variant ON catalog_items (variant_id);
CREATE INDEX IF NOT EXISTS ix_catalog_items_category_v3 ON catalog_items (category_v3);

-- ---------------------------------------------------------------------------
-- catalog_sources: who supplies the offer, its commercial policy and
-- verification state. Section 6.1 source classes (sale/rental/venue/context/
-- editorial/test) all live here so provenance is auditable even for classes
-- that never produce a commercial offer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_sources (
  source_id         TEXT PRIMARY KEY,
  provider_name     TEXT NOT NULL,
  source_class      TEXT NOT NULL CHECK (source_class IN (
                       'catalog_sale', 'catalog_rental', 'venue_existing',
                       'context_non_quotable', 'editorial_reference', 'test_only'
                     )),
  status            TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN (
                       'active', 'inactive', 'pending_verification', 'rejected'
                     )),
  verified_at       TIMESTAMPTZ,
  commercial_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_area      JSONB,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_catalog_sources_class_status
  ON catalog_sources (source_class, status);

-- ---------------------------------------------------------------------------
-- catalog_commercial_offers: CommercialOfferV1 (section 7.3). One row per
-- sellable/rentable modality of a catalog_item, snapshot-pinned and
-- re-verifiable independently of the item's physical identity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_commercial_offers (
  offer_id                TEXT PRIMARY KEY,
  item_id                 TEXT NOT NULL REFERENCES catalog_items(item_id) ON DELETE CASCADE,
  variant_id              TEXT REFERENCES catalog_variants(variant_id) ON DELETE SET NULL,
  source_id               TEXT NOT NULL REFERENCES catalog_sources(source_id),
  snapshot_id             TEXT NOT NULL,
  verified_at             TIMESTAMPTZ NOT NULL,
  source_class            TEXT NOT NULL CHECK (source_class IN ('catalog_sale', 'catalog_rental')),
  status                  TEXT NOT NULL CHECK (status IN ('PRICED', 'QUOTE_REQUIRED', 'UNAVAILABLE')),
  availability_status     TEXT NOT NULL CHECK (availability_status IN ('available', 'limited', 'unavailable')),
  availability_checked_at TIMESTAMPTZ NOT NULL,
  service_area_country    TEXT,
  service_area_cities     TEXT[] NOT NULL DEFAULT '{}',
  service_area_radius_km  NUMERIC CHECK (service_area_radius_km IS NULL OR service_area_radius_km > 0),
  valid_from               TIMESTAMPTZ,
  valid_until               TIMESTAMPTZ,
  rental_minimum_periods  INTEGER CHECK (rental_minimum_periods IS NULL OR rental_minimum_periods > 0),
  rental_period_unit      TEXT CHECK (rental_period_unit IS NULL OR rental_period_unit IN ('event', 'day')),
  minimum_quantity        INTEGER CHECK (minimum_quantity IS NULL OR minimum_quantity > 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until),
  -- Invariant 2 (section 6.3): rental-only fields must stay empty for sale offers.
  CHECK (source_class = 'catalog_rental' OR (rental_minimum_periods IS NULL AND rental_period_unit IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_catalog_commercial_offers_item
  ON catalog_commercial_offers (item_id);
CREATE INDEX IF NOT EXISTS ix_catalog_commercial_offers_source
  ON catalog_commercial_offers (source_id);
CREATE INDEX IF NOT EXISTS ix_catalog_commercial_offers_class_status
  ON catalog_commercial_offers (source_class, status);
CREATE INDEX IF NOT EXISTS ix_catalog_commercial_offers_validity
  ON catalog_commercial_offers (valid_from, valid_until);
CREATE INDEX IF NOT EXISTS ix_catalog_commercial_offers_variant
  ON catalog_commercial_offers (variant_id);

-- ---------------------------------------------------------------------------
-- catalog_product_capabilities: scene function, confidence and evidence
-- (section 5.3). Many-to-many between catalog_items and scene functions.
-- The canonical function list is documented, not enforced as a CHECK enum,
-- so new functions can be added without a migration.
-- ---------------------------------------------------------------------------
-- Canonical scene functions (section 5.3): altar_frame, focal_backdrop,
-- focal_decor, floral_foliage_accent, balloon_accent, aisle_runner,
-- aisle_marker, guest_chair, table_surface, linen, table_setting,
-- centerpiece, ambient_light, floor_light, welcome_signage, plinth_pedestal,
-- service_support.
CREATE TABLE IF NOT EXISTS catalog_product_capabilities (
  id             BIGSERIAL PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES catalog_items(item_id) ON DELETE CASCADE,
  scene_function TEXT NOT NULL CHECK (BTRIM(scene_function) <> ''),
  confidence     NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence       TEXT NOT NULL CHECK (BTRIM(evidence) <> ''),
  derived_from   TEXT NOT NULL DEFAULT 'derived' CHECK (derived_from IN ('derived', 'manual', 'review')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, scene_function, evidence)
);

CREATE INDEX IF NOT EXISTS ix_catalog_product_capabilities_function
  ON catalog_product_capabilities (scene_function);
CREATE INDEX IF NOT EXISTS ix_catalog_product_capabilities_item
  ON catalog_product_capabilities (item_id);

-- ---------------------------------------------------------------------------
-- catalog_price_components: PriceComponent list per offer (section 6.3,
-- invariant 2). Amounts are always integer COP (invariant 1) -- never float.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_price_components (
  id             BIGSERIAL PRIMARY KEY,
  offer_id       TEXT NOT NULL REFERENCES catalog_commercial_offers(offer_id) ON DELETE CASCADE,
  price_type     TEXT NOT NULL CHECK (price_type IN ('unit_sale', 'package_sale', 'rental_period', 'service_fee')),
  component_kind TEXT NOT NULL DEFAULT 'product' CHECK (component_kind IN (
                    'product', 'deposit', 'transport', 'installation', 'labor'
                  )),
  amount_cop     INTEGER NOT NULL CHECK (amount_cop >= 0),
  refundable     BOOLEAN NOT NULL DEFAULT FALSE,
  period_unit    TEXT CHECK (period_unit IS NULL OR period_unit IN ('event', 'day')),
  valid_from     TIMESTAMPTZ,
  valid_until    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until),
  -- Invariant 3 (section 6.3): deposit/transport/installation/labor never
  -- ride on the same component row as the product's unit/package price.
  CHECK (component_kind = 'product' OR price_type = 'service_fee')
);

CREATE INDEX IF NOT EXISTS ix_catalog_price_components_offer
  ON catalog_price_components (offer_id, price_type);
CREATE INDEX IF NOT EXISTS ix_catalog_price_components_validity
  ON catalog_price_components (valid_from, valid_until);

-- ---------------------------------------------------------------------------
-- catalog_product_spatial: dimensions, mounting, support and environment
-- compatibility (CatalogItemV3.dimensions / .compatibility, section 7.3).
-- One row per item; a missing row means "dimensions unknown", never "zero".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_product_spatial (
  item_id           TEXT PRIMARY KEY REFERENCES catalog_items(item_id) ON DELETE CASCADE,
  width_cm          NUMERIC CHECK (width_cm IS NULL OR width_cm > 0),
  height_cm         NUMERIC CHECK (height_cm IS NULL OR height_cm > 0),
  depth_cm          NUMERIC CHECK (depth_cm IS NULL OR depth_cm > 0),
  weight_kg         NUMERIC CHECK (weight_kg IS NULL OR weight_kg > 0),
  indoor_outdoor    TEXT[] NOT NULL DEFAULT '{}',
  requires_support  TEXT[] NOT NULL DEFAULT '{}',
  supports          TEXT[] NOT NULL DEFAULT '{}',
  mounting          TEXT[] NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_catalog_product_spatial_indoor_outdoor
  ON catalog_product_spatial USING GIN (indoor_outdoor);
CREATE INDEX IF NOT EXISTS ix_catalog_product_spatial_mounting
  ON catalog_product_spatial USING GIN (mounting);

-- ---------------------------------------------------------------------------
-- catalog_source_audit: append-only trail of provenance changes and
-- rejections, for the anti-hallucination invariants in section 6.4.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_source_audit (
  id             BIGSERIAL PRIMARY KEY,
  source_id      TEXT REFERENCES catalog_sources(source_id) ON DELETE SET NULL,
  offer_id       TEXT REFERENCES catalog_commercial_offers(offer_id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN (
                    'created', 'updated', 'verified', 'rejected',
                    'deactivated', 'price_changed', 'availability_changed'
                  )),
  reason         TEXT,
  previous_state JSONB,
  new_state      JSONB,
  actor          TEXT NOT NULL DEFAULT 'system',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_catalog_source_audit_source
  ON catalog_source_audit (source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_catalog_source_audit_offer
  ON catalog_source_audit (offer_id, created_at DESC);
