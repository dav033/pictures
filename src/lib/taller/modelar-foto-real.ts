import { embeberImagen } from "@/lib/rag/embeddings";
import type { FotoLectura } from "@/lib/globos3d/leer-foto-ia";
import { modelarDesdeFoto, type Modelado } from "@/lib/globos3d/modelar-desde-foto";
import { plantillasParecidas } from "./plantillas-foto";
import { normalizarFoto } from "./normalizar-foto";

/**
 * `modelarDesdeFoto` con las dependencias reales del servidor: Gemini lee la foto y, con la biblioteca indexada
 * (`TALLER_RAG_ENABLED`), se busca por su embedding de imagen (la foto se lleva a 1024 px, como «Buscar por foto»).
 * Lo usan `/api/escena-desde-foto` y `/api/escena-ia`.
 */
export function modelarFotoReal(foto: FotoLectura, signal?: AbortSignal): Promise<Modelado> {
  return modelarDesdeFoto(foto, {
    plantillas: async (f) => plantillasParecidas(await normalizarFoto(f.bytes), { embeber: embeberImagen }),
    opciones: { signal },
  });
}
