import { sombrear, type ElementoEscenografia } from "./escenografia";
import { caja, mat, r1, v, type Material } from "./mobiliario-base";

/**
 * **Cortina de flecos** (cm): el fondo de tiras de brillo, tinsel o shimmer que cuelga de un riel (y, opcionalmente, sobre un
 * drapeado de raso). Cada tira es una caja delgada y vertical; las tiras comparten tres materiales (el color, uno más oscuro y uno
 * más claro, que dan el centelleo) y el visor junta lo que comparte material en una sola malla por pieza: cien tiras son tres mallas,
 * no cien. Cuelga de la pared del fondo, centrada en x = 0, con la base en y = 0.
 */

export type OpcionesFlecos = { anchoCm: number; fondoCm: number; altoCm: number; flecos: Material; /** El drapeado de raso de detrás (si falta, solo se ven las tiras y la pared a través). */ raso?: Material };

/** Separación (cm) entre tira y tira, y tope de tiras: el ancho manda, pero una cortina de 8 m no llena la escena de cajas. */
const SEPARACION_FLECOS_CM = 2.4;
const MAXIMO_FLECOS = 160;
const MINIMO_FLECOS = 8;
/** Entre una tira y la de al lado cambia la capa (dos profundidades) y el tono: eso le da al fleco volumen y brillo. */
const CAPAS_Z_CM = [1.5, 2.6] as const;
/** Cada tira es un poco más corta que la anterior (hasta este tanto del alto): el borde de abajo no es una línea recta. */
const DESIGUALDAD_DEL_BORDE = 0.04;

/** Mezcla `hex` con blanco en la proporción `k` (0 = igual, 1 = blanco). */
function aclarar(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const c = (x: number) => Math.round(x + (255 - x) * k).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Cuántas tiras lleva una cortina de ese ancho. */
export const flecosDe = (anchoCm: number): number => Math.min(MAXIMO_FLECOS, Math.max(MINIMO_FLECOS, Math.floor(anchoCm / SEPARACION_FLECOS_CM)));

export function cortinaFlecos(o: OpcionesFlecos): ElementoEscenografia[] {
  const { anchoCm: w, altoCm: h, flecos } = o;
  const n = flecosDe(w), paso = w / n;
  const tonos = [flecos, mat(sombrear(flecos.hex, 0.84), flecos.acabado), mat(aclarar(flecos.hex, 0.35), flecos.acabado)];
  const salida: ElementoEscenografia[] = [];
  if (o.raso) {
    salida.push(caja(v(0, h / 2, 0.5), v(w, h, 0.8), o.raso));
    // Los pliegues del drapeado: una nervadura vertical cada ~16 cm, un poco más oscura.
    const pliegue = mat(sombrear(o.raso.hex, 0.9), o.raso.acabado);
    for (let x = -w / 2 + 8; x < w / 2 - 4; x += 16) salida.push(caja(v(r1(x), h / 2, 1.1), v(2.2, h, 0.8), pliegue));
  }
  for (let i = 0; i < n; i++) {
    const largo = r1(h * (1 - DESIGUALDAD_DEL_BORDE * (((i * 7) % 5) / 4)));
    salida.push(caja(v(r1(-w / 2 + (i + 0.5) * paso), r1(h - largo / 2), CAPAS_Z_CM[i % 2]!), v(1.3, largo, 0.5), tonos[(i + (i % 3)) % 3]!));
  }
  // El riel de arriba, de donde cuelgan.
  salida.push(caja(v(0, h - 1.2, 2), v(r1(w + 4), 2.4, 2.4), mat(sombrear(flecos.hex, 0.5), "metal")));
  return salida;
}
