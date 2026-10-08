/**
 * Los sistemas de búsqueda que compara `evaluar-busqueda.ts`. Para sumar uno: implementar `SistemaBusqueda` y
 * registrarlo en `SISTEMAS`. El RAG (REQ-002) se enchufa aquí cuando exista `src/lib/taller/buscar.ts`.
 */
import { buscarEnBiblioteca } from "../../src/lib/globos3d/herramientas-escena-biblioteca";
import { SistemaNoDisponible, type SistemaBusqueda } from "../../src/lib/taller/evaluar";

/**
 * La búsqueda de hoy, la misma función que usa la IA del taller (`buscar_en_biblioteca`): solo el texto, sin los filtros
 * de tipo, ocasión o color que la IA puede sumar al llamarla (aquí no hay IA que los deduzca). Tope de 15 items.
 */
export const sistemaActual: SistemaBusqueda = {
  nombre: "actual (buscarEnBiblioteca)",
  buscarTexto: (texto, limite) => buscarEnBiblioteca({ texto, limite }).map((item) => item.id),
};

/** El RAG todavía no existe: el adaptador avisa y el evaluador sigue con los demás. */
export const sistemaRag: SistemaBusqueda = {
  nombre: "RAG (taller/buscar)",
  buscarTexto() {
    throw new SistemaNoDisponible("RAG no disponible: falta src/lib/taller/buscar.ts");
  },
  buscarFoto() {
    throw new SistemaNoDisponible("RAG no disponible: falta src/lib/taller/buscar.ts");
  },
};

export const SISTEMAS: Readonly<Record<string, SistemaBusqueda>> = { actual: sistemaActual, rag: sistemaRag };
