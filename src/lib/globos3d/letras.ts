import { coloresDelFormato, formatoPorId, infladoValido } from "./formatos";
import { centroCuerpo } from "./geometria";
import type { Vec3 } from "./modulos";
import { armarTrenza } from "./trenza";
import { materialesDecoracion, type MaterialDecoracion } from "./figuras";
import type { GloboDecoracion, TuboDecoracion } from "./decoraciones";

/**
 * **Letras y números de globos.** Una tipografía de trazos: cada carácter (0–9, A–Z, Ñ y el espacio) es un esqueleto
 * de segmentos y curvas en una caja de 10 de alto (la base en y = 0, la parte de arriba en y = 10). Con ese esqueleto
 * se arma la letra de tres maneras, como se hace en el taller:
 *
 * - **hilera**: globitos (R-5 por defecto) uno tras otro siguiendo el trazo, mirando al frente; si el grosor pedido
 *   es mayor que un globo, van varias hileras en paralelo, al tresbolillo;
 * - **cuartetos**: una trenza de cuartetos chicos a lo largo de cada trazo (la de `trenza.ts`), el número clásico de
 *   columna;
 * - **tubito**: dos T-260 trenzados entre sí siguiendo el trazo (el letrero de tubito).
 *
 * Una cadena («2012», «FELIZ», «ANA») se compone en fila o en columna (un carácter debajo de otro). Todo queda en el
 * plano XY (cm), centrado en x = 0, apoyado en y = 0 y mirando a +z. El esqueleto también lo usa `formas.ts` para
 * rellenar la silueta de un número con otra técnica (malla, celdas u orgánico).
 */

export type P2 = { x: number; y: number };
/** Un trazo del esqueleto: una polilínea (abierta o cerrada). */
export type Trazo = { puntos: P2[]; cerrado: boolean };
export type Caracter = { ancho: number; trazos: Trazo[] };

const p = (x: number, y: number): P2 => ({ x, y });
const abierto = (...puntos: P2[]): Trazo => ({ puntos, cerrado: false });

/** Arco de elipse de `desde` a `hasta` (grados, en el sentido que toque: si `hasta` < `desde`, va en sentido horario). */
function arco(cx: number, cy: number, rx: number, ry: number, desde: number, hasta: number): P2[] {
  const pasos = Math.max(2, Math.ceil(Math.abs(hasta - desde) / 12));
  const salida: P2[] = [];
  for (let i = 0; i <= pasos; i++) {
    const a = ((desde + ((hasta - desde) * i) / pasos) * Math.PI) / 180;
    salida.push(p(Math.round((cx + rx * Math.cos(a)) * 1000) / 1000, Math.round((cy + ry * Math.sin(a)) * 1000) / 1000));
  }
  return salida;
}

function elipse(cx: number, cy: number, rx: number, ry: number): Trazo {
  const puntos = arco(cx, cy, rx, ry, 90, 450);
  puntos.pop();
  return { puntos, cerrado: true };
}

/**
 * El esqueleto de cada carácter (alto 10). Pensado para que se lea hecho con globos: pocos trazos, curvas amplias, el
 * 1 con bandera y pie (como los números de columna), la I con remates para no confundirse con el 1, y el 0 más
 * estrecho que la O.
 */
export const ESQUELETOS: Readonly<Record<string, Caracter>> = {
  " ": { ancho: 3, trazos: [] },
  "0": { ancho: 5, trazos: [elipse(2.5, 5, 2.5, 5)] },
  "1": { ancho: 4.4, trazos: [abierto(p(0.6, 7.6), p(2.6, 10), p(2.6, 0)), abierto(p(0.4, 0), p(4.4, 0))] },
  "2": { ancho: 6, trazos: [abierto(...arco(3, 7, 3, 3, 160, -40), p(0, 0), p(6, 0))] },
  "3": { ancho: 6, trazos: [abierto(...arco(3, 7.6, 2.4, 2.4, 150, -90), ...arco(3, 2.6, 2.6, 2.6, 90, -150).slice(1))] },
  "4": { ancho: 6, trazos: [abierto(p(4.6, 0), p(4.6, 10), p(0, 3), p(6, 3))] },
  "5": { ancho: 6, trazos: [abierto(p(5.6, 10), p(0.9, 10), p(0.6, 5.6), ...arco(3, 3.2, 3, 3.2, 128, -145))] },
  "6": { ancho: 6, trazos: [abierto(...arco(6.2, 3, 6.2, 6.6, 85, 180)), elipse(3, 3, 3, 3)] },
  "7": { ancho: 6, trazos: [abierto(p(0, 10), p(6, 10), p(2, 0))] },
  "8": { ancho: 6, trazos: [elipse(3, 7.6, 2.4, 2.4), elipse(3, 2.7, 2.9, 2.7)] },
  "9": { ancho: 6, trazos: [elipse(3, 7, 3, 3), abierto(...arco(-0.2, 7, 6.2, 6.6, 0, -95))] },
  A: { ancho: 6.4, trazos: [abierto(p(0, 0), p(3.2, 10), p(6.4, 0)), abierto(p(1.2, 3.6), p(5.2, 3.6))] },
  B: { ancho: 6, trazos: [abierto(p(0, 0), p(0, 10)), abierto(p(0, 10), ...arco(3.4, 7.6, 2.4, 2.4, 90, -90), p(0, 5.2)), abierto(p(0, 5.2), ...arco(3.4, 2.6, 2.6, 2.6, 90, -90), p(0, 0))] },
  C: { ancho: 6.2, trazos: [abierto(...arco(3.4, 5, 3.4, 5, 45, 315))] },
  D: { ancho: 6.2, trazos: [abierto(p(0, 0), p(0, 10), ...arco(2, 5, 4.2, 5, 90, -90), p(0, 0))] },
  E: { ancho: 5.6, trazos: [abierto(p(5.6, 10), p(0, 10), p(0, 0), p(5.6, 0)), abierto(p(0, 5), p(4.4, 5))] },
  F: { ancho: 5.6, trazos: [abierto(p(5.6, 10), p(0, 10), p(0, 0)), abierto(p(0, 5), p(4.4, 5))] },
  G: { ancho: 6.6, trazos: [abierto(...arco(3.4, 5, 3.4, 5, 45, 350), p(6.6, 4.4), p(3.8, 4.4))] },
  H: { ancho: 6, trazos: [abierto(p(0, 0), p(0, 10)), abierto(p(6, 0), p(6, 10)), abierto(p(0, 5), p(6, 5))] },
  I: { ancho: 4, trazos: [abierto(p(2, 0), p(2, 10)), abierto(p(0, 10), p(4, 10)), abierto(p(0, 0), p(4, 0))] },
  J: { ancho: 5.6, trazos: [abierto(p(5.6, 10), ...arco(2.8, 2.8, 2.8, 2.8, 0, -180))] },
  K: { ancho: 6, trazos: [abierto(p(0, 0), p(0, 10)), abierto(p(6, 10), p(0, 3.6)), abierto(p(2, 5.7), p(6, 0))] },
  L: { ancho: 5.4, trazos: [abierto(p(0, 10), p(0, 0), p(5.4, 0))] },
  M: { ancho: 7.6, trazos: [abierto(p(0, 0), p(0, 10), p(3.8, 3.6), p(7.6, 10), p(7.6, 0))] },
  N: { ancho: 6.4, trazos: [abierto(p(0, 0), p(0, 10), p(6.4, 0), p(6.4, 10))] },
  "Ñ": { ancho: 6.4, trazos: [abierto(p(0, 0), p(0, 10), p(6.4, 0), p(6.4, 10)), abierto(p(1.4, 11.6), p(3.2, 12.4), p(5, 11.6))] },
  O: { ancho: 7, trazos: [elipse(3.5, 5, 3.5, 5)] },
  P: { ancho: 6, trazos: [abierto(p(0, 0), p(0, 10), p(3.4, 10), ...arco(3.4, 7.4, 2.6, 2.6, 90, -90), p(0, 4.8))] },
  Q: { ancho: 7, trazos: [elipse(3.5, 5, 3.5, 5), abierto(p(4.2, 2.2), p(7, -0.6))] },
  R: { ancho: 6.2, trazos: [abierto(p(0, 0), p(0, 10), p(3.4, 10), ...arco(3.4, 7.4, 2.6, 2.6, 90, -90), p(0, 4.8)), abierto(p(2.8, 4.8), p(6.2, 0))] },
  S: { ancho: 6, trazos: [abierto(...arco(3, 7.5, 2.6, 2.5, 25, 270), ...arco(3, 2.5, 2.9, 2.5, 90, -155).slice(1))] },
  T: { ancho: 6.4, trazos: [abierto(p(0, 10), p(6.4, 10)), abierto(p(3.2, 10), p(3.2, 0))] },
  U: { ancho: 6, trazos: [abierto(p(0, 10), ...arco(3, 3, 3, 3, 180, 360), p(6, 10))] },
  V: { ancho: 6.4, trazos: [abierto(p(0, 10), p(3.2, 0), p(6.4, 10))] },
  W: { ancho: 8.4, trazos: [abierto(p(0, 10), p(2, 0), p(4.2, 7), p(6.4, 0), p(8.4, 10))] },
  X: { ancho: 6.2, trazos: [abierto(p(0, 10), p(6.2, 0)), abierto(p(0, 0), p(6.2, 10))] },
  Y: { ancho: 6.4, trazos: [abierto(p(0, 10), p(3.2, 5), p(6.4, 10)), abierto(p(3.2, 5), p(3.2, 0))] },
  Z: { ancho: 6, trazos: [abierto(p(0, 10), p(6, 10), p(0, 0), p(6, 0))] },
};

/** Lo que se puede escribir: mayúsculas sin tilde (la Ñ se queda), dígitos y espacio. */
export function normalizarTexto(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/Ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0000/g, "Ñ");
}

// ----------------------------------------------------------------------------------------------------------
// Utilidades 2D (las usa también `formas.ts`)
// ----------------------------------------------------------------------------------------------------------

export function largoPolilinea(puntos: readonly P2[], cerrado: boolean): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) total += Math.hypot(puntos[i]!.x - puntos[i - 1]!.x, puntos[i]!.y - puntos[i - 1]!.y);
  if (cerrado && puntos.length > 2) total += Math.hypot(puntos[0]!.x - puntos[puntos.length - 1]!.x, puntos[0]!.y - puntos[puntos.length - 1]!.y);
  return total;
}

/**
 * `n` puntos repartidos a igual distancia sobre la polilínea (con su tangente unitaria). Abierta: del primero al
 * último, ambos incluidos; cerrada: la vuelta entera sin repetir el primero.
 */
export function repartirEnPolilinea(puntos: readonly P2[], cerrado: boolean, n: number): Array<{ punto: P2; tangente: P2 }> {
  const lista = cerrado ? [...puntos, puntos[0]!] : [...puntos];
  const total = largoPolilinea(lista, false);
  const salida: Array<{ punto: P2; tangente: P2 }> = [];
  if (lista.length < 2 || n <= 0) return salida;
  const cuantos = cerrado ? n : Math.max(1, n);
  for (let k = 0; k < cuantos; k++) {
    const s = cerrado ? (total * k) / n : cuantos === 1 ? total / 2 : (total * k) / (cuantos - 1);
    let resto = s;
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1]!, b = lista[i]!;
      const largo = Math.hypot(b.x - a.x, b.y - a.y);
      if (resto <= largo + 1e-9 || i === lista.length - 1) {
        const t = largo > 0 ? Math.min(1, Math.max(0, resto / largo)) : 0;
        salida.push({ punto: p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), tangente: largo > 0 ? p((b.x - a.x) / largo, (b.y - a.y) / largo) : p(1, 0) });
        break;
      }
      resto -= largo;
    }
  }
  return salida;
}

/** Distancia de un punto a un segmento. */
export function distanciaASegmento(x: number, y: number, a: P2, b: P2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}

/** Distancia de un punto a un trazo. */
export function distanciaATrazo(x: number, y: number, trazo: Trazo): number {
  const { puntos } = trazo;
  if (puntos.length === 1) return Math.hypot(x - puntos[0]!.x, y - puntos[0]!.y);
  let min = Infinity;
  for (let i = 1; i < puntos.length; i++) min = Math.min(min, distanciaASegmento(x, y, puntos[i - 1]!, puntos[i]!));
  if (trazo.cerrado && puntos.length > 2) min = Math.min(min, distanciaASegmento(x, y, puntos[puntos.length - 1]!, puntos[0]!));
  return min;
}

// ----------------------------------------------------------------------------------------------------------
// Composición de una cadena
// ----------------------------------------------------------------------------------------------------------

export type DisposicionTexto = "fila" | "columna";

/** Los trazos de una cadena en cm, con el carácter al que pertenece cada uno. */
export type TextoCompuesto = { trazos: Array<Trazo & { caracter: number }>; caracteres: string[]; anchoCm: number; altoCm: number; omitidos: string[] };

/**
 * Compone `texto` en cm: cada carácter mide `altoCm` de alto (su ancho, el de su esqueleto a esa escala) y entre uno y
 * otro quedan `separacionCm`. En fila, de izquierda a derecha; en columna, el primero arriba. Centrado en x = 0 y
 * apoyado en y = 0 (descontando `margenCm` abajo, para que el grosor del trazo no se meta bajo el piso).
 */
export function componerTexto(texto: string, o: { altoCm: number; separacionCm: number; disposicion: DisposicionTexto; margenCm?: number }): TextoCompuesto {
  const escala = o.altoCm / 10;
  const margen = o.margenCm ?? 0;
  const omitidos: string[] = [];
  const caracteres = [...normalizarTexto(texto)].filter((c) => {
    if (ESQUELETOS[c]) return true;
    omitidos.push(c);
    return false;
  });
  const trazos: TextoCompuesto["trazos"] = [];
  let cursor = 0;
  const n = caracteres.length;
  caracteres.forEach((c, i) => {
    const esqueleto = ESQUELETOS[c]!;
    const ancho = esqueleto.ancho * escala;
    let dx: number, dy: number;
    if (o.disposicion === "fila") { dx = cursor; dy = margen; cursor += ancho + o.separacionCm; }
    else { dx = -ancho / 2; dy = margen + (n - 1 - i) * (o.altoCm + o.separacionCm); }
    for (const t of esqueleto.trazos) trazos.push({ cerrado: t.cerrado, caracter: i, puntos: t.puntos.map((q) => p(dx + q.x * escala, dy + q.y * escala)) });
  });
  if (o.disposicion === "fila") {
    const ancho = Math.max(0, cursor - o.separacionCm);
    for (const t of trazos) for (const q of t.puntos) q.x -= ancho / 2;
  }
  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (const t of trazos) for (const q of t.puntos) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); }
  return { trazos, caracteres, anchoCm: Number.isFinite(minX) ? maxX - minX : 0, altoCm: maxY + margen, omitidos };
}

// ----------------------------------------------------------------------------------------------------------
// Armado con globos
// ----------------------------------------------------------------------------------------------------------

export type TecnicaLetras = "hilera" | "cuartetos" | "tubito";
export type PatronLetras = "un_color" | "por_letra" | "alternado";

export type OpcionesLetras = {
  texto: string;
  /** Alto de cada carácter (el de su esqueleto), en cm. */
  altoCm: number;
  /** Grosor del trazo: en hilera, cuántas hileras caben; en cuartetos, el inflado; en tubito, lo que abre la trenza. */
  grosorCm: number;
  disposicion: DisposicionTexto;
  tecnica: TecnicaLetras;
  /** Globo de la hilera o de los cuartetos («R-5») o tubito («T-260»). */
  formatoId: string;
  infladoCm: number;
  colores: string[];
  patron: PatronLetras;
  /** Espacio entre caracteres (cm); por defecto, un cuarto del alto. */
  separacionCm?: number;
};

export type LetrasArmadas = {
  globos: GloboDecoracion[];
  tubos: TuboDecoracion[];
  anclas: Array<{ posicion: Vec3; normal: Vec3 }>;
  materiales: MaterialDecoracion[];
  texto: TextoCompuesto;
  avisos: string[];
};

/** Un color oficial que no se fabrica en ese formato es un error, no se cambia por otro a escondidas. */
export function exigirColor(formatoId: string, codigo: string): void {
  if (!coloresDelFormato(formatoId).some((r) => r.codigo === codigo)) throw new Error(`El color ${codigo} no se fabrica en ${formatoId}.`);
}

function colorLetra(o: OpcionesLetras, caracter: number, indice: number): string {
  const c = (i: number) => o.colores[((i % o.colores.length) + o.colores.length) % Math.max(1, o.colores.length)] ?? o.colores[0] ?? "005";
  switch (o.patron) {
    case "un_color": return c(0);
    case "por_letra": return c(caracter);
    case "alternado": return c(indice);
  }
}

/** Un globo redondo con el centro del cuerpo en `centro`, mirando hacia `direccion`. */
export function globoEn(formatoId: string, infladoCm: number, codigo: string, centro: Vec3, direccion: Vec3 = { x: 0, y: 0, z: 1 }): GloboDecoracion {
  const tipo = formatoPorId(formatoId)?.tipo === "link" ? "link" : "redondo";
  const natural = centroCuerpo(tipo, infladoCm);
  return { formatoId, infladoCm, codigo, nudo: { x: centro.x - direccion.x * natural, y: centro.y - direccion.y * natural, z: centro.z - direccion.z * natural }, direccion, cuelloExtraCm: 0 };
}

export function centroDe(g: GloboDecoracion): Vec3 {
  const tipo = formatoPorId(g.formatoId)?.tipo === "link" ? "link" : "redondo";
  const l = centroCuerpo(tipo, g.infladoCm) + g.cuelloExtraCm;
  return { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l };
}

export function armarLetras(o: OpcionesLetras): LetrasArmadas {
  const formato = formatoPorId(o.formatoId);
  if (!formato) throw new Error(`Formato desconocido: ${o.formatoId}`);
  for (const codigo of o.colores) exigirColor(formato.id, codigo);
  if (!o.colores.length) throw new Error("Las letras necesitan al menos un color.");
  const avisos: string[] = [];
  const globos: GloboDecoracion[] = [];
  const tubos: TuboDecoracion[] = [];

  if (o.tecnica === "tubito") {
    if (formato.tipo !== "tubito") throw new Error("Las letras de tubito van con T-160, T-260 o T-360.");
    const g = formato.infladoDecoracionCm;
    const texto = componerTexto(o.texto, { altoCm: o.altoCm, separacionCm: o.separacionCm ?? o.altoCm * 0.25, disposicion: o.disposicion, margenCm: Math.max(g, o.grosorCm / 2) });
    // Dos tubitos que se enroscan uno en otro: cada uno da vueltas alrededor del trazo, a medio grosor, y el otro a
    // media vuelta (la trenza de dos). Una vuelta cada 7 grosores, como queda al torcerlos a mano.
    const abre = Math.max(g * 0.5, o.grosorCm / 2 - g / 2);
    const paso = g * 7;
    texto.trazos.forEach((t, k) => {
      const largo = largoPolilinea(t.puntos, t.cerrado);
      const n = Math.max(4, Math.round(largo / 1.5));
      const muestras = repartirEnPolilinea(t.puntos, t.cerrado, n);
      for (const fase of [0, Math.PI]) {
        const puntos: Vec3[] = muestras.map((m, i) => {
          const s = (largo * i) / (t.cerrado ? n : Math.max(1, n - 1));
          const a = (2 * Math.PI * s) / paso + fase;
          const normal = p(-m.tangente.y, m.tangente.x);
          return { x: m.punto.x + normal.x * abre * Math.cos(a), y: m.punto.y + normal.y * abre * Math.cos(a), z: abre * Math.sin(a) };
        });
        tubos.push({ formatoId: formato.id, grosorCm: g, codigo: colorLetra(o, t.caracter, k), puntos, cerrado: t.cerrado });
      }
    });
    if (texto.omitidos.length) avisos.push(`No sé escribir «${texto.omitidos.join("")}»: se dejó fuera.`);
    const anclas = texto.trazos.flatMap((t) => repartirEnPolilinea(t.puntos, t.cerrado, 2).map((m) => ({ posicion: { x: m.punto.x, y: m.punto.y, z: abre + g / 2 }, normal: { x: 0, y: 0, z: 1 } })));
    return { globos, tubos, anclas, materiales: materialesDecoracion(globos, tubos), texto, avisos };
  }

  if (formato.tipo !== "redondo") throw new Error("Las letras de hilera o de cuartetos van con globos redondos.");
  if (o.tecnica === "hilera") {
    const d = infladoValido(formato, o.infladoCm);
    const filas = Math.max(1, Math.min(4, Math.round(o.grosorCm / (d * 0.9))));
    const ancho = d * (0.5 + (filas - 1) * 0.8);
    const texto = componerTexto(o.texto, { altoCm: o.altoCm, separacionCm: o.separacionCm ?? o.altoCm * 0.25, disposicion: o.disposicion, margenCm: ancho });
    const paso = d * 0.9;
    const centros: Vec3[] = [];
    texto.trazos.forEach((t) => {
      for (let f = 0; f < filas; f++) {
        const desplazo = (f - (filas - 1) / 2) * d * 0.8;
        const largo = largoPolilinea(t.puntos, t.cerrado);
        const n = t.cerrado ? Math.max(3, Math.floor(largo / paso)) : Math.max(1, Math.floor(largo / paso) + 1);
        for (const m of repartirEnPolilinea(t.puntos, t.cerrado, n)) {
          // Al tresbolillo: las hileras pares se corren medio paso a lo largo del trazo.
          const corre = f % 2 === 1 ? paso / 2 : 0;
          const c: Vec3 = { x: m.punto.x - m.tangente.y * desplazo + m.tangente.x * corre, y: m.punto.y + m.tangente.x * desplazo + m.tangente.y * corre, z: 0 };
          // En las uniones de dos trazos (y donde se cruzan) no se repite el globo.
          if (centros.some((x) => Math.hypot(x.x - c.x, x.y - c.y) < d * 0.86)) continue;
          centros.push(c);
          globos.push(globoEn(formato.id, d, colorLetra(o, t.caracter, globos.length), c));
        }
      }
    });
    if (texto.omitidos.length) avisos.push(`No sé escribir «${texto.omitidos.join("")}»: se dejó fuera.`);
    const anclas = globos.filter((_, i) => i % 4 === 0).map((g) => { const c = centroDe(g); return { posicion: { x: c.x, y: c.y, z: c.z + d / 2 }, normal: { x: 0, y: 0, z: 1 } }; });
    return { globos, tubos, anclas, materiales: materialesDecoracion(globos, tubos), texto, avisos };
  }

  // Cuartetos: una trenza por trazo. El grosor de la trenza es ~2,24 inflados (globos a 0,62 del eje).
  const d = infladoValido(formato, o.infladoCm);
  const texto = componerTexto(o.texto, { altoCm: o.altoCm, separacionCm: o.separacionCm ?? Math.max(o.altoCm * 0.25, d * 1.2), disposicion: o.disposicion, margenCm: d * 1.12 });
  // Donde dos trazos se juntan (o un trazo dobla en esquina) las trenzas se pisan: el globo que cae sobre otro ya
  // puesto (que no sea de su mismo cuarteto) no se pone.
  const centros: Array<Vec3 & { trazo: number; nivel: number }> = [];
  texto.trazos.forEach((t, k) => {
    const recorrido = t.cerrado ? [...t.puntos, t.puntos[0]!] : t.puntos;
    if (largoPolilinea(recorrido, false) < d * 0.5) return;
    const trenza = armarTrenza({ formato, infladoCm: d, patron: "un_color", colores: [o.colores[0]!], recorrido, reparto: "extremos" });
    const niveles = t.cerrado ? trenza.niveles - 1 : trenza.niveles;
    for (const g of trenza.globos) {
      if (g.nivel >= niveles) continue;
      const globo: GloboDecoracion = { formatoId: formato.id, infladoCm: d, codigo: "", nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm };
      const c = centroDe(globo);
      if (centros.some((x) => (x.trazo !== k || x.nivel !== g.nivel) && Math.hypot(x.x - c.x, x.y - c.y, x.z - c.z) < d * 0.84)) continue;
      centros.push({ ...c, trazo: k, nivel: g.nivel });
      globos.push({ ...globo, codigo: colorLetra(o, t.caracter, o.patron === "alternado" ? g.nivel : globos.length) });
    }
  });
  if (texto.omitidos.length) avisos.push(`No sé escribir «${texto.omitidos.join("")}»: se dejó fuera.`);
  const anclas = globos.filter((g, i) => i % 6 === 0 && g.direccion.z > 0.3).map((g) => { const c = centroDe(g); return { posicion: { x: c.x, y: c.y, z: c.z + d / 2 }, normal: { x: 0, y: 0, z: 1 } }; });
  return { globos, tubos, anclas, materiales: materialesDecoracion(globos, tubos), texto, avisos };
}
