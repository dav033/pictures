import { rm } from "node:fs/promises";
import path from "node:path";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

export async function DELETE(_request: Request, { params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  if (!/^\d+$/.test(numero)) return Response.json({ error: "Número de orden inválido." }, { status: 400 });

  const carpetaOrden = path.join(RUTA_ORDENES, numero);
  try {
    await rm(carpetaOrden, { recursive: true, force: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  return Response.json({ ok: true });
}
