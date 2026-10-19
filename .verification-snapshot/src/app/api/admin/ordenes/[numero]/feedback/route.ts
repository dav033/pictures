import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { CATEGORIAS_ENTRENAMIENTO, type FeedbackFoto } from "@/lib/ordenes/tipos";
import { directorioOrdenes, nombreFotoOrden } from "@/lib/ordenes/directorio";

const FeedbackInputSchema = z.object({
  orden: z.string().optional(),
  foto: z.unknown().optional(),
  elementoPrincipal: z.unknown().optional(),
  esDecoracion: z.boolean().optional(),
  decoracionCompleta: z.boolean().optional(),
  fidelidadImagen: z.string().optional(),
  productosRepresentados: z.array(z.object({ producto: z.string(), representado: z.boolean() })).optional(),
  aptoParaEntrenamiento: z.boolean().optional(),
  categoria: z.string().optional(),
  notas: z.string().optional(),
  revisadoEn: z.string().optional(),
  fuente: z.enum(["ia_automatica", "humano"]).optional(),
}).strict();

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

  let cuerpo: z.infer<typeof FeedbackInputSchema>;
  try {
    cuerpo = FeedbackInputSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Feedback inválido." }, { status: 400 });
  }
  if (typeof cuerpo.elementoPrincipal !== "string") {
    return Response.json({ error: "Falta el elemento principal." }, { status: 400 });
  }
  const archivoFoto = nombreFotoOrden(indice, cuerpo.foto);
  if (!archivoFoto) return Response.json({ error: "Nombre de foto inválido." }, { status: 400 });

  const feedback: FeedbackFoto = {
    orden: numero,
    foto: archivoFoto,
    esDecoracion: Boolean(cuerpo.esDecoracion),
    decoracionCompleta: Boolean(cuerpo.decoracionCompleta),
    elementoPrincipal: cuerpo.elementoPrincipal.trim(),
    fidelidadImagen: cuerpo.fidelidadImagen === "alta" || cuerpo.fidelidadImagen === "baja" ? cuerpo.fidelidadImagen : "media",
    productosRepresentados: Array.isArray(cuerpo.productosRepresentados) ? cuerpo.productosRepresentados : [],
    aptoParaEntrenamiento: Boolean(cuerpo.aptoParaEntrenamiento),
    categoria: CATEGORIAS_ENTRENAMIENTO.find((categoria) => categoria === cuerpo.categoria) ?? "no_asignada",
    notas: cuerpo.notas ?? "",
    revisadoEn: new Date().toISOString(),
    fuente: "humano",
  };

  await writeFile(path.join(carpetaOrden, `feedback-${indice}.json`), JSON.stringify(feedback, null, 2), "utf-8");
  return Response.json({ ok: true, feedback });
}
