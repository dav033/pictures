# Project: Regeneración RAG v2

**Project ID:** `rag-regeneration-v2`  
**Created:** 2026-08-21  
**Status:** planned; implementación pendiente  
**Phase:** `01-rag-regeneration`

## Objetivo

Reconstruir un RAG de catálogo reproducible, seguro y medible para búsquedas de SKU, nombre, color, acabado, patrón, ocasión, forma, tamaño, precio y stock. Las restricciones comerciales se resuelven de forma determinista en PostgreSQL; Gemini/vector son mejoras opcionales y nunca autoridad de precio, inventario o IDs.

Fuentes versionadas de esta regeneración:

- `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json?v=1779763986`
- `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/order_data.json?v=1779763985de`

El primer snapshot se trata como catálogo/variantes/inventario y el segundo como señal agregada de demanda. No se almacenan órdenes ni PII en prompts, embeddings o logs de búsqueda.

## Evidencia de partida

- El código actual usa `www.sempertex.com/products.json` como catálogo y el primer JSON como inventario cruzado; `order_data.json` no tiene consumidor.
- El primer snapshot auditado contiene 3.297 productos, 6.136 variantes, 1.491 `ACTIVE`, 1.806 `DRAFT`, 278 variantes con precio `<=0`, 161 productos con todas las variantes no positivas, 40 productos sin imágenes, 5.923 SKUs únicos y 66 claves SKU repetidas.
- El segundo contiene 200 órdenes, 1.855 líneas, 897 SKUs distintos, 198 estados financieros `PENDING`, 2 `PAID`, todo `UNFULFILLED`; 175 órdenes tienen exactamente 10 líneas y no hay `pageInfo`.
- 64 líneas de órdenes (510 unidades) usan una clave SKU duplicada.
- Docker responde, pero el contexto auditado no tenía contenedores/imágenes disponibles; no se puede afirmar E2E hasta restaurar el runtime.

## Invariantes no negociables

1. Vista pública: solo productos `ACTIVE` y variantes con precio numérico positivo en COP; disponibilidad e inventario se mantienen separados y se evalúan a nivel de la misma variante.
2. `DRAFT`, precio cero/negativo, SKU ambiguo y tamaño/forma no verificable no se convierten silenciosamente en candidatos exactos.
3. IDs GID/números se canonicalizan una sola vez y conservan el valor original en auditoría.
4. Un SKU único puede resolverse exacto; un SKU repetido devuelve conjunto ambiguo o pide aclaración.
5. Precio, stock, imagen, SKU, variante e IDs de selección se leen de PostgreSQL; el LLM no los inventa.
6. Órdenes generan únicamente popularidad agregada, débil y con decaimiento; nunca precio, stock, filtros duros ni datos de cliente.
7. Color, acabado, patrón, ocasión, categoría, forma y tamaño tienen estados `known`, `unknown` o `ambiguous`, con cobertura medida.
8. Sin `GEMINI_API_KEY`, exact SKU + FTS + `pg_trgm` siguen funcionando; vector se omite como capacidad opcional.
9. La ingestión es staged, transaccional e idempotente; un fetch vacío/parcial no purga el catálogo publicado.
10. Se conserva el stack SQL propio; no se añade LangChain/LlamaIndex sin evidencia de mejora frente al control determinista de variantes.

## Alcance

Incluye runtime Docker/entorno, adaptadores Zod y fixtures, esquema canónico, ingestión staged de productos, agregados de órdenes sin PII, taxonomía versionada, parser determinista-first, retrieval exact/FTS/trigram/vector opcional, benchmark fijo, E2E, build y rollback. No incluye LoRA, creación de cuentas/secretos ni rediseño de UI.

## Definition of Done global

- `docker compose config`, migraciones, health y `npm run build` pasan en un entorno limpio.
- Ambos snapshots quedan registrados por URL, status, bytes, timestamp y SHA-256; sus contratos se validan sin guardar PII en RAG.
- Primera ingesta pasa políticas; segunda ingesta idéntica produce cero cambios de contenido, cero duplicados y cero re-embeddings innecesarios.
- 100 % de candidatos públicos cumple estado/precio/stock; 0 IDs/variantes huérfanos; 0 fugas de variante, precio, color, forma o tamaño.
- SKU no ambiguo: Recall@1 >= 0,99 y Recall@5 = 1,00; SKU ambiguo nunca se resuelve como único.
- Nombre: Recall@5 >= 0,95; filtros duros: precision@20 = 1,00; SKU inexistente: 100 % sin resultados.
- Parser estable 3/3; sin key la búsqueda funciona; con key Gemini solo puede completar el schema validado.
- Embeddings completos y dimensión correcta cuando están habilitados; retrieval p50 <= 500 ms y p95 <= 2.100 ms en el corpus congelado; E2E p95 <= 1,15× baseline comparable.
- Existe runbook de snapshot, promoción, rollback, stale-data y re-ejecución; no quedan riesgos P0 abiertos.

## Referencias obligatorias

`.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `STACK.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `TESTING.md`, `CONCERNS.md`, `PLAN_RENDIMIENTO_RAG.md`, `PLAN_RAG_FRANJAS_PRESUPUESTO.md` y `PLAN_TAMANOS_GLOBO.md`.
