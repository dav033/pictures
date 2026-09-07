import "server-only";
import fs from "node:fs";
import { getRagPool } from "@/lib/rag/db";

/**
 * training_1 ahora enforce_dataset_allowlist=true sobre lora-dataset-v004-154,
 * pero lora_dataset_element_stats nunca se pobló para ese dataset (solo se
 * construyó para v007). Sin filas, resolveLoraModeDatasetAllowlist lanza
 * LORA_DATASET_ALLOWLIST_EMPTY y bloquea toda generación.
 *
 * Reconstruye las filas reales desde data/processed/lora-v004-composicion.json
 * (402 elementos con SKU real), resolviendo cada SKU contra catalog_variants
 * para obtener product_id/variant_id verdaderos. No inventa nada: cada fila
 * exige una coincidencia real en el catálogo.
 */
type ElementoShopify = { producto: string; variante: string | null; sku: string | null; fotos: number; pct: number };

async function main(): Promise<void> {
  const pool = getRagPool();
  const composicion = JSON.parse(fs.readFileSync("data/processed/lora-v004-composicion.json", "utf8")) as {
    dataset: { imagenes: number };
    shopify: { elementos: ElementoShopify[] };
  };

  const skus = [...new Set(composicion.shopify.elementos.map((el) => el.sku).filter((sku): sku is string => Boolean(sku)))];
  const { rows: catalogo } = await pool.query<{ product_id: string; variant_id: string; sku: string; title: string }>(
    `SELECT v.product_id, v.variant_id, v.sku, p.title
       FROM catalog_variants v JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.sku = ANY($1::text[])`,
    [skus],
  );
  const porSku = new Map(catalogo.map((row) => [row.sku, row]));

  const sinMatch: string[] = [];
  const filas = composicion.shopify.elementos.flatMap((el) => {
    if (!el.sku) return [];
    const match = porSku.get(el.sku);
    if (!match) {
      sinMatch.push(`${el.sku} (${el.producto})`);
      return [];
    }
    return [{ ...el, product_id: match.product_id, variant_id: match.variant_id, title: match.title }];
  });

  console.log(`${filas.length}/${composicion.shopify.elementos.length} elementos resueltos contra catalog_variants.`);
  if (sinMatch.length) console.log(`Sin match (${sinMatch.length}):`, sinMatch.slice(0, 10).join(", "), sinMatch.length > 10 ? "..." : "");

  if (filas.length === 0) throw new Error("Ningun elemento del historico de v004 resolvio contra el catalogo actual; no se puede poblar el allowlist.");

  const writes = filas.map((fila) => ({
    canonicalId: `${fila.product_id}:${fila.variant_id}`,
    productId: fila.product_id,
    variantId: fila.variant_id,
    label: fila.title,
    sku: fila.sku,
    imageCount: fila.fotos,
    representationPct: fila.pct,
  }));

  await pool.query("DELETE FROM lora_dataset_element_stats WHERE dataset_id = $1 AND element_kind = 'shopify_variant'", ["lora-dataset-v004-154"]);
  for (const write of writes) {
    await pool.query(
      `INSERT INTO lora_dataset_element_stats (dataset_id, element_kind, canonical_id, label, product_id, variant_id, sku, image_count, representation_pct, image_keys)
       VALUES ($1, 'shopify_variant', $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb)
       ON CONFLICT (dataset_id, element_kind, canonical_id) DO UPDATE
         SET label = EXCLUDED.label, product_id = EXCLUDED.product_id, variant_id = EXCLUDED.variant_id,
             sku = EXCLUDED.sku, image_count = EXCLUDED.image_count, representation_pct = EXCLUDED.representation_pct`,
      ["lora-dataset-v004-154", write.canonicalId, write.label, write.productId, write.variantId, write.sku, write.imageCount, write.representationPct],
    );
  }

  const check = await pool.query("SELECT COUNT(*)::int AS n FROM lora_dataset_element_stats WHERE dataset_id = $1", ["lora-dataset-v004-154"]);
  console.log("Filas insertadas para lora-dataset-v004-154:", check.rows[0].n);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
