import { puntoALocal, type MarcoPieza, type NodoArmado } from "./escena";
import type { Vec3 } from "./modulos";
import type { GloboDePieza } from "./piezas";

/**
 * Los globos de UNA copia de una pieza, en el espacio de la pieza (el de antes de colocarla en la sala). La hoja de armado
 * se lee así porque una columna acostada o colgada de un ancla sigue siendo la misma columna: sus capas, su arriba y su
 * izquierda son los suyos, no los del salón. Las copias se arman iguales y van una tras otra en `NodoArmado.globos`.
 */
export type CentroLocal = { globo: GloboDePieza; x: number; y: number; z: number };

/** El centro del cuerpo del globo: el nudo más la longitud hasta el centro (la misma que usa la caja de la pieza). */
export function centroDelGlobo(globo: GloboDePieza): Vec3 {
  const largo = globo.infladoCm / 2 + globo.cuelloExtraCm;
  return {
    x: globo.nudo.x + globo.direccion.x * largo,
    y: globo.nudo.y + globo.direccion.y * largo,
    z: globo.nudo.z + globo.direccion.z * largo,
  };
}

/** Cuántos globos lleva cada copia de la pieza. */
export function globosPorUnidad(nodo: NodoArmado): number {
  return nodo.copias > 0 ? Math.round(nodo.globos.length / nodo.copias) : 0;
}

/** Los globos de la copia `copia` (0 es la primera), en el orden en que la pieza los arma. */
export function globosDeUnidad(nodo: NodoArmado, copia = 0): GloboDePieza[] {
  const n = globosPorUnidad(nodo);
  return nodo.globos.slice(copia * n, (copia + 1) * n);
}

/** El giro del marco deja ruido de 1e-13 cm: se redondea a 0,001 cm para que dos copias iguales caigan siempre en los mismos tramos. */
const redondeado = (n: number): number => Math.round(n * 1000) / 1000 + 0;

const determinante = ({ m }: MarcoPieza): number => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

/**
 * Los centros de los globos de una copia, en el espacio de la pieza y en el orden en que la pieza los arma. Una pieza puesta
 * `sobre` otra o en un ancla tiene un marco espejo (determinante −1, ver `marcoDeAncla` en `escena.ts`): en el salón se ve
 * reflejada, así que aquí se refleja también su x. Así el giro de una espiral, el sentido de la numeración y la izquierda y la
 * derecha de la hoja son los que se ven en el 3D, y una copia reflejada no se junta con una que no lo está.
 */
export function centrosDeUnidad(nodo: NodoArmado, copia = 0): CentroLocal[] {
  const marco = nodo.puestas[copia]?.marco;
  const espejo = marco !== undefined && determinante(marco) < 0 ? -1 : 1;
  return globosDeUnidad(nodo, copia).map((globo) => {
    const mundo = centroDelGlobo(globo);
    const p = marco ? puntoALocal(marco, mundo) : mundo;
    return { globo, x: redondeado(espejo * p.x), y: redondeado(p.y), z: redondeado(p.z) };
  });
}
