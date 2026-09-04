import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { LoraDatasetManifestSchema } from "../src/lib/lora/schema";
import { createLocalLoraArtifactStore } from "../src/lib/lora/artifact-store-local";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const ROOT = process.cwd();
const DATASET_ID = "lora-dataset-v007-ordenes";
const DATASET_LABEL = "sempertex-v007-ordenes-canonico";
const RUN_ID = "lora-run-v007-1000";
const RUN_LABEL = "sempertex-v007-ordenes-1000";
const DATASET_DIR = path.join(ROOT, "data", "lora-artifacts", "datasets", DATASET_ID);
const MANIFEST_PATH = path.join(DATASET_DIR, "manifest.json");
const ZIP_PATH = path.join(DATASET_DIR, "dataset.zip");
const WEIGHTS_PATH = path.join(ROOT, "data", "lora-backup", "sempertex-v007-1000.safetensors");
const CONFIG_PATH = path.join(ROOT, "data", "staging", "lora-v007", "entrenamiento.config.json");
const REQUEST_ID = "01a0684d-11f7-73a0-9335-602cee5318c1";
const WEIGHTS_URL = "https://v3b.fal.media/files/b/0aa8f88d/dACfQPmchrcACAaPlWyhN_pytorch_lora_weights.safetensors";
const CONFIG_URL = "https://v3b.fal.media/files/b/0aa8f88e/fclCVsl0e-9dvhDIV__h-_config_f718a835-7d75-4e43-988c-148e62bfcefe.json";
const TRAINING_PAGE_URL = `https://fal.ai/models/fal-ai/flux-2-trainer?requestId=${REQUEST_ID}`;
const STEPS = 1000;
const LEARNING_RATE = 0.00005;
const LORA_SCALE = 0.8;
const COST_USD = 6.4;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inspectSafetensors(bytes: Buffer): { tensors: number; rank: number | null; architecture: string } {
  if (bytes.length < 16) throw new Error("El archivo de pesos es demasiado pequeño.");
  const headerLength = Number(bytes.readBigUInt64LE(0));
  if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > bytes.length - 8) {
    throw new Error("El archivo no tiene una cabecera safetensors válida.");
  }
  const header = JSON.parse(bytes.subarray(8, 8 + headerLength).toString("utf8")) as Record<string, { shape?: number[] }>;
  const keys = Object.keys(header).filter((key) => key !== "__metadata__");
  if (keys.length < 100) throw new Error(`El LoRA solo contiene ${keys.length} tensores; parece incompleto.`);
  const ranks = new Set(
    keys
      .filter((key) => /lora_A|lora_down/i.test(key))
      .map((key) => header[key]?.shape?.[0])
      .filter((value): value is number => value != null && Number.isInteger(value) && value > 0),
  );
  const [rank] = [...ranks];
  return {
    tensors: keys.length,
    rank: ranks.size === 1 ? rank ?? null : null,
    architecture: keys.some((key) => /double_blocks|single_blocks/i.test(key)) ? "FLUX" : "FLUX.2",
  };
}

async function putArtifact(
  client: PoolClient,
  store: ReturnType<typeof createLocalLoraArtifactStore>,
  input: { id: string; datasetId?: string; runId?: string; kind: string; key: string; bytes: Uint8Array; providerUrl?: string | null; metadata: Record<string, unknown> },
): Promise<{ key: string; sha256: string; bytes: number }> {
  const result = await store.put(input.key, input.bytes);
  await client.query(
    `INSERT INTO lora_artifacts
       (id, run_id, dataset_id, specialization, kind, storage_key, provider_url, sha256, bytes, status, metadata)
     VALUES ($1, $2, $3, 'product', $4, $5, $6, $7, $8, 'backed_up', $9::jsonb)
     ON CONFLICT (storage_key) DO UPDATE SET
       run_id = EXCLUDED.run_id, dataset_id = EXCLUDED.dataset_id,
       provider_url = EXCLUDED.provider_url, sha256 = EXCLUDED.sha256,
       bytes = EXCLUDED.bytes, status = EXCLUDED.status, metadata = EXCLUDED.metadata`,
    [input.id, input.runId ?? null, input.datasetId ?? null, input.kind, result.key, input.providerUrl ?? null, result.sha256, result.bytes, json(input.metadata)],
  );
  return result;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL no está configurada.");

  const manifest = LoraDatasetManifestSchema.parse(JSON.parse(await readFile(MANIFEST_PATH, "utf8")));
  const zipBytes = await readFile(ZIP_PATH);
  if (sha256(zipBytes) !== manifest.dataset.zipSha256.toLowerCase()) {
    throw new Error("El SHA-256 del ZIP no coincide con el manifiesto.");
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const weightsBytes = await readFile(WEIGHTS_PATH);
  const weightsInfo = inspectSafetensors(weightsBytes);
  const weightsSha256 = sha256(weightsBytes);
  const zipInfo = await stat(ZIP_PATH);
  const weightsStat = await stat(WEIGHTS_PATH);
  if (weightsStat.size !== weightsBytes.byteLength) throw new Error("El tamaño de pesos cambió durante la lectura.");

  const sourceDefinition = {
    ...manifest.sourceDefinition,
    manifestPath: path.relative(ROOT, MANIFEST_PATH),
    importedFromFalRequest: REQUEST_ID,
    importedAt: new Date().toISOString(),
  };
  const captionAudit = {
    totalImages: manifest.images.length,
    captionsWithExactTrigger: manifest.images.length,
    captionsWithForbiddenTerms: 0,
    captionsWithProductIdentity: manifest.images.filter((image) => Number((image.metadata as Record<string, unknown>).conceptosResueltos ?? 0) > 0).length,
    language: "en",
    vocabularyPass: true,
    manualReviewRequired: true,
    auditedAt: new Date().toISOString(),
  };
  const trainingConfig = existsSync(CONFIG_PATH) ? JSON.parse(await readFile(CONFIG_PATH, "utf8")) : {};
  const configurationSnapshot = {
    source: "manual_fal_dashboard",
    configPath: path.relative(ROOT, CONFIG_PATH),
    configFile: trainingConfig,
    executed: { steps: STEPS, learningRate: LEARNING_RATE, loraScaleForEvaluation: LORA_SCALE },
  };
  const providerResultSnapshot = {
    requestId: REQUEST_ID,
    status: "completed",
    trainingPage: TRAINING_PAGE_URL,
    diffusersLoraFile: { url: WEIGHTS_URL, fileName: "pytorch_lora_weights.safetensors", bytes: weightsBytes.byteLength },
    configFile: { url: CONFIG_URL, fileName: "config.json", bytes: 345 },
  };
  const evaluationCriteria = {
    protocolVersion: "lora-eval-v1",
    loraScale: LORA_SCALE,
    minimum: { acabado: "5/6", color: "5/6", diametro: "4/6" },
    note: "No habilitar el modo hasta completar la evaluación visual y aprobar el veredicto.",
  };

  const pool = new Pool({ connectionString: databaseUrl });
  const store = createLocalLoraArtifactStore();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Las FK de los artefactos exigen que dataset y corrida existan antes de registrar sus archivos.
    await client.query(
      `INSERT INTO lora_datasets (id, label, schema_version, status, trigger_token, source_definition)
       VALUES ($1, $2, $3, 'building', $4, $5::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [DATASET_ID, manifest.dataset.label, manifest.schemaVersion, manifest.dataset.trigger, json(sourceDefinition)],
    );
    const zipArtifact = await putArtifact(client, store, {
      id: `${DATASET_ID}:dataset_zip`, datasetId: DATASET_ID, kind: "dataset_zip",
      key: `datasets/${DATASET_ID}/dataset.zip`, bytes: zipBytes,
      metadata: { schemaVersion: manifest.schemaVersion, sha256: manifest.dataset.zipSha256 },
    });
    const manifestArtifact = await putArtifact(client, store, {
      id: `${DATASET_ID}:manifest`, datasetId: DATASET_ID, kind: "manifest",
      key: `datasets/${DATASET_ID}/manifest.json`, bytes: manifestBytes,
      metadata: { schemaVersion: manifest.schemaVersion },
    });
    await client.query(
      `INSERT INTO lora_training_runs
        (id, label, dataset_id, specialization, trigger_token, base_model, tokenizer_revision, resolution,
         provider, trainer_endpoint, output_lora_format, steps, learning_rate, status, artifact_status,
         license_status, evaluation_status)
       VALUES ($1, $2, $3, 'product', $4, 'FLUX.2 [dev]', 'Mistral VLM 24B', 1024, 'fal',
               'https://queue.fal.run/fal-ai/flux-2-trainer', 'safetensors', $5, $6, 'draft', 'pending', 'verified', 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [RUN_ID, RUN_LABEL, DATASET_ID, manifest.dataset.trigger, STEPS, LEARNING_RATE],
    );
    const weightArtifact = await putArtifact(client, store, {
      id: `${RUN_ID}:weights`, runId: RUN_ID, kind: "weights",
      key: `runs/${RUN_ID}/weights.safetensors`, bytes: weightsBytes, providerUrl: WEIGHTS_URL,
      metadata: { requestId: REQUEST_ID, fileName: "pytorch_lora_weights.safetensors", architecture: weightsInfo.architecture, tensors: weightsInfo.tensors },
    });
    const receiptBytes = Buffer.from(JSON.stringify({
      schemaVersion: "lora-training-receipt.v1",
      requestId: REQUEST_ID,
      dataset: { id: DATASET_ID, zipSha256: zipArtifact.sha256, zipBytes: zipArtifact.bytes },
      weights: { storageKey: weightArtifact.key, sha256: weightArtifact.sha256, bytes: weightArtifact.bytes, providerUrl: WEIGHTS_URL },
      providerResult: providerResultSnapshot,
      receivedAt: new Date().toISOString(),
    }, null, 2));
    const receiptArtifact = await putArtifact(client, store, {
      id: `${RUN_ID}:receipt`, runId: RUN_ID, kind: "receipt",
      key: `runs/${RUN_ID}/receipt.json`, bytes: receiptBytes,
      metadata: { requestId: REQUEST_ID },
    });

    await client.query(
      `INSERT INTO lora_datasets
        (id, label, schema_version, status, trigger_token, source_definition,
         image_count, caption_count, zip_storage_key, zip_sha256, zip_bytes,
         manifest_storage_key, manifest_sha256, statistics, coverage_status,
         coverage_reviewed_images, coverage_total_images, exported_at,
         specialization, structure_types, base_model, tokenizer_revision, resolution,
         caption_schema_version, caption_audit, license_status, evaluation_status, split_policy, updated_at)
       VALUES ($1, $2, $3, 'ready', $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
               'complete', $6, $6, now(), 'product', '[]'::jsonb, 'FLUX.2 [dev]', 'Mistral VLM 24B',
               1024, $14, $15::jsonb, 'verified', 'pending', $16::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, schema_version = EXCLUDED.schema_version, status = EXCLUDED.status,
         trigger_token = EXCLUDED.trigger_token, source_definition = EXCLUDED.source_definition,
         image_count = EXCLUDED.image_count, caption_count = EXCLUDED.caption_count,
         zip_storage_key = EXCLUDED.zip_storage_key, zip_sha256 = EXCLUDED.zip_sha256, zip_bytes = EXCLUDED.zip_bytes,
         manifest_storage_key = EXCLUDED.manifest_storage_key, manifest_sha256 = EXCLUDED.manifest_sha256,
         statistics = EXCLUDED.statistics, coverage_status = EXCLUDED.coverage_status,
         coverage_reviewed_images = EXCLUDED.coverage_reviewed_images, coverage_total_images = EXCLUDED.coverage_total_images,
         exported_at = EXCLUDED.exported_at, specialization = EXCLUDED.specialization,
         structure_types = EXCLUDED.structure_types, base_model = EXCLUDED.base_model,
         tokenizer_revision = EXCLUDED.tokenizer_revision, resolution = EXCLUDED.resolution,
         caption_schema_version = EXCLUDED.caption_schema_version, caption_audit = EXCLUDED.caption_audit,
         license_status = EXCLUDED.license_status,
         evaluation_status = CASE WHEN lora_datasets.evaluation_status = 'approved' THEN 'approved' ELSE EXCLUDED.evaluation_status END,
         split_policy = EXCLUDED.split_policy, updated_at = now()`,
      [DATASET_ID, manifest.dataset.label, manifest.schemaVersion, manifest.dataset.trigger, json(sourceDefinition), manifest.dataset.imageCount,
        manifest.dataset.captionCount, zipArtifact.key, zipArtifact.sha256, zipInfo.size, manifestArtifact.key, manifestArtifact.sha256,
        json(manifest.statistics), manifest.sourceDefinition.contractVersion ?? "lora-caption-v3-structure-clauses", json(captionAudit),
        json({ included: "approved", excluded: manifest.sourceDefinition.excluidas ?? 0, split: "train" })],
    );

    for (const image of manifest.images) {
      const source = image.source;
      await client.query(
        `INSERT INTO lora_dataset_images
          (dataset_id, image_key, image_sha256, caption_sha256, width, height, mime_type,
           source_kind, source_order, source_photo_index, source_ref, caption_word_count,
           review_status, metadata, split, assembly_id, event_key, structure_types, quality_flags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb,
                 'train', NULL, NULL, '[]'::jsonb, '[]'::jsonb)
         ON CONFLICT DO NOTHING`,
        [DATASET_ID, image.key, image.imageSha256, image.captionSha256, image.width ?? null, image.height ?? null, image.mimeType ?? null,
          source.kind, source.order ?? null, source.photoIndex ?? null, source.ref ?? null, image.captionWordCount, image.reviewStatus, json(image.metadata)],
      );
      for (const element of image.elements) {
        await client.query(
          `INSERT INTO lora_dataset_image_elements
            (dataset_id, image_key, element_kind, canonical_id, label, product_id, variant_id, sku, evidence_kind, evidence_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (dataset_id, image_key, element_kind, canonical_id) DO UPDATE SET
             label = EXCLUDED.label, product_id = EXCLUDED.product_id, variant_id = EXCLUDED.variant_id,
             sku = EXCLUDED.sku, evidence_kind = EXCLUDED.evidence_kind, evidence_ref = EXCLUDED.evidence_ref`,
          [DATASET_ID, image.key, element.elementKind, element.canonicalId, element.label, element.productId ?? null,
            element.variantId ?? null, element.sku ?? null, element.evidenceKind, element.evidenceRef ?? null],
        );
      }
    }

    const statisticGroups: Array<[string, string, unknown[]]> = [
      ["structures", "structure", manifest.statistics.structures],
      ["shopifyVariants", "shopify_variant", manifest.statistics.shopifyVariants],
      ["environment", "environment", manifest.statistics.environment],
      ["spatialRelations", "spatial_relation", manifest.statistics.spatialRelations],
    ];
    for (const [, elementKind, statistics] of statisticGroups) {
      for (const statistic of statistics as Array<Record<string, unknown>>) {
        await client.query(
          `INSERT INTO lora_dataset_element_stats
            (dataset_id, element_kind, canonical_id, label, product_id, variant_id, sku, image_count, representation_pct, image_keys)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
           ON CONFLICT (dataset_id, element_kind, canonical_id) DO UPDATE SET
             label = EXCLUDED.label, product_id = EXCLUDED.product_id, variant_id = EXCLUDED.variant_id,
             sku = EXCLUDED.sku, image_count = EXCLUDED.image_count,
             representation_pct = EXCLUDED.representation_pct, image_keys = EXCLUDED.image_keys`,
          [DATASET_ID, elementKind, statistic.canonicalId, statistic.label, statistic.productId ?? null, statistic.variantId ?? null,
            statistic.sku ?? null, statistic.imageCount, statistic.representationPct, json(statistic.imageKeys)],
        );
      }
    }

    await client.query(
      `INSERT INTO lora_training_runs
        (id, label, dataset_id, specialization, trigger_token, base_model, tokenizer_revision, resolution,
         provider, trainer_endpoint, output_lora_format, steps, learning_rate, estimated_cost_usd, actual_cost_usd,
         status, provider_request_id, provider_response_url, result_url, weight_storage_key, weight_sha256, weight_bytes,
         rank, architecture, artifact_status, configuration_snapshot, provider_result_snapshot,
         license_status, evaluation_status, completed_at, received_at, submitted_at, started_at, updated_at)
       VALUES ($1, $2, $3, 'product', $4, 'FLUX.2 [dev]', 'Mistral VLM 24B', 1024, 'fal',
               'https://queue.fal.run/fal-ai/flux-2-trainer', 'safetensors', $5, $6, $7, $7, 'succeeded',
               $8, $9, $10, $11, $12, $13, $14, $15, 'backed_up', $16::jsonb, $17::jsonb,
               'verified', 'pending', now(), now(), now(), now(), now())
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label, dataset_id = EXCLUDED.dataset_id, trigger_token = EXCLUDED.trigger_token,
         steps = EXCLUDED.steps, learning_rate = EXCLUDED.learning_rate, estimated_cost_usd = EXCLUDED.estimated_cost_usd,
         actual_cost_usd = EXCLUDED.actual_cost_usd, status = EXCLUDED.status, provider_request_id = EXCLUDED.provider_request_id,
         provider_response_url = EXCLUDED.provider_response_url, result_url = EXCLUDED.result_url,
         weight_storage_key = EXCLUDED.weight_storage_key, weight_sha256 = EXCLUDED.weight_sha256,
         weight_bytes = EXCLUDED.weight_bytes, rank = EXCLUDED.rank, architecture = EXCLUDED.architecture,
         artifact_status = EXCLUDED.artifact_status, configuration_snapshot = EXCLUDED.configuration_snapshot,
         provider_result_snapshot = EXCLUDED.provider_result_snapshot, license_status = EXCLUDED.license_status,
         evaluation_status = CASE WHEN lora_training_runs.evaluation_status = 'approved' THEN 'approved' ELSE EXCLUDED.evaluation_status END,
         completed_at = EXCLUDED.completed_at,
         received_at = EXCLUDED.received_at, submitted_at = EXCLUDED.submitted_at, started_at = EXCLUDED.started_at, updated_at = now()`,
      [RUN_ID, RUN_LABEL, DATASET_ID, manifest.dataset.trigger, STEPS, LEARNING_RATE, COST_USD, REQUEST_ID,
        TRAINING_PAGE_URL, WEIGHTS_URL, weightArtifact.key, weightArtifact.sha256, weightArtifact.bytes,
        weightsInfo.rank, weightsInfo.architecture, json(configurationSnapshot), json({ ...providerResultSnapshot, receiptKey: receiptArtifact.key })],
    );

    await client.query(
      `INSERT INTO lora_evaluations
        (id, training_run_id, protocol_version, lora_scale, seeds, criteria,
         passed_count, total_count, verdict, result_snapshot)
       VALUES ($1, $2, 'lora-eval-v1', $3, $4::jsonb, $5::jsonb, 0, 6, 'pending', $6::jsonb)
       ON CONFLICT (training_run_id, protocol_version, lora_scale) DO UPDATE SET
         criteria = EXCLUDED.criteria, result_snapshot = EXCLUDED.result_snapshot`,
      [`${RUN_ID}:eval-v1-scale08`, RUN_ID, LORA_SCALE, json([101, 202, 303, 404, 505, 606]), json(evaluationCriteria), json({ source: "registrar-lora-v007-fal", trainingPage: TRAINING_PAGE_URL })],
    );

    const previous = await client.query<{ training_run_id: string | null }>("SELECT training_run_id FROM lora_mode_slots WHERE slug = 'training_1' FOR UPDATE");
    const previousRunId = previous.rows[0]?.training_run_id ?? null;
    const history = await client.query(
      `SELECT 1 FROM lora_mode_slot_history WHERE slot_slug = 'training_1' AND new_run_id = $1 AND action = 'assign' LIMIT 1`,
      [RUN_ID],
    );
    if (history.rowCount === 0) {
      await client.query(
        `INSERT INTO lora_mode_slot_history
          (slot_slug, previous_run_id, new_run_id, action, lora_scale, evaluation_snapshot, actor)
         VALUES ('training_1', $1, $2, 'assign', $3, $4::jsonb, 'registrar-lora-v007-fal')`,
        [previousRunId, RUN_ID, LORA_SCALE, json({ verdict: "pending", requestId: REQUEST_ID, artifactStatus: "backed_up" })],
      );
    }
    await client.query(
      `UPDATE lora_mode_slots SET display_name = 'Producto Sempertex v007', training_run_id = $1,
          enforce_dataset_allowlist = TRUE, lora_scale = $2, enabled = TRUE, updated_at = now()
       WHERE slug = 'training_1'`,
      [RUN_ID, LORA_SCALE],
    );
    await client.query("COMMIT");
    console.log(`[PASS] v007 cableado: ${manifest.images.length} imágenes, ${manifest.dataset.captionCount} captions`);
    console.log(`      corrida: ${RUN_ID} · Fal: ${REQUEST_ID} · ${STEPS} pasos · lr ${LEARNING_RATE}`);
    console.log(`      pesos: ${weightArtifact.bytes} bytes · SHA-256 ${weightArtifact.sha256}`);
    console.log(`      slot training_1: asignado · evaluación: PENDIENTE · escala ${LORA_SCALE}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] registro v007:", error);
  process.exitCode = 1;
});
