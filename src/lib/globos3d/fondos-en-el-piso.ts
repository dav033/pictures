import { profundidadEnElPiso } from "./encuadre-foto";
import type { LecturaFoto } from "./lectura-foto";
import { PROFUNDIDAD_DE_LA_FOTO_CM } from "./proyeccion-foto";

/**
 * **Un cuerpo apoyado en el piso, como se arma** (`compilar-lectura.ts`): lo que se para delante de la decoración (cada pedestal de
 * un juego detectado, una mesa) se ve más grande si su pie baja de la línea del piso, y se coloca en la profundidad que dice ese
 * pie o, si el pie no dice profundidad (sobre la línea del piso o tapado), al retiro del catálogo. Aquí se calcula una vez para
 * que quien lo arma y quien pone algo encima (`apoyo-racimo.ts`) lo vean igual. Puro.
 */

/** Cuánto se retira de la pared un cuerpo cuyo pie no dice profundidad: el retiro del catálogo, que lo deja delante de cualquier panel. */
export const RETIRO_MUEBLE_CM = 120;
/** Lo mínimo que mide un cuerpo armado (cm). */
const MINIMO_CM = 30;

export type Conversion = { X: (x: number) => number; Y: (y: number) => number; cm: (f: number) => number };
/** Un cuerpo leído: su centro, su pie, su ancho y su alto (fracciones de la foto). */
export type CuerpoLeido = { x: number; yBase: number; ancho: number; alto: number };
export type CuerpoColocado = { anchoCm: number; altoCm: number; xCm: number; zCm: number; factor: number };

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Su ancho (el diámetro de un pedestal), su alto, su x y la z de su centro, ya a su tamaño real y en su profundidad. */
export function colocarCuerpo(l: LecturaFoto, c: CuerpoLeido, muro: number, conv: Conversion): CuerpoColocado {
  const { delanteCm, factor } = profundidadEnElPiso(l, c.yBase);
  const anchoCm = r0(Math.max(MINIMO_CM, conv.cm(c.ancho) * factor));
  return {
    anchoCm, altoCm: r0(Math.max(MINIMO_CM, conv.cm(c.alto) * factor)), xCm: r1(conv.X(c.x) * factor), factor,
    zCm: delanteCm > 0 ? r0(muro + PROFUNDIDAD_DE_LA_FOTO_CM + delanteCm - anchoCm / 2) : muro + RETIRO_MUEBLE_CM,
  };
}
