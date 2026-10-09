import { entradaDeCatalogo } from "./fondos-escenografia";
import { colocarCuerpo, type Conversion, type CuerpoLeido } from "./fondos-en-el-piso";
import type { LecturaFoto, PiezaLeida } from "./lectura-foto";

/**
 * **Dónde se apoya un montón de piso cuyo pie se ve sobre la línea del piso** (`compilar-lectura.ts`): puede estar colgado de un
 * aro (en el aire) o puesto sobre una mesa o un pedestal. Si debajo de él (a lo ancho) hay un mueble de piso cuyo tope, en la foto,
 * queda a la altura del pie del montón, se asienta encima: en la altura y la profundidad con que se arma ese mueble
 * (`fondos-en-el-piso.ts`) y a su escala; si no, cuelga o está en el piso (un pie a ras del tope de un mueble corto en primer plano, que
 * ya no se ve sobre la línea del piso, también cuenta). Se compara en coordenadas de la foto: un pie por delante de la línea del piso no se
 * pierde por el recorte a cero de la altura. Puro.
 */

/** El pie del montón y el tope del mueble se tienen por el mismo sitio si difieren menos de esto (cm de la foto). */
const TOLERANCIA_TOPE_CM = 25;

type Monton = Extract<PiezaLeida, { tipo: "racimo_piso" }>;
export type ApoyoDeRacimo = { xCm: number; yCm: number; zCm: number; factor: number; nombre: string };

/** Los cuerpos del fondo: cada pedestal de un juego detectado, o el fondo entero. */
function cuerpos(q: Extract<PiezaLeida, { tipo: "fondo" }>): CuerpoLeido[] {
  return q.cajas?.length ? q.cajas : [{ x: q.x, yBase: q.yBase, ancho: q.ancho, alto: q.alto }];
}

/** El mueble de piso sobre el que se ve el montón (por su x y la altura de su tope en la foto), o `null` si cuelga. */
export function apoyoDeRacimo(l: LecturaFoto, p: Monton, muro: number, conv: Conversion): ApoyoDeRacimo | null {
  const tolerancia = TOLERANCIA_TOPE_CM / l.escala.altoImagenCm;
  for (const q of l.piezas) {
    if (q.tipo !== "fondo") continue;
    const e = entradaDeCatalogo(q.id);
    if (!e || e.lugar !== "piso" || e.flotaCm !== undefined || ("telon" in e && e.telon) || !(e.clase === "mueble" || e.retiroCm !== undefined)) continue;
    for (const k of cuerpos(q)) {
      if (Math.abs(p.x - k.x) * l.aspecto > k.ancho / 2 || Math.abs(k.yBase - k.alto - p.yPie) > tolerancia) continue;
      const hecho = colocarCuerpo(l, k, muro, conv);
      return { xCm: r1(conv.X(p.x) * hecho.factor), yCm: hecho.altoCm, zCm: hecho.zCm, factor: hecho.factor, nombre: q.id.replace(/_/g, " ") };
    }
  }
  return null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
