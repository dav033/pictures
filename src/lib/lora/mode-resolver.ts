import "server-only";

import type { Pool } from "pg";
import { getRagPool } from "@/lib/rag/db";
import { LoraModeSlugSchema, LoraSelectionSchema, type LoraModeSlug, type LoraSelection, type LoraSpecialization } from "./schema";
import { assertLoraCompatibility, type LoraCompatibilityArtifact } from "./compatibility";
import { LORA_V007_CATALOG_SOURCE_IDS, LORA_V007_DATASET_ID } from "./v007-catalog-allowlist";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";

function allowRejectedForLocalTesting(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LORA_ALLOW_REJECTED_FOR_TESTING === "true";
}

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
  slug: LoraModeSlug;
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
  slug: LoraModeSlug;
  display_name: string;
  training_run_id: string | null;
  dataset_id: string | null;
  enforce_dataset_allowlist: boolean;
  lora_scale: number;
  enabled: boolean;
  updated_at: string;
  status: "disabled" | "not_configured" | "pending" | "running" | "succeeded" | "failed" | "ready" | "experimental" | "provider_url_missing";
  ready: boolean;
  trigger_token: string | null;
  selection: LoraSelection | null;
};

const DEFAULT_SCALES: Record<LoraSpecialization, number> = {
  product: 0.3,
  structure: 0.6,
};

export function parseLoraSelection(value: unknown): LoraSelection | null {
  const parsed = LoraSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isCompletedRun(status: string | null): boolean {
  return status === "succeeded" || status === "completed";
}

function modeStatus(row: ModeOptionRow): LoraModeOption["status"] {
  if (!row.enabled) return "disabled";
  if (!row.training_run_id) return "not_configured";
  if (!isCompletedRun(row.run_status)) return row.run_status === "running" ? "running" : row.run_status === "failed" ? "failed" : "pending";
  if (row.evaluation_status === "rejected") return allowRejectedForLocalTesting() ? "experimental" : "failed";
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
    const ready = (status === "ready" || status === "experimental") && Boolean(row.artifact_id && row.specialization);
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

export async function resolveLoraMode(mode: LoraModeSlug, pool: Pool = getRagPool()): Promise<ResolvedLoraApplication[]> {
  const parsedMode = LoraModeSlugSchema.parse(mode);
  const option = (await listLoraModeOptions(pool)).find((candidate) => candidate.slug === parsedMode);
  if (!option) throw new Error(`LORA_MODE_NOT_FOUND: ${parsedMode}`);
  if (!option.enabled) throw new Error(`LORA_MODE_DISABLED: ${parsedMode}`);
  if (!option.training_run_id) throw new Error(`LORA_MODE_NOT_CONFIGURED: ${parsedMode}`);
  if (!option.ready || !option.selection) throw new Error(`LORA_MODE_NOT_READY: ${parsedMode} (${option.status})`);
  return resolveLoraSelection(option.selection, pool, { allowUnapprovedForTesting: option.status === "experimental" });
}

export async function resolveLoraSelection(
  selection: LoraSelection,
  pool: Pool = getRagPool(),
  options: { allowUnapprovedForTesting?: boolean } = {},
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
    if (row.evaluation_status !== "approved" && !(options.allowUnapprovedForTesting && allowRejectedForLocalTesting() && row.evaluation_status === "rejected")) {
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

  if (applications.length > 1 && process.env.FAL_MULTI_LORA_SUPPORTED !== "true") {
    throw new Error("LORA_MULTI_UNSUPPORTED: confirma el schema multi-LoRA del proveedor antes de habilitar dos pesos");
  }
  assertLoraCompatibility(applications);
  return applications;
}

export async function resolveLoraModeDatasetAllowlist(
  mode: unknown,
  pool: Pool = getRagPool(),
): Promise<CatalogAllowlist | null> {
  const parsedMode = LoraModeSlugSchema.parse(mode);
  const option = (await listLoraModeOptions(pool)).find((candidate) => candidate.slug === parsedMode);
  if (!option) throw new Error(`LORA_MODE_NOT_FOUND: ${parsedMode}`);
  if (!option.enabled) throw new Error(`LORA_MODE_DISABLED: ${parsedMode}`);
  if (!option.training_run_id || !option.dataset_id) throw new Error(`LORA_MODE_NOT_CONFIGURED: ${parsedMode}`);
  if (!option.enforce_dataset_allowlist) return null;
  if (!option.ready) throw new Error(`LORA_MODE_NOT_READY: ${parsedMode} (${option.status})`);

  if (option.dataset_id === LORA_V007_DATASET_ID) {
    const materialized = await pool.query<{ product_id: string; variant_id: string }>(
      `SELECT DISTINCT variants.product_id, variants.variant_id
         FROM catalog_variants AS variants
        WHERE variants.sku_canonical = ANY($1::text[])
           OR variants.product_id = ANY($1::text[])`,
      [LORA_V007_CATALOG_SOURCE_IDS],
    );
    const productIds = [...new Set(materialized.rows.map((row) => row.product_id))];
    const variantIds = [...new Set(materialized.rows.map((row) => row.variant_id))];
    if (productIds.length || variantIds.length) return { productIds, variantIds };
  }

  const result = await pool.query<{ product_id: string | null; variant_id: string | null }>(
    `SELECT DISTINCT product_id, variant_id
       FROM lora_dataset_element_stats
      WHERE dataset_id = $1
        AND element_kind = 'shopify_variant'
        AND (product_id IS NOT NULL OR variant_id IS NOT NULL)`,
    [option.dataset_id],
  );
  const productIds = [...new Set(result.rows.flatMap((row) => row.product_id ? [row.product_id] : []))];
  const variantIds = [...new Set(result.rows.flatMap((row) => row.variant_id ? [row.variant_id] : []))];
  if (productIds.length === 0 && variantIds.length === 0) throw new Error(`LORA_DATASET_ALLOWLIST_EMPTY: ${option.dataset_id}`);
  return { productIds, variantIds };
}
