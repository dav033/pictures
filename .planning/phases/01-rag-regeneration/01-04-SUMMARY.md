# Plan 04 — Summary

**Status:** complete  
**Date:** 2026-08-21  
**Scope:** order demand aggregates, privacy boundary, deterministic decay and replay-safe persistence

## Implemented

- `scripts/migrations/008_order_demand_aggregate.sql`: additive/idempotent aggregate table keyed by `source_snapshot_id + variant_id`, with only catalog identity, observed units/order count, timestamps, decay and the constrained `observed_demand` label. It has no customer, order, line-item, raw payload, price, stock or inventory columns.
- `src/lib/rag/orders/aggregate.ts`: validates the already-parsed GraphQL order contract, matches exact source/canonical variant IDs first, falls back to a unique SKU only, rejects ambiguous SKU fallback without choosing a row, counts exact-ID matches that still carry an ambiguous SKU, and calculates deterministic half-life weighting from the snapshot's latest order date.
- `src/lib/rag/orders/persist.ts`: writes aggregate-only rows in a transaction, records safe source provenance, upserts the same snapshot without increasing units, and treats a replay as a complete replacement by deleting stale variant rows from that snapshot.
- `scripts/import-order-aggregates.ts`: fetches the fixed order URL in memory, supports `--dry-run`, `--offline`, fixtures and safe manifests, uses the published `catalog_variants` whitelist for persistence, and uses remote canonicalization only for dry-runs.
- `scripts/test-order-aggregates.ts`: synthetic contract-realistic gate with exactly 200 orders/1,855 lines, ambiguous SKU fallback, exact-ID ambiguity reporting, schema privacy checks, deterministic replay, stale-row replacement, and catalog price/stock signature preservation.

## Evidence

```text
npx tsx --env-file=.env.example scripts/migrate.ts
  PASS — migration 008 applied; repeated migration runs report 0 new / 8 already applied

npx tsx --env-file=.env.example scripts/test-order-aggregates.ts
  PASS — 200 orders / 1,855 lines / 897 aggregate rows / 0 duplicate rows
  PASS — demand class observed_demand; second identical run adds 0 rows
  PASS — reduced replacement deletes 3 stale rows without accumulating units
  PASS — catalog price/stock signature unchanged

npx tsx --env-file=.env.example scripts/test-order-aggregates.ts --schema
  PASS — aggregate table, observed_demand constraint, no forbidden PII/price/stock

npx tsx scripts/import-order-aggregates.ts --dry-run
  PASS — live order snapshot: 200 orders / 1,855 lines / 24,006 units
  1,785 matched; 11 ambiguous-SKU fallback lines; 25 exact-ID lines with
  ambiguous SKUs; 59 unmatched under the published ACTIVE/positive-price view;
  869 aggregate variants

npx tsc --noEmit --pretty false --incremental false
  PASS

npx eslint src/lib/rag/orders/aggregate.ts src/lib/rag/orders/persist.ts \
  scripts/import-order-aggregates.ts scripts/test-order-aggregates.ts
  PASS — 0 errors / 0 warnings on Plan 04 files

git diff --check
  PASS — only line-ending normalization warnings from unrelated parallel files
```

The root agent additionally verified the real persistence path twice against the Docker database: the second run produced `0 new / 869 existing`, `23,853` matched units and `0` forbidden PII columns. Raw order/customer/line payloads are never passed to the persistence layer, manifest, logs, prompt or embedding path.

## Decisions and safety guarantees

- `PENDING` and `UNFULFILLED` are not interpreted as paid sales or stock. Every aggregate is explicitly `observed_demand`.
- Exact variant IDs are authoritative even when their SKU is duplicated; the report still exposes those ambiguous-SKU lines/units so downstream retrieval can avoid SKU filtering.
- SKU fallback requires exactly one catalog candidate. Ambiguous keys never select the first row.
- Live persistence reads the published catalog whitelist from PostgreSQL. A remote canonical catalog is allowed only for dry-run inspection, preventing source-version drift during publication.
- Replaying the same snapshot is deterministic: decay uses the snapshot's latest order date, and stale variants are removed before the batch is upserted.

## Risks carried forward

- The live order snapshot contains 59 lines that do not map into the currently published ACTIVE/positive-price catalog view; they remain counted in the manifest but produce no aggregate and require catalog publication reconciliation in the product-ingestion plan.
- The source audit's apparent truncation (many orders with ten lines) means demand is a weak ranking signal, not commercial truth, a hard filter, or a price/stock source.

No commits were created per the parallel-editing instruction. Files changed by this plan are limited to the five plan artifacts plus this summary; unrelated working-tree changes were left untouched.
