import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { Caption, Desglose, FeedbackFoto, LineaDesglose } from "@/lib/ordenes/tipos";
import { getDb } from "@/lib/db";

export type LoraDatasetProductComponent = {
  label: string;
  sku: string | null;
  quantity: number | null;
  imageUrl: string | null;
};

export type LoraDatasetGalleryRecord = {
  imageId: string;
  imageFile: string;
  caption: string | null;
  /** QuÃ© contrato produjo el caption: v007 canÃ³nico, o el legado v1/v005. */
  captionVersion: "v007" | "legacy" | null;
  status: "order" | "web_pending";
  origin: string;
  conceptIds: string[];
  components: LoraDatasetProductComponent[];
  componentsStatus: "confirmed_visible" | "order_breakdown_only" | "source_breakdown_only" | "not_available";
  productBreakdownStatus?: string;
  sourceUrl?: string | null;
  sourceRef?: string | null;
};

export type LoraDatasetGalleryData = {
  id: string;
  label: string;
  trigger: string;
  imageCount: number;
  captionCount: number;
  captionV007Count: number;
  orderImageCount: number;
  webImageCount: number;
  pendingImageCount: number;
  catalogImageCount: number;
  conceptCount: number;
  zipSha256: string | null;
  records: LoraDatasetGalleryRecord[];
};

const ORDER_DATASET_ID = "lora-dataset-v004-154";
const WEB_DATASET_ID = "lora-dataset-v006-orders-web-v001";
const ORDER_DATASET_DIR = path.join(process.cwd(), "data", "lora-artifacts", "datasets", ORDER_DATASET_ID);
const ORDER_IMAGE_DIR = path.join(process.cwd(), "data", "staging", "recaption-v004", "original");
const ORDER_CAPTIONS_DIR = path.join(process.cwd(), "data", "staging", "recaption-v004", "nuevo");
const V007_CAPTIONS_DIR = path.join(process.cwd(), "data", "staging", "lora-v007", "captions");
const V007_ANNOTATIONS_DIR = path.join(process.cwd(), "data", "staging", "lora-v007", "anotaciones");
const WEB_STAGING_DIR = path.join(process.cwd(), "data", "staging", "lora-v006-orders-web-v001");
const WEB_IMAGE_DIR = path.join(WEB_STAGING_DIR, "original");
const WEB_MANIFEST_PATH = path.join(WEB_STAGING_DIR, "manifest.json");
const ORDERS_DIR = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

type CatalogImageRow = {
  sku: string | null;
  imagen_principal: string | null;
  imagenes: string | null;
};

type V007Annotation = {
  image_id?: unknown;
  source?: { ref?: unknown };
  anotacion?: { structures?: unknown };
};

type V007Structure = { visible_concept_ids?: unknown };

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function readV007Metadata(): Map<string, Pick<LoraDatasetGalleryRecord, "conceptIds" | "sourceRef">> {
  const metadata = new Map<string, Pick<LoraDatasetGalleryRecord, "conceptIds" | "sourceRef">>();
  if (!fs.existsSync(V007_ANNOTATIONS_DIR)) return metadata;
  for (const file of fs.readdirSync(V007_ANNOTATIONS_DIR).filter((entry) => entry.endsWith(".json"))) {
    const annotation = readJson<V007Annotation>(path.join(V007_ANNOTATIONS_DIR, file));
    const imageId = typeof annotation?.image_id === "string" ? annotation.image_id : file.slice(0, -5);
    const structures = Array.isArray(annotation?.anotacion?.structures)
      ? annotation.anotacion.structures.filter((item): item is V007Structure => Boolean(item && typeof item === "object"))
      : [];
    metadata.set(imageId, {
      conceptIds: [...new Set(structures.flatMap((structure) => strings(structure.visible_concept_ids)))],
      sourceRef: typeof annotation?.source?.ref === "string" ? annotation.source.ref : null,
    });
  }
  return metadata;
}

function normalizeProductText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function productLabel(linea: LineaDesglose): string {
  return `${linea.producto}${linea.variante ? ` (${linea.variante})` : ""}`;
}

function readCatalogImagesBySku(): Map<string, string> {
  try {
    const rows = getDb()
      .prepare(
        `SELECT v.sku, p.imagen_principal, p.imagenes
         FROM shopify_variante v
         JOIN shopify_producto p ON p.id = v.producto_id
         WHERE v.sku IS NOT NULL`,
      )
      .all() as unknown as CatalogImageRow[];
    const images = new Map<string, string>();
    for (const row of rows) {
      if (!row.sku) continue;
      let imageUrl = row.imagen_principal;
      if (!imageUrl && row.imagenes) {
        try {
          const productImages = JSON.parse(row.imagenes) as unknown;
          imageUrl = Array.isArray(productImages) && typeof productImages[0] === "string" ? productImages[0] : null;
        } catch {
          imageUrl = null;
        }
      }
      if (imageUrl) images.set(normalizeProductText(row.sku), imageUrl);
    }
    return images;
  } catch {
    return new Map();
  }
}

function readOrderComponents(
  imageId: string,
  catalogImagesBySku: Map<string, string>,
): Pick<LoraDatasetGalleryRecord, "components" | "componentsStatus"> {
  const match = imageId.match(/^(\d+)-(\d+)$/);
  if (!match) return { components: [], componentsStatus: "not_available" };
  const [, orderNumber, photoIndex] = match;
  const orderDir = path.join(ORDERS_DIR, orderNumber);
  const breakdown = readJson<Desglose>(path.join(orderDir, "desglose.json"));
  const feedback = readJson<FeedbackFoto>(path.join(orderDir, `feedback-${photoIndex}.json`));
  const lines = breakdown?.lineas ?? [];
  const represented = feedback?.productosRepresentados?.filter((product) => product.representado) ?? [];

  if (represented.length > 0) {
    const components = represented.map((product) => {
      const matchingLine = lines.find((line) => normalizeProductText(productLabel(line)) === normalizeProductText(product.producto));
      return {
        label: matchingLine ? productLabel(matchingLine) : product.producto,
        sku: matchingLine?.sku ?? null,
        quantity: matchingLine?.cantidad ?? null,
        imageUrl: matchingLine?.sku ? catalogImagesBySku.get(normalizeProductText(matchingLine.sku)) ?? null : null,
      };
    });
    return { components, componentsStatus: "confirmed_visible" };
  }

  if (lines.length > 0) {
    return {
      components: lines.map((line) => ({
        label: productLabel(line),
        sku: line.sku,
        quantity: line.cantidad,
        imageUrl: line.sku ? catalogImagesBySku.get(normalizeProductText(line.sku)) ?? null : null,
      })),
      componentsStatus: "order_breakdown_only",
    };
  }

  return { components: [], componentsStatus: "not_available" };
}

type WebManifestRecord = {
  id?: string;
  image?: string;
  caption?: string | null;
  theme?: string;
  sourceUrl?: string | null;
  productBreakdown?: {
    lineas?: LineaDesglose[];
  } | null;
  productBreakdownStatus?: string;
};

function readWebComponents(
  productBreakdown: WebManifestRecord["productBreakdown"],
  catalogImagesBySku: Map<string, string>,
): Pick<LoraDatasetGalleryRecord, "components" | "componentsStatus"> {
  const lines = productBreakdown?.lineas ?? [];
  if (lines.length === 0) return { components: [], componentsStatus: "not_available" };

  return {
    components: lines.map((line) => ({
      label: productLabel(line),
      sku: line.sku,
      quantity: line.cantidad,
      imageUrl: line.sku ? catalogImagesBySku.get(normalizeProductText(line.sku)) ?? null : null,
    })),
    componentsStatus: "source_breakdown_only",
  };
}

function readOrderRecords(
  catalogImagesBySku: Map<string, string>,
  v007Metadata: Map<string, Pick<LoraDatasetGalleryRecord, "conceptIds" | "sourceRef">>,
): LoraDatasetGalleryRecord[] {
  if (!fs.existsSync(ORDERS_DIR)) return [];
  return fs.readdirSync(ORDERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .flatMap((entry) => {
      const orderDir = path.join(ORDERS_DIR, entry.name);
      return fs.readdirSync(orderDir)
        .filter((file) => /^foto-\d+\.(jpe?g|png|webp)$/i.test(file))
        .sort((a, b) => Number(a.match(/foto-(\d+)/i)?.[1] ?? 0) - Number(b.match(/foto-(\d+)/i)?.[1] ?? 0))
        .map((file) => {
          const photoIndex = file.match(/^foto-(\d+)\./i)?.[1];
          if (!photoIndex) return null;
          const imageId = `${entry.name}-${photoIndex}`;
          const stagedImage = fs.existsSync(ORDER_IMAGE_DIR)
            ? fs.readdirSync(ORDER_IMAGE_DIR).find((candidate) => candidate.replace(/\.[^.]+$/, "") === imageId && /\.(jpe?g|png|webp)$/i.test(candidate))
            : null;
          // Precedencia de captions: v007 (compilado del contrato con nombres canÃ³nicos) gana
          // sobre el recaption v005 y sobre el caption v1 guardado en la orden. Se lee del
          // disco en cada request, asÃ­ que un refresco muestra el avance del anotador.
          const v007CaptionPath = path.join(V007_CAPTIONS_DIR, `${imageId}.txt`);
          const captionV007 = fs.existsSync(v007CaptionPath) ? fs.readFileSync(v007CaptionPath, "utf8").trim() : "";
          const stagedCaptionPath = path.join(ORDER_CAPTIONS_DIR, `${imageId}.txt`);
          const captionFromStaging = fs.existsSync(stagedCaptionPath) ? fs.readFileSync(stagedCaptionPath, "utf8").trim() : "";
          const captionFromOrder = readJson<Caption>(path.join(orderDir, `caption-${photoIndex}.json`))?.caption?.trim() ?? "";
          const caption = captionV007 || captionFromStaging || captionFromOrder || null;
          const metadata = v007Metadata.get(imageId);
          return {
            imageId,
            imageFile: stagedImage ?? `${imageId}.jpg`,
            caption,
            captionVersion: captionV007 ? ("v007" as const) : caption ? ("legacy" as const) : null,
            status: "order" as const,
            origin: "ordenes-decoracion",
            conceptIds: metadata?.conceptIds ?? [],
            sourceRef: metadata?.sourceRef ?? null,
            ...readOrderComponents(imageId, catalogImagesBySku),
          };
        });
    })
    .filter((record): record is NonNullable<typeof record> => record !== null);
}

function readWebRecords(
  catalogImagesBySku: Map<string, string>,
  v007Metadata: Map<string, Pick<LoraDatasetGalleryRecord, "conceptIds" | "sourceRef">>,
): LoraDatasetGalleryRecord[] {
  const manifest = readJson<{ records?: WebManifestRecord[] }>(WEB_MANIFEST_PATH);
  if (!manifest || !fs.existsSync(WEB_IMAGE_DIR)) return [];
  return (manifest.records ?? [])
    .map((record) => {
      const imageFile = typeof record.image === "string" ? path.basename(record.image) : "";
      if (!record.id || !/^web-\d+\.(jpe?g|png|webp)$/i.test(imageFile)) return null;
      if (!fs.existsSync(path.join(WEB_IMAGE_DIR, imageFile))) return null;
      const metadata = v007Metadata.get(record.id);
      return {
        imageId: record.id,
        imageFile,
        caption: typeof record.caption === "string" && record.caption.trim() ? record.caption.trim() : null,
        captionVersion: null,
        status: "web_pending" as const,
        origin: "Sempertex.com â€” Ideas de Fiesta",
        conceptIds: metadata?.conceptIds ?? [],
        sourceRef: metadata?.sourceRef ?? null,
        ...readWebComponents(record.productBreakdown, catalogImagesBySku),
        productBreakdownStatus: record.productBreakdownStatus ?? "pending",
        sourceUrl: record.sourceUrl ?? null,
      };
    })
    .filter((record): record is NonNullable<typeof record> => record !== null);
}

export function readLoraDatasetV005View(): LoraDatasetGalleryData | null {
  const catalogImagesBySku = readCatalogImagesBySku();
  const v007Metadata = readV007Metadata();
  const orderRecords = readOrderRecords(catalogImagesBySku, v007Metadata);
  const webRecords = readWebRecords(catalogImagesBySku, v007Metadata);
  const records = [...orderRecords, ...webRecords];
  if (records.length === 0) return null;

  const packageManifest = readJson<{ dataset?: { zipSha256?: string } }>(path.join(ORDER_DATASET_DIR, "manifest.json"));
  const captionCount = records.filter((record) => Boolean(record.caption)).length;
  const captionV007Count = records.filter((record) => record.captionVersion === "v007").length;
  return {
    id: webRecords.length > 0 ? WEB_DATASET_ID : ORDER_DATASET_ID,
    label: webRecords.length > 0 ? "sempertex-v006-ordenes-web-sempertex" : "sempertex-v004-154-fotos-de-ordenes",
    trigger: "eventdecor_style_v1",
    imageCount: records.length,
    captionCount,
    captionV007Count,
    orderImageCount: orderRecords.length,
    webImageCount: webRecords.length,
    pendingImageCount: records.length - captionCount,
    catalogImageCount: 0,
    conceptCount: 0,
    zipSha256: webRecords.length > 0 ? null : packageManifest?.dataset?.zipSha256 ?? null,
    records,
  };
}

