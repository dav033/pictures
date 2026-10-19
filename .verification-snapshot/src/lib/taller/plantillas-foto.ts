import { TALLER_RAG_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import type { ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import type { Plantilla } from "@/lib/globos3d/modelar-desde-foto";
import { buscarEnTaller, type EntradaBusqueda, type RespuestaBusquedaTaller } from "./buscar";

/**
 * Las plantillas de la biblioteca que más se parecen a una foto (REQ-001 paso 7b): embebe la imagen y busca por su
 * vector, igual que «Buscar por foto» (`buscar-foto.ts`). Sin la biblioteca indexada (`TALLER_RAG_ENABLED` apagada o la
 * base respondiendo desde memoria, que no usa vectores) no hay plantillas: nunca se inventan.
 */

export const PLANTILLAS_POR_FOTO = 5;

export type DependenciasPlantillas = {
  /** Por defecto `TALLER_RAG_ENABLED`. */
  habilitado?: boolean;
  /** Bytes + mime de la imagen ya normalizada → vector de 768. */
  embeber: (bytes: Uint8Array, mime: string, telemetria?: ContextoTelemetriaIA) => Promise<number[]>;
  buscar?: (entrada: EntradaBusqueda) => Promise<RespuestaBusquedaTaller>;
};

/** Las plantillas más parecidas a la foto (ya normalizada a JPEG), con la similitud de imagen que midió la base. */
export async function plantillasParecidas(imagen: Uint8Array, deps: DependenciasPlantillas): Promise<Plantilla[]> {
  if (!(deps.habilitado ?? TALLER_RAG_ENABLED)) return [];
  const vectorImagen = await deps.embeber(imagen, "image/jpeg", { superficie: "taller_biblioteca" });
  const respuesta = await (deps.buscar ?? ((entrada: EntradaBusqueda) => buscarEnTaller(entrada)))({ vectorImagen, limite: PLANTILLAS_POR_FOTO });
  if (respuesta.fuente !== "rag") return [];
  return respuesta.resultados.slice(0, PLANTILLAS_POR_FOTO).map((r) => {
    const similitud = r.ramas.vector_imagen?.puntaje;
    return { id: r.id, nombre: r.nombre, parecido: typeof similitud === "number" ? Math.round(similitud * 1000) / 1000 : null };
  });
}
