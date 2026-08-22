import type { Pool } from "pg";
import type { CatalogProduct, CatalogVariant } from "./schemas";
import { canonicalizeSku } from "./canonicalize";

type ExistingSkuRow = {
  variant_id: string;
  sku: string | null;
  sku_original: string | null;
  sku_canonical: string | null;
};

function attributeStates(variant: CatalogVariant): Record<string, "source" | "derived" | "unknown"> {
  return {
    price: "source",
    availability: "source",
    inventory: variant.inventory_quantity == null ? "unknown" : "source",
    color: variant.derived_colors.length ? "derived" : "unknown",
    shape: variant.forma ? "derived" : "unknown",
    size: variant.codigo_tamano ? "derived" : "unknown",
  };
}

async function recomputeSkuAmbiguity(client: import("pg").PoolClient, productId: string, affectedKeys: Set<string>): Promise<void> {
  // A source SKU can be removed. Such a row no longer belongs to any
  // collision group and must not retain a stale ambiguous flag.
  await client.query(
    `UPDATE catalog_variants SET sku_ambiguous = FALSE
      WHERE product_id = $1 AND sku_canonical IS NULL`,
    [productId],
  );
  if (affectedKeys.size === 0) return;

  // The legacy path may have rows written before v2 columns existed. Read the
  // small catalog once, canonicalize in the same helper used by retrieval,
  // then update only keys touched by this product. This keeps old rows in the
  // collision set instead of silently dropping their provenance.
  const { rows } = await client.query<ExistingSkuRow>(
    `SELECT variant_id, sku, sku_original, sku_canonical
       FROM catalog_variants
      WHERE sku IS NOT NULL OR sku_original IS NOT NULL OR sku_canonical IS NOT NULL`,
  );
  const relevant = rows
    .map((row) => {
      const original = row.sku_original ?? row.sku;
      const canonical = canonicalizeSku(original) ?? row.sku_canonical;
      return { row, original, canonical };
    })
    .filter((item): item is { row: ExistingSkuRow; original: string; canonical: string } =>
      Boolean(item.canonical && affectedKeys.has(item.canonical)),
    );
  const counts = new Map<string, number>();
  for (const item of relevant) counts.set(item.canonical, (counts.get(item.canonical) ?? 0) + 1);

  for (const item of relevant) {
    const ambiguous = (counts.get(item.canonical) ?? 0) > 1;
    if (
      item.row.sku_original === item.original &&
      item.row.sku_canonical === item.canonical
    ) {
      await client.query(
        `UPDATE catalog_variants
            SET sku_ambiguous = $2
          WHERE variant_id = $1`,
        [item.row.variant_id, ambiguous],
      );
    } else {
      await client.query(
        `UPDATE catalog_variants
            SET sku_original = $2, sku_canonical = $3, sku_ambiguous = $4
          WHERE variant_id = $1`,
        [item.row.variant_id, item.original, item.canonical, ambiguous],
      );
    }
  }
}

/**
 * Upsert compartido entre la importación masiva (script) y el receptor de
 * webhooks (Fase 5) — una sola fuente de verdad para el SQL de persistencia,
 * para que no se desincronicen dos copias del mismo INSERT.
 */
export async function upsertProducto(
  pool: Pool,
  producto: CatalogProduct,
  variantes: CatalogVariant[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize legacy writers while SKU collision flags are recomputed; two
    // concurrent webhooks must not observe different halves of the key set.
    await client.query("LOCK TABLE catalog_variants IN SHARE ROW EXCLUSIVE MODE");

    const oldRows = await client.query<{ sku: string | null; sku_original: string | null; sku_canonical: string | null }>(
      `SELECT sku, sku_original, sku_canonical
         FROM catalog_variants
        WHERE product_id = $1`,
      [producto.product_id],
    );
    const affectedKeys = new Set<string>();
    for (const row of oldRows.rows) {
      const key = canonicalizeSku(row.sku_original ?? row.sku) ?? row.sku_canonical;
      if (key) affectedKeys.add(key);
    }
    for (const variant of variantes) {
      const key = canonicalizeSku(variant.sku);
      if (key) affectedKeys.add(key);
    }

    await client.query(
      `INSERT INTO catalog_products
         (product_id, handle, title, description_text, vendor, product_type, tags, image_urls,
          status, available, price_min, price_max, derived, source_payload, search_text,
          embedding_source_hash, source_updated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
       ON CONFLICT (product_id) DO UPDATE SET
         handle = excluded.handle, title = excluded.title, description_text = excluded.description_text,
         vendor = excluded.vendor, product_type = excluded.product_type, tags = excluded.tags,
         image_urls = excluded.image_urls, status = excluded.status, available = excluded.available,
         price_min = excluded.price_min, price_max = excluded.price_max, derived = excluded.derived,
         source_payload = excluded.source_payload, search_text = excluded.search_text,
         embedding_source_hash = excluded.embedding_source_hash,
         source_updated_at = excluded.source_updated_at, updated_at = now()`,
      [
        producto.product_id,
        producto.handle,
        producto.title,
        producto.description_text,
        producto.vendor,
        producto.product_type,
        producto.tags,
        producto.image_urls,
        producto.status,
        producto.available,
        producto.price_min,
        producto.price_max,
        JSON.stringify(producto.derived),
        JSON.stringify(producto.source_payload),
        producto.search_text,
        producto.embedding_source_hash,
        producto.source_updated_at,
      ],
    );

    const variantIds = variantes.map((variant) => variant.variant_id);
    await client.query(
      `DELETE FROM catalog_variants
        WHERE product_id = $1 AND NOT (variant_id = ANY($2::text[]))`,
      [producto.product_id, variantIds],
    );
    for (const v of variantes) {
      const skuOriginal = v.sku;
      const skuCanonical = canonicalizeSku(skuOriginal);
      await client.query(
        `INSERT INTO catalog_variants
           (variant_id, product_id, sku, sku_original, sku_canonical, sku_ambiguous,
            title, price, currency, inventory_quantity, inventory_source,
            available, options, image_url, source_payload, codigo_tamano, forma,
            diam_pulg, largo_pulg, ancho_cm, alto_cm, unidades_paq, unidades_inferidas,
            derived_colors, source_variant_id, attribute_states)
         VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (variant_id) DO UPDATE SET
           product_id = excluded.product_id, sku = excluded.sku,
           sku_original = excluded.sku_original,
           sku_canonical = excluded.sku_canonical,
           title = excluded.title, price = excluded.price, currency = excluded.currency,
           inventory_quantity = excluded.inventory_quantity, inventory_source = excluded.inventory_source,
           available = excluded.available, options = excluded.options, image_url = excluded.image_url,
           source_payload = excluded.source_payload, codigo_tamano = excluded.codigo_tamano,
           forma = excluded.forma, diam_pulg = excluded.diam_pulg, largo_pulg = excluded.largo_pulg,
           ancho_cm = excluded.ancho_cm, alto_cm = excluded.alto_cm,
           unidades_paq = excluded.unidades_paq, unidades_inferidas = excluded.unidades_inferidas,
           derived_colors = excluded.derived_colors, source_variant_id = excluded.source_variant_id,
           attribute_states = excluded.attribute_states`,
        [
          v.variant_id,
          v.product_id,
          v.sku,
          skuOriginal,
          skuCanonical,
          v.title,
          v.price,
          v.currency,
          v.inventory_quantity,
          v.inventory_source,
          v.available,
          JSON.stringify(v.options),
          v.image_url,
          JSON.stringify(v.source_payload),
          v.codigo_tamano,
          v.forma,
          v.diam_pulg,
          v.largo_pulg,
          v.ancho_cm,
          v.alto_cm,
          v.unidades_paq,
          v.unidades_inferidas,
          v.derived_colors,
          v.variant_id,
          JSON.stringify(attributeStates(v)),
        ],
      );
    }

    await recomputeSkuAmbiguity(client, producto.product_id, affectedKeys);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** CASCADE en el esquema limpia variantes y embeddings solo. */
export async function eliminarProducto(pool: Pool, productId: string): Promise<void> {
  await pool.query("DELETE FROM catalog_products WHERE product_id = $1", [productId]);
}

/** `source_updated_at` almacenado — null significa "desconocido", se trata
 * como "siempre más viejo" para no bloquear la primera escritura real. */
export async function obtenerSourceUpdatedAt(pool: Pool, productId: string): Promise<string | null> {
  const { rows } = await pool.query<{ source_updated_at: string | null }>(
    "SELECT source_updated_at FROM catalog_products WHERE product_id = $1",
    [productId],
  );
  return rows[0]?.source_updated_at ?? null;
}
