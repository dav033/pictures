import { formatoPorId } from "./formatos";
import { centroCuerpo } from "./geometria";
import type { Vec3 } from "./modulos";

/**
 * **La superficie de una estructura de globos como lienzo** (columna, arco, aro orgánico, guirnalda, pared de
 * globos): cada globo es una esfera de su inflado alrededor del centro de su cuerpo. Con eso se busca dónde pega un
 * rayo (la IA describe el sitio con altura y lado), hacia dónde mira la superficie en un punto (suavizado al tamaño
 * de la decoración, para que una flor sobre una columna mire hacia fuera del eje y no hacia el costado de un globo)
 * y cuánto sobresale la superficie bajo una decoración (para apoyarla sin enterrarla). Todo en cm y puro.
 */

export type CuerpoGlobo = { c: Vec3; r: number };

type GloboConCuerpo = { formatoId: string; infladoCm: number; nudo: Vec3; direccion: Vec3; cuelloExtraCm: number };

const resta = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const suma = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const punto = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const largo = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const unitario = (v: Vec3): Vec3 => { const n = largo(v) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
export const cruz = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Los cuerpos (esferas) de unos globos ya colocados. Los tubitos y Link-O-Loon largos no cuentan (son tubos). */
export function cuerposDeGlobos(globos: readonly GloboConCuerpo[]): CuerpoGlobo[] {
  const salida: CuerpoGlobo[] = [];
  for (const g of globos) {
    const formato = formatoPorId(g.formatoId);
    if (formato?.tipo === "tubito" || (formato?.tipo === "link" && formato.largoCm)) continue;
    const l = centroCuerpo(formato?.tipo === "link" ? "link" : "redondo", g.infladoCm) + g.cuelloExtraCm;
    const d = unitario(g.direccion);
    salida.push({ c: suma(g.nudo, d, l), r: g.infladoCm / 2 });
  }
  return salida;
}

/** El primer cuerpo que corta el rayo `origen + t·dir` (t > 0): dónde y con qué globo; `null` si no corta ninguno. */
export function rayoContraCuerpos(cuerpos: readonly CuerpoGlobo[], origen: Vec3, dir: Vec3): { punto: Vec3; t: number; cuerpo: number } | null {
  const d = unitario(dir);
  let mejor: { punto: Vec3; t: number; cuerpo: number } | null = null;
  cuerpos.forEach((k, i) => {
    const w = resta(origen, k.c);
    const b = punto(w, d), c = punto(w, w) - k.r * k.r;
    const disc = b * b - c;
    if (disc < 0) return;
    const raiz = Math.sqrt(disc);
    const t = -b - raiz > 1e-6 ? -b - raiz : -b + raiz;
    if (t <= 1e-6 || (mejor && t >= mejor.t)) return;
    mejor = { punto: suma(origen, d, t), t, cuerpo: i };
  });
  return mejor;
}

/**
 * Hacia dónde mira la superficie en `p`, promediada al tamaño `radioCm` de lo que se apoya: cada globo cercano
 * empuja hacia fuera de su centro con un peso que crece cuanto más cerca está. En una columna sale hacia fuera
 * del eje; en una pared de globos, de frente. `null` si no hay globos cerca.
 */
export function normalSuavizada(cuerpos: readonly CuerpoGlobo[], p: Vec3, radioCm: number): Vec3 | null {
  let acumulada: Vec3 = { x: 0, y: 0, z: 0 };
  let pesos = 0;
  for (const k of cuerpos) {
    const v = resta(p, k.c);
    const d = largo(v);
    const peso = k.r + radioCm - d;
    if (peso <= 0 || d < 1e-6) continue;
    acumulada = suma(acumulada, v, peso / d);
    pesos += peso;
  }
  if (pesos <= 0 || largo(acumulada) < 1e-9) return null;
  return unitario(acumulada);
}

/** La altura (a lo largo de `n`) del globo más saliente que corta la recta `q + s·n`; `-Infinity` si ninguno. */
function alturaEn(cerca: readonly CuerpoGlobo[], q: Vec3, n: Vec3): number {
  let mejor = -Infinity;
  for (const k of cerca) {
    const w = resta(k.c, q);
    const a = punto(w, n);
    const d2 = punto(w, w) - a * a;
    if (d2 < k.r * k.r) mejor = Math.max(mejor, a + Math.sqrt(k.r * k.r - d2));
  }
  return mejor;
}

/**
 * Hacia dónde mira la superficie bajo algo de radio `radioCm` apoyado en `p`: se mide la superficie más saliente
 * en un disco de muestras (centro y tres anillos) perpendicular a `n0` y se le ajusta un plano por mínimos cuadrados;
 * dos pasadas. Así una flor sobre una pared de globos mira de frente aunque el punto caiga en la parte de abajo de un
 * globo, y sobre una columna mira hacia fuera del eje. Si no hay con qué ajustar, `n0`.
 */
export function normalDeSuperficie(cuerpos: readonly CuerpoGlobo[], p: Vec3, n0: Vec3, radioCm: number): Vec3 {
  let n = unitario(n0);
  // Al menos un globo de ancho alrededor del punto: si no, el plano sigue la curva de un solo globo.
  const vecinos = cuerpos.filter((k) => largo(resta(k.c, p)) < Math.max(4, radioCm) + k.r);
  const rMedio = vecinos.length ? vecinos.reduce((s, k) => s + k.r, 0) / vecinos.length : 0;
  const radio = Math.max(4, radioCm, radioCm * 0.5 + rMedio);
  const cerca = cuerpos.filter((k) => largo(resta(k.c, p)) < radio + k.r + 10);
  for (let pasada = 0; pasada < 2; pasada++) {
    const auxiliar: Vec3 = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const e1 = unitario(cruz(auxiliar, n)), e2 = cruz(n, e1);
    // Mínimos cuadrados de h = a·u + b·v + c.
    let su = 0, sv = 0, sh = 0, suu = 0, svv = 0, suv = 0, suh = 0, svh = 0, cuantas = 0;
    const muestras: Array<[number, number]> = [[0, 0]];
    for (const f of [0.35, 0.7, 1]) for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * Math.PI + f; muestras.push([Math.cos(a) * radio * f, Math.sin(a) * radio * f]); }
    for (const [u, v] of muestras) {
      const h = alturaEn(cerca, suma(suma(p, e1, u), e2, v), n);
      if (!Number.isFinite(h)) continue;
      su += u; sv += v; sh += h; suu += u * u; svv += v * v; suv += u * v; suh += u * h; svh += v * h; cuantas += 1;
    }
    if (cuantas < 6) break;
    // Centrado: covarianzas.
    const mu = su / cuantas, mv = sv / cuantas, mh = sh / cuantas;
    const cuu = suu / cuantas - mu * mu, cvv = svv / cuantas - mv * mv, cuv = suv / cuantas - mu * mv;
    const cuh = suh / cuantas - mu * mh, cvh = svh / cuantas - mv * mh;
    const det = cuu * cvv - cuv * cuv;
    if (Math.abs(det) < 1e-9) break;
    const a = (cuh * cvv - cvh * cuv) / det, b = (cvh * cuu - cuh * cuv) / det;
    n = unitario(suma(suma(n, e1, -a), e2, -b));
  }
  return n;
}

/**
 * Cuánto sobresale la superficie (medido a lo largo de `n`, desde el plano que pasa por `p`) bajo un disco de radio
 * `radioCm` centrado en `p` y perpendicular a `n`: el centro y dos anillos de 8 muestras (como `decorarPared`). Solo
 * cuentan los globos cercanos (no la cara de atrás de una columna ni la otra pata de un arco). `-Infinity` si no hay.
 */
export function alturaBajoDisco(cuerpos: readonly CuerpoGlobo[], p: Vec3, n: Vec3, radioCm: number): number {
  const normal = unitario(n);
  const auxiliar: Vec3 = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const e1 = unitario(cruz(auxiliar, normal)), e2 = cruz(normal, e1);
  const muestras: Vec3[] = [p];
  for (const f of [0.3, 0.6]) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    muestras.push(suma(suma(p, e1, Math.cos(a) * radioCm * f), e2, Math.sin(a) * radioCm * f));
  }
  const cerca = cuerpos.filter((k) => largo(resta(k.c, p)) < radioCm + k.r + 10);
  return Math.max(...muestras.map((q) => alturaEn(cerca, q, normal)));
}

/**
 * La espalda de una decoración armada en su espacio propio (mirando a +y): muestras (x, z) con la altura `y` de lo
 * más atrasado ahí (el fondo de cada globo y de cada tramo de tubito). Sirve para apoyarla de verdad sobre los globos
 * de debajo, no por su caja (una flor toca con su centro, no con la punta de sus pétalos).
 */
export function espaldaDe(armada: { globos: readonly GloboConCuerpo[]; tubos: ReadonlyArray<{ puntos: readonly Vec3[]; grosorCm: number }> }): Vec3[] {
  const salida: Vec3[] = [];
  for (const k of cuerposDeGlobos(armada.globos)) {
    salida.push({ x: k.c.x, y: k.c.y - k.r, z: k.c.z });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * 2 * Math.PI; salida.push({ x: k.c.x + Math.cos(a) * k.r * 0.5, y: k.c.y - k.r * 0.866, z: k.c.z + Math.sin(a) * k.r * 0.5 }); }
  }
  for (const t of armada.tubos) {
    const paso = Math.max(1, Math.floor(t.puntos.length / 12));
    for (let i = 0; i < t.puntos.length; i += paso) { const q = t.puntos[i]!; salida.push({ x: q.x, y: q.y - t.grosorCm / 2, z: q.z }); }
  }
  return salida;
}

/**
 * Cuánto hay que correr una decoración a lo largo de `n` (desde donde la deja `aMundo` con corrimiento 0) para que su
 * espalda toque la superficie: lo más que asoma la superficie sobre cada muestra de la espalda. `-Infinity` si
 * ninguna muestra tiene globos debajo.
 */
export function contactoDeEspalda(cuerpos: readonly CuerpoGlobo[], espalda: readonly Vec3[], aMundo: (v: Vec3) => Vec3, p: Vec3, n: Vec3, radioCm: number): number {
  const normal = unitario(n);
  const cerca = cuerpos.filter((k) => largo(resta(k.c, p)) < radioCm + k.r + 10);
  let mejor = -Infinity;
  for (const e of espalda) {
    const q = aMundo({ x: e.x, y: 0, z: e.z });
    mejor = Math.max(mejor, alturaEn(cerca, q, normal) - e.y);
  }
  return mejor;
}

/** El punto de la superficie más cercano a `p` (sobre el globo más cercano) y su distancia; `null` sin globos. */
export function superficieMasCercana(cuerpos: readonly CuerpoGlobo[], p: Vec3): { punto: Vec3; distancia: number } | null {
  let mejor: { punto: Vec3; distancia: number } | null = null;
  for (const k of cuerpos) {
    const v = resta(p, k.c);
    const d = largo(v);
    const distancia = Math.abs(d - k.r);
    if (mejor && distancia >= mejor.distancia) continue;
    mejor = { punto: d < 1e-9 ? suma(k.c, { x: 0, y: 0, z: 1 }, k.r) : suma(k.c, v, k.r / d), distancia };
  }
  return mejor;
}
