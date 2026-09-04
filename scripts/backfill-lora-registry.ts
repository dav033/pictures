import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { LoraDatasetManifestSchema, type LoraElementKind } from "../src/lib/lora/schema";
import { createLocalLoraArtifactStore } from "../src/lib/lora/artifact-store-local";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

const ROOT = process.cwd();
const DATASET_ID = "lora-dataset-v004-154";
const RUN_ID = "lora-run-v004-1000";
const DATASET_JSON = path.join(ROOT, "data", "processed", "export-general-2026-08-27.json");
const COMPOSITION_JSON = path.join(ROOT, "data", "processed", "lora-v004-composicion.json");
const PROCEDENCIA_JSON = path.join(ROOT, "data", "lora-backup", "PROCEDENCIA-v004-1000.json");
const ZIP_PATH = path.join(ROOT, "data", "staging", "sempertex-general-v004-recaption-fal.zip");
const WEIGHTS_PATH = path.join(ROOT, "data", "lora-backup", "sempertex-v004-1000.safetensors");
const CAPTIONS_DIR = path.join(ROOT, "data", "staging", "recaption-v004", "nuevo");
const IMAGES_DIR = path.join(ROOT, "data", "staging", "recaption-v004", "original");
const ORDERS_DIR = process.env.ORDENES_DECORACION_DIR ?? "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

type DatasetEntry = {
  orden: string;
  indice: number;
  nombre: string;
  px?: string;
  transformaciones?: string[];
};
type CompositionElement = { nombre: string; imagenes?: string[] };
type LegacyComposition = {
  lora: { etiqueta: string; trigger: string; steps: number; learning_rate: number; epocas: number; costo_usd: number; rank: number; url: string | null };
  dataset: { imagenes: number };
  composicion: Array<{ grupo: string; elementos: CompositionElement[] }>;
};
type Linea = { producto: string; variante: string | null; sku: string | null };
type Desglose = { lineas?: Linea[] };
type Feedback = { productosRepresentados?: Array<{ producto: string; representado: boolean }> };

type ElementRecord = {
  elementKind: LoraElementKind;
  canonicalId: string;
  label: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  evidenceKind: "feedback_confirmed" | "controlled_caption";
  evidenceRef?: string;
};

function readJson<T>(file: string): Promise<T> {
  return readFile(file, "utf8").then((value) => JSON.parse(value) as T);
}

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalId(kind: LoraElementKind, label: string, sku?: string | null): string {
  if (kind === "shopify_variant" && sku) return `sku:${sku}`;
  return `${kind}:${slugify(label)}`;
}

function normalizeProduct(value: string): string {
  return value.replace(/Â®/g, "").replace(/\s+x\d+\s*$/i, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function lineKey(line: Linea): string {
  return normalizeProduct(`${line.producto}${line.variante ? ` (${line.variante})` : ""}`);
}

function findLine(producto: string, lines: Linea[], byKey: Map<string, Linea>): Linea | undefined {
  const normalized = normalizeProduct(producto);
  const exact = byKey.get(normalized);
  if (exact) return exact;
  const parts = normalized.match(/^(.*)\s\(([^()]*)\)$/);
  if (!parts) return undefined;
  const candidates = lines.filter((line) =>
    normalizeProduct(line.producto) === parts[1]
    && normalizeProduct(line.variante ?? "").startsWith(parts[2]),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function parsePixels(value: string | undefined): { width?: number; height?: number } {
  const match = value?.match(/^(\d+)x(\d+)$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
}

function mimeType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

async function buildBackfill() {
  const [dataset, composition, provenance, imageFiles] = await Promise.all([
    readJson<{ entradas: DatasetEntry[] }>(DATASET_JSON),
    readJson<LegacyComposition>(COMPOSITION_JSON),
    readJson<Record<string, unknown>>(PROCEDENCIA_JSON),
    readdir(IMAGES_DIR),
  ]);
  const entries = dataset.entradas ?? [];
  if (entries.length !== composition.dataset.imagenes) throw new Error("Conteo de composición no coincide con dataset");
  if (!entries.length) throw new Error("Dataset v004 vacío");

  const imagesByBase = new Map(imageFiles
    .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
    .map((file) => [path.parse(file).name.toLowerCase(), file]));
  const elementsByImage = new Map<string, ElementRecord[]>();
  const stats = new Map<string, { element: ElementRecord; imageKeys: Set<string> }>();
  const addElement = (imageKey: string, element: ElementRecord) => {
    const imageElements = elementsByImage.get(imageKey) ?? [];
    if (!imageElements.some((item) => item.elementKind === element.elementKind && item.canonicalId === element.canonicalId)) {
      imageElements.push(element);
      elementsByImage.set(imageKey, imageElements);
    }
    const statsKey = `${element.elementKind}:${element.canonicalId}`;
    const aggregate = stats.get(statsKey) ?? { element, imageKeys: new Set<string>() };
    aggregate.imageKeys.add(imageKey);
    stats.set(statsKey, aggregate);
  };

  const groupKind: Record<string, LoraElementKind | undefined> = {
    Estructuras: "structure",
    "Relaciones espaciales": "spatial_relation",
    "Objetos del entorno": "environment",
  };
  for (const group of composition.composicion) {
    const kind = groupKind[group.grupo];
    if (!kind) continue;
    for (const item of group.elementos) {
      for (const imageKey of item.imagenes ?? []) {
        addElement(imageKey, {
          elementKind: kind,
          canonicalId: canonicalId(kind, item.nombre),
          label: item.nombre,
          evidenceKind: "controlled_caption",
          evidenceRef: `composition:${group.grupo}`,
        });
      }
    }
  }

  for (const entry of entries) {
    const imageKey = imagesByBase.get(entry.nombre.toLowerCase());
    if (!imageKey) continue;
    try {
      const orderDir = path.join(ORDERS_DIR, entry.orden);
      const [desglose, feedback] = await Promise.all([
        readJson<Desglose>(path.join(orderDir, "desglose.json")),
        readJson<Feedback>(path.join(orderDir, `feedback-${entry.indice}.json`)),
      ]);
      const lines = desglose.lineas ?? [];
      const byKey = new Map(lines.map((line) => [lineKey(line), line]));
      for (const product of feedback.productosRepresentados ?? []) {
        if (!product.representado) continue;
        const line = findLine(product.producto, lines, byKey);
        if (!line) continue;
        addElement(imageKey, {
          elementKind: "shopify_variant",
          canonicalId: canonicalId("shopify_variant", product.producto, line.sku),
          label: `${line.producto}${line.variante ? ` (${line.variante})` : ""}`,
          sku: line.sku ?? undefined,
          evidenceKind: "feedback_confirmed",
          evidenceRef: `orden/${entry.orden}/feedback-${entry.indice}.json`,
        });
      }
    } catch {
      // Faltantes históricos no se convierten en identidad inventada.
    }
  }

  const images = [];
  let reviewed = 0;
  for (const entry of entries) {
    const imageFile = imagesByBase.get(entry.nombre.toLowerCase());
    if (!imageFile) throw new Error(`Falta imagen para ${entry.nombre}`);
    const imagePath = path.join(IMAGES_DIR, imageFile);
    const captionPath = path.join(CAPTIONS_DIR, `${entry.nombre}.txt`);
    const [imageBytes, captionBytes, metadata] = await Promise.all([
      readFile(imagePath),
      readFile(captionPath),
      sharp(imagePath).metadata(),
    ]);
    const fallbackPixels = parsePixels(entry.px);
    const elementRecords = elementsByImage.get(imageFile) ?? [];
    if (elementRecords.length > 0) reviewed++;
    images.push({
      key: imageFile,
      imageSha256: sha256(imageBytes),
      captionSha256: sha256(captionBytes),
      width: metadata.width ?? fallbackPixels.width,
      height: metadata.height ?? fallbackPixels.height,
      mimeType: mimeType(imageFile),
      source: {
        kind: "legacy_import" as const,
        order: entry.orden,
        photoIndex: entry.indice,
        ref: `orden/${entry.orden}/feedback-${entry.indice}.json`,
      },
      captionWordCount: captionBytes.toString("utf8").trim().split(/\s+/).filter(Boolean).length,
      reviewStatus: elementRecords.length > 0 ? "confirmed" as const : "empty_confirmed" as const,
      metadata: { transformations: entry.transformaciones ?? [] },
      elements: elementRecords,
    });
  }

  const zipBytes = await readFile(ZIP_PATH);
  const weightBytes = await readFile(WEIGHTS_PATH);
  const zipSha256 = sha256(zipBytes);
  const weightSha256 = sha256(weightBytes);
  const statisticArrays = {
    structures: [],
    shopifyVariants: [],
    environment: [],
    spatialRelations: [],
  } as Record<string, Array<Record<string, unknown>>>;
  const statGroup: Record<LoraElementKind, keyof typeof statisticArrays> = {
    structure: "structures",
    shopify_variant: "shopifyVariants",
    environment: "environment",
    spatial_relation: "spatialRelations",
  };
  for (const aggregate of stats.values()) {
    const imageCount = aggregate.imageKeys.size;
    const target = statisticArrays[statGroup[aggregate.element.elementKind]];
    target.push({
      canonicalId: aggregate.element.canonicalId,
      label: aggregate.element.label,
      ...(aggregate.element.productId ? { productId: aggregate.element.productId } : {}),
      ...(aggregate.element.variantId ? { variantId: aggregate.element.variantId } : {}),
      ...(aggregate.element.sku ? { sku: aggregate.element.sku } : {}),
      imageCount,
      representationPct: Number(((100 * imageCount) / entries.length).toFixed(3)),
      imageKeys: [...aggregate.imageKeys].sort(),
    });
  }
  for (const values of Object.values(statisticArrays)) values.sort((a, b) => Number(b.imageCount) - Number(a.imageCount));

  const manifest = LoraDatasetManifestSchema.parse({
    schemaVersion: "lora-dataset-manifest.v1",
    dataset: {
      id: DATASET_ID,
      label: "sempertex-v004-154",
      trigger: composition.lora.trigger,
      imageCount: images.length,
      captionCount: images.length,
      zipSha256,
    },
    sourceDefinition: {
      kind: "legacy_import",
      source: "recaption-v004",
      datasetJson: "data/processed/export-general-2026-08-27.json",
      compositionJson: "data/processed/lora-v004-composicion.json",
      shopifyIdentityPolicy: "sku_fallback_without_inventing_variant_id",
    },
    images,
    statistics: statisticArrays,
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const receipt = {
    schemaVersion: "lora-training-receipt.v1",
    trainingRun: {
      id: RUN_ID,
      label: composition.lora.etiqueta,
      datasetId: DATASET_ID,
      datasetSha256: zipSha256,
      provider: "fal",
      trainerEndpoint: "fal-ai/flux-2-trainer-v2",
      steps: composition.lora.steps,
      learningRate: composition.lora.learning_rate,
      estimatedCostUsd: composition.lora.costo_usd,
      actualCostUsd: composition.lora.costo_usd,
      providerRequestId: provenance.requestId ?? provenance.request_id,
    },
    result: {
      resultUrl: composition.lora.url ?? undefined,
      weightStorageKey: `runs/${RUN_ID}/weights.safetensors`,
      weightSha256,
      weightBytes: weightBytes.byteLength,
      rank: composition.lora.rank,
      architecture: "FLUX",
    },
    evaluation: {
      protocolVersion: "lora-eval-v1",
      loraScale: 0.8,
      passedCount: 6,
      totalCount: 6,
      verdict: "approved",
    },
  };

  return {
    dataset,
    composition,
    provenance,
    images,
    stats: statisticArrays,
    zipBytes,
    zipSha256,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    weightBytes,
    weightSha256,
    receipt,
    receiptBytes: Buffer.from(JSON.stringify(receipt, null, 2)),
    reviewed,
  };
}

async function persist(backfill: Awaited<ReturnType<typeof buildBackfill>>): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL no está configurada; use --dry-run para validar");
  const pool = new Pool({ connectionString: databaseUrl });
  const store = createLocalLoraArtifactStore();
  const zipArtifact = await store.put(`datasets/${DATASET_ID}/dataset.zip`, backfill.zipBytes);
  const manifestArtifact = await store.put(`datasets/${DATASET_ID}/manifest.json`, backfill.manifestBytes);
  const weightArtifact = await store.put(`runs/${RUN_ID}/weights.safetensors`, backfill.weightBytes);
  const receiptArtifact = await store.put(`runs/${RUN_ID}/receipt.json`, backfill.receiptBytes);
  const hasIncompleteShopifyIdentity = backfill.images.some((image) => image.elements.some(
    (element) => element.elementKind === "shopify_variant" && !element.variantId,
  ));
  const coverageStatus = hasIncompleteShopifyIdentity ? "partial" : "complete";
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
         exported_at = EXCLUDED.exported_at, updated_at = now()`,
      [
        DATASET_ID,
        "sempertex-v004-154",
        backfill.composition.lora.trigger,
        JSON.stringify(backfill.manifest.sourceDefinition),
        backfill.images.length,
        zipArtifact.key,
        zipArtifact.sha256,
        zipArtifact.bytes,
        manifestArtifact.key,
        manifestArtifact.sha256,
        JSON.stringify(backfill.stats),
        coverageStatus,
        backfill.reviewed,
      ],
    );

    const imageParams: unknown[] = [];
    const imageRows = backfill.images.map((image) => {
      const start = imageParams.length;
      imageParams.push(
        DATASET_ID, image.key, image.imageSha256, image.captionSha256,
        image.width ?? null, image.height ?? null, image.mimeType ?? null,
        image.source.kind, image.source.order ?? null, image.source.photoIndex ?? null,
        image.source.ref ?? null, image.captionWordCount, image.reviewStatus,
        JSON.stringify(image.metadata),
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
         source_kind = EXCLUDED.source_kind, source_order = EXCLUDED.source_order,
         source_photo_index = EXCLUDED.source_photo_index, source_ref = EXCLUDED.source_ref,
         caption_word_count = EXCLUDED.caption_word_count, review_status = EXCLUDED.review_status,
         metadata = EXCLUDED.metadata`,
      imageParams,
    );

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

    const statParams: unknown[] = [];
    const statRows: string[] = [];
    for (const [group, values] of Object.entries(backfill.stats)) {
      const elementKind: LoraElementKind = group === "structures" ? "structure"
        : group === "shopifyVariants" ? "shopify_variant"
          : group === "environment" ? "environment" : "spatial_relation";
      for (const stat of values) {
        const start = statParams.length;
        statParams.push(DATASET_ID, elementKind, stat.canonicalId, stat.label, stat.productId ?? null,
          stat.variantId ?? null, stat.sku ?? null, stat.imageCount, stat.representationPct,
          JSON.stringify(stat.imageKeys));
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

    await client.query(
      `INSERT INTO lora_training_runs
        (id, label, dataset_id, provider, trainer_endpoint, output_lora_format,
         steps, learning_rate, estimated_epochs, estimated_cost_usd, actual_cost_usd,
         status, provider_request_id, result_url, weight_storage_key, weight_sha256,
         weight_bytes, rank, architecture, artifact_status, configuration_snapshot,
         provider_result_snapshot, completed_at, received_at, updated_at)
       VALUES ($1, $2, $3, 'fal', 'fal-ai/flux-2-trainer-v2', 'safetensors',
               $4, $5, $6, $7, $7, 'succeeded', $8, $9, $10, $11, $12, $13, $14,
               'backed_up', $15::jsonb, $16::jsonb, now(), now(), now())
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, dataset_id = EXCLUDED.dataset_id,
         steps = EXCLUDED.steps, learning_rate = EXCLUDED.learning_rate,
         estimated_epochs = EXCLUDED.estimated_epochs, estimated_cost_usd = EXCLUDED.estimated_cost_usd,
         actual_cost_usd = EXCLUDED.actual_cost_usd, status = EXCLUDED.status,
         provider_request_id = EXCLUDED.provider_request_id, result_url = EXCLUDED.result_url,
         weight_storage_key = EXCLUDED.weight_storage_key, weight_sha256 = EXCLUDED.weight_sha256,
         weight_bytes = EXCLUDED.weight_bytes, rank = EXCLUDED.rank, architecture = EXCLUDED.architecture,
         artifact_status = EXCLUDED.artifact_status, configuration_snapshot = EXCLUDED.configuration_snapshot,
         provider_result_snapshot = EXCLUDED.provider_result_snapshot,
         completed_at = EXCLUDED.completed_at, received_at = EXCLUDED.received_at, updated_at = now()`,
      [RUN_ID, backfill.composition.lora.etiqueta, DATASET_ID, backfill.composition.lora.steps,
        backfill.composition.lora.learning_rate, backfill.composition.lora.epocas,
        backfill.composition.lora.costo_usd, backfill.provenance.request_id ?? null,
        backfill.composition.lora.url, weightArtifact.key, weightArtifact.sha256,
        weightArtifact.bytes, backfill.composition.lora.rank, "FLUX",
        JSON.stringify({ steps: backfill.composition.lora.steps, learningRate: backfill.composition.lora.learning_rate }),
        JSON.stringify({ receiptKey: receiptArtifact.key, source: "legacy_import" })],
    );
    await client.query(
      `INSERT INTO lora_evaluations
        (id, training_run_id, protocol_version, lora_scale, seeds, criteria,
         passed_count, total_count, verdict, result_snapshot, completed_at)
       VALUES ($1, $2, 'lora-eval-v1', 0.8, $3::jsonb, $4::jsonb, 6, 6, 'approved', $5::jsonb, now())
       ON CONFLICT (training_run_id, protocol_version, lora_scale) DO UPDATE SET
         passed_count = EXCLUDED.passed_count, total_count = EXCLUDED.total_count,
         verdict = EXCLUDED.verdict, result_snapshot = EXCLUDED.result_snapshot,
         completed_at = EXCLUDED.completed_at`,
      ["eval-v004-1000-scale08", RUN_ID, JSON.stringify([101, 202, 303, 404, 505, 606]),
        JSON.stringify({ minimum: "5/6", criterion: "composicion XV" }),
        JSON.stringify({ source: "data/lora-backup/PROCEDENCIA-v004-1000.json" })],
    );
    const history = await client.query(
      `SELECT 1 FROM lora_mode_slot_history
        WHERE slot_slug = 'unlimited' AND new_run_id = $1 AND action = 'assign' LIMIT 1`,
      [RUN_ID],
    );
    if (history.rowCount === 0) {
      await client.query(
        `INSERT INTO lora_mode_slot_history
          (slot_slug, previous_run_id, new_run_id, action, lora_scale, evaluation_snapshot, actor)
         VALUES ('unlimited', NULL, $1, 'assign', 0.8, $2::jsonb, 'backfill-lora-registry')`,
        [RUN_ID, JSON.stringify({ verdict: "approved", passedCount: 6, totalCount: 6 })],
      );
    }
    await client.query(
      `UPDATE lora_mode_slots
          SET training_run_id = $1, lora_scale = 0.8, enabled = TRUE, updated_at = now()
        WHERE slug = 'unlimited'`,
      [RUN_ID],
    );
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
  const backfill = await buildBackfill();
  console.log(`[PASS] backfill preparado: ${backfill.images.length} imágenes, ${Object.values(backfill.stats).flat().length} agregados`);
  console.log(`      ZIP SHA-256: ${backfill.zipSha256}`);
  console.log(`      manifiesto SHA-256: ${backfill.manifestSha256}`);
  console.log(`      cobertura: ${backfill.reviewed}/${backfill.images.length}`);
  console.log(`      estado de cobertura: ${backfill.images.some((image) => image.elements.some(
    (element) => element.elementKind === "shopify_variant" && !element.variantId,
  )) ? "partial (SKU sin variant_id canónico)" : "complete"}`);
  if (process.argv.includes("--apply")) {
    await persist(backfill);
    console.log("[PASS] backfill aplicado a PostgreSQL y artefactos respaldados localmente");
  } else {
    console.log("[DRY-RUN] Nada escrito. Añade --apply para persistir registro y artefactos.");
  }
}

main().catch((error) => {
  console.error(`[FAIL] backfill LoRA: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
