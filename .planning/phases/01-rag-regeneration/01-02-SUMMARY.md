# Plan 02 — Summary

**Status:** complete  
**Date:** 2026-08-21  
**Scope:** contracts, safe snapshot fetch/manifest, synthetic fixtures

## Implemented

- `src/lib/rag/sources/contracts.ts`: Zod contracts for the real camelCase/GID `products_catalog` array and GraphQL `order_data` envelope. Includes safe count summarization and a guard for identity keys in persistible output.
- `src/lib/rag/sources/fetch.ts`: exact source URLs, in-memory fetch, JSON parsing, timeout, bounded exponential retries for network/408/425/429/5xx, JSON content metadata, SHA-256 and aggregate-only manifest creation. Response bodies are never written.
- `scripts/validate-source-snapshots.ts`: supports `--offline`, `--fixtures [dir]`, repeated `--url`, and optional `--manifest path`. It emits only contract/count/status/hash metadata; validation errors contain schema paths, not source values.
- `eval/fixtures/`: synthetic product/order fixtures and `source-contracts.test.ts`. They contain no real product/order/line/customer identifiers and no downloaded payload.

## Evidence

Commands executed:

```text
npx tsx --test eval/fixtures/source-contracts.test.ts
  4 tests passed, 0 failed

npx tsx scripts/validate-source-snapshots.ts --offline --fixtures
  products: 2 products / 2 variants / 1 ACTIVE / 1 DRAFT / 1 non-positive price
  orders: 1 order / 1 line / 1 SKU
  PASS; raw bodies not persisted

npx tsx scripts/validate-source-snapshots.ts
  products_catalog: 3,297 products / 6,136 variants / 1,491 ACTIVE / 1,806 DRAFT / 278 non-positive prices
  order_data: 200 orders / 1,855 lines / 897 unique SKUs
  PASS; raw bodies not persisted

npx tsx scripts/validate-source-snapshots.ts --url <products URL> --url <orders URL>
  Same live counts and PASS

npx tsx scripts/validate-source-snapshots.ts --url
  Alias remoto-default; same live counts and PASS

targeted npx tsc --noEmit ... contracts.ts fetch.ts validate-source-snapshots.ts source-contracts.test.ts
  PASS
```

The full repository `npx tsc --noEmit --pretty false` still reports the pre-existing unrelated `src/app/page.tsx:1480` `TarjetaCotizacion` prop mismatch (`editable` not declared). No Plan 02 file is involved and no unrelated file was changed.

## Security/data guarantees

- No raw CDN snapshot, customer identity, order ID, line ID, product ID or variant ID was persisted.
- Manifests contain only URL/fixture label, status, content type, byte count, timestamp, SHA-256, contract version and aggregate counts.
- Fixtures use `fixture-*` identifiers and `customer: null`.
- No package, environment, Docker, or application runtime file was edited.
