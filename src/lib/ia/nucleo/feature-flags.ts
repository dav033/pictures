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
  | "PATRONES_COLOR_V1"
  | "BOUQUETS_ARMADO_V1"
  | "GUIRNALDAS_ARMADO_V1"
  | "ARMADO_ARCO_COLUMNA_V1"
  | "ESTIMAR_CONTEO_V1"
  | "CONTEO_REFERENCIA_V1"
  | "ANALISIS_COLOR_SEMPERTEX_V1"
  | "GUIA_ESTRUCTURA_V1"
  | "GUIA_ESCENA_V1"
  | "GUIA_ESCENA_SIN_FOTO_V1";

/**
 * Valor por defecto de cada bandera: **el mismo en local y en producción**.
 *
 * Antes tres banderas se encendían solas fuera de producción (`NODE_ENV`) y el
 * resto de las capacidades de imagen quedaban apagadas: lo que se validaba en
 * local no era lo que generaba producción (auditoría 2026-10-04, K2). Decisión
 * del 2026-10-04 (D2): las capacidades que acercan la imagen al plan y a la foto
 * van **encendidas por defecto en todas partes**; una variable a `false` sigue
 * siendo el interruptor para apagarlas. Quedan apagadas solo cuatro, por motivo:
 *
 * - `SCENE_PLAN_V2_SHADOW`: diagnóstico en sombra, no cambia la imagen.
 * - `GUIA_ESTRUCTURA_V1`: el mapa de color por `/edit` se diseñó para el LoRA
 *   entrenado y cuesta dos imágenes de entrada más; sin medir con el modelo base.
 * - `ARMADO_ARCO_COLUMNA_V1` (decisión del dueño del 2026-10-05): con ella, la
 *   confirmación escribe la receta del motor en cada arco, columna y guirnalda
 *   nueva, y eso cambia la cotización de los planes nuevos de forma que nadie ha
 *   aprobado (arco clásico de 2,5 m 118 → 58 por el límite del arco angosto, arco
 *   orgánico de 3 × 2,4 m 119 → 263, columna orgánica de 1,8 m 35 → 80). Apagada
 *   hasta que el clasificador corrija el arco angosto y la guirnalda lujosa. En
 *   local se enciende con `ARMADO_ARCO_COLUMNA_V1=true` en `.env.local`, que es
 *   explícito: el valor por defecto sigue siendo el mismo en todas partes.
 *
 * `GUIA_ESCENA_V1` (encendida, como manda D2): con un plan que salió de una foto de referencia, FLUX recibe por
 * `/edit` UNA imagen plana con los globos de todas las piezas del plan (dibujados por el motor) colocados donde
 * la foto tiene cada pieza, en lugar de la foto, que nunca sale hacia fal. Una imagen de entrada más
 * (~US$ 0,021 estimados por generación). `false` vuelve a la generación solo con texto.
 *
 * `GUIA_ESCENA_SIN_FOTO_V1` (2026-10-07, «¿O sea FLUX también debería recibir el gráfico?»): la misma guía para los
 * planes SIN foto (de texto o de una idea del catálogo), con cada pieza a su escala real en metros
 * (`instanciasAEscala`) y la receta del motor en las piezas sin armado (la que enseña la gráfica del plan). Necesita
 * `GUIA_ESCENA_V1` encendida. **Encendida por defecto**: en la comparación real del 2026-10-07 (FLUX base, la misma
 * semilla con y sin guía; semiarco del dueño, semiarco + 2 columnas de fútbol, guirnalda de 2,4 m) la guía dejó cada
 * pieza con su forma y su escala (la guirnalda de 2,4 m dejó de salir de pared a pared, las columnas con su degradado
 * y su remate plano) sin empobrecer el entorno ni dar aspecto de dibujo. Coste: una imagen de entrada más
 * (~US$ 0,021 estimados) y unos segundos más (`/edit` y, en una pieza orgánica sin armado, su receta).
 *
 * Lo que hace cada una está en su ADR (ARMADO_ARCO_COLUMNA_V1 → ADR-0034,
 * ESTIMAR_CONTEO_V1 → ADR-0038, PATRONES_COLOR_V1 → ADR-0028,
 * BOUQUETS_ARMADO_V1 → ADR-0030, GUIRNALDAS_ARMADO_V1 → ADR-0032,
 * CONTEO_REFERENCIA_V1 → ADR-0031). Varias cambian `plan_hash`, cantidades o
 * precio de los planes **nuevos**; los ya aprobados no cambian.
 */
const DEFAULT_APAGADAS: ReadonlySet<FeatureFlag> = new Set<FeatureFlag>(["SCENE_PLAN_V2_SHADOW", "GUIA_ESTRUCTURA_V1", "ARMADO_ARCO_COLUMNA_V1"]);

export function featureEnabled(name: FeatureFlag): boolean {
  const raw = process.env[name];
  if (raw === undefined) return !DEFAULT_APAGADAS.has(name);
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}

/**
 * **Corta el flujo después del análisis de la foto.** Con esto encendido, soltar una foto de referencia
 * analiza y mide el color, y ahí se para: no sale el turno de chat automático, así que no se busca en el RAG,
 * no se arma un plan y no se cotiza nada.
 *
 * Está para poder mirar el análisis de color con fotos reales sin arrastrar todo lo demás. Default:
 * **apagada** — el flujo va entero hasta Omoikane, el plan y la cotización. Se enciende con
 * `NEXT_PUBLIC_SOLO_ANALISIS_FOTO=true` cuando se quiera volver a mirar solo el análisis.
 *
 * Se lee en el navegador, así que va por `NEXT_PUBLIC_` y `NODE_ENV`, que Next sí incrusta en el cliente;
 * `featureEnabled` no sirve para esto porque lee `process.env` con un nombre variable.
 *
 * Escribir a mano en el compositor sigue mandando el turno: lo que se corta es el automático. Para cortarlo
 * todo, el botón de enviar se deshabilita con esta misma constante.
 */
export const SOLO_ANALISIS_FOTO = process.env.NEXT_PUBLIC_SOLO_ANALISIS_FOTO === "true";

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

/**
 * Default: OFF (REQ-002). Enciende la búsqueda de la biblioteca del taller 3D en Postgres (`/api/taller/buscar`,
 * migración 028). Apagada, o si la base falla, se busca en memoria como hasta hoy. No encenderla antes de aplicar la
 * migración, indexar la biblioteca y pasar la evaluación contra la búsqueda por palabras.
 */
export const TALLER_RAG_ENABLED = process.env.TALLER_RAG_ENABLED === "true";

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

/** Default: OFF. Routes FLUX's fal.ai queue round trip through Python. */
const fluxGenerationPythonFlag = process.env.FLUX_GENERATION_PYTHON_ENABLED;
const legacyFluxGenerationPythonFlag = process.env.LORA_GENERATION_PYTHON_ENABLED;
if (fluxGenerationPythonFlag === undefined && legacyFluxGenerationPythonFlag !== undefined) {
  console.warn("LORA_GENERATION_PYTHON_ENABLED está obsoleta; usa FLUX_GENERATION_PYTHON_ENABLED.");
}
export const FLUX_GENERATION_PYTHON_ENABLED =
  (fluxGenerationPythonFlag ?? legacyFluxGenerationPythonFlag) === "true";

/** Default: OFF. Routes each Omoikane chat turn's Gemini stream through Python (docs/architecture/decisions/0027); the tool loop, the browser SSE, the prompt and the tools stay in TypeScript either way. Only /api/chat reads it -- Amaterasu's chatDe() is unaffected. */
export const CHAT_PYTHON_ENABLED = process.env.CHAT_PYTHON_ENABLED === "true";

/** Default: OFF. Routes Happie's two Gemini calls (the webhook chat extractor and the package recommender) through Python; prompts, the conversation state machine and the package id filter stay in TypeScript either way. */
export const HAPPIE_PYTHON_ENABLED = process.env.HAPPIE_PYTHON_ENABLED === "true";

/**
 * Default: ON since 2026-10-04 (D2; was OFF) (docs/architecture/decisions/0028 §11). After the reference
 * analysis, asks Python to read each balloon structure's color pattern in the
 * photo and stores it on its blueprint element (`appearance.patron_color`).
 * It adds one Gemini call per analyzed photo; a failure never breaks the
 * analysis. Off: no hints, and confirmed plans take the preset pattern. The
 * hints only reach a plan while `PATRONES_COLOR_V1` is on.
 */
export const PATRON_REFERENCIA_PYTHON_ENABLED = process.env.PATRON_REFERENCIA_PYTHON_ENABLED !== "false"; // Encendida por defecto (D2, 2026-10-04).

/**
 * Default: OFF (2026-09-25). The in-process cache of the reference analysis
 * (same photo, same prompt -> the stored blueprint, up to 40 photos) served a
 * stale analysis while the bouquet reading was being fixed and hid every fix
 * behind "the same photo". Off, every upload is analysed again (one Gemini
 * call, ~US$0.01); the gallery examples (`analisis-ejemplos.json`) and the
 * in-flight sharing of one identical request are not a cache and stay. Read
 * at call time so a test can turn it on.
 */
export function referenceAnalysisCacheEnabled(): boolean {
  return process.env.REFERENCE_ANALYSIS_CACHE_ENABLED === "true";
}

/**
 * Default: ON since 2026-10-04 (D2; was OFF) (ADR-0030). After the reference analysis, asks Python to read
 * how each bouquet in the photo is assembled and stores it on its blueprint
 * element (`appearance.armado_bouquet`). One Gemini call per photo with
 * bouquets, in parallel with the pattern reading; a failure never breaks the
 * analysis. The readings only reach a plan while `BOUQUETS_ARMADO_V1` is on.
 */
export const BOUQUET_REFERENCIA_PYTHON_ENABLED = process.env.BOUQUET_REFERENCIA_PYTHON_ENABLED !== "false"; // Encendida por defecto (D2, 2026-10-04).

/**
 * Default: ON since 2026-10-04 (D2; was OFF) (ADR-0031, E1). After the reference analysis, asks Python to
 * count the balloons of each balloon structure in the photo and stores the
 * reading on its blueprint element (`appearance.conteo`). One Gemini call per
 * photo with balloon structures, in parallel with the pattern and bouquet
 * readings and under the same deadline; a failure never breaks the analysis.
 * A plan only uses the reading when `CONTEO_REFERENCIA_V1` is also on (E2);
 * off, the blueprint is exactly what it was before.
 */
export const CONTEO_REFERENCIA_PYTHON_ENABLED = process.env.CONTEO_REFERENCIA_PYTHON_ENABLED !== "false"; // Encendida por defecto (D2, 2026-10-04).

/**
 * Default: ON since 2026-10-04 (D2; was OFF) (ADR-0032, E4). After the reference analysis, asks Python to
 * read how each garland in the photo is built (support, shape, clusters,
 * filler, toppers) and stores it on its blueprint element
 * (`appearance.armado_guirnalda`); with it on, the placement of each garland
 * is refined from that reading and the furniture of the photo
 * (`reubicarGuirnaldas`). One Gemini call per photo with garlands (arches and
 * half-arches included), in parallel with the other readings; a failure never
 * breaks the analysis. The readings only reach a plan while
 * `GUIRNALDAS_ARMADO_V1` is on, and never change what is bought.
 */
export const GUIRNALDA_REFERENCIA_PYTHON_ENABLED = process.env.GUIRNALDA_REFERENCIA_PYTHON_ENABLED !== "false"; // Encendida por defecto (D2, 2026-10-04).

/**
 * Default: ON since 2026-10-04 (D2; was OFF) (variante `v17-lectura-unica`). **Una sola IA mira la foto.** El
 * análisis de Amaterasu devuelve, en la misma llamada de visión y por elemento,
 * las cuatro lecturas que hoy se piden en cuatro llamadas más sobre la misma
 * imagen (patrón de color, conteo, armado del bouquet y armado de la
 * guirnalda); `app/lecturas_foto.py` las valida con los validadores de siempre
 * y el blueprint sale con la misma forma.
 *
 * Encendida cambia el prompt del análisis (a la variante `v17-lectura-unica`:
 * v16 tal cual más las reglas de las lecturas), su esquema de herramienta y su
 * tope de salida, así que el `system_prompt_hash`, el `config_hash` y la clave
 * de caché del análisis son otros: **la línea base de evaluación de ADR-0029 no
 * aplica a lo que salga de aquí**. Encendida por decisión del 2026-10-04 (D2); falta la corrida
 * que la compare contra v16 (reconocimiento y las cuatro lecturas a la vez).
 *
 * Apagada, la petición es byte a byte la de siempre: v16, `leerLecturasDeFoto`
 * y las cuatro banderas `*_REFERENCIA_PYTHON_ENABLED` de cada lectura. Las dos
 * no se mezclan: encendida, esas cuatro no se leen.
 */
export const LECTURA_UNICA_REFERENCIA_ENABLED = process.env.LECTURA_UNICA_REFERENCIA_ENABLED !== "false"; // Encendida por defecto (D2, 2026-10-04).

// --- LoRA capability flags -------------------------------------------------

// --- Debug flags -----------------------------------------------------------

/** Default: ON in local development, OFF everywhere else unless explicit. */
export const IMAGE_DEBUG = process.env.IMAGE_DEBUG === "true" ||
  (process.env.NODE_ENV === "development" && process.env.IMAGE_DEBUG !== "false");

/** Las banderas de `featureEnabled`, en el orden de su tipo: la lista para el resumen de arranque. */
const BANDERAS: readonly FeatureFlag[] = [
  "SCENE_PLAN_V2_SHADOW",
  "PLAN_COST_OPTIMIZER_V2",
  "PLAN_BUDGET_GATE_V2",
  "VENUE_AWARE_PLACEMENT_V1",
  "MEASURED_COLOR_DOMINANCE_V1",
  "AMBIENTE_FIESTA_V1",
  "PATRONES_COLOR_V1",
  "BOUQUETS_ARMADO_V1",
  "GUIRNALDAS_ARMADO_V1",
  "ARMADO_ARCO_COLUMNA_V1",
  "ESTIMAR_CONTEO_V1",
  "CONTEO_REFERENCIA_V1",
  "ANALISIS_COLOR_SEMPERTEX_V1",
  "GUIA_ESTRUCTURA_V1",
  "GUIA_ESCENA_V1",
  "GUIA_ESCENA_SIN_FOTO_V1",
] as const satisfies readonly FeatureFlag[];

/**
 * El valor EFECTIVO de cada bandera que cambia lo que se analiza, se arma o se
 * dibuja, para registrarlo una vez al arrancar. Solo nombres y booleanos: la
 * lista es explícita y nunca recorre `process.env`, así que no puede arrastrar
 * una clave, un secreto ni una URL de base de datos.
 *
 * Existe porque el `.env.production` del repositorio no es el entorno real (vive
 * en el servidor) y lo que se valida en local no era lo que generaba producción
 * (auditoría 2026-10-04, K2/S9): esta línea en el log del servidor es la verdad.
 */
export function resumenBanderas(): Record<string, boolean | string> {
  return {
    node_env: process.env.NODE_ENV ?? "unset",
    ...Object.fromEntries(BANDERAS.map((bandera) => [bandera, featureEnabled(bandera)])),
    LECTURA_UNICA_REFERENCIA_ENABLED,
    PATRON_REFERENCIA_PYTHON_ENABLED,
    BOUQUET_REFERENCIA_PYTHON_ENABLED,
    CONTEO_REFERENCIA_PYTHON_ENABLED,
    GUIRNALDA_REFERENCIA_PYTHON_ENABLED,
    REFERENCE_ANALYSIS_PYTHON_ENABLED,
    FLUX_GENERATION_PYTHON_ENABLED,
    CHAT_PYTHON_ENABLED,
    IMAGE_DEBUG,
  };
}

type LecturaDeFoto = "patron" | "bouquet" | "guirnalda" | "conteo";

/** Cada lectura de la foto y la bandera que la consume al confirmar un plan. */
export const CONSUMIDOR_DE_LECTURA: ReadonlyArray<{ lectura: LecturaDeFoto; consumidor: FeatureFlag }> = [
  // Las piezas con motor (arco, columna) también la usan vía ARMADO_ARCO_COLUMNA_V1; paredes y centros de mesa, solo así.
  { lectura: "patron", consumidor: "PATRONES_COLOR_V1" },
  { lectura: "bouquet", consumidor: "BOUQUETS_ARMADO_V1" },
  { lectura: "guirnalda", consumidor: "GUIRNALDAS_ARMADO_V1" },
  { lectura: "conteo", consumidor: "CONTEO_REFERENCIA_V1" },
];

/** Las lecturas que el análisis de la foto pide hoy: con la lectura única, las cuatro. */
export function lecturasEncendidas(): ReadonlySet<LecturaDeFoto> {
  if (LECTURA_UNICA_REFERENCIA_ENABLED) return new Set<LecturaDeFoto>(["patron", "bouquet", "guirnalda", "conteo"]);
  return new Set<LecturaDeFoto>([
    ...(PATRON_REFERENCIA_PYTHON_ENABLED ? (["patron"] as const) : []),
    ...(BOUQUET_REFERENCIA_PYTHON_ENABLED ? (["bouquet"] as const) : []),
    ...(GUIRNALDA_REFERENCIA_PYTHON_ENABLED ? (["guirnalda"] as const) : []),
    ...(CONTEO_REFERENCIA_PYTHON_ENABLED ? (["conteo"] as const) : []),
  ]);
}

/**
 * Lecturas que se pagan (una llamada de visión) y que nada consume al confirmar
 * el plan. Con `LECTURA_UNICA_REFERENCIA_ENABLED` encendida y los consumidores
 * apagados, en local se pagaban las cuatro y se tiraban tres (auditoría
 * 2026-10-04, M2). La lectura de patrón la consume también el motor, así que con
 * `ARMADO_ARCO_COLUMNA_V1` no se cuenta como perdida.
 */
export function lecturasSinConsumidor(): LecturaDeFoto[] {
  const encendidas = lecturasEncendidas();
  return CONSUMIDOR_DE_LECTURA
    .filter(({ lectura, consumidor }) => encendidas.has(lectura) && !featureEnabled(consumidor))
    .filter(({ lectura }) => !(lectura === "patron" && featureEnabled("ARMADO_ARCO_COLUMNA_V1")))
    .map(({ lectura }) => lectura);
}
