import { z } from "zod";
import {
  ACABADOS_CATALOGO_V2,
  CATEGORIAS_CATALOGO_V2,
  DIAMETROS_REDONDOS_CATALOGO_V2,
  PALETA_COLORES_V2,
  clasificarTaxonomia,
  plegarTexto,
} from "@/lib/rag/taxonomy/v2";
import { interpretarConsultaDeterminista } from "./deterministic";

const enumSchema = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);
const diameterSchema = z.union(
  DIAMETROS_REDONDOS_CATALOGO_V2.map((diameter) => z.literal(diameter)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]],
);

const EventHardFiltersSchema = z.object({
  categorias: z.array(enumSchema(CATEGORIAS_CATALOGO_V2)).default([]),
  colores: z.array(enumSchema(PALETA_COLORES_V2)).default([]),
  acabados: z.array(enumSchema(ACABADOS_CATALOGO_V2)).default([]),
  formas: z.array(z.enum(["redondo", "corazon", "link", "modelar"])).default([]),
  diametros_pulgadas: z.array(diameterSchema).default([]),
  precio_max: z.number().nullable().default(null),
  solo_disponibles: z.boolean().default(true),
}).strict();

const EventSoftSignalsSchema = z.object({
  estilos: z.array(z.string().trim().min(1)).default([]),
  motivos: z.array(z.string().trim().min(1)).default([]),
  colores: z.array(z.string().trim().min(1)).default([]),
}).strict();

/** Open event label plus closed catalog filters. Event terms never become ids. */
export const EventSearchIntentSchema = z.object({
  event_label: z.string().trim().min(1).nullable(),
  event_terms: z.array(z.string().trim().min(1)),
  occasion_filter: z.array(z.string().trim().min(1)),
  hard_filters: EventHardFiltersSchema,
  soft_signals: EventSoftSignalsSchema,
  semantic_query: z.string(),
}).strict();

export type EventSearchIntent = z.infer<typeof EventSearchIntentSchema>;

const STYLE_TERMS = [
  "glamour", "glamuroso", "glamurosa", "rustico", "rustica", "romantico", "romantica",
  "bohemio", "bohemia", "boho", "vintage", "elegante", "moderno", "moderna",
  "campestre", "tropical", "minimalista", "clasico", "clasica", "chic", "fantasia",
] as const;

const EVENT_ALIASES = [
  "revelacion de genero", "primera comunion", "evento corporativo", "baby shower",
  "quinceanero", "quince anos", "aniversario", "graduacion", "cumpleanos", "bautizo",
  "san valentin", "dia de la madre", "dia del padre", "dia de la mujer", "navidad",
  "halloween", "boda", "matrimonio",
] as const;

const EVENT_STOP_WORDS = new Set([
  "azul", "azules", "rosado", "rosada", "rosa", "dorado", "dorada", "plateado", "plateada",
  "blanco", "blanca", "verde", "negro", "negra", "fucsia", "morado", "morada", "lila",
  "elegante", "glamour", "boho", "rustico", "rustica", "moderno", "moderna", "chic",
  "para", "con", "de", "en", "y", "el", "la", "los", "las", "un", "una", "mi", "por",
  "hasta", "maximo", "presupuesto", "pesos", "solo", "solamente", "quiero", "necesito", "no", "es", "se", "trata",
  // Product/component words are not event signals; keeping them out prevents
  // a generic balloon title from being mislabeled thematic for every event.
  "evento", "fiesta", "celebracion", "festejo", "festival", "globo", "globos", "arco", "guirnalda",
  "decoracion", "decoraciones", "cartel", "letras", "backdrop", "fondo", "mesa",
]);

const EVENT_VALUE_STOP_WORDS = new Set([
  "azul", "azules", "rosado", "rosada", "rosa", "dorado", "dorada", "plateado", "plateada",
  "blanco", "blanca", "verde", "negro", "negra", "fucsia", "morado", "morada", "lila",
  "elegante", "glamour", "boho", "rustico", "rustica", "moderno", "moderna", "chic",
  "hasta", "maximo", "presupuesto", "pesos", "solo", "solamente", "quiero", "necesito",
]);

function cleanWords(value: string): string[] {
  return plegarTexto(value).split(" ").filter((word) => word.length > 1);
}

function preserveSourcePhrase(source: string, foldedPhrase: string): string {
  const sourceWords = source.match(/[^\s,.;]+/g) ?? [];
  const foldedWords = sourceWords.map((word) => plegarTexto(word));
  const wanted = cleanWords(foldedPhrase);
  for (let index = 0; index <= foldedWords.length - wanted.length; index++) {
    if (wanted.every((word, offset) => foldedWords[index + offset] === word)) {
      return sourceWords.slice(index, index + wanted.length).join(" ");
    }
  }
  return foldedPhrase;
}

function isNegatedEventMention(foldedSource: string, foldedAlias: string): boolean {
  const alias = foldedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(
    `(?:^|\\s)(?:no|nunca|sin)\\s+(?:(?:es|sea|ser)\\s+)?(?:una?\\s+)?${alias}(?=$|\\s|[,.;])`,
    "i",
  ).test(foldedSource);
}

function extractEventLabel(source: string, occasionValues: string[]): string | null {
  const folded = plegarTexto(source);
  const known = EVENT_ALIASES
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((alias) => new RegExp(`(?:^|\\s)${alias.replace(/ /g, "\\s+")}(?:$|\\s|[,.;])`, "i").test(folded)
      && !isNegatedEventMention(folded, alias));
  if (known) {
    // Match folded words while returning original tokens, preserving accents
    // and the customer's spelling in `event_label`.
    const sourceTokens = source.match(/[^\s,.;]+/g) ?? [];
    const aliasTokens = known.split(" ");
    for (let index = 0; index <= sourceTokens.length - aliasTokens.length; index++) {
      const candidate = sourceTokens.slice(index, index + aliasTokens.length);
      if (candidate.map(plegarTexto).join(" ") === aliasTokens.join(" ")) return candidate.join(" ");
    }
    return known;
  }
  const positiveOccasion = occasionValues.find((occasion) => !isNegatedEventMention(folded, plegarTexto(occasion)));
  if (positiveOccasion) return preserveSourcePhrase(source, positiveOccasion);

  // Unknown celebrations stay open. Capture the event phrase, stopping before
  // colors, style, or commercial constraints instead of swallowing the query.
  // Require an explicit event cue. "globos para arco" is product context,
  // not an event named "arco".
  const match = folded.match(/(?:evento|celebracion|festejo|fiesta|festival)\s+([^,.;]+)/i);
  if (!match?.[1]) return null;
  const words: string[] = [];
  const prefix = /(?:evento|celebracion|festejo|fiesta|festival)\s+/i.test(match[0])
    ? match[0].match(/^(?:evento|celebracion|festejo|fiesta|festival)/i)?.[0]
    : undefined;
  for (const word of `${prefix ? `${prefix} ` : ""}${match[1].trim()}`.split(/\s+/)) {
    if (EVENT_VALUE_STOP_WORDS.has(plegarTexto(word))) break;
    words.push(word);
  }
  return words.length > 0 ? preserveSourcePhrase(source, words.join(" ")) : null;
}

function eventTerms(label: string | null, source: string): string[] {
  const labelTerms = label ? cleanWords(label).filter((word) => !EVENT_STOP_WORDS.has(word)) : [];
  const sourceTerms = cleanWords(source).filter((word) => !STYLE_TERMS.includes(word as (typeof STYLE_TERMS)[number]) && !EVENT_STOP_WORDS.has(word));
  return [...new Set([...labelTerms, ...sourceTerms])].slice(0, 24);
}

/**
 * Deterministic event-search contract. Unknown labels stay free text; only
 * aliases already present in catalog taxonomy populate `occasion_filter`.
 */
export function parseEventSearchIntent(mensaje: string): EventSearchIntent {
  const semanticQuery = mensaje.trim();
  const taxonomy = clasificarTaxonomia(semanticQuery);
  const local = interpretarConsultaDeterminista(semanticQuery).intent;
  const eventLabel = extractEventLabel(semanticQuery, taxonomy.ocasiones.values);
  const occasionFilter = taxonomy.ocasiones.status === "known"
    ? taxonomy.ocasiones.values.filter((occasion) => !isNegatedEventMention(plegarTexto(semanticQuery), plegarTexto(occasion)))
    : [];
  const styles = STYLE_TERMS.filter((term) => new RegExp(`(?:^|\\s)${term}(?:$|\\s)`, "i").test(plegarTexto(semanticQuery)));
  const colores = taxonomy.colores.values.map(String);
  const hardFilters = EventHardFiltersSchema.parse({
    categorias: local.filtros_duros.categorias,
    colores: local.filtros_duros.colores,
    acabados: local.filtros_duros.acabados,
    formas: local.filtros_duros.formas,
    diametros_pulgadas: local.filtros_duros.diametros_pulgadas,
    precio_max: local.filtros_duros.precio_max,
    solo_disponibles: local.filtros_duros.solo_disponibles,
  });
  const labelWords = new Set(cleanWords(eventLabel ?? ""));
  const terms = eventTerms(eventLabel, semanticQuery).filter((term) => !isNegatedEventMention(plegarTexto(semanticQuery), plegarTexto(term)));
  const motifs = terms.filter((term) => !labelWords.has(term) && !styles.includes(term as (typeof STYLE_TERMS)[number]) && !colores.includes(term));

  return EventSearchIntentSchema.parse({
    event_label: eventLabel,
    event_terms: terms,
    occasion_filter: occasionFilter,
    hard_filters: hardFilters,
    soft_signals: { estilos: [...new Set(styles)], motivos: [...new Set(motifs)], colores },
    semantic_query: semanticQuery,
  });
}

// Spanish alias used by retrieval callers; both names remain public to avoid
// coupling callers to a single wording choice.
export const interpretarConsultaEvento = parseEventSearchIntent;
