# Codebase Structure

**Analysis Date:** 2026-08-21

## Directory Layout

```text
pictures/
├── src/
│   ├── app/                         # Next.js App Router pages and Route Handlers
│   │   └── api/
│   │       ├── chat/                # Streaming/non-streaming assistant endpoint
│   │       ├── rag/webhooks/shopify/ # Signed Shopify → Postgres RAG updates
│   │       ├── shopify/sync/         # Legacy Shopify → SQLite sync
│   │       └── catalogo/piezas/      # Direct SQLite catalog browse endpoint
│   ├── lib/
│   │   ├── rag/                     # Postgres/pgvector RAG pipeline
│   │   │   ├── catalog/             # Source fetch, schema, normalization, persistence
│   │   │   ├── chat/                # Search and selection contracts/validation
│   │   │   ├── query-parser/        # Gemini intent extraction + Zod schema
│   │   │   ├── retrieval/           # Hybrid search, RRF, rerank, diversity, roles
│   │   │   ├── presupuesto/         # Budget bands, plan, basket assembly
│   │   │   ├── tamanos/             # Geometric size-mix expansion
│   │   │   ├── webhooks/            # Signature and Shopify payload processing
│   │   │   └── observability/       # RAG query/selection logging
│   │   ├── ia/                      # Gemini provider, prompts, tool registry, state
│   │   ├── shopify/                 # Legacy SQLite Shopify sync/query/derivations
│   │   ├── cotizacion/              # Quote calculation from catalog variants
│   │   ├── medidas/                 # Geometric balloon despiece calculations
│   │   ├── db.ts                    # SQLite schema/connection/seed
│   │   ├── products.ts              # Legacy product CRUD/adapters
│   │   └── types.ts                 # App/domain types
│   └── components/                  # Client/admin/catalog UI components
├── packages/
│   └── agente-core/                 # Workspace package: generic Gemini tool loop, retry, telemetry, RRF
├── scripts/
│   ├── migrations/                  # Ordered Postgres/pgvector schema changes 001–006
│   ├── import-shopify-catalog.ts    # RAG full import into Postgres
│   ├── generate-embeddings.ts       # Hash-aware Gemini vector materialization
│   ├── migrate.ts                   # Migration runner
│   ├── eval-*.ts / test-*.ts        # Retrieval, parser, budget, validation, webhook eval scripts
│   └── rag-*.ts                     # Health, metrics, and operational checks
├── data/                            # Ignored runtime/data artifacts and dataset manifests
├── configs/                         # Provider/project/LoRA configuration
├── docs/                            # Requirements, research, decisions, operations, dataset docs
├── reports/                         # Evaluation/review reports
├── public/                          # Static assets and runtime uploads directory
├── docker-compose.yml               # Local pgvector Postgres service definition
├── package.json                     # Next.js workspace and RAG operational scripts
├── tsconfig.json                    # `@/*` alias → `src/*`, strict TypeScript
├── README.md                        # App setup and legacy SQLite description (partially stale for RAG)
├── PLAN_*.md                        # RAG performance, budget-band, and size plans
└── project-state.json               # LoRA project state; not RAG runtime state
```

## Directory Purposes

**`src/app/`:**

- Purpose: Next.js routes and pages.
- Contains: Chat UI, catalog/admin pages, image-generation routes, Shopify sync, and RAG webhook/API handlers.
- Key files: `src/app/api/chat/route.ts`, `src/app/api/rag/webhooks/shopify/route.ts`, `src/app/api/shopify/sync/route.ts`, `src/app/page.tsx`.

**`src/lib/rag/`:**

- Purpose: All Postgres/pgvector retrieval behavior and RAG-specific domain contracts.
- Contains: DB pool, flags, embeddings, canonical catalog, parser, hybrid search, budget composition, size resolver, webhooks, and observability.
- Key files: `src/lib/rag/catalog/normalize.ts`, `src/lib/rag/retrieval/search.ts`, `src/lib/rag/chat/buscar.ts`, `src/lib/rag/chat/validar.ts`, `src/lib/rag/presupuesto/ensamblar.ts`.

**`src/lib/rag/catalog/`:**

- Purpose: Convert source payloads into trusted canonical Postgres records.
- Contains: `fetch-shopify.ts`, `schemas.ts`, `sanitize.ts`, `normalize.ts`, `persist.ts`.
- Key invariant: facts come from Shopify/raw payload; only deterministic derived fields are added. Prices and inventory are not included in semantic `search_text`.

**`src/lib/rag/query-parser/`:**

- Purpose: Translate Spanish free text into closed-enum search intent.
- Contains: `schema.ts` and `parse.ts`.
- Key invariant: parser returns filters and semantic text, never product IDs or commercial facts.

**`src/lib/rag/retrieval/`:**

- Purpose: Candidate retrieval and post-retrieval ranking.
- Contains: `search.ts` (exact SKU + vector + FTS + filters + RRF), `types.ts`, `por-rol.ts`, `rerank.ts`, `diversidad.ts`.
- Key invariant: price, availability, physical form, and diameter filters are applied as SQL metadata constraints; preferences may remain semantic/ranking signals.

**`src/lib/rag/chat/`:**

- Purpose: Adapt retrieval to tool contracts and prevent hallucinated selection data.
- Contains: `buscar.ts`, `buscar-presupuesto.ts`, `validar.ts`.
- Key invariant: result IDs are whitelisted for the current conversation and selection data is re-resolved from Postgres.

**`src/lib/rag/presupuesto/`:**

- Purpose: Deterministic budget-aware composition.
- Contains: `franjas.ts`, `resolver.ts`, `plan.ts`, `ensamblar.ts`.
- Key invariant: the LLM does not define the band, recipe, total, or subtotal; it receives a computed basket and alternatives.

**`src/lib/rag/tamanos/`:**

- Purpose: Expand a geometric despiece into real size variants and package quantities.
- Contains: `resolver.ts`.
- Important coupling: reads SQLite `shopify_variante`, not Postgres; package units are available only in the legacy store.

**`src/lib/ia/`:**

- Purpose: Domain-facing AI orchestration and tool declarations.
- Contains: prompt, provider registry, Gemini adapters, tool schemas, tool handlers, and state.
- Key files: `src/lib/ia/registro-herramientas.ts`, `src/lib/ia/herramientas.ts`, `src/lib/ia/ejecutar.ts`, `src/lib/ia/prompt-sistema.ts`.

**`packages/agente-core/`:**

- Purpose: Reusable domain-neutral tool-calling engine and RRF utility.
- Contains: TypeScript source under `packages/agente-core/src/`, Gemini adapter, retry, telemetry, conversation loop, and `rag/rrf.ts`.
- Build: `packages/agente-core/package.json` exposes `@sempertex/agente-core`, `@sempertex/agente-core/gemini`, and `@sempertex/agente-core/rag`; compiled `dist/` is ignored and not present in source listing.

**`src/lib/shopify/`:**

- Purpose: Legacy SQLite catalog ingestion, taxonomy, queries, and public browsing adapters.
- Contains: `sincronizar.ts`, `consultas.ts`, `derivar.ts`, `tipos.ts`, `enriquecer-descripcion.ts`.
- Important coupling: uses the same Shopify/CDN origins as RAG, but persists independently to SQLite.

**`scripts/migrations/`:**

- Purpose: PostgreSQL schema history.
- Contains: `001_init.sql`, `002_unaccent_fts.sql`, `003_webhooks.sql`, `004_observability.sql`, `005_franjas_presupuesto.sql`, `006_tamanos_variante.sql`.
- Naming/order: numeric prefix is the execution order used by `scripts/migrate.ts`; `schema_migrations` tracks filenames.

**`scripts/`:**

- Purpose: Operational imports, embedding jobs, health checks, evaluations, regressions, and dataset work.
- Key RAG files: `import-shopify-catalog.ts`, `generate-embeddings.ts`, `eval-retrieval.ts`, `eval-query-parser.ts`, `eval-presupuesto.ts`, `eval-chat-thinking.ts`, `rag-health.ts`, `rag-metrics.ts`, `regression-anti-alucinacion.ts`.
- Tests are script-based rather than a configured Jest/Vitest/Playwright suite.

**`data/`:**

- Purpose: Runtime catalog snapshots and ML dataset artifacts.
- Contains: Git-kept manifests and placeholders; `data/raw/` and `data/demo.sqlite` are runtime/ignored artifacts when generated.
- Important: `data/raw/shopify-products.snapshot.json` is created by RAG import but is not present in the checked-in tree; no provided `order_data.json` is materialized here.

**`docs/`, root plans, and `reports/`:**

- Purpose: Design/requirements/decision history and measurement evidence.
- Key files: `PLAN_RENDIMIENTO_RAG.md`, `PLAN_RAG_FRANJAS_PRESUPUESTO.md`, `PLAN_TAMANOS_GLOBO.md`, `docs/decisions/adr-001-provider-model.md`, `docs/research/provider-comparison.md`, `reports/eval-tamanos-2026-08-21.txt`.
- Caveat: `.planning/codebase/` was empty before this mapping; the current architecture/structure documents are the first generated codebase map.

## Key File Locations

**Entry Points:**

- `src/app/api/chat/route.ts`: public chat POST, SSE stream, non-stream fallback.
- `src/app/api/rag/webhooks/shopify/route.ts`: signed Shopify product webhook.
- `src/app/api/shopify/sync/route.ts`: legacy SQLite catalog sync/status.
- `scripts/migrate.ts`: Postgres schema runner.
- `scripts/import-shopify-catalog.ts`: Postgres catalog importer.
- `scripts/generate-embeddings.ts`: Postgres embedding materializer.
- `src/lib/ia/registro-herramientas.ts`: actual RAG/legacy tool dispatch boundary.

**Configuration:**

- `package.json`: `rag:migrate`, `rag:health`, `rag:import`, `rag:embed`, `rag:sync`, evaluation and regression commands.
- `docker-compose.yml`: local `pgvector/pgvector:pg16` service, credentials, port 5432, named volume.
- `src/lib/rag/flags.ts`: `RAG_ENABLED` and `RAG_FRANJAS_ENABLED` module flags.
- `src/lib/gemini.ts`: `GEMINI_CHAT_MODEL`, `GEMINI_IMAGE_MODEL`, and Gemini client; `src/lib/rag/embeddings.ts` has embedding model/dimension envs.
- `scripts/migrations/*.sql`: Postgres schema/index/configuration.
- `.env.local`: ignored local secrets/config; currently empty in this checkout.

**Core Logic:**

- `src/lib/rag/catalog/normalize.ts`: raw → canonical product/variants.
- `src/lib/rag/catalog/sanitize.ts`: search text and hash.
- `src/lib/rag/retrieval/search.ts`: SQL retrieval and hybrid ranking.
- `src/lib/rag/query-parser/parse.ts`: intent extraction.
- `src/lib/rag/chat/buscar.ts`: non-budget search response.
- `src/lib/rag/chat/buscar-presupuesto.ts`: budget response.
- `src/lib/rag/chat/validar.ts`: selection validation and real-price calculation.
- `src/lib/rag/retrieval/rerank.ts`, `src/lib/rag/retrieval/diversidad.ts`, `src/lib/rag/presupuesto/ensamblar.ts`: candidate scoring, family diversity, and basket assembly.
- `src/lib/rag/tamanos/resolver.ts`: size-mix expansion against SQLite.

**Persistence:**

- `src/lib/rag/db.ts`: singleton `pg.Pool` from `DATABASE_URL`.
- `scripts/migrations/001_init.sql`: core Postgres RAG tables.
- `scripts/migrations/002_unaccent_fts.sql`: Spanish unaccented full-text configuration.
- `scripts/migrations/003_webhooks.sql`: source timestamp and webhook log.
- `scripts/migrations/004_observability.sql`: query/selection log.
- `scripts/migrations/005_franjas_presupuesto.sql`: budget overrides/log fields/price index.
- `scripts/migrations/006_tamanos_variante.sql`: variant size/shape fields/index.
- `src/lib/db.ts`: SQLite schema/connection and seed.

**Testing / Evaluation:**

- `scripts/rag-health.ts`: Postgres, pgvector, and Gemini embedding smoke checks.
- `scripts/eval-retrieval.ts`: recall/precision/no-result and invalid-ID checks against real Postgres data.
- `scripts/eval-query-parser.ts`: structured parser stability regression.
- `scripts/eval-presupuesto.ts`: deterministic band mapping and basket invariants.
- `scripts/eval-chat-thinking.ts`: end-to-end chat/tool trace checks.
- `scripts/test-rag-validation.ts`: whitelist, availability, inventory, and price validation.
- `scripts/test-webhook.ts`: signature/idempotency/stale webhook behavior.
- `scripts/regression-anti-alucinacion.ts`: product/price hallucination regression.
- No `vitest.config.*`, `jest.config.*`, Playwright config, or colocated `*.test.ts` suite was detected.

## Naming Conventions

**Files:**

- Spanish domain names use lowercase kebab-like conceptual segments where needed (`buscar-presupuesto.ts`, `enriquecer-descripcion.ts`, `registro-herramientas.ts`).
- Next route entry files are conventionally `route.ts`; page entry files are `page.tsx`.
- Operational scripts use verb/action names (`import-shopify-catalog.ts`, `generate-embeddings.ts`, `rag-health.ts`).
- SQL migrations use zero-padded numeric ordering (`001_init.sql` through `006_tamanos_variante.sql`).

**Directories:**

- Domain modules are grouped under lowercase Spanish names (`rag`, `shopify`, `presupuesto`, `query-parser`).
- Next dynamic route segments use bracket notation (`src/app/catalogo/[handle]/page.tsx`, `src/app/api/productos/[id]/route.ts`).
- UI components use PascalCase filenames (`GridCatalogo.tsx`, `TarjetaCotizacion.tsx`); small UI primitives live under `src/components/ui/`.

**Types and functions:**

- TypeScript types are mostly PascalCase (`CatalogProduct`, `ResultadoRetrieval`); exported functions are camelCase Spanish (`normalizarProducto`, `buscarHibrido`, `resolverFranja`).
- Database columns and JSON tool fields use snake_case (`product_id`, `variant_id`, `precio_max`), while internal TypeScript fields commonly use camelCase (`productId`, `precioMax`).
- Environment constants and fixed taxonomies use uppercase (`RAG_ENABLED`, `ROLES_PRESUPUESTO`, `DIAMETROS_REDONDOS_CATALOGO`).

## Where to Add New Code

**New RAG source or ingestion field:**

- Source types: `src/lib/shopify/tipos.ts` or a new source-specific module under `src/lib/rag/catalog/`.
- Canonical schema: `src/lib/rag/catalog/schemas.ts`.
- Normalization/derivation: `src/lib/rag/catalog/normalize.ts` plus deterministic helper in `src/lib/shopify/derivar.ts` if shared with SQLite.
- Persistence: `src/lib/rag/catalog/persist.ts` and a new ordered SQL migration in `scripts/migrations/`.
- Import/update orchestration: `scripts/import-shopify-catalog.ts` and, if event-driven, `src/lib/rag/webhooks/procesar.ts`.
- Add an explicit source snapshot and evaluation script under `scripts/`; do not silently add a second direct SQL writer.

**New retrieval filter or ranking signal:**

- Intent vocabulary/schema: `src/lib/rag/query-parser/schema.ts` and parser instructions in `src/lib/rag/query-parser/parse.ts`.
- Hard factual filter: `src/lib/rag/retrieval/types.ts` and `src/lib/rag/retrieval/search.ts` with matching Postgres index/migration where appropriate.
- Ranking preference: `src/lib/rag/retrieval/rerank.ts`; role-specific behavior belongs in `src/lib/rag/retrieval/por-rol.ts`.
- Regression: extend `scripts/eval-retrieval.ts` or add a focused script under `scripts/` using real catalog IDs.

**New RAG tool:**

- Declaration/schema and user-facing contract: `src/lib/ia/herramientas.ts`.
- Handler/state/observability: `src/lib/ia/registro-herramientas.ts`.
- Domain logic: `src/lib/rag/chat/` or the relevant RAG submodule; keep the generic loop in `packages/agente-core/` domain-neutral.
- Selection-like tools must pass through a backend whitelist and database revalidation, following `src/lib/rag/chat/validar.ts`.

**New budget role/band behavior:**

- Constants/recipes: `src/lib/rag/presupuesto/franjas.ts`.
- Plan invariants: `src/lib/rag/presupuesto/plan.ts`.
- Retrieval relaxation: `src/lib/rag/retrieval/por-rol.ts`.
- Score/diversity/assembly: `src/lib/rag/retrieval/rerank.ts`, `src/lib/rag/retrieval/diversidad.ts`, `src/lib/rag/presupuesto/ensamblar.ts`.
- Evaluation: `scripts/eval-presupuesto.ts` and `PLAN_RAG_FRANJAS_PRESUPUESTO.md`.

**New UI catalog feature:**

- Server-side catalog reads: `src/lib/shopify/consultas.ts` for the existing SQLite browse path, or `src/lib/rag/chat/` only when the feature truly requires RAG retrieval.
- HTTP endpoint: `src/app/api/catalogo/` or a domain-specific `src/app/api/` route.
- Components: `src/components/catalogo/` for catalog browsing, `src/components/admin/` for administration.
- Do not mix Postgres RAG reads into a SQLite route without defining consistency and fallback behavior.

**New operational check:**

- Add a script under `scripts/`, register an npm command in `package.json`, and document required env/DB state near existing `rag:health`, `rag:metrics`, and eval commands.

## Special Directories

**`node_modules/`:**

- Purpose: Installed dependencies, including Next, Gemini SDK, pg, Zod, and workspace package links.
- Generated: Yes.
- Committed: No.

**`.next/`:**

- Purpose: Next build/dev output and generated route types.
- Generated: Yes.
- Committed: No.

**`packages/agente-core/dist/`:**

- Purpose: Compiled workspace package output consumed by package exports.
- Generated: Yes by `packages/agente-core/package.json` build.
- Committed: No (`packages/*/dist` is ignored); source of truth is `packages/agente-core/src/`.

**`data/raw/`:**

- Purpose: Runtime raw Shopify snapshot from `scripts/import-shopify-catalog.ts`.
- Generated: Yes.
- Committed: No; directory is allowed but its contents are ignored.

**`data/demo.sqlite`:**

- Purpose: Runtime SQLite catalog/legacy state.
- Generated: Yes by `src/lib/db.ts`/sync; not present in the checked-in tree.
- Committed: No.

**`public/uploads/`:**

- Purpose: Runtime product/decorative images used by the legacy admin/image path.
- Generated: Yes.
- Committed: No.

**`.planning/codebase/`:**

- Purpose: GSD codebase mapping consumed by future planning/execution tasks.
- Generated: Yes by mapping work.
- Committed: The directory is in the workspace and these documents are intended planning artifacts; no prior map files existed during this audit.

## Operational Gaps Relevant to Structure

- `docker-compose.yml` defines Postgres but the audit found no running container, so the RAG runtime cannot be verified from this checkout without starting infrastructure and configuring `DATABASE_URL`.
- `.env.local` is empty/ignored, so `GEMINI_API_KEY`, `DATABASE_URL`, `RAG_ENABLED`, and optional webhook/model variables are not reproducibly configured.
- The repository has no `order_data.json` consumer or target directory; a future order-aware RAG feature needs a dedicated `src/lib/rag/orders/` (or equivalent) plus migrations and evaluation, rather than placing order records in product tables.
- The README's documented structure describes SQLite-only behavior and omits `src/lib/rag/`, `scripts/migrations/`, and the Postgres operational chain; it should be updated as part of reconstruction documentation.

---

*Structure analysis: 2026-08-21*
