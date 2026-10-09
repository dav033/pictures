import { profundidadEnElPiso } from "./encuadre-foto";
import { entradaDeCatalogo } from "./fondos-escenografia";
import type { LecturaFoto, PiezaLeida } from "./lectura-foto";
import { PROFUNDIDAD_DE_LA_FOTO_CM } from "./proyeccion-foto";

/**
 * **Dónde se apoya un montón de piso cuyo pie se ve sobre la línea del piso** (`compilar-lectura.ts`): puede estar colgado de un
 * aro (en el aire) o puesto sobre una mesa o un pedestal. Si debajo de él (a lo ancho) hay un mueble de piso cuyo tope queda a la
 * altura del pie, el montón se asienta encima, a su profundidad; si no, cuelga. Puro.
 */

/** El pie del montón y el tope del mueble se tienen por el mismo sitio si difieren menos de esto (cm). */
const TOLERANCIA_TOPE_CM = 25;
/** Lo que se retira de la pared un mueble cuyo pie no dice profundidad: el retiro del catálogo para mesas y pedestales. */
const RETIRO_MUEBLE_CM = 120;

type Monton = Extract<PiezaLeida, { tipo: "racimo_piso" }>;
export type Conversion = { X: (x: number) => number; Y: (y: number) => number; cm: (f: number) => number };
export type ApoyoDeRacimo = { yCm: number; zCm: number; nombre: string };

/** Los cuerpos con su centro, su ancho, su pie y su alto (cm de la foto): cada pedestal de un juego detectado, o el fondo entero. */
function cuerpos(q: Extract<PiezaLeida, { tipo: "fondo" }>): Array<{ x: number; ancho: number; yBase: number; alto: number }> {
  return q.cajas?.length ? q.cajas.map((c) => ({ x: c.x, ancho: c.ancho, yBase: c.yBase, alto: c.alto })) : [{ x: q.x, ancho: q.ancho, yBase: q.yBase, alto: q.alto }];
}

/** El mueble de piso sobre el que se ve el montón (por su x y la altura de su tope), o `null` si cuelga. */
export function apoyoDeRacimo(l: LecturaFoto, p: Monton, muro: number, c: Conversion): ApoyoDeRacimo | null {
  const pie = c.Y(p.yPie);
  for (const q of l.piezas) {
    if (q.tipo !== "fondo") continue;
    const e = entradaDeCatalogo(q.id);
    if (!e || e.lugar !== "piso" || e.flotaCm !== undefined || ("telon" in e && e.telon) || !(e.clase === "mueble" || e.retiroCm !== undefined)) continue;
    for (const k of cuerpos(q)) {
      const tope = c.Y(k.yBase) + c.cm(k.alto);
      if (Math.abs(c.X(p.x) - c.X(k.x)) > c.cm(k.ancho) / 2 || Math.abs(tope - pie) > TOLERANCIA_TOPE_CM) continue;
      const { delanteCm } = profundidadEnElPiso(l, k.yBase);
      return { yCm: tope, zCm: delanteCm > 0 ? muro + PROFUNDIDAD_DE_LA_FOTO_CM + delanteCm - c.cm(k.ancho) / 2 : muro + RETIRO_MUEBLE_CM, nombre: q.id.replace(/_/g, " ") };
    }
  }
  return null;
}
