import { embeberImagen } from "@/lib/rag/embeddings";
import type { FotoLectura } from "@/lib/globos3d/leer-foto-ia";
import { modelarDesdeFoto, type DependenciasModelado, type Modelado } from "@/lib/globos3d/modelar-desde-foto";
import { buscarVisible } from "./buscar-visible";
import { plantillasParecidas } from "./plantillas-foto";
import { normalizarFoto } from "./normalizar-foto";

/**
 * `modelarDesdeFoto` con las dependencias reales del servidor: Gemini lee la foto y, con la biblioteca indexada
 * (`TALLER_RAG_ENABLED`), se busca por su embedding de imagen (la foto se lleva a 1024 px, como «Buscar por foto»).
 * Lo usan `/api/escena-desde-foto` y `/api/escena-ia`. `detectar` (opcional) lo usa el arnés de entrenamiento para cachear la detección.
 */
export function modelarFotoReal(foto: FotoLectura, signal?: AbortSignal, detectar?: DependenciasModelado["detectar"]): Promise<Modelado> {
  return modelarDesdeFoto(foto, {
    ...(detectar !== undefined ? { detectar } : {}),
    plantillas: async (f) => plantillasParecidas(await normalizarFoto(f.bytes), { embeber: embeberImagen, buscar: (entrada) => buscarVisible(entrada) }),
    opciones: { signal },
  });
}
