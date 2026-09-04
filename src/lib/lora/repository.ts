import "server-only";

import type { Pool } from "pg";
import { getRagPool } from "@/lib/rag/db";

export type LoraPool = Pool;

export type LoraModeSlotRow = {
  slug: "unlimited" | "training_1" | "training_2";
  display_name: string;
  training_run_id: string | null;
  enforce_dataset_allowlist: boolean;
  lora_scale: number;
  enabled: boolean;
  updated_at: string;
};

export type LoraTrainingRunRow = {
  id: string;
  label: string;
  dataset_id: string;
  dataset_label: string;
  specialization: "product" | "structure";
  trigger_token: string;
  base_model: string;
  tokenizer_revision: string;
  resolution: number;
  evaluation_status: string;
  image_count: number;
  caption_count: number;
  coverage_status: string;
  provider: string;
  trainer_endpoint: string;
  steps: number;
  learning_rate: number;
  estimated_epochs: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  status: string;
  artifact_status: string;
  provider_request_id: string | null;
  weight_storage_key: string | null;
  weight_sha256: string | null;
  rank: number | null;
  architecture: string | null;
  evaluation_verdict: string | null;
  evaluation_passed_count: number | null;
  evaluation_total_count: number | null;
  evaluation_lora_scale: number | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  received_at: string | null;
};

export type LoraDatasetRow = {
  id: string;
  label: string;
  specialization: "product" | "structure";
  structure_types: unknown;
  base_model: string;
  tokenizer_revision: string;
  resolution: number;
  caption_audit: unknown;
  license_status: string;
  evaluation_status: string;
  schema_version: string;
  status: string;
  trigger_token: string;
  image_count: number;
  caption_count: number;
  coverage_status: string;
  coverage_reviewed_images: number;
  coverage_total_images: number;
  zip_storage_key: string | null;
  zip_sha256: string | null;
  manifest_storage_key: string | null;
  manifest_sha256: string | null;
  statistics: unknown;
  source_definition: unknown;
  created_at: string;
  exported_at: string | null;
  archived_at: string | null;
};

export type LoraTrainingControlRow = {
  id: string;
  label: string;
  dataset_id: string;
  specialization: "product" | "structure";
  trigger_token: string;
  base_model: string;
  tokenizer_revision: string;
  resolution: number;
  evaluation_status: string;
  trainer_endpoint: string;
  output_lora_format: string;
  steps: number;
  learning_rate: number;
  estimated_cost_usd: number | null;
  status: string;
  artifact_status: string;
  provider_request_id: string | null;
  provider_status_url: string | null;
  provider_response_url: string | null;
  uploaded_dataset_url: string | null;
  configuration_snapshot: Record<string, unknown>;
  zip_storage_key: string | null;
  zip_sha256: string | null;
  image_count: number;
  caption_count: number;
  coverage_status: string;
};

export type LoraJobRow = {
  id: string;
  kind: string;
  resource_id: string;
  status: string;
  attempts: number;
  locked_at: string | null;
  heartbeat_at: string | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

export type LoraArtifactRow = {
  id: string;
  run_id: string;
  dataset_id: string;
  label: string;
  specialization: "product" | "structure";
  kind: string;
  provider_url: string | null;
  sha256: string;
  bytes: number;
  status: string;
  evaluation_status: string;
  base_model: string;
  tokenizer_revision: string;
  resolution: number;
  trigger_token: string;
  created_at: string;
};

export type LoraOverview = {
  slots: LoraModeSlotRow[];
  recentRuns: LoraTrainingRunRow[];
  recentJobs: LoraJobRow[];
  alerts: string[];
};

export async function listLoraModeSlots(pool: LoraPool = getRagPool()): Promise<LoraModeSlotRow[]> {
  const result = await pool.query<LoraModeSlotRow>(
    `SELECT slug, display_name, training_run_id, enforce_dataset_allowlist,
            lora_scale::float8, enabled, updated_at::text
       FROM lora_mode_slots
      ORDER BY CASE slug
        WHEN 'unlimited' THEN 1
        WHEN 'training_1' THEN 2
        WHEN 'training_2' THEN 3
      END`,
  );
  return result.rows;
}

export async function listLoraDatasets(
  options: { limit?: number; offset?: number } = {},
  pool: LoraPool = getRagPool(),
): Promise<LoraDatasetRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const result = await pool.query<LoraDatasetRow>(
    `SELECT id, label, specialization, structure_types, base_model,
            tokenizer_revision, resolution, caption_audit, license_status,
            evaluation_status, schema_version, status, trigger_token, image_count,
            caption_count, coverage_status, coverage_reviewed_images,
            coverage_total_images, zip_storage_key, zip_sha256,
            manifest_storage_key, manifest_sha256, statistics,
            source_definition, created_at::text, exported_at::text,
            archived_at::text
       FROM lora_datasets
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

export async function getLoraDataset(id: string, pool: LoraPool = getRagPool()): Promise<LoraDatasetRow | null> {
  const result = await pool.query<LoraDatasetRow>(
    `SELECT id, label, specialization, structure_types, base_model,
            tokenizer_revision, resolution, caption_audit, license_status,
            evaluation_status, schema_version, status, trigger_token, image_count,
            caption_count, coverage_status, coverage_reviewed_images,
            coverage_total_images, zip_storage_key, zip_sha256,
            manifest_storage_key, manifest_sha256, statistics,
            source_definition, created_at::text, exported_at::text,
            archived_at::text
       FROM lora_datasets
      WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createLoraDatasetDraft(
  input: {
    id: string;
    label: string;
    specialization: "product" | "structure";
    triggerToken: string;
    structureTypes: string[];
    baseModel: string;
    tokenizerRevision: string;
    resolution: number;
    imageCount: number;
    captionCount: number;
    coverageReviewedImages: number;
    coverageTotalImages: number;
    captionAudit: Record<string, unknown>;
    sourceDefinition: Record<string, unknown>;
  },
  pool: LoraPool = getRagPool(),
): Promise<{ id: string; label: string; specialization: string; status: string }> {
  const result = await pool.query<{ id: string; label: string; specialization: string; status: string }>(
    `INSERT INTO lora_datasets
      (id, label, schema_version, specialization, structure_types, trigger_token,
       base_model, tokenizer_revision, resolution, image_count, caption_count,
       coverage_status, coverage_reviewed_images, coverage_total_images,
       caption_audit, source_definition, status)
     VALUES ($1, $2, 'lora-dataset-manifest.v2', $3, $4::jsonb, $5, $6, $7, $8,
       $9, $10, 'unknown', $11, $12, $13::jsonb, $14::jsonb, 'building')
     RETURNING id, label, specialization, status`,
    [
      input.id,
      input.label,
      input.specialization,
      JSON.stringify(input.structureTypes),
      input.triggerToken,
      input.baseModel,
      input.tokenizerRevision,
      input.resolution,
      input.imageCount,
      input.captionCount,
      input.coverageReviewedImages,
      input.coverageTotalImages,
      JSON.stringify(input.captionAudit),
      JSON.stringify(input.sourceDefinition),
    ],
  );
  return result.rows[0]!;
}

export async function createLoraTrainingDraft(
  input: {
    id: string;
    label: string;
    datasetId: string;
    specialization?: "product" | "structure";
    triggerToken?: string;
    baseModel?: string;
    tokenizerRevision?: string;
    resolution?: number;
    captionAudit?: Record<string, unknown>;
    licenseStatus?: "pending" | "verified" | "rejected";
    trainerEndpoint: string;
    steps: number;
    learningRate: number;
    estimatedCostUsd: number;
    configurationSnapshot: Record<string, unknown>;
  },
  pool: LoraPool = getRagPool(),
): Promise<{ id: string; label: string; status: string; estimated_cost_usd: number }> {
  const result = await pool.query<{ id: string; label: string; status: string; estimated_cost_usd: number }>(
    `INSERT INTO lora_training_runs
      (id, label, dataset_id, specialization, trigger_token, base_model,
       tokenizer_revision, resolution, provider, trainer_endpoint,
       output_lora_format, steps, learning_rate, estimated_cost_usd, status,
       artifact_status, license_status, caption_audit, configuration_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'fal', $9, 'fal', $10, $11,
       $12, 'draft', 'pending', $13, $14::jsonb, $15::jsonb)
     RETURNING id, label, status, estimated_cost_usd::float8`,
    [
      input.id,
      input.label,
      input.datasetId,
      input.specialization ?? "product",
      input.triggerToken ?? "eventdecor_style_v2",
      input.baseModel ?? "FLUX.2 [dev]",
      input.tokenizerRevision ?? "provider-default",
      input.resolution ?? 1024,
      input.trainerEndpoint,
      input.steps,
      input.learningRate,
      input.estimatedCostUsd,
      input.licenseStatus ?? "pending",
      JSON.stringify(input.captionAudit ?? {}),
      JSON.stringify(input.configurationSnapshot),
    ],
  );
  return result.rows[0];
}

export async function getLoraTrainingControl(
  id: string,
  pool: LoraPool = getRagPool(),
): Promise<LoraTrainingControlRow | null> {
  const result = await pool.query<LoraTrainingControlRow>(
    `SELECT runs.id, runs.label, runs.dataset_id, runs.specialization,
            runs.trigger_token, runs.base_model, runs.tokenizer_revision,
            runs.resolution, runs.evaluation_status, runs.trainer_endpoint,
            runs.output_lora_format, runs.steps, runs.learning_rate::float8,
            runs.estimated_cost_usd::float8, runs.status, runs.artifact_status,
            runs.provider_request_id, runs.provider_status_url,
            runs.provider_response_url, runs.uploaded_dataset_url,
            runs.configuration_snapshot, datasets.zip_storage_key,
            datasets.zip_sha256, datasets.image_count, datasets.caption_count,
            datasets.coverage_status
       FROM lora_training_runs AS runs
       JOIN lora_datasets AS datasets ON datasets.id = runs.dataset_id
      WHERE runs.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listLoraArtifacts(
  options: { specialization?: "product" | "structure"; limit?: number } = {},
  pool: LoraPool = getRagPool(),
): Promise<LoraArtifactRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const values: unknown[] = [limit];
  const specializationFilter = options.specialization ? "AND artifacts.specialization = $2" : "";
  if (options.specialization) values.push(options.specialization);
  const result = await pool.query<LoraArtifactRow>(
    `SELECT artifacts.id, artifacts.run_id, artifacts.dataset_id,
            runs.label, artifacts.specialization, artifacts.kind,
            artifacts.provider_url, artifacts.sha256, artifacts.bytes,
            artifacts.status, runs.evaluation_status, runs.base_model,
            runs.tokenizer_revision, runs.resolution, runs.trigger_token,
            artifacts.created_at::text
       FROM lora_artifacts AS artifacts
       JOIN lora_training_runs AS runs ON runs.id = artifacts.run_id
      WHERE artifacts.kind = 'weights'
        AND artifacts.status = 'backed_up'
        AND runs.status IN ('succeeded', 'completed')
        AND runs.evaluation_status = 'approved'
        ${specializationFilter}
      ORDER BY artifacts.created_at DESC
      LIMIT $1`,
    values,
  );
  return result.rows;
}

export async function listLoraTrainingRuns(
  options: { limit?: number; offset?: number } = {},
  pool: LoraPool = getRagPool(),
): Promise<LoraTrainingRunRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const result = await pool.query<LoraTrainingRunRow>(
    `SELECT runs.id, runs.label, runs.dataset_id,
            runs.specialization, runs.trigger_token, runs.base_model,
            runs.tokenizer_revision, runs.resolution, runs.evaluation_status,
            datasets.label AS dataset_label, datasets.image_count,
            datasets.caption_count, datasets.coverage_status,
            runs.provider, runs.trainer_endpoint, runs.steps,
            runs.learning_rate::float8, runs.estimated_epochs::float8,
            runs.estimated_cost_usd::float8, runs.actual_cost_usd::float8,
            runs.status, runs.artifact_status, runs.provider_request_id,
            runs.weight_storage_key, runs.weight_sha256, runs.rank,
            runs.architecture, evaluations.verdict AS evaluation_verdict,
            evaluations.passed_count AS evaluation_passed_count,
            evaluations.total_count AS evaluation_total_count,
            evaluations.lora_scale::float8 AS evaluation_lora_scale,
            runs.created_at::text, runs.submitted_at::text,
            runs.completed_at::text, runs.received_at::text
       FROM lora_training_runs AS runs
       JOIN lora_datasets AS datasets ON datasets.id = runs.dataset_id
       LEFT JOIN LATERAL (
         SELECT verdict, passed_count, total_count, lora_scale
           FROM lora_evaluations
          WHERE training_run_id = runs.id
          ORDER BY created_at DESC
          LIMIT 1
       ) AS evaluations ON TRUE
      ORDER BY runs.created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

export async function getLoraOverview(pool: LoraPool = getRagPool()): Promise<LoraOverview> {
  const [slots, recentRuns, recentJobs, missingSlotRuns, partialDatasets, failedJobs] = await Promise.all([
    listLoraModeSlots(pool),
    listLoraTrainingRuns({ limit: 10 }, pool),
    pool.query<LoraJobRow>(
      `SELECT id, kind, resource_id, status, attempts, locked_at::text,
              heartbeat_at::text, error_message, created_at::text,
              finished_at::text
         FROM lora_jobs
        WHERE status IN ('pending', 'running', 'failed')
        ORDER BY created_at DESC
        LIMIT 20`,
    ).then((result) => result.rows),
    pool.query<{ slug: string }>(
      `SELECT slug FROM lora_mode_slots
        WHERE enabled = TRUE AND training_run_id IS NULL`,
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM lora_datasets
        WHERE status IN ('ready', 'building') AND coverage_status = 'partial'
        LIMIT 20`,
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM lora_jobs WHERE status = 'failed' LIMIT 20`,
    ),
  ]);

  const alerts = [
    ...missingSlotRuns.rows.map((row) => `slot_sin_corrida:${row.slug}`),
    ...(partialDatasets.rows.length > 0 ? [`datasets_con_cobertura_parcial:${partialDatasets.rows.length}`] : []),
    ...(failedJobs.rows.length > 0 ? [`jobs_fallidos:${failedJobs.rows.length}`] : []),
  ];

  return { slots, recentRuns, recentJobs, alerts };
}
