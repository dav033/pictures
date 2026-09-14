import { rm } from "node:fs/promises";
import path from "node:path";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { directorioOrdenes } from "@/lib/ordenes/directorio";

export async function DELETE(request: Request, { params }: { params: Promise<{ numero: string }> }) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });

  const { numero } = await params;
  if (!/^\d+$/.test(numero)) return Response.json({ error: "Número de orden inválido." }, { status: 400 });

  const carpetaOrden = path.join(/*turbopackIgnore: true*/ directorioOrdenes(), numero);
  try {
    await rm(carpetaOrden, { recursive: true, force: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  return Response.json({ ok: true });
}
