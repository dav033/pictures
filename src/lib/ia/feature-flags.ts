// Este archivo es la única fuente de verdad para las capacidades de IA que se
// leen desde process.env. Los defaults de las capacidades activas forman parte
// del producto; los valores `false` siguen siendo kill-switches operativos.
//
// PYTHON_BACKEND_ENABLED / PYTHON_BACKEND_KILL_SWITCH quedan deliberadamente
// fuera de este registro: no son una capacidad de IA sino el selector de linaje
// Next/Python de la migración (capítulo 10.4/10.5), con su propia función
// dueña (`seleccionarBackendMigracion` en src/lib/ia/contracts/operational-v1.ts)
// donde el kill switch tiene precedencia absoluta sobre el enabled. Meterlo
// aquí arriesgaría diluir esa precedencia dentro del genérico "1/true/on".

export type FeatureFlag =
  | "IMAGE_QA_ENABLED"
  | "SCENE_PLAN_V2_SHADOW"
  | "PLAN_COST_OPTIMIZER_V2"
  | "PLAN_BUDGET_GATE_V2";

export function featureEnabled(name: FeatureFlag): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    // Scene diagnostics default OFF. The production capabilities below default
    // ON; their explicit false values remain available as kill-switches.
    if (name.startsWith("SCENE_PLAN_V2_")) return false;
    if (name === "PLAN_COST_OPTIMIZER_V2" || name === "PLAN_BUDGET_GATE_V2") return true;
    if (name === "IMAGE_QA_ENABLED") return false;
    return true;
  }
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}

// --- RAG capability flags ---------------------------------------------
// RAG flags use exact "false" parsing so an omitted variable enables the
// selected production capability while an explicit false remains a rollback.

/** Default: ON. Explicit false is the RAG rollback switch. */
export const RAG_ENABLED = process.env.RAG_ENABLED !== "false";
/** Default: ON. Explicit false disables budget-tier RAG mode. */
export const RAG_FRANJAS_ENABLED = process.env.RAG_FRANJAS_ENABLED !== "false";
/** Default: ON. Missing provider credentials still degrade to lexical search. */
export const RAG_USE_VECTOR = process.env.RAG_USE_VECTOR !== "false";
/** Default: ON. Disabled only by the literal string "false" -- inverted polarity from the other RAG flags on purpose (full-text is the primary retrieval branch). */
export const RAG_USE_FULLTEXT = process.env.RAG_USE_FULLTEXT !== "false";
/** Default: ON. Disabled only by the literal string "false" -- same inverted-polarity reasoning as RAG_USE_FULLTEXT. */
export const RAG_USE_TRIGRAM = process.env.RAG_USE_TRIGRAM !== "false";
/**
 * Default: OFF (Fase 8.2, docs/migracion-python/PLAN-MAESTRO-V2.md). Gates
 * cross-encoder reranking of the already-whitelisted candidate list via the
 * Python service. Explicit default, not implicit: turning this on before
 * the before/after evaluation confirms it helps would risk regressing
 * result order in production for no measured benefit. Also requires the
 * Python backend to be selected (seleccionarBackendMigracion) -- if it is
 * not, retrieval silently skips reranking rather than failing the request.
 */
export const RAG_RERANK_ENABLED = process.env.RAG_RERANK_ENABLED === "true";

/** Default: OFF. Routes live RETRIEVAL_QUERY embeddings through Python. */
export const RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED =
  process.env.RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED === "true";

// --- Image QA flags --------------------------------------------------------

/**
 * Default: OFF. TEMPORARY (2026-09-15, requested to unblock local E2E): when
 * "true", a Gemini image the visual QA marks non-conforming is returned with
 * `qa.pass: false` (as the LoRA path already does) instead of a 422
 * IMAGEN_NO_FIEL. QA, the corrective retry and the audit still run, and the
 * page keeps showing the "may not reflect the proposal" notice. Remove once the
 * placement false positives (e.g. EST_01_GUIRNALDA) are fixed.
 */
export const IMAGE_QA_NON_BLOCKING = process.env.IMAGE_QA_NON_BLOCKING === "true";

// --- LoRA capability flags -------------------------------------------------

// --- Debug flags -----------------------------------------------------------

/** Default: ON in local development, OFF everywhere else unless explicit. */
export const IMAGE_DEBUG = process.env.IMAGE_DEBUG === "true" ||
  (process.env.NODE_ENV === "development" && process.env.IMAGE_DEBUG !== "false");
