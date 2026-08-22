import {
  type CatalogProductSource,
  type CatalogVariantSource,
  type ProductsCatalogSource,
} from "../sources/contracts";
import { construirSearchText, hashSearchText, sanitizeTexto, sanitizeTextoNullable } from "./sanitize";
import { CatalogProductSchema, CatalogVariantSchema, type CatalogProduct, type CatalogVariant } from "./schemas";
import {
  decodificarTamano,
  derivarCategoria,
  derivarColores,
  derivarOcasiones,
  limpiarTitulo,
  tipoExcluido,
  type TamanoDecodificado,
} from "../../../lib/shopify/derivar";

export type CanonicalRejection = {
  source_id: string | null;
  record_type: "product" | "variant";
  reason: string;
  raw_payload: unknown;
};

export type CanonicalVariant = CatalogVariant & {
  source_variant_id: string;
  sku_original: string | null;
  sku_canonical: string | null;
  sku_ambiguous: boolean;
  attribute_states: Record<string, "source" | "derived" | "unknown">;
};

export type CanonicalProduct = CatalogProduct & {
  source_product_id: string;
  source_status: string;
  publication_reason: "active_positive_price";
  attribute_states: Record<string, "source" | "derived" | "unknown">;
  variants: CanonicalVariant[];
};

export type CanonicalCatalog = {
  products: CanonicalProduct[];
  rejections: CanonicalRejection[];
  source_products: number;
  source_variants: number;
};

type CanonicalizeOptions = {
  rejectExcludedTypes?: boolean;
};

/**
 * Convierte una vez un GID de Shopify al identificador estable que usa el
 * catálogo. Se conserva el tramo final aun cuando una fixture use un sufijo
 * no numérico; nunca se mezcla un Product con un ProductVariant.
 */
export function canonicalizeShopifyId(value: string, expectedKind: "Product" | "ProductVariant"): string {
  const raw = sanitizeTexto(value);
  const match = raw.match(/^gid:\/\/shopify\/([^/]+)\/([^/]+)$/i);
  if (!match) return raw;
  if (match[1].toLowerCase() !== expectedKind.toLowerCase()) {
    throw new Error(`GID kind mismatch: expected ${expectedKind}`);
  }
  return sanitizeTexto(match[2]);
}

/**
 * Join key for SKU lookups. The original SKU remains untouched in `sku` and
 * `sku_original`; only the lookup key is normalized. B2B- is a known channel
 * prefix in this dataset and is therefore not identity-bearing.
 */
export function canonicalizeSku(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = sanitizeTexto(value).toUpperCase().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.replace(/^B2B\s*[-:]\s*/, "");
}

function sourceStatus(value: string): string {
  return sanitizeTexto(value).toUpperCase();
}

function parsePositivePrice(value: string): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(sanitizeTexto).filter(Boolean))];
}

function findExplicitSize(product: CatalogProductSource, variant: CatalogVariantSource): {
  codigo: string | null;
  decoded: TamanoDecodificado | null;
} {
  // Only decode an explicit code. A free-form title such as "Grande" is not
  // enough evidence to fabricate dimensions or shape.
  const candidates = [variant.title, ...product.tags];
  for (const candidate of candidates) {
    const decoded = decodificarTamano(candidate);
    if (decoded) return { codigo: sanitizeTexto(candidate), decoded };
  }
  return { codigo: null, decoded: null };
}

function sizeFields(size: { codigo: string | null; decoded: TamanoDecodificado | null }) {
  return {
    codigo_tamano: size.codigo,
    forma: size.decoded?.forma ?? null,
    diam_pulg: size.decoded?.diamPulg ?? null,
    largo_pulg: size.decoded?.largoPulg ?? null,
    ancho_cm: size.decoded?.anchoCm ?? null,
    alto_cm: size.decoded?.altoCm ?? null,
  };
}

function attributeStates(colors: string[], occasions: string[], size: TamanoDecodificado | null) {
  return {
    price: "source" as const,
    availability: "source" as const,
    inventory: "source" as const,
    color: colors.length ? ("derived" as const) : ("unknown" as const),
    occasion: occasions.length ? ("derived" as const) : ("unknown" as const),
    shape: size?.forma ? ("derived" as const) : ("unknown" as const),
    size: size ? ("derived" as const) : ("unknown" as const),
  };
}

function canonicalizeVariant(
  product: CatalogProductSource,
  variant: CatalogVariantSource,
  productId: string,
): CanonicalVariant | CanonicalRejection {
  const variantId = canonicalizeShopifyId(variant.id, "ProductVariant");
  const price = parsePositivePrice(variant.price);
  if (price === null) {
    return {
      source_id: variant.id,
      record_type: "variant",
      reason: "non_positive_price",
      raw_payload: variant,
    };
  }

  const skuOriginal = sanitizeTextoNullable(variant.sku);
  const skuCanonical = canonicalizeSku(skuOriginal);
  const title = sanitizeTextoNullable(variant.title);
  const imageUrl = product.images[0]?.url ? sanitizeTexto(product.images[0].url) : null;
  const size = findExplicitSize(product, variant);

  const value: CanonicalVariant = {
    variant_id: variantId,
    product_id: productId,
    sku: skuOriginal,
    title,
    price,
    currency: "COP",
    inventory_quantity: variant.inventoryQuantity ?? null,
    inventory_source: "cdn",
    available: variant.availableForSale,
    options: { variant_title: title },
    image_url: imageUrl,
    source_payload: variant,
    ...sizeFields(size),
    source_variant_id: variant.id,
    sku_original: skuOriginal,
    sku_canonical: skuCanonical,
    sku_ambiguous: false,
    attribute_states: attributeStates([], [], size.decoded),
  };
  const parsed = CatalogVariantSchema.parse(value);
  return {
    ...parsed,
    source_variant_id: value.source_variant_id,
    sku_original: value.sku_original,
    sku_canonical: value.sku_canonical,
    sku_ambiguous: value.sku_ambiguous,
    attribute_states: value.attribute_states,
  } as CanonicalVariant;
}

function canonicalizeProduct(
  product: CatalogProductSource,
  usedProductIds: Set<string>,
  usedVariantIds: Set<string>,
  options: CanonicalizeOptions,
): { product: CanonicalProduct | null; rejections: CanonicalRejection[] } {
  const rejections: CanonicalRejection[] = [];
  const sourceId = product.id;
  let productId: string;
  try {
    productId = canonicalizeShopifyId(product.id, "Product");
  } catch (error) {
    return {
      product: null,
      rejections: [{ source_id: sourceId, record_type: "product", reason: error instanceof Error ? error.message : "invalid_product_gid", raw_payload: product }],
    };
  }
  if (usedProductIds.has(productId)) {
    return {
      product: null,
      rejections: [{ source_id: sourceId, record_type: "product", reason: "duplicate_canonical_product_id", raw_payload: product }],
    };
  }
  usedProductIds.add(productId);

  const status = sourceStatus(product.status);
  if (status !== "ACTIVE") {
    return {
      product: null,
      rejections: [{ source_id: sourceId, record_type: "product", reason: `source_status_${status.toLowerCase()}`, raw_payload: product }],
    };
  }
  const productType = sanitizeTextoNullable(product.productType);
  if (options.rejectExcludedTypes && tipoExcluido(productType)) {
    return {
      product: null,
      rejections: [{ source_id: sourceId, record_type: "product", reason: "excluded_product_type", raw_payload: product }],
    };
  }

  const variants: CanonicalVariant[] = [];
  for (const sourceVariant of product.variants) {
    let variantId: string;
    try {
      variantId = canonicalizeShopifyId(sourceVariant.id, "ProductVariant");
    } catch (error) {
      rejections.push({ source_id: sourceVariant.id, record_type: "variant", reason: error instanceof Error ? error.message : "invalid_variant_gid", raw_payload: sourceVariant });
      continue;
    }
    if (usedVariantIds.has(variantId)) {
      rejections.push({ source_id: sourceVariant.id, record_type: "variant", reason: "duplicate_canonical_variant_id", raw_payload: sourceVariant });
      continue;
    }
    usedVariantIds.add(variantId);
    const result = canonicalizeVariant(product, sourceVariant, productId);
    if ("record_type" in result) {
      rejections.push(result);
    } else {
      variants.push(result);
    }
  }

  if (variants.length === 0) {
    rejections.push({ source_id: sourceId, record_type: "product", reason: "no_positive_price_variant", raw_payload: product });
    return { product: null, rejections };
  }

  const rawTags = uniqueStrings(product.tags);
  const title = sanitizeTexto(limpiarTitulo(product.title));
  const colors = derivarColores(rawTags, title);
  const occasions = derivarOcasiones(rawTags, title);
  const category = derivarCategoria(productType, rawTags);
  const variantTitles = variants.map((variant) => variant.title).filter((value): value is string => Boolean(value));
  const searchTags = uniqueStrings([...rawTags, ...(productType ? [productType] : []), ...variantTitles]);
  const skus = uniqueStrings(variants.flatMap((variant) => [variant.sku_original, variant.sku_canonical]).filter((value): value is string => Boolean(value)));
  const searchText = construirSearchText({
    titulo: title,
    categoria: category,
    descripcion: null,
    tags: searchTags,
    colores: colors,
    ocasiones: occasions,
    skus,
  });
  const sizeForProduct = variants.find((variant) => variant.forma || variant.codigo_tamano);
  const attributes = attributeStates(colors, occasions, sizeForProduct?.forma ? {
    forma: sizeForProduct.forma,
    diamPulg: sizeForProduct.diam_pulg,
    largoPulg: sizeForProduct.largo_pulg,
    anchoCm: sizeForProduct.ancho_cm,
    altoCm: sizeForProduct.alto_cm,
  } : null);

  const value: CanonicalProduct = {
    product_id: productId,
    handle: sanitizeTexto(product.handle),
    title,
    description_text: null,
    vendor: sanitizeTextoNullable(product.vendor),
    product_type: productType,
    tags: rawTags,
    image_urls: uniqueStrings(product.images.map((image) => image.url)),
    status: "ACTIVE",
    available: variants.some((variant) => variant.available),
    price_min: Math.min(...variants.map((variant) => variant.price)),
    price_max: Math.max(...variants.map((variant) => variant.price)),
    derived: { category, colors, occasions },
    source_payload: product,
    search_text: searchText,
    embedding_source_hash: hashSearchText(searchText),
    source_updated_at: product.updatedAt ?? null,
    source_product_id: product.id,
    source_status: status,
    publication_reason: "active_positive_price",
    attribute_states: attributes,
    variants,
  };
  // The public Zod contract intentionally describes the product document and
  // strips internal persistence metadata. Re-attach the explicit provenance
  // and variant collection after validation rather than bypassing the schema.
  const parsed = CatalogProductSchema.parse(value);
  return {
    product: {
      ...parsed,
      source_product_id: value.source_product_id,
      source_status: value.source_status,
      publication_reason: value.publication_reason,
      attribute_states: value.attribute_states,
      variants,
    } as CanonicalProduct,
    rejections,
  };
}

/** Canonicalizes and applies publication policy without touching Postgres. */
export function canonicalizeCatalog(source: ProductsCatalogSource, options: CanonicalizeOptions = {}): CanonicalCatalog {
  const products: CanonicalProduct[] = [];
  const rejections: CanonicalRejection[] = [];
  const usedProductIds = new Set<string>();
  const usedVariantIds = new Set<string>();

  for (const productSource of source) {
    const result = canonicalizeProduct(productSource, usedProductIds, usedVariantIds, options);
    rejections.push(...result.rejections);
    if (result.product) products.push(result.product);
  }

  const skuCounts = new Map<string, number>();
  for (const product of products) {
    for (const variant of product.variants) {
      if (variant.sku_canonical) skuCounts.set(variant.sku_canonical, (skuCounts.get(variant.sku_canonical) ?? 0) + 1);
    }
  }
  for (const product of products) {
    for (const variant of product.variants) {
      variant.sku_ambiguous = Boolean(variant.sku_canonical && (skuCounts.get(variant.sku_canonical) ?? 0) > 1);
    }
  }

  return {
    products,
    rejections,
    source_products: source.length,
    source_variants: source.reduce((count, product) => count + product.variants.length, 0),
  };
}
