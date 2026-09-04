import { NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { readLoraTrainingReferenceEvidence } from "@/lib/lora/training-reference-counts";

const MAX_CATALOG_ID_LENGTH = 160;
const MAX_SIZE_CODE_LENGTH = 40;

export function GET(request: Request): NextResponse {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ error: "SesiÃ³n requerida." }, { status: 401 });

  const url = new URL(request.url);
  const catalogId = url.searchParams.get("catalog_id")?.trim() ?? "";
  const sizeCode = url.searchParams.get("size_code")?.trim() || null;
  if (!catalogId || catalogId.length > MAX_CATALOG_ID_LENGTH || (sizeCode && sizeCode.length > MAX_SIZE_CODE_LENGTH)) {
    return NextResponse.json({ error: "Referencia de catÃ¡logo invÃ¡lida." }, { status: 400 });
  }

  const evidence = readLoraTrainingReferenceEvidence(catalogId, sizeCode);
  if (!evidence) return NextResponse.json({ error: "No hay concepto de entrenamiento para esta referencia." }, { status: 404 });
  return NextResponse.json(evidence, { headers: { "Cache-Control": "no-store" } });
}
