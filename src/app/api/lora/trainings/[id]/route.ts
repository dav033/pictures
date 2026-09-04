import { NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { getLoraTrainingControl } from "@/lib/lora/repository";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  const { id } = await params;
  try {
    const training = await getLoraTrainingControl(id);
    return training ? NextResponse.json({ training }) : NextResponse.json({ code: "TRAINING_NOT_FOUND", message: "Corrida no encontrada" }, { status: 404 });
  } catch {
    return NextResponse.json({ code: "LORA_REGISTRY_UNAVAILABLE", message: "Registro LoRA no disponible", retryable: true }, { status: 503 });
  }
}
