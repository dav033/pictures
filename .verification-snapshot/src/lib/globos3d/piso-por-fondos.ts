import { entradaDeCatalogo, esTelon } from "./fondos-escenografia";
import type { LecturaFoto, PiezaLeida } from "./lectura-foto";
import type { FondoDetectado } from "./medir-fondos";

/**
 * **La línea del piso que dicen los muebles detectados** (`medir-con-detecciones.ts`, caso del dueño «quince-mesa»): el lector puso el
 * piso del montaje en el brillo del piso que se ve entre la cámara y el fondo (0,52 del alto) cuando el trono del montaje apoya sus patas
 * en 0,45. Un mueble de piso no flota: si TODOS los muebles de piso detectados (sillas, tronos, mesas, pedestales; no los telones, cuyo
 * pie suele quedar tapado, ni lo que la foto corta por abajo) tienen el pie por encima de la línea leída en más de `MARGEN`, la línea
 * del piso pasa al pie más bajo de ellos. Si alguno apoya en ella o más abajo (lo que está por delante), o si algo de lo leído se apoya
 * más abajo de la línea nueva (el pie de una columna, de un arco, un montón, un globo en el piso), la leída queda. Pura.
 */

/** Cuánto (fracción del alto de la foto) por encima de la línea leída tiene que quedar el pie de un mueble para decir que la línea está mal. */
const MARGEN = 0.06;
/** Un pie más abajo que esto está cortado por el borde de abajo de la foto: no dice dónde apoya. */
const BORDE_DE_ABAJO = 0.97;
/** El extremo de una guirnalda a esto (fracción del alto) de la línea leída nace del piso. */
const TOCA_EL_PISO = 0.03;

/** ¿El fondo se para en el piso por delante de la pared (un mueble, un pedestal, un tapete) y no es un telón? */
function seApoyaEnElPiso(id: string): boolean {
  const e = entradaDeCatalogo(id);
  if (!e || e.lugar !== "piso" || e.flotaCm !== undefined || esTelon(id)) return false;
  return e.clase === "mueble" ? !e.sobreMesa : e.retiroCm !== undefined;
}

/** Los pies de lo leído que se apoya en el piso (columnas, ramos, montones, globos y muebles de piso, la punta de una guirnalda que nace del piso). */
function piesLeidos(piezas: readonly PiezaLeida[], pisoY: number): number[] {
  return piezas.flatMap((p) => {
    switch (p.tipo) {
      case "columna_organica": case "columna_clasica": case "ramo_helio": return [p.yBase];
      case "racimo_piso": return [p.yPie];
      case "globo": return p.en === "piso" ? [p.y + p.diametro / 2] : [];
      case "fondo": return seApoyaEnElPiso(p.id) && p.yBase < BORDE_DE_ABAJO ? [p.yBase] : [];
      case "guirnalda_organica": return [p.puntos[0]!, p.puntos[p.puntos.length - 1]!].map((q) => q.y + q.grosor / 2).filter((y) => y >= pisoY - TOCA_EL_PISO);
      default: return [];
    }
  });
}

/** La línea del piso con los muebles detectados (y la nota si cambió); la leída si no hay con qué, si alguno apoya en ella o si lo leído baja más. */
export function pisoPorFondosDetectados(l: LecturaFoto, fondos: readonly FondoDetectado[]): { pisoY: number | null; nota: string | null } {
  const pisoY = l.pisoY;
  if (pisoY === null) return { pisoY, nota: null };
  const pies = fondos.filter((f) => seApoyaEnElPiso(f.id)).map((f) => (f.box_2d[2] ?? NaN) / 1000).filter((y) => Number.isFinite(y) && y < BORDE_DE_ABAJO);
  if (!pies.length || Math.max(...pies) > pisoY - MARGEN) return { pisoY, nota: null };
  const nuevo = Math.round(Math.max(...pies) * 1000) / 1000;
  if (piesLeidos(l.piezas, pisoY).some((y) => y > nuevo + MARGEN)) return { pisoY, nota: null };
  return { pisoY: nuevo, nota: `La línea del piso leída (${pisoY}) queda por debajo del pie de todos los muebles del montaje detectados: pasa a ${nuevo}, donde apoyan.` };
}
