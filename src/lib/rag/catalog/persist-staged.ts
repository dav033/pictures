import type { Pool, PoolClient } from "pg";
import type { SourceManifest } from "../sources/fetch";
import type { CanonicalCatalog, CanonicalProduct, CanonicalVariant } from "./canonicalize";
import type { DerivedSceneCapability, DeriveSceneCapabilitiesResult } from "./derive-scene-capabilities";

export type PersistOptions = {
  sourceSnapshotId: string;
  manifest: SourceManifest;
  /** A lower count is valid only when explicitly opted into. */
  allowPartial?: boolean;
  /** Default protects a live catalog from a truncated/partial download. */
  maxDropRatio?: number;
  minPublishedProducts?: number;
};

export type PersistResult = {
  sourceSnapshotId: string;
  publishedProducts: number;
  publishedVariants: number;
  rejectedRecords: number;
  deletedProducts: number;
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function stageProduct(client: PoolClient, snapshotId: string, product: CanonicalProduct): Promise<void> {
  await client.query(
    `INSERT INTO catalog_products_staging
      (source_snapshot_id, product_id, source_product_id, handle, title, description_text,
       vendor, product_type, tags, image_urls, source_status, available, price_min, price_max,
       derived, attribute_states, source_payload, search_text, embedding_source_hash, source_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (source_snapshot_id, product_id) DO UPDATE SET
       source_product_id = excluded.source_product_id, handle = excluded.handle,
       title = excluded.title, description_text = excluded.description_text,
       vendor = excluded.vendor, product_type = excluded.product_type, tags = excluded.tags,
       image_urls = excluded.image_urls, source_status = excluded.source_status,
       available = excluded.available, price_min = excluded.price_min, price_max = excluded.price_max,
       derived = excluded.derived, attribute_states = excluded.attribute_states,
       source_payload = excluded.source_payload, search_text = excluded.search_text,
       embedding_source_hash = excluded.embedding_source_hash,
       source_updated_at = excluded.source_updated_at, staged_at = now()` ,
    [
      snapshotId, product.product_id, product.source_product_id, product.handle, product.title,
      product.description_text, product.vendor, product.product_type, product.tags, product.image_urls,
      product.source_status, product.available, product.price_min, product.price_max,
      json(product.derived), json(product.attribute_states), json(product.source_payload),
      product.search_text, product.embedding_source_hash, product.source_updated_at,
    ],
  );
}

async function stageVariant(client: PoolClient, snapshotId: string, variant: CanonicalVariant): Promise<void> {
  await client.query(
    `INSERT INTO catalog_variants_staging
      (source_snapshot_id, product_id, variant_id, source_variant_id, sku, sku_original,
       sku_canonical, sku_ambiguous, title, price, currency, inventory_quantity,
       inventory_source, available, options, image_url, source_payload, codigo_tamano,
       forma, diam_pulg, largo_pulg, ancho_cm, alto_cm, unidades_paq, unidades_inferidas,
       derived_colors, attribute_states)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     ON CONFLICT (source_snapshot_id, variant_id) DO UPDATE SET
       product_id = excluded.product_id, source_variant_id = excluded.source_variant_id,
       sku = excluded.sku, sku_original = excluded.sku_original, sku_canonical = excluded.sku_canonical,
       sku_ambiguous = excluded.sku_ambiguous, title = excluded.title, price = excluded.price,
       currency = excluded.currency, inventory_quantity = excluded.inventory_quantity,
       inventory_source = excluded.inventory_source, available = excluded.available,
       options = excluded.options, image_url = excluded.image_url, source_payload = excluded.source_payload,
       codigo_tamano = excluded.codigo_tamano, forma = excluded.forma, diam_pulg = excluded.diam_pulg,
       largo_pulg = excluded.largo_pulg, ancho_cm = excluded.ancho_cm, alto_cm = excluded.alto_cm,
       unidades_paq = excluded.unidades_paq, unidades_inferidas = excluded.unidades_inferidas,
       derived_colors = excluded.derived_colors,
       attribute_states = excluded.attribute_states, staged_at = now()` ,
    [
      snapshotId, variant.product_id, variant.variant_id, variant.source_variant_id,
      variant.sku, variant.sku_original, variant.sku_canonical, variant.sku_ambiguous,
      variant.title, variant.price, variant.currency, variant.inventory_quantity,
      variant.inventory_source, variant.available, json(variant.options), variant.image_url,
      json(variant.source_payload), variant.codigo_tamano, variant.forma, variant.diam_pulg,
      variant.largo_pulg, variant.ancho_cm, variant.alto_cm, variant.unidades_paq,
      variant.unidades_inferidas, variant.derived_colors, json(variant.attribute_states),
    ],
  );
}

async function publishProduct(client: PoolClient, snapshotId: string, product: CanonicalProduct): Promise<void> {
  await client.query(
    `INSERT INTO catalog_products
      (product_id, handle, title, description_text, vendor, product_type, tags, image_urls,
       status, available, price_min, price_max, derived, source_payload, search_text,
       embedding_source_hash, source_updated_at, source_snapshot_id, source_product_id,
       source_status, publication_reason, attribute_states, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now())
     ON CONFLICT (product_id) DO UPDATE SET
       handle = excluded.handle, title = excluded.title, description_text = excluded.description_text,
       vendor = excluded.vendor, product_type = excluded.product_type, tags = excluded.tags,
       image_urls = excluded.image_urls, status = excluded.status, available = excluded.available,
       price_min = excluded.price_min, price_max = excluded.price_max, derived = excluded.derived,
       source_payload = excluded.source_payload, search_text = excluded.search_text,
       embedding_source_hash = excluded.embedding_source_hash,
       source_updated_at = excluded.source_updated_at, source_snapshot_id = excluded.source_snapshot_id,
       source_product_id = excluded.source_product_id, source_status = excluded.source_status,
       publication_reason = excluded.publication_reason, attribute_states = excluded.attribute_states,
       updated_at = CASE WHEN catalog_products.embedding_source_hash IS DISTINCT FROM excluded.embedding_source_hash
                         OR catalog_products.source_payload IS DISTINCT FROM excluded.source_payload
                         THEN now() ELSE catalog_products.updated_at END`,
    [
      product.product_id, product.handle, product.title, product.description_text, product.vendor,
      product.product_type, product.tags, product.image_urls, product.available, product.price_min,
      product.price_max, json(product.derived), json(product.source_payload), product.search_text,
      product.embedding_source_hash, product.source_updated_at, snapshotId, product.source_product_id,
      product.source_status, product.publication_reason, json(product.attribute_states),
    ],
  );
}

async function publishVariant(client: PoolClient, snapshotId: string, variant: CanonicalVariant): Promise<void> {
  await client.query(
    `INSERT INTO catalog_variants
      (variant_id, product_id, sku, title, price, currency, inventory_quantity,
       inventory_source, available, options, image_url, source_payload, codigo_tamano,
       forma, diam_pulg, largo_pulg, ancho_cm, alto_cm, source_snapshot_id,
       source_variant_id, sku_original, sku_canonical, sku_ambiguous, unidades_paq, unidades_inferidas,
       derived_colors, attribute_states)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     ON CONFLICT (variant_id) DO UPDATE SET
       product_id = excluded.product_id, sku = excluded.sku, title = excluded.title,
       price = excluded.price, currency = excluded.currency, inventory_quantity = excluded.inventory_quantity,
       inventory_source = excluded.inventory_source, available = excluded.available,
       options = excluded.options, image_url = excluded.image_url, source_payload = excluded.source_payload,
       codigo_tamano = excluded.codigo_tamano, forma = excluded.forma, diam_pulg = excluded.diam_pulg,
       largo_pulg = excluded.largo_pulg, ancho_cm = excluded.ancho_cm, alto_cm = excluded.alto_cm,
       source_snapshot_id = excluded.source_snapshot_id, source_variant_id = excluded.source_variant_id,
       sku_original = excluded.sku_original, sku_canonical = excluded.sku_canonical,
       sku_ambiguous = excluded.sku_ambiguous, unidades_paq = excluded.unidades_paq,
       unidades_inferidas = excluded.unidades_inferidas, derived_colors = excluded.derived_colors,
       attribute_states = excluded.attribute_states`,
    [
      variant.variant_id, variant.product_id, variant.sku, variant.title, variant.price, variant.currency,
      variant.inventory_quantity, variant.inventory_source, variant.available, json(variant.options),
      variant.image_url, json(variant.source_payload), variant.codigo_tamano, variant.forma,
      variant.diam_pulg, variant.largo_pulg, variant.ancho_cm, variant.alto_cm, snapshotId,
      variant.source_variant_id, variant.sku_original, variant.sku_canonical, variant.sku_ambiguous,
      variant.unidades_paq, variant.unidades_inferidas, variant.derived_colors, json(variant.attribute_states),
    ],
  );
}

function productIds(catalog: CanonicalCatalog): string[] {
  return catalog.products.map((product) => product.product_id);
}

/**
 * Stages and publishes one complete source snapshot. Every purge and upsert is
 * inside the same transaction; a failed fetch/validation leaves the prior
 * published catalog intact.
 */
export async function persistStagedCatalog(
  pool: Pool,
  catalog: CanonicalCatalog,
  options: PersistOptions,
): Promise<PersistResult> {
  const client = await pool.connect();
  const ids = productIds(catalog);
  const variants = catalog.products.flatMap((product) => product.variants);
  const maxDropRatio = options.maxDropRatio ?? 0.5;
  const minPublishedProducts = options.minPublishedProducts ?? 1;

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO rag_source_snapshots
        (source_snapshot_id, source_kind, source_url, source_sha256, fetched_at, status, manifest, rejected_records)
       VALUES ($1,'products_catalog',$2,$3,$4,'staged',$5,$6)
       ON CONFLICT (source_snapshot_id) DO UPDATE SET
         source_url = excluded.source_url, source_sha256 = excluded.source_sha256,
         fetched_at = excluded.fetched_at, status = 'staged', manifest = excluded.manifest,
         rejected_records = excluded.rejected_records, rejection_reason = NULL,
         published_at = NULL, published_products = 0, published_variants = 0`,
      [options.sourceSnapshotId, options.manifest.url, options.manifest.sha256, options.manifest.fetched_at, json(options.manifest), catalog.rejections.length],
    );
    await client.query("DELETE FROM catalog_variants_staging WHERE source_snapshot_id = $1", [options.sourceSnapshotId]);
    await client.query("DELETE FROM catalog_products_staging WHERE source_snapshot_id = $1", [options.sourceSnapshotId]);
    // Rejections are audit rows for a snapshot, not an append-only retry log.
    // Re-running the same source therefore keeps the audit deterministic too.
    await client.query("DELETE FROM catalog_rejections WHERE source_snapshot_id = $1", [options.sourceSnapshotId]);

    for (const product of catalog.products) {
      await stageProduct(client, options.sourceSnapshotId, product);
      for (const variant of product.variants) await stageVariant(client, options.sourceSnapshotId, variant);
    }
    for (const rejection of catalog.rejections) {
      await client.query(
        `INSERT INTO catalog_rejections (source_id, reason, raw_payload, source_snapshot_id, record_type)
         VALUES ($1,$2,$3,$4,$5)`,
        [rejection.source_id, rejection.reason, json(rejection.raw_payload), options.sourceSnapshotId, rejection.record_type],
      );
    }

    const previous = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM catalog_products WHERE status = 'ACTIVE'");
    const previousCount = Number(previous.rows[0]?.count ?? 0);
    if (ids.length < minPublishedProducts) throw new Error("source snapshot has no publishable products");
    const minimumAllowed = previousCount * (1 - maxDropRatio);
    if (!options.allowPartial && previousCount > 0 && ids.length < minimumAllowed) {
      throw new Error(`partial source guard: ${ids.length} products would drop more than ${maxDropRatio * 100}% from ${previousCount}`);
    }

    const handles = catalog.products.map((product) => product.handle);
    await client.query(
      "DELETE FROM catalog_products WHERE handle = ANY($1::text[]) AND product_id <> ALL($2::text[])",
      [handles, ids],
    );
    for (const product of catalog.products) await publishProduct(client, options.sourceSnapshotId, product);

    await client.query("DELETE FROM catalog_variants WHERE product_id = ANY($1::text[])", [ids]);
    for (const product of catalog.products) {
      for (const variant of product.variants) await publishVariant(client, options.sourceSnapshotId, variant);
    }
    const deleted = await client.query<{ product_id: string }>(
      "DELETE FROM catalog_products WHERE product_id <> ALL($1::text[]) RETURNING product_id",
      [ids],
    );

    await client.query(
      `UPDATE rag_source_snapshots
       SET status = 'published', published_at = now(), published_products = $2,
           published_variants = $3, rejected_records = $4
       WHERE source_snapshot_id = $1`,
      [options.sourceSnapshotId, ids.length, variants.length, catalog.rejections.length],
    );
    await client.query("COMMIT");
    return {
      sourceSnapshotId: options.sourceSnapshotId,
      publishedProducts: ids.length,
      publishedVariants: variants.length,
      rejectedRecords: catalog.rejections.length,
      deletedProducts: deleted.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Enriquecimiento con evidencia (Tarea 03.1, PLAN_ARQUITECTURA_ESCENA_COMPLETA_
// RAG.md, Plan 03). Escritura DELIBERADAMENTE separada de
// `persistStagedCatalog()` de arriba: esa función sigue exactamente igual
// (mismo comportamiento para `scripts/import-cdn-catalog.ts` y cualquier otro
// llamador), y `persistSceneCapabilities()` es un flujo de escritura aditivo
// nuevo que un caller (p. ej. `scripts/enrich-scene-capabilities.ts`) invoca
// explícitamente, ya sea sobre el catálogo recién publicado por
// `persistStagedCatalog()` o sobre el catálogo ya publicado previamente por
// cualquiera de los dos pipelines de importación. Nunca se ejecuta como
// efecto secundario implícito de otra función de este módulo.
// ---------------------------------------------------------------------------

export type SceneCapabilityPersistOptions = {
  /** Quién dispara la escritura, para `catalog_source_audit.actor` (plan §6.4/§8.2). */
  actor?: string;
};

export type SceneCapabilityPersistSummary = {
  itemsUpserted: number;
  capabilitiesUpserted: number;
  itemsNeedingReview: number;
  auditRowsInserted: number;
};

async function upsertSceneCatalogItem(client: PoolClient, result: DeriveSceneCapabilitiesResult): Promise<void> {
  // Item a nivel de producto (sin variante): mismo criterio que
  // `adaptCatalogProductV2ToV3()`, que por defecto usa `product_id` como
  // `item_id`. Coincide con el índice único parcial
  // `ux_catalog_items_product_only` de la migración 012 (WHERE variant_id IS
  // NULL) — nunca inventa una variante-especificidad que el catálogo V2 no
  // tiene hoy.
  await client.query(
    `INSERT INTO catalog_items (item_id, product_id, variant_id, category_v3, updated_at)
     VALUES ($1, $2, NULL, $3, now())
     ON CONFLICT (item_id) DO UPDATE SET
       product_id = excluded.product_id, category_v3 = excluded.category_v3, updated_at = now()`,
    [result.itemId, result.productId, result.categoryV3],
  );
}

async function upsertSceneCapability(client: PoolClient, itemId: string, capability: DerivedSceneCapability): Promise<void> {
  // ON CONFLICT sobre la restricción UNIQUE (item_id, scene_function,
  // evidence) de la migración 012: re-correr el enriquecimiento sobre el
  // mismo dato de origen (mismo fragmento de evidencia) actualiza la misma
  // fila en vez de duplicarla — esto es lo que hace posible que el modo real
  // sea idempotente y el modo --dry-run sea comparable entre corridas.
  await client.query(
    `INSERT INTO catalog_product_capabilities (item_id, scene_function, confidence, evidence, derived_from)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_id, scene_function, evidence) DO UPDATE SET
       confidence = excluded.confidence, derived_from = excluded.derived_from`,
    [itemId, capability.scene_function, capability.confidence, capability.evidence, capability.derived_from],
  );
}

/**
 * Persiste un lote de resultados de `deriveSceneCapabilities()` (Tarea 03.1):
 * un `catalog_items` por producto y un `catalog_product_capabilities` por
 * candidata (tanto `derived` como `review` — un estado ambiguo se PERSISTE y
 * queda consultable como pendiente de revisión, nunca se descarta ni se trata
 * silenciosamente como cierto). Cada item procesado deja un registro en
 * `catalog_source_audit` con la evidencia completa, para que la procedencia
 * de cada capacidad sea auditable con una consulta.
 *
 * Toda la operación corre en una única transacción: un error a mitad de lote
 * revierte el lote completo, nunca deja un producto con `catalog_items` pero
 * sin sus capacidades (o viceversa).
 */
export async function persistSceneCapabilities(
  pool: Pool,
  results: DeriveSceneCapabilitiesResult[],
  options: SceneCapabilityPersistOptions = {},
): Promise<SceneCapabilityPersistSummary> {
  const actor = options.actor?.trim() || "enrich-scene-capabilities";
  const client = await pool.connect();
  let itemsUpserted = 0;
  let capabilitiesUpserted = 0;
  let itemsNeedingReview = 0;
  let auditRowsInserted = 0;
  try {
    await client.query("BEGIN");
    for (const result of results) {
      await upsertSceneCatalogItem(client, result);
      itemsUpserted++;
      if (result.needsReview) itemsNeedingReview++;

      for (const capability of result.capabilities) {
        await upsertSceneCapability(client, result.itemId, capability);
        capabilitiesUpserted++;
      }

      const reason = result.needsReview
        ? `enriquecimiento de escena: ${result.capabilities.length} candidata(s), pendiente de revisión (${result.reviewReasons.join("; ")})`
        : `enriquecimiento de escena: ${result.capabilities.length} candidata(s) derivada(s) con confianza publicable`;
      await client.query(
        `INSERT INTO catalog_source_audit (source_id, offer_id, action, reason, previous_state, new_state, actor)
         VALUES (NULL, NULL, 'updated', $1, NULL, $2, $3)`,
        [
          reason,
          json({
            item_id: result.itemId,
            product_id: result.productId,
            category_v3: result.categoryV3,
            overall_confidence: result.overallConfidence,
            capabilities: result.capabilities,
          }),
          actor,
        ],
      );
      auditRowsInserted++;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { itemsUpserted, capabilitiesUpserted, itemsNeedingReview, auditRowsInserted };
}
