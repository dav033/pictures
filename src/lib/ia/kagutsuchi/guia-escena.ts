import type { ReferenceBlueprintV2, ReferenceBBox } from "@/lib/ia/referencia/reference-blueprint";
import type { AnclajeGuiaEscena, PiezaGuiaEscena, RellenoGuiaEscena, TrazoGuiaEscena } from "@/lib/plan/guia-escena";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { labDeRgb } from "@/lib/rag/catalog/similitud-color";
import { FONDO_GUIA, PISO_GUIA } from "./guia-estructura";

/**
 * La guía de escena (`GUIA_ESCENA_V1`): UNA imagen plana con todas las piezas de globos del plan aprobado,
 * cada una dibujada globo a globo por su motor (o por su dibujo esquemático) y colocada donde la foto de
 * referencia tiene la suya. Es lo único que FLUX ve de la foto: la foto nunca sale hacia el proveedor.
 *
 * - Los discos llegan de Python en metros (`plan-guia-escena.v1`); aquí no se coloca ni se cuenta ningún globo:
 *   solo se encaja cada pieza, con su proporción, en su caja.
 * - La caja es la `reference_bbox` del elemento de la foto que la pieza materializa
 *   (`estructuras[].referencia_element_id`). Una pieza repetida toma las cajas de los elementos de la foto de su
 *   mismo grupo, de izquierda a derecha; lo que falte sale de `cajasDeEstructuras`, la geometría del plan.
 * - Cómo se sostiene cada pieza lo dice la ubicación del plan (`apoyoDe`: piso, techo o pared), salvo que Python
 *   publique su `anclaje`, que manda. Una pieza `flotante` (un bouquet de helio) tiene su caja en la foto con la
 *   pesa en el piso: se encaja contando su `elevacion_m` y sus globos quedan esa altura por encima del fondo de la
 *   caja, a la escala de la pieza y siempre dentro de ella; nunca pegados a la franja de piso.
 * - Fondo liso y una franja de piso, círculos planos con su color exacto: sin degradados, sin sombras, sin texto,
 *   sin persona ni marcas de altura. Un modelo de imagen copia lo que ve.
 * - Cada disco lleva un borde fino de su propio tono, más oscuro (`bordeDeDisco`), y el fondo baja de
 *   `FONDO_GUIA` hacia un gris medio neutro cuando hay discos claros (`fondoDeEscena`): sin las dos cosas, un globo
 *   blanco, crema, transparente o pastel desaparecía contra el fondo y entre sus vecinos. El relleno nunca cambia:
 *   un blanco sigue siendo `#ffffff`.
 *
 * Puro y determinista: el mismo plan, la misma foto y el mismo tamaño dan el mismo SVG. Rasterizar es de
 * `rasterizar-guia.ts`, en el servidor.
 */

type EstructuraPlan = PlanResuelto["plan"]["estructuras"][number];
type ElementoFoto = ReferenceBlueprintV2["elements"][number];

/**
 * Cómo se apoya la pieza dentro de su caja: abajo en el piso, arriba en el techo, centrada en la pared, o
 * flotando sobre su pesa (`flotante`, solo cuando Python lo publica en `anclaje`).
 */
export type ApoyoGuia = AnclajeGuiaEscena;

export type InstanciaGuia = {
  estructura_id: string;
  /** 1..repeticiones. */
  instancia: number;
  /** Caja normalizada (0..1) en el encuadre de la imagen. */
  caja: ReferenceBBox;
  /** De dónde salió la caja: la foto de referencia o la geometría del plan. */
  fuente: "foto" | "plan";
  /** La copia derecha de una pieza repetida se dibuja en espejo, como se monta un par. */
  espejo: boolean;
  apoyo: ApoyoGuia;
};

const UBICACIONES_TECHO: ReadonlySet<string> = new Set(["techo", "techo_multipunto"]);

function apoyoDe(estructura: EstructuraPlan): ApoyoGuia {
  const oficial = "estructura_oficial" in estructura ? estructura.estructura_oficial : undefined;
  if (UBICACIONES_TECHO.has(estructura.ubicacion) || oficial === "techo_globos") return "techo";
  if (estructura.tipo === "guirnalda") return "pared";
  return "piso";
}

function centroX(caja: ReferenceBBox): number {
  return caja.x + caja.width / 2;
}

function referenciaDe(estructura: EstructuraPlan): string | undefined {
  return "referencia_element_id" in estructura ? estructura.referencia_element_id : undefined;
}

/**
 * Las cajas de la foto para una pieza de `n` instancias: la del elemento que materializa y, si se repite, las de
 * los demás elementos de la foto que son la misma pieza. Primero los que comparten `repetition_group` con él; si
 * no hay bastantes, los elementos de globos del mismo `structure_type` que ninguna otra estructura del plan ya
 * reclama (dos columnas a los lados de una mesa llegan como dos elementos con su propio grupo). Los más cercanos
 * en horizontal primero, y al final de izquierda a derecha.
 */
function cajasDeLaFoto(elemento: ElementoFoto, n: number, elementos: readonly ElementoFoto[], reclamados: ReadonlySet<string>): ReferenceBBox[] {
  if (n <= 1) return [elemento.reference_bbox];
  const grupo = elemento.visual_semantics?.repetition_group;
  const tipo = elemento.visual_semantics?.structure_type;
  const otros = elementos.filter((item) => item.element_id !== elemento.element_id);
  const delGrupo = grupo ? otros.filter((item) => item.visual_semantics?.repetition_group === grupo) : [];
  const delTipo = tipo
    ? otros.filter((item) => item.category === "balloon_structure" && item.visual_semantics?.structure_type === tipo && !reclamados.has(item.element_id) && !delGrupo.includes(item))
    : [];
  const cerca = (item: ElementoFoto) => Math.abs(centroX(item.reference_bbox) - centroX(elemento.reference_bbox));
  const candidatos = [...delGrupo.sort((a, b) => cerca(a) - cerca(b) || a.element_id.localeCompare(b.element_id)), ...delTipo.sort((a, b) => cerca(a) - cerca(b) || a.element_id.localeCompare(b.element_id))];
  return [elemento, ...candidatos.slice(0, n - 1)]
    .map((item) => item.reference_bbox)
    .sort((a, b) => centroX(a) - centroX(b) || a.y - b.y);
}

/** Cada instancia de cada pieza del plan con su caja en el encuadre. */
export function instanciasDeEscena(estructuras: readonly EstructuraPlan[], foto: ReferenceBlueprintV2 | undefined): InstanciaGuia[] {
  const elementos = foto?.elements ?? [];
  const porId = new Map(elementos.map((elemento) => [elemento.element_id, elemento] as const));
  const reclamados = new Set(estructuras.map(referenciaDe).filter((id): id is string => Boolean(id)));
  const delPlan = cajasDeEstructuras([...estructuras]);
  const instancias: InstanciaGuia[] = [];
  for (const estructura of estructuras) {
    const n = Math.max(1, estructura.repeticiones);
    const referencia = referenciaDe(estructura);
    const elemento = referencia ? porId.get(referencia) : undefined;
    const deLaFoto = elemento ? cajasDeLaFoto(elemento, n, elementos, reclamados) : [];
    for (let indice = 0; indice < n; indice += 1) {
      const clave = n > 1 ? `${estructura.estructura_id}#${indice + 1}` : estructura.estructura_id;
      const caja = deLaFoto[indice] ?? delPlan[clave]?.bbox ?? delPlan[estructura.estructura_id]?.bbox;
      if (!caja) continue;
      instancias.push({
        estructura_id: estructura.estructura_id,
        instancia: indice + 1,
        caja,
        fuente: indice < deLaFoto.length ? "foto" : "plan",
        espejo: n > 1 && centroX(caja) > 0.5,
        apoyo: apoyoDe(estructura),
      });
    }
  }
  return instancias;
}

const HEX = /^#[0-9a-f]{6}$/;

// --- Color: fondo por escena y borde de cada disco ---------------------------------------------------------------

/**
 * Los fondos posibles de una escena: de `FONDO_GUIA` (L* ≈ 96) hacia abajo en escalones de 2 hasta un gris medio
 * (L* 70), todos con el mismo leve tinte de `FONDO_GUIA` (neutros: FLUX no tiene que leerlos como color de pared).
 * No baja más: un fondo oscuro se leería como un salón de noche.
 */
const L_FONDO_MINIMO = 70;
const PASO_L_FONDO = 2;
/** Cuánto más oscuro (ΔL*) que su relleno es el borde de cada disco; en los casi negros, cuánto más claro. */
export const DELTA_L_BORDE = 22;
/** Contraste WCAG mínimo entre cualquier borde y el fondo o el piso de su escena (el test exige ≥ 1,5). */
export const CONTRASTE_BORDE_MINIMO = 1.6;
/** Grosor del borde a 1024 px de ancho; escala con el ancho y nunca pasa del 30 % del radio. */
const GROSOR_BORDE_1024 = 2;

type Rgb = readonly [number, number, number];

function rgbDeHex(hex: string): Rgb {
  const entero = Number.parseInt(hex.slice(1), 16);
  return [(entero >> 16) & 255, (entero >> 8) & 255, entero & 255];
}

function hexDeRgb(rgb: Rgb): string {
  return `#${rgb.map((canal) => canal.toString(16).padStart(2, "0")).join("")}`;
}

function lineal(canal: number): number {
  const valor = canal / 255;
  return valor > 0.04045 ? ((valor + 0.055) / 1.055) ** 2.4 : valor / 12.92;
}

/** Luminancia relativa WCAG de un hex. */
export function luminanciaRelativa(hex: string): number {
  const [r, g, b] = rgbDeHex(hex).map(lineal) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos hex (1..21). */
export function contrasteWcag(a: string, b: string): number {
  const [claro, oscuro] = [luminanciaRelativa(a), luminanciaRelativa(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** L* de CIELAB de un hex (la conversión del catálogo, `labDeRgb`). */
export function lDeHex(hex: string): number {
  return labDeRgb(...rgbDeHex(hex))[0];
}

/** CIELAB (D65) a sRGB de 8 bits, o `undefined` si cae fuera de la gama. Inversa de `labDeRgb`. */
function rgbDeLab(l: number, a: number, b: number): Rgb | undefined {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inversa = (t: number): number => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inversa(fx) * 0.95047;
  const y = inversa(fy);
  const z = inversa(fz) * 1.08883;
  const lineales = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const canales = lineales.map((valor) => (valor <= 0.0031308 ? 12.92 * valor : 1.055 * valor ** (1 / 2.4) - 0.055));
  if (canales.some((valor) => valor < -0.002 || valor > 1.002)) return undefined;
  const [r, g, bl] = canales.map((valor) => Math.round(Math.min(1, Math.max(0, valor)) * 255)) as [number, number, number];
  return [r, g, bl];
}

/** El color en L* dada, con el mismo tono (a*, b* a escala) y la mayor croma que quepa en sRGB. */
function conLuminosidad(hex: string, l: number): string {
  const [, a, b] = labDeRgb(...rgbDeHex(hex));
  for (let paso = 0; paso <= 40; paso += 1) {
    const escala = 1 - paso / 40;
    const rgb = rgbDeLab(l, a * escala, b * escala);
    if (rgb) return hexDeRgb(rgb);
  }
  return hexDeRgb(rgbDeLab(l, 0, 0)!);
}

/**
 * La luminancia relativa más alta que puede tener un borde para que contraste al menos `CONTRASTE_BORDE_MINIMO`
 * con el fondo y con el piso de su escena (el más oscuro de los dos manda).
 */
function luminanciaMaximaBorde(fondoHex: string, pisoHex: string): number {
  const base = Math.min(luminanciaRelativa(fondoHex), luminanciaRelativa(pisoHex));
  return (base + 0.05) / CONTRASTE_BORDE_MINIMO - 0.05;
}

/** L* de una luminancia relativa (la Y de CIELAB). */
function lDeLuminancia(y: number): number {
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/**
 * El borde de un disco: su mismo tono, `DELTA_L_BORDE` más oscuro y nunca más claro de lo que el fondo de la
 * escena admite (así un blanco lleva un borde gris que se lee contra el fondo). Un disco casi negro, que no tiene
 * hacia dónde oscurecer, lleva el borde más claro: separa dos negros vecinos y sigue lejos del fondo.
 */
export function bordeDeDisco(hex: string, fondo: { fondo: string; piso: string }): string {
  const l = lDeHex(hex);
  const techo = lDeLuminancia(luminanciaMaximaBorde(fondo.fondo, fondo.piso)) - 0.5;
  const objetivo = l - DELTA_L_BORDE >= 6 ? Math.min(l - DELTA_L_BORDE, techo) : Math.min(l + DELTA_L_BORDE, techo);
  return conLuminosidad(hex, objetivo);
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = labDeRgb(...rgbDeHex(a));
  const [l2, a2, b2] = labDeRgb(...rgbDeHex(b));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Los fondos candidatos, del más claro (`FONDO_GUIA`/`PISO_GUIA` tal cual) al gris medio. */
function fondosCandidatos(): Array<{ fondo: string; piso: string }> {
  const lFondo = lDeHex(FONDO_GUIA);
  const caidaPiso = lFondo - lDeHex(PISO_GUIA);
  const candidatos = [{ fondo: FONDO_GUIA, piso: PISO_GUIA }];
  for (let l = Math.floor(lFondo / PASO_L_FONDO) * PASO_L_FONDO; l >= L_FONDO_MINIMO; l -= PASO_L_FONDO) {
    if (lFondo - l < PASO_L_FONDO / 2) continue;
    candidatos.push({ fondo: conLuminosidad(FONDO_GUIA, l), piso: conLuminosidad(FONDO_GUIA, l - caidaPiso) });
  }
  return candidatos;
}

const FONDOS_CANDIDATOS = fondosCandidatos();

/**
 * El fondo y el piso de la escena: de los fondos candidatos, el que más separa (ΔE CIE76) al color de disco que
 * peor se separa de él. Sin blancos ni casi blancos gana `FONDO_GUIA` de siempre; con blancos y platas el fondo
 * baja hasta quedar entre los dos. A igualdad, el más claro. Determinista: solo depende de los colores presentes.
 */
export function fondoDeEscena(hexes: Iterable<string>): { fondo: string; piso: string } {
  const colores = [...new Set(hexes)];
  let mejor = FONDOS_CANDIDATOS[0]!;
  let separacion = -1;
  for (const candidato of FONDOS_CANDIDATOS) {
    const peor = Math.min(...colores.map((hex) => deltaE(hex, candidato.fondo)));
    if (peor > separacion + 1e-9) {
      mejor = candidato;
      separacion = peor;
    }
  }
  return mejor;
}

function redondear(valor: number): number {
  if (!Number.isFinite(valor)) throw new Error("GUIA_ESCENA_INVALIDA: la composición dio un valor no finito.");
  return Math.round(valor * 100) / 100;
}

function fondo(caja: ReferenceBBox): number {
  return caja.y + caja.height;
}

/**
 * La línea del piso, en fracción del alto: donde se apoya la pieza de piso más lejana (la base más alta en la
 * imagen). Una pieza flotante cuenta: su caja baja hasta la pesa, que está en el piso. Sin piezas de piso, la del
 * encuadre por defecto de la guía de estructura (88 %).
 */
export function lineaDePiso(instancias: readonly InstanciaGuia[]): number {
  const bases = instancias.filter((instancia) => instancia.apoyo === "piso" || instancia.apoyo === "flotante").map((instancia) => fondo(instancia.caja));
  if (!bases.length) return 0.88;
  return Math.min(0.97, Math.max(0.5, Math.min(...bases)));
}

/**
 * La escala (píxeles por metro) y la base (la `y` en píxeles del borde inferior de la pieza) de una pieza en su
 * caja. Conserva la proporción y nunca se sale de la caja.
 *
 * - `piso`: abajo; `techo`: arriba; `pared`: centrada en vertical.
 * - `flotante`: la caja va del piso (la pesa) a lo más alto de los globos, así que la altura que se encaja es la
 *   de la pieza más su `elevacion_m`; los globos quedan `elevacion_m · escala` por encima del fondo de la caja.
 */
export function encaje(pieza: Pick<PiezaGuiaEscena, "ancho_m" | "alto_m" | "elevacion_m">, apoyo: ApoyoGuia, caja: { x: number; y: number; ancho: number; alto: number }): { escala: number; base: number } {
  const elevacion = apoyo === "flotante" ? Math.max(0, pieza.elevacion_m ?? 0) : 0;
  const escala = Math.min(caja.ancho / pieza.ancho_m, caja.alto / (pieza.alto_m + elevacion));
  const altoPieza = pieza.alto_m * escala;
  const fondoCaja = caja.y + caja.alto;
  if (apoyo === "techo") return { escala, base: caja.y + altoPieza };
  if (apoyo === "pared") return { escala, base: caja.y + (caja.alto + altoPieza) / 2 };
  if (apoyo === "flotante") return { escala, base: Math.max(caja.y + altoPieza, fondoCaja - elevacion * escala) };
  return { escala, base: fondoCaja };
}

// --- Lo que se ve sin ser globo: trazos y rellenos de la pieza --------------------------------------------------

type DiscoPx = { tipo: "disco"; x: number; y: number; r: number; hex: string };
type TrazoPx =
  | { tipo: "linea"; x1: number; y1: number; x2: number; y2: number; grosor: number; hex: string }
  | { tipo: "arco"; cx: number; cy: number; r: number; desde: number; hasta: number; grosor: number; hex: string };
type RellenoPx =
  | { tipo: "elipse"; cx: number; cy: number; rx: number; ry: number; hex: string }
  | { tipo: "poligono"; puntos: Array<readonly [number, number]>; hex: string };
type PintablePx = DiscoPx | TrazoPx | RellenoPx;

/** Un trazo más fino que esto no se ve a 1024 px; escala con el ancho como el borde de los discos. */
const GROSOR_TRAZO_MINIMO_1024 = 1.5;

function conHex(hex: string): string {
  if (!HEX.test(hex)) throw new Error(`GUIA_ESCENA_INVALIDA: color ${hex} fuera de formato.`);
  return hex;
}

/** Un punto del marco local de la pieza (metros, `y` arriba) en píxeles de la guía, con su espejo. */
type Transformacion = { x: (xM: number) => number; y: (yM: number) => number; escala: number; espejo: boolean };

function trazoEnPx(trazo: TrazoGuiaEscena, t: Transformacion, grosorMinimo: number): TrazoPx {
  const grosor = Math.max(grosorMinimo, trazo.grosor_m * t.escala);
  if (trazo.forma === "linea") {
    return { tipo: "linea", x1: t.x(trazo.x1_m), y1: t.y(trazo.y1_m), x2: t.x(trazo.x2_m), y2: t.y(trazo.y2_m), grosor, hex: conHex(trazo.hex) };
  }
  // En espejo, un ángulo `a` pasa a `180 - a` y el recorrido se invierte para seguir siendo antihorario.
  const desde = t.espejo ? 180 - trazo.hasta_grados : trazo.desde_grados;
  const hasta = t.espejo ? 180 - trazo.desde_grados : trazo.hasta_grados;
  return { tipo: "arco", cx: t.x(trazo.cx_m), cy: t.y(trazo.cy_m), r: trazo.r_m * t.escala, desde, hasta, grosor, hex: conHex(trazo.hex) };
}

function rellenoEnPx(relleno: RellenoGuiaEscena, t: Transformacion): RellenoPx {
  if (relleno.forma === "elipse") {
    return { tipo: "elipse", cx: t.x(relleno.cx_m), cy: t.y(relleno.cy_m), rx: relleno.rx_m * t.escala, ry: relleno.ry_m * t.escala, hex: conHex(relleno.hex) };
  }
  return { tipo: "poligono", puntos: relleno.puntos.map((punto) => [t.x(punto.x_m), t.y(punto.y_m)] as const), hex: conHex(relleno.hex) };
}

/**
 * El color de un trazo: el suyo si se lee contra el fondo y el piso de la escena; si no (el gris claro de un marco
 * metálico sobre un fondo claro), el de su borde (`bordeDeDisco`): el mismo tono, más oscuro.
 */
function colorDeTrazo(hex: string, colores: { fondo: string; piso: string }): string {
  const seLee = contrasteWcag(hex, colores.fondo) >= CONTRASTE_BORDE_MINIMO && contrasteWcag(hex, colores.piso) >= CONTRASTE_BORDE_MINIMO;
  return seLee ? hex : bordeDeDisco(hex, colores);
}

function svgDeTrazo(trazo: TrazoPx, color: string): string {
  const comun = `fill="none" stroke="${color}" stroke-width="${redondear(trazo.grosor)}" stroke-linecap="round"`;
  if (trazo.tipo === "linea") {
    return `<line x1="${redondear(trazo.x1)}" y1="${redondear(trazo.y1)}" x2="${redondear(trazo.x2)}" y2="${redondear(trazo.y2)}" ${comun}/>`;
  }
  if (trazo.hasta - trazo.desde >= 360) return `<circle cx="${redondear(trazo.cx)}" cy="${redondear(trazo.cy)}" r="${redondear(trazo.r)}" ${comun}/>`;
  // Antihorario con `y` arriba es antihorario en pantalla: `sweep-flag` 0.
  const punto = (grados: number) => [trazo.cx + trazo.r * Math.cos((grados * Math.PI) / 180), trazo.cy - trazo.r * Math.sin((grados * Math.PI) / 180)] as const;
  const [x0, y0] = punto(trazo.desde);
  const [x1, y1] = punto(trazo.hasta);
  const grande = trazo.hasta - trazo.desde > 180 ? 1 : 0;
  return `<path d="M${redondear(x0)} ${redondear(y0)}A${redondear(trazo.r)} ${redondear(trazo.r)} 0 ${grande} 0 ${redondear(x1)} ${redondear(y1)}" ${comun}/>`;
}

function svgDeRelleno(relleno: RellenoPx, borde: string, grosor: number): string {
  const comun = `fill="${relleno.hex}" stroke="${borde}" stroke-width="${redondear(grosor)}"`;
  if (relleno.tipo === "elipse") return `<ellipse cx="${redondear(relleno.cx)}" cy="${redondear(relleno.cy)}" rx="${redondear(relleno.rx)}" ry="${redondear(relleno.ry)}" ${comun}/>`;
  return `<polygon points="${relleno.puntos.map(([x, y]) => `${redondear(x)},${redondear(y)}`).join(" ")}" ${comun}/>`;
}

/**
 * El SVG de la guía de escena. Cada pieza conserva su proporción y se encaja en su caja: abajo si se apoya en
 * el piso, arriba si cuelga del techo, centrada si va en la pared. Se pinta de lo lejano a lo cercano (la base
 * más alta primero), y dentro de cada pieza en el orden de pintura que dio Python. El fondo sale de los discos
 * y de los rellenos (`fondoDeEscena`) y cada disco lleva su borde (`bordeDeDisco`) por dentro de su radio.
 *
 * Lo que no es globo (`rellenos` y `trazos`: el forro y el marco de un aro, la pesa y las cintas de un bouquet)
 * va detrás de los discos de su pieza, en el mismo encaje: plano, de su color, el relleno con el borde de su tono
 * y el trazo oscurecido si no se lee contra el fondo. Una pieza que no los trae se pinta exactamente como antes.
 */
export function svgGuiaEscena(piezas: readonly PiezaGuiaEscena[], instancias: readonly InstanciaGuia[], tamano: { ancho: number; alto: number }): string {
  const { ancho, alto } = tamano;
  const porId = new Map(piezas.map((pieza) => [pieza.estructura_id, pieza] as const));
  // El anclaje que publica Python manda sobre el que se dedujo de la ubicación del plan.
  const dibujables = instancias
    .filter((instancia) => porId.has(instancia.estructura_id))
    .map((instancia) => ({ ...instancia, apoyo: porId.get(instancia.estructura_id)!.anclaje ?? instancia.apoyo }));
  if (!dibujables.length) throw new Error("GUIA_ESCENA_INVALIDA: ninguna pieza del plan tiene globos que dibujar.");
  const piso = redondear(alto * lineaDePiso(dibujables));
  const pintables: PintablePx[] = [];
  const grosorTrazoMinimo = (GROSOR_TRAZO_MINIMO_1024 * ancho) / 1024;
  const ordenadas = [...dibujables].sort((a, b) => fondo(a.caja) - fondo(b.caja) || centroX(a.caja) - centroX(b.caja) || a.estructura_id.localeCompare(b.estructura_id) || a.instancia - b.instancia);
  for (const instancia of ordenadas) {
    const pieza = porId.get(instancia.estructura_id)!;
    const cajaX = instancia.caja.x * ancho;
    const cajaY = instancia.caja.y * alto;
    const cajaAncho = instancia.caja.width * ancho;
    const cajaAlto = instancia.caja.height * alto;
    const { escala, base } = encaje(pieza, instancia.apoyo, { x: cajaX, y: cajaY, ancho: cajaAncho, alto: cajaAlto });
    const centro = cajaX + cajaAncho / 2;
    const t: Transformacion = { x: (xM) => centro + (instancia.espejo ? -xM : xM) * escala, y: (yM) => base - yM * escala, escala, espejo: instancia.espejo };
    for (const relleno of pieza.rellenos ?? []) pintables.push(rellenoEnPx(relleno, t));
    for (const trazo of pieza.trazos ?? []) pintables.push(trazoEnPx(trazo, t, grosorTrazoMinimo));
    for (const disco of pieza.discos) {
      pintables.push({ tipo: "disco", x: t.x(disco.x_m), y: t.y(disco.y_m), r: Math.max(0.5, disco.r_m * escala), hex: conHex(disco.hex) });
    }
  }
  const colores = fondoDeEscena(pintables.filter((item) => item.tipo === "disco" || item.tipo === "elipse" || item.tipo === "poligono").map((item) => item.hex));
  const partes = [
    `<rect x="0" y="0" width="${ancho}" height="${alto}" fill="${colores.fondo}"/>`,
    `<rect x="0" y="${piso}" width="${ancho}" height="${redondear(alto - piso)}" fill="${colores.piso}"/>`,
  ];
  const bordes = new Map<string, string>();
  const bordeDe = (hex: string): string => {
    if (!bordes.has(hex)) bordes.set(hex, bordeDeDisco(hex, colores));
    return bordes.get(hex)!;
  };
  const grosorBase = (GROSOR_BORDE_1024 * ancho) / 1024;
  for (const item of pintables) {
    if (item.tipo === "disco") {
      // El borde va por dentro: el disco conserva su radio exterior.
      const grosor = Math.min(grosorBase, item.r * 0.3);
      partes.push(`<circle cx="${redondear(item.x)}" cy="${redondear(item.y)}" r="${redondear(item.r - grosor / 2)}" fill="${item.hex}" stroke="${bordeDe(item.hex)}" stroke-width="${redondear(grosor)}"/>`);
    } else if (item.tipo === "elipse" || item.tipo === "poligono") {
      partes.push(svgDeRelleno(item, bordeDe(item.hex), grosorBase));
    } else {
      partes.push(svgDeTrazo(item, colorDeTrazo(item.hex, colores)));
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">${partes.join("")}</svg>`;
}

/**
 * Cuándo la generación lleva guía de escena: bandera encendida, FLUX directo (modo base o entrenado, sin el
 * híbrido con foto del espacio), sin resultado previo (esa ya es la base de `/edit`), con `/edit` disponible, el
 * caption en texto y un plan que salió de una foto de referencia (alguna estructura la materializa).
 */
export function generacionAdmiteGuiaEscena(entrada: { bandera: boolean; usarLora: boolean; hibrido: boolean; fotoEspacio: boolean; resultadoPrevio: boolean; editApagado: boolean; formatoTexto: boolean; conReferencia: boolean }): boolean {
  return entrada.bandera && entrada.usarLora && !entrada.hibrido && !entrada.fotoEspacio && !entrada.resultadoPrevio && !entrada.editApagado && entrada.formatoTexto && entrada.conReferencia;
}

/** Si alguna estructura del plan materializa un elemento de una foto de referencia. */
export function planConReferencia(estructuras: readonly EstructuraPlan[]): boolean {
  return estructuras.some((estructura) => Boolean(referenciaDe(estructura)));
}
