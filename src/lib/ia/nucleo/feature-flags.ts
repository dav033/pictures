// Este archivo es la única fuente de verdad para las capacidades de IA que se
// leen desde process.env. Los defaults de las capacidades activas forman parte
// del producto; los valores `false` siguen siendo kill-switches operativos.
// Python es el único backend de dominio (ADR-0023): no hay selector de backend.

export type FeatureFlag =
  | "SCENE_PLAN_V2_SHADOW"
  | "PLAN_COST_OPTIMIZER_V2"
  | "PLAN_BUDGET_GATE_V2"
  | "VENUE_AWARE_PLACEMENT_V1"
  | "MEASURED_COLOR_DOMINANCE_V1"
  | "AMBIENTE_FIESTA_V1"
  | "REFERENCIA_EN_ETAPA1_V1"
  | "PATRONES_COLOR_V1"
  | "BOUQUETS_ARMADO_V1";

export function featureEnabled(name: FeatureFlag): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    // Scene diagnostics default OFF. The production capabilities below default
    // ON; their explicit false values remain available as kill-switches.
    if (name.startsWith("SCENE_PLAN_V2_")) return false;
    // Default OFF: preserve the existing placement until the Phase 6.A
    // benchmark validates the venue-aware geometry in production.
    if (name === "VENUE_AWARE_PLACEMENT_V1") return false;
    // Default OFF: la paleta medida sobre píxeles reemplaza el orden de
    // redacción del analizador (fase 2.1) y cambia qué colores compra un plan,
    // así que espera a que el benchmark lo muestre.
    if (name === "MEASURED_COLOR_DOMINANCE_V1") return false;
    // Default OFF: el ambiente añade objetos a una imagen que se muestra junto a
    // un precio, así que se enciende cuando el aviso de "no cotizado" esté
    // visible en la UI y no antes (fase 6.B).
    if (name === "AMBIENTE_FIESTA_V1") return false;
    // Default OFF: mandar la referencia como píxeles a la etapa 1 cambia lo que
    // dibuja el LoRA, y elegir entre eso y editar el venue directamente exige la
    // evaluación de 10 planes de la fase 4.
    if (name === "REFERENCIA_EN_ETAPA1_V1") return false;
    // Default OFF (ADR-0028). Solo decide cuándo Python pone un patrón por su
    // cuenta: al confirmar un plan, Next pide `completar_patrones` con las
    // pistas de la foto (`pistas_patron`) y cada estructura geométrica de dos
    // colores o más recibe el patrón de su pista o su preset (§7); al editar,
    // una pieza que pasa de un color a dos recibe su preset (§9). Apagada, los
    // planes nuevos salen sin patrón y nada más cambia: un plan que ya trae
    // `patron_color` lo conserva, y la edición, la vista previa, el editor
    // ("Crear patrón" incluido) y la resolución lo tratan igual, porque
    // ninguno lee la bandera. Apagarla no quita patrones.
    if (name === "PATRONES_COLOR_V1") return false;
    // Default OFF (ADR-0030). Al confirmar un plan, Next pide
    // `completar_armados` con las lecturas de la foto (`pistas_armado`) y cada
    // bouquet sin armado recibe el de su lectura o su receta, sin cambiar lo
    // que se compra. Apagada, los planes nuevos salen sin armado; uno que ya lo
    // trae lo conserva.
    if (name === "BOUQUETS_ARMADO_V1") return false;
    return true;
  }
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}

// --- RAG capability flags ---------------------------------------------
// RAG flags use exact "false" parsing so an omitted variable enables the
// selected production capability while an explicit false remains a rollback.

/** Default: ON. Explicit false is the RAG rollback switch. */
export const RAG_ENABLED = process.env.RAG_ENABLED !== "false";
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
 * result order in production for no measured benefit.
 */
export const RAG_RERANK_ENABLED = process.env.RAG_RERANK_ENABLED === "true";

/** Default: OFF. Routes live RETRIEVAL_QUERY embeddings through Python. */
export const RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED =
  process.env.RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED === "true";

// --- AI-generativa migration flags (docs/architecture/decisions/0026) ------
// One flag per generative call being moved to Python, same shape as the RAG
// flags above: default OFF. Turning this on before validating the Python path would silently swap the
// provider round trip for the whole app; the TypeScript path is only removed
// once this has been on and compared in production.

/** Default: OFF. Routes Inari's Gemini call (the ambiguous-parse enrichment, not the deterministic-first parse) through Python. */
export const INTENT_PARSER_PYTHON_ENABLED = process.env.INTENT_PARSER_PYTHON_ENABLED === "true";

/** Default: OFF. Routes Amaterasu's two Gemini tool-calling passes (inventory + audit) through Python; the cache, retry loop and blueprint assembly stay in TypeScript either way. */
export const REFERENCE_ANALYSIS_PYTHON_ENABLED = process.env.REFERENCE_ANALYSIS_PYTHON_ENABLED === "true";

/** Default: OFF. Routes Uzume's Gemini Interactions call (image generation/composition) through Python; the labeled input array is still built in TypeScript either way. */
export const GEMINI_IMAGE_PYTHON_ENABLED = process.env.GEMINI_IMAGE_PYTHON_ENABLED === "true";

/** Default: OFF. Routes Kagutsuchi's fal.ai queue round trip (submit/poll/download, SSRF guard included) through Python; prompt composition and which references go to /edit stay in TypeScript either way. */
export const LORA_GENERATION_PYTHON_ENABLED = process.env.LORA_GENERATION_PYTHON_ENABLED === "true";

/** Default: OFF. Routes each Omoikane chat turn's Gemini stream through Python (docs/architecture/decisions/0027); the tool loop, the browser SSE, the prompt and the tools stay in TypeScript either way. Only /api/chat reads it -- Amaterasu's chatDe() is unaffected. */
export const CHAT_PYTHON_ENABLED = process.env.CHAT_PYTHON_ENABLED === "true";

/** Default: OFF. Routes Happie's two Gemini calls (the webhook chat extractor and the package recommender) through Python; prompts, the conversation state machine and the package id filter stay in TypeScript either way. */
export const HAPPIE_PYTHON_ENABLED = process.env.HAPPIE_PYTHON_ENABLED === "true";

/**
 * Default: OFF (docs/architecture/decisions/0028 §11). After the reference
 * analysis, asks Python to read each balloon structure's color pattern in the
 * photo and stores it on its blueprint element (`appearance.patron_color`).
 * It adds one Gemini call per analyzed photo; a failure never breaks the
 * analysis. Off: no hints, and confirmed plans take the preset pattern. The
 * hints only reach a plan while `PATRONES_COLOR_V1` is on.
 */
export const PATRON_REFERENCIA_PYTHON_ENABLED = process.env.PATRON_REFERENCIA_PYTHON_ENABLED === "true";

/**
 * Default: OFF (ADR-0030). After the reference analysis, asks Python to read
 * how each bouquet in the photo is assembled and stores it on its blueprint
 * element (`appearance.armado_bouquet`). One Gemini call per photo with
 * bouquets, in parallel with the pattern reading; a failure never breaks the
 * analysis. The readings only reach a plan while `BOUQUETS_ARMADO_V1` is on.
 */
export const BOUQUET_REFERENCIA_PYTHON_ENABLED = process.env.BOUQUET_REFERENCIA_PYTHON_ENABLED === "true";

// --- LoRA capability flags -------------------------------------------------

// --- Debug flags -----------------------------------------------------------

/** Default: ON in local development, OFF everywhere else unless explicit. */
export const IMAGE_DEBUG = process.env.IMAGE_DEBUG === "true" ||
  (process.env.NODE_ENV === "development" && process.env.IMAGE_DEBUG !== "false");
