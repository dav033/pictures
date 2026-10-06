import { HEX_COLORES_OBSERVABLES } from "@/lib/rag/taxonomy/v2";
import type { ParticipacionColor } from "@/lib/plan/dominancia-color";

/**
 * El orden de los colores de una pieza vertical, del PIE hacia arriba, medido en los píxeles de la foto (2026-10-06).
 *
 * El motor pone el primer color de `patron_color` en el pie de una columna o un semiarco, y el modelo lista los
 * colores unas veces desde el pie y otras desde la punta: CASE-002 tiene rosa arriba y plata abajo, y la imagen
 * salía con el rosa abajo. Pedirlo en el prompt (v19) mejoró el orden pero estropeó otros tipos y no se promovió
 * (anexo E). Aquí el orden lo deciden los píxeles: el color que más pesa en la franja de abajo de la caja frente
 * a la de arriba va primero. Solo se reordena con una señal clara; si no, manda lo que dijo el modelo.
 *
 * Cada color medido (paleta del catálogo, con la luz de la foto encima: un rosa bajo luz lila se mide «dorado
 * rosa») cuenta para el color del patrón más cercano en CIELAB, no por su nombre.
 */

/** Diferencia mínima de (abajo − arriba) entre el primer y el último color para fiarse del orden medido. */
export const SENAL_MINIMA_ORDEN = 0.15;
/** Lo que se aleja un color medido de todos los del patrón para no contar (ΔE76): otro color, fondo, muebles. */
const DELTA_E_MAXIMO = 40;

type Lab = readonly [number, number, number];

function hexALab(hex: string): Lab {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const lineal = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [lineal((n >> 16) & 255), lineal((n >> 8) & 255), lineal(n & 255)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const distancia = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Cuánto de la franja es cada color del patrón (índice), repartiendo cada color medido al más cercano. */
function repartoEnPatron(colores: readonly string[], franja: readonly ParticipacionColor[]): number[] {
  const labs = colores.map((color) => (HEX_COLORES_OBSERVABLES[color] ? hexALab(HEX_COLORES_OBSERVABLES[color]!) : null));
  const reparto = colores.map(() => 0);
  for (const medido of franja) {
    const hex = HEX_COLORES_OBSERVABLES[medido.color];
    if (!hex) continue;
    const lab = hexALab(hex);
    let mejor = -1;
    let mejorDistancia = DELTA_E_MAXIMO;
    labs.forEach((otro, indice) => {
      if (!otro) return;
      const d = distancia(lab, otro);
      if (d < mejorDistancia) { mejor = indice; mejorDistancia = d; }
    });
    if (mejor >= 0) reparto[mejor] = reparto[mejor]! + medido.participacion;
  }
  const total = reparto.reduce((suma, valor) => suma + valor, 0);
  return total > 0 ? reparto.map((valor) => valor / total) : reparto;
}

/** True when measured palette repeats with similar shares across the piece's vertical bands. */
export function mezclaVerticalMedida(colores: readonly string[], franjas: readonly (readonly ParticipacionColor[])[]): boolean {
  if (colores.length < 2 || franjas.length < 4) return false;
  const repartos = franjas.map((franja) => repartoEnPatron(colores, franja));
  const medias = colores.map((_color, indice) => repartos.reduce((suma, reparto) => suma + reparto[indice]!, 0) / repartos.length);
  const activos = medias.map((media, indice) => ({ media, indice })).filter(({ media }) => media >= 0.08);
  if (activos.length < 2) return false;
  return activos.every(({ media, indice }) => {
    const presencia = repartos.filter((reparto) => reparto[indice]! >= Math.max(0.04, media * 0.35)).length;
    const desviacion = repartos.reduce((suma, reparto) => suma + Math.abs(reparto[indice]! - media), 0) / repartos.length;
    return presencia >= Math.ceil(repartos.length * 0.7) && desviacion <= 0.18;
  });
}

/**
 * La permutación de `colores` del pie a la punta (índices en el orden nuevo), o `null` si los píxeles no dan una
 * señal clara o el orden ya es ese. `abajo` y `arriba` son las dominancias medidas en las dos franjas.
 */
export function ordenDesdeElPie(colores: readonly string[], abajo: readonly ParticipacionColor[], arriba: readonly ParticipacionColor[]): number[] | null {
  if (colores.length < 2) return null;
  const enAbajo = repartoEnPatron(colores, abajo);
  const enArriba = repartoEnPatron(colores, arriba);
  if (!enAbajo.some((v) => v > 0) || !enArriba.some((v) => v > 0)) return null;
  const inclinacion = colores.map((_color, indice) => enAbajo[indice]! - enArriba[indice]!);
  const orden = colores.map((_color, indice) => indice).sort((a, b) => inclinacion[b]! - inclinacion[a]! || a - b);
  if (inclinacion[orden[0]!]! - inclinacion[orden[orden.length - 1]!]! < SENAL_MINIMA_ORDEN) return null;
  return orden.every((indice, posicion) => indice === posicion) ? null : orden;
}
