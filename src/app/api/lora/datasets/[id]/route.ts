import { NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { getLoraDataset } from "@/lib/lora/repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  const { id } = await params;
  try {
    const dataset = await getLoraDataset(id);
    return dataset ? NextResponse.json({ dataset }) : NextResponse.json({ code: "DATASET_NOT_FOUND", message: "Dataset no encontrado" }, { status: 404 });
  } catch {
    return NextResponse.json({ code: "LORA_REGISTRY_UNAVAILABLE", message: "Registro LoRA no disponible", retryable: true }, { status: 503 });
  }
}
