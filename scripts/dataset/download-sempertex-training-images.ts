import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const INPUT_PATH = argument("--input", path.join("data", "processed", "sempertex-training-selection-v001.json"));
const OUTPUT_DIR = argument("--output-dir", path.join("data", "raw", "sempertex-products-v001"));
const DATABASE_PATH = argument("--database", path.join("data", "processed", "sempertex-products-database-v001.json"));
const CAPTIONS_PATH = argument("--captions", path.join("data", "processed", "sempertex-products-captions-v001.jsonl"));
const CONCURRENCY = 8;
const MAX_ATTEMPTS = 3;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MINIMUM_SHORT_SIDE = Number(argument("--minimum-short-side", "768"));
const TRIGGER_TOKEN = "sempertex_product_v1";
const SCENE_TRIGGER_TOKEN = "eventdecor_style_v1";

type ProductRecord = {
  selectionId: string;
  imageRole?: "scene" | "venue_scene" | "assembled_decoration" | "product";
  sourceLocalImage?: string;
  theme: string;
  themeMatch: string;
  productId: string;
  handle: string;
  title: string;
  productType: string | null;
  category: string;
  colors: string[];
  occasions: string[];
  tags: string[];
  productUrl: string;
  imageUrl: string;
  license: Record<string, unknown>;
  description: {
    descripcion: string | null;
    textoCompleto: string | null;
    especificaciones: Array<{ nombre?: string; valor?: string }>;
    medidas: Array<{ nombre?: string; valor?: string }>;
    contenidoKit: unknown[];
    tablas: unknown[];
  };
  variants: Array<{
    sku?: string | null;
    titulo?: string | null;
    option1?: string | null;
    option2?: string | null;
    tamano?: { codigo?: string; pulgadas?: number | null } | null;
  }>;
  [key: string]: unknown;
};

type SelectionDocument = {
  selectionVersion: string;
  counts: unknown;
  rules: unknown;
  products: ProductRecord[];
};

type Dimensions = { width: number; height: number };

type DownloadResult = ProductRecord & {
  caption: string;
  triggerToken: string;
  searchText: string;
  localImage: string | null;
  imageSha256: string | null;
  width: number | null;
  height: number | null;
  imageBytes: number | null;
  contentType: string | null;
  downloadStatus: "downloaded" | "failed";
  qualityStatus: "approved" | "low_resolution" | "duplicate" | "rejected";
  duplicateOf: string | null;
  error: string | null;
};

function safeStem(product: ProductRecord): string {
  const handle = product.handle
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${product.selectionId}-${handle}`;
}

function extensionFor(contentType: string | null, url: string): string {
  const type = contentType?.split(";")[0].trim().toLowerCase();
  const byType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  if (type && byType[type]) return byType[type];
  const pathname = new URL(url).pathname.toLowerCase();
  const match = pathname.match(/\.(jpe?g|png|webp|gif)$/);
  if (!match) return ".img";
  return match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;
}

function imageDimensions(buffer: Buffer): Dimensions | null {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length >= 10 && buffer.subarray(0, 3).toString("ascii") === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  if (buffer.length >= 30 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const format = buffer.subarray(12, 16).toString("ascii");
    if (format === "VP8X") {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (format === "VP8 " && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (format === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > buffer.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += length + 2;
    }
  }
  return null;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function triggerFor(product: ProductRecord): string {
  return product.imageRole === "scene" || product.imageRole === "venue_scene" || product.imageRole === "assembled_decoration"
    ? SCENE_TRIGGER_TOKEN
    : TRIGGER_TOKEN;
}

function captionFor(product: ProductRecord): string {
  const trigger = triggerFor(product);
  const details: string[] = [
    trigger,
    product.imageRole === "venue_scene"
      ? `finished Sempertex event decoration photographed in a real venue, ${product.title}`
      : product.imageRole === "assembled_decoration" || product.imageRole === "scene"
        ? `assembled Sempertex balloon decoration, ${product.title}`
      : `Sempertex commercial catalog product image of ${product.title}`,
    `product category ${product.category}`,
    `theme ${product.theme}`,
  ];
  if (product.productType) details.push(`product type ${product.productType}`);
  if (product.colors.length) details.push(`colors ${product.colors.join(", ")}`);
  if (product.occasions.length) details.push(`occasions ${product.occasions.join(", ")}`);

  const specifications = product.description.especificaciones
    .filter((item) => item.nombre && item.valor)
    .slice(0, 6)
    .map((item) => `${item.nombre}: ${item.valor}`);
  if (specifications.length) details.push(`specifications ${specifications.join("; ")}`);

  const sizes = [...new Set(product.variants.flatMap((variant) => {
    const decoded = variant.tamano?.codigo;
    const option = variant.option1 && !/^DEFAULT TITLE$/i.test(variant.option1) ? variant.option1 : null;
    return [decoded, option].filter((value): value is string => Boolean(value));
  }))].slice(0, 8);
  if (sizes.length) details.push(`available variants ${sizes.join(", ")}`);
  const skus = [...new Set(product.variants.map((variant) => variant.sku).filter((value): value is string => Boolean(value)))].slice(0, 8);
  if (skus.length) details.push(`catalog references ${skus.join(", ")}`);
  return compactText(details.join(", "));
}

function searchTextFor(product: ProductRecord): string {
  const specs = product.description.especificaciones
    .map((item) => [item.nombre, item.valor].filter(Boolean).join(": "))
    .filter(Boolean);
  const variants = product.variants
    .flatMap((variant) => [variant.sku, variant.titulo, variant.option1, variant.option2, variant.tamano?.codigo])
    .filter((value): value is string => Boolean(value));
  return compactText([
    product.title,
    product.productType ?? "",
    product.category,
    product.theme,
    product.colors.join(" "),
    product.occasions.join(" "),
    product.tags.join(" "),
    product.description.textoCompleto ?? product.description.descripcion ?? "",
    specs.join(" "),
    variants.join(" "),
  ].join(" "));
}

async function fetchImage(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type");
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        throw new Error(`Tipo inesperado: ${contentType}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw new Error("Imagen vacía");
      if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`Imagen excede ${MAX_IMAGE_BYTES} bytes`);
      return { buffer, contentType };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastError;
}

async function processProduct(product: ProductRecord): Promise<DownloadResult> {
  const caption = captionFor(product);
  const triggerToken = triggerFor(product);
  const searchText = searchTextFor(product);
  try {
    const localSource = product.sourceLocalImage
      ? { buffer: await readFile(product.sourceLocalImage), contentType: `image/${path.extname(product.sourceLocalImage).slice(1).replace("jpg", "jpeg")}` }
      : null;
    const { buffer, contentType } = localSource ?? await fetchImage(product.imageUrl);
    const dimensions = imageDimensions(buffer);
    if (!dimensions) throw new Error("Formato o dimensiones no reconocidos");

    const extension = extensionFor(contentType, product.imageUrl);
    const stem = safeStem(product);
    const imageName = `${stem}${extension}`;
    const localImage = path.join(OUTPUT_DIR, imageName).replaceAll("\\", "/");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const licensePath = path.join(OUTPUT_DIR, `${stem}.license.json`);
    const captionPath = path.join(OUTPUT_DIR, `${stem}.txt`);

    await writeFile(path.join(OUTPUT_DIR, imageName), buffer);
    await writeFile(captionPath, `${caption}\n`, "utf-8");
    await writeFile(licensePath, `${JSON.stringify({
      ...product.license,
      productId: product.productId,
      handle: product.handle,
      productUrl: product.productUrl,
      sourceImageUrl: product.imageUrl,
      imageSha256: sha256,
      downloadedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf-8");

    return {
      ...product,
      caption,
      triggerToken,
      searchText,
      localImage,
      imageSha256: sha256,
      width: dimensions.width,
      height: dimensions.height,
      imageBytes: buffer.length,
      contentType,
      downloadStatus: "downloaded",
      duplicateOf: null,
      qualityStatus: Math.min(dimensions.width, dimensions.height) >= MINIMUM_SHORT_SIDE ? "approved" : "low_resolution",
      error: null,
    };
  } catch (error) {
    return {
      ...product,
      caption,
      triggerToken,
      searchText,
      localImage: null,
      imageSha256: null,
      width: null,
      height: null,
      imageBytes: null,
      contentType: null,
      downloadStatus: "failed",
      qualityStatus: "rejected",
      duplicateOf: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const selection = JSON.parse(await readFile(INPUT_PATH, "utf-8")) as SelectionDocument;
  await mkdir(OUTPUT_DIR, { recursive: true });

  const results = new Array<Awaited<ReturnType<typeof processProduct>>>(selection.products.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < selection.products.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await processProduct(selection.products[index]);
      if ((index + 1) % 20 === 0) console.log(`Procesadas ${index + 1}/${selection.products.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const firstByHash = new Map<string, string>();
  for (const product of results) {
    if (product.downloadStatus !== "downloaded" || !product.imageSha256) continue;
    const prior = firstByHash.get(product.imageSha256 as string);
    if (prior) {
      product.duplicateOf = prior;
      product.qualityStatus = "duplicate";
    } else {
      firstByHash.set(product.imageSha256 as string, product.selectionId);
    }
  }

  const counts = {
    selected: results.length,
    downloaded: results.filter((product) => product.downloadStatus === "downloaded").length,
    failed: results.filter((product) => product.downloadStatus === "failed").length,
    approved: results.filter((product) => product.qualityStatus === "approved").length,
    duplicate: results.filter((product) => product.qualityStatus === "duplicate").length,
    lowResolution: results.filter((product) => product.qualityStatus === "low_resolution").length,
  };
  const database = {
    schemaVersion: 1,
    datasetVersion: argument("--dataset-version", "sempertex-products-v001"),
    selectionVersion: selection.selectionVersion,
    generatedAt: new Date().toISOString(),
    status: counts.approved === results.length ? "ready" : "needs_review",
    triggerTokens: {
      scenes: SCENE_TRIGGER_TOKEN,
      products: TRIGGER_TOKEN,
    },
    sourceSelectionCounts: selection.counts,
    sourceSelectionRules: selection.rules,
    qualityRules: {
      exactDuplicateDetection: "sha256",
      minimumShortSide: MINIMUM_SHORT_SIDE,
      captionsUseOnlyCatalogMetadata: true,
    },
    counts,
    products: results,
  };
  await writeFile(DATABASE_PATH, `${JSON.stringify(database, null, 2)}\n`, "utf-8");
  await writeFile(
    CAPTIONS_PATH,
    `${results.map((product) => JSON.stringify({
      selectionId: product.selectionId,
      file: product.localImage ?? null,
      caption: product.caption,
      approved: product.qualityStatus === "approved",
    })).join("\n")}\n`,
    "utf-8",
  );
  console.log(JSON.stringify({ outputDir: path.resolve(OUTPUT_DIR), database: path.resolve(DATABASE_PATH), counts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
