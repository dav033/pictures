# State — Regeneración RAG v2

**Updated:** 2026-08-22
**Phase:** `01-rag-regeneration`  
**Status:** complete — planes `01-01` a `01-08` completos
**Current wave:** complete

## Resultado final

La regeneración RAG v2 quedó verificada sobre PostgreSQL real en Docker y habilitada localmente con `RAG_ENABLED=true`. La ruta obligatoria es determinista (parser + FTS/trigram + SQL); Gemini/vector queda `SKIPPED_OPTIONAL` sin key. El bloqueo de integración de generación quedó cerrado: `productIds` enruta explícitamente al catálogo legado SQLite y `ragVariantIds` al catálogo RAG PostgreSQL, sin heurística ni fallback.

- Snapshot publicado: `products_catalog:13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`.
- SHA de productos: `13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`.
- SHA de órdenes: `d4f5dd037656209f25b018274877333bd134560df5f055168410ffeaac58b414`.
- Catálogo publicado: `1411` productos / `3592` variantes.
- Migraciones aplicadas: `10`; `010_variant_package_units.sql` incluido.
- Unidades por paquete: `3518` conocidas / `74` desconocidas (`NULL`, sin inventar valores).
- Manifests fuente revisados: sin PII y sin cambios en hashes.
- Docker: servicio PostgreSQL healthy; pgvector, pg_trgm y unaccent verificados.
- HTTP smoke en producción local (puerto `3010`): `/`, `/catalogo`, `/api/productos`, `/api/shopify/sync` y `/api/ia/salud` respondieron `200`; las solicitudes válidas de `/api/generate` (PG y legado) superaron validación de catálogo y terminaron en `503 sin_llave`, sin llamada pagada.
- Navegador integrado final: raíz/catálogo/búsqueda `globo corazón rojo` devolvió `28`; filtros `forma=corazon` (Corazón) + `color=rojo` (rojo) devolvieron `10`; detalle, selección y frontera de generación PASS, `0` errores de consola y estado limpiado.

## Métricas y gates

- Corpus fijo: `416`; benchmark `repeat=2`; p50 `25.1583 ms`; p95 `54.2580 ms`.
- NDCG@10 global: `0.905466`; filter precision: `1.0000`.
- E2E no-key: PASS, `0` fallos; p95 final `72.4 ms`, `2` skips opcionales (vector/Gemini sin key), baseline `144.7 ms`, límite baseline+15% `166.4 ms`.
- `npm run rag:test-generation-resolver`: PASS después de recuperar Docker; cubre metadata PG, legado Shopify real, legado curado, orden mixto, desconocidos/duplicados/payload runtime y frontera HTTP sin proveedor pagado.
- Build, TypeScript, lint focal y `git diff --check`: PASS.
- E2E con Gemini sin key: `SKIPPED_OPTIONAL`.
- Build, TypeScript, lint, health, parser, ingesta, SKU, whitelist, precio, disponibilidad, same-variant, rollback y HTTP: PASS.

| Gate | Estado | Evidencia |
| --- | --- | --- |
| Runtime/Docker/build | PASS | Docker healthy, build y rutas HTTP 200 |
| Contratos/snapshots | PASS | manifests, Zod, SHA y conteos |
| Schema/ingesta productos | PASS | staging, idempotencia, ACTIVE/precio positivo |
| Agregados de órdenes | PASS | 1855 líneas, agregados sin PII, replay determinista |
| Taxonomía/parser | PASS | parser determinista 3/3 y taxonomía v2 |
| Retrieval/índices | PASS | FTS/trigram, filtros same-variant y EXPLAIN |
| Benchmark fijo | PASS | corpus 416, repeat 2, NDCG/filter/latencia en gates |
| E2E/rollback | PASS | PG-only identity → despiece → visual, runbooks y SHA exacto |
| Resolución de generación / frontera HTTP | PASS | Fuentes explícitas, revalidación `ACTIVE`/disponible/precio positivo, orden legado→RAG y `503 sin_llave` sin proveedor pagado |
| Gemini/vector | SKIPPED_OPTIONAL | sin `GEMINI_API_KEY`; no bloquea no-key |

## Decisiones operativas

- `RAG_ENABLED=true`, `RAG_USE_VECTOR=false`, `RAG_USE_FULLTEXT=true`, `RAG_USE_TRIGRAM=true` en el entorno local aprobado.
- El RAG no depende de IDs ni metadata SQLite: retrieval, resolver, validación y proyección visual RAG usan PostgreSQL y la misma whitelist. La compatibilidad de `/api/generate` mantiene dos fuentes explícitas: `productIds` (SQLite legado) y `ragVariantIds` (PostgreSQL RAG), con revalidación confiable `ACTIVE`/disponible/precio positivo y orden determinista legado→RAG.
- La separación de corpus es intencional: SQLite tiene `1671` productos/`3724` variantes (`/catalogo` muestra `1456`), PostgreSQL RAG `1411`/`3592`, con solapamiento exacto de `0` IDs de producto y `0` IDs de variante. Multi-turn y cotizaciones editadas conservan la procedencia de la fuente.
- SKU duplicado siempre requiere aclaración; no hay primer match silencioso.
- `available` y precio de la variante son autoridad comercial; inventario negativo/cero no reinterpreta disponibilidad.
- Rollback: `RAG_ENABLED=false` y reimportación exacta de los SHA registrados en `release-manifest.json`; conservar el volumen Docker.

## Mantenimiento siguiente

1. Ante una nueva fuente, validar URL/hash/conteos y ejecutar `npm run rag:migrate` antes del import.
2. Tras reimportar, ejecutar `ANALYZE catalog_products`, `ANALYZE catalog_variants`, `ANALYZE catalog_embeddings` y `ANALYZE rag_order_demand_aggregates` antes del benchmark.
3. Ejecutar `npm run rag:e2e-v2`, `npm run rag:test-generation-resolver` y `npx tsx scripts/bench-rag-v2.ts --no-key --repeat 2` antes de cambiar flags.
4. Mantener Gemini/vector como opcionales hasta disponer de key, embeddings completos y benchmark comparable.
5. Conservar manifests, hashes, backups y rollback target; no persistir cuerpos RAW ni PII.
