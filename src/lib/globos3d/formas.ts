import { formatoPorId, infladoValido } from "./formatos";
import { contornoCorazon } from "./geometria";
import type { Vec3 } from "./modulos";
import { armarColumna } from "./columnas";
import { armarOrganico, crearAzar, formaColumna, RELLENO_TUPIDO, type ColorOrganico, type OpcionesOrganico, type RellenoOrganico, type TramoOrganico } from "./organico";
import { INFLADOS_ORGANICOS } from "./estructuras-organicas";
import { materialesDecoracion, type MaterialDecoracion } from "./figuras";
import type { GloboDecoracion, TuboDecoracion } from "./decoraciones";
import { LARGO_ESLABON_POR_DIAMETRO } from "./paredes";
import { centroDe, componerTexto, distanciaASegmento, distanciaATrazo, exigirColor, globoEn, largoPolilinea, repartirEnPolilinea, type DisposicionTexto, type P2, type Trazo } from "./letras";

/**
 * **Formas rellenas, siluetas y volúmenes de globos.**
 *
 * 1. **Forma rellena por contorno 2D.** Un contorno (corazón, estrella, círculo, aro, ancla, cruz, nube, castillo, la
 *    silueta de un texto o uno libre) se convierte en una *región*: una función que da, para cada punto del plano, la
 *    distancia al borde (positiva dentro). Con ella se rellena con una de tres técnicas:
 *    - **celdas** («pixel»): una hilera de globos siguiendo el borde (por dentro, a medio globo) y el interior en
 *      retícula cuadrada o al tresbolillo; los huecos grandes que quedan se tapan con otro globo igual;
 *    - **malla** de Link-O-Loon: la cadeneta del borde (eslabones siguiendo el contorno) y dentro la malla diagonal
 *      de `paredes.ts`, con su pareja de unión en cada nudo;
 *    - **orgánica**: el motor orgánico (`armarOrganico`, sin tocarlo) sobre el esqueleto de la forma (los rayos de la
 *      estrella, los trazos de un número) o, si no tiene, sobre franjas horizontales que barren el contorno.
 *    Opcional: el **borde** de otro color, un **marco** (solo una franja de ese ancho junto al borde: el centro queda
 *    hueco, el marco de fotos) y **acentos**: globitos de otro tamaño metidos en los huecos entre tres o cuatro globos
 *    (las «esferas» rojas de un árbol, el champaña entre el latte).
 * 2. **Volúmenes**: esfera geodésica (cada globo en un vértice de una geodésica de icosaedro: cinco o seis vecinos,
 *    los pentágonos y hexágonos), cono de anillos que se achican (el árbol de Navidad de cuartetos) o cono orgánico,
 *    árbol (tronco de columna y copa esférica, achatada si se quiere) y globo aerostático (esfera, cuerdas y canasta).
 *
 * Espacio local: cm, x a la derecha (centrado), y hacia arriba (apoyado en y = 0), +z hacia quien mira. Los colores
 * se exigen del formato (`coloresDelFormato`): uno que no se fabrica es un error, no se cambia a escondidas.
 */

// ----------------------------------------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------------------------------------

export type ContornoPredefinido = "corazon" | "estrella" | "circulo" | "aro" | "ancla" | "cruz" | "nube" | "castillo";

export const CONTORNOS_PREDEFINIDOS: ReadonlyArray<{ id: ContornoPredefinido; nombre: string }> = [
  { id: "corazon", nombre: "Corazón" }, { id: "estrella", nombre: "Estrella" }, { id: "circulo", nombre: "Círculo" }, { id: "aro", nombre: "Aro" },
  { id: "ancla", nombre: "Ancla" }, { id: "cruz", nombre: "Cruz" }, { id: "nube", nombre: "Nube" }, { id: "castillo", nombre: "Castillo" },
];

export type ContornoForma =
  | { tipo: "predefinido"; id: ContornoPredefinido; anchoCm: number; altoCm: number }
  /** La silueta de un texto: cada trazo del esqueleto con `grosorCm` de ancho. */
  | { tipo: "texto"; texto: string; altoCm: number; grosorCm: number; disposicion?: DisposicionTexto }
  /** Polígono libre (cm, y hacia arriba) y, si se quiere, huecos (polígonos dentro). */
  | { tipo: "libre"; puntos: P2[]; huecos?: P2[][] };

export type TecnicaRelleno =
  | { tipo: "celdas"; formatoId: string; infladoCm: number; celda: "cuadrada" | "tresbolillo" }
  | { tipo: "malla"; formatoId: string; infladoCm: number; union: { infladoCm: number; codigo: string } }
  /** `radioCm`: medio grosor de la capa (la envoltura del motor). `mezcla`: pesos por formato («R-12», «R-5»…). */
  | { tipo: "organico"; radioCm: number; mezcla: Readonly<Record<string, number>>; semilla: number; /** Inflado por formato (cm); si falta, el de la técnica orgánica. */ inflados?: Readonly<Record<string, number>> };

export type PatronColorForma = "un_color" | "degradado" | "franjas" | "mezcla" | "alternado";

/**
 * Colores de la forma (códigos Sempertex). `degradado`: por bandas a lo largo de `anguloGrados` (90 = de abajo
 * arriba; el primer color en el origen), con el borde entre bandas un poco irregular; `franjas`: horizontales de
 * `franjaCm` (o, en los volúmenes por niveles, de `franjaNiveles` niveles); `mezcla`: al azar con `pesos`
 * (determinista por `semilla`); `alternado`: uno tras otro (en un anillo de un cono, gira en espiral).
 */
export type ColoresForma = { codigos: string[]; patron: PatronColorForma; anguloGrados?: number; franjaCm?: number; franjaNiveles?: number; pesos?: number[]; semilla?: number };

/** Globitos metidos en los huecos entre los globos de la forma: uno de cada `cada` huecos (1 = todos). */
export type AcentoForma = { formatoId: string; infladoCm: number; codigos: string[]; cada?: number };

export type OpcionesRellena = {
  clase: "rellena";
  contorno: ContornoForma;
  tecnica: TecnicaRelleno;
  colores: ColoresForma;
  /** La hilera del borde de otro color (técnicas de celdas y malla). */
  borde?: { codigo: string } | null;
  /** Solo una franja de este ancho junto al borde: el centro queda hueco (marco de fotos). */
  marcoCm?: number | null;
  acento?: AcentoForma | null;
};

export type GloboVolumen = { formatoId: string; infladoCm: number };

export type OpcionesEsfera = { clase: "esfera"; diametroCm: number; globo: GloboVolumen; colores: ColoresForma; acento?: AcentoForma | null; /** Achata la esfera en vertical (1 = redonda). */ achatado?: number };

export type OpcionesCono = {
  clase: "cono";
  altoCm: number;
  tecnica: "anillos" | "organico";
  formatoId: string;
  /** Inflado de los globos de abajo y de arriba (se achican a lo largo). */
  infladoBaseCm: number;
  infladoPuntaCm: number;
  /** Globos por anillo abajo y arriba (4 = cuarteto, 6 = sexteto). */
  globosBase: number;
  globosPunta: number;
  colores: ColoresForma;
  acento?: AcentoForma | null;
  /** Un globo en la punta. */
  remate?: { formatoId: string; infladoCm: number; codigo: string } | null;
  /** Solo en la orgánica: mezcla de tamaños y semilla. */
  mezcla?: Readonly<Record<string, number>>;
  semilla?: number;
};

export type OpcionesArbol = {
  clase: "arbol";
  /** Tronco: columna de cuartetos de un color. */
  tronco: { altoCm: number; formatoId: string; infladoCm: number; codigo: string };
  copa: { diametroCm: number; globo: GloboVolumen; colores: ColoresForma; achatado: number; acento?: AcentoForma | null };
};

export type OpcionesAerostatico = {
  clase: "aerostatico";
  globo: { diametroCm: number; globo: GloboVolumen; colores: ColoresForma; acento?: AcentoForma | null };
  /** Canasta: anillos de globos apilados. */
  canasta: { formatoId: string; infladoCm: number; codigo: string; porAnillo: number; anillos: number };
  /** Lo que queda entre la canasta y el globo (las cuerdas). */
  cuerdasCm: number;
};

export type OpcionesForma = OpcionesRellena | OpcionesEsfera | OpcionesCono | OpcionesArbol | OpcionesAerostatico;
export type ClaseForma = OpcionesForma["clase"];

export type GloboDeForma = GloboDecoracion & { confeti?: boolean };

export type FormaArmada = {
  globos: GloboDeForma[];
  tubos: TuboDecoracion[];
  anclas: Array<{ posicion: Vec3; normal: Vec3 }>;
  materiales: MaterialDecoracion[];
  avisos: string[];
};

// ----------------------------------------------------------------------------------------------------------
// Regiones 2D
// ----------------------------------------------------------------------------------------------------------

export type Caja2 = { minX: number; minY: number; maxX: number; maxY: number };

/** Un trazo del esqueleto para la técnica orgánica: el radio de la capa al inicio y al final. */
export type TrazoEsqueleto = { puntos: P2[]; cerrado: boolean; radioInicioCm: number; radioFinCm: number };

/**
 * Una región del plano: `distancia(x, y)` es la distancia al borde (positiva dentro, negativa fuera; dentro puede
 * quedarse corta en las uniones, nunca se pasa). `esqueleto`: por dónde va el eje de la forma, si lo tiene.
 */
export type Region = { caja: Caja2; distancia: (x: number, y: number) => number; esqueleto?: TrazoEsqueleto[] };

const r1 = (n: number) => Math.round(n * 10) / 10;

function cajaDePuntos(puntos: readonly P2[], margen = 0): Caja2 {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of puntos) { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); }
  return { minX: minX - margen, minY: minY - margen, maxX: maxX + margen, maxY: maxY + margen };
}

/** Región de uno o varios polígonos (par-impar: un anillo dentro de otro es un hueco). */
export function regionPoligonos(anillos: readonly P2[][]): Region {
  const caja = cajaDePuntos(anillos.flat());
  return {
    caja,
    distancia: (x, y) => {
      let dentro = false, min = Infinity;
      for (const anillo of anillos) {
        for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
          const a = anillo[j]!, b = anillo[i]!;
          if ((b.y > y) !== (a.y > y) && x < ((a.x - b.x) * (y - b.y)) / (a.y - b.y) + b.x) dentro = !dentro;
          min = Math.min(min, distanciaASegmento(x, y, a, b));
        }
      }
      return dentro ? min : -min;
    },
  };
}

/** Región de trazos con grosor (cada uno, una «salchicha» de su ancho). */
export function regionTrazos(trazos: ReadonlyArray<Trazo & { grosorCm: number }>): Region {
  const caja = cajaDePuntos(trazos.flatMap((t) => t.puntos), Math.max(0, ...trazos.map((t) => t.grosorCm / 2)));
  return { caja, distancia: (x, y) => trazos.reduce((m, t) => Math.max(m, t.grosorCm / 2 - distanciaATrazo(x, y, t)), -Infinity) };
}

/** Unión de regiones (la distancia de dentro es la mayor: se queda corta en las costuras, nunca se pasa). */
export function unirRegiones(regiones: readonly Region[]): Region {
  const cajas = regiones.map((r) => r.caja);
  return {
    caja: { minX: Math.min(...cajas.map((c) => c.minX)), minY: Math.min(...cajas.map((c) => c.minY)), maxX: Math.max(...cajas.map((c) => c.maxX)), maxY: Math.max(...cajas.map((c) => c.maxY)) },
    distancia: (x, y) => regiones.reduce((m, r) => Math.max(m, r.distancia(x, y)), -Infinity),
  };
}

/** Solo la franja de `anchoCm` junto al borde: lo de más adentro es hueco. */
export function regionMarco(region: Region, anchoCm: number): Region {
  return { caja: region.caja, distancia: (x, y) => { const d = region.distancia(x, y); return Math.min(d, anchoCm - d); } };
}

function trasladarRegion(region: Region, dx: number, dy: number): Region {
  return {
    caja: { minX: region.caja.minX + dx, minY: region.caja.minY + dy, maxX: region.caja.maxX + dx, maxY: region.caja.maxY + dy },
    distancia: (x, y) => region.distancia(x - dx, y - dy),
    ...(region.esqueleto ? { esqueleto: region.esqueleto.map((t) => ({ ...t, puntos: t.puntos.map((q) => ({ x: q.x + dx, y: q.y + dy })) })) } : {}),
  };
}

/** Deja la región centrada en x = 0 y apoyada en y = 0. */
function apoyar(region: Region): Region {
  return trasladarRegion(region, -(region.caja.minX + region.caja.maxX) / 2, -region.caja.minY);
}

/** Polígono normalizado (x en −0,5…0,5, y en 0…1) llevado a ancho × alto. */
const escalar = (puntos: ReadonlyArray<readonly [number, number]>, ancho: number, alto: number): P2[] => puntos.map(([x, y]) => ({ x: x * ancho, y: y * alto }));

function normalizarPuntos(puntos: readonly P2[]): Array<[number, number]> {
  const c = cajaDePuntos(puntos);
  const w = c.maxX - c.minX || 1, h = c.maxY - c.minY || 1;
  return puntos.map((q) => [(q.x - c.minX) / w - 0.5, (q.y - c.minY) / h]);
}

function poligonoEstrella(puntas: number, interior: number): P2[] {
  const salida: P2[] = [];
  for (let k = 0; k < 2 * puntas; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / puntas;
    const r = k % 2 === 0 ? 1 : interior;
    salida.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return salida;
}

function circuloPuntos(cx: number, cy: number, rx: number, ry: number, n = 72): P2[] {
  return Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((2 * Math.PI * i) / n), y: cy + ry * Math.sin((2 * Math.PI * i) / n) }));
}

const CASTILLO: ReadonlyArray<readonly [number, number]> = [
  [-0.5, 0], [0.5, 0], [0.5, 1], [0.42, 1], [0.42, 0.91], [0.33, 0.91], [0.33, 1], [0.25, 1], [0.25, 0.68], [0.17, 0.68], [0.17, 0.6], [0.08, 0.6], [0.08, 0.68],
  [-0.08, 0.68], [-0.08, 0.6], [-0.17, 0.6], [-0.17, 0.68], [-0.25, 0.68], [-0.25, 1], [-0.33, 1], [-0.33, 0.91], [-0.42, 0.91], [-0.42, 1], [-0.5, 1],
];

/** La región de un contorno, centrada en x = 0 y apoyada en y = 0. */
export function regionDeContorno(c: ContornoForma): Region {
  if (c.tipo === "libre") {
    if (c.puntos.length < 3) throw new Error("Un contorno libre necesita al menos 3 puntos.");
    return apoyar(regionPoligonos([c.puntos, ...(c.huecos ?? [])]));
  }
  if (c.tipo === "texto") {
    const texto = componerTexto(c.texto, { altoCm: c.altoCm, separacionCm: Math.max(c.altoCm * 0.15, c.grosorCm * 0.6), disposicion: c.disposicion ?? "fila", margenCm: c.grosorCm / 2 });
    if (!texto.trazos.length) throw new Error(`No hay nada que dibujar en «${c.texto}».`);
    const region = regionTrazos(texto.trazos.map((t) => ({ ...t, grosorCm: c.grosorCm })));
    return apoyar({ ...region, esqueleto: texto.trazos.map((t) => ({ puntos: t.puntos, cerrado: t.cerrado, radioInicioCm: c.grosorCm / 2, radioFinCm: c.grosorCm / 2 })) });
  }
  const W = Math.max(10, c.anchoCm), H = Math.max(10, c.altoCm);
  switch (c.id) {
    case "corazon": return apoyar(regionPoligonos([escalar(normalizarPuntos(contornoCorazon(1)), W, H)]));
    case "circulo": return apoyar(regionPoligonos([circuloPuntos(0, H / 2, W / 2, H / 2)]));
    case "aro": return apoyar(regionPoligonos([circuloPuntos(0, H / 2, W / 2, H / 2), circuloPuntos(0, H / 2, W * 0.3, H * 0.3)]));
    case "castillo": return apoyar(regionPoligonos([escalar(CASTILLO, W, H)]));
    case "estrella": {
      const puntos = escalar(normalizarPuntos(poligonoEstrella(5, 0.42)), W, H);
      const region = regionPoligonos([puntos]);
      // El esqueleto: cinco rayos del centro a cada punta, gruesos al centro y finos en la punta.
      const centro = { x: puntos.reduce((s, q) => s + q.x, 0) / puntos.length, y: puntos.reduce((s, q) => s + q.y, 0) / puntos.length };
      const interiores = puntos.filter((_, k) => k % 2 === 1);
      const rInterior = interiores.reduce((s, q) => s + Math.hypot(q.x - centro.x, q.y - centro.y), 0) / interiores.length;
      const esqueleto = puntos.filter((_, k) => k % 2 === 0).map((punta) => {
        const largo = Math.hypot(punta.x - centro.x, punta.y - centro.y);
        const radioFin = Math.max(6, rInterior * 0.42);
        const f = Math.max(0, (largo - radioFin * 1.15) / largo);
        return { puntos: [centro, { x: centro.x + (punta.x - centro.x) * f * 0.5, y: centro.y + (punta.y - centro.y) * f * 0.5 }, { x: centro.x + (punta.x - centro.x) * f, y: centro.y + (punta.y - centro.y) * f }], cerrado: false, radioInicioCm: rInterior * 0.95, radioFinCm: radioFin };
      });
      return apoyar({ ...region, esqueleto });
    }
    case "cruz": {
      const barra = Math.min(W, H) * 0.38;
      const yTravesano = H * 0.68;
      const ring: P2[] = [
        { x: -barra / 2, y: 0 }, { x: barra / 2, y: 0 }, { x: barra / 2, y: yTravesano - barra / 2 }, { x: W / 2, y: yTravesano - barra / 2 }, { x: W / 2, y: yTravesano + barra / 2 },
        { x: barra / 2, y: yTravesano + barra / 2 }, { x: barra / 2, y: H }, { x: -barra / 2, y: H }, { x: -barra / 2, y: yTravesano + barra / 2 }, { x: -W / 2, y: yTravesano + barra / 2 },
        { x: -W / 2, y: yTravesano - barra / 2 }, { x: -barra / 2, y: yTravesano - barra / 2 },
      ];
      const r = barra / 2;
      const esqueleto: TrazoEsqueleto[] = [
        { puntos: [{ x: 0, y: r * 0.9 }, { x: 0, y: H / 2 }, { x: 0, y: H - r * 0.9 }], cerrado: false, radioInicioCm: r, radioFinCm: r },
        { puntos: [{ x: -W / 2 + r * 0.9, y: yTravesano }, { x: 0, y: yTravesano }, { x: W / 2 - r * 0.9, y: yTravesano }], cerrado: false, radioInicioCm: r, radioFinCm: r },
      ];
      return apoyar({ ...regionPoligonos([ring]), esqueleto });
    }
    case "ancla": {
      // Caña con remate arriba, cepo (travesaño) y los brazos en U con las uñas anchas, como la de Sempertex.
      const g = W * 0.15;
      const u = (x: number, y: number): P2 => ({ x: x * W, y: y * H });
      const brazos: P2[] = [u(-0.38, 0.47), u(-0.38, 0.24)];
      for (let i = 0; i <= 12; i++) { const a = Math.PI + (Math.PI * i) / 12; brazos.push(u(0.38 * Math.cos(a), 0.24 + 0.2 * Math.sin(a))); }
      brazos.push(u(0.38, 0.24), u(0.38, 0.47));
      const trazos: Array<Trazo & { grosorCm: number }> = [
        { puntos: [u(0, 0.06), u(0, 0.94)], cerrado: false, grosorCm: g },
        { puntos: [u(-0.36, 0.76), u(0.36, 0.76)], cerrado: false, grosorCm: g * 0.85 },
        { puntos: brazos, cerrado: false, grosorCm: g },
        { puntos: [u(-0.38, 0.4), u(-0.38, 0.5)], cerrado: false, grosorCm: g * 1.45 },
        { puntos: [u(0.38, 0.4), u(0.38, 0.5)], cerrado: false, grosorCm: g * 1.45 },
      ];
      return apoyar({ ...regionTrazos(trazos), esqueleto: trazos.slice(0, 3).map((t) => ({ puntos: t.puntos, cerrado: false, radioInicioCm: t.grosorCm / 2, radioFinCm: t.grosorCm / 2 })) });
    }
    case "nube": {
      const s = Math.min(W, H);
      const bolas: Array<[number, number, number]> = [[-0.3, 0.36, 0.2], [-0.05, 0.56, 0.3], [0.26, 0.48, 0.24], [0.4, 0.3, 0.18], [-0.42, 0.24, 0.16], [0.05, 0.3, 0.26]];
      const circulos = bolas.map(([x, y, r]) => regionPoligonos([circuloPuntos(x * W, y * H, r * s * (W / s) * 0.9, r * s * (H / s) * 0.9, 40)]));
      const base = regionPoligonos([[{ x: -0.44 * W, y: 0.08 * H }, { x: 0.44 * W, y: 0.08 * H }, { x: 0.44 * W, y: 0.3 * H }, { x: -0.44 * W, y: 0.3 * H }]]);
      return apoyar(unirRegiones([...circulos, base]));
    }
  }
}

/** La región que se rellena: el contorno y, con marco, solo su franja junto al borde. */
export function regionDeRellena(o: Pick<OpcionesRellena, "contorno" | "marcoCm">): Region {
  const base = regionDeContorno(o.contorno);
  if (!o.marcoCm || o.marcoCm <= 0) return base;
  // El esqueleto no sirve para un marco: el orgánico va por franjas.
  return regionMarco({ caja: base.caja, distancia: base.distancia }, o.marcoCm);
}

/** Área de la región (cm²), contando celdas de `pasoCm`. */
export function areaRegion(region: Region, pasoCm = 2): number {
  let n = 0;
  for (let y = region.caja.minY + pasoCm / 2; y < region.caja.maxY; y += pasoCm) for (let x = region.caja.minX + pasoCm / 2; x < region.caja.maxX; x += pasoCm) if (region.distancia(x, y) > 0) n++;
  return n * pasoCm * pasoCm;
}

/**
 * Las curvas donde la distancia al borde vale `nivel` (cuadrados en marcha sobre una rejilla de `h` cm): cada una
 * cerrada, como polilínea.
 */
export function isolineas(region: Region, nivel: number, h = 2): P2[][] {
  const { minX, minY, maxX, maxY } = region.caja;
  const x0 = minX - 2 * h, y0 = minY - 2 * h;
  const nx = Math.ceil((maxX - minX) / h) + 4, ny = Math.ceil((maxY - minY) / h) + 4;
  const v = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v[j * (nx + 1) + i] = region.distancia(x0 + i * h, y0 + j * h) - nivel;
  const val = (i: number, j: number) => v[j * (nx + 1) + i]!;
  const punto = (clave: string): P2 => {
    const [tipo, si, sj] = clave.split(",");
    const i = Number(si), j = Number(sj);
    if (tipo === "h") { const a = val(i, j), b = val(i + 1, j); const t = a / (a - b); return { x: x0 + (i + t) * h, y: y0 + j * h }; }
    const a = val(i, j), b = val(i, j + 1); const t = a / (a - b); return { x: x0 + i * h, y: y0 + (j + t) * h };
  };
  const vecinos = new Map<string, string[]>();
  const unir = (a: string, b: string) => { (vecinos.get(a) ?? vecinos.set(a, []).get(a)!).push(b); (vecinos.get(b) ?? vecinos.set(b, []).get(b)!).push(a); };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = val(i, j) > 0, b = val(i + 1, j) > 0, c = val(i + 1, j + 1) > 0, d = val(i, j + 1) > 0;
      const caso = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (caso === 0 || caso === 15) continue;
      const e0 = `h,${i},${j}`, e1 = `v,${i + 1},${j}`, e2 = `h,${i},${j + 1}`, e3 = `v,${i},${j}`;
      const centro = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > 0;
      switch (caso) {
        case 1: case 14: unir(e3, e0); break;
        case 2: case 13: unir(e0, e1); break;
        case 3: case 12: unir(e3, e1); break;
        case 4: case 11: unir(e1, e2); break;
        case 6: case 9: unir(e0, e2); break;
        case 7: case 8: unir(e3, e2); break;
        case 5: if (centro) { unir(e0, e1); unir(e2, e3); } else { unir(e3, e0); unir(e1, e2); } break;
        case 10: if (centro) { unir(e3, e0); unir(e1, e2); } else { unir(e0, e1); unir(e2, e3); } break;
      }
    }
  }
  const vistos = new Set<string>();
  const lazos: P2[][] = [];
  for (const inicio of vecinos.keys()) {
    if (vistos.has(inicio)) continue;
    const lazo: P2[] = [];
    let actual: string | undefined = inicio, previo: string | null = null;
    while (actual !== undefined && !vistos.has(actual)) {
      vistos.add(actual);
      lazo.push(punto(actual));
      const opciones: string[] = vecinos.get(actual) ?? [];
      const siguiente: string | undefined = opciones.find((x) => x !== previo && !vistos.has(x));
      previo = actual;
      actual = siguiente;
    }
    if (lazo.length >= 3) lazos.push(lazo);
  }
  return lazos;
}

// ----------------------------------------------------------------------------------------------------------
// Colores
// ----------------------------------------------------------------------------------------------------------

type Pintor = (centro: Vec3, indice: number, nivel?: number) => string;

/**
 * `muestras`: puntos de la forma (opcional). Con ellos el degradado reparte las bandas por área (cada color, la misma
 * parte de la forma); sin ellos, a lo largo de la caja.
 */
function crearPintor(c: ColoresForma, caja: { min: Vec3; max: Vec3 }, muestras?: readonly P2[]): Pintor {
  if (!c.codigos.length) throw new Error("La forma necesita al menos un color.");
  const n = c.codigos.length;
  const codigo = (i: number) => c.codigos[((i % n) + n) % n]!;
  const azar = crearAzar((c.semilla ?? 7) * 7919 + 13);
  switch (c.patron) {
    case "un_color": return () => codigo(0);
    case "alternado": return (_, i) => codigo(i);
    case "franjas": {
      const franja = Math.max(1, c.franjaCm ?? 20);
      return (centro, _, nivel) => codigo(nivel !== undefined && c.franjaNiveles ? Math.floor(nivel / Math.max(1, c.franjaNiveles)) : Math.floor((centro.y - caja.min.y) / franja));
    }
    case "mezcla": {
      const pesos = c.codigos.map((_, i) => Math.max(0, c.pesos?.[i] ?? 1));
      const total = pesos.reduce((s, x) => s + x, 0) || 1;
      return () => {
        let r = azar() * total;
        for (let i = 0; i < n; i++) { r -= pesos[i]!; if (r <= 0) return codigo(i); }
        return codigo(n - 1);
      };
    }
    case "degradado": {
      const a = ((c.anguloGrados ?? 90) * Math.PI) / 180;
      const u = { x: Math.cos(a), y: Math.sin(a) };
      const proyecciones = [caja.min.x * u.x + caja.min.y * u.y, caja.max.x * u.x + caja.min.y * u.y, caja.min.x * u.x + caja.max.y * u.y, caja.max.x * u.x + caja.max.y * u.y];
      const desde = Math.min(...proyecciones), hasta = Math.max(...proyecciones);
      // Con muestras, el corte entre bandas va en los cuantiles: cada color cubre la misma parte de la forma.
      const ordenadas = muestras?.length ? muestras.map((q) => q.x * u.x + q.y * u.y).sort((p, q) => p - q) : null;
      const fraccion = (v: number) => {
        if (!ordenadas) return (v - desde) / (hasta - desde || 1);
        let lo = 0, hi = ordenadas.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (ordenadas[m]! < v) lo = m + 1; else hi = m; }
        return lo / ordenadas.length;
      };
      return (centro) => {
        const t = fraccion(centro.x * u.x + centro.y * u.y) + (azar() - 0.5) * 0.16;
        return codigo(Math.max(0, Math.min(n - 1, Math.floor(t * n))));
      };
    }
  }
}

// ----------------------------------------------------------------------------------------------------------
// Relleno por celdas, malla y orgánico
// ----------------------------------------------------------------------------------------------------------

/** Separación entre centros de dos globos iguales que se tocan aplastándose un 10 % (como mucho un 11 %: el límite es 12 %). */
const PASO_POR_DIAMETRO = 0.9;
const MINIMO_POR_DIAMETRO = 0.89;

/** Un globo del relleno plano: centro, diámetro y formato (los chicos que tapan huecos pueden ser de otro). */
type Centro = { x: number; y: number; borde: boolean; d: number; formatoId: string };

/** Lazos del borde resampleados a `paso` (sin repetir lo que ya está a menos de `minimo`). */
function hileraDeBorde(region: Region, nivel: number, paso: number, minimo: number, centros: Centro[], d: number, formatoId: string): void {
  for (const lazo of isolineas(region, nivel, Math.max(1, Math.min(2, paso / 6)))) {
    const largo = largoPolilinea(lazo, true);
    const n = Math.floor(largo / paso);
    const puntos = n >= 3 ? repartirEnPolilinea(lazo, true, n).map((m) => m.punto) : [{ x: lazo.reduce((s, q) => s + q.x, 0) / lazo.length, y: lazo.reduce((s, q) => s + q.y, 0) / lazo.length }];
    for (const q of puntos) {
      if (region.distancia(q.x, q.y) < 0) continue;
      if (centros.some((c) => Math.hypot(c.x - q.x, c.y - q.y) < minimo)) continue;
      centros.push({ x: q.x, y: q.y, borde: true, d, formatoId });
    }
  }
}

/** Mete globos iguales (a `minimo` de separación) en los huecos más grandes que quedan dentro, del mayor al menor. */
function taparHuecos(region: Region, centros: Centro[], minimo: number, nivelMinimo: number, d: number, formatoId: string): void {
  const h = Math.max(1.5, minimo / 6);
  const candidatos: Array<{ x: number; y: number; d: number }> = [];
  for (let y = region.caja.minY; y <= region.caja.maxY; y += h) for (let x = region.caja.minX; x <= region.caja.maxX; x += h) {
    if (region.distancia(x, y) < nivelMinimo) continue;
    let dist = Infinity;
    for (const c of centros) dist = Math.min(dist, Math.hypot(c.x - x, c.y - y));
    if (dist >= minimo) candidatos.push({ x, y, d: dist });
  }
  for (;;) {
    let mejor: { x: number; y: number; d: number } | null = null;
    for (const c of candidatos) if (c.d >= minimo && (!mejor || c.d > mejor.d + 1e-9)) mejor = c;
    if (!mejor) break;
    centros.push({ x: mejor.x, y: mejor.y, borde: false, d, formatoId });
    for (const c of candidatos) c.d = Math.min(c.d, Math.hypot(c.x - mejor.x, c.y - mejor.y));
  }
}

/**
 * Lo que aún se ve entre globos (por la retícula que no casa con la hilera del borde) se tapa con globos más chicos,
 * como en el taller: del mismo formato a menos inflado o, si no cabe, R-5. Cada uno tan grande como deja el vecino más
 * cercano sin aplastarse más del 12 % del menor; primero los huecos más grandes.
 */
function taparConChicos(region: Region, centros: Centro[], formatoId: string, dMax: number, permitido: (x: number, y: number) => boolean = () => true): void {
  const principal = formatoPorId(formatoId)!, r5 = formatoPorId("R-5")!;
  const minimoPrincipal = principal.diametroMaxCm * 0.4, minimoR5 = r5.diametroMaxCm * 0.4;
  const h = 1.5;
  type Candidato = { x: number; y: number; rho: number };
  const radioQueCabe = (x: number, y: number) => {
    // Que no se salga del contorno más de medio globo.
    let rho = Math.min(dMax / 2, 2 * region.distancia(x, y));
    for (const c of centros) {
      const dist = Math.hypot(c.x - x, c.y - y), r = c.d / 2;
      // Se admite el 12 % del diámetro del menor: con ρ ≤ r, dist ≥ r + 0,76 ρ; con ρ > r, dist ≥ ρ + 0,76 r.
      const conMenor = (dist - r - 0.15) / 0.78;
      rho = Math.min(rho, conMenor <= r ? conMenor : dist - 0.15 - 0.78 * r);
      if (rho <= 0) return 0;
    }
    return rho;
  };
  const candidatos: Candidato[] = [];
  for (let y = region.caja.minY; y <= region.caja.maxY; y += h) for (let x = region.caja.minX; x <= region.caja.maxX; x += h) {
    if (region.distancia(x, y) < 0 || !permitido(x, y)) continue;
    const rho = radioQueCabe(x, y);
    if (rho * 2 >= minimoR5) candidatos.push({ x, y, rho });
  }
  for (;;) {
    let mejor: Candidato | null = null;
    for (const c of candidatos) if (c.rho * 2 >= minimoR5 && (!mejor || c.rho > mejor.rho + 1e-9)) mejor = c;
    if (!mejor) break;
    const d = Math.min(dMax, Math.floor(mejor.rho * 2 * 10) / 10);
    centros.push({ x: mejor.x, y: mejor.y, borde: false, d, formatoId: d >= minimoPrincipal ? formatoId : "R-5" });
    for (const c of candidatos) if (Math.hypot(c.x - mejor.x, c.y - mejor.y) < mejor.rho + dMax) c.rho = radioQueCabe(c.x, c.y);
  }
}

function rellenoCeldas(region: Region, t: Extract<TecnicaRelleno, { tipo: "celdas" }>): { centros: Centro[]; d: number } {
  const formato = formatoPorId(t.formatoId);
  if (!formato || formato.tipo !== "redondo") throw new Error("El relleno por celdas va con globos redondos (R-5, R-9, R-12…).");
  const d = infladoValido(formato, t.infladoCm), r = d / 2;
  const paso = d * PASO_POR_DIAMETRO, minimo = d * MINIMO_POR_DIAMETRO;
  const nivel = r * 0.5;
  const centros: Centro[] = [];
  hileraDeBorde(region, nivel, paso, minimo, centros, d, formato.id);
  // El interior en retícula, alineada con el centro de la caja para que quede simétrica.
  const cx = (region.caja.minX + region.caja.maxX) / 2, cy = (region.caja.minY + region.caja.maxY) / 2;
  const dy = t.celda === "tresbolillo" ? paso * Math.sqrt(3) / 2 : paso;
  const filas = Math.ceil((region.caja.maxY - region.caja.minY) / dy) + 2, columnas = Math.ceil((region.caja.maxX - region.caja.minX) / paso) + 2;
  for (let j = -filas; j <= filas; j++) {
    for (let i = -columnas; i <= columnas; i++) {
      const x = cx + (i + (t.celda === "tresbolillo" && Math.abs(j) % 2 === 1 ? 0.5 : 0)) * paso, y = cy + j * dy;
      if (region.distancia(x, y) < nivel + paso * 0.6) continue;
      if (centros.some((c) => c.borde && Math.hypot(c.x - x, c.y - y) < minimo)) continue;
      centros.push({ x, y, borde: false, d, formatoId: formato.id });
    }
  }
  taparHuecos(region, centros, minimo, nivel * 0.8, d, formato.id);
  taparConChicos(region, centros, formato.id, d);
  return { centros, d };
}

/** Acentos: globitos metidos al frente de los huecos entre los globos (donde cabe más hondo, primero). */
function acentosPlanos(region: Region, centros: readonly Centro[], d: number, a: AcentoForma, profundidadCm: number): GloboDeForma[] {
  const formato = formatoPorId(a.formatoId);
  if (!formato || formato.tipo !== "redondo") throw new Error("Los acentos van con globos redondos.");
  const da = infladoValido(formato, a.infladoCm), ra = da / 2;
  const h = 1.5;
  // Cada punto, con el globo que más cerca le queda (por su cara): hueco si casi no lo tapa ninguno.
  const huecos: Array<{ x: number; y: number; g: number; dist: number; r: number }> = [];
  for (let y = region.caja.minY; y <= region.caja.maxY; y += h) for (let x = region.caja.minX; x <= region.caja.maxX; x += h) {
    if (region.distancia(x, y) < ra * 0.5) continue;
    let g = Infinity, dist = 0, r = d / 2;
    for (const c of centros) { const l = Math.hypot(c.x - x, c.y - y); if (l - c.d / 2 < g) { g = l - c.d / 2; dist = l; r = c.d / 2; } }
    if (g >= -0.05 * r && g < ra) huecos.push({ x, y, g, dist, r });
  }
  huecos.sort((p, q) => q.g - p.g || p.y - q.y || p.x - q.x);
  const elegidos: typeof huecos = [];
  for (const hueco of huecos) if (!elegidos.some((e) => Math.hypot(e.x - hueco.x, e.y - hueco.y) < Math.max(da * 1.6, d * 0.45))) elegidos.push(hueco);
  elegidos.sort((p, q) => p.y - q.y || p.x - q.x);
  const cada = Math.max(1, Math.round(a.cada ?? 1));
  const pintar = crearPintor({ codigos: a.codigos, patron: "alternado" }, { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
  return elegidos.filter((_, i) => i % cada === 0).map((e, i) => {
    // Apoyado contra los globos de alrededor: tan adelante como pide tocarlos (aplastándose un poco).
    const z = profundidadCm + Math.sqrt(Math.max(0, ((e.r + ra) * 0.94) ** 2 - e.dist * e.dist));
    return globoEn(formato.id, da, pintar({ x: e.x, y: e.y, z }, i), { x: r1(e.x), y: r1(e.y), z: r1(z) });
  });
}

function rellenoMalla(region: Region, t: Extract<TecnicaRelleno, { tipo: "malla" }>, pintor: Pintor, borde: string | null): { globos: GloboDeForma[]; centros: Centro[] } {
  const formato = formatoPorId(t.formatoId);
  const r5 = formatoPorId("R-5");
  if (!formato || formato.tipo !== "link" || !r5) throw new Error("La malla va con Link-O-Loon (LOL-6 o LOL-12).");
  exigirColor("R-5", t.union.codigo);
  const d = infladoValido(formato, t.infladoCm), r = d / 2;
  const largo = d * LARGO_ESLABON_POR_DIAMETRO;
  const a = largo / Math.SQRT2;
  const globos: GloboDeForma[] = [];
  const centros: Centro[] = [];
  const nudos = new Map<string, P2>();
  const eslabon = (desde: P2, hasta: P2, codigo: string, esBorde: boolean) => {
    const medio = { x: (desde.x + hasta.x) / 2, y: (desde.y + hasta.y) / 2 };
    const l = Math.hypot(hasta.x - desde.x, hasta.y - desde.y) || 1;
    const direccion: Vec3 = { x: (hasta.x - desde.x) / l, y: (hasta.y - desde.y) / l, z: 0 };
    globos.push(globoEn(formato.id, d, codigo, { x: r1(medio.x), y: r1(medio.y), z: 0 }, direccion));
    centros.push({ x: medio.x, y: medio.y, borde: esBorde, d, formatoId: formato.id });
    for (const q of [desde, hasta]) nudos.set(`${Math.round(q.x)},${Math.round(q.y)}`, q);
  };
  // La malla diagonal (centros de flor en i par), recortada por el contorno: se queda cada eslabón con el cuerpo
  // dentro (su centro a más de un tercio de globo del borde y sus dos puntas, con su pareja de unión, dentro). Los del borde, del color del borde.
  const cx = (region.caja.minX + region.caja.maxX) / 2, cy = (region.caja.minY + region.caja.maxY) / 2;
  const ni = Math.ceil((region.caja.maxX - region.caja.minX) / a / 2) + 2, nj = Math.ceil((region.caja.maxY - region.caja.minY) / a / 2) + 2;
  for (let i = -2 * ni; i <= 2 * ni; i += 2) {
    for (let j = -2 * nj; j <= 2 * nj; j++) {
      if ((i + j) % 2 !== 0) continue;
      const centro = { x: cx + i * a, y: cy + j * a };
      for (const [di, dj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const esquina = { x: centro.x + di * a, y: centro.y + dj * a };
        const medio = { x: (centro.x + esquina.x) / 2, y: (centro.y + esquina.y) / 2 };
        const enMedio = region.distancia(medio.x, medio.y);
        if (enMedio < r * 0.35) continue;
        if (region.distancia(centro.x, centro.y) < 0 || region.distancia(esquina.x, esquina.y) < 0) continue;
        const esBorde = enMedio < d * 0.8;
        eslabon(centro, esquina, esBorde && borde ? borde : pintor({ x: medio.x, y: medio.y, z: 0 }, globos.length), esBorde);
      }
    }
  }
  // Una pareja de unión (R-5) en cada nudo: una al frente y otra atrás.
  const amarre = Math.max(0.35, t.union.infladoCm * 0.035);
  for (const q of [...nudos.values()].sort((p, s) => p.y - s.y || p.x - s.x)) {
    for (const z of [1, -1]) globos.push({ formatoId: r5.id, infladoCm: t.union.infladoCm, codigo: t.union.codigo, nudo: { x: r1(q.x), y: r1(q.y), z: z * amarre }, direccion: { x: 0, y: 0, z }, cuelloExtraCm: 0 });
    centros.push({ x: q.x, y: q.y, borde: false, d: t.union.infladoCm, formatoId: r5.id });
  }
  // Lo que el recorte deja al aire (junto al borde, o donde no cupo la malla) se tapa con R-5, del color del borde o
  // del de la forma; los huecos propios de la malla (los rodean tres o cuatro eslabones) se dejan.
  const antes = centros.length;
  const eslabones = centros.filter((c) => c.formatoId === formato.id);
  const huecoDeMalla = (x: number, y: number) => eslabones.filter((c) => Math.hypot(c.x - x, c.y - y) < largo * 0.75).length >= 3;
  taparConChicos(region, centros, r5.id, r5.infladoDecoracionCm, (x, y) => region.distancia(x, y) < d * 0.9 || !huecoDeMalla(x, y));
  for (const c of centros.slice(antes)) {
    const codigo = borde ?? pintor({ x: c.x, y: c.y, z: 0 }, globos.length);
    if (coloresDeFormatoTiene(r5.id, codigo)) globos.push(globoEn(r5.id, c.d, codigo, { x: r1(c.x), y: r1(c.y), z: 0 }));
  }
  return { globos, centros };
}

function rellenoOrganico(region: Region, t: Extract<TecnicaRelleno, { tipo: "organico" }>, colores: ColoresForma): { opciones: OpcionesOrganico } {
  const R = Math.max(8, t.radioCm);
  const pesos = colores.codigos.map((_, i) => Math.max(0, colores.pesos?.[i] ?? 1));
  const paleta: ColorOrganico[] = colores.codigos.map((codigo, i) => ({ codigo, peso: pesos[i]! }));
  const mezcla = [{ t: 0, pesos: { ...t.mezcla } }, { t: 1, pesos: { ...t.mezcla } }];
  const tramos: TramoOrganico[] = [];
  if (region.esqueleto?.length) {
    region.esqueleto.forEach((e, k) => {
      const puntos = e.cerrado ? [...e.puntos, e.puntos[0]!] : e.puntos;
      const muestras = repartirEnPolilinea(puntos, false, Math.max(3, Math.min(14, Math.round(largoPolilinea(puntos, false) / 25) + 1)));
      tramos.push({
        id: `trazo_${k}`, nombre: `Trazo ${k + 1}`, recorrido: muestras.map((m) => ({ x: r1(m.punto.x), y: r1(m.punto.y), z: 0 })),
        grosor: [{ t: 0, radioCm: Math.min(R * 1.6, e.radioInicioCm) }, { t: 1, radioCm: Math.min(R * 1.6, e.radioFinCm) }],
        mezcla, irregularidad: 0.12, tapas: e.cerrado ? {} : { inicio: true, fin: true },
      });
    });
  } else {
    // Franjas horizontales que barren el contorno: cada tramo de dentro de una franja es una guirnalda corta.
    const { minY, maxY, minX, maxX } = region.caja;
    const filas = Math.max(1, Math.round((maxY - minY - 1.2 * R) / (1.4 * R)) + 1);
    for (let k = 0; k < filas; k++) {
      const y = filas === 1 ? (minY + maxY) / 2 : minY + R * 0.6 + ((maxY - minY - 1.2 * R) * k) / (filas - 1);
      let desde: number | null = null, holgura = 0;
      const cerrar = (hasta: number) => {
        if (desde === null) return;
        const radio = Math.max(6, Math.min(R, holgura));
        let a = desde + radio * 0.5, b = hasta - radio * 0.5;
        if (b - a < 2) { const m = (desde + hasta) / 2; a = m - 1; b = m + 1; }
        tramos.push({
          id: `franja_${k}_${tramos.length}`, nombre: `Franja ${k + 1}`, recorrido: [{ x: r1(a), y: r1(y), z: 0 }, { x: r1((a + b) / 2), y: r1(y), z: 0 }, { x: r1(b), y: r1(y), z: 0 }],
          grosor: [{ t: 0, radioCm: radio }, { t: 1, radioCm: radio }], mezcla, irregularidad: 0.1, tapas: { inicio: true, fin: true },
        });
        desde = null; holgura = 0;
      };
      for (let x = minX; x <= maxX + 1; x += 1) {
        const dist = region.distancia(x, y);
        if (dist >= R * 0.4) { if (desde === null) desde = x; holgura = Math.max(holgura, dist); }
        else cerrar(x);
      }
      cerrar(maxX + 1);
    }
  }
  if (!tramos.length) throw new Error("El contorno es demasiado pequeño para la capa orgánica: baja el grosor.");
  // Relleno sin R-9 si algún color no se fabrica en R-9 (el motor lo cambiaría por otro de su familia).
  const conR9 = paleta.every((c) => formatoPorId("R-9") && coloresDeFormatoTiene("R-9", c.codigo));
  const relleno: RellenoOrganico[] = (conR9 ? RELLENO_TUPIDO : RELLENO_TUPIDO.filter((x) => x.formatoId !== "R-9")).map((x) => ({ ...x }));
  for (const formatoId of Object.keys(t.mezcla)) for (const c of paleta) exigirColor(formatoId, c.codigo);
  for (const x of relleno) for (const c of paleta) exigirColor(x.formatoId, c.codigo);
  return { opciones: { semilla: t.semilla, tramos, inflados: { ...INFLADOS_ORGANICOS, ...(t.inflados ?? {}) }, variacionInflado: 0.07, relleno, colores: paleta, suelo: true, huecosFlores: 0, vista: { x: 0, y: 0, z: 1 } } };
}

function coloresDeFormatoTiene(formatoId: string, codigo: string): boolean {
  try { exigirColor(formatoId, codigo); return true; } catch { return false; }
}

function cajaPlana(region: Region): { min: Vec3; max: Vec3 } {
  return { min: { x: region.caja.minX, y: region.caja.minY, z: 0 }, max: { x: region.caja.maxX, y: region.caja.maxY, z: 0 } };
}

function armarRellena(o: OpcionesRellena): FormaArmada {
  const region = regionDeRellena(o);
  const avisos: string[] = [];
  const muestras: P2[] = [];
  for (let y = region.caja.minY; y <= region.caja.maxY; y += 4) for (let x = region.caja.minX; x <= region.caja.maxX; x += 4) if (region.distancia(x, y) > 0) muestras.push({ x, y });
  const pintor = crearPintor(o.colores, cajaPlana(region), muestras);
  let globos: GloboDeForma[] = [];
  let centros: Centro[] = [];
  let d = 0;
  if (o.tecnica.tipo === "celdas") {
    const tecnica = o.tecnica;
    for (const codigo of o.colores.codigos) exigirColor(tecnica.formatoId, codigo);
    if (o.borde) exigirColor(tecnica.formatoId, o.borde.codigo);
    const celdas = rellenoCeldas(region, tecnica);
    centros = celdas.centros; d = celdas.d;
    // Se pintan de abajo arriba y de izquierda a derecha: el mismo orden siempre.
    const ordenados = [...centros].sort((p, q) => p.y - q.y || p.x - q.x);
    globos = [];
    ordenados.forEach((c, i) => {
      const codigo = c.borde && o.borde ? o.borde.codigo : pintor({ x: c.x, y: c.y, z: 0 }, i);
      // Un chico de R-5 en un color que no se fabrica en R-5 no se pone (el hueco queda).
      if (!coloresDeFormatoTiene(c.formatoId, codigo)) return;
      globos.push(globoEn(c.formatoId, c.d, codigo, { x: r1(c.x), y: r1(c.y), z: 0 }));
    });
  } else if (o.tecnica.tipo === "malla") {
    for (const codigo of o.colores.codigos) exigirColor(o.tecnica.formatoId, codigo);
    if (o.borde) exigirColor(o.tecnica.formatoId, o.borde.codigo);
    const malla = rellenoMalla(region, o.tecnica, pintor, o.borde?.codigo ?? null);
    globos = malla.globos; centros = malla.centros;
    d = infladoValido(formatoPorId(o.tecnica.formatoId)!, o.tecnica.infladoCm);
  } else {
    const { opciones } = rellenoOrganico(region, o.tecnica, o.colores);
    const resultado = armarOrganico(opciones);
    // Lo que el motor deja con el centro fuera del contorno se quita: la silueta manda.
    const dentro = resultado.globos.filter((g) => region.distancia(g.centro.x, g.centro.y) >= 0);
    if (dentro.length < resultado.globos.length) avisos.push(`Se quitaron ${resultado.globos.length - dentro.length} globos de la capa orgánica que se salían del contorno.`);
    globos = dentro.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.confeti ? { confeti: true } : {}) }));
    avisos.push(...resultado.avisos);
    // Lo que aún se ve de frente (las puntas finas, la orilla) se tapa con R-5, como los tríos del motor: vistos de
    // frente no se pisan con nadie, así que en 3D tampoco.
    centros = dentro.map((g) => ({ x: g.centro.x, y: g.centro.y, borde: false, d: g.infladoCm, formatoId: g.formatoId }));
    const antes = centros.length;
    taparConChicos(region, centros, "R-5", 12);
    const mezcla = crearPintor({ ...o.colores, patron: "mezcla" }, cajaPlana(region));
    for (const c of centros.slice(antes)) {
      const codigo = mezcla({ x: c.x, y: c.y, z: 0 }, 0);
      if (coloresDeFormatoTiene("R-5", codigo)) globos.push(globoEn("R-5", c.d, codigo, { x: r1(c.x), y: r1(c.y), z: 0 }));
    }
  }
  if (o.acento && o.tecnica.tipo !== "organico") {
    for (const codigo of o.acento.codigos) exigirColor(o.acento.formatoId, codigo);
    globos.push(...acentosPlanos(region, centros, d, o.acento, 0));
  }
  const frente = globos.filter((g) => g.direccion.z > 0.5 || o.tecnica.tipo === "organico");
  const anclas = frente.filter((_, i) => i % 5 === 2).map((g) => { const c = centroDe(g); return { posicion: { x: r1(c.x), y: r1(c.y), z: r1(c.z + g.infladoCm / 2) }, normal: { x: 0, y: 0, z: 1 } }; });
  return { globos, tubos: [], anclas, materiales: materialesDecoracion(globos, []), avisos };
}

// ----------------------------------------------------------------------------------------------------------
// Volúmenes
// ----------------------------------------------------------------------------------------------------------

const normalizar = (v: Vec3): Vec3 => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const restar = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const sumar = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const por = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const largo3 = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const redondo3 = (v: Vec3): Vec3 => ({ x: r1(v.x), y: r1(v.y), z: r1(v.z) });

type Geodesica = { vertices: Vec3[]; triangulos: Array<[number, number, number]>; aristaMinima: number };
const GEODESICAS = new Map<number, Geodesica>();

/** Geodésica de icosaedro de frecuencia `f` (vértices en la esfera unidad, uno arriba del todo). */
export function geodesica(f: number): Geodesica {
  const guardada = GEODESICAS.get(f);
  if (guardada) return guardada;
  const t = (1 + Math.sqrt(5)) / 2;
  const giro = Math.atan(-1 / t);
  const base = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as const)
    .map(([x, y, z]) => normalizar({ x: x * Math.cos(giro) - y * Math.sin(giro), y: x * Math.sin(giro) + y * Math.cos(giro), z }));
  const caras: ReadonlyArray<readonly [number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const vertices: Vec3[] = [];
  const indice = new Map<string, number>();
  const id = (v: Vec3) => {
    const n = normalizar(v);
    const clave = `${n.x.toFixed(5)},${n.y.toFixed(5)},${n.z.toFixed(5)}`;
    const ya = indice.get(clave);
    if (ya !== undefined) return ya;
    vertices.push(n);
    indice.set(clave, vertices.length - 1);
    return vertices.length - 1;
  };
  const triangulos: Array<[number, number, number]> = [];
  for (const [ia, ib, ic] of caras) {
    const A = base[ia]!, B = base[ib]!, C = base[ic]!;
    const P = (i: number, j: number) => id(sumar(A, sumar(por(restar(B, A), i / f), por(restar(C, A), j / f))));
    for (let i = 0; i < f; i++) for (let j = 0; j < f - i; j++) {
      triangulos.push([P(i, j), P(i + 1, j), P(i, j + 1)]);
      if (i + j < f - 1) triangulos.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
    }
  }
  let aristaMinima = Infinity;
  for (const [a, b, c] of triangulos) for (const [p, q] of [[a, b], [b, c], [c, a]] as const) aristaMinima = Math.min(aristaMinima, largo3(restar(vertices[p]!, vertices[q]!)));
  const g = { vertices, triangulos, aristaMinima };
  GEODESICAS.set(f, g);
  return g;
}

/**
 * Esfera (o elipsoide achatado) de globos en los vértices de una geodésica: se elige la frecuencia cuyo diámetro
 * exterior queda más cerca del pedido con los globos tocándose (separación 0,9 inflados), y los acentos van en los
 * huecos de cada triángulo. `centro`: dónde queda su centro.
 */
function armarEsfera(o: { diametroCm: number; globo: GloboVolumen; colores: ColoresForma; acento?: AcentoForma | null; achatado?: number }, centro: Vec3): { globos: GloboDeForma[]; anclas: FormaArmada["anclas"]; radioCm: number; altoCm: number } {
  const formato = formatoPorId(o.globo.formatoId);
  if (!formato || formato.tipo !== "redondo") throw new Error("La esfera va con globos redondos.");
  for (const codigo of o.colores.codigos) exigirColor(formato.id, codigo);
  const d = infladoValido(formato, o.globo.infladoCm), r = d / 2;
  const achatado = Math.max(0.6, Math.min(1, o.achatado ?? 1));
  // La frecuencia más densa que cabe en el diámetro pedido sin aplastar los globos más de un 10 % (si sobran unos
  // centímetros entre globos, los tapan los acentos); si ni la más simple cabe, la más simple a su tamaño.
  const radioPedido = o.diametroCm / 2 - r;
  let mejor: { f: number; escala: number } | null = null;
  for (let f = 1; f <= 12; f++) {
    const g = geodesica(f);
    // Con el achatado, la arista más corta se mide ya aplastada.
    let minima = Infinity;
    for (const [a, b, c] of g.triangulos) for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const u = g.vertices[p]!, v = g.vertices[q]!;
      minima = Math.min(minima, Math.hypot(u.x - v.x, (u.y - v.y) * achatado, u.z - v.z));
    }
    const necesaria = (d * PASO_POR_DIAMETRO) / minima;
    if (necesaria <= radioPedido) mejor = { f, escala: radioPedido };
    else { if (!mejor) mejor = { f, escala: necesaria }; break; }
  }
  const { f, escala } = mejor!;
  const g = geodesica(f);
  const caja = { min: { x: -escala, y: -escala * achatado, z: -escala }, max: { x: escala, y: escala * achatado, z: escala } };
  const pintor = crearPintor(o.colores, caja);
  const local = g.vertices.map((v) => ({ x: v.x * escala, y: v.y * escala * achatado, z: v.z * escala }));
  const normal = (p: Vec3) => normalizar({ x: p.x, y: p.y / (achatado * achatado), z: p.z });
  const orden = local.map((_, i) => i).sort((a, b) => local[a]!.y - local[b]!.y || local[a]!.x - local[b]!.x || local[a]!.z - local[b]!.z);
  const globos: GloboDeForma[] = orden.map((i, k) => globoEn(formato.id, d, pintor(local[i]!, k), redondo3(sumar(centro, local[i]!)), normal(local[i]!)));
  if (o.acento) {
    const fa = formatoPorId(o.acento.formatoId);
    if (!fa) throw new Error(`Formato desconocido: ${o.acento.formatoId}`);
    for (const codigo of o.acento.codigos) exigirColor(fa.id, codigo);
    const da = infladoValido(fa, o.acento.infladoCm);
    const ra = fa.tipo === "corazon" ? da * 0.32 : da / 2;
    const cada = Math.max(1, Math.round(o.acento.cada ?? 1));
    const huecos = g.triangulos.map(([a, b, c]) => {
      const m = por(sumar(local[a]!, sumar(local[b]!, local[c]!)), 1 / 3);
      const g0 = (largo3(restar(local[a]!, m)) + largo3(restar(local[b]!, m)) + largo3(restar(local[c]!, m))) / 3;
      const n = normal(m);
      // Apoyado contra los tres globos del triángulo; si el hueco es más ancho que eso, a ras de la cara de la esfera.
      const contra = sumar(m, por(n, Math.sqrt(Math.max(0, ((r + ra) * 0.94) ** 2 - g0 * g0))));
      const aRas = por(n, escala + r - ra);
      return largo3(contra) >= largo3(aRas) ? contra : aRas;
    }).sort((p, q) => p.y - q.y || p.x - q.x || p.z - q.z);
    huecos.forEach((h, i) => {
      if (i % cada !== 0) return;
      const n = normal(h);
      const codigo = o.acento!.codigos[Math.floor(i / cada) % o.acento!.codigos.length]!;
      if (fa.tipo === "corazon") {
        // El corazón, plano contra la esfera: su cara mira hacia fuera y su punta hacia abajo.
        const arriba = normalizar(restar({ x: 0, y: 1, z: 0 }, por(n, n.y)));
        const eje = largo3(arriba) > 0.1 ? arriba : { x: 1, y: 0, z: 0 };
        globos.push({ ...globoEn(fa.id, da, codigo, redondo3(sumar(centro, h)), eje), frente: n });
      } else globos.push(globoEn(fa.id, da, codigo, redondo3(sumar(centro, h)), n));
    });
  }
  const anclas = orden.filter((_, k) => k % 4 === 1).map((i) => { const n = normal(local[i]!); return { posicion: redondo3(sumar(centro, sumar(local[i]!, por(n, r)))), normal: n }; });
  return { globos, anclas, radioCm: escala + r, altoCm: 2 * (escala * achatado + r) };
}

/** Radio del anillo de `n` globos de inflado `d` que se tocan (con el aplastamiento de los módulos). */
const radioAnillo = (n: number, d: number) => (n <= 1 ? 0 : (d * 0.88) / (2 * Math.sin(Math.PI / n)));

function armarCono(o: OpcionesCono): FormaArmada {
  const formato = formatoPorId(o.formatoId);
  if (!formato || formato.tipo !== "redondo") throw new Error("El cono va con globos redondos.");
  for (const codigo of o.colores.codigos) exigirColor(formato.id, codigo);
  if (o.remate) exigirColor(o.remate.formatoId, o.remate.codigo);
  const dB = infladoValido(formato, o.infladoBaseCm), dP = infladoValido(formato, o.infladoPuntaCm);
  const avisos: string[] = [];
  if (o.tecnica === "organico") {
    const radioBase = radioAnillo(Math.max(3, o.globosBase), dB) + dB / 2, radioPunta = Math.max(8, radioAnillo(Math.max(3, o.globosPunta), dP) * 0.6 + dP / 2);
    const mezcla = [{ t: 0, pesos: { ...(o.mezcla ?? { [formato.id]: 1 }) } }, { t: 1, pesos: { ...(o.mezcla ?? { [formato.id]: 1 }) } }];
    const tramo = formaColumna({ id: "cono", nombre: "Cono orgánico", altoCm: o.altoCm, radioBaseCm: radioBase, radioMedioCm: (radioBase + radioPunta) / 2, radioPuntaCm: radioPunta, mezcla, irregularidad: 0.1, serpenteoCm: 0 });
    const paleta: ColorOrganico[] = o.colores.codigos.map((codigo, i) => ({ codigo, peso: Math.max(0, o.colores.pesos?.[i] ?? 1) }));
    const conR9 = paleta.every((c) => coloresDeFormatoTiene("R-9", c.codigo));
    const relleno = (conR9 ? RELLENO_TUPIDO : RELLENO_TUPIDO.filter((x) => x.formatoId !== "R-9")).map((x) => ({ ...x }));
    for (const formatoId of Object.keys(mezcla[0]!.pesos)) for (const c of paleta) exigirColor(formatoId, c.codigo);
    const resultado = armarOrganico({ semilla: o.semilla ?? 11, tramos: [tramo], inflados: INFLADOS_ORGANICOS, variacionInflado: 0.07, relleno, colores: paleta, suelo: true, huecosFlores: 0, vista: { x: 0, y: 0, z: 1 } });
    const globos: GloboDeForma[] = resultado.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.confeti ? { confeti: true } : {}) }));
    if (o.remate) globos.push(globoEn(o.remate.formatoId, o.remate.infladoCm, o.remate.codigo, { x: 0, y: r1(o.altoCm + o.remate.infladoCm * 0.25), z: 0 }, { x: 0, y: 1, z: 0 }));
    const anclas = resultado.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal }));
    return { globos, tubos: [], anclas, materiales: materialesDecoracion(globos, []), avisos: [...avisos, ...resultado.avisos] };
  }
  // Anillos: cada nivel, un anillo de globos que se tocan, girado medio globo respecto al de abajo; el inflado y la
  // cantidad bajan de la base a la punta, y cada nivel sube 0,8 de su inflado (la fórmula de las columnas).
  type Nivel = { y: number; d: number; n: number; giro: number; centros: Vec3[] };
  const niveles: Nivel[] = [];
  const tope = o.altoCm - (o.remate ? o.remate.infladoCm * 0.6 : 0);
  let y = 0, giro = 0;
  for (let k = 0; k < 200; k++) {
    const t = Math.min(1, y / Math.max(1, tope));
    const d = dB + (dP - dB) * t;
    if (y + d > tope + 0.5 && k > 0) break;
    const n = Math.max(3, Math.round(o.globosBase + (o.globosPunta - o.globosBase) * t));
    const rr = radioAnillo(n, d);
    const centros = Array.from({ length: n }, (_, i) => { const a = giro + (2 * Math.PI * i) / n; return { x: rr * Math.cos(a), y: y + d / 2, z: rr * Math.sin(a) }; });
    niveles.push({ y, d, n, giro, centros });
    y += d * 0.8;
    giro += Math.PI / n;
  }
  const caja = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: tope, z: 0 } };
  const pintor = crearPintor(o.colores, caja);
  const globos: GloboDeForma[] = [];
  niveles.forEach((nv, k) => nv.centros.forEach((c, i) => {
    const fuera = normalizar({ x: c.x, y: (k % 2 === 0 ? 1 : -1) * 0.12 * Math.hypot(c.x, c.z), z: c.z });
    globos.push(globoEn(formato.id, r1(nv.d), pintor(c, i, k), redondo3(c), fuera));
  }));
  if (o.remate) {
    const ultimo = niveles[niveles.length - 1]!;
    globos.push(globoEn(o.remate.formatoId, o.remate.infladoCm, o.remate.codigo, { x: 0, y: r1(ultimo.y + ultimo.d * 0.55 + o.remate.infladoCm * 0.35), z: 0 }, { x: 0, y: 1, z: 0 }));
  }
  if (o.acento) {
    const fa = formatoPorId(o.acento.formatoId);
    if (!fa || fa.tipo !== "redondo") throw new Error("Los acentos del cono van con globos redondos.");
    for (const codigo of o.acento.codigos) exigirColor(fa.id, codigo);
    const da = infladoValido(fa, o.acento.infladoCm), ra = da / 2;
    const cada = Math.max(1, Math.round(o.acento.cada ?? 1));
    let cuenta = 0;
    for (let k = 0; k + 1 < niveles.length; k++) {
      const abajo = niveles[k]!, arriba = niveles[k + 1]!;
      for (const c of arriba.centros) {
        // El hueco entre un globo de arriba y los dos de abajo más cercanos.
        const cercanos = [...abajo.centros].sort((p, q) => largo3(restar(p, c)) - largo3(restar(q, c))).slice(0, 2);
        const m = por(sumar(c, sumar(cercanos[0]!, cercanos[1]!)), 1 / 3);
        const r = (abajo.d + arriba.d) / 4;
        const g0 = (largo3(restar(c, m)) + largo3(restar(cercanos[0]!, m)) + largo3(restar(cercanos[1]!, m))) / 3;
        const n = normalizar({ x: m.x, y: 0, z: m.z });
        const p = sumar(m, por(n, Math.sqrt(Math.max(0, ((r + ra) * 0.94) ** 2 - g0 * g0))));
        if (cuenta % cada === 0) globos.push(globoEn(fa.id, da, o.acento.codigos[Math.floor(cuenta / cada) % o.acento.codigos.length]!, redondo3(p), n));
        cuenta++;
      }
    }
  }
  const anclas = niveles.filter((_, k) => k % 2 === 1).map((nv) => {
    const rr = radioAnillo(nv.n, nv.d) + nv.d / 2;
    return { posicion: { x: 0, y: r1(nv.y + nv.d / 2), z: r1(rr) }, normal: { x: 0, y: 0, z: 1 } };
  });
  return { globos, tubos: [], anclas, materiales: materialesDecoracion(globos, []), avisos };
}

function armarArbol(o: OpcionesArbol): FormaArmada {
  const formato = formatoPorId(o.tronco.formatoId);
  if (!formato) throw new Error(`Formato desconocido: ${o.tronco.formatoId}`);
  exigirColor(formato.id, o.tronco.codigo);
  const columna = armarColumna({ formato, infladoCm: o.tronco.infladoCm, alturaCm: o.tronco.altoCm, patron: "un_color", colores: [o.tronco.codigo] });
  const tronco: GloboDeForma[] = columna.globos.map((g) => ({ formatoId: formato.id, infladoCm: o.tronco.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm }));
  const achatado = Math.max(0.6, Math.min(1, o.copa.achatado));
  // La copa se apoya en el tronco: su centro, a 0,7 de su medio alto por encima de la punta del tronco.
  const prueba = armarEsfera({ ...o.copa, achatado }, { x: 0, y: 0, z: 0 });
  const centroY = columna.alturaCm + (prueba.altoCm / 2) * 0.7;
  const copa = armarEsfera({ ...o.copa, achatado }, { x: 0, y: r1(centroY), z: 0 });
  const globos = [...tronco, ...copa.globos];
  return { globos, tubos: [], anclas: [...copa.anclas, ...columna.anclas.filter((_, i) => i % 4 === 0).map((a) => ({ posicion: a.posicion, normal: a.normal }))], materiales: materialesDecoracion(globos, []), avisos: [] };
}

function armarAerostatico(o: OpcionesAerostatico): FormaArmada {
  const fc = formatoPorId(o.canasta.formatoId);
  if (!fc || fc.tipo !== "redondo") throw new Error("La canasta va con globos redondos.");
  exigirColor(fc.id, o.canasta.codigo);
  const dc = infladoValido(fc, o.canasta.infladoCm);
  const n = Math.max(3, Math.round(o.canasta.porAnillo));
  const rr = radioAnillo(n, dc);
  const globos: GloboDeForma[] = [];
  const anillos = Math.max(1, Math.round(o.canasta.anillos));
  for (let k = 0; k < anillos; k++) {
    const y = dc / 2 + k * dc * 0.8;
    for (let i = 0; i < n; i++) {
      const a = (k * Math.PI) / n + (2 * Math.PI * i) / n;
      globos.push(globoEn(fc.id, dc, o.canasta.codigo, redondo3({ x: rr * Math.cos(a), y, z: rr * Math.sin(a) }), normalizar({ x: Math.cos(a), y: 0, z: Math.sin(a) })));
    }
  }
  const arribaCanasta = dc / 2 + (anillos - 1) * dc * 0.8 + dc / 2;
  const prueba = armarEsfera(o.globo, { x: 0, y: 0, z: 0 });
  const centroY = arribaCanasta + Math.max(0, o.cuerdasCm) + prueba.altoCm / 2;
  const esfera = armarEsfera(o.globo, { x: 0, y: r1(centroY), z: 0 });
  globos.push(...esfera.globos);
  // Cuatro cuerdas (no son globo: hilo) de la canasta a la parte de abajo del globo.
  const tubos: TuboDecoracion[] = [0, 1, 2, 3].map((k) => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const desde = { x: rr * 0.9 * Math.cos(a), y: r1(arribaCanasta - dc * 0.2), z: rr * 0.9 * Math.sin(a) };
    const hasta = { x: esfera.radioCm * 0.62 * Math.cos(a), y: r1(centroY - (esfera.altoCm / 2) * 0.78), z: esfera.radioCm * 0.62 * Math.sin(a) };
    return { formatoId: "T-160", grosorCm: 0.6, codigo: o.canasta.codigo, puntos: [redondo3(desde), redondo3(hasta)], cerrado: false, papel: { hex: "#d8d2c4" } };
  });
  return { globos, tubos, anclas: esfera.anclas, materiales: materialesDecoracion(globos, tubos), avisos: [] };
}

/** Arma cualquier forma en su espacio local (cm, centrada en x, apoyada en y = 0, mirando a +z). */
export function armarForma(o: OpcionesForma): FormaArmada {
  switch (o.clase) {
    case "rellena": return armarRellena(o);
    case "esfera": {
      const prueba = armarEsfera(o, { x: 0, y: 0, z: 0 });
      const esfera = armarEsfera(o, { x: 0, y: r1(prueba.altoCm / 2), z: 0 });
      return { globos: esfera.globos, tubos: [], anclas: esfera.anclas, materiales: materialesDecoracion(esfera.globos, []), avisos: [] };
    }
    case "cono": return armarCono(o);
    case "arbol": return armarArbol(o);
    case "aerostatico": return armarAerostatico(o);
  }
}

/** Qué es la forma, en español corto (para listas y fichas). */
export function nombreForma(o: OpcionesForma): string {
  switch (o.clase) {
    case "rellena": {
      const que = o.contorno.tipo === "predefinido" ? CONTORNOS_PREDEFINIDOS.find((c) => c.id === (o.contorno as { id: ContornoPredefinido }).id)?.nombre ?? "Forma" : o.contorno.tipo === "texto" ? `«${o.contorno.texto}»` : "Silueta libre";
      const tecnica = o.tecnica.tipo === "celdas" ? "relleno de globos" : o.tecnica.tipo === "malla" ? "malla Link-O-Loon" : "orgánico";
      return `${que} (${tecnica}${o.marcoCm ? ", marco" : ""})`;
    }
    case "esfera": return "Esfera de globos";
    case "cono": return o.tecnica === "organico" ? "Cono orgánico" : "Cono de anillos";
    case "arbol": return "Árbol con copa";
    case "aerostatico": return "Globo aerostático";
  }
}

/** La forma en inglés corto (para el prompt de la imagen). */
export function formaEnIngles(o: OpcionesForma): string {
  switch (o.clase) {
    case "rellena": {
      const que = o.contorno.tipo === "predefinido" ? o.contorno.id.replace("corazon", "heart").replace("estrella", "star").replace("circulo", "circle").replace("aro", "ring").replace("ancla", "anchor").replace("cruz", "cross").replace("nube", "cloud").replace("castillo", "castle") : o.contorno.tipo === "texto" ? `"${o.contorno.texto}" lettering` : "custom";
      const tecnica = o.tecnica.tipo === "celdas" ? "filled with small round balloons" : o.tecnica.tipo === "malla" ? "made of a Link-O-Loon balloon mesh" : "filled with organic mixed-size balloons";
      return `a flat ${que} shape ${tecnica}${o.marcoCm ? " as a frame with an open center" : ""}`;
    }
    case "esfera": return "a geodesic sphere of balloons";
    case "cono": return "a cone-shaped balloon Christmas tree";
    case "arbol": return "a balloon tree with a column trunk and a round canopy";
    case "aerostatico": return "a hot-air balloon made of balloons with a basket";
  }
}
