import type { Pool } from "pg";
import { canonicalizeSku } from "@/lib/rag/catalog/canonicalize";

/**
 * Links the Shopify elements represented in a LoRA dataset to the CURRENT
 * catalog snapshot.
 *
 * `lora_dataset_element_stats` stores the product/variant ids of the catalog
 * that existed when the dataset was built. Those ids are surrogate Shopify ids
 * of one store: a catalog re-import from another source (e.g. the B2B CDN
 * catalog imported on 2026-09-11) assigns new ids to the same physical product,
 * so an id-only join silently drops every trained element.
 *
 * The supplier SKU is the stable identity across imports. The rule, in order:
 * 1. The stored variant id still exists in the catalog -> linked by id, unless
 *    both sides carry a canonical SKU and they disagree (conflict, not linked).
 * 2. Otherwise the canonical SKU (same `canonicalizeSku` the importer uses)
 *    matches exactly ONE catalog variant that the catalog does not flag as
 *    `sku_ambiguous` -> linked by SKU.
 * 3. An element without variant or SKU information links by product id only
 *    when that product still exists.
 * Everything else is reported (unmatched / ambiguous / conflict) and is never
 * guessed from titles.
 */

export type DatasetElement = {
  canonicalId: string;
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  imageCount: number;
};

export type CatalogVariantKey = {
  variantId: string;
  productId: string;
  skuCanonical: string | null;
  skuAmbiguous: boolean;
};

export type LinkedDatasetElement = {
  canonicalId: string;
  productId: string;
  variantId: string | null;
  imageCount: number;
  via: "variant_id" | "sku_canonical" | "product_id";
};

export type DatasetCatalogLink = {
  linked: LinkedDatasetElement[];
  unmatched: string[];
  ambiguous: string[];
  conflicts: string[];
};

export function linkDatasetElementsToCatalog(
  elements: ReadonlyArray<DatasetElement>,
  catalogVariants: ReadonlyArray<CatalogVariantKey>,
  catalogProductIds: ReadonlySet<string>,
): DatasetCatalogLink {
  const byVariantId = new Map(catalogVariants.map((variant) => [variant.variantId, variant]));
  const bySku = new Map<string, CatalogVariantKey[]>();
  for (const variant of catalogVariants) {
    if (!variant.skuCanonical) continue;
    const list = bySku.get(variant.skuCanonical) ?? [];
    list.push(variant);
    bySku.set(variant.skuCanonical, list);
  }

  const result: DatasetCatalogLink = { linked: [], unmatched: [], ambiguous: [], conflicts: [] };
  for (const element of elements) {
    const sku = canonicalizeSku(element.sku);
    const byId = element.variantId ? byVariantId.get(element.variantId) : undefined;
    if (byId) {
      if (sku && byId.skuCanonical && byId.skuCanonical !== sku) {
        result.conflicts.push(element.canonicalId);
        continue;
      }
      result.linked.push({ canonicalId: element.canonicalId, productId: byId.productId, variantId: byId.variantId, imageCount: element.imageCount, via: "variant_id" });
      continue;
    }
    if (sku) {
      const candidates = bySku.get(sku) ?? [];
      if (candidates.length === 0) result.unmatched.push(element.canonicalId);
      else if (candidates.length > 1 || candidates[0].skuAmbiguous) result.ambiguous.push(element.canonicalId);
      else result.linked.push({ canonicalId: element.canonicalId, productId: candidates[0].productId, variantId: candidates[0].variantId, imageCount: element.imageCount, via: "sku_canonical" });
      continue;
    }
    if (!element.variantId && element.productId && catalogProductIds.has(element.productId)) {
      result.linked.push({ canonicalId: element.canonicalId, productId: element.productId, variantId: null, imageCount: element.imageCount, via: "product_id" });
      continue;
    }
    result.unmatched.push(element.canonicalId);
  }
  return result;
}

/** Loads the dataset's Shopify elements and the catalog keys they can link to. */
export async function linkDatasetToCurrentCatalog(pool: Pool, datasetId: string): Promise<DatasetCatalogLink> {
  const stats = await pool.query<{ canonical_id: string; product_id: string | null; variant_id: string | null; sku: string | null; image_count: number }>(
    `SELECT canonical_id, product_id, variant_id, sku, image_count
       FROM lora_dataset_element_stats
      WHERE dataset_id = $1
        AND element_kind = 'shopify_variant'
        AND (product_id IS NOT NULL OR variant_id IS NOT NULL OR sku IS NOT NULL)`,
    [datasetId],
  );
  const elements: DatasetElement[] = stats.rows.map((row) => ({
    canonicalId: row.canonical_id,
    productId: row.product_id,
    variantId: row.variant_id,
    sku: row.sku,
    imageCount: row.image_count,
  }));
  const variantIds = elements.flatMap((element) => element.variantId ? [element.variantId] : []);
  const skus = [...new Set(elements.flatMap((element) => {
    const sku = canonicalizeSku(element.sku);
    return sku ? [sku] : [];
  }))];
  const productIds = elements.flatMap((element) => element.productId ? [element.productId] : []);

  const variants = await pool.query<{ variant_id: string; product_id: string; sku_canonical: string | null; sku_ambiguous: boolean }>(
    `SELECT variant_id, product_id, sku_canonical, sku_ambiguous
       FROM catalog_variants
      WHERE variant_id = ANY($1::text[])
         OR sku_canonical = ANY($2::text[])`,
    [variantIds, skus],
  );
  const products = await pool.query<{ product_id: string }>(
    "SELECT product_id FROM catalog_products WHERE product_id = ANY($1::text[])",
    [productIds],
  );
  return linkDatasetElementsToCatalog(
    elements,
    variants.rows.map((row) => ({ variantId: row.variant_id, productId: row.product_id, skuCanonical: row.sku_canonical, skuAmbiguous: row.sku_ambiguous })),
    new Set(products.rows.map((row) => row.product_id)),
  );
}
