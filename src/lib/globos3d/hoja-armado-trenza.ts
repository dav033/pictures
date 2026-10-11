import { filasBomba, type CalibracionBomba, type FilaBomba } from "./bomba-segundos";
import { claveDeGlobo, colorear, globoHoja, marcasDe, secuenciaDeColor, sumaSinRedondear, type GloboHoja, type LineaColorCapa, type TramoColor } from "./hoja-armado-comun";
import type { CentroLocal } from "./hoja-armado-local";

/**
 * Arcos y guirnaldas clásicos: una trenza de cuartetos a lo largo de un recorrido. No se arma por capas horizontales: se
 * arma cuarteto a cuarteto, en el orden del recorrido (el cuarteto 1 es el primero que se ata). La hoja da los cuartetos en
 * ese orden, sin mezclar las dos patas de un arco, y junta los seguidos que llevan lo mismo.
 */

export type CuartetoHoja = {
  /** Número del primer cuarteto del bloque (1 es el primero del recorrido). */
  desde: number;
  hasta: number;
  repeticiones: number;
  /** Los globos del primer cuarteto del bloque, en el orden del cuarteto. */
  globos: GloboHoja[];
  /** Por cuarteto. */
  colores: LineaColorCapa[];
  /** Por cuarteto: cuántos van de helio, impresos o con confeti (ver `marcasDe`). */
  marcas: string[];
  /** El orden de color dentro de UN cuarteto. */
  secuencia: TramoColor[];
  /** Por cuarteto. */
  filasBomba: FilaBomba[];
  /** Segundos de bomba de UN cuarteto, sin redondear. */
  segundosBomba: number;
};

const firmaDeCuarteto = (grupo: readonly CentroLocal[]) => grupo.map((c) => claveDeGlobo(globoHoja(c))).join(";");

/** Los cuartetos de una trenza en el orden del recorrido; los seguidos con los mismos globos en el mismo orden se juntan. */
export function cuartetosDeNiveles(niveles: readonly (readonly CentroLocal[])[], calibracion: CalibracionBomba = {}): CuartetoHoja[] {
  const bloques: CuartetoHoja[] = [];
  let i = 0;
  while (i < niveles.length) {
    const firma = firmaDeCuarteto(niveles[i]!);
    let j = i;
    while (j + 1 < niveles.length && firmaDeCuarteto(niveles[j + 1]!) === firma) j += 1;
    const grupo = niveles[i]!;
    const globos = grupo.map((c) => globoHoja(c));
    const filas = filasBomba(grupo.map((c) => c.globo), calibracion);
    bloques.push({ desde: i + 1, hasta: j + 1, repeticiones: j - i + 1, globos, colores: colorear(globos), marcas: marcasDe(globos, { tipo: "posicion", de: j > i ? "de cada cuarteto" : "del cuarteto" }), secuencia: secuenciaDeColor(globos), filasBomba: filas, segundosBomba: sumaSinRedondear(filas) });
    i = j + 1;
  }
  return bloques;
}

const centroide = (grupo: readonly CentroLocal[]) => ({
  x: grupo.reduce((s, c) => s + c.x, 0) / grupo.length,
  y: grupo.reduce((s, c) => s + c.y, 0) / grupo.length,
  z: grupo.reduce((s, c) => s + c.z, 0) / grupo.length,
});

/** Por dónde empieza y hacia dónde va el recorrido, visto de frente (x local es la derecha, y local es arriba, z local sale hacia quien mira). */
export function sentidoDelRecorrido(niveles: readonly (readonly CentroLocal[])[]): string {
  if (niveles.length < 2) return "Se arma cuarteto a cuarteto, en orden.";
  const a = centroide(niveles[0]!), b = centroide(niveles[niveles.length - 1]!);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const mayor = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  if (mayor < 1) return "Se arma cuarteto a cuarteto, en el orden del recorrido.";
  const [desde, hasta] = Math.abs(dx) === mayor
    ? (dx > 0 ? ["izquierdo", "derecho"] : ["derecho", "izquierdo"])
    : Math.abs(dy) === mayor
      ? (dy > 0 ? ["de abajo", "de arriba"] : ["de arriba", "de abajo"])
      : (dz > 0 ? ["del fondo", "del frente"] : ["del frente", "del fondo"]);
  return `Se arma cuarteto a cuarteto, en orden: el 1 está en el extremo ${desde} (visto de frente) y el último en el extremo ${hasta}.`;
}
