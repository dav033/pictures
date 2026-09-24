# ADR-0025 — Retirar el QA visual; cada IA con su propio módulo nombrado

Date: 2026-09-21
Status: accepted
Supersedes: nothing.

## Problem

Two separate debts had accumulated around the app's AI-calling code.

1. Visual QA — a second Gemini call that judged a generated image against the
   approved plan, with a corrective retry and a 422 gate (`IMAGEN_NO_FIEL`) —
   had become unreliable enough that a temporary, uncommitted local flag
   (`IMAGE_QA_NON_BLOCKING`) was already bypassing its 422 for false positives
   such as "placement failure EST_01_GUIRNALDA". It doubled the cost of every
   generation that failed it (a second paid LoRA/Gemini call) for a signal
   nobody trusted enough to leave blocking in production.
2. Every AI-calling module lived flat in `src/lib/ia/`, indistinguishable by
   name from the deterministic/shared helpers next to it. Finding which file
   owned a given provider call, or its full input → prompt → output pipeline,
   meant grepping across the whole directory.

## Decisions

### 1. Visual QA is removed entirely, not throttled further

Removed: `src/lib/ia/image-qa.ts`, `src/lib/ia/generation-qa.ts`,
`src/components/references/GenerationQaSummary.tsx`, the feature flags
`IMAGE_QA_ENABLED`/`IMAGE_QA_NON_BLOCKING`, the `ui-error.v1` codes
`VALIDACION_VISUAL_REQUERIDA`/`IMAGEN_NO_FIEL` and the
`activar_validacion_visual` action, and — inside `/api/generate` — the
mandatory `IMAGE_QA_REQUIRED` gate, the one-shot corrective retry, and the
`qa`/`retried` response fields. The "Validar visualmente" checkbox and its
screen summary are gone from the UI; an approved plan now generates once and
returns whatever Uzume (composition) produced, with no second automated
judgment.

Rejected: keeping the scaffolding (`ImageQaReport`, the audit fields, the
retry shape) with the Gemini call swapped for a stub, in case a better
heuristic replaces it later. The scaffolding was half of what made the
feature expensive to reason about; reintroducing a QA step later is a fresh
design, not a flag flip, and carrying dead shape for a hypothetical is the
premature-generality this repo's own rules warn against.

Kept, because it was never QA's: `officialStructuresDePlan` — the plan's
declared official-structure map that both the corrective retry prompt and
the ordinary image prompt read — moved to a small local helper in
`route.ts` instead of disappearing with `qaPlanInputsFromPlan`.

### 2. The six AI-calling processes each get a named, self-contained folder

Every module whose job is to call a paid generative provider now lives under
`src/lib/ia/<name>/` (Python: `services/ai-api/app/watatsumi/`), named after
a Japanese mythological deity chosen to match the module's role, each with a
short README stating its input, output, provider/model and main consumer:

- **Omoikane** (wisdom, deviser of plans) — chat de edición de propuesta.
- **Inari** (commerce, messenger foxes that find things) — parser de
  intención del catálogo (RAG).
- **Amaterasu** (the sun, light that reveals) — análisis de foto de
  referencia.
- **Kagutsuchi** (fire and the forge) — generación/edición de producto LoRA.
- **Uzume** (dawn, dance, festivity) — composición final sobre la foto del
  espacio.
- **Watatsumi** (the sea, its depths) — embeddings de catálogo (búsqueda
  semántica).

Each folder holds only what a single provider call and its own prompt
construction actually own. Deterministic logic and contract types shared by
more than one consumer — `registro-herramientas.ts`/`herramientas.ts` (tool
registry, also used by plan editing), `registro.ts` (provider dispatch, used
by both chat and image generation), `reference-blueprint.ts`/
`reference-structure.ts` (the reference contract, used across the app),
`gemini.ts` (client + model constants) — stay in their shared location; the
god folders import from there like any other consumer. `rag/query-parser/`
keeps its deterministic-first pipeline (`deterministic.ts`, `event-search.ts`,
`parse-event.ts`, `hard-filters.ts`, `schema.ts`) outside Inari for the same
reason: none of it calls a provider, and most of it is used by more than the
one AI call.

Also deleted as dead code found during the audit: `src/lib/ia/analizar-referencias.ts`
(v1 of the reference analyser, no importers left since v2 shipped).

## Consequences

- An approved plan's image now costs one provider call path instead of up to
  two, with no 422 a customer could hit from a false QA positive.
- There is currently no automated check that a generated image matches the
  approved plan's cardinality/composition. If that turns out to matter, it is
  a new design (ADR of its own), not a revert of this one.
- `plan_audit_log.qa_hash` keeps its column but is written `null` from now on;
  no migration dropped it; it is inert history, not owned by this decision.
- Six READMEs are now the first thing to read before touching any of these
  providers, instead of the call site being the only documentation.

## Rollback

Visual QA: reverting this commit restores it whole (it was a clean deletion,
not a rewrite). The god-folder moves are pure `git mv` plus import-path
updates — reverting is mechanical and touches no contract, migration or
`plan_hash`.
