import { distanciaLab } from "./colores-formato";
import type { ColorLeido, ColoresEscalon } from "./lectura-foto";
import type { Globo } from "./medir-geometria";
import type { Escalon } from "./mezcla-lectura";

/**
 * **Los colores de la lectura medidos con los globos detectados** (`medir-con-detecciones.ts`): a qué color de la pieza
 * corresponde cada globo detectado, y con esa cuenta los pesos de los colores de la pieza, los de cada escalón de tamaño y
 * el color dominante de cada tramo. Puro.
 *
 * El detector dice el color con una palabra de una lista corta («azul», «plateado», «blanco»); la lectura, con el nombre del
 * decorador y el color medido en la foto («azul marino», «plata», «blanco perla»). Casarlos por el comienzo del nombre se
 * equivoca («plateado» no es «plata», «azul» no es «azul marino»): cada palabra del detector tiene su color típico y se casa
 * con el color de la pieza más cercano en CIELAB, si no se aparta demasiado. El confeti y lo transparente van por acabado.
 */

export const COLORES_DETECCION = ["dorado", "plateado", "blanco", "negro", "rosa", "fucsia", "rojo", "vino", "naranja", "amarillo", "verde", "azul", "azul marino", "morado", "lila", "nude", "beige", "cafe", "gris", "confeti", "transparente", "otro"] as const;
export type ColorDetectado = (typeof COLORES_DETECCION)[number];

/** El color típico de cada palabra del detector (un globo de látex iluminado). */
export const HEX_DE_COLOR_DETECTADO: Readonly<Record<Exclude<ColorDetectado, "confeti" | "transparente" | "otro">, string>> = {
  dorado: "#D4AF37", plateado: "#C0C0C0", blanco: "#F5F5F5", negro: "#1C1C1C", rosa: "#F4A6C0", fucsia: "#D6247A", rojo: "#C8102E", vino: "#6D1A2B",
  naranja: "#F28C28", amarillo: "#F7D94C", verde: "#3A9D5D", azul: "#2F6DB5", "azul marino": "#1B2A5C", morado: "#6A3FA0", lila: "#C3A6E0",
  nude: "#E3C2A8", beige: "#D8C3A0", cafe: "#6B4423", gris: "#8C8C8C",
};

/** Hasta esta distancia CIELAB un color de la pieza vale por el que dijo el detector; más allá, ese globo no cuenta. */
export const DISTANCIA_MAXIMA_COLOR = 40;
/** Con menos globos de color casado no se rehace el reparto de colores de la pieza. */
export const MINIMO_CASADOS = 15;
/** Globos casados que pide un escalón o un tramo para fiarse de su reparto de colores. */
export const MINIMO_COLOR_ESCALON = 6;
export const MINIMO_COLOR_TRAMO = 5;
/** Diferencia mínima (en puntos de %) con el reparto de la pieza para que un escalón lleve sus propios colores. */
export const DESVIO_COLOR_ESCALON = 15;
/** Un color domina un tramo si tiene al menos este % de sus globos y le saca esta diferencia (puntos de %) a su peso en la pieza. */
export const PARTE_DOMINANTE = 70;
export const VENTAJA_DOMINANTE = 15;

/** El índice del color de la pieza que corresponde a cada color detectado (memoizado), o -1. */
export function indiceDeDetectado(colores: readonly ColorLeido[]): (color: string) => number {
  const memo = new Map<string, number>();
  const calcular = (color: string): number => {
    const c = color.trim().toLowerCase();
    if (c === "confeti") return colores.findIndex((x) => x.acabado === "confeti");
    if (c === "transparente") return colores.findIndex((x) => x.acabado === "cristal");
    const hex = (HEX_DE_COLOR_DETECTADO as Readonly<Record<string, string>>)[c];
    if (!hex) return -1;
    let mejor = -1, mejorD = Infinity;
    colores.forEach((x, k) => {
      if (x.acabado === "confeti" || x.acabado === "cristal") return;
      const d = distanciaLab(hex, x.hex);
      if (d < mejorD) { mejorD = d; mejor = k; }
    });
    return mejorD <= DISTANCIA_MAXIMA_COLOR ? mejor : -1;
  };
  return (color) => {
    if (!memo.has(color)) memo.set(color, calcular(color));
    return memo.get(color)!;
  };
}

/** Cuántos globos de cada color de la pieza hay en la lista (los que no casan con ninguno no cuentan). */
export function cuentaPorColor(lista: readonly Globo[], colores: readonly ColorLeido[], indiceDe = indiceDeDetectado(colores)): { cuenta: number[]; total: number } {
  const cuenta = colores.map(() => 0);
  let total = 0;
  for (const g of lista) { const k = indiceDe(g.color); if (k >= 0) { cuenta[k]!++; total++; } }
  return { cuenta, total };
}

/**
 * Los pesos de los colores de la pieza por la cuenta de colores detectados, en una sola escala (suman 100): los colores que
 * aparecen se reparten lo que no ocupan los que no aparecen, que conservan su parte de la lectura.
 */
export function coloresDe(colores: readonly ColorLeido[], globos: readonly Globo[]): ColorLeido[] {
  const { cuenta, total } = cuentaPorColor(globos, colores);
  if (total < MINIMO_CASADOS) return [...colores];
  const pesoTotal = colores.reduce((s, c) => s + c.peso, 0) || 1;
  const sinCuenta = colores.reduce((s, c, k) => s + (cuenta[k]! > 0 ? 0 : (100 * c.peso) / pesoTotal), 0);
  const presupuesto = Math.max(0, 100 - sinCuenta);
  return colores.map((c, k) => ({ ...c, peso: Math.max(1, Math.round(cuenta[k]! > 0 ? (presupuesto * cuenta[k]!) / total : (100 * c.peso) / pesoTotal)) }));
}

/** Los colores de cada escalón que se aparta del reparto de la pieza («los chicos, todos dorados»). */
export function coloresPorEscalonDe(porEscalon: ReadonlyMap<Escalon, readonly Globo[]>, colores: readonly ColorLeido[]): ColoresEscalon[] {
  const indiceDe = indiceDeDetectado(colores);
  const pesoTotal = colores.reduce((s, c) => s + c.peso, 0) || 1;
  const salida: ColoresEscalon[] = [];
  for (const [e, lista] of porEscalon) {
    const { cuenta, total } = cuentaPorColor(lista, colores, indiceDe);
    if (total < MINIMO_COLOR_ESCALON) continue;
    const pesos = cuenta.map((n) => Math.round((100 * n) / total));
    if (pesos.some((w, k) => Math.abs(w - (100 * colores[k]!.peso) / pesoTotal) >= DESVIO_COLOR_ESCALON)) salida.push({ escalon: e, pesos });
  }
  return salida;
}

/** El color que domina en un tramo (≥ 70 % de sus globos y 15 puntos más que en la pieza), o undefined. */
export function dominanteDe(lista: readonly Globo[], colores: readonly ColorLeido[], indiceDe = indiceDeDetectado(colores)): string | undefined {
  const { cuenta, total } = cuentaPorColor(lista, colores, indiceDe);
  if (total < MINIMO_COLOR_TRAMO) return undefined;
  const k = cuenta.reduce((m, n, i) => (n > cuenta[m]! ? i : m), 0);
  const pesoTotal = colores.reduce((s, c) => s + c.peso, 0) || 1;
  const parte = (100 * cuenta[k]!) / total;
  return parte >= PARTE_DOMINANTE && parte - (100 * colores[k]!.peso) / pesoTotal >= VENTAJA_DOMINANTE ? colores[k]!.nombre : undefined;
}
