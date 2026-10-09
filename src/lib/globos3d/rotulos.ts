import { z } from "zod";
import type { AcabadoRotulo, ElementoEscenografia, RotuloEscenografia, SolidoEscenografia } from "./escenografia";
import type { Punto2 } from "./trenza";

/**
 * **Rótulos** (2026-10-09): un nombre o frase en letra cursiva —con las letras unidas— sobre la cara de delante de un panel o
 * de un marco de tela (vinilo pegado) o suelto, en letras de acrílico recortadas (espejo o mate) delante de un aro. Aquí está lo
 * que no depende del navegador: el esquema, los textos de cada acabado, la cara que lleva el rótulo, dónde y de qué tamaño
 * queda y cómo se pone en una lista de elementos. El visor lo dibuja con `rotulo-visor.ts` (el contorno de las letras sale de
 * `rotulo-contornos.ts`).
 *
 * Un fondo o mueble que admite rótulo (`rotulable` en el catálogo) lo lleva en `mueble.rotulo` de su pieza, y lo lleva SU ÚLTIMO
 * ELEMENTO (el panel de delante, la tela del marco): `conRotulo` lo pone al armar. El nombre de acrílico suelto (`rotulo_acrilico`)
 * lo arma él mismo con su texto, color y material.
 */

export const MAX_TEXTO_ROTULO = 24;
export const MAX_LINEAS_ROTULO = 3;
/** Grosor de las letras de acrílico y de la calcomanía de vinilo (cm). */
export const GROSOR_ACRILICO_CM = 0.6;
/** Lo más alto que puede ser el texto de un rótulo y a qué altura puede estar su centro (cm): los topes del esquema. */
export const MAX_ALTO_ROTULO_CM = 600;
export const MAX_ALTURA_ROTULO_CM = 1500;
export const GROSOR_VINILO_CM = 0.08;
/** Lo que sobresalen las lentejuelas del tablero (cm): el rótulo se apoya encima de ellas. */
export const SOBRESALE_LENTEJUELAS_CM = 1;
/** Qué fracción de lo ancho que queda libre puede ocupar el texto. */
const LLENADO_ANCHO = 0.92;

export const ACABADOS_ROTULO = ["vinilo", "acrilico_espejo", "acrilico_mate"] as const satisfies readonly AcabadoRotulo[];
export const esAcabadoRotulo = (t: unknown): t is AcabadoRotulo => typeof t === "string" && (ACABADOS_ROTULO as readonly string[]).includes(t);
export const NOMBRE_ACABADO_ROTULO: Readonly<Record<AcabadoRotulo, string>> = { vinilo: "Vinilo", acrilico_espejo: "Acrílico espejo", acrilico_mate: "Acrílico mate" };
/** Cómo se dice cada acabado en inglés (el inventario que se le manda a FLUX). */
export const ACABADO_ROTULO_EN: Readonly<Record<AcabadoRotulo, string>> = { vinilo: "vinyl", acrilico_espejo: "mirror acrylic cut-out", acrilico_mate: "matte acrylic cut-out" };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** El esquema de un rótulo guardado en una pieza (lo usa la API de la IA de escena). */
export const RotuloSchema = z.object({
  texto: z.string().min(1).max(MAX_TEXTO_ROTULO),
  color: z.string().regex(HEX),
  acabado: z.enum(ACABADOS_ROTULO),
  altoCm: z.number().finite().min(1).max(MAX_ALTO_ROTULO_CM),
  yCm: z.number().finite().min(0).max(MAX_ALTURA_ROTULO_CM),
});

/** El texto como se dibuja: líneas sin espacios de sobra (máximo `maxLineas`, 3 por defecto) y 24 caracteres en total; vacío si no queda nada. */
export function limpiarTexto(texto: string, maxLineas = MAX_LINEAS_ROTULO): string {
  if (maxLineas <= 1) return texto.replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO_ROTULO).trim();
  const lineas = texto.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, maxLineas);
  return lineas.join("\n").slice(0, MAX_TEXTO_ROTULO).trim();
}
export const lineasDeRotulo = (texto: string): string[] => texto.split("\n").filter(Boolean);

/** El texto en una sola línea (para decirlo: la lista de compra, la IA, el inventario en inglés). */
export const textoEnUnaLinea = (texto: string): string => texto.replace(/\s*\n\s*/g, " ");

// ----------------------------------------------------------------------------------------------------------
// La cara que lleva el rótulo
// ----------------------------------------------------------------------------------------------------------

/** La cara de delante de un elemento (en su marco, cm): lo que mide, dónde está su centro y su borde de abajo, y a qué profundidad. */
export type CaraRotulo = { anchoCm: number; altoCm: number; centroXCm: number; baseYCm: number; zCm: number; contorno?: readonly Punto2[] };

type Portador = ElementoEscenografia | SolidoEscenografia;

/** La cara de delante de una caja o de un panel (null si es otra forma). Si el cuerpo no se dibuja (`oculto`), el rótulo parte del plano de su centro. */
export function caraDe(e: Portador): CaraRotulo | null {
  if (e.forma === "caja") {
    const z = e.oculto ? -e.tamano.z / 2 : e.tamano.z / 2 + (e.acabado === "lentejuelas" ? SOBRESALE_LENTEJUELAS_CM : 0);
    return { anchoCm: e.tamano.x, altoCm: e.tamano.y, centroXCm: 0, baseYCm: -e.tamano.y / 2, zCm: z };
  }
  if (e.forma === "panel") {
    const xs = e.contorno.map((p) => p.x), ys = e.contorno.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { anchoCm: x1 - x0, altoCm: y1 - y0, centroXCm: (x0 + x1) / 2, baseYCm: y0, zCm: e.grosorCm, contorno: e.contorno };
  }
  return null;
}

/** Lo ancho de la cara a la altura `y` (cm sobre su borde de abajo): el de una caja es todo; en un panel, el tramo del contorno que cruza esa línea. */
function anchoEn(cara: CaraRotulo, y: number): number {
  if (!cara.contorno) return cara.anchoCm;
  const yAbs = cara.baseYCm + Math.min(cara.altoCm - 0.01, Math.max(0.01, y));
  let min = Infinity, max = -Infinity;
  const c = cara.contorno;
  for (let i = 0; i < c.length; i++) {
    const a = c[i]!, b = c[(i + 1) % c.length]!;
    if (a.y > yAbs === b.y > yAbs) continue;
    const x = a.x + ((yAbs - a.y) * (b.x - a.x)) / (b.y - a.y);
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return max > min ? max - min : 0;
}

/** Lo ancho que puede tener un texto que ocupa de `y0` a `y1` (cm sobre el borde de abajo): lo más angosto de la cara en esas dos alturas y al medio. */
const anchoLibre = (cara: CaraRotulo, y0: number, y1: number): number => Math.min(anchoEn(cara, y0), anchoEn(cara, (y0 + y1) / 2), anchoEn(cara, y1));

export type RotuloColocado = { anchoCm: number; altoCm: number; xCm: number; yCm: number; zCm: number };

/**
 * Dónde queda un rótulo de proporción `aspecto` (ancho/alto de las letras) en una cara, en el marco del elemento: centrado a
 * lo ancho, a la altura pedida (sin salirse de la cara) y del alto pedido, que se achica si el texto no cabe a lo ancho —en un
 * arco o un círculo, a lo ancho que tiene el contorno en esas alturas—.
 */
export function colocarRotulo(cara: CaraRotulo, r: Pick<RotuloEscenografia, "altoCm" | "yCm">, aspecto: number): RotuloColocado {
  const asp = Math.max(0.05, aspecto);
  let alto = Math.max(0.5, Math.min(r.altoCm, cara.altoCm));
  const centro = (a: number) => Math.min(cara.altoCm - a / 2, Math.max(a / 2, r.yCm));
  // Achicar hasta que quepa: al bajar el alto, el contorno se ensancha, así que se repite un par de veces.
  for (let i = 0; i < 4; i++) {
    const c = centro(alto);
    const cabe = anchoLibre(cara, c - alto / 2, c + alto / 2) * LLENADO_ANCHO;
    if (alto * asp <= cabe + 1e-6) break;
    alto = Math.max(0.5, cabe / asp);
  }
  return { anchoCm: alto * asp, altoCm: alto, xCm: cara.centroXCm, yCm: cara.baseYCm + centro(alto), zCm: cara.zCm };
}

// ----------------------------------------------------------------------------------------------------------
// Valores de partida y cambios
// ----------------------------------------------------------------------------------------------------------

/** La tinta que se lee sobre un fondo: oscura sobre claro y clara sobre oscuro. */
export function tintaSobre(hex: string): string {
  if (!HEX.test(hex)) return "#1c1c1c";
  const n = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return 0.299 * n(0) + 0.587 * n(1) + 0.114 * n(2) > 0.55 ? "#1c1c1c" : "#f7f6f2";
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** El rótulo de partida de un texto sobre un elemento: vinilo de la tinta que se lee, un 22 % del alto de la cara, a media altura. */
export function rotuloInicial(portador: Portador, texto: string): RotuloEscenografia | null {
  const cara = caraDe(portador);
  const limpio = limpiarTexto(texto);
  if (!cara || !limpio) return null;
  return { texto: limpio, color: tintaSobre(portador.hex), acabado: "vinilo", altoCm: r1(Math.max(4, cara.altoCm * 0.22)), yCm: r1(cara.altoCm / 2) };
}

export type PedidoRotulo = { texto?: string; color?: string; acabado?: AcabadoRotulo; altoCm?: number; yCm?: number };

const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Un rótulo siempre armable: texto limpio, color `#rrggbb`, acabado válido, alto y altura dentro de lo que admite el esquema (1–600 cm
 * y 0–1500 cm) y, con `acotarACara` (al armar), dentro de la cara que lo lleva. Lo que se guarda no se acota a la cara: si el marco
 * se achica y se vuelve a agrandar, el texto recupera el tamaño que tenía. null si no hay texto o el elemento no admite rótulo.
 */
export function normalizarRotulo(r: Partial<RotuloEscenografia> | undefined, portador: Portador | undefined, acotarACara = false): RotuloEscenografia | null {
  const cara = portador ? caraDe(portador) : null;
  const texto = limpiarTexto(r?.texto ?? "");
  if (!portador || !cara || !texto) return null;
  const inicial = rotuloInicial(portador, texto)!;
  return {
    texto,
    color: typeof r?.color === "string" && HEX.test(r.color) ? r.color.toLowerCase() : inicial.color,
    acabado: esAcabadoRotulo(r?.acabado) ? r.acabado : inicial.acabado,
    altoCm: r1(typeof r?.altoCm === "number" && Number.isFinite(r.altoCm) && r.altoCm > 0 ? entre(r.altoCm, 1, acotarACara ? cara.altoCm : MAX_ALTO_ROTULO_CM) : inicial.altoCm),
    yCm: r1(typeof r?.yCm === "number" && Number.isFinite(r.yCm) ? entre(r.yCm, 0, acotarACara ? cara.altoCm : MAX_ALTURA_ROTULO_CM) : inicial.yCm),
  };
}

/** El rótulo que resulta de cambiarle `pedido` al que había (o de ponerlo por primera vez con el texto pedido); null si el texto queda vacío. */
export function cambiarRotulo(previo: RotuloEscenografia | undefined, pedido: PedidoRotulo, portador: Portador | undefined): RotuloEscenografia | null {
  const texto = pedido.texto ?? previo?.texto;
  if (!texto || !limpiarTexto(texto)) return null;
  return normalizarRotulo({ ...previo, ...Object.fromEntries(Object.entries(pedido).filter(([, v]) => v !== undefined)), texto }, portador);
}

/**
 * Los elementos con el rótulo en el último (el panel de delante, la tela del marco). Si el último lleva un texto impreso (el
 * tablero de un letrero), el rótulo lo reemplaza. Si el último no admite rótulo, o el rótulo no es válido, queda igual.
 */
export function conRotulo(elementos: readonly ElementoEscenografia[], rotulo: Partial<RotuloEscenografia> | null | undefined): ElementoEscenografia[] {
  const ultimo = elementos[elementos.length - 1];
  if (!ultimo || !rotulo) return [...elementos];
  const r = normalizarRotulo(rotulo, ultimo, true);
  if (!r || (ultimo.forma !== "caja" && ultimo.forma !== "panel")) return [...elementos];
  // El texto impreso de un tablero (el letrero) se cambia por el rótulo; otro dibujo (lunares, rayas) se queda.
  const impreso = ultimo.motivo?.dibujo === "texto";
  return [...elementos.slice(0, -1), { ...ultimo, ...(impreso ? { motivo: undefined } : {}), rotulo: r } as ElementoEscenografia];
}
