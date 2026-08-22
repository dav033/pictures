# Plan 03 — Summary

**Status:** complete  
**Date:** 2026-08-21  
**Scope:** canonical schema, CDN product canonicalization, staged publication and ingestion tests

## Implemented

- \`scripts/migrations/007_rag_regeneration_schema.sql\`: additive/idempotent source snapshots, product/variant staging, provenance columns, attribute states, canonical/original SKU fields, ambiguity flags and indexes. Staging constraints reject empty IDs, non-positive prices and non-COP variants.
- \`src/lib/rag/catalog/canonicalize.ts\`: validates the Plan 02 camelCase/GID contract, canonicalizes GIDs once, preserves raw source IDs/payloads, publishes only ACTIVE products with positive COP variants, keeps availability and inventory on the same variant, derives only deterministic taxonomy/explicit size codes, and creates price/stock-free search text plus a stable hash. Repeated canonical SKUs are marked \`sku_ambiguous\`; no first-match resolution is performed.
- \`src/lib/rag/catalog/persist-staged.ts\`: stages and publishes inside one transaction, records rejection audit rows per snapshot, guards against empty/partial source drops, preserves product IDs/embedding hashes on unchanged content, and cleans only the approved published set.
- \`scripts/import-cdn-catalog.ts\`: fetches and validates the products CDN source, emits an aggregate-only manifest with \`--manifest\`, supports \`--dry-run\`, \`--offline\`, \`--fixture\`, \`--allow-partial\` and configurable drop protection, then stages/publishes through the transactional writer.
- \`scripts/test-product-ingestion.ts\`: canonicalization invariants, DRAFT/zero-price/availability/size/image/SKU-collision cases, schema/constraint checks, empty-source rollback guard, orphan checks and two-run database idempotency checks (\`--canonicalize\`, \`--schema\`, \`--idempotency\`).

## Evidence

\`\`\`text
npx tsc --noEmit --pretty false --incremental false
  PASS

npx tsx scripts/test-product-ingestion.ts --canonicalize
  PASS — ACTIVE/DRAFT and zero-price policy, explicit R-12 size, source image,
  same-variant availability/inventory, null-safe derivation, ambiguous SKU,
  stable canonicalization

DATABASE_URL=local Docker Postgres
npx tsx scripts/migrate.ts
  PASS — 0 new migrations; all 7 migrations already applied

npx tsx scripts/test-product-ingestion.ts --schema
  PASS — migration 007 tables, provenance columns, staging price/non-empty-ID
  constraints, FK/orphan invariant and non-mutating schema verification

npx tsx scripts/test-product-ingestion.ts --idempotency
  PASS — identical product/variant content, snapshot counters and rejection
  audit counts on the second run; empty source rolls back without purging
\`\`\`

The live Docker database is currently populated by the fixture idempotency test (one publishable fixture product), so the next operational step is the approved \`scripts/import-cdn-catalog.ts --manifest\` run to regenerate it from the real CDN snapshot. No raw source body or order/customer data was persisted by this plan.

