import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { createLoraTrainingDraft, getLoraDataset, listLoraTrainingRuns } from "@/lib/lora/repository";
import { LoraSpecializationSchema } from "@/lib/lora/schema";

const CreateTrainingSchema = z.object({
  datasetId: z.string().trim().min(1).max(200),
  specialization: LoraSpecializationSchema.optional(),
  label: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/, "Usa 3-81 caracteres: letras, números, punto, guion o guion bajo"),
  steps: z.number().int().min(100).max(2000),
  learningRate: z.number().gt(0).lte(0.0001),
  baseModel: z.string().trim().min(1).max(200).optional(),
  tokenizerRevision: z.string().trim().min(1).max(200).optional(),
  resolution: z.number().int().positive().max(4096).optional(),
});

const DEFAULT_TRAINER_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2-trainer";
const DEFAULT_COST_PER_STEP_USD = 0.0064;

function costPerStep(): number {
  const configured = Number(process.env.LORA_COST_USD_PER_STEP);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_PER_STEP_USD;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54) || "training";
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ code: "INVALID_ORIGIN", message: "Origen no permitido" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON", message: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const parsed = CreateTrainingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_INPUT", message: "Revisa dataset, etiqueta, pasos y learning rate", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const dataset = await getLoraDataset(parsed.data.datasetId).catch(() => null);
  if (!dataset) {
    return NextResponse.json({ code: "DATASET_NOT_FOUND", message: "Dataset no encontrado" }, { status: 404 });
  }
  if (dataset.status !== "ready" || !dataset.zip_storage_key || !dataset.zip_sha256) {
    return NextResponse.json(
      { code: "DATASET_NOT_READY", message: "Dataset todavía no está exportado y respaldado", retryable: false },
      { status: 409 },
    );
  }
  if (dataset.image_count !== dataset.caption_count || dataset.image_count === 0) {
    return NextResponse.json(
      { code: "DATASET_INCOMPLETE", message: "Dataset debe tener una caption válida por imagen", retryable: false },
      { status: 409 },
    );
  }

  const specialization = parsed.data.specialization ?? dataset.specialization;
  if (specialization !== dataset.specialization) {
    return NextResponse.json({ code: "SPECIALIZATION_MISMATCH", message: "La especialización no coincide con el dataset" }, { status: 409 });
  }
  if (specialization === "structure") {
    if (dataset.license_status !== "verified") {
      return NextResponse.json({ code: "STRUCTURE_LICENSE_REQUIRED", message: "El dataset de estructuras requiere licencia verificada" }, { status: 409 });
    }
    if (dataset.evaluation_status !== "approved") {
      return NextResponse.json({ code: "STRUCTURE_DATASET_REVIEW_REQUIRED", message: "El dataset de estructuras requiere revisión aprobada" }, { status: 409 });
    }
    const structureTypes = Array.isArray(dataset.structure_types) ? dataset.structure_types : [];
    if (!structureTypes.length || !dataset.caption_audit || typeof dataset.caption_audit !== "object") {
      return NextResponse.json({ code: "STRUCTURE_COVERAGE_REQUIRED", message: "Falta cobertura estructural o auditoría de captions" }, { status: 409 });
    }
  }

  const estimatedCostUsd = Number((parsed.data.steps * costPerStep()).toFixed(2));
  const id = `lora-run-${slug(parsed.data.label)}-${randomUUID().slice(0, 8)}`;
  try {
    const training = await createLoraTrainingDraft({
      id,
      label: parsed.data.label,
      datasetId: dataset.id,
      specialization,
      triggerToken: dataset.trigger_token,
      baseModel: parsed.data.baseModel ?? dataset.base_model,
      tokenizerRevision: parsed.data.tokenizerRevision ?? dataset.tokenizer_revision,
      resolution: parsed.data.resolution ?? dataset.resolution,
      captionAudit: dataset.caption_audit && typeof dataset.caption_audit === "object" ? dataset.caption_audit as Record<string, unknown> : {},
      licenseStatus: dataset.license_status === "verified" ? "verified" : "pending",
      trainerEndpoint: process.env.FAL_TRAINER_ENDPOINT?.trim() || DEFAULT_TRAINER_ENDPOINT,
      steps: parsed.data.steps,
      learningRate: parsed.data.learningRate,
      estimatedCostUsd,
      configurationSnapshot: {
        source: "configuracion-lora",
        estimatedCostUsd,
        costPerStepUsd: costPerStep(),
        coverageStatus: dataset.coverage_status,
      },
    });

    return NextResponse.json(
      {
        training: {
          ...training,
          dataset: {
            id: dataset.id,
            label: dataset.label,
            imageCount: dataset.image_count,
            captionCount: dataset.caption_count,
            coverageStatus: dataset.coverage_status,
            specialization: dataset.specialization,
            structureTypes: dataset.structure_types,
            captionAudit: dataset.caption_audit,
            licenseStatus: dataset.license_status,
            evaluationStatus: dataset.evaluation_status,
          },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return NextResponse.json({ code: "TRAINING_LABEL_EXISTS", message: "Ya existe una corrida con esa etiqueta" }, { status: 409 });
    }
    return NextResponse.json({ code: "TRAINING_DRAFT_FAILED", message: "No se pudo crear el borrador", retryable: true }, { status: 503 });
  }
}

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  }
  const url = new URL(request.url);
  const specialization = url.searchParams.get("specialization");
  if (specialization && specialization !== "product" && specialization !== "structure") {
    return NextResponse.json({ code: "INVALID_SPECIALIZATION", message: "Especialización inválida" }, { status: 400 });
  }
  try {
    const trainings = await listLoraTrainingRuns({ limit: 100 });
    return NextResponse.json({ trainings: specialization ? trainings.filter((training) => training.specialization === specialization) : trainings });
  } catch {
    return NextResponse.json({ code: "LORA_REGISTRY_UNAVAILABLE", message: "Registro LoRA no disponible", retryable: true }, { status: 503 });
  }
}
