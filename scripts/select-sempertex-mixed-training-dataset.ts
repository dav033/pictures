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
const PRODUCT_SELECTION_PATH = path.join("data", "processed", "sempertex-training-selection-v001.json");
const OUTPUT_PATH = path.join("data", "processed", "sempertex-training-mixed-selection-v001.json");

const PRODUCT_PER_THEME = 16;
const SCENE_TARGETS: Record<Theme, number> = {
  halloween: 12,
  coquette: 20,
  navidad: 12,
  cumpleanos: 28,
  genericos: 48,
};
const SCENE_TYPES = new Set(["E-DECORS", "FIESTAS PREDISEÑADAS", "KIT MERCADOLIBRE"]);

type Theme = "halloween" | "coquette" | "navidad" | "cumpleanos" | "genericos";
type EnrichedProduct = {
  id: string;
  descripcion: {
    descripcion: string | null;
    textoCompleto: string | null;
    especificaciones: unknown[];
    medidas: unknown[];
    contenidoKit: unknown[];
    tablas: unknown[];
  };
};
type ExistingRecord = Record<string, unknown> & {
  selectionId: string;
  theme: Theme;
  imageUrl: string;
  productType: string | null;
  qualityStatus?: string;
};
type SceneCandidate = {
  raw: ProductoPublico;
  enriched: EnrichedProduct;
  imageUrl: string;
  imageIndex: number;
  theme: Theme;
  confidence: "metadata_high" | "gallery_candidate";
  score: number;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

const THEME_PATTERNS: Record<Exclude<Theme, "genericos">, RegExp> = {
  halloween: /HALLOWEEN|ARANA|TELARANA|CALABAZA|FANTASMA|BRUJA|MURCIELAGO|TERROR|ESQUELETO|MONSTRUO/,
  navidad: /NAVIDAD|CHRISTMAS|NAVIDENO|SANTA|PAPA NOEL|NOEL|RENO|NOCHEBUENA|MUNECO DE NIEVE|ARBOL NAVIDENO|INVIERNO DORADO/,
  cumpleanos: /CUMPLEAN|BIRTHDAY|FELIZ CUMPLE|HAPPY BIRTHDAY|VELA DE CUMPLE|ANIVERSARIO/,
  coquette: /COQUETTE|AMOR|LOVE|CORAZON|MARIPOSA|PERLA|PRINCESA|BARBIE|ROSADO|ROSA|FUCSIA|LILA|LAVANDA|PASTEL|FASHION GIRL|SAN VALENTIN/,
};

function themeFor(raw: ProductoPublico): Theme {
  const text = normalize(`${raw.title} ${(raw.tags ?? []).join(" ")}`);
  if (THEME_PATTERNS.halloween.test(text)) return "halloween";
  if (THEME_PATTERNS.navidad.test(text)) return "navidad";
  if (THEME_PATTERNS.coquette.test(text)) return "coquette";
  if (THEME_PATTERNS.cumpleanos.test(text)) return "cumpleanos";
  return "genericos";
}

function metadataQuality(raw: ProductoPublico, enriched: EnrichedProduct): number {
  return (
    (enriched.descripcion.descripcion ? 4 : 0) +
    (enriched.descripcion.especificaciones.length ? 3 : 0) +
    (enriched.descripcion.medidas.length ? 2 : 0) +
    Math.min(3, (raw.variants ?? []).filter((variant) => variant.available).length)
  );
}

function collectSceneCandidates(
  products: ProductoPublico[],
  enrichedById: Map<string, EnrichedProduct>,
  excludedImageUrls: Set<string>,
): SceneCandidate[] {
  const candidates: SceneCandidate[] = [];
  for (const raw of products) {
    const enriched = enrichedById.get(String(raw.id));
    if (!enriched || tipoExcluido(raw.product_type)) continue;
    if (!(raw.variants ?? []).some((variant) => variant.available)) continue;
    const strongSceneType = SCENE_TYPES.has(raw.product_type ?? "");
    const theme = themeFor(raw);
    for (const [imageIndex, image] of (raw.images ?? []).entries()) {
      if (!image.src || excludedImageUrls.has(image.src)) continue;
      const secondaryThemeGallery = imageIndex > 0 && theme !== "genericos";
      if (!strongSceneType && !secondaryThemeGallery) continue;
      const confidence = strongSceneType ? "metadata_high" : "gallery_candidate";
      const typeScore = raw.product_type === "E-DECORS" ? 500 : raw.product_type === "FIESTAS PREDISEÑADAS" ? 400 : strongSceneType ? 300 : 150;
      candidates.push({
        raw,
        enriched,
        imageUrl: image.src,
        imageIndex,
        theme,
        confidence,
        score: typeScore + (imageIndex > 0 ? 20 : 0) + metadataQuality(raw, enriched),
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.raw.title.localeCompare(b.raw.title, "es") || a.imageIndex - b.imageIndex);
}

function selectScenes(candidates: SceneCandidate[]): SceneCandidate[] {
  const selected: SceneCandidate[] = [];
  const usedUrls = new Set<string>();
  const perProduct = new Map<string, number>();

  function take(candidate: SceneCandidate, enforceThemeCap: boolean): boolean {
    const productId = String(candidate.raw.id);
    if (usedUrls.has(candidate.imageUrl) || (perProduct.get(productId) ?? 0) >= 2) return false;
    if (enforceThemeCap && selected.filter((item) => item.theme === candidate.theme).length >= SCENE_TARGETS[candidate.theme]) return false;
    selected.push(candidate);
    usedUrls.add(candidate.imageUrl);
    perProduct.set(productId, (perProduct.get(productId) ?? 0) + 1);
    return true;
  }

  for (const theme of Object.keys(SCENE_TARGETS) as Theme[]) {
    for (const candidate of candidates.filter((item) => item.theme === theme)) {
      if (selected.filter((item) => item.theme === theme).length >= SCENE_TARGETS[theme]) break;
      take(candidate, true);
    }
  }

  const totalTarget = Object.values(SCENE_TARGETS).reduce((sum, value) => sum + value, 0);
  for (const candidate of candidates) {
    if (selected.length >= totalTarget) break;
    take(candidate, false);
  }
  if (selected.length !== totalTarget) throw new Error(`Escenas incompletas: ${selected.length}/${totalTarget}`);
  return selected;
}

function variantsFor(raw: ProductoPublico) {
  return (raw.variants ?? []).filter((variant) => variant.available).map((variant) => ({
    id: String(variant.id),
    sku: variant.sku,
    titulo: variant.title,
    precioCop: Number(variant.price),
    option1: variant.option1,
    option2: variant.option2,
    tamano: decodificarTamano(variant.option1),
  }));
}

function sceneRecord(candidate: SceneCandidate, index: number) {
  const raw = candidate.raw;
  const tags = raw.tags ?? [];
  return {
    selectionId: `sempertex-mixed-${String(index + 1).padStart(3, "0")}`,
    imageRole: "scene",
    sceneConfidence: candidate.confidence,
    theme: candidate.theme,
    themeMatch: candidate.theme === "genericos" ? "generic" : "affinity",
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
    imageIndex: candidate.imageIndex,
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
    variants: variantsFor(raw),
  };
}

function main(): void {
  const raw = JSON.parse(readFileSync(RAW_PATH, "utf-8")) as { productos: ProductoPublico[] };
  const enriched = JSON.parse(readFileSync(ENRICHED_PATH, "utf-8")) as { productos: EnrichedProduct[] };
  const prior = JSON.parse(readFileSync(PRODUCT_SELECTION_PATH, "utf-8")) as { products: ExistingRecord[] };
  const enrichedById = new Map(enriched.productos.map((product) => [product.id, product]));

  const productRecords = (Object.keys(SCENE_TARGETS) as Theme[]).flatMap((theme) =>
    prior.products
      .filter((record) => record.theme === theme && !SCENE_TYPES.has(record.productType ?? ""))
      .slice(0, PRODUCT_PER_THEME),
  ).map((record, index) => ({
    ...record,
    selectionId: `sempertex-mixed-${String(index + 121).padStart(3, "0")}`,
    imageRole: "product",
    sceneConfidence: null,
  }));
  if (productRecords.length !== PRODUCT_PER_THEME * 5) {
    throw new Error(`Productos individuales incompletos: ${productRecords.length}/${PRODUCT_PER_THEME * 5}`);
  }

  const productImageUrls = new Set(productRecords.map((record) => record.imageUrl));
  const sceneCandidates = collectSceneCandidates(raw.productos, enrichedById, productImageUrls);
  const scenes = selectScenes(sceneCandidates).map(sceneRecord);
  const records = [...scenes, ...productRecords];
  const imageUrls = new Set(records.map((record) => record.imageUrl));
  if (records.length !== 200 || imageUrls.size !== 200) {
    throw new Error(`Dataset inválido: ${records.length} registros, ${imageUrls.size} URLs únicas`);
  }

  const byTheme = Object.fromEntries((Object.keys(SCENE_TARGETS) as Theme[]).map((theme) => [
    theme,
    records.filter((record) => record.theme === theme).length,
  ]));
  const document = {
    schemaVersion: 1,
    selectionVersion: "sempertex-mixed-200-v001",
    generatedAt: new Date().toISOString(),
    status: "selected_pending_visual_audit",
    strategy: {
      objective: "Generate finished Sempertex-style decorations while preserving real product identity.",
      total: 200,
      scenes: 120,
      individualProducts: 80,
      productImagesPerTheme: PRODUCT_PER_THEME,
      desiredSceneDistribution: SCENE_TARGETS,
      maximumSceneImagesPerProduct: 2,
      sceneCandidatesRequireVisualAudit: true,
    },
    counts: {
      total: records.length,
      byRole: { scene: scenes.length, product: productRecords.length },
      byTheme,
      sceneByTheme: Object.fromEntries((Object.keys(SCENE_TARGETS) as Theme[]).map((theme) => [
        theme,
        scenes.filter((record) => record.theme === theme).length,
      ])),
    },
    products: records,
  };

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify({ output: path.resolve(OUTPUT_PATH), counts: document.counts }, null, 2));
}

main();
