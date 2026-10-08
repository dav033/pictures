import type { Vec3 } from "./modulos";

/**
 * **Zonas de una pieza orgánica**: dónde va un cambio de tamaños («los R-24 solo abajo», «más R-18 al inicio»). Una
 * zona se decide por el eje de la pieza: `inicio`, `medio` y `fin` son tercios del recorrido (de cada tramo);
 * `abajo` y `arriba`, el tercio de abajo y el de arriba de la altura que recorre el eje (en una pieza casi plana —el
 * eje sube menos de 40 cm— no hay arriba ni abajo: valen para toda ella). La usan el trazo orgánico al sacar su mezcla
 * en cada punto y la IA de escena para contar los globos de cada zona.
 */

export const ZONAS_ORGANICAS = ["todo", "abajo", "arriba", "inicio", "medio", "fin"] as const;
export type ZonaOrganica = (typeof ZONAS_ORGANICAS)[number];

/** En la zona, los formatos de `pesos` toman ese peso (sobre la mezcla de base normalizada a 1); 0 = ahí no va. */
export type ZonaMezcla = { zona: ZonaOrganica; pesos: Readonly<Record<string, number>> };

export type RangoAltura = { minY: number; maxY: number };

/** Por debajo de esto de recorrido en altura, la pieza es plana: abajo y arriba son toda ella. */
export const ALTURA_PLANA_CM = 40;

export const esPlana = (r: RangoAltura) => r.maxY - r.minY < ALTURA_PLANA_CM;

export function rangoAltura(puntos: readonly { y: number }[]): RangoAltura {
  const ys = puntos.map((p) => p.y);
  return ys.length ? { minY: Math.min(...ys), maxY: Math.max(...ys) } : { minY: 0, maxY: 0 };
}

/** ¿El punto del eje a la fracción `t` de su tramo y a la altura `y` está en la zona? */
export function enZona(zona: ZonaOrganica, t: number, y: number, rango: RangoAltura): boolean {
  const tercio = (rango.maxY - rango.minY) / 3;
  switch (zona) {
    case "todo": return true;
    case "inicio": return t <= 1 / 3;
    case "medio": return t >= 1 / 3 && t <= 2 / 3;
    case "fin": return t >= 2 / 3;
    case "abajo": return esPlana(rango) || y <= rango.minY + tercio;
    case "arriba": return esPlana(rango) || y >= rango.maxY - tercio;
  }
}

/** La mezcla normalizada (suma 1, solo pesos positivos). */
export function normalizarPesos(pesos: Readonly<Record<string, number>>): Record<string, number> {
  const positivos = Object.entries(pesos).filter(([, w]) => Number.isFinite(w) && w > 0);
  const total = positivos.reduce((s, [, w]) => s + w, 0);
  return total > 0 ? Object.fromEntries(positivos.map(([f, w]) => [f, w / total])) : {};
}

/** Los pesos en un punto: la base normalizada y, encima, los de cada zona que lo contiene (la última manda). */
export function pesosConZonas(base: Readonly<Record<string, number>>, zonas: readonly ZonaMezcla[] | undefined, t: number, y: number, rango: RangoAltura): Record<string, number> {
  const salida: Record<string, number> = normalizarPesos(base);
  for (const z of zonas ?? []) if (enZona(z.zona, t, y, rango)) Object.assign(salida, z.pesos);
  return salida;
}

/** El punto de una polilínea a la fracción `t` de su largo. */
export function puntoEnRecorrido(recorrido: readonly Vec3[], t: number): Vec3 {
  if (recorrido.length < 2) return recorrido[0] ?? { x: 0, y: 0, z: 0 };
  const largos = [0];
  for (let i = 1; i < recorrido.length; i++) largos.push(largos[i - 1]! + Math.hypot(recorrido[i]!.x - recorrido[i - 1]!.x, recorrido[i]!.y - recorrido[i - 1]!.y, recorrido[i]!.z - recorrido[i - 1]!.z));
  const meta = Math.min(1, Math.max(0, t)) * largos[largos.length - 1]!;
  for (let i = 1; i < recorrido.length; i++) {
    if (meta <= largos[i]!) {
      const a = recorrido[i - 1]!, b = recorrido[i]!, u = (meta - largos[i - 1]!) / (largos[i]! - largos[i - 1]! || 1);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
    }
  }
  return recorrido[recorrido.length - 1]!;
}

/** Fracción del largo de cada punto de una polilínea (0 el primero, 1 el último). */
export function fraccionesDe(puntos: readonly { x: number; y: number }[]): number[] {
  const largos = [0];
  for (let i = 1; i < puntos.length; i++) largos.push(largos[i - 1]! + Math.hypot(puntos[i]!.x - puntos[i - 1]!.x, puntos[i]!.y - puntos[i - 1]!.y));
  const total = largos[largos.length - 1]! || 1;
  return largos.map((l) => l / total);
}
