import {
  clasificarCategorias,
  clasificarColores,
  clasificarFormas,
  clasificarOcasiones,
  clasificarTaxonomia,
  plegarTexto,
  type TaxonomyClassification,
} from "@/lib/rag/taxonomy/v2";
import { IntentQuerySchema, type IntentQuery } from "./schema";

export type DeterministicConfidence = "certain" | "ambiguous";

export type LockedIntentField = "precio_max" | "formas" | "diametros_pulgadas" | "solo_disponibles";

export type DeterministicParse = {
  intent: IntentQuery;
  confidence: DeterministicConfidence;
  lockedFields: LockedIntentField[];
  taxonomy: TaxonomyClassification;
};

const DIAMETERS = [5, 9, 12, 18, 24, 36, 40] as const;

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(/,/g, ".");
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePrice(text: string): number | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const pattern = /(?:maximo|hasta|tope|presupuesto|no mas de|menos de|menor a|por debajo de)\s*\$?\s*([\d.,]+)\s*(mil|k)?/i;
  const match = normalized.match(pattern);
  if (!match) return null;
  const amount = parseAmount(match[1]);
  if (amount === null) return null;
  return match[2] ? amount * 1_000 : amount;
}

function parseDiameter(text: string): number[] {
  const normalized = plegarTexto(text);
  const found = new Set<number>();
  const explicitCode = normalized.match(/\b(?:r)\s*-?\s*(5|9|12|18|24|36|40)\b/i);
  if (explicitCode) found.add(Number(explicitCode[1]));

  for (const match of normalized.matchAll(/\b(?:tamano|talla|medida|de)\s*(5|9|12|18|24|36|40)\s*(?:pulgadas?|in)?\b/gi)) {
    found.add(Number(match[1]));
  }
  for (const match of normalized.matchAll(/\b(5|9|12|18|24|36|40)\s*(?:pulgadas?|in)\b/gi)) {
    found.add(Number(match[1]));
  }

  return [...found].filter((value): value is (typeof DIAMETERS)[number] => DIAMETERS.includes(value as (typeof DIAMETERS)[number]));
}

function parseCodeForma(text: string): "redondo" | "corazon" | "link" | "modelar" | null {
  const normalized = plegarTexto(text);
  if (/\b(?:r)\s*-?\s*(?:5|9|12|18|24|36|40)\b/i.test(normalized)) return "redondo";
  if (/\b(?:c)\s*-?\s*\d+(?:\.\d+)?\b/i.test(normalized)) return "corazon";
  if (/\b(?:lol)\s*-?\s*\d+\b/i.test(normalized)) return "link";
  if (/\b(?:t)\s*-?\s*\d+\b/i.test(normalized)) return "modelar";
  return null;
}

function textualFormaHard(text: string, values: readonly string[]): string[] {
  const normalized = plegarTexto(text);
  const explicitForm = /\b(?:en\s+)?forma(?:\s+de)?\s+(?:redond\w*|corazon\w*|heart|link(?:\s+o\s+loon)?|modelar|figuras?|twisting)\b/.test(normalized);
  const balloonContext = /\b(?:globo|globos|balloon|balloons)\b/.test(normalized);
  // Keep the guard here as well as in taxonomy: hard filters must remain
  // conservative even if an alias is later added to the taxonomy module.
  return explicitForm || balloonContext ? [...values] : [];
}

function asksForUnavailable(text: string): boolean {
  return /\b(?:agotad\w*|sin stock|descontinuad\w*|fuera de inventario)\b/i.test(plegarTexto(text));
}

function mentionsSku(text: string): boolean {
  // SKU is kept in semantic_query so exact retrieval can resolve it locally;
  // no model call is needed to preserve or invent that identifier.
  return /\b[A-Z]{2,}[A-Z0-9]*(?:[-_][A-Z0-9]+)+\b/i.test(text);
}

function isOther(text: string): boolean {
  const normalized = plegarTexto(text);
  if (/\b(?:hola|buenas|gracias|adios|chao)\b/.test(normalized) && !/\b(?:globo|vela|kit|decoracion|producto|precio)\b/.test(normalized)) return true;
  return /^(?:que horarios?|cual es el horario|donde estan ubicados?|como puedo pagar|(?:hacen|tienen) envios?\b)/.test(normalized);
}

function hasSoftPreference(text: string): boolean {
  return /\b(?:preferiria|preferiria|me gustaria|idealmente|si se puede|acepto otros|no importa|podria ser|de pronto|ojala)\b/i.test(plegarTexto(text));
}

function hasExplicitHardRequirement(text: string): boolean {
  return /\b(?:solo|solamente|unicamente|tiene que|debe ser|necesito que|sin otro|exclusivamente)\b/i.test(plegarTexto(text));
}

function hardTaxonomy(text: string): boolean {
  return !hasSoftPreference(text) || hasExplicitHardRequirement(text);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function interpretarConsultaDeterminista(mensaje: string): DeterministicParse {
  const source = mensaje.trim();
  const taxonomy = clasificarTaxonomia(source);
  const hard = hardTaxonomy(source);
  const parsedDiametros = parseDiameter(source);
  // Multiple alternatives are not a hard SQL filter. Keep the request in the
  // semantic query so retrieval can rank both options instead of silently
  // returning an arbitrary intersection.
  const diametros = taxonomy.tamanos.status === "known" ? parsedDiametros : [];
  const codeForma = parseCodeForma(source);
  const textualFormas = textualFormaHard(source, taxonomy.formas.values);
  const precio = parsePrice(source);
  const unavailable = asksForUnavailable(source);
  const sku = mentionsSku(source);

  const filtros = {
    categorias: hard && taxonomy.categorias.status === "known" ? unique(taxonomy.categorias.values) : [],
    ocasiones: hard && taxonomy.ocasiones.status === "known" ? unique(taxonomy.ocasiones.values) : [],
    colores: hard && taxonomy.colores.status === "known" ? unique(taxonomy.colores.values) : [],
    formas: codeForma ? [codeForma] : (hard && taxonomy.formas.status === "known" ? unique(textualFormas) : []),
    diametros_pulgadas: diametros,
    precio_max: precio,
    solo_disponibles: !unavailable,
  };

  const intentValue = isOther(source) ? "other" : "product_search";
  const intent = IntentQuerySchema.parse({
    intent: intentValue,
    filtros_duros: filtros,
    semantic_query: source,
  });

  const hasSignal = sku || precio !== null || diametros.length > 0 || codeForma !== null || unavailable ||
    taxonomy.colores.values.length > 0 || taxonomy.categorias.values.length > 0 ||
    taxonomy.ocasiones.values.length > 0 || textualFormas.length > 0 || intentValue === "other";
  const hasAmbiguousTaxonomy = Object.values(taxonomy).some((match) => match.status === "ambiguous");
  const confidence: DeterministicConfidence = hasSignal && !hasAmbiguousTaxonomy ? "certain" : "ambiguous";
  const lockedFields: LockedIntentField[] = ["solo_disponibles"];
  if (precio !== null) lockedFields.push("precio_max");
  if (diametros.length > 0) lockedFields.push("diametros_pulgadas");
  if (codeForma !== null || (hard && textualFormas.length > 0)) lockedFields.push("formas");

  return { intent, confidence, lockedFields, taxonomy };
}

/**
 * Gemini can add a missing taxonomy interpretation, but never override a
 * deterministic fact such as an exact price, SKU-adjacent size code, shape or
 * availability. All remote data is parsed by the same Zod contract first.
 */
export function mergeGeminiIntent(local: DeterministicParse, remote: IntentQuery): IntentQuery {
  const localFilters = local.intent.filtros_duros;
  const remoteFilters = remote.filtros_duros;
  const selectRemoteTaxonomy = <T>(status: "known" | "unknown" | "ambiguous", localValues: T[], remoteValues: T[]): T[] =>
    status === "unknown" ? remoteValues : localValues;
  const merged = {
    categorias: selectRemoteTaxonomy(local.taxonomy.categorias.status, localFilters.categorias, remoteFilters.categorias),
    ocasiones: selectRemoteTaxonomy(local.taxonomy.ocasiones.status, localFilters.ocasiones, remoteFilters.ocasiones),
    colores: selectRemoteTaxonomy(local.taxonomy.colores.status, localFilters.colores, remoteFilters.colores),
    formas: local.lockedFields.includes("formas")
      ? localFilters.formas
      : selectRemoteTaxonomy(local.taxonomy.formas.status, localFilters.formas, remoteFilters.formas),
    diametros_pulgadas: local.lockedFields.includes("diametros_pulgadas") || local.taxonomy.tamanos.status !== "unknown"
      ? localFilters.diametros_pulgadas
      : remoteFilters.diametros_pulgadas,
    precio_max: local.lockedFields.includes("precio_max") ? localFilters.precio_max : remoteFilters.precio_max,
    solo_disponibles: local.lockedFields.includes("solo_disponibles") ? localFilters.solo_disponibles : remoteFilters.solo_disponibles,
  };
  return IntentQuerySchema.parse({
    intent: local.intent.intent,
    filtros_duros: merged,
    // Keep the original query, including a SKU or exact product name.
    semantic_query: local.intent.semantic_query,
  });
}

export { clasificarCategorias, clasificarColores, clasificarFormas, clasificarOcasiones };
