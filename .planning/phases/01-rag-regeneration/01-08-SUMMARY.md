---
phase: 01-rag-regeneration
plan: 08
subsystem: e2e-operations
tags: [rag, e2e, rollback, release-manifest, no-key, pg-only]
requires: [01-01, 01-02, 01-03, 01-04, 01-05, 01-06, 01-07]
provides:
  - deterministic end-to-end RAG gate with exact SKU, filters, whitelist, DB pricing, budget and latency checks
  - PG-only identity-to-despiece-to-visual selection flow with package-unit evidence
  - executable regeneration and rollback runbooks without secrets or raw order data
  - READY RAG release metadata with source URLs, SHA-256, aggregate counts and explicit gate states
affects: [release, operations, 01-06]
tech-stack:
  added: []
  patterns:
    - deterministic SQL/parser path is the required no-key route
    - optional Gemini/vector capabilities are reported as SKIPPED_OPTIONAL
    - RAG selection and visual projection use the same validated PostgreSQL rows
    - unknown package units remain NULL; no package size is invented
key-files:
  created:
    - scripts/eval-e2e-rag-v2.ts
    - docs/operations/rag-regeneration-v2.md
    - docs/operations/rag-rollback-v2.md
    - .planning/phases/01-rag-regeneration/01-08-SUMMARY.md
    - scripts/migrations/010_variant_package_units.sql
  modified:
    - release-manifest.json
decisions:
  - "RAG is READY with local RAG_ENABLED=true; vector/Gemini remains SKIPPED_OPTIONAL without a key."
  - "Identity flows search → PG whitelist → PG despiece → PG validation → visual projection; the RAG path no longer depends on SQLite IDs or metadata."
  - "Migration 010 stores package-unit evidence in PG; 3518 variants are known and 74 remain NULL/unknown."
  - "Rollback disables RAG and reimports the exact approved source SHA; no independent promote(snapshot_id) is assumed."
metrics:
  duration: "implemented and verified on 2026-08-22"
  completed: 2026-08-22
  status: complete
  release_status: PASS
---

# Plan 08 — E2E, operaciones y rollback — PASS / complete

Se cerró la fase con el flujo RAG operativo y verificable de extremo a extremo. La identidad recuperada, el despiece, la validación comercial y la proyección visual usan PostgreSQL y conservan los mismos `product_id`/`variant_id`; SQLite queda fuera de la ruta RAG.

## Evidencia final

- PostgreSQL/pgvector en Docker: contenedor `postgres` healthy; `stack-check`, extensiones y migraciones PASS.
- Migraciones aplicadas: `10`, incluida `010_variant_package_units.sql`.
- Catálogo publicado: `1411` productos / `3592` variantes.
- Unidades por paquete en PG: `3518` conocidas, `74` desconocidas (`NULL`); los desconocidos no se convierten en `1`.
- Flags locales verificadas: `RAG_ENABLED=true`, `RAG_USE_VECTOR=false`, `RAG_USE_FULLTEXT=true`, `RAG_USE_TRIGRAM=true`.
- Snapshots y manifests fuente revisados sin PII; los SHA-256 no fueron modificados.

## E2E determinista y opcionales

- `npm run rag:e2e-v2` — PASS, todas las invariantes obligatorias; p95 final `123.7 ms`, `2` warmups excluidos y `20` muestras secuenciales; baseline `144.7 ms`, límite baseline+15% `166.4 ms`, límite absoluto `2100 ms`.
- `npx tsx --conditions=react-server scripts/eval-e2e-rag-v2.ts --with-gemini` sin key — PASS; Gemini/vector `SKIPPED_OPTIONAL`.
- Se validaron SKU original/canónico/conversacional/inexistente/ambiguo, whitelist, precio/subtotal desde PG, filtros same-variant, forma, diámetro, color, corazón, adversario `ESCARCHADA`, presupuesto y resolver PG no vacío.
- La proyección visual conserva IDs PG, precio, categoría, colores, descripción, imagen, tamaño/forma/diámetro y unidades; `paquetes` se aplica desde la selección validada.

## Corpus, benchmark y build

- Corpus fijo: `416` consultas; benchmark `repeat=2`.
- Benchmark final: p50 `25.1583 ms`, p95 `54.2580 ms`, NDCG@10 global `0.905466`, filter precision `1.0000`; todos los gates obligatorios PASS.
- `npx tsc --noEmit --pretty false --incremental false` — PASS.
- `npm run lint` — PASS.
- `npm run build` — PASS.
- HTTP smoke local: `/`, `/api/productos`, `/api/shopify/sync` y `/api/ia/salud` respondieron `200`.

## Runbooks y release

- `docs/operations/rag-regeneration-v2.md` documenta validación de fuentes, migración 010, reimportación staged, `ANALYZE` posterior, benchmark, flags locales y comandos PowerShell.
- `docs/operations/rag-rollback-v2.md` documenta contención con `RAG_ENABLED=false`, restauración o reimportación por SHA exacto, `ANALYZE`, verificación de unidades desconocidas y reactivación controlada.
- `release-manifest.json` queda `rag.status=READY`, `rag.enabled=true`, con gates obligatorios PASS, opcionales explícitos y rollback target por SHA exacto.
- No se escribieron customer IDs, order IDs, line-item IDs, cuerpos RAW, claves ni secretos.
