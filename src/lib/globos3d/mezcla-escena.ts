import type { Escena } from "./escena";
import { armarPieza, type Pieza } from "./piezas";
import { inventarioDe } from "./partes-globos";

/**
 * **La mezcla de tamaños de lo orgánico de una escena** (globos por formato y por escalón grande / mediano / chico), para
 * medir si lo que se armó de una foto tiene los tamaños de la foto (`scripts/exp/evaluar-foto-a-escena.ts`) y para las
 * pruebas del compilador. Solo cuenta las piezas `organico` (guirnaldas, arcos y columnas orgánicas); lo demás (columnas
 * clásicas, racimos de decoración, foil) no tiene mezcla que comparar. Puro y sin red.
 */

export type Escalones = { grandes: number; medianos: number; chicos: number };

const ESCALON_DE: Readonly<Record<string, keyof Escalones>> = { "R-36": "grandes", "R-24": "grandes", "R-18": "grandes", "R-12": "medianos", "R-9": "chicos", "R-5": "chicos" };

/** Los globos de una pieza (una copia) por formato («R-24»: 12). */
export function globosPorFormatoDe(pieza: Pieza, cuenta: Record<string, number> = {}): Record<string, number> {
  for (const l of inventarioDe(armarPieza(pieza))) cuenta[l.formatoId] = (cuenta[l.formatoId] ?? 0) + l.cantidad;
  return cuenta;
}

/** Los globos de las piezas orgánicas de la escena por formato. */
export function globosOrganicosPorFormato(escena: Escena): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const nodo of escena.nodos) if (nodo.pieza.tipo === "organico") globosPorFormatoDe(nodo.pieza, cuenta);
  return cuenta;
}

/** Pesos o cuentas por formato → fracción de cada escalón (suman 1; todo 0 si no hay nada). */
export function escalonesDe(porFormato: Readonly<Record<string, number>>): Escalones {
  const e: Escalones = { grandes: 0, medianos: 0, chicos: 0 };
  for (const [f, n] of Object.entries(porFormato)) if (ESCALON_DE[f]) e[ESCALON_DE[f]!] += n;
  const total = e.grandes + e.medianos + e.chicos;
  if (total <= 0) return e;
  return { grandes: e.grandes / total, medianos: e.medianos / total, chicos: e.chicos / total };
}

/** Distancia entre dos repartos por escalón: 0 = iguales, 1 = nada en común (la mitad de la suma de diferencias). */
export function distanciaEscalones(a: Escalones, b: Escalones): number {
  return Math.round(((Math.abs(a.grandes - b.grandes) + Math.abs(a.medianos - b.medianos) + Math.abs(a.chicos - b.chicos)) / 2) * 1000) / 1000;
}

/** Distancia de variación total entre el reparto por formato de lo armado (globos por formato) y el leído (pesos): 0 = igual, 1 = nada en común. */
export function distanciaFormatos(armado: Readonly<Record<string, number>>, leido: Readonly<Record<string, number>>): number {
  const norm = (m: Readonly<Record<string, number>>) => { const t = Object.values(m).reduce((a, b) => a + b, 0); return (f: string) => (t > 0 ? (m[f] ?? 0) / t : 0); };
  const a = norm(armado), b = norm(leido);
  const formatos = new Set([...Object.keys(armado), ...Object.keys(leido)]);
  return Math.round([...formatos].reduce((s, f) => s + Math.abs(a(f) - b(f)), 0) / 2 * 1000) / 1000;
}
