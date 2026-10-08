import { formatoPorId, infladoValido } from "./formatos";
import type { Vec3 } from "./modulos";
import type { GloboDecoracion, TuboDecoracion } from "./decoraciones";
import { materialesDecoracion, type MaterialDecoracion } from "./figuras";
import { exigirColor, globoEn } from "./letras";
import { crearAzar } from "./organico";
import { RADIO_TRENZA_POR_DIAMETRO, PASO_POR_DIAMETRO } from "./trenza";

/**
 * **Palmeras y árboles de globos.**
 *
 * - **Tronco**: cuartetos apretados (como la trenza de `trenza.ts`: cada globo a 0,62 inflados del eje, cada nivel girado
 *   1/8 de vuelta y a 0,8 inflados del anterior) a lo largo de un eje que puede **curvarse** (la punta se corre
 *   `curvaCm` a un lado, como el tronco de una palmera) y **afinarse** (inflado de la base a la punta). Colores de
 *   abajo arriba (uno o un degradado por niveles), acentos chicos (R-5) en los huecos y, si se pide, un anillo de
 *   globos más grandes al pie.
 * - **Copa de palmera**: hojas de tubito (T-260, T-360 o Link-O-Loon 660) que nacen de la punta del tronco, suben y se
 *   doblan hacia abajo como una fronda, repartidas alrededor; cocos (redondos chicos) colgando bajo las hojas.
 * - **Copa de racimos**: una esfera (o media esfera achatada) cubierta de racimos de cuatro globos que miran hacia
 *   fuera, cada racimo de un color (mezcla determinista por `semilla`), con frutas (R-5) en el centro de algunos.
 *
 * Espacio local: cm, y hacia arriba con la base del tronco apoyada en el piso (lo más bajo de los globos en y = 0),
 * centrado en x/z en el pie del tronco, +z hacia quien mira. Los colores se exigen del formato.
 */

export type TroncoArbol = {
  formatoId: string;
  infladoBaseCm: number;
  infladoPuntaCm: number;
  altoCm: number;
  /** De abajo arriba: un color, o varios en degradado por niveles. */
  colores: string[];
  /** Cuánto se corre la punta hacia +x (la curva de la palmera); 0 = recto. */
  curvaCm: number;
  /** Globitos en los huecos del tronco (uno de cada `cada`). */
  acento?: { formatoId: string; infladoCm: number; codigo: string; cada?: number } | null;
  /** Anillo de globos al pie (más grandes que los del tronco). */
  base?: { formatoId: string; infladoCm: number; codigo: string; cantidad: number } | null;
};

export type CopaPalmera = {
  tipo: "palmera";
  hojas: { formatoId: string; codigos: string[]; cantidad: number; largoCm: number };
  cocos?: { formatoId: string; infladoCm: number; codigo: string; cantidad: number } | null;
};

export type CopaRacimos = {
  tipo: "racimos";
  diametroCm: number;
  /** 1 = esfera; menos, achatada (hongo, brócoli). */
  achatado: number;
  globo: { formatoId: string; infladoCm: number };
  colores: string[];
  pesos?: number[];
  semilla: number;
  frutas?: { formatoId: string; infladoCm: number; codigo: string; cantidad: number } | null;
};

export type OpcionesArbolGlobos = { tronco: TroncoArbol; copa: CopaPalmera | CopaRacimos };

export type ArbolArmado = {
  globos: GloboDecoracion[];
  tubos: TuboDecoracion[];
  anclas: Array<{ posicion: Vec3; normal: Vec3 }>;
  materiales: MaterialDecoracion[];
  /** El eje del tronco (para ver que se apoya y se curva). */
  eje: Vec3[];
};

const r1 = (n: number) => Math.round(n * 10) / 10 + 0;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const mas = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const por = (a: Vec3, k: number): Vec3 => v(a.x * k, a.y * k, a.z * k);
const unitario = (a: Vec3): Vec3 => { const n = Math.hypot(a.x, a.y, a.z) || 1; return por(a, 1 / n); };
const cruz = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const redondo = (p: Vec3): Vec3 => v(r1(p.x), r1(p.y), r1(p.z));

function formato(id: string, tipos: ReadonlyArray<"redondo" | "link" | "tubito">) {
  const f = formatoPorId(id);
  if (!f) throw new Error(`Formato desconocido: ${id}`);
  if (!tipos.includes(f.tipo as "redondo" | "link" | "tubito")) throw new Error(`${id} no sirve aquí (va ${tipos.join(" o ")}).`);
  return f;
}

/** El eje del tronco: de (0, y0) a la punta, curvándose hacia +x (parábola: arranca vertical). */
function ejeTronco(t: TroncoArbol, y0: number): { punto: (s: number) => Vec3; tangente: (s: number) => Vec3 } {
  const H = Math.max(10, t.altoCm), c = t.curvaCm;
  return {
    punto: (s) => v(c * s * s, y0 + H * s, 0),
    tangente: (s) => unitario(v(2 * c * s, H, 0)),
  };
}

function armarTronco(t: TroncoArbol, globos: GloboDecoracion[], anclas: ArbolArmado["anclas"]): { punta: Vec3; tangente: Vec3; dPunta: number; eje: Vec3[] } {
  const f = formato(t.formatoId, ["redondo"]);
  if (!t.colores.length) throw new Error("El tronco necesita al menos un color.");
  for (const c of t.colores) exigirColor(f.id, c);
  const dB = infladoValido(f, t.infladoBaseCm), dP = infladoValido(f, t.infladoPuntaCm);
  let y0 = 0;
  if (t.base && t.base.cantidad > 0) {
    const fb = formato(t.base.formatoId, ["redondo"]);
    exigirColor(fb.id, t.base.codigo);
    const db = infladoValido(fb, t.base.infladoCm);
    const n = Math.max(3, Math.round(t.base.cantidad));
    const rho = (0.88 * db) / (2 * Math.sin(Math.PI / n));
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
      const radial = v(Math.cos(a), 0, Math.sin(a));
      globos.push(globoEn(fb.id, db, t.base.codigo, redondo(v(radial.x * rho, db / 2, radial.z * rho)), unitario(v(radial.x, 0.25, radial.z))));
    }
    y0 = db * 0.75;
  }
  const eje = ejeTronco(t, y0 + dB * 0.45);
  // Niveles por largo de eje: cada uno a 0,8 de su inflado del anterior.
  const muestras = 200;
  const largos: number[] = [0];
  for (let i = 1; i <= muestras; i++) largos.push(largos[i - 1]! + Math.hypot(eje.punto(i / muestras).x - eje.punto((i - 1) / muestras).x, eje.punto(i / muestras).y - eje.punto((i - 1) / muestras).y));
  const total = largos[muestras]!;
  const sDeLargo = (l: number) => { let i = 0; while (i < muestras && largos[i + 1]! < l) i++; const a = largos[i]!, b = largos[i + 1] ?? a; return (i + (b > a ? (l - a) / (b - a) : 0)) / muestras; };
  const niveles: Array<{ s: number; d: number; giro: number }> = [];
  let l = 0, giro = 0;
  while (l <= total + 0.01) {
    const s = Math.min(1, sDeLargo(l));
    const d = dB + (dP - dB) * s;
    niveles.push({ s, d, giro });
    l += d * PASO_POR_DIAMETRO;
    giro += Math.PI / 4;
  }
  const n = niveles.length;
  const ejeMuestras: Vec3[] = [];
  niveles.forEach((nv, k) => {
    const p = eje.punto(nv.s), T = eje.tangente(nv.s);
    ejeMuestras.push(redondo(p));
    const lado = unitario(cruz(T, v(0, 0, 1))), fuera = v(0, 0, 1);
    const codigo = t.colores[Math.min(t.colores.length - 1, Math.floor((k / n) * t.colores.length))]!;
    for (let q = 0; q < 4; q++) {
      const a = nv.giro + (q * Math.PI) / 2;
      const radial = mas(por(lado, Math.cos(a)), por(fuera, Math.sin(a)));
      globos.push(globoEn(f.id, r1(nv.d), codigo, redondo(mas(p, por(radial, nv.d * RADIO_TRENZA_POR_DIAMETRO))), unitario(mas(radial, por(T, 0.12)))));
    }
    if (k % 3 === 1) anclas.push({ posicion: redondo(mas(p, por(fuera, nv.d * (RADIO_TRENZA_POR_DIAMETRO + 0.5)))), normal: fuera });
  });
  if (t.acento) {
    const fa = formato(t.acento.formatoId, ["redondo"]);
    exigirColor(fa.id, t.acento.codigo);
    const da = infladoValido(fa, t.acento.infladoCm);
    const cada = Math.max(1, Math.round(t.acento.cada ?? 1));
    let cuenta = 0;
    for (let k = 0; k + 1 < n; k++) {
      const a0 = niveles[k]!, a1 = niveles[k + 1]!;
      const s = (a0.s + a1.s) / 2, d = (a0.d + a1.d) / 2;
      const p = eje.punto(s), T = eje.tangente(s);
      const lado = unitario(cruz(T, v(0, 0, 1))), fuera = v(0, 0, 1);
      for (let q = 0; q < 4; q++) {
        // Encima de un globo del nivel de abajo, entre dos del de arriba: el hueco.
        const a = a0.giro + (q * Math.PI) / 2;
        const radial = mas(por(lado, Math.cos(a)), por(fuera, Math.sin(a)));
        if (cuenta++ % cada !== 0) continue;
        globos.push(globoEn(fa.id, da, t.acento.codigo, redondo(mas(p, por(radial, d * (RADIO_TRENZA_POR_DIAMETRO + 0.5) + da * 0.1))), radial));
      }
    }
  }
  const ultimo = niveles[n - 1]!;
  return { punta: eje.punto(ultimo.s), tangente: eje.tangente(ultimo.s), dPunta: ultimo.d, eje: ejeMuestras };
}

function armarPalmera(c: CopaPalmera, punta: Vec3, tangente: Vec3, dPunta: number, globos: GloboDecoracion[], tubos: TuboDecoracion[], anclas: ArbolArmado["anclas"]): void {
  const fh = formato(c.hojas.formatoId, ["tubito", "link"]);
  if (fh.tipo === "link" && !fh.largoCm) throw new Error("Las hojas de Link-O-Loon van con el LOL-660 (largo).");
  if (!c.hojas.codigos.length) throw new Error("Las hojas necesitan al menos un color.");
  for (const x of c.hojas.codigos) exigirColor(fh.id, x);
  const grosor = fh.infladoDecoracionCm;
  const nace = mas(punta, por(tangente, dPunta * 0.55));
  const n = Math.max(3, Math.round(c.hojas.cantidad));
  for (let k = 0; k < n; k++) {
    // Repartidas alrededor; unas más paradas y otras más caídas, unas más largas.
    const phi = (k * 2 * Math.PI) / n + 0.35;
    const subida = (k % 2 === 0 ? 62 : 38) * (Math.PI / 180);
    const largo = c.hojas.largoCm * (k % 3 === 0 ? 1 : k % 3 === 1 ? 0.9 : 0.8);
    const caida = (k % 2 === 0 ? 75 : 85) * (Math.PI / 180);
    const horizontal = v(Math.cos(phi), 0, Math.sin(phi));
    const puntos: Vec3[] = [];
    let p = nace;
    const pasos = 16;
    for (let s = 0; s <= pasos; s++) {
      puntos.push(redondo(p));
      const t = s / pasos;
      // El ángulo sobre la horizontal baja de `subida` a −`caida` a lo largo de la hoja (se arquea).
      const ang = subida - (subida + caida) * t ** 1.4;
      p = mas(p, por(mas(por(horizontal, Math.cos(ang)), v(0, Math.sin(ang), 0)), largo / pasos));
    }
    tubos.push({ formatoId: fh.id, grosorCm: grosor, codigo: c.hojas.codigos[k % c.hojas.codigos.length]!, puntos, cerrado: false });
    const medio = puntos[Math.floor(pasos / 2)]!;
    anclas.push({ posicion: medio, normal: unitario(mas(horizontal, v(0, 0.6, 0))) });
  }
  if (c.cocos && c.cocos.cantidad > 0) {
    const fc = formato(c.cocos.formatoId, ["redondo"]);
    exigirColor(fc.id, c.cocos.codigo);
    const dc = infladoValido(fc, c.cocos.infladoCm);
    const m = Math.max(1, Math.round(c.cocos.cantidad));
    const rho = m === 1 ? 0 : (0.9 * dc) / (2 * Math.sin(Math.PI / m));
    for (let k = 0; k < m; k++) {
      // Colgando bajo la corona, alrededor del tronco y un poco por fuera de él.
      const a = (k * 2 * Math.PI) / m + 0.2;
      const radial = v(Math.cos(a), 0, Math.sin(a));
      const centro = mas(nace, v(radial.x * (rho + dPunta * 0.55), -dc * 0.55, radial.z * (rho + dPunta * 0.55)));
      globos.push(globoEn(fc.id, dc, c.cocos.codigo, redondo(centro), unitario(v(radial.x, -1, radial.z))));
    }
  }
}

function armarCopaRacimos(c: CopaRacimos, punta: Vec3, dPunta: number, globos: GloboDecoracion[], anclas: ArbolArmado["anclas"]): void {
  const f = formato(c.globo.formatoId, ["redondo"]);
  if (!c.colores.length) throw new Error("La copa necesita al menos un color.");
  for (const x of c.colores) exigirColor(f.id, x);
  const d = infladoValido(f, c.globo.infladoCm);
  const achatado = Math.max(0.5, Math.min(1, c.achatado));
  const R = Math.max(d, c.diametroCm / 2 - d * 0.6);
  // El centro de la copa: su parte de abajo abraza la punta del tronco.
  const centro = mas(punta, v(0, R * achatado * 0.7 + dPunta * 0.3, 0));
  // Racimos de cuatro en puntos de Fibonacci sobre el elipsoide: tantos como caben por área.
  const huella = Math.PI * (1.02 * d) ** 2;
  const area = 4 * Math.PI * R * R * (0.35 + 0.65 * achatado);
  const total = Math.max(6, Math.round(area / huella));
  const azar = crearAzar(c.semilla * 7919 + 17);
  const pesos = c.colores.map((_, i) => Math.max(0, c.pesos?.[i] ?? 1));
  const suma = pesos.reduce((s, x) => s + x, 0) || 1;
  const color = () => { let r = azar() * suma; for (let i = 0; i < c.colores.length; i++) { r -= pesos[i]!; if (r <= 0) return c.colores[i]!; } return c.colores[c.colores.length - 1]!; };
  const oro = Math.PI * (3 - Math.sqrt(5));
  const racimos: Array<{ p: Vec3; n: Vec3 }> = [];
  for (let i = 0; i < total; i++) {
    const y = 1 - (2 * (i + 0.5)) / total;
    if (y < -0.8) continue; // por donde entra el tronco
    const rr = Math.sqrt(1 - y * y), a = i * oro;
    const u = v(Math.cos(a) * rr, y, Math.sin(a) * rr);
    const n = unitario(v(u.x, u.y / achatado, u.z));
    racimos.push({ p: mas(centro, v(u.x * R, u.y * R * achatado, u.z * R)), n });
  }
  racimos.forEach(({ p, n }, k) => {
    const codigo = color();
    const aux = Math.abs(n.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
    const e1 = unitario(cruz(n, aux)), e2 = cruz(n, e1);
    const rho = (0.9 * d) / Math.SQRT2 * 0.82;
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2 + k;
      const radial = mas(por(e1, Math.cos(a)), por(e2, Math.sin(a)));
      globos.push(globoEn(f.id, d, codigo, redondo(mas(p, por(radial, rho))), unitario(mas(por(n, 0.75), por(radial, 0.66)))));
    }
    if (k % 2 === 0) anclas.push({ posicion: redondo(mas(p, por(n, d * 0.55))), normal: n });
  });
  if (c.frutas && c.frutas.cantidad > 0) {
    const ff = formato(c.frutas.formatoId, ["redondo"]);
    exigirColor(ff.id, c.frutas.codigo);
    const df = infladoValido(ff, c.frutas.infladoCm);
    // En el centro de los racimos que miran al frente y en el hueco entre dos racimos vecinos, repartidas: primero las de
    // más adelante, sin dos frutas juntas.
    const sitios: Array<{ p: Vec3; n: Vec3 }> = racimos.map(({ p, n }) => ({ p: mas(p, por(n, d * 0.42)), n }));
    racimos.forEach((a, i) => racimos.forEach((b, j) => {
      if (j <= i || Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y, a.p.z - b.p.z) > 2.6 * d) return;
      const n = unitario(mas(a.n, b.n));
      const m = por(mas(a.p, b.p), 0.5);
      sitios.push({ p: mas(m, por(n, d * 0.55)), n });
    }));
    const delante = sitios.filter((x) => x.n.z > 0.2).sort((a, b) => b.n.z - a.n.z || b.p.y - a.p.y || a.p.x - b.p.x);
    const elegidos: Array<{ p: Vec3; n: Vec3 }> = [];
    for (const x of delante) {
      if (elegidos.length >= Math.round(c.frutas.cantidad)) break;
      if (elegidos.some((e) => Math.hypot(e.p.x - x.p.x, e.p.y - x.p.y, e.p.z - x.p.z) < d * 1.3)) continue;
      elegidos.push(x);
    }
    for (const x of elegidos) globos.push(globoEn(ff.id, df, c.frutas.codigo, redondo(x.p), x.n));
  }
}

export function armarArbolGlobos(o: OpcionesArbolGlobos): ArbolArmado {
  const globos: GloboDecoracion[] = [];
  const tubos: TuboDecoracion[] = [];
  const anclas: ArbolArmado["anclas"] = [];
  const tronco = armarTronco(o.tronco, globos, anclas);
  if (o.copa.tipo === "palmera") armarPalmera(o.copa, tronco.punta, tronco.tangente, tronco.dPunta, globos, tubos, anclas);
  else armarCopaRacimos(o.copa, tronco.punta, tronco.dPunta, globos, anclas);
  // Apoyado en el piso: lo más bajo de los globos en y = 0 (los tubitos van arriba).
  let piso = Infinity;
  // (como lo mide la caja de la pieza: el cuerpo de cada globo como una esfera a medio globo del nudo)
  for (const g of globos) piso = Math.min(piso, g.nudo.y + g.direccion.y * (g.infladoCm / 2 + g.cuelloExtraCm) - g.infladoCm / 2);
  for (const t of tubos) for (const p of t.puntos) piso = Math.min(piso, p.y - t.grosorCm / 2);
  const dy = Number.isFinite(piso) ? -piso : 0;
  const bajar = (p: Vec3): Vec3 => redondo(v(p.x, p.y + dy, p.z));
  return {
    globos: globos.map((g) => ({ ...g, nudo: bajar(g.nudo) })),
    tubos: tubos.map((t) => ({ ...t, puntos: t.puntos.map(bajar) })),
    anclas: anclas.map((a) => ({ posicion: bajar(a.posicion), normal: a.normal })),
    materiales: materialesDecoracion(globos, tubos),
    eje: tronco.eje.map(bajar),
  };
}

// ----------------------------------------------------------------------------------------------------------
// Árboles de muestra (Decoraciones pequeñas)
// ----------------------------------------------------------------------------------------------------------

export const ARBOLES_PREDEFINIDOS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; arbol: OpcionesArbolGlobos }> = [
  {
    id: "arbol_palmera_curva", nombre: "Palmera curva", descripcion: "Tronco café de cuartetos que se curva, 9 hojas T-260 verde selva y 3 cocos.",
    arbol: {
      tronco: { formatoId: "R-9", infladoBaseCm: 20, infladoPuntaCm: 16, altoCm: 130, colores: ["074"], curvaCm: 30, base: { formatoId: "R-12", infladoCm: 26, codigo: "074", cantidad: 4 } },
      copa: { tipo: "palmera", hojas: { formatoId: "T-260", codigos: ["032", "029"], cantidad: 9, largoCm: 85 }, cocos: { formatoId: "R-12", infladoCm: 16, codigo: "076", cantidad: 3 } },
    },
  },
  {
    id: "arbol_racimos", nombre: "Árbol de racimos", descripcion: "Tronco chocolate y copa redonda de racimos verdes con manzanitas.",
    arbol: {
      tronco: { formatoId: "R-12", infladoBaseCm: 22, infladoPuntaCm: 18, altoCm: 90, colores: ["076"], curvaCm: 0, acento: { formatoId: "R-5", infladoCm: 9, codigo: "074", cada: 3 } },
      copa: { tipo: "racimos", diametroCm: 95, achatado: 0.85, globo: { formatoId: "R-9", infladoCm: 18 }, colores: ["031", "030"], semilla: 3, frutas: { formatoId: "R-5", infladoCm: 11, codigo: "015", cantidad: 6 } },
    },
  },
];

/** La palmera o el árbol en inglés corto (para el prompt de la imagen). */
export function arbolEnIngles(o: OpcionesArbolGlobos): string {
  return o.copa.tipo === "palmera"
    ? `a balloon palm tree with a ${o.tronco.curvaCm ? "curved " : ""}trunk of stacked balloon clusters and long twisting balloon fronds${o.copa.cocos ? " with balloon coconuts" : ""}`
    : `a balloon tree with a column trunk and a round canopy of balloon clusters${o.copa.frutas ? " dotted with small balloon fruits" : ""}`;
}
