import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  decodificarTamano,
  derivarCategoria,
  derivarColores,
  derivarOcasiones,
} from "../src/lib/shopify/derivar";
import type { ProductoPublico } from "../src/lib/shopify/tipos";

const RAW_PATH = path.join("data", "raw", "shopify-products.snapshot.json");
const ENRICHED_PATH = path.join("data", "processed", "shopify-products.enriched.json");
const PRODUCT_SELECTION_PATH = path.join("data", "processed", "sempertex-training-selection-v001.json");
const PRODUCT_QUALITY_PATH = path.join("data", "processed", "sempertex-products-database-v001.json");
const LEGACY_MANIFEST_PATH = path.join("data", "manifests", "dataset-v001.jsonl");
const OUTPUT_PATH = path.join("data", "processed", "sempertex-training-final-selection-v001.json");

const VENUE_SCENE_TARGET = 15;
const ASSEMBLED_DECORATION_TARGET = 105;
const PRODUCT_PER_THEME = 16;

type Theme = "halloween" | "coquette" | "navidad" | "cumpleanos" | "boda" | "amor_amistad" | "genericos";
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
  theme: Theme;
  imageUrl: string;
  productType: string | null;
};
type QualityRecord = { imageUrl: string; qualityStatus: string };
type ManifestRecord = {
  id: string;
  relative_path: string;
  sha256: string;
  source: string;
  license: string;
  width: number;
  height: number;
  status: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

const THEME_PATTERNS: Record<Exclude<Theme, "genericos">, RegExp> = {
  halloween: /HALLOWEEN|ARANA|TELARANA|CALABAZA|FANTASMA|BRUJA|MURCIELAGO|TERROR|ESQUELETO|MONSTRUO/,
  navidad: /NAVIDAD|CHRISTMAS|NAVIDENO|SANTA|PAPA NOEL|NOEL|RENO|NOCHEBUENA|MUNECO DE NIEVE|ARBOL NAVIDENO/,
  // ANIVERSARIO salió de aquí: en este catálogo es casi siempre de pareja/boda,
  // no de cumpleaños — se mudó a "boda" abajo.
  cumpleanos: /CUMPLEAN|BIRTHDAY|FELIZ CUMPLE|HAPPY BIRTHDAY|FESTIVO|FUTBOL|KARS|NEON/,
  // Tema propio para bodas — antes no existía y todo caía en "genericos" (§3
  // del plan de entrenamiento).
  boda: /\bBODA\b|BODAS|MATRIMONIO|\bNOVIA\b|\bNOVIOS?\b|NUPCIAL|ANIVERSARIO/,
  // Tema propio para amor y amistad — antes fusionado dentro de "coquette".
  // Requiere la frase de la ocasión completa; "amor"/"corazon" sueltos no
  // bastan (corazón es forma —código C-N—, no ocasión).
  amor_amistad: /SAN VALENTIN|D[IÍ]A DEL AMOR|AMOR Y AMISTAD|D[IÍ]A DE LOS ENAMORADOS|ENAMORADOS|CUPIDO/,
  // CORAZON/AMOR/LOVE/SAN VALENTIN salieron de aquí: forma o tema propio,
  // no estética coquette (ver arriba y §3 del plan).
  coquette: /COQUETTE|MARIPOSA|PERLA|PRINCESA|BARBIE|ROSADO|ROSA|FUCSIA|LILA|LAVANDA|PASTEL|CASTILLO|CANDY/,
};

function themeFromText(value: string): Theme {
  const text = normalize(value);
  if (THEME_PATTERNS.halloween.test(text)) return "halloween";
  if (THEME_PATTERNS.navidad.test(text)) return "navidad";
  if (THEME_PATTERNS.boda.test(text)) return "boda";
  if (THEME_PATTERNS.amor_amistad.test(text)) return "amor_amistad";
  if (THEME_PATTERNS.coquette.test(text)) return "coquette";
  if (THEME_PATTERNS.cumpleanos.test(text)) return "cumpleanos";
  return "genericos";
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

function commonLicense() {
  return {
    owner: "Sempertex",
    source: "sempertex-public-catalog",
    license: "sempertex-owned-public-ai-training",
    approval: "explicit internal approval confirmed by user on 2026-08-13",
    approvedUses: ["lora_training", "model_evaluation", "image_inference"],
  };
}

function venueRecords(): Array<Record<string, unknown>> {
  const manifest = readFileSync(LEGACY_MANIFEST_PATH, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ManifestRecord)
    .filter((record) => record.status === "approved");
  if (manifest.length !== VENUE_SCENE_TARGET) {
    throw new Error(`Escenas reales incompletas: ${manifest.length}/${VENUE_SCENE_TARGET}`);
  }

  return manifest.map((record, index) => {
    const sourceLocalImage = record.relative_path.replaceAll("\\", "/");
    const stem = path.basename(sourceLocalImage, path.extname(sourceLocalImage));
    const licensePath = `${sourceLocalImage}.license.json`;
    const license = JSON.parse(readFileSync(licensePath, "utf-8")) as Record<string, unknown>;
    const title = stem.replace(/-/g, " ").toUpperCase();
    const theme = themeFromText(title);
    const description = `Real finished Sempertex event decoration photographed in a physical venue: ${title}.`;
    return {
      selectionId: `sempertex-final-${String(index + 1).padStart(3, "0")}`,
      imageRole: "venue_scene",
      sceneConfidence: "visually_audited",
      theme,
      themeMatch: theme === "genericos" ? "generic" : "exact",
      selectionScore: 1000,
      productId: record.id,
      handle: stem,
      title,
      productType: "DECORACION TERMINADA",
      category: "escena_decorada",
      colors: [],
      occasions: theme === "genericos" ? [] : [theme],
      tags: ["SEMERTEX", "DECORACION TERMINADA", "ESCENA REAL", theme],
      productUrl: "https://sempertex.com",
      imageUrl: `local:${sourceLocalImage}`,
      sourceLocalImage,
      imageUrlSha256: createHash("sha256").update(sourceLocalImage).digest("hex"),
      sourceImageSha256: record.sha256,
      localImage: null,
      imageSha256: null,
      width: record.width,
      height: record.height,
      license: { ...commonLicense(), ...license },
      description: {
        descripcion: description,
        textoCompleto: description,
        especificaciones: [],
        medidas: [],
        contenidoKit: [],
        tablas: [],
      },
      variants: [],
    };
  });
}

function assembledDecorationRecords(
  rawProducts: ProductoPublico[],
  enrichedById: Map<string, EnrichedProduct>,
  startIndex: number,
): Array<Record<string, unknown>> {
  const products = rawProducts
    .filter((product) => product.product_type === "E-DECORS" && (product.images ?? []).length > 0)
    .filter((product) => enrichedById.has(String(product.id)))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));

  const candidates: Array<{ raw: ProductoPublico; imageUrl: string; imageIndex: number }> = [];
  const maxImages = Math.max(...products.map((product) => product.images?.length ?? 0));
  for (let imageIndex = 0; imageIndex < maxImages; imageIndex += 1) {
    for (const raw of products) {
      const imageUrl = raw.images?.[imageIndex]?.src;
      if (imageUrl) candidates.push({ raw, imageUrl, imageIndex });
    }
  }
  const selected = candidates.slice(0, ASSEMBLED_DECORATION_TARGET);
  if (selected.length !== ASSEMBLED_DECORATION_TARGET) {
    throw new Error(`Decoraciones armadas incompletas: ${selected.length}/${ASSEMBLED_DECORATION_TARGET}`);
  }

  return selected.map(({ raw, imageUrl, imageIndex }, index) => {
    const enriched = enrichedById.get(String(raw.id))!;
    const tags = raw.tags ?? [];
    const theme = themeFromText(`${raw.title} ${tags.join(" ")}`);
    return {
      selectionId: `sempertex-final-${String(startIndex + index + 1).padStart(3, "0")}`,
      imageRole: "assembled_decoration",
      sceneConfidence: "visually_audited_product_family",
      theme,
      themeMatch: theme === "genericos" ? "generic" : "affinity",
      selectionScore: 800 - imageIndex,
      productId: String(raw.id),
      handle: raw.handle,
      title: raw.title,
      productType: raw.product_type,
      category: derivarCategoria(raw.product_type, tags),
      colors: derivarColores(tags, raw.title),
      occasions: derivarOcasiones(tags, raw.title),
      tags,
      productUrl: `https://sempertex.com/products/${raw.handle}`,
      imageUrl,
      imageIndex,
      imageUrlSha256: createHash("sha256").update(imageUrl).digest("hex"),
      localImage: null,
      imageSha256: null,
      width: null,
      height: null,
      license: commonLicense(),
      description: enriched.descripcion,
      variants: variantsFor(raw),
    };
  });
}

function main(): void {
  const raw = JSON.parse(readFileSync(RAW_PATH, "utf-8")) as { productos: ProductoPublico[] };
  const enriched = JSON.parse(readFileSync(ENRICHED_PATH, "utf-8")) as { productos: EnrichedProduct[] };
  const prior = JSON.parse(readFileSync(PRODUCT_SELECTION_PATH, "utf-8")) as { products: ExistingRecord[] };
  const quality = JSON.parse(readFileSync(PRODUCT_QUALITY_PATH, "utf-8")) as { products: QualityRecord[] };
  const enrichedById = new Map(enriched.productos.map((product) => [product.id, product]));
  const qualityByUrl = new Map(quality.products.map((record) => [record.imageUrl, record.qualityStatus]));

  const themes: Theme[] = ["halloween", "coquette", "navidad", "cumpleanos", "genericos"];
  const productRecords = themes.flatMap((theme) =>
    prior.products
      .filter((record) => record.theme === theme)
      .filter((record) => record.productType !== "E-DECORS")
      .filter((record) => qualityByUrl.get(record.imageUrl) === "approved")
      .slice(0, PRODUCT_PER_THEME),
  ).map((record, index) => ({
    ...record,
    selectionId: `sempertex-final-${String(VENUE_SCENE_TARGET + ASSEMBLED_DECORATION_TARGET + index + 1).padStart(3, "0")}`,
    imageRole: "product",
    sceneConfidence: null,
  }));
  if (productRecords.length !== PRODUCT_PER_THEME * themes.length) {
    throw new Error(`Productos individuales incompletos: ${productRecords.length}/${PRODUCT_PER_THEME * themes.length}`);
  }

  const venues = venueRecords();
  const assemblies = assembledDecorationRecords(raw.productos, enrichedById, venues.length);
  const records = [...venues, ...assemblies, ...productRecords];
  const imageKeys = new Set(records.map((record) => String(record.imageUrl)));
  if (records.length !== 200 || imageKeys.size !== 200) {
    throw new Error(`Dataset inválido: ${records.length} registros, ${imageKeys.size} imágenes únicas`);
  }

  const byTheme = Object.fromEntries(themes.map((theme) => [theme, records.filter((record) => record.theme === theme).length]));
  const document = {
    schemaVersion: 1,
    selectionVersion: "sempertex-final-200-v001",
    generatedAt: new Date().toISOString(),
    status: "selected_pending_download_validation",
    strategy: {
      objective: "Generate complete Sempertex event decorations and understand real catalog products.",
      total: 200,
      venueScenes: VENUE_SCENE_TARGET,
      assembledDecorations: ASSEMBLED_DECORATION_TARGET,
      individualProducts: productRecords.length,
      productImagesPerTheme: PRODUCT_PER_THEME,
      visualAudit: "Venue scenes audited individually; E-DECORS family audited by contact sheets; catalog packages excluded from scene role.",
    },
    counts: {
      total: records.length,
      byRole: {
        venue_scene: venues.length,
        assembled_decoration: assemblies.length,
        product: productRecords.length,
      },
      byTheme,
    },
    products: records,
  };
  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify({ output: path.resolve(OUTPUT_PATH), counts: document.counts }, null, 2));
}

main();
