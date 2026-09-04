import { isAuthenticatedRequest } from "@/lib/auth/request";
import { eliminarImagenesDataset } from "@/lib/lora/eliminacion-dataset-v005";

export async function DELETE(request: Request): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "SesiÃ³n requerida." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud invÃ¡lida." }, { status: 400 });
  }

  const imageIds = body && typeof body === "object" && Array.isArray((body as { imageIds?: unknown }).imageIds)
    ? (body as { imageIds: unknown[] }).imageIds
    : null;
  if (!imageIds || imageIds.length === 0 || imageIds.some((id) => typeof id !== "string")) {
    return Response.json({ error: "Debes enviar imageIds." }, { status: 400 });
  }

  try {
    const deletedIds = await eliminarImagenesDataset(imageIds as string[]);
    return Response.json({ ok: true, deletedIds });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}


