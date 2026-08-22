---
phase: 01-rag-regeneration
plan: 07
subsystem: rag-evaluation
tags: [rag, corpus, ground-truth, benchmark, same-variant, no-key]
requires: [01-06]
provides:
  - fixed 416-query corpus and DB-backed ground truth for the final published snapshot
  - deterministic no-key evaluator with correctness, filter, branch, error, and latency gates
  - reproducible baseline report for promotion decisions
affects: [01-08, release]
tech-stack:
  added: []
  patterns:
    - expected sets are complete over commercial availability and final same-variant policy
    - color evidence is explicit variant color or singleton product fallback only
    - optional vector/Gemini remains SKIPPED_OPTIONAL in no-key baseline
---

# Plan 07 — Corpus, ground truth y benchmark final

Se regeneró el ground truth contra la reimportación final de Plan06 y se ejecutó el benchmark completo sobre PostgreSQL real. El corpus conserva 416 consultas fijas, sin IDs/handles en texto ni PII.

## Snapshot y corpus

- `snapshot_id`: `products_catalog:13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`
- `snapshot_hash`: `13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`
- Publicado: `1411` productos / `3592` variantes.
- `taxonomy_version`: `catalog-taxonomy-v2`.
- Familias: SKU 61, name 51, semantic 101, color 51, shape_size 51, filter 51, budget 25, negative 25.
- Reimport final: `derived_colors` explícito en `2716/3592` variantes; el resto sólo usa fallback si el producto tiene exactamente un color.
- Ground truth actualizado: 131 casos; filter/color/semantic incluyen variantes disponibles que cumplen color explícito de la misma variante o fallback singleton inequívoco. Shape mantiene expected del mismo producto y sus atributos físicos.

## Verificación final

- `npx tsc --noEmit --pretty false --incremental false` — PASS.
- `npx tsx scripts/eval-rag-v2.ts --validate-corpus` — PASS, 416 casos y 84 desacuerdos semánticos documentados.
- `npx tsx scripts/bench-rag-v2.ts --no-key --repeat 2` — PASS, 832 ejecuciones.
- `npx tsx scripts/eval-rag-v2.ts --gate` — exit code 0.

## Métricas finales

- SKU unique Recall@1/@5: `1.0000 / 1.0000`.
- Name Recall@5: `1.0000`; misses: `0`.
- NDCG@10 global: `0.9055`; mínimo familiar: `0.7670` (semantic).
- Filter variant precision: `1.0000`.
- Hard-filter variant leakage: `0`.
- Negative not-found: `1.0000`.
- Error rate / branch error rate: `0 / 0`.
- IDs inválidos / branch statuses inválidos: `0 / 0`.
- Latencia total (repeat=2): p50 `35.6039 ms`, p95 `87.6977 ms`.
- Cobertura de evidencia de color: `1.0000`; 594 expected usan fallback singleton válido.

## Decisiones y límites

- No se bajaron thresholds ni se modificó retrieval para aprobar el gate.
- No se modificó `STATE` ni se hicieron commits.
- Vector/Gemini queda `SKIPPED_OPTIONAL` en este baseline no-key; FTS/trigram y filtros duros se ejercitaron contra la DB real.

Artefacto: `reports/rag-baseline-v2.md`.
