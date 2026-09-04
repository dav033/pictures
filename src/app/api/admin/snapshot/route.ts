import { NextResponse } from "next/server";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { buildSnapshot, publishSnapshotToServer, readLastPublishState, readLocalSnapshot } from "@/lib/lora/snapshot";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  }

  const live = buildSnapshot();
  return NextResponse.json({
    live: {
      generatedAt: live.generatedAt,
      composicionGenerado: live.composicion?.generado ?? null,
      datasetImagenes: live.datasetGallery?.imageCount ?? 0,
      datasetCaptions: live.datasetGallery?.captionCount ?? 0,
    },
    savedAt: readLocalSnapshot()?.generatedAt ?? null,
    lastPublish: readLastPublishState(),
  });
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ code: "INVALID_ORIGIN", message: "Origen no válido" }, { status: 403 });
  }

  const result = await publishSnapshotToServer();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
