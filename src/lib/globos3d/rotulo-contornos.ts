import type { Punto2 } from "./trenza";

/**
 * **De una máscara de píxeles a contornos** (un rótulo): el texto cursivo se dibuja en un lienzo, se marca qué píxeles son
 * tinta y aquí se saca el contorno de cada mancha y de cada hueco (la «o», la «a»), listo para extruirlo como una letra
 * recortada. Sin dependencias del navegador: recibe la máscara, así que se puede probar con figuras hechas a mano.
 *
 * Los contornos siguen el borde exacto de los píxeles (la tinta queda siempre a la derecha, con y hacia abajo), se les
 * quitan los vértices en línea recta y se simplifican con Douglas–Peucker: un texto de 200 px de alto queda en unos cientos
 * de puntos por letra, sin escalones visibles a su tamaño real.
 */

export type Mascara = { datos: Uint8Array; ancho: number; alto: number };
/** Una mancha de tinta (`externo`) con sus huecos. Los puntos están en píxeles, con y hacia abajo. */
export type ContornoTinta = { externo: Punto2[]; huecos: Punto2[][] };

/** Área con signo ×2 (positiva si el contorno gira en el sentido de las manecillas con y hacia abajo: los externos). */
export function areaConSigno(c: readonly Punto2[]): number {
  let a = 0;
  for (let i = 0; i < c.length; i++) { const p = c[i]!, q = c[(i + 1) % c.length]!; a += p.x * q.y - q.x * p.y; }
  return a;
}

/** ¿Está el punto dentro del polígono? (par/impar). */
export function puntoEnPoligono(p: Punto2, poligono: readonly Punto2[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i]!, b = poligono[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** Quita los vértices que están en línea recta con sus vecinos. */
function sinRectas(c: readonly Punto2[]): Punto2[] {
  return c.filter((p, i) => {
    const a = c[(i + c.length - 1) % c.length]!, b = c[(i + 1) % c.length]!;
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
}

function distanciaASegmento(p: Punto2, a: Punto2, b: Punto2): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas–Peucker sobre un tramo abierto `desde`..`hasta` (índices incluidos). */
function simplificarTramo(c: readonly Punto2[], desde: number, hasta: number, tolerancia: number, salida: Punto2[]) {
  let lejos = -1, mayor = tolerancia;
  for (let i = desde + 1; i < hasta; i++) {
    const d = distanciaASegmento(c[i]!, c[desde]!, c[hasta]!);
    if (d > mayor) { mayor = d; lejos = i; }
  }
  if (lejos < 0) return;
  simplificarTramo(c, desde, lejos, tolerancia, salida);
  salida.push(c[lejos]!);
  simplificarTramo(c, lejos, hasta, tolerancia, salida);
}

/** Simplifica un contorno cerrado: se parte por su punto más lejano al primero y se simplifica cada mitad. */
export function simplificarContorno(c: readonly Punto2[], tolerancia: number): Punto2[] {
  if (c.length <= 4) return [...c];
  let lejos = 0, mayor = -1;
  for (let i = 1; i < c.length; i++) { const d = Math.hypot(c[i]!.x - c[0]!.x, c[i]!.y - c[0]!.y); if (d > mayor) { mayor = d; lejos = i; } }
  const ida: Punto2[] = [], vuelta: Punto2[] = [];
  const cerrado = [...c, c[0]!];
  simplificarTramo(cerrado, 0, lejos, tolerancia, ida);
  simplificarTramo(cerrado, lejos, c.length, tolerancia, vuelta);
  return [c[0]!, ...ida, c[lejos]!, ...vuelta];
}

/** Los bordes dirigidos de la máscara (tinta a la derecha): `vértice → [vértices a los que se puede ir]`. */
function bordes(m: Mascara): Map<number, number[]> {
  const { datos, ancho, alto } = m;
  const col = ancho + 1;
  const tinta = (x: number, y: number) => x >= 0 && y >= 0 && x < ancho && y < alto && datos[y * ancho + x] !== 0;
  const salidas = new Map<number, number[]>();
  const mas = (de: number, a: number) => { const l = salidas.get(de); if (l) l.push(a); else salidas.set(de, [a]); };
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    if (!tinta(x, y)) continue;
    const tl = y * col + x, tr = tl + 1, bl = tl + col, br = bl + 1;
    if (!tinta(x, y - 1)) mas(tl, tr);
    if (!tinta(x + 1, y)) mas(tr, br);
    if (!tinta(x, y + 1)) mas(br, bl);
    if (!tinta(x - 1, y)) mas(bl, tl);
  }
  return salidas;
}

/** Los lazos cerrados de bordes, en píxeles; en un vértice con dos salidas se gira a la derecha (la tinta en diagonal no se une). */
function lazos(m: Mascara): Punto2[][] {
  const col = m.ancho + 1;
  const salidas = bordes(m);
  const punto = (v: number): Punto2 => ({ x: v % col, y: Math.floor(v / col) });
  const resultado: Punto2[][] = [];
  for (const [inicio, lista] of salidas) {
    while (lista.length) {
      const puntos: number[] = [inicio];
      let actual = lista.pop()!, previo = inicio;
      while (actual !== inicio) {
        puntos.push(actual);
        const opciones = salidas.get(actual);
        if (!opciones?.length) break;
        let k = 0;
        if (opciones.length > 1) {
          const dx = punto(actual).x - punto(previo).x, dy = punto(actual).y - punto(previo).y;
          const derecha = opciones.findIndex((o) => punto(o).x - punto(actual).x === -dy && punto(o).y - punto(actual).y === dx);
          k = derecha >= 0 ? derecha : 0;
        }
        const [siguiente] = opciones.splice(k, 1);
        previo = actual;
        actual = siguiente!;
      }
      if (puntos.length >= 4) resultado.push(puntos.map(punto));
    }
  }
  return resultado;
}

/**
 * Los contornos de la tinta de una máscara: cada mancha con sus huecos. `tolerancia` (px) es cuánto se puede apartar el
 * contorno simplificado del borde de los píxeles; las manchas de menos de `minimoPx` píxeles de área (polvo) se descartan.
 */
export function contornosDeMascara(m: Mascara, tolerancia = 0.75, minimoPx = 4): ContornoTinta[] {
  const todos = lazos(m).map((l) => simplificarContorno(sinRectas(l), tolerancia)).filter((l) => l.length >= 3);
  const externos = todos.filter((l) => areaConSigno(l) > 0 && Math.abs(areaConSigno(l)) / 2 >= minimoPx);
  const huecos = todos.filter((l) => areaConSigno(l) < 0 && Math.abs(areaConSigno(l)) / 2 >= minimoPx);
  const salida: ContornoTinta[] = externos.map((externo) => ({ externo, huecos: [] }));
  for (const hueco of huecos) {
    // El hueco es de la mancha más chica que lo contiene.
    const dueno = salida.filter((s) => puntoEnPoligono(hueco[0]!, s.externo)).sort((a, b) => Math.abs(areaConSigno(a.externo)) - Math.abs(areaConSigno(b.externo)))[0];
    dueno?.huecos.push(hueco);
  }
  return salida;
}

/** El rectángulo de tinta de una máscara (en píxeles) o null si está vacía. */
export function cajaDeTinta(m: Mascara): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = m.ancho, y0 = m.alto, x1 = -1, y1 = -1;
  for (let y = 0; y < m.alto; y++) for (let x = 0; x < m.ancho; x++) {
    if (m.datos[y * m.ancho + x] === 0) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
