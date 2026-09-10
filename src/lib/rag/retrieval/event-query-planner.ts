/**
 * Planificador determinista para eventos abiertos (C1-C3).
 *
 * El nombre del evento es texto del cliente. Solo `occasion_filter` puede
 * activar un predicado SQL, y únicamente cuando el parser ya reconoció un
 * alias cerrado. Todo lo demás es señal de recuperación/ranking.
 */

import type { Pool } from "pg";
import { buscarHibrido, consultaTieneSku } from "./search";
import { embeddingOpcional } from "../embeddings";
import type {
  EventMatchEvidence,
  EventMatchLevel,
  EventSearchIntent,
  FiltrosDuros,
  ResultadoRetrieval,
} from "./types";

export type { EventMatchEvidence, EventMatchLevel, EventSearchIntent } from "./types";

export type ComponentKind = "focal" | "backdrop" | "message" | "table" | "accents" | "generic";

export type ComponentQuery = {
  component: ComponentKind;
  /** Human-readable role. Not used as a hard catalog category. */
  role: string;
  query: string;
  semantic_query: string;
  hard_filters: FiltrosDuros;
  event_terms: string[];
  event_intent: EventSearchIntent;
  budget_cop?: number;
  ladder: RecoveryTier[];
};

export type RecoveryTier = {
  level: EventMatchLevel | "generic_composition";
  query: string;
  hard_filters: FiltrosDuros;
  relaxations: string[];
};

export type ComponentPlannerInput = {
  request: string;
  event: EventSearchIntent;
  space?: string | { type?: string; width_cm?: number; height_cm?: number; depth_cm?: number };
  budget_cop?: number;
  complexity?: "focal_only" | "balanced_scene" | "immersive_scene" | "full_event";
  /** Explicit components override inference; it is still normalized/deduplicated. */
  components?: string[];
};

export type EventComponentResult = {
  component: ComponentQuery;
  candidates: Array<ResultadoRetrieval & { evidence: EventMatchEvidence }>;
  selected_level: EventMatchLevel | "generic_composition" | "NO_MATCH";
  relaxations: string[];
};

const COMPONENT_TERMS: Record<ComponentKind, string[]> = {
  focal: ["arco", "guirnalda", "estructura", "kit armado", "protagonista"],
  backdrop: ["backdrop", "telon", "fondo", "pared de globos", "panel"],
  message: ["cartel", "letras", "mensaje", "numero", "banderola"],
  table: ["mesa", "desechables", "vajilla", "servicio", "centro de mesa"],
  accents: ["acento", "detalle", "complemento", "relleno", "decoracion pequena"],
  generic: ["estructura neutral", "soporte lateral", "accesorio de catalogo"],
};

const COMPONENT_ALIASES: Array<[ComponentKind, RegExp]> = [
  ["focal", /\b(arco|guirnalda|estructura|focal|protagonista|globos?)\b/i],
  ["backdrop", /\b(backdrop|telon|fondo|panel|pared)\b/i],
  ["message", /\b(cartel|letrero|letras?|mensaje|numero|n[uú]mero|banderola)\b/i],
  ["table", /\b(mesa|desechables?|vajilla|servicio|cubiertos?|centro(?:s)? de mesa)\b/i],
  ["accents", /\b(acento|detalle|complemento|relleno|accesorios?)\b/i],
];

const ROLE_LABEL: Record<ComponentKind, string> = {
  focal: "estructura focal",
  backdrop: "fondo o soporte",
  message: "mensaje o señalización",
  table: "mesa y servicio",
  accents: "acentos y volumen",
  generic: "composición genérica",
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function eventText(event: EventSearchIntent): string {
  return unique([event.event_label ?? "", ...event.event_terms, ...event.soft_signals.motivos]).join(" ");
}

function hardFilters(event: EventSearchIntent, budget?: number): FiltrosDuros {
  return {
    disponible: event.hard_filters.solo_disponibles,
    precioMax: budget ?? event.hard_filters.precio_max ?? undefined,
    categorias: event.hard_filters.categorias.length ? [...event.hard_filters.categorias] : undefined,
    colores: event.hard_filters.colores.length ? [...event.hard_filters.colores] : undefined,
    acabados: event.hard_filters.acabados.length ? [...event.hard_filters.acabados] : undefined,
    formas: event.hard_filters.formas.length ? [...event.hard_filters.formas] : undefined,
    diametrosPulgadas: event.hard_filters.diametros_pulgadas.length ? [...event.hard_filters.diametros_pulgadas] : undefined,
    // Occasion is deliberately omitted for thematic/adaptable tiers. Unknown
    // events must never become a made-up closed occasion predicate.
    ocasiones: event.occasion_filter.length ? [...event.occasion_filter] : undefined,
  };
}

function normalizeComponent(value: string): ComponentKind | null {
  const folded = fold(value);
  if (/focal|arco|guirnalda|estructura|protagonista/.test(folded)) return "focal";
  if (/backdrop|telon|fondo|panel|pared/.test(folded)) return "backdrop";
  if (/cartel|letrero|letras?|mensaje|numero|banderola/.test(folded)) return "message";
  if (/mesa|desechable|vajilla|servicio|cubierto/.test(folded)) return "table";
  if (/acento|detalle|complemento|relleno|accesorio/.test(folded)) return "accents";
  if (/generic|generica|neutral|composicion/.test(folded)) return "generic";
  return null;
}

function inferComponents(input: ComponentPlannerInput): ComponentKind[] {
  const explicit = input.components?.map(normalizeComponent).filter((x): x is ComponentKind => x !== null) ?? [];
  if (explicit.length) return unique(explicit) as ComponentKind[];

  const found = COMPONENT_ALIASES.filter(([, pattern]) => pattern.test(input.request)).map(([kind]) => kind);
  const complexity = input.complexity ?? "balanced_scene";
  // Composition is driven by space/complexity. Event label alone never forces
  // a wedding-like recipe or a product category.
  const result = [...found];
  if (!result.includes("focal")) result.unshift("focal");
  if (complexity !== "focal_only" && !result.includes("backdrop")) result.push("backdrop");
  if ((complexity === "immersive_scene" || complexity === "full_event") && !result.includes("accents")) result.push("accents");
  if (complexity === "full_event" && !result.includes("table")) result.push("table");
  return unique(result) as ComponentKind[];
}

function budgetWeights(components: ComponentKind[]): Map<ComponentKind, number> {
  const weight: Record<ComponentKind, number> = { focal: 0.42, backdrop: 0.24, message: 0.1, table: 0.14, accents: 0.1, generic: 1 };
  const total = components.reduce((sum, component) => sum + (weight[component] ?? 0.1), 0) || 1;
  return new Map(components.map((component) => [component, (weight[component] ?? 0.1) / total]));
}

function composeQuery(input: ComponentPlannerInput, component: ComponentKind): string {
  const event = eventText(input.event);
  const style = unique([...input.event.soft_signals.estilos, ...input.event.soft_signals.colores]).join(" ");
  const space = typeof input.space === "string" ? input.space : input.space?.type ?? "espacio del evento";
  const componentTerms = COMPONENT_TERMS[component].join(" ");
  return unique([event, componentTerms, space, style]).join(" ").trim();
}

function buildLadder(input: ComponentPlannerInput, component: ComponentKind, baseQuery: string, budget?: number): RecoveryTier[] {
  const base = hardFilters(input.event, budget);
  const thematicFilters: FiltrosDuros = { ...base, ocasiones: undefined };
  const adaptableFilters: FiltrosDuros = { ...thematicFilters };
  // Category, color, shape, size, stock and ceiling stay locked in every tier.
  // Only event/occasion signal relaxes; physical/commercial constraints never
  // disappear silently.
  return [
    {
      level: "exact_event",
      query: baseQuery,
      hard_filters: base,
      relaxations: [],
    },
    {
      level: "thematic",
      query: unique([baseQuery, ...input.event.soft_signals.motivos]).join(" "),
      hard_filters: thematicFilters,
      relaxations: input.event.occasion_filter.length ? ["ocasión pasó de filtro exacto a señal temática"] : [],
    },
    {
      level: "adaptable",
      query: unique([COMPONENT_TERMS[component].join(" "), typeof input.space === "string" ? input.space : input.space?.type ?? ""]).join(" "),
      hard_filters: adaptableFilters,
      relaxations: ["evento pasó de señal temática a composición adaptable"],
    },
    {
      level: "generic_composition",
      query: COMPONENT_TERMS[component].join(" "),
      hard_filters: adaptableFilters,
      relaxations: ["se usa composición genérica compatible"],
    },
  ];
}

/** Derives genuinely distinct, deterministic component queries from request/context. */
export function planComponentQueries(input: ComponentPlannerInput): ComponentQuery[] {
  const components = inferComponents(input);
  const weights = budgetWeights(components);
  return components.map((component) => {
    const budget = input.budget_cop != null ? Math.round(input.budget_cop * (weights.get(component) ?? 0)) : undefined;
    const query = composeQuery(input, component);
    return {
      component,
      role: ROLE_LABEL[component],
      query,
      semantic_query: query,
      hard_filters: hardFilters(input.event, budget),
      event_terms: [...input.event.event_terms],
      event_intent: input.event,
      ...(budget == null ? {} : { budget_cop: budget }),
      ladder: buildLadder(input, component, query, budget),
    };
  });
}

/** Pure evidence classifier used by the reranker and tests. */
export function evidenceForEventMatch(
  product: { title?: string | null; handle?: string | null; description?: string | null; tags?: readonly string[]; occasions?: readonly string[] },
  event: EventSearchIntent,
  tierHint?: EventMatchLevel,
): EventMatchEvidence {
  const haystack = fold([product.title, product.handle, product.description, ...(product.tags ?? [])].filter(Boolean).join(" "));
  const matchedSignals = unique([...event.event_terms, ...event.soft_signals.motivos].filter((signal) => haystack.includes(fold(signal))));
  const exact = Boolean(event.event_label && haystack.includes(fold(event.event_label)))
    || Boolean(event.occasion_filter.length && (product.occasions ?? []).some((occasion) => event.occasion_filter.includes(occasion)));
  const match_level: EventMatchLevel = exact ? "exact_event" : tierHint === "thematic" || matchedSignals.length ? "thematic" : "adaptable";
  return { match_level, matched_signals: matchedSignals, relaxations: match_level === "adaptable" ? ["evento no respaldado por título, descripción o tags"] : [] };
}

/**
 * Runs ladder tiers sequentially. `NO_MATCH` is returned only after adaptable
 * and generic composition have been exhausted. No vector provider required.
 */
export async function retrieveEventComponent(
  pool: Pool,
  query: ComponentQuery,
): Promise<EventComponentResult> {
  const relaxations: string[] = [];
  let embeddingFallido = false;
  const initialQuery = query.ladder[0]?.query ?? query.semantic_query;
  const embeddingPrecalculado = consultaTieneSku(initialQuery)
    ? undefined
    : await embeddingOpcional(
      initialQuery,
      undefined,
      undefined,
      () => { embeddingFallido = true; },
    );
  for (const tier of query.ladder) {
    const response = await buscarHibrido(pool, {
      semanticQuery: tier.query,
      focusedQueries: [tier.query],
      filtros: tier.hard_filters,
      embeddingPrecalculado,
      embeddingFallido,
      eventTerms: query.event_terms,
      eventIntent: query.event_intent,
    });
    if (tier.relaxations.length) relaxations.push(...tier.relaxations);
    if (!response.results.length) continue;
    const candidates = response.results.map((candidate) => ({
      ...candidate,
      evidence: {
        match_level: tier.level === "generic_composition" ? "adaptable" : tier.level,
        matched_signals: [...(response.query.eventTerms ?? [])],
        relaxations: [...relaxations],
      },
    }));
    return {
      component: query,
      candidates,
      selected_level: tier.level,
      relaxations,
    };
  }
  return { component: query, candidates: [], selected_level: "NO_MATCH", relaxations };
}
