import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { LoraDatasetManifestSchema } from "../src/lib/lora/schema";
import { createLocalLoraArtifactStore } from "../src/lib/lora/artifact-store-local";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const ROOT = process.cwd();
const DATASET_ID = "lora-dataset-v005-300";
const DATASET_LABEL = "sempertex-v005-300";
const DATASET_ROOT = path.join(ROOT, "data", "staging", "recaption-v005");
const IMAGES_DIR = path.join(DATASET_ROOT, "original");
const CAPTIONS_DIR = path.join(DATASET_ROOT, "nuevo");
const SELECTION_PATH = path.join(DATASET_ROOT, "seleccion-300.json");
const CONFIG_PATH = path.join(DATASET_ROOT, "entrenamiento.config.json");
const PACKAGE_PATH = path.join(DATASET_ROOT, "empaquetado-300.json");
const ZIP_PATH = path.join(ROOT, "data", "staging", "sempertex-general-v005-300-fal.zip");
const SOURCE_ROOT = path.join(ROOT, "data", "staging", "sempertex-full-v001");

type SelectionEntry = {
  nombre: string;
  origen: string;
  id?: string;
  role?: string;
  theme?: string;
  sha256?: string;
};

type Selection = {
  total: number;
  entradas: SelectionEntry[];
  fuentes: string[];
  estrategia: string;
};

type TrainingConfig = {
  dataset: { trigger: string; imagenes: number };
  trainer: { endpoint: string; output_lora_format: string };
};

type PackageReceipt = { imagenes: number; captions: number; sha256: string };
type CatalogVariant = {
  variant_id: string;
  product_id: string;
  sku: string | null;
  sku_original: string | null;
  title: string | null;
  product_title: string;
};
type ManifestElement = {
  elementKind: "shopify_variant" | "environment";
  canonicalId: string;
  label: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  evidenceKind: "controlled_caption";
  evidenceRef: string;
};
function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function imageFile(file: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(file);
}

function mimeType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function requireFile(file: string): void {
  if (!existsSync(file)) throw new Error(`Falta ${path.relative(ROOT, file)}`);
}

function parseCatalogReferences(sourceCaption: string): string[] {
  const match = sourceCaption.trim().match(/catalog references\s+(.+)$/i);
  return match
    ? [...new Set(match[1].split(",").map((value) => value.trim().toUpperCase()).filter(Boolean))]
    : [];
}

async function loadCatalogVariants(references: string[]): Promise<Map<string, CatalogVariant>> {
  const uniqueReferences = [...new Set(references)];
  if (uniqueReferences.length === 0) return new Map();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL no está configurada para validar referencias de catálogo");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<CatalogVariant>(
      `SELECT v.variant_id, v.product_id, v.sku, v.sku_original, v.title,
              p.title AS product_title
         FROM catalog_variants v
         JOIN catalog_products p ON p.product_id = v.product_id
        WHERE UPPER(v.sku_original) = ANY($1::text[])
        ORDER BY v.variant_id`,
      [uniqueReferences],
    );
    const byReference = new Map<string, CatalogVariant>();
    for (const row of result.rows) {
      for (const value of [...new Set([row.sku_original, row.sku].filter(Boolean))]) {
        const reference = value!.toUpperCase();
        if (!uniqueReferences.includes(reference)) continue;
        if (byReference.has(reference) && byReference.get(reference)!.variant_id !== row.variant_id) {
          throw new Error(`Referencia de catálogo ambigua: ${reference}`);
        }
        byReference.set(reference, row);
      }
    }
    const missing = uniqueReferences.filter((reference) => !byReference.has(reference));
    if (missing.length > 0) throw new Error(`Referencias de catálogo sin variante: ${missing.join(", ")}`);
    return byReference;
  } finally {
    await pool.end();
  }
}

async function buildManifest() {
  requireFile(SELECTION_PATH);
  requireFile(CONFIG_PATH);
  requireFile(PACKAGE_PATH);
  requireFile(ZIP_PATH);

  const [selection, config, packageReceipt] = await Promise.all([
    readFile(SELECTION_PATH, "utf8").then((value) => JSON.parse(value) as Selection),
    readFile(CONFIG_PATH, "utf8").then((value) => JSON.parse(value) as TrainingConfig),
    readFile(PACKAGE_PATH, "utf8").then((value) => JSON.parse(value) as PackageReceipt),
  ]);
  const imageNames = (await readdir(IMAGES_DIR)).filter(imageFile).sort();
  if (selection.total !== 300 || selection.entradas.length !== 300) throw new Error("Selección v005 no contiene 300 entradas");
  if (config.dataset.imagenes !== 300) throw new Error("Configuración v005 no declara 300 imágenes");
  if (packageReceipt.imagenes !== 300 || packageReceipt.captions !== 300) throw new Error("Recibo de empaquetado no declara 300/300");
  if (imageNames.length !== 300) throw new Error(`Se esperaban 300 imágenes, encontradas ${imageNames.length}`);

  const entries = new Map(selection.entradas.map((entry) => [entry.nombre.toLowerCase(), entry]));
  const referencesByImage = new Map<string, string[]>();
  const allReferences: string[] = [];
  for (const entry of selection.entradas) {
    if (entry.origen === "recaption-v004") continue;
    const base = path.parse(entry.nombre).name;
    const sourceCaptionPath = path.join(SOURCE_ROOT, `${base}.txt`);
    requireFile(sourceCaptionPath);
    const references = parseCatalogReferences(await readFile(sourceCaptionPath, "utf8"));
    if (entry.role === "venue_scene" && references.length > 0) {
      throw new Error(`La escena ${base} no debería tener referencias de producto`);
    }
    if (entry.role !== "venue_scene" && references.length === 0) {
      throw new Error(`Faltan referencias de catálogo para ${base}`);
    }
    referencesByImage.set(base.toLowerCase(), references);
    allReferences.push(...references);
  }
  const catalogVariants = await loadCatalogVariants(allReferences);
  const stats = new Map<string, { element: ManifestElement; imageKeys: Set<string> }>();
  const addStatistic = (imageKey: string, element: ManifestElement): void => {
    const key = `${element.elementKind}:${element.canonicalId}`;
    const current = stats.get(key) ?? { element, imageKeys: new Set<string>() };
    current.imageKeys.add(imageKey);
    stats.set(key, current);
  };
  const images: Array<{
    key: string;
    imageSha256: string;
    captionSha256: string;
    width?: number;
    height?: number;
    mimeType: string;
    source: { kind: "approved_manifest" | "legacy_import"; ref: string };
    captionWordCount: number;
    reviewStatus: "confirmed" | "pending";
    metadata: Record<string, unknown>;
    elements: ManifestElement[];
  }> = [];
  let reviewedImages = 0;
  for (const file of imageNames) {
    const base = path.parse(file).name;
    const entry = entries.get(base.toLowerCase());
    if (!entry) throw new Error(`Imagen ${file} no existe en selección v005`);
    const imagePath = path.join(IMAGES_DIR, file);
    const captionPath = path.join(CAPTIONS_DIR, `${base}.txt`);
    requireFile(captionPath);
    const [imageBytes, captionBytes, metadata] = await Promise.all([
      readFile(imagePath),
      readFile(captionPath),
      sharp(imagePath).metadata(),
    ]);
    const imageSha256 = sha256(imageBytes);
    if (entry.sha256 && entry.sha256.toLowerCase() !== imageSha256.toLowerCase()) {
      throw new Error(`Hash no coincide para ${file}`);
    }
    const reviewed = entry.origen === "recaption-v004" || referencesByImage.has(base.toLowerCase());
    const evidenceRef = entry.origen === "recaption-v004"
      ? `recaption-v004/${base}`
      : `source:sempertex-full-v001/${base}.txt`;
    const references = referencesByImage.get(base.toLowerCase()) ?? [];
    const elements: ManifestElement[] = [];
    if (entry.origen !== "recaption-v004") {
      if (entry.role === "venue_scene") {
        elements.push({
          elementKind: "environment",
          canonicalId: "environment:finished-event-decoration-scene",
          label: "Finished event decoration scene",
          evidenceKind: "controlled_caption",
          evidenceRef,
        });
      } else {
        for (const reference of references) {
          const variant = catalogVariants.get(reference);
          if (!variant) throw new Error(`No se pudo resolver la referencia ${reference} en ${base}`);
          const sku = variant.sku_original ?? variant.sku ?? reference;
          elements.push({
            elementKind: "shopify_variant",
            canonicalId: `sku:${sku}`,
            label: variant.product_title,
            productId: variant.product_id,
            variantId: variant.variant_id,
            sku,
            evidenceKind: "controlled_caption",
            evidenceRef,
          });
        }
      }
    }
    for (const element of elements) addStatistic(file, element);
    if (reviewed) reviewedImages += 1;
    images.push({
      key: file,
      imageSha256,
      captionSha256: sha256(captionBytes),
      width: metadata.width,
      height: metadata.height,
      mimeType: mimeType(file),
      source: {
        kind: entry.origen === "recaption-v004" ? "legacy_import" as const : "approved_manifest" as const,
        ref: entry.origen === "recaption-v004" ? `recaption-v004/${base}` : `seleccion-300/${entry.id ?? base}`,
      },
      captionWordCount: captionBytes.toString("utf8").trim().split(/\s+/).filter(Boolean).length,
      reviewStatus: reviewed ? "confirmed" as const : "pending" as const,
      metadata: {
        origen: entry.origen,
        ...(entry.id ? { id: entry.id } : {}),
        ...(entry.role ? { role: entry.role } : {}),
        ...(entry.theme ? { theme: entry.theme } : {}),
        ...(references.length > 0 ? { catalogReferences: references } : { coverage: "environment_only" }),
      },
      elements,
    });
  }

  const zipBytes = await readFile(ZIP_PATH);
  const zipSha256 = sha256(zipBytes);
  if (packageReceipt.sha256.toLowerCase() !== zipSha256.toLowerCase()) throw new Error("Hash del ZIP no coincide con empaquetado-300.json");

  const manifest = LoraDatasetManifestSchema.parse({
    schemaVersion: "lora-dataset-manifest.v1",
    dataset: {
      id: DATASET_ID,
      label: DATASET_LABEL,
      trigger: config.dataset.trigger,
      imageCount: images.length,
      captionCount: images.length,
      zipSha256,
    },
    sourceDefinition: {
      kind: "approved_manifest",
      selection: "data/staging/recaption-v005/seleccion-300.json",
      config: "data/staging/recaption-v005/entrenamiento.config.json",
      packageReceipt: "data/staging/recaption-v005/empaquetado-300.json",
      sources: selection.fuentes,
      strategy: selection.estrategia,
      coveragePolicy: "300/300 imágenes revisadas: 154 legacy, 131 con variantes de catálogo confirmadas y 15 escenas confirmadas como ambiente sin producto aplicable",
    },
    images,
    statistics: {
      structures: [],
      shopifyVariants: [...stats.values()]
        .filter(({ element }) => element.elementKind === "shopify_variant")
        .map(({ element, imageKeys }) => ({
          canonicalId: element.canonicalId,
          label: element.label,
          productId: element.productId,
          variantId: element.variantId,
          sku: element.sku,
          imageCount: imageKeys.size,
          representationPct: Number(((100 * imageKeys.size) / images.length).toFixed(3)),
          imageKeys: [...imageKeys].sort(),
        })),
      environment: [...stats.values()]
        .filter(({ element }) => element.elementKind === "environment")
        .map(({ element, imageKeys }) => ({
          canonicalId: element.canonicalId,
          label: element.label,
          imageCount: imageKeys.size,
          representationPct: Number(((100 * imageKeys.size) / images.length).toFixed(3)),
          imageKeys: [...imageKeys].sort(),
        })),
      spatialRelations: [],
    },
  });

  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const statistics = manifest.statistics;
  return {
    config,
    images,
    reviewedImages,
    zipBytes,
    zipSha256,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    statistics,
  };
}

async function persist(backfill: Awaited<ReturnType<typeof buildManifest>>): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL no está configurada");
  const pool = new Pool({ connectionString: databaseUrl });
  const store = createLocalLoraArtifactStore();
  const zipArtifact = await store.put(`datasets/${DATASET_ID}/dataset.zip`, backfill.zipBytes);
  const manifestArtifact = await store.put(`datasets/${DATASET_ID}/manifest.json`, backfill.manifestBytes);
  const coverageStatus = backfill.reviewedImages === backfill.images.length ? "complete" : "partial";
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO lora_datasets
        (id, label, schema_version, status, trigger_token, source_definition,
         image_count, caption_count, zip_storage_key, zip_sha256, zip_bytes,
         manifest_storage_key, manifest_sha256, statistics, coverage_status,
         coverage_reviewed_images, coverage_total_images, exported_at, updated_at)
       VALUES ($1, $2, 'lora-dataset-manifest.v1', 'ready', $3, $4::jsonb,
               $5, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $5, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, schema_version = EXCLUDED.schema_version,
         status = EXCLUDED.status, trigger_token = EXCLUDED.trigger_token,
         source_definition = EXCLUDED.source_definition, image_count = EXCLUDED.image_count,
         caption_count = EXCLUDED.caption_count, zip_storage_key = EXCLUDED.zip_storage_key,
         zip_sha256 = EXCLUDED.zip_sha256, zip_bytes = EXCLUDED.zip_bytes,
         manifest_storage_key = EXCLUDED.manifest_storage_key,
         manifest_sha256 = EXCLUDED.manifest_sha256, statistics = EXCLUDED.statistics,
         coverage_status = EXCLUDED.coverage_status,
         coverage_reviewed_images = EXCLUDED.coverage_reviewed_images,
         coverage_total_images = EXCLUDED.coverage_total_images,
         exported_at = EXCLUDED.exported_at, archived_at = NULL, updated_at = now()`,
      [
        DATASET_ID,
        DATASET_LABEL,
        backfill.config.dataset.trigger,
        JSON.stringify({
          kind: "approved_manifest",
          selection: "data/staging/recaption-v005/seleccion-300.json",
          config: "data/staging/recaption-v005/entrenamiento.config.json",
        }),
        backfill.images.length,
        zipArtifact.key,
        zipArtifact.sha256,
        zipArtifact.bytes,
        manifestArtifact.key,
        manifestArtifact.sha256,
        JSON.stringify(backfill.statistics),
        coverageStatus,
        backfill.reviewedImages,
      ],
    );

    const imageParams: unknown[] = [];
    const imageRows = backfill.images.map((image) => {
      const start = imageParams.length;
      imageParams.push(
        DATASET_ID, image.key, image.imageSha256, image.captionSha256,
        image.width ?? null, image.height ?? null, image.mimeType ?? null,
        image.source.kind, null, null, image.source.ref ?? null,
        image.captionWordCount, image.reviewStatus, JSON.stringify(image.metadata),
      );
      return `(${Array.from({ length: 14 }, (_, index) => `$${start + index + 1}`).join(", ")}::jsonb)`;
    });
    await client.query(
      `INSERT INTO lora_dataset_images
        (dataset_id, image_key, image_sha256, caption_sha256, width, height,
         mime_type, source_kind, source_order, source_photo_index, source_ref,
         caption_word_count, review_status, metadata)
       VALUES ${imageRows.join(", ")}
       ON CONFLICT (dataset_id, image_key) DO UPDATE SET
         image_sha256 = EXCLUDED.image_sha256, caption_sha256 = EXCLUDED.caption_sha256,
         width = EXCLUDED.width, height = EXCLUDED.height, mime_type = EXCLUDED.mime_type,
         source_kind = EXCLUDED.source_kind, source_ref = EXCLUDED.source_ref,
         caption_word_count = EXCLUDED.caption_word_count, review_status = EXCLUDED.review_status,
         metadata = EXCLUDED.metadata`,
      imageParams,
    );

    await client.query("DELETE FROM lora_dataset_image_elements WHERE dataset_id = $1", [DATASET_ID]);
    const elementRowsData = backfill.images.flatMap((image) => image.elements.map((element) => ({ image, element })));
    if (elementRowsData.length > 0) {
      const elementParams: unknown[] = [];
      const elementRows = elementRowsData.map(({ image, element }) => {
        const start = elementParams.length;
        elementParams.push(
          DATASET_ID, image.key, element.elementKind, element.canonicalId, element.label,
          element.productId ?? null, element.variantId ?? null, element.sku ?? null,
          element.evidenceKind, element.evidenceRef ?? null,
        );
        return `(${Array.from({ length: 10 }, (_, index) => `$${start + index + 1}`).join(", ")})`;
      });
      await client.query(
        `INSERT INTO lora_dataset_image_elements
          (dataset_id, image_key, element_kind, canonical_id, label,
           product_id, variant_id, sku, evidence_kind, evidence_ref)
         VALUES ${elementRows.join(", ")}
         ON CONFLICT DO NOTHING`,
        elementParams,
      );
    }

    await client.query("DELETE FROM lora_dataset_element_stats WHERE dataset_id = $1", [DATASET_ID]);
    const statParams: unknown[] = [];
    const statRows: string[] = [];
    const statisticGroups: Array<["structures" | "shopifyVariants" | "environment" | "spatialRelations", "structure" | "shopify_variant" | "environment" | "spatial_relation"]> = [
      ["structures", "structure"],
      ["shopifyVariants", "shopify_variant"],
      ["environment", "environment"],
      ["spatialRelations", "spatial_relation"],
    ];
    for (const [group, elementKind] of statisticGroups) {
      for (const stat of backfill.statistics[group]) {
        const start = statParams.length;
        statParams.push(
          DATASET_ID, elementKind, stat.canonicalId, stat.label,
          stat.productId ?? null, stat.variantId ?? null, stat.sku ?? null,
          stat.imageCount, stat.representationPct, JSON.stringify(stat.imageKeys),
        );
        statRows.push(`(${Array.from({ length: 10 }, (_, index) => `$${start + index + 1}`).join(", ")}::jsonb)`);
      }
    }
    if (statRows.length > 0) {
      await client.query(
        `INSERT INTO lora_dataset_element_stats
          (dataset_id, element_kind, canonical_id, label, product_id,
           variant_id, sku, image_count, representation_pct, image_keys)
         VALUES ${statRows.join(", ")}
         ON CONFLICT (dataset_id, element_kind, canonical_id) DO UPDATE SET
           label = EXCLUDED.label, image_count = EXCLUDED.image_count,
           representation_pct = EXCLUDED.representation_pct, image_keys = EXCLUDED.image_keys`,
        statParams,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const backfill = await buildManifest();
  console.log(`v005 validado: ${backfill.images.length} imágenes, ${backfill.reviewedImages} revisadas, ${backfill.images.length - backfill.reviewedImages} pendientes de catálogo`);
  console.log(`ZIP SHA-256: ${backfill.zipSha256}`);
  console.log(`Manifiesto SHA-256: ${backfill.manifestSha256}`);
  if (!process.argv.includes("--apply")) {
    console.log("[DRY-RUN] No se escribió DB. Usa --apply para registrar dataset v005.");
    return;
  }
  await persist(backfill);
  console.log(`Registrado: ${DATASET_ID} (${DATASET_LABEL}) · ready · 300/300 captions`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
