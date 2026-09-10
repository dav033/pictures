// Fase 5.3 (plan §12.3, auditoria/09-revision-fase-5.md secciones 2 y 5):
// este archivo es la única fuente de verdad para las capacidades de IA que
// se leen desde process.env. Antes había tres archivos con tres convenciones
// distintas (este, src/lib/plan/flags.ts, src/lib/rag/flags.ts) más media
// docena de lecturas sueltas de process.env repetidas en varios call sites.
// Se consolidan aquí sin normalizar la semántica de cada flag -- cada uno
// conserva su convención de parseo y su default original tal cual estaban en
// producción; cambiar eso sería una decisión de producto, no una limpieza.
//
// PYTHON_BACKEND_ENABLED / PYTHON_BACKEND_KILL_SWITCH quedan deliberadamente
// FUERA de este registro (ver auditoria/09-revision-fase-5.md, pregunta
// abierta 7): no son una capacidad de IA sino el selector de linaje
// Next/Python de la migración (capítulo 10.4/10.5), con su propia función
// dueña (`seleccionarBackendMigracion` en src/lib/ia/contracts/operational-v1.ts)
// donde el kill switch tiene precedencia absoluta sobre el enabled. Meterlo
// aquí arriesgaría diluir esa precedencia dentro del genérico "1/true/on".

export type FeatureFlag =
  | "REFERENCE_BLUEPRINT_V2"
  | "IMAGE_QA_ENABLED"
  | "LOCALIZED_EDIT_ENABLED"
  | "SCENE_PLAN_V2_SHADOW"
  | "SCENE_PLAN_V2_ENABLED"
  | "SCENE_PLAN_V2_REQUIRE_VERIFIED_SOURCES"
  | "SCENE_PLAN_V2_VISUAL_QA"
  | "SCENE_PLAN_V2_KILL_SWITCH"
  | "PLAN_COST_OPTIMIZER_V2"
  | "PLAN_BUDGET_GATE_V2"
  | "IMAGE_INSTANCE_QA";

export function featureEnabled(name: FeatureFlag): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    // Scene and image flags default OFF. The cost optimizer and budget gate
    // preserve the already validated V1 safety behavior unless explicitly
    // disabled for rollback.
    if (name.startsWith("SCENE_PLAN_V2_")) return false;
    if (name === "PLAN_COST_OPTIMIZER_V2" || name === "PLAN_BUDGET_GATE_V2") return true;
    if (name === "IMAGE_INSTANCE_QA") {
      // IMAGE_QA_VISION predates IMAGE_INSTANCE_QA. This must be the ONLY
      // place that decides this flag: `src/lib/ia/image-qa.ts` calls
      // `featureEnabled("IMAGE_INSTANCE_QA")` instead of reimplementing this
      // fallback, so the gate that requires QA for an approved plan
      // (`src/app/api/generate/route.ts`) and the QA call itself never
      // disagree about whether QA is actually going to run.
      const legacy = process.env.IMAGE_QA_VISION;
      if (legacy != null) return ["1", "true", "on"].includes(legacy.toLowerCase());
      return Boolean(process.env.GEMINI_API_KEY);
    }
    return true;
  }
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}

// --- RAG capability flags ---------------------------------------------
// Exact-match "true" parsing (not the "1/true/on" convention above) is the
// existing, load-bearing production behavior for this group -- preserved
// verbatim from src/lib/rag/flags.ts and src/lib/rag/retrieval/search.ts.

/** Default: OFF. Gates the RAG retrieval subsystem end-to-end (chat and budget flows). */
export const RAG_ENABLED = process.env.RAG_ENABLED === "true";
/** Default: OFF. Gates the budget-tier ("franjas de presupuesto") RAG mode. */
export const RAG_FRANJAS_ENABLED = process.env.RAG_FRANJAS_ENABLED === "true";
/** Default: OFF. Enables the vector retrieval branch; also needs a Gemini key at call sites that check it. */
export const RAG_USE_VECTOR = process.env.RAG_USE_VECTOR === "true";
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

// --- Plan capability flags -----------------------------------------------

/** Default: OFF ("1"/"true"/"on", case-insensitive). Preserved from src/lib/plan/flags.ts. */
export const PLAN_DECORACION_ENABLED = ["1", "true", "on"].includes((process.env.PLAN_DECORACION_ENABLED ?? "").toLowerCase());

// --- LoRA capability flags -------------------------------------------------

/** Default: OFF, and hard-gated to non-production regardless of the env var -- never allow a rejected LoRA run outside a developer's own machine. */
export const LORA_ALLOW_REJECTED_FOR_TESTING =
  process.env.NODE_ENV !== "production" && process.env.LORA_ALLOW_REJECTED_FOR_TESTING === "true";
/** Default: OFF (single-LoRA composition only) -- exact "true" match. */
export const FAL_MULTI_LORA_SUPPORTED = process.env.FAL_MULTI_LORA_SUPPORTED === "true";

// --- Debug flags -----------------------------------------------------------

/** Default: ON outside production, OFF in production unless IMAGE_DEBUG is explicitly "true". */
export const IMAGE_DEBUG = process.env.NODE_ENV !== "production" || process.env.IMAGE_DEBUG === "true";
