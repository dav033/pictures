/**
 * Los sistemas de búsqueda que compara `evaluar-busqueda.ts`. Para sumar uno: implementar `SistemaBusqueda` y
 * registrarlo en `SISTEMAS`. El RAG (REQ-002) es `buscarEnTaller` contra la base de DATABASE_URL (con el flag forzado).
 */
import { buscarEnBiblioteca } from "../../src/lib/globos3d/herramientas-escena-biblioteca";
import { buscarEnTaller } from "../../src/lib/taller/buscar";
import { SistemaNoDisponible, type SistemaBusqueda } from "../../src/lib/taller/evaluar";

/**
 * La búsqueda de hoy, la misma función que usa la IA del taller (`buscar_en_biblioteca`): solo el texto, sin los filtros
 * de tipo, ocasión o color que la IA puede sumar al llamarla (aquí no hay IA que los deduzca). Tope de 15 items.
 */
export const sistemaActual: SistemaBusqueda = {
  nombre: "actual (buscarEnBiblioteca)",
  buscarTexto: (texto, limite) => buscarEnBiblioteca({ texto, limite }).map((item) => item.id),
};

/**
 * El RAG de producción (`buscarEnTaller`): la base de DATABASE_URL, con el embedding de la consulta (Gemini, centésimas de
 * centavo por consulta) y el flag forzado, sin depender de TALLER_RAG_ENABLED. Si responde desde la memoria (la base no
 * contesta) se avisa: comparar la memoria consigo misma no evalúa nada. Por foto, todavía no (falta embeber las fotos del oro).
 */
export const sistemaRag: SistemaBusqueda = {
  nombre: "RAG (taller/buscar)",
  async buscarTexto(texto, limite) {
    const r = await buscarEnTaller({ texto, limite }, { habilitado: true });
    if (r.fuente !== "rag") throw new SistemaNoDisponible(`RAG no disponible: respondió la memoria (${r.avisos.join(" · ") || "sin aviso"})`);
    return r.ids;
  },
};

export const SISTEMAS: Readonly<Record<string, SistemaBusqueda>> = { actual: sistemaActual, rag: sistemaRag };
