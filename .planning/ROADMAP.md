# Roadmap — Regeneración RAG v2

**Phase:** `01-rag-regeneration`  
**Status:** planned  
**Ejecución:** ocho planes autónomos, sin checkpoints de permiso.

## Objetivo de fase

Publicar una búsqueda de catálogo respaldada por los dos snapshots suministrados, con filtros comerciales exactos, fallback sin Gemini, relevancia medible y rollback seguro.

## Olas y dependencias

```text
Wave 1  01-runtime-build
          |
Wave 2  02-contracts-fixtures
          |
Wave 3  03-schema-product-ingestion
          |
Wave 4  04-order-aggregates
          |
Wave 5  05-taxonomy-parser-fallback
          |
Wave 6  06-retrieval-indexes
          |
Wave 7  07-fixed-benchmark
          |
Wave 8  08-e2e-docs-rollback
```

Las olas se ejecutan secuencialmente por dependencia. Dentro de cada plan, las tareas son autónomas y pueden paralelizarse solo si no comparten archivos.

## Planes

| Plan | Wave | Dependencias | Resultado |
| --- | ---: | --- | --- |
| `01-01-PLAN.md` | 1 | — | Runtime Docker/Next/build y env seguro |
| `01-02-PLAN.md` | 2 | 01 | Contratos Zod, snapshots, hashes y fixtures sin PII |
| `01-03-PLAN.md` | 3 | 02 | Esquema canónico e ingesta idempotente de productos |
| `01-04-PLAN.md` | 4 | 03 | Agregados de órdenes con popularidad débil y sin PII |
| `01-05-PLAN.md` | 5 | 03 | Taxonomía versionada, parser determinista y fallback Gemini opcional |
| `01-06-PLAN.md` | 6 | 04, 05 | Retrieval exact/FTS/trigram/vector opcional con RRF |
| `01-07-PLAN.md` | 7 | 06 | Benchmark fijo de 400+ consultas y gates cuantitativos |
| `01-08-PLAN.md` | 8 | 01–07 | E2E, build final, runbook, flags y rollback |

## Gates de salida

1. Runtime: `docker compose config`, DB/pgvector health y build base sin secretos comprometidos.
2. Contratos: ambos snapshots se validan por URL fija/hash; desconocidos y ambiguos son explícitos.
3. Productos: política `ACTIVE`/precio positivo/stock, no huérfanos y segunda ingesta sin cambios.
4. Órdenes: 0 PII, agregados idempotentes y no se usan como precio/stock/filtro.
5. Parser: 100 % correcto y estable 3/3 en casos etiquetados; sin key funciona determinísticamente.
6. Retrieval: SKU no ambiguo Recall@1 >= 0,99, nombre Recall@5 >= 0,95, filtros precision@20=1,00, IDs inválidos=0.
7. Benchmark: retrieval p50 <=500 ms/p95 <=2.100 ms y negativas SKU 100 % sin resultado.
8. E2E: búsqueda → whitelist → selección → precio desde DB → cotización; build, rollback y stale-data documentados.

## Reglas de ejecución

- No importar directamente el CDN al tipo REST existente: usar adaptador explícito.
- No persistir órdenes crudas ni `customer.id` en tablas del RAG.
- No activar vector si falta `GEMINI_API_KEY`; reportar `SKIPPED_OPTIONAL` y probar exact/FTS/trigram.
- No agregar framework RAG externo; medir primero el stack SQL propio.
- No ejecutar `ORDER BY random()` en criterios de aceptación; todos los casos deben tener snapshot/hash y evidencia.
- Toda migración es aditiva/reversible y toda publicación usa staging.
