import { codigoDeColor } from "./compilar-lectura";
import type { ColorLeido, LecturaFoto, PiezaLeida } from "./lectura-foto";

/**
 * **Compara dos lecturas de la misma foto** (la de Gemini contra la hecha a mano del dueño, `referencias-dueno.ts`):
 * la medida con que se evalúa la lectura de la IA (`scripts/exp/evaluar-foto-a-escena.ts`) y, más adelante, el bucle de
 * refinamiento. Puro y sin red. Lo que mide, todo de 0 a 1:
 * - tipos: las piezas leídas contra las esperadas (precisión, cobertura y F1 por tipo; `inventadas` y `faltantes`);
 * - fondos: lo mismo con los ids de fondos y decoraciones del catálogo;
 * - colores: cuánto coincide la mezcla de colores, por código Sempertex y por familia (rojo, azul, dorado…);
 * - silueta: de las guirnaldas orgánicas, la clase de recorrido (arco, colgante, diagonal…) y qué tan cerca van los ejes.
 */

export type Silueta = "arco" | "medio_arco" | "colgante" | "diagonal" | "horizontal" | "vertical";
type Punto = { x: number; y: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const f1De = (p: number, r: number) => (p + r > 0 ? (2 * p * r) / (p + r) : 0);

// ----------------------------------------------------------------------------------------------------------
// Tipos y conteos
// ----------------------------------------------------------------------------------------------------------

export type Cobertura = { aciertos: number; leidas: number; esperadas: number; precision: number; cobertura: number; f1: number; inventadas: string[]; faltantes: string[]; conteos: Record<string, [number, number]> };

/** Compara dos multiconjuntos de etiquetas (la intersección cuenta cada una tantas veces como esté en las dos). */
export function compararEtiquetas(leidas: readonly string[], esperadas: readonly string[]): Cobertura {
  const cuenta = (xs: readonly string[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
  const g = cuenta(leidas), h = cuenta(esperadas);
  const claves = [...new Set([...Object.keys(g), ...Object.keys(h)])].sort();
  let aciertos = 0;
  const inventadas: string[] = [], faltantes: string[] = [], conteos: Record<string, [number, number]> = {};
  for (const k of claves) {
    const a = g[k] ?? 0, b = h[k] ?? 0;
    aciertos += Math.min(a, b);
    conteos[k] = [a, b];
    for (let i = 0; i < a - b; i++) inventadas.push(k);
    for (let i = 0; i < b - a; i++) faltantes.push(k);
  }
  const precision = leidas.length ? aciertos / leidas.length : esperadas.length ? 0 : 1;
  const cobertura = esperadas.length ? aciertos / esperadas.length : leidas.length ? 0 : 1;
  return { aciertos, leidas: leidas.length, esperadas: esperadas.length, precision: r3(precision), cobertura: r3(cobertura), f1: r3(esperadas.length + leidas.length ? f1De(precision, cobertura) : 1), inventadas, faltantes, conteos };
}

/** Cada pieza cuenta una vez, salvo las decoraciones, que cuentan por su `cantidad` (una de cantidad 3 y tres de cantidad 1 son lo mismo). */
const tiposDe = (l: LecturaFoto) => l.piezas.flatMap((p) => (p.tipo === "otro" ? [] : p.tipo === "decoracion" ? Array.from({ length: p.cantidad }, () => p.tipo) : [p.tipo]));
const fondosDe = (l: LecturaFoto) => l.piezas.flatMap((p) => (p.tipo === "fondo" ? [`fondo:${p.id}`] : p.tipo === "decoracion" ? Array.from({ length: p.cantidad }, () => `decoracion:${p.id}`) : []));

// ----------------------------------------------------------------------------------------------------------
// Colores
// ----------------------------------------------------------------------------------------------------------

/** La familia de color de un tono medido (y su nombre): lo que un decorador llamaría el mismo color. */
export function familiaDeColor(c: Pick<ColorLeido, "nombre" | "hex" | "acabado">): string {
  const nombre = c.nombre.toLowerCase();
  if (/dorad|\boro\b|gold/.test(nombre)) return "dorado";
  if (/plat[ae]|silver|cromo/.test(nombre) && !/plateado rosa/.test(nombre)) return "plata";
  if (/cristal|transparent|clear/.test(nombre) || c.acabado === "cristal") return "cristal";
  const n = parseInt(c.hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.88 && s < 0.35) return "blanco";
  if (l < 0.14) return "negro";
  if (s < 0.14) return c.acabado === "cromado" ? "plata" : "gris";
  const h = d === 0 ? 0 : ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  if (c.acabado === "cromado" && h >= 25 && h < 65) return "dorado";
  if (h < 15 || h >= 345) return l > 0.72 ? "rosa" : "rojo";
  if (h < 45) return l < 0.45 ? "cafe" : l > 0.75 ? "durazno" : "naranja";
  if (h < 70) return l > 0.82 ? "crema" : "amarillo";
  if (h < 165) return "verde";
  if (h < 200) return "turquesa";
  if (h < 255) return "azul";
  if (h < 290) return "morado";
  return l > 0.7 ? "rosa" : "fucsia";
}

const conColores = (p: PiezaLeida): p is PiezaLeida & { colores: ColorLeido[] } => p.tipo !== "fondo" && p.tipo !== "otro" && "colores" in p;

/** Histograma de color de las piezas de globos (cada pieza pesa lo mismo; dentro de ella, por `peso`). */
function histogramas(l: LecturaFoto): { codigos: Map<string, number>; familias: Map<string, number> } {
  const codigos = new Map<string, number>(), familias = new Map<string, number>();
  for (const p of l.piezas.filter(conColores)) {
    const total = p.colores.reduce((s, c) => s + Math.max(c.peso, 0.01), 0);
    for (const c of p.colores) {
      const w = Math.max(c.peso, 0.01) / total;
      let codigo: string;
      try { codigo = codigoDeColor(c, ["R-12"], []); } catch { codigo = `?${c.nombre}`; }
      codigos.set(codigo, (codigos.get(codigo) ?? 0) + w);
      const familia = familiaDeColor(c);
      familias.set(familia, (familias.get(familia) ?? 0) + w);
    }
  }
  return { codigos, familias };
}

/** Intersección de dos histogramas normalizados (1 = misma mezcla, 0 = nada en común). */
function interseccion(a: Map<string, number>, b: Map<string, number>): number {
  const sa = [...a.values()].reduce((s, v) => s + v, 0), sb = [...b.values()].reduce((s, v) => s + v, 0);
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  return [...a.keys()].reduce((s, k) => s + Math.min((a.get(k) ?? 0) / sa, (b.get(k) ?? 0) / sb), 0);
}

// ----------------------------------------------------------------------------------------------------------
// Siluetas de las guirnaldas orgánicas
// ----------------------------------------------------------------------------------------------------------

/** La clase de recorrido de un eje de guirnalda, en coordenadas de la imagen (y hacia abajo). */
export function siluetaDeTrazo(puntos: readonly Punto[]): Silueta {
  const a = puntos[0]!, z = puntos[puntos.length - 1]!;
  const xs = puntos.map((p) => p.x), ys = puntos.map((p) => p.y);
  const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys);
  const topY = Math.min(...ys), bajoY = Math.max(...ys);
  const extremoAlto = Math.min(a.y, z.y), extremoBajo = Math.max(a.y, z.y);
  if (dx < 0.12 && dy > dx * 1.5) return "vertical";
  // ∩: los dos extremos más abajo que lo más alto del recorrido.
  if (extremoAlto - topY > 0.1 && dx > 0.12) return "arco";
  // ∪: los dos extremos más arriba que lo más bajo.
  if (bajoY - extremoBajo > 0.08 && dx > 0.2) return "colgante";
  if (Math.abs(a.y - z.y) > 0.3 && dx > 0.15) {
    // Un extremo arriba y el otro abajo: si el recorrido se abomba respecto a la cuerda es un medio arco; si no, una diagonal.
    const largo = Math.hypot(z.x - a.x, z.y - a.y) || 1;
    const abombe = Math.max(...puntos.map((p) => Math.abs((z.x - a.x) * (a.y - p.y) - (a.x - p.x) * (z.y - a.y)) / largo));
    return abombe / largo > 0.12 ? "medio_arco" : "diagonal";
  }
  return dy > dx ? "vertical" : "horizontal";
}

/** Los puntos de una polilínea repartidos parejo (para comparar dos recorridos con distinta cantidad de puntos). */
function muestrear(puntos: readonly Punto[], n = 32): Punto[] {
  const largos = puntos.slice(1).map((p, i) => Math.hypot(p.x - puntos[i]!.x, p.y - puntos[i]!.y));
  const total = largos.reduce((s, v) => s + v, 0);
  if (total === 0) return Array.from({ length: n }, () => puntos[0]!);
  return Array.from({ length: n }, (_, k) => {
    let resto = (k / (n - 1)) * total, i = 0;
    while (i < largos.length - 1 && resto > largos[i]!) { resto -= largos[i]!; i++; }
    const t = largos[i] ? Math.min(1, resto / largos[i]!) : 0;
    const p = puntos[i]!, q = puntos[i + 1]!;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  });
}

/** Distancia media entre dos ejes (en fracción del alto de la imagen), simétrica. */
export function distanciaTrazos(a: readonly Punto[], b: readonly Punto[]): number {
  const A = muestrear(a), B = muestrear(b);
  const media = (X: Punto[], Y: Punto[]) => X.reduce((s, p) => s + Math.min(...Y.map((q) => Math.hypot(p.x - q.x, p.y - q.y))), 0) / X.length;
  return (media(A, B) + media(B, A)) / 2;
}

/** Hasta qué distancia (fracción del alto) un recorrido aún cuenta como parecido. */
const DISTANCIA_CERO = 0.2;

type Guirnalda = Extract<PiezaLeida, { tipo: "guirnalda_organica" }>;
const guirnaldasDe = (l: LecturaFoto) => l.piezas.filter((p): p is Guirnalda => p.tipo === "guirnalda_organica");

export type ComparacionSilueta = { esperadas: Silueta[]; leidas: Silueta[]; claseIgual: number | null; distancia: number | null; puntaje: number | null };

function compararSiluetas(g: LecturaFoto, h: LecturaFoto): ComparacionSilueta {
  const G = guirnaldasDe(g), H = guirnaldasDe(h);
  const esperadas = H.map((p) => siluetaDeTrazo(p.puntos)), leidas = G.map((p) => siluetaDeTrazo(p.puntos));
  if (!H.length) return { esperadas, leidas, claseIgual: null, distancia: null, puntaje: null };
  // Cada guirnalda esperada se empareja con la leída más cercana.
  const distancias = H.map((p) => (G.length ? Math.min(...G.map((q) => distanciaTrazos(p.puntos, q.puntos))) : Infinity));
  const mejores = H.map((p) => (G.length ? G.reduce((m, q) => (distanciaTrazos(p.puntos, q.puntos) < distanciaTrazos(p.puntos, m.puntos) ? q : m)) : null));
  const claseIgual = H.reduce((s, p, i) => s + (mejores[i] && siluetaDeTrazo(mejores[i]!.puntos) === siluetaDeTrazo(p.puntos) ? 1 : 0), 0) / H.length;
  const finitas = distancias.filter(Number.isFinite);
  const distancia = finitas.length ? finitas.reduce((s, v) => s + v, 0) / finitas.length : null;
  const puntaje = distancias.reduce((s, d) => s + (Number.isFinite(d) ? Math.max(0, 1 - d / DISTANCIA_CERO) : 0), 0) / H.length;
  return { esperadas, leidas, claseIgual: r3(claseIgual), distancia: distancia === null ? null : r3(distancia), puntaje: r3(puntaje) };
}

// ----------------------------------------------------------------------------------------------------------
// Todo junto
// ----------------------------------------------------------------------------------------------------------

export type Comparacion = {
  tipos: Cobertura;
  fondos: Cobertura | null;
  colores: { codigo: number; familia: number };
  silueta: ComparacionSilueta;
  /** Promedio de lo que aplica: F1 de tipos, F1 de fondos (si la mano leyó alguno), familias de color y silueta (si hay guirnaldas orgánicas). */
  puntaje: number;
};

/** La lectura de la IA (`leida`) contra la hecha a mano (`esperada`). */
export function compararLecturas(leida: LecturaFoto, esperada: LecturaFoto): Comparacion {
  const tipos = compararEtiquetas(tiposDe(leida), tiposDe(esperada));
  const hayFondos = fondosDe(esperada).length > 0;
  const fondos = hayFondos || fondosDe(leida).length ? compararEtiquetas(fondosDe(leida), fondosDe(esperada)) : null;
  const hl = histogramas(leida), he = histogramas(esperada);
  const colores = { codigo: r3(interseccion(hl.codigos, he.codigos)), familia: r3(interseccion(hl.familias, he.familias)) };
  const silueta = compararSiluetas(leida, esperada);
  const partes = [tipos.f1, ...(fondos && hayFondos ? [fondos.f1] : []), colores.familia, ...(silueta.puntaje !== null ? [silueta.puntaje] : [])];
  return { tipos, fondos, colores, silueta, puntaje: r3(partes.reduce((s, v) => s + v, 0) / partes.length) };
}
