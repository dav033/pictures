import type { Pool, PoolClient } from "pg";
import type { SourceManifest } from "../sources/fetch";
import { ORDER_DEMAND_CLASS, type OrderAggregateBatch, type OrderDemandAggregate } from "./aggregate";

const FORBIDDEN_KEYS = /^(customer|order_id|line_item|raw_payload|source_payload|price|stock|inventory)/i;

export type PersistOrderOptions = {
  sourceSnapshotId: string;
  manifest: SourceManifest;
};

export type PersistOrderResult = {
  snapshotId: string;
  aggregateRows: number;
  insertedRows: number;
  existingRows: number;
  staleRowsDeleted: number;
  unitsObserved: number;
  idempotent: boolean;
};

function assertSafeObject(value: unknown, path = "root"): void {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) assertSafeObject(child, `${path}[${index}]`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new Error(`unsafe order aggregate field at ${path}.${key}`);
    assertSafeObject(child, `${path}.${key}`);
  }
}

function assertAggregateSafe(row: OrderDemandAggregate): void {
  if (row.demandClass !== ORDER_DEMAND_CLASS) throw new Error("order aggregate must be observed_demand");
  assertSafeObject(row);
}

function safeManifest(manifest: SourceManifest): Record<string, unknown> {
  if (manifest.kind !== "order_data") throw new Error("order demand requires an order_data manifest");
  const value = {
    kind: manifest.kind,
    url: manifest.url,
    fetched_at: manifest.fetched_at,
    status: manifest.status,
    content_type: manifest.content_type,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    counts: manifest.counts,
    contract_version: manifest.contract_version,
  };
  assertSafeObject(value);
  return value;
}

async function persistWithClient(
  client: PoolClient,
  batch: OrderAggregateBatch,
  options: PersistOrderOptions,
): Promise<PersistOrderResult> {
  const manifest = safeManifest(options.manifest);
  if (options.sourceSnapshotId.trim() === "") throw new Error("sourceSnapshotId is required");
  for (const row of batch.aggregates) assertAggregateSafe(row);

  const existing = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM rag_order_demand_aggregates WHERE source_snapshot_id = $1",
    [options.sourceSnapshotId],
  );
  const existingBeforeReplace = Number(existing.rows[0]?.count ?? 0);
  const incomingVariantIds = batch.aggregates.map((row) => row.variantId);
  const stale = incomingVariantIds.length
    ? await client.query(
        `DELETE FROM rag_order_demand_aggregates
          WHERE source_snapshot_id = $1
            AND NOT (variant_id = ANY($2::text[]))`,
        [options.sourceSnapshotId, incomingVariantIds],
      )
    : await client.query("DELETE FROM rag_order_demand_aggregates WHERE source_snapshot_id = $1", [options.sourceSnapshotId]);
  const current = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM rag_order_demand_aggregates WHERE source_snapshot_id = $1",
    [options.sourceSnapshotId],
  );
  const existingRows = Number(current.rows[0]?.count ?? 0);

  await client.query(
    `INSERT INTO rag_source_snapshots (
       source_snapshot_id, source_kind, source_url, source_sha256, fetched_at,
       status, manifest, published_products, published_variants, rejected_records,
       published_at
     ) VALUES ($1, 'order_data', $2, $3, $4, 'published', $5::jsonb, 0, $6, $7, NOW())
     ON CONFLICT (source_kind, source_sha256) DO UPDATE SET
       source_snapshot_id = EXCLUDED.source_snapshot_id,
       source_url = EXCLUDED.source_url,
       fetched_at = EXCLUDED.fetched_at,
       status = 'published',
       manifest = EXCLUDED.manifest,
       published_products = 0,
       published_variants = EXCLUDED.published_variants,
       rejected_records = EXCLUDED.rejected_records,
       published_at = NOW()`,
    [
      options.sourceSnapshotId,
      options.manifest.url,
      options.manifest.sha256,
      options.manifest.fetched_at,
      JSON.stringify(manifest),
      batch.aggregates.length,
      batch.report.unmatchedLines + batch.report.ambiguousSkuLines,
    ],
  );

  for (const row of batch.aggregates) {
    await client.query(
      `INSERT INTO rag_order_demand_aggregates (
         source_snapshot_id, source_url, source_sha256, variant_id, product_id,
         sku_canonical, sku_ambiguous, demand_class, order_count, units_observed,
         first_observed_at, last_observed_at, half_life_days, decay_factor,
         weighted_units, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
       ON CONFLICT (source_snapshot_id, variant_id) DO UPDATE SET
         source_url = EXCLUDED.source_url,
         source_sha256 = EXCLUDED.source_sha256,
         product_id = EXCLUDED.product_id,
         sku_canonical = EXCLUDED.sku_canonical,
         sku_ambiguous = EXCLUDED.sku_ambiguous,
         demand_class = EXCLUDED.demand_class,
         order_count = EXCLUDED.order_count,
         units_observed = EXCLUDED.units_observed,
         first_observed_at = EXCLUDED.first_observed_at,
         last_observed_at = EXCLUDED.last_observed_at,
         half_life_days = EXCLUDED.half_life_days,
         decay_factor = EXCLUDED.decay_factor,
         weighted_units = EXCLUDED.weighted_units,
         updated_at = NOW()`,
      [
        options.sourceSnapshotId,
        options.manifest.url,
        options.manifest.sha256,
        row.variantId,
        row.productId,
        row.skuCanonical,
        row.skuAmbiguous,
        row.demandClass,
        row.orderCount,
        row.unitsObserved,
        row.firstObservedAt,
        row.lastObservedAt,
        row.halfLifeDays,
        row.decayFactor,
        row.weightedUnits,
      ],
    );
  }

  return {
    snapshotId: options.sourceSnapshotId,
    aggregateRows: batch.aggregates.length,
    insertedRows: Math.max(0, batch.aggregates.length - existingRows),
    existingRows,
    staleRowsDeleted: Number(stale.rowCount ?? 0),
    unitsObserved: batch.report.unitsObserved,
    idempotent: existingBeforeReplace === batch.aggregates.length && stale.rowCount === 0,
  };
}

/** Persists a complete batch in one transaction and never increments on replay. */
export async function persistOrderDemand(
  pool: Pool,
  batch: OrderAggregateBatch,
  options: PersistOrderOptions,
): Promise<PersistOrderResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await persistOrderDemandInTransaction(client, batch, options);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Exported for rollback-safe integration tests that own the transaction. */
export async function persistOrderDemandInTransaction(
  client: PoolClient,
  batch: OrderAggregateBatch,
  options: PersistOrderOptions,
): Promise<PersistOrderResult> {
  return persistWithClient(client, batch, options);
}
