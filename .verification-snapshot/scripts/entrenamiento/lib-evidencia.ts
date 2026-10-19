/**
 * La evidencia de una pasada reducida a lo que `clasificarCapacidad` compara: las piezas de la lectura medida, los nodos de la escena final,
 * lo que la compilación no armó y los errores de las herramientas. Una sola función la arma, venga de una pasada en vivo (lo que ya está en
 * memoria y la auditoría, donde solo viven los errores de las herramientas) o de reconstruir una corrida guardada (`reclasificar-corrida.ts`).
 */
import type { EvidenciaCapacidad } from "./lib-capacidad";
import type { NodoResumido, PiezaResumida } from "./lib-familias";

export function resumirPiezas(piezas: readonly unknown[]): PiezaResumida[] {
  return piezas.flatMap((pieza) => {
    if (typeof pieza !== "object" || pieza === null) return [];
    const { tipo, id, descripcion } = pieza as { tipo?: unknown; id?: unknown; descripcion?: unknown };
    if (typeof tipo !== "string") return [];
    return [{ tipo, ...(typeof id === "string" ? { id } : {}), ...(typeof descripcion === "string" ? { descripcion } : {}) }];
  });
}

/** ¿La forma (la de una pieza `forma`; en un arco `forma` es otra cosa) rellena el contorno de un texto, un número o una letra? */
function dibujaTexto(forma: unknown): boolean {
  if (typeof forma !== "object" || forma === null || !("contorno" in forma)) return false;
  const { contorno } = forma;
  return typeof contorno === "object" && contorno !== null && "tipo" in contorno && contorno.tipo === "texto";
}

/** Los nodos de la escena con el id del mueble o fondo del catálogo con que se armó cada uno (`pieza.mueble.id`), si lo tiene, y si es una forma que dibuja un número o una letra. */
export function resumirNodos(escena: { nodos: ReadonlyArray<{ id: string; pieza: { tipo: string; mueble?: { id?: string }; forma?: unknown } }> }): NodoResumido[] {
  return escena.nodos.map((nodo) => ({
    id: nodo.id, tipo: nodo.pieza.tipo,
    ...(typeof nodo.pieza.mueble?.id === "string" ? { muebleId: nodo.pieza.mueble.id } : {}),
    ...(nodo.pieza.tipo === "forma" && dibujaTexto(nodo.pieza.forma) ? { contorno: "texto" as const } : {}),
  }));
}

export function evidenciaDePasada(entrada: { piezas: readonly unknown[]; escena: Parameters<typeof resumirNodos>[0]; omitidas: readonly string[]; erroresHerramientas: readonly string[] }): EvidenciaCapacidad {
  return { piezasLeidas: resumirPiezas(entrada.piezas), nodosFinales: resumirNodos(entrada.escena), omitidas: entrada.omitidas, erroresHerramientas: entrada.erroresHerramientas };
}
