import type { Vec3 } from "./modulos";
import type { PuntoGrosor, PuntoMezcla, TramoOrganico } from "./organico";

/**
 * **Geometría del motor orgánico** (extraída de `organico.ts`): vectores, el recorrido de un tramo (muestreo uniforme y marco que
 * no gira), su proyección, el perfil de grosor y de mezcla a lo largo de él, la superficie de la envoltura y cuántos globos de un
 * diámetro pide un cm de cuerpo. Puro y sin dependencias del empaque.
 */

/** PRNG mulberry32: rápido, de 32 bits, el mismo en cualquier motor de JS. */
export function crearAzar(semilla: number): () => number {
  let a = semilla >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const suma = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const resta = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const escala = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);
export const punto = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cruz = (a: Vec3, b: Vec3): Vec3 => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const norma = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distancia = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const unitario = (a: Vec3, siNulo: Vec3 = vec(0, 1, 0)): Vec3 => {
  const n = norma(a);
  return n > 1e-9 ? escala(a, 1 / n) : siNulo;
};
export const limitar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Aplastamiento de dos cuerpos que se tocan, como fracción del diámetro del menor (negativo: no se tocan). */
export function aplastamiento(a: { centro: Vec3; infladoCm: number }, b: { centro: Vec3; infladoCm: number }): number {
  return (a.infladoCm / 2 + b.infladoCm / 2 - distancia(a.centro, b.centro)) / Math.min(a.infladoCm, b.infladoCm);
}

// ----------------------------------------------------------------------------------------------------------
// Recorrido: muestreo uniforme y marco que no gira (transporte paralelo)
// ----------------------------------------------------------------------------------------------------------

export type Muestra = { s: number; p: Vec3; t: Vec3; n: Vec3; b: Vec3 };

export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const u2 = u * u, u3 = u2 * u;
  const c = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u2 + (-a + 3 * b - 3 * c2 + d) * u3);
  return vec(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z));
}

/** Largo (cm) del recorrido suavizado. */
export function largoRecorrido(control: readonly Vec3[]): number {
  const m = muestrear(control, 2);
  return m[m.length - 1]!.s;
}

export function muestrear(control: readonly Vec3[], pasoCm: number): Muestra[] {
  if (control.length < 2) throw new Error("El recorrido orgánico necesita al menos dos puntos");
  const densa: Vec3[] = [control[0]!];
  for (let i = 0; i < control.length - 1; i++) {
    const p0 = control[Math.max(0, i - 1)]!, p1 = control[i]!, p2 = control[i + 1]!, p3 = control[Math.min(control.length - 1, i + 2)]!;
    for (let k = 1; k <= 16; k++) densa.push(catmullRom(p0, p1, p2, p3, k / 16));
  }
  const acumulado = [0];
  for (let i = 1; i < densa.length; i++) acumulado.push(acumulado[i - 1]! + distancia(densa[i]!, densa[i - 1]!));
  const total = acumulado[acumulado.length - 1]!;
  if (!(total > 0)) throw new Error("El recorrido orgánico no tiene largo");
  const n = Math.max(1, Math.ceil(total / pasoCm));
  const puntos: Array<{ s: number; p: Vec3 }> = [];
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const s = (i * total) / n;
    while (j < densa.length - 1 && acumulado[j]! < s) j++;
    const a = densa[j - 1]!, b = densa[j]!;
    const tramo = acumulado[j]! - acumulado[j - 1]!;
    const f = tramo > 0 ? limitar((s - acumulado[j - 1]!) / tramo, 0, 1) : 0;
    puntos.push({ s, p: suma(a, escala(resta(b, a), f)) });
  }
  const muestras: Muestra[] = [];
  for (let i = 0; i < puntos.length; i++) {
    const antes = puntos[Math.max(0, i - 1)]!.p, despues = puntos[Math.min(puntos.length - 1, i + 1)]!.p;
    const t = unitario(resta(despues, antes));
    let nrm: Vec3;
    if (i === 0) {
      const ref = Math.abs(t.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
      nrm = unitario(resta(ref, escala(t, punto(ref, t))));
    } else {
      const previa = muestras[i - 1]!.n;
      nrm = unitario(resta(previa, escala(t, punto(previa, t))), previa);
    }
    muestras.push({ s: puntos[i]!.s, p: puntos[i]!.p, t, n: nrm, b: cruz(t, nrm) });
  }
  return muestras;
}

export type Fases = readonly [number, number, number];

export type TramoPreparado = {
  def: TramoOrganico;
  muestras: Muestra[];
  largo: number;
  paso: number;
  fases: Fases;
};

export function muestraEn(tp: TramoPreparado, s: number): Muestra {
  if (s > tp.largo || s < 0) {
    const extremo = s > tp.largo ? tp.muestras[tp.muestras.length - 1]! : tp.muestras[0]!;
    const fuera = s > tp.largo ? s - tp.largo : s;
    return { ...extremo, s, p: suma(extremo.p, escala(extremo.t, fuera)) };
  }
  const f = s / tp.paso;
  const i = Math.min(tp.muestras.length - 2, Math.floor(f));
  const a = tp.muestras[i]!, b = tp.muestras[i + 1]!;
  const u = limitar(f - i, 0, 1);
  const cercana = u < 0.5 ? a : b;
  return { ...cercana, s: limitar(s, 0, tp.largo), p: suma(a.p, escala(resta(b.p, a.p), u)) };
}

/** Proyección de un punto sobre el eje del tramo: muestra más cercana, afinada sobre sus dos segmentos. */
export function proyectar(tp: TramoPreparado, c: Vec3): Muestra {
  let mejor = 0, mejorD = Infinity;
  for (let i = 0; i < tp.muestras.length; i++) {
    const d = distancia(tp.muestras[i]!.p, c);
    if (d < mejorD) { mejorD = d; mejor = i; }
  }
  let s = tp.muestras[mejor]!.s;
  let menor = Infinity;
  for (const k of [mejor - 1, mejor]) {
    if (k < 0 || k + 1 >= tp.muestras.length) continue;
    const a = tp.muestras[k]!.p, b = tp.muestras[k + 1]!.p;
    const ab = resta(b, a);
    const f = limitar(punto(resta(c, a), ab) / (punto(ab, ab) || 1), 0, 1);
    const q = suma(a, escala(ab, f));
    const d = distancia(q, c);
    if (d < menor) { menor = d; s = tp.muestras[k]!.s + f * tp.paso; }
  }
  return muestraEn(tp, s);
}

export function ruido(f: Fases, s: number, phi: number): number {
  return (Math.sin(s / 19 + 2 * phi + f[0]) + 0.7 * Math.sin(s / 9 - 3 * phi + f[1]) + 0.5 * Math.sin(s / 31 + phi + f[2])) / 2.2;
}

export function interpolarGrosor(grosor: readonly PuntoGrosor[], t: number): number {
  const g = [...grosor].sort((a, b) => a.t - b.t);
  if (g.length === 0) return 20;
  if (t <= g[0]!.t) return g[0]!.radioCm;
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1]!, b = g[i]!;
    if (t <= b.t) return a.radioCm + (b.radioCm - a.radioCm) * ((t - a.t) / (b.t - a.t || 1));
  }
  return g[g.length - 1]!.radioCm;
}

/** Pesos normalizados de la mezcla en la fracción `t` (solo los positivos). */
export function mezclaEn(mezcla: readonly PuntoMezcla[], t: number): Map<string, number> {
  const m = [...mezcla].sort((a, b) => a.t - b.t);
  const crudo = new Map<string, number>();
  if (m.length === 0) return crudo;
  let a = m[0]!, b = m[0]!, u = 0;
  if (t >= m[m.length - 1]!.t) { a = b = m[m.length - 1]!; }
  else if (t > m[0]!.t) {
    for (let i = 1; i < m.length; i++) if (t <= m[i]!.t) { a = m[i - 1]!; b = m[i]!; u = (t - a.t) / (b.t - a.t || 1); break; }
  }
  for (const id of new Set([...Object.keys(a.pesos), ...Object.keys(b.pesos)])) {
    const w = (a.pesos[id] ?? 0) * (1 - u) + (b.pesos[id] ?? 0) * u;
    if (w > 0) crudo.set(id, w);
  }
  const total = [...crudo.values()].reduce((x, y) => x + y, 0);
  for (const [id, w] of crudo) crudo.set(id, w / total);
  return crudo;
}

export function radioEnvoltura(tp: TramoPreparado, s: number, phi: number): number {
  const base = interpolarGrosor(tp.def.grosor, limitar(s / tp.largo, 0, 1));
  return base * (1 + limitar(tp.def.irregularidad, 0, 0.3) * ruido(tp.fases, s, phi));
}

/**
 * A qué distancia del eje va el centro de un globo de radio `r`: con su cara de fuera en la envoltura (`R − r`,
 * corrido por el hundimiento), pero nunca a menos de su propio radio (×1,05). El globo va amarrado por el nudo al
 * armazón del centro y el cuerpo sale hacia fuera, así que su centro no puede meterse en el eje: un globo más ancho
 * que la envoltura sobresale hacia su lado (los grandes de la base abomban la silueta) en vez de tapar toda la
 * sección y no dejar sitio a nadie a su altura.
 */
export function profundidad(radioEnvolturaCm: number, r: number, hundimiento: number): number {
  return Math.max(radioEnvolturaCm - r * hundimiento, r * 1.05);
}

/** Hasta dónde se reparte el tramo: de 0 al largo, más 0,85 radios en cada extremo con tapa. */
export function rangoS(tp: TramoPreparado): { min: number; max: number } {
  return {
    min: tp.def.tapas?.inicio ? -0.85 * interpolarGrosor(tp.def.grosor, 0) : 0,
    max: tp.largo + (tp.def.tapas?.fin ? 0.85 * interpolarGrosor(tp.def.grosor, 1) : 0),
  };
}

/**
 * Punto de la envoltura en (`s`, `phi`) y su normal hacia fuera. Dentro del recorrido es un tubo; pasado un extremo
 * con tapa, una media esfera centrada en el extremo (`s` fuera del recorrido es cuánto se avanza sobre ella).
 */
export function superficie(tp: TramoPreparado, s: number, phi: number): { punto: Vec3; normal: Vec3; radio: number; centro: Vec3 } {
  const m = muestraEn(tp, s);
  const radial = suma(escala(m.n, Math.cos(phi)), escala(m.b, Math.sin(phi)));
  const radio = radioEnvoltura(tp, s, phi);
  if (s > tp.largo || s < 0) {
    const centro = muestraEn(tp, limitar(s, 0, tp.largo)).p;
    const fuera = s > tp.largo ? s - tp.largo : s;
    const seno = limitar(fuera / Math.max(1, radio), -1, 1);
    const normal = unitario(suma(escala(m.t, seno), escala(radial, Math.sqrt(1 - seno * seno))));
    return { punto: suma(centro, escala(normal, radio)), normal, radio, centro };
  }
  return { punto: suma(m.p, escala(radial, radio)), normal: radial, radio, centro: m.p };
}

/**
 * Globos de estructura de diámetro `d` por centímetro de recorrido, si la envoltura tiene radio `R`. Cada globo
 * ocupa la huella de un tresbolillo, d²·0,866, sobre la
 * superficie a media profundidad del globo: el cuerpo va con su cara de fuera en la envoltura y su centro a
 * `R − d/2`, así que la superficie que de verdad reparte es la de radio `R − d/4` (y nunca menos de `d/4`, para
 * el globo más ancho que la envoltura, que va casi en el eje). Con una mezcla, cada formato consume su parte:
 * el total por centímetro es la media armónica ponderada por la proporción en número de cada formato.
 * `EMPAQUE` lo calibra: colocando de abajo arriba sin pasar del 12 % de aplastamiento se llena el 76 % del
 * tresbolillo ideal (medido: R-12 a 27 cm en una columna de 64 cm de ancho y 1,9 m → 36 globos, 19 por metro, lo
 * mismo que la trenza de cuartetos de Sempertex con R-12: 5 niveles × 4 = 20 por metro). Lo que no cabe se avisa y
 * lo cubre el relleno.
 */
export const EMPAQUE = 0.76;
export function estructuraPorCm(d: number, radioCm: number): number {
  const radioMedio = Math.max(radioCm - d / 4, d / 4);
  return (EMPAQUE * 2 * Math.PI * radioMedio) / (d * d * 0.866);
}

