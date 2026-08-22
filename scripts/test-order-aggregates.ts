import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import {
  aggregateOrderData,
  ORDER_DEMAND_CLASS,
  type CatalogVariantIdentity,
  type OrderAggregateBatch,
} from "../src/lib/rag/orders/aggregate";
import { persistOrderDemandInTransaction } from "../src/lib/rag/orders/persist";
import { OrderDataSourceSchema, type OrderDataSource } from "../src/lib/rag/sources/contracts";
import type { SourceManifest } from "../src/lib/rag/sources/fetch";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

function syntheticCatalog(): CatalogVariantIdentity[] {
  const rows = Array.from({ length: 905 }, (_, index) => {
    const skuNumber = (index % 897) + 1;
    return {
      variantId: `variant-${index + 1}`,
      sourceVariantId: `source-variant-${index + 1}`,
      productId: `product-${(index % 120) + 1}`,
      skuOriginal: `SKU-${skuNumber}`,
      skuCanonical: `SKU-${skuNumber}`,
      skuAmbiguous: false,
    };
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.skuCanonical ?? "", (counts.get(row.skuCanonical ?? "") ?? 0) + 1);
  return rows.map((row) => ({ ...row, skuAmbiguous: (counts.get(row.skuCanonical ?? "") ?? 0) > 1 }));
}

function syntheticSource(): OrderDataSource {
  let lineNumber = 0;
  const orders = Array.from({ length: 200 }, (_, orderIndex) => {
    const lineCount = orderIndex < 175 ? 10 : orderIndex < 196 ? 5 : 0;
    const edges = Array.from({ length: lineCount }, () => {
      const current = lineNumber++;
      const ambiguousFallback = current < 5;
      const skuNumber = ambiguousFallback ? 1 : (current % 897) + 1;
      return {
        node: {
          id: `line-${current + 1}`,
          title: "TEST ITEM",
          quantity: (current % 4) + 1,
          variant: {
            id: ambiguousFallback ? `unknown-variant-${current + 1}` : `source-variant-${(current % 897) + 1}`,
            sku: `SKU-${skuNumber}`,
          },
        },
      };
    });
    return {
      id: `order-${orderIndex + 1}`,
      name: `TEST-${String(orderIndex + 1).padStart(3, "0")}`,
      createdAt: `2026-01-${String((orderIndex % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      displayFinancialStatus: "PENDING",
      displayFulfillmentStatus: "UNFULFILLED",
      totalPriceSet: { shopMoney: { amount: "0", currencyCode: "COP" } },
      lineItems: { edges },
    };
  });

  return OrderDataSourceSchema.parse({ data: { orders: { edges: orders.map((node) => ({ node })) } } });
}

function syntheticManifest(): SourceManifest {
  return {
    kind: "order_data",
    url: "fixture://order-aggregate-test-v1",
    fetched_at: "2026-01-28T00:00:00.000Z",
    status: 200,
    content_type: "application/json",
    bytes: 0,
    sha256: createHash("sha256").update("order-aggregate-test-v1").digest("hex"),
    counts: { orders: 200, lineItems: 1855, uniqueOrderSkus: 897 },
    contract_version: "cdn-graphql-v1",
  };
}

function checkPureBatch(source: OrderDataSource, batch: OrderAggregateBatch): void {
  assert.equal(batch.report.orders, 200);
  assert.equal(batch.report.lines, 1855);
  assert.equal(batch.report.matchedLines, 1850);
  assert.ok(batch.report.matchedWithAmbiguousSkuLines > 0);
  assert.ok(batch.report.matchedWithAmbiguousSkuUnits > 0);
  assert.equal(batch.report.ambiguousSkuLines, 5);
  assert.equal(batch.report.ambiguousSkuKeys, 1);
  assert.equal(batch.report.unmatchedLines, 0);
  assert.equal(batch.report.demandClass, ORDER_DEMAND_CLASS);
  assert.equal(source.data.orders.edges.filter((edge) => edge.node.displayFinancialStatus === "PENDING").length, 200);
  assert.ok(batch.aggregates.length > 0);
  assert.ok(batch.aggregates.every((row) => row.demandClass === ORDER_DEMAND_CLASS));
  assert.ok(batch.aggregates.every((row) => !Object.keys(row).some((key) => /price|stock|inventory/i.test(key))));
  assert.doesNotMatch(JSON.stringify(batch), /customer|gid:\/\/shopify\/(?:Order|Customer|LineItem)/i);
}

async function schemaCheck(client: PoolClient): Promise<void> {
  const columns = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rag_order_demand_aggregates'`,
  );
  assert.ok(columns.rows.length > 0, "008 table must exist");
  const forbidden = columns.rows.map((row) => row.column_name).filter((column) => /customer|order_id|line_item|raw_payload|source_payload|price|stock|inventory/i.test(column));
  assert.deepEqual(forbidden, [], `order aggregate schema contains forbidden columns: ${forbidden.join(", ")}`);
  const constraint = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = 'rag_order_demand_aggregates'::regclass
        AND pg_get_constraintdef(oid) LIKE '%observed_demand%'`,
  );
  assert.ok(constraint.rows.length > 0, "demand_class must be constrained to observed_demand");
}

async function catalogSignature(client: PoolClient): Promise<string> {
  const result = await client.query(
    `SELECT COUNT(*)::text AS rows,
            COALESCE(SUM(price), 0)::text AS prices,
            COALESCE(SUM(inventory_quantity), 0)::text AS inventory,
            COALESCE(SUM(CASE WHEN available THEN 1 ELSE 0 END), 0)::text AS available
       FROM catalog_variants`,
  );
  return JSON.stringify(result.rows[0]);
}

async function databaseCheck(batch: OrderAggregateBatch, manifest: SourceManifest): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the idempotence/database gate");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const snapshotId = `order_data:${manifest.sha256}`;
  try {
    await client.query("BEGIN");
    await schemaCheck(client);
    const beforeCatalog = await catalogSignature(client);
    const first = await persistOrderDemandInTransaction(client, batch, { sourceSnapshotId: snapshotId, manifest });
    const second = await persistOrderDemandInTransaction(client, batch, { sourceSnapshotId: snapshotId, manifest });
    const reducedBatch: OrderAggregateBatch = {
      ...batch,
      aggregates: batch.aggregates.slice(0, -3),
      report: { ...batch.report, aggregateVariants: batch.aggregates.length - 3 },
    };
    const replacement = await persistOrderDemandInTransaction(client, reducedBatch, { sourceSnapshotId: snapshotId, manifest });
    const rows = await client.query<{ rows: string; units: string; duplicate_keys: string }>(
      `SELECT COUNT(*)::text AS rows,
              COALESCE(SUM(units_observed), 0)::text AS units,
              COUNT(DISTINCT source_snapshot_id || ':' || variant_id)::text AS duplicate_keys
         FROM rag_order_demand_aggregates
        WHERE source_snapshot_id = $1`,
      [snapshotId],
    );
    const afterCatalog = await catalogSignature(client);
    const expectedUnits = reducedBatch.aggregates.reduce((sum, row) => sum + row.unitsObserved, 0);
    assert.equal(first.insertedRows, batch.aggregates.length);
    assert.equal(second.insertedRows, 0);
    assert.equal(second.existingRows, batch.aggregates.length);
    assert.equal(second.idempotent, true);
    assert.equal(replacement.staleRowsDeleted, 3);
    assert.equal(replacement.insertedRows, 0);
    assert.equal(Number(rows.rows[0]?.rows), reducedBatch.aggregates.length);
    assert.equal(Number(rows.rows[0]?.units), expectedUnits);
    assert.equal(Number(rows.rows[0]?.duplicate_keys), reducedBatch.aggregates.length);
    assert.equal(afterCatalog, beforeCatalog, "order aggregate persistence must not modify price/stock fields");
    await client.query("ROLLBACK");
    console.log(`[PASS] schema/PII/idempotence: ${batch.report.lines} lines, ${batch.aggregates.length} aggregate rows, 0 duplicate rows`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const source = syntheticSource();
  const identities = syntheticCatalog();
  const batch = aggregateOrderData(source, identities);
  const replay = aggregateOrderData(source, identities);
  assert.deepEqual(replay, batch, "same input snapshot must produce the same decay values");
  checkPureBatch(source, batch);
  const manifest = syntheticManifest();
  if (process.argv.includes("--schema")) {
    await databaseCheck(batch, manifest);
    console.log("[PASS] --schema");
    return;
  }
  await databaseCheck(batch, manifest);
  console.log(`[PASS] order aggregate tests: ${batch.report.orders} orders/${batch.report.lines} lines; class=${batch.report.demandClass}`);
}

main().catch((error) => {
  console.error(`[FAIL] order aggregate tests: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
