import { NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { listLoraArtifacts } from "@/lib/lora/repository";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  const specialization = new URL(request.url).searchParams.get("specialization");
  if (specialization && specialization !== "product" && specialization !== "structure") {
    return NextResponse.json({ code: "INVALID_SPECIALIZATION", message: "Especialización inválida" }, { status: 400 });
  }
  try {
    return NextResponse.json({ artifacts: await listLoraArtifacts({ specialization: specialization as "product" | "structure" | undefined }) });
  } catch {
    return NextResponse.json({ code: "LORA_REGISTRY_UNAVAILABLE", message: "Registro LoRA no disponible", retryable: true }, { status: 503 });
  }
}
