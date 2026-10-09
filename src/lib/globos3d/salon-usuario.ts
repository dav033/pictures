import { armarEscena, descendientes, type Escena } from "./escena";
import { esDelSalon } from "./salon-registro";
import { unir, type RectCm } from "./salon-zonas";

/**
 * Las piezas del USUARIO que están en el piso (con lo que cuelga de ellas o va encima): lo que el salón esquiva o, con fondo de
 * fotos, corre como un bloque. Las del techo, del aire (`libre`) y de la pared no cuentan: no estorban a las mesas y el salón no
 * las mueve.
 */

export type BloqueUsuario = { id: string; caja: RectCm };

/**
 * Cada pieza raíz del usuario en el piso con el rectángulo que ocupa junto con lo suyo. `conAdoptadas`: también las que el salón
 * ya corrió a su fondo de fotos (siguen a su zona, así que al ajustar no cuentan como obstáculo).
 */
export function piezasDeUsuarioEnElPiso(escena: Escena, conAdoptadas: boolean): BloqueUsuario[] {
  const propias = escena.nodos.filter((n) => n.colocacion.en === "piso" && !esDelSalon(escena, n.id) && (conAdoptadas || escena.salon?.piezas[n.id] === undefined));
  if (!propias.length) return [];
  const armada = armarEscena(escena);
  const cajas = new Map(armada.porNodo.filter((n) => n.copias > 0 && Number.isFinite(n.caja.min.x)).map((n) => [n.id, { x0: n.caja.min.x, x1: n.caja.max.x, z0: n.caja.min.z, z1: n.caja.max.z }]));
  return propias.flatMap((nodo) => {
    const rects = [...descendientes(escena, nodo.id)].flatMap((id) => { const r = cajas.get(id); return r ? [r] : []; });
    return rects.length ? [{ id: nodo.id, caja: rects.reduce(unir) }] : [];
  });
}
