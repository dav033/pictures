import type { ElementoEscenografia } from "./escenografia";
import { entradaDeCatalogo } from "./fondos-escenografia";
import type { PiezaLeida } from "./lectura-foto";
import type { FondoDetectado } from "./medir-fondos";
import type { MuebleCatalogo } from "./mobiliario-tipos";

/**
 * **La escala de la foto por las piezas de medida conocida** (`medir-con-detecciones.ts`): los globos dan la escala si se sabe qué formato es cada uno, y esa
 * correspondencia (qué grupo de tamaños es el R-12) es lo que más falla: en la foto del cumpleaños la medida cayó a 481 cm en vez de ~300 por tomar los
 * globos chicos por R-12, y en el entrenamiento 300 cm leídos llegaron a 694. Una pieza de las que tienen una medida de catálogo conocida (la mesa de postres de
 * 90 cm, la imperial y la redonda de 75, la de cóctel, una silla suelta, el juego de pedestales, el panel redondo) da la escala por su caja detectada: medida
 * real / medida en la foto. Solo cuentan esas piezas: nada que vaya sobre ellas (pasteles, corazones) ni un telón (una cortina llega hasta donde llegue) ni un
 * mueble de medida variable entra en la cuenta. `decidirEscala` fija la precedencia entre esta escala, la de los globos y la leída. Puro.
 */

/** Las mesas cuya altura real es la del catálogo (±15 %): con ellas se mide la escala. */
export const MESAS_DE_ESCALA: ReadonlySet<string> = new Set(["mesa_postres", "mesa_postres_mantel", "mesa_imperial", "mesa_imperial_mantel", "mesa_redonda", "mesa_redonda_mantel", "mesa_coctel", "mesa_coctel_licra"]);
/** Las sillas sueltas (una sola: una fila de sillas no vale, su caja es la unión) de alto de catálogo. */
const SILLAS_DE_ESCALA: ReadonlySet<string> = new Set(["silla_tiffany", "silla_moderna"]);
/** Las piezas de medida conocida con las que se mide la escala por una sola dimensión de su caja (alto o ancho). */
type Medida = { dimension: "alto" | "ancho"; cm: number };

/**
 * Referencias BLANDAS: fondos fijos cuya medida real varía de un juego a otro y que están delante de la pared. El pedestal más alto mide ~75 cm (lo que dicen el
 * lector y las fotos del dueño, no los 100 cm del catálogo de ejemplo) con ±`TOLERANCIA_BLANDA`; el panel redondo, el ancho de su catálogo. Como están a ~1,2 m
 * delante del plano donde se mide la escala (más cerca de la cámara se ven más grandes, así que la regla subestima los cm), su escala no es un punto sino un
 * intervalo: de la medida mínima a la máxima y, por arriba, hasta `FACTOR_DELANTE_DEL_PLANO` veces más. `decidirEscala` solo acota con él la escala de los globos.
 */
const REFERENCIAS_BLANDAS: ReadonlyMap<string, Medida | null> = new Map([["pedestales", { dimension: "alto", cm: 75 }], ["panel_redondo", null]]);
const TOLERANCIA_BLANDA = 0.15;
export const FACTOR_DELANTE_DEL_PLANO = 1.6;
/** Los fondos que son un juego de varios cuerpos: la medida es la de la caja detectada MÁS ALTA (un cuerpo), no la de la unión. */
const JUEGOS_DE_ESCALA: ReadonlySet<string> = new Set(["pedestales"]);
export type IntervaloEscala = { min: number; max: number };

/** Una caja más baja que esto (fracción del alto de la foto) es un pedazo o un fallo de la detección: no se fía. */
const ALTO_MINIMO_CAJA = 0.06;
/** Una caja que toca el borde de abajo de la foto (su pie sale de la imagen) mide menos que la pieza: no se fía. */
const BORDE_DE_ABAJO = 0.98;
/** La caja detectada es de la pieza que leyó el lector si sus centros están a menos de esto (fracción del alto de la foto) o se solapan (IoU). */
const CENTROS_MAXIMOS = 0.15;
const IOU_MINIMO = 0.3;
/** Los globos y los muebles concuerdan si sus escalas no se apartan más que esta razón: entonces valen los dos (su media geométrica). */
export const RAZON_DE_ACUERDO = 1.35;
/** Sin ninguna pieza de medida conocida, la escala de los globos no se aparta de la leída más que esta razón (por encima o por debajo)… */
export const RAZON_MAXIMA_SIN_MUEBLES = 2;
/** …o esta otra si la respaldan varias guirnaldas (al menos dos) cuyas escalas coinciden entre sí dentro de `RAZON_DE_CORROBORACION`: entonces la evidencia es de los globos, no del azar de una pieza. */
export const RAZON_MAXIMA_CORROBORADA = 2.5;
export const RAZON_DE_CORROBORACION = 1.25;

type Caja = { x0: number; y0: number; x1: number; y1: number };

/** Ancho y alto (cm) de un conjunto de elementos de escenografía apoyados en el piso. */
export function dimensionesDeElementos(elementos: readonly ElementoEscenografia[]): { ancho: number; alto: number } {
  const xs: number[] = [], ys: number[] = [];
  for (const e of elementos) {
    if (e.forma === "caja") { xs.push(e.centro.x - e.tamano.x / 2, e.centro.x + e.tamano.x / 2); ys.push(e.centro.y - e.tamano.y / 2, e.centro.y + e.tamano.y / 2); }
    else if (e.forma === "cilindro") { xs.push(e.base.x - e.radioCm, e.base.x + e.radioCm); ys.push(e.base.y, e.base.y + e.altoCm); }
    else for (const q of e.contorno) { xs.push(q.x); ys.push(q.y); }
  }
  return xs.length ? { ancho: Math.max(...xs) - Math.min(...xs), alto: Math.max(...ys) - Math.min(0, ...ys) } : { ancho: 0, alto: 0 };
}

/** Lo que mide de verdad, según el catálogo, una pieza FIRME que da escala (su alto en cm), o `null` si no es una de ellas. */
function medidaFirme(id: string): Medida | null {
  const e = entradaDeCatalogo(id);
  return e?.clase === "mueble" && (MESAS_DE_ESCALA.has(id) || SILLAS_DE_ESCALA.has(id)) ? { dimension: "alto", cm: (e as MuebleCatalogo).medidas.altoCm } : null;
}

/** La medida de una referencia blanda (la del catálogo si la tabla no la fija), o `null`. */
function medidaBlanda(id: string): Medida | null {
  if (!REFERENCIAS_BLANDAS.has(id)) return null;
  const fija = REFERENCIAS_BLANDAS.get(id);
  if (fija) return fija;
  const e = entradaDeCatalogo(id);
  if (!e || e.clase !== "fondo") return null;
  const cm = dimensionesDeElementos(e.elementos()).ancho;
  return cm > 0 ? { dimension: "ancho", cm } : null;
}

const cajaDe = (f: FondoDetectado, aspecto: number): Caja | null => {
  const [y0, x0, y1, x1] = f.box_2d.map((n) => n / 1000) as [number, number, number, number];
  if (![y0, x0, y1, x1].every(Number.isFinite) || y1 <= y0 || x1 <= x0) return null;
  return { x0: x0 * aspecto, x1: x1 * aspecto, y0, y1 };
};
const iouDe = (a: Caja, b: Caja) => {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return (w * h) / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - w * h || 1);
};
const centrosDe = (a: Caja, b: Caja) => Math.hypot((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2, (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);

/** Por cada pieza leída del tipo pedido, la escala (cm de alto de foto) que da su caja detectada: medida de catálogo / la de la caja. */
function escalasPorPiezas(fondos: readonly FondoDetectado[], leidas: readonly PiezaLeida[], aspecto: number, medidaDe: (id: string) => Medida | null): number[] {
  const escalas: number[] = [];
  for (const p of leidas) {
    if (p.tipo !== "fondo") continue;
    const medida = medidaDe(p.id);
    if (!medida || ((p.cantidad ?? 1) > 1 && !JUEGOS_DE_ESCALA.has(p.id))) continue;
    const leida: Caja = { x0: p.x * aspecto - p.ancho / 2, x1: p.x * aspecto + p.ancho / 2, y0: p.yBase - p.alto, y1: p.yBase };
    const cajas = fondos.filter((f) => f.id === p.id).flatMap((f) => {
      const caja = cajaDe(f, aspecto);
      if (!caja) return [];
      const centros = centrosDe(caja, leida);
      return iouDe(caja, leida) >= IOU_MINIMO || centros <= CENTROS_MAXIMOS ? [{ caja, centros }] : [];
    }).sort((a, b) => a.centros - b.centros).map((c) => c.caja);
    // Un juego: la caja de un cuerpo, la más alta (la unión de cuerpos a distintas distancias de la cámara no es la de ninguno).
    const mejor = JUEGOS_DE_ESCALA.has(p.id) ? [...cajas].sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0))[0] : cajas[0];
    if (!mejor || mejor.y1 >= BORDE_DE_ABAJO || mejor.y1 - mejor.y0 < ALTO_MINIMO_CAJA) continue;
    escalas.push(medida.cm / (medida.dimension === "alto" ? mejor.y1 - mejor.y0 : mejor.x1 - mejor.x0));
  }
  return escalas.sort((a, b) => a - b);
}
const medianaDe = (v: readonly number[]): number | null => (v.length ? v[Math.floor((v.length - 1) / 2)]! : null);

/**
 * La escala (cm de alto de foto) que dan las piezas FIRMES de medida conocida (mesas, sillas sueltas), o `null`. Solo cuentan las que el lector CONFIRMÓ: una
 * pieza leída con el mismo id de catálogo (una de cóctel que la detección llamó «de postres» no sirve) y una caja detectada de ese mismo id que cae sobre lo
 * leído. Las cajas bajas de más o que tocan el borde de abajo de la foto (la pieza sale cortada) no valen. Con varias, la mediana.
 */
export function escalaPorMuebles(fondos: readonly FondoDetectado[], leidas: readonly PiezaLeida[], aspecto: number): number | null {
  return medianaDe(escalasPorPiezas(fondos, leidas, aspecto, medidaFirme));
}

/** El intervalo de escala que dan las referencias blandas (pedestales, panel redondo), o `null`: de su medida mínima a la máxima y, por arriba, `FACTOR_DELANTE_DEL_PLANO` más. */
export function intervaloPorReferenciasBlandas(fondos: readonly FondoDetectado[], leidas: readonly PiezaLeida[], aspecto: number): IntervaloEscala | null {
  const e = medianaDe(escalasPorPiezas(fondos, leidas, aspecto, medidaBlanda));
  return e === null ? null : { min: e * (1 - TOLERANCIA_BLANDA), max: e * (1 + TOLERANCIA_BLANDA) * FACTOR_DELANTE_DEL_PLANO };
}

/** Antes solo contaban las mesas; el nombre se conserva. */
export const escalaPorMesas = escalaPorMuebles;

/**
 * La escala final de los globos (`globos`), la de las piezas de medida conocida (`muebles`, o `null`) y la que leyó el lector (`leida`): sin piezas, la de los
 * globos; con ellas, si concuerdan, su media geométrica; si no, la mediana de las tres (un fallo en una sola de las medidas no manda).
 */
export function escalaReconciliada(globos: number, muebles: number | null, leida: number): number {
  if (muebles === null) return globos;
  if (Math.max(globos, muebles) / Math.min(globos, muebles) <= RAZON_DE_ACUERDO) return Math.sqrt(globos * muebles);
  return [globos, muebles, leida].sort((a, b) => a - b)[1]!;
}

/** De dónde sale la escala final: globos y muebles juntos, solo los muebles, la lectura, los globos, o los globos acotados a la lectura (sin muebles que los apoyen). */
export type FuenteEscala = "globos+muebles" | "muebles" | "lectura" | "globos" | "globos_acotados" | "referencia_blanda";

/** La decisión de escala con todo lo que se miró, para dejarla en el resultado y en la auditoría. `acotada`: la cota (`RAZON_MAXIMA_*`) cortó la escala de los globos, que no es una medida sino un límite. */
export type DecisionEscala = { cm: number; fuente: FuenteEscala; globos: number; muebles: number | null; leida: number; acotada: boolean; corroborada: boolean };

/** ¿Varias guirnaldas (al menos dos) dan escalas que coinciden entre sí? */
export const escalasCorroboradas = (escalas: readonly number[]): boolean => escalas.length >= 2 && Math.max(...escalas) / Math.min(...escalas) <= RAZON_DE_CORROBORACION;

/**
 * **La política de escala**, en orden de confianza: 1) las piezas de medida de catálogo (tamaño real conocido); 2) si concuerdan con los globos (razón <=
 * `RAZON_DE_ACUERDO`) vale la media geométrica, si no la mediana de globos, piezas y lectura; 3) sin piezas, los globos valen solo hasta
 * (con referencias blandas, los globos solo se acotan a su intervalo) `RAZON_MAXIMA_SIN_MUEBLES` veces la escala leída (`RAZON_MAXIMA_CORROBORADA` si varias guirnaldas coinciden) por encima o por debajo: qué formato es cada
 * globo es lo que más falla, y la cota es una salvaguarda, no una verdad (`acotada` lo dice). Pura.
 */
export function decidirEscala(globos: number, muebles: number | null, leida: number, corroborada = false, blanda: IntervaloEscala | null = null): DecisionEscala {
  const base = { globos, muebles, leida, corroborada, acotada: false };
  if (muebles === null && blanda) {
    // Referencias blandas: los globos valen si caen en su intervalo; si no, el borde más cercano (una cota, no una medida), sin pasar de la escala leída
    // hacia el otro lado: una referencia blanda acerca los globos al lector, nunca los lleva más lejos que él.
    const cm = Math.min(Math.max(globos, leida), Math.max(Math.min(globos, leida), Math.min(blanda.max, Math.max(blanda.min, globos))));
    return { ...base, cm, acotada: cm !== globos, fuente: cm === globos ? "globos" : "referencia_blanda" };
  }
  if (muebles === null) {
    const razon = corroborada ? RAZON_MAXIMA_CORROBORADA : RAZON_MAXIMA_SIN_MUEBLES;
    const cm = Math.min(leida * razon, Math.max(leida / razon, globos));
    return { ...base, cm, acotada: cm !== globos, fuente: cm === globos ? "globos" : "globos_acotados" };
  }
  const cm = escalaReconciliada(globos, muebles, leida);
  if (Math.max(globos, muebles) / Math.min(globos, muebles) <= RAZON_DE_ACUERDO) return { ...base, cm, fuente: "globos+muebles" };
  return { ...base, cm, fuente: cm === muebles ? "muebles" : cm === globos ? "globos" : "lectura" };
}
