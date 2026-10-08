import type { TuboDecoracion } from "./decoraciones";
import type { ElementoEscenografia, MotivoEscenografia, ProductoDePieza } from "./escenografia";
import { contornoCorazon } from "./geometria";
import type { Vec3 } from "./modulos";
import type { Punto2 } from "./trenza";

/**
 * **Globos metalizados (foil)**: planos, de papel metalizado, con su contorno (número, letra, corazón, estrella,
 * redondo, flor, luna, nube) y el borde sellado. No son látex ni se cotizan por color Sempertex: son un producto de la
 * tienda («GLOBO METALIZADO NUMERO 2 DORADO MATE»). Se arman como un panel de escenografía de acabado `foil` (espejo)
 * o `foil_mate` (satinado): el visor lo infla como una almohada con arrugas suaves cerca del borde.
 *
 * **El contorno** sale de un campo de distancias: cada número y letra es un trazo grueso de puntas redondas (como la
 * letra de los foil, «bubble»), las figuras son polígonos o uniones de círculos. Se recorre el borde del campo con
 * cuadrados que marchan (marching squares) y se simplifica: queda un contorno (antihorario) y sus huecos (el ojo del
 * 0, del 4, del 6, de la A…, en sentido horario), en cm, con la base en y = 0 y centrado en x.
 * Todo determinista: el mismo metalizado da siempre el mismo contorno.
 */

export type FormaMetalizado =
  | { tipo: "numero"; valor: number }
  | { tipo: "letra"; valor: string }
  /** Varias letras seguidas, cada una su globo (el «HBD» de la tienda). */
  | { tipo: "letras"; texto: string }
  | { tipo: "corazon" | "estrella" | "redondo" | "luna" | "flor" | "nube" };

export type TipoFormaMetalizado = FormaMetalizado["tipo"];

/** Colores de foil de la tienda Sempertex (y los de siempre): su tono y si es espejo o satinado (mate). */
export const COLORES_METALIZADO = {
  oro: { nombre: "Oro", hex: "#e2b64c", mate: false },
  plata: { nombre: "Plata", hex: "#d6d9de", mate: false },
  rosa_oro: { nombre: "Rosa oro", hex: "#e9b2a2", mate: false },
  rojo: { nombre: "Rojo", hex: "#d0172f", mate: false },
  azul: { nombre: "Azul", hex: "#8cc4ec", mate: false },
  azul_rey: { nombre: "Azul rey", hex: "#2a62c9", mate: false },
  rosado: { nombre: "Rosado", hex: "#e48ec8", mate: false },
  fucsia: { nombre: "Fucsia", hex: "#e3388f", mate: false },
  verde_vibrante: { nombre: "Verde vibrante", hex: "#7ccf2e", mate: false },
  rosada_vibrante: { nombre: "Rosada vibrante", hex: "#e81f86", mate: false },
  azul_vibrante: { nombre: "Azul vibrante", hex: "#1c8ee0", mate: false },
  dorado_mate: { nombre: "Dorado mate", hex: "#dcb04e", mate: true },
  negro_mate: { nombre: "Negro mate", hex: "#202022", mate: true },
  latte: { nombre: "Latte", hex: "#dcb99b", mate: true },
  arena: { nombre: "Arena", hex: "#e6dccb", mate: true },
  azul_pastel: { nombre: "Azul pastel", hex: "#9fb4c4", mate: true },
  rosado_satin: { nombre: "Rosado satinado", hex: "#d8a5ad", mate: true },
  blanco: { nombre: "Blanco", hex: "#f2f2f0", mate: true },
} as const satisfies Record<string, { nombre: string; hex: string; mate: boolean }>;

export type ColorMetalizado = keyof typeof COLORES_METALIZADO;

/** Tamaños de la tienda (pulgadas): 16" (letras, corazones pequeños), 18" (corazón, estrella, redondo), 27" (flor), 32"/34"/40" (números). */
export const PULGADAS_METALIZADO = [16, 18, 27, 32, 34, 40] as const;

/**
 * Un metalizado: forma, tamaño, color y, si trae algo impreso, el texto o motivo (la calcomanía del panel). Con
 * `cinta` flota con helio: su base queda `largoCm` por encima del peso (el origen) y la cinta baja hasta él.
 */
export type OpcionesMetalizado = {
  forma: FormaMetalizado;
  pulgadas: number;
  color: ColorMetalizado;
  impreso?: MotivoEscenografia | null;
  cinta?: { largoCm: number; hex: string } | null;
  /** El producto de la tienda (url relativa /products/…), si es uno del catálogo. */
  producto?: { nombre: string; url: string } | null;
  /** Acostado (mirando arriba) en vez de parado de frente; por defecto, parado. */
  acostado?: boolean;
};

const PULGADA_CM = 2.54;
/** Media del ancho del trazo de los números y letras, sobre el alto. */
const TRAZO = 0.115;

// ----------------------------------------------------------------------------------------------------------
// Trazos de números y letras (esqueleto en una caja de alto 1, y hacia arriba)
// ----------------------------------------------------------------------------------------------------------

type P = readonly [number, number];
type Trazo = { puntos: P[]; cerrado?: boolean };

/** Arco de elipse de `a0` a `a1` grados (sentido según el signo). */
function arco(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 18): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const;
  });
}
/** Superelipse cerrada (el 0 de los foil: un óvalo cuadradito). */
function ovalo(cx: number, cy: number, rx: number, ry: number, k = 3, n = 40): P[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    return [cx + rx * Math.sign(c) * Math.abs(c) ** (2 / k), cy + ry * Math.sign(s) * Math.abs(s) ** (2 / k)] as const;
  });
}
const linea = (...p: P[]): Trazo => ({ puntos: p });
const curva = (p: P[]): Trazo => ({ puntos: p });
const cerrada = (p: P[]): Trazo => ({ puntos: p, cerrado: true });
const girar180 = (t: Trazo[], cx: number, cy: number): Trazo[] => t.map((x) => ({ ...x, puntos: x.puntos.map(([a, b]) => [2 * cx - a, 2 * cy - b] as const) }));

const B = 0.13, T = 0.87;

const SEIS: Trazo[] = [cerrada(ovalo(0.26, 0.32, 0.18, 0.2, 2.4)), curva([[0.08, 0.32], [0.09, 0.5], [0.14, 0.67], [0.24, 0.8], [0.4, 0.87]])];
const ESE: Trazo[] = [curva([...arco(0.27, 0.68, 0.17, 0.19, 15, 270, 16), ...arco(0.25, 0.31, 0.19, 0.18, 90, -160, 16)])];
const PE: Trazo[] = [linea([0.1, B], [0.1, T], [0.26, T]), curva(arco(0.26, 0.68, 0.18, 0.19, 90, -90)), linea([0.26, 0.49], [0.1, 0.49])];
const O: Trazo[] = [cerrada(ovalo(0.29, 0.5, 0.21, 0.37, 2.2))];

const GLIFOS: Readonly<Record<string, Trazo[]>> = {
  "0": [cerrada(ovalo(0.25, 0.5, 0.19, 0.37, 3))],
  "1": [linea([0.08, 0.7], [0.24, T], [0.24, B])],
  "2": [curva(arco(0.25, 0.65, 0.17, 0.22, 165, -35)), linea([0.39, 0.52], [0.08, B], [0.44, B])],
  "3": [curva([...arco(0.24, 0.68, 0.16, 0.19, 150, -90, 14), ...arco(0.24, 0.31, 0.19, 0.18, 90, -150, 14)])],
  "4": [linea([0.36, B], [0.36, T], [0.06, 0.37], [0.47, 0.37])],
  "5": [linea([0.42, T], [0.12, T], [0.1, 0.56]), curva(arco(0.25, 0.33, 0.18, 0.21, 125, -150))],
  "6": SEIS,
  "7": [linea([0.06, T], [0.44, T], [0.18, B])],
  "8": [cerrada(ovalo(0.25, 0.68, 0.15, 0.18, 2.2)), cerrada(ovalo(0.25, 0.31, 0.18, 0.19, 2.2))],
  "9": girar180(SEIS, 0.25, 0.5),
  A: [linea([0.05, B], [0.27, T], [0.49, B]), linea([0.14, 0.38], [0.4, 0.38])],
  B: [linea([0.1, B], [0.1, T], [0.27, T]), curva(arco(0.27, 0.69, 0.16, 0.18, 90, -90)), linea([0.27, 0.51], [0.1, 0.51], [0.3, 0.51]), curva(arco(0.3, 0.32, 0.18, 0.19, 90, -90)), linea([0.3, B], [0.1, B])],
  C: [curva(arco(0.31, 0.5, 0.23, 0.37, 50, 310, 24))],
  D: [linea([0.1, B], [0.1, T], [0.22, T]), curva(arco(0.22, 0.5, 0.24, 0.37, 90, -90, 22)), linea([0.22, B], [0.1, B])],
  E: [linea([0.42, T], [0.1, T], [0.1, B], [0.42, B]), linea([0.1, 0.5], [0.36, 0.5])],
  F: [linea([0.42, T], [0.1, T], [0.1, B]), linea([0.1, 0.5], [0.36, 0.5])],
  G: [curva(arco(0.31, 0.5, 0.23, 0.37, 50, 360, 24)), linea([0.54, 0.5], [0.36, 0.5])],
  H: [linea([0.1, B], [0.1, T]), linea([0.44, B], [0.44, T]), linea([0.1, 0.5], [0.44, 0.5])],
  I: [linea([0.12, B], [0.12, T])],
  J: [linea([0.38, T], [0.38, 0.33]), curva(arco(0.23, 0.33, 0.15, 0.2, 0, -180))],
  K: [linea([0.1, B], [0.1, T]), linea([0.44, T], [0.12, 0.48], [0.46, B])],
  L: [linea([0.1, T], [0.1, B], [0.42, B])],
  M: [linea([0.08, B], [0.1, T], [0.31, 0.38], [0.52, T], [0.54, B])],
  N: [linea([0.1, B], [0.1, T], [0.44, B], [0.44, T])],
  O,
  P: PE,
  Q: [...O, linea([0.34, 0.3], [0.54, 0.08])],
  R: [...PE, linea([0.24, 0.49], [0.46, B])],
  S: ESE,
  T: [linea([0.06, T], [0.48, T]), linea([0.27, T], [0.27, B])],
  U: [linea([0.1, T], [0.1, 0.34]), curva(arco(0.27, 0.34, 0.17, 0.21, 180, 360)), linea([0.44, 0.34], [0.44, T])],
  V: [linea([0.06, T], [0.27, B], [0.48, T])],
  W: [linea([0.04, T], [0.17, B], [0.3, 0.62], [0.43, B], [0.56, T])],
  X: [linea([0.08, T], [0.46, B]), linea([0.46, T], [0.08, B])],
  Y: [linea([0.06, T], [0.27, 0.5], [0.48, T]), linea([0.27, 0.5], [0.27, B])],
  Z: [linea([0.08, T], [0.46, T], [0.08, B], [0.46, B])],
};

/** Los caracteres que sabe dibujar (0–9 y A–Z). */
export const CARACTERES_METALIZADO: readonly string[] = Object.keys(GLIFOS);

// ----------------------------------------------------------------------------------------------------------
// Campos de distancia (dentro > 0)
// ----------------------------------------------------------------------------------------------------------

type Campo = (x: number, y: number) => number;

function distSegmento(x: number, y: number, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

function campoTrazos(trazos: readonly Trazo[], r: number): Campo {
  const tramos: Array<[P, P]> = [];
  for (const t of trazos) {
    for (let i = 1; i < t.puntos.length; i++) tramos.push([t.puntos[i - 1]!, t.puntos[i]!]);
    if (t.cerrado && t.puntos.length > 2) tramos.push([t.puntos[t.puntos.length - 1]!, t.puntos[0]!]);
  }
  return (x, y) => {
    let d = Infinity;
    for (const [a, b] of tramos) d = Math.min(d, distSegmento(x, y, a, b));
    return r - d;
  };
}

function dentroPoligono(x: number, y: number, poli: readonly P[]): boolean {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [xi, yi] = poli[i]!, [xj, yj] = poli[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function campoPoligono(poli: readonly P[]): Campo {
  return (x, y) => {
    let d = Infinity;
    for (let i = 0; i < poli.length; i++) d = Math.min(d, distSegmento(x, y, poli[i]!, poli[(i + 1) % poli.length]!));
    return dentroPoligono(x, y, poli) ? d : -d;
  };
}

const circulo = (cx: number, cy: number, r: number): Campo => (x, y) => r - Math.hypot(x - cx, y - cy);
const union = (...c: Campo[]): Campo => (x, y) => Math.max(...c.map((f) => f(x, y)));
const menos = (a: Campo, b: Campo): Campo => (x, y) => Math.min(a(x, y), -b(x, y));
const engordar = (c: Campo, r: number): Campo => (x, y) => c(x, y) + r;

/** El campo de cada forma, en una caja de alto ~1 (y hacia arriba), y su ancho aproximado. */
function campoDe(forma: Exclude<FormaMetalizado, { tipo: "letras" }>): { campo: Campo; ancho: number } {
  switch (forma.tipo) {
    case "numero":
    case "letra": {
      const c = forma.tipo === "numero" ? String(Math.max(0, Math.min(9, Math.round(forma.valor)))) : forma.valor.toUpperCase().slice(0, 1);
      const trazos = GLIFOS[c] ?? GLIFOS["O"]!;
      const xs = trazos.flatMap((t) => t.puntos.map((p) => p[0]));
      return { campo: campoTrazos(trazos, TRAZO), ancho: Math.max(...xs) - Math.min(...xs) + 2 * TRAZO };
    }
    case "corazon": {
      const poli = contornoCorazon(1).map((p) => [p.x, p.y + 0.06] as const);
      // Un foil de corazón es más lleno arriba que la curva clásica: se engorda un poco (redondea la punta y el valle).
      return { campo: engordar(campoPoligono(poli), 0.035), ancho: 1.07 };
    }
    case "estrella": {
      const poli: P[] = Array.from({ length: 10 }, (_, i) => {
        const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.2 : 0.43;
        return [r * Math.cos(a), r * Math.sin(a) - 0.03] as const;
      });
      // Puntas redondeadas: la estrella un poco más chica, engordada.
      return { campo: engordar(campoPoligono(poli), 0.06), ancho: 0.98 };
    }
    case "redondo": return { campo: circulo(0, 0, 0.5), ancho: 1 };
    case "luna": return { campo: menos(circulo(0, 0, 0.5), circulo(0.22, 0.12, 0.42)), ancho: 0.8 };
    case "flor": {
      const petalos = Array.from({ length: 5 }, (_, i) => {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
        return circulo(0.27 * Math.cos(a), 0.27 * Math.sin(a), 0.235);
      });
      return { campo: union(circulo(0, 0, 0.25), ...petalos), ancho: 1.02 };
    }
    case "nube": return { campo: union(circulo(-0.28, -0.08, 0.24), circulo(0, 0.08, 0.32), circulo(0.3, -0.06, 0.25), circulo(0, -0.15, 0.22)), ancho: 1.1 };
  }
}

// ----------------------------------------------------------------------------------------------------------
// Cuadrados que marchan: del campo a contornos cerrados
// ----------------------------------------------------------------------------------------------------------

function simplificar(puntos: readonly P[], tolerancia: number): P[] {
  if (puntos.length < 4) return [...puntos];
  const marcar = new Uint8Array(puntos.length);
  marcar[0] = 1; marcar[puntos.length - 1] = 1;
  const pila: Array<[number, number]> = [[0, puntos.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop()!;
    let peor = -1, dmax = 0;
    for (let k = i + 1; k < j; k++) { const d = distSegmento(puntos[k]![0], puntos[k]![1], puntos[i]!, puntos[j]!); if (d > dmax) { dmax = d; peor = k; } }
    if (peor >= 0 && dmax > tolerancia) { marcar[peor] = 1; pila.push([i, peor], [peor, j]); }
  }
  return puntos.filter((_, k) => marcar[k]);
}

function area(p: readonly P[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Los bordes (curvas de nivel 0) del campo en la caja dada, con paso `h`: lazos cerrados sin repetir el primero. */
function bordes(campo: Campo, caja: { x0: number; y0: number; x1: number; y1: number }, h: number): P[][] {
  const nx = Math.ceil((caja.x1 - caja.x0) / h) + 1, ny = Math.ceil((caja.y1 - caja.y0) / h) + 1;
  const f = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = campo(caja.x0 + i * h, caja.y0 + j * h);
    // Nunca exactamente 0 (así cada esquina está dentro o fuera).
    f[j * nx + i] = Math.abs(v) < 1e-9 ? -1e-9 : v;
  }
  const valor = (i: number, j: number) => f[j * nx + i]!;
  const puntoArista = new Map<string, P>();
  const arista = (tipo: "h" | "v", i: number, j: number): string => {
    const clave = `${tipo}${i},${j}`;
    if (!puntoArista.has(clave)) {
      const [a, b] = tipo === "h" ? [valor(i, j), valor(i + 1, j)] : [valor(i, j), valor(i, j + 1)];
      const t = a / (a - b);
      puntoArista.set(clave, tipo === "h" ? [caja.x0 + (i + t) * h, caja.y0 + j * h] : [caja.x0 + i * h, caja.y0 + (j + t) * h]);
    }
    return clave;
  };
  const vecinos = new Map<string, string[]>();
  const unir = (a: string, b: string) => {
    (vecinos.get(a) ?? vecinos.set(a, []).get(a)!).push(b);
    (vecinos.get(b) ?? vecinos.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const d0 = valor(i, j) > 0, d1 = valor(i + 1, j) > 0, d2 = valor(i + 1, j + 1) > 0, d3 = valor(i, j + 1) > 0;
    const e: Array<string | null> = [
      d0 !== d1 ? arista("h", i, j) : null, d1 !== d2 ? arista("v", i + 1, j) : null,
      d3 !== d2 ? arista("h", i, j + 1) : null, d0 !== d3 ? arista("v", i, j) : null,
    ];
    const cortes = e.filter((x): x is string => x !== null);
    if (cortes.length === 2) unir(cortes[0]!, cortes[1]!);
    else if (cortes.length === 4) {
      // Silla: decide el centro de la celda.
      const centro = (valor(i, j) + valor(i + 1, j) + valor(i + 1, j + 1) + valor(i, j + 1)) / 4 > 0;
      const [e0, e1, e2, e3] = e as [string, string, string, string];
      if (d0 === centro) { unir(e0, e1); unir(e2, e3); } else { unir(e3, e0); unir(e1, e2); }
    }
  }
  const lazos: P[][] = [];
  const visto = new Set<string>();
  for (const inicio of vecinos.keys()) {
    if (visto.has(inicio)) continue;
    const lazo: P[] = [];
    let previo: string | null = null, actual: string | null = inicio;
    while (actual && !visto.has(actual)) {
      visto.add(actual);
      lazo.push(puntoArista.get(actual)!);
      const siguientes: string[] = (vecinos.get(actual) ?? []).filter((v) => v !== previo && !visto.has(v));
      previo = actual;
      actual = siguientes[0] ?? null;
    }
    if (lazo.length >= 3) lazos.push(lazo);
  }
  return lazos;
}

export type ContornoMetalizado = { contorno: Punto2[]; huecos: Punto2[][]; anchoCm: number; altoCm: number };

const cacheContornos = new Map<string, ContornoMetalizado>();

/** Alto del metalizado (cm) según su forma y tamaño: los números y letras miden su tamaño de alto; las figuras, de ancho. */
export function altoMetalizadoCm(forma: FormaMetalizado, pulgadas: number): number {
  const cm = pulgadas * PULGADA_CM;
  if (forma.tipo === "numero" || forma.tipo === "letra" || forma.tipo === "letras") return Math.round(cm);
  if (forma.tipo === "flor") return Math.round(cm * 0.95);
  return Math.round(cm * 0.92);
}

/**
 * El contorno de un metalizado de una sola pieza (número, letra o figura) a `altoCm` de alto: contorno exterior
 * (antihorario) y huecos (horario), en cm, base en y = 0 y centrado en x.
 */
export function contornoMetalizado(forma: Exclude<FormaMetalizado, { tipo: "letras" }>, altoCm: number): ContornoMetalizado {
  const clave = `${JSON.stringify(forma)}|${altoCm}`;
  const guardado = cacheContornos.get(clave);
  if (guardado) return guardado;
  const { campo } = campoDe(forma);
  const caja = { x0: -0.7, y0: -0.7, x1: 1.4, y1: 1.4 };
  const lazos = bordes(campo, caja, 1 / 110).map((l) => simplificar([...l, l[0]!], 0.0022).slice(0, -1)).filter((l) => l.length >= 3);
  if (!lazos.length) throw new Error(`Metalizado sin contorno: ${clave}`);
  // Exterior: el de mayor área; huecos: los que quedan dentro de él.
  const porArea = [...lazos].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const exterior = porArea[0]!;
  const huecos = porArea.slice(1).filter((l) => dentroPoligono(l[0]![0], l[0]![1], exterior));
  const xs = exterior.map((p) => p[0]), ys = exterior.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const escala = altoCm / (maxY - minY);
  const cx = (minX + maxX) / 2;
  const aCm = (l: P[], antihorario: boolean): Punto2[] => {
    const orientado = (area(l) > 0) === antihorario ? l : [...l].reverse();
    return orientado.map(([x, y]) => ({ x: Math.round((x - cx) * escala * 100) / 100, y: Math.round((y - minY) * escala * 100) / 100 }));
  };
  const salida: ContornoMetalizado = {
    contorno: aCm(exterior, true), huecos: huecos.map((h) => aCm(h, false)),
    anchoCm: Math.round((maxX - minX) * escala * 10) / 10, altoCm,
  };
  cacheContornos.set(clave, salida);
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Armado: paneles de foil (escenografía), cinta y producto
// ----------------------------------------------------------------------------------------------------------

export type MetalizadoArmado = { elementos: ElementoEscenografia[]; tubos: TuboDecoracion[]; productos: ProductoDePieza[]; altoCm: number; anchoCm: number };

/** Grosor inflado (cm): las figuras ~22 % de su ancho; los números y letras, un poco más que medio trazo. */
function grosorCm(forma: FormaMetalizado, alto: number, ancho: number): number {
  if (forma.tipo === "numero" || forma.tipo === "letra" || forma.tipo === "letras") return Math.round(alto * TRAZO * 2 * 0.55 * 10) / 10;
  return Math.round(Math.min(alto, ancho) * 0.22 * 10) / 10;
}

function letrasDe(forma: FormaMetalizado): Array<Exclude<FormaMetalizado, { tipo: "letras" }>> {
  if (forma.tipo !== "letras") return [forma];
  return [...forma.texto.toUpperCase()].filter((c) => GLIFOS[c]).map((c) => (/[0-9]/.test(c) ? { tipo: "numero", valor: Number(c) } : { tipo: "letra", valor: c }));
}

/**
 * Arma un metalizado en su espacio (cm, y arriba, +z al frente): uno o varios paneles de foil parados de frente,
 * centrados en x y con la base en y = 0 (o a `cinta.largoCm`, flotando, con la cinta de papel hasta el origen).
 */
export function armarMetalizado(m: OpcionesMetalizado): MetalizadoArmado {
  const color = COLORES_METALIZADO[m.color];
  const alto = altoMetalizadoCm(m.forma, m.pulgadas);
  const piezas = letrasDe(m.forma).map((f) => ({ forma: f, contorno: contornoMetalizado(f, alto) }));
  if (!piezas.length) throw new Error(`Metalizado sin letras dibujables: ${JSON.stringify(m.forma)}`);
  const separacion = alto * 0.04;
  const anchoTotal = piezas.reduce((s, p) => s + p.contorno.anchoCm, 0) + separacion * (piezas.length - 1);
  const base = m.cinta ? m.cinta.largoCm : 0;
  const grosor = grosorCm(m.forma, alto, piezas[0]!.contorno.anchoCm);
  const elementos: ElementoEscenografia[] = [];
  let x = -anchoTotal / 2;
  for (const p of piezas) {
    const dx = x + p.contorno.anchoCm / 2;
    const mover = (q: Punto2): Punto2 => ({ x: Math.round((q.x + dx) * 100) / 100, y: Math.round((q.y + base) * 100) / 100 });
    elementos.push({
      forma: "panel", contorno: p.contorno.contorno.map(mover), huecos: p.contorno.huecos.map((h) => h.map(mover)),
      zCm: -grosor / 2, grosorCm: grosor, hex: color.hex, acabado: color.mate ? "foil_mate" : "foil",
      ...(m.impreso && piezas.length === 1 ? { motivo: { ...m.impreso } } : {}),
    });
    // La flor de foil lleva el centro de otro color (dorado): un disco de foil un poco por delante.
    if (p.forma.tipo === "flor") {
      const r = alto * 0.13, cy = base + alto / 2;
      const disco = Array.from({ length: 28 }, (_, i): Punto2 => ({ x: Math.round((dx + r * Math.cos((i / 28) * Math.PI * 2)) * 100) / 100, y: Math.round((cy + r * Math.sin((i / 28) * Math.PI * 2)) * 100) / 100 }));
      elementos.push({ forma: "panel", contorno: disco, huecos: [], zCm: grosor * 0.15, grosorCm: grosor * 0.5, hex: COLORES_METALIZADO.oro.hex, acabado: "foil" });
    }
    x += p.contorno.anchoCm + separacion;
  }
  const tubos: TuboDecoracion[] = [];
  if (m.cinta) {
    const arriba: Vec3 = { x: 0, y: base + 1, z: 0 };
    const puntos: Vec3[] = Array.from({ length: 9 }, (_, k) => {
      const t = k / 8;
      return { x: Math.round(2 * Math.sin(t * Math.PI * 3) * (1 - t) * 100) / 100, y: Math.round(arriba.y * (1 - t) * 100) / 100, z: 0 };
    });
    tubos.push({ formatoId: "papel", grosorCm: 0.35, codigo: "papel", puntos, cerrado: false, papel: { hex: m.cinta.hex } });
  }
  const productos: ProductoDePieza[] = m.producto ? [{ nombre: m.producto.nombre, url: m.producto.url, cantidad: 1 }] : [];
  if (m.acostado) {
    // Acostado: girado para mirar arriba (+y): (x, y, z) → (x, −z, y).
    for (const e of elementos) if (e.forma === "panel") e.en = { origen: { x: 0, y: 0, z: 0 }, ejeX: { x: 1, y: 0, z: 0 }, ejeY: { x: 0, y: 0, z: -1 } };
  }
  return { elementos, tubos, productos, altoCm: alto + base, anchoCm: Math.round(anchoTotal * 10) / 10 };
}

/** Nombre corto del metalizado: «Número 2 dorado mate 32"». */
export function nombreMetalizado(m: OpcionesMetalizado): string {
  const f = m.forma;
  const que = f.tipo === "numero" ? `Número ${f.valor}` : f.tipo === "letra" ? `Letra ${f.valor.toUpperCase()}` : f.tipo === "letras" ? `Letras «${f.texto.toUpperCase()}»`
    : { corazon: "Corazón", estrella: "Estrella", redondo: "Redondo", luna: "Luna", flor: "Flor", nube: "Nube" }[f.tipo];
  return `${que} ${COLORES_METALIZADO[m.color].nombre.toLowerCase()} ${m.pulgadas}"`;
}

/** En inglés y corto (para la foto con IA). */
export function metalizadoEnIngles(m: OpcionesMetalizado): string {
  const f = m.forma;
  const que = f.tipo === "numero" ? `number ${f.valor}` : f.tipo === "letra" ? `letter ${f.valor.toUpperCase()}` : f.tipo === "letras" ? `letters "${f.texto.toUpperCase()}"` : f.tipo === "redondo" ? "round" : f.tipo === "corazon" ? "heart" : f.tipo === "estrella" ? "star" : f.tipo === "luna" ? "moon" : f.tipo === "flor" ? "flower" : "cloud";
  const color = m.color.replace(/_/g, " ").replace("oro", "gold").replace("plata", "silver").replace("rojo", "red").replace("azul", "blue").replace("rosado", "pink").replace("negro mate", "matte black").replace("dorado mate", "matte gold");
  return `a ${m.pulgadas}-inch ${color} foil ${que} balloon${m.impreso?.texto ? ` printed "${m.impreso.texto}"` : ""}`;
}

// ----------------------------------------------------------------------------------------------------------
// Los metalizados de la tienda que usan las ideas
// ----------------------------------------------------------------------------------------------------------

/**
 * Un metalizado de la tienda Sempertex (los 39 «metalizado» de `productos.json` del barrido de las Ideas de fiesta):
 * nombre y url exactos, tallas que vende (pulgadas, de las opciones del producto en el listado público de la tienda,
 * 2026-10-07), en cuántas ideas aparece y cómo se arma (`metalizado`, en la talla más usada). Dos «metalizados» no
 * son globos (un plato y una cortina): van con `metalizado: null` y su nota.
 */
export type MetalizadoCatalogo = {
  id: string;
  nombre: string;
  url: string;
  tallas: readonly number[];
  ideas: number;
  metalizado: OpcionesMetalizado | null;
  /** Unidades por paquete, si no es 1. */
  unidades?: number;
  nota?: string;
};

// <datos> (generado: no editar a mano entre estas marcas)
export const METALIZADOS_TIENDA: readonly MetalizadoCatalogo[] = [
  { id: "corazon-te-amo-rosado", nombre: "GLOBO METALIZADO CORAZON TE AMO ROSADO", url: "/products/globo-metalizado-corazon-te-amo-rosado", tallas: [16], ideas: 3, metalizado: { forma: { tipo: "corazon" }, pulgadas: 16, color: "rosa_oro", impreso: { dibujo: "texto", texto: "Te\nAmo", hex: "#1b1b1f" } } },
  { id: "love-1", nombre: "GLOBO METALIZADO LOVE", url: "/products/globo-metalizado-love-1", tallas: [18], ideas: 3, metalizado: { forma: { tipo: "redondo" }, pulgadas: 18, color: "plata", impreso: { dibujo: "texto", texto: "LOVE", hex: "#d42032" } }, nota: "Redondo con «LOVE» rojo y garabatos rosados (aquí solo el letrero)." },
  { id: "globo-met-18-c-zon-feliz-dia-mama-x-1", nombre: "GLOBO METALIZADO CORAZON FELIZ DIA MAMA", url: "/products/globo-met-18-c-zon-feliz-dia-mama-x-1", tallas: [18], ideas: 2, metalizado: { forma: { tipo: "corazon" }, pulgadas: 18, color: "fucsia", impreso: { dibujo: "texto", texto: "Feliz Día\nMamá", hex: "#ffffff" } } },
  { id: "estrella-plata-1", nombre: "GLOBO METALIZADO ESTRELLA PLATA", url: "/products/globo-metalizado-estrella-plata-1", tallas: [18], ideas: 2, metalizado: { forma: { tipo: "estrella" }, pulgadas: 18, color: "plata" } },
  { id: "numero-0-negro", nombre: "GLOBO METALIZADO NUMERO 0 NEGRO MATE", url: "/products/globo-metalizado-numero-0-negro", tallas: [16, 32], ideas: 2, metalizado: { forma: { tipo: "numero", valor: 0 }, pulgadas: 32, color: "negro_mate" } },
  { id: "numero-2-negro", nombre: "GLOBO METALIZADO NUMERO 2 NEGRO MATE", url: "/products/globo-metalizado-numero-2-negro", tallas: [16, 32], ideas: 2, metalizado: { forma: { tipo: "numero", valor: 2 }, pulgadas: 32, color: "negro_mate" } },
  { id: "numero-5-negro", nombre: "GLOBO METALIZADO NUMERO 5 NEGRO MATE", url: "/products/globo-metalizado-numero-5-negro", tallas: [16, 32], ideas: 2, metalizado: { forma: { tipo: "numero", valor: 5 }, pulgadas: 32, color: "negro_mate" } },
  { id: "flor-rosada", nombre: "GLOBO METALIZADO FLOR ROSADA", url: "/products/globo-metalizado-flor-rosada", tallas: [27], ideas: 2, metalizado: { forma: { tipo: "flor" }, pulgadas: 27, color: "rosado_satin" }, nota: "Flor de 5 pétalos rosados con el centro dorado." },
  { id: "acuarela", nombre: "GLOBO METALIZADO FELIZ CUMPLEAÑOS ACUARELA", url: "/products/globo-metalizado-acuarela", tallas: [18], ideas: 2, metalizado: { forma: { tipo: "redondo" }, pulgadas: 18, color: "blanco", impreso: { dibujo: "texto", texto: "FELIZ\nCumpleaños", hex: "#d6457f" } }, nota: "Fondo de acuarela rosa y lila: aquí blanco con el letrero rosado." },
  { id: "numero-0-latte", nombre: "GLOBO METALIZADO NUMERO 0 LATTE", url: "/products/globo-metalizado-numero-0-latte", tallas: [16, 32], ideas: 2, metalizado: { forma: { tipo: "numero", valor: 0 }, pulgadas: 32, color: "latte" } },
  { id: "numero-4-latte", nombre: "GLOBO METALIZADO NUMERO 4 LATTE", url: "/products/globo-metalizado-numero-4-latte", tallas: [16, 32], ideas: 2, metalizado: { forma: { tipo: "numero", valor: 4 }, pulgadas: 32, color: "latte" } },
  { id: "estrella-azul-1", nombre: "GLOBO METALIZADO ESTRELLA AZUL", url: "/products/globo-metalizado-estrella-azul-1", tallas: [18], ideas: 2, metalizado: { forma: { tipo: "estrella" }, pulgadas: 18, color: "azul" } },
  { id: "boy-and-girl", nombre: "GLOBO METALIZADO BOY AND GIRL", url: "/products/globo-metalizado-boy-and-girl", tallas: [18], ideas: 2, metalizado: { forma: { tipo: "redondo" }, pulgadas: 18, color: "plata", impreso: { dibujo: "texto", texto: "Girl or Boy?", hex: "#3b6fb6" } }, nota: "Revelación de género: «Girl or Boy» con un «?» grande (aquí solo el letrero)." },
  { id: "estrella-dorado-mate", nombre: "GLOBO METALIZADO ESTRELLA DORADO MATE", url: "/products/globo-metalizado-estrella-dorado-mate", tallas: [18], ideas: 2, metalizado: { forma: { tipo: "estrella" }, pulgadas: 18, color: "dorado_mate" } },
  { id: "feliz-cumpleanos-pastel-dusk", nombre: "GLOBO METALIZADO FCPASTEL DUSK", url: "/products/globo-metalizado-feliz-cumpleanos-pastel-dusk", tallas: [18], ideas: 2, metalizado: { forma: { tipo: "redondo" }, pulgadas: 18, color: "arena", impreso: { dibujo: "texto", texto: "Feliz\nCUMPLEAÑOS", hex: "#b08d4a" } } },
  { id: "corazon-lavanda", nombre: "GLOBO METALIZADO CORAZON ROSADO", url: "/products/globo-metalizado-corazon-lavanda", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "corazon" }, pulgadas: 18, color: "rosado" }, nota: "La url dice «lavanda»; el producto es «CORAZON ROSADO» (rosa fucsia metalizado en la foto)." },
  { id: "corazon-te-quiero-rojo", nombre: "GLOBO METALIZADO CORAZON TE QUIERO ROJO", url: "/products/globo-metalizado-corazon-te-quiero-rojo", tallas: [16], ideas: 1, metalizado: { forma: { tipo: "corazon" }, pulgadas: 16, color: "rojo", impreso: { dibujo: "texto", texto: "te\nQuiero", hex: "#ffffff" } } },
  { id: "mariposas-encantadas-copia", nombre: "GLOBO METALIZADO GRADO", url: "/products/globo-metalizado-mariposas-encantadas-copia", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "redondo" }, pulgadas: 18, color: "plata", impreso: { dibujo: "texto", texto: "Feliz\nGRADO!", hex: "#1b1b1f" } }, nota: "La url dice «mariposas encantadas»; el producto es «GLOBO METALIZADO GRADO»." },
  { id: "numero-4-plata", nombre: "GLOBO METALIZADO NUMERO 4 PLATA", url: "/products/globo-metalizado-numero-4-plata", tallas: [16, 32], ideas: 1, metalizado: { forma: { tipo: "numero", valor: 4 }, pulgadas: 32, color: "plata" } },
  { id: "numero-2-dorado-mate", nombre: "GLOBO METALIZADO NUMERO 2 DORADO MATE", url: "/products/globo-metalizado-numero-2-dorado-mate", tallas: [16, 32], ideas: 1, metalizado: { forma: { tipo: "numero", valor: 2 }, pulgadas: 32, color: "dorado_mate" } },
  { id: "numero-0-dorado-mate", nombre: "GLOBO METALIZADO NUMERO 0 DORADO MATE", url: "/products/globo-metalizado-numero-0-dorado-mate", tallas: [16, 32], ideas: 1, metalizado: { forma: { tipo: "numero", valor: 0 }, pulgadas: 32, color: "dorado_mate" } },
  { id: "numero-5-dorado-mate", nombre: "GLOBO METALIZADO NUMERO 5 DORADO MATE", url: "/products/globo-metalizado-numero-5-dorado-mate", tallas: [16, 32], ideas: 1, metalizado: { forma: { tipo: "numero", valor: 5 }, pulgadas: 32, color: "dorado_mate" } },
  { id: "corazon-rojo-2", nombre: "GLOBO METALIZADO CORAZON ROJO", url: "/products/globo-metalizado-corazon-rojo-2", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "corazon" }, pulgadas: 18, color: "rojo" } },
  { id: "numero-2-latte", nombre: "GLOBO METALIZADO NUMERO 2 LATTE", url: "/products/globo-metalizado-numero-2-latte", tallas: [16, 32], ideas: 1, metalizado: { forma: { tipo: "numero", valor: 2 }, pulgadas: 32, color: "latte" } },
  { id: "corazon-rosado-i-love-you", nombre: "GLOBO METALIZADO CORAZON ROSADO I LOVE YOU", url: "/products/globo-metalizado-corazon-rosado-i-love-you", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "corazon" }, pulgadas: 18, color: "blanco", impreso: { dibujo: "texto", texto: "I Love\nYou!", hex: "#1b1b1f" } }, nota: "Corazón blanco con rayas rosadas y «I Love You!» (aquí sin las rayas)." },
  { id: "feliz-cumpleanos-terrazo-azul", nombre: "GLOBO METALIZADO FC TERRAZO AZUL", url: "/products/globo-metalizado-feliz-cumpleanos-terrazo-azul", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "redondo" }, pulgadas: 18, color: "azul_rey", impreso: { dibujo: "texto", texto: "FELIZ\nCumpleaños", hex: "#ffffff" } } },
  { id: "estrella-verde-vibrante", nombre: "GLOBO METALIZADO ESTRELLA VERDE VIBRANTE", url: "/products/globo-metalizado-estrella-verde-vibrante", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "estrella" }, pulgadas: 18, color: "verde_vibrante" } },
  { id: "estrella-rosada-vibrante", nombre: "GLOBO METALIZADO ESTRELLA ROSADA VIBRANTE", url: "/products/globo-metalizado-estrella-rosada-vibrante", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "estrella" }, pulgadas: 18, color: "rosada_vibrante" } },
  { id: "estrella-azul-vibrante", nombre: "GLOBO METALIZADO ESTRELLA AZUL VIBRANTE", url: "/products/globo-metalizado-estrella-azul-vibrante", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "estrella" }, pulgadas: 18, color: "azul_vibrante" } },
  { id: "plato-desechable-metalizado-corazones-brillantes", nombre: "PLATO METALIZADO CORAZONES BRILLANTES", url: "/products/plato-desechable-metalizado-corazones-brillantes", tallas: [], ideas: 1, metalizado: null, nota: "No es un globo: plato de cartón metalizado de 18 cm (paquete de 8); es utilería de fiesta." },
  { id: "numero-3-plata", nombre: "GLOBO METALIZADO NUMERO 3 PLATA", url: "/products/globo-metalizado-numero-3-plata", tallas: [16, 32], ideas: 1, metalizado: { forma: { tipo: "numero", valor: 3 }, pulgadas: 32, color: "plata" } },
  { id: "numero-5-plata", nombre: "GLOBO METALIZADO NUMERO 5 PLATA", url: "/products/globo-metalizado-numero-5-plata", tallas: [16, 32], ideas: 1, metalizado: { forma: { tipo: "numero", valor: 5 }, pulgadas: 32, color: "plata" } },
  { id: "corazon-azul-pastel", nombre: "GLOBO METALIZADO CORAZON AZUL PASTEL", url: "/products/globo-metalizado-corazon-azul-pastel", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "corazon" }, pulgadas: 18, color: "azul_pastel" } },
  { id: "mural-metalizado-cuadros-plata", nombre: "MURAL METALIZADO CUADROS PLATA", url: "/products/mural-metalizado-cuadros-plata", tallas: [], ideas: 1, metalizado: null, nota: "No es un globo: cortina (mural) de cuadros metalizados plata para fondo." },
  { id: "happy-birthday-plata", nombre: "GLOBO METALIZADO HAPPY BIRTHDAY PLATA", url: "/products/globo-metalizado-happy-birthday-plata", tallas: [16], ideas: 1, metalizado: { forma: { tipo: "letras", texto: "HBD" }, pulgadas: 16, color: "plata" }, nota: "La tienda lo llama «HAPPY BIRTHDAY»; la foto muestra las letras «HBD» de 16\"." },
  { id: "happy-birthday-dorado-mate", nombre: "GLOBO METALIZADO HAPPY BIRTHDAY DORADO", url: "/products/globo-metalizado-happy-birthday-dorado-mate", tallas: [16], ideas: 1, metalizado: { forma: { tipo: "letras", texto: "HBD" }, pulgadas: 16, color: "dorado_mate" }, nota: "La tienda lo llama «HAPPY BIRTHDAY DORADO»; la foto muestra las letras «HBD» de 16\"." },
  { id: "estrella-arena", nombre: "GLOBO METALIZADO ESTRELLA ARENA", url: "/products/globo-metalizado-estrella-arena", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "estrella" }, pulgadas: 18, color: "arena" } },
  { id: "corazones-plata", nombre: "GLOBO METALIZADO CORAZONES PLATA", url: "/products/globo-metalizado-corazones-plata", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "corazon" }, pulgadas: 18, color: "plata" }, unidades: 4 },
  { id: "festivo", nombre: "GLOBO METALIZADO FELIZ CUMPLEAÑOS FESTIVO", url: "/products/globo-metalizado-festivo", tallas: [18], ideas: 1, metalizado: { forma: { tipo: "redondo" }, pulgadas: 18, color: "blanco", impreso: { dibujo: "texto", texto: "Feliz\nCumpleaños", hex: "#e0397f" } }, nota: "Borde de franjas de colores: aquí blanco con el letrero." },
];
// </datos>

export function metalizadoPorUrl(url: string): MetalizadoCatalogo | undefined {
  const u = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "");
  return METALIZADOS_TIENDA.find((m) => m.url === u);
}

export function metalizadoPorId(id: string): MetalizadoCatalogo | undefined {
  return METALIZADOS_TIENDA.find((m) => m.id === id);
}

/**
 * Las opciones para armar un metalizado del catálogo, con su producto: en otra talla, con cinta o acostado si se
 * pide. Falla si no existe o no es un globo.
 */
export function metalizadoDeTienda(id: string, cambios: Partial<Pick<OpcionesMetalizado, "pulgadas" | "cinta" | "acostado">> = {}): OpcionesMetalizado {
  const m = metalizadoPorId(id);
  if (!m?.metalizado) throw new Error(`Metalizado de la tienda desconocido o que no es globo: ${id}`);
  return { ...m.metalizado, producto: { nombre: m.nombre, url: m.url }, ...cambios };
}
