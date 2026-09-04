import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import sharp from "sharp";
import { auditStructureCandidates, splitStructureCandidates, type StructureCandidate } from "../src/lib/lora/dataset-builder";
import { createLocalLoraArtifactStore } from "../src/lib/lora/artifact-store-local";
import type { LoraStructureType } from "../src/lib/lora/schema";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const DATASET_ID = "lora-dataset-structure-v001-114";
const DATASET_LABEL = "structures-v001-local-114";
const TRIGGER = "eventdecor_structure_v1";
const BASE_MODEL = "FLUX.2 [dev]";
const TOKENIZER_REVISION = "provider-default";
const RESOLUTION = 1024;
const SOURCE_ROOT = path.join(ROOT, "data", "staging", "recaption-v004");
const SOURCE_IMAGES = path.join(SOURCE_ROOT, "original");
const SOURCE_CAPTIONS = path.join(SOURCE_ROOT, "nuevo");
const SOURCE_MANIFEST = path.join(ROOT, "data", "lora-artifacts", "datasets", "lora-dataset-v004-154", "manifest.json");
const OUTPUT_ROOT = path.join(ROOT, "data", "staging", "structure-v001");
const PAYLOAD_ROOT = path.join(OUTPUT_ROOT, "payload");
const ZIP_PATH = path.join(OUTPUT_ROOT, "structure-dataset.zip");
const MANIFEST_PATH = path.join(OUTPUT_ROOT, "manifest.json");
const CAPTION_BUNDLE_PATH = path.join(OUTPUT_ROOT, "captions.jsonl");
const AUDIT_PATH = path.join(OUTPUT_ROOT, "audit.json");
const ARTIFACT_ROOT = path.join(ROOT, "data", "lora-artifacts");

const CAPTION_CORRECTIONS: Record<string, Array<[RegExp, string]>> = {
  "10357-1.jpg": [[/paired with two fabric-wrapped cylindrical plinths nearby wrapped in a smaller balloon garland arrangement/gi, "paired with a single fabric-wrapped cylindrical plinth nearby accompanied by a smaller balloon garland arrangement"]],
  "10457-1.jpg": [[/flanked by matte blue and red balloon clusters attached on either side/gi, "flanked on one side by a tall matte blue, red, and navy balloon garland reaching toward the ceiling"]],
  "11073-1.jpg": [[/a number marquee to one side, and a balloon column on the opposite side/gi, "a number marquee light and a balloon column both positioned to one side"]],
  "15468-1.jpg": [[/paper butterfly accents/gi, "metallic gold butterfly accents"]],
};

type SourceElement = {
  elementKind: string;
  canonicalId: string;
  label: string;
  evidenceKind?: string;
  evidenceRef?: string;
};

type SourceImage = {
  key: string;
  imageSha256: string;
  width?: number;
  height?: number;
  source?: { order?: string; photoIndex?: number; ref?: string };
  elements?: SourceElement[];
};

type SourceManifest = { images: SourceImage[] };

const STRUCTURE_LABELS: Record<LoraStructureType, string> = {
  arco: "balloon arch",
  semiarco: "balloon half arch",
  guirnalda: "organic balloon garland",
  columna: "balloon column",
  bouquet: "balloon bouquet",
  backdrop: "decorative backdrop",
  instalacion_completa: "complete event decoration installation",
};

const SOURCE_TO_TYPES: Record<string, LoraStructureType[]> = {
  "structure:arco-de-guirnalda": ["arco", "guirnalda"],
  "structure:guirnalda-organica": ["guirnalda"],
  "structure:columna": ["columna"],
  "structure:bouquet": ["bouquet"],
  "structure:panel-de-fondo": ["backdrop"],
  "structure:muro-de-globos": ["backdrop"],
  "structure:marquesina-letras": ["backdrop"],
  "structure:aro-metalico": ["arco"],
  "structure:racimo": ["bouquet"],
  "structure:centro-de-mesa": ["bouquet"],
  "structure:escultura": ["instalacion_completa"],
};

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function mimeType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function structureTypesFor(elements: SourceElement[], caption: string): LoraStructureType[] {
  const sourceIds = elements.filter((element) => element.elementKind === "structure").map((element) => element.canonicalId);
  const types = new Set<LoraStructureType>(sourceIds.flatMap((id) => SOURCE_TO_TYPES[id] ?? []));
  const primary = [...types].filter((type) => type !== "instalacion_completa");
  const hasBackdropOrColumn = types.has("backdrop") || types.has("columna");
  if (hasBackdropOrColumn && primary.length > 1) types.add("instalacion_completa");
  if (sourceIds.length >= 3 && primary.length > 1) types.add("instalacion_completa");
  if (/\bhalf[- ]arch|semi[- ]arch|semicircular\b/i.test(caption)) types.add("semiarco");
  return [...types].filter((type) => type in STRUCTURE_LABELS);
}

function structureCaption(sourceCaption: string, types: LoraStructureType[], key: string): string {
  let body = sourceCaption
    .replace(/^eventdecor_style_v2\s*,\s*/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  for (const [pattern, replacement] of CAPTION_CORRECTIONS[key] ?? []) body = body.replace(pattern, replacement);
  const descriptors = types.map((type) => STRUCTURE_LABELS[type]);
  return [TRIGGER, ...descriptors, body].filter(Boolean).join(", ");
}

function groupKeyFor(source: SourceImage): string {
  return source.source?.order?.trim() || path.parse(source.key).name.split("-")[0] || source.key;
}

function sourceStructureLabels(elements: SourceElement[]): string[] {
  return [...new Set(elements.filter((element) => element.elementKind === "structure").map((element) => element.label))];
}

function coverageFor(candidates: StructureCandidate[], splits: Map<string, "train" | "validation" | "test">) {
  const byStructureType: Record<string, { train: number; validation: number; test: number }> = {};
  let trainImages = 0;
  let validationImages = 0;
  let testImages = 0;
  for (const candidate of candidates) {
    const split = splits.get(candidate.key) ?? "train";
    if (split === "train") trainImages += 1;
    if (split === "validation") validationImages += 1;
    if (split === "test") testImages += 1;
    for (const type of candidate.structureTypes) {
      byStructureType[type] ??= { train: 0, validation: 0, test: 0 };
      byStructureType[type][split] += 1;
    }
  }
  return { totalImages: candidates.length, trainImages, validationImages, testImages, byStructureType };
}

async function createZip(): Promise<Buffer> {
  await rm(ZIP_PATH, { force: true });
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path ${powershellQuote(path.join(PAYLOAD_ROOT, "*"))} -DestinationPath ${powershellQuote(ZIP_PATH)} -Force`,
  ]);
  return readFile(ZIP_PATH);
}

async function buildCandidates(): Promise<{ candidates: StructureCandidate[]; sourceByKey: Map<string, SourceImage> }> {
  const manifest = JSON.parse(await readFile(SOURCE_MANIFEST, "utf8")) as SourceManifest;
  const imageFiles = new Map((await readdir(SOURCE_IMAGES)).map((file) => [file.toLowerCase(), file]));
  const candidates: StructureCandidate[] = [];
  const sourceByKey = new Map<string, SourceImage>();
  for (const source of manifest.images) {
    const sourceElements = source.elements ?? [];
    const sourceCaptionPath = path.join(SOURCE_CAPTIONS, `${path.parse(source.key).name}.txt`);
    const imageFile = imageFiles.get(source.key.toLowerCase()) ?? source.key;
    const imagePath = path.join(SOURCE_IMAGES, imageFile);
    const structureTypes = structureTypesFor(sourceElements, await readFile(sourceCaptionPath, "utf8"));
    if (structureTypes.length === 0) continue;
    if (!existsSync(imagePath)) throw new Error(`Falta imagen local: ${imagePath}`);
    const [imageBytes, sourceCaption, metadata] = await Promise.all([
      readFile(imagePath),
      readFile(sourceCaptionPath, "utf8"),
      sharp(imagePath).metadata(),
    ]);
    const key = source.key;
    candidates.push({
      key,
      sha256: sha256(imageBytes),
      width: metadata.width ?? source.width ?? 0,
      height: metadata.height ?? source.height ?? 0,
      groupKey: groupKeyFor(source),
      structureTypes,
      caption: structureCaption(sourceCaption, structureTypes, source.key),
      sourceRef: source.source?.ref,
    });
    sourceByKey.set(key, source);
  }
  return { candidates, sourceByKey };
}

async function materialize(candidates: StructureCandidate[], sourceByKey: Map<string, SourceImage>, splits: Map<string, "train" | "validation" | "test">) {
  await rm(PAYLOAD_ROOT, { recursive: true, force: true });
  await mkdir(PAYLOAD_ROOT, { recursive: true });
  const bundles: string[] = [];
  const images = [];
  for (const candidate of candidates) {
    const source = sourceByKey.get(candidate.key);
    if (!source) throw new Error(`Fuente no encontrada para ${candidate.key}`);
    const imagePath = path.join(SOURCE_IMAGES, candidate.key);
    await copyFile(imagePath, path.join(PAYLOAD_ROOT, candidate.key));
    await writeFile(path.join(PAYLOAD_ROOT, `${path.parse(candidate.key).name}.txt`), `${candidate.caption}\n`, "utf8");
    const split = splits.get(candidate.key) ?? "train";
    const sourceLabels = sourceStructureLabels(source.elements ?? []);
    const structureElements = candidate.structureTypes.map((type) => ({
      elementKind: "structure",
      canonicalId: `structure:${type}`,
      label: STRUCTURE_LABELS[type],
      evidenceKind: "controlled_caption",
      evidenceRef: source.source?.ref ?? `source:${candidate.key}`,
    }));
    bundles.push(JSON.stringify({ key: candidate.key, caption: candidate.caption, structureTypes: candidate.structureTypes, split }));
    images.push({
      key: candidate.key,
      imageSha256: candidate.sha256,
      captionSha256: sha256(Buffer.from(`${candidate.caption}\n`, "utf8")),
      width: candidate.width,
      height: candidate.height,
      mimeType: mimeType(candidate.key),
      source: { kind: "legacy_import", ref: source.source?.ref ?? `recaption-v004/${path.parse(candidate.key).name}` },
      captionWordCount: candidate.caption.split(/\s+/).filter(Boolean).length,
      reviewStatus: "pending",
      metadata: {
        sourceDataset: "lora-dataset-v004-154",
        sourceStructureLabels: sourceLabels,
        captionStrategy: "existing_confirmed_caption_plus_structure_trigger",
        licenseStatus: "pending",
      },
      split,
      assemblyId: `assembly-${candidate.groupKey}`,
      eventKey: `event-${candidate.groupKey}`,
      structureTypes: candidate.structureTypes,
      productMentionPolicy: "forbidden",
      elements: structureElements,
    });
  }
  await writeFile(CAPTION_BUNDLE_PATH, `${bundles.join("\n")}\n`, "utf8");
  return images;
}

async function registerDraft(input: {
  manifest: Record<string, unknown>;
  manifestBytes: Buffer;
  captionBundleBytes: Buffer;
  zipBytes: Buffer;
  images: Array<Record<string, unknown>>;
  statistics: Record<string, unknown>;
}): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL no está configurada; se generó el dataset local sin registro DB");
  const store = createLocalLoraArtifactStore(ARTIFACT_ROOT);
  const zipArtifact = await store.put(`datasets/${DATASET_ID}/dataset.zip`, input.zipBytes);
  const manifestArtifact = await store.put(`datasets/${DATASET_ID}/manifest.json`, input.manifestBytes);
  const captionArtifact = await store.put(`datasets/${DATASET_ID}/captions.jsonl`, input.captionBundleBytes);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO lora_datasets
        (id, label, schema_version, status, specialization, structure_types, trigger_token,
         base_model, tokenizer_revision, resolution, caption_schema_version, caption_audit,
         license_status, evaluation_status, source_definition, image_count, caption_count,
         zip_storage_key, zip_sha256, zip_bytes, manifest_storage_key, manifest_sha256,
         statistics, coverage_status, coverage_reviewed_images, coverage_total_images,
         exported_at, updated_at)
       VALUES ($1, $2, 'lora-dataset-manifest.v2', 'building', 'structure', $3::jsonb, $4,
         $5, $6, $7, 'lora-caption-v2', $8::jsonb, 'pending', 'pending', $9::jsonb,
         $10, $11, $12, $13, $14, $15, $16, $17::jsonb, 'partial', 0, $10, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, schema_version = EXCLUDED.schema_version,
         status = EXCLUDED.status, specialization = EXCLUDED.specialization,
         structure_types = EXCLUDED.structure_types, trigger_token = EXCLUDED.trigger_token,
         base_model = EXCLUDED.base_model, tokenizer_revision = EXCLUDED.tokenizer_revision,
         resolution = EXCLUDED.resolution, caption_schema_version = EXCLUDED.caption_schema_version,
         caption_audit = EXCLUDED.caption_audit, license_status = EXCLUDED.license_status,
         evaluation_status = EXCLUDED.evaluation_status, source_definition = EXCLUDED.source_definition,
         image_count = EXCLUDED.image_count, caption_count = EXCLUDED.caption_count,
         zip_storage_key = EXCLUDED.zip_storage_key, zip_sha256 = EXCLUDED.zip_sha256,
         zip_bytes = EXCLUDED.zip_bytes, manifest_storage_key = EXCLUDED.manifest_storage_key,
         manifest_sha256 = EXCLUDED.manifest_sha256, statistics = EXCLUDED.statistics,
         coverage_status = EXCLUDED.coverage_status, coverage_reviewed_images = EXCLUDED.coverage_reviewed_images,
         coverage_total_images = EXCLUDED.coverage_total_images, exported_at = EXCLUDED.exported_at,
         archived_at = NULL, updated_at = now()` ,
      [
        DATASET_ID,
        DATASET_LABEL,
        JSON.stringify((input.manifest.structureTypes as unknown[]) ?? []),
        TRIGGER,
        BASE_MODEL,
        TOKENIZER_REVISION,
        RESOLUTION,
        JSON.stringify(input.manifest.captionAudit),
        JSON.stringify(input.manifest.sourceDefinition),
        input.images.length,
        input.images.length,
        zipArtifact.key,
        zipArtifact.sha256,
        zipArtifact.bytes,
        manifestArtifact.key,
        manifestArtifact.sha256,
        JSON.stringify(input.statistics),
      ],
    );
    await client.query("DELETE FROM lora_dataset_images WHERE dataset_id = $1", [DATASET_ID]);
    const imageParams: unknown[] = [];
    const imageRows = input.images.map((image) => {
      const start = imageParams.length;
      const source = image.source as { kind: string; ref?: string };
      imageParams.push(
        DATASET_ID, image.key, image.imageSha256, image.captionSha256, image.width, image.height,
        image.mimeType, source.kind, null, null, source.ref ?? null, image.captionWordCount,
        image.reviewStatus, JSON.stringify(image.metadata), image.split, image.assemblyId,
        image.eventKey, JSON.stringify(image.structureTypes), JSON.stringify([]),
      );
      return `(${Array.from({ length: 19 }, (_, index) => `$${start + index + 1}`).join(", ")})`;
    });
    await client.query(
      `INSERT INTO lora_dataset_images
        (dataset_id, image_key, image_sha256, caption_sha256, width, height, mime_type,
         source_kind, source_order, source_photo_index, source_ref, caption_word_count,
         review_status, metadata, split, assembly_id, event_key, structure_types, quality_flags)
       VALUES ${imageRows.join(", ")}`,
      imageParams,
    );
    const elementParams: unknown[] = [];
    const elementRows: string[] = [];
    for (const image of input.images) {
      for (const type of image.structureTypes as LoraStructureType[]) {
        const start = elementParams.length;
        elementParams.push(DATASET_ID, image.key, "structure", `structure:${type}`, STRUCTURE_LABELS[type], null, null, null, "controlled_caption", "structure-v001");
        elementRows.push(`(${Array.from({ length: 10 }, (_, index) => `$${start + index + 1}`).join(", ")})`);
      }
    }
    if (elementRows.length > 0) {
      await client.query(
        `INSERT INTO lora_dataset_image_elements
          (dataset_id, image_key, element_kind, canonical_id, label, product_id, variant_id,
           sku, evidence_kind, evidence_ref)
         VALUES ${elementRows.join(", ")}`,
        elementParams,
      );
    }
    await client.query("DELETE FROM lora_dataset_element_stats WHERE dataset_id = $1", [DATASET_ID]);
    const stats = input.statistics.byStructureType as Record<string, { train: number; validation: number; test: number }>;
    const statParams: unknown[] = [];
    const statRows: string[] = [];
    for (const [type, count] of Object.entries(stats)) {
      const total = count.train + count.validation + count.test;
      const keys = input.images.filter((image) => (image.structureTypes as string[]).includes(type)).map((image) => image.key);
      const start = statParams.length;
      statParams.push(DATASET_ID, "structure", `structure:${type}`, STRUCTURE_LABELS[type as LoraStructureType], null, null, null, total, Number(((total * 100) / input.images.length).toFixed(3)), JSON.stringify(keys));
      statRows.push(`(${Array.from({ length: 10 }, (_, index) => `$${start + index + 1}`).join(", ")}::jsonb)`);
    }
    if (statRows.length > 0) {
      await client.query(
        `INSERT INTO lora_dataset_element_stats
          (dataset_id, element_kind, canonical_id, label, product_id, variant_id, sku,
           image_count, representation_pct, image_keys)
         VALUES ${statRows.join(", ")}`,
        statParams,
      );
    }
    for (const artifact of [
      { id: `${DATASET_ID}:dataset_zip`, kind: "dataset_zip", result: zipArtifact },
      { id: `${DATASET_ID}:manifest`, kind: "manifest", result: manifestArtifact },
      { id: `${DATASET_ID}:caption_bundle`, kind: "caption_bundle", result: captionArtifact },
    ]) {
      await client.query(
        `INSERT INTO lora_artifacts
          (id, run_id, dataset_id, specialization, kind, storage_key, sha256, bytes, status, metadata)
         VALUES ($1, NULL, $2, 'structure', $3, $4, $5, $6, 'backed_up', $7::jsonb)
         ON CONFLICT (storage_key) DO UPDATE SET
           sha256 = EXCLUDED.sha256, bytes = EXCLUDED.bytes, status = EXCLUDED.status,
           metadata = EXCLUDED.metadata, dataset_id = EXCLUDED.dataset_id`,
        [artifact.id, DATASET_ID, artifact.kind, artifact.result.key, artifact.result.sha256, artifact.result.bytes, JSON.stringify({ datasetStatus: "building", licenseStatus: "pending" })],
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
  const register = process.argv.includes("--register");
  const { candidates, sourceByKey } = await buildCandidates();
  const audit = auditStructureCandidates(candidates);
  if (audit.accepted.length === 0) throw new Error("La auditoría no dejó imágenes aceptadas");
  const splits = splitStructureCandidates(audit.accepted);
  const images = await materialize(audit.accepted, sourceByKey, splits);
  const coverage = coverageFor(audit.accepted, splits);
  const sourceLabels = [...new Set(candidates.flatMap((candidate) => sourceStructureLabels(sourceByKey.get(candidate.key)?.elements ?? [])))];
  const manifestBase = {
    schemaVersion: "lora-dataset-manifest.v2",
    draft: true,
    dataset: {
      id: DATASET_ID,
      label: DATASET_LABEL,
      specialization: "structure",
      trigger: TRIGGER,
      baseModel: BASE_MODEL,
      tokenizerRevision: TOKENIZER_REVISION,
      resolution: RESOLUTION,
      imageCount: images.length,
      captionCount: images.length,
    },
    sourceDefinition: {
      kind: "legacy_import",
      sourceDataset: "data/lora-artifacts/datasets/lora-dataset-v004-154/manifest.json",
      sourceImages: "data/staging/recaption-v004/original",
      sourceCaptions: "data/staging/recaption-v004/nuevo",
      captionStrategy: "replace_product_trigger_and_prefix_controlled_structure_types",
      sourceStructureLabels: sourceLabels,
      missingLocalClass: "semiarco",
      licenseGate: "pending_manual_verification",
    },
    structureTypes: Object.keys(coverage.byStructureType),
    licenseStatus: "pending",
    captionAudit: { ...audit.captionAudit, manualReviewRequired: true, auditedAt: new Date().toISOString() },
    coverage,
    images,
  };
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(AUDIT_PATH, JSON.stringify({ ...audit, licenseStatus: "pending", source: "local legacy_import" }, null, 2), "utf8");
  const zipBytes = await createZip();
  const manifest = { ...manifestBase, dataset: { ...manifestBase.dataset, zipSha256: sha256(zipBytes) } };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(MANIFEST_PATH, manifestBytes);
  const captionBundleBytes = await readFile(CAPTION_BUNDLE_PATH);
  const statistics = {
    byStructureType: coverage.byStructureType,
    structures: Object.entries(coverage.byStructureType).map(([type, count]) => ({
      canonicalId: `structure:${type}`,
      label: STRUCTURE_LABELS[type as LoraStructureType],
      imageCount: count.train + count.validation + count.test,
      representationPct: Number((((count.train + count.validation + count.test) * 100) / images.length).toFixed(3)),
    })),
  };
  if (register) await registerDraft({ manifest, manifestBytes, captionBundleBytes, zipBytes, images, statistics });
  console.log(JSON.stringify({
    datasetId: DATASET_ID,
    registered: register,
    images: images.length,
    rejected: audit.rejected.length,
    rejectedItems: audit.rejected,
    classes: coverage.byStructureType,
    captionAudit: audit.captionAudit,
    licenseStatus: "pending",
    output: path.relative(ROOT, OUTPUT_ROOT),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
