import { reposVisibles } from "@/lib/catalogo/visibilidad";
import { buscarEnTaller, type DependenciasBuscar, type EntradaBusqueda, type RespuestaBusquedaTaller } from "./buscar";

/**
 * La búsqueda de la biblioteca con la visibilidad del catálogo para el RAG ya resuelta (REQ-013): `reposVisibles("rag")`, de la
 * variable `CATALOGO_REPOS_RAG` o de los manifiestos. Es composición: la usan las rutas (`/api/taller/buscar`,
 * `/api/taller/buscar-foto`, `/api/escena-ia`) y `modelar-foto-real`; el motor no la alcanza (`test-catalogo-capas`).
 */
export function buscarVisible(entrada: EntradaBusqueda, dependencias: DependenciasBuscar = {}): Promise<RespuestaBusquedaTaller> {
  return buscarEnTaller(entrada, { repositoriosVisibles: () => reposVisibles("rag"), ...dependencias });
}
