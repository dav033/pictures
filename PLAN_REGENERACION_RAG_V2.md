# Plan maestro — Regeneración RAG v2

**Estado:** listo para ejecución autónoma  
**Fecha:** 2026-08-21  
**Fase:** `01-rag-regeneration`  
**Planes:** 8, en `.planning/phases/01-rag-regeneration/`

## Resultado buscado

Un RAG de catálogo en PostgreSQL que responda con precisión a SKU/nombre/color/acabado/patrón/ocasión/forma/tamaño/precio/stock, sin que el LLM pueda inventar un producto o precio. La búsqueda debe arrancar sin `GEMINI_API_KEY` mediante parser determinista, full-text y `pg_trgm`; Gemini/pgvector se habilitan como mejoras verificadas.

## Fuentes exactas

- Productos/variantes: `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json?v=1779763986`
- Órdenes/demanda débil: `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/order_data.json?v=1779763985de`

Los snapshots se deben fijar por status, bytes, timestamp y SHA-256. La segunda URL contiene PII potencial (`customer.id`) y órdenes truncadas a 10 líneas en 175/200 órdenes; no se guarda cruda en RAG.

## Diagnóstico que motiva la regeneración

El código actual consume `www.sempertex.com/products.json` como catálogo, usa el primer JSON solo como inventario y no consume órdenes. El CDN tiene un contrato distinto: camelCase, GID, `status`, `availableForSale`, `images[].url`, sin `option1`/`body_html`. El snapshot contiene 3.297 productos, 6.136 variantes, 1.491 `ACTIVE`, 1.806 `DRAFT`, 278 precios no positivos y 66 claves SKU duplicadas. La taxonomía actual no cubre de forma segura colores compuestos, acabados, patrones y formas derivadas desde tags. El benchmark actual usa muestreo aleatorio y no ofrece un gate reproducible.

## Arquitectura objetivo

```text
URLs fijadas
  -> fetch + metadata + SHA-256 + Zod
  -> staging source snapshots (sin PII de órdenes)
  -> canonical products/variants + taxonomy states
  -> ACTIVE + precio positivo + disponibilidad de misma variante
  -> search_text/hash -> embeddings opcionales
  -> exact SKU | FTS | pg_trgm | vector opcional
  -> RRF + popularity tie-break débil
  -> variant whitelist
  -> selection validation + precio/subtotal desde DB
```

`DRAFT`, precio `<=0`, SKU ambiguo y atributos no verificables no pasan como match exacto. Disponibilidad e inventario permanecen separados. Las órdenes solo aportan `order_count`, `units_observed` y decaimiento por producto/variante, sin filtros ni autoridad de precio.

## Olas

1. Runtime/build reproducible.
2. Contratos y fixtures de las dos fuentes.
3. Schema canónico e ingesta staged/idempotente de productos.
4. Agregados de órdenes sin PII.
5. Taxonomía versionada + parser determinista-first + Gemini opcional.
6. Retrieval exact/FTS/trigram/vector opcional/RRF e índices medidos.
7. Benchmark fijo de 400+ consultas.
8. E2E, build final, documentación y rollback.

## Criterios cuantitativos de aceptación

- Datos: 100 % IDs/handles/variantes válidos y únicos donde corresponde; 0 FK huérfanas; 0 candidatos públicos `DRAFT`, precio no positivo o sin disponibilidad válida; 0 PII en tablas/prompts/logs RAG.
- Ambigüedad: 66 claves SKU repetidas del snapshot quedan etiquetadas; ningún SKU ambiguo se resuelve como único; SKU no ambiguo Recall@1 >= 0,99 y Recall@5 = 1,00.
- Relevancia: nombre Recall@5 >= 0,95, NDCG@10 semántico >=0,75 global y >=0,70 por familia; filtros duros precision@20=1,00; IDs inválidos=0; SKU inexistente=100 % sin resultado.
- Parser: 100 % de campos etiquetados correctos y estables en 3 repeticiones; sin key no hay error, solo rama vectorial `SKIPPED_OPTIONAL`.
- Integridad comercial: 100 % de precios/stock/forma/tamaño mostrados pertenecen a la misma variante whitelist y precio resuelto de DB con diferencia 0,00 COP.
- Rendimiento: retrieval p50 <=500 ms y p95 <=2.100 ms sobre corpus congelado; E2E p95 <=1,15× baseline comparable; error/timeout <1 % en 100 consultas.
- Repetibilidad: segunda importación idéntica = cero cambios de contenido, cero popularidad duplicada y cero re-embeddings innecesarios.

## Reglas operativas

No se solicita permiso durante la ejecución. No se implementa un framework RAG externo. Se preservan cambios existentes, no se usan comandos destructivos y se detiene la promoción ante cualquier P0. Las migraciones son aditivas/reversibles y las publicaciones se hacen desde staging.

## Handoff

El ejecutor debe comenzar por `.planning/phases/01-rag-regeneration/01-01-PLAN.md`, continuar siguiendo `ROADMAP.md`, actualizar `STATE.md` solo con evidencia y entregar al final logs, hashes, métricas, configuración, resultado opcional de Gemini y runbook de rollback.
