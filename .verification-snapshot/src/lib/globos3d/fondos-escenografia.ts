import type { Punto2 } from "./trenza";
import { mesaConMantel, paredLentejuelas, tapete, type AcabadoEscenografia, type ElementoEscenografia } from "./escenografia";
import { CATALOGO_MOBILIARIO } from "./mobiliario-catalogo";
import type { FondoCatalogo, FondoFijo } from "./mobiliario-tipos";

export type { FondoCatalogo, FondoFijo, MuebleCatalogo } from "./mobiliario-tipos";

/**
 * **Fondos y muebles** de las fotos de Pinterest (2026-10-08): lo que va detrás y alrededor de los globos y no es globo.
 * Cada uno por parámetros (medidas, colores, acabado) para armar la escena de una foto o ponerlo a mano:
 * - panel redondo (con aro de otro color), media luna, arcos tipo chiara (2–3 arcos escalonados), pared de lentejuelas;
 * - pedestales (juego de cilindros de alturas distintas, mate, satinados o dorados), mesa con mantel, tapete;
 * - cortina de tela con luces y letrero (un tablero con texto).
 * Panel redondo, arcos chiara, pared de lentejuelas, letrero y marco con tela admiten un rótulo en cursiva (`rotulos.ts`): lo lleva su último elemento (en los arcos, el más grande).
 * `FONDOS_CATALOGO` (al final) junta estos fondos fijos con el mobiliario paramétrico de `mobiliario-catalogo.ts` (sillas, mesas,
 * sofás, aros metálicos…): un solo registro, con `clase: "fondo" | "mueble"`, para el panel «Añadir», la lectura de fotos y la IA.
 * Todo apoyado en el piso (y = 0) y de frente (+z), centrado en x = 0. No cotiza (escenografía).
 */

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Un contorno circular de `n` puntos. */
function circulo(cx: number, cy: number, radio: number, n = 48): Punto2[] {
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return { x: r1(cx + Math.cos(a) * radio), y: r1(cy + Math.sin(a) * radio) }; });
}

/** Rectángulo con la parte de arriba en medio punto (el arco chiara). */
function arcoChiara(cx: number, ancho: number, alto: number): Punto2[] {
  const r = ancho / 2, recto = Math.max(0, alto - r);
  const arriba = Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI; return { x: r1(cx + Math.cos(a) * r), y: r1(recto + Math.sin(a) * r) }; });
  return [{ x: r1(cx + r), y: 0 }, ...arriba, { x: r1(cx - r), y: 0 }];
}

export function panelRedondo(o: { diametroCm: number; alturaCentroCm?: number; hex: string; acabado?: AcabadoEscenografia; aro?: { hex: string; anchoCm: number } | null }): ElementoEscenografia[] {
  const r = o.diametroCm / 2, cy = o.alturaCentroCm ?? r;
  const salida: ElementoEscenografia[] = [];
  // Si va alto, sobre su soporte (un pie detrás, hasta el piso).
  const pie = cy - r - (o.aro?.anchoCm ?? 0);
  if (pie > 1) salida.push({ forma: "caja", centro: { x: 0, y: r1(pie / 2 + 10), z: -1.5 }, tamano: { x: 6, y: r1(pie + 20), z: 2 }, hex: "#cfc6b8", acabado: "metal" });
  if (o.aro) salida.push({ forma: "panel", contorno: circulo(0, cy, r + o.aro.anchoCm), zCm: 0, grosorCm: 2, hex: o.aro.hex, acabado: "brillante" });
  salida.push({ forma: "panel", contorno: circulo(0, cy, r), zCm: o.aro ? 2 : 0, grosorCm: 2, hex: o.hex, acabado: o.acabado ?? "mate" });
  return salida;
}

/**
 * Media luna: un círculo al que otro, corrido hacia un lado, se le come ese lado (la de la foto azul marino, detrás del
 * panel redondo). `lado` es hacia dónde queda la luna.
 */
export function mediaLuna(o: { diametroCm: number; hex: string; acabado?: AcabadoEscenografia; lado?: "izquierda" | "derecha" }): ElementoEscenografia[] {
  const r = o.diametroCm / 2, d = r * 0.45, ri = r * 0.85;
  // Luna a la derecha (se come el lado izquierdo); a la izquierda se refleja en x.
  const dentroDelOtro = (x: number, y: number) => Math.hypot(x + d, y - r) < ri;
  const fuera = Array.from({ length: 96 }, (_, i) => -Math.PI + (i / 96) * Math.PI * 2)
    .map((t) => ({ t, x: Math.cos(t) * r, y: r + Math.sin(t) * r })).filter((p) => !dentroDelOtro(p.x, p.y)).sort((a, b) => b.t - a.t);
  const borde = Array.from({ length: 96 }, (_, i) => -Math.PI + (i / 96) * Math.PI * 2)
    .map((t) => ({ t, x: -d + Math.cos(t) * ri, y: r + Math.sin(t) * ri })).filter((p) => Math.hypot(p.x, p.y - r) < r).sort((a, b) => a.t - b.t);
  const signo = o.lado === "izquierda" ? -1 : 1;
  const contorno = [...fuera, ...borde].map((p) => ({ x: r1(signo * p.x), y: r1(p.y) }));
  return [{ forma: "panel", contorno: signo > 0 ? contorno : contorno.reverse(), zCm: 0, grosorCm: 2, hex: o.hex, acabado: o.acabado ?? "mate" }];
}

/** Arcos chiara: 2 o 3 paneles de medio punto escalonados (el más alto detrás), cada uno de su color. */
export function arcosChiara(o: { arcos: ReadonlyArray<{ anchoCm: number; altoCm: number; hex: string; xCm?: number }>; acabado?: AcabadoEscenografia }): ElementoEscenografia[] {
  return o.arcos.map((a, i) => ({ forma: "panel" as const, contorno: arcoChiara(a.xCm ?? 0, a.anchoCm, a.altoCm), zCm: i * 2.2, grosorCm: 2, hex: a.hex, acabado: o.acabado ?? "mate" }));
}

/** Juego de pedestales (cilindros) de alturas y diámetros distintos, lado a lado, con su tapa. */
export function pedestales(o: { cilindros: ReadonlyArray<{ diametroCm: number; altoCm: number; hex: string; acabado?: AcabadoEscenografia }>; separacionCm?: number }): ElementoEscenografia[] {
  const sep = o.separacionCm ?? 4;
  const total = o.cilindros.reduce((s, c) => s + c.diametroCm, 0) + sep * (o.cilindros.length - 1);
  let x = -total / 2;
  const salida: ElementoEscenografia[] = [];
  for (const c of o.cilindros) {
    const r = c.diametroCm / 2;
    salida.push({ forma: "cilindro", base: { x: r1(x + r), y: 0, z: 0 }, radioCm: r, altoCm: c.altoCm, hex: c.hex, acabado: c.acabado ?? "satinado" });
    x += c.diametroCm + sep;
  }
  return salida;
}

/** Cortina de tela hasta el piso (con luces: el dibujo de puntitos claros). */
export function cortina(o: { anchoCm: number; altoCm: number; hex: string; luces?: boolean }): ElementoEscenografia[] {
  return [{ forma: "caja", centro: { x: 0, y: o.altoCm / 2, z: 1 }, tamano: { x: o.anchoCm, y: o.altoCm, z: 2 }, hex: o.hex, acabado: "tela", ...(o.luces ? { motivo: { dibujo: "lunares" as const, hex: "#fff6d8", escala: 0.4 } } : {}) }];
}

/** Letrero: un tablero con el texto impreso (de pie o colgado; su borde de abajo a `alturaCm`). */
export function letrero(o: { texto: string; anchoCm: number; altoCm: number; hex: string; tinta: string; alturaCm?: number; acabado?: AcabadoEscenografia }): ElementoEscenografia[] {
  const y0 = o.alturaCm ?? 0;
  return [{ forma: "caja", centro: { x: 0, y: y0 + o.altoCm / 2, z: 1 }, tamano: { x: o.anchoCm, y: o.altoCm, z: 2 }, hex: o.hex, acabado: o.acabado ?? "madera", motivo: { dibujo: "texto", texto: o.texto, hex: o.tinta } }];
}

/** Los de las fotos, listos para poner (y luego cambiar de color o medida). */
const FONDOS_BASE: readonly FondoFijo[] = [
  { clase: "fondo", id: "panel_redondo", rotulable: true, tinte: "#f3e7cf", nombre: "Panel redondo", descripcion: "Panel circular de 1,5 m con aro dorado (el fondo de «Happy Birthday»).", lugar: "piso", elementos: () => panelRedondo({ diametroCm: 150, alturaCentroCm: 110, hex: "#f3e7cf", aro: { hex: "#d8b25a", anchoCm: 4 } }) },
  { clase: "fondo", id: "media_luna", tinte: "#1c2f5e", nombre: "Media luna", descripcion: "Panel de media luna azul marino de 1,8 m, para poner detrás de un panel redondo.", lugar: "piso", elementos: () => mediaLuna({ diametroCm: 180, hex: "#1c2f5e" }) },
  { clase: "fondo", id: "arcos_chiara", rotulable: "mayor", nombre: "Arcos chiara", descripcion: "Tres arcos de medio punto escalonados (azul, crema y rosa).", lugar: "piso", elementos: () => arcosChiara({ arcos: [{ anchoCm: 120, altoCm: 210, hex: "#3d8fd6", xCm: -15 }, { anchoCm: 105, altoCm: 190, hex: "#f2dcc4", xCm: 5 }, { anchoCm: 80, altoCm: 165, hex: "#d6336c", xCm: 15 }] }) },
  { clase: "fondo", id: "lentejuelas", rotulable: true, tinte: "#d4af5a", nombre: "Pared de lentejuelas", descripcion: "Panel de shimmer dorado de 2,4 × 2,4 m.", lugar: "piso", elementos: () => [paredLentejuelas({ anchoCm: 240, altoCm: 240, hex: "#d4af5a" })] },
  { clase: "fondo", id: "pedestales", nombre: "Pedestales", grupo: "decorado", descripcion: "Tres cilindros de alturas distintas (azul, blanco y dorado), para la torta y los dulces.", lugar: "piso", retiroCm: 120, elementos: () => pedestales({ cilindros: [{ diametroCm: 55, altoCm: 70, hex: "#1f3366" }, { diametroCm: 50, altoCm: 85, hex: "#f4f1ea" }, { diametroCm: 45, altoCm: 100, hex: "#c9a14a", acabado: "metal" }] }) },
  { clase: "fondo", id: "mesa_mantel", nombre: "Mesa con mantel", grupo: "mesa", descripcion: "Mesa de 1,8 m con mantel blanco hasta el piso.", lugar: "piso", retiroCm: 120, elementos: () => mesaConMantel({ anchoCm: 180, fondoCm: 75, altoCm: 75, mantel: "#f7f6f2" }) },
  { clase: "fondo", id: "tapete_redondo", tinte: "#e9e2d6", nombre: "Tapete", descripcion: "Tapete claro de 2 × 1,6 m frente al montaje.", lugar: "piso", retiroCm: 120, elementos: () => tapete({ anchoCm: 200, fondoCm: 160, hex: "#e9e2d6" }) },
  { clase: "fondo", id: "cortina_luces", tinte: "#f6f4ef", nombre: "Cortina con luces", descripcion: "Cortina blanca de 2,5 × 2,4 m con luces de hada.", lugar: "pared", elementos: () => cortina({ anchoCm: 250, altoCm: 240, hex: "#f6f4ef", luces: true }) },
  { clase: "fondo", id: "letrero", rotulable: true, tinte: "#e9dcc3", nombre: "Letrero", descripcion: "Tablero de madera con un nombre (cámbiale el texto).", lugar: "pared", alturaParedCm: 150, elementos: () => letrero({ texto: "Asher", anchoCm: 90, altoCm: 40, hex: "#e9dcc3", tinta: "#2f4a35" }) },
];

/** Fondos de las fotos y mobiliario de eventos (`mobiliario-catalogo.ts`): todo lo que no es globo y se pone en la escena. */
export const FONDOS_CATALOGO: readonly FondoCatalogo[] = [...FONDOS_BASE, ...CATALOGO_MOBILIARIO];

const POR_ID: ReadonlyMap<string, FondoCatalogo> = new Map(FONDOS_CATALOGO.map((f) => [f.id, f]));
/** La entrada del catálogo de fondos y mobiliario con ese id, si la hay. */
export const entradaDeCatalogo = (id: string): FondoCatalogo | undefined => POR_ID.get(id);

/**
 * ¿Es un telón, lo que se para contra la pared del fondo y los globos suelen tapar (panel redondo, lentejuelas, arcos,
 * cortina, letrero; aros, arco, marco con tela, biombo)? Los fondos fijos sin retiro van contra la pared; los muebles lo
 * dicen con `telon`.
 */
export function esTelon(id: string): boolean {
  const e = entradaDeCatalogo(id);
  if (!e) return false;
  return e.clase === "fondo" ? e.retiroCm === undefined : Boolean(e.telon);
}

/** Los telones de piso cuyo `alto` es un diámetro (panel redondo, media luna): su ancho es todo lo que se ve de ellos y su pie no se prolonga hasta el piso. Los aros llevan pie y mástil: son telones de alto propio. */
export const TELONES_DE_DIAMETRO: ReadonlySet<string> = new Set(["panel_redondo", "media_luna"]);
