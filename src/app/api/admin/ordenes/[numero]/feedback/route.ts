import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { CATEGORIAS_ENTRENAMIENTO, type FeedbackFoto } from "@/lib/ordenes/tipos";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

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

  const cuerpo = (await request.json()) as Partial<FeedbackFoto>;
  if (typeof cuerpo.elementoPrincipal !== "string") {
    return Response.json({ error: "Falta el elemento principal." }, { status: 400 });
  }

  const feedback: FeedbackFoto = {
    orden: numero,
    foto: cuerpo.foto ?? `foto-${indice}.jpg`,
    esDecoracion: Boolean(cuerpo.esDecoracion),
    decoracionCompleta: Boolean(cuerpo.decoracionCompleta),
    elementoPrincipal: cuerpo.elementoPrincipal.trim(),
    fidelidadImagen: cuerpo.fidelidadImagen === "alta" || cuerpo.fidelidadImagen === "baja" ? cuerpo.fidelidadImagen : "media",
    productosRepresentados: Array.isArray(cuerpo.productosRepresentados) ? cuerpo.productosRepresentados : [],
    aptoParaEntrenamiento: Boolean(cuerpo.aptoParaEntrenamiento),
    categoria: cuerpo.categoria && CATEGORIAS_ENTRENAMIENTO.includes(cuerpo.categoria) ? cuerpo.categoria : "no_asignada",
    notas: cuerpo.notas ?? "",
    revisadoEn: new Date().toISOString(),
    fuente: "humano",
  };

  await writeFile(path.join(carpetaOrden, `feedback-${indice}.json`), JSON.stringify(feedback, null, 2), "utf-8");
  return Response.json({ ok: true, feedback });
}
