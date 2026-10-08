import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { sumarMateriales } from "../mezcla";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl } from "../impresos-catalogo";
import { metalizadoDeTienda, type ColorMetalizado, type OpcionesMetalizado } from "../metalizados";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { ColorOrganico, OpcionesOrganico, PuntoMezcla, RellenoOrganico } from "../organico";
import type { ElementoEscenografia } from "../escenografia";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesMono } from "../figuras";
import type { FormaAccesorio, PropiedadesFigura } from "../figuras-tubito";
import type { PropiedadesRizo } from "../rizos";
import type { OpcionesMural } from "../murales";
import type { PatronColumna } from "../columnas";
import type { Vec3 } from "../modulos";
import { centroCuerpo } from "../geometria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 16** (los números de `clasif/lote-16.json`): ramos, centros de
 * mesa y estructuras que antes quedaban «a medias» y que ahora cubren los generadores nuevos (metalizados de números,
 * letras y corazones, globos impresos de la tienda, rizos de tubito, murales y formas): #155 arreglo orgánico de
 * Halloween, #172 bandera de EE. UU., #174 banner «Feliz Cumpleaños», #177 base «I love you», #178 base orgánica Feliz
 * Cumpleaños, #179 base «Te amo», #185 columna de bebé de 1 año, #186 arco de bebé, #198 ramo amor dorado rosa, #199 ramo
 * de baby shower, #200 ramo corazón, #201 ramo de flores en maceta, #202 ramo «Feliz Día» con animal print, #204 ramo de
 * flores «Feliz Día Mamá» y #208 ramo sombrero del Día del Padre.
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada y con rejilla:
 * - **Escala**: la de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 22 cm, R-12 ≈ 28 cm, R-18 ≈ 42 cm,
 *   R-24 ≈ 55 cm; un T-260 inflado ≈ 5 cm de grueso; un metalizado de 16" ≈ 41 cm). Cada idea dice su escala (px/cm) y
 *   su función `px` pasa los píxeles de la foto al mundo: con ella salen alturas, anchos, radios y largos.
 * - **Conteo**: lo que se ve, contando lo que asoma por detrás; lo que la técnica obliga y no se ve (el cuarto globo
 *   de un cuarteto) se pone y la nota lo dice. En los orgánicos el motor da los globos para el grosor y el largo medidos
 *   (no se cuentan uno a uno). Ninguna idea del lote publica «Materiales» con cantidades: todo va `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos (aunque la foto mida otra cosa: la nota lo dice). Si no,
 *   medidos en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla
 *   oficial) y el código más cercano que se fabrica en ese formato (el Fashion si queda a ≤ 6 ΔE del mejor). La
 *   «Blush Crema» que publican #200 y #201 no está en la tabla oficial: va el código medido más cercano y su producto
 *   publicado lo lleva (`codigo3d`).
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando la idea lo publica y el catálogo lo trae; si no, el más
 *   parecido del catálogo (y la nota lo dice); si no hay ninguno parecido, el liso de su color de fondo. Los metalizados
 *   que no están en el catálogo de la tienda (números y letras plata, el «1» rosado) van genéricos, sin producto. La
 *   calabaza de #155 (publicada, fuera del catálogo de impresos) se dibuja con la cara impresa de la calabaza del
 *   taller y cotiza como el producto publicado (`nodos`).
 * - **Montaje** (para que la biblioteca saque «esta estructura con sus decoraciones» y «esta decoración sola»): la
 *   estructura principal es la raíz. En los centros de mesa de cuartetos, su base; de ella cuelga su varilla (por el
 *   hueco del centro del cuarteto) y de la varilla todo lo demás, exacto (montaje de los lotes 05 y 10). En los de base
 *   orgánica, la raíz es su armazón (la base o el tubo de PVC escondido entre los globos, como en el lote 10): de él
 *   cuelgan sus tramos orgánicos y sus metalizados; lo que se apoya en los globos va `sobre` el orgánico. Los ramos de
 *   helio van **por pisos** (lote 02): su raíz es «Peso y cintas» (el amarre con una cinta a cada globo) y cada globo o
 *   metalizado cuelga de ella en su altura, su lado y su inclinación medidos. La escenografía con cilindros inclinados
 *   (cintas, escarcha, el sombrero de bruja) va suelta: así el visor la dibuja derecha.
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

/** Una pieza `sobre` los globos de una estructura: la escena la corre a lo largo de la normal hasta tocarlos. */
function apoyar(id: string, nombre: string, pieza: Pieza, padre: Padre, punto: Vec3, normal: Vec3, giroGrados = 0): NodoEscena {
  return { id, nombre, pieza, colocacion: { en: "sobre", padreId: padre.id, puntoCm: redondo(aLocal(padre.marco, punto)), normal: redondo(trasladar(padre.marco.m, unitario(normal))), giroGrados } };
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

const globo = (g: ParteGlobo, impresoId?: string): Pieza => ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) });
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
/** Una bola de `cantidad` globitos iguales (las «uvas», el centro de una flor). */
const uvas = (g: ParteGlobo, cantidad: number): Pieza => figura({ cuerpo: [{ tipo: "racimo", globo: g, cantidad }], queEs: "a small cluster of tiny balloons" });
/** Un aro de tubito (o de Link-O-Loon 660) sin figura; colgado mirando al frente queda acostado. */
const aro = (t: { formatoId: string; grosorCm: number; codigo: string }, radioCm: number): Pieza => figura({
  queEs: "a twisted-balloon ring", accesorios: [{ en: "base", forma: { tipo: "aro", tubito: t, radioCm, plano: "horizontal", desdeGrados: 0, hastaGrados: 360 } satisfies FormaAccesorio }],
});
/** Tres globitos amarrados juntos. */
const trio = (g: ParteGlobo, giroGrados = 0): Pieza => flor({ petalos: { ...g, cantidad: 3, aperturaGrados: 35, giroGrados }, centro: null });
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
const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: ElementoEscenografia["acabado"] = "mate"): ElementoEscenografia => ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado });
/** Un polígono por puntos (cm) a lo largo de una polilínea: escarcha, contornos de alambre. */
const polilinea = (puntos: readonly Vec3[], hex: string, radioCm: number, acabado: ElementoEscenografia["acabado"]): ElementoEscenografia[] =>
  puntos.slice(1).map((p, i) => cinta(puntos[i]!, p, hex, radioCm, acabado));
const ovalo = (x: number, y: number, rx: number, ry: number, puntos = 20): Array<{ x: number; y: number }> =>
  Array.from({ length: puntos }, (_, i) => ({ x: r2(x + rx * Math.cos((2 * Math.PI * i) / puntos)), y: r2(y + ry * Math.sin((2 * Math.PI * i) / puntos)) }));

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
  for (const g of o.globos) {
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
  // Perezosa (ver `ideaPerezosa` en tipos.ts): la escena se arma la primera vez que se pide, no al importar el lote.
  const laEscena = perezoso(escena);
  return ideaPerezosa(
    {
      id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
      get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
    },
    () => ({ tipo: "escena", escena: laEscena() }),
    () => productosDe(laEscena(), publicados),
  );
}

// Impresos del catálogo que usa el lote.
const ARANA_CRISTAL = "infinity-arana-fashion-transparente";
const ARANA_NEGRO = "infinity-arana-metalink-fashion-negro";
const HALLOWEEN_NEGRO = "infinity-happy-halloween-friends-fashion-negro";
const ESTRELLAS_CRISTAL = "infinity-estrellas-fashion-transparente";
const GRAFFITI_ROJO = "infinity-graffiti-invierno-fashion-rojo";
const FESTIVO = "infinity-happy-birthday-festivo-fashion-surtido";
const FANTASIA = "2-caras-feliz-cumpleanos-fantasia-reflex-surtido";
const CORAZONES_ROJO = "infinity-corazones-por-siempre-fashion-rojo";
const POLKA_LIMA = "infinity-polka-blanco-fashion-verde-lima";
const ANIMAL = "infinity-animal-print-fashion-y-metal-surtido";
const PAPA_OESTE = "infinity-r-feliz-dia-papa-oeste-fashion-surtido";

// ==========================================================================================================
// 155 · Arreglo orgánico Halloween
// ==========================================================================================================

/**
 * Foto 740 × 570 (recorte): los R-12 del ramo miden ~68 px (≈ 28 cm): 2,45 px/cm, con el piso en y = 548 y el eje en
 * x = 374. Base orgánica de ~1 m de ancho en dos montículos (el izquierdo hasta ~52 cm y el derecho, bajo el «8», hasta
 * ~66 cm): R-12 negros, naranjas y durazno, R-9 y tríos de R-5 Reflex Plata. Sobre el derecho, el «8» metalizado plata
 * (~72 cm) con escarcha naranja y una bruja de papel arriba; a su derecha, un gato negro de escarcha. A la izquierda, el
 * balde de calabaza de escarcha y, saliendo de él, el ramo de helio de 7 R-12 por pisos: plata arriba, dos negros con
 * telaraña plateada, un cristal con arañas, dos calabazas naranjas y un negro con cara de calabaza amarilla.
 */
const escena155 = (): Escena => {
  const px = foto(2.45, 374, 548);
  const armazon = suelta("armazon", "Armazón del arreglo (base y tubo de PVC)", escenografia([cilindro(v(0, 0, 0), 5, 1.5, "#2b2b2b"), cilindro(v(20, 0, -4), 1.2, 62, "#dcdcd6")]), v(0, 0, 0));
  const base = organicoDePiso({
    id: "base", nombre: "Base orgánica negra, naranja, durazno y plata", padre: armazon.padre, origen: v(0, 0.5, 0),
    racimos: [
      { nombre: "Fila de abajo", puntos: [v(-34, 19, 4), v(0, 17, 8), v(34, 19, 4)], radio: 19 },
      { nombre: "Montículo izquierdo", puntos: [v(-36, 34, -2), v(-22, 37, 2)], radio: 15 },
      { nombre: "Montículo derecho", puntos: [v(12, 46, 2), v(28, 49, -2)], radio: 18 },
    ],
    mezcla: { "R-12": 0.8, "R-9": 0.2 },
    colores: [colorOrg("080", 4, ["R-12", "R-9"]), colorOrg("061", 4, ["R-12", "R-9"]), colorOrg("060", 3.5, ["R-12", "R-9"]), colorOrg("981", 30, ["R-5"]), colorOrg("061", 8, ["R-5"])],
    densidad: 1.4, semilla: 155, inflados: { "R-12": 25, "R-9": 19, "R-5": 10.5 }, relleno: [{ formatoId: "R-5", infladoCm: 10, trios: true }],
  });
  const ocho = metalEn("ocho", "Número 8 metalizado plata de 32\"", armazon.padre, metal({ tipo: "numero", valor: 8 }, 32, "plata"), v(px(420, 0).x, 61, -4));
  // El ramo de helio, por pisos, saliendo del balde (el amarre en su boca).
  const amarre = px(305, 385, 2);
  // La calabaza es una decoración «de pie»: va mirando al frente, derecha (su cara impresa hacia quien mira).
  const g = (id: string, nombre: string, pieza: Pieza, x: number, y: number, z: number): GloboHelio =>
    ({ id, nombre, pieza, centro: px(x, y, z), direccion: pieza.tipo === "decoracion" ? AL_FRENTE : subiendo(amarre, px(x, y, z), 0.3) });
  const calabaza = (): Pieza => deco({ tipo: "calabaza", propiedades: { globo: R("R-12", 28, "061"), cara: { hex: "#1d1d1d" }, tallo: null } });
  const helio = ramo({
    id: "ramo", nombre: "Peso y cintas del ramo de Halloween", amarre, cinta: "#dfe2e6",
    globos: [
      g("helio-plata", "R-12 Reflex Plata (piso 4, arriba)", globo(R("R-12", 30, "981")), 301, 40, -4),
      g("helio-arana-arriba", "R-12 negro con telaraña plateada (piso 3, atrás)", globo(R("R-12", 28, "080"), ARANA_NEGRO), 300, 100, -14),
      g("helio-calabaza-arriba", "Calabaza naranja (piso 3)", calabaza(), 338, 150, 4),
      g("helio-cristal", "R-12 cristal con arañas (piso 3, izquierda)", globo(R("R-12", 28, "390"), ARANA_CRISTAL), 268, 175, -2),
      g("helio-cara-negra", "R-12 negro con cara de calabaza (piso 2)", globo(R("R-12", 28, "080"), HALLOWEEN_NEGRO), 325, 215, 8),
      g("helio-arana-abajo", "R-12 negro con telaraña plateada (piso 2, izquierda)", globo(R("R-12", 28, "080"), ARANA_NEGRO), 282, 240, -6),
      g("helio-calabaza-abajo", "Calabaza naranja (piso 1)", calabaza(), 300, 290, 6),
    ],
  });
  // Escenografía: el balde de calabaza, la escarcha del 8, la bruja y el gato de escarcha.
  const NARANJA = "#f07a1c", NEGRO = "#151515";
  const balde: ElementoEscenografia[] = [
    { ...cilindro(px(315, 440, 4), 11.5, 24, NARANJA, "lentejuelas", 12.5), motivo: { dibujo: "calabaza", hex: NEGRO, cara: "frente" } },
    cilindro(px(315, 445, 4), 12.5, 3, NEGRO, "lentejuelas"), cilindro(px(315, 380, 4), 13, 3, NEGRO, "lentejuelas"),
  ];
  const escarcha = polilinea([px(442, 205, 3), px(426, 226, 3), px(416, 250, 3), px(400, 270, 3), px(386, 300, 3), px(404, 330, 3), px(424, 350, 3), px(440, 366, 3)], NARANJA, 1.6, "lentejuelas");
  const bruja: ElementoEscenografia[] = [
    { forma: "panel", contorno: ovalo(px(388, 0).x, px(0, 183).y, 6.5, 5), huecos: [], zCm: 0, grosorCm: 1.2, hex: "#f2731d", acabado: "papel" },
    { forma: "panel", contorno: [{ x: px(415, 0).x, y: px(0, 178).y }, { x: px(445, 0).x, y: px(0, 178).y }, { x: px(432, 0).x, y: px(0, 150).y }], huecos: [], zCm: 0.5, grosorCm: 1, hex: NEGRO, acabado: "papel" },
    cinta(px(362, 197, 1), px(448, 172, 1), "#8a5a2b", 0.8, "madera"),
  ];
  const cuerpoGato = Array.from({ length: 13 }, (_, k) => mas(px(505, 395, 0), v(r2(14 * Math.cos(rad(30 * k))), r2(12 * Math.sin(rad(30 * k))), 0)));
  const cabezaGato = Array.from({ length: 11 }, (_, k) => mas(px(518, 352, 0), v(r2(8 * Math.cos(rad(36 * k - 90))), r2(7 * Math.sin(rad(36 * k - 90))), 0)));
  const gato: ElementoEscenografia[] = [
    ...polilinea(cuerpoGato, NEGRO, 1.8, "lentejuelas"), ...polilinea(cabezaGato, NEGRO, 1.8, "lentejuelas"),
    ...polilinea([px(503, 350), px(500, 330), px(512, 343)], NEGRO, 1.4, "lentejuelas"), ...polilinea([px(525, 343), px(538, 330), px(534, 352)], NEGRO, 1.4, "lentejuelas"),
    caja(px(498, 374, 2), v(5, 3.5, 1.5), NARANJA, "satinado"), caja(px(510, 374, 2), v(5, 3.5, 1.5), NARANJA, "satinado"),
  ];
  return {
    sala: sala(320, 260, 260, { piso: "#f2f2f2", paredes: "#ffffff", techo: "#ffffff" }),
    nodos: [
      armazon.nodo, base.nodo, ocho, ...helio.nodos,
      { id: "balde", nombre: "Balde de calabaza de escarcha", pieza: escenografia(balde), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "escarcha", nombre: "Escarcha naranja del 8", pieza: escenografia(escarcha), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "bruja", nombre: "Bruja de papel en escoba", pieza: escenografia(bruja), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -2, giroGrados: 0 } },
      { id: "gato", nombre: "Gato negro de escarcha con moño naranja", pieza: escenografia(gato), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -2, giroGrados: 0 } },
    ],
  };
};

const idea155 = idea("arreglo-organico-con-decoraciones", "Arreglo orgánico Halloween con el 8 plata y ramo de calabazas", escena155,
  "Igual: la base orgánica de ~1 m en dos montículos (R-12 negros, naranjas y durazno, R-9 y tríos de R-5 Reflex Plata), el número 8 metalizado plata de 32\" (~80 cm; en la foto ~72) sobre el montículo derecho con su escarcha naranja y la bruja de papel arriba, el gato negro de escarcha con su moño naranja, el balde de calabaza de escarcha y, saliendo de él, el ramo de 7 R-12 de helio por pisos en sus sitios medidos: plata arriba, dos negros con telaraña, un cristal con arañas (el impreso publicado), dos calabazas naranjas (el producto publicado, con su cara impresa) y un negro con cara de calabaza. Distinto: los negros con telaraña plateada no están publicados: va el «Araña Metalink» negro de la tienda (el más parecido); el negro con cara de calabaza amarilla, el «Happy Halloween Friends» negro (calabaza naranja con letrero); el 8 plata no está en el catálogo de la tienda (va genérico, sin producto); el 8 va derecho (en la foto, apenas inclinado); el gato, la bruja, el balde y la escarcha son escenografía simple; los globos de la base los da el motor para el grosor medido.", [
  P("GLOBO REDONDO CALABAZA NARANJA", "/products/globo-para-fiesta-latex-redondo-2-caras-calabaza-fashion-naranja", "R-12", null, { nodos: ["helio-calabaza-arriba", "helio-calabaza-abajo"] }),
  P("GLOBO INFINITY® ARAÑA TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-arana-fashion-transparente", null, null),
  P("GLOBO REDONDO FASHION DURAZNO", "/products/globo-para-fiesta-latex-redondo-fashion-durazno", "R-12", "060"),
  P("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"),
  P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
  P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
]);

// ==========================================================================================================
// 172 · Bandera USA (mural)
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 de la retícula miden ~65 px y van cada ~62 px (tocándose); los chicos del frente ~50 px y
 * los de estrellas ~54 px. Se cuentan 10 columnas × 9 filas de grandes (90) y 9 × 8 chicos al frente, en el centro de
 * cada cuadro de cuatro grandes (72). El cantón azul: 4 columnas × 4 filas de grandes con 3 × 3 chicos de estrellas;
 * las franjas, una fila de grandes y una de chicos del mismo color, rojo y blanco alternados empezando en rojo.
 * Colores medidos: azul #01298a → Fashion Azul Rey 041 (el Violeta mide más cerca por el tono de la foto, pero la
 * bandera es azul), rojo → Fashion Rojo 015 (ΔE 10), blanco 005.
 */
const escena172 = (): Escena => {
  const filas = Array.from({ length: 9 }, (_, j) => Array.from({ length: 10 }, (_, i) => (j < 4 && i < 4 ? "a" : j % 2 === 0 ? "b" : "c")).join(""));
  const estrellas: Array<[number, number]> = [], rojos: Array<[number, number]> = [], blancos: Array<[number, number]> = [];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 9; i++) {
    const p: [number, number] = [i + 0.5, j + 0.5];
    if (j < 3 && i < 3) estrellas.push(p);
    else if (j % 2 === 0) rojos.push(p);
    else blancos.push(p);
  }
  const mural: OpcionesMural = {
    disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 27 }, chico: null,
    matriz: { colores: ["041", "015", "005"], filas },
    encima: [
      { formatoId: "R-12", infladoCm: 22.5, codigo: "390", puntos: estrellas },
      { formatoId: "R-9", infladoCm: 21, codigo: "015", puntos: rojos },
      { formatoId: "R-9", infladoCm: 21, codigo: "005", puntos: blancos },
    ],
  };
  return {
    sala: sala(420, 300, 300, { paredes: "#f4f4f2", piso: "#e9e7e3" }),
    nodos: [{ id: "bandera", nombre: "Pared bandera de EE. UU.", pieza: { tipo: "mural", mural, impresos: [{ impresoId: ESTRELLAS_CRISTAL, codigo: "390" }] }, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } }],
  };
};
const idea172 = idea("bandera-usa", "Bandera de EE. UU. en pared de globos", escena172,
  "Igual: la pared de ~2,5 × 2,2 m celda a celda: 10 × 9 R-12 (16 azul rey en el cantón, 42 rojos y 32 blancos en franjas alternas empezando en rojo) y, al frente, en el centro de cada cuadro de cuatro, 72 chicos: 9 con estrellas sobre el cantón y 30 rojos y 33 blancos en las franjas, como en la foto. Distinto: la idea no publica productos (colores medidos); las estrellas de la foto parecen de escarcha plateada sobre azul: va el «Infinity® Estrellas» cristal de la tienda (el más parecido, R-12 a 22 cm, que deja ver el azul de atrás); los chicos rojos y blancos van en R-9 a 21 cm; la retícula del 3D va a 0,9 inflados (la de la foto, casi a uno: la foto es ~10 % más ancha que alta y el 3D casi cuadrado).");

// ==========================================================================================================
// 174 · Banner Feliz Cumpleaños (centro de mesa)
// ==========================================================================================================

/**
 * Foto 740 × 570: los T-260 del penacho miden ~15 px (≈ 5 cm) y el tubo grande ~42 px: 3,1 px/cm, piso en y = 548, eje
 * en x = 361. De abajo arriba: base de un cuarteto de R-12 impresos (~19 cm: rojo y amarillo al frente, verde atrás) con
 * un cuarteto de R-5 morados encima; el Link-O-Loon 660 naranja impreso «Feliz Cumpleaños» (~13,5 cm × 74 cm); un
 * cuarteto de R-9 amarillos (~14 cm) y el penacho de 16 T-260 que salen del centro (rojo, rosa, verde lima, verde,
 * violeta, amarillo y naranja), de ~40 a 55 cm. Alto total ~1,65 m. Colores medidos (no publica productos): rojo 015,
 * amarillo 020, verde 030, morado Orquídea 056 (ΔE 17), naranja 061.
 */
const escena174 = (): Escena => {
  const px = foto(3.1, 361, 548);
  const base = baseCuarteto("base", "Base: cuarteto de R-12 impresos", { ...cuarteto(R("R-12", 19, "015"), ["015", "020", "040", "030"], "espiral"), impresos: [{ impresoId: GRAFFITI_ROJO, codigo: "015" }, { impresoId: FESTIVO, codigo: "020" }, { impresoId: FESTIVO, codigo: "040" }] }, px(0, 505).y, 0);
  const vara = varilla(base.padre, v(0, 1, 0), 112, "#f07a1c");
  const nodos: NodoEscena[] = [base.nodo, vara.nodo];
  nodos.push(nivel("morados", "Cuarteto de R-5 Fashion Orquídea Morada", vara.padre, cuarteto(R("R-5", 10, "056"), ["056"]), v(0, px(0, 470).y, 0), 45));
  nodos.push(varita("tubo", "Link-O-Loon 660 naranja («Feliz Cumpleaños» en la foto)", vara.padre, { formatoId: "LOL-660", grosorCm: 13.5, codigo: "061" }, v(0, 27, 0), v(0, 101, 0)));
  nodos.push(nivel("amarillos", "Cuarteto de R-9 Fashion Amarillo", vara.padre, cuarteto(R("R-9", 14, "020"), ["020"]), v(0, px(0, 215).y, 0), 45));
  // El penacho: cada T-260 del centro (encima del cuarteto amarillo) a su punta medida.
  const PUNTAS: ReadonlyArray<[number, number, number, string, string]> = [
    [240, 90, -6, "015", "rojo"], [252, 140, 4, "011", "rosa"], [262, 95, -10, "031", "verde lima"], [292, 45, -4, "031", "verde lima"],
    [295, 78, 2, "051", "violeta"], [322, 60, -8, "020", "amarillo"], [342, 85, 6, "030", "verde"], [352, 30, -2, "051", "violeta"],
    [373, 58, 8, "030", "verde"], [393, 48, 0, "015", "rojo"], [418, 30, -6, "051", "violeta"], [485, 120, 4, "011", "rosa"],
    [467, 130, 8, "061", "naranja"], [468, 165, 2, "051", "violeta"], [440, 160, 10, "020", "amarillo"], [305, 150, 6, "015", "rojo"],
  ];
  PUNTAS.forEach(([x, y, z, codigo, color], k) => {
    const desde = v(0, px(0, 200).y, r2(z * 0.2));
    nodos.push(varita(`penacho-${k + 1}`, `T-260 ${color} del penacho ${k + 1}`, vara.padre, { formatoId: "T-260", grosorCm: 4.8, codigo }, desde, px(x, y, z)));
  });
  return { sala: sala(280, 240, 240, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea174 = idea("banner-feliz-cumpleanos", "Banner Feliz Cumpleaños: tubo naranja con penacho de tubitos", escena174,
  "Igual: ~1,65 m de alto con las medidas de la foto: la base de cuatro R-12 impresos (~19 cm) con el cuarteto de R-5 morados encima, el tubo de Link-O-Loon 660 naranja de ~74 cm, el cuarteto de R-9 amarillos y el penacho de 16 T-260 contados con su color y su punta medida (3 rojos, 2 rosa, 2 verde lima, 2 verdes, 4 violeta, 2 amarillos y 1 naranja). Distinto: la idea no publica productos (colores medidos); el impreso «Feliz Cumpleaños» del tubo no existe en el catálogo ni el visor pinta impresos en tubitos: va liso; los R-12 de la base llevan remolinos blancos: el rojo va con el «Graffiti Invierno» rojo y el amarillo con el «Happy Birthday Festivo» (los más parecidos de la tienda); el verde va liso y el cuarto, que no se ve, se supone azul (con el mismo Festivo); el rizo rojo del centro del penacho no va; los tubitos del penacho van rectos (en la foto, algo curvos).");

// ==========================================================================================================
// 177 · Base I love you
// ==========================================================================================================

/**
 * Foto 1600 × 1569: los R-12 Reflex Dorado Rosa de la base miden ~235 px (≈ 30 cm): 7,8 px/cm, sobre un banco de ~45
 * cm (su tabla en y = 1560) y el eje en x = 810. Base de dos cuartetos de R-12 (abajo con un globo al frente, arriba con
 * el hueco), R-5 dorado rosa entre ellos, una flor de 6 burbujas de T-260 con su centro y un aro de T-260 alrededor de la
 * «U». Las letras plata «I», «Y», «O», «U» (~68 cm: 27") y tres corazones rojos (uno liso arriba a la derecha y dos de
 * filigrana a la izquierda) se sostienen de la varilla.
 */
const escena177 = (): Escena => {
  const MESA = 45;
  const px = foto(7.8, 810, 1560, MESA);
  const base = baseCuarteto("base", "Base: cuarteto de R-12 Reflex Dorado Rosa de abajo", cuarteto(R("R-12", 30, "968"), ["968"]), MESA + 16, 45, MESA);
  const vara = varilla(base.padre, v(0, MESA + 1, 0), 125, "#d9d9db");
  const nodos: NodoEscena[] = [base.nodo, vara.nodo];
  nodos.push(nivel("cuarteto-arriba", "Cuarteto de R-12 Reflex Dorado Rosa de arriba", vara.padre, cuarteto(R("R-12", 30, "968"), ["968"]), v(0, px(0, 1230).y, 0), 0));
  const R5: ReadonlyArray<[number, number, number]> = [[600, 1140, 6], [1040, 1235, 10], [1010, 1295, 12], [990, 1060, 8], [1085, 1075, 4], [585, 1075, 4]];
  R5.forEach(([x, y, z], k) => { const c = px(x, y, z); nodos.push(colgar({ id: `r5-${k + 1}`, nombre: `R-5 Reflex Dorado Rosa ${k + 1}`, pieza: globo(R("R-5", 11, "968")), padre: vara.padre, origen: c, normal: unitario(v(c.x, 4, c.z + 6)) }).nodo); });
  nodos.push(colgar({ id: "flor", nombre: "Flor de 6 burbujas de T-260 Reflex Dorado Rosa", pieza: florTubito(burbujas("T-260", 4.5, ["968"], 6, 6, 10, 0), R("R-5", 6, "968")), padre: vara.padre, origen: px(1030, 1150, 16), normal: unitario(v(0.4, 0.1, 1)) }).nodo);
  nodos.push(colgar({ id: "aro", nombre: "Aro de T-260 Reflex Dorado Rosa", pieza: aro({ formatoId: "T-260", grosorCm: 4.5, codigo: "968" }, 18), padre: vara.padre, origen: px(1052, 950, 0), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "lazos", nombre: "Lazos de T-260 Reflex Dorado Rosa", pieza: mono({ formatoId: "T-260", grosorCm: 4.5, codigo: "968", lazosPorLado: 1, largoLazoCm: 11, anchoLazoCm: 7, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: null }), padre: vara.padre, origen: px(560, 1050, 4), normal: AL_FRENTE }).nodo);
  const letra = (valor: string) => metal({ tipo: "letra", valor }, 27, "plata");
  nodos.push(metalEn("letra-i", "Letra I metalizada plata", vara.padre, letra("I"), px(760, 640, -16)));
  nodos.push(metalEn("letra-y", "Letra Y metalizada plata", vara.padre, letra("Y"), px(430, 1090, -6)));
  nodos.push(metalEn("letra-o", "Letra O metalizada plata", vara.padre, letra("O"), px(800, 1110, 6)));
  nodos.push(metalEn("letra-u", "Letra U metalizada plata", vara.padre, letra("U"), px(1290, 1225, 0)));
  const alto = 21;
  nodos.push(metalEn("corazon-arriba", "Corazón metalizado rojo (arriba)", vara.padre, metalTienda("corazon-rojo-2"), mas(px(1070, 450, -12), v(0, -alto, 0))));
  nodos.push(metalEn("corazon-filigrana-1", "Corazón metalizado rojo (de filigrana en la foto, izquierda)", vara.padre, metalTienda("corazon-rojo-2"), mas(px(215, 925, -2), v(0, -alto, 0))));
  nodos.push(metalEn("corazon-filigrana-2", "Corazón metalizado rojo (de filigrana en la foto, abajo)", vara.padre, metalTienda("corazon-rojo-2"), mas(px(420, 1260, 10), v(0, -alto, 0))));
  const MADERA = "#c69a63", BLANCO = "#f4f2ee";
  const banco: ElementoEscenografia[] = [caja(v(0, MESA - 2, 0), v(100, 4, 55), BLANCO, "satinado"), ...[-46, 46].flatMap((x) => [-24, 24].map((z) => caja(v(x, (MESA - 4) / 2, z), v(4, MESA - 4, 4), MADERA, "madera")))];
  nodos.push({ id: "banco", nombre: "Banco blanco y madera", pieza: escenografia(banco), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } });
  return { sala: sala(340, 280, 260, { paredes: "#f1eee9", piso: "#d9d3ca" }), nodos };
};
const idea177 = idea("base-i-love-you", "Base I love you: letras plata y corazones rojos sobre cuartetos dorado rosa", escena177,
  "Igual: la base de dos cuartetos de R-12 Reflex Dorado Rosa (el publicado; abajo con un globo al frente y arriba con el hueco), 6 R-5 dorado rosa entre ellos, la flor de 6 burbujas de T-260 dorado rosa con su centro, el aro de T-260 alrededor de la «U» y los lazos de la izquierda; las letras plata «I», «Y», «O», «U» de ~68 cm (27\") en sus alturas medidas, con la «I» atrás y arriba, y los tres corazones rojos de 18\"; todo sobre el banco blanco de ~45 cm. Distinto: las letras plata no están en el catálogo de la tienda (van genéricas, sin producto) y van derechas (en la foto, la «Y» y la «U» van algo inclinadas); los dos corazones de la izquierda son de filigrana (calados) en la foto: va el «Corazón rojo» de 18\" de la tienda, el más parecido, para los tres; los R-5, la flor y el aro son del mismo dorado rosa (en la foto los de la sombra se ven más rojos).", [
  P("GLOBO REDONDO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa", "R-12", "968"),
]);

// ==========================================================================================================
// 178 · Base orgánica Feliz Cumpleaños Reflex
// ==========================================================================================================

/**
 * Foto 740 × 570: el R-12 dorado rosa impreso de arriba mide ~140 px (≈ 29 cm): 4,8 px/cm, con la base en y = 545 y el
 * eje en x = 372. Base cuadrada negra (~28 cm) con dos varillas rosadas que sostienen la nube orgánica (~57 cm de ancho,
 * de 47 a 77 cm) de R-5 Reflex Champaña con R-5 negros, plata y algún dorado rosa; encima el R-12 «Feliz Cumpleaños»;
 * debajo, tres cintas negras con tríos de R-5 plata (~6 cm) colgando (la del centro con dos), y a los pies de las
 * varillas, dos racimitos de R-5 dorado rosa y champaña.
 */
const escena178 = (): Escena => {
  const px = foto(4.8, 372, 545);
  const ROSA = "#e2a497", NEGRO = "#151515";
  const CINTAS: ReadonlyArray<[number, number]> = [[290, 370], [355, 470], [430, 360]];
  const armazon = suelta("base", "Base cuadrada negra con varillas y cintas", escenografia([
    caja(v(0, 2, 0), v(28, 4, 28), NEGRO, "brillante"),
    cilindro(v(px(335, 0).x, 4, 3), 0.5, 46, ROSA, "satinado"), cilindro(v(px(415, 0).x, 4, -3), 0.5, 46, ROSA, "satinado"),
    ...CINTAS.map(([x, y]) => cilindro(v(px(x, 0).x, px(0, y).y, 0), 0.3, r2(48 - px(0, y).y), NEGRO, "satinado")),
  ]), v(0, 0, 0));
  const nube = organicoDePiso({
    id: "nube", nombre: "Nube orgánica de R-5 Reflex Champaña", padre: armazon.padre, origen: v(0, 47, 0),
    racimos: [{ nombre: "Nube", puntos: [v(-18, 62, 0), v(16, 62, 0)], radio: 15 }],
    mezcla: { "R-5": 1 }, colores: [colorOrg("971", 5), colorOrg("080", 0.7), colorOrg("981", 1), colorOrg("968", 0.4)],
    semilla: 178, inflados: { "R-5": 12 }, relleno: [{ formatoId: "R-5", infladoCm: 6, trios: true }],
  });
  const nodos: NodoEscena[] = [armazon.nodo, nube.nodo];
  nodos.push(apoyar("remate", "R-12 Reflex Dorado Rosa «Feliz Cumpleaños»", globo(R("R-12", 29, "968"), FANTASIA), nube.padre, px(360, 150, 0), ARRIBA, giroAlFrente(ARRIBA)));
  const TRIOS: ReadonlyArray<[string, number, number]> = [["izquierda", 290, 360], ["centro-arriba", 355, 385], ["centro-abajo", 355, 462], ["derecha", 430, 352], ["bajo-nube-izquierda", 280, 306], ["bajo-nube-centro", 345, 308], ["bajo-nube-derecha", 445, 304]];
  for (const [id, x, y] of TRIOS) nodos.push(colgar({ id: `trio-${id}`, nombre: `Trío de R-5 Reflex Plata (${id.replace(/-/g, " ")})`, pieza: trio(R("R-5", 6, "981")), padre: armazon.padre, origen: px(x, y, 0), normal: ABAJO }).nodo);
  const PIES: ReadonlyArray<[string, number, number, string]> = [
    ["pie-izquierdo-1", -12, 4, "968"], ["pie-izquierdo-2", -9, -3, "968"], ["pie-izquierdo-3", -6, 5, "971"], ["pie-izquierdo-4", -13, 1, "971"],
    ["pie-derecho-1", 6, 4, "968"], ["pie-derecho-2", 12, -2, "968"], ["pie-derecho-3", 9, 1, "971"], ["pie-derecho-4", 14, 5, "971"],
  ];
  PIES.forEach(([id, x, z, codigo], k) => nodos.push(colgar({ id, nombre: `R-5 ${codigo === "968" ? "Reflex Dorado Rosa" : "Reflex Champaña"} al pie de las varillas ${k + 1}`, pieza: globo(R("R-5", 9, codigo)), padre: armazon.padre, origen: v(x, k % 4 === 3 ? 12 : 8.6, z), normal: unitario(v(x * 0.05, 1, z * 0.05)) }).nodo));
  return { sala: sala(260, 240, 220, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea178 = idea("base-organica-feliz-cumpleanos-reflex", "Base orgánica Feliz Cumpleaños reflex con colgantes plata", escena178,
  "Igual: la base cuadrada negra (~28 cm) con sus dos varillas rosadas, la nube orgánica de ~57 cm de R-5 Reflex Champaña con R-5 negros, plata y algún dorado rosa entre 47 y 77 cm, el R-12 Reflex Dorado Rosa impreso «Feliz Cumpleaños» encima (~1,05 m de alto en total), las tres cintas negras con sus 4 tríos de R-5 plata (la del centro con dos) y los 3 tríos plata bajo la nube, y los dos racimitos de R-5 dorado rosa y champaña a los pies, con los colores publicados (champaña, negro y plata). Distinto: el impreso de la foto lleva «Feliz Cumpleaños» manuscrito con destellos: va el «Feliz Cumpleaños Fantasía» reflex de la tienda (el que trae el dorado rosa medido, ΔE 9); el dorado rosa no está publicado; los globos de la nube los da el motor para el tamaño medido; la foto no tiene mesa (va en el piso).", [
  P("GLOBO REDONDO REFLEX CHAMPAÑA", "/products/globo-para-fiesta-latex-redondo-reflex-champana", "R-12", "971"),
  P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
  P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
]);

// ==========================================================================================================
// 179 · Base Te amo
// ==========================================================================================================

/**
 * Foto 1000 × 1000: los T-260 entorchados miden ~30 px (≈ 5 cm) y los R-12 impresos de la base ~180 px (≈ 30 cm): 6
 * px/cm, piso en y = 960 y la varilla rosada en x = 510. De abajo arriba: cuarteto de R-12 «Corazones por siempre» rojo
 * (un globo al frente), cuarteto de R-9 rosados (~16,5 cm), la varilla rosada a la vista con un T-260 rojo y uno rosado
 * que suben en espiral abierta (~1¼ vueltas, ~14 cm del eje), un cuarteto de R-9 blancos (~14 cm), uno de R-9 rosados
 * (~15 cm, un globo al frente) y el corazón rojo «Te amo» con su marco de perlas doradas (~5 cm).
 */
const escena179 = (): Escena => {
  const px = foto(6, 510, 960);
  const base = baseCuarteto("base", "Base: cuarteto de R-12 «Corazones por siempre» rojo", { ...cuarteto(R("R-12", 30, "015"), ["015"]), impresos: [{ impresoId: CORAZONES_ROJO, codigo: "015" }] }, px(0, 830).y, 45);
  const vara = varilla(base.padre, v(0, 1, 0), 112, "#f2a2bd", 1);
  const nodos: NodoEscena[] = [base.nodo, vara.nodo];
  nodos.push(nivel("rosados-abajo", "Cuarteto de R-9 Fashion Rosado de abajo", vara.padre, cuarteto(R("R-9", 16.5, "009"), ["009"]), v(0, px(0, 705).y, 0), 0));
  nodos.push(nivel("blancos", "Cuarteto de R-9 Fashion Blanco", vara.padre, cuarteto(R("R-9", 14, "005"), ["005"]), v(0, px(0, 460).y, 0), 0));
  nodos.push(nivel("rosados-arriba", "Cuarteto de R-9 Fashion Rosado de arriba", vara.padre, cuarteto(R("R-9", 15, "009"), ["009"]), v(0, px(0, 375).y, 0), 45));
  const espiral = (codigo: string, giroGrados: number): Pieza => rizo({ forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 4.8, codigo }, vueltas: 1.25, radioCm: 14, largoCm: 46, eje: "abajo", giroGrados });
  nodos.push(colgar({ id: "espiral-roja", nombre: "T-260 Fashion Rojo en espiral", pieza: espiral("015", 0), padre: vara.padre, origen: v(0, 92, 0), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "espiral-rosada", nombre: "T-260 Fashion Rosado en espiral", pieza: espiral("009", 180), padre: vara.padre, origen: v(0, 92, 0), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "corazon", nombre: "Corazón C-12 Fashion Rojo («Te amo» en la foto)", pieza: globo(R("C-12", 30.5, "015")), padre: vara.padre, origen: v(0, 121, 1), normal: ARRIBA, giroGrados: -90 }).nodo);
  nodos.push(colgar({ id: "perlas", nombre: "Marco de perlas R-5 Reflex Dorado", pieza: marcoCorazon(46, 41, R("R-5", 5.2, "970")), padre: vara.padre, origen: v(0, 100, -2), normal: ARRIBA, giroGrados: -90 }).nodo);
  return { sala: sala(260, 240, 220, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};

/** Un marco de perlas en corazón: solo la hilera del borde de una forma rellena por celdas. */
function marcoCorazon(anchoCm: number, altoCm: number, g: ParteGlobo): Pieza {
  return { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm, altoCm }, tecnica: { tipo: "celdas", formatoId: g.formatoId, infladoCm: g.infladoCm, celda: "cuadrada" }, colores: { codigos: [g.codigo], patron: "un_color" }, marcoCm: r2(g.infladoCm * 0.9) } };
}

const idea179 = idea("base-te-amo", "Base Te amo: corazón con perlas y tubitos en espiral", escena179,
  "Igual: de abajo arriba, el cuarteto de R-12 «Corazones por siempre» rojo (el impreso publicado), el cuarteto de R-9 rosados, la varilla rosada a la vista con el T-260 rojo y el rosado en espiral abierta, el cuarteto de R-9 blancos, el de R-9 rosados y el corazón rojo con su marco de perlas doradas, con los 6 productos que publica la idea. Distinto: el corazón de la foto mide ~55 cm de ancho, casi el doble de un C-12 (30 cm, el que publica la idea y el único que vende la tienda junto al C-6): el 3D lo deja a su tamaño real, así que el remate queda más chico que en la foto (alto total ~1,35 m); el «Te amo» no se imprime (no está en el catálogo de impresos); las perlas de la foto (~5 cm) van como R-5 Reflex Dorado a 5,2 cm (no publicadas; medidas doradas); los rosados y blancos de la foto miden más que un R-5: van R-9 de 14 a 16,5 cm.", [
  P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
  P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005"),
  P("GLOBO REDONDO INFINITY® CORAZONES POR SIEMPRE FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-por-siempre-fashion-rojo", "C-12", null),
  P("GLOBO TUBITO FASHION ROJO", "/products/globo-para-fiesta-latex-tubito-fashion-rojo", "T-260", "015"),
  P("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"),
  P("GLOBO CORAZON TE AMO MODERNO FASHION ROJO", "/products/globo-para-fiesta-latex-corazon-2-caras-te-amo-moderno-fashion-rojo", "C-12", "015"),
]);

// ==========================================================================================================
// 185 · Bebé 1 año (columna)
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 de lunares de la base miden ~57 px (≈ 27,5 cm): 2,07 px/cm, piso en y = 555, eje en x = 358.
 * De abajo arriba: cuarteto de R-12 verde lima con lunares blancos (un globo al frente), cuarteto de R-9 rosados (~22
 * cm), el poste de Link-O-Loon 660 lila (~14,5 cm × 1,06 m) con un T-260 rosado en espiral (2 vueltas) y una flor lila de
 * burbujas con centro verde, cuarteto de R-12 lila (~24 cm) con dos florecitas rosadas a los lados, cuarteto de R-9
 * rosados (~19 cm) y el «1» metalizado rosado de 32". Alto ~2,6 m. Colores medidos (no publica productos): verde lima
 * 031 (ΔE 8), rosado 009 (ΔE 8), lila 050 (ΔE 6).
 */
const escena185 = (): Escena => {
  const px = foto(2.07, 358, 555);
  const base = baseCuarteto("base", "Base: cuarteto de R-12 verde lima con lunares", { ...cuarteto(R("R-12", 27.5, "031"), ["031"]), impresos: [{ impresoId: POLKA_LIMA, codigo: "031" }] }, px(0, 515).y, 45);
  const vara = varilla(base.padre, v(0, 1, 0), 190, "#c8a3d0");
  const nodos: NodoEscena[] = [base.nodo, vara.nodo];
  nodos.push(nivel("rosados-abajo", "Cuarteto de R-9 Fashion Rosado de abajo", vara.padre, cuarteto(R("R-9", 22.5, "009"), ["009"]), v(0, px(0, 462).y, 0), 0));
  nodos.push(varita("poste", "Poste de Link-O-Loon 660 Fashion Lila", vara.padre, { formatoId: "LOL-660", grosorCm: 14.5, codigo: "050" }, v(0, 52, 0), v(0, 151, 0)));
  nodos.push(colgar({ id: "espiral", nombre: "T-260 Fashion Rosado en espiral", pieza: rizo({ forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 4.8, codigo: "009" }, vueltas: 2, radioCm: 9.5, largoCm: 96, eje: "abajo", giroGrados: 30 }), padre: vara.padre, origen: v(0, 148, 0), normal: AL_FRENTE }).nodo);
  nodos.push(colgar({ id: "flor-lila", nombre: "Flor de 5 burbujas de T-260 lila", pieza: florTubito(burbujas("T-260", 4.5, ["050"], 5, 6, 10, 0), R("R-5", 5.5, "031")), padre: vara.padre, origen: px(400, 385, 9), normal: unitario(v(0.6, 0, 0.8)) }).nodo);
  nodos.push(nivel("lilas", "Cuarteto de R-12 Fashion Lila", vara.padre, cuarteto(R("R-12", 24, "050"), ["050"]), v(0, px(0, 228).y, 0), 45));
  const florecita = florTubito(burbujas("T-260", 4, ["009"], 5, 5, 10, 0), R("R-5", 5.5, "009"));
  nodos.push(colgar({ id: "florecita-izquierda", nombre: "Florecita de T-260 rosado (izquierda)", pieza: florecita, padre: vara.padre, origen: v(-17, 156, 14), normal: unitario(v(-0.6, 0, 0.8)) }).nodo);
  nodos.push(colgar({ id: "florecita-derecha", nombre: "Florecita de T-260 rosado (derecha)", pieza: florecita, padre: vara.padre, origen: v(40, 157, 4), normal: unitario(v(1, 0, 0.3)) }).nodo);
  nodos.push(nivel("rosados-arriba", "Cuarteto de R-9 Fashion Rosado de arriba", vara.padre, cuarteto(R("R-9", 19.5, "009"), ["009"]), v(0, px(0, 185).y, 0), 45));
  nodos.push(metalEn("uno", "Número 1 metalizado rosado de 32\"", vara.padre, metal({ tipo: "numero", valor: 1 }, 32, "rosado"), v(0, 186, -2)));
  return { sala: sala(300, 260, 300, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea185 = idea("bebe-1-ano", "Bebé 1 año: columna lila con el 1 rosado", escena185,
  "Igual: la columna de ~2,6 m con sus medidas: base de cuatro R-12 verde lima con lunares blancos (el «Polka» de la tienda), cuarteto de R-9 rosados, el poste de Link-O-Loon 660 lila con el T-260 rosado en espiral de 2 vueltas y la flor lila de 5 burbujas con centro verde, cuarteto de R-12 lila con sus dos florecitas rosadas, cuarteto de R-9 rosados y el «1» metalizado rosado de 32\". Distinto: la idea no publica productos (colores medidos); el «1» rosado no está en el catálogo de la tienda (va genérico, sin producto); la espiral del 3D es pareja (en la foto se abre más abajo) y gasta dos T-260 por su largo; las florecitas de la foto son más chicas y de pétalos más redondos.");

// ==========================================================================================================
// 186 · Bebé arco
// ==========================================================================================================

/**
 * Foto 740 × 570: cada pata entorchada de cuatro T-260 mide ~30 px (≈ 11 cm) y los R-12 amarillos de la base ~75 px (≈
 * 28 cm): 2,7 px/cm, piso en y = 545 y el centro en x = 370 (las patas a ±85 cm). Cada pata: cuarteto de R-12 amarillos,
 * cuarteto de R-12 verde agua de lunares (~23 cm), cuatro T-260 entorchados (verde agua, azul, lila y rosado, ~3 vueltas)
 * y un cuarteto de R-9 verde agua (~15 cm). El arco: cuartetos de R-5 amarillos (~11,5 cm: ~26 cm de grueso) de pata a
 * pata, ~78 cm de flecha, con 17 R-5 de lunares al frente (azul, rosado, verde agua y lila, en ese orden).
 */
const escena186 = (): Escena => {
  const px = foto(2.7, 370, 545);
  const nodos: NodoEscena[] = [];
  for (const [lado, x] of [["izquierda", -85.2], ["derecha", 85.2]] as const) {
    const base = baseCuarteto(`pata-${lado}`, `Pata ${lado}: cuarteto de R-12 Fashion Amarillo`, cuarteto(R("R-12", 28, "020"), ["020"]), px(0, 510).y, 0, 0, x);
    const vara = colgar({ id: `varilla-${lado}`, nombre: `Varilla de la pata ${lado}`, pieza: escenografia([{ forma: "cilindro", base: v(0, 0, 0), radioCm: 0.6, altoCm: 105, hex: "#e6e6e6", acabado: "mate" }]), padre: base.padre, origen: v(x, 1, 0), normal: ARRIBA, giroGrados: -90 });
    nodos.push(base.nodo, vara.nodo);
    nodos.push(nivel(`verdes-${lado}`, `Cuarteto de R-12 Fashion Verde (pata ${lado})`, vara.padre, cuarteto(R("R-12", 23, "030"), ["030"]), v(x, px(0, 455).y, 0), 45));
    (["030", "040", "050", "009"] as const).forEach((codigo, k) => nodos.push(colgar({
      id: `entorchado-${lado}-${k + 1}`, nombre: `T-260 entorchado ${["verde", "azul", "lila", "rosado"][k]} (pata ${lado})`,
      pieza: rizo({ forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 4.6, codigo }, vueltas: 3, radioCm: 3.2, largoCm: 54, eje: "abajo", giroGrados: 90 * k }),
      padre: vara.padre, origen: v(x, 98, 0), normal: AL_FRENTE,
    }).nodo));
    nodos.push(nivel(`verdes-arriba-${lado}`, `Cuarteto de R-9 Fashion Verde (arriba, pata ${lado})`, vara.padre, cuarteto(R("R-9", 15, "030"), ["030"]), v(x, 103.7, 0), 45));
  }
  const ARRANQUE = 104;
  const arco = suelta("arco", "Arco de cuartetos de R-5 Fashion Amarillo", { tipo: "arco", formatoId: "R-5", infladoCm: 11.5, forma: "redondo", anchoCm: 170.4, altoCm: 78, patron: "un_color", colores: ["020"] }, v(0, ARRANQUE, 0));
  nodos.push(arco.nodo);
  const LUNARES = ["040", "009", "030", "650"] as const;
  const NOMBRE: Readonly<Record<string, string>> = { "040": "azul", "009": "rosado", "030": "verde agua", "650": "lila" };
  for (let k = 0; k < 17; k++) {
    const t = rad(170 - (162 * k) / 16);
    const codigo = LUNARES[k % 4]!;
    nodos.push(apoyar(`lunar-${k + 1}`, `R-5 ${NOMBRE[codigo]} de lunares del arco ${k + 1}`, globo(R("R-5", 12.5, codigo)), arco.padre, v(r2(85.2 * Math.cos(t)), r2(ARRANQUE + 78 * Math.sin(t)), -4), AL_FRENTE));
  }
  return { sala: sala(320, 260, 260, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea186 = idea("bebe-arco", "Bebé arco: arco amarillo de lunares con patas entorchadas", escena186,
  "Igual: el arco de cuartetos de R-5 amarillos de ~1,7 m entre patas y ~2 m de alto, con sus 17 lunares contados al frente en el orden de la foto (azul, rosado, verde agua y lila), y las dos patas con sus medidas: cuarteto de R-12 amarillos, cuarteto de R-12 verde agua, cuatro T-260 entorchados (verde agua, azul, lila y rosado) y cuarteto de R-9 verde agua arriba. Distinto: la idea no publica productos (colores medidos: amarillo 020, verde agua → Fashion Verde 030 (ΔE 11), azul 040 (ΔE 5), rosado 009, lila → Pastel Mate Lila 650 en los lunares (ΔE 6) y Fashion Lila 050 en los tubitos); los lunares blancos impresos de los globos verde agua, azules, rosados y lilas no están en el catálogo de la tienda en esos colores: van lisos; el arco del 3D es una media elipse pareja (la foto se abre un poco más arriba).");

// ==========================================================================================================
// 198 · Bouquet amor dorado rosa
// ==========================================================================================================

/**
 * Foto 1600 × 2235 (medida sobre la vista de 1432 × 2000): los R-12 de helio miden ~255 px (≈ 30 cm): 8,5 px/cm, sobre un
 * pedestal negro (su tapa en y = 1900, ~45 cm) y el eje en x = 740. Base orgánica de R-12 dorado rosa (~20 cm), R-5
 * champaña y R-5 cristal rojo, con tres flores de 5 lazos de T-260 (dorado y dorado rosa alternados) con centro rojo, y el
 * corazón metalizado «I love you» apoyado. Arriba, el ramo de helio por pisos: 3 dorado rosa, 2 champaña al frente y un
 * dorado atrás, y el corazón «I love you» de remate; en el amarre, una flor de 6 R-5 dorado rosa con corona dorada.
 */
const escena198 = (): Escena => {
  const MESA = 45;
  const px = foto(8.5, 740, 1900, MESA);
  const pedestal = suelta("pedestal", "Pedestal negro con la base orgánica", escenografia([caja(v(0, MESA / 2, 0), v(40, MESA, 40), "#1d1d1f", "satinado")]), v(0, 0, 0));
  const base = organicoDePiso({
    id: "base", nombre: "Base orgánica dorado rosa, champaña y cristal rojo", padre: pedestal.padre, origen: v(0, MESA + 0.5, 0),
    racimos: [
      { nombre: "Base", puntos: [v(-10, 58, 2), v(10, 58, 0)], radio: 15 },
      { nombre: "Montículo", puntos: [v(-2, 72, 0), v(12, 80, -2)], radio: 12 },
    ],
    mezcla: { "R-12": 0.75, "R-5": 0.25 }, colores: [colorOrg("968", 6, ["R-12"]), colorOrg("971", 4, ["R-5", "R-12"]), colorOrg("915", 3, ["R-5"]), colorOrg("968", 2, ["R-5"])],
    semilla: 198, inflados: { "R-12": 20, "R-5": 12 }, relleno: [{ formatoId: "R-5", infladoCm: 7, trios: true }],
  });
  const nodos: NodoEscena[] = [pedestal.nodo, base.nodo];
  const florLazos = (largoCm: number) => florTubito(lazos("T-260", 4.2, ["970", "968"], 5, largoCm, 10, 15, 0), R("R-5", 7, "915"));
  nodos.push(colgar({ id: "flor-izquierda", nombre: "Flor de lazos dorado y dorado rosa (izquierda)", pieza: florLazos(22), padre: pedestal.padre, origen: px(550, 1755, 14), normal: unitario(v(-0.5, 0.2, 1)) }).nodo);
  nodos.push(colgar({ id: "flor-derecha", nombre: "Flor de lazos dorado y dorado rosa (derecha)", pieza: florLazos(20), padre: pedestal.padre, origen: px(965, 1530, 8), normal: unitario(v(0.6, 0.3, 0.8)) }).nodo);
  nodos.push(colgar({ id: "flor-atras", nombre: "Flor de lazos dorado y dorado rosa (atrás)", pieza: florLazos(20), padre: pedestal.padre, origen: px(640, 1600, -8), normal: unitario(v(-0.3, 0.5, 0.6)) }).nodo);
  nodos.push(metalEn("corazon-base", "Corazón metalizado «I love you» de la base", pedestal.padre, metalTienda("corazon-rosado-i-love-you"), mas(px(815, 1360, 10), v(0, -21, 0))));
  const amarre = px(722, 1150, -2);
  const g = (id: string, nombre: string, codigo: string, x: number, y: number, z: number): GloboHelio => ({ id, nombre, pieza: globo(R("R-12", 30, codigo)), centro: px(x, y, z), direccion: subiendo(amarre, px(x, y, z), 0.35) });
  const helio = ramo({
    id: "ramo", nombre: "Peso y cintas del ramo dorado rosa", amarre, cinta: "#d9b25c",
    globos: [
      g("helio-champana-izquierda", "R-12 Reflex Champaña (piso 2, izquierda)", "971", 585, 510, 0),
      g("helio-champana-derecha", "R-12 Reflex Champaña (piso 2, derecha)", "971", 845, 500, 2),
      g("helio-dorado", "R-12 Reflex Dorado (piso 2, atrás)", "970", 735, 600, -16),
      g("helio-rosa-atras", "R-12 Reflex Dorado Rosa (piso 1, atrás)", "968", 560, 760, -10),
      g("helio-rosa-frente", "R-12 Reflex Dorado Rosa (piso 1, al frente)", "968", 690, 820, 10),
      g("helio-rosa-derecha", "R-12 Reflex Dorado Rosa (piso 1, derecha)", "968", 890, 790, 0),
    ],
    metalizados: [{ id: "corazon-remate", nombre: "Corazón metalizado «I love you» de remate", pieza: metalTienda("corazon-rosado-i-love-you"), base: mas(px(750, 215, -6), v(0, -21, 0)) }],
  });
  nodos.push(...helio.nodos);
  nodos.push(colgar({ id: "flor-amarre", nombre: "Flor de 6 R-5 dorado rosa con corona dorada (en el amarre)", pieza: flor({ petalos: { ...R("R-5", 9, "968"), cantidad: 6, aperturaGrados: 10, giroGrados: 0 }, corona: { ...R("R-5", 5.2, "970"), cantidad: 8 }, centro: { ...R("R-5", 6, "915"), cantidad: 1 } }), padre: helio.padre, origen: px(705, 1180, 4), normal: AL_FRENTE }).nodo);
  return { sala: sala(300, 260, 300, { paredes: "#c9d3cd", piso: "#8c8c8c" }), nodos };
};
const idea198 = idea("bouquet-amor-dorado-rosa", "Bouquet amor dorado rosa: ramo de helio sobre base con flores de lazos", escena198,
  "Igual: el ramo de helio por pisos en sus sitios medidos (3 R-12 Reflex Dorado Rosa abajo, 2 Reflex Champaña y un Reflex Dorado arriba y el corazón «I love you» de remate) con su flor de 6 R-5 dorado rosa y corona dorada en el amarre; la base orgánica de R-12 dorado rosa, R-5 champaña y R-5 cristal rojo con sus tres flores de 5 lazos de T-260 dorado y dorado rosa alternados con centro rojo, y el corazón «I love you» apoyado; todo sobre el pedestal negro (~2,6 m de alto). Distinto: los corazones de la foto son blancos con rayas rosadas y un corazón dorado con «I love you»: va el «Corazón Rosado I love you» de la tienda (el más parecido); los dorados claros de la foto miden champaña (ΔE 14) y así van; el cristal rojo (ΔE 8) no está publicado; los R-12 de la base miden ~20 cm (inflado chico); el alto del pedestal es supuesto (la foto lo corta).", [
  P("GLOBO REDONDO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa", "R-12", "968"),
  P("GLOBO REDONDO REFLEX CHAMPAÑA", "/products/globo-para-fiesta-latex-redondo-reflex-champana", "R-12", "971"),
  P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
]);

// ==========================================================================================================
// 199 · Bouquet baby shower
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 de helio miden ~65 px (≈ 28 cm): 2,3 px/cm, piso en y = 548, eje en x = 365. Base de cuatro
 * R-12 (~25 cm: crema, azul de lunares, lila y blanco) con cadenitas de burbujas azules y un moño amarillo; de ella sube
 * el ramo: un trío de R-12 verde agua impresos (~108 cm), un trío de R-12 blancos (~145 cm), un collar de burbujitas
 * azules bajo cada trío y bajo el tetero, los lazos amarillos y el tetero metalizado «It's a boy» de remate (~76 cm,
 * inclinado ~30°). Colores medidos (no publica productos): verde agua → Aguamarina 037, blanco 005, crema → Eucalipto
 * 027 (ΔE 11), azul 040, lila → Pastel Mate Lila 650 (ΔE 2), amarillo → Amarillo Miel 021 (ΔE 8).
 */
const escena199 = (): Escena => {
  const px = foto(2.3, 365, 548);
  const base = baseCuarteto("base", "Base: cuarteto de R-12 crema, azul, lila y blanco", cuarteto(R("R-12", 25, "027"), ["027", "040", "650", "005"], "espiral"), px(0, 515).y, 45);
  const vara = varilla(base.padre, v(0, 1, 0), 40, "#e8e8e8");
  const collar = (cantidad: number) => rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3.5, codigos: ["040"], largosCm: [3.5], recorrido: "aro", cantidad });
  const nodos: NodoEscena[] = [base.nodo, vara.nodo];
  nodos.push(colgar({ id: "cadena-base", nombre: "Cadena de burbujas de T-260 azul de la base", pieza: collar(46), padre: vara.padre, origen: v(0, 24, 0), normal: ARRIBA }).nodo);
  nodos.push(colgar({ id: "mono-base", nombre: "Moño de T-260 amarillo miel de la base", pieza: mono({ formatoId: "T-260", grosorCm: 4.5, codigo: "021", lazosPorLado: 2, largoLazoCm: 10, anchoLazoCm: 6, aberturaGrados: 30, colas: false, largoColaCm: 0, centro: null }), padre: vara.padre, origen: v(0, 38, 6), normal: unitario(v(0, 0.6, 0.8)) }).nodo);
  const amarre = v(0, 40, 0);
  const g = (id: string, nombre: string, codigo: string, centro: Vec3): GloboHelio => ({ id, nombre, pieza: globo(R("R-12", 27, codigo)), centro, direccion: subiendo(amarre, centro, 0.25) });
  const helio = ramo({
    id: "ramo", nombre: "Peso y cintas del ramo de baby shower", amarre, cinta: "#f2f2f2",
    globos: [
      g("verde-izquierda", "R-12 Aguamarina (piso 1, izquierda)", "037", v(-19, 107.8, -6)), g("verde-centro", "R-12 Aguamarina (piso 1, al frente)", "037", v(0, 106, 8)), g("verde-derecha", "R-12 Aguamarina (piso 1, derecha)", "037", v(17.4, 108, -10)),
      g("blanco-izquierda", "R-12 Fashion Blanco (piso 2, izquierda)", "005", v(-17.4, 145, -6)), g("blanco-centro", "R-12 Fashion Blanco (piso 2, al frente)", "005", v(0, 143, 8)), g("blanco-derecha", "R-12 Fashion Blanco (piso 2, derecha)", "005", v(17, 146, -10)),
    ],
  });
  nodos.push(...helio.nodos);
  for (const [id, y] of [["collar-abajo", 90], ["collar-medio", 126], ["collar-arriba", 162]] as const) nodos.push(colgar({ id, nombre: `Collar de burbujitas de T-260 azul (${id.slice(7)})`, pieza: collar(12), padre: helio.padre, origen: v(0, y, 0), normal: ARRIBA }).nodo);
  nodos.push(colgar({ id: "lazos-tetero", nombre: "Lazos de T-260 amarillo miel bajo el tetero", pieza: mono({ formatoId: "T-260", grosorCm: 4.5, codigo: "021", lazosPorLado: 2, largoLazoCm: 10, anchoLazoCm: 6, aberturaGrados: 35, colas: false, largoColaCm: 0, centro: null }), padre: helio.padre, origen: v(0, 166, 5), normal: AL_FRENTE }).nodo);
  // El tetero «It's a boy»: paneles de foil girados ~31° (la boca arriba a la izquierda).
  const a = rad(31), ejeX = v(r2(Math.cos(a)), r2(Math.sin(a)), 0), ejeY = v(r2(-Math.sin(a)), r2(Math.cos(a)), 0);
  const pie = v(12, 168, 0);
  const panel = (contorno: Array<{ x: number; y: number }>, hex: string, z: number, motivo?: ElementoEscenografia["motivo"]): ElementoEscenografia =>
    ({ forma: "panel", contorno, huecos: [], zCm: z, grosorCm: 5, hex, acabado: "foil", ...(motivo ? { motivo } : {}), en: { origen: pie, ejeX, ejeY } });
  const redondeado = (ancho: number, y0: number, y1: number) => [...ovalo(0, y0 + ancho / 2, ancho / 2, ancho / 2, 16).filter((p) => p.y <= y0 + ancho / 2), ...ovalo(0, y1 - ancho / 2, ancho / 2, ancho / 2, 16).filter((p) => p.y >= y1 - ancho / 2)].sort((p, q) => Math.atan2(p.y - (y0 + y1) / 2, p.x) - Math.atan2(q.y - (y0 + y1) / 2, q.x));
  const tetero: ElementoEscenografia[] = [
    panel(redondeado(24, 0, 52), "#55c8de", -2.5, { dibujo: "texto", texto: "It's a\nBoy!", hex: "#7b3fa1" }),
    panel(redondeado(21, 50, 62), "#c7a4dc", -2),
    panel(redondeado(9, 60, 76), "#f2bf9a", -1.5),
  ];
  nodos.push({ id: "tetero", nombre: "Tetero metalizado «It's a boy»", pieza: escenografia(tetero), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -4, giroGrados: 0 } });
  return { sala: sala(260, 240, 260, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea199 = idea("bouquet-baby-shower", "Bouquet baby shower: tríos de helio con tetero «It's a boy»", escena199,
  "Igual: la base de cuatro R-12 (crema, azul, lila y blanco) con su cadena de burbujas azules y el moño amarillo, y el ramo de helio por pisos con sus medidas: un trío de R-12 verde agua, un trío de R-12 blancos, los tres collares de burbujitas azules, los lazos amarillos y el tetero «It's a boy» de remate inclinado ~30° (~2,3 m de alto). Distinto: la idea no publica productos (colores medidos); los verde agua llevan piecitos y «baby» impresos y los de la base lunares y estrellas: no están en el catálogo de la tienda y van lisos; el tetero metalizado no existe como forma de metalizado: va como paneles de foil (escenografía, sin producto); en la foto las cadenas de la base se enroscan sobre cada globo (aquí un aro alrededor).");

// ==========================================================================================================
// 200 · Bouquet corazón
// ==========================================================================================================

/**
 * Foto 1254 × 1254: los R-12 rojo imperial de la base miden ~290 px (≈ 30 cm): 9,7 px/cm, piso en y = 1215, eje en x =
 * 627. De abajo arriba: cuarteto de R-12 rojo imperial (un globo al frente), cuarteto de R-12 (~22 cm) blush y nácar con
 * 7 R-5 Silk Dorado en dos racimitos, cuarteto de R-9 nácar (~17 cm) y el corazón rojo con su marco de perlas doradas
 * (~7 cm).
 */
const escena200 = (): Escena => {
  const px = foto(9.7, 627, 1215);
  const base = baseCuarteto("base", "Base: cuarteto de R-12 Fashion Rojo Imperial", cuarteto(R("R-12", 30, "016"), ["016"]), px(0, 1060).y, 45);
  const vara = varilla(base.padre, v(0, 1, 0), 78, "#e8e8e8");
  const nodos: NodoEscena[] = [base.nodo, vara.nodo];
  nodos.push(nivel("blush-nacar", "Cuarteto de R-12 Blush Crema y Silk Blanco Nácar", vara.padre, cuarteto(R("R-12", 22, "663"), ["663", "806"], "dos_colores"), v(0, px(0, 805).y, 0), 0));
  const DORADOS: ReadonlyArray<[number, number, number]> = [[-11, 45, 14], [-6, 40, 15], [-8, 50, 12], [-3, 46, 15], [24, 49, 8], [27, 41, 8], [22, 44, 11]];
  DORADOS.forEach(([x, y, z], k) => nodos.push(colgar({ id: `dorado-${k + 1}`, nombre: `R-5 Silk Dorado ${k + 1}`, pieza: globo(R("R-5", 8.8, "870")), padre: vara.padre, origen: v(x, y, z), normal: unitario(v(x * 0.03, 0.4, 1)) }).nodo));
  nodos.push(nivel("nacar", "Cuarteto de R-9 Silk Blanco Nácar", vara.padre, cuarteto(R("R-9", 17, "806"), ["806"]), v(0, px(0, 655).y, 0), 45));
  nodos.push(colgar({ id: "corazon", nombre: "Corazón C-12 Fashion Rojo", pieza: globo(R("C-12", 30.5, "015")), padre: vara.padre, origen: v(0, 81, 1), normal: ARRIBA, giroGrados: -90 }).nodo);
  nodos.push(colgar({ id: "perlas", nombre: "Marco de perlas R-5 Silk Dorado", pieza: marcoCorazon(46, 41, R("R-5", 6, "870")), padre: vara.padre, origen: v(0, 60, -2), normal: ARRIBA, giroGrados: -90 }).nodo);
  return { sala: sala(260, 240, 220, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea200 = idea("bouquet-corazon", "Bouquet corazón: corazón rojo con perlas doradas sobre cuartetos", escena200,
  "Igual: de abajo arriba, el cuarteto de R-12 rojo imperial, el cuarteto de R-12 blush y nácar con sus 7 R-5 Silk Dorado en dos racimitos, el cuarteto de R-9 nácar y el corazón rojo con su marco de perlas doradas, con los productos publicados. Distinto: el corazón de la foto mide ~57 cm de ancho, casi el doble de un C-12 (30 cm, el que publica la idea): el 3D lo deja a su tamaño real, así que el remate queda más chico (alto total ~1 m); las perlas de la foto son burbujas de T-260 Silk Dorado (publicado): van como R-5 Silk Dorado a 6 cm (el taller no arma una cadena de burbujas en contorno de corazón), así que el tubito publicado sale sin cantidad; la «Blush Crema» no está en la tabla oficial: va el Pastel Mate Melón 663 (el más cercano medido, ΔE 6) con el producto publicado; el rojo imperial de la foto mide Merlot (ΔE 10) y va el publicado.", [
  P("GLOBO CORAZON FASHION ROJO", "/products/globo-para-fiesta-latex-corazon-fashion-rojo", "C-12", "015"),
  P("GLOBO REDONDO SILK BLANCO NÁCAR", "/products/globo-latex-redondo-silk-blanco-nacar", "R-12", "806"),
  P("GLOBO REDONDO FASHION BLUSH CREMA", "/products/globo-redondo-fashion-blush-crema", "R-12", null, { codigo3d: "663" }),
  P("GLOBO REDONDO FASHION ROJO IMPERIAL", "/products/globo-latex-redondo-fashion-rojo-imperial", "R-12", "016"),
  P("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870"),
  P("GLOBO TUBITO SILK DORADO", "/products/globo-latex-tubito-silk-rocio-de-oro", "T-260", "870"),
]);

// ==========================================================================================================
// 201 · Bouquet de flores (en maceta)
// ==========================================================================================================

/**
 * Foto 740 × 570: los T-260 miden ~19 px (≈ 5 cm): 3,8 px/cm, con la boca de la maceta en y = 435, su pie en y = 520 y
 * el eje en x = 370. En la maceta blanca (~27 cm × 22 cm): la flor grande de 4 R-9 blush (~16 cm) con un lazo de T-260
 * naranja alrededor de cada uno y centro rosado; arriba, una bola de R-5 frambuesa; dos ramas de T-260 verde salvia con
 * R-5 (rosados a la izquierda, durazno a la derecha); y abajo cuatro flores de tubito (lazos rosa con centro naranja,
 * burbujas naranjas, rosa y rosado claro), con R-9 blush de relleno y hojitas verdes. Alto ~1,2 m.
 */
const escena201 = (): Escena => {
  const px = foto(3.8, 370, 520);
  const BLANCO = "#f6f6f4";
  const maceta = suelta("maceta", "Maceta blanca", escenografia([cilindro(v(0, 0, 0), 13.7, 22.4, BLANCO, "satinado"), cilindro(v(0, 21.6, 0), 12.9, 1, "#4a3a2c")]), v(0, 0, 0));
  const nodos: NodoEscena[] = [maceta.nodo];
  const TALLO = { formatoId: "T-260", grosorCm: 4.5, codigo: "027" };
  const colgado = (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal: Vec3 = AL_FRENTE, giro = 0) => nodos.push(colgar({ id, nombre, pieza, padre: maceta.padre, origen, normal, giroGrados: giro }).nodo);
  nodos.push(varita("tallo-centro", "Tallo de T-260 verde salvia (al centro)", maceta.padre, TALLO, v(0, 20, 0), v(-4, 62, 0)));
  nodos.push(varita("tallo-bola", "Tallo de T-260 verde salvia (a la bola)", maceta.padre, TALLO, v(-2, 86, -1), v(0, 101, -1)));
  nodos.push(varita("rama-izquierda", "Rama de T-260 verde salvia (izquierda)", maceta.padre, TALLO, px(300, 190, -3), px(195, 95, -3)));
  nodos.push(varita("rama-derecha", "Rama de T-260 verde salvia (derecha)", maceta.padre, TALLO, px(425, 240, -3), px(505, 80, -3)));
  colgado("flor-grande", "Flor grande de 4 R-9 blush con centro rosado", flor({ petalos: { ...R("R-9", 16, "661"), cantidad: 4, aperturaGrados: 5, giroGrados: 45 }, centro: { ...R("R-5", 10, "009"), cantidad: 1 } }), px(350, 240, 6), unitario(v(0, 0.15, 1)));
  colgado("lazos-flor-grande", "Lazos de T-260 naranja de la flor grande", florTubito(lazos("T-260", 4.5, ["061"], 4, 26, 19, 0, 45)), px(350, 240, 4), unitario(v(0, 0.15, 1)));
  colgado("bola", "Bola de R-5 Fashion Frambuesa", uvas(R("R-5", 6.5, "014"), 14), px(373, 100, 0));
  const IZQ: ReadonlyArray<[number, number]> = [[190, 100], [208, 95], [218, 118], [242, 128], [262, 140], [245, 160], [232, 155]];
  IZQ.forEach(([x, y], k) => colgado(`rosado-${k + 1}`, `R-5 Fashion Rosado de la rama izquierda ${k + 1}`, globo(R("R-5", 7.5, "009")), px(x, y, k % 2 ? 2 : -1), unitario(v(-0.5, 0.5, 0.6))));
  const DER: ReadonlyArray<[number, number]> = [[490, 82], [515, 80], [535, 97], [487, 128], [512, 135], [476, 170], [502, 168], [495, 195], [452, 212], [462, 228]];
  DER.forEach(([x, y], k) => colgado(`durazno-${k + 1}`, `R-5 Fashion Durazno de la rama derecha ${k + 1}`, globo(R("R-5", 8, "060")), px(x, y, k % 2 ? 2 : -1), unitario(v(0.5, 0.5, 0.6))));
  const RELLENO: ReadonlyArray<[number, number, number]> = [[305, 315, -4], [345, 350, -2], [300, 292, -6]];
  RELLENO.forEach(([x, y, z], k) => colgado(`blush-${k + 1}`, `R-9 blush de relleno ${k + 1}`, globo(R("R-9", 13, "661")), px(x, y, z), unitario(v(-0.2, 0.3, 1))));
  colgado("flor-lazos-rosa", "Flor de lazos de T-260 rosa con centro naranja", florTubito(lazos("T-260", 4.2, ["011"], 5, 14, 7, 10, 0), null, burbujas("T-260", 3.5, ["061"], 5, 4, 30, 0)), px(440, 320, 8), unitario(v(0.3, 0.1, 1)));
  colgado("flor-naranja", "Flor de 5 burbujas de T-260 naranja", florTubito(burbujas("T-260", 4.5, ["061"], 5, 7, 10, 0), R("R-5", 6, "009")), px(365, 400, 12), unitario(v(0, 0.2, 1)));
  colgado("flor-rosa", "Flor de 6 burbujas de T-260 rosa y rosado", florTubito(burbujas("T-260", 4.5, ["011", "009"], 6, 7, 10, 0), R("R-5", 7, "011")), px(295, 405, 8), unitario(v(-0.3, 0.1, 1)));
  colgado("flor-rosado", "Flor de 5 burbujas de T-260 rosado", florTubito(burbujas("T-260", 4.5, ["009"], 5, 6.5, 10, 0), R("R-5", 5.5, "009")), px(430, 395, 6), unitario(v(0.3, 0.1, 1)));
  colgado("hojas", "Hojitas en lazo de T-260 verde salvia", florTubito(lazos("T-260", 4.5, ["027"], 2, 12, 6, 15, 0)), px(375, 425, 10));
  return { sala: sala(240, 220, 200, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea201 = idea("bouquet-de-flores", "Bouquet de flores de tubito en maceta", escena201,
  "Igual: la maceta blanca con la flor grande de 4 R-9 blush y sus 4 lazos de T-260 naranja, la bola de R-5 frambuesa de remate, las dos ramas verdes con sus R-5 contados (7 rosados a la izquierda y 10 durazno a la derecha), las cuatro flores de tubito de abajo (lazos rosa con centro naranja, 5 burbujas naranjas, 6 rosa y rosado, 5 rosado claro), los 3 R-9 blush de relleno y las hojitas, con los productos publicados (~1,2 m). Distinto: la «Blush Crema» no está en la tabla oficial: va el Pastel Mate Nude 661 (el más cercano medido, ΔE 6) con el producto publicado; la bola de arriba mide Fashion Frambuesa (ΔE 10, no publicado) y la rama derecha Fashion Durazno (ΔE 5, no publicado); los tallos verde salvia miden Eucalipto (no publicado); los tallos van rectos (en la foto, las ramas con hojitas en zigzag).", [
  P("GLOBO TUBITO FASHION ROSA", "/products/globo-latex-tubito-fashion-rosa", "T-260", "011"),
  P("GLOBO REDONDO FASHION BLUSH CREMA", "/products/globo-redondo-fashion-blush-crema", "R-12", null, { codigo3d: "661" }),
  P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
  P("GLOBO TUBITO FASHION NARANJA", "/products/globo-para-fiesta-latex-tubito-fashion-naranja", "T-260", "061"),
  P("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"),
]);

// ==========================================================================================================
// 202 · Bouquet Feliz Día con animal print
// ==========================================================================================================

/**
 * Foto 740 × 570 (recorte): los R-12 impresos miden ~62 px (≈ 30 cm) y las letras «FELIZ» ~85 px (16" ≈ 41 cm): 2,1
 * px/cm, piso en y = 560, centro en x = 365. Base orgánica de ~1,8 m (más alta a la izquierda, ~1 m) de R-12 y R-5
 * latte, arena, Reflex Dorado, Reflex Verde Lima e impresos animal print (jirafa, cebra, leopardo); una columna orgánica
 * de R-5 latte y arena hasta ~2,1 m y una guirnalda que baja detrás de «FELIZ»; un R-18 Reflex Dorado; arriba una flor
 * de 8 lazos de T-260 verde lima (~80 cm) con un racimo dorado al centro; y los metalizados plata «1» (34"), «FELIZ» y
 * «DÍA» (16").
 */
const escena202 = (): Escena => {
  const px = foto(2.1, 365, 560);
  const armazon = suelta("armazon", "Armazón del ramo (base y tubo de PVC)", escenografia([cilindro(v(0, 0, 0), 20, 1.5, "#2b2b2b"), cilindro(v(-19, 0, -2), 1.5, 205, "#dcdcd6")]), v(0, 0, 0));
  const R12_R5 = ["R-12", "R-5"];
  const base = organicoDePiso({
    id: "base", nombre: "Base orgánica latte, arena, dorado, verde lima y animal print", padre: armazon.padre, origen: v(0, 0.5, 0),
    racimos: [
      { nombre: "Base", puntos: [v(-62, 22, 0), v(0, 18, 8), v(62, 22, 0)], radio: 24 },
      { nombre: "Montículo izquierdo", puntos: [v(-62, 50, 2), v(-56, 82, 4)], radio: 18 },
      { nombre: "Montículo derecho", puntos: [v(40, 48, 4), v(68, 46, 0)], radio: 22 },
      { nombre: "Columna", puntos: [v(-19, 70, -2), v(-19, 140, -2), v(-17, 200, -2)], radio: 16, radioFin: 13, mezcla: { "R-5": 0.85, "R-12": 0.15 } },
      { nombre: "Guirnalda", puntos: [v(10, 150, -8), v(40, 140, -8), v(62, 118, -8), v(72, 92, -6)], radio: 9, mezcla: { "R-5": 1 } },
    ],
    mezcla: { "R-12": 0.85, "R-5": 0.15 },
    colores: [colorOrg("073", 4, R12_R5), colorOrg("071", 3, R12_R5), colorOrg("970", 2, R12_R5), colorOrg("931", 1.5, R12_R5), colorOrg("570", 1.2, R12_R5), colorOrg("080", 0.8, R12_R5)],
    semilla: 202, inflados: { "R-12": 28, "R-5": 11 }, relleno: [{ formatoId: "R-5", infladoCm: 7, trios: true }],
    impresos: [{ impresoId: ANIMAL, codigo: "570" }, { impresoId: ANIMAL, codigo: "080" }, { impresoId: ANIMAL, codigo: "071", cada: 5 }],
  });
  const nodos: NodoEscena[] = [armazon.nodo, base.nodo];
  nodos.push(apoyar("dorado-grande", "R-18 Reflex Dorado", globo(R("R-18", 44, "970")), base.padre, v(22, 104, -24), AL_FRENTE));
  nodos.push(colgar({ id: "flor", nombre: "Flor de 8 lazos de T-260 Reflex Verde Lima", pieza: florTubito(lazos("T-260", 4.8, ["931"], 8, 34, 17, 10, 0)), padre: armazon.padre, origen: px(330, 90, 2), normal: unitario(v(0, 0.3, 1)) }).nodo);
  nodos.push(colgar({ id: "centro-flor", nombre: "Racimo de R-5 Reflex Dorado al centro de la flor", pieza: uvas(R("R-5", 6, "970"), 8), padre: armazon.padre, origen: px(330, 90, 9), normal: AL_FRENTE }).nodo);
  nodos.push(metalEn("uno", "Número 1 metalizado plata de 34\"", armazon.padre, metal({ tipo: "numero", valor: 1 }, 34, "plata"), px(240, 345, 12)));
  const LETRAS: ReadonlyArray<[string, string, string, number, number, number]> = [
    ["f", "F", "FELIZ", 405, 260, -2], ["e", "E", "FELIZ", 450, 262, -2], ["l", "L", "FELIZ", 495, 265, -2], ["i", "I", "FELIZ", 530, 300, 2], ["z", "Z", "FELIZ", 540, 375, 6],
    ["d", "D", "DÍA", 375, 470, 30], ["i-dia", "I", "DÍA", 425, 475, 30], ["a", "A", "DÍA", 485, 470, 30],
  ];
  for (const [id, valor, palabra, x, y, z] of LETRAS) nodos.push(metalEn(`letra-${id}`, `Letra ${valor} metalizada plata de 16" («${palabra}»)`, armazon.padre, metal({ tipo: "letra", valor }, 16, "plata"), px(x, y, z)));
  return { sala: sala(300, 260, 300, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea202 = idea("bouquet-feliz-dia-con-animal-print", "Bouquet Feliz Día con animal print y flor verde lima", escena202,
  "Igual: la base orgánica de ~1,8 m más alta a la izquierda, la columna orgánica hasta ~2,1 m y la guirnalda detrás de «FELIZ», en los colores publicados (latte, arena, Reflex Dorado y Reflex Verde Lima) con el «Infinity® Animal Print» publicado en todos los dorado metal y negros y en uno de cada cinco arena; el R-18 Reflex Dorado; la flor de 8 lazos de T-260 Reflex Verde Lima con su racimo dorado, y los metalizados plata «1» (34\"), «FELIZ» y «DÍA» (16\") en sus sitios. Distinto: las letras y el número plata no están en el catálogo de la tienda (van genéricos, sin producto) y van derechos (en la foto, la «Z» va acostada y la «I» inclinada); la «Í» va sin tilde; el animal print de la tienda es de manchas: no distingue jirafa, cebra, leopardo y tigre; los globos de lo orgánico los da el motor.", [
  P("GLOBO REDONDO INFINITY® ANIMAL PRINT", "/products/globo-para-fiesta-latex-redondo-infinity-animal-print-fashion-y-metal-surtido", "R-12", null),
  P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
  P("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931"),
  P("GLOBO REDONDO FASHION LATTE", "/products/globo-para-fiesta-latex-redondo-fashion-latte", "R-12", "073"),
  P("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
]);

// ==========================================================================================================
// 204 · Bouquet flores Feliz Día Mamá
// ==========================================================================================================

/**
 * Foto 1000 × 1000: los R-12 fucsia de la base miden ~120 px (≈ 28 cm): 4,3 px/cm, piso en y = 890, centro en x = 490.
 * Base orgánica de R-12 Fashion Fucsia de ~1,3 m × 64 cm; al frente, una flor de 4 corazones fucsia con centro de
 * R-5 dorado rosa y tres florecitas de 6 lazos de T-260 dorado rosa con centro rosado; arriba a la derecha, una flor de
 * 5 corazones rosados con centro fucsia. El ramo de helio: un R-12 Reflex Dorado Rosa arriba y dos corazones
 * metalizados («Feliz Día Mamá» y «Día de la Madre»).
 */
const escena204 = (): Escena => {
  const px = foto(4.3, 490, 890);
  const armazon = suelta("armazon", "Armazón de la base (tubo de PVC)", escenografia([cilindro(v(0, 0, 0), 4, 1.5, "#2b2b2b"), cilindro(v(-6, 0, -4), 1.2, 60, "#dcdcd6")]), v(0, 0, 0));
  const base = organicoDePiso({
    id: "base", nombre: "Base orgánica de R-12 Fashion Fucsia", padre: armazon.padre, origen: v(0, 0.5, 0),
    racimos: [
      { nombre: "Fila de abajo", puntos: [v(-42, 22, 0), v(42, 22, 0)], radio: 22 },
      { nombre: "Fila de arriba", puntos: [v(-30, 48, -2), v(36, 48, -2)], radio: 17 },
    ],
    mezcla: { "R-12": 1 }, colores: [colorOrg("012", 1)], semilla: 204, inflados: { "R-12": 28 }, relleno: [{ formatoId: "R-12", infladoCm: 24, trios: false }],
  });
  const nodos: NodoEscena[] = [armazon.nodo, base.nodo];
  const florCorazones = (c: ParteGlobo, cantidad: number, apertura: number): Pieza => deco({ tipo: "flor_corazones", propiedades: { corazones: { ...c, cantidad, aperturaGrados: apertura, giroGrados: 45 }, interior: null, centro: null } });
  nodos.push(apoyar("flor-fucsia", "Flor de 4 corazones C-6 Fashion Fucsia", florCorazones(R("C-6", 15.2, "012"), 4, 5), base.padre, px(330, 790, 0), AL_FRENTE));
  nodos.push(apoyar("centro-fucsia", "Centro de R-5 Reflex Dorado Rosa de la flor fucsia", uvas(R("R-5", 5.5, "968"), 7), base.padre, px(330, 790, 4), AL_FRENTE));
  nodos.push(apoyar("flor-rosada", "Flor de 5 corazones C-12 Fashion Rosado", florCorazones(R("C-12", 19, "009"), 5, 10), base.padre, px(580, 560, -4), unitario(v(0, 0.5, 0.8))));
  nodos.push(apoyar("centro-rosada", "Centro de R-5 Fashion Fucsia de la flor rosada", uvas(R("R-5", 5.5, "012"), 7), base.padre, px(580, 560, 0), unitario(v(0, 0.5, 0.8))));
  const FLORECITAS: ReadonlyArray<[number, number]> = [[480, 760], [640, 770], [735, 745]];
  FLORECITAS.forEach(([x, y], k) => nodos.push(apoyar(`florecita-${k + 1}`, `Florecita de 6 lazos de T-260 Reflex Dorado Rosa ${k + 1}`, florTubito(lazos("T-260", 3.5, ["968"], 6, 8, 5, 10, 0), R("R-5", 5.5, "009")), base.padre, px(x, y, 0), AL_FRENTE)));
  const amarre = px(465, 615, 0);
  const helio = ramo({
    id: "ramo", nombre: "Peso y cintas del ramo Feliz Día Mamá", amarre, cinta: "#f4f4f4",
    globos: [{ id: "helio-dorado-rosa", nombre: "R-12 Reflex Dorado Rosa (arriba)", pieza: globo(R("R-12", 30, "968")), centro: px(460, 205, -6), direccion: subiendo(amarre, px(460, 205, -6), 0.2) }],
    metalizados: [
      { id: "corazon-feliz-dia", nombre: "Corazón metalizado «Feliz Día Mamá» (izquierda)", pieza: metalTienda("globo-met-18-c-zon-feliz-dia-mama-x-1"), base: mas(px(315, 465, 4), v(0, -21, 0)) },
      { id: "corazon-dia-madre", nombre: "Corazón metalizado («Día de la Madre» en la foto)", pieza: metalTienda("globo-met-18-c-zon-feliz-dia-mama-x-1"), base: mas(px(480, 395, -4), v(0, -21, 0)) },
    ],
  });
  nodos.push(...helio.nodos);
  return { sala: sala(300, 260, 240, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea204 = idea("bouquet-flores-feliz-dia-mama", "Bouquet flores Feliz Día Mamá: base fucsia con flores de corazones", escena204,
  "Igual: la base orgánica de R-12 Fashion Fucsia de ~1,3 m × 64 cm, la flor de 4 corazones fucsia con su centro de R-5 dorado rosa al frente, las tres florecitas de 6 lazos de T-260 Reflex Dorado Rosa con centro rosado, la flor de 5 corazones rosados con centro fucsia arriba a la derecha y el ramo de helio: el R-12 Reflex Dorado Rosa arriba y dos corazones metalizados de 18\", con los 4 productos publicados. Distinto: el corazón de la derecha dice «Día de la Madre» en la foto: va el «Feliz Día Mamá» publicado para los dos; los corazones de las flores no se fabrican en fucsia en C-12: la fucsia va en C-6 (15 cm; en la foto ~22 cm) y la rosada en C-12 Fashion Rosado (la foto es cromada); el moño de T-260 que nombra la clasificación no se ve en la foto y no va; el fucsia de la foto es más eléctrico (va el publicado).", [
  P("GLOBO METALIZADO CORAZON FELIZ DIA MAMA", "/products/globo-met-18-c-zon-feliz-dia-mama-x-1", null, null),
  P("GLOBO REDONDO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa", "R-12", "968"),
  P("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
  P("GLOBO TUBITO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-tubito-reflex-dorado-rosa", "T-260", "968"),
]);

// ==========================================================================================================
// 208 · Bouquet sombrero Día del Padre
// ==========================================================================================================

/**
 * Foto 740 × 570: los R-12 de helio miden ~90 px (≈ 28 cm): 3,2 px/cm, piso en y = 555, eje en x = 370. El sombrero de
 * copa: un R-12 negro de copa (~25 cm), una cinta de T-260 arena y el ala de dos aros de Link-O-Loon 660 negro (~11 y 14
 * cm de grueso; el de abajo más ancho). Del sombrero sale el ramo de 6 R-12 por pisos: azul caribe con bigote arriba,
 * amarillo «WOW» atrás, verde y azul «Feliz Día Papá», naranja con bigote y rojo «WOW». Colores medidos (no publica
 * productos): caribe 038, amarillo miel 021, verde lima 031, azul hortensia 042, naranja 061, rojo 015, negro 080, arena
 * 071.
 */
const escena208 = (): Escena => {
  const px = foto(3.2, 370, 555);
  const amarre = px(370, 405, 0);
  const g = (id: string, nombre: string, pieza: Pieza, x: number, y: number, z: number): GloboHelio => ({ id, nombre, pieza, centro: px(x, y, z), direccion: subiendo(amarre, px(x, y, z), 0.35) });
  const helio = ramo({
    id: "ramo", nombre: "Peso y cintas del ramo con sombrero", amarre, cinta: "#f2f2f2", peso: null,
    globos: [
      g("helio-caribe", "R-12 Fashion Azul Caribe (piso 4, bigote en la foto)", globo(R("R-12", 28, "038")), 368, 55, -6),
      g("helio-amarillo", "R-12 Fashion Amarillo Miel (piso 4, atrás; «WOW» en la foto)", globo(R("R-12", 28, "021")), 410, 100, -14),
      g("helio-verde", "R-12 Fashion Verde Lima (piso 3; «Feliz Día Papá» en la foto)", globo(R("R-12", 28, "031")), 340, 170, 0),
      g("helio-azul", "R-12 azul rey «Feliz Día Papá»", globo(R("R-12", 28, "041"), PAPA_OESTE), 415, 210, 6),
      g("helio-naranja", "R-12 Fashion Naranja (piso 2, bigote en la foto)", globo(R("R-12", 28, "061")), 332, 270, 8),
      g("helio-rojo", "R-12 Fashion Rojo (piso 1; «WOW» en la foto)", globo(R("R-12", 28, "015")), 418, 300, 2),
    ],
  });
  const nodos: NodoEscena[] = [...helio.nodos];
  const colgado = (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal: Vec3, giro = 0) => nodos.push(colgar({ id, nombre, pieza, padre: helio.padre, origen, normal, giroGrados: giro }).nodo);
  colgado("copa", "Copa del sombrero: R-12 Fashion Negro", globo(R("R-12", 26, "080")), px(370, 440, 0), ARRIBA, -90);
  colgado("cinta-sombrero", "Cinta del sombrero: aro de T-260 Fashion Arena", aro({ formatoId: "T-260", grosorCm: 4.5, codigo: "071" }, 12.5), v(0, 23.5, 0), AL_FRENTE);
  colgado("ala-arriba", "Ala del sombrero: aro de Link-O-Loon 660 negro (arriba)", aro({ formatoId: "LOL-660", grosorCm: 11, codigo: "080" }, 18), v(0, 16.5, 0), AL_FRENTE);
  colgado("ala-abajo", "Ala del sombrero: aro de Link-O-Loon 660 negro (abajo)", aro({ formatoId: "LOL-660", grosorCm: 14, codigo: "080" }, 22), v(0, 7, 0), AL_FRENTE);
  return { sala: sala(260, 240, 220, { piso: "#efefef", paredes: "#ffffff", techo: "#ffffff" }), nodos };
};
const idea208 = idea("bouquet-sombrero-dia-del-padre", "Bouquet sombrero Día del Padre: ramo de helio sobre sombrero de copa", escena208,
  "Igual: el sombrero de copa negro (R-12 de copa, cinta de T-260 arena y ala de dos aros de Link-O-Loon 660 negro, el de abajo más ancho) y el ramo de 6 R-12 de helio por pisos saliendo de la copa, en sus colores medidos y sitios: azul caribe arriba, amarillo atrás, verde, azul, naranja y rojo (~1,7 m). Distinto: la idea no publica productos; los impresos de la foto (caras con bigote, «WOW» y «Feliz Día Papá» con estrellas) no están en el catálogo de la tienda: el azul va con el «Feliz Día Papá Oeste» (el más parecido; lo trae en Azul Rey, y la foto mide Azul Hortensia) y los demás van lisos; la copa de la foto es más cilíndrica que un R-12.");

/** Ideas de fiesta de sempertex.com digitalizadas: lote 16. */
export const LOTE_16: readonly IdeaDigitalizada[] = [idea155, idea172, idea174, idea177, idea178, idea179, idea185, idea186, idea198, idea199, idea200, idea201, idea202, idea204, idea208];
