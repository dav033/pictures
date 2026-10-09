import type { Escena, Sala } from "./escena";
import { cuelgaDeTecho } from "./herramientas-escena-techo-zona";
import { armarPieza } from "./piezas";

/**
 * **Los techos del salón cuando cambia el alto de la sala** (REQ-008): una decoración de techo cuelga una distancia fija del techo, así
 * que al bajar la sala de 4,5 a 3 m los festones se quedarían a la altura de la cabeza. Aquí se vuelve a calcular lo que cuelga (con la
 * misma regla de `techo_por_zona`) en los techos que puso esa herramienta (ids `techo-zona-…`). Sin cambio de alto no toca nada.
 */

const esTechoDeZona = (id: string) => id.startsWith("techo-zona-");

/** La escena con la sala nueva y los techos de zona vueltos a colgar para ese alto. */
export function conSalaNueva(escena: Escena, sala: Sala): Escena {
  if (sala.altoCm === escena.sala.altoCm) return { ...escena, sala };
  const nodos = escena.nodos.map((n) => {
    const c = n.colocacion;
    if (c.en !== "techo" || n.pieza.tipo !== "techo" || !esTechoDeZona(n.id)) return n;
    const { min, max } = armarPieza(n.pieza).caja;
    return { ...n, colocacion: { ...c, cuelgaCm: Math.round(cuelgaDeTecho(sala.altoCm, max.y - min.y)) } };
  });
  return { ...escena, sala, nodos };
}
