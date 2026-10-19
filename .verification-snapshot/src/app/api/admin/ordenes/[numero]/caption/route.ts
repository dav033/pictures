import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { directorioOrdenes, nombreFotoOrden } from "@/lib/ordenes/directorio";

type CuerpoCaption = {
  foto: string;
  trigger_token: string;
  tipo_estructura: string;
  elementos_no_comprados: string[];
  proporcion_relativa_presente: boolean;
  proporcion_relativa_descripcion: string;
  caption: string;
  caption_status: string;
  source: string;
};

export async function PUT(request: Request, { params }: { params: Promise<{ numero: string }> }) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });

  const { numero } = await params;
  if (!/^\d+$/.test(numero)) return Response.json({ error: "Número de orden inválido." }, { status: 400 });

  const indice = Number(new URL(request.url).searchParams.get("indice") ?? "1");
  if (!Number.isInteger(indice) || indice < 1) return Response.json({ error: "Índice inválido." }, { status: 400 });

  const carpetaOrden = path.join(/*turbopackIgnore: true*/ directorioOrdenes(), numero);
  try {
    await access(carpetaOrden);
  } catch {
    return Response.json({ error: "La carpeta de esa orden no existe." }, { status: 404 });
  }

  const cuerpo = (await request.json()) as Partial<CuerpoCaption>;
  if (typeof cuerpo.caption !== "string" || cuerpo.caption.trim().length === 0) {
    return Response.json({ error: "El caption no puede quedar vacío." }, { status: 400 });
  }
  const archivoFoto = nombreFotoOrden(indice, cuerpo.foto);
  if (!archivoFoto) return Response.json({ error: "Nombre de foto inválido." }, { status: 400 });

  const entrada: CuerpoCaption = {
    foto: archivoFoto,
    trigger_token: cuerpo.trigger_token ?? "eventdecor_style_v1",
    tipo_estructura: cuerpo.tipo_estructura ?? "",
    elementos_no_comprados: Array.isArray(cuerpo.elementos_no_comprados) ? cuerpo.elementos_no_comprados : [],
    proporcion_relativa_presente: Boolean(cuerpo.proporcion_relativa_presente),
    proporcion_relativa_descripcion: cuerpo.proporcion_relativa_descripcion ?? "",
    caption: cuerpo.caption.trim(),
    caption_status: "editado_manualmente",
    source: cuerpo.source ?? "claude-vision+orden-real",
  };

  await writeFile(
    path.join(carpetaOrden, `caption-${indice}.json`),
    JSON.stringify({ orden: numero, ...entrada }, null, 2),
    "utf-8",
  );
  return Response.json({ ok: true, indice, caption: { orden: numero, ...entrada } });
}
