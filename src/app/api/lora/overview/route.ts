import { NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { getLoraOverview } from "@/lib/lora/repository";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getLoraOverview());
  } catch {
    return NextResponse.json(
      { code: "LORA_REGISTRY_UNAVAILABLE", message: "Registro LoRA no disponible", retryable: true },
      { status: 503 },
    );
  }
}
