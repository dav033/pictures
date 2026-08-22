# State — Regeneración RAG v2

**Updated:** 2026-08-21  
**Phase:** `01-rag-regeneration`  
**Status:** planned / implementation pending  
**Current wave:** 1

## Posición actual

La ingeniería inversa, auditoría de fuente, convenciones, pruebas y riesgos está documentada en `.planning/codebase/`. Los ocho planes ejecutables están creados, pero todavía no se implementó código ni se hizo commit.

## Bloqueos verificados

- Docker engine responde, pero el contexto auditado no tiene contenedor/imagen PostgreSQL/pgvector listo.
- `.env.local` está vacío; no hay `DATABASE_URL` ni `GEMINI_API_KEY` disponibles.
- El importador actual espera REST Shopify y no acepta directamente el contrato camelCase/GID del CDN.
- `order_data.json` no tiene consumidor y contiene `customer.id`; solo puede producir agregados sin PII.
- La taxonomía existente no cubre de forma segura todos los colores compuestos, acabados, formas y tamaños del snapshot.
- El benchmark existente es parcialmente aleatorio y no sirve como gate reproducible.

## Decisiones bloqueadas para ejecución

- Mantener Postgres + SQL propio; no LangChain/LlamaIndex.
- Usar exactamente las URLs fijadas en `PROJECT.md`, registrar hash y no mezclar snapshots.
- Política pública `ACTIVE` + precio positivo; stock/disponibilidad por variante.
- SKU repetido = `ambiguous`, nunca primer match.
- Órdenes = popularidad débil/decay, sin PII y sin autoridad comercial.
- Parser determinista-first; Gemini opcional y validado por Zod.
- Exact SKU, FTS y `pg_trgm` son baseline sin key; vector es opcional.
- Índices vectoriales solo tras `EXPLAIN (ANALYZE, BUFFERS)` y benchmark.

## Próxima acción

Ejecutar `01-01-PLAN.md` y continuar en orden estricto de `ROADMAP.md`. Si un plan falla, conservar logs y detener la ola; no marcarlo completo por existencia de archivos.

## Ledger de verificación

| Gate | Estado | Evidencia requerida |
| --- | --- | --- |
| Runtime/Next/build | NOT STARTED | compose config, health, build |
| Contratos/snapshots | AUDITADO; NO IMPLEMENTADO | Zod + manifest + hash |
| Schema/ingesta productos | NOT STARTED | staging, invariantes, diff de segunda corrida |
| Agregados órdenes | NOT STARTED | scan PII + idempotencia |
| Taxonomía/parser fallback | NOT STARTED | matriz 3/3 + cobertura |
| Retrieval/índices | NOT STARTED | benchmark + EXPLAIN |
| Benchmark fijo | NOT STARTED | 400+ casos + métricas |
| E2E/rollback | NOT STARTED | reporte completo + runbook |
