import "server-only";

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { createLocalLoraArtifactStore } from "../src/lib/lora/artifact-store-local";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const ROOT = process.cwd();
const DATASET_ID = "lora-dataset-v007-ordenes";
const RUN_ID = "lora-run-v007-1000";
const LORA_SCALE = 0.8;
const SEEDS = [101, 202, 303, 404, 505, 606];
const SOURCE_DIR = path.join(ROOT, "reports", "lora-debug", "eval-v007-producto");
const REPORT_PATH = path.join(SOURCE_DIR, "veredicto-v007-producto.json");
const REPORT_KEY = `runs/${RUN_ID}/evaluation-report-v007-product.json`;

const report = {
  protocolVersion: "lora-product-v1",
  runId: RUN_ID,
  datasetId: DATASET_ID,
  loraScale: LORA_SCALE,
  seeds: SEEDS,
  sourceDir: path.relative(ROOT, SOURCE_DIR),
  generatedImages: { succeeded: 36, requested: 36 },
  criteria: {
    acabado: { minimum: "5/6", promptPair: "Reflex high-shine vs Fashion matte" },
    color: { minimum: "5/6", promptPair: "Reflex rose gold vs Reflex gold" },
    diametro: { minimum: "4/6", promptPair: "Fashion white 5-inch vs 24-inch" },
  },
  scores: {
    acabado: { passedCount: 0, totalCount: 6, observed: "Fashion conservó reflejos especulares fuertes; no hubo separación mate." },
    color: { passedCount: 6, totalCount: 6, observed: "Rose gold y gold se distinguieron en las seis semillas." },
    diametro: { passedCount: 0, totalCount: 6, observed: "Las salidas de 5-inch y 24-inch fueron visualmente similares." },
  },
  overall: { passedCount: 0, totalCount: 6 },
  verdict: "rejected" as const,
  note: "Generación válida 36/36, pero falla fidelidad de producto en acabado y diámetro. No promover el modo.",
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function putEvaluationArtifact(client: PoolClient, bytes: Uint8Array): Promise<void> {
  const store = createLocalLoraArtifactStore();
  const stored = await store.put(REPORT_KEY, bytes);
  await client.query(
    `INSERT INTO lora_artifacts
       (id, run_id, dataset_id, specialization, kind, storage_key, provider_url, sha256, bytes, status, metadata)
     VALUES ($1, $2, $3, 'product', 'evaluation_report', $4, NULL, $5, $6, 'backed_up', $7::jsonb)
     ON CONFLICT (storage_key) DO UPDATE SET
       run_id = EXCLUDED.run_id, dataset_id = EXCLUDED.dataset_id,
       sha256 = EXCLUDED.sha256, bytes = EXCLUDED.bytes,
       status = EXCLUDED.status, metadata = EXCLUDED.metadata`,
    [
      `${RUN_ID}:evaluation-report-v007-product`,
      RUN_ID,
      DATASET_ID,
      stored.key,
      stored.sha256,
      stored.bytes,
      json({ protocolVersion: report.protocolVersion, verdict: report.verdict, sourceDir: report.sourceDir }),
    ],
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL no está configurada.");

  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (sha256(reportBytes).length !== 64) throw new Error("No se pudo calcular el hash del veredicto.");
  await mkdir(SOURCE_DIR, { recursive: true });
  await writeFile(REPORT_PATH, reportBytes);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ id: string }>("SELECT id FROM lora_training_runs WHERE id = $1 FOR UPDATE", [RUN_ID]);
    if (!run.rowCount) throw new Error(`No existe la corrida ${RUN_ID}.`);
    const dataset = await client.query<{ id: string }>("SELECT id FROM lora_datasets WHERE id = $1 FOR UPDATE", [DATASET_ID]);
    if (!dataset.rowCount) throw new Error(`No existe el dataset ${DATASET_ID}.`);

    await putEvaluationArtifact(client, reportBytes);

    const evaluation = await client.query(
      `UPDATE lora_evaluations
          SET criteria = $1::jsonb,
              passed_count = 0,
              total_count = 6,
              verdict = 'rejected',
              report_storage_key = $2,
              result_snapshot = $3::jsonb,
              completed_at = now()
        WHERE training_run_id = $4
          AND protocol_version = 'lora-eval-v1'
          AND lora_scale = $5`,
      [json(report.criteria), REPORT_KEY, json(report), RUN_ID, LORA_SCALE],
    );
    if (!evaluation.rowCount) throw new Error("No existe la evaluación lora-eval-v1 a completar.");

    await client.query(
      `UPDATE lora_training_runs
          SET evaluation_status = 'rejected', updated_at = now()
        WHERE id = $1`,
      [RUN_ID],
    );
    await client.query(
      `UPDATE lora_datasets
          SET evaluation_status = 'rejected', updated_at = now()
        WHERE id = $1`,
      [DATASET_ID],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log("[PASS] evaluación v007 registrada: RECHAZADO");
  console.log("[INFO] acabado 0/6 · color 6/6 · diámetro 0/6 · overall 0/6");
  console.log(`[INFO] reporte: ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error("[FAIL] registrar-evaluacion-product-v007", error);
  process.exitCode = 1;
});
