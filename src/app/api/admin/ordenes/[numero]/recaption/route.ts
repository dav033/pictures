import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { generarCaption } from "@/lib/ordenes/generarCaption";
import type { Desglose, FeedbackFoto } from "@/lib/ordenes/tipos";
import { directorioOrdenes, nombreFotoOrden } from "@/lib/ordenes/directorio";

export async function POST(request: Request, { params }: { params: Promise<{ numero: string }> }) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });

  const { numero } = await params;
  if (!/^\d+$/.test(numero)) return Response.json({ error: "Número de orden inválido." }, { status: 400 });

  const indice = Number(new URL(request.url).searchParams.get("indice") ?? "1");
  if (!Number.isInteger(indice) || indice < 1) return Response.json({ error: "Índice inválido." }, { status: 400 });

  const carpetaOrden = path.join(/*turbopackIgnore: true*/ directorioOrdenes(), numero);

  let feedback: FeedbackFoto;
  try {
    feedback = JSON.parse(await readFile(path.join(carpetaOrden, `feedback-${indice}.json`), "utf-8"));
  } catch {
    return Response.json({ error: "Esta foto todavía no tiene feedback guardado -- revisala primero." }, { status: 400 });
  }

  if (!feedback.esDecoracion) {
    return Response.json(
      { error: "El feedback marca esta foto como que NO es de decoración -- no tiene sentido generarle caption." },
      { status: 400 },
    );
  }

  let desglose: Desglose;
  try {
    desglose = JSON.parse(await readFile(path.join(carpetaOrden, "desglose.json"), "utf-8"));
  } catch {
    return Response.json({ error: "No se encontró desglose.json para esta orden." }, { status: 404 });
  }

  const archivoFoto = nombreFotoOrden(indice, feedback.foto);
  if (!archivoFoto) return Response.json({ error: "El feedback contiene un nombre de foto inválido." }, { status: 400 });
  const rutaFoto = path.join(carpetaOrden, archivoFoto);
  try {
    await access(rutaFoto);
  } catch {
    return Response.json({ error: `No se encontró la foto ${archivoFoto}.` }, { status: 404 });
  }

  let resultado;
  try {
    resultado = generarCaption(numero, archivoFoto, rutaFoto, desglose, feedback);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error generando el recaption." }, { status: 500 });
  }

  await writeFile(path.join(carpetaOrden, `caption-${indice}.json`), JSON.stringify(resultado.caption, null, 2), "utf-8");
  return Response.json({ ok: true, caption: resultado.caption });
}
