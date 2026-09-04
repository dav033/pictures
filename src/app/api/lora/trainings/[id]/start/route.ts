import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { createLocalLoraArtifactStore } from "@/lib/lora/artifact-store-local";
import { getLoraTrainingControl } from "@/lib/lora/repository";
import { getRagPool } from "@/lib/rag/db";

const StartTrainingSchema = z.object({
  confirmText: z.literal("ENVIAR ENTRENAMIENTO"),
  idempotencyKey: z.string().uuid(),
});

const UPLOAD_INITIATE_URL = "https://rest.alpha.fal.ai/storage/upload/initiate";

function validFalUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "queue.fal.run" || url.hostname === "rest.alpha.fal.ai");
  } catch {
    return false;
  }
}

function validFalStorageUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"));
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ code: "INVALID_ORIGIN", message: "Origen no permitido" }, { status: 403 });
  }

  const parsed = StartTrainingSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { code: "CONFIRMATION_REQUIRED", message: "Escribe ENVIAR ENTRENAMIENTO para confirmar el gasto", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id } = await params;
  const pool = getRagPool();
  const run = await getLoraTrainingControl(id).catch(() => null);
  if (!run) return NextResponse.json({ code: "TRAINING_NOT_FOUND", message: "Corrida no encontrada" }, { status: 404 });

  const previousRequest = await pool.query<{ response: { training?: unknown } }>(
    `SELECT response FROM lora_idempotency_events WHERE run_id = $1 AND action = 'start' AND idempotency_key = $2`,
    [id, parsed.data.idempotencyKey],
  );
  if (previousRequest.rows[0]) return NextResponse.json(previousRequest.rows[0].response, { status: 202 });

  if (run.status !== "draft") {
    if (["uploading", "queued", "running", "completed", "succeeded"].includes(run.status)) {
      return NextResponse.json({ training: { id: run.id, status: run.status, providerRequestId: run.provider_request_id } }, { status: 200 });
    }
    return NextResponse.json({ code: "TRAINING_NOT_STARTABLE", message: "Corrida no está en estado borrador", retryable: false }, { status: 409 });
  }

  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    return NextResponse.json({ code: "FAL_KEY_MISSING", message: "FAL_KEY no está configurada en el servidor", retryable: false }, { status: 503 });
  }
  if (!validFalUrl(run.trainer_endpoint)) {
    return NextResponse.json({ code: "TRAINER_ENDPOINT_INVALID", message: "Endpoint fal.ai no permitido", retryable: false }, { status: 503 });
  }
  if (!run.zip_storage_key || !run.zip_sha256) {
    return NextResponse.json({ code: "DATASET_ARTIFACT_MISSING", message: "ZIP del dataset no está respaldado", retryable: false }, { status: 409 });
  }

  let zip: Buffer;
  try {
    zip = await createLocalLoraArtifactStore().read(run.zip_storage_key);
  } catch {
    return NextResponse.json({ code: "DATASET_ARTIFACT_UNREADABLE", message: "No se pudo leer ZIP del dataset", retryable: true }, { status: 503 });
  }
  const actualSha256 = createHash("sha256").update(zip).digest("hex");
  if (actualSha256.toLowerCase() !== run.zip_sha256.toLowerCase()) {
    return NextResponse.json({ code: "DATASET_HASH_MISMATCH", message: "Hash del ZIP no coincide con registro", retryable: false }, { status: 409 });
  }

  const claimed = await pool.query(
    `UPDATE lora_training_runs
        SET status = 'uploading',
            configuration_snapshot = configuration_snapshot || jsonb_build_object('startIdempotencyKey', $2::text),
            updated_at = now()
      WHERE id = $1 AND status = 'draft'
      RETURNING id`,
    [id, parsed.data.idempotencyKey],
  );
  if (claimed.rowCount !== 1) {
    return NextResponse.json({ code: "TRAINING_ALREADY_CLAIMED", message: "Otra solicitud ya está procesando esta corrida", retryable: false }, { status: 409 });
  }

  let providerSubmitted = false;
  try {
    const initiate = await fetch(UPLOAD_INITIATE_URL, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: "application/zip", file_name: `${run.dataset_id}.zip` }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!initiate.ok) throw new Error("fal rechazó inicio de subida");
    const upload = await initiate.json() as { upload_url?: string; file_url?: string };
    if (!upload.upload_url || !upload.file_url || !validFalStorageUrl(upload.file_url)) throw new Error("fal no devolvió URL de dataset");

    const uploadResponse = await fetch(upload.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      body: new Uint8Array(zip),
      signal: AbortSignal.timeout(600_000),
    });
    if (!uploadResponse.ok) throw new Error("fal rechazó ZIP");

    const submit = await fetch(run.trainer_endpoint, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_data_url: upload.file_url,
        steps: run.steps,
        learning_rate: run.learning_rate,
        output_lora_format: run.output_lora_format,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!submit.ok) throw new Error("fal rechazó el entrenamiento");
    const queue = await submit.json() as { request_id?: string; status_url?: string; response_url?: string };
    if (!queue.request_id || !validFalUrl(queue.status_url) || !validFalUrl(queue.response_url)) {
      throw new Error("fal no devolvió una solicitud válida");
    }
    providerSubmitted = true;

    await pool.query(
      `UPDATE lora_training_runs
          SET status = 'queued', provider_request_id = $2,
              provider_status_url = $3, provider_response_url = $4,
              uploaded_dataset_url = $5, submitted_at = now(), updated_at = now(),
              error_message = NULL
        WHERE id = $1 AND status = 'uploading'`,
      [id, queue.request_id, queue.status_url, queue.response_url, upload.file_url],
    );
    await pool.query(
      `INSERT INTO lora_jobs (id, kind, resource_id, status)
       VALUES ($1, 'training_sync', $2, 'pending')
       ON CONFLICT (kind, resource_id) DO NOTHING`,
      [randomUUID(), id],
    );

    const responseBody = { training: { id, status: "queued", providerRequestId: queue.request_id } };
    await pool.query(
      `INSERT INTO lora_idempotency_events (idempotency_key, run_id, action, response)
       VALUES ($1, $2, 'start', $3::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [parsed.data.idempotencyKey, id, JSON.stringify(responseBody)],
    );
    return NextResponse.json(responseBody, { status: 202 });
  } catch (error) {
    console.error("[lora] error al enviar entrenamiento", { id, providerSubmitted, error });
    if (!providerSubmitted) {
      await pool.query(
        `UPDATE lora_training_runs
            SET status = 'failed', error_message = $2, updated_at = now()
          WHERE id = $1 AND status = 'uploading'`,
        [id, "No se pudo enviar la solicitud a fal.ai"],
      ).catch(() => undefined);
    }
    return NextResponse.json(
      {
        code: providerSubmitted ? "TRAINING_SUBMISSION_UNRECORDED" : "TRAINING_SUBMISSION_FAILED",
        message: providerSubmitted
          ? "fal.ai recibió la solicitud, pero no quedó registrada localmente. No reintentes; revisa el proveedor."
          : "No se pudo enviar el entrenamiento a fal.ai. La corrida quedó marcada para revisión.",
        retryable: false,
      },
      { status: 502 },
    );
  }
}
