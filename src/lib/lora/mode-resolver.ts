import "server-only";

import type { Pool } from "pg";
import { getRagPool } from "@/lib/rag/db";
import { LoraModeSlugSchema, LoraSelectionSchema, type LoraModeSlug, type LoraSelection, type LoraSpecialization } from "./schema";
import { assertLoraCompatibility, type LoraCompatibilityArtifact } from "./compatibility";
import { LORA_V007_CATALOG_SOURCE_IDS, LORA_V007_DATASET_ID } from "./v007-catalog-allowlist";
import { buildLookupIndexes, resolveProductConcept } from "./product-vocabulary";
import { PRODUCT_VOCABULARY } from "./product-vocabulary-data";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { crearCatalogAllowlist } from "@/lib/rag/retrieval/allowlist";
import { linkDatasetToCurrentCatalog } from "./dataset-catalog-link";

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
  status: "disabled" | "not_configured" | "pending" | "running" | "succeeded" | "failed" | "ready" | "provider_url_missing" | "testing_rejected";
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

export async function resolveLoraMode(mode: LoraModeSlug, pool: Pool = getRagPool()): Promise<ResolvedLoraApplication[]> {
  const parsedMode = LoraModeSlugSchema.parse(mode);
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
    if (productIds.length || variantIds.length) return filtrarPorVocabulario(pool, { productIds, variantIds });
  }

  // Los ids guardados en el dataset pertenecen al catálogo de cuando se
  // construyó; se vinculan al snapshot vigente por id o SKU canónico exacto.
  const vinculo = await linkDatasetToCurrentCatalog(pool, option.dataset_id);
  const sinVincular = vinculo.unmatched.length + vinculo.ambiguous.length + vinculo.conflicts.length;
  if (sinVincular > 0) {
    console.warn("[lora-allowlist] elementos del dataset sin vínculo al catálogo vigente", {
      datasetId: option.dataset_id,
      linked: vinculo.linked.length,
      unmatched: vinculo.unmatched.length,
      ambiguous: vinculo.ambiguous.length,
      conflicts: vinculo.conflicts.length,
    });
  }
  if (vinculo.linked.length === 0) {
    if (sinVincular === 0) throw new Error(`LORA_DATASET_ALLOWLIST_EMPTY: ${option.dataset_id}`);
    throw new Error(
      `LORA_DATASET_CATALOG_UNLINKED: ${option.dataset_id} (unmatched=${vinculo.unmatched.length}, ambiguous=${vinculo.ambiguous.length}, conflicts=${vinculo.conflicts.length})`,
    );
  }
  const productIds = [...new Set(vinculo.linked.map((item) => item.productId))];
  const variantIdsRepresentados = vinculo.linked.flatMap((item) => item.variantId ? [item.variantId] : []);

  // El tamaño de paquete (unidades_paq) no cambia el globo que el LoRA vio:
  // es la misma familia/modelo/color/diámetro empacado distinto. Restringir
  // por variant_id exacto bloqueaba paquetes nunca fotografiados de un globo
  // que sí está cubierto (ej. R-12 Fashion Fucsia PAQ X20 cubre PAQ X50).
  // Se amplía a cualquier variante que comparta product_id + forma + diámetro
  // con una variante representada — "modelo, familia y tamaño", no empaque.
  const familias = await pool.query<{ product_id: string; variant_id: string }>(
    `WITH identidad_visual AS (
       SELECT DISTINCT v.product_id, v.forma, v.diam_pulg
         FROM catalog_variants v
        WHERE v.variant_id = ANY($1::text[])
     )
     SELECT DISTINCT v.product_id, v.variant_id
       FROM catalog_variants v
       JOIN identidad_visual iv
         ON iv.product_id = v.product_id
        AND iv.forma IS NOT DISTINCT FROM v.forma
        AND iv.diam_pulg IS NOT DISTINCT FROM v.diam_pulg`,
    [variantIdsRepresentados],
  );
  const variantIds = [...new Set([...variantIdsRepresentados, ...familias.rows.map((row) => row.variant_id)])];
  return filtrarPorVocabulario(pool, { productIds, variantIds });
}

/**
 * El allowlist dice qué vio el modelo; el vocabulario dice qué sabemos
 * describir sin nombres comerciales. Eran dos coberturas distintas: el dataset
 * v004 incluye impresos y artículos de mesa (platos, servilletas, manteles,
 * tiaras, kits) que el vocabulario dejó fuera a propósito para no inventar
 * descripciones. Ofrecerlos terminaba en LORA_PRODUCT_VOCABULARY_FAILED al
 * generar, ya con el plan armado y aprobado.
 *
 * Se intersectan aquí para que un elemento indescribible simplemente no se
 * ofrezca, en vez de fallar al final. La resolución replica la precedencia de
 * `resolveProductConcept`: ids (variante, producto, sku) y luego título.
 */
async function filtrarPorVocabulario(
  pool: Pool,
  allowlist: { productIds: readonly string[]; variantIds: readonly string[] },
): Promise<CatalogAllowlist> {
  // Without variant information the dataset only authorizes products.
  if (!allowlist.variantIds.length) {
    return crearCatalogAllowlist(allowlist.productIds.map((productId) => ({ productId, variantId: null })));
  }
  const filas = await pool.query<{ variant_id: string; product_id: string; sku: string | null; titulo: string | null }>(
    `SELECT v.variant_id, v.product_id, v.sku, p.title AS titulo
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.variant_id = ANY($1::text[])`,
    [[...allowlist.variantIds]],
  );
  const indexes = buildLookupIndexes(PRODUCT_VOCABULARY);
  const describible = (fila: (typeof filas.rows)[number]): boolean => {
    for (const id of [fila.variant_id, fila.product_id, fila.sku]) {
      if (id && resolveProductConcept({ productId: id }, PRODUCT_VOCABULARY, indexes).status === "resolved") return true;
    }
    return Boolean(fila.titulo) && resolveProductConcept({ text: fila.titulo! }, PRODUCT_VOCABULARY, indexes).status === "resolved";
  };
  const permitidas = filas.rows.filter(describible);
  if (!permitidas.length) throw new Error(`LORA_VOCABULARY_ALLOWLIST_EMPTY: ninguna variante del dataset tiene concepto de vocabulario.`);
  // Each row is a joined catalog row, so the product→variant pair is real.
  return crearCatalogAllowlist(permitidas.map((fila) => ({ productId: fila.product_id, variantId: fila.variant_id })));
}
