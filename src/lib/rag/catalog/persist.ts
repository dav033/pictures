import type { Pool } from "pg";
import type { CatalogProduct, CatalogVariant } from "./schemas";

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
  await pool.query(
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

  await pool.query("DELETE FROM catalog_variants WHERE product_id = $1", [producto.product_id]);
  for (const v of variantes) {
    await pool.query(
      `INSERT INTO catalog_variants
         (variant_id, product_id, sku, title, price, currency, inventory_quantity,
          inventory_source, available, options, image_url, source_payload,
          codigo_tamano, forma, diam_pulg, largo_pulg, ancho_cm, alto_cm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        v.variant_id,
        v.product_id,
        v.sku,
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
      ],
    );
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
