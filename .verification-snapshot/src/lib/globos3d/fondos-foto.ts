import { ASIGNACION_FONDOS } from "@/lib/catalogo/asignacion-fondos";
import type { IdRepositorio } from "@/lib/catalogo/tipos";
import { FONDOS_CATALOGO } from "./fondos-escenografia";
import type { LecturaFoto } from "./lectura-foto";
import type { FondoCatalogo } from "./mobiliario-tipos";

/**
 * **Qué fondos y muebles ve la lectura de fotos** (REQ-013): la lista del prompt de Gemini y del detector de fondos sale de los
 * repositorios visibles para la superficie `foto`. Sin acotar —o con mobiliario y escenografía visibles, lo de hoy— es
 * `FONDOS_CATALOGO` mismo, en su orden: el prompt no cambia ni un byte. La política (qué repositorios) la resuelve quien llama
 * (`taller/modelar-foto-real.ts`); aquí solo se aplica, con la tabla de asignación (hoja del catálogo, regla R8).
 */

export function fondosParaFoto(repositorios?: readonly IdRepositorio[]): readonly FondoCatalogo[] {
  if (!repositorios) return FONDOS_CATALOGO;
  const visibles = FONDOS_CATALOGO.filter((f) => {
    const repositorio = ASIGNACION_FONDOS.get(f.id);
    return repositorio !== undefined && repositorios.includes(repositorio);
  });
  return visibles.length === FONDOS_CATALOGO.length ? FONDOS_CATALOGO : visibles;
}

export type LecturaAcotada = { lectura: LecturaFoto; descartadas: string[] };

/**
 * Lo que el modelo puso como fondo y la lista de la foto no ofrece (un id que el prompt no nombra pero el texto de las reglas sí) no
 * se arma: pasa a «otro», que solo se anota. Con la lista completa la lectura vuelve tal cual.
 */
export function acotarFondosLeidos(lectura: LecturaFoto, fondos: readonly FondoCatalogo[]): LecturaAcotada {
  if (fondos === FONDOS_CATALOGO) return { lectura, descartadas: [] };
  const ofrecidos = new Set(fondos.map((f) => f.id));
  const descartadas: string[] = [];
  const piezas = lectura.piezas.map((pieza, i) => {
    if (pieza.tipo !== "fondo" || ofrecidos.has(pieza.id)) return pieza;
    descartadas.push(`Pieza ${i + 1} (fondo ${pieza.id}): no está en el catálogo de esta superficie; se anotó como «otro».`);
    return { tipo: "otro" as const, descripcion: `${pieza.id} (no disponible en el catálogo)` };
  });
  return { lectura: descartadas.length ? { ...lectura, piezas } : lectura, descartadas };
}
