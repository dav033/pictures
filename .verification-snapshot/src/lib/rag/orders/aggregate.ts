import { canonicalizeSku } from "../catalog/canonicalize";
import type { OrderDataSource } from "../sources/contracts";

export const ORDER_DEMAND_CLASS = "observed_demand" as const;

export type CatalogVariantIdentity = {
  variantId: string;
  sourceVariantId: string;
  productId: string;
  skuOriginal: string | null;
  skuCanonical: string | null;
  skuAmbiguous: boolean;
};

export type OrderDemandAggregate = {
  variantId: string;
  productId: string;
  skuCanonical: string | null;
  skuAmbiguous: boolean;
  demandClass: typeof ORDER_DEMAND_CLASS;
  orderCount: number;
  unitsObserved: number;
  firstObservedAt: string;
  lastObservedAt: string;
  halfLifeDays: number;
  decayFactor: number;
  weightedUnits: number;
};

export type OrderAggregateReport = {
  orders: number;
  lines: number;
  ordersWithLines: number;
  matchedLines: number;
  matchedByVariantId: number;
  matchedBySku: number;
  matchedWithAmbiguousSkuLines: number;
  matchedWithAmbiguousSkuUnits: number;
  ambiguousSkuLines: number;
  unmatchedLines: number;
  unitsObserved: number;
  aggregateVariants: number;
  ambiguousSkuKeys: number;
  demandClass: typeof ORDER_DEMAND_CLASS;
};

export type OrderAggregateBatch = {
  aggregates: OrderDemandAggregate[];
  report: OrderAggregateReport;
};

type VariantIndex = {
  bySourceVariantId: Map<string, CatalogVariantIdentity>;
  byVariantId: Map<string, CatalogVariantIdentity>;
  bySku: Map<string, CatalogVariantIdentity[]>;
};

type MutableAggregate = {
  variant: CatalogVariantIdentity;
  orderKeys: Set<string>;
  unitsObserved: number;
  firstObservedAt: string;
  lastObservedAt: string;
};

type AggregateOptions = {
  asOf?: Date;
  halfLifeDays?: number;
};

function normalizeIdentity(identity: CatalogVariantIdentity): CatalogVariantIdentity {
  return {
    ...identity,
    variantId: identity.variantId.trim(),
    sourceVariantId: identity.sourceVariantId.trim(),
    productId: identity.productId.trim(),
    skuOriginal: identity.skuOriginal?.trim() || null,
    skuCanonical: identity.skuCanonical ? canonicalizeSku(identity.skuCanonical) : canonicalizeSku(identity.skuOriginal),
  };
}

/** Builds exact-ID and unique/ambiguous-SKU indexes without choosing a row. */
export function buildVariantIndex(identities: CatalogVariantIdentity[]): VariantIndex {
  const bySourceVariantId = new Map<string, CatalogVariantIdentity>();
  const byVariantId = new Map<string, CatalogVariantIdentity>();
  const bySku = new Map<string, CatalogVariantIdentity[]>();

  for (const input of identities) {
    const identity = normalizeIdentity(input);
    if (!identity.variantId || !identity.sourceVariantId || !identity.productId) continue;
    if (bySourceVariantId.has(identity.sourceVariantId) || byVariantId.has(identity.variantId)) continue;
    bySourceVariantId.set(identity.sourceVariantId, identity);
    byVariantId.set(identity.variantId, identity);
    if (identity.skuCanonical) {
      bySku.set(identity.skuCanonical, [...(bySku.get(identity.skuCanonical) ?? []), identity]);
    }
  }

  return { bySourceVariantId, byVariantId, bySku };
}

function dateValue(date: string): number {
  const value = Date.parse(date);
  if (!Number.isFinite(value)) throw new Error("order createdAt is not a valid date");
  return value;
}

function decayFactor(lastObservedAt: string, asOf: Date, halfLifeDays: number): number {
  const ageDays = Math.max(0, asOf.getTime() - dateValue(lastObservedAt)) / 86_400_000;
  return Math.max(0, Math.min(1, 2 ** (-ageDays / halfLifeDays)));
}

function matchVariant(
  variantId: string | null | undefined,
  sku: string | null | undefined,
  index: VariantIndex,
): { identity: CatalogVariantIdentity; method: "variant_id" | "sku_unique" } | { ambiguous: true } | null {
  if (variantId) {
    const exact = index.bySourceVariantId.get(variantId) ?? index.byVariantId.get(variantId);
    if (exact) return { identity: exact, method: "variant_id" };
  }

  const skuCanonical = canonicalizeSku(sku);
  if (!skuCanonical) return null;
  const candidates = index.bySku.get(skuCanonical) ?? [];
  if (candidates.length !== 1) return candidates.length > 1 ? { ambiguous: true } : null;
  return { identity: candidates[0], method: "sku_unique" };
}

function asOfFor(source: OrderDataSource, options: AggregateOptions): Date {
  if (options.asOf) return options.asOf;
  const dates = source.data.orders.edges.map((edge) => dateValue(edge.node.createdAt));
  // The snapshot's own latest order is the deterministic cutoff. Using the
  // wall clock here would change weighted_units on every replay of the same
  // hash and make idempotence impossible to audit.
  return new Date(dates.length ? Math.max(...dates) : 0);
}

/**
 * Converts order history to a weak, decayed signal. Order/customer/line IDs
 * exist only in local memory to count distinct orders; none are returned.
 * Financial and fulfillment statuses are intentionally not read: every row
 * is labelled `observed_demand`, never paid/fulfilled inventory truth.
 */
export function aggregateOrderData(
  source: OrderDataSource,
  identities: CatalogVariantIdentity[],
  options: AggregateOptions = {},
): OrderAggregateBatch {
  const halfLifeDays = options.halfLifeDays ?? 30;
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) throw new Error("halfLifeDays must be positive");

  const index = buildVariantIndex(identities);
  const asOf = asOfFor(source, options);
  const mutable = new Map<string, MutableAggregate>();
  const ambiguousSkuKeys = new Set<string>();
  let lines = 0;
  let matchedLines = 0;
  let matchedByVariantId = 0;
  let matchedBySku = 0;
  let matchedWithAmbiguousSkuLines = 0;
  let matchedWithAmbiguousSkuUnits = 0;
  let ambiguousSkuLines = 0;
  let unmatchedLines = 0;
  let unitsObserved = 0;
  let ordersWithLines = 0;

  for (const orderEdge of source.data.orders.edges) {
    const order = orderEdge.node;
    const orderLines = order.lineItems.edges;
    if (orderLines.length > 0) ordersWithLines++;

    for (const lineEdge of orderLines) {
      lines++;
      const line = lineEdge.node;
      unitsObserved += line.quantity;
      const match = matchVariant(line.variant?.id, line.variant?.sku, index);
      if (!match) {
        unmatchedLines++;
        continue;
      }
      if ("ambiguous" in match) {
        ambiguousSkuLines++;
        const sku = canonicalizeSku(line.variant?.sku);
        if (sku) ambiguousSkuKeys.add(sku);
        continue;
      }

      matchedLines++;
      if (match.method === "variant_id") matchedByVariantId++;
      else matchedBySku++;
      if (match.identity.skuAmbiguous) {
        matchedWithAmbiguousSkuLines++;
        matchedWithAmbiguousSkuUnits += line.quantity;
      }
      const current = mutable.get(match.identity.variantId);
      if (!current) {
        mutable.set(match.identity.variantId, {
          variant: match.identity,
          orderKeys: new Set([order.id]),
          unitsObserved: line.quantity,
          firstObservedAt: order.createdAt,
          lastObservedAt: order.createdAt,
        });
        continue;
      }
      current.orderKeys.add(order.id);
      current.unitsObserved += line.quantity;
      if (dateValue(order.createdAt) < dateValue(current.firstObservedAt)) current.firstObservedAt = order.createdAt;
      if (dateValue(order.createdAt) > dateValue(current.lastObservedAt)) current.lastObservedAt = order.createdAt;
    }
  }

  const aggregates = [...mutable.values()].map((current): OrderDemandAggregate => {
    const factor = decayFactor(current.lastObservedAt, asOf, halfLifeDays);
    return {
      variantId: current.variant.variantId,
      productId: current.variant.productId,
      skuCanonical: current.variant.skuCanonical,
      skuAmbiguous: current.variant.skuAmbiguous,
      demandClass: ORDER_DEMAND_CLASS,
      orderCount: current.orderKeys.size,
      unitsObserved: current.unitsObserved,
      firstObservedAt: current.firstObservedAt,
      lastObservedAt: current.lastObservedAt,
      halfLifeDays,
      decayFactor: factor,
      weightedUnits: current.unitsObserved * factor,
    };
  });

  return {
    aggregates,
    report: {
      orders: source.data.orders.edges.length,
      lines,
      ordersWithLines,
      matchedLines,
      matchedByVariantId,
      matchedBySku,
      matchedWithAmbiguousSkuLines,
      matchedWithAmbiguousSkuUnits,
      ambiguousSkuLines,
      unmatchedLines,
      unitsObserved,
      aggregateVariants: aggregates.length,
      ambiguousSkuKeys: ambiguousSkuKeys.size,
      demandClass: ORDER_DEMAND_CLASS,
    },
  };
}

/** Converts the canonical catalog object into the narrow order-join contract. */
export function identitiesFromCanonicalCatalog(catalog: {
  products: Array<{
    product_id: string;
    variants: Array<{
      variant_id: string;
      source_variant_id: string;
      sku_original: string | null;
      sku_canonical: string | null;
      sku_ambiguous: boolean;
    }>;
  }>;
}): CatalogVariantIdentity[] {
  return catalog.products.flatMap((product) =>
    product.variants.map((variant) => ({
      variantId: variant.variant_id,
      sourceVariantId: variant.source_variant_id,
      productId: product.product_id,
      skuOriginal: variant.sku_original,
      skuCanonical: variant.sku_canonical,
      skuAmbiguous: variant.sku_ambiguous,
    })),
  );
}
