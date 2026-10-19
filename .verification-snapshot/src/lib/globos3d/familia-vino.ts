import { labDeRgb } from "@/lib/rag/catalog/similitud-color";

/**
 * **La familia vino–ciruela–malva–morado oscuros**: los tonos que un decorador llama malva, ciruela, uva, berenjena, burdeos, borgoña o merlot y que el
 * detector de globos (22 palabras) solo puede decir «morado» o «vino». Con el color típico de esas dos palabras (CIELAB) ningún nombre libre de la lectura
 * queda a 40 («Fashion Merlot» a 57 del morado típico): los globos de ese racimo no contaban en ningún color de la pieza y los demás colores se llevaban su
 * parte. Aquí se dice si un hex cae en la familia por su claridad, su croma y su tono, sin mirar nombres. Puro.
 */

const CLARIDAD_MAXIMA = 46;
const CROMA_MINIMO = 18;
/** Del morado azulado (295°) por el magenta y el rosa oscuro hasta el vino rojizo (25°); el rojo ladrillo y el café quedan fuera. */
const TONO_DESDE = 295;
const TONO_HASTA = 25;

export function esVinoCiruela(hex: string): boolean {
  const [l, a, b] = labDeRgb(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  if (l > CLARIDAD_MAXIMA || Math.hypot(a, b) < CROMA_MINIMO) return false;
  const tono = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return tono >= TONO_DESDE || tono <= TONO_HASTA;
}
