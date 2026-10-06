import "server-only";

import type { Pool } from "pg";
import { getRagPool } from "@/lib/rag/db";
import { LORA_BASE_MODE, LoraModeSlugSchema, LoraSelectionSchema, type LoraModeSlug, type LoraSelection, type LoraSpecialization, type LoraTrainedModeSlug } from "./schema";
import { assertLoraCompatibility, type LoraCompatibilityArtifact } from "./compatibility";

export type ResolvedLoraApplication = LoraCompatibilityArtifact & {
  artifactId: string;
  runId: string;
  datasetId: string;
  label: string;
  path: string;
};

type ArtifactRow = {
  artifact_id: string;
  run_id: string;
  dataset_id: string;
  label: string;
  specialization: LoraSpecialization;
  provider_url: string | null;
  trigger_token: string;
  base_model: string;
  tokenizer_revision: string;
  resolution: number;
  run_status: string;
  artifact_status: string;
  evaluation_status: string;
};

type ModeOptionRow = {
  slug: LoraTrainedModeSlug;
  display_name: string;
  training_run_id: string | null;
  dataset_id: string | null;
  enforce_dataset_allowlist: boolean;
  lora_scale: number;
  enabled: boolean;
  updated_at: string;
  run_status: string | null;
  specialization: LoraSpecialization | null;
  trigger_token: string | null;
  artifact_id: string | null;
  artifact_status: string | null;
  evaluation_status: string | null;
  provider_url: string | null;
};

export type LoraModeOption = {
  slug: LoraTrainedModeSlug;
  display_name: string;
  training_run_id: string | null;
  dataset_id: string | null;
  enforce_dataset_allowlist: boolean;
  lora_scale: number;
  enabled: boolean;
  updated_at: string;
  status: "disabled" | "not_configured" | "pending" | "running" | "succeeded" | "failed" | "ready" | "provider_url_missing" | "testing_rejected";
  ready: boolean;
  trigger_token: string | null;
  selection: LoraSelection | null;
};

const DEFAULT_SCALES: Record<LoraSpecialization, number> = {
  product: 0.3,
  structure: 0.6,
};

function isCompletedRun(status: string | null): boolean {
  return status === "succeeded" || status === "completed";
}

function permiteEvaluacionRechazadaEnPruebas(): boolean {
  return process.env.NODE_ENV === "development" && process.env.LORA_ALLOW_REJECTED_FOR_TESTING === "true";
}

function modeStatus(row: ModeOptionRow): LoraModeOption["status"] {
  if (!row.enabled) return "disabled";
  if (!row.training_run_id) return "not_configured";
  if (!isCompletedRun(row.run_status)) return row.run_status === "running" ? "running" : row.run_status === "failed" ? "failed" : "pending";
  if (row.evaluation_status === "rejected") {
    return permiteEvaluacionRechazadaEnPruebas() && row.artifact_status === "backed_up" && Boolean(row.provider_url)
      ? "testing_rejected"
      : "failed";
  }
  if (row.artifact_status !== "backed_up" || row.evaluation_status !== "approved") return "pending";
  if (!row.provider_url) return "provider_url_missing";
  return "ready";
}

export async function listLoraModeOptions(pool: Pool = getRagPool()): Promise<LoraModeOption[]> {
  const result = await pool.query<ModeOptionRow>(
    `SELECT slots.slug, slots.display_name, slots.training_run_id,
            runs.dataset_id AS dataset_id,
            slots.enforce_dataset_allowlist, slots.lora_scale::float8,
            slots.enabled, slots.updated_at::text,
            runs.status AS run_status, runs.specialization,
            runs.trigger_token, runs.evaluation_status,
            artifacts.id AS artifact_id, artifacts.status AS artifact_status,
            artifacts.provider_url
       FROM lora_mode_slots AS slots
       LEFT JOIN lora_training_runs AS runs ON runs.id = slots.training_run_id
       LEFT JOIN LATERAL (
         SELECT id, status, provider_url
           FROM lora_artifacts
          WHERE run_id = runs.id AND kind = 'weights'
          ORDER BY created_at DESC
          LIMIT 1
       ) AS artifacts ON TRUE
      ORDER BY CASE slots.slug
        WHEN 'unlimited' THEN 1
        WHEN 'training_1' THEN 2
        WHEN 'training_2' THEN 3
      END`,
  );

  return result.rows.map((row) => {
    const status = modeStatus(row);
    const ready = (status === "ready" || status === "testing_rejected") && Boolean(row.artifact_id && row.specialization);
    const selection = ready && row.artifact_id && row.specialization
      ? row.specialization === "product"
        ? { product: { artifactId: row.artifact_id, scale: row.lora_scale } }
        : { structure: { artifactId: row.artifact_id, scale: row.lora_scale } }
      : null;
    return {
      slug: row.slug,
      display_name: row.display_name,
      training_run_id: row.training_run_id,
      dataset_id: row.dataset_id,
      enforce_dataset_allowlist: row.enforce_dataset_allowlist,
      lora_scale: row.lora_scale,
      enabled: row.enabled,
      updated_at: row.updated_at,
      status,
      ready,
      trigger_token: row.trigger_token,
      selection,
    } satisfies LoraModeOption;
  });
}

/**
 * `base` resolves to no application at all: the base FLUX.2 model with
 * `loras: []` and no trigger. It never reads the registry, so it works with no
 * slot row and does not depend on the state of any trained LoRA.
 */
export async function resolveLoraMode(mode: LoraModeSlug, poolDado?: Pool): Promise<ResolvedLoraApplication[]> {
  const parsedMode = LoraModeSlugSchema.parse(mode);
  // Antes de tocar la base de datos: el pool por defecto se evaluaba en la firma y el modo base fallaba sin
  // `DATABASE_URL` aunque no la usa.
  if (parsedMode === LORA_BASE_MODE) return [];
  const pool = poolDado ?? getRagPool();
  const option = (await listLoraModeOptions(pool)).find((candidate) => candidate.slug === parsedMode);
  if (!option) throw new Error(`LORA_MODE_NOT_FOUND: ${parsedMode}`);
  if (!option.enabled) throw new Error(`LORA_MODE_DISABLED: ${parsedMode}`);
  if (!option.training_run_id) throw new Error(`LORA_MODE_NOT_CONFIGURED: ${parsedMode}`);
  if (!option.ready || !option.selection) throw new Error(`LORA_MODE_NOT_READY: ${parsedMode} (${option.status})`);
  return resolveLoraSelection(option.selection, pool);
}

export async function resolveLoraSelection(
  selection: LoraSelection,
  pool: Pool = getRagPool(),
): Promise<ResolvedLoraApplication[]> {
  const parsed = LoraSelectionSchema.parse(selection);
  const selected = Object.entries(parsed).filter((entry): entry is [LoraSpecialization, { artifactId: string; scale?: number }] => Boolean(entry[1]));
  const ids = selected.map(([, value]) => value.artifactId);
  const result = await pool.query<ArtifactRow>(
    `SELECT artifacts.id AS artifact_id,
            artifacts.run_id,
            artifacts.dataset_id,
            runs.label,
            artifacts.specialization,
            artifacts.provider_url,
            runs.trigger_token,
            runs.base_model,
            runs.tokenizer_revision,
            runs.resolution,
            runs.status AS run_status,
            artifacts.status AS artifact_status,
            runs.evaluation_status
       FROM lora_artifacts AS artifacts
       JOIN lora_training_runs AS runs ON runs.id = artifacts.run_id
      WHERE artifacts.id = ANY($1::text[])
        AND artifacts.kind = 'weights'`,
    [ids],
  );

  const byId = new Map(result.rows.map((row) => [row.artifact_id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`LORA_ARTIFACT_NOT_FOUND: ${missing.join(", ")}`);

  const applications = selected.map(([specialization, value]) => {
    const row = byId.get(value.artifactId)!;
    if (row.specialization !== specialization) throw new Error(`LORA_SPECIALIZATION_MISMATCH: ${value.artifactId}`);
    if (!isCompletedRun(row.run_status)) throw new Error(`LORA_RUN_NOT_COMPLETED: ${row.run_id}`);
    if (row.artifact_status !== "backed_up") throw new Error(`LORA_ARTIFACT_NOT_APPROVED: ${row.artifact_id}`);
    if (row.evaluation_status !== "approved" && !permiteEvaluacionRechazadaEnPruebas()) {
      throw new Error(`LORA_EVALUATION_REQUIRED: ${row.run_id}`);
    }
    if (!row.provider_url) throw new Error(`LORA_PROVIDER_URL_MISSING: ${row.artifact_id}`);
    return {
      artifactId: row.artifact_id,
      runId: row.run_id,
      datasetId: row.dataset_id,
      label: row.label,
      specialization,
      providerUrl: row.provider_url,
      path: row.provider_url,
      trigger: row.trigger_token,
      baseModel: row.base_model,
      tokenizerRevision: row.tokenizer_revision,
      resolution: row.resolution,
      scale: value.scale ?? DEFAULT_SCALES[specialization],
    } satisfies ResolvedLoraApplication;
  });

  assertLoraCompatibility(applications);
  return applications;
}
