import { z } from "zod";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { esIdRepositorio } from "@/lib/catalogo/ids";
import { conRegistro } from "@/lib/registro/servidor";
import { buscarVisible } from "@/lib/taller/buscar-visible";
import { DIMENSIONES_VECTOR_TALLER } from "@/lib/taller/indice";

/**
 * Búsqueda de la biblioteca del taller 3D (REQ-002): palabras + nombre + vectores con filtros duros, en Postgres con
 * `TALLER_RAG_ENABLED` y, si está apagada o la base falla, en memoria con la misma forma de respuesta (`fuente`
 * dice cuál respondió). Los vectores de la consulta llegan ya calculados: esta ruta no llama a ningún modelo.
 */
export const POST = conRegistro("/api/taller/buscar", atenderPOST, { vista: "3d" });

const Lista = z.array(z.string().trim().min(1).max(80)).max(50).optional();
const Medida = z.number().finite().min(0).max(100_000).optional();
const Vector = z.array(z.number().finite()).length(DIMENSIONES_VECTOR_TALLER).optional();

const CuerpoSchema = z.object({
  texto: z.string().trim().max(500).optional(),
  filtros: z.object({
    tipos: Lista,
    tiposPieza: Lista,
    celebraciones: Lista,
    tematicas: Lista,
    formatos: Lista,
    partes: Lista,
    colores: Lista,
    altoMin: Medida,
    altoMax: Medida,
    anchoMin: Medida,
    anchoMax: Medida,
    fuente: Lista,
    propietario: z.string().trim().min(1).max(120).nullable().optional(),
    soloPropios: z.boolean().optional(),
    // REQ-013: acota a estos repositorios; nunca abre uno que el RAG no vea (`reposVisibles("rag")`).
    repositorios: z.array(z.string().trim().refine(esIdRepositorio, { message: "repositorio desconocido" })).max(10).optional(),
  }).strict().default({}),
  limite: z.number().int().min(1).max(50).default(12),
  vectorTexto: Vector,
  vectorImagen: Vector,
}).strict().refine((c) => !c.filtros.soloPropios || !!c.filtros.propietario, { message: "soloPropios necesita propietario." });

async function atenderPOST(request: Request) {
  if (!isAuthenticatedRequest(request) || !isSameOriginRequest(request)) {
    return Response.json({ error: "Sesión requerida." }, { status: 401 });
  }
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400 });
  }
  const parseado = CuerpoSchema.safeParse(cuerpo);
  if (!parseado.success) {
    return Response.json({ error: "Búsqueda inválida.", detalle: parseado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 5) }, { status: 400 });
  }
  return Response.json(await buscarVisible(parseado.data));
}
