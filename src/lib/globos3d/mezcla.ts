import type { Vec3 } from "./modulos";
import { colocarEn, colocarTubosEn, type GloboDecoracion, type TuboDecoracion } from "./decoraciones";
import { armarDecoracion, decoracionPredefinida, type Decoracion, type DecoracionArmada, type MaterialDecoracion } from "./figuras";
import type { OpcionesParedTrenzas } from "./pared-trenzas";

/**
 * Mezcla de decoraciones sobre una pared: varias decoraciones a la vez, repartidas en las anclas.
 * - «proporcional»: `total` decoraciones repartidas según el peso de cada una (resto mayor), puestas de la más
 *   grande a la más chica en anclas barajadas con la semilla: queda desordenado como un mural orgánico, pero
 *   siempre igual para la misma semilla.
 * - «ciclico»: recorre las anclas en orden de lectura (de arriba abajo, de izquierda a derecha) y pone las
 *   decoraciones en ciclo (cada una tantas veces seguidas como su peso): un patrón regular.
 * En los dos, una decoración solo entra donde no se monta con las ya puestas (`separacionCm` entre bordes; si es
 * negativa, se permite que se pisen un poco) y su centro queda dentro de la pared.
 * - «fijo»: cada decoración en su sitio exacto (`fijas`: posición relativa en la pared y giro), medido de una foto;
 *   así una réplica queda igual a la foto aunque cambie el tamaño de la pared.
 * Unidades: cm.
 */
export type ElementoMezcla = { nombre: string; decoracion: Decoracion; peso: number };

/** Un sitio fijo: `u` de izquierda (0) a derecha (1) y `v` de abajo (0) arriba (1) de la pared; giro en grados. */
export type ColocacionFija = { elemento: number; u: number; v: number; giroGrados: number };

export type MezclaDecoraciones = {
  elementos: ElementoMezcla[];
  modo: "proporcional" | "ciclico" | "fijo";
  /** Solo en «fijo»: dónde va cada decoración. */
  fijas?: ColocacionFija[];
  semilla: number;
  /** Cuántas decoraciones poner en total (las que quepan). */
  total: number;
  separacionCm: number;
  /** Gira al azar (con la semilla) las flores sobre su eje; el moño y la estrella siempre quedan derechos. */
  giroAleatorio: boolean;
};

export type AnclaParaMezcla = { posicion: Vec3; normal: Vec3 };

export type Colocacion = { elemento: number; ancla: number; giroRad: number };

/** Generador pseudoaleatorio con semilla (mulberry32): mismo número, mismo reparto. */
export function aleatorio(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajar<T>(lista: readonly T[], azar: () => number): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  }
  return copia;
}

/** Cuántas de cada una para llegar a `total` según los pesos (método del resto mayor). */
export function cuotas(pesos: readonly number[], total: number): number[] {
  const suma = pesos.reduce((s, p) => s + Math.max(0, p), 0);
  if (suma <= 0 || total <= 0) return pesos.map(() => 0);
  const exactas = pesos.map((p) => (Math.max(0, p) / suma) * total);
  const enteras = exactas.map(Math.floor);
  let faltan = total - enteras.reduce((s, n) => s + n, 0);
  const orden = exactas.map((e, i) => ({ i, resto: e - Math.floor(e) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of orden) { if (faltan <= 0) break; enteras[i]! += 1; faltan -= 1; }
  return enteras;
}

const GIRABLES = new Set<Decoracion["tipo"]>(["flor", "flor_tubito", "flor_corazones"]);

/**
 * Decide qué decoración va en qué ancla. `piezas` trae, por elemento de la mezcla, su radio (cm) y si se puede
 * girar. `limites`: el rectángulo de la pared (x, y) donde debe quedar el centro de cada decoración.
 */
export function repartirMezcla(
  anclas: readonly AnclaParaMezcla[],
  piezas: ReadonlyArray<{ radioCm: number; girable: boolean }>,
  mezcla: Pick<MezclaDecoraciones, "elementos" | "modo" | "semilla" | "total" | "separacionCm" | "giroAleatorio">,
  limites?: { minX: number; maxX: number; minY: number; maxY: number },
): Colocacion[] {
  const azar = aleatorio(mezcla.semilla);
  const pesos = mezcla.elementos.map((e) => Math.max(0, e.peso));
  const total = Math.max(0, Math.round(mezcla.total));
  if (!pesos.some((p) => p > 0) || total === 0 || anclas.length === 0) return [];

  // La secuencia de decoraciones a poner.
  let secuencia: number[];
  let orden: number[];
  if (mezcla.modo === "proporcional") {
    const cuenta = cuotas(pesos, total);
    secuencia = cuenta.flatMap((n, i) => Array.from({ length: n }, () => i));
    // De la más grande a la más chica: las grandes primero encuentran sitio.
    secuencia.sort((a, b) => (piezas[b]?.radioCm ?? 0) - (piezas[a]?.radioCm ?? 0) || a - b);
    orden = barajar(anclas.map((_, i) => i), azar);
  } else {
    const ciclo = pesos.flatMap((p, i) => Array.from({ length: p > 0 ? Math.max(1, Math.round(p)) : 0 }, () => i));
    secuencia = Array.from({ length: total }, (_, k) => ciclo[k % ciclo.length]!);
    // Orden de lectura: de arriba abajo y de izquierda a derecha.
    orden = anclas.map((_, i) => i).sort((a, b) => anclas[b]!.posicion.y - anclas[a]!.posicion.y || anclas[a]!.posicion.x - anclas[b]!.posicion.x);
  }

  const puestas: Array<Colocacion & { x: number; y: number; z: number; r: number }> = [];
  const usadas = new Set<number>();
  for (const elemento of secuencia) {
    const r = piezas[elemento]?.radioCm ?? 0;
    for (const indice of orden) {
      if (usadas.has(indice)) continue;
      const p = anclas[indice]!.posicion;
      if (limites && (p.x < limites.minX + r * 0.45 || p.x > limites.maxX - r * 0.45 || p.y < limites.minY + r * 0.45 || p.y > limites.maxY - r * 0.45)) continue;
      if (puestas.some((q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < r + q.r + mezcla.separacionCm)) continue;
      usadas.add(indice);
      const giroRad = mezcla.giroAleatorio && piezas[elemento]?.girable ? azar() * 2 * Math.PI : 0;
      puestas.push({ elemento, ancla: indice, giroRad, x: p.x, y: p.y, z: p.z, r });
      break;
    }
  }
  return puestas.map(({ elemento, ancla, giroRad }) => ({ elemento, ancla, giroRad }));
}

/** Suma listas de materiales por formato y color. */
export function sumarMateriales(...listas: ReadonlyArray<ReadonlyArray<MaterialDecoracion>>): MaterialDecoracion[] {
  const cuenta = new Map<string, MaterialDecoracion>();
  for (const lista of listas) {
    for (const m of lista) {
      const clave = `${m.formatoId}|${m.codigo}`;
      const actual = cuenta.get(clave);
      if (actual) actual.cantidad += m.cantidad; else cuenta.set(clave, { ...m });
    }
  }
  return [...cuenta.values()];
}

/** Lo que se hunde una decoración en la pared al amarrarla (el látex cede). */
const HUNDIMIENTO_CM = 2;

export type ParedDecorada = {
  colocaciones: Array<Colocacion & { nombre: string }>;
  globos: GloboDecoracion[];
  tubos: TuboDecoracion[];
  /** Solo las decoraciones (la pared lleva sus propios materiales). */
  materiales: MaterialDecoracion[];
  porElemento: number[];
};

/**
 * Arma cada decoración de la mezcla una vez, la reparte en las anclas y la apoya sobre la pared: el plano de
 * atrás de la decoración queda sobre lo más adelantado de la superficie bajo ella (menos lo que cede el látex).
 */
export function decorarPared(opciones: {
  anclas: readonly AnclaParaMezcla[];
  mezcla: MezclaDecoraciones;
  superficie?: (x: number, y: number) => number;
  limites?: { minX: number; maxX: number; minY: number; maxY: number };
}): ParedDecorada {
  const { mezcla, superficie, limites } = opciones;
  const armadas: DecoracionArmada[] = mezcla.elementos.map((e) => armarDecoracion(e.decoracion));
  const piezas = armadas.map((a, i) => ({ radioCm: a.diametroCm / 2, girable: GIRABLES.has(mezcla.elementos[i]!.decoracion.tipo) }));
  let anclas = opciones.anclas;
  let colocaciones: Colocacion[];
  if (mezcla.modo === "fijo") {
    // Sitios medidos en la foto, relativos a la pared (si no hay límites, a lo que ocupan las anclas).
    const xs = anclas.map((a) => a.posicion.x), ys = anclas.map((a) => a.posicion.y);
    const caja = limites ?? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const fijas = (mezcla.fijas ?? []).filter((f) => f.elemento >= 0 && f.elemento < mezcla.elementos.length);
    anclas = fijas.map((f) => ({ posicion: { x: caja.minX + f.u * (caja.maxX - caja.minX), y: caja.minY + f.v * (caja.maxY - caja.minY), z: 0 }, normal: { x: 0, y: 0, z: 1 } }));
    colocaciones = fijas.map((f, i) => ({ elemento: f.elemento, ancla: i, giroRad: (f.giroGrados * Math.PI) / 180 }));
  } else {
    colocaciones = repartirMezcla(anclas, piezas, mezcla, limites);
  }
  const globos: GloboDecoracion[] = [];
  const tubos: TuboDecoracion[] = [];
  const listas: MaterialDecoracion[][] = [];
  const porElemento = mezcla.elementos.map(() => 0);
  for (const c of colocaciones) {
    const armada = armadas[c.elemento]!;
    const ancla = anclas[c.ancla]!;
    let posicion = ancla.posicion;
    if (superficie) {
      // Lo más adelantado de la pared bajo la decoración (centro y dos anillos de muestras).
      const r = armada.diametroCm / 2;
      let frente = superficie(posicion.x, posicion.y);
      for (const f of [0.3, 0.6]) for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        frente = Math.max(frente, superficie(posicion.x + Math.cos(a) * r * f, posicion.y + Math.sin(a) * r * f));
      }
      posicion = { ...posicion, z: Math.max(posicion.z, frente - HUNDIMIENTO_CM + armada.fondoCm) };
    }
    const puesta = { posicion, normal: ancla.normal };
    globos.push(...colocarEn(armada.globos, puesta, c.giroRad));
    tubos.push(...colocarTubosEn(armada.tubos, puesta, c.giroRad));
    listas.push(armada.materiales);
    porElemento[c.elemento]! += 1;
  }
  return { colocaciones: colocaciones.map((c) => ({ ...c, nombre: mezcla.elementos[c.elemento]?.nombre ?? "" })), globos, tubos, materiales: sumarMateriales(...listas), porElemento };
}

/**
 * Celebra ed. 27, p. 42 («Malla con flores orgánicas»), tal como la foto:
 * - pared: trenzas de cuartetos rosados alternando R-12 (grande, 25 cm) y R-9 (chico, 20 cm,
 *   el tamaño chico del PDF de Sempertex). La revista pide 128 R-12 y 128 R-9 (64 cuartetos); la foto, casi
 *   cuadrada, se arma con 5 trenzas de 13 cuartetos (2,5 × 2,17 m): 33 grandes y 32 chicos, un cuarteto
 *   grande más que la revista (132 R-12).
 * - decoraciones contadas en la foto: 3 flores grandes de R-12 (Graffiti Rosa en la revista), 7 flores de
 *   corazones, 7 flores de burbujas, 2 flores de lazos dorados, 1 flor de lazos fucsia, 2 flores de R-5
 *   rosadas, 1 racimo dorado, 1 estrella dorada y 1 moño fucsia: 25.
 * - cada una en su sitio de la foto (modo «fijo»): centros medidos en píxeles sobre la foto de 423 × 467 px,
 *   con el cuerpo de la pared entre x 39–366 y y 79–393; `u` y `v` son esas medidas relativas a la pared.
 */
const PARED_FOTO = { x0: 39, x1: 366, y0: 79, y1: 393 };
const enFoto = (elemento: number, x: number, y: number, giroGrados = 0): ColocacionFija => ({
  elemento,
  u: Math.round(((x - PARED_FOTO.x0) / (PARED_FOTO.x1 - PARED_FOTO.x0)) * 1000) / 1000,
  v: Math.round(((PARED_FOTO.y1 - y) / (PARED_FOTO.y1 - PARED_FOTO.y0)) * 1000) / 1000,
  giroGrados,
});
// Índices de `elementos` del preset.
const GRANDE = 0, CORAZONES = 1, BURBUJAS = 2, LAZOS_DORADOS = 3, LAZOS_FUCSIA = 4, R5_ROSADA = 5, RACIMO = 6, ESTRELLA = 7, MONO = 8;

export const CELEBRA_27: { pared: OpcionesParedTrenzas; mezcla: MezclaDecoraciones } = {
  pared: {
    grande: { formatoId: "R-12", infladoCm: 25 }, chico: { formatoId: "R-9", infladoCm: 20 },
    anchoCm: 230, altoCm: 215, patron: "un_color",
    // La revista dice Pastel Mate Rosado (609, #e6cfd6), pero el rosado medido en la foto (#eda0b2) está mucho más
    // cerca del Fashion Rosado (009, #f2b6c8): va el 009 para que el render quede como la foto.
    colores: ["009"], empiezaCon: "grande",
  },
  mezcla: {
    modo: "fijo", semilla: 27, total: 25, separacionCm: -4, giroAleatorio: false,
    fijas: [
      enFoto(GRANDE, 90, 140), enFoto(GRANDE, 326, 120), enFoto(GRANDE, 288, 277),
      enFoto(CORAZONES, 265, 107), enFoto(CORAZONES, 152, 168), enFoto(CORAZONES, 218, 163), enFoto(CORAZONES, 65, 212),
      enFoto(CORAZONES, 326, 207), enFoto(CORAZONES, 158, 355), enFoto(CORAZONES, 285, 357),
      enFoto(BURBUJAS, 155, 112), enFoto(BURBUJAS, 107, 212), enFoto(BURBUJAS, 240, 212), enFoto(BURBUJAS, 117, 262),
      enFoto(BURBUJAS, 218, 340), enFoto(BURBUJAS, 335, 340), enFoto(BURBUJAS, 107, 375),
      enFoto(LAZOS_DORADOS, 205, 212), enFoto(LAZOS_DORADOS, 218, 283),
      enFoto(LAZOS_FUCSIA, 286, 170),
      enFoto(R5_ROSADA, 150, 262), enFoto(R5_ROSADA, 155, 320),
      enFoto(RACIMO, 66, 265), enFoto(ESTRELLA, 198, 120), enFoto(MONO, 82, 330),
    ],
    elementos: [
      { nombre: "Flor grande de R-12", decoracion: decoracionPredefinida("flor_graffiti"), peso: 3 },
      { nombre: "Flor de corazones", decoracion: decoracionPredefinida("flor_corazones"), peso: 7 },
      { nombre: "Flor de 8 burbujas", decoracion: decoracionPredefinida("flor_burbujas"), peso: 7 },
      { nombre: "Flor de lazos dorados", decoracion: decoracionPredefinida("flor_lazos_dorados"), peso: 2 },
      { nombre: "Flor de lazos fucsia", decoracion: decoracionPredefinida("flor_lazos_rosados"), peso: 1 },
      { nombre: "Flor de R-5 rosada", decoracion: decoracionPredefinida("flor_r5_rosada"), peso: 2 },
      { nombre: "Racimo dorado", decoracion: decoracionPredefinida("racimo_dorado"), peso: 1 },
      { nombre: "Estrella dorada", decoracion: decoracionPredefinida("estrella_dorada"), peso: 1 },
      { nombre: "Moño fucsia", decoracion: decoracionPredefinida("mono_fucsia"), peso: 1 },
    ],
  },
};
