# Architecture

**Analysis Date:** 2026-08-21

## Pattern Overview

**Overall:** Next.js App Router monolith with two parallel catalog stores and a custom, deterministic RAG pipeline. The conversational layer uses Gemini tool-calling through the reusable `@sempertex/agente-core` package; retrieval is implemented directly with PostgreSQL/pgvector and PostgreSQL full-text search. SQLite remains the legacy/public catalog and quotation store.

**Key Characteristics:**

- The RAG path is gated by module-level flags in `src/lib/rag/flags.ts`: `RAG_ENABLED` selects the RAG tools, while `RAG_FRANJAS_ENABLED` optionally activates the budget-basket pipeline.
- Shopify is treated as the factual source. `src/lib/rag/catalog/normalize.ts` validates and deterministically derives taxonomy, colors, occasions, size, and shape; no LLM writes catalog facts.
- Retrieval is hybrid: exact SKU lookup, pgvector cosine distance, Spanish unaccented full-text search, hard SQL filters, and Reciprocal Rank Fusion from `packages/agente-core/src/rag/rrf.ts`.
- Product selection is guarded by a per-conversation whitelist and revalidated against Postgres in `src/lib/rag/chat/validar.ts`; prices, inventory, handles, images, and subtotals are resolved from the database rather than accepted from the LLM.
- A second data path is still live: `src/lib/shopify/sincronizar.ts` populates SQLite for catalog navigation and image/cotization compatibility, while the RAG importer populates Postgres. They duplicate normalization logic and are not one atomic source of runtime truth.

## Layers

**Presentation / HTTP:**

- Purpose: Accept chat, sync, webhook, catalog-navigation, and admin requests and translate results into JSON or SSE.
- Location: `src/app/api/chat/route.ts`, `src/app/api/rag/webhooks/shopify/route.ts`, `src/app/api/shopify/sync/route.ts`, `src/app/api/catalogo/piezas/route.ts`.
- Contains: Next.js Route Handlers, request parsing, response status mapping, SSE framing, HMAC verification boundary.
- Depends on: IA orchestration, RAG tools, SQLite catalog functions, PostgreSQL pool, and environment flags.
- Used by: `src/app/page.tsx`, `src/app/catalogo/page.tsx`, admin UI under `src/app/admin/page.tsx`, and Shopify webhook delivery.

**Conversation orchestration:**

- Purpose: Run the multi-turn Gemini tool-calling loop and maintain per-request state.
- Location: `src/lib/ia/ejecutar.ts`, `src/lib/ia/registro-herramientas.ts`, `src/lib/ia/prompt-sistema.ts`, `packages/agente-core/src/ejecutar.ts`.
- Contains: Tool registration, maximum-turn handling, streaming events, prompt assembly, RAG/legacy tool switching, conversation whitelist, and result packaging.
- Depends on: `@sempertex/agente-core`, Gemini adapter, RAG chat functions, SQLite catalog functions, and image-generation state.
- Used by: `src/app/api/chat/route.ts` and `scripts/eval-chat-thinking.ts`.

**RAG tool boundary:**

- Purpose: Expose only catalog-backed search and selection operations to the LLM when RAG is enabled.
- Location: `src/lib/ia/herramientas.ts` and `src/lib/ia/registro-herramientas.ts`.
- Contains: JSON schemas for `buscar_catalogo_rag` and `confirmar_seleccion_rag`; handlers that resolve budget mode, record retrieval IDs, persist observability, and invoke validation.
- Depends on: `src/lib/rag/chat/buscar.ts`, `src/lib/rag/chat/buscar-presupuesto.ts`, `src/lib/rag/chat/validar.ts`, `src/lib/rag/observability/log.ts`, and SQLite compatibility functions.
- Used by: The generic conversation loop in `packages/agente-core/src/ejecutar.ts`.

**Query interpretation:**

- Purpose: Convert free text into a closed, backend-representable intent without returning product IDs.
- Location: `src/lib/rag/query-parser/parse.ts`, `src/lib/rag/query-parser/schema.ts`.
- Contains: Gemini structured JSON generation, Zod validation, controlled categories/colors/occasions/forms/diameters, hard filters, and `semantic_query`.
- Depends on: `src/lib/shopify/derivar.ts` for the same taxonomies and `src/lib/gemini.ts` for the Gemini client/model.
- Used by: `src/lib/rag/chat/buscar.ts` and `src/lib/rag/chat/buscar-presupuesto.ts`.

**Retrieval:**

- Purpose: Find product candidates while applying factual constraints before ranking.
- Location: `src/lib/rag/retrieval/search.ts`, `src/lib/rag/retrieval/types.ts`, `packages/agente-core/src/rag/rrf.ts`.
- Contains: Exact SKU lookup, vector branch, full-text branch, reusable hard-filter SQL, RRF merge, minimum vector similarity, and variant whitelist construction.
- Depends on: `src/lib/rag/db.ts`, `src/lib/rag/embeddings.ts`, PostgreSQL tables from `scripts/migrations/001_init.sql` through `006_tamanos_variante.sql`.
- Used by: `src/lib/rag/chat/buscar.ts` and `src/lib/rag/retrieval/por-rol.ts`.

**Budget composition:**

- Purpose: Turn a resolved budget into role-specific candidates and a deterministic basket.
- Location: `src/lib/rag/presupuesto/franjas.ts`, `src/lib/rag/presupuesto/resolver.ts`, `src/lib/rag/presupuesto/plan.ts`, `src/lib/rag/retrieval/por-rol.ts`, `src/lib/rag/retrieval/rerank.ts`, `src/lib/rag/retrieval/diversidad.ts`, `src/lib/rag/presupuesto/ensamblar.ts`.
- Contains: Four budget bands, five roles, per-variant price caps, relaxation ladder, score reranking, family diversity, greedy assembly, and budget repair.
- Depends on: Query parser intent, Postgres retrieval, variant metadata, and role/category constants.
- Used by: `src/lib/rag/chat/buscar-presupuesto.ts` when `RAG_FRANJAS_ENABLED` is true and `brief.presupuesto` resolves.

**Catalog ingestion / canonicalization:**

- Purpose: Fetch source data, validate it, derive search fields, upsert products/variants, and record rejections/sync history.
- Location: `src/lib/rag/catalog/fetch-shopify.ts`, `src/lib/rag/catalog/normalize.ts`, `src/lib/rag/catalog/sanitize.ts`, `src/lib/rag/catalog/schemas.ts`, `src/lib/rag/catalog/persist.ts`, `scripts/import-shopify-catalog.ts`.
- Contains: Shopify public product pagination, CDN inventory fetch, sanitization, deterministic taxonomy/size derivation, SHA-256 search-text fingerprints, raw snapshot, duplicate detection, stale-product purge safeguards, and rejection logs.
- Depends on: `src/lib/shopify/derivar.ts`, `src/lib/shopify/enriquecer-descripcion.ts`, Zod, `pg`, and the public Shopify endpoints.
- Used by: Manual `npm run rag:import`, `npm run rag:sync`, and webhook processing through `src/lib/rag/webhooks/procesar.ts`.

**Embedding generation:**

- Purpose: Materialize one 768-dimensional vector per canonical product only when `search_text` is new or changed.
- Location: `scripts/generate-embeddings.ts`, `src/lib/rag/embeddings.ts`.
- Contains: Gemini embedding calls, bounded concurrency, retry policy, dimension validation, and upsert keyed by `embedding_source_hash`.
- Depends on: Gemini API, `catalog_products.search_text`, `catalog_embeddings`, and `DATABASE_URL`.
- Used by: `npm run rag:embed`; online retrieval embeds only the query.

**Persistence / infrastructure:**

- Purpose: Provide Postgres/pgvector, migrations, connection pooling, observability, and synchronization state.
- Location: `docker-compose.yml`, `scripts/migrations/*.sql`, `scripts/migrate.ts`, `src/lib/rag/db.ts`, `src/lib/rag/observability/log.ts`.
- Contains: Docker volume, `vector`/`unaccent` extensions, catalog tables, embeddings, webhook/sync logs, query logs, and a global `pg.Pool`.
- Depends on: Docker and a configured `DATABASE_URL`; the repository does not create that environment variable automatically.
- Used by: All RAG route/tool/script paths.

**Legacy SQLite / compatibility:**

- Purpose: Keep the existing public catalog, UI browsing, quotation, image selection, and package-size data working.
- Location: `src/lib/db.ts`, `src/lib/shopify/sincronizar.ts`, `src/lib/shopify/consultas.ts`, `src/lib/products.ts`, `src/lib/cotizacion/motor.ts`.
- Contains: `data/demo.sqlite`, `shopify_producto`, `shopify_variante`, SQLite FTS, catalog faceting, package units, and image-generation product adapters.
- Depends on: Node `node:sqlite`, the same Shopify public/CDN sources, and local filesystem runtime storage.
- Used by: Catalog pages, `/api/catalogo/piezas`, quote generation, `/api/shopify/sync`, and size-mix expansion.

## Data Flow

**RAG bootstrap / full import:**

1. `scripts/migrate.ts` applies sorted SQL files in `scripts/migrations/` to a Postgres instance. `scripts/migrations/001_init.sql` creates `catalog_products`, `catalog_variants`, `catalog_embeddings`, rejection history, and sync history; later migrations add unaccented FTS, webhook state, observability, budget, and variant size/shape columns.
2. `scripts/import-shopify-catalog.ts` fetches paginated `https://www.sempertex.com/products.json` through `src/lib/rag/catalog/fetch-shopify.ts` and fetches the default `products_catalog.json` CDN URL as inventory. It stores the raw response in the ignored runtime path `data/raw/shopify-products.snapshot.json`.
3. `src/lib/rag/catalog/normalize.ts` rejects missing IDs/handles/titles, excluded product types, and products without a paid variant. It sanitizes text, derives category/colors/occasions, decodes size/shape, builds `search_text`, and computes `embedding_source_hash`.
4. `src/lib/rag/catalog/persist.ts` upserts the product, deletes/reinserts its variants, and relies on foreign-key cascade for deleted products and embeddings. The importer wraps the catalog pass in a transaction and deletes products missing from a sufficiently complete new snapshot.
5. `scripts/generate-embeddings.ts` reads products with missing/stale hashes, calls Gemini, validates 768 dimensions, and upserts vectors into `catalog_embeddings`.

**Online product search without a budget band:**

1. `src/app/api/chat/route.ts` rebuilds the text-only conversation history, resolves Gemini, constructs the prompt with `construirSistema`, and starts the stream from `src/lib/ia/ejecutar.ts`.
2. `packages/agente-core/src/ejecutar.ts` runs the tool loop. `src/lib/ia/registro-herramientas.ts` exposes RAG tools when `RAG_ENABLED=true` and removes the older `buscar_catalogo`, `confirmar_seleccion_ia`, and `consultar_disponibilidad` tools to prevent bypassing RAG validation.
3. `buscar_catalogo_rag` calls `src/lib/rag/chat/buscar.ts`, which calls the Gemini parser in `src/lib/rag/query-parser/parse.ts`. Zod validates intent and keeps product selection outside the LLM.
4. `buscarCatalogoRag` maps parser output to hard filters. `src/lib/rag/retrieval/search.ts` first performs an exact SKU lookup, rejects unknown SKU-shaped queries, then runs pgvector and/or FTS branches with the same hard SQL filters. Results are merged by weighted RRF (`0.6` vector / `0.4` text, `k=60`) and capped by configured limits.
5. The retrieval query returns product IDs plus only variants satisfying availability, price, form, and diameter constraints. `buscar.ts` loads the product details, applies this variant whitelist, and returns product/variant data to the tool. If the initial combination is empty, it relaxes occasion and then color, reporting which filter was relaxed.
6. The handler adds returned product IDs to `estado.ragIdsRecuperados` and records query telemetry in `rag_query_log` through `src/lib/rag/observability/log.ts`.
7. Gemini may call `confirmar_seleccion_rag`. `src/lib/rag/chat/validar.ts` verifies product whitelist membership, product/variant ownership, positive integer quantity, availability, and known inventory; it calculates prices/subtotals from Postgres. The result is copied into state and then adapted through SQLite `variantesPorIds`/`aProducto` so the existing image-generation frontend can react to `seleccionFinalIA`.
8. `src/app/api/chat/route.ts` emits `texto`, `herramienta`, `fin`, or `error` SSE events. If streaming fails before the first fragment, it falls back to the non-streaming conversation response.

**Online search with budget composition:**

1. `src/lib/ia/registro-herramientas.ts` resolves `brief.presupuesto` deterministically with `src/lib/rag/presupuesto/resolver.ts`; the LLM never chooses a band.
2. `src/lib/rag/chat/buscar-presupuesto.ts` parses intent, creates a band plan in `plan.ts`, embeds the base semantic query once, then calls `buscarPorRol` concurrently for the plan's active roles.
3. `buscarPorRol` runs a sequential relaxation ladder per role: base filters, 15% price expansion, color/occasion relaxation, and allowed category expansion. Each accepted relaxation is returned, not hidden.
4. Retrieved variants are fetched in one Postgres detail query, reranked by role price utilization/color/occasion/completeness/inventory, diversified by title-family similarity, and assembled by `ensamblarCanasta` under role quotas and budget repair rules.
5. The tool returns `franja`, `canasta`, `pool_por_rol`, `relajaciones`, and `conflictos`; telemetry persists basket and utilization data. Selection validation still uses the Postgres whitelist and reports if the final total exceeds the band ceiling.

**Continuous updates:**

1. `src/app/api/rag/webhooks/shopify/route.ts` reads raw request text, validates `X-Shopify-Hmac-Sha256`, parses JSON, and dispatches supported product create/update/delete topics.
2. `src/lib/rag/webhooks/procesar.ts` inserts the webhook ID atomically for idempotency, normalizes product payloads, rejects invalid data, discards stale `updated_at` events, and calls the shared Postgres upsert/delete functions.
3. Inventory updates are not a separate supported topic; current inventory is refreshed by the full import/CDN path. A real Shopify webhook subscription and `SHOPIFY_WEBHOOK_SECRET` are external prerequisites documented in `src/app/api/rag/webhooks/shopify/route.ts`.

**Legacy sync / UI browse path:**

1. `src/app/api/shopify/sync/route.ts` calls `src/lib/shopify/sincronizar.ts`, which fetches the same public Shopify products and inventory CDN and replaces SQLite tables in a transaction.
2. `src/lib/shopify/consultas.ts` powers `/api/catalogo/piezas`, catalog facets, product cards, quote helpers, and image-generation adapters.
3. This endpoint does not update Postgres or embeddings. The RAG equivalent is the manual script chain `npm run rag:migrate`, `npm run rag:import`, `npm run rag:embed` (or `npm run rag:sync`).

**Input-source audit:**

- The current code references the CDN `products_catalog.json` URL in `src/lib/rag/catalog/fetch-shopify.ts` and `src/lib/shopify/sincronizar.ts`.
- No file, route, migration, or script references the user-provided `order_data.json` URL. It is not part of the current schema or ingestion flow, so order history/order-derived features cannot be reconstructed from the codebase alone.

## State Management

- Request state is an in-memory `EstadoConversacion` closure created by `src/lib/ia/registro-herramientas.ts`; chat history is sent by the client on every request and is not persisted.
- RAG whitelist state (`ragIdsRecuperados`) exists only for the current tool-loop request. It is intentionally not a cross-turn product cache.
- Product/catalog state is persisted twice: Postgres for RAG and SQLite for legacy browsing/quotation/image compatibility.
- Query, selection, sync, and webhook state is persisted in Postgres logs, but there is no catalog snapshot/version pointer that makes both stores switch atomically.

## Key Abstractions

**Canonical product / variant:**

- Purpose: Separate factual Shopify fields from deterministic derived fields and make validation/retrieval input stable.
- Examples: `CatalogProduct` and `CatalogVariant` in `src/lib/rag/catalog/schemas.ts`; normalization in `src/lib/rag/catalog/normalize.ts`.
- Pattern: Zod schemas reject malformed records; `source_payload` preserves raw source; `derived` stores category/colors/occasions; `search_text` and SHA-256 hash are derived separately.

**Intent query:**

- Purpose: Keep LLM interpretation in a closed vocabulary and distinguish hard constraints from semantic preferences.
- Examples: `IntentQuerySchema` in `src/lib/rag/query-parser/schema.ts` and `interpretarConsulta` in `src/lib/rag/query-parser/parse.ts`.
- Pattern: Structured Gemini JSON → Zod parse → SQL filters plus semantic query; LLM never returns product IDs.

**Hybrid retrieval contract:**

- Purpose: Keep retrieval independent from conversational language generation.
- Examples: `ConsultaRetrieval`/`ResultadoRetrieval` in `src/lib/rag/retrieval/types.ts`; `buscarHibrido` in `src/lib/rag/retrieval/search.ts`.
- Pattern: IDs and scores only; exact SKU gets an infinite ordering score and is placed first; RRF magnitude is used only for ordering.

**Tool registry:**

- Purpose: Keep domain handlers behind a generic tool-calling engine.
- Examples: `herramientasActivas` and `crearRegistroHerramientas` in `src/lib/ia/registro-herramientas.ts`; generic loop in `packages/agente-core/src/ejecutar.ts`.
- Pattern: JSON Schema declarations in `src/lib/ia/herramientas.ts`, domain handlers in the registry, generic Gemini adapter in `packages/agente-core/src/gemini/chat.ts`.

**Budget basket:**

- Purpose: Make price-aware composition deterministic and explainable instead of asking the LLM to sum/select.
- Examples: `PlanCanasta` in `src/lib/rag/presupuesto/plan.ts`, `CandidatoPuntuado` in `src/lib/rag/retrieval/rerank.ts`, and `Canasta` in `src/lib/rag/presupuesto/ensamblar.ts`.
- Pattern: resolver → role quotas → retrieval/relaxation → rerank/diversity → greedy assembly/repair.

**Variant size/shape:**

- Purpose: Apply physical constraints at variant level, where price and availability also live.
- Examples: `decodificarTamano` in `src/lib/shopify/derivar.ts`, columns added by `scripts/migrations/006_tamanos_variante.sql`, hard filters in `src/lib/rag/retrieval/search.ts`.
- Pattern: explicit size/shape requests become SQL filters; unspecified figure sizes go through `src/lib/rag/tamanos/resolver.ts` and a geometric despiece.

## Entry Points

**Chat API:**

- Location: `src/app/api/chat/route.ts`.
- Triggers: Client POST from `src/app/page.tsx`.
- Responsibilities: Resolve provider, build prompt, reconstruct messages, invoke streamed/generic conversation loop, serialize RAG and validation results.

**RAG migration:**

- Location: `scripts/migrate.ts`, command `npm run rag:migrate`.
- Triggers: Manual/operator setup.
- Responsibilities: Apply sorted SQL migrations once per filename.

**RAG import:**

- Location: `scripts/import-shopify-catalog.ts`, command `npm run rag:import`.
- Triggers: Manual/operator sync or `npm run rag:sync`.
- Responsibilities: Fetch, snapshot, normalize, upsert, reject, purge stale products, and record sync stats. It does not generate embeddings.

**Embedding job:**

- Location: `scripts/generate-embeddings.ts`, command `npm run rag:embed`.
- Triggers: Manual/operator sync.
- Responsibilities: Generate/upsert missing or hash-stale product vectors.

**Shopify webhook:**

- Location: `src/app/api/rag/webhooks/shopify/route.ts`.
- Triggers: External Shopify delivery.
- Responsibilities: Verify signature, parse body, process supported product topics, return 2xx for decided outcomes and 5xx for retryable infrastructure errors.

**Legacy SQLite sync:**

- Location: `src/app/api/shopify/sync/route.ts`.
- Triggers: Admin UI or operator.
- Responsibilities: Replace SQLite catalog and report SQLite sync state; it does not refresh Postgres RAG state.

## Error Handling

**Strategy:** Fail closed for factual/catalog validation, retry transient external calls, preserve previous catalog on failed full import, and expose explicit relaxation/rejection information to the LLM.

**Patterns:**

- `src/lib/retry.ts`, `src/lib/rag/catalog/fetch-shopify.ts`, and `src/lib/rag/embeddings.ts` retry network/429/5xx errors while treating configuration 4xx errors as non-retryable.
- `src/lib/rag/catalog/normalize.ts` returns typed rejections instead of inventing missing fields.
- `src/lib/rag/chat/validar.ts` rejects unknown IDs, mismatched variants, invalid quantities, unavailable variants, and over-inventory quantities.
- `src/lib/rag/retrieval/search.ts` treats an unknown SKU-shaped query as no result rather than semanticizing it into an unrelated product.
- `src/app/api/rag/webhooks/shopify/route.ts` returns 200 for idempotent/stale/rejected business outcomes so Shopify does not retry them, and 500 for database/processing failures.
- `src/lib/rag/observability/log.ts` catches log failures so telemetry cannot abort a user conversation.
- `src/app/api/chat/route.ts` maps IA failures to status codes and has a pre-first-byte non-stream fallback.

## Cross-Cutting Concerns

**Logging / observability:** `scripts/migrations/004_observability.sql` creates `rag_query_log`; `src/lib/rag/observability/log.ts` records intent, retrieved IDs, scores, latency, selection rejection, and optional basket data. `scripts/rag-metrics.ts` aggregates query/sync/webhook metrics. `packages/agente-core/src/telemetria.ts` records generic IA events.

**Validation:** Zod is used for canonical catalog and parser intent schemas. HTTP admin validation uses Zod in `src/app/api/admin/arquitectura/route.ts`; the RAG tool schemas are JSON Schema declarations in `src/lib/ia/herramientas.ts` and backend selection is validated again in `src/lib/rag/chat/validar.ts`.

**Authentication / authorization:** No application authentication boundary was found around chat, catalog sync, RAG webhook, or admin routes. The Shopify webhook has HMAC authenticity; other routes rely on deployment/network context. This is a production blocker if these endpoints are externally reachable.

**Source-of-truth separation:** Shopify raw payload is preserved in Postgres `source_payload`; derived fields remain deterministic. However, SQLite and Postgres are independently refreshed, and size-mix expansion intentionally reads SQLite (`src/lib/rag/tamanos/resolver.ts:37-42`), so catalog consistency is eventual/manual rather than atomic.

**Framework evaluation:** No LangChain, LlamaIndex, Haystack, Ragas, Pinecone, Weaviate, or equivalent RAG framework is present in `package.json` or source imports. The existing framework is a small in-repo abstraction: `@sempertex/agente-core` for tool calling/RRF plus direct `pg`/SQL, Gemini embeddings, Zod, and `pgvector`. This is deliberate and justified by `PLAN_RENDIMIENTO_RAG.md` (frameworks were marked “No aplica” because they add layers without removing the measured Gemini/SQL round trips). A framework change is not justified by the current code; the priority is unifying stores, sources, sync lifecycle, and tests.

## Known Breaks / Incomplete Boundaries

**Runtime is not currently reproducible from checked-in defaults:**

- Evidence: `docker compose ps` returned no running services during this audit; `.env.local` is empty and ignored by Git.
- Files: `docker-compose.yml`, `.env.local`, `src/lib/rag/db.ts`, `scripts/migrate.ts`.
- Impact: `DATABASE_URL` is not supplied by the repository, so migration/import/retrieval/health scripts cannot run from this checkout without operator environment setup. Gemini parser/embeddings also require `GEMINI_API_KEY`.

**The user-provided order source is absent:**

- Evidence: repository search found no `order_data.json` reference; only `products_catalog.json` appears as a default inventory URL.
- Files: `src/lib/rag/catalog/fetch-shopify.ts`, `src/lib/shopify/sincronizar.ts`, `src/lib/rag/catalog/schemas.ts`, `scripts/migrations/001_init.sql`.
- Impact: orders/order history are not ingested, stored, indexed, or queryable by the current RAG. Rebuilding that behavior requires a schema and explicit semantics for what an order is used for.

**Two catalogs can drift:**

- Files: `src/lib/shopify/sincronizar.ts`, `scripts/import-shopify-catalog.ts`, `src/lib/rag/tamanos/resolver.ts`, `src/lib/db.ts`.
- Impact: `/api/shopify/sync` updates SQLite only; `npm run rag:sync` updates Postgres/embeddings only. The size-mix resolver reads SQLite and package units exist there but not in Postgres RAG canonical variants. A partial/manual sync can make retrieval, validation, quotation, and generated-image selection disagree.

**Continuous inventory freshness is incomplete:**

- Files: `src/lib/rag/webhooks/procesar.ts`, `src/app/api/rag/webhooks/shopify/route.ts`, `src/lib/rag/catalog/fetch-shopify.ts`.
- Impact: only product create/update/delete topics are handled; inventory quantities are refreshed by the full CDN import, and webhook subscription setup is external. Availability can be stale between full imports.

**Webhook upsert is not transactionally grouped:**

- Files: `src/lib/rag/webhooks/procesar.ts`, `src/lib/rag/catalog/persist.ts`.
- Impact: `upsertProducto` commits product upsert, variant delete, and each variant insert as separate pool queries when invoked by a webhook. A mid-operation failure can leave a product with no or partial variants even though the webhook is logged as an error.

**Budget mode is implemented but opt-in:**

- Files: `src/lib/rag/flags.ts`, `src/lib/rag/presupuesto/*`, `PLAN_RAG_FRANJAS_PRESUPUESTO.md`.
- Impact: `RAG_FRANJAS_ENABLED` must be true before budget resolution/canasta runs; otherwise RAG returns flat product candidates. The plan states the budget work is implemented behind this flag.

**RAG documentation and user-facing README diverge:**

- Files: `README.md`, `PLAN_RENDIMIENTO_RAG.md`, `scripts/migrations/*.sql`, `src/lib/rag/*`.
- Impact: `README.md` describes SQLite/mock data as the system of record and does not explain Postgres/pgvector, manual RAG migration/import/embed, or required environment variables. Operators can start the UI and believe the RAG is available when it is not.

**Current hard-filter semantics are uneven by attribute:**

- Files: `src/lib/rag/catalog/sanitize.ts`, `src/lib/shopify/derivar.ts`, `src/lib/rag/retrieval/search.ts`, `src/lib/rag/query-parser/schema.ts`.
- Impact: color and occasion are product-level derived arrays from tags/title; shape/diameter, price, and availability are variant-level. `search_text` intentionally excludes volatile price/stock and does not carry variant size/shape, so exact physical constraints depend on parser extraction plus SQL metadata, not embeddings. No variant-level color model exists in Postgres.

**No checked-in end-to-end harness covers the real stack from a clean runtime:**

- Files: `scripts/eval-retrieval.ts`, `scripts/eval-presupuesto.ts`, `scripts/eval-chat-thinking.ts`, `scripts/test-rag-validation.ts`, `scripts/test-webhook.ts`, `scripts/rag-health.ts`.
- Impact: there are useful script-based evaluations and plans, but the missing Docker/env runtime in this checkout prevents verification now; there is no single command that provisions Postgres, imports both supplied JSON files, embeds, starts Next, and exercises chat → search → selection → quote/image response.

---

*Architecture analysis: 2026-08-21*
