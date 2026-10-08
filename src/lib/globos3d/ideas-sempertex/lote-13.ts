import { ideaPerezosa, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { coloresDelFormato, formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import { fondoMarcoOndulado, mesaCilindrica, paredLentejuelas, tapete, type ElementoEscenografia } from "../escenografia";
import { banderin, letrero, platos, vasos } from "../utileria";
import type { ColorOrganico, OpcionesOrganico, PuntoGrosor, PuntoMezcla, RellenoOrganico, TramoOrganico } from "../organico";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { Decoracion } from "../figuras";
import type { EstiloOjo } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { Vec3 } from "../modulos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 13** (los números de `clasif/lote-13.json`), nueve escenas
 * completas: #933 The Grinch (cuatro columnas espiral y una perla), #524 Escenario Halloween (malla Link-O-Loon, guirnalda
 * cromada, torre de calderos y ramo), #553 Feliz cumpleaños Terra (arco terracota y durazno, cascada café y mostaza),
 * #554 Feliz día bigotes (aro dorado con orgánico de cuatro colores, montículo y dos ramos), #639 Feliz Año (arco
 * asimétrico plata, gris, arena y negro, ramo con R-24 impreso), #650 Halloween (cuatro racimos neón con ojos y manos),
 * #794 Reflex Luxury (marco champaña, café y arena con flor), #948 Tropical Sunset (aro de bejucos y flores sobre dos
 * bases cobrizas) y #961 Una tierna fiesta en tonos pasteles (arco arcoíris pastel).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, ampliada con rejilla y medida:
 * - **Escala**: la de algo de tamaño conocido en la misma foto (un R-24 ≈ 55 cm, un cuarteto R-12 ≈ 2,24 diámetros de
 *   ancho de frente, un eslabón LOL-12 de la malla, una mesa o un pedestal) en el plano del fondo; con ella, una función
 *   de la foto al mundo por idea (x a la derecha desde el centro, y desde el piso). Cada escena dice su escala.
 * - **Conteo**: niveles de las columnas por los bultos del borde, eslabones y flores de la malla, globos de cada ramo
 *   (de arriba abajo), flores, hojas, ojos y anillos. En los orgánicos el motor da los globos para el grosor y el largo
 *   medidos (no se cuentan uno a uno: la nota lo dice). Ninguna idea publica «Materiales» con cantidades: lo contado va
 *   con `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos (aunque la foto mida otra cosa: la nota lo dice). Si no,
 *   medidos en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial;
 *   en las fotos con dominante cálida, después de equilibrar el blanco con la puerta o la pared blancas) y el código más
 *   cercano que se fabrica en ese formato. En lo orgánico cada color va solo en los formatos donde existe.
 * - **Impresos**: los del catálogo (`impresos-catalogo.ts`) cuando la foto los tiene; si no, el liso de su fondo.
 * - **Montaje** (para que la biblioteca saque «esta estructura sola con sus decoraciones» y «esta decoración sola»): cada
 *   estructura es su propio árbol. Si es de una paleta, su raíz es ella misma; si va por tramos de color (el motor
 *   orgánico pinta una pieza con una sola paleta), su raíz es su **armazón** (el tubo de PVC o el aro que la sostiene,
 *   escondido entre los globos o a la vista): de él cuelgan (`sobre`, exacto) sus tramos, y de cada tramo, lo que se
 *   apoya en sus globos. Lo que va sobre los globos se asienta en su superficie (`apoyar`); los ramos de helio van de pie
 *   con el peso metido en su base de globos (la biblioteca los cuenta como pegados a ella). Mesas, utilería y
 *   escenografía van aparte, sueltas.
 * Unidades: cm. Mundo: y arriba desde el piso, x a la derecha de quien mira, +z hacia quien mira; la pared del fondo en
 * z = −fondo/2.
 */

// ----------------------------------------------------------------------------------------------------------
// Geometría
// ----------------------------------------------------------------------------------------------------------

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const mas = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const menos = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const por = (a: Vec3, k: number): Vec3 => v(a.x * k, a.y * k, a.z * k);
const largo = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unitario = (a: Vec3): Vec3 => { const n = largo(a) || 1; return por(a, 1 / n); };
const cruz = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const redondo = (p: Vec3): Vec3 => v(r2(p.x), r2(p.y), r2(p.z));
const rad = (g: number) => (g * Math.PI) / 180;
const ARRIBA = v(0, 1, 0);
const AL_FRENTE = v(0, 0, 1);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos: Partial<Sala["tonos"]> = {}): Sala => {
  const s = structuredClone(SALA_INICIAL);
  return { ...s, anchoCm, fondoCm, altoCm, tonos: { ...s.tonos, ...tonos } };
};

/** Matriz 3 × 3 por filas: de un espacio local al mundo (giro, o giro con espejo: el marco de `sobre` lo es). */
type M3 = readonly [number, number, number, number, number, number, number, number, number];
/** Un espacio local: v ↦ m·v + t. */
type Marco = { m: M3; t: Vec3 };

const IDENTIDAD: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** mᵀ·a: del mundo al espacio local (los marcos son ortonormales). */
const trasladar = (m: M3, a: Vec3): Vec3 => v(m[0] * a.x + m[3] * a.y + m[6] * a.z, m[1] * a.x + m[4] * a.y + m[7] * a.z, m[2] * a.x + m[5] * a.y + m[8] * a.z);
const aLocal = (k: Marco, p: Vec3): Vec3 => trasladar(k.m, menos(p, k.t));

/**
 * El giro de una pieza `sobre` (el mismo que `marcoDeAncla` de la escena): y local = la normal, x local horizontal (o
 * a lo largo de x si la normal es vertical) y `giroGrados` sobre la normal. Con la normal hacia arriba y 90°, (x, y, z)
 * local va a (x, y, −z) del mundo; con la normal al frente y 0°, a (x, z, y).
 */
function giroSobre(normal: Vec3, giroGrados: number): M3 {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  const c = Math.cos(rad(giroGrados)), s = Math.sin(rad(giroGrados));
  const f = (a: number, b: number, d: number): [number, number, number] => [a * c + d * s, b, -a * s + d * c];
  const [m0, m1, m2] = f(xL.x, n.x, zL.x), [m3, m4, m5] = f(xL.y, n.y, zL.y), [m6, m7, m8] = f(xL.z, n.z, zL.z);
  const r = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
  return [r(m0), r(m1), r(m2), r(m3), r(m4), r(m5), r(m6), r(m7), r(m8)];
}

/** Lo que una pieza armada baja de su origen a lo largo de su y local (−min.y de su caja). */
const bajoDe = (pieza: Pieza): number => -armarPieza(pieza).caja.min.y;

type Padre = { id: string; marco: Marco };

/** Una pieza suelta (raíz), con su origen en `origen` del mundo, de frente. */
function suelta(id: string, nombre: string, pieza: Pieza, origen: Vec3): { nodo: NodoEscena; padre: Padre } {
  return { nodo: { id, nombre, pieza, colocacion: { en: "libre", xCm: r2(origen.x), yCm: r2(origen.y), zCm: r2(origen.z), giroGrados: 0 } }, padre: { id, marco: { m: IDENTIDAD, t: origen } } };
}

/** Una pieza en el piso, centrada en (x, z) y girada sobre la vertical. */
const enPiso = (id: string, nombre: string, pieza: Pieza, x: number, z: number, giroGrados = 0): NodoEscena =>
  ({ id, nombre, pieza, colocacion: { en: "piso", xCm: r2(x), zCm: r2(z), giroGrados } });

/**
 * Una pieza `sobre` una pieza **sin globos** (un armazón): la escena la corre a lo largo de la normal lo que baja su caja
 * (−min.y) y la hunde `HUNDIMIENTO_SOBRE_CM`; aquí se descuenta, así que su origen queda en `origen` (mundo), su y local
 * hacia `normal` y girada `giroGrados`. Los tramos orgánicos (con `suelo`, su globo más bajo en su y = 0) se cuelgan
 * con `bajo` 0: su globo más bajo queda en el plano de `origen`.
 */
function colgar(o: { id: string; nombre: string; pieza: Pieza; padre: Padre; origen: Vec3; normal: Vec3; giroGrados?: number; bajo?: number }): { nodo: NodoEscena; padre: Padre } {
  const n = unitario(o.normal);
  const giro = o.giroGrados ?? 0;
  const bajo = o.bajo ?? bajoDe(o.pieza);
  const punto = menos(o.origen, por(n, bajo - HUNDIMIENTO_SOBRE_CM));
  return {
    nodo: { id: o.id, nombre: o.nombre, pieza: o.pieza, colocacion: { en: "sobre", padreId: o.padre.id, puntoCm: redondo(aLocal(o.padre.marco, punto)), normal: redondo(trasladar(o.padre.marco.m, n)), giroGrados: giro } },
    padre: { id: o.id, marco: { m: giroSobre(n, giro), t: o.origen } },
  };
}

/**
 * Una pieza `sobre` los globos de una estructura: un punto (mundo) dentro de ella o en su cara y hacia dónde mira; la
 * escena la corre a lo largo de la normal hasta que su espalda toca los globos (la flor sobre el racimo, el ojo sobre el
 * orgánico, el globo de remate sobre otro).
 */
function apoyar(id: string, nombre: string, pieza: Pieza, padre: Padre, punto: Vec3, normal: Vec3, giroGrados = 0): NodoEscena {
  return { id, nombre, pieza, colocacion: { en: "sobre", padreId: padre.id, puntoCm: redondo(aLocal(padre.marco, punto)), normal: redondo(trasladar(padre.marco.m, unitario(normal))), giroGrados } };
}

/** Un giro sobre la normal al frente que lleva el «abajo» de una decoración de pie (−z) a la dirección (dx, dy) de la pared. */
const giroHacia = (dx: number, dy: number) => r2((Math.atan2(-dx, -dy) * 180) / Math.PI);

// ----------------------------------------------------------------------------------------------------------
// Piezas
// ----------------------------------------------------------------------------------------------------------

const globo = (g: ParteGlobo, impresoId?: string): Pieza => ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) });
const deco = (decoracion: Decoracion): Pieza => ({ tipo: "decoracion", decoracion });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
/** Un anillo de `cantidad` globos iguales (el collar de un caldero, un racimito de bayas). */
const anillo = (g: ParteGlobo, cantidad: number, aperturaGrados = 0): Pieza => deco(flor({ petalos: { ...g, cantidad, aperturaGrados, giroGrados: 0 }, centro: null }));
const rizo = (p: PropiedadesRizo): Pieza => deco({ tipo: "rizo", propiedades: p });

/** Una columna de cuartetos de `niveles` niveles (la trenza de Sempertex: un nivel cada 0,8 diámetros). */
function columna(formatoId: string, infladoCm: number, niveles: number, colores: string[], patron: "un_color" | "dos_colores" = "un_color"): Pieza {
  return { tipo: "columna", formatoId, infladoCm, alturaCm: r2(niveles * infladoCm * 0.8), patron, colores };
}

/** Un ramo de helio (de arriba abajo), con su peso en el origen; `impresos` por índice de globo. */
function ramo(globos: ParteGlobo[], alturaCm: number, cinta: string, peso: string, impresos: ImpresoEnPieza[] = []): Pieza {
  return { tipo: "decoracion", decoracion: { tipo: "ramo_helio", propiedades: { globos, alturaCm, cinta: { hex: cinta }, peso: { hex: peso } } }, ...(impresos.length ? { impresos } : {}) };
}

/** Un racimo redondo de globos (la base de un ramo, lo que va dentro de una jaula): la forma esfera, centrada. */
const racimoEsfera = (diametroCm: number, formatoId: string, infladoCm: number, codigos: string[], pesos: number[], semilla: number): Pieza =>
  ({ tipo: "forma", forma: { clase: "esfera", diametroCm, globo: { formatoId, infladoCm }, colores: { codigos, patron: "mezcla", pesos, semilla } } });

// ----------------------------------------------------------------------------------------------------------
// Orgánicos (raíces sueltas o tramos de color colgados de su armazón)
// ----------------------------------------------------------------------------------------------------------

const FORMATOS_REDONDOS = ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"];
/** Un color de la paleta orgánica, solo en los formatos donde se fabrica (y, si se pide, solo en esos). */
function color(codigo: string, peso: number, soloEn?: string[]): ColorOrganico {
  const formatos = (soloEn ?? FORMATOS_REDONDOS).filter((f) => coloresDelFormato(f).some((r) => r.codigo === codigo));
  return { codigo, peso, formatos };
}
const mezcla = (pesos: Readonly<Record<string, number>>, fin?: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos: fin ?? pesos }];
/** Grosor de un racimo: de `inicio` a `fin` (y la punta, redondeada). */
const grosor = (inicio: number, fin: number): PuntoGrosor[] => [{ t: 0, radioCm: inicio }, { t: 0.85, radioCm: fin }, { t: 1, radioCm: fin * 0.8 }];
/**
 * Relleno de huecos: R-12 desinflados y R-9 (lo que se ve en estas fotos: el R-12 manda y los R-5 son acentos, que van
 * en la mezcla); solo R-12 si la paleta no se fabrica en R-9; y el tupido (R-9 y tríos de R-5) donde la foto muestra
 * muchos globitos (la guirnalda cromada de #524, los racimos neón de #650).
 */
const RELLENO_12_9: RellenoOrganico[] = [{ formatoId: "R-12", infladoCm: 22, trios: false }, { formatoId: "R-9", infladoCm: 16, trios: false }];
const RELLENO_12: RellenoOrganico[] = [{ formatoId: "R-12", infladoCm: 22, trios: false }];
const RELLENO_TUPIDO_5: RellenoOrganico[] = [{ formatoId: "R-9", infladoCm: 16, trios: false }, { formatoId: "R-5", infladoCm: 11, trios: true }];
/** Inflados de lo orgánico en estas fotos (los globos de estructura van un poco menos inflados que los de helio). */
const INFLADOS: Readonly<Record<string, number>> = { "R-36": 80, "R-24": 50, "R-18": 38, "R-12": 27, "R-9": 20, "R-5": 12 };

/** Un tramo de racimo con su recorrido en el MUNDO. */
type TramoDef = { id: string; nombre: string; puntos: Vec3[]; grosor: PuntoGrosor[]; mezcla: PuntoMezcla[]; tapas?: { inicio?: boolean; fin?: boolean }; irregularidad?: number };
/** `pared`: z de la pared del fondo (el eje se separa de ella lo que haga falta para que ningún globo la cruce). */
type OpcionesPaleta = { colores: ColorOrganico[]; semilla: number; relleno: RellenoOrganico[]; pared: number; inflados?: Readonly<Record<string, number>>; densidad?: number };

function radioEn(g: readonly PuntoGrosor[], t: number): number {
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1]!, b = g[i]!;
    if (t <= b.t) return a.radioCm + ((b.radioCm - a.radioCm) * (t - a.t)) / Math.max(1e-9, b.t - a.t);
  }
  return g[g.length - 1]!.radioCm;
}

/** El plano de apoyo de unos tramos: el piso, o (si flotan) justo bajo su globo más bajo. */
function planoDe(tramos: readonly TramoDef[]): number {
  const bajo = Math.min(...tramos.flatMap((d) => d.puntos.map((p, i) => p.y - radioEn(d.grosor, i / Math.max(1, d.puntos.length - 1)))));
  return bajo < 8 ? 0 : r2(bajo - 1);
}

function piezaOrganica(tramos: readonly TramoDef[], o: OpcionesPaleta, local: (p: Vec3) => Vec3): Pieza {
  const t: TramoOrganico[] = tramos.map((d) => ({
    id: d.id, nombre: d.nombre, recorrido: d.puntos.map((p) => redondo(local(p))), grosor: d.grosor, mezcla: d.mezcla,
    irregularidad: d.irregularidad ?? 0.14, tapas: d.tapas ?? { inicio: true, fin: true },
  }));
  const opciones: OpcionesOrganico = {
    semilla: o.semilla, tramos: t, inflados: { ...(o.inflados ?? INFLADOS) }, variacionInflado: 0.07,
    relleno: o.relleno.map((r) => ({ ...r })), colores: o.colores, suelo: true, huecosFlores: 0, ...(o.densidad ? { densidad: o.densidad } : {}),
  };
  return { tipo: "organico", opciones, flores: null };
}

/** Un orgánico de una paleta como raíz suelta: su plano de apoyo es el piso (o el de debajo de su globo más bajo). */
/** Los tramos con su eje separado de la pared del fondo lo que mide su envoltura (y 6 cm más: la irregularidad). */
const lejosDeLaPared = (tramos: readonly TramoDef[], pared: number): TramoDef[] =>
  tramos.map((d) => ({ ...d, puntos: d.puntos.map((p, i) => v(p.x, p.y, Math.max(p.z, r2(pared + radioEn(d.grosor, i / Math.max(1, d.puntos.length - 1)) + 6)))) }));

/**
 * Un orgánico de una paleta como raíz suelta: su plano de apoyo es el de debajo de su globo más bajo, o 3 cm sobre el
 * piso (el motor deja que los de abajo se aplasten un poco contra su plano).
 */
function organicoSuelto(id: string, nombre: string, tramos0: TramoDef[], o: OpcionesPaleta): { nodo: NodoEscena; padre: Padre } {
  const tramos = lejosDeLaPared(tramos0, o.pared);
  const origen = v(0, planoDe(tramos) || 3, 0);
  return suelta(id, nombre, piezaOrganica(tramos, o, (p) => menos(p, origen)), origen);
}

/**
 * Un tramo de color colgado de su armazón, con la normal hacia arriba (su y = 0 local es el plano de apoyo: el piso, o
 * justo bajo su globo más bajo si flota, y ningún globo baja de ahí) y girado 90° (local (x, y, z) → mundo (x, y, −z)).
 */
function tramoDe(armazon: Padre, id: string, nombre: string, tramos0: TramoDef[], o: OpcionesPaleta): { nodo: NodoEscena; padre: Padre } {
  const tramos = lejosDeLaPared(tramos0, o.pared);
  const origen = v(0, planoDe(tramos), 0);
  const marco: Marco = { m: giroSobre(ARRIBA, 90), t: origen };
  return colgar({ id, nombre, pieza: piezaOrganica(tramos, o, (p) => aLocal(marco, p)), padre: armazon, origen, normal: ARRIBA, giroGrados: 90, bajo: 0 });
}

// ----------------------------------------------------------------------------------------------------------
// Escenografía (no cotiza)
// ----------------------------------------------------------------------------------------------------------

type Acabado = ElementoEscenografia["acabado"];
const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: Acabado = "mate", giroGrados = 0): ElementoEscenografia =>
  ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado, ...(giroGrados ? { giroGrados } : {}) });
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: Acabado = "mate", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });
/** Un cilindro de `desde` a `hasta` (tubo, cinta, pata, cable). */
function barra(desde: Vec3, hasta: Vec3, radioCm: number, hex: string, acabado: Acabado = "mate"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm: r2(radioCm), altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
/** Un tablón inclinado (pluma, hoja de pampa, tira): una caja con su propio marco, de `desde` a `hasta`. */
function tablon(desde: Vec3, hasta: Vec3, anchoCm: number, gruesoCm: number, hex: string, acabado: Acabado = "mate"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const x = unitario(d);
  const y = unitario(Math.abs(x.y) < 0.95 ? cruz(AL_FRENTE, x) : cruz(x, v(1, 0, 0)));
  return { forma: "caja", centro: v(r2(largo(d) / 2), 0, 0), tamano: v(r2(largo(d)), r2(gruesoCm), r2(anchoCm)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
/** Una bola (cabeza, pompón, foco) de cilindros apilados. */
function bola(centro: Vec3, radioCm: number, hex: string, acabado: Acabado = "mate", tramos = 6): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  for (let i = 0; i < tramos; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * i) / tramos, a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / tramos;
    salida.push(cilindro(v(centro.x, centro.y + radioCm * Math.sin(a0), centro.z), Math.max(0.3, radioCm * Math.cos(a0)), radioCm * (Math.sin(a1) - Math.sin(a0)), hex, acabado, Math.max(0.3, radioCm * Math.cos(a1))));
  }
  return salida;
}
/** Un tubo que sigue unos puntos (el armazón de PVC, el aro metálico). */
const tubo = (puntos: readonly Vec3[], radioCm: number, hex: string, acabado: Acabado = "mate"): ElementoEscenografia[] =>
  puntos.slice(1).map((p, i) => barra(puntos[i]!, p, radioCm, hex, acabado));
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });
/** Un círculo (contorno de un panel) de `pasos` puntos alrededor de (cx, cy), en sentido `signo`. */
const circulo = (cx: number, cy: number, rx: number, ry: number, pasos = 24, signo = 1) =>
  Array.from({ length: pasos }, (_, i) => ({ x: r2(cx + rx * Math.cos((signo * 2 * Math.PI * i) / pasos)), y: r2(cy + ry * Math.sin((signo * 2 * Math.PI * i) / pasos)) }));
/** Una araña de peluche o de oropel (no es globo): cuerpo, cabeza y 8 patas quebradas, de frente sobre el plano z. */
function aranaDeOropel(centro: Vec3, radioCm: number, hex = "#141214"): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [...bola(centro, radioCm, hex, "lentejuelas"), ...bola(mas(centro, v(0, radioCm * 1.2, 0)), radioCm * 0.6, hex, "lentejuelas")];
  for (const lado of [-1, 1]) for (let k = 0; k < 4; k++) {
    const a = rad(-40 + k * 30);
    const rodilla = mas(centro, v(lado * radioCm * 2 * Math.cos(a), radioCm * 2 * Math.sin(a) + radioCm * 0.8, 0));
    const pie = mas(rodilla, v(lado * radioCm * 1.1, -radioCm * 1.8, 0));
    salida.push(barra(centro, rodilla, radioCm * 0.13, hex, "lentejuelas"), barra(rodilla, pie, radioCm * 0.12, hex, "lentejuelas"));
  }
  return salida;
}
/** Una mesa de patas metálicas (marco blanco) con tapa de vidrio o de madera. */
function mesaMetalica(ancho: number, fondo: number, alto: number, marco: string, tapa: string, acabadoTapa: Acabado = "brillante"): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [caja(v(0, alto - 1, 0), v(ancho, 2, fondo), tapa, acabadoTapa)];
  for (const x of [-ancho / 2 + 1.5, ancho / 2 - 1.5]) for (const z of [-fondo / 2 + 1.5, fondo / 2 - 1.5]) salida.push(caja(v(x, (alto - 2) / 2, z), v(2.5, alto - 2, 2.5), marco, "metal"));
  for (const y of [3, alto - 4]) {
    salida.push(caja(v(0, y, fondo / 2 - 1.5), v(ancho, 2.5, 2.5), marco, "metal"), caja(v(0, y, -fondo / 2 + 1.5), v(ancho, 2.5, 2.5), marco, "metal"));
    salida.push(caja(v(-ancho / 2 + 1.5, y, 0), v(2.5, 2.5, fondo), marco, "metal"), caja(v(ancho / 2 - 1.5, y, 0), v(2.5, 2.5, fondo), marco, "metal"));
  }
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** Un producto que la idea publica (nombre y url tal cual; el formato y el código de su mapeo). */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };
const P = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });

const clave = (formatoId: string, codigo: string) => `${formatoId}|${codigo}`;
const tipoDe = (formatoId: string | null) => (formatoId ? formatoPorId(formatoId)?.tipo ?? null : null);

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos). */
function lisoDeTienda(formatoId: string, codigo: string): { nombre: string; url: string } {
  const tipo = tipoDe(formatoId) ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  if (fila) return { nombre: fila.nombre, url: fila.url };
  const x = productoDeGlobo(formatoId, codigo);
  return { nombre: x.nombre, url: quitarOrigen(x.url) };
}

/**
 * Los globos impresos de una escena: por impreso y por látex (formato y código del globo). Se eligen como los elige
 * `aplicarImpresos`: por índice o por color (uno de cada `cada` desde `desde`), sin repetir globo; el látex es el del
 * globo si es del surtido, si no el del impreso.
 */
function impresosDe(escena: Escena): Map<string, Map<string, number>> {
  const salida = new Map<string, Map<string, number>>();
  for (const nodo of escena.nodos) {
    const pedidos = nodo.pieza.impresos ?? [];
    if (!pedidos.length) continue;
    const base = armarPieza({ ...nodo.pieza, impresos: [] }).globos;
    const usados = new Set<number>();
    for (const pedido of pedidos) {
      const i = impresoPorId(pedido.impresoId);
      if (!i) continue;
      let elegidos: number[];
      if ("globos" in pedido) elegidos = pedido.globos.filter((k) => k >= 0 && k < base.length);
      else {
        const delColor = base.map((g, k) => (g.codigo === pedido.codigo ? k : -1)).filter((k) => k >= 0);
        const cada = Math.max(1, pedido.cada ?? 1), desde = Math.max(0, pedido.desde ?? 0);
        elegidos = delColor.filter((_, n) => n >= desde && (n - desde) % cada === 0);
      }
      for (const k of elegidos.filter((x) => !usados.has(x))) {
        usados.add(k);
        const g = base[k]!;
        const codigo = i.surtido?.includes(g.codigo) ? g.codigo : i.codigoBase;
        const porLatex = salida.get(i.id) ?? new Map<string, number>();
        porLatex.set(clave(g.formatoId, codigo), (porLatex.get(clave(g.formatoId, codigo)) ?? 0) + 1);
        salida.set(i.id, porLatex);
      }
    }
  }
  return salida;
}

/**
 * Los productos de lo armado: cada línea del 3D (formato y código) con su cantidad exacta. Primero los impresos de la
 * tienda (con su látex), luego los lisos: el producto publicado si es el mismo globo (mismo tipo y código: la talla va
 * en `formato`), si no el liso de la tienda. Lo publicado que la foto no muestra va al final, sin cantidad.
 */
function productosDe(contenido: IdeaDigitalizada["contenido"], publicados: readonly Publicado[]): ProductoDeIdea[] {
  const escena: Escena = contenido.tipo === "escena" ? contenido.escena : { sala: structuredClone(SALA_INICIAL), nodos: [{ id: "pieza", nombre: "pieza", pieza: contenido.pieza, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  const armada = armarEscena(escena);
  const total = new Map<string, number>();
  for (const m of armada.materiales) total.set(clave(m.formatoId, m.codigo), (total.get(clave(m.formatoId, m.codigo)) ?? 0) + m.cantidad);
  const impresos = impresosDe(escena);
  const impresosPorClave = new Map<string, number>();
  for (const porLatex of impresos.values()) for (const [k, n] of porLatex) impresosPorClave.set(k, (impresosPorClave.get(k) ?? 0) + n);
  const usados = new Set<Publicado>();
  const salida: ProductoDeIdea[] = [];
  for (const [impresoId, porLatex] of impresos) {
    const i = impresoPorId(impresoId)!;
    const p = publicados.find((x) => x.codigo === null && impresoPorUrl(x.url)?.id === impresoId);
    if (p) usados.add(p);
    for (const [k, n] of porLatex) { const [f, c] = k.split("|") as [string, string]; salida.push({ nombre: p?.nombre ?? i.nombre, url: p?.url ?? i.url, formato: f, codigo: c, cantidad: n, contada: true }); }
  }
  for (const [k, n] of total) {
    const resto = Math.ceil(n - 1e-9) - (impresosPorClave.get(k) ?? 0);
    if (resto <= 0) continue;
    const [f, c] = k.split("|") as [string, string];
    const p = publicados.find((x) => x.codigo === c && tipoDe(x.formato) === tipoDe(f));
    if (p) usados.add(p);
    const base = p ?? lisoDeTienda(f, c);
    salida.push({ nombre: base.nombre, url: base.url, formato: f, codigo: c, cantidad: resto, contada: true });
  }
  for (const p of publicados) if (!usados.has(p)) salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: null });
  return salida;
}

function fuente(slug: string): FuenteIdea {
  const f = fuenteIdea(slug);
  if (!f) throw new Error(`La idea «${slug}» no está en las fuentes.`);
  return f;
}

/**
 * La idea con su número, ocasiones y foto de su fuente; perezosa (ver `tipos.ts`): la escena se arma y sus productos se
 * calculan la primera vez que se piden (salen de armar la escena). Las ocasiones salen de las etiquetas con
 * `ocasionesDeEtiquetas`, que vive en `index.ts` (que importa este lote): se calculan al leerlas, como en los lotes 06 y 09.
 */
function idea(slug: string, nombre: string, escena: () => Escena, nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  return ideaPerezosa({
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
  }, () => ({ tipo: "escena", escena: escena() }), (contenido) => productosDe(contenido, publicados));
}

// ----------------------------------------------------------------------------------------------------------
// 933 · The Grinch
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (con margen blanco): cuatro columnas anchas de cuartetos R-12 en espiral doble rojo y perla, pegadas
 * (la cuarta, detrás de la chimenea), y una columna perla corta a la derecha, bajo el cuadro. Escala: el cuarteto mide
 * 100 px de ancho de frente (2,24 diámetros: R-12 a 25 cm, 1,78 px/cm); de y = 92 al piso (≈ 490, tapado por los
 * regalos) son 398 px ≈ 2,25 m: 11 niveles. La perla mide 80 px de ancho y 143 px de alto, más al fondo (≈ 1,43 px/cm):
 * 5 niveles. La chimenea de cartón con el Grinch sentado, los regalos, las medias, el cuadro y las luces son escenografía.
 */
const escena933 = (): Escena => {
  const ROJO = "#d8231c", VERDE = "#8fbf3a", AMARILLO = "#f4c21a", NARANJA = "#ec8a2a", BLANCO = "#f7f2ea";
  const columnaEspiral = columna("R-12", 25, 11, ["015", "406"], "dos_colores");
  const columnas: NodoEscena[] = [
    enPiso("columna-1", "Columna espiral rojo y perla 1", columnaEspiral, -126, -140),
    enPiso("columna-2", "Columna espiral rojo y perla 2", columnaEspiral, -75, -140, 45),
    enPiso("columna-3", "Columna espiral rojo y perla 3", columnaEspiral, -25, -140),
    enPiso("columna-4", "Columna espiral rojo y perla 4 (detrás de la chimenea)", columnaEspiral, 18, -168, 45),
    enPiso("columna-perla", "Columna perla", columna("R-12", 25, 5, ["406"]), 205, -172),
  ];
  // La chimenea de cartón: cuerpo, repisa blanca, campana que se angosta y el tubo; ladrillos pintados.
  const chimenea: ElementoEscenografia[] = [
    caja(v(0, 75, 0), v(150, 150, 50), AMARILLO, "papel"), caja(v(0, 30, 26), v(60, 60, 2), "#7a3a12", "papel"),
    caja(v(0, 154, 4), v(172, 8, 62), BLANCO, "papel"),
    { forma: "panel", contorno: [{ x: -62, y: 158 }, { x: 62, y: 158 }, { x: 30, y: 225 }, { x: -30, y: 225 }], zCm: -18, grosorCm: 34, hex: AMARILLO, acabado: "papel" },
    caja(v(0, 240, -2), v(52, 30, 30), NARANJA, "papel"),
    ...[20, 50, 80, 110, 140].map((y) => caja(v(0, y, 25.2), v(150, 1, 0.5), NARANJA, "papel")),
    // El tubo de la campana que dobla hacia la derecha (rojo).
    barra(v(20, 236, 0), v(90, 250, 0), 4, ROJO, "papel"),
  ];
  // El Grinch sentado delante de la chimenea: cuerpo rojo, cara verde, gorro de Santa con pompón.
  const grinch: ElementoEscenografia[] = [
    caja(v(0, 30, 0), v(52, 60, 42), ROJO, "tela"), caja(v(0, 64, 0), v(56, 10, 46), BLANCO, "tela"),
    ...bola(v(0, 92, 2), 15, "#8bb04a", "mate"), cilindro(v(0, 104, 2), 15, 22, ROJO, "tela", 2), ...bola(v(6, 128, 2), 4, BLANCO, "tela"),
    barra(v(-26, 50, 8), v(-38, 20, 22), 6, ROJO, "tela"), barra(v(26, 50, 8), v(40, 22, 22), 6, ROJO, "tela"),
  ];
  const regalo = (x: number, y: number, z: number, a: number, h: number, f: number, hex: string, liston: string): ElementoEscenografia[] => [
    caja(v(x, y + h / 2, z), v(a, h, f), hex, "papel"),
    caja(v(x, y + h / 2, z), v(a * 0.16, h + 0.4, f + 0.4), liston, "satinado"), caja(v(x, y + h / 2, z), v(a + 0.4, h + 0.4, f * 0.16), liston, "satinado"),
    caja(v(x, y + h + 4, z), v(a * 0.5, 8, f * 0.16), liston, "satinado"),
  ];
  const regalos: ElementoEscenografia[] = [
    ...regalo(-70, 0, -80, 60, 45, 50, VERDE, AMARILLO), ...regalo(-70, 45, -80, 55, 52, 45, AMARILLO, ROJO),
    ...regalo(-180, 0, -60, 62, 50, 50, ROJO, "#2e8b3a"), ...regalo(-22, 0, -95, 52, 30, 40, NARANJA, AMARILLO),
    ...regalo(112, 0, -92, 50, 46, 44, "#a58fc8", AMARILLO),
  ];
  // Las medias navideñas: en el piso, delante, y cuatro colgadas de la repisa (pierna, pie y puño blanco).
  const media = (x: number, y: number, z: number, hex: string, giro: number): ElementoEscenografia[] => [
    caja(v(x, y + 15, z), v(12, 30, 6), hex, "tela", giro), caja(v(x + 6, y + 4, z), v(22, 9, 6), hex, "tela", giro), caja(v(x, y + 31, z), v(14, 7, 7), BLANCO, "tela", giro),
  ];
  const medias: ElementoEscenografia[] = [
    ...[[-150, -10], [-118, 5], [-95, -20], [-45, 10], [-10, -15], [25, 5], [55, -25], [135, -30], [-165, 20], [5, 25]].flatMap(([x, z], k) => media(x!, 0, z!, k % 2 ? ROJO : VERDE, (k * 37) % 70 - 35)),
  ];
  const colgadas: ElementoEscenografia[] = [-50, -18, 22, 55].flatMap((x, k) => media(x, 112, 28, k % 2 ? VERDE : ROJO, 0));
  const fondo: ElementoEscenografia[] = [
    // Los paneles pintados del fondo (naranja y verde) y el cuadro de Cindy Lou con marco rojo.
    caja(v(70, 125, 0), v(170, 250, 2), NARANJA, "mate"), caja(v(190, 125, 0), v(80, 250, 2), "#79a83a", "mate"),
    caja(v(205, 172, 2), v(72, 98, 2), ROJO, "papel"), caja(v(205, 172, 3.2), v(58, 82, 1), "#f3e6c8", "papel"),
    // La guirnalda de luces de colores sobre las columnas.
    ...tubo([v(-40, 246, 6), v(-10, 236, 6), v(25, 244, 6), v(60, 232, 6)], 0.3, "#202020"),
    ...[[-34, 243], [-20, 238], [-4, 237], [12, 241], [30, 243], [46, 236]].flatMap(([x, y], k) => bola(v(x!, y! - 3, 7), 1.6, ["#e8261c", "#2fa84a", "#f4c21a", "#3a7be0"][k % 4]!, "brillante", 3)),
  ];
  return {
    sala: sala(480, 400, 260, { piso: "#5b2f1d", paredes: "#e7c1a4", techo: "#f3ebe3" }),
    nodos: [
      ...columnas,
      { id: "chimenea", nombre: "Chimenea de cartón", pieza: escenografia(chimenea), colocacion: { en: "libre", xCm: 88, yCm: 0, zCm: -165, giroGrados: 0 } },
      enPiso("grinch", "Grinch sentado con gorro de Santa", escenografia(grinch), 78, -118),
      { id: "medias-repisa", nombre: "Medias colgadas de la repisa", pieza: escenografia(colgadas), colocacion: { en: "libre", xCm: 88, yCm: 0, zCm: -165, giroGrados: 0 } },
      { id: "regalos", nombre: "Regalos de cartón", pieza: escenografia(regalos), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "medias", nombre: "Medias navideñas en el piso", pieza: escenografia(medias), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "fondo", nombre: "Paneles pintados, cuadro y luces", pieza: escenografia(fondo), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -199, giroGrados: 0 } },
      enPiso("tapete", "Tapete lila", escenografia(tapete({ anchoCm: 300, fondoCm: 170, hex: "#9a8cab" })), 40, -40),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 524 · Escenario Halloween
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1600 × 1067: la malla Link-O-Loon en damero de flores negras y naranjas (las flores se repiten cada 146 px; con
 * LOL-12 a 25 cm, eslabón de 36,75 cm, eso es 52 cm: 2,8 px/cm) de 225 × 225 cm contra la pared; la guirnalda orgánica
 * cromada (Silk Verde Menta publicado) que sube del montículo del piso por la izquierda, cruza arriba y acaba a la derecha,
 * con 2 negros en la esquina de arriba a la izquierda y 3 en la punta derecha; la torre de calderos (4 R-5 de patas, R-24
 * y R-18 aguamarina, dos R-18 violeta, con collares de R-5 cromados) y el ramo de 6 R-12 sobre su base de R-5 cromados.
 * Foto → mundo: x = (px − 690)/2,8, y = (810 − py)/2,8.
 */
const escena524 = (): Escena => {
  const malla: Pieza = { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 25, anchoCm: 225, altoCm: 225, patron: "damero", colores: ["080", "061"], union: { infladoCm: 10, codigo: "061" } };
  const g = (t: number, radioCm: number): PuntoGrosor => ({ t, radioCm });
  const guirnalda = organicoSuelto("guirnalda", "Guirnalda orgánica cromada verde menta", [{
    id: "guirnalda", nombre: "Guirnalda", tapas: { inicio: true, fin: true },
    puntos: [v(-164, 30, -132), v(-145, 36, -160), v(-139, 89, -176), v(-139, 146, -178), v(-129, 205, -180), v(-96, 237, -182), v(-46, 244, -182), v(4, 248, -182), v(57, 238, -182), v(104, 224, -182), v(139, 196, -182)],
    grosor: [g(0, 42), g(0.1, 32), g(0.2, 24), g(0.35, 24), g(0.45, 27), g(0.6, 28), g(0.85, 26), g(1, 18)],
    mezcla: mezcla({ "R-18": 0.15, "R-12": 0.5, "R-5": 0.35 }, { "R-12": 0.5, "R-5": 0.5 }),
  }], { colores: [color("826", 1)], semilla: 524, relleno: RELLENO_TUPIDO_5, pared: -210, inflados: { ...INFLADOS, "R-12": 28 } });
  const negro = globo(R("R-12", 28, "080"));
  const P0 = v(125, 0, -150);
  const sobreArriba = (id: string, nombre: string, pieza: Pieza, padreId: string, alto: number): NodoEscena =>
    ({ id, nombre, pieza, colocacion: { en: "sobre", padreId, puntoCm: v(0, alto, 0), normal: ARRIBA, giroGrados: 0 } });
  const collar = anillo(R("R-5", 11, "826"), 8);
  const base = racimoEsfera(38, "R-5", 12, ["826"], [1], 524);
  const ramo524 = ramo([R("R-12", 30, "931"), R("R-12", 30, "931"), R("R-12", 30, "981"), R("R-12", 30, "981"), R("R-12", 30, "080"), R("R-12", 30, "080")], 212, "#d4b04a", "#d4b04a",
    [{ impresoId: "2-caras-happy-halloween-noche-reflex-surtido", globos: [0, 1, 2, 3] }, { impresoId: "infinity-arana-metalink-fashion-negro", globos: [4, 5] }]);
  const letras = ["H", "A", "P", "P", "Y", "", "H", "A", "L", "L", "O", "W", "E", "E", "N"];
  const banderin524 = banderin({
    recorrido: { tipo: "recto", desde: v(-104, 0, 0), hasta: v(104, 0, 0) }, caidaCm: 43, cantidad: letras.length, forma: "rectangulo", anchoCm: 11, altoCm: 17,
    colores: letras.map((l) => (l ? "#f6f4ef" : "#f28c28")), motivos: letras.map((l) => (l ? { dibujo: "texto" as const, texto: l, hex: "#5a3a8a" } : { dibujo: "calabaza" as const })),
    cordon: "#e8742a", productoId: null, descripcion: "banderín de papel «Happy Halloween»",
  });
  const mesa: ElementoEscenografia[] = [
    caja(v(42, 40, -165), v(88, 80, 46), "#f7f7f5", "mate"), caja(v(42, 80.6, -165), v(92, 1.2, 50), "#161416", "tela"),
    caja(v(86.5, 55, -165), v(1.2, 50, 50), "#161416", "tela"), caja(v(24, 20, -125), v(118, 40, 34), "#f7f7f5", "mate"),
  ];
  const peluches: ElementoEscenografia[] = [
    ...aranaDeOropel(v(-12, 22, -100), 9), ...aranaDeOropel(v(-130, 96, -150), 5),
    // El gato de oropel: dos aros negros (cuerpo y cabeza) con un moño naranja.
    { forma: "panel", contorno: circulo(45, 16, 16, 16), huecos: [circulo(45, 16, 10, 10, 24, -1)], zCm: -104, grosorCm: 3, hex: "#141214", acabado: "lentejuelas" },
    { forma: "panel", contorno: circulo(43, 42, 11, 11), huecos: [circulo(43, 42, 6, 6, 24, -1)], zCm: -104, grosorCm: 3, hex: "#141214", acabado: "lentejuelas" },
    caja(v(44, 31, -100), v(10, 4, 2), "#f28c28", "satinado"),
  ];
  return {
    sala: sala(600, 420, 300, { piso: "#e8e7e2", paredes: "#efeee8", techo: "#f7f7f5" }),
    nodos: [
      { id: "malla", nombre: "Malla Link-O-Loon negra y naranja", pieza: malla, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } },
      guirnalda.nodo,
      apoyar("negro-1", "R-12 negro de la esquina (1)", negro, guirnalda.padre, v(-98, 262, -186), v(-0.2, 1, 0.15)),
      apoyar("negro-2", "R-12 negro de la esquina (2)", negro, guirnalda.padre, v(-78, 258, -186), v(0.1, 1, 0.15)),
      apoyar("negro-3", "R-12 negro de la punta (1)", negro, guirnalda.padre, v(111, 243, -186), v(0.3, 1, 0.15)),
      apoyar("negro-4", "R-12 negro de la punta (2)", negro, guirnalda.padre, v(136, 234, -190), v(1, 0.6, -0.2)),
      apoyar("negro-5", "R-12 negro de la punta (3)", negro, guirnalda.padre, v(146, 208, -190), v(1, 0, -0.2)),
      enPiso("torre", "Torre de calderos: patas de 4 R-5 aguamarina", columna("R-5", 11, 1, ["037"]), P0.x, P0.z),
      sobreArriba("caldero-cuerpo", "R-24 aguamarina del caldero", globo(R("R-24", 54, "037")), "torre", 30),
      sobreArriba("collar-1", "Collar de 8 R-5 cromados (abajo)", collar, "caldero-cuerpo", 30),
      sobreArriba("caldero-cuello", "R-18 aguamarina", globo(R("R-18", 38, "037")), "caldero-cuerpo", 30),
      sobreArriba("collar-2", "Collar de 8 R-5 cromados (medio)", collar, "caldero-cuello", 22),
      sobreArriba("caldero-violeta-1", "R-18 violeta (caldero de abajo)", globo(R("R-18", 36, "051")), "caldero-cuello", 22),
      sobreArriba("collar-3", "Collar de 8 R-5 cromados (arriba)", collar, "caldero-violeta-1", 22),
      sobreArriba("caldero-violeta-2", "R-18 violeta (caldero de arriba)", globo(R("R-18", 36, "051")), "caldero-violeta-1", 22),
      suelta("base-ramo", "Base de R-5 cromados del ramo", base, v(177, 19, -120)).nodo,
      { id: "ramo", nombre: "Ramo de helio Happy Halloween y Araña Metalink", pieza: ramo524, colocacion: { en: "libre", xCm: 177, yCm: 8, zCm: -120, giroGrados: 0 } },
      { id: "banderin", nombre: "Banderín «Happy Halloween»", pieza: banderin524, colocacion: { en: "libre", xCm: 0, yCm: 214, zCm: -190, giroGrados: 0 } },
      { id: "mesa", nombre: "Mesa blanca escalonada con mantel de telaraña", pieza: escenografia(mesa), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "platos", nombre: "Platos de calabaza", pieza: platos({ cantidad: 6, diametroCm: 22, hex: "#7e57c2", centro: "#f28c28", motivo: { dibujo: "calabaza" }, dePie: true, productoId: null, descripcion: "platos de Halloween" }), colocacion: { en: "libre", xCm: 20, yCm: 81, zCm: -175, giroGrados: 0 } },
      { id: "vasos", nombre: "Vasos con servilleta", pieza: vasos({ cantidad: 3, altoCm: 10, diametroCm: 7, hex: "#7e57c2", motivo: { dibujo: "calabaza" }, servilleta: "#b7e04a", productoId: null, descripcion: "vasos de Halloween" }), colocacion: { en: "libre", xCm: 50, yCm: 81, zCm: -160, giroGrados: 0 } },
      { id: "peluches", nombre: "Arañas y gato de oropel", pieza: escenografia(peluches), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      enPiso("tapete", "Tapete naranja", escenografia(tapete({ anchoCm: 500, fondoCm: 170, hex: "#c95a26" })), 15, -122),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 553 · Feliz cumpleaños Terra
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 714 × 634 con dominante cálida (se equilibró con la puerta blanca). Escala: el R-24 nude de la esquina mide 105 px
 * (≈ 55 cm: 1,9 px/cm); la puerta-panel, 165 × 460 px ≈ 0,87 × 2,4 m. Dos estructuras por tramos: el arco de la izquierda
 * (tramo terracota con dorados sobre la puerta y cascada durazno y nude con dorados que baja por la derecha de la puerta
 * hasta el piso, con el R-24 nude en la esquina) y la cascada de la derecha (café con dorados arriba, mostaza con dorados
 * abajo y un R-24 mostaza en el piso). El ramo de la izquierda (3 impresos Feliz Cumpleaños Terra y 2 dorados) tiene el
 * peso en un racimo dorado y blanco sobre un canasto; el de la derecha (mármol, mostaza y verde salvia) sale cortado.
 * Foto → mundo: x = (px − 360)/1,9, y = (610 − py)/1,9.
 */
const escena553 = (): Escena => {
  const INF553 = { ...INFLADOS, "R-12": 28 };
  const tubosA = [v(-166, 240, -168), v(-132, 268, -166), v(-84, 262, -164), v(-37, 258, -163), v(8, 250, -160), v(38, 214, -150), v(34, 165, -142), v(8, 128, -138), v(-18, 86, -134), v(-20, 40, -132), v(-16, 4, -132)];
  const armazonA = suelta("armazon-arco", "Armazón del arco terracota y durazno", escenografia(tubo(tubosA, 1.6, "#dedbd4")), v(0, 0, 0));
  const terracota = tramoDe(armazonA.padre, "tramo-terracota", "Arco: tramo terracota con dorados", [{
    id: "terracota", nombre: "Terracota", puntos: tubosA.slice(0, 5), grosor: grosor(42, 38), mezcla: mezcla({ "R-12": 0.75, "R-5": 0.25 }),
  }], { colores: [color("059", 0.72), color("970", 0.28, ["R-5"])], semilla: 5531, relleno: RELLENO_12, pared: -190, inflados: INF553 });
  const durazno = tramoDe(armazonA.padre, "tramo-durazno", "Arco: cascada durazno y nude con dorados", [{
    id: "durazno", nombre: "Durazno", puntos: tubosA.slice(4), tapas: { inicio: true, fin: false },
    grosor: [{ t: 0, radioCm: 44 }, { t: 0.3, radioCm: 42 }, { t: 0.5, radioCm: 30 }, { t: 0.75, radioCm: 22 }, { t: 1, radioCm: 20 }],
    mezcla: mezcla({ "R-18": 0.12, "R-12": 0.53, "R-9": 0.15, "R-5": 0.2 }, { "R-12": 0.6, "R-9": 0.2, "R-5": 0.2 }),
  }], { colores: [color("060", 0.4), color("661", 0.3), color("970", 0.18, ["R-5"]), color("023", 0.06, ["R-12"]), color("968", 0.06, ["R-12"])], semilla: 5532, relleno: RELLENO_12_9, pared: -190, inflados: INF553 });
  const tubosB = [v(150, 198, -150), v(122, 174, -145), v(106, 142, -140), v(118, 104, -138), v(116, 82, -136), v(104, 48, -130), v(126, 14, -125), v(170, 12, -120)];
  const armazonB = suelta("armazon-cascada", "Armazón de la cascada café y mostaza", escenografia(tubo(tubosB, 1.6, "#dedbd4")), v(0, 0, 0));
  const cafe = tramoDe(armazonB.padre, "tramo-cafe", "Cascada: tramo café con dorados", [{
    id: "cafe", nombre: "Café", puntos: tubosB.slice(0, 4), grosor: grosor(50, 38), mezcla: mezcla({ "R-18": 0.1, "R-12": 0.55, "R-9": 0.1, "R-5": 0.25 }),
  }], { colores: [color("074", 0.72), color("970", 0.28, ["R-5"])], semilla: 5533, relleno: RELLENO_12_9, pared: -190, inflados: INF553 });
  const mostaza = tramoDe(armazonB.padre, "tramo-mostaza", "Cascada: tramo mostaza con dorados", [{
    id: "mostaza", nombre: "Mostaza", puntos: tubosB.slice(3), grosor: grosor(40, 42), mezcla: mezcla({ "R-18": 0.12, "R-12": 0.63, "R-5": 0.25 }),
  }], { colores: [color("023", 0.75), color("970", 0.25, ["R-5"])], semilla: 5534, relleno: RELLENO_12_9, pared: -190, inflados: INF553 });
  const TERRA = "infinity-feliz-cumpleanos-terra-fashion-surtido";
  const ramoIzq = ramo([R("R-12", 30, "062"), R("R-12", 30, "023"), R("R-12", 30, "970"), R("R-12", 30, "062"), R("R-12", 30, "970")], 236, "#e8dcc4", "#c9a35c", [{ impresoId: TERRA, globos: [0, 1, 3] }]);
  const ramoDer = ramo([R("R-12", 30, "390"), R("R-12", 30, "023"), R("R-12", 30, "630")], 240, "#e8dcc4", "#c9a35c", [{ impresoId: "infinity-graffiti-marmol-fashion-transparente", globos: [0] }]);
  const MIMBRE = "#b8905e", BLANCO = "#f6f4f1";
  const pampa = (base: Vec3, puntas: Vec3[]): ElementoEscenografia[] => puntas.map((p) => tablon(base, p, 4, 0.6, "#c9a27a", "papel"));
  const puerta: ElementoEscenografia[] = [
    caja(v(0, 121, 0), v(87, 242, 5), BLANCO, "satinado"),
    ...[[60, 70], [160, 100]].map(([y, h]) => caja(v(0, y!, 2.8), v(64, h!, 0.6), "#eceae6", "satinado")),
    ...pampa(v(0, 162, 4), [v(-48, 170, 6), v(-44, 160, 6), v(-40, 176, 6), v(48, 170, 6), v(44, 160, 6), v(40, 176, 6)]),
    caja(v(0, 158, 5), v(14, 10, 2), "#e5c27a", "papel"),
  ];
  const silla: ElementoEscenografia[] = [
    { forma: "panel", contorno: circulo(0, 122, 84, 60, 28), zCm: -6, grosorCm: 4, hex: MIMBRE, acabado: "madera" },
    { forma: "panel", contorno: circulo(0, 118, 40, 32, 20), zCm: -1.6, grosorCm: 1, hex: "#a37a4c", acabado: "madera" },
    cilindro(v(0, 48, 12), 34, 10, MIMBRE, "madera"), cilindro(v(0, 0, 10), 26, 24, MIMBRE, "madera", 10), cilindro(v(0, 24, 10), 10, 24, MIMBRE, "madera", 30),
  ];
  const mesas: ElementoEscenografia[] = [
    cilindro(v(0, 92, 0), 32, 4, "#b07a46", "madera"), ...[-1, 1].flatMap((s) => [barra(v(s * 24, 0, -14), v(s * 22, 92, -12), 1, "#1b1b1b", "metal"), barra(v(s * 24, 0, 14), v(s * 22, 92, 12), 1, "#1b1b1b", "metal")]),
    cilindro(v(0, 96, -4), 9, 20, "#c8323a", "brillante"), cilindro(v(-14, 96, 8), 7, 6, "#f3efe7", "mate"),
    caja(v(-38, 25, 22), v(70, 50, 45), "#e4ecd8", "tela"), barra(v(-70, 0, 2), v(-70, 50, 2), 1, "#1b1b1b", "metal"),
  ];
  const fondo: ElementoEscenografia[] = [caja(v(175, 150, 0), v(90, 300, 2), "#ef9d66", "mate"), ...[-150, -75, 0, 75].map((x) => caja(v(x, 150, 1.2), v(0.6, 300, 0.6), "#c9a47c", "madera"))];
  return {
    sala: sala(440, 380, 340, { piso: "#efe8e1", paredes: "#e6c49c", techo: "#f6efe6" }),
    nodos: [
      armazonA.nodo, terracota.nodo, durazno.nodo,
      apoyar("r24-nude", "R-24 nude de la esquina", globo(R("R-24", 55, "661")), durazno.padre, v(28, 252, -150), v(0.3, 0.7, 0.9)),
      armazonB.nodo, cafe.nodo, mostaza.nodo,
      apoyar("r24-mostaza", "R-24 mostaza del piso", globo(R("R-24", 55, "023")), mostaza.padre, v(150, 28, -100), v(0.3, 0.1, 1)),
      suelta("racimo-canasto", "Racimo dorado y blanco del canasto", racimoEsfera(44, "R-9", 17, ["970", "405"], [0.6, 0.4], 553), v(-172, 59, -68)).nodo,
      { id: "ramo-izquierda", nombre: "Ramo Feliz Cumpleaños Terra", pieza: ramoIzq, colocacion: { en: "libre", xCm: -172, yCm: 45, zCm: -68, giroGrados: 0 } },
      { id: "ramo-derecha", nombre: "Ramo mármol, mostaza y salvia", pieza: ramoDer, colocacion: { en: "libre", xCm: 192, yCm: 2, zCm: -78, giroGrados: 0 } },
      { id: "canasto", nombre: "Canasto de mimbre", pieza: escenografia([cilindro(v(0, 0, 0), 20, 37, MIMBRE, "madera", 23)]), colocacion: { en: "libre", xCm: -172, yCm: 0, zCm: -68, giroGrados: 0 } },
      { id: "puerta", nombre: "Puerta-panel blanca con pampas", pieza: escenografia(puerta), colocacion: { en: "libre", xCm: -75, yCm: 0, zCm: -186, giroGrados: 0 } },
      { id: "pampas", nombre: "Pampas secas de la cascada", pieza: escenografia([...pampa(v(110, 180, -120), [v(80, 250, -118), v(95, 262, -118), v(112, 255, -118), v(70, 230, -118)]), ...pampa(v(130, 90, -110), [v(160, 120, -105), v(170, 100, -105), v(150, 130, -105)])]), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "silla", nombre: "Silla pavo real de mimbre", pieza: escenografia(silla), colocacion: { en: "libre", xCm: 74, yCm: 0, zCm: -112, giroGrados: 0 } },
      { id: "mesas", nombre: "Mesas auxiliares con la torta", pieza: escenografia(mesas), colocacion: { en: "libre", xCm: -5, yCm: 0, zCm: -82, giroGrados: 0 } },
      { id: "fondo", nombre: "Pared de madera y pared naranja", pieza: escenografia(fondo), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -189, giroGrados: 0 } },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 554 · Feliz día bigotes y padres
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 714 × 634: el aro metálico dorado mide 410 px; los pedestales blancos, 115 px de ancho y 220 de alto (≈ 1 m):
 * 2,2 px/cm, así que el aro mide 1,86 m. Sobre el aro, el orgánico por tramos: azul rey arriba a la izquierda, un gran
 * racimo mostaza por dentro, blanco con un R-18 arena alrededor del letrero dorado y azul Galaxy con plata cromada que
 * baja por la derecha hasta el piso. Abajo a la izquierda, el montículo de azul Galaxy, blanco, mostaza, plata y azul rey
 * con un mostaza de bigotes y un azul de «Feliz Día» con sombrero negro encima; el ramo de 7 impresos de bigotes tiene el
 * peso en el montículo y el de la derecha (7: terrazo azul, mostaza y plata) sobre el pedestal de la derecha.
 * Foto → mundo: x = (px − 357)/2,2, y = (600 − py)/2,2.
 */
const escena554 = (): Escena => {
  const ARO = { centro: v(8, 136, -168), radio: 93 };
  const aroPuntos = Array.from({ length: 41 }, (_, i) => mas(ARO.centro, v(ARO.radio * Math.cos((2 * Math.PI * i) / 40), ARO.radio * Math.sin((2 * Math.PI * i) / 40), 0)));
  const DORADO = "#c9a34a";
  const aro = suelta("aro", "Aro metálico dorado", escenografia([...tubo(aroPuntos, 1.2, DORADO, "metal"), barra(v(8, 0, -168), v(8, 43, -168), 1.2, DORADO, "metal"), cilindro(v(8, 0, -168), 22, 1.5, DORADO, "metal")]), v(0, 0, 0));
  const azul = tramoDe(aro.padre, "tramo-azul", "Aro: tramo azul rey", [{
    id: "azul", nombre: "Azul rey", puntos: [v(-53, 210, -162), v(-71, 192, -162), v(-78, 166, -162), v(-76, 143, -160)], grosor: grosor(26, 24), mezcla: mezcla({ "R-12": 0.6, "R-5": 0.4 }),
  }], { colores: [color("041", 1)], semilla: 5541, relleno: RELLENO_12_9, pared: -190 });
  const mostaza = tramoDe(aro.padre, "tramo-mostaza", "Aro: racimo mostaza", [{
    id: "mostaza", nombre: "Mostaza", puntos: [v(-28, 183, -150), v(-44, 162, -146), v(-53, 136, -146), v(-44, 118, -148)], grosor: grosor(40, 30), mezcla: mezcla({ "R-12": 0.5, "R-9": 0.2, "R-5": 0.3 }),
  }], { colores: [color("023", 1)], semilla: 5542, relleno: RELLENO_12_9, pared: -190 });
  const blanco = tramoDe(aro.padre, "tramo-blanco", "Aro: tramos blanco y arena", [
    { id: "blanco_arriba", nombre: "Blanco de arriba", puntos: [v(18, 180, -152), v(45, 166, -150)], grosor: grosor(20, 18), mezcla: mezcla({ "R-12": 0.5, "R-5": 0.5 }) },
    { id: "blanco_abajo", nombre: "Blanco de abajo", puntos: [v(-5, 123, -150), v(-26, 91, -146), v(-26, 68, -142)], grosor: grosor(26, 22), mezcla: mezcla({ "R-18": 0.12, "R-12": 0.5, "R-5": 0.38 }) },
  ], { colores: [color("005", 0.75), color("071", 0.25, ["R-18", "R-12"])], semilla: 5543, relleno: RELLENO_12_9, pared: -190 });
  const navy = tramoDe(aro.padre, "tramo-navy", "Aro: tramo azul Galaxy con plata", [
    { id: "navy", nombre: "Azul Galaxy", puntos: [v(52, 176, -165), v(38, 150, -162), v(33, 109, -162), v(42, 68, -162), v(33, 26, -162), v(30, 10, -162)], grosor: grosor(34, 28), mezcla: mezcla({ "R-18": 0.08, "R-12": 0.5, "R-9": 0.1, "R-5": 0.32 }) },
    { id: "navy_derecha", nombre: "Azul Galaxy y plata de la derecha", puntos: [v(60, 140, -166), v(88, 122, -168), v(105, 102, -170)], grosor: grosor(28, 25), mezcla: mezcla({ "R-12": 0.55, "R-9": 0.1, "R-5": 0.35 }) },
  ], { colores: [color("944", 0.75), color("981", 0.25)], semilla: 5544, relleno: RELLENO_12_9, pared: -190 });
  const monticulo = organicoSuelto("monticulo", "Montículo azul, blanco, mostaza y plata", [{
    id: "monticulo", nombre: "Montículo", puntos: [v(-153, 18, -125), v(-126, 36, -120), v(-90, 42, -115), v(-58, 35, -110), v(-40, 20, -105)], grosor: grosor(36, 30), mezcla: mezcla({ "R-12": 0.55, "R-9": 0.12, "R-5": 0.33 }),
  }], { colores: [color("944", 0.3), color("005", 0.2), color("023", 0.2), color("981", 0.2), color("041", 0.1)], semilla: 5545, relleno: RELLENO_12_9, pared: -190 });
  const BIGOTES = "infinity-feliz-dia-bigotes-fashion-surtido";
  const ramoIzq = ramo([R("R-12", 30, "940"), R("R-12", 30, "981"), R("R-12", 30, "390"), R("R-12", 30, "080"), R("R-12", 30, "041"), R("R-12", 30, "041"), R("R-12", 30, "390")], 234, "#dfe3ea", "#c9ccd2", [
    { impresoId: "2-caras-feliz-dia-bigotes-reflex-surtido", globos: [0, 1] }, { impresoId: "infinity-graffiti-cielo-fashion-transparente", globos: [2] },
    { impresoId: BIGOTES, globos: [3, 5] }, { impresoId: "infinity-bigotes-y-corbatines-fashion-transparente", globos: [6] },
  ]);
  const ramoDer = ramo([R("R-12", 30, "044"), R("R-12", 30, "023"), R("R-12", 30, "044"), R("R-12", 30, "023"), R("R-12", 30, "981"), R("R-12", 30, "981"), R("R-12", 30, "044")], 157, "#dfe3ea", "#c9ccd2", [
    { impresoId: "infinity-feliz-cumpleanos-terrazo-azul-fashion-surtido", globos: [0] }, { impresoId: "infinity-feliz-cumpleanos-terrazo-azul-fashion", globos: [2, 6] },
  ]);
  const azulBigotes = apoyar("bigotes-azul", "R-12 azul «Feliz Día» de bigotes", globo(R("R-12", 30, "041"), BIGOTES), monticulo.padre, v(-57, 50, -112), ARRIBA);
  const pedestal = (x: number, ancho: number, alto: number): ElementoEscenografia => caja(v(x, alto / 2, 0), v(ancho, alto, 40), "#f6f6f4", "mate");
  const pedestales: ElementoEscenografia[] = [pedestal(10, 36, 111), pedestal(71, 52, 100), pedestal(128, 52, 91), cilindro(v(71, 100, 0), 12, 4, "#2d6fd1", "satinado"), cilindro(v(71, 104, 0), 9, 20, "#f7f7f5", "mate")];
  const banderin554 = banderin({
    recorrido: { tipo: "recto", desde: v(-82, 10, 0), hasta: v(82, -10, 0) }, caidaCm: 12, cantidad: 7, forma: "triangulo", anchoCm: 20, altoCm: 26,
    colores: ["#2b2b2b", "#1f5fc8", "#2b2b2b", "#1f5fc8", "#2b2b2b", "#1f5fc8", "#2b2b2b"],
    motivos: [{ dibujo: "rayas", hex: "#f2f2f2" }, { dibujo: "texto", texto: "Feliz Día", hex: "#ffffff" }],
    cordon: "#2b2b2b", productoId: null, descripcion: "banderín de papel de bigotes «Feliz Día»",
  });
  const piso: ElementoEscenografia[] = [{ forma: "caja", centro: v(0, 0.3, 0), tamano: v(420, 0.6, 210), hex: "#2160c4", acabado: "tela", motivo: { dibujo: "lunares", hex: "#ffffff", cara: "arriba", escala: 0.4 } }];
  const bolsas: ElementoEscenografia[] = [
    { forma: "caja", centro: v(-66, 20, -78), tamano: v(28, 40, 10), hex: "#4c8fe0", acabado: "papel", motivo: { dibujo: "rayas", hex: "#cfe86a" } },
    { forma: "caja", centro: v(-40, 16, -68), tamano: v(24, 32, 9), hex: "#5ab0e8", acabado: "papel", motivo: { dibujo: "rayas", hex: "#1d3f8c" } },
  ];
  return {
    sala: sala(420, 380, 300, { piso: "#d8d4cf", paredes: "#e8b994", techo: "#f6efe6" }),
    nodos: [
      aro.nodo, azul.nodo, mostaza.nodo, blanco.nodo, navy.nodo,
      monticulo.nodo,
      apoyar("bigotes-mostaza", "R-12 mostaza de bigotes", globo(R("R-12", 30, "023")), monticulo.padre, v(-131, 50, -122), ARRIBA),
      azulBigotes,
      { id: "sombrero", nombre: "Sombrero negro (R-9)", pieza: globo(R("R-9", 18, "080")), colocacion: { en: "sobre", padreId: "bigotes-azul", puntoCm: v(0, 20, 0), normal: ARRIBA, giroGrados: 0 } },
      { id: "ramo-izquierda", nombre: "Ramo de bigotes «Feliz Día»", pieza: ramoIzq, colocacion: { en: "libre", xCm: -115, yCm: 25, zCm: -116, giroGrados: 0 } },
      { id: "ramo-derecha", nombre: "Ramo terrazo azul, mostaza y plata", pieza: ramoDer, colocacion: { en: "libre", xCm: 136, yCm: 91, zCm: -100, giroGrados: 0 } },
      { id: "letrero", nombre: "Letrero dorado «Happy Birthday»", pieza: letrero({ forma: "circulo", anchoCm: 44, altoCm: 44, hex: "#d6b66a", motivo: { dibujo: "texto", texto: "Happy Birthday", hex: "#ffffff" }, apoyo: "colgado", productoId: null, descripcion: "letrero de acrílico dorado" }), colocacion: { en: "libre", xCm: 7, yCm: 129, zCm: -140, giroGrados: 0 } },
      { id: "pedestales", nombre: "Pedestales blancos con la torta", pieza: escenografia(pedestales), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -96, giroGrados: 0 } },
      { id: "banderin", nombre: "Banderín de bigotes «Feliz Día»", pieza: banderin554, colocacion: { en: "libre", xCm: 74, yCm: 100, zCm: -75, giroGrados: 0 } },
      { id: "bolsas", nombre: "Bolsas de regalo de rayas", pieza: escenografia(bolsas), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "mantel", nombre: "Mantel azul de lunares en el piso", pieza: escenografia(piso), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -40, giroGrados: 0 } },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 639 · Feliz Año
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 714 × 634: los R-12 cromados del arco miden ~48 px (≈ 25 cm: 1,9 px/cm) y la cortina de flecos dorada, 350 px ≈
 * 1,85 m (dos cortinas de 1 m). Arco asimétrico de ~2,9 m por tramos: la esquina de la izquierda (plata cromada, negro y
 * dorado), el tramo gris con dorados, el arena con dorados y la bajada de la derecha hasta el piso (plata, negro, gris,
 * arena y dorado, con R-18 y R-24). El ramo de la izquierda (el R-24 negro «Feliz Año», un dorado y un plata «Feliz Año»,
 * un satín plata y 3 negros de estrellas) tiene el peso en el racimo del piso, que lleva los R-5 Estrellas Reflex Plata.
 * Foto → mundo: x = (px − 370)/1,9, y = (565 − py)/1,9.
 */
const escena639 = (): Escena => {
  const tubos = [v(-184, 229, -172), v(-158, 258, -172), v(-116, 266, -170), v(-86, 252, -170), v(-80, 240, -170), v(-53, 258, -170), v(-28, 252, -170), v(-20, 236, -170), v(0, 252, -170), v(22, 240, -170), v(42, 248, -172), v(79, 258, -172), v(114, 226, -170), v(132, 178, -165), v(142, 124, -160), v(147, 72, -155), v(142, 22, -150), v(132, 4, -150)];
  const armazon = suelta("armazon", "Armazón del arco Feliz Año", escenografia(tubo(tubos, 1.6, "#d9d6d0")), v(0, 0, 0));
  const dorado5 = (peso: number) => color("970", peso, ["R-5"]);
  const izquierda = tramoDe(armazon.padre, "tramo-izquierda", "Arco: esquina plata, negra y dorada", [{
    id: "izquierda", nombre: "Esquina", puntos: tubos.slice(0, 4), grosor: grosor(36, 36), mezcla: mezcla({ "R-12": 0.5, "R-5": 0.5 }),
  }], { colores: [color("981", 0.45), color("580", 0.3), dorado5(0.25)], semilla: 6391, relleno: RELLENO_12_9, pared: -200 });
  const gris = tramoDe(armazon.padre, "tramo-gris", "Arco: tramo gris con dorados", [{
    id: "gris", nombre: "Gris", puntos: tubos.slice(4, 7), grosor: grosor(34, 32), mezcla: mezcla({ "R-12": 0.6, "R-9": 0.1, "R-5": 0.3 }),
  }], { colores: [color("081", 0.75), dorado5(0.25)], semilla: 6392, relleno: RELLENO_12_9, pared: -200 });
  const arena = tramoDe(armazon.padre, "tramo-arena", "Arco: tramo arena con dorados", [{
    id: "arena", nombre: "Arena", puntos: tubos.slice(7, 10), grosor: grosor(32, 32), mezcla: mezcla({ "R-12": 0.55, "R-9": 0.15, "R-5": 0.3 }),
  }], { colores: [color("071", 0.75), dorado5(0.25)], semilla: 6393, relleno: RELLENO_12_9, pared: -200 });
  const derecha = tramoDe(armazon.padre, "tramo-derecha", "Arco: bajada de la derecha", [{
    id: "derecha", nombre: "Bajada", puntos: tubos.slice(10), tapas: { inicio: true, fin: false },
    grosor: [{ t: 0, radioCm: 38 }, { t: 0.3, radioCm: 40 }, { t: 0.55, radioCm: 48 }, { t: 0.8, radioCm: 55 }, { t: 1, radioCm: 48 }],
    mezcla: mezcla({ "R-12": 0.55, "R-5": 0.45 }, { "R-24": 0.08, "R-18": 0.12, "R-12": 0.45, "R-9": 0.08, "R-5": 0.27 }),
  }], { colores: [color("981", 0.35), color("580", 0.2), dorado5(0.15), color("081", 0.12), color("071", 0.18)], semilla: 6394, relleno: RELLENO_12_9, pared: -200 });
  const ESTRELLAS = "infinity-estrellas-reflex-plata";
  const racimo = organicoSuelto("racimo-ramo", "Racimo del piso con estrellas plata", [{
    id: "racimo", nombre: "Racimo", puntos: [v(-140, 22, -108), v(-132, 48, -110)], grosor: grosor(28, 22), mezcla: mezcla({ "R-12": 0.45, "R-5": 0.55 }),
  }], { colores: [color("970", 0.25, ["R-12"]), color("071", 0.25), color("981", 0.25, ["R-5"]), color("580", 0.12, ["R-5"]), color("081", 0.13, ["R-5"])], semilla: 6395, relleno: RELLENO_12_9, pared: -200 });
  const racimoNodo: NodoEscena = { ...racimo.nodo, pieza: { ...racimo.nodo.pieza, impresos: [{ impresoId: ESTRELLAS, codigo: "981" }] } };
  const ramo639 = ramo([R("R-24", 58, "080"), R("R-12", 30, "970"), R("R-12", 30, "981"), R("R-12", 30, "481"), R("R-12", 30, "080"), R("R-12", 30, "080"), R("R-12", 30, "080")], 230, "#d9c48a", "#c9a34a", [
    { impresoId: "infinity-feliz-ano-estrellas-fashion-negro", globos: [0] }, { impresoId: "2-caras-feliz-ano-estrellas-reflex-surtido", globos: [1, 2] },
    { impresoId: "infinity-feliz-ano-estrellas-satin-y-metal-surtido-deluxe", globos: [3, 4, 5, 6] },
  ]);
  const BLANCO = "#f4f4f2", VIDRIO = "#e3ebee";
  const cortina: ElementoEscenografia[] = [caja(v(0, 109, 0), v(184, 218, 1.5), "#d8b14a", "lentejuelas"), ...Array.from({ length: 23 }, (_, k) => caja(v(-88 + k * 8, 109, 1.2), v(0.8, 218, 0.4), "#f0d27a", "metal"))];
  const mesas: ElementoEscenografia[] = [
    ...mesaMetalica(55, 45, 110, BLANCO, VIDRIO).map((e) => (e.forma === "caja" ? { ...e, centro: mas(e.centro, v(0, 0, -120)) } : e)),
    ...mesaMetalica(50, 40, 60, BLANCO, VIDRIO).map((e) => (e.forma === "caja" ? { ...e, centro: mas(e.centro, v(-70, 0, -92)) } : e)),
    ...mesaMetalica(75, 50, 80, BLANCO, VIDRIO).map((e) => (e.forma === "caja" ? { ...e, centro: mas(e.centro, v(78, 0, -92)) } : e)),
    ...bola(v(0, 126, -120), 12, "#f7f5f0", "tela"), cilindro(v(-70, 60, -92), 12, 1.5, "#d6b04c", "metal"), cilindro(v(78, 80, -92), 14, 1.5, "#cfd2d6", "metal"),
  ];
  return {
    sala: sala(460, 400, 320, { piso: "#d9cfc4", paredes: "#dcd8d1", techo: "#f4f2ee" }),
    nodos: [
      armazon.nodo, izquierda.nodo, gris.nodo, arena.nodo, derecha.nodo,
      racimoNodo,
      { id: "ramo", nombre: "Ramo Feliz Año negro y dorado", pieza: ramo639, colocacion: { en: "libre", xCm: -134, yCm: 22, zCm: -108, giroGrados: 0 } },
      { id: "cortina", nombre: "Cortina de flecos dorada", pieza: escenografia(cortina), colocacion: { en: "libre", xCm: -44, yCm: 0, zCm: -192, giroGrados: 0 } },
      { id: "letrero", nombre: "Letrero «Feliz Año»", pieza: letrero({ forma: "rectangulo", anchoCm: 145, altoCm: 28, hex: "#1d1d1f", motivo: { dibujo: "texto", texto: "Feliz Año", hex: "#d9b45a" }, apoyo: "colgado", productoId: null, descripcion: "letrero negro y dorado" }), colocacion: { en: "libre", xCm: -40, yCm: 179, zCm: -188, giroGrados: 0 } },
      { id: "mesas", nombre: "Mesas de marco blanco y vidrio", pieza: escenografia(mesas), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 650 · Halloween (showroom)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000 (fondo recortado), la misma del preset «Halloween: marco orgánico con mesas»: 1 px ≈ 0,385 cm. Cuatro
 * racimos orgánicos (arriba a la izquierda, el que baja por la derecha y los dos montículos del piso) en los colores
 * publicados —Neón Verde, Fashion Naranja, Neón Naranja (el amarillo anaranjado), Durazno y Reflex Violeta (los chiquitos
 * cromados)—, con 6 pares de ojos saltones blancos; 2 manos de T-260 Neón Verde sobre el marco ondulado verde con su
 * pared de lentejuelas negra; el ramo de 11 impresos Happy Halloween con el peso en la calabaza de dulces; dos mesas
 * cilíndricas negras, el tapete naranja, las arañas y el gato de oropel. Foto → mundo: x = (px − 500)·0,385,
 * y = (860 − py)·0,385.
 */
const escena650 = (): Escena => {
  const arriba = mezcla({ "R-18": 0.18, "R-12": 0.57, "R-9": 0.25 }, { "R-18": 0.12, "R-12": 0.55, "R-9": 0.33 });
  const abajo = mezcla({ "R-18": 0.22, "R-12": 0.55, "R-9": 0.23 }, { "R-18": 0.15, "R-12": 0.55, "R-9": 0.3 });
  const colores: ColorOrganico[] = [color("230", 20), color("061", 22), color("261", 18), color("060", 16), color("951", 24, ["R-5", "R-12"])];
  const p = (x: number, y: number, z: number) => v(x, y, z);
  const racimo = (id: string, nombre: string, puntos: Vec3[], g: [number, number], m: PuntoMezcla[], semilla: number) =>
    organicoSuelto(id, nombre, [{ id: id.replace(/-/g, "_"), nombre, puntos, grosor: grosor(g[0], g[1]), mezcla: m }], { colores, semilla, inflados: { "R-18": 36, "R-12": 26, "R-9": 18, "R-5": 11 }, relleno: RELLENO_TUPIDO_5, pared: -201 });
  const ai = racimo("racimo-arriba-izquierda", "Racimo de arriba a la izquierda", [p(-110, 205, -158), p(-102, 242, -158), p(-73, 260, -158), p(-50, 250, -158)], [34, 30], arriba, 6501);
  const ad = racimo("racimo-arriba-derecha", "Racimo que baja por la derecha", [p(38, 227, -158), p(77, 248, -158), p(112, 222, -158), p(127, 196, -158), p(119, 176, -158)], [34, 28], arriba, 6502);
  const bi = racimo("racimo-abajo-izquierda", "Montículo de abajo a la izquierda", [p(-142, 30, -146), p(-119, 50, -146), p(-85, 62, -146), p(-64, 38, -146)], [36, 30], abajo, 6503);
  const bd = racimo("racimo-abajo-derecha", "Montículo de abajo a la derecha", [p(73, 30, -146), p(85, 69, -146), p(119, 85, -146), p(140, 58, -146), p(135, 30, -146)], [34, 32], abajo, 6504);
  const OJO: EstiloOjo = { iris: null, pupila: { hex: "#2b2a33", proporcion: 0.46 }, brillo: true, venas: null };
  const ojos = deco({ tipo: "racimo_ojos", propiedades: { ojos: [R("R-9", 15, "005"), R("R-5", 11, "005")], estilo: OJO } });
  const mano = (giroGrados: number) => deco({ tipo: "mano", propiedades: { formatoId: "T-260", grosorCm: 4.5, codigo: "230", dedos: 5, largoDedoCm: 24, aberturaGrados: 6, garra: true, giroGrados } });
  const ramo650 = ramo(["981", "061", "080", "031", "080", "061", "931", "031", "061", "061", "080"].map((c) => R("R-12", 28, c)), 280, "#e0571f", "#e8681e", [
    { impresoId: "2-caras-happy-halloween-noche-reflex-surtido", globos: [0, 6] }, { impresoId: "2-caras-happy-halloween-fashion-surtido-negro-naranja", globos: [1, 5, 8, 9] },
    { impresoId: "infinity-happy-halloween-friends-fashion-negro", globos: [2, 4, 10] }, { impresoId: "infinity-happy-halloween-noche-fashion-surtido", globos: [3, 7] },
  ]);
  const MARCO_Z = -205;
  const banderin650 = banderin({
    recorrido: { tipo: "recto", desde: v(-62, 0, 0), hasta: v(62, 0, 0) }, caidaCm: 10, cantidad: 7, forma: "circulo", anchoCm: 13, altoCm: 13,
    colores: ["#f6f3ee", "#f28c28", "#f6f3ee", "#7e57c2", "#f6f3ee", "#f28c28", "#f6f3ee"], motivos: [{ dibujo: "fantasma" }, { dibujo: "calabaza" }, { dibujo: "calavera" }],
    cordon: "#1b1b1b", productoId: null, descripcion: "guirnalda de papel de fantasmitas",
  });
  const peluches: ElementoEscenografia[] = [
    ...aranaDeOropel(v(-80, 126, -198), 6), ...aranaDeOropel(v(75, 153, -198), 7),
    { forma: "panel", contorno: circulo(-112, 100, 13, 13), huecos: [circulo(-112, 100, 8, 8, 24, -1)], zCm: -196, grosorCm: 3, hex: "#141214", acabado: "lentejuelas" },
    { forma: "panel", contorno: circulo(-108, 122, 9, 9), huecos: [circulo(-108, 122, 5, 5, 24, -1)], zCm: -196, grosorCm: 3, hex: "#141214", acabado: "lentejuelas" },
    // La calabaza de dulces donde va el peso del ramo.
    cilindro(v(-150, 0, -105), 11, 15, "#f07a1a", "brillante", 13),
  ];
  return {
    sala: sala(520, 420, 320, { piso: "#d9d2ca", paredes: "#ece9ef", techo: "#fbfaf8" }),
    nodos: [
      ai.nodo, ad.nodo, bi.nodo, bd.nodo,
      apoyar("ojos-1", "Ojos saltones (arriba a la izquierda)", ojos, ai.padre, v(-75, 236, -120), AL_FRENTE),
      apoyar("ojos-2", "Ojos saltones (arriba a la derecha)", ojos, ad.padre, v(84, 230, -120), AL_FRENTE),
      apoyar("ojos-3", "Ojos saltones (lado derecho)", ojos, ad.padre, v(125, 177, -120), AL_FRENTE),
      apoyar("ojos-4", "Ojos saltones (abajo a la izquierda)", ojos, bi.padre, v(-120, 55, -100), AL_FRENTE),
      apoyar("ojos-5", "Ojos saltones (abajo a la derecha)", ojos, bd.padre, v(126, 79, -100), AL_FRENTE),
      apoyar("ojos-6", "Ojos saltones (abajo a la derecha, abajo)", ojos, bd.padre, v(133, 46, -100), AL_FRENTE),
      { id: "marco", nombre: "Marco verde ondulado y lentejuelas negras", pieza: escenografia(fondoMarcoOndulado({ anchoCm: 240, altoCm: 245, bandaCm: 42, bandaArribaCm: 40, capas: ["#4f9e7b", "#8fcab5"], lentejuelas: "#1d1c21" })), colocacion: { en: "piso", xCm: 0, zCm: MARCO_Z, giroGrados: 0 } },
      { id: "mano-1", nombre: "Mano verde neón (arriba)", pieza: mano(-135), colocacion: { en: "libre", xCm: -37, yCm: 208, zCm: -199.5, giroGrados: 0 } },
      { id: "mano-2", nombre: "Mano verde neón (lado izquierdo)", pieza: mano(135), colocacion: { en: "libre", xCm: -80, yCm: 155, zCm: -199.5, giroGrados: 0 } },
      { id: "ramo", nombre: "Ramo de helio Happy Halloween", pieza: ramo650, colocacion: { en: "libre", xCm: -150, yCm: 2, zCm: -105, giroGrados: 0 } },
      { id: "guirnalda-papel", nombre: "Guirnalda de papel de fantasmitas", pieza: banderin650, colocacion: { en: "libre", xCm: 0, yCm: 200, zCm: -197, giroGrados: 0 } },
      { id: "peluches", nombre: "Arañas y gato de oropel y calabaza de dulces", pieza: escenografia(peluches), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      enPiso("tapete", "Tapete naranja con encaje negro", escenografia(tapete({ anchoCm: 330, fondoCm: 125, hex: "#e35a40", borde: { hex: "#1a1414", cm: 6 } })), 0, -128),
      enPiso("mesa-baja", "Mesa cilíndrica negra baja", escenografia(mesaCilindrica({ diametroCm: 62, altoCm: 62, hex: "#141012" })), -28, -105),
      enPiso("mesa-alta", "Mesa cilíndrica negra alta", escenografia(mesaCilindrica({ diametroCm: 70, altoCm: 84, hex: "#141012" })), 34, -150),
      { id: "platos", nombre: "Platos naranja y lila", pieza: platos({ cantidad: 5, diametroCm: 22, hex: "#f28c28", centro: "#7e57c2", motivo: { dibujo: "calabaza" }, dePie: true, productoId: null, descripcion: "platos de Halloween" }), colocacion: { en: "libre", xCm: 34, yCm: 84, zCm: -160, giroGrados: 0 } },
      { id: "vasos", nombre: "Vasos lila con servilleta verde", pieza: vasos({ cantidad: 3, altoCm: 10, diametroCm: 7, hex: "#9b7fd6", servilleta: "#b7e04a", productoId: null, descripcion: "vasos de Halloween" }), colocacion: { en: "libre", xCm: -28, yCm: 62, zCm: -105, giroGrados: 0 } },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 794 · Ocasiones especiales Reflex Luxury
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1080 × 1080: los R-24 cromados de arriba miden ~165 px (≈ 55 cm: 3 px/cm en el plano del fondo); el panel de
 * lentejuelas plata, 660 px ≈ 2,2 m. Marco por tramos alrededor del panel: la esquina izquierda Reflex Champaña con algo
 * de dorado, el centro café cromado (el chocolate de la foto: Fashion Café, el más cercano), arena a la derecha de arriba,
 * la pata derecha café y champaña con la flor café de centro dorado entre plumas y cuernos dorados, y el pie izquierdo
 * café y champaña. Dos ramos (7 y 6) con el peso en racimitos café. Foto → mundo: x = (px − 540)/3, y = (915 − py)/3.
 */
const escena794 = (): Escena => {
  const tubos = [v(-150, 10, -150), v(-157, 62, -150), v(-158, 120, -156), v(-160, 180, -160), v(-150, 235, -160), v(-125, 262, -160), v(-95, 255, -160), v(-75, 235, -160), v(-80, 262, -162), v(-48, 262, -160), v(-34, 225, -158), v(-44, 195, -156), v(5, 240, -160), v(36, 258, -162), v(55, 226, -160), v(18, 205, -156), v(78, 198, -155), v(86, 150, -152), v(92, 105, -150), v(110, 52, -148), v(122, 10, -146)];
  const armazon = suelta("armazon", "Armazón del marco Reflex Luxury", escenografia(tubo(tubos, 1.6, "#d4ccc2")), v(0, 0, 0));
  const g = (t: number, radioCm: number): PuntoGrosor => ({ t, radioCm });
  const champana = tramoDe(armazon.padre, "tramo-champana", "Marco: esquina champaña", [{
    id: "champana", nombre: "Champaña", puntos: tubos.slice(2, 8), grosor: [g(0, 42), g(0.4, 50), g(0.7, 55), g(1, 42)], mezcla: mezcla({ "R-24": 0.1, "R-12": 0.45, "R-5": 0.45 }),
  }], { colores: [color("971", 0.9), color("970", 0.1, ["R-12"])], semilla: 7941, relleno: RELLENO_12, pared: -190 });
  const cafe = tramoDe(armazon.padre, "tramo-cafe", "Marco: centro café", [{
    id: "cafe", nombre: "Café", puntos: tubos.slice(8, 12), grosor: grosor(48, 40), mezcla: mezcla({ "R-24": 0.12, "R-12": 0.5, "R-5": 0.38 }),
  }], { colores: [color("074", 0.85), color("971", 0.15, ["R-5"])], semilla: 7942, relleno: RELLENO_12_9, pared: -190 });
  const arena = tramoDe(armazon.padre, "tramo-arena", "Marco: arena de arriba a la derecha", [{
    id: "arena", nombre: "Arena", puntos: tubos.slice(12, 16), grosor: grosor(42, 36), mezcla: mezcla({ "R-24": 0.1, "R-12": 0.5, "R-5": 0.4 }),
  }], { colores: [color("071", 1)], semilla: 7943, relleno: RELLENO_12_9, pared: -190 });
  const pataDerecha = tramoDe(armazon.padre, "tramo-pata-derecha", "Marco: pata derecha café y champaña", [{
    id: "pata_derecha", nombre: "Pata derecha", puntos: tubos.slice(16), tapas: { inicio: true, fin: false }, grosor: [g(0, 44), g(0.5, 50), g(1, 55)],
    mezcla: mezcla({ "R-24": 0.06, "R-18": 0.1, "R-12": 0.5, "R-5": 0.34 }),
  }], { colores: [color("074", 0.5), color("971", 0.4), color("071", 0.1)], semilla: 7944, relleno: RELLENO_12_9, pared: -190 });
  const pieIzquierdo = tramoDe(armazon.padre, "tramo-pie-izquierdo", "Marco: pie izquierdo café y champaña", [{
    id: "pie_izquierdo", nombre: "Pie izquierdo", puntos: [tubos[2]!, tubos[1]!, tubos[0]!], tapas: { inicio: true, fin: false }, grosor: grosor(46, 50), mezcla: mezcla({ "R-12": 0.6, "R-5": 0.4 }),
  }], { colores: [color("074", 0.6), color("971", 0.4)], semilla: 7945, relleno: RELLENO_12_9, pared: -190 });
  const florCafe = deco(flor({ petalos: { ...R("R-12", 27, "074"), cantidad: 6, aperturaGrados: 15, giroGrados: 0 }, centro: { ...R("R-5", 10, "970"), cantidad: 3 } }));
  const ramoIzq = ramo([R("R-12", 30, "971"), R("R-12", 30, "971"), R("R-12", 30, "970"), R("R-12", 30, "390"), R("R-12", 30, "971"), R("R-12", 30, "970"), R("R-12", 30, "971")], 185, "#f4f1ea", "#f4f1ea", [{ impresoId: "infinity-confetti-dorado-fashion-transparente", globos: [3] }]);
  const ramoDer = ramo([R("R-12", 30, "970"), R("R-12", 30, "970"), R("R-12", 30, "971"), R("R-12", 30, "970"), R("R-12", 30, "971"), R("R-12", 30, "071")], 205, "#f4f1ea", "#f4f1ea");
  const racimito = racimoEsfera(34, "R-5", 11, ["074"], [1], 794);
  const CREMA = "#efe6cb", ORO = "#c9a13c";
  const mesa: ElementoEscenografia[] = [
    caja(v(0, 74, 0), v(90, 3, 90), CREMA, "brillante"), cilindro(v(0, 6, 0), 6, 68, CREMA, "madera", 5), cilindro(v(0, 0, 0), 26, 6, CREMA, "madera", 8),
    cilindro(v(0, 75.5, 0), 12, 3, ORO, "metal"), cilindro(v(0, 78.5, 0), 3, 8, ORO, "metal"), cilindro(v(0, 86.5, 0), 13, 22, "#f7f5f0", "mate"), cilindro(v(0, 104, 0), 13.4, 4, "#4a2c18", "brillante"),
  ];
  const silla = (x: number): ElementoEscenografia[] => [
    { forma: "panel", contorno: circulo(x, 95, 20, 30, 20), zCm: -22, grosorCm: 4, hex: "#f6f4f0", acabado: "tela" },
    caja(v(x, 46, 0), v(46, 8, 44), "#f6f4f0", "tela"),
    ...[-1, 1].flatMap((s) => [barra(v(x + s * 20, 0, 18), v(x + s * 21, 42, 18), 1.2, ORO, "metal"), barra(v(x + s * 20, 0, -18), v(x + s * 19, 92, -20), 1.2, ORO, "metal")]),
  ];
  const plumas: ElementoEscenografia[] = [
    ...[[60, 300], [70, 320], [105, 315], [125, 300], [130, 270], [50, 260], [40, 225], [120, 190], [105, 160]].map(([x, y]) => tablon(v(83, 217, -110), v(x!, y!, -112), 9, 0.8, "#f3eee4", "tela")),
    // Los dos cuernos dorados trenzados alrededor de la flor.
    tablon(v(25, 285, -115), v(70, 238, -112), 9, 7, ORO, "metal"), tablon(v(145, 274, -115), v(98, 240, -112), 9, 7, ORO, "metal"),
  ];
  return {
    sala: sala(440, 380, 340, { piso: "#cfc6bc", paredes: "#d9dccf", techo: "#f1efe9" }),
    nodos: [
      armazon.nodo, champana.nodo, cafe.nodo, arena.nodo, pataDerecha.nodo, pieIzquierdo.nodo,
      apoyar("flor-cafe", "Flor café con centro dorado", florCafe, pataDerecha.padre, v(83, 217, -200), AL_FRENTE),
      suelta("racimito-izquierda", "Racimito café del ramo izquierdo", racimito, v(-140, 17, -50)).nodo,
      { id: "ramo-izquierda", nombre: "Ramo champaña y dorado (izquierda)", pieza: ramoIzq, colocacion: { en: "libre", xCm: -140, yCm: 8, zCm: -50, giroGrados: 0 } },
      suelta("racimito-derecha", "Racimito café del ramo derecho", racimito, v(147, 17, -50)).nodo,
      { id: "ramo-derecha", nombre: "Ramo dorado y champaña (derecha)", pieza: ramoDer, colocacion: { en: "libre", xCm: 147, yCm: 8, zCm: -50, giroGrados: 0 } },
      { id: "panel", nombre: "Panel de lentejuelas plata", pieza: escenografia([paredLentejuelas({ anchoCm: 220, altoCm: 190, hex: "#d9d4ce" })]), colocacion: { en: "libre", xCm: -3, yCm: 0, zCm: -188, giroGrados: 0 } },
      { id: "mesa", nombre: "Mesa de pedestal con la torta", pieza: escenografia(mesa), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -95, giroGrados: 0 } },
      { id: "sillas", nombre: "Dos sillas blancas de patas doradas", pieza: escenografia([...silla(-72), ...silla(72)]), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -80, giroGrados: 0 } },
      { id: "plumas", nombre: "Plumas blancas y cuernos dorados", pieza: escenografia(plumas), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 948 · Tropical Sunset
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: los pétalos amarillos (R-12 a ~26 cm) miden ~75 px y la mesa alta de patas de horquilla, ~265 px
 * (≈ 1 m): 2,8 px/cm. Dos bases altas de R-24, R-18 y R-12 Naranja Cobrizo (1,6 m) a los lados; de ellas sube el aro
 * de bejucos de T-260 (los publicados, Reflex Verde Lima) con un racimo cobrizo arriba; 15 flores grandes (7 amarillas
 * de 5 pétalos Amarillo Miel con centro cobrizo y 8 de 5 pétalos Orquídea Morada con centro amarillo), 12 hojas de
 * burbujas de T-260, 8 racimitos de bayas de R-5 y 5 florecitas de 3 pétalos en el pasto. El letrero de neón «Let's
 * Party», la mesa alta y el pasto son escenografía. Foto → mundo: x = (px − 470)/2,8, y = (835 − py)/2,8.
 */
const escena948 = (): Escena => {
  const INF948 = { "R-24": 50, "R-18": 40, "R-12": 28, "R-9": 20, "R-5": 12 };
  const base = (id: string, nombre: string, puntos: Vec3[], semilla: number) => organicoSuelto(id, nombre, [{
    id: id.replace(/-/g, "_"), nombre, puntos, tapas: { inicio: false, fin: true }, grosor: [{ t: 0, radioCm: 58 }, { t: 0.5, radioCm: 52 }, { t: 1, radioCm: 42 }],
    mezcla: mezcla({ "R-24": 0.3, "R-18": 0.4, "R-12": 0.3 }, { "R-18": 0.3, "R-12": 0.6, "R-9": 0.1 }),
  }], { colores: [color("062", 1)], semilla, relleno: RELLENO_12, pared: -200, inflados: INF948 });
  const baseIzq = base("base-izquierda", "Base cobriza de la izquierda", [v(-80, 12, -150), v(-82, 66, -154), v(-79, 120, -158), v(-68, 148, -160)], 9481);
  const baseDer = base("base-derecha", "Base cobriza de la derecha", [v(79, 10, -150), v(77, 66, -154), v(75, 120, -158), v(64, 148, -160)], 9482);
  const aroPuntos = [v(-68, 155, -176), v(-82, 209, -178), v(-79, 252, -180), v(-50, 277, -182), v(0, 286, -182), v(50, 277, -182), v(82, 252, -180), v(89, 209, -178), v(68, 159, -176)];
  const aro = suelta("aro", "Aro de bejucos (armazón)", escenografia(tubo(aroPuntos, 2, "#7f9a6e")), v(0, 0, 0));
  const racimoArriba = tramoDe(aro.padre, "racimo-arriba", "Aro: racimo cobrizo de arriba", [{
    id: "arriba", nombre: "Racimo de arriba", puntos: [v(-50, 262, -176), v(-18, 272, -176), v(18, 276, -176), v(54, 266, -176), v(75, 248, -176)], grosor: grosor(32, 26),
    mezcla: mezcla({ "R-18": 0.1, "R-12": 0.5, "R-5": 0.4 }),
  }], { colores: [color("062", 1)], semilla: 9483, relleno: RELLENO_12_9, pared: -200, inflados: INF948 });
  const VERDE = { formatoId: "T-260", grosorCm: 4, codigo: "931" };
  const nodos: NodoEscena[] = [baseIzq.nodo, baseDer.nodo, aro.nodo, racimoArriba.nodo];
  // Los bejucos: resortes de T-260 de punto a punto del aro (salvo bajo el racimo de arriba), delante del tubo.
  const tramosBejuco: Array<[Vec3, Vec3]> = [[aroPuntos[0]!, aroPuntos[1]!], [aroPuntos[1]!, aroPuntos[2]!], [aroPuntos[2]!, aroPuntos[3]!], [aroPuntos[6]!, aroPuntos[5]!], [aroPuntos[7]!, aroPuntos[6]!], [aroPuntos[8]!, aroPuntos[7]!]];
  tramosBejuco.forEach(([a, b], k) => {
    const d = menos(b, a);
    const largoCm = r2(Math.hypot(d.x, d.y));
    const pieza = rizo({ forma: "resorte", tubito: VERDE, vueltas: Math.max(4, Math.round(largoCm / 6)), radioCm: 3.5, largoCm, eje: "abajo" });
    nodos.push(colgar({ id: `bejuco-${k + 1}`, nombre: `Bejuco de tubito ${k + 1}`, pieza, padre: aro.padre, origen: v(a.x, a.y, -172), normal: AL_FRENTE, giroGrados: giroHacia(d.x, d.y) }).nodo);
  });
  // Las hojas de burbujas (de dónde nacen y hacia dónde apuntan, en la pared) y el zarcillo de abajo a la izquierda.
  const hojas: Array<[number, number, number, number]> = [
    [-79, 238, -0.95, -0.3], [-82, 191, -0.93, 0.36], [-61, 152, 1, 0], [-114, 130, -0.87, -0.48], [-43, 231, -0.1, -1], [-46, 98, 1, 0],
    [61, 238, 0.99, 0.16], [93, 259, 1, 0], [82, 205, 1, 0], [54, 155, 0.45, -0.9], [111, 148, 0.85, 0.53], [-20, 258, 0.2, -1],
  ];
  const hoja = rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3.5, codigos: ["931"], largosCm: [4.5], recorrido: "recta", cantidad: 12 });
  hojas.forEach(([x, y, dx, dy], k) => nodos.push(colgar({ id: `hoja-${k + 1}`, nombre: `Hoja de burbujas ${k + 1}`, pieza: hoja, padre: aro.padre, origen: v(x, y, -168), normal: AL_FRENTE, giroGrados: giroHacia(dx, dy) }).nodo));
  nodos.push(colgar({ id: "zarcillo", nombre: "Zarcillo de tubito (abajo a la izquierda)", pieza: rizo({ forma: "tirabuzon", tubito: VERDE, vueltas: 3, radioInicialCm: 9, radioFinalCm: 5, largoCm: 60, eje: "abajo" }), padre: aro.padre, origen: v(-112, 108, -150), normal: AL_FRENTE, giroGrados: giroHacia(-0.2, -1) }).nodo);
  // Las bayas: racimitos de 4 R-5 chiquitos en cobrizo, amarillo o morado.
  const bayas: Array<[number, number, string]> = [[-61, 290, "062"], [-27, 284, "056"], [64, 277, "062"], [-68, 246, "062"], [-61, 214, "021"], [-125, 173, "021"], [61, 221, "021"], [118, 113, "062"]];
  bayas.forEach(([x, y, c], k) => nodos.push(colgar({ id: `bayas-${k + 1}`, nombre: `Racimito de bayas ${k + 1}`, pieza: anillo(R("R-5", 7, c), 4, 20), padre: aro.padre, origen: v(x, y, -166), normal: AL_FRENTE }).nodo));
  // Las flores grandes: en los bejucos (colgadas del aro), sobre el racimo de arriba y sobre las bases.
  const amarilla = deco(flor({ petalos: { ...R("R-12", 26, "021"), cantidad: 5, aperturaGrados: 10, giroGrados: 0 }, centro: { ...R("R-5", 10, "062"), cantidad: 1 } }));
  const morada = deco(flor({ petalos: { ...R("R-12", 28, "056"), cantidad: 5, aperturaGrados: 10, giroGrados: 18 }, centro: { ...R("R-9", 14, "021"), cantidad: 1 } }));
  ([["amarilla-1", amarilla, -91, 255], ["amarilla-3", amarilla, 86, 252], ["amarilla-4", amarilla, -95, 177], ["amarilla-6", amarilla, 77, 171], ["morada-3", morada, -91, 205], ["morada-4", morada, 88, 200]] as const)
    .forEach(([id, pieza, x, y]) => nodos.push(colgar({ id: `flor-${id}`, nombre: `Flor ${id.replace("-", " ")}`, pieza, padre: aro.padre, origen: v(x, y, -164), normal: AL_FRENTE }).nodo));
  nodos.push(
    apoyar("flor-amarilla-2", "Flor amarilla 2", amarilla, racimoArriba.padre, v(4, 254, -120), AL_FRENTE),
    apoyar("flor-morada-1", "Flor morada 1", morada, racimoArriba.padre, v(-52, 262, -120), AL_FRENTE),
    apoyar("flor-morada-2", "Flor morada 2", morada, racimoArriba.padre, v(48, 268, -120), AL_FRENTE),
    apoyar("flor-amarilla-5", "Flor amarilla 5", amarilla, baseIzq.padre, v(-77, 138, -90), AL_FRENTE),
    apoyar("flor-morada-5", "Flor morada 5", morada, baseIzq.padre, v(-114, 123, -90), AL_FRENTE),
    apoyar("flor-morada-6", "Flor morada 6", morada, baseIzq.padre, v(-80, 86, -90), AL_FRENTE),
    apoyar("flor-amarilla-7", "Flor amarilla 7", amarilla, baseDer.padre, v(52, 120, -90), AL_FRENTE),
    apoyar("flor-morada-7", "Flor morada 7", morada, baseDer.padre, v(102, 127, -90), AL_FRENTE),
    apoyar("flor-morada-8", "Flor morada 8", morada, baseDer.padre, v(79, 79, -90), AL_FRENTE),
  );
  // Las florecitas de 3 pétalos en el pasto (sueltas, de frente).
  const tercia = (petalo: ParteGlobo, centro: ParteGlobo) => deco(flor({ petalos: { ...petalo, cantidad: 3, aperturaGrados: 0, giroGrados: 30 }, centro: { ...centro, cantidad: 1 } }));
  const terciaAmarilla = tercia(R("R-9", 18, "021"), R("R-5", 9, "062")), terciaMorada = tercia(R("R-12", 18, "056"), R("R-5", 9, "021"));
  ([["amarilla-1", terciaAmarilla, -80, -70], ["amarilla-2", terciaAmarilla, -4, -40], ["amarilla-3", terciaAmarilla, 43, -70], ["morada-1", terciaMorada, -52, -52], ["morada-2", terciaMorada, 46, -58]] as const)
    .forEach(([id, pieza, x, z]) => nodos.push({ id: `florecita-${id}`, nombre: `Florecita ${id.replace("-", " ")} en el pasto`, pieza, colocacion: { en: "libre", xCm: x, yCm: 19, zCm: z, giroGrados: 0 } }));
  const mesa: ElementoEscenografia[] = [
    cilindro(v(0, 96, 0), 22, 3, "#c8a072", "madera"),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => barra(v(sx! * 20, 0, sz! * 20), v(-sx! * 12, 96, -sz! * 12), 0.7, "#1b1b1b", "metal")),
  ];
  nodos.push(
    { id: "mesa", nombre: "Mesa alta de patas de horquilla", pieza: escenografia(mesa), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -95, giroGrados: 0 } },
    { id: "platos", nombre: "Platos tropicales", pieza: platos({ cantidad: 6, diametroCm: 20, hex: "#f6c6d4", centro: "#f7d65a", productoId: null, descripcion: "platos de estampado tropical" }), colocacion: { en: "libre", xCm: -8, yCm: 99, zCm: -95, giroGrados: 0 } },
    { id: "vasos", nombre: "Vasos tropicales", pieza: vasos({ cantidad: 2, altoCm: 11, diametroCm: 8, hex: "#f6c6d4", servilleta: "#f7a64a", productoId: null, descripcion: "vasos de estampado tropical" }), colocacion: { en: "libre", xCm: 9, yCm: 99, zCm: -100, giroGrados: 0 } },
    { id: "neon", nombre: "Letrero de neón «Let's Party»", pieza: letrero({ forma: "rectangulo", anchoCm: 96, altoCm: 44, hex: "#e9ebec", motivo: { dibujo: "texto", texto: "Let's Party", hex: "#ffffff" }, apoyo: "colgado", productoId: null, descripcion: "letrero de neón" }), colocacion: { en: "libre", xCm: -2, yCm: 168, zCm: -198, giroGrados: 0 } },
    enPiso("pasto", "Tapete de pasto", escenografia(tapete({ anchoCm: 460, fondoCm: 230, hex: "#2f7d34" })), 0, -85),
  );
  return { sala: sala(460, 400, 320, { piso: "#cfc9c0", paredes: "#ecebe8", techo: "#f5f5f3" }), nodos };
};

// ----------------------------------------------------------------------------------------------------------
// 961 · Una tierna fiesta en tonos pasteles
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 660 × 572 (con marco): los R-12 del arco miden ~44 px (≈ 25 cm: 1,75 px/cm); el arco, 490 px ≈ 2,8 m de ancho y
 * ~2,3 m de alto. Arco orgánico por bloques de color de un arcoíris pastel, de izquierda a derecha: base blanca con R-36,
 * lila, azul, verde menta, amarillo, naranja durazno, rosado y base blanca, con R-12 Silk Amatista (los violeta perlados)
 * y R-5 de cristal sueltos. Tres jaulas con globitos pastel dentro, el muro de estibas con el letrero «Amaia», las mesas
 * provenzales blancas y el pasto. Foto → mundo: x = (px − 315)/1,75, y = (420 − py)/1,75.
 */
const escena961 = (): Escena => {
  const tubos = [v(-140, 10, -140), v(-130, 48, -150), v(-120, 76, -160), v(-112, 108, -165), v(-106, 140, -165), v(-100, 170, -165), v(-88, 196, -165), v(-62, 214, -165), v(-30, 220, -165), v(4, 216, -165), v(34, 212, -165), v(66, 204, -165), v(96, 188, -165), v(110, 162, -165), v(116, 134, -165), v(119, 108, -165), v(122, 84, -162), v(126, 60, -160), v(134, 38, -150), v(146, 22, -145), v(162, 12, -140)];
  const armazon = suelta("armazon", "Armazón del arco arcoíris", escenografia(tubo(tubos, 1.6, "#efece8")), v(0, 0, 0));
  const pastel = mezcla({ "R-18": 0.08, "R-12": 0.55, "R-9": 0.12, "R-5": 0.25 });
  const acentos = [color("850", 0.06, ["R-12"]), color("390", 0.05, ["R-5"])];
  const bloque = (id: string, nombre: string, codigo: string, desde: number, hasta: number, semilla: number) => tramoDe(armazon.padre, `tramo-${id}`, `Arco: bloque ${nombre}`, [{
    id, nombre, puntos: tubos.slice(desde, hasta + 1), grosor: grosor(31, 30), mezcla: pastel,
  }], { colores: [color(codigo, 0.89), ...acentos], semilla, relleno: RELLENO_12_9, pared: -200 });
  const blancoIzq = tramoDe(armazon.padre, "tramo-blanco-izquierda", "Arco: base blanca de la izquierda", [{
    id: "blanco_izquierda", nombre: "Base blanca izquierda", puntos: tubos.slice(0, 3), tapas: { inicio: false, fin: true }, grosor: grosor(48, 40),
    mezcla: mezcla({ "R-36": 0.3, "R-24": 0.3, "R-18": 0.25, "R-12": 0.15 }, { "R-24": 0.2, "R-18": 0.4, "R-12": 0.4 }),
  }], { colores: [color("005", 1)], semilla: 9611, relleno: RELLENO_12_9, pared: -200 });
  const blancoDer = tramoDe(armazon.padre, "tramo-blanco-derecha", "Arco: base blanca de la derecha", [{
    id: "blanco_derecha", nombre: "Base blanca derecha", puntos: tubos.slice(17), tapas: { inicio: true, fin: false }, grosor: grosor(36, 34),
    mezcla: mezcla({ "R-24": 0.2, "R-18": 0.35, "R-12": 0.45 }),
  }], { colores: [color("005", 1)], semilla: 9618, relleno: RELLENO_12_9, pared: -200 });
  const bloques = [
    bloque("lila", "lila", "650", 2, 4, 9612), bloque("azul", "azul", "640", 4, 7, 9613), bloque("verde", "verde menta", "630", 7, 10, 9614),
    bloque("amarillo", "amarillo", "620", 10, 12, 9615), bloque("naranja", "naranja durazno", "261", 12, 14, 9616), bloque("rosado", "rosado", "609", 14, 17, 9617),
  ];
  // Las jaulas: base, aros, 10 barrotes y la cúpula; dentro, un racimito de globitos pastel.
  const jaula = (alto: number, radio: number): ElementoEscenografia[] => [
    cilindro(v(0, 0, 0), radio + 1, 2, "#f4f2ee", "metal"), cilindro(v(0, alto - 1, 0), radio, 1, "#f4f2ee", "metal"),
    ...Array.from({ length: 10 }, (_, k) => barra(v(radio * Math.cos((2 * Math.PI * k) / 10), 0, radio * Math.sin((2 * Math.PI * k) / 10)), v(radio * Math.cos((2 * Math.PI * k) / 10), alto, radio * Math.sin((2 * Math.PI * k) / 10)), 0.3, "#f4f2ee", "metal")),
    ...Array.from({ length: 5 }, (_, k) => barra(v(radio * Math.cos((Math.PI * k) / 5), alto, radio * Math.sin((Math.PI * k) / 5)), v(-radio * Math.cos((Math.PI * k) / 5), alto, -radio * Math.sin((Math.PI * k) / 5)), 0.3, "#f4f2ee", "metal")),
    cilindro(v(0, alto, 0), radio, radio * 0.6, "#f4f2ee", "metal", 1),
  ];
  const JAULAS: Array<[string, string, number, number, number]> = [["izquierda", "izquierda", -45, 70, -110], ["centro", "del piso", 55, 0, -45], ["derecha", "derecha", 150, 80, -110]];
  const dentro = racimoEsfera(26, "R-5", 10, ["640", "609", "620", "630", "650"], [1, 1, 1, 1, 1], 961);
  const BLANCO = "#f7f6f3";
  const mesaProvenzal = (x: number, z: number, ancho: number, fondo: number, alto: number): ElementoEscenografia[] => [
    caja(v(x, alto - 2, z), v(ancho, 4, fondo), BLANCO, "satinado"), caja(v(x, alto - 9, z + fondo / 2 - 1), v(ancho - 6, 10, 2), BLANCO, "satinado"),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => barra(v(x + sx! * (ancho / 2 - 6), 0, z + sz! * (fondo / 2 - 5)), v(x + sx! * (ancho / 2 - 3), alto - 4, z + sz! * (fondo / 2 - 3)), 1.6, BLANCO, "satinado")),
  ];
  const mesas: ElementoEscenografia[] = [
    ...mesaProvenzal(40, -125, 140, 60, 85), ...mesaProvenzal(55, -75, 60, 40, 62), ...mesaProvenzal(-110, -50, 50, 45, 55), ...mesaProvenzal(178, -55, 50, 45, 55),
    cilindro(v(-45, 0, -110), 4, 70, BLANCO, "satinado"), cilindro(v(-45, 68, -110), 16, 2, BLANCO, "satinado"),
    cilindro(v(150, 0, -110), 4, 80, BLANCO, "satinado"), cilindro(v(150, 78, -110), 16, 2, BLANCO, "satinado"),
    // La torta del arcoíris y los frascos de dulces.
    cilindro(v(40, 85, -128), 16, 12, "#8fd3a0", "mate"), cilindro(v(40, 97, -128), 11, 10, "#f6b2c8", "mate"), ...[-10, 0, 80, 92].map((x) => cilindro(v(x, 85, -120), 6, 18, "#e8f0f2", "brillante")),
  ];
  const estibas: ElementoEscenografia[] = [
    ...Array.from({ length: 12 }, (_, k) => caja(v(30, 7 + k * 14.5, 0), v(225, 13, 3), k % 2 ? "#c49a6c" : "#ad8257", "madera")),
    { forma: "panel", contorno: [...circulo(5, 141, 55, 22, 28)], zCm: 3.5, grosorCm: 1.5, hex: "#f5f3f2", acabado: "papel", motivo: { dibujo: "texto", texto: "Amaia", hex: "#8e6bb8" } },
  ];
  const nodos: NodoEscena[] = [
    armazon.nodo, blancoIzq.nodo, ...bloques.map((b) => b.nodo), blancoDer.nodo,
    ...JAULAS.map(([id, nombre, x, y, z]) => suelta(`globitos-jaula-${id}`, `Globitos pastel de la jaula ${nombre}`, dentro, v(x, y + 16, z)).nodo),
    { id: "jaulas", nombre: "Jaulas decorativas", pieza: escenografia(JAULAS.flatMap(([, , x, y, z]) => jaula(36, 15).map((e) => (e.forma === "cilindro" && !e.en ? { ...e, base: mas(e.base, v(x, y, z)) } : e.forma === "cilindro" && e.en ? { ...e, en: { ...e.en, origen: mas(e.en.origen, v(x, y, z)) } } : e)))), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
    { id: "mesas", nombre: "Mesas provenzales blancas con la torta", pieza: escenografia(mesas), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
    { id: "estibas", nombre: "Muro de estibas con el letrero «Amaia»", pieza: escenografia(estibas), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -197, giroGrados: 0 } },
    enPiso("pasto", "Tapete de pasto", escenografia(tapete({ anchoCm: 420, fondoCm: 210, hex: "#2e7d32" })), 10, -90),
  ];
  return { sala: sala(460, 400, 300, { piso: "#e9e1d7", paredes: "#f2f0ed", techo: "#f7f6f3" }), nodos };
};

// ----------------------------------------------------------------------------------------------------------
// Las 9 ideas
// ----------------------------------------------------------------------------------------------------------

const PUB = {
  silkVerdeMenta: P("GLOBO REDONDO SILK VERDE MENTA", "/products/globo-latex-redondo-silk-verde-menta", "R-12", "826"),
  naranjaNegro: P("GLOBO REDONDO FASHION NARANJA-NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-surtido-negro-naranja", "R-12", "061"),
  hhNocheReflex: P("GLOBO REDONDO HAPPY HALLOWEEN", "/products/globo-para-fiesta-latex-redondo-2-caras-happy-halloween-noche-reflex-surtido", "R-12", null),
  aranaMetalink: P("GLOBO INFINITY® ARAÑA METALINK", "/products/globo-para-fiesta-latex-redondo-infinity-arana-metalink-fashion-negro", null, null),
  reflexDorado: P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
  arena: P("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
};

/** Ideas de fiesta de sempertex.com digitalizadas: lote 13. */
export const LOTE_13: readonly IdeaDigitalizada[] = [
  idea("the-grinch", "The Grinch: columnas espiral rojo y perla", escena933, "Igual: las 4 columnas anchas de cuartetos R-12 a 25 cm en espiral doble Fashion Rojo 015 y Satín Perla 406, pegadas y de 11 niveles (~2,25 m; el cuarteto mide 100 px de frente: 1,78 px/cm), la cuarta detrás de la chimenea, y la columna perla corta de 5 niveles bajo el cuadro, en una sala de 4,8 × 4 m y 2,6 m de alto; la chimenea de cartón amarilla con repisa blanca, el Grinch sentado con gorro de Santa, los regalos de cartón, las medias (10 en el piso y 4 en la repisa), el cuadro de marco rojo, los paneles naranja y verde, la guirnalda de luces y el tapete lila. Colores medidos (no publica productos) tras equilibrar el blanco con la repisa: rojo #e51d0e → 015; las perlas, translúcidas y teñidas por la luz cálida, van en Satín Perla. Distinto: la trenza del 3D gira 1/8 por nivel y la espiral de la foto se ve más marcada; el Grinch, la chimenea, los regalos y las medias son volúmenes sencillos."),
  idea("escenario-halloween", "Escenario Halloween: malla, guirnalda cromada y calderos", escena524, "Igual: la malla Link-O-Loon de 2,25 × 2,25 m en damero de flores Fashion Negro y Fashion Naranja (LOL-12 a 25 cm: la flor se repite cada 146 px, 2,8 px/cm) contra la pared; la guirnalda orgánica en el Silk Verde Menta publicado (R-18, R-12, R-9 y muchos R-5, como en la foto) que sube del montículo del piso por la izquierda, cruza arriba y acaba a la derecha, con 2 R-12 negros en la esquina y 3 en la punta; la torre de calderos (4 R-5, R-24 y R-18 Aguamarina 037 medidos, dos R-18 Fashion Violeta 051 y collares de R-5 verde menta); el ramo de 6 R-12 con los impresos publicados (2 Happy Halloween Reflex verde lima, 2 plata y 2 Araña Metalink) sobre su base de 12 R-5; el banderín «Happy Halloween», la mesa blanca escalonada con mantel de telaraña, platos y vasos, la araña y el gato de oropel y el tapete naranja. Distinto: en la malla las uniones de la foto alternan negro y naranja (aquí todas naranjas: la pared lleva un solo color de unión); los collares son de 8 R-5 (en la foto ~12; la flor admite 8) y les faltan las asas de tubito; las telarañas de papel no van; el publicado «Fashion Naranja-Negro» es el surtido de R-12 y aquí presta su nombre a las uniones R-5 naranjas.",
    [PUB.silkVerdeMenta, PUB.naranjaNegro, PUB.hhNocheReflex, PUB.aranaMetalink]),
  idea("feliz-cumpleanos-terra", "Feliz cumpleaños Terra: arco terracota y cascada mostaza", escena553, "Igual: con la foto equilibrada con la puerta blanca (R-24 de 105 px ≈ 55 cm: 1,9 px/cm), el arco de la izquierda por tramos —terracota (Fashion Coral Tropical 059, medido ΔE 10–15, el más cercano; R-12 con R-5 Reflex Dorado) sobre la puerta-panel de 2,4 m y la cascada Fashion Durazno 060 y Pastel Mate Nude 661 con dorados y algún mostaza y Reflex Dorado Rosa que baja hasta el piso, con el R-24 nude en la esquina— y la cascada de la derecha (Fashion Café 074 con dorados arriba, Fashion Mostaza 023 con dorados abajo y un R-24 mostaza en el piso); el ramo de la izquierda con 3 Infinity® Feliz Cumpleaños Terra (2 cobrizos y 1 mostaza) y 2 dorados, con el peso en un racimo dorado y blanco sobre el canasto de mimbre; el de la derecha (mármol, mostaza y verde salvia), cortado como en la foto; la silla pavo real, las mesas con la torta, las pampas y las paredes de madera y naranja. Colores medidos (no publica productos). Distinto: el motor orgánico da 414 globos en los cuatro tramos (no se cuentan uno a uno); la silla, las mesas y las pampas son volúmenes sencillos; el globo de mármol va con el Graffiti Mármol de la tienda (en la foto se ve más blanco)."),
  idea("feliz-dia-bigotes-y-padres", "Feliz día bigotes y padres: aro dorado y ramos", escena554, "Igual: el aro metálico dorado de 1,86 m (410 px; pedestales de 220 px ≈ 1 m: 2,2 px/cm) con su orgánico por tramos —Fashion Azul Rey 041 arriba a la izquierda, el gran racimo Fashion Mostaza 023 por dentro, Fashion Blanco 005 con R-18 y R-12 Arena 071 alrededor del letrero dorado «Happy Birthday» y Reflex Azul Galaxy 944 (medido ΔE 5–7) con Reflex Plata 981 que baja por la derecha hasta el piso—; el montículo de abajo a la izquierda en esos colores con un mostaza de bigotes y un Infinity® Feliz Día Bigotes azul rey con sombrero negro encima; el ramo de 7 (2 Feliz Día Bigotes Reflex azul y plata, Graffiti Cielo, 2 Infinity® Feliz Día Bigotes negro y azul rey, un azul liso y un Bigotes y Corbatines) con el peso en el montículo y el de 7 de la derecha (Feliz Cumpleaños Terrazo Azul, 2 Terrazo Azul, 2 mostaza y 2 plata) sobre el pedestal; los 3 pedestales blancos, el banderín de bigotes, la torta, las bolsas de rayas y el mantel azul de lunares. Colores medidos (no publica productos). Distinto: el azul rey de la foto es más vivo que el oficial (ΔE 18–27); el mostaza de bigotes negros no está en la tienda (va liso); el plata de corbatines va con el Bigotes y Corbatines Cristal; el orgánico lo pone el motor (no uno a uno)."),
  idea("grado-y-feliz-ano", "Feliz Año: arco plata, gris, arena y negro", escena639, "Igual: el arco asimétrico de ~2,9 m (R-12 cromados de 48 px ≈ 25 cm: 1,9 px/cm) por tramos con los productos publicados: la esquina de la izquierda en Reflex Plata, Metal Negro 580 y R-5 Reflex Dorado 970, el tramo Fashion Gris 081 con dorados, el Fashion Arena 071 con dorados y la bajada de la derecha hasta el piso con plata, negro, gris, arena y dorado, con R-18 y R-24; el ramo de la izquierda con el R-24 Infinity® Feliz Año Estrellas negro, un dorado y un plata Feliz Año Estrellas Reflex y 4 Infinity® Feliz Año Estrellas (satín plata y 3 negros), con el peso en el racimo del piso, que lleva los R-5 Infinity® Estrellas Reflex Plata publicados; la cortina de flecos dorada, el letrero «Feliz Año» y las tres mesas de marco blanco y vidrio. Distinto: el plata cromado (Reflex Plata 981) no está entre los publicados (se ve en la foto); el motor orgánico da 372 globos en el arco (no se cuentan uno a uno); la idea mapea las Estrellas Reflex Plata a R-12 y la tienda las vende en R-5; el pastel, los platos y las flores blancas son volúmenes sencillos.", [
    P("GLOBO REDONDO METAL NEGRO", "/products/globo-para-fiesta-latex-redondo-metal-negro", "R-12", "580"),
    P("GLOBO REDONDO FASHION GRIS", "/products/globo-para-fiesta-latex-redondo-fashion-gris", "R-12", "081"),
    PUB.reflexDorado, PUB.arena,
    P("GLOBO REDONDO INFINITY® ESTRELLAS REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-infinity-estrellas-reflex-plata", "R-12", null),
  ]),
  idea("halloween-2", "Halloween: racimos neón con ojos y manos", escena650, "Igual: la foto del preset del showroom (0,385 cm/px): los cuatro racimos orgánicos —arriba a la izquierda, el que baja por la derecha y los dos montículos del piso— en los colores publicados (Neón Verde 230, Fashion Naranja 061, Neón Naranja 261, Fashion Durazno 060 y R-5/R-12 Reflex Violeta 951), con 6 pares de ojos saltones de R-9 y R-5 Fashion Blanco 005; las 2 manos de T-260 Neón Verde publicadas sobre el marco ondulado verde con la pared de lentejuelas negra; el ramo de 11 R-12 impresos (Happy Halloween Reflex plata y verde lima, 4 Happy Halloween naranja, 3 Happy Halloween Friends negros y 2 Infinity® Happy Halloween verde lima) con el peso en la calabaza de dulces; las dos mesas cilíndricas negras con platos y vasos, la guirnalda de papel de fantasmitas, las arañas y el gato de oropel y el tapete naranja con encaje. Distinto: los chiquitos cromados de la foto se ven lila (Silk Amatista, ΔE 5–9) y van en el Reflex Violeta publicado; el verde mide más como Fashion Verde Lima y va el Neón Verde publicado; los tubitos durazno, naranja, neón naranja y violeta publicados no se ven en la foto (sin cantidad); el orgánico lo pone el motor (no uno a uno).", [
    P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005"),
    P("GLOBO REDONDO NEON VERDE", "/products/globo-para-fiesta-latex-redondo-neon-verde", "R-12", "230"),
    P("GLOBO REDONDO NEON NARANJA", "/products/globo-para-fiesta-latex-redondo-neon-naranja", "R-12", "261"),
    P("GLOBO REDONDO INFINITY® HAPPY HALLOWEEN FRIENDS FASHION NEGRO", "/products/globo-latex-redondo-infinity-happy-halloween-friends-fashion-negro", "R-12", null),
    P("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"),
    P("GLOBO REDONDO FASHION DURAZNO", "/products/globo-para-fiesta-latex-redondo-fashion-durazno", "R-12", "060"),
    P("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951"),
    P("GLOBO INFINITY® HAPPY HALLOWEEN", "/products/globo-para-fiesta-latex-redondo-infinity-happy-halloween-noche-fashion-surtido", null, null),
    P("GLOBO REDONDO HAPPY HALLOWEEN", "/products/globo-para-fiesta-latex-redondo-2-caras-happy-halloween-fashion-surtido-negro-naranja", "R-12", null),
    PUB.hhNocheReflex,
    P("GLOBO TUBITO NEON VERDE", "/products/globo-para-fiesta-latex-tubito-neon-verde", "T-260", "230"),
    P("GLOBO TUBITO FASHION DURAZNO", "/products/globo-para-fiesta-latex-tubito-fashion-durazno", "T-260", "060"),
    P("GLOBO TUBITO NEON NARANJA", "/products/globo-latex-tubito-neon-naranja", "T-260", "261"),
    P("GLOBO TUBITO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-tubito-reflex-violeta", "T-260", "951"),
    P("GLOBO TUBITO FASHION NARANJA", "/products/globo-para-fiesta-latex-tubito-fashion-naranja", "T-260", "061"),
  ]),
  idea("ocasiones-especiales-paleta-neutral", "Reflex Luxury: marco champaña, café y arena", escena794, "Igual: el marco por tramos alrededor del panel de lentejuelas plata de 2,2 m (R-24 de 165 px ≈ 55 cm: 3 px/cm), con los productos publicados: la esquina izquierda Reflex Champaña 971 (R-24, R-12 y R-5) con algún Reflex Dorado, el centro café con R-24, el Fashion Arena 071 de arriba a la derecha, la pata derecha café, champaña y arena con la flor café de 6 pétalos y centro de 3 R-5 dorados entre plumas blancas y cuernos dorados, y el pie izquierdo café y champaña; los dos ramos (7: champaña, dorado y un Confetti Dorado; 6: dorado, champaña y arena) con el peso en racimitos de 12 R-5 café; la mesa de pedestal crema con la torta de chocolate y las dos sillas blancas de patas doradas. Distinto: el café cromado de la foto («chocolate») no está publicado: medido #7c583d → Fashion Café 074 (el más cercano, ΔE 4–6; el Chocolate no se fabrica en R-24); los impresos dorados «… Boda» de los ramos no están en la tienda (van lisos); el motor orgánico da 595 globos en el marco (no se cuentan uno a uno); plumas y cuernos son tablones.", [
    P("GLOBO REDONDO REFLEX CHAMPAÑA", "/products/globo-para-fiesta-latex-redondo-reflex-champana", "R-12", "971"), PUB.reflexDorado, PUB.arena,
  ]),
  idea("tropical-sunset", "Tropical Sunset: aro de bejucos y flores", escena948, "Igual: con los productos publicados, las dos bases altas (1,6 m) de R-24, R-18 y R-12 Fashion Naranja Cobrizo 062 a los lados (pétalos de ~75 px ≈ 26 cm: 2,8 px/cm), el aro de bejucos de T-260 Reflex Verde Lima con el racimo cobrizo de arriba, 15 flores grandes de 5 pétalos R-12 (7 Fashion Amarillo Miel 021 con centro cobrizo y 8 Fashion Orquídea Morada 056 con centro R-9 amarillo), 12 hojas de burbujas de T-260, un zarcillo, 8 racimitos de 4 bayas R-5 (cobrizo, amarillo y morado) y las 5 florecitas de 3 pétalos en el pasto; la mesa alta de patas de horquilla con platos y vasos, el letrero de neón «Let's Party» y el tapete de pasto. Distinto: los bejucos de la foto son tubitos trenzados que se enroscan entre sí (aquí resortes rectos de punto a punto); las hojas de la foto llevan dos filas de burbujas (aquí una); el punto morado del centro de las flores moradas no va; las bases las pone el motor orgánico (no uno a uno) y el verde de los tubitos se ve salvia en la foto.", [
    P("GLOBO REDONDO FASHION NARANJA COBRIZO", "/products/globo-latex-redondo-fashion-naranja-cobrizo", "R-12", "062"),
    P("GLOBO REDONDO FASHION AMARILLO MIEL", "/products/copia-de-globo-latex-redondo-fashion-amarillomiel", "R-12", "021"),
    P("GLOBO REDONDO FASHION ORQUIDEA MORADA", "/products/globo-para-fiesta-latex-redondo-fashion-orquidea-morada", "R-12", "056"),
    P("GLOBO TUBITO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-reflex-verde-lima", "T-260", "931"),
  ]),
  idea("una-tierna-fiesta-en-tonos-pasteles", "Una tierna fiesta en tonos pasteles: arco arcoíris", escena961, "Igual: el arco de ~2,8 m (R-12 de 44 px ≈ 25 cm: 1,75 px/cm) por bloques de color del arcoíris pastel con los 5 productos publicados —base Fashion Blanco 005 con R-36 a la izquierda, Pastel Mate Lila 650, Azul 640, Verde 630, Amarillo 620, el bloque naranja, Pastel Mate Rosado 609 y base blanca a la derecha—, con R-12 Silk Amatista 850 (los violeta perlados, medidos ΔE 4–6) y R-5 de cristal sueltos; las tres jaulas con 12 globitos pastel cada una, el muro de estibas con el letrero «Amaia», las mesas provenzales blancas con la torta y los frascos, y el tapete de pasto. Distinto: el naranja no está publicado: medido #e79d4b → Neón Naranja 261 (en la foto, más pastel); el verde mide como Pastel Dusk Té Verde y el rosado como Fashion Rosado (van los publicados); el motor orgánico da 287 globos en el arco (no se cuentan uno a uno); la malla Link-O-Loon de detrás del muro y las columnas que cuenta el texto no se ven en la foto (no van).", [
    P("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609"),
    P("GLOBO REDONDO PASTEL MATE LILA", "/products/globo-para-fiesta-latex-redondo-pastel-mate-lila", "R-12", "650"),
    P("GLOBO REDONDO PASTEL MATE AZUL", "/products/globo-para-fiesta-latex-redondo-pastel-mate-azul", "R-12", "640"),
    P("GLOBO REDONDO PASTEL MATE AMARILLO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-amarillo", "R-12", "620"),
    P("GLOBO REDONDO PASTEL MATE VERDE", "/products/globo-para-fiesta-latex-redondo-pastel-mate-verde", "R-12", "630"),
  ]),
];
