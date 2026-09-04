import { writeFile, access } from "node:fs/promises";
import path from "node:path";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

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
  const { numero } = await params;
  if (!/^\d+$/.test(numero)) return Response.json({ error: "Número de orden inválido." }, { status: 400 });

  const indice = Number(new URL(request.url).searchParams.get("indice") ?? "1");
  if (!Number.isInteger(indice) || indice < 1) return Response.json({ error: "Índice inválido." }, { status: 400 });

  const carpetaOrden = path.join(RUTA_ORDENES, numero);
  try {
    await access(carpetaOrden);
  } catch {
    return Response.json({ error: "La carpeta de esa orden no existe." }, { status: 404 });
  }

  const cuerpo = (await request.json()) as Partial<CuerpoCaption>;
  if (typeof cuerpo.caption !== "string" || cuerpo.caption.trim().length === 0) {
    return Response.json({ error: "El caption no puede quedar vacío." }, { status: 400 });
  }

  const entrada: CuerpoCaption = {
    foto: cuerpo.foto ?? `foto-${indice}.jpg`,
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
