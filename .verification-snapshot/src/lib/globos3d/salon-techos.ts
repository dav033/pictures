import type { Escena, Sala } from "./escena";
import { armarPieza } from "./piezas";

/**
 * **Los techos del salón cuando cambia el alto de la sala** (REQ-008): una decoración de techo cuelga una distancia del techo, así que
 * al bajar la sala de 4,5 a 3 m los festones se quedarían a la altura de la cabeza. Aquí se vuelve a colgar lo de los techos que puso
 * `techo_por_zona` (ids `techo-zona-…`) conservando el alto libre que tenían desde el piso (el que eligió quien los pidió), todo lo que
 * quepa en la sala nueva. Si no cabe, o queda bajo para pasar, se avisa en vez de callarlo. Sin cambio de alto no toca nada.
 */

const esTechoDeZona = (id: string) => id.startsWith("techo-zona-");
/** Por debajo de esto (cm) no se pasa cómodo bajo una decoración de techo. */
const LIBRE_PARA_PASAR_CM = 210;
/** Lo que se deja pegado a la pared del techo para el hilo (misma regla que la herramienta). */
const HILO_MAXIMO_RESTA_CM = 40;

export type SalaNueva = { escena: Escena; avisos: string[] };

/** La escena con la sala nueva y los techos de zona vueltos a colgar para ese alto, con lo que hay que avisar. */
export function conSalaNueva(escena: Escena, sala: Sala): SalaNueva {
  if (sala.altoCm === escena.sala.altoCm) return { escena: { ...escena, sala }, avisos: [] };
  const avisos: string[] = [];
  const nodos = escena.nodos.map((n) => {
    const c = n.colocacion;
    if (c.en !== "techo" || n.pieza.tipo !== "techo" || !esTechoDeZona(n.id)) return n;
    const { min, max } = armarPieza(n.pieza).caja;
    const alto = max.y - min.y;
    const libreAntes = escena.sala.altoCm - c.cuelgaCm - alto;
    const cuelga = Math.round(Math.min(Math.max(0, sala.altoCm - HILO_MAXIMO_RESTA_CM), Math.max(0, sala.altoCm - libreAntes - alto)));
    const libre = sala.altoCm - cuelga - alto;
    if (libre < 0) avisos.push(`«${n.nombre}» mide ${Math.round(alto)} cm de alto y la sala ${Math.round(sala.altoCm)} cm: no cabe, atraviesa el piso. Quítala o ponla más chica con techo_por_zona.`);
    else if (libre < libreAntes - 1) avisos.push(`«${n.nombre}» queda a ${Math.round(libre)} cm del piso (antes ${Math.round(libreAntes)}): no cabe más alta en la sala nueva.`);
    if (libre >= 0 && libre < LIBRE_PARA_PASAR_CM) avisos.push(`«${n.nombre}» queda a ${Math.round(libre)} cm del piso: es bajo para pasar por debajo.`);
    return { ...n, colocacion: { ...c, cuelgaCm: cuelga } };
  });
  return { escena: { ...escena, sala, nodos }, avisos };
}
