import { NextResponse } from "next/server";
import { readLoraTrainingReferenceCounts } from "@/lib/lora/training-reference-counts";

export function GET(): NextResponse {
  return NextResponse.json(readLoraTrainingReferenceCounts(), {
    headers: { "Cache-Control": "no-store" },
  });
}
