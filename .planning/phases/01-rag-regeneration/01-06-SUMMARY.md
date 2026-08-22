---
phase: 01-rag-regeneration
plan: 06
subsystem: retrieval
tags: [postgres, pg-trgm, fts, rrf, sku, benchmark]
requires: [01-04, 01-05]
provides: [hybrid-retrieval, measured-retrieval-indexes, no-key-benchmark]
affects: [chat-search, budget-search, future-embedding-rollout]
---

# Phase 01 Plan 06: Retrieval híbrido e índices medidos

Se reemplazó la fachada de retrieval de producción por un pipeline determinístico y auditable: SKU exacto aislado, FTS `spanish_unaccent`, trigram de título/handle, vector opcional y RRF local. Todas las ramas aplican `ACTIVE`, disponibilidad fuente, precio, forma, diámetro y facetas antes de rankear; la whitelist final consulta todas las variantes que cumplen esos filtros en el mismo registro de variante.

## Entregado

- `search.ts` conserva `buscarHibrido`, añade extracción de SKU dentro de texto, estado `unique/ambiguous/not_found/filtered_out`, fallback sin Gemini y contribuciones RRF.
- El estado `ambiguous` se propaga sin selección silenciosa por `buscarCatalogoRag`, presupuesto y el registro de herramientas como `AMBIGUOUS_SKU`/`sku_status`; el prompt obliga a pedir una aclaración.
- La confirmación ahora conserva un `Map<product_id, Set<variant_id>>` obligatorio por conversación y `validarSeleccion` rechaza siblings reales fuera de la whitelist antes de consultar DB; ya no existe el bypass inseguro por sólo product ID.
- SKU original tiene prioridad; el SKU canónico se usa solo como fallback. Un SKU ambiguo devuelve todas sus variantes exactas, nunca el primer match.
- `diametrosPulgadas` implica `forma = redondo` cuando no se pide forma explícita. `available=true` no se infiere de inventario positivo.
- FTS, trigram y vector rankean un producto una sola vez por rama; la whitelist posterior reúne todas las variantes válidas del producto. Popularidad usa `log1p(weighted_units)` como desempate de peso `0.0001`.
- Las consultas price-only/faceta-only tienen un `filter_browse` controlado: solo se activa con un filtro duro explícito, ordena variantes válidas de forma determinista y nunca lista el catálogo ante una consulta vacía sin filtros.
- `009_retrieval_indexes.sql` es idempotente, reutiliza el GIN FTS existente, crea índices de facetas como expresiones que coinciden con las cláusulas reales, mantiene un solo trigram de SKU para fallback y usa B-tree uppercase para exactitud. No se añadió HNSW/IVFFlat.
- El presupuesto propaga forma/diámetro y no calcula embeddings sin `RAG_USE_VECTOR=true` y `GEMINI_API_KEY`; el caller de chat y el caller por rol funcionan sin key.
- Embeddings de presupuesto capturan claves inválidas/expiradas y continúan por FTS/trigram. La demanda usa únicamente el snapshot `order_data` publicado más reciente y sólo variantes de la whitelist final que siguen `available=true`.
- `derived_colors TEXT[]` es evidencia canónica por variante (con GIN), no la unión de colores del producto. `dorado rosa` conserva su compuesto, `arena` se normaliza a `beige`, `ESCARCHADA` queda desconocido y `vino` se desambigua en contextos de bolsa/caja/empaque. Precio, disponibilidad y color se verifican en la misma variante.
- El trigram productivo se reescribió en candidatos indexables separados por `title`/`handle` y se explicó con la misma forma de SQL; no se agregaron `DROP INDEX` a 009.
- Canonicalización extrae `C-/LOL-/T-/R-` de títulos con empaque y convierte `CORAZON N` seguro a `C-N`; se agregó regresión sintética de `CORAZON 12 / PAQUETE X 10`.
- `.env.example` documenta flags seguros: vector apagado, FTS/trigram encendidos, límites y umbral trigram.

## Evidencia ejecutada

- `npx tsx scripts/test-product-ingestion.ts --canonicalize` — PASS; fixture de corazón deriva `codigo_tamano=C-12`, `forma=corazon`.
- Importación CDN real después del fix — `3297` productos/`6136` variantes fuente → `1411` productos/`3592` variantes publicadas, `2008` rechazos.
- Segunda importación real — mismos `1411/3592`, `deleted 0`; no duplicó filas.
- Shape counts finales: `corazon=49`, `link=220`, `modelar=228`, `redondo=1832`, `NULL=1263`; `23` variantes tienen `available=true` e inventario `<=0`, preservando la disponibilidad fuente.
- Conteos de evidencia tras la iteración: `diam_pulg=40` en `29` variantes, `derived_colors` no vacío en `2515`, `beige` en `54`; shape counts permanecen `corazon=49`, `link=220`, `modelar=228`, `redondo=1832`, `NULL=1263` y las `23` variantes `available=true` con inventario `<=0` siguen respetando la fuente.
- Docker tiene `pg_trgm`, `unaccent` y `vector`; la migración 009 se aplicó explícitamente después de ajustar su contenido y se verificaron los índices en `pg_indexes`.
- `npx tsx --env-file=.env.example scripts/bench-retrieval-v2.ts --no-key --smoke` — PASS. Budget caller: `15` candidatos sin Gemini. Planes: FTS usa `ix_catalog_products_tsv`; exact SKU usa `ix_catalog_variants_sku_original_upper_v2`; filtro usa `ix_catalog_products_status_available_v2`; trigram usa `Seq Scan` medido (catálogo de 1.4k, ~17 ms en `EXPLAIN`) aunque los GIN quedan disponibles para escala.
- `npx tsx --env-file=.env.example scripts/test-rag-validation.ts` — PASS; valida SKU/producto inventado, sibling fuera de whitelist, agotado y `available=true` con inventario `<=0` sin reinterpretar disponibilidad.
- `npx tsx --env-file=.env.example scripts/eval-e2e-rag-v2.ts --no-key --smoke` — PASS final: `fallos=0`, `bloqueos=0`, `p95=87.9 ms`; incluye adversarial de sibling fuera de whitelist.
- `npx tsx --env-file=.env.example scripts/regression-anti-alucinacion.ts` — PASS; webhook, validación de selección y contrato de parser sin regresiones después de hacer obligatoria la whitelist de variantes.
- Latencia smoke de la iteración: FTS p50/p95 `163.9/175.1 ms`; trigram `149.2/188.2 ms`; filtros de misma variante `75.9/124.3 ms`; diámetro implícito `117.1/143.8 ms`; browse price-only `73.8/76.1 ms`; SKU inexistente `11.3/18.8 ms`. Todos los gates por familia p50 ≤500 ms y p95 ≤2100 ms pasaron.
- El smoke incluyó `B2B-20008459` en retrieval/chat/presupuesto (estado ambiguo y pool vacío), clave Gemini inválida, diámetro real 40, producto multi-variante Cuchara Deluxe (rojo no puede devolver ESCARCHADA), demanda latest-snapshot/whitelist y EXPLAIN de la SQL trigram productiva.
- `npx eslint` sobre los archivos del plan y adaptaciones — PASS.
- `npm run lint` — PASS (solo warnings preexistentes/no bloqueantes en scripts ajenos).
- `npx tsc --noEmit --pretty false --incremental false` — PASS.
- `npm run build` — PASS (Next 16.3.0 compiló y generó las rutas).

## Desviaciones automáticas

1. **Rule 1 — Bug:** canonicalización no reconocía códigos con sufijo de empaque ni tags `CORAZON N`; se extrajo el token explícito y se añadió regresión.
2. **Rule 2 — Critical:** el caller de presupuesto invocaba Gemini siempre y `buscarPorRol` agregaba prose de rol a FTS; se hizo vector opt-in y se recortó el hint tras em-dash para lexical retrieval.
3. **Rule 2 — Critical:** se añadieron las adaptaciones mínimas de `por-rol.ts`, `buscar-presupuesto.ts`, `.env.example` y el test de ingestión para que el módulo actualizado fuera alcanzable end-to-end.
4. **Rule 3 — Blocking:** 009 ya figuraba en `schema_migrations` mientras se medían índices; se ejecutó su DDL final explícitamente en el Postgres local y se confirmó que una DB limpia lo aplica mediante `rag:migrate`.

## Riesgos y decisiones pendientes

- El trigram benchmark simple elige `Seq Scan` por el tamaño actual del catálogo; se midió y es más barato que forzar índice. Si el catálogo crece, repetir `EXPLAIN` y revisar el umbral/GIN antes de introducir ANN.
- La rama vectorial no se ejercitó en `--no-key`; permanece explícitamente opt-in y captura errores sin degradar FTS/trigram.

## Iteración posterior: misses de catálogo y parser (2026-08-22)

- `variantColors` ahora usa todos los colores explícitos del título público cuando el título de variante no aporta uno, normaliza separadores (`Plata-Azul`, `Dorado/Negro`) y no hereda la unión de tags. `SURTIDO/MULTICOLOR` conserva la señal genérica y suma colores específicos del título cuando existen; `ESCARCHADA` permanece desconocido.
- `findExplicitSize` prioriza `variant.title`, luego `product.title` y sólo usa tags si todos sus códigos decodificados son inequívocos. Así `R12` del título Bouquet se publica como `R12/redondo/12`, mientras tags `R-5` + `R-12` sin evidencia titular quedan `NULL`.
- Se eliminaron inferencias hard desde `mini`, `pequeña`, `mediana`, `grande` y `jumbo`; sólo códigos/unidades explícitos fijan pulgadas. Las formas textuales requieren contexto de globo o frase explícita `forma ...`; códigos C/R/LOL/T siguen siendo hard.
- Títulos públicos `Decor-Kit` tienen precedencia segura sobre `productType` legacy: los IDs `10105768083751` y `10105771360551` quedaron categoría `kit`.
- Reimportación CDN final en Docker, dos corridas: cada una `3297/6136` fuente → `1411/3592` publicadas, `2008` rechazadas, `deleted 0`. Conteos finales: `corazon=49`, `link=220`, `modelar=228`, `redondo=1838`, `NULL=1257`; diámetro 40 en `29`; `derived_colors` no vacío en `2716`. `Kit Dorado Y Negro / SURTIDO` quedó `{multicolor,dorado,negro}` y los Bouquets R12 quedaron `redondo/12`; no hay forma derivada para `Servilleta Pequeña`.
- Verificación: `npx tsx scripts/test-product-ingestion.ts --canonicalize`, `npx tsx scripts/eval-query-parser-v2.ts --no-key` (95 casos), `npx tsx --env-file=.env.example scripts/bench-retrieval-v2.ts --no-key --smoke`, `npx tsx --env-file=.env.example scripts/regression-anti-alucinacion.ts`, `npx tsc --noEmit --pretty false --incremental false` y `npm run build` pasaron. `npm run lint` pasó con las cuatro advertencias preexistentes; `git diff --check` no reportó errores.
- Plan07 debe volver a ejecutar su corpus de recall/benchmark sobre este snapshot final; no se bajaron gates.
