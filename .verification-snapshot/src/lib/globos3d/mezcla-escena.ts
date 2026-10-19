import type { Escena } from "./escena";
import { armarPieza, type Pieza } from "./piezas";
import { inventarioDe } from "./partes-globos";
import { ESCALONES, FORMATOS_DEL_ESCALON, escalonTres, type EscalonTres } from "./mezcla-lectura";

/**
 * **La mezcla de tamaños de lo orgánico de una escena** (globos por formato y por escalón grande / mediano / chico), para
 * medir si lo que se armó de una foto tiene los tamaños de la foto (`scripts/exp/evaluar-foto-a-escena.ts`) y para las
 * pruebas del compilador. Solo cuenta las piezas `organico` (guirnaldas, arcos y columnas orgánicas); lo demás (columnas
 * clásicas, racimos de decoración, foil) no tiene mezcla que comparar. Puro y sin red.
 */

export type Escalones = { grandes: number; medianos: number; chicos: number };

/** El escalón de cada formato por omisión (el de `mezcla-lectura.ts`, con los gigantes entre los grandes). */
const ESCALON_DE: Readonly<Record<string, EscalonTres>> = Object.fromEntries(ESCALONES.flatMap((e) => FORMATOS_DEL_ESCALON[e].map((f) => [f, escalonTres(e)])));

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

/**
 * Pesos o cuentas por formato → fracción de cada escalón (suman 1; todo 0 si no hay nada). `escalonDe` dice a qué escalón va
 * cada formato cuando la pieza lo nombra distinto (un R-9 que el lector llama mediano); por omisión, el de siempre.
 */
export function escalonesDe(porFormato: Readonly<Record<string, number>>, escalonDe: (formatoId: string) => EscalonTres | undefined = (f) => ESCALON_DE[f]): Escalones {
  const e: Escalones = { grandes: 0, medianos: 0, chicos: 0 };
  for (const [f, n] of Object.entries(porFormato)) { const k = escalonDe(f); if (k) e[k] += n; }
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
