import { coloresDelFormato, formatoPorId, infladoValido } from "./formatos";
import type { Vec3 } from "./modulos";
import type { GloboDecoracion, TuboDecoracion } from "./decoraciones";
import { materialesDecoracion, type MaterialDecoracion } from "./figuras";
import { exigirColor, globoEn } from "./letras";
import { LARGO_ESLABON_POR_DIAMETRO } from "./paredes";
import { labDeRgb, type Lab } from "@/lib/rag/catalog/similitud-color";

/**
 * **Mural pixelado**: una imagen de colores hecha con globos, celda a celda (banderas, logos, siluetas, letras,
 * dibujos en malla). La imagen es una **matriz** de códigos Sempertex guardada en el código (nada de imágenes en el
 * repo): `filas` de símbolos, cada símbolo es el índice de su color en `colores` («a» = el primero) y «.» es una
 * celda sin globo (el fondo que se ve, el hueco de un corazón).
 *
 * Cada celda de la matriz es UN globo en su sitio real. Cómo se reparten los globos (la **disposición**, la de los
 * murales de Sempertex):
 * - `simple`: todos grandes, en retícula cuadrada, tocándose (paso 0,9 inflados).
 * - `tablero`: grande y chico alternados en las dos direcciones (R-12 con R-5 entre ellos, como la bandera de
 *   Australia): los grandes se tocan en diagonal y los chicos tapan el hueco del medio.
 * - `rejilla`: la malla de redondos con su unión: chicos (la unión) en las celdas (par, par), grandes en las (par,
 *   impar) e (impar, par) y hueco en las (impar, impar): la malla de dos tamaños con agujeros (la «Pared corazón»). Es
 *   la `malla` de Link-O-Loon hecha con redondos.
 * - `malla`: Link-O-Loon. Los eslabones van en las celdas (impar, par) (horizontales) y (par, impar) (verticales),
 *   la pareja de unión (R-5, al frente y atrás) en cada nudo (par, par) y hueco en (impar, impar). Es la malla de
 *   `paredes.ts` girada 45°: el eslabón mide 1,47 inflados de nudo a nudo, así que cada celda mide 0,735 inflados.
 * Las celdas de hueco de la disposición no llevan globo aunque la matriz traiga un color ahí (se avisa).
 *
 * El paso (lo que mide una celda) sale de los globos: `simple` 0,9·d; `tablero` y `rejilla` el mayor de 0,9·d/√2
 * (grandes en diagonal) y 0,45·(d + d chico) (grande con chico); `malla` 1,47·d/2.
 *
 * `aplicaciones`: tubitos encima del mural (las cruces blancas de T-260 de la Union Jack), por celdas; `encima`: globos
 * sueltos amarrados sobre el mural (las diagonales rojas de la Union Jack), también por celdas (pueden ser fraccionarias).
 *
 * Además, `matrizDesdeImagen` convierte una imagen de referencia (RGBA) en matriz: cuantiza cada celda a la paleta
 * oficial del formato (solo los códigos que se fabrican en él), con un máximo de colores. El script
 * `scripts/mural-desde-imagen.ts` la usa con una foto local.
 *
 * Espacio local: cm, x a la derecha (centrado), y hacia arriba (apoyado en y = 0), +z hacia quien mira.
 */

export type DisposicionMural = "simple" | "tablero" | "rejilla" | "malla";

export const DISPOSICIONES_MURAL: ReadonlyArray<{ id: DisposicionMural; nombre: string; descripcion: string }> = [
  { id: "simple", nombre: "Un tamaño", descripcion: "Todas las celdas con el globo grande, en retícula cuadrada." },
  { id: "tablero", nombre: "Tablero de dos tamaños", descripcion: "Grande y chico alternados (R-12 con R-5)." },
  { id: "rejilla", nombre: "Rejilla con huecos", descripcion: "Chicos en los cruces, grandes entre ellos y hueco al medio." },
  { id: "malla", nombre: "Malla Link-O-Loon", descripcion: "Eslabones entre nudos, con su pareja de unión R-5." },
];

/** Símbolo de cada color de la matriz: «a» es `colores[0]`, «b» `colores[1]`… (y luego dígitos). «.» = sin globo. */
export const SIMBOLOS_MURAL = "abcdefghijklmnopqrstuvwxyz0123456789";
export const HUECO_MURAL = ".";

/** La imagen del mural: `filas[0]` es la fila de arriba y cada carácter una celda. */
export type MatrizMural = { colores: string[]; filas: string[] };

export type GloboMural = { formatoId: string; infladoCm: number };

/** Tubitos encima del mural: una polilínea por celdas (columna, fila; pueden ser fraccionarias). */
export type AplicacionMural = { formatoId: string; codigo: string; grosorCm?: number; puntos: Array<[number, number]> };

/** Globos redondos sueltos amarrados sobre el mural, uno en cada punto (columna, fila). */
export type EncimaMural = { formatoId: string; infladoCm: number; codigo: string; puntos: Array<[number, number]> };

export type OpcionesMural = {
  matriz: MatrizMural;
  disposicion: DisposicionMural;
  /** El globo de las celdas grandes (redondo) o el eslabón (Link-O-Loon, en `malla`). */
  grande: GloboMural;
  /** El globo chico (`tablero`, `rejilla`) o la unión (`malla`, R-5). `simple` no lo usa. */
  chico: GloboMural | null;
  aplicaciones?: AplicacionMural[];
  encima?: EncimaMural[];
};

export type RolCelda = "grande" | "chico" | "union" | "eslabon_h" | "eslabon_v" | "hueco";

export type CeldaMural = { fila: number; columna: number; rol: RolCelda; codigo: string | null; centro: Vec3 };

export type MuralArmado = {
  globos: GloboDecoracion[];
  tubos: TuboDecoracion[];
  anclas: Array<{ posicion: Vec3; normal: Vec3 }>;
  materiales: MaterialDecoracion[];
  celdas: CeldaMural[];
  pasoCm: number;
  anchoCm: number;
  altoCm: number;
  avisos: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10 + 0;

/** El código de una celda (null si es «.»); un símbolo sin color es un error. */
export function codigoDeCelda(m: MatrizMural, fila: number, columna: number): string | null {
  const s = m.filas[fila]?.[columna] ?? HUECO_MURAL;
  if (s === HUECO_MURAL || s === " ") return null;
  const i = SIMBOLOS_MURAL.indexOf(s);
  const codigo = i >= 0 ? m.colores[i] : undefined;
  if (codigo === undefined) throw new Error(`El símbolo «${s}» (fila ${fila + 1}, columna ${columna + 1}) no tiene color en la matriz.`);
  return codigo;
}

/** Filas × columnas de la matriz (todas las filas del mismo largo). */
export function tamanoMatriz(m: MatrizMural): { filas: number; columnas: number } {
  if (!m.filas.length) throw new Error("La matriz del mural no tiene filas.");
  const columnas = m.filas[0]!.length;
  m.filas.forEach((f, i) => { if (f.length !== columnas) throw new Error(`La fila ${i + 1} del mural tiene ${f.length} celdas y la primera ${columnas}.`); });
  return { filas: m.filas.length, columnas };
}

/** El papel de cada celda según la disposición. */
export function rolDeCelda(disposicion: DisposicionMural, fila: number, columna: number): Exclude<RolCelda, "hueco"> | "hueco" {
  const pi = columna % 2 === 0, pj = fila % 2 === 0;
  switch (disposicion) {
    case "simple": return "grande";
    case "tablero": return (fila + columna) % 2 === 0 ? "grande" : "chico";
    case "rejilla": return pi && pj ? "chico" : !pi && !pj ? "hueco" : "grande";
    case "malla": return pi && pj ? "union" : !pi && !pj ? "hueco" : !pi ? "eslabon_h" : "eslabon_v";
  }
}

function diametros(o: Pick<OpcionesMural, "disposicion" | "grande" | "chico">): { dG: number; dP: number; fG: string; fP: string | null } {
  const fg = formatoPorId(o.grande.formatoId);
  if (!fg) throw new Error(`Formato desconocido: ${o.grande.formatoId}`);
  if (o.disposicion === "malla" ? fg.tipo !== "link" || fg.largoCm : fg.tipo !== "redondo") {
    throw new Error(o.disposicion === "malla" ? "La malla del mural va con Link-O-Loon (LOL-6 o LOL-12)." : "Las celdas del mural van con globos redondos (R-5, R-9, R-12…).");
  }
  const dG = infladoValido(fg, o.grande.infladoCm);
  if (o.disposicion === "simple") return { dG, dP: 0, fG: fg.id, fP: null };
  if (!o.chico) throw new Error(`La disposición «${o.disposicion}» necesita el globo chico (o la unión).`);
  const fp = formatoPorId(o.chico.formatoId);
  if (!fp || fp.tipo !== "redondo") throw new Error("El globo chico del mural (o la unión) es redondo (R-5…).");
  return { dG, dP: infladoValido(fp, o.chico.infladoCm), fG: fg.id, fP: fp.id };
}

/** Lo que mide una celda (cm) con esos globos. */
export function pasoMural(o: Pick<OpcionesMural, "disposicion" | "grande" | "chico">): number {
  const { dG, dP } = diametros(o);
  switch (o.disposicion) {
    case "simple": return dG * 0.9;
    case "tablero":
    case "rejilla": return Math.max((dG * 0.9) / Math.SQRT2, 0.45 * (dG + dP));
    case "malla": return (dG * LARGO_ESLABON_POR_DIAMETRO) / 2;
  }
}

/** Ancho × alto del mural (cm), de borde a borde de los globos. */
export function medidasMural(o: OpcionesMural): { anchoCm: number; altoCm: number; pasoCm: number } {
  const { filas, columnas } = tamanoMatriz(o.matriz);
  const paso = pasoMural(o);
  const { dG } = diametros(o);
  const borde = o.disposicion === "malla" ? dG * 0.4 : dG;
  return { anchoCm: Math.round((columnas - 1) * paso + borde), altoCm: Math.round((filas - 1) * paso + borde), pasoCm: paso };
}

/** Las celdas del mural con su papel, su código y el centro de su globo (ya apoyado en y = 0). */
export function celdasMural(o: OpcionesMural): { celdas: CeldaMural[]; pasoCm: number; avisos: string[] } {
  const { filas, columnas } = tamanoMatriz(o.matriz);
  const paso = pasoMural(o);
  const { dG, dP } = diametros(o);
  // Lo más bajo: la fila de abajo, con su globo (en la malla, el eslabón vertical o la unión).
  const abajo = o.disposicion === "malla" ? dG * 0.5 : Math.max(dG, dP) / 2;
  const avisos: string[] = [];
  let ignoradas = 0;
  const celdas: CeldaMural[] = [];
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < columnas; i++) {
      const rol = rolDeCelda(o.disposicion, j, i);
      const codigo = codigoDeCelda(o.matriz, j, i);
      if (rol === "hueco" && codigo !== null) ignoradas++;
      celdas.push({ fila: j, columna: i, rol, codigo: rol === "hueco" ? null : codigo, centro: { x: r1((i - (columnas - 1) / 2) * paso), y: r1((filas - 1 - j) * paso + abajo), z: 0 } });
    }
  }
  if (ignoradas) avisos.push(`${ignoradas} celdas de la matriz caen en huecos de la ${o.disposicion} y no llevan globo.`);
  return { celdas, pasoCm: paso, avisos };
}

export function armarMural(o: OpcionesMural): MuralArmado {
  const { dG, dP, fG, fP } = diametros(o);
  const { celdas, pasoCm, avisos } = celdasMural(o);
  const globos: GloboDecoracion[] = [];
  const amarre = Math.max(0.35, dP * 0.035);
  for (const c of celdas) {
    if (c.codigo === null) continue;
    switch (c.rol) {
      case "hueco": break;
      case "grande":
        exigirColor(fG, c.codigo);
        globos.push(globoEn(fG, dG, c.codigo, c.centro));
        break;
      case "chico":
        exigirColor(fP!, c.codigo);
        globos.push(globoEn(fP!, dP, c.codigo, c.centro));
        break;
      case "eslabon_h":
      case "eslabon_v":
        exigirColor(fG, c.codigo);
        globos.push(globoEn(fG, dG, c.codigo, c.centro, c.rol === "eslabon_h" ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
        break;
      case "union":
        // La pareja de unión: un globito hacia el frente y otro hacia atrás, amarrados en el nudo.
        exigirColor(fP!, c.codigo);
        for (const z of [1, -1]) globos.push({ formatoId: fP!, infladoCm: dP, codigo: c.codigo, nudo: { x: c.centro.x, y: c.centro.y, z: r1(z * amarre) }, direccion: { x: 0, y: 0, z }, cuelloExtraCm: 0 });
        break;
    }
  }
  const tubos: TuboDecoracion[] = [];
  const { filas, columnas } = tamanoMatriz(o.matriz);
  const abajo = o.disposicion === "malla" ? dG * 0.5 : Math.max(dG, dP) / 2;
  for (const a of o.aplicaciones ?? []) {
    const f = formatoPorId(a.formatoId);
    if (!f || f.tipo !== "tubito") throw new Error("Las aplicaciones del mural son tubitos (T-160, T-260, T-360).");
    exigirColor(f.id, a.codigo);
    if (a.puntos.length < 2) throw new Error("Una aplicación del mural necesita al menos dos puntos.");
    const grosor = a.grosorCm ?? f.infladoDecoracionCm;
    tubos.push({
      formatoId: f.id, grosorCm: grosor, codigo: a.codigo, cerrado: false,
      puntos: a.puntos.map(([i, j]) => ({ x: r1((i - (columnas - 1) / 2) * pasoCm), y: r1((filas - 1 - j) * pasoCm + abajo), z: r1(dG / 2 + grosor / 2) })),
    });
  }
  for (const e of o.encima ?? []) {
    const f = formatoPorId(e.formatoId);
    if (!f || f.tipo !== "redondo") throw new Error("Lo que va encima del mural son globos redondos.");
    exigirColor(f.id, e.codigo);
    const d = infladoValido(f, e.infladoCm);
    // Delante del mural, metido a medias entre los globos de debajo (amarrado a ellos).
    for (const [i, j] of e.puntos) globos.push(globoEn(f.id, d, e.codigo, { x: r1((i - (columnas - 1) / 2) * pasoCm), y: r1((filas - 1 - j) * pasoCm + abajo), z: r1((dG + d) * 0.38) }));
  }
  // Anclas: una de cada cuatro celdas grandes (o eslabones), al frente.
  const anclas = celdas.filter((c) => c.codigo !== null && c.rol !== "chico" && c.rol !== "union").filter((_, k) => k % 4 === 1)
    .map((c) => ({ posicion: { x: c.centro.x, y: c.centro.y, z: r1(dG / 2) }, normal: { x: 0, y: 0, z: 1 } }));
  const { anchoCm, altoCm } = medidasMural(o);
  return { globos, tubos, anclas, materiales: materialesDecoracion(globos, tubos), celdas, pasoCm, anchoCm, altoCm, avisos };
}

// ----------------------------------------------------------------------------------------------------------
// Imagen de referencia → matriz
// ----------------------------------------------------------------------------------------------------------

/** Una imagen en memoria: RGBA de 8 bits por canal, fila por fila (lo que da `sharp(...).ensureAlpha().raw()`). */
export type ImagenRGBA = { ancho: number; alto: number; datos: ArrayLike<number> };

export type OpcionesConversion = {
  columnas: number;
  filas: number;
  /** El formato cuyos colores oficiales se usan (solo los que se fabrican en él). */
  formatoId: string;
  maxColores: number;
  /** Limitar la paleta a estos códigos (los productos de la idea, por ejemplo). */
  codigos?: readonly string[];
  /** Lo que se parece al fondo (o es transparente) queda «.»: sin globo. */
  fondo?: { hex: string; toleranciaDeltaE?: number } | null;
  /** Solo esta parte de la imagen (píxeles). */
  recorte?: { x: number; y: number; ancho: number; alto: number } | null;
  /** Si se da, las celdas de hueco de esa disposición salen «.». */
  disposicion?: DisposicionMural;
};

const labDeHex = (hex: string): Lab => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return labDeRgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
};
const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Cuantiza una imagen a la paleta oficial de un formato, celda a celda: cada píxel del centro de la celda (el 70 %
 * del medio, para no mezclar con la vecina) vota por el color oficial más cercano (ΔE76 en CIELAB) o por el fondo;
 * gana el más votado. Con más colores que `maxColores`, se quedan los más votados de toda la imagen y se vuelve a
 * votar solo entre ellos. Determinista.
 */
export function matrizDesdeImagen(img: ImagenRGBA, o: OpcionesConversion): MatrizMural {
  if (o.columnas < 1 || o.filas < 1) throw new Error("El mural necesita al menos una fila y una columna.");
  if (o.columnas > 200 || o.filas > 200) throw new Error("Como mucho 200 × 200 celdas.");
  if (img.datos.length < img.ancho * img.alto * 4) throw new Error("La imagen no trae RGBA completo.");
  const permitidos = o.codigos ? new Set(o.codigos) : null;
  const paleta = coloresDelFormato(o.formatoId).filter((r) => !permitidos || permitidos.has(r.codigo)).map((r) => ({ codigo: r.codigo, lab: labDeHex(r.hexGlobo) }));
  if (!paleta.length) throw new Error(`No hay colores oficiales para ${o.formatoId}${permitidos ? " entre los pedidos" : ""}.`);
  const max = Math.max(1, Math.min(SIMBOLOS_MURAL.length, Math.round(o.maxColores)));
  const fondo = o.fondo ? { lab: labDeHex(o.fondo.hex), tol: o.fondo.toleranciaDeltaE ?? 12 } : null;
  const rec = o.recorte ?? { x: 0, y: 0, ancho: img.ancho, alto: img.alto };
  // Los píxeles de cada celda, ya en Lab (o null si son fondo), una sola vez.
  const muestras: Array<Array<Lab | null>> = [];
  for (let j = 0; j < o.filas; j++) {
    for (let i = 0; i < o.columnas; i++) {
      const x0 = rec.x + (i + 0.15) * (rec.ancho / o.columnas), x1 = rec.x + (i + 0.85) * (rec.ancho / o.columnas);
      const y0 = rec.y + (j + 0.15) * (rec.alto / o.filas), y1 = rec.y + (j + 0.85) * (rec.alto / o.filas);
      const pasoX = Math.max(1, (x1 - x0) / 6), pasoY = Math.max(1, (y1 - y0) / 6);
      const celda: Array<Lab | null> = [];
      for (let y = y0; y < y1; y += pasoY) {
        for (let x = x0; x < x1; x += pasoX) {
          const px = Math.min(img.ancho - 1, Math.max(0, Math.floor(x))), py = Math.min(img.alto - 1, Math.max(0, Math.floor(y)));
          const k = (py * img.ancho + px) * 4;
          const alfa = img.datos[k + 3] ?? 255;
          if (alfa < 128) { celda.push(null); continue; }
          const lab = labDeRgb(img.datos[k] ?? 0, img.datos[k + 1] ?? 0, img.datos[k + 2] ?? 0);
          celda.push(fondo && deltaE(lab, fondo.lab) <= fondo.tol ? null : lab);
        }
      }
      muestras.push(celda);
    }
  }
  const votar = (lista: ReadonlyArray<{ codigo: string; lab: Lab }>) => muestras.map((celda) => {
    const votos = new Map<string, number>();
    for (const lab of celda) {
      let mejor = HUECO_MURAL, dist = Infinity;
      if (lab) for (const c of lista) { const d = deltaE(lab, c.lab); if (d < dist) { dist = d; mejor = c.codigo; } }
      votos.set(mejor, (votos.get(mejor) ?? 0) + 1);
    }
    let ganador = HUECO_MURAL, n = -1;
    // Empate: el primero de la paleta (orden fijo), con el fondo al final.
    for (const c of [...lista.map((x) => x.codigo), HUECO_MURAL]) { const v = votos.get(c) ?? 0; if (v > n) { n = v; ganador = c; } }
    return ganador;
  });
  let elegidos = votar(paleta);
  const cuenta = new Map<string, number>();
  for (const c of elegidos) if (c !== HUECO_MURAL) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
  if (cuenta.size > max) {
    const quedan = new Set([...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([c]) => c));
    elegidos = votar(paleta.filter((c) => quedan.has(c.codigo)));
  }
  // Los colores en orden de aparición (de arriba abajo, de izquierda a derecha).
  const colores: string[] = [];
  for (const c of elegidos) if (c !== HUECO_MURAL && !colores.includes(c)) colores.push(c);
  const filas: string[] = [];
  for (let j = 0; j < o.filas; j++) {
    let fila = "";
    for (let i = 0; i < o.columnas; i++) {
      const c = elegidos[j * o.columnas + i]!;
      const hueco = c === HUECO_MURAL || (o.disposicion !== undefined && rolDeCelda(o.disposicion, j, i) === "hueco");
      fila += hueco ? HUECO_MURAL : SIMBOLOS_MURAL[colores.indexOf(c)]!;
    }
    filas.push(fila);
  }
  return { colores, filas };
}

/** La matriz como texto de TypeScript, lista para pegar en el código. */
export function matrizComoCodigo(m: MatrizMural): string {
  return `{\n  colores: [${m.colores.map((c) => `"${c}"`).join(", ")}],\n  filas: [\n${m.filas.map((f) => `    "${f}",`).join("\n")}\n  ],\n}`;
}

// ----------------------------------------------------------------------------------------------------------
// Ayudas para dibujar matrices en el código (banderas y figuras geométricas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Una matriz dibujada con una función: `pintar(columna, fila)` da el índice del color (o null: sin globo). Las
 * coordenadas van del centro de la celda: (0,5; 0,5) es la de arriba a la izquierda.
 */
export function matrizDibujada(columnas: number, filas: number, colores: string[], pintar: (x: number, y: number) => number | null): MatrizMural {
  const salida: string[] = [];
  for (let j = 0; j < filas; j++) {
    let fila = "";
    for (let i = 0; i < columnas; i++) {
      const k = pintar(i + 0.5, j + 0.5);
      fila += k === null ? HUECO_MURAL : SIMBOLOS_MURAL[k] ?? HUECO_MURAL;
    }
    salida.push(fila);
  }
  return { colores, filas: salida };
}

/** Par-impar: si (x, y) cae dentro del polígono. */
export function dentroDePoligono(x: number, y: number, puntos: ReadonlyArray<readonly [number, number]>): boolean {
  let dentro = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const [xi, yi] = puntos[i]!, [xj, yj] = puntos[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Estrella de 5 puntas de radio 4,4 (y hacia arriba). */
const ESTRELLA_5: ReadonlyArray<readonly [number, number]> = Array.from({ length: 10 }, (_, k) => {
  const a = Math.PI / 2 + (Math.PI * k) / 5, r = k % 2 === 0 ? 4.4 : 1.8;
  return [r * Math.cos(a), r * Math.sin(a)] as const;
});

// ----------------------------------------------------------------------------------------------------------
// Murales de muestra (Decoraciones pequeñas)
// ----------------------------------------------------------------------------------------------------------

export const MURALES_PREDEFINIDOS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; mural: OpcionesMural }> = [
  {
    id: "mural_corazon_tablero", nombre: "Corazón en tablero", descripcion: "Corazón rojo sobre blanco, R-12 con R-5 alternados (2 × 1,6 m).",
    mural: {
      disposicion: "tablero", grande: { formatoId: "R-12", infladoCm: 25 }, chico: { formatoId: "R-5", infladoCm: 12 },
      matriz: matrizDibujada(13, 11, ["005", "015"], (x, y) => {
        const u = (x - 6.5) / 5, v = 1.32 - (y - 0.5) * 0.235;
        return (u * u + v * v - 1) ** 3 - u * u * v * v * v <= 0 ? 1 : 0;
      }),
    },
  },
  {
    id: "mural_bandera_malla", nombre: "Bandera en malla", descripcion: "Tres franjas en malla Link-O-Loon 12 con uniones R-5.",
    mural: {
      disposicion: "malla", grande: { formatoId: "LOL-12", infladoCm: 25 }, chico: { formatoId: "R-5", infladoCm: 10 },
      matriz: matrizDibujada(11, 9, ["021", "041", "015"], (x, y) => (Math.floor(x - 0.5) % 2 === 1 && Math.floor(y - 0.5) % 2 === 1 ? null : y < 4 ? 0 : y < 6.5 ? 1 : 2)),
    },
  },
  {
    id: "mural_pixel_r5", nombre: "Pixel de R-5", descripcion: "Estrella amarilla sobre azul, un R-5 por pixel (1,2 × 1,2 m).",
    mural: {
      disposicion: "simple", grande: { formatoId: "R-5", infladoCm: 12 }, chico: null,
      matriz: matrizDibujada(11, 11, ["041", "020"], (x, y) => (dentroDePoligono((x - 5.5) * 0.85, (5.9 - y) * 0.85, ESTRELLA_5) ? 1 : 0)),
    },
  },
];

/** El mural en inglés corto (para el prompt de la imagen). */
export function muralEnIngles(o: OpcionesMural): string {
  const como = o.disposicion === "malla" ? "a Link-O-Loon balloon mesh wall" : o.disposicion === "simple" ? "a flat wall of same-size round balloons" : "a flat wall of alternating large and small round balloons";
  return `a pixel-art balloon mural (${como}) whose balloons form a picture in ${o.matriz.colores.length} colors`;
}
