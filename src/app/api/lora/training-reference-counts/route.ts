import { NextResponse } from "next/server";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { readLoraTrainingReferenceCounts } from "@/lib/lora/training-reference-counts";

export function GET(request: Request): NextResponse {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ error: "SesiÃ³n requerida." }, { status: 401 });
  return NextResponse.json(readLoraTrainingReferenceCounts(), {
    headers: { "Cache-Control": "no-store" },
  });
}
