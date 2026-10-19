import { armarPieza, type Pieza, type PiezaArmada } from "./piezas";

/**
 * **Cuánto mide de alto una pieza**, con UNA sola definición para todo el que pregunta si cabe bajo el techo: la herramienta de
 * escena que valida una pieza (`comprobarAltura`) y `ajustar_tamanos` al decidir hasta dónde puede engrosar un cuerpo. Las
 * piezas con medida declarada (columna, arco, pared de globos o de trenzas, arco orgánico) valen por ella; las de decoración,
 * escenografía y techo no cuentan; el resto, por la caja de lo armado.
 */

/** Piezas ya armadas por su JSON (para no rehacer una pieza orgánica en cada llamada que necesita su geometría). */
export const CACHE_ARMADO = new Map<string, PiezaArmada>();
const MAXIMO_ARMADAS = 300;

export function armadaDe(p: Pieza): PiezaArmada {
  const clave = JSON.stringify(p);
  let armada = CACHE_ARMADO.get(clave);
  if (!armada) {
    armada = armarPieza(p);
    CACHE_ARMADO.set(clave, armada);
    while (CACHE_ARMADO.size > MAXIMO_ARMADAS) { const primera = CACHE_ARMADO.keys().next().value; if (primera === undefined) break; CACHE_ARMADO.delete(primera); }
  }
  return armada;
}

export function alturaDePieza(pieza: Pieza): number {
  switch (pieza.tipo) {
    case "columna": return pieza.alturaCm;
    case "arco": case "pared_malla": return pieza.altoCm;
    case "arco_organico": return pieza.arco.altoCm;
    case "pared_trenzas": return pieza.opciones.altoCm;
    case "decoracion": case "escenografia": case "techo": return 0;
    default: { const { min, max } = armadaDe(pieza).caja; return max.y - min.y; }
  }
}
