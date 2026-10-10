import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { coloresDelFormato, formatoPorId } from "../formatos";
import { sumarMateriales } from "../mezcla";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import { metalizadoDeTienda, type ColorMetalizado, type OpcionesMetalizado } from "../metalizados";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { ColorOrganico, OpcionesOrganico, PuntoMezcla, RellenoOrganico } from "../organico";
import type { ElementoEscenografia } from "../escenografia";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesMono } from "../figuras";
import type { FormaAccesorio, PropiedadesFigura } from "../figuras-tubito";
import type { PropiedadesArana } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { PatronColumna } from "../columnas";
import type { Vec3 } from "../modulos";
import { centroCuerpo } from "../geometria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 18** (los números de `clasif/lote-18.json`): sobre todo
 * columnas y colgantes que antes quedaban «a medias» (metalizados de personaje, rizos de tubito, tubitos en espiral,
 * globos largos) y una figura: #326 cohete, #329 colgante de amor, #330 colgante Nemo, #334 columna 15 años, #335
 * columna Angry Birds, #338 columna araña, #341 y #342 columnas Baby Shower luna (niña y niño), #344 columna de
 * bautismo, #353 columna cebra fucsia, #354 columna cebra, #356 colgante de estrellas, #363 columna cupcake, #367
 * columna emoji y #374 columna Feliz Cumpleaños.
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`, todas de 740 × 570) recortada, ampliada
 * con rejilla y con el perfil de ancho por filas de píxeles (dónde empieza y acaba cada nivel):
 * - **Escala**: la de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 22 cm, R-12 ≈ 28 cm, R-24 ≈ 55
 *   cm; un T-260 inflado ≈ 5 cm de grueso; un Link-O-Loon 660 ≈ 14–15 cm). Cada idea dice su escala (px/cm) y su
 *   función `px` pasa los píxeles de la foto al mundo: con ella salen alturas, anchos y tamaños.
 * - **Conteo**: cuartetos por nivel (3 globos de frente = cuarteto con un globo al frente, girado 45°; 2 = con el
 *   hueco al frente) y niveles por los bultos del perfil; lo que la técnica obliga y no se ve (el cuarto globo de un
 *   cuarteto) se pone y la nota lo dice. Ninguna idea del lote publica «Materiales» con cantidades: todo lo contado va
 *   `contada: true`. En la nube del cohete el motor orgánico da los globos para el tamaño medido.
 * - **Alturas reales**: cada nivel va a la altura medida de su centro (los cuartetos de estas columnas van más juntos
 *   que el paso del taller, 0,8 diámetros: el 3D respeta la medida y la nota lo dice).
 * - **Colores**: si la idea publica productos (solo #326), ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana
 *   de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y el código más cercano que se
 *   fabrica en ese formato; si la sombra, el brillo o la transparencia engañan, la nota lo dice.
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando existe; si no, el más parecido del catálogo (y la nota lo
 *   dice); si no hay ninguno parecido (lunares de colores, emojis, «Baby Shower»), el liso de su fondo. Los metalizados
 *   de personaje (Angry Bird, cebra, cupcake, luna con gorro) no están en el catálogo: van genéricos (redondo o luna con
 *   su color y, si se puede, su letrero o sus rayas), sin producto.
 * - **Montaje** (para que la biblioteca saque «esta estructura con sus decoraciones» y «esta decoración sola»): en las
 *   columnas la raíz es su base de cuartetos; de ella cuelga su varilla (por el hueco del centro de los cuartetos) y de
 *   la varilla, exacto, cada nivel a su altura, los rizos, los remates y los metalizados (el montaje de los lotes 05, 10
 *   y 16). En los colgantes la raíz es el cordón del techo y del cordón cuelga todo; en el cohete, su armazón escondido.
 * Unidades: cm. Mundo: y arriba desde el piso, x a la derecha de quien mira, +z hacia quien mira.
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
const ABAJO = v(0, -1, 0);
const AL_FRENTE = v(0, 0, 1);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos: Partial<Sala["tonos"]> = {}): Sala => {
  const s = structuredClone(SALA_INICIAL);
  return { ...s, anchoCm, fondoCm, altoCm, tonos: { ...s.tonos, ...tonos } };
};
/** Un mapeo de la foto al mundo: (x, y) en píxeles → cm, con `escala` px/cm, el eje en `x0` y el piso en `y0`. */
const foto = (escala: number, x0: number, y0: number, alturaCm = 0) => (x: number, y: number, z = 0): Vec3 =>
  v(r2((x - x0) / escala), r2(alturaCm + (y0 - y) / escala), z);

// ----------------------------------------------------------------------------------------------------------
// Montaje: marcos, `colgar` (exacto, de una pieza sin globos) y `apoyar` (sobre los globos de una estructura)
// ----------------------------------------------------------------------------------------------------------

/** Matriz 3 × 3 por filas: de un espacio local al mundo (giro, o giro con espejo: el marco de `sobre` lo es). */
type M3 = readonly [number, number, number, number, number, number, number, number, number];
type Marco = { m: M3; t: Vec3 };

const IDENTIDAD: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const aplicar = (m: M3, a: Vec3): Vec3 => v(m[0] * a.x + m[1] * a.y + m[2] * a.z, m[3] * a.x + m[4] * a.y + m[5] * a.z, m[6] * a.x + m[7] * a.y + m[8] * a.z);
const trasladar = (m: M3, a: Vec3): Vec3 => v(m[0] * a.x + m[3] * a.y + m[6] * a.z, m[1] * a.x + m[4] * a.y + m[7] * a.z, m[2] * a.x + m[5] * a.y + m[8] * a.z);
const aLocal = (k: Marco, p: Vec3): Vec3 => trasladar(k.m, menos(p, k.t));

/**
 * El giro de una pieza `sobre` (el de `marcoDeAncla` de la escena): y local = la normal, x local horizontal (o a lo
 * largo de x si la normal es vertical) y `giroGrados` sobre la normal. Con la normal hacia arriba y −90° queda el mundo
 * con x al revés (así cuelgan los metalizados: el visor los dibuja derechos y de frente).
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
type Puesta = { nodo: NodoEscena; padre: Padre };

/** Una pieza suelta (raíz), con su origen en `origen` del mundo y girada `giroGrados` sobre la vertical. */
function suelta(id: string, nombre: string, pieza: Pieza, origen: Vec3, giroGrados = 0): Puesta {
  const c = Math.cos(rad(giroGrados)), s = Math.sin(rad(giroGrados));
  const m: M3 = giroGrados === 0 ? IDENTIDAD : [c, 0, s, 0, 1, 0, -s, 0, c];
  return { nodo: { id, nombre, pieza, colocacion: { en: "libre", xCm: r2(origen.x), yCm: r2(origen.y), zCm: r2(origen.z), giroGrados } }, padre: { id, marco: { m, t: origen } } };
}

/**
 * Una pieza `sobre` una pieza **sin globos** (una varilla, un armazón, el peso de un ramo): la escena la corre a lo largo
 * de la normal lo que baja su caja y la hunde `HUNDIMIENTO_SOBRE_CM`; aquí se descuenta, así que su origen queda en
 * `origen` (mundo), su y local hacia `normal` y girada `giroGrados`. `bajo`: lo que baja su caja (si no se da, se arma).
 */
function colgar(o: { id: string; nombre: string; pieza: Pieza; padre: Padre; origen: Vec3; normal: Vec3; giroGrados?: number; bajo?: number }): Puesta {
  const n = unitario(o.normal);
  const giro = o.giroGrados ?? 0;
  const bajo = o.bajo ?? bajoDe(o.pieza);
  const punto = menos(o.origen, por(n, bajo - HUNDIMIENTO_SOBRE_CM));
  return {
    nodo: { id: o.id, nombre: o.nombre, pieza: o.pieza, colocacion: { en: "sobre", padreId: o.padre.id, puntoCm: redondo(aLocal(o.padre.marco, punto)), normal: redondo(trasladar(o.padre.marco.m, n)), giroGrados: giro } },
    padre: { id: o.id, marco: { m: giroSobre(n, giro), t: o.origen } },
  };
}

/** El giro sobre la normal que deja la cara (+z local) de la pieza hacia quien mira: lo impreso al frente. */
function giroAlFrente(normal: Vec3): number {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  return Math.round((Math.atan2(-xL.z, zL.z) * 180) / Math.PI);
}

/** El origen que deja el centro del primer globo de la pieza en `centro` (mundo), y dónde queda su nudo. */
function centrada(pieza: Pieza, centro: Vec3, normal: Vec3, giroGrados: number): { origen: Vec3; nudo: Vec3 } {
  const g = armarPieza(pieza).globos[0];
  if (!g) return { origen: centro, nudo: centro };
  const m = giroSobre(normal, giroGrados);
  const c = mas(g.nudo, por(g.direccion, centroCuerpo("redondo", g.infladoCm) + g.cuelloExtraCm));
  const origen = menos(centro, aplicar(m, c));
  return { origen, nudo: mas(origen, aplicar(m, g.nudo)) };
}

// ----------------------------------------------------------------------------------------------------------
// Piezas
// ----------------------------------------------------------------------------------------------------------

const globo = (g: ParteGlobo, impresoId?: string): Pieza => ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(g.helio ? { helio: true as const } : {}), ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) });
const deco = (decoracion: Decoracion): Pieza => ({ tipo: "decoracion", decoracion });
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });
const flor = (p: PropiedadesFlor): Pieza => deco({ tipo: "flor", propiedades: p });
const lazos = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, anchoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados, giroGrados });
const burbujas = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const florTubito = (petalos: AnilloTubito, centro: ParteGlobo | null = null, interior: AnilloTubito | null = null): Pieza =>
  deco({ tipo: "flor_tubito", propiedades: { petalos, interior, corona: null, centro } });
const mono = (p: PropiedadesMono): Pieza => deco({ tipo: "mono", propiedades: p });
const rizo = (p: PropiedadesRizo): Pieza => deco({ tipo: "rizo", propiedades: p });
const figura = (p: Partial<PropiedadesFigura> & Pick<PropiedadesFigura, "queEs">): Pieza => deco({
  tipo: "figura", propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, accesorios: [], ...p },
});
/** Un nivel de cuarteto: una columna de un nivel (su origen es el centro del cuarteto). */
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color"): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores });
/** Un metalizado genérico (sin producto de la tienda): número, letra o figura. */
const metal = (forma: OpcionesMetalizado["forma"], pulgadas: number, color: ColorMetalizado): Pieza => ({ tipo: "metalizado", metalizado: { forma, pulgadas, color } });
const metalTienda = (id: string, pulgadas?: number): Pieza => ({ tipo: "metalizado", metalizado: metalizadoDeTienda(id, pulgadas ? { pulgadas } : {}) });

/** Un cilindro de `desde` a `hasta` (cinta, varilla, escarcha), en el espacio de la pieza que lo lleva. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2, acabado: ElementoEscenografia["acabado"] = "satinado"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });

/**
 * Un tallo o varita recto de tubito de `desde` a `hasta` (mundo), colgado exacto de un padre sin globos: dos burbujas
 * opuestas (apertura 0) de medio largo cada una, con el centro en el medio y puestas a lo largo de la recta (la normal,
 * perpendicular; el giro, el que lleva su primera burbuja hacia `hasta`). Así gasta lo que mide (un tubito si cabe).
 */
function varita(id: string, nombre: string, padre: Padre, t: { formatoId: string; grosorCm: number; codigo: string }, desde: Vec3, hasta: Vec3): NodoEscena {
  const d = unitario(menos(hasta, desde));
  const mitad = largo(menos(hasta, desde)) / 2;
  const n = unitario(Math.abs(d.z) < 0.9 ? menos(AL_FRENTE, por(d, d.z)) : menos(ARRIBA, por(d, d.y)));
  const m0 = giroSobre(n, 0);
  const xL = aplicar(m0, v(1, 0, 0)), zL = aplicar(m0, v(0, 0, 1));
  const giro = r2((Math.atan2(d.x * zL.x + d.y * zL.y + d.z * zL.z, d.x * xL.x + d.y * xL.y + d.z * xL.z) * 180) / Math.PI);
  const desdeCentro = Math.max(t.grosorCm / 2, (2 * t.grosorCm * 0.8) / (2 * Math.PI));
  const pieza = florTubito(burbujas(t.formatoId, t.grosorCm, [t.codigo], 2, r2(Math.max(t.grosorCm, mitad - desdeCentro)), 0, 0));
  return colgar({ id, nombre, pieza, padre, origen: por(mas(desde, hasta), 0.5), normal: n, giroGrados: giro }).nodo;
}

/** La varilla de un centro de mesa, colgada de su base por el eje (el hueco del centro de los cuartetos). */
function varilla(raiz: Padre, base: Vec3, altoCm: number, hex = "#ececea", radioCm = 0.6, nombre = "Varilla del centro"): Puesta {
  return colgar({ id: "varilla", nombre, pieza: escenografia([{ forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm, hex, acabado: "mate" }]), padre: raiz, origen: base, normal: ARRIBA, giroGrados: -90 });
}
/** Un nivel de cuarteto colgado de la varilla con su centro en `centro`: 0° deja un hueco al frente, 45° un globo. */
const nivel = (id: string, nombre: string, padre: Padre, pieza: Pieza, centro: Vec3, giroGrados: number): NodoEscena =>
  colgar({ id, nombre, pieza, padre, origen: centro, normal: ARRIBA, giroGrados: -90 - giroGrados }).nodo;
/** Un metalizado colgado derecho y de frente con su base en `base`. */
const metalEn = (id: string, nombre: string, padre: Padre, pieza: Pieza, base: Vec3): NodoEscena =>
  colgar({ id, nombre, pieza, padre, origen: base, normal: ARRIBA, giroGrados: -90 }).nodo;

/** La raíz de una base de cuartetos: el cuarteto apoyado en `pisoCm` con su centro lo más cerca de `centroY`. */
function baseCuarteto(id: string, nombre: string, pieza: Pieza, centroY: number, giroGrados: number, pisoCm = 0, x = 0, z = 0): Puesta {
  return suelta(id, nombre, pieza, v(x, r2(Math.max(centroY, pisoCm + bajoDe(pieza) + 0.3)), z), giroGrados);
}

// ----------------------------------------------------------------------------------------------------------
// Orgánicos
// ----------------------------------------------------------------------------------------------------------

const colorOrg = (codigo: string, peso: number, formatos?: string[]): ColorOrganico => ({ codigo, peso, ...(formatos ? { formatos } : {}) });
const constante = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];
/** Un racimo (tramo de guirnalda con remate en las dos puntas); `mezcla`, la suya si no es la del orgánico. */
type Racimo = { nombre: string; puntos: Vec3[]; radio: number; radioFin?: number; mezcla?: Readonly<Record<string, number>> };

/**
 * Un orgánico de racimos sobre un plano de piso (en `origen`: su cara de abajo no baja de ese plano), colgado de un
 * armazón sin globos. Los puntos de los racimos van en el mundo y se pasan a su espacio (normal arriba y −90°).
 */
function organicoDePiso(o: {
  id: string; nombre: string; padre: Padre; origen: Vec3; racimos: Racimo[]; mezcla: Readonly<Record<string, number>>;
  colores: ColorOrganico[]; semilla: number; inflados: Readonly<Record<string, number>>; relleno: RellenoOrganico[]; impresos?: Pieza["impresos"]; densidad?: number;
}): Puesta {
  const marco: Marco = { m: giroSobre(ARRIBA, -90), t: o.origen };
  const libres: RacimoLibre[] = o.racimos.map((r, k) => ({
    id: `racimo_${k + 1}`, nombre: r.nombre, puntos: r.puntos.map((p) => redondo(aLocal(marco, p))), radioInicioCm: r.radio, radioFinCm: r.radioFin ?? r.radio,
    mezcla: constante(r.mezcla ?? o.mezcla), tapas: { inicio: true, fin: true },
  }));
  const opciones: OpcionesOrganico = { ...opcionesRacimosLibres({ racimos: libres, colores: o.colores, semilla: o.semilla, suelo: true, relleno: o.relleno }), inflados: { ...o.inflados }, variacionInflado: 0.06, ...(o.densidad ? { densidad: o.densidad } : {}) };
  const pieza: Pieza = { tipo: "organico", opciones, flores: null, ...(o.impresos?.length ? { impresos: o.impresos } : {}) };
  return colgar({ id: o.id, nombre: o.nombre, pieza, padre: o.padre, origen: o.origen, normal: ARRIBA, giroGrados: -90, bajo: 0 });
}

// ----------------------------------------------------------------------------------------------------------
// Ramo de helio por pisos
// ----------------------------------------------------------------------------------------------------------

/** Un globo del ramo: su pieza, el centro de su cuerpo y hacia dónde sube (su cinta va del amarre a su nudo). */
type GloboHelio = { id: string; nombre: string; pieza: Pieza; centro: Vec3; direccion: Vec3; giroGrados?: number };
/** Un metalizado del ramo: su base (de ahí baja su cinta). */
type MetalHelio = { id: string; nombre: string; pieza: Pieza; base: Vec3 };

/**
 * Un ramo de helio: la raíz «Peso y cintas» (suelta, en el amarre) con una cinta a cada globo y a cada metalizado, y cada
 * uno colgado exacto en su sitio. Un globo con impreso va girado con lo impreso al frente.
 */
function ramo(o: { id: string; nombre: string; amarre: Vec3; cinta: string; globos: GloboHelio[]; metalizados?: MetalHelio[]; peso?: { radioCm: number; altoCm: number; hex: string } | null }): { nodos: NodoEscena[]; padre: Padre } {
  const nodos: NodoEscena[] = [];
  const cintas: ElementoEscenografia[] = [];
  const raiz = { id: o.id, marco: { m: IDENTIDAD, t: o.amarre } };
  // Todo lo de `globos` flota (un globo suelto o una decoración de un globo, como la calabaza); los foil van aparte, en `metalizados`.
  for (const g of o.globos.map((x) => ({ ...x, pieza: { ...x.pieza, helio: true as const } }))) {
    const d = unitario(g.direccion);
    const giro = g.giroGrados ?? (g.pieza.impresos?.length ? giroAlFrente(d) : 0);
    const { origen, nudo } = centrada(g.pieza, g.centro, d, giro);
    nodos.push(colgar({ id: g.id, nombre: g.nombre, pieza: g.pieza, padre: raiz, origen, normal: d, giroGrados: giro }).nodo);
    cintas.push(cinta(v(0, 0, 0), redondo(menos(nudo, o.amarre)), o.cinta, 0.15));
  }
  for (const m of o.metalizados ?? []) {
    nodos.push(metalEn(m.id, m.nombre, raiz, m.pieza, m.base));
    cintas.push(cinta(v(0, 0, 0), redondo(menos(m.base, o.amarre)), o.cinta, 0.15));
  }
  const peso = o.peso === undefined ? { radioCm: 1.6, altoCm: 3, hex: o.cinta } : o.peso;
  const elementos = [...(peso ? [cilindro(v(0, -peso.altoCm, 0), peso.radioCm, peso.altoCm, peso.hex, "satinado")] : []), ...cintas];
  return { nodos: [suelta(o.id, o.nombre, escenografia(elementos), o.amarre).nodo, ...nodos], padre: raiz };
}

/** La dirección de un globo de ramo: de su amarre hacia su centro, enderezada hacia arriba. */
const subiendo = (amarre: Vec3, centro: Vec3, k = 0.45): Vec3 => unitario(mas(por(unitario(menos(centro, amarre)), k), por(ARRIBA, 1 - k)));

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos), con la cantidad contada. */
function liso(formatoId: string, codigo: string, cantidad: number): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const p = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const x = productoDeGlobo(formatoId, codigo); return { nombre: x.nombre, url: quitarOrigen(x.url) }; })();
  return { nombre: p.nombre, url: p.url, formato: formatoId, codigo, cantidad, contada: true };
}

/**
/**
 * Un producto que la idea publica: nombre, url, formato y código tal cual. `codigo3d`: el código oficial con que va en
 * el 3D un color que no está en la tabla (la Blush Crema). `nodos`: los nodos cuyo látex ES este producto (un impreso
 * que el catálogo no trae y que se dibuja con otra pieza: la calabaza).
 */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null; codigo3d?: string; nodos?: string[] };
const P = (nombre: string, url: string, formato: string | null, codigo: string | null, extra: Pick<Publicado, "codigo3d" | "nodos"> = {}): Publicado => ({ nombre, url, formato, codigo, ...extra });

/** Qué globos de una pieza toman cada impreso (la misma regla que `aplicarImpresos`): por impreso, formato y color. */
function usoDeImpresos(pieza: Pieza): Array<{ impresoId: string; formatoId: string; codigo: string; cantidad: number }> {
  if (!pieza.impresos?.length) return [];
  const globos = armarPieza({ ...pieza, impresos: [] }).globos.map((g) => ({ formatoId: g.formatoId, codigo: g.codigo }));
  const ya = new Set<number>();
  const salida = new Map<string, { impresoId: string; formatoId: string; codigo: string; cantidad: number }>();
  for (const pedido of pieza.impresos) {
    const i = impresoPorId(pedido.impresoId);
    if (!i) continue;
    let elegidos: number[];
    if ("globos" in pedido) elegidos = pedido.globos.filter((k) => k >= 0 && k < globos.length);
    else {
      const delColor = globos.map((g, k) => (g.codigo === pedido.codigo ? k : -1)).filter((k) => k >= 0);
      const cada = Math.max(1, pedido.cada ?? 1), desde = Math.max(0, pedido.desde ?? 0);
      elegidos = delColor.filter((_, n) => n >= desde && (n - desde) % cada === 0);
    }
    for (const k of elegidos.filter((x) => !ya.has(x))) {
      ya.add(k);
      const g = globos[k]!;
      const codigo = i.surtido?.includes(g.codigo) ? g.codigo : i.codigoBase;
      const clave = `${i.id}|${g.formatoId}|${codigo}`;
      const previo = salida.get(clave) ?? { impresoId: i.id, formatoId: g.formatoId, codigo, cantidad: 0 };
      previo.cantidad += 1;
      salida.set(clave, previo);
    }
  }
  return [...salida.values()];
}

/**
 * Los productos de la idea a partir de lo armado (que es lo contado en la foto): cada impreso de la tienda por formato
 * y color de fondo, cada metalizado de la tienda, lo publicado que se dibuja con otra pieza (`nodos`) y los lisos (lo que
 * queda de cada formato y código). Lo que la idea publica sale con su nombre y url tal cual (si la foto no lo tiene,
 * sin cantidad); lo demás, con el producto liso de la tienda.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[]): ProductoDeIdea[] {
  const armada = armarEscena(escena);
  const salida: ProductoDeIdea[] = [];
  const usados = new Set<Publicado>();
  const impresos = new Map<string, { impresoId: string; formatoId: string; codigo: string; cantidad: number }>();
  const metalizados = new Map<string, { nombre: string; url: string; cantidad: number }>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    for (const u of usoDeImpresos(nodo.pieza)) {
      const k = `${u.impresoId}|${u.formatoId}|${u.codigo}`;
      const previo = impresos.get(k) ?? { ...u, cantidad: 0 };
      previo.cantidad += u.cantidad * copias;
      impresos.set(k, previo);
    }
    if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto) {
      const { nombre, url } = nodo.pieza.metalizado.producto;
      const previo = metalizados.get(url) ?? { nombre, url, cantidad: 0 };
      previo.cantidad += copias;
      metalizados.set(url, previo);
    }
  }
  const restar = new Map<string, number>();
  const quitar = (formatoId: string, codigo: string, n: number) => restar.set(`${formatoId}|${codigo}`, (restar.get(`${formatoId}|${codigo}`) ?? 0) + n);
  for (const u of impresos.values()) {
    const i = impresoPorId(u.impresoId)!;
    const publicado = publicados.find((p) => p.url === i.url);
    if (publicado) usados.add(publicado);
    salida.push({ nombre: publicado?.nombre ?? i.nombre, url: i.url, formato: u.formatoId, codigo: u.codigo, cantidad: u.cantidad, contada: true });
    quitar(u.formatoId, u.codigo, u.cantidad);
  }
  for (const m of metalizados.values()) {
    const publicado = publicados.find((p) => p.url === m.url);
    if (publicado) usados.add(publicado);
    salida.push({ nombre: publicado?.nombre ?? m.nombre, url: m.url, formato: null, codigo: null, cantidad: m.cantidad, contada: true });
  }
  for (const p of publicados.filter((x) => x.nodos?.length)) {
    const suyos = armada.porNodo.filter((n) => p.nodos!.includes(n.id));
    for (const m of sumarMateriales(...suyos.map((n) => n.materiales))) {
      const cantidad = Math.ceil(m.cantidad - 1e-9);
      if (cantidad <= 0) continue;
      usados.add(p);
      salida.push({ nombre: p.nombre, url: p.url, formato: m.formatoId, codigo: m.codigo, cantidad, contada: true });
      quitar(m.formatoId, m.codigo, cantidad);
    }
  }
  for (const m of sumarMateriales(armada.materiales)) {
    const cantidad = Math.ceil(m.cantidad - (restar.get(`${m.formatoId}|${m.codigo}`) ?? 0) - 1e-9);
    if (cantidad <= 0) continue;
    // El producto de la tienda es uno por color para todas sus tallas: se reconoce por el tipo de globo y el código.
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const publicado = publicados.find((p) => p.formato !== null && !p.nodos && formatoPorId(p.formato)?.tipo === tipo && (p.codigo3d ?? p.codigo) === m.codigo && !impresoPorUrl(p.url));
    if (publicado) { usados.add(publicado); salida.push({ nombre: publicado.nombre, url: publicado.url, formato: m.formatoId, codigo: m.codigo, cantidad, contada: true }); }
    else salida.push(liso(m.formatoId, m.codigo, cantidad));
  }
  // Lo publicado que la foto no tiene: listado, sin cantidad.
  for (const p of publicados) if (!usados.has(p)) salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: null });
  return salida;
}

function fuente(slug: string): FuenteIdea {
  const f = fuenteIdea(slug);
  if (!f) throw new Error(`La idea «${slug}» no está en las fuentes.`);
  return f;
}

/**
 * La idea con su número, ocasiones y foto de su fuente, y sus productos calculados la primera vez que se piden (salen de
 * armar la escena). Las ocasiones salen de las etiquetas con `ocasionesDeEtiquetas`, que vive en `index.ts` (que importa
 * este lote): se calculan al leerlas.
 */
function idea(slug: string, nombre: string, escena: () => Escena, nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  // Perezosa (ver «Patrón perezoso» en tipos.ts): la escena se arma la primera vez que se pide.
  return ideaPerezosa({
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
  }, () => ({ tipo: "escena", escena: escena() }), () => productosDe(escena(), publicados));
}


// ----------------------------------------------------------------------------------------------------------
// Columnas de niveles medidos
// ----------------------------------------------------------------------------------------------------------

/** El nombre oficial de un color («Fashion Negro»). */
const nombreColor = (formatoId: string, codigo: string): string => coloresDelFormato(formatoId).find((c) => c.codigo === codigo)?.nombreCompleto ?? codigo;

/**
 * Los colores de un cuarteto como se ven de frente. Con el globo al frente (giro 45°): [izquierda, frente, derecha,
 * atrás]; con el hueco al frente (giro 0°): [frente izquierda, frente derecha, atrás derecha, atrás izquierda].
 */
type Cuatro = readonly [string, string, string, string];
type GiroNivel = 0 | 45;

/**
 * Un nivel de cuarteto medido en la foto: su globo (formato e inflado), sus colores vistos de frente, la fila de su
 * centro en la foto (`yPx`) y si lleva un globo al frente (45°) o el hueco (0°).
 */
type NivelFoto = { id: string; nombre?: string; g: ParteGlobo; colores: Cuatro; yPx: number; giro: GiroNivel; impresos?: ImpresoEnPieza[] };

/**
 * El orden de los colores en la pieza: colgado de la varilla (`nivel`) va tal cual; la base, suelta en el piso, la
 * escena la arma con el marco al revés (izquierda y derecha cambiadas), así que se cambia el orden para que se vea igual.
 */
const ordenSuelta = (c: Cuatro, giro: GiroNivel): string[] => (giro === 45 ? [c[2], c[1], c[0], c[3]] : [c[1], c[0], c[3], c[2]]);

function piezaNivel(n: NivelFoto, colores: readonly string[]): Pieza {
  const unico = new Set(colores).size === 1;
  return { ...cuarteto(n.g, unico ? [colores[0]!] : [...colores], unico ? "un_color" : "espiral"), ...(n.impresos?.length ? { impresos: n.impresos } : {}) };
}

function nombreNivel(n: NivelFoto): string {
  if (n.nombre) return n.nombre;
  const distintos = [...new Set(n.colores)].map((c) => nombreColor(n.g.formatoId, c));
  return `Cuarteto de ${n.g.formatoId} ${distintos.join(" y ")} (${n.id.replace(/-/g, " ")})`;
}

/**
 * Una columna de niveles medidos: la base (el primer nivel) es la raíz, de ella cuelga la varilla por el eje y de la
 * varilla cada nivel con su centro a la altura medida (`px` pasa la fila de la foto a la altura real).
 */
function columnaFoto(px: (x: number, y: number, z?: number) => Vec3, niveles: readonly NivelFoto[], altoVarillaCm: number, varillaHex = "#ececea", varillaNombre?: string, varillaRadioCm = 0.6): { nodos: NodoEscena[]; vara: Puesta; alturas: number[] } {
  const [primero, ...resto] = niveles;
  if (!primero) throw new Error("Columna sin niveles");
  const base = baseCuarteto(primero.id, nombreNivel(primero), piezaNivel(primero, ordenSuelta(primero.colores, primero.giro)), px(0, primero.yPx).y, primero.giro);
  const vara = varilla(base.padre, v(0, 1, 0), altoVarillaCm, varillaHex, varillaRadioCm, varillaNombre);
  const nodos: NodoEscena[] = [base.nodo, vara.nodo];
  const alturas = [r2(base.padre.marco.t.y)];
  for (const n of resto) {
    const y = px(0, n.yPx).y;
    alturas.push(y);
    nodos.push(nivel(n.id, nombreNivel(n), vara.padre, piezaNivel(n, n.colores), v(0, y, 0), n.giro));
  }
  return { nodos, vara, alturas };
}

/** Un aro de tubito perpendicular a la normal con que se cuelga (alrededor de un eje, o de frente). */
const anillo = (t: { formatoId: string; grosorCm: number; codigo: string }, radioCm: number): Pieza => figura({
  queEs: "a twisted-balloon ring", accesorios: [{ en: "base", forma: { tipo: "aro", tubito: t, radioCm, plano: "frente", desdeGrados: 0, hastaGrados: 360 } satisfies FormaAccesorio }],
});

/** Un tirabuzón de tubito que cuelga de su amarre (con el eje vertical si se cuelga mirando al frente). */
const tirabuzon = (formatoId: string, grosorCm: number, codigo: string, vueltas: number, radioInicialCm: number, radioFinalCm: number, largoCm: number, giroGrados = 0): Pieza =>
  rizo({ forma: "tirabuzon", tubito: { formatoId, grosorCm, codigo }, vueltas, radioInicialCm, radioFinalCm, largoCm, eje: "abajo", giroGrados });

const SALA_BLANCA = { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" } as const;

// Impresos y metalizados del catálogo que usa el lote.
const CORAZONES_ROJO = "infinity-corazones-por-siempre-fashion-rojo";
const HALLOWEEN_NARANJA = "2-caras-happy-halloween-fashion-surtido-negro-naranja";
const GRAFFITI_CRISTAL = "infinity-graffiti-invierno-fashion-transparente";
const CONFETI_PASTEL = "infinity-confetti-multicolor-pastel-fashion-transparente";
const FESTIVO_METALIZADO = "festivo";

/** El cordón del techo de un colgante: la raíz, con su amarre en el techo y la cinta hasta lo de arriba del colgante. */
function cordonDeTecho(techoCm: number, hastaCm: number, x = 0, z = 0): Puesta {
  return suelta("cordon", "Cordón del techo", escenografia([cinta(v(0, 0, 0), v(0, r2(hastaCm - techoCm), 0), "#d9d9d9", 0.25), cilindro(v(0, -1.5, 0), 2.5, 1.5, "#e6e6e6", "satinado")]), v(x, techoCm, z));
}

/**
 * El origen que deja el centro de la caja de la pieza en `centro` (mundo) al colgarla con esa normal y ese giro: las
 * figuras se arman paradas en su base (un aro de figura queda con el borde en su origen); así quedan centradas.
 */
function origenCentrado(pieza: Pieza, centro: Vec3, normal: Vec3, giroGrados = 0): Vec3 {
  const c = armarPieza(pieza).caja;
  return menos(centro, aplicar(giroSobre(unitario(normal), giroGrados), por(mas(c.min, c.max), 0.5)));
}

/** Un globo colgado con el centro de su cuerpo en `centro` y el cuerpo hacia `direccion` (el nudo, al lado contrario). */
const globoEn = (id: string, nombre: string, padre: Padre, pieza: Pieza, centro: Vec3, direccion: Vec3): NodoEscena =>
  colgar({ id, nombre, pieza, padre, origen: centro, normal: unitario(direccion) }).nodo;

// ==========================================================================================================
// 326 · Cohete
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 blancos grandes de la nube miden ~80 px (≈ 28 cm): 2,9 px/cm; la foto se pone con la fila 560
 * a 30 cm del piso y el centro en x = 370. El cohete va inclinado ~30° (la punta abajo a la izquierda, en px (110, 452);
 * la tobera arriba a la derecha, en (345, 318)): ~93 cm de cuerpo rojo de ~19 cm de grueso, dos aros blancos (a 11 y 46
 * cm de la punta), cuatro aletas de lazos rojos a 60 cm (se ven tres), la espiral azul de la tobera (~5 vueltas) y
 * cuatro llamas de tubito (naranja, amarilla, amarilla, naranja) que entran en la nube de R-12, R-9 y R-5 blancos
 * (~85 × 115 cm).
 */
const escena326 = perezoso((): Escena => {
  const px = foto(2.9, 370, 560, 30);
  const armazon = suelta("armazon", "Armazón del cohete (base y varilla escondida en la nube)", escenografia([cilindro(v(0, 0, 0), 12, 1.2, "#e9e9e9", "satinado"), cilindro(v(0, 0, 0), 1, 128, "#e9e9e9", "satinado")]), v(px(520, 0).x, 0, -16));
  const nodos: NodoEscena[] = [armazon.nodo];
  const punta = px(110, 452), tobera = px(345, 318);
  const eje = unitario(menos(tobera, punta));
  const p1 = v(-eje.y, eje.x, 0), p2 = AL_FRENTE;
  const sobreEje = (s: number, a = 0, r = 0): Vec3 => mas(mas(punta, por(eje, s)), mas(por(p1, r * Math.cos(rad(a))), por(p2, r * Math.sin(rad(a)))));
  const largoCuerpo = largo(menos(tobera, punta));
  // El cuerpo: 7 T-260 rojos juntos (uno al centro y seis alrededor), de la punta a la tobera.
  const ROJO = { formatoId: "T-260", grosorCm: 5, codigo: "015" };
  nodos.push(varita("cuerpo-centro", "T-260 Fashion Rojo del cuerpo (centro)", armazon.padre, ROJO, sobreEje(2), sobreEje(largoCuerpo - 1)));
  for (let k = 0; k < 6; k++) nodos.push(varita(`cuerpo-${k + 1}`, `T-260 Fashion Rojo del cuerpo ${k + 1}`, armazon.padre, ROJO, sobreEje(4, 60 * k, 5.2), sobreEje(largoCuerpo - 2, 60 * k, 5.2)));
  const BLANCO = { formatoId: "T-260", grosorCm: 4.8, codigo: "005" };
  nodos.push(colgar({ id: "aro-punta", nombre: "Aro de T-260 blanco (junto a la punta)", pieza: anillo(BLANCO, 10.5), padre: armazon.padre, origen: origenCentrado(anillo(BLANCO, 10.5), sobreEje(11.5), eje), normal: eje }).nodo);
  nodos.push(colgar({ id: "aro-medio", nombre: "Aro de T-260 blanco (medio)", pieza: anillo(BLANCO, 10.5), padre: armazon.padre, origen: origenCentrado(anillo(BLANCO, 10.5), sobreEje(46), eje), normal: eje }).nodo);
  nodos.push(colgar({ id: "aletas", nombre: "Aletas: 4 lazos de T-260 Fashion Rojo", pieza: florTubito(lazos("T-260", 4.8, ["015"], 4, 23, 15, 15, 0)), padre: armazon.padre, origen: sobreEje(60), normal: eje }).nodo);
  nodos.push(colgar({ id: "espiral-tobera", nombre: "Espiral de T-160 Fashion Azul Rey en la tobera", pieza: rizo({ forma: "resorte", tubito: { formatoId: "T-160", grosorCm: 2.5, codigo: "041" }, vueltas: 4.5, radioCm: 8.5, largoCm: 13, eje: "frente" }), padre: armazon.padre, origen: sobreEje(largoCuerpo - 14), normal: eje }).nodo);
  // Las llamas: de dentro de la tobera a su punta medida.
  const LLAMAS: ReadonlyArray<[number, number, string, string]> = [[470, 192, "061", "naranja"], [490, 222, "020", "amarilla"], [515, 262, "020", "amarilla"], [518, 290, "061", "naranja"]];
  LLAMAS.forEach(([x, y, codigo, color], k) => nodos.push(varita(`llama-${k + 1}`, `Llama ${color} de T-260 (${k + 1})`, armazon.padre, { formatoId: "T-260", grosorCm: 4.8, codigo }, sobreEje(largoCuerpo - 6, 90 * k - 135, 3), px(x, y, r2(2 - k)))));
  const nube = organicoDePiso({
    id: "nube", nombre: "Nube orgánica de R-12, R-9 y R-5 Fashion Blanco", padre: armazon.padre, origen: v(0, 60, -14),
    racimos: [
      { nombre: "Cuerpo de la nube", puntos: [px(470, 175, -14), px(560, 330, -14)], radio: 32 },
      { nombre: "Lóbulo de arriba", puntos: [px(430, 135, -16), px(520, 128, -16)], radio: 17 },
      { nombre: "Lóbulo de la derecha", puntos: [px(600, 250, -10), px(612, 355, -10)], radio: 19 },
      { nombre: "Lóbulo de abajo", puntos: [px(445, 395, -8), px(560, 405, -8)], radio: 16 },
    ],
    mezcla: { "R-12": 0.55, "R-9": 0.3, "R-5": 0.15 }, colores: [colorOrg("005", 1)], densidad: 1.4,
    semilla: 326, inflados: { "R-12": 27, "R-9": 19, "R-5": 11 }, relleno: [],
  });
  nodos.push(nube.nodo);
  return { sala: sala(320, 260, 260, SALA_BLANCA), nodos };
});
const idea326 = idea("cohete", "Cohete de tubitos con nube blanca", escena326,
  "Igual: el cohete de ~93 cm inclinado ~30° como en la foto (2,9 px/cm por los R-12 de la nube), con el cuerpo de T-260 Fashion Rojo, los dos aros de T-260 blanco, cuatro aletas de lazos rojos, la espiral azul de la tobera y las cuatro llamas (naranja, amarilla, amarilla, naranja) entrando en la nube de ~85 × 115 cm de R-12, R-9 y R-5 Fashion Blanco: los tres productos publicados (T-260 rojo y amarillo, R-12 blanco). Distinto: el cuerpo de la foto (~19 cm de grueso) se arma con 7 T-260 juntos (uno al centro y seis alrededor) y su punta queda plana; las aletas son lazos (en la foto, burbujas infladas en forma de corazón) y van cuatro donde se ven tres; las llamas naranjas, los aros blancos y la espiral azul (T-160 Fashion Azul Rey, medido #005378–#1f86dc) no están publicados; la nube la da el motor orgánico para el tamaño medido (no se cuentan uno a uno) y el cohete va sobre una base con varilla escondida en la nube (la foto no muestra el soporte).", [
  P("GLOBO TUBITO FASHION ROJO", "/products/globo-para-fiesta-latex-tubito-fashion-rojo", "T-260", "015"),
  P("GLOBO TUBITO FASHION AMARILLO", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", "T-260", "020"),
  P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005"),
]);

// ==========================================================================================================
// 329 · Colgante de amor
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 rojos de corazones miden ~70 px (≈ 28 cm): 2,5 px/cm; la fila 560 a 60 cm del piso y el eje
 * en x = 380, colgado de un techo de 3 m. De arriba abajo: la flor de 5 R-12 rojos con corazones blancos y un R-12
 * blanco al centro (en px (380, 100)); un R-12 blanco (~25 cm) con un aro de T-260 rojo alrededor y un lazo rojo a cada
 * lado (los brazos: el izquierdo baja a (280, 205), el derecho, un lazo largo, llega a (510, 185)); el cuerpo, un R-24
 * blanco de ~56 cm con un trébol de 4 lazos rojos al frente; un cuarteto de R-12 rojos de corazones (se ven 3) y cuatro
 * T-260 blancos (las piernas) con un trébol rojo en cada punta: 5 tréboles.
 */
const escena329 = perezoso((): Escena => {
  const px = foto(2.5, 380, 560, 60);
  const arriba = px(380, 12).y;
  const cordon = cordonDeTecho(300, arriba);
  const nodos: NodoEscena[] = [cordon.nodo];
  const flor329: Pieza = { ...flor({ petalos: { ...R("R-12", 28, "015"), cantidad: 5, aperturaGrados: 0, giroGrados: 0 }, centro: { ...R("R-12", 27, "005"), cantidad: 1 } }), impresos: [{ impresoId: CORAZONES_ROJO, codigo: "015" }] };
  nodos.push(colgar({ id: "flor", nombre: "Flor de 5 R-12 rojos de corazones con centro blanco", pieza: flor329, padre: cordon.padre, origen: px(380, 100, 0), normal: AL_FRENTE }).nodo);
  nodos.push(globoEn("cabeza", "R-12 Fashion Blanco bajo la flor", cordon.padre, globo(R("R-12", 25.5, "005")), px(392, 163, 4), ABAJO));
  const ROJO = { formatoId: "T-260", grosorCm: 4.5, codigo: "015" };
  nodos.push(colgar({ id: "aro", nombre: "Aro de T-260 Fashion Rojo alrededor del R-12 blanco", pieza: anillo(ROJO, 17), padre: cordon.padre, origen: origenCentrado(anillo(ROJO, 17), px(392, 163, 8), AL_FRENTE), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "brazos", nombre: "Lazos rojos a los lados (brazos)", pieza: mono({ ...ROJO, lazosPorLado: 1, largoLazoCm: 42, anchoLazoCm: 10, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: null }), padre: cordon.padre, origen: px(392, 175, 10), normal: AL_FRENTE }).nodo);
  nodos.push(globoEn("cuerpo", "R-24 Fashion Blanco (cuerpo)", cordon.padre, globo(R("R-24", 56, "005")), px(370, 250, 0), ABAJO));
  const trebol = (): Pieza => florTubito(lazos("T-260", 4, ["015"], 4, 9, 8, 0, 45), R("R-5", 5.5, "005"));
  nodos.push(colgar({ id: "trebol-cuerpo", nombre: "Trébol de 4 lazos rojos en el cuerpo", pieza: trebol(), padre: cordon.padre, origen: px(397, 232, 26), normal: AL_FRENTE }).nodo);
  nodos.push(nivel("faldon", "Cuarteto de R-12 rojos de corazones (bajo el cuerpo)", cordon.padre, { ...cuarteto(R("R-12", 28, "015"), ["015"]), impresos: [{ impresoId: CORAZONES_ROJO, codigo: "015" }] }, px(380, 350, 0), 45));
  // Las piernas: cada T-260 blanco del amarre bajo el cuarteto a su trébol medido.
  const PIERNAS: ReadonlyArray<[number, number, number, number, string]> = [[330, 385, 245, 375, "izquierda"], [395, 390, 470, 410, "derecha"], [380, 395, 370, 465, "centro"], [360, 400, 305, 510, "abajo"]];
  PIERNAS.forEach(([x0, y0, x1, y1, lado], k) => {
    nodos.push(varita(`pierna-${k + 1}`, `Pierna de T-260 Fashion Blanco (${lado})`, cordon.padre, { formatoId: "T-260", grosorCm: 4.5, codigo: "005" }, px(x0, y0, 4), px(x1, y1, 6)));
    nodos.push(colgar({ id: `trebol-${k + 1}`, nombre: `Trébol de 4 lazos rojos (${lado})`, pieza: trebol(), padre: cordon.padre, origen: px(x1, y1, 8), normal: AL_FRENTE }).nodo);
  });
  return { sala: sala(300, 260, 300, SALA_BLANCA), nodos };
});
const idea329 = idea("colgante-de-amor", "Colgante de amor: flor de corazones y tréboles rojos", escena329,
  "Igual: el colgante de techo de ~2,2 m con sus partes medidas (2,5 px/cm): la flor de 5 R-12 Fashion Rojo con el impreso «Corazones por siempre» de la tienda (corazones blancos sobre rojo) y su R-12 blanco al centro, el R-12 blanco con el aro rojo de T-260 y los lazos rojos de los brazos, el cuerpo R-24 blanco (~56 cm) con su trébol rojo, el cuarteto de R-12 rojos de corazones, las 4 piernas de T-260 blanco y los 5 tréboles contados. Colores medidos (no publica productos): rojo #f31116 → 015, blancos 005. Distinto: las piernas son rectas (en la foto se curvan en S) y los tréboles son 4 lazos de T-260 con un R-5 blanco al centro (en la foto parecen 4 corazoncitos inflados); del cuarteto de abajo se ven 3 globos (el cuarto, detrás, se pone); el lazo derecho de la foto es más largo que el izquierdo y aquí son iguales.");

// ==========================================================================================================
// 330 · Colgante Nemo y 356 · Columna colgante de estrellas (el mismo armado)
// ==========================================================================================================

/** Un globo del racimo de un colgante: dónde está en la foto (px), su z, su tamaño (px) y su color. */
type GloboRacimo = { x: number; y: number; z: number; dPx: number; codigo: string; nombre: string };
/** Un rizo de un colgante: su amarre arriba (px), su z, su largo y su radio (cm), vueltas y color. */
type RizoColgante = { x: number; y: number; z: number; largoCm: number; radioCm: number; vueltas: number; codigo: string; nombre: string };

/**
 * Un colgante de racimo: el cordón del techo (la raíz), el racimo de R-12 (cada globo en su sitio medido, con el nudo
 * hacia el centro del racimo), el globo grande colgado debajo (nudo arriba) y los rizos de T-260 que salen del racimo.
 */
function colgante(o: { px: (x: number, y: number, z?: number) => Vec3; escala: number; arribaPx: number; grande: { xPx: number; yPx: number; g: ParteGlobo; nombre: string }; racimo: GloboRacimo[]; rizos: RizoColgante[] }): NodoEscena[] {
  const cordon = cordonDeTecho(300, o.px(0, o.arribaPx).y);
  const nodos: NodoEscena[] = [cordon.nodo];
  const centros = o.racimo.map((g) => o.px(g.x, g.y, g.z));
  const centro = por(centros.reduce((a, b) => mas(a, b), v(0, 0, 0)), 1 / Math.max(1, centros.length));
  o.racimo.forEach((g, k) => nodos.push(globoEn(`racimo-${k + 1}`, `R-12 ${g.nombre} del racimo (${k + 1})`, cordon.padre, globo(R("R-12", r2(g.dPx / o.escala), g.codigo)), centros[k]!, mas(menos(centros[k]!, centro), v(0, 2, 0)))));
  nodos.push(globoEn("grande", o.grande.nombre, cordon.padre, globo(o.grande.g), o.px(o.grande.xPx, o.grande.yPx, 0), ABAJO));
  o.rizos.forEach((r, k) => nodos.push(colgar({ id: `rizo-${k + 1}`, nombre: `Rizo de T-260 ${r.nombre} (${k + 1})`, pieza: tirabuzon("T-260", 4.5, r.codigo, r.vueltas, r.radioCm, r.radioCm, r.largoCm, 40 * k), padre: cordon.padre, origen: o.px(r.x, r.y, r.z), normal: AL_FRENTE }).nodo));
  return nodos;
}

/**
 * 330. Foto 740 × 570: el globo naranja de abajo mide 273 px de ancho y los del racimo 70–90 px; los T-260 de los rizos
 * ~17 px de grueso (≈ 5,3 cm): 3,2 px/cm, así que el de abajo es un R-36 a ~85 cm (no un R-24: un R-24 dejaría los
 * tubitos de 3 cm) y los del racimo R-12 de 22 a 28 cm. La fila 555 a 110 cm del piso, el eje en x = 373, de un techo
 * de 3 m. Racimo de 8 R-12: 3 rojos, 3 verde neón, 1 azul rey y 1 verde azulado (con manchas turquesa impresas); 5 rizos:
 * verde, naranja, azul, verde azulado y rojo.
 */
const escena330 = perezoso((): Escena => ({
  sala: sala(300, 260, 300, SALA_BLANCA),
  nodos: colgante({
    px: foto(3.2, 373, 555, 110), escala: 3.2, arribaPx: 20,
    grande: { xPx: 373, yPx: 422, g: R("R-36", 85, "061"), nombre: "R-36 Fashion Naranja (abajo)" },
    racimo: [
      { x: 340, y: 50, z: -10, dPx: 85, codigo: "015", nombre: "Fashion Rojo" },
      { x: 252, y: 95, z: -6, dPx: 85, codigo: "041", nombre: "Fashion Azul Rey" },
      { x: 440, y: 100, z: -8, dPx: 80, codigo: "230", nombre: "Neón Verde" },
      { x: 270, y: 185, z: 4, dPx: 90, codigo: "015", nombre: "Fashion Rojo" },
      { x: 400, y: 190, z: 6, dPx: 85, codigo: "230", nombre: "Neón Verde" },
      { x: 335, y: 245, z: 20, dPx: 70, codigo: "230", nombre: "Neón Verde" },
      { x: 270, y: 265, z: 6, dPx: 80, codigo: "015", nombre: "Fashion Rojo" },
      { x: 465, y: 262, z: 4, dPx: 75, codigo: "932", nombre: "Reflex Verde Aurora" },
    ],
    rizos: [
      { x: 270, y: 20, z: 4, largoCm: 28, radioCm: 14, vueltas: 1.25, codigo: "029", nombre: "Fashion Verde Trébol" },
      { x: 235, y: 110, z: 6, largoCm: 31, radioCm: 8, vueltas: 1.5, codigo: "061", nombre: "Fashion Naranja" },
      { x: 280, y: 280, z: 14, largoCm: 28, radioCm: 13, vueltas: 1.25, codigo: "041", nombre: "Fashion Azul Rey" },
      { x: 425, y: 30, z: -2, largoCm: 37, radioCm: 12, vueltas: 1.5, codigo: "932", nombre: "Reflex Verde Aurora" },
      { x: 490, y: 160, z: 6, largoCm: 25, radioCm: 11, vueltas: 2, codigo: "015", nombre: "Fashion Rojo" },
    ],
  }),
}));
const idea330 = idea("colgante-nemo", "Colgante Nemo: racimo de colores sobre globo naranja", escena330,
  "Igual: el colgante de techo de ~1,7 m con el racimo de 8 R-12 contados en su sitio (3 Fashion Rojo, 3 Neón Verde, 1 Fashion Azul Rey y 1 Reflex Verde Aurora), el globo naranja grande colgado debajo con el nudo arriba y los 5 rizos de T-260 (verde, naranja, azul, verde azulado y rojo) que salen del racimo. Colores medidos en una foto muy saturada (no publica productos): naranja #ff9501 → 061 (ΔE 25: el más cercano), verde neón #77da07 → 230, verde azulado #007d7b → 932, azul de los rizos #0082fa → 041. Distinto: la clasificación decía R-24, pero por la proporción con los tubitos (5 cm) el de abajo mide ~85 cm: va un R-36; las manchas turquesa impresas de los R-12 (el «Nemo») no están en la tienda: van lisos; los rizos son tirabuzones parejos (en la foto, lazos sueltos de distinta forma).");

/**
 * 356. Foto 740 × 570: el amarillo de abajo mide 247 px y los R-12 de estrellas 70–100 px; los T-260 verdes ~15 px (≈ 4,5
 * cm): 3,3 px/cm, así que el de abajo es un R-36 a ~75 cm y los del racimo R-12 de 21 a 30 cm. La fila 553 a 110 cm, el
 * eje en x = 357, de un techo de 3 m. Racimo de 7 R-12 con estrellas blancas: 1 azul caribe, 2 azules, 2 fucsia y 2
 * verde neón; 4 rizos de T-260 verde.
 */
const escena356 = perezoso((): Escena => ({
  sala: sala(300, 260, 300, SALA_BLANCA),
  nodos: colgante({
    px: foto(3.3, 357, 553, 110), escala: 3.3, arribaPx: 20,
    grande: { xPx: 357, yPx: 427, g: R("R-36", 75, "020"), nombre: "R-36 Fashion Amarillo (abajo)" },
    racimo: [
      { x: 285, y: 100, z: -6, dPx: 100, codigo: "038", nombre: "Fashion Azul Caribe" },
      { x: 405, y: 100, z: -6, dPx: 95, codigo: "220", nombre: "Neón Amarillo" },
      { x: 330, y: 190, z: 8, dPx: 92, codigo: "040", nombre: "Fashion Azul" },
      { x: 262, y: 215, z: -2, dPx: 80, codigo: "012", nombre: "Fashion Fucsia" },
      { x: 300, y: 262, z: 8, dPx: 85, codigo: "012", nombre: "Fashion Fucsia" },
      { x: 395, y: 262, z: 8, dPx: 80, codigo: "040", nombre: "Fashion Azul" },
      { x: 435, y: 205, z: -4, dPx: 70, codigo: "220", nombre: "Neón Amarillo" },
    ],
    rizos: [
      { x: 285, y: 20, z: 6, largoCm: 36, radioCm: 13, vueltas: 1, codigo: "530", nombre: "Metal Verde" },
      { x: 275, y: 120, z: 10, largoCm: 39, radioCm: 13, vueltas: 1, codigo: "530", nombre: "Metal Verde" },
      { x: 440, y: 40, z: 4, largoCm: 45, radioCm: 15, vueltas: 1.5, codigo: "530", nombre: "Metal Verde" },
      { x: 480, y: 230, z: 6, largoCm: 30, radioCm: 8, vueltas: 1.5, codigo: "530", nombre: "Metal Verde" },
    ],
  }),
}));
const idea356 = idea("columna-colgante-de-estrellas", "Columna colgante de estrellas", escena356,
  "Igual: el colgante de techo de ~1,6 m con el racimo de 7 R-12 contados en su sitio (1 Fashion Azul Caribe, 2 Fashion Azul, 2 Fashion Fucsia y 2 Neón Amarillo), el globo amarillo grande colgado debajo con el nudo arriba y los 4 rizos de T-260 verde. Colores medidos (no publica productos): amarillo #dfdd00 → 020, «verde lima» de la foto #c5cc08 → Neón Amarillo 220 (ΔE 12; el Fashion Verde Lima queda más lejos), fucsia → 012, azules → 038 y 040, verde de los rizos #00892b → Metal Verde 530. Distinto: la clasificación decía R-24, pero por la proporción con los tubitos el de abajo mide ~75 cm: va un R-36; las estrellas blancas impresas no están en la tienda sobre esos colores (solo sobre cristal): van lisos; los rizos son tirabuzones parejos (en la foto, lazos y curvas de distinta forma).");

// ==========================================================================================================
// 334 · Columna 15 años
// ==========================================================================================================

/**
 * Foto 740 × 570: el T-260 blanco de la espiral mide ~12 px (≈ 5 cm) y los R-5 del cuello ~30 px (≈ 12 cm): 2,5 px/cm,
 * piso en y = 550, eje en x = 350. Columna en reloj de arena de 14 niveles, con los colores en ciclo (amarillo, rojo,
 * azul, verde, violeta, naranja) de abajo arriba: 5 niveles que se afinan (R-12 de 23,5 y 21,5 cm, R-9 de 19,5, 18 y
 * 16,5), un cuello de 7 niveles de R-5 a ~11 cm (¡a solo ~6 cm uno de otro!), y arriba un R-9 amarillo de 17 y uno rojo
 * de 19; un T-260 blanco en espiral envuelve la parte de abajo (~1¼ vueltas) y otro la de arriba; el «15» metalizado
 * (~73 cm) remata. Alto total ~2,15 m.
 */
const escena334 = perezoso((): Escena => {
  const px = foto(2.5, 350, 550);
  const N = (id: string, f: string, d: number, codigo: string, yPx: number, giro: GiroNivel): NivelFoto => ({ id, g: R(f, d, codigo), colores: [codigo, codigo, codigo, codigo], yPx, giro });
  const col = columnaFoto(px, [
    N("amarillo-abajo", "R-12", 23.5, "021", 521, 45), N("rojo-abajo", "R-12", 21.5, "015", 474, 0), N("azul-abajo", "R-9", 19.5, "041", 440, 45),
    N("verde-abajo", "R-9", 18, "032", 407, 0), N("violeta-abajo", "R-9", 16.5, "051", 380, 45),
    N("naranja-cuello-1", "R-5", 11.5, "061", 357, 0), N("amarillo-cuello", "R-5", 11, "021", 343, 45), N("rojo-cuello", "R-5", 11, "015", 327, 0),
    N("azul-cuello", "R-5", 11, "041", 312, 45), N("verde-cuello", "R-5", 11, "032", 297, 0), N("violeta-cuello", "R-5", 11, "051", 283, 45),
    N("naranja-cuello-2", "R-5", 11.5, "061", 265, 0), N("amarillo-arriba", "R-9", 17, "021", 240, 45), N("rojo-arriba", "R-9", 19, "015", 205, 0),
  ], 142);
  const nodos = [...col.nodos];
  const BLANCO = "005";
  nodos.push(colgar({ id: "espiral-abajo", nombre: "T-260 Fashion Blanco en espiral (abajo)", pieza: tirabuzon("T-260", 4.8, BLANCO, 1.25, 21, 27, 53, 200), padre: col.vara.padre, origen: v(0, px(0, 375).y, 0), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "espiral-arriba", nombre: "T-260 Fashion Blanco en espiral (arriba)", pieza: tirabuzon("T-260", 4.8, BLANCO, 0.75, 22, 24, 26, 30), padre: col.vara.padre, origen: v(0, px(0, 195).y, 0), normal: AL_FRENTE }).nodo);
  const numero = (valor: number): Pieza => ({ tipo: "metalizado", metalizado: { forma: { tipo: "numero", valor }, pulgadas: 29, color: "plata", impreso: { dibujo: "estrellas", hex: "#e23a2c" } } });
  nodos.push(metalEn("uno", "Número 1 metalizado plata con estrellas (29\")", col.vara.padre, numero(1), px(311, 196, -3)));
  nodos.push(metalEn("cinco", "Número 5 metalizado plata con estrellas (29\")", col.vara.padre, numero(5), px(407, 196, -3)));
  return { sala: sala(280, 240, 260, SALA_BLANCA), nodos };
});
const idea334 = idea("columna-15-anos", "Columna 15 años en reloj de arena con el 15", escena334,
  "Igual: los 14 niveles contados en el ciclo de colores de la foto (amarillo, rojo, azul, verde, violeta, naranja): dos de R-12 (23,5 y 21,5 cm) y tres de R-9 que se afinan, el cuello de 7 niveles de R-5 y arriba un R-9 amarillo y uno rojo, cada nivel a la altura medida de su centro (2,5 px/cm); los dos T-260 blancos en espiral (abajo y arriba) y el «15» metalizado encima: ~2,15 m. Colores medidos (no publica productos): amarillo #edcc0e → Amarillo Miel 021, rojo → 015, azul #004488 → Azul Rey 041, verde #017138 → Verde Selva 032, violeta → Fashion Violeta 051 (medido en sombra, #55478a), naranja → 061. Distinto: el cuello de la foto va mucho más apretado que el paso del taller (~6 cm entre niveles de R-5 de 11 cm, contra 8,8): el 3D respeta la medida y los cuartetos se meten unos en otros; los globos de la foto llevan destellos blancos impresos que la tienda no vende: van lisos; el «15» de la foto es un metalizado multicolor de estrellas que no está en el catálogo: van el 1 y el 5 genéricos en plata con estrellas rojas, de 29\" (~73 cm medidos; la tienda los vende de 16\" y 32\").");

// ==========================================================================================================
// 335 · Columna Angry Birds
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 miden ~86 px (3 de frente: 191 px = 2,24 diámetros; 2 de frente: 165 px = 1,88): 3,07
 * px/cm a 28 cm, piso en y = 538 (bajo el centro del primer nivel), eje en x = 368. Seis niveles en espiral de color:
 * verde, verde y azul caribe, azul caribe, azul caribe y rojo, rojo, y rojo con la bomba negra; ~19 cm entre niveles
 * (el taller pone 22,4). Encima, la cabeza de Angry Bird metalizada (~56 × 52 cm).
 */
const escena335 = perezoso((): Escena => {
  const px = foto(3.07, 368, 538);
  const G = R("R-12", 28, "029");
  const V = "029", A = "038", Rj = "015", N = "080";
  const col = columnaFoto(px, [
    { id: "verde", g: G, colores: [V, V, V, V], yPx: 495, giro: 45 },
    { id: "verde-azul", g: G, colores: [V, A, A, V], yPx: 445, giro: 0 },
    { id: "azul", g: G, colores: [A, A, A, A], yPx: 380, giro: 45 },
    { id: "azul-rojo", g: G, colores: [A, Rj, Rj, A], yPx: 325, giro: 0 },
    { id: "rojo", g: G, colores: [Rj, Rj, Rj, Rj], yPx: 265, giro: 45 },
    { id: "rojo-bomba", nombre: "Cuarteto de R-12 Fashion Rojo con la bomba Fashion Negro", g: G, colores: [Rj, N, Rj, Rj], yPx: 205, giro: 0 },
  ], 116);
  const nodos = [...col.nodos];
  nodos.push(metalEn("pajaro", "Cabeza de Angry Bird metalizada (redondo rojo de 22\")", col.vara.padre, metal({ tipo: "redondo" }, 22, "rojo"), v(0, 113, -4)));
  return { sala: sala(260, 240, 240, SALA_BLANCA), nodos };
});
const idea335 = idea("columna-angry-birds", "Columna Angry Birds", escena335,
  "Igual: los 6 niveles de R-12 a 28 cm (3,07 px/cm) con la espiral de colores de la foto —verde, verde y azul caribe, azul caribe, azul caribe y rojo, rojo, y el de arriba rojo con la bomba negra a la derecha— cada uno a la altura medida (~19 cm entre niveles; el paso del taller es 22,4: el 3D respeta la foto) y el metalizado del pájaro encima: ~1,65 m. Colores medidos (no publica productos): verde #01c35c → Verde Trébol 029, azul #00b8d8 → Azul Caribe 038, rojo #fe2d42 → 015. Distinto: la cabeza de Angry Bird metalizada no está en el catálogo: va un redondo rojo genérico de 22\" (~51 cm; la foto ~56 × 52 cm) sin la cara, el pico ni el copete; la bomba negra de la foto es un poco más chica que los rojos y aquí es un R-12 igual.");

// ==========================================================================================================
// 338 · Columna araña 2
// ==========================================================================================================

/**
 * Foto 740 × 570: el R-12 naranja de abajo al frente mide ~95 px (≈ 28 cm): 3,4 px/cm, piso en y = 552, eje en x = 360.
 * Cinco niveles de R-12 negros y naranjas impresos en espiral (~21 cm entre niveles); encima la araña: cuerpo negro de
 * ~35 cm (R-18) con la cabeza de ojos verdes adelante (R-12 de ~24 cm) y 8 patas de T-260 negro (~55 cm); dos rizos de
 * T-260 violeta: uno a la derecha (de 109 a 61 cm) y uno a la izquierda abajo (de 56 a 26 cm).
 */
const escena338 = perezoso((): Escena => {
  const px = foto(3.4, 360, 552);
  const G = R("R-12", 28, "080");
  const O = "061", N = "080";
  const impresos: ImpresoEnPieza[] = [{ impresoId: HALLOWEEN_NARANJA, codigo: O }];
  const col = columnaFoto(px, [
    { id: "nivel-1", g: G, colores: [N, O, N, O], yPx: 505, giro: 45, impresos },
    { id: "nivel-2", g: G, colores: [O, N, O, N], yPx: 430, giro: 0, impresos },
    { id: "nivel-3", g: G, colores: [O, N, O, N], yPx: 362, giro: 45, impresos },
    { id: "nivel-4", g: G, colores: [N, O, N, O], yPx: 290, giro: 0, impresos },
    { id: "nivel-5", g: G, colores: [N, O, N, O], yPx: 210, giro: 45, impresos },
  ], 128);
  const nodos = [...col.nodos];
  const arana: PropiedadesArana = { cuerpo: R("R-18", 35, "080"), cabeza: R("R-12", 24, "080"), ojos: { hexIris: "#58b947" }, patas: { formatoId: "T-260", grosorCm: 4.5, codigo: "080", largoCm: 55, estilo: "articuladas" }, giroGrados: 0 };
  nodos.push(colgar({ id: "arana", nombre: "Araña negra de 8 patas (cuerpo R-18 y cabeza R-12)", pieza: deco({ tipo: "arana", propiedades: arana }), padre: col.vara.padre, origen: v(0, 130, -4), normal: ARRIBA, giroGrados: -90 }).nodo);
  nodos.push(colgar({ id: "rizo-derecha", nombre: "Rizo de T-260 Fashion Violeta (derecha)", pieza: tirabuzon("T-260", 4.5, "051", 1, 11, 11, 48, 90), padre: col.vara.padre, origen: v(px(430, 0).x, px(0, 180).y, 30), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "rizo-izquierda", nombre: "Rizo de T-260 Fashion Violeta (izquierda)", pieza: tirabuzon("T-260", 4.5, "051", 1, 12, 12, 30, 270), padre: col.vara.padre, origen: v(px(295, 0).x, px(0, 362).y, 30), normal: AL_FRENTE }).nodo);
  return { sala: sala(280, 240, 240, SALA_BLANCA), nodos };
});
const idea338 = idea("columna-arana-2", "Columna araña 2: negra y naranja con araña", escena338,
  "Igual: los 5 niveles de R-12 a 28 cm (3,4 px/cm) con 2 negros y 2 naranjas en espiral, en el orden visto de frente y a la altura medida, la araña encima (cuerpo R-18 negro, cabeza R-12 con ojos verdes adelante y 8 patas articuladas de T-260 negro de ~55 cm) y los dos rizos de T-260 violeta: ~1,5 m. Colores medidos (no publica productos): negro → 080, violeta #6236da → Fashion Violeta 051 (ΔE 41: el violeta de la foto es más azulado que todos los de la tabla). Distinto: los naranjas de la foto llevan un impreso de murciélagos y letras negras que no está en la tienda: va el «Happy Halloween» naranja (2 caras, sobre Fashion Naranja 061), el más parecido del catálogo; el naranja medido #fd9442 queda más cerca del Neón Naranja, pero el impreso solo se vende sobre el 061; la boca roja de la araña no se dibuja y sus patas van en el plano del cuerpo (en la foto caen un poco); los rizos son tirabuzones parejos (en la foto, curvas abiertas).");

// ==========================================================================================================
// 341 y 342 · Columnas Baby Shower luna (niña y niño: el mismo armado)
// ==========================================================================================================

/**
 * Foto 740 × 570: cada globo largo mide ~42 px de grueso (un Link-O-Loon 660 a ~15 cm): 2,8 px/cm, piso en y = 548,
 * eje en x = 357 (niña) o 363 (niño). Base de 3 R-12 impresos (~21 cm; se ven tres: izquierda, frente y derecha), dos
 * Link-O-Loon 660 impresos «Baby Shower» arqueados de 25 a 122 cm (juntos arriba y abajo; ~44 cm de ancho en el medio),
 * cuatro mariposas blancas en el hilo del centro, un collar de R-5 blancos y la luna con gorro metalizada (~64 cm).
 */
function escenaBabyShower(o: { base: Cuatro; lol: string; mariposasPx: readonly number[] }): Escena {
  const px = foto(2.8, 0, 548);
  const col = columnaFoto(px, [
    { id: "base", nombre: "Base: cuarteto de R-12 impresos (se ven tres)", g: R("R-12", 21, o.base[0]), colores: o.base, yPx: 515, giro: 45 },
    { id: "collar", nombre: "Collar de 4 R-5 Fashion Blanco", g: R("R-5", 8, "005"), colores: ["005", "005", "005", "005"], yPx: 200, giro: 45 },
  ], 124, "#f4f4f4", "Hilo del centro (y varilla)", 0.3);
  const nodos = [...col.nodos];
  // Los dos Link-O-Loon: arcos de circunferencia de 162 cm de radio en el plano de frente, juntos en sus puntas.
  const abajo = px(0, 478).y, arriba = px(0, 205).y;
  const cuerda = arriba - abajo, flecha = 7.5, medio = 14.75;
  const radio = r2((cuerda * cuerda / 4 + flecha * flecha) / (2 * flecha));
  const angulo = r2((Math.asin(cuerda / 2 / radio) * 180) / Math.PI);
  const arcos = figura({
    queEs: "two long pink balloons bowed into a lens",
    accesorios: [{ en: "base", par: true, corrimientoCm: [r2(medio - radio), 0, 0], forma: { tipo: "aro", tubito: { formatoId: "LOL-660", grosorCm: 14.5, codigo: o.lol }, radioCm: radio, plano: "frente", desdeGrados: -angulo, hastaGrados: angulo } }],
  });
  nodos.push(colgar({ id: "globos-largos", nombre: `Dos Link-O-Loon 660 ${nombreColor("LOL-660", o.lol)} arqueados («Baby Shower» en la foto)`, pieza: arcos, padre: col.vara.padre, origen: origenCentrado(arcos, v(0, r2((abajo + arriba) / 2), 0), AL_FRENTE), normal: AL_FRENTE }).nodo);
  o.mariposasPx.forEach((y, k) => nodos.push(colgar({
    id: `mariposa-${k + 1}`, nombre: `Mariposa de T-160 Fashion Blanco en el hilo (${k + 1})`,
    pieza: mono({ formatoId: "T-160", grosorCm: 2, codigo: "005", lazosPorLado: 1, largoLazoCm: 6, anchoLazoCm: 4.5, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: null }),
    padre: col.vara.padre, origen: v(0, px(0, y).y, 1), normal: AL_FRENTE,
  }).nodo));
  nodos.push(metalEn("luna", "Luna con gorro metalizada (luna dorada de 27\")", col.vara.padre, metal({ tipo: "luna" }, 27, "oro"), v(0, r2(px(0, 200).y + 2), -2)));
  return { sala: sala(260, 240, 240, SALA_BLANCA), nodos };
}

const escena341 = perezoso(() => escenaBabyShower({ base: ["009", "038", "071", "009"], lol: "009", mariposasPx: [290, 340, 395, 435] }));
const idea341 = idea("columna-baby-shower-nina-luna", "Columna Baby Shower niña con luna", escena341,
  "Igual: la base de R-12 de ~21 cm (rosado a la izquierda, azul caribe al frente, arena a la derecha), los dos Link-O-Loon 660 Fashion Rosado arqueados de 25 a 122 cm (~44 cm de ancho al medio; 2,8 px/cm), las 4 mariposas blancas del hilo del centro, el collar de R-5 blancos y la luna metalizada encima: ~1,9 m. Colores medidos (no publica productos): rosado #e7cae5 → 009, azul caribe #1ac1c0 → 038, arena #d6d1b2 → 071. Distinto: el «Baby Shower» impreso de los globos largos y las estrellas blancas de la base no están en la tienda (ni el visor imprime sobre tubos): van lisos; de la base se ven 3 globos (el cuarto, detrás, se pone rosado); la luna con gorro de colores y su estrellita no están en el catálogo: va una luna dorada genérica de 27\" (~63 cm; la foto ~64 cm); las mariposas son lazos de T-160 (en la foto, figuritas blancas que no se distinguen bien).");

const escena342 = perezoso(() => escenaBabyShower({ base: ["037", "126", "038", "037"], lol: "040", mariposasPx: [315, 350, 375, 405] }));
const idea342 = idea("columna-baby-shower-nino-luna", "Columna Baby Shower niño con luna", escena342,
  "Igual: el mismo armado de la #341 con sus colores: base de R-12 de ~21 cm (aguamarina a la izquierda, té verde al frente, azul caribe a la derecha), los dos Link-O-Loon 660 Fashion Azul arqueados de 25 a 122 cm, las 4 mariposas blancas del hilo, el collar de R-5 blancos y la luna metalizada: ~1,9 m. Colores medidos (no publica productos): azul #049fda → 040, aguamarina #6bccc0 → 037, crema verdoso #b7ceb1 → Pastel Dusk Té Verde 126, azul caribe #31c5e3 → 038. Distinto: el «Baby Shower» impreso y las estrellas de la base no están en la tienda: van lisos; el cuarto globo de la base (detrás) se pone aguamarina; la luna con gorro no está en el catálogo: va una luna dorada genérica de 27\"; las mariposas son lazos de T-160.");

// ==========================================================================================================
// 344 · Columna bautismo
// ==========================================================================================================

/**
 * Foto 740 × 570 (borrosa): los R-12 miden ~60 px y el metalizado redondo 115 px (≈ 42 cm): 2,65 px/cm, piso en y =
 * 550, eje en x = 362. Ocho niveles de R-12 a ~22 cm en bloques de dos: azul, cristal, azul satinado y azul (se ven 5
 * globos en cada bloque: dos niveles), a solo ~13 cm uno de otro; del amarre de arriba (~1,09 m) sale el ramo de helio:
 * 3 R-12 (azul, y dos azul satinado) y el metalizado redondo azul (~42 cm) arriba.
 */
const escena344 = perezoso((): Escena => {
  const px = foto(2.65, 362, 550);
  const N = (id: string, codigo: string, yPx: number, giro: GiroNivel): NivelFoto => ({ id, g: R("R-12", 22, codigo), colores: [codigo, codigo, codigo, codigo], yPx, giro });
  const col = columnaFoto(px, [
    N("azul-1", "040", 520, 45), N("azul-2", "040", 487, 0), N("cristal-1", "390", 455, 45), N("cristal-2", "390", 423, 0),
    N("satin-1", "440", 392, 45), N("satin-2", "440", 358, 0), N("azul-3", "040", 322, 45), N("azul-4", "040", 290, 0),
  ], 106);
  const amarre = px(362, 262, 0);
  const g = (id: string, nombre: string, codigo: string, x: number, y: number, z: number, d: number): GloboHelio =>
    ({ id, nombre, pieza: globo(R("R-12", d, codigo)), centro: px(x, y, z), direccion: subiendo(amarre, px(x, y, z), 0.5) });
  const helio = ramo({
    id: "ramo", nombre: "Peso y cintas del ramo", amarre, cinta: "#cfe8f3", peso: null,
    globos: [
      g("helio-azul", "R-12 Fashion Azul de helio (izquierda)", "040", 330, 150, 2, 26),
      g("helio-satin-arriba", "R-12 Satín Azul de helio (derecha)", "440", 405, 140, -8, 26),
      g("helio-satin-abajo", "R-12 Satín Azul de helio (abajo)", "440", 385, 212, 8, 25),
    ],
    metalizados: [{ id: "metalizado", nombre: "Metalizado redondo azul de 18\" (bautizo en la foto)", pieza: metal({ tipo: "redondo" }, 18, "azul"), base: px(368, 105, -12) }],
  });
  return { sala: sala(260, 240, 240, SALA_BLANCA), nodos: [...col.nodos, ...helio.nodos] };
});
const idea344 = idea("columna-bautismo", "Columna bautismo azul con ramo", escena344,
  "Igual: los 8 niveles de R-12 a ~22 cm en bloques de dos (azul, cristal, azul satinado y azul; 2,65 px/cm) hasta ~1,1 m y el ramo de helio amarrado arriba con sus 3 R-12 (uno azul y dos azul satinado) y el metalizado redondo azul de 18\" encima: ~1,9 m. Colores medidos (no publica productos): azul #01acdf → Fashion Azul 040, satinado #a0d4e2 → Satín Azul 440. Distinto: los niveles de la foto van a ~13 cm uno de otro (el paso del taller sería 17,6): el 3D respeta la medida y los cuartetos se meten unos en otros; los «cristal» miden #7badaf (Silk Verde Menta 826, ΔE 5) por el fondo que se ve a través: van Cristal Transparente 390; el metalizado de la foto lleva un dibujo de bautizo que no se lee y no está en el catálogo: va un redondo azul genérico; la clasificación habla de 4 R-12 en el ramo y en la foto se ven 3.");

// ==========================================================================================================
// 353 · Columna cebra fucsia
// ==========================================================================================================

/**
 * Foto 740 × 570 (pequeña y borrosa): los corazoncitos fucsia miden ~30 px (un C-6 a ~14 cm) y los T-260 del penacho ~10
 * px: 2,1 px/cm, así que los globos de la columna (~46 px) son R-12 a ~22 cm; piso en y = 550, eje en x = 381. Nueve
 * niveles en espiral (~18 cm entre niveles): los impares con dos fucsia y dos negros, los pares con dos cristal de
 * escarcha plateada y dos negros; 6 corazoncitos fucsia pegados (2 y 1 a la derecha, 1 al frente y 2 a la izquierda) y
 * el penacho de 9 T-260 (negros, blancos y rosados) de ~90 cm.
 */
const escena353 = perezoso((): Escena => {
  const px = foto(2.1, 381, 550);
  const G = R("R-12", 22, "080");
  const F = "012", B = "080", S = "390";
  const impresos: ImpresoEnPieza[] = [{ impresoId: GRAFFITI_CRISTAL, codigo: S }];
  const FILAS: ReadonlyArray<[Cuatro, number, GiroNivel]> = [
    [[F, B, F, B], 525, 45], [[S, B, S, B], 490, 0], [[B, F, B, F], 450, 45], [[B, S, B, S], 415, 0], [[F, B, F, B], 375, 45],
    [[S, B, S, B], 335, 0], [[B, F, B, F], 300, 45], [[B, S, B, S], 260, 0], [[F, B, F, B], 225, 45],
  ];
  const col = columnaFoto(px, FILAS.map(([colores, yPx, giro], k) => ({ id: `nivel-${k + 1}`, g: G, colores, yPx, giro, ...(colores.includes(S) ? { impresos } : {}) })), 165);
  const nodos = [...col.nodos];
  const CORAZONES: ReadonlyArray<[number, number]> = [[432, 265], [450, 285], [430, 337], [365, 365], [310, 420], [300, 442]];
  CORAZONES.forEach(([x, y], k) => {
    const c = px(x, y);
    const z = r2(Math.sqrt(Math.max(16, 30 * 30 - c.x * c.x)));
    nodos.push(globoEn(`corazon-${k + 1}`, `Corazón C-6 Fashion Fucsia pegado (${k + 1})`, col.vara.padre, globo(R("C-6", 14, "012")), v(c.x, c.y, z), v(c.x, 6, z)));
  });
  nodos.push(colgar({ id: "penacho", nombre: "Penacho de 9 T-260 negros, blancos y rosados", pieza: rizo({ forma: "penacho", formatoId: "T-260", grosorCm: 4.5, codigos: ["080", "005", "009"], rizos: 9, vueltas: 1.2, radioInicialCm: 1.5, radioFinalCm: 6, largoCm: 88, inclinacionGrados: 0, aperturaGrados: 28 }), padre: col.vara.padre, origen: v(0, px(0, 205).y, 0), normal: AL_FRENTE }).nodo);
  return { sala: sala(280, 240, 280, SALA_BLANCA), nodos };
});
const idea353 = idea("columna-cebra-fucsia", "Columna cebra fucsia con penacho", escena353,
  "Igual: los 9 niveles de R-12 a ~22 cm (2,1 px/cm por los corazoncitos y los tubitos) en el orden de colores visto de frente —los impares con dos Fashion Fucsia y dos Fashion Negro, los pares con dos cristal de escarcha y dos negros—, cada uno a la altura medida (~18 cm entre niveles), los 6 corazoncitos C-6 fucsia contados en su sitio y el penacho de 9 T-260 (negros, blancos y rosados) de ~90 cm: ~2,5 m. Colores medidos (no publica productos): fucsia #c1256a → 012, rosado de los tubitos #fcbbd2 → 009. Distinto: los cristales de la foto llevan una escarcha plateada (como cebra) que no está en la tienda: va el «Graffiti Invierno» cristal (escarcha blanca en remolinos), el más parecido; los fucsia llevan un dibujo de cebra más oscuro que no se vende: van lisos; la clasificación cuenta 4 corazones y en la foto hay 6; el penacho es un cono parejo (en la foto, tubitos ondulados de distinto largo).");

// ==========================================================================================================
// 354 · Columna cebra
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 miden ~87 px (3 de frente: 207 px = 2,24 diámetros; 2 de frente: 171 px = 1,88): 3,1 px/cm
 * a 28 cm, piso en y = 558, eje en x = 369. Seis niveles en espiral de dos negros y dos blancos (~18 cm entre niveles; el
 * taller pondría 22,4) y la cabeza de cebra metalizada (~59 × 39 cm) encima.
 */
const escena354 = perezoso((): Escena => {
  const px = foto(3.1, 369, 558);
  const G = R("R-12", 28, "005");
  const W = "005", B = "080";
  const col = columnaFoto(px, [
    { id: "nivel-1", g: G, colores: [W, B, W, B], yPx: 515, giro: 0 },
    { id: "nivel-2", g: G, colores: [B, W, B, W], yPx: 455, giro: 45 },
    { id: "nivel-3", g: G, colores: [B, W, B, W], yPx: 405, giro: 0 },
    { id: "nivel-4", g: G, colores: [W, B, W, B], yPx: 352, giro: 45 },
    { id: "nivel-5", g: G, colores: [W, B, W, B], yPx: 300, giro: 0 },
    { id: "nivel-6", g: G, colores: [B, W, B, W], yPx: 240, giro: 45 },
  ], 112);
  const nodos = [...col.nodos];
  const cebra: Pieza = { tipo: "metalizado", metalizado: { forma: { tipo: "redondo" }, pulgadas: 24, color: "blanco", impreso: { dibujo: "rayas", hex: "#141414" } } };
  nodos.push(metalEn("cebra", "Cabeza de cebra metalizada (redondo blanco de rayas, 24\")", col.vara.padre, cebra, v(0, 108, -4)));
  return { sala: sala(260, 240, 240, SALA_BLANCA), nodos };
});
const idea354 = idea("columna-cebra", "Columna cebra en espiral", escena354,
  "Igual: la columna en espiral de 6 niveles de R-12 a 28 cm (3,1 px/cm) con dos Fashion Negro y dos Fashion Blanco por nivel, en el orden visto de frente y a la altura medida (~18 cm entre niveles, contra 22,4 del paso del taller: el 3D respeta la foto), y el metalizado de la cebra encima, como dice la idea («arma una columna en espiral y en la parte de arriba coloca un globo metalizado en forma de cebra»): ~1,65 m. Distinto: la cabeza de cebra no está en el catálogo: va un redondo blanco genérico de 24\" con rayas negras (~56 cm; la foto mide ~59 × 39 cm: la cabeza es más angosta), sin orejas, ojos ni hocico; los blancos de la foto se ven grisáceos por la sombra (#c0d1d6) y van en Fashion Blanco 005.");

// ==========================================================================================================
// 363 · Columna cupcake
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 de lunares de la base miden ~78 px (≈ 28 cm) y los R-5 violeta ~30 px: 2,8 px/cm, piso en y
 * = 548, eje en x = 369. De abajo arriba: base de 4 R-12 (turquesa, fucsia neón, amarillo y turquesa detrás), 4 R-5
 * violeta, el tallo de 2 T-260 amarillos (de 33 a 80 cm) con cuatro anillos (burbujitas rosadas, burbujitas verdes, un
 * aro blanco grueso y burbujitas rosadas), 4 R-5 violeta, un cuarteto de R-12 blancos de confites y el metalizado del
 * cupcake «Happy Birthday!» (~45 cm) con su vela «1» (~33 cm).
 */
const escena363 = perezoso((): Escena => {
  const px = foto(2.8, 369, 548);
  const col = columnaFoto(px, [
    { id: "base", nombre: "Base: cuarteto de R-12 de lunares (turquesa, fucsia y amarillo)", g: R("R-12", 28, "040"), colores: ["040", "212", "220", "040"], yPx: 505, giro: 0 },
    { id: "violetas-abajo", g: R("R-5", 11, "051"), colores: ["051", "051", "051", "051"], yPx: 470, giro: 45 },
    { id: "violetas-arriba", g: R("R-5", 11, "051"), colores: ["051", "051", "051", "051"], yPx: 310, giro: 45 },
    { id: "confites", nombre: "Cuarteto de R-12 de confites (blancos en la foto)", g: R("R-12", 28, "005"), colores: ["005", "005", "005", "005"], yPx: 280, giro: 0, impresos: [{ impresoId: CONFETI_PASTEL, codigo: "005" }] },
  ], 150);
  const nodos = [...col.nodos];
  const AMARILLO = { formatoId: "T-260", grosorCm: 4.8, codigo: "020" };
  nodos.push(varita("tallo-izquierdo", "Tallo: T-260 Fashion Amarillo (izquierdo)", col.vara.padre, AMARILLO, v(-2.6, px(0, 455).y, 0), v(-2.6, px(0, 325).y, 0)));
  nodos.push(varita("tallo-derecho", "Tallo: T-260 Fashion Amarillo (derecho)", col.vara.padre, AMARILLO, v(2.6, px(0, 455).y, 0), v(2.6, px(0, 325).y, 0)));
  const cuentas = (formatoId: string, codigo: string, cantidad: number): Pieza => rizo({ forma: "burbujas", formatoId, grosorCm: 2.5, codigos: [codigo], largosCm: [3], recorrido: "aro", cantidad });
  nodos.push(colgar({ id: "cuentas-rosadas-abajo", nombre: "Anillo de burbujitas de T-160 Fashion Rosado (abajo)", pieza: cuentas("T-160", "009", 15), padre: col.vara.padre, origen: v(0, px(0, 397).y, 0), normal: ARRIBA }).nodo);
  nodos.push(colgar({ id: "cuentas-verdes", nombre: "Anillo de burbujitas de T-160 Fashion Verde Trébol", pieza: cuentas("T-160", "029", 27), padre: col.vara.padre, origen: v(0, px(0, 381).y, 0), normal: ARRIBA }).nodo);
  nodos.push(colgar({ id: "aro-blanco", nombre: "Aro de T-360 Fashion Blanco", pieza: anillo({ formatoId: "T-360", grosorCm: 7, codigo: "005" }, 11.5), padre: col.vara.padre, origen: origenCentrado(anillo({ formatoId: "T-360", grosorCm: 7, codigo: "005" }, 11.5), v(0, px(0, 370).y, 0), ARRIBA), normal: ARRIBA }).nodo);
  nodos.push(colgar({ id: "cuentas-rosadas-arriba", nombre: "Anillo de burbujitas de T-160 Fashion Rosado (arriba)", pieza: cuentas("T-160", "009", 19), padre: col.vara.padre, origen: v(0, px(0, 355).y, 0), normal: ARRIBA }).nodo);
  const cupcake: Pieza = { tipo: "metalizado", metalizado: { forma: { tipo: "redondo" }, pulgadas: 19, color: "rojo", impreso: { dibujo: "texto", texto: "Happy\nBirthday!", hex: "#ffffff" } } };
  nodos.push(metalEn("cupcake", "Cupcake metalizado «Happy Birthday!» (redondo rojo de 19\")", col.vara.padre, cupcake, v(0, px(0, 250).y, -4)));
  const vela: Pieza = { tipo: "metalizado", metalizado: { forma: { tipo: "numero", valor: 1 }, pulgadas: 13, color: "blanco", impreso: { dibujo: "lunares", hex: "#e0397f" } } };
  nodos.push(metalEn("vela", "Vela «1» metalizada blanca de lunares (13\")", col.vara.padre, vela, v(0, px(0, 125).y, -4)));
  return { sala: sala(260, 240, 240, SALA_BLANCA), nodos };
});
const idea363 = idea("columna-cupcake", "Columna cupcake Happy Birthday con vela 1", escena363,
  "Igual: de abajo arriba y a las alturas medidas (2,8 px/cm): la base de 4 R-12 (Fashion Azul al frente y detrás, Neón Fucsia y Neón Amarillo), 4 R-5 Fashion Violeta, el tallo de 2 T-260 Fashion Amarillo con sus cuatro anillos (burbujitas rosadas, verdes, el aro blanco grueso y burbujitas rosadas), 4 R-5 violeta, el cuarteto de R-12 de confites y el cupcake metalizado «Happy Birthday!» con la vela «1» encima: ~1,9 m. Colores medidos (no publica productos): turquesa #01bae6 → 040, fucsia #fe58c4 → Neón Fucsia 212, amarillo #cecc53 → Neón Amarillo 220, violeta → 051, tallo #dfd700 → 020. Distinto: los lunares blancos de la base no se venden en esos colores (la tienda solo los tiene sobre rojo y verde lima): van lisos; los R-12 blancos de confites de colores van con el «Confetti multicolor pastel» de la tienda, que es cristal (390): el más parecido; el cupcake y su vela no están en el catálogo: van un redondo rojo genérico con «Happy Birthday!» y un «1» blanco de lunares, sin el betún amarillo ni la llama; los anillos de burbujitas son de T-160 (en la foto se ven cuentas de ese tamaño).");

// ==========================================================================================================
// 367 · Columna divertida emoji
// ==========================================================================================================

/**
 * Foto 740 × 570: el R-24 amarillo de arriba mide ~137 px (≈ 55 cm): 2,5 px/cm, piso en y = 556, eje en x = 370. De
 * abajo arriba: R-12 amarillos de emojis (25,5 cm), R-12 azul caribe (24), R-9 naranja (19), un cuello trenzado de 9
 * niveles de R-5 (fucsia, naranja, azul caribe y verde en espiral, a ~7 cm uno de otro), R-9 naranja (19,5), R-12 azul
 * caribe (22,5), R-12 amarillos de emojis (29) y el R-24 amarillo; 4 emojis «popó» de T-260 café pegados al cuello.
 */
const escena367 = perezoso((): Escena => {
  const px = foto(2.5, 370, 556);
  const N = (id: string, f: string, d: number, colores: Cuatro, yPx: number, giro: GiroNivel, nombre?: string): NivelFoto => ({ id, g: R(f, d, colores[0]), colores, yPx, giro, ...(nombre ? { nombre } : {}) });
  const uno = (c: string): Cuatro => [c, c, c, c];
  const ESPIRAL: Cuatro = ["012", "061", "038", "029"];
  const cuello = [410, 393, 377, 360, 343, 327, 310, 293, 277].map((y, k) => N(`cuello-${k + 1}`, "R-5", 11, ESPIRAL, y, k % 2 ? 45 : 0, `Cuarteto de R-5 fucsia, naranja, azul caribe y verde (cuello ${k + 1})`));
  const col = columnaFoto(px, [
    N("emojis-abajo", "R-12", 25.5, uno("021"), 520, 45, "Cuarteto de R-12 Fashion Amarillo Miel (emojis en la foto, abajo)"),
    N("azul-abajo", "R-12", 24, uno("038"), 473, 0), N("naranja-abajo", "R-9", 19, uno("061"), 436, 45), ...cuello,
    N("naranja-arriba", "R-9", 19.5, uno("061"), 255, 0), N("azul-arriba", "R-12", 22.5, uno("038"), 215, 45),
    N("emojis-arriba", "R-12", 29, uno("021"), 165, 0, "Cuarteto de R-12 Fashion Amarillo Miel (emojis en la foto, arriba)"),
  ], 175);
  const nodos = [...col.nodos];
  nodos.push(globoEn("remate", "R-24 Fashion Amarillo Miel (remate)", col.vara.padre, globo(R("R-24", 55, "021")), v(0, px(0, 72).y, 0), ARRIBA));
  const POPO: ReadonlyArray<[number, number, number, string]> = [[300, 290, 6, "izquierda arriba"], [300, 372, 6, "izquierda abajo"], [410, 275, 8, "derecha arriba"], [410, 385, 8, "derecha abajo"]];
  POPO.forEach(([x, y, z, lado], k) => nodos.push(colgar({ id: `popo-${k + 1}`, nombre: `Emoji popó de T-260 Fashion Café (${lado})`, pieza: tirabuzon("T-260", 4.5, "074", 2.5, 2, 7.5, 13, 60 * k), padre: col.vara.padre, origen: px(x, y, z), normal: AL_FRENTE }).nodo));
  return { sala: sala(260, 240, 260, SALA_BLANCA), nodos };
});
const idea367 = idea("columna-divertida-emoji", "Columna divertida emoji con popós", escena367,
  "Igual: los 15 niveles contados con sus tamaños medidos (2,5 px/cm por el R-24) —R-12 amarillos, R-12 azul caribe, R-9 naranja, el cuello de 9 niveles de R-5 fucsia, naranja, azul caribe y verde en espiral, R-9 naranja, R-12 azul caribe y R-12 amarillos más grandes— cada uno a la altura de su centro, el R-24 amarillo encima y los 4 emojis «popó» de T-260 café: ~2,2 m. Colores medidos (no publica productos): amarillo #ffd101 → Amarillo Miel 021, azul caribe #02bcdd → 038, naranja → 061, fucsia #fd6094 → 012, verde #2fb602 → Verde Trébol 029, café #72451f → 074. Distinto: los emojis impresos de los R-12 amarillos no están en la tienda: van lisos; el cuello de la foto va más apretado que el paso del taller (~7 cm entre niveles de R-5 de 11 cm) y el 3D respeta la medida; los popós son tirabuzones cónicos sin los ojos blancos.");

// ==========================================================================================================
// 374 · Columna Feliz Cumpleaños
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 de lunares miden ~88 px (≈ 28,5 cm): 3,1 px/cm, piso en y = 545, eje en x = 368. De abajo
 * arriba: base de 4 R-12 de lunares (verde lima, violeta, rojo y azul rey detrás), 4 R-5 verdes, el tallo de 2 T-360
 * amarillos entorchados (de 34 a 103 cm) con 3 volutas de T-260 violeta al pie, 4 R-5 verdes, el cuarteto de R-12 de
 * lunares de arriba (azul rey, verde lima con «Feliz Cumpleaños», violeta y rojo detrás), 4 R-5 verdes y el metalizado
 * «Feliz Cumpleaños» de lunares y franjas.
 */
const escena374 = perezoso((): Escena => {
  const px = foto(3.1, 368, 545);
  const R5 = (id: string, yPx: number, giro: GiroNivel): NivelFoto => ({ id, g: R("R-5", 10, "029"), colores: ["029", "029", "029", "029"], yPx, giro });
  const col = columnaFoto(px, [
    { id: "base", nombre: "Base: cuarteto de R-12 de lunares (verde lima, violeta, rojo y azul rey)", g: R("R-12", 28.5, "031"), colores: ["031", "051", "015", "041"], yPx: 495, giro: 0 },
    R5("verdes-abajo", 440, 45),
    R5("verdes-medio", 222, 0),
    { id: "lunares-arriba", nombre: "Cuarteto de R-12 de lunares (azul rey, verde lima, violeta y rojo)", g: R("R-12", 28.5, "031"), colores: ["041", "031", "051", "015"], yPx: 172, giro: 45 },
    R5("verdes-arriba", 135, 0),
  ], 135);
  const nodos = [...col.nodos];
  const tallo = (codigo: string, giroGrados: number): Pieza => rizo({ forma: "resorte", tubito: { formatoId: "T-360", grosorCm: 6.5, codigo }, vueltas: 2.5, radioCm: 2.6, largoCm: r2(px(0, 225).y - px(0, 440).y), eje: "abajo", giroGrados });
  nodos.push(colgar({ id: "tallo-1", nombre: "Tallo: T-360 Fashion Amarillo entorchado (1)", pieza: tallo("020", 0), padre: col.vara.padre, origen: v(0, px(0, 225).y, 0), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "tallo-2", nombre: "Tallo: T-360 Fashion Amarillo entorchado (2)", pieza: tallo("020", 180), padre: col.vara.padre, origen: v(0, px(0, 225).y, 0), normal: AL_FRENTE }).nodo);
  const voluta = (giroGrados: number): Pieza => rizo({ forma: "voluta", tubito: { formatoId: "T-260", grosorCm: 4.5, codigo: "051" }, vueltas: 2, radioInicialCm: 1.5, radioFinalCm: 11, giroGrados });
  const VOLUTAS: ReadonlyArray<[number, number, number, string]> = [[285, 410, 6, "izquierda"], [420, 395, 8, "derecha"], [365, 420, 26, "al frente"]];
  VOLUTAS.forEach(([x, y, z, lado], k) => nodos.push(colgar({ id: `voluta-${k + 1}`, nombre: `Voluta de T-260 Fashion Violeta (${lado})`, pieza: voluta(90 * k), padre: col.vara.padre, origen: px(x, y, z), normal: AL_FRENTE }).nodo));
  nodos.push(metalEn("metalizado", "Metalizado «Feliz Cumpleaños» festivo de la tienda (18\")", col.vara.padre, metalTienda(FESTIVO_METALIZADO), v(0, px(0, 128).y, -4)));
  return { sala: sala(260, 240, 240, SALA_BLANCA), nodos };
});
const idea374 = idea("columna-feliz-cumpleanos", "Columna Feliz Cumpleaños: topiario de lunares", escena374,
  "Igual: el topiario con sus medidas (3,1 px/cm): base de 4 R-12 de 28,5 cm (Fashion Verde Lima al frente izquierda, Violeta al frente derecha, Rojo detrás a la derecha y Azul Rey detrás), 4 R-5 Verde Trébol, el tallo de 2 T-360 Fashion Amarillo entorchados de ~69 cm con las 3 volutas de T-260 violeta al pie, 4 R-5 verdes, el cuarteto de R-12 de arriba (azul rey, verde lima al frente, violeta y rojo detrás), 4 R-5 verdes y el metalizado «Feliz Cumpleaños» encima: ~1,75 m. Colores medidos (no publica productos): verde lima #7cc34c → 031, violeta #3e1e80 → 051, rojo → 015, verdes chicos #24b630 → 029, amarillo #ffe303 → 020. Distinto: los lunares de colores y el «Feliz Cumpleaños» impresos de los R-12 no están en la tienda (solo lunares blancos sobre rojo y verde lima): van lisos; el cuarto globo de cada cuarteto de R-12 (detrás) no se ve: se supone del color que falta; el metalizado de la foto (lunares arriba, franjas abajo) va como el «Feliz Cumpleaños Festivo» de la tienda (18\", ~42 cm; en la foto mide ~36 cm), el más parecido; las volutas no llevan la cola que las une al tallo.");

// ==========================================================================================================
// El lote
// ==========================================================================================================

/** Ideas de fiesta de sempertex.com digitalizadas: lote 18 (en el orden de `clasif/lote-18.json`). */
export const LOTE_18: readonly IdeaDigitalizada[] = [idea326, idea329, idea330, idea334, idea335, idea338, idea341, idea342, idea344, idea353, idea354, idea356, idea363, idea367, idea374];
