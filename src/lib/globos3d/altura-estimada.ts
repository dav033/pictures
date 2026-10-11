import { interpolarGrosor } from "./organico-geometria";
import type { OpcionesOrganico } from "./organico";

/**
 * **Cuánto mide de alto un cuerpo orgánico más grueso, sin armarlo.** El alto de verdad (`alturaDePieza`) arma la pieza, y una grande tarda
 * segundos; pero al engrosar el cuerpo solo cambia lo que asoma de su eje: la cima (el punto más alto del eje más el radio de la envoltura
 * ahí) y, si la pieza no apoya en el piso, el fondo. El alto de la pieza engrosada es el de la de partida (armada) más lo que cambió esa
 * extensión: medido en un arco de 500 × 320, a ×1,12 y ×1,25 de grosor da 2,4 y 6,0 cm más y la cuenta da 2,4 y 5,0.
 */

/** De la cima al fondo del cuerpo (cm): el eje más el radio de la envoltura; con piso, el fondo no baja de 0. */
export function extensionDelCuerpo(o: Pick<OpcionesOrganico, "tramos" | "suelo">): number {
  let cima = -Infinity, fondo = Infinity;
  for (const tramo of o.tramos) {
    const largos = tramo.recorrido.slice(1).map((q, i) => Math.hypot(q.x - tramo.recorrido[i]!.x, q.y - tramo.recorrido[i]!.y, q.z - tramo.recorrido[i]!.z));
    const total = largos.reduce((suma, largo) => suma + largo, 0) || 1;
    let recorrido = 0;
    tramo.recorrido.forEach((q, i) => {
      if (i > 0) recorrido += largos[i - 1]!;
      const radio = interpolarGrosor(tramo.grosor, recorrido / total);
      cima = Math.max(cima, q.y + radio);
      fondo = Math.min(fondo, q.y - radio);
    });
  }
  return cima - (o.suelo ? Math.max(0, fondo) : fondo);
}

/** El alto (cm) de una pieza que solo cambió de grosor respecto de otra de la que se sabe el alto armado. */
export const alturaEstimada = (altoDePartida: number, deLaPartida: Pick<OpcionesOrganico, "tramos" | "suelo">, deLaPieza: Pick<OpcionesOrganico, "tramos" | "suelo">): number =>
  altoDePartida + extensionDelCuerpo(deLaPieza) - extensionDelCuerpo(deLaPartida);
