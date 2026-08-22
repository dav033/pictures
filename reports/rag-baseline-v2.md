# RAG baseline v2 — PASS

Generado: 2026-08-22T02:43:05.227Z  
Rama evaluada: determinista local + PostgreSQL; vector/Gemini: SKIPPED_OPTIONAL (no-key)  
Repeticiones: 2; latencia medida de forma secuencial para no distorsionar contención.

## Corpus y snapshot

- Consultas fijas: **416**; familias semánticas con dos métodos/adjudicación: **84**.
- `taxonomy_version`: `catalog-taxonomy-v2`
- `snapshot_id`: `products_catalog:13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`
- `snapshot_hash`: `13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`
- PostgreSQL: `16.15 (Debian 16.15-1.pgdg12+2)`; extensiones: pg_trgm@1.6, unaccent@1.1, vector@0.8.6.
- Publicado: published; productos: 1411; variantes: 3592.

## Gates cuantitativos

| Gate | Valor | Umbral | Estado | Detalle |
|---|---:|---:|---|---|
| sku_unique_recall@1 | 1.0000 | >= 0.99 | PASS |  |
| sku_unique_recall@5 | 1.0000 | = 1.00 | PASS |  |
| name_recall@5 | 1.0000 | >= 0.95 | PASS |  |
| ndcg@10_global | 0.9055 | >= 0.75 | PASS |  |
| ndcg@10_family_min | 0.7670 | >= 0.70 | PASS | {"sku":1,"name":0.9710533140056044,"semantic":0.7670086212282117,"color":0.9039240493201146,"shape_size":0.9782899855042032,"filter":0.8833894822477456,"budget":1} |
| filter_variant_precision | 1.0000 | = 1.00 | PASS |  |
| negative_not_found | 1.0000 | = 1.00 | PASS |  |
| error_rate | 0.0000 | < 0.01 | PASS |  |
| branch_error_rate | 0.0000 | < 0.01 | PASS |  |
| hard_filter_variant_leakage | 0.0000 | = 0 | PASS |  |
| invalid_result_ids | 0.0000 | = 0 | PASS |  |
| invalid_branch_statuses | 0.0000 | = 0 | PASS |  |
| latency_p50_ms | 35.6039 | <= 500 | PASS |  |
| latency_p95_ms | 87.6977 | <= 2100 | PASS |  |
| color_variant_attribute_coverage | 1.0000 | = 1.00 | PASS | 2716 variantes tienen color explícito; 594 expected usan fallback singleton inequívoco; ambos son evidencia de la misma variant_id |

El comando con `--gate` devuelve exit code **0**.

## Métricas por familia

| Familia | Casos por repetición | Hit@1 producto/no-match | NDCG@10 | p50 total |
|---|---:|---:|---:|---:|
| budget | 25 | 100.00% | 100.00% | 36.9 ms |
| color | 51 | 100.00% | 90.39% | 40.9 ms |
| filter | 51 | 100.00% | 88.34% | 45.9 ms |
| name | 51 | 100.00% | 97.11% | 36.6 ms |
| negative | 25 | 100.00% | 0.00% | 14.2 ms |
| semantic | 101 | 99.01% | 76.70% | 34.7 ms |
| shape_size | 51 | 100.00% | 97.83% | 61.4 ms |
| sku | 61 | 100.00% | 100.00% | 10.9 ms |

## Métricas completas

```json
{
  "corpus": 416,
  "runs": 832,
  "repeat": 2,
  "recall": {
    "sku_unique_at_1": 1,
    "sku_unique_at_5": 1,
    "global_at_1": 0.5125151528896542,
    "global_at_5": 0.665582294511728,
    "global_at_10": 0.7284612922724361,
    "variant_color_at_1": 0.12349363622276317,
    "variant_shape_at_1": 0.5000000000000002
  },
  "mrr_global": 0.9689675343128027,
  "ndcg_global": 0.9054664172097453,
  "ndcg_family": {
    "sku": 1,
    "name": 0.9710533140056044,
    "semantic": 0.7670086212282117,
    "color": 0.9039240493201146,
    "shape_size": 0.9782899855042032,
    "filter": 0.8833894822477456,
    "budget": 1
  },
  "filter_precision": 1,
  "error_rate": 0,
  "branch_error_rate": 0,
  "positive_empty_rate": 0,
  "latencies_ms": {
    "p50": 35.60389999999825,
    "p95": 87.69770000000062,
    "mean": 41.348072115384625,
    "parse_p50": 0.5649999999986903,
    "retrieval_p50": 35.04190000000017,
    "retrieval_p95": 86.96510000000126
  },
  "sku_status": {
    "expected_unique": 51,
    "expected_ambiguous": 10,
    "expected_not_found": 25,
    "observed": {
      "unique": 51,
      "ambiguous": 10,
      "not_found": 25
    }
  },
  "name_misses": [],
  "parser_constraint_misses": {
    "total": 0,
    "by_family": {}
  },
  "invalid_result_ids": 0,
  "invalid_branch_statuses": 0,
  "invariant_violations": 0,
  "unknown_color_checks": 488,
  "parser_stability": "deterministic_local"
}
```

## Branches y restricciones

- Se validaron estados de rama contra `READY | EMPTY | SKIPPED_OPTIONAL | ERROR`.
- IDs fuera del snapshot y violaciones de restricciones precio/disponibilidad/facetas se contabilizan, no se descartan.
- La cobertura de color exige evidencia de la misma `variant_id`: `v.derived_colors` explícito o fallback sólo si `p.derived.colors` es singleton; un producto multicolor nunca hereda color a un sibling.
- Los filtros de inventario no reinterpretan `available`; el inventario queda como evidencia/anomalía.
- La fuga de hard filters se calcula sólo contra predicados efectivamente producidos por el parser y aplicados por retrieval; los atributos de verdad no soportados por el parser se reportan aparte como `parser_constraint_misses` ({"total":0,"by_family":{}}). Las facetas de categoría/ocasión provienen de `catalog_products.derived` y disponibilidad de producto/variante se comprueba sobre ambas filas.

## EXPLAIN resumido

- fts: Limit -> Sort -> Bitmap Heap Scan -> Bitmap Index Scan/ix_catalog_products_tsv
- trigram: Limit -> Sort -> Bitmap Heap Scan -> Bitmap Index Scan/ix_catalog_products_title_trgm_v2
- same_variant_filter: Result

## Fallos detallados (máximo 30)

- Ningún error o violación registrada.

## Fallos de búsqueda por nombre (Recall@5)

Se listan los casos cuyo producto esperado no aparece en las primeras cinco posiciones. No se regeneraron labels ni se omitieron misses; el rango es el primero observado fuera de top-5 o `null` si no aparece.

- Ningún miss de name.

## Reproducción

```powershell
$env:DATABASE_URL="postgresql://rag:rag_local_only_change_me@127.0.0.1:5432/rag"
npx tsx scripts/eval-rag-v2.ts --validate-corpus
npx tsx scripts/bench-rag-v2.ts --no-key --repeat 2
npx tsx scripts/eval-rag-v2.ts --gate
```
