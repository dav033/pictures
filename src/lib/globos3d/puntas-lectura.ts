/**
 * **Las puntas de una guirnalda leída.** En una foto, el primer y el último punto del eje marcan hasta dónde llega el
 * cuerpo de globos (el centro del último racimo); el trazo, en cambio, cierra cada extremo que queda en el aire con un
 * remate redondo (media esfera de globos) que sobresale medio grosor MÁS ALLÁ de su último punto. Armada tal cual, la guirnalda
 * de la foto sale más larga por sus puntas libres (un semiarco cuyo tramo de arriba en la foto es más corto sale completo).
 * Aquí cada punta libre se recoge hacia dentro lo que sobresale su remate, y la que toca el piso (abierta, sin remate) no se toca.
 */

/** Un extremo con el borde de los globos a menos de esto del piso nace del piso y queda abierto (como en `trazo-organico.ts`). */
export const TOCA_PISO_CM = 6;
/** Qué parte del radio de la punta se recoge hacia dentro. */
export const FRACCION_PUNTA = 0.5;
/** Lo más que se recoge una punta de lo que mide su primer tramo (un tramo corto no se pliega sobre sí mismo). */
const PARTE_DEL_TRAMO = 0.6;

type PuntoCm = { x: number; y: number; grosor: number };

/** La punta `extremo` recogida hacia su vecino `vecino`; igual si toca el piso o si no hay tramo. */
function recoger<T extends PuntoCm>(extremo: T, vecino: T, fraccion: number): T {
  if (extremo.y - extremo.grosor / 2 <= TOCA_PISO_CM) return extremo;
  const largo = Math.hypot(vecino.x - extremo.x, vecino.y - extremo.y);
  if (largo < 1e-6) return extremo;
  const recogido = Math.min((extremo.grosor / 2) * fraccion, largo * PARTE_DEL_TRAMO);
  const k = recogido / largo;
  return { ...extremo, x: Math.round((extremo.x + (vecino.x - extremo.x) * k) * 10) / 10, y: Math.round((extremo.y + (vecino.y - extremo.y) * k) * 10) / 10 };
}

/** Los puntos (cm, plano de la pared) con las dos puntas libres recogidas lo que sobresale su remate. */
export function recogerPuntas<T extends PuntoCm>(puntos: readonly T[], fraccion = FRACCION_PUNTA): T[] {
  if (puntos.length < 2) return [...puntos];
  const ultimo = puntos.length - 1;
  return puntos.map((q, i) => (i === 0 ? recoger(q, puntos[1]!, fraccion) : i === ultimo ? recoger(q, puntos[ultimo - 1]!, fraccion) : q));
}
