import { NextResponse } from "next/server";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { listLoraDatasets } from "@/lib/lora/repository";
import { createLoraDatasetDraft } from "@/lib/lora/repository";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LoraStructureTypeSchema, LoraSpecializationSchema } from "@/lib/lora/schema";

const CreateDatasetSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$/),
  label: z.string().trim().min(3).max(160),
  specialization: LoraSpecializationSchema,
  structureTypes: z.array(LoraStructureTypeSchema).default([]),
  triggerToken: z.string().trim().min(1).max(120),
  baseModel: z.string().trim().min(1).max(200).default("FLUX.2 [dev]"),
  tokenizerRevision: z.string().trim().min(1).max(200).default("provider-default"),
  resolution: z.number().int().positive().max(4096).default(1024),
  imageCount: z.number().int().nonnegative().default(0),
  captionCount: z.number().int().nonnegative().default(0),
  coverageReviewedImages: z.number().int().nonnegative().default(0),
  coverageTotalImages: z.number().int().nonnegative().default(0),
  captionAudit: z.record(z.string(), z.unknown()).default({}),
  sourceDefinition: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  }

  try {
    const specialization = new URL(request.url).searchParams.get("specialization");
    if (specialization && specialization !== "product" && specialization !== "structure") {
      return NextResponse.json({ code: "INVALID_SPECIALIZATION", message: "Especialización inválida" }, { status: 400 });
    }
    const datasets = await listLoraDatasets({ limit: 100 });
    return NextResponse.json({ datasets: specialization ? datasets.filter((dataset) => dataset.specialization === specialization) : datasets });
  } catch {
    return NextResponse.json(
      { code: "LORA_REGISTRY_UNAVAILABLE", message: "Registro LoRA no disponible", retryable: true },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ code: "INVALID_ORIGIN", message: "Origen no permitido" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: "INVALID_JSON", message: "Cuerpo JSON inválido" }, { status: 400 }); }
  const parsed = CreateDatasetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", message: "Revisa la configuración del dataset", details: parsed.error.issues }, { status: 400 });
  if (parsed.data.specialization === "structure" && parsed.data.triggerToken !== "eventdecor_structure_v1") {
    return NextResponse.json({ code: "STRUCTURE_TRIGGER_INVALID", message: "El trigger de estructuras debe ser eventdecor_structure_v1" }, { status: 422 });
  }
  try {
    const dataset = await createLoraDatasetDraft({ ...parsed.data, id: parsed.data.id || `lora-dataset-${randomUUID().slice(0, 8)}` });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") return NextResponse.json({ code: "DATASET_EXISTS", message: "Ya existe un dataset con ese id o etiqueta" }, { status: 409 });
    return NextResponse.json({ code: "DATASET_CREATE_FAILED", message: "No se pudo crear el borrador del dataset", retryable: true }, { status: 503 });
  }
}
