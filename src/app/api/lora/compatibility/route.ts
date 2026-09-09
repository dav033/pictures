import { NextResponse } from "next/server";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { LoraSelectionSchema } from "@/lib/lora/schema";
import { LoraCompatibilityError } from "@/lib/lora/compatibility";
import { resolveLoraSelection } from "@/lib/lora/mode-resolver";
import { FAL_MULTI_LORA_SUPPORTED } from "@/lib/ia/feature-flags";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  return NextResponse.json({ multiLora: FAL_MULTI_LORA_SUPPORTED, baseModel: "FLUX.2 [dev]", resolution: 1024 });
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ code: "INVALID_ORIGIN", message: "Origen no permitido" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: "INVALID_JSON", message: "Cuerpo JSON inválido" }, { status: 400 }); }
  const parsed = LoraSelectionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", message: "Selecciona un LoRA válido", details: parsed.error.issues }, { status: 400 });
  try {
    const loras = await resolveLoraSelection(parsed.data);
    return NextResponse.json({ ok: true, loras: loras.map((lora) => ({ artifactId: lora.artifactId, specialization: lora.specialization, scale: lora.scale, trigger: lora.trigger, baseModel: lora.baseModel, tokenizerRevision: lora.tokenizerRevision, resolution: lora.resolution })) });
  } catch (error) {
    if (error instanceof LoraCompatibilityError || error instanceof Error && /^LORA_/.test(error.message)) {
      return NextResponse.json({ code: error instanceof LoraCompatibilityError ? error.code : "LORA_INCOMPATIBLE", message: error.message }, { status: 409 });
    }
    return NextResponse.json({ code: "LORA_REGISTRY_UNAVAILABLE", message: "No se pudo comprobar compatibilidad", retryable: true }, { status: 503 });
  }
}
