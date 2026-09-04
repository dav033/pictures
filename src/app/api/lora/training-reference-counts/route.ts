import { NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { LoraModeSlugSchema } from "@/lib/lora/schema";
import { readActiveLoraTrainingReferenceCounts } from "@/lib/lora/training-reference-counts";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ error: "SesiÃ³n requerida." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  // El badge debe reflejar el modelo que realmente genera, no un dataset fijo:
  // sin ?loraMode, se asume el modo por defecto del selector principal.
  const parsedMode = LoraModeSlugSchema.safeParse(searchParams.get("loraMode") ?? "training_1");
  if (!parsedMode.success) return NextResponse.json({ error: "loraMode inválido." }, { status: 400 });
  const datos = await readActiveLoraTrainingReferenceCounts(parsedMode.data);
  return NextResponse.json(datos, {
    headers: { "Cache-Control": "no-store" },
  });
}
