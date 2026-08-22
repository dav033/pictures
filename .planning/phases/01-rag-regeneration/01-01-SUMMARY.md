---
phase: 01-rag-regeneration
plan: 01
subsystem: runtime-and-build
tags: [docker, postgres, pgvector, nextjs, typescript, quotation-ui]
requires: []
provides:
  - reproducible local PostgreSQL/pgvector Compose runtime
  - safe environment contract and optional-Gemini health check
  - passing Next.js production build with editable quotation props wired
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08]
tech-stack:
  added: []
  patterns:
    - loopback-only Compose binding with named volume
    - deterministic SQL health checks independent of Next server-only modules
    - client-side quotation draft confirmed through parent callback
key-files:
  created:
    - .env.example
    - scripts/stack-check.ts
    - .planning/phases/01-rag-regeneration/01-01-SUMMARY.md
  modified:
    - docker-compose.yml
    - package.json
    - .gitignore
    - src/components/TarjetaCotizacion.tsx
    - .planning/STATE.md
decisions:
  - "PostgreSQL is bound to 127.0.0.1 by default; the host and port remain explicit overrides."
  - "Gemini is reported as SKIPPED_OPTIONAL when no key is present; deterministic SQL/parser work remains runnable."
  - "pg_trgm is optional for plan 01 because its index/retrieval migration belongs to a later plan."
metrics:
  duration: "runtime pull, verification, and build completed on 2026-08-21"
  completed: 2026-08-21
---

# Phase 01 Plan 01: Runtime, Docker y build base — Summary

Runtime local reproducible y build Next.js 16.3.0 verificado, con la tarjeta de cotización conectada al hook editable que ya existía.

## Tasks completed

### Task 1 — Parametrizar compose y entorno

- `docker-compose.yml` ahora usa variables de entorno con defaults locales, bind `127.0.0.1`, healthcheck con `pg_isready` y el volumen nombrado existente/creado sin borrar volúmenes.
- `.env.example` declara PostgreSQL, dimensiones de embedding, flags RAG y Gemini opcional sin credenciales reales.
- `!.env.example` se añadió a `.gitignore` para que el contrato seguro pueda versionarse.

### Task 2 — Health check del stack

- `scripts/stack-check.ts` verifica conexión PostgreSQL, `vector`, `unaccent`, dimensión 768 y normalización Unicode.
- Gemini produce `SKIPPED_OPTIONAL` sin `GEMINI_API_KEY`.
- `pg_trgm` se muestra como `SKIPPED_OPTIONAL` hasta la migración de retrieval; no bloquea el runtime base.
- `npm run rag:stack-check` quedó registrado en `package.json`.

### Task 3 — Build y mismatch de props

- `TarjetaCotizacion` ahora declara `editable` y `onAplicar`, usa `useBorradorCotizacion` y mantiene el flujo existente de aplicar una edición a `page.tsx`.
- La UI permite cambiar paquetes, quitar/restaurar líneas, cancelar y confirmar cambios; las líneas sin referencia continúan siendo informativas.
- Se leyó la documentación instalada de Next.js sobre build, variables de entorno, Server/Client Components y Route Handlers antes de editar el componente.

## Verification evidence

- `docker compose --env-file .env.example config` — PASS; no hay secretos reales y el puerto queda en `127.0.0.1:5432`.
- `docker compose --env-file .env.example up -d postgres` — PASS; `pictures-postgres-1` quedó `Up (healthy)`.
- `npx tsx --env-file=.env.example scripts/migrate.ts` — PASS; 7 migraciones disponibles aplicadas al volumen local compartido.
- `npx tsx --env-file=.env.example scripts/stack-check.ts` — PASS: PostgreSQL READY, vector 0.8.6 READY, pgvector dimensión 768 READY, unaccent READY, pg_trgm SKIPPED_OPTIONAL, Gemini SKIPPED_OPTIONAL.
- `docker compose ... exec ... psql` — PASS; `unaccent('Árbol') = 'Arbol'` y `vector_dims(...768...) = 768`.
- `npx tsc --noEmit --pretty false --incremental false` — PASS.
- `npm run lint` — PASS con 3 warnings preexistentes/no bloqueantes en archivos de otros agentes (`validate-source-snapshots.ts`, `analizar-referencias-v2.ts`, `rag/sources/fetch.ts`).
- `npm run build` — PASS; compilación Turbopack, TypeScript, prerender y 21 rutas completados.
- `git diff --check` — PASS.

## Commits

- `cdd6ab3` — `feat(01-01): add reproducible local RAG runtime checks`
- `a4b68e3` — `fix(01-01): track safe environment template`
- `c23bc7d` — `fix(01-01): keep optional trigram health non-blocking`
- `5850312` — `fix(01-01): wire editable quotation card props`

## Deviations from plan

### 1. [Rule 3 — Blocking] `.env.example` was ignored by the repository pattern

- **Found during:** Task 1 verification.
- **Issue:** `.gitignore` matched `.env*`, so the safe template could not be tracked normally.
- **Fix:** Added `!.env.example` after the broad ignore rule and verified `git check-ignore .env.example` returns no match.
- **Commit:** `a4b68e3`.

### 2. [Rule 2 — Missing critical correctness] `pg_trgm` must not block the base health gate

- **Found during:** Task 2 verification against the phase dependency order.
- **Issue:** `pg_trgm` belongs to the later retrieval/index migration; requiring it in plan 01 would make a clean base runtime fail before that plan runs.
- **Fix:** Report it as `SKIPPED_OPTIONAL` when absent while keeping `vector` and `unaccent` required.
- **Commit:** `c23bc7d`.

## Authentication gates

None. No Gemini key was required for this plan; its absence was verified as an optional capability.

## Next phase readiness

The runtime/build gate is green. Continue with `01-02-PLAN.md` for source contracts and snapshot validation. Keep the local PostgreSQL container and named volume; do not remove them during subsequent plan execution.
