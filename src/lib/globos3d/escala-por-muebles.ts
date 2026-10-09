import { entradaDeCatalogo } from "./fondos-escenografia";
import type { FondoDetectado } from "./medir-fondos";
import type { MuebleCatalogo } from "./mobiliario-tipos";

/**
 * **La escala de la foto por los muebles de medida conocida** (`medir-con-detecciones.ts`): los globos dan la escala si se sabe qué formato es cada uno, y esa
 * correspondencia (qué grupo de tamaños es el R-12) es lo que más falla: en la foto del cumpleaños la medida cayó a 481 cm en vez de ~300 por tomar los
 * globos chicos por R-12. Una mesa de las que tienen una altura de catálogo conocida (la de postres de 90 cm, la imperial y la redonda de 75, la de cóctel) da la
 * escala por su caja detectada: alto real / alto en la foto. Solo cuentan esas mesas: nada que vaya sobre ellas (pasteles, corazones) ni un telón (una cortina
 * llega hasta donde llegue) ni un mueble de medida variable entra en la cuenta. Puro.
 */

/** Las mesas cuya altura real es la del catálogo (±15 %): con ella se mide la escala. */
export const MESAS_DE_ESCALA: ReadonlySet<string> = new Set(["mesa_postres", "mesa_postres_mantel", "mesa_imperial", "mesa_imperial_mantel", "mesa_redonda", "mesa_redonda_mantel", "mesa_coctel", "mesa_coctel_licra"]);

/** Una caja más baja que esto (fracción del alto de la foto) es un pedazo o un fallo de la detección: no se fía. */
const ALTO_MINIMO_CAJA = 0.06;
/** Los globos y la mesa concuerdan si sus escalas no se apartan más que esta razón: entonces valen las dos (su media geométrica). */
export const RAZON_DE_ACUERDO = 1.35;

/** La escala (cm de alto de foto) que dan las mesas detectadas (la mediana si hay varias), o `null`. */
export function escalaPorMesas(fondos: readonly FondoDetectado[]): number | null {
  const escalas = fondos.flatMap((f) => {
    if (!MESAS_DE_ESCALA.has(f.id)) return [];
    const e = entradaDeCatalogo(f.id) as MuebleCatalogo | undefined;
    const [y0, , y1] = f.box_2d;
    const alto = Number.isFinite(y0) && Number.isFinite(y1) ? (y1! - y0!) / 1000 : 0;
    return e?.clase === "mueble" && alto >= ALTO_MINIMO_CAJA ? [e.medidas.altoCm / alto] : [];
  }).sort((a, b) => a - b);
  return escalas.length ? escalas[Math.floor((escalas.length - 1) / 2)]! : null;
}

/**
 * La escala final de los globos (`globos`), la de las mesas (`mesas`, o `null`) y la que leyó el lector (`leida`): sin mesas, la de los globos; con ellas, si
 * concuerdan, su media geométrica; si no, la mediana de las tres (un fallo en una sola de las medidas no manda).
 */
export function escalaReconciliada(globos: number, mesas: number | null, leida: number): number {
  if (mesas === null) return globos;
  if (Math.max(globos, mesas) / Math.min(globos, mesas) <= RAZON_DE_ACUERDO) return Math.sqrt(globos * mesas);
  return [globos, mesas, leida].sort((a, b) => a - b)[1]!;
}
