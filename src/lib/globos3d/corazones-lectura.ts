import type { Colocacion } from "./escena";
import { codigoDeColor } from "./colores-lectura";
import { formatoPorId } from "./formatos";
import type { ColorLeido, PiezaLeida } from "./lectura-foto";
import type { Pieza } from "./piezas";

/**
 * **Los corazones de una foto** (`compilar-lectura.ts`, pieza «corazon»): globos de corazón de látex en un solo tamaño (C-12, 28 cm inflado) y de cualquier
 * color de la paleta; el catálogo no vende un corazón de látex más grande, así que uno grande de la foto sale de varios C-12 juntos (`cantidad`). Los `cantidad`
 * corazones se apilan en pirámide alrededor de (x, y): en el piso, la fila de abajo apoyada en él; en el aire, centrados en y. Cada color de la pieza lleva su
 * parte de los corazones, en proporción a su peso. Puro.
 */

export type CorazonLeido = Extract<PiezaLeida, { tipo: "corazon" }>;
export type NodoCorazon = { nombre: string; pieza: Pieza; colocacion: Colocacion };

export const FORMATO_CORAZON = "C-12";
/** Separación (cm) entre corazones vecinos de una fila y entre filas. */
const PASO_X_CM = 26;
const PASO_Y_CM = 23;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Cuántos corazones lleva cada color, en proporción a su peso (por restos mayores) y sumando `total`. */
export function repartoPorColor(colores: readonly Pick<ColorLeido, "peso">[], total: number): number[] {
  const suma = colores.reduce((s, c) => s + Math.max(0, c.peso), 0) || colores.length;
  const cuotas = colores.map((c) => ((suma === colores.length && !colores.some((x) => x.peso > 0) ? 1 : Math.max(0, c.peso)) / suma) * total);
  const enteros = cuotas.map(Math.floor);
  const faltan = total - enteros.reduce((s, n) => s + n, 0);
  cuotas.map((c, i) => ({ i, resto: c - Math.floor(c) })).sort((a, b) => b.resto - a.resto || a.i - b.i).slice(0, faltan).forEach(({ i }) => { enteros[i]!++; });
  return enteros;
}

/** Las posiciones (cm, relativas al centro y a la fila de abajo) de `n` corazones apilados en pirámide. */
export function pilaDeCorazones(n: number): Array<{ x: number; fila: number }> {
  const base = Math.max(1, Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2));
  const salida: Array<{ x: number; fila: number }> = [];
  for (let fila = 0, ancho = base; salida.length < n; fila++, ancho = Math.max(1, ancho - 1)) {
    for (let k = 0; k < ancho && salida.length < n; k++) salida.push({ x: (k - (ancho - 1) / 2) * PASO_X_CM, fila });
  }
  return salida;
}

/**
 * Los nodos de los corazones leídos; `centro` es el sitio (cm) del centro de la pila: x, alto del centro (sobre el piso) y z. La fila de abajo nunca queda
 * bajo el piso: en el piso, el grupo se asienta en él (o sobre lo que `y` dice que lo sostiene: un montón, una mesa); en el aire, queda a la altura de `y`.
 */
export function corazonesLeidos(p: CorazonLeido, centro: { xCm: number; yCm: number; zCm: number }, notas: string[]): NodoCorazon[] {
  const formato = formatoPorId(FORMATO_CORAZON)!;
  const codigos = p.colores.map((c) => codigoDeColor(c, ["R-12"], notas));
  const coloreados = repartoPorColor(p.colores, p.cantidad).flatMap((n, k) => Array.from({ length: n }, () => codigos[k]!));
  const pila = pilaDeCorazones(p.cantidad);
  const filas = Math.max(...pila.map((q) => q.fila)) + 1;
  const radio = formato.infladoDecoracionCm / 2;
  const base = Math.max(radio, centro.yCm - ((filas - 1) * PASO_Y_CM) / 2);
  return pila.map((q, i) => ({
    nombre: p.cantidad > 1 ? `Corazón ${i + 1}` : "Corazón",
    pieza: { tipo: "globo", formatoId: formato.id, infladoCm: formato.infladoDecoracionCm, codigo: coloreados[i]! },
    colocacion: { en: "libre", xCm: r1(centro.xCm + q.x), yCm: r1(base + q.fila * PASO_Y_CM), zCm: centro.zCm, giroGrados: 0 },
  }));
}
