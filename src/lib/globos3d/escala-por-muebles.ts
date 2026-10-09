import { entradaDeCatalogo } from "./fondos-escenografia";
import type { PiezaLeida } from "./lectura-foto";
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
/** Una caja que toca el borde de abajo de la foto (su pie sale de la imagen) mide menos que la mesa: no se fía. */
const BORDE_DE_ABAJO = 0.98;
/** La caja detectada es de la mesa que leyó el lector si sus centros están a menos de esto (fracción del alto de la foto) o se solapan (IoU). */
const CENTROS_MAXIMOS = 0.15;
const IOU_MINIMO = 0.3;
/** Los globos y la mesa concuerdan si sus escalas no se apartan más que esta razón: entonces valen las dos (su media geométrica). */
export const RAZON_DE_ACUERDO = 1.35;

type Caja = { x0: number; y0: number; x1: number; y1: number };

/**
 * La escala (cm de alto de foto) que dan las mesas, o `null`. Solo cuentan las mesas que el lector CONFIRMÓ: una pieza leída con el mismo id de catálogo
 * (una de cóctel que la detección llamó «de postres» no sirve) y una caja detectada de ese mismo id que cae sobre lo leído. Las cajas bajas de más o que
 * tocan el borde de abajo de la foto (la mesa sale cortada) no valen. Con varias, la mediana.
 */
export function escalaPorMesas(fondos: readonly FondoDetectado[], leidas: readonly PiezaLeida[], aspecto: number): number | null {
  const escalas: number[] = [];
  for (const p of leidas) {
    if (p.tipo !== "fondo" || !MESAS_DE_ESCALA.has(p.id) || (p.cantidad ?? 1) > 1) continue;
    const e = entradaDeCatalogo(p.id) as MuebleCatalogo | undefined;
    if (e?.clase !== "mueble") continue;
    const leida: Caja = { x0: p.x * aspecto - p.ancho / 2, x1: p.x * aspecto + p.ancho / 2, y0: p.yBase - p.alto, y1: p.yBase };
    const candidatas = fondos.filter((f) => f.id === p.id).flatMap((f) => {
      const [y0, x0, y1, x1] = f.box_2d.map((n) => n / 1000) as [number, number, number, number];
      if (![y0, x0, y1, x1].every(Number.isFinite) || y1 <= y0 || x1 <= x0) return [];
      const caja: Caja = { x0: x0 * aspecto, x1: x1 * aspecto, y0, y1 };
      const centros = Math.hypot((caja.x0 + caja.x1) / 2 - (leida.x0 + leida.x1) / 2, (caja.y0 + caja.y1) / 2 - (leida.y0 + leida.y1) / 2);
      const w = Math.max(0, Math.min(caja.x1, leida.x1) - Math.max(caja.x0, leida.x0)), h = Math.max(0, Math.min(caja.y1, leida.y1) - Math.max(caja.y0, leida.y0));
      const iou = (w * h) / ((caja.x1 - caja.x0) * (caja.y1 - caja.y0) + (leida.x1 - leida.x0) * (leida.y1 - leida.y0) - w * h || 1);
      return iou >= IOU_MINIMO || centros <= CENTROS_MAXIMOS ? [{ caja, centros }] : [];
    }).sort((a, b) => a.centros - b.centros);
    const mejor = candidatas[0]?.caja;
    if (!mejor || mejor.y1 >= BORDE_DE_ABAJO || mejor.y1 - mejor.y0 < ALTO_MINIMO_CAJA) continue;
    escalas.push(e.medidas.altoCm / (mejor.y1 - mejor.y0));
  }
  escalas.sort((a, b) => a - b);
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
