import assert from "node:assert/strict";
import type { Pool } from "pg";
import { listLoraModeOptions, resolveLoraMode } from "../src/lib/lora/mode-resolver";

const modeRow = {
  slug: "training_1" as const,
  display_name: "Producto Sempertex v007",
  training_run_id: "run-v007",
  enforce_dataset_allowlist: true,
  lora_scale: 0.8,
  enabled: true,
  updated_at: "2026-09-03T00:00:00.000Z",
  run_status: "succeeded",
  specialization: "product" as const,
  trigger_token: "eventdecor_style_v3",
  artifact_id: "artifact-v007",
  artifact_status: "backed_up",
  evaluation_status: "approved",
  provider_url: "https://v3b.fal.media/files/product-v007.safetensors",
};

const artifactRow = {
  artifact_id: "artifact-v007",
  run_id: "run-v007",
  dataset_id: "dataset-v007",
  label: "sempertex-producto-v007",
  specialization: "product" as const,
  provider_url: modeRow.provider_url,
  trigger_token: modeRow.trigger_token,
  base_model: "FLUX.2 [dev]",
  tokenizer_revision: "mistral-vlm-24b",
  resolution: 1024,
  run_status: "succeeded",
  artifact_status: "backed_up",
  evaluation_status: "approved",
};

const pool = {
  query: async (sql: string) => sql.includes("lora_mode_slots")
    ? { rows: [modeRow] }
    : { rows: [artifactRow] },
} as unknown as Pool;

async function main(): Promise<void> {
  const options = await listLoraModeOptions(pool);
  assert.equal(options[0]?.ready, true);
  assert.deepEqual(options[0]?.selection, { product: { artifactId: "artifact-v007", scale: 0.8 } });

  const resolved = await resolveLoraMode("training_1", pool);
  assert.equal(resolved[0]?.trigger, "eventdecor_style_v3");
  assert.equal(resolved[0]?.scale, 0.8);

  const pendingPool = {
    query: async () => ({ rows: [{ ...modeRow, run_status: "queued", artifact_id: null, artifact_status: null, evaluation_status: "pending", provider_url: null }] }),
  } as unknown as Pool;
  await assert.rejects(() => resolveLoraMode("training_1", pendingPool), /LORA_MODE_NOT_READY/);

  const rejectedPool = {
    query: async () => ({ rows: [{ ...modeRow, evaluation_status: "rejected" }] }),
  } as unknown as Pool;
  const rejectedOptions = await listLoraModeOptions(rejectedPool);
  assert.equal(rejectedOptions[0]?.status, "failed");
  assert.equal(rejectedOptions[0]?.ready, false);
  await assert.rejects(() => resolveLoraMode("training_1", rejectedPool), /LORA_MODE_NOT_READY/);

  console.log("[PASS] modos LoRA: producto v007 preparado y bloqueado hasta aprobación");
}

main().catch((error) => {
  console.error("[FAIL] test-lora-modes", error);
  process.exitCode = 1;
});
