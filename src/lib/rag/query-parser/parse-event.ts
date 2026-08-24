/**
 * Extractor determinista de `EventIntentV2` desde un mensaje en español
 * (Tarea 04.1 — `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 9.1 paso
 * 1 / "Plan 04, Tarea 04.1" en la sección 11).
 *
 * `parseEventIntent(mensaje, contexto?)` es una función PURA y determinista:
 * mismo `mensaje` + mismo `contexto` produce siempre el mismo
 * `EventIntentV2` (mismos valores, mismo orden de arreglos). No llama a
 * ningún LLM ni proveedor externo — es el mismo enfoque "determinista
 * primero" que ya usa el parser V2 clásico de este mismo directorio
 * (`./deterministic.ts`, función `interpretarConsultaDeterminista`): reglas
 * de texto explícitas, sin adivinar. Si el diseño final necesita un LLM para
 * casos ambiguos, ese LLM se conectaría en un wrapper async posterior (igual
 * que `./parse.ts` envuelve `interpretarConsultaDeterminista` con Gemini
 * como enriquecimiento opcional) — esta tarea entrega el camino determinista,
 * no el wrapper.
 *
 * RELACIÓN CON EL PARSER V2 CLÁSICO (`./schema.ts` + `./parse.ts` +
 * `./deterministic.ts`): ese parser produce una consulta PLANA por mensaje
 * (una lista de filtros para una sola búsqueda de productos — el problema
 * diagnosticado en la sección 2.3 del plan). Este módulo no lo reemplaza ni
 * lo reutiliza como dependencia directa: produce una INTENCIÓN DE EVENTO
 * completa (`EventIntentV2`), estructuralmente distinta (una intención, no
 * una consulta), que después se expande a un `SceneProgramV1` con varios
 * slots (`src/lib/scene/recipes.ts`) y SOLO ENTONCES se convierte en
 * múltiples consultas — una por slot (`./retrieval/slot-query-planner.ts`).
 * Lo que SÍ se reutiliza directamente de la infraestructura del parser
 * clásico es su capa de taxonomía compartida
 * (`src/lib/rag/taxonomy/v2.ts`): `clasificarColores` para paleta/color y
 * `plegarTexto` para normalización de texto — ambas ya prueban aliases,
 * acentos y ambigüedad de colores del catálogo real, así que reescribirlas
 * aquí sería duplicar lógica ya verificada.
 *
 * RELACIÓN CON `src/lib/plan/restricciones.ts`: ese módulo extrae
 * `RestriccionesUsuario` (presupuesto/estructuras/colores/tamaños/acabados
 * con procedencia `explicito|inferido|supuesto` y polaridad
 * `obligatorio|prohibido|preferencia`) para el dominio de PRESUPUESTO/PLAN
 * V1. Este extractor resuelve un problema estructuralmente distinto — una
 * INTENCIÓN DE EVENTO (vistas, complejidad, zona del venue), no un plan de
 * estructuras — así que no lo importa como dependencia (sus funciones
 * relevantes tampoco están exportadas: `extraerTecho`, `numero`, `ESTRUCTURAS`
 * son locales a ese archivo). En su lugar, este módulo MIRRORS
 * deliberadamente el mismo patrón de extracción determinista con
 * procedencia por campo — mismo vocabulario `EventFieldProvenance`
 * (`event-schema.ts`), mismas heurísticas de formato numérico colombiano
 * (puntos como separador de miles) y la misma idea de "mención literal no
 * negada = explícito" para colores/estructuras — para que ambos extractores
 * sean conceptualmente compatibles según exige la Tarea 04.1, sin acoplar
 * este módulo a cambios paralelos en el dominio de presupuesto.
 *
 * REGLA CRÍTICA (sección "IMPORTANTE" de la Tarea 04.1): el LLM —o, aquí, el
 * conjunto de reglas deterministas que hace sus veces— NUNCA convierte una
 * preferencia de estilo/ambiente (p. ej. "glamour", "bohemio", "rústico") en
 * un filtro duro. El léxico de `STYLE_TERM_LEXICON` (términos de ambiente) y
 * el léxico de restricciones duras (colores de catálogo, tipos de
 * estructura, tamaños, acabados de catálogo) son conjuntos DISJUNTOS a
 * propósito: ninguna regla de este archivo traduce un término de estilo a
 * una restricción dura. Ver `detectStyleAndHardCandidates` más abajo.
 */

import { TIPOS_ESTRUCTURA, type TipoEstructura } from "@/lib/plan/tipos";
import { clasificarAcabados, clasificarColores, plegarTexto } from "@/lib/rag/taxonomy/v2";
import { EventIntentV2Schema, type ComplexityProfile, type EventIntentV2, type EventScope, type RequestedView } from "@/lib/scene/tipos";
import {
  RawEventIntentDraftSchema,
  type RawEventIntentDraft,
  type RawField,
  type RawHardConstraintCandidate,
} from "./event-schema";

// ---------------------------------------------------------------------------
// Defaults deterministas — documentados uno a uno (exigencia de la Tarea 04.1).
// ---------------------------------------------------------------------------

/**
 * DEFAULT — `event_scope`: sección 3 del plan fija `ceremony_view` como
 * "unidad renderizable principal" del primer lanzamiento; una mención
 * genérica de "boda" sin más señal (E2E-1, `wedding-intents.ts`) se
 * interpreta como `"ceremony"`.
 */
export const DEFAULT_EVENT_SCOPE: EventScope = "ceremony";

/**
 * DEFAULT — `complexity_requested`: sección 5.1, "`balanced_scene`: valor
 * predeterminado para 'boda'".
 */
export const DEFAULT_COMPLEXITY: ComplexityProfile = "balanced_scene";

/**
 * DEFAULT — `requested_views`: se derivan 1:1 de `event_scope` cuando el
 * mensaje no nombra una vista explícita adicional (regla documentada en
 * `detectRequestedViews`): `ceremony -> ["ceremony"]`, `reception ->
 * ["reception"]`, `both -> ["ceremony", "reception"]`.
 */
export function deriveDefaultRequestedViews(scope: EventScope): RequestedView[] {
  if (scope === "both") return ["ceremony", "reception"];
  return [scope];
}

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

const fold = plegarTexto;

/** Colombiano: puntos como separador de miles. Mismo criterio que `src/lib/plan/restricciones.ts`#extraerTecho y `./deterministic.ts`#parsePrice (ninguna exportada). */
function parseColombianAmount(raw: string, suffix?: string): number | null {
  const cleaned = raw.replace(/\./g, "").replace(/,/g, "");
  const base = Number(cleaned);
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.round(base * (suffix ? 1000 : 1));
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

function parseCount(raw: string): number | null {
  const key = fold(raw);
  if (NUMBER_WORDS[key] !== undefined) return NUMBER_WORDS[key];
  const n = Number(key);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// event_scope / requested_views / complexity_requested
// ---------------------------------------------------------------------------

const CEREMONY_WORDS = /\b(ceremonia|altar|votos)\b/;
const RECEPTION_WORDS = /\b(recepcion|fiesta|banquete|brindis)\b/;

/**
 * `event_scope`: "both" solo cuando el texto nombra explícitamente ceremonia
 * Y recepción a la vez (procedencia "explicito" — ambas palabras están
 * literalmente ahí); "reception" cuando solo aparece vocabulario de
 * recepción; "ceremony" en cualquier otro caso (incluida la mención genérica
 * de "boda" sin más detalle — procedencia "supuesto", el default de la
 * sección 3).
 */
function detectEventScope(folded: string): RawField<EventScope> {
  const hasCeremony = CEREMONY_WORDS.test(folded);
  const hasReception = RECEPTION_WORDS.test(folded);
  if (hasCeremony && hasReception) {
    return { value: "both", provenance: "explicito", source_text: "ceremonia + recepción mencionadas" };
  }
  if (hasReception && !hasCeremony) {
    return { value: "reception", provenance: "explicito", source_text: "recepción mencionada" };
  }
  return {
    value: "ceremony",
    provenance: hasCeremony ? "explicito" : "supuesto",
    source_text: hasCeremony ? "ceremonia mencionada" : "",
  };
}

const ENTRANCE_WORDS = /\b(entrada|bienvenida)\b/;
const DETAIL_WORDS = /\b(detalle|detalles|close ?up)\b/;

/**
 * `requested_views`: parte del default determinista de `event_scope`
 * (`deriveDefaultRequestedViews`) y AÑADE `"entrance"`/`"detail"` solo si el
 * texto los nombra explícitamente — nunca los quita ni los sustituye.
 */
function detectRequestedViews(folded: string, eventScope: EventScope): RawField<RequestedView[]> {
  const base = deriveDefaultRequestedViews(eventScope);
  const additions: RequestedView[] = [];
  if (ENTRANCE_WORDS.test(folded)) additions.push("entrance");
  if (DETAIL_WORDS.test(folded)) additions.push("detail");
  if (additions.length === 0) {
    return { value: base, provenance: "supuesto", source_text: "" };
  }
  return {
    value: Array.from(new Set([...base, ...additions])),
    provenance: "explicito",
    source_text: additions.join(", "),
  };
}

const FOCAL_ONLY_TRIGGER = /\b(solo quiero|solamente quiero|unicamente quiero|solo necesito|exclusivamente quiero|nada mas)\b/;
const IMMERSIVE_TRIGGER = /\b(inmersiv\w*|muy completa|con de todo|todo incluido|decoracion completa|bien completa)\b/;

/**
 * `complexity_requested` — orden de precedencia, de mayor a menor:
 *   1. Petición explícita de UNA sola instalación ("solo quiero...", "nada
 *      más") => `focal_only` (E2E-3). Gana sobre cualquier otra señal: si el
 *      cliente pide "solo" algo, eso es más específico que cualquier default.
 *   2. `event_scope === "both"` (ceremonia Y recepción mencionadas) =>
 *      `full_event` (E2E-6). Procedencia "inferido": el cliente no escribió
 *      literalmente la palabra "full_event", pero mencionar ambas partes del
 *      evento es una señal concreta y no una suposición sin base.
 *   3. Lenguaje de "decoración rica/inmersiva" explícito => `immersive_scene`
 *      (E2E-5).
 *   4. Default determinista: `balanced_scene` (sección 5.1).
 */
function detectComplexity(folded: string, eventScope: EventScope): RawField<ComplexityProfile> {
  const focalMatch = folded.match(FOCAL_ONLY_TRIGGER);
  if (focalMatch) {
    return { value: "focal_only", provenance: "explicito", source_text: focalMatch[0] };
  }
  if (eventScope === "both") {
    return { value: "full_event", provenance: "inferido", source_text: "event_scope both" };
  }
  const immersiveMatch = folded.match(IMMERSIVE_TRIGGER);
  if (immersiveMatch) {
    return { value: "immersive_scene", provenance: "explicito", source_text: immersiveMatch[0] };
  }
  return { value: DEFAULT_COMPLEXITY, provenance: "supuesto", source_text: "" };
}

// ---------------------------------------------------------------------------
// budget_cop
// ---------------------------------------------------------------------------

const BUDGET_PATTERN =
  /(?:presupuesto|techo|tope|hasta|maximo|no mas de|menos de)\s*(?:es\s+de|de|es|:)?\s*\$?\s*([\d.,]+)\s*(mil|k)?/i;

/**
 * Normalización que SOLO quita acentos y pasa a minúsculas — a diferencia de
 * `plegarTexto`/`fold` (`src/lib/rag/taxonomy/v2.ts`), NUNCA elimina puntos
 * ni comas. `fold` colapsa "150.000" a "150 000" (dos tokens separados por
 * espacio), lo que destruye el separador de miles colombiano antes de que
 * `parseColombianAmount` pueda leerlo. `detectBudgetCop` necesita el texto
 * con su puntuación intacta; mismo criterio de normalización que
 * `src/lib/plan/restricciones.ts`#normalizar (no exportada).
 */
function normalizeKeepingPunctuation(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * `budget_cop`: solo cuando el texto lleva una palabra disparadora explícita
 * (presupuesto/techo/tope/hasta/máximo/...) — nunca adivina un número
 * cualquiera como si fuera presupuesto. Mismo criterio de formato que
 * `src/lib/plan/restricciones.ts`#extraerTecho (puntos = miles). Opera sobre
 * `source` (con puntuación), no sobre el texto "folded" usado por el resto
 * de los detectores — ver `normalizeKeepingPunctuation`.
 */
function detectBudgetCop(source: string): RawField<number> | undefined {
  const normalized = normalizeKeepingPunctuation(source);
  const match = normalized.match(BUDGET_PATTERN);
  if (!match) return undefined;
  const amount = parseColombianAmount(match[1]!, match[2]);
  if (amount === null) return undefined;
  return { value: amount, provenance: "explicito", source_text: match[0] };
}

// ---------------------------------------------------------------------------
// venue.environment
// ---------------------------------------------------------------------------

const OUTDOOR_WORDS = /\b(jardin|aire libre|exterior|patio|terraza|campestre|playa|finca)\b/;
const INDOOR_WORDS = /\b(salon|interior|bajo techo|indoor)\b/;

/**
 * `venue.environment`: solo se fija cuando el texto es inequívoco (una sola
 * de las dos familias de palabras aparece). Si aparecen ambas, o ninguna, se
 * deja `undefined` — nunca se adivina el ambiente del lugar.
 */
function detectVenueEnvironment(folded: string): RawField<"indoor" | "outdoor"> | undefined {
  const outdoor = OUTDOOR_WORDS.test(folded);
  const indoor = INDOOR_WORDS.test(folded);
  if (outdoor && !indoor) {
    return { value: "outdoor", provenance: "explicito", source_text: folded.match(OUTDOOR_WORDS)?.[0] ?? "" };
  }
  if (indoor && !outdoor) {
    return { value: "indoor", provenance: "explicito", source_text: folded.match(INDOOR_WORDS)?.[0] ?? "" };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// existing_asset_refs (hook de foto del lugar)
// ---------------------------------------------------------------------------

const EXISTING_ASSET_PATTERN = /ya (?:tenemos|hay|existe|contamos con)\s+([^,.;]+)/gi;

/**
 * `existing_asset_refs`: captura best-effort de menciones literales de "ya
 * tenemos/hay X" en el texto (procedencia "explicito"). El análisis real de
 * foto del lugar (visión) es un hook sin implementar todavía (sección 7.1:
 * `venue.existing_asset_refs`, sección 6.4: "venue_existing requiere una
 * región de foto o confirmación explícita"): si el caller ya tiene
 * descripciones resueltas por otra vía (p. ej. un análisis de imagen futuro),
 * las pasa en `contexto.existingAssetRefs` y aquí se agregan con procedencia
 * "inferido" — nunca "explicito", porque esta función no las derivó de texto
 * literal del cliente.
 */
function detectExistingAssetRefs(mensaje: string, contexto: ParseEventContext): RawField<string[]> | undefined {
  const fromText: string[] = [];
  for (const match of mensaje.matchAll(EXISTING_ASSET_PATTERN)) {
    const description = match[1]?.trim();
    if (description) fromText.push(description);
  }
  const fromContext = contexto.existingAssetRefs ?? [];
  const combined = Array.from(new Set([...fromText, ...fromContext]));
  if (combined.length === 0) return undefined;
  return {
    value: combined,
    provenance: fromText.length > 0 ? "explicito" : "inferido",
    source_text: fromText.join("; "),
  };
}

// ---------------------------------------------------------------------------
// palette / style_terms / hard_constraint_candidates
// ---------------------------------------------------------------------------

/**
 * Léxico de términos de AMBIENTE/ESTILO — deliberadamente DISJUNTO de
 * cualquier vocabulario que alimente `hard_constraint_candidates` (colores
 * de catálogo, tipos de estructura, tamaños, acabados). Esta es la garantía
 * estructural de la regla crítica de la Tarea 04.1: "glamour" nunca puede
 * volverse un filtro duro porque este léxico solo escribe en `style_terms`,
 * nunca en `hard_constraint_candidates` — no existe ninguna tabla en este
 * archivo que traduzca "glamour" a "reflex" o a cualquier otro atributo de
 * catálogo.
 */
const STYLE_TERM_LEXICON = [
  "glamour", "glamuroso", "glamurosa", "rustico", "rustica", "romantico", "romantica",
  "bohemio", "bohemia", "boho", "vintage", "elegante", "moderno", "moderna",
  "campestre", "tropical", "minimalista", "clasico", "clasica", "chic", "fantasia",
] as const;

function detectStyleTerms(folded: string): RawField<string[]> | undefined {
  const found = STYLE_TERM_LEXICON.filter((term) => new RegExp(`\\b${term}\\b`).test(folded));
  if (found.length === 0) return undefined;
  return { value: Array.from(new Set(found)), provenance: "explicito", source_text: found.join(", ") };
}

function isNegatedMention(folded: string, needle: string): boolean {
  const foldedNeedle = fold(needle);
  return folded.includes(`sin ${foldedNeedle}`) || folded.includes(`no ${foldedNeedle}`);
}

/**
 * Color(es) mencionados literalmente y NO negados ("sin blanco"/"no blanco").
 * Reutiliza `clasificarColores` (`src/lib/rag/taxonomy/v2.ts`, ya usado por
 * el parser V2 clásico) en vez de reimplementar el matching de alias de
 * color del catálogo. Solo se acepta `status === "known"`: una interpretación
 * ambigua ("azul o verde") nunca se convierte en preferencia ni en
 * restricción dura — la Tarea 04.1 exige que la incertidumbre nunca se
 * redondee hacia un filtro.
 */
function detectColors(mensaje: string, folded: string): { palette?: RawField<string[]>; hardCandidate?: RawHardConstraintCandidate } {
  const match = clasificarColores(mensaje);
  if (match.status !== "known" || match.values.length === 0) return {};
  const nonNegated = match.values.filter((color) => !isNegatedMention(folded, color));
  if (nonNegated.length === 0) return {};
  return {
    palette: { value: nonNegated, provenance: "explicito", source_text: mensaje },
    hardCandidate: {
      key: "color",
      value: nonNegated,
      provenance: "user",
      source_text: mensaje,
      rule_id: "color_literal_mention",
    },
  };
}

/** Alias mínimo de tipos de estructura — mirror deliberado de `ESTRUCTURAS` en `src/lib/plan/restricciones.ts` (no exportado). Vocabulario: `TIPOS_ESTRUCTURA` (`src/lib/plan/tipos.ts`, exportado). */
const STRUCTURE_ALIASES: Array<{ tipo: TipoEstructura; aliases: string[] }> = [
  { tipo: "arco", aliases: ["arco", "arcos"] },
  { tipo: "columna", aliases: ["columna", "columnas"] },
  { tipo: "guirnalda", aliases: ["guirnalda", "guirnaldas"] },
  { tipo: "semiarco", aliases: ["semiarco", "semiarcos"] },
  { tipo: "pared", aliases: ["pared", "paredes"] },
  { tipo: "centro_mesa", aliases: ["centro de mesa", "centros de mesa"] },
  { tipo: "backdrop", aliases: ["backdrop", "telon"] },
];

// Self-check: cada `tipo` de STRUCTURE_ALIASES debe pertenecer al vocabulario
// exportado real (`TIPOS_ESTRUCTURA`, `src/lib/plan/tipos.ts`) — falla en
// tiempo de carga del módulo si algún día ese enum cambia y este alias local
// queda desalineado, en vez de fallar en silencio dentro de un candidato mal
// tipado.
const KNOWN_STRUCTURE_TYPES = new Set<TipoEstructura>(TIPOS_ESTRUCTURA);
for (const structure of STRUCTURE_ALIASES) {
  if (!KNOWN_STRUCTURE_TYPES.has(structure.tipo)) {
    throw new Error(`STRUCTURE_ALIASES: tipo "${structure.tipo}" no pertenece a TIPOS_ESTRUCTURA`);
  }
}

const NUMBER_WORD_ALTERNATION = Object.keys(NUMBER_WORDS).join("|");

/**
 * Estructura focal explícita ("un arco", "dos columnas"): exige un
 * cuantificador (dígito o palabra-número, incluido "un/una") inmediatamente
 * antes o después del alias — igual que el patrón de
 * `src/lib/plan/restricciones.ts`. Una mención SIN cuantificador ("quiero
 * arco") no produce candidato: no hay manera determinista de saber si es
 * "un arco" o una mención genérica sin comprometerse a un número inventado.
 */
function detectStructureCandidate(folded: string): RawHardConstraintCandidate | undefined {
  for (const structure of STRUCTURE_ALIASES) {
    const aliasAlt = structure.aliases.map((a) => fold(a)).join("|");
    const pattern = new RegExp(
      `\\b(\\d+|${NUMBER_WORD_ALTERNATION})\\s+(?:${aliasAlt})\\b|\\b(?:${aliasAlt})\\s+(\\d+|${NUMBER_WORD_ALTERNATION})\\b`,
      "i",
    );
    const match = folded.match(pattern);
    if (!match) continue;
    if (isNegatedMention(folded, structure.aliases[0]!)) continue;
    const count = parseCount(match[1] ?? match[2] ?? "1") ?? 1;
    return {
      key: "estructura_focal",
      value: { tipo: structure.tipo, cantidad: count },
      provenance: "user",
      source_text: match[0],
      rule_id: "structure_literal_mention",
    };
  }
  return undefined;
}

const SIZE_PATTERN = /\br[- ]?(5|9|12|18|24|36|40)\b|\b(5|9|12|18|24|36|40)\s*(?:pulgadas?|in)\b/gi;

function detectSizeCandidate(folded: string): RawHardConstraintCandidate | undefined {
  const codes = new Set<string>();
  for (const match of folded.matchAll(SIZE_PATTERN)) {
    const size = match[1] ?? match[2];
    if (size) codes.add(`R-${size}`);
  }
  if (codes.size === 0) return undefined;
  return {
    key: "tamano",
    value: Array.from(codes),
    provenance: "user",
    source_text: [...folded.matchAll(SIZE_PATTERN)].map((m) => m[0]).join(", "),
    rule_id: "size_literal_mention",
  };
}

/**
 * Acabado de catálogo mencionado LITERALMENTE (p. ej. "quiero globos
 * reflex"). Reutiliza `clasificarAcabados` (taxonomy v2). Distinto de
 * `STYLE_TERM_LEXICON`: un acabado es un atributo de catálogo nombrado
 * directamente por el cliente, no una palabra de ambiente — esta función
 * jamás se dispara a partir de "glamour", "romántico", etc., porque esas
 * palabras no están en `ACABADOS_CATALOGO_V2`.
 */
function detectFinishCandidate(mensaje: string, folded: string): RawHardConstraintCandidate | undefined {
  const match = clasificarAcabados(mensaje);
  if (match.status !== "known" || match.values.length === 0) return undefined;
  const nonNegated = match.values.filter((finish) => !isNegatedMention(folded, finish));
  if (nonNegated.length === 0) return undefined;
  return {
    key: "acabado",
    value: nonNegated,
    provenance: "user",
    source_text: mensaje,
    rule_id: "finish_literal_mention",
  };
}

// ---------------------------------------------------------------------------
// Contexto opcional del caller
// ---------------------------------------------------------------------------

export type ParseEventContext = {
  /** Referencias de elementos ya existentes en el lugar, resueltas por otra vía (p. ej. un análisis de foto futuro — hook, sin implementar aquí). */
  existingAssetRefs?: string[];
  /** Ubicación estructurada ya conocida por el caller (p. ej. de un formulario previo) — este extractor no hace NLP de direcciones. */
  eventLocation?: { country: string; city: string; venue_id?: string };
  /** Período de alquiler ya conocido por el caller — este extractor no hace NLP de fechas. */
  rentalPeriod?: { starts_at: string; ends_at: string };
  eventDate?: string;
};

// ---------------------------------------------------------------------------
// Borrador crudo (exportado para inspección/testing sin pasar por el schema final)
// ---------------------------------------------------------------------------

export function buildRawEventIntentDraft(mensaje: string, contexto: ParseEventContext = {}): RawEventIntentDraft {
  const source = mensaje.trim();
  const folded = fold(source);

  const eventScope = detectEventScope(folded);
  const requestedViews = detectRequestedViews(folded, eventScope.value);
  const complexity = detectComplexity(folded, eventScope.value);
  const budget = detectBudgetCop(mensaje);
  const venueEnvironment = detectVenueEnvironment(folded);
  const existingAssetRefs = detectExistingAssetRefs(source, contexto);
  const styleTerms = detectStyleTerms(folded);
  const { palette, hardCandidate: colorCandidate } = detectColors(source, folded);
  const structureCandidate = detectStructureCandidate(folded);
  const sizeCandidate = detectSizeCandidate(folded);
  const finishCandidate = detectFinishCandidate(source, folded);

  const hardCandidates = [colorCandidate, structureCandidate, sizeCandidate, finishCandidate].filter(
    (c): c is RawHardConstraintCandidate => c !== undefined,
  );

  const draft: RawEventIntentDraft = {
    event_scope: eventScope,
    requested_views: requestedViews,
    complexity_requested: complexity,
    ...(budget ? { budget_cop: budget } : {}),
    ...(contexto.eventDate ? { event_date: { value: contexto.eventDate, provenance: "explicito", source_text: "" } } : {}),
    ...(contexto.eventLocation
      ? { event_location: { value: contexto.eventLocation, provenance: "explicito", source_text: "" } }
      : {}),
    ...(contexto.rentalPeriod
      ? { rental_period: { value: contexto.rentalPeriod, provenance: "explicito", source_text: "" } }
      : {}),
    ...(venueEnvironment ? { venue_environment: venueEnvironment } : {}),
    ...(existingAssetRefs ? { existing_asset_refs: existingAssetRefs } : {}),
    ...(palette ? { palette } : {}),
    ...(styleTerms ? { style_terms: styleTerms } : {}),
    hard_constraint_candidates: hardCandidates,
  };

  return RawEventIntentDraftSchema.parse(draft);
}

// ---------------------------------------------------------------------------
// Finalización: borrador crudo -> EventIntentV2 validado
// ---------------------------------------------------------------------------

function finalizeEventIntent(draft: RawEventIntentDraft): EventIntentV2 {
  const hard_constraints = draft.hard_constraint_candidates.map((c) => ({
    key: c.key,
    value: c.value,
    provenance: c.provenance,
  }));

  const intent: EventIntentV2 = {
    schema_version: "event-intent-v2",
    event_type: "wedding",
    event_scope: draft.event_scope?.value ?? DEFAULT_EVENT_SCOPE,
    requested_views: draft.requested_views?.value ?? deriveDefaultRequestedViews(DEFAULT_EVENT_SCOPE),
    complexity_requested: draft.complexity_requested?.value ?? DEFAULT_COMPLEXITY,
    budget_cop: draft.budget_cop?.value,
    event_date: draft.event_date?.value,
    event_location: draft.event_location?.value,
    rental_period: draft.rental_period?.value,
    venue: {
      environment: draft.venue_environment?.value,
      existing_asset_refs: draft.existing_asset_refs?.value ?? [],
    },
    palette: draft.palette?.value ?? [],
    style_terms: draft.style_terms?.value ?? [],
    hard_constraints,
  };

  return EventIntentV2Schema.parse(intent);
}

/**
 * Punto de entrada público de la Tarea 04.1: extrae una `EventIntentV2`
 * completa y validada de un mensaje de cliente en español. Pura y
 * determinista (ver cabecera del archivo).
 */
export function parseEventIntent(mensaje: string, contexto: ParseEventContext = {}): EventIntentV2 {
  const draft = buildRawEventIntentDraft(mensaje, contexto);
  return finalizeEventIntent(draft);
}
