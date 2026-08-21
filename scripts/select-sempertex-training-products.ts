import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  decodificarTamano,
  derivarCategoria,
  derivarColores,
  derivarOcasiones,
  tipoExcluido,
} from "../src/lib/shopify/derivar";
import type { ProductoPublico } from "../src/lib/shopify/tipos";

const RAW_PATH = path.join("data", "raw", "shopify-products.snapshot.json");
const ENRICHED_PATH = path.join("data", "processed", "shopify-products.enriched.json");
const OUTPUT_PATH = path.join("data", "processed", "sempertex-training-selection-v001.json");
const QUOTA = 40;
const MAX_PER_PRODUCT_TYPE = 14;

type Theme = "halloween" | "coquette" | "navidad" | "cumpleanos" | "boda" | "amor_amistad" | "genericos";
type MatchKind = "exact" | "affinity" | "generic";

type EnrichedProduct = {
  id: string;
  handle: string;
  titulo: string;
  descripcion: {
    descripcion: string | null;
    textoCompleto: string | null;
    especificaciones: unknown[];
    medidas: unknown[];
    contenidoKit: unknown[];
    tablas: unknown[];
  };
};

type Candidate = {
  raw: ProductoPublico;
  enriched: EnrichedProduct;
  imageUrl: string;
  theme: Theme;
  matchKind: MatchKind;
  relevance: number;
  score: number;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function textOf(product: ProductoPublico): { title: string; tags: string; all: string } {
  const title = normalize(product.title);
  const tags = normalize((product.tags ?? []).join(" "));
  return { title, tags, all: `${title} ${tags}` };
}

const PATTERNS: Record<Exclude<Theme, "coquette" | "genericos">, RegExp> = {
  halloween: /HALLOWEEN|ARANA|TELARANA|CALABAZA|FANTASMA|BRUJA|MURCIELAGO|TERROR|ESQUELETO|MONSTRUO/,
  navidad: /NAVIDAD|NAVIDENO|SANTA|PAPA NOEL|NOEL|RENO|NOCHEBUENA|MUNECO DE NIEVE|ARBOL NAVIDENO/,
  cumpleanos: /CUMPLEAN|BIRTHDAY|FELIZ CUMPLE|HAPPY BIRTHDAY|VELA DE CUMPLE/,
  // BODA/MATRIMONIO/NOVIA ya no viven mezcladas en THEMATIC_TITLE genérico —
  // tema propio, ver §3 del plan de entrenamiento (antes caía todo en "genericos").
  boda: /\bBODA\b|BODAS|MATRIMONIO|\bNOVIA\b|\bNOVIOS?\b|NUPCIAL/,
  // Ojo: "amor"/"love"/"corazon" sueltos NO entran aquí — corazón es una
  // FORMA (código C-N), no una ocasión, y "amor" solo sin más contexto es
  // demasiado ambiguo (puede ser un producto genérico con esa palabra en
  // la descripción). Requiere la frase completa de la ocasión.
  amor_amistad: /SAN VALENTIN|D[IÍ]A DEL AMOR|AMOR Y AMISTAD|D[IÍ]A DE LOS ENAMORADOS|ENAMORADOS|CUPIDO/,
};

const THEMATIC_TITLE = new RegExp(
  `${PATTERNS.halloween.source}|${PATTERNS.navidad.source}|${PATTERNS.cumpleanos.source}|` +
    `${PATTERNS.boda.source}|${PATTERNS.amor_amistad.source}|` +
    "COQUETTE|MARIPOSA|MADRE|PADRE|BABY|BAUTIZO|COMUNION|GRADO|PRINCESA|BARBIE|DISNEY|FUTBOL",
);

function themeRelevance(
  product: ProductoPublico,
  theme: Exclude<Theme, "coquette" | "genericos">,
): { relevance: number; matchKind: MatchKind } {
  const text = textOf(product);
  if (PATTERNS[theme].test(text.title)) return { relevance: 4, matchKind: "exact" };
  if (PATTERNS[theme].test(text.tags)) return { relevance: 2, matchKind: "affinity" };
  return { relevance: 0, matchKind: "affinity" };
}

function coquetteRelevance(product: ProductoPublico): { relevance: number; matchKind: MatchKind } {
  const text = textOf(product);
  if (/COQUETTE/.test(text.title)) return { relevance: 6, matchKind: "exact" };
  if (/COQUETTE/.test(text.tags)) return { relevance: 5, matchKind: "exact" };

  let relevance = 0;
  // CORAZON fuera: es forma (código C-N), no estética coquette — un globo de
  // corazón sirve igual para boda, amor y amistad o cumpleaños.
  if (/MONO|LAZO|BOW|MARIPOSA|PERLA|PRINCESA|BARBIE/.test(text.all)) relevance += 2;
  if (/ROSADO|ROSA|FUCSIA|LILA|LAVANDA|PASTEL|DORADO ROSA|CHAMPANA/.test(text.all)) relevance += 1;
  if (/POLKA|FLORES|ROMANTIC/.test(text.all)) relevance += 1;
  return { relevance, matchKind: "affinity" };
}

function genericRelevance(product: ProductoPublico): number {
  const text = textOf(product);
  if (THEMATIC_TITLE.test(text.title)) return 0;
  let relevance = 1;
  if (/LISOS/.test(text.tags)) relevance += 3;
  if (/GLOBO (REDONDO|CORAZON|TUBITO|LINK)|FASHION|REFLEX|PASTEL|METAL|MANTEL PEVA|CORTINA METALIZADA/.test(text.title)) {
    relevance += 2;
  }
  if (/SURTIDO|IMPRESO|PERSONAJE|FELIZ DIA/.test(text.title)) relevance -= 2;
  return Math.max(0, relevance);
}

function qualityScore(raw: ProductoPublico, enriched: EnrichedProduct): number {
  const description = enriched.descripcion;
  return (
    Math.min(5, (raw.variants ?? []).filter((variant) => variant.available).length) +
    (description.descripcion ? 3 : 0) +
    (description.especificaciones.length ? 2 : 0) +
    (description.medidas.length ? 2 : 0) +
    ((raw.images ?? []).length > 1 ? 1 : 0)
  );
}

function candidatesFor(
  products: ProductoPublico[],
  enrichedById: Map<string, EnrichedProduct>,
  theme: Theme,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const raw of products) {
    const enriched = enrichedById.get(String(raw.id));
    const imageUrl = raw.images?.[0]?.src;
    if (!enriched || !imageUrl || tipoExcluido(raw.product_type)) continue;
    if (!(raw.variants ?? []).some((variant) => variant.available)) continue;

    let relevance = 0;
    let matchKind: MatchKind = "exact";
    if (theme === "coquette") {
      const match = coquetteRelevance(raw);
      relevance = match.relevance;
      matchKind = match.matchKind;
      if (relevance < 3) continue;
    } else if (theme === "genericos") {
      relevance = genericRelevance(raw);
      matchKind = "generic";
      if (relevance === 0) continue;
    } else {
      const match = themeRelevance(raw, theme);
      relevance = match.relevance;
      matchKind = match.matchKind;
      if (relevance === 0) continue;
    }

    candidates.push({
      raw,
      enriched,
      imageUrl,
      theme,
      matchKind,
      relevance,
      score: relevance * 100 + qualityScore(raw, enriched),
    });
  }
  return candidates.sort(
    (a, b) => b.score - a.score || a.raw.title.localeCompare(b.raw.title, "es") || a.raw.handle.localeCompare(b.raw.handle),
  );
}

function selectCandidates(candidates: Candidate[], quota: number, usedIds: Set<string>): Candidate[] {
  const selected: Candidate[] = [];
  const typeCounts = new Map<string, number>();
  const imageUrls = new Set<string>();

  for (const allowOverflow of [false, true]) {
    for (const candidate of candidates) {
      const id = String(candidate.raw.id);
      if (selected.length >= quota) break;
      if (usedIds.has(id) || selected.some((item) => String(item.raw.id) === id)) continue;
      if (imageUrls.has(candidate.imageUrl)) continue;
      const type = candidate.raw.product_type ?? "SIN_TIPO";
      if (!allowOverflow && (typeCounts.get(type) ?? 0) >= MAX_PER_PRODUCT_TYPE) continue;
      selected.push(candidate);
      imageUrls.add(candidate.imageUrl);
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
    if (selected.length >= quota) break;
  }
  for (const candidate of selected) usedIds.add(String(candidate.raw.id));
  return selected;
}

function main(): void {
  const rawSnapshot = JSON.parse(readFileSync(RAW_PATH, "utf-8")) as { productos: ProductoPublico[] };
  const enrichedSnapshot = JSON.parse(readFileSync(ENRICHED_PATH, "utf-8")) as {
    productos: EnrichedProduct[];
  };
  const enrichedById = new Map(enrichedSnapshot.productos.map((product) => [product.id, product]));
  const usedIds = new Set<string>();

  // Coquette exacto se reserva primero; afinidades se completan después.
  const coquetteCandidates = candidatesFor(rawSnapshot.productos, enrichedById, "coquette");
  const coquetteExact = selectCandidates(
    coquetteCandidates.filter((candidate) => candidate.matchKind === "exact"),
    QUOTA,
    usedIds,
  );
  const selections = new Map<Theme, Candidate[]>();
  for (const theme of ["halloween", "navidad", "cumpleanos"] as const) {
    selections.set(
      theme,
      selectCandidates(candidatesFor(rawSnapshot.productos, enrichedById, theme), QUOTA, usedIds),
    );
  }
  const coquetteAffinity = selectCandidates(
    coquetteCandidates.filter((candidate) => candidate.matchKind === "affinity"),
    QUOTA - coquetteExact.length,
    usedIds,
  );
  selections.set("coquette", [...coquetteExact, ...coquetteAffinity]);
  selections.set(
    "genericos",
    selectCandidates(candidatesFor(rawSnapshot.productos, enrichedById, "genericos"), QUOTA, usedIds),
  );

  const orderedThemes: Theme[] = ["halloween", "coquette", "navidad", "cumpleanos", "genericos"];
  const selected = orderedThemes.flatMap((theme) => selections.get(theme) ?? []);
  if (selected.length !== QUOTA * orderedThemes.length) {
    throw new Error(`Selección incompleta: ${selected.length}/${QUOTA * orderedThemes.length}`);
  }

  const records = selected.map((candidate, index) => {
    const raw = candidate.raw;
    const tags = raw.tags ?? [];
    const variants = (raw.variants ?? []).filter((variant) => variant.available).map((variant) => ({
      id: String(variant.id),
      sku: variant.sku,
      titulo: variant.title,
      precioCop: Number(variant.price),
      option1: variant.option1,
      option2: variant.option2,
      tamano: decodificarTamano(variant.option1),
    }));
    return {
      selectionId: `sempertex-200-${String(index + 1).padStart(3, "0")}`,
      theme: candidate.theme,
      themeMatch: candidate.matchKind,
      selectionScore: candidate.score,
      productId: String(raw.id),
      handle: raw.handle,
      title: raw.title,
      productType: raw.product_type,
      category: derivarCategoria(raw.product_type, tags),
      colors: derivarColores(tags, raw.title),
      occasions: derivarOcasiones(tags, raw.title),
      tags,
      productUrl: `https://sempertex.com/products/${raw.handle}`,
      imageUrl: candidate.imageUrl,
      imageUrlSha256: createHash("sha256").update(candidate.imageUrl).digest("hex"),
      localImage: null,
      imageSha256: null,
      width: null,
      height: null,
      license: {
        owner: "Sempertex",
        source: "sempertex-public-catalog",
        license: "sempertex-owned-public-ai-training",
        approval: "explicit internal approval confirmed by user on 2026-08-13",
        approvedUses: ["lora_training", "model_evaluation", "image_inference"],
      },
      description: candidate.enriched.descripcion,
      variants,
    };
  });

  const themeCounts = Object.fromEntries(
    orderedThemes.map((theme) => [theme, records.filter((record) => record.theme === theme).length]),
  );
  const matchCounts = Object.fromEntries(
    ["exact", "affinity", "generic"].map((kind) => [
      kind,
      records.filter((record) => record.themeMatch === kind).length,
    ]),
  );
  const document = {
    schemaVersion: 1,
    selectionVersion: "sempertex-200-v001",
    generatedAt: new Date().toISOString(),
    status: "selected_pending_download",
    rules: {
      total: 200,
      quotaPerTheme: QUOTA,
      onePrimaryImagePerProduct: true,
      onlyAvailableProducts: true,
      maximumPerProductTypeBeforeBackfill: MAX_PER_PRODUCT_TYPE,
      coquettePolicy: "Exact matches kept separate from visually related affinity candidates.",
    },
    counts: { total: records.length, byTheme: themeCounts, byMatch: matchCounts },
    products: records,
  };

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify({ output: path.resolve(OUTPUT_PATH), counts: document.counts }, null, 2));
}

main();
