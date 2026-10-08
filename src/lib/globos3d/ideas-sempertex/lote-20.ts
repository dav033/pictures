import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { LOTE_17 } from "./lote-17";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { ElementoEscenografia, MotivoEscenografia } from "../escenografia";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion } from "../figuras";
import type { Vec3 } from "../modulos";
import type { PatronColumna } from "../columnas";
import type { OpcionesMetalizado } from "../metalizados";
import { centroCuerpo } from "../geometria";
import type { Accesorio, Cara, PropiedadesFigura } from "../figuras-tubito";
import type { ParteTubito } from "../halloween";
import type { PropiedadesRizo } from "../rizos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 20** (los números de `clasif/lote-20.json`): el corazón
 * orgánico «Love» (#429), el centro de mesa cristal (#449, la misma foto que #277 del lote 17), las cuatro cruces de
 * primera comunión (#450 celestial, #451 dorada, #452 pink y #454), las columnas de cumpleaños cupcakes (#461), rock star
 * (#464) y neón (#551), la medusa de corazones (#496), el ramo dorado-eucalipto-arena (#504), el duende (#512), el
 * fantasma de Halloween (#543) y los dos faroles navideños (#545 verde y #546).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada con rejilla de
 * píxeles y medida:
 * - **Escala**: la de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 22 cm, R-12 ≈ 28 cm, R-18 ≈ 42 cm,
 *   R-24 ≈ 55 cm; un metalizado de 18" ≈ 42–45 cm). Las cruces no traen referencia: su escala sale de casar el ancho
 *   y el paso de su columna de R-5 con la columna del taller (cada escena dice la suya). Las posiciones se escriben en
 *   el mundo con `foto(eje, piso, px/cm)`: x a la derecha del eje de la pieza, y desde el piso.
 * - **Conteo**: lo que se ve, uno a uno, y lo que la técnica obliga detrás (el cuarto globo de un cuarteto); los
 *   niveles de las columnas, contados. Ninguna idea publica «Materiales» con cantidades: lo contado va `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana de un
 *   parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y el código más cercano que se fabrica en
 *   ese formato (un Fashion si queda a ≤ 6 ΔE del mejor). Cada nota dice lo medido cuando se aparta.
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando la idea lo publica; si no, el más parecido del catálogo
 *   y la nota lo dice. Los metalizados que la tienda no tiene (estrella «Rock star», redondos de cupcake, letras
 *   «love») van genéricos, sin producto; las formas que el generador de metalizados no tiene (el cupcake y la
 *   guitarra) van como paneles de foil (escenografía, no cotizan).
 * - **Montaje** (como los lotes 05 y 17): la estructura principal es el nodo raíz (suelta); de ella cuelga (`sobre`)
 *   su varilla y de la varilla todo lo demás, en el sitio exacto de la foto. La varilla va **escondida**: por el eje
 *   de las columnas (dentro de los globos), dentro del peso del ramo, dentro del cuarteto de la medusa o detrás del
 *   corazón; ningún disco ni pieza de amarre queda a la vista. El ramo (#504), que no tiene estructura, lleva de raíz
 *   su peso (como los ramos del lote 16).
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
const IZQUIERDA = v(-1, 0, 0);
const DERECHA = v(1, 0, 0);
/** Hacia fuera en el plano del piso: 0° = al frente (+z), 90° = a la derecha de quien mira (+x). */
const fuera = (grados: number): Vec3 => v(r2(Math.sin(rad(grados))), 0, r2(Math.cos(rad(grados))));
/** Dirección hacia fuera `grados` alrededor y levantada `elevacion` grados sobre el plano del piso. */
const haciaFuera = (grados: number, elevacion: number): Vec3 => unitario(mas(por(fuera(grados), Math.cos(rad(elevacion))), por(ARRIBA, Math.sin(rad(elevacion)))));
/** Un punto a `radio` del eje vertical, en el ángulo `grados` (0° al frente), a la altura `y`. */
const enAnillo = (grados: number, radio: number, y: number): Vec3 => mas(por(fuera(grados), radio), v(0, y, 0));
/** Del píxel de una foto al mundo: x desde el eje de la pieza, y desde el piso (la fila `piso`), a `pxPorCm`. */
const foto = (eje: number, piso: number, pxPorCm: number, pxPorCmY = pxPorCm) => (x: number, y: number, z = 0): Vec3 => v(r2((x - eje) / pxPorCm), r2((piso - y) / pxPorCmY), z);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const T = (formatoId: string, grosorCm: number, codigo: string): ParteTubito => ({ formatoId, grosorCm, codigo });
const sala = (anchoCm = 340, fondoCm = 300, altoCm = 260): Sala => ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm });
const SIN_CARA: Cara = { ojos: null, boca: null, mejillas: null, bigote: null, nariz: null, cejas: null };

/** El giro sobre la normal que deja la cara (+z local) de la pieza lo más hacia quien mira (+z): lo impreso al frente. */
function giroAlFrente(normal: Vec3): number {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  return Math.round((Math.atan2(-xL.z, zL.z) * 180) / Math.PI);
}

/** Curva suave (Catmull-Rom) por unos puntos de frente: `pasos` tramos entre cada par (los tentáculos, los rizos). */
function suave(puntos: ReadonlyArray<readonly [number, number]>, pasos = 3): Array<readonly [number, number]> {
  if (puntos.length < 3) return [...puntos];
  const salida: Array<readonly [number, number]> = [];
  for (let i = 0; i < puntos.length - 1; i++) {
    const p0 = puntos[Math.max(0, i - 1)]!, p1 = puntos[i]!, p2 = puntos[i + 1]!, p3 = puntos[Math.min(puntos.length - 1, i + 2)]!;
    for (let k = 0; k < pasos; k++) {
      const t = k / pasos, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, d: number, e: number) => 0.5 * (2 * b + (-a + d) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (-a + 3 * b - 3 * d + e) * t3);
      salida.push([r2(c(p0[0], p1[0], p2[0], p3[0])), r2(c(p0[1], p1[1], p2[1], p3[1]))]);
    }
  }
  salida.push(puntos[puntos.length - 1]!);
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Piezas sueltas
// ----------------------------------------------------------------------------------------------------------

/** Un nivel de cuarteto como columna de un nivel (`giro` 0: un hueco al frente; 45: un globo al frente). */
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color", impresos?: ImpresoEnPieza[]): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) });

/** Una columna de `niveles` cuartetos al paso del taller (0,8 diámetros); su origen es el centro del primero. */
const columna = (g: ParteGlobo, niveles: number, colores: string[], patron: PatronColumna = "un_color"): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8 * niveles), patron, colores });

const figura = (p: Omit<PropiedadesFigura, "postura" | "base" | "piernas" | "cuerpo" | "cuello" | "cabeza" | "brazos"> & Partial<PropiedadesFigura>): Decoracion => ({
  tipo: "figura",
  propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, ...p },
});

const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });

/**
 * Un tubito de frente que sigue líneas quebradas y arcos (tentáculos, brazos, rizos): una figura vacía con cadenas de
 * burbujas. Las coordenadas van como las ve quien mira la foto (cm: a su derecha, arriba); como una pieza `sobre` queda
 * en espejo (el marco de un ancla es de mano izquierda), aquí se reflejan para que se vea como en la foto (lote 17).
 */
type TrazoFrente = { tipo: "linea"; puntos: ReadonlyArray<readonly [number, number]> } | { tipo: "arco"; centro: readonly [number, number]; radioCm: number; desdeGrados: number; hastaGrados: number };
function trazos(t: ParteTubito, partes: readonly TrazoFrente[], queEs: string): Decoracion {
  const accesorios: Accesorio[] = partes.map((p): Accesorio => {
    if (p.tipo === "arco") {
      return { en: "base", corrimientoCm: [-p.centro[0], 0, p.centro[1]], forma: { tipo: "aro", tubito: t, radioCm: p.radioCm, plano: "frente", desdeGrados: 180 - p.hastaGrados, hastaGrados: 180 - p.desdeGrados } };
    }
    const [x0, y0] = p.puntos[0]!;
    const largos: number[] = [], angulos: number[] = [];
    for (let i = 1; i < p.puntos.length; i++) {
      const [xa, ya] = p.puntos[i - 1]!, [xb, yb] = p.puntos[i]!;
      largos.push(r2(Math.hypot(xb - xa, yb - ya)));
      angulos.push(r2((Math.atan2(yb - ya, -(xb - xa)) * 180) / Math.PI));
    }
    return { en: "base", corrimientoCm: [-x0, 0, y0], forma: { tipo: "burbujas", tubito: t, largosCm: largos, angulosGrados: angulos } };
  });
  return figura({ accesorios, queEs });
}

/** El punto más bajo que dibujan unos trazos (antes de que la figura se apoye en z = 0). */
function bajoDeTrazos(partes: readonly TrazoFrente[]): number {
  let minimo = Infinity;
  for (const p of partes) {
    if (p.tipo === "linea") for (const [, y] of p.puntos) minimo = Math.min(minimo, y);
    else for (let a = p.desdeGrados; a <= p.hastaGrados + 1e-9; a += Math.max(1, (p.hastaGrados - p.desdeGrados) / 36)) minimo = Math.min(minimo, p.centro[1] + p.radioCm * Math.sin(rad(a)));
  }
  return minimo;
}

/** Lo que sube el (0, 0) de unos trazos al apoyarse la figura en z = 0. */
const subidaDeTrazos = (t: ParteTubito, partes: readonly TrazoFrente[]): number => r2(t.grosorCm / 2 - bajoDeTrazos(partes));

/** Un panel de foil (escenografía: el papel metalizado de un globo que el generador de metalizados no tiene). */
const panelFoil = (contorno: ReadonlyArray<readonly [number, number]>, grosorCm: number, hex: string, motivo?: MotivoEscenografia, adelanteCm = 0): ElementoEscenografia => ({
  forma: "panel", contorno: contorno.map(([x, y]) => ({ x: r2(x), y: r2(y) })), zCm: r2(-grosorCm / 2 + adelanteCm), grosorCm, hex, acabado: "foil", ...(motivo ? { motivo } : {}),
});

/** Un óvalo de `n` puntos (antihorario) con centro (x, y). */
const ovalo = (x: number, y: number, rx: number, ry: number, n = 24): Array<readonly [number, number]> =>
  Array.from({ length: n }, (_, i): readonly [number, number] => [r2(x + rx * Math.cos((2 * Math.PI * i) / n)), r2(y + ry * Math.sin((2 * Math.PI * i) / n))]);

// ----------------------------------------------------------------------------------------------------------
// Montaje: la estructura principal como raíz, su varilla (escondida) y lo que cuelga de la varilla
// ----------------------------------------------------------------------------------------------------------

/** Lo que se hunde una pieza `sobre` otra (`HUNDIMIENTO_SOBRE_CM` de la escena). */
const HUNDIDO = 1.5;
/** Varilla con normal hacia arriba y giro −90°: su marco local es el del mundo con x al revés. */
const GIRO_VARILLA = -90;

/** Alto bajo el origen de una pieza armada (−min.y de su caja): lo que la escena corre al apoyarla `sobre` algo sin globos. */
const bajoOrigen = (pieza: Pieza): number => -armarPieza(pieza).caja.min.y;

type Montaje = {
  nodos: NodoEscena[];
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro del cuerpo en `centro`, hacia `direccion` (con su impreso de la tienda, al frente). */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un globo de helio (como `globo`): su nudo queda anotado para las cintas. */
  helio: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, impresoId?: string, direccion?: Vec3) => void;
  /** Una burbuja de helio (decoración `burbuja`) con el centro del globo de fuera en `centro`; su nudo, para las cintas. */
  burbujaHelio: (id: string, nombre: string, pieza: Pieza, exterior: ParteGlobo, centro: Vec3) => void;
  /** Un globo con cara impresa (de pie y de frente) con el centro del cuerpo en `centro`. */
  conCara: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, cara: Cara, queEs: string) => void;
  /** Un metalizado de pie y de frente con el centro en `centro` (su base anotada para las cintas si `conCinta`). */
  foil: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3, conCinta?: boolean) => void;
  /** Paneles de foil (contorno de frente con la base en y = 0, centrado) con la base en `base`, de pie y de frente. */
  foilPaneles: (id: string, nombre: string, elementos: ElementoEscenografia[], base: Vec3, conCinta?: boolean) => void;
  /** Un nivel de cuarteto con su centro en `centro`, girado `giroGrados` (0° = un hueco al frente; 45° = un globo al frente). */
  nivel: (id: string, nombre: string, pieza: Pieza, centro: Vec3, giroGrados: number) => void;
  /** Una decoración con su origen en `origen`, mirando hacia `normal` (su +y local) y girada `giroGrados`. */
  deco: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados?: number) => void;
  /** Unos trazos de tubito con su punto (0, 0) en `origen`, en el plano vertical de frente: su «arriba» es el del mundo. */
  trazo: (id: string, nombre: string, t: ParteTubito, partes: readonly TrazoFrente[], origen: Vec3, queEs: string) => void;
  /** Un tallo recto de tubito de `desde` a `hasta` (dos burbujas en línea). */
  palito: (id: string, nombre: string, t: ParteTubito, desde: Vec3, hasta: Vec3) => void;
  /** Las cintas de los globos de helio anotados, desde `amarre` (mundo). */
  cintas: (amarre: Vec3, hex: string, nombre?: string) => void;
  escena: (s?: Sala) => Escena;
};

/** Una cinta (escenografía: no cotiza) de `desde` a `hasta`, en el mundo. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado: "satinado", en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

/**
 * Arma el montaje: `raiz` suelta con su origen en `origen` (mundo); su varilla, con la base en `varilla.base` (mundo),
 * en un sitio sin globos debajo (el eje hueco de los cuartetos, dentro de un peso o detrás de la pieza), así la escena
 * no la corre y queda donde se pide. Lo demás cuelga de la varilla.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; origen: Vec3; giroGrados?: number }, varilla: { nombre: string; base: Vec3; altoCm: number; radioCm: number; hex: string }): Montaje {
  const nodos: NodoEscena[] = [{ id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: { en: "libre", xCm: raiz.origen.x, yCm: raiz.origen.y, zCm: raiz.origen.z, giroGrados: raiz.giroGrados ?? 0 } }];
  const puntoVarilla = mas(menos(varilla.base, raiz.origen), v(0, HUNDIDO, 0));
  nodos.push({
    id: "varilla", nombre: varilla.nombre,
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: varilla.radioCm, altoCm: varilla.altoCm, hex: varilla.hex, acabado: "mate" }] },
    colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(puntoVarilla), normal: ARRIBA, giroGrados: GIRO_VARILLA },
  });
  const O = varilla.base;
  const aVarilla = (p: Vec3): Vec3 => redondo(v(-(p.x - O.x), p.y - O.y, p.z - O.z));
  const dirAVarilla = (d: Vec3): Vec3 => redondo(v(-d.x, d.y, d.z));
  const nudos: Vec3[] = [];
  const pieza = (id: string, nombre: string, p: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    const punto = menos(origen, por(n, bajoOrigen(p) - HUNDIDO));
    nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: "varilla", puntoCm: aVarilla(punto), normal: dirAVarilla(n), giroGrados } });
  };
  const globo = (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion: Vec3 = ARRIBA, impresoId?: string) => {
    const p: Pieza = { tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
    pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
  };
  const deco = (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados = 0) => pieza(id, nombre, { tipo: "decoracion", decoracion }, origen, normal, giroGrados);
  return {
    nodos, pieza, globo, deco,
    helio: (id, nombre, g, centro, impresoId, direccion = ARRIBA) => {
      globo(id, nombre, g, centro, direccion, impresoId);
      nudos.push(menos(centro, por(unitario(direccion), centroCuerpo("redondo", g.infladoCm))));
    },
    burbujaHelio: (id, nombre, p, exterior, centro) => {
      // La burbuja de pie y de frente: su nudo (el origen) bajo el centro del globo de fuera.
      const nudo = menos(centro, v(0, centroCuerpo("redondo", exterior.infladoCm), 0));
      pieza(id, nombre, p, nudo, AL_FRENTE);
      nudos.push(nudo);
    },
    conCara: (id, nombre, g, centro, cara, queEs) => {
      // De pie y de frente (normal al frente): el +z de la figura sube y su +y mira a quien ve.
      const p: Pieza = { tipo: "decoracion", decoracion: figura({ cuerpo: [{ tipo: "globo", globo: g, cara }], accesorios: [], queEs }) };
      const gl = armarPieza(p).globos[0]!;
      const c = mas(gl.nudo, por(gl.direccion, centroCuerpo("redondo", g.infladoCm)));
      pieza(id, nombre, p, menos(centro, v(c.x, c.z, c.y)), AL_FRENTE);
    },
    foil: (id, nombre, m, centro, conCinta = true) => {
      const p: Pieza = { tipo: "metalizado", metalizado: m };
      const caja = armarPieza(p).caja;
      const base = v(centro.x, r2(centro.y - (caja.max.y - caja.min.y) / 2), centro.z);
      // Normal arriba y el giro de la varilla: el panel queda de frente y sin espejo.
      pieza(id, nombre, p, base, ARRIBA, GIRO_VARILLA);
      if (conCinta) nudos.push(base);
    },
    foilPaneles: (id, nombre, elementos, base, conCinta = true) => {
      // Igual que un metalizado: paneles en el plano xy de la pieza (base en y = 0), de frente y sin espejo.
      pieza(id, nombre, { tipo: "escenografia", elementos }, base, ARRIBA, GIRO_VARILLA);
      if (conCinta) nudos.push(base);
    },
    nivel: (id, nombre, p, centro, giroGrados) => pieza(id, nombre, p, centro, ARRIBA, GIRO_VARILLA - giroGrados),
    trazo: (id, nombre, t, partes, origen, queEs) => {
      const p: Pieza = { tipo: "decoracion", decoracion: trazos(t, partes, queEs) };
      // La figura se apoya en z = 0 (su arriba, con la normal al frente, es el del mundo): su (0, 0) sube lo que bajaba
      // el punto más bajo, más medio grosor.
      pieza(id, nombre, p, menos(origen, v(0, subidaDeTrazos(t, partes), 0)), AL_FRENTE);
    },
    palito: (id, nombre, t, desde, hasta) => {
      const d = menos(hasta, desde);
      const n = unitario(d);
      const p: Pieza = { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: t.formatoId, grosorCm: t.grosorCm, codigos: [t.codigo], cantidad: 2, estilo: "burbuja", largoCm: r2(largo(d)), anchoCm: t.grosorCm, aperturaGrados: -90, giroGrados: 0 }, interior: null, corona: null, centro: null } } };
      pieza(id, nombre, p, mas(desde, por(n, bajoOrigen(p))), n);
    },
    cintas: (amarre, hex, nombre = "Cintas del helio") => {
      const lista = nudos.map((n) => cinta(amarre, n, hex));
      if (!lista.length) return;
      const p: Pieza = { tipo: "escenografia", elementos: lista.map((e) => (e.en ? { ...e, en: { origen: aVarilla(e.en.origen), ejeX: dirAVarilla(e.en.ejeX), ejeY: dirAVarilla(e.en.ejeY) } } : e)) };
      nodos.push({ id: "cintas", nombre, pieza: p, colocacion: { en: "sobre", padreId: "varilla", puntoCm: v(0, r2(-bajoOrigen(p) + HUNDIDO), 0), normal: ARRIBA, giroGrados: GIRO_VARILLA } });
    },
    escena: (s = sala()) => ({ sala: s, nodos }),
  };
}

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

/** Un producto que la idea publica (nombre y url tal cual, con el formato y código del mapeo de la idea). */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };
const pub = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });

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
 * y color de fondo; cada metalizado de la tienda; y los lisos (lo que queda de cada formato y código). Lo que la idea
 * publica sale con su nombre y url tal cual (si la foto no lo tiene, sin cantidad); lo demás, con el liso de la tienda.
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
  for (const u of impresos.values()) {
    const i = impresoPorId(u.impresoId)!;
    const publicado = publicados.find((p) => p.url === i.url);
    if (publicado) usados.add(publicado);
    salida.push({ nombre: publicado?.nombre ?? i.nombre, url: i.url, formato: u.formatoId, codigo: u.codigo, cantidad: u.cantidad, contada: true });
    restar.set(`${u.formatoId}|${u.codigo}`, (restar.get(`${u.formatoId}|${u.codigo}`) ?? 0) + u.cantidad);
  }
  for (const m of metalizados.values()) {
    const publicado = publicados.find((p) => p.url === m.url);
    if (publicado) usados.add(publicado);
    salida.push({ nombre: publicado?.nombre ?? m.nombre, url: m.url, formato: null, codigo: null, cantidad: m.cantidad, contada: true });
  }
  for (const m of armada.materiales) {
    const cantidad = Math.ceil(m.cantidad - (restar.get(`${m.formatoId}|${m.codigo}`) ?? 0) - 1e-9);
    if (cantidad <= 0) continue;
    // El producto de la tienda es uno por color para todas sus tallas: se reconoce por el tipo de globo y el código.
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const publicado = publicados.find((p) => p.formato !== null && formatoPorId(p.formato)?.tipo === tipo && p.codigo === m.codigo && !impresoPorUrl(p.url));
    if (publicado) { usados.add(publicado); salida.push({ ...publicado, formato: m.formatoId, cantidad, contada: true }); }
    else salida.push(liso(m.formatoId, m.codigo, cantidad));
  }
  // Lo publicado que la foto no tiene: listado, sin cantidad.
  for (const p of publicados) if (!usados.has(p)) salida.push({ ...p, cantidad: null });
  return salida;
}

function fuente(slug: string): FuenteIdea {
  const f = fuenteIdea(slug);
  if (!f) throw new Error(`La idea «${slug}» no está en las fuentes.`);
  return f;
}

/**
 * La idea con su número, ocasiones y foto de su fuente; su escena y sus productos se calculan la primera vez que se
 * piden (los productos salen de armar la escena). Las ocasiones salen de las etiquetas con `ocasionesDeEtiquetas`, que
 * vive en `index.ts` (que importa este lote): se calculan al leerlas, como en el lote 17.
 */
function idea(numero: number, slug: string, nombre: string, escena: () => Escena, nota: () => string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  if (f.numero !== numero) throw new Error(`«${slug}» es la #${f.numero}, no la #${numero}.`);
  const laEscena = perezoso(escena);
  return ideaPerezosa(
    {
      id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena",
      get nota() { return nota(); },
      get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
    },
    () => ({ tipo: "escena", escena: laEscena() }),
    () => productosDe(laEscena(), publicados),
  );
}

// Colores de cinta y de varilla.
const CINTA_ROSADA = "#f29ac0";
const VARILLA = "#ececea";

// ----------------------------------------------------------------------------------------------------------
// 429 · Corazón Love
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1600×1354; los R-12 grandes de delante miden ~166 px (28 cm): 5,93 px/cm. El corazón va de x 70 a 1515 y de
 * y 45 a 1300 px: 244 × 212 cm. Globos de tres tamaños: R-12 a ~28 cm (los más), otros a ~22 (130 px) y R-5 a ~9 cm
 * (55 px) en el borde y en los huecos, todos del Reflex Cristal Rojo publicado. Encima, el «love» en cursiva
 * metalizado oro rosa (555 × 450 px: 94 × 76 cm) con su centro a 117 cm de la punta y 7 cm a la derecha del eje.
 */
const BASE_429 = 4;
/** Medio grueso de la capa orgánica del corazón (cm) y lo que asoma por delante (el frente de sus globos, medido al armarlo). */
const CAPA_429 = 24;
const FRENTE_429 = 25;
const escena429 = (): Escena => {
  const ROJO = "915";
  const corazon: Pieza = {
    tipo: "forma",
    forma: {
      clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 244, altoCm: 212 },
      tecnica: { tipo: "organico", radioCm: CAPA_429, mezcla: { "R-12": 1, "R-5": 0.3 }, semilla: 429, inflados: { "R-12": 27, "R-5": 9 } },
      colores: { codigos: [ROJO], patron: "un_color" },
    },
  };
  // El amarre del «love», detrás del corazón (sin globos debajo: la escena no lo corre) y tapado por él.
  const m = montaje(
    { id: "corazon", nombre: "Corazón orgánico de R-12 Reflex Cristal Rojo", pieza: corazon, origen: v(0, BASE_429, 0) },
    { nombre: "Amarre del «love» (escondido detrás del corazón)", base: v(7, BASE_429 + 115, -FRENTE_429 - 4), altoCm: 2, radioCm: 0.2, hex: "#a62d2f" },
  );
  m.foil("love", "Letras «LOVE» metalizadas oro rosa de 16\" (en la foto, «love» en cursiva)", { forma: { tipo: "letras", texto: "LOVE" }, pulgadas: 16, color: "rosa_oro" }, v(6.7, BASE_429 + 117, FRENTE_429 - 2), false);
  return m.escena(sala(380, 300, 280));
};

// ----------------------------------------------------------------------------------------------------------
// 449 · Cristal centerpiece (la misma foto que #277 del lote 17)
// ----------------------------------------------------------------------------------------------------------

/** La #277 del lote 17 (se busca al pedirla: así no importa el orden en que se cargan los lotes). */
function idea277(): IdeaDigitalizada {
  const i = LOTE_17.find((x) => x.numero === 277);
  if (!i || i.contenido.tipo !== "escena") throw new Error("La #277 del lote 17 no está o no es una escena.");
  return i;
}

/**
 * #449 es la misma foto que #277 (740×570, idéntica píxel a píxel): reusa sus mismos nodos y solo cambia los tonos de
 * la sala (así la biblioteca no la funde con #277 por tener el mismo contenido), como #303 con #264 en el lote 17.
 */
const escena449 = (): Escena => {
  const c = idea277().contenido;
  if (c.tipo !== "escena") throw new Error("La #277 no es una escena.");
  return { ...c.escena, sala: { ...c.escena.sala, tonos: { piso: "#e6e0da", paredes: "#f5f2ee", techo: "#fbfaf9" } } };
};

// ----------------------------------------------------------------------------------------------------------
// Las cruces de primera comunión (450, 451, 452 y 454)
// ----------------------------------------------------------------------------------------------------------

/**
 * Una cruz de columna (#451 dorada, #452 pink y #454): base de un cuarteto R-9 y uno R-5 grande, la columna de 18
 * cuartetos R-5 a 8,5 cm en espiral de dos colores (una pareja de cada color), el travesaño de dos brazos de 5
 * cuartetos acostados que salen de los lados de la columna, un R-5 en cada punta y uno de remate arriba. Escala: el
 * ancho (~70–75 px) y el paso (~20 px) de la columna casados con los de la columna del taller (2,24 y 0,8 diámetros):
 * ~3,4 px/cm.
 */
type MedidasCruz = { brazoY: number; finIzquierda: ParteGlobo; finDerecha: ParteGlobo; remate: ParteGlobo; remateY: number; baseAbajo: ParteGlobo; baseArriba: ParteGlobo; baseArribaY: number; primerNivelY: number };
const R5_CRUZ = 8.5;
const NIVELES_CRUZ = 18;
const NIVELES_BRAZO = 5;

function cruzDeColumna(rayas: [string, string], base: [string, string], d: MedidasCruz, nombre: string): Escena {
  const g = R("R-5", R5_CRUZ, rayas[0]);
  const m = montaje(
    { id: "columna", nombre: `Columna de la ${nombre}: 18 cuartetos R-5 en espiral`, pieza: columna(g, NIVELES_CRUZ, rayas, "dos_colores"), origen: v(0, d.primerNivelY, 0) },
    { nombre: "Varilla de la cruz (por dentro de la columna)", base: v(0, 0, 0), altoCm: r2(d.remateY - 4), radioCm: 0.4, hex: VARILLA },
  );
  m.nivel("base-abajo", "Base: cuarteto R-9 de abajo", cuarteto(d.baseAbajo, base, "dos_colores"), v(0, r2(d.baseAbajo.infladoCm / 2 + 0.5), 0), 0);
  m.nivel("base-arriba", "Base: cuarteto R-5 grande de arriba", cuarteto(d.baseArriba, [base[1], base[0]], "dos_colores"), v(0, d.baseArribaY, 0), 45);
  // Los brazos: columnas de 5 cuartetos acostadas, su primer cuarteto pegado al costado de la columna.
  const radioColumna = 0.62 * R5_CRUZ + R5_CRUZ / 2;
  const primero = r2(radioColumna + R5_CRUZ * 0.4);
  const ultimo = r2(primero + (NIVELES_BRAZO - 1) * 0.8 * R5_CRUZ);
  const brazo = columna(g, NIVELES_BRAZO, rayas, "dos_colores");
  m.pieza("brazo-izquierdo", "Brazo izquierdo: 5 cuartetos R-5 acostados", brazo, v(-primero, d.brazoY, 0), IZQUIERDA);
  m.pieza("brazo-derecho", "Brazo derecho: 5 cuartetos R-5 acostados", brazo, v(primero, d.brazoY, 0), DERECHA);
  const fin = ultimo + R5_CRUZ / 2;
  m.globo("punta-izquierda", "R-5 de la punta izquierda", d.finIzquierda, v(-r2(fin + d.finIzquierda.infladoCm / 2), d.brazoY, 0), IZQUIERDA);
  m.globo("punta-derecha", "R-5 de la punta derecha", d.finDerecha, v(r2(fin + d.finDerecha.infladoCm / 2), d.brazoY, 0), DERECHA);
  m.globo("remate", "R-5 de remate arriba", d.remate, v(0, d.remateY, 0), ARRIBA);
  return m.escena(sala(300, 260, 240));
}

/**
 * #451 dorada. Foto de 740×570 a 3,4 px/cm, con el piso en y = 555 px y el eje en x = 370: base de R-9 (~48 px: 14 cm)
 * y R-5 grande (~32 px: 10,5 cm) a 21 cm; la columna de 28,5 a 144 cm; el travesaño a 114 cm (y 167 px), de x 212 a
 * 535 px más las puntas; el remate (~30 px: 9 cm) a 153 cm. Medidos: rayas doradas #bb7009 (sobresaturado: lejos de
 * todos; la idea es «dorada»: Metal Dorado 570) y perla #b8b7ac → Reflex Plata 981 (ΔE 9); base verde agua #8aa8aa →
 * Silk Verde Menta 826 (ΔE 4) y perla; remate y punta izquierda turquesa #41c9ce → Azul Caribe 038 (ΔE 11); punta
 * derecha perla #a09694 → Reflex Plata 981 (ΔE 8).
 */
const escena451 = (): Escena => cruzDeColumna(["570", "981"], ["826", "981"], {
  primerNivelY: 28.5, brazoY: 114, baseAbajo: R("R-9", 14, "826"), baseArriba: R("R-5", 10.5, "981"), baseArribaY: 21.5,
  finIzquierda: R("R-5", 9, "038"), finDerecha: R("R-5", 9, "981"), remate: R("R-5", 9, "038"), remateY: 153,
}, "cruz dorada");

/**
 * #452 pink y #454 (la misma foto con otro color). Foto de 740×570 a 3,45 px/cm, con el piso en y = 555 px y el eje en
 * x = 372: base de R-9 (~50 px: 14,5 cm) y R-5 grande a 20 cm; la columna de 27 a 143 cm; el travesaño a 106 cm (y 188
 * px), de x 215 a 535 px más las puntas (~40 px: 11,5 cm); el remate a 151 cm.
 */
const MEDIDAS_PINK: Omit<MedidasCruz, "finIzquierda" | "finDerecha" | "remate" | "baseAbajo" | "baseArriba"> = { primerNivelY: 27, brazoY: 106.4, baseArribaY: 20.3, remateY: 151 };
const cruzPink = (rayas: [string, string], perla: string, nombre: string): Escena => cruzDeColumna(rayas, [perla, perla], {
  ...MEDIDAS_PINK, baseAbajo: R("R-9", 14.5, perla), baseArriba: R("R-5", 11, perla), finIzquierda: R("R-5", 11.5, perla), finDerecha: R("R-5", 11.5, perla), remate: R("R-5", 11.5, perla),
}, nombre);
/** Medidos: rosa #fc899b → Coral Tropical 059 (ΔE 12, el mejor); claro #fcb4be → Rosado 009 (ΔE 7); perla rosada en sombra #c5a9ae → Palo de Rosa 010 (ΔE 11). */
const escena452 = (): Escena => cruzPink(["059", "009"], "010", "cruz pink");
/** Medidos: turquesa #04b1d2 → Azul Caribe 038 (ΔE 9); claro #80c4da → Aguamarina 037 (ΔE 12); perla azulada #8dafbb → Silk Azul Ártico 839 (ΔE 8). */
const escena454 = (): Escena => cruzPink(["038", "037"], "839", "cruz");

/**
 * #450 celestial. Foto de 740×570; los óvalos morados miden ~60 px de ancho: Link-O-Loon 12 a 15,5 cm → 3,87 px/cm,
 * con la punta de abajo en y = 530 px y el eje en x = 362. La cruz (130 cm × 92 cm de travesaño) es una cadena de
 * óvalos de LOL-12 violeta y racimitos de 4 R-5 violeta (~21 px: 5,4 cm) en cada unión: abajo del cruce 3 óvalos y 3
 * racimos, arriba 2 y 2, en cada brazo 2 y 2 (el último en la punta) y un racimo en el cruce (a 77,5 cm). Alrededor
 * sube en espiral una hilera de R-5 azul rey (~27 px: 7 cm), 3 vueltas, por delante en el cruce. Medidos: morado
 * #7b1b84 → Violeta 051 (ΔE 17,5: la Orquídea Morada queda a 16 pero no se hace en LOL-12); azul #3c53a3 → Azul Rey 041 (ΔE 3,5).
 */
const escena450 = (): Escena => {
  const VIOLETA = "051", AZUL = "041";
  // Los óvalos del palo, a 14 cm (los de la foto son algo más largos que los del travesaño, a 13).
  const ovalo12 = R("LOL-12", 14, VIOLETA), ovaloBrazo = R("LOL-12", 13, VIOLETA);
  const racimo = R("R-5", 5.4, VIOLETA);
  const LARGO_OVALO = 14 * 1.35, LARGO_BRAZO = 13 * 1.35, LARGO_RACIMO = 5.4 * 0.95;
  const racimoPieza = cuarteto(racimo, [VIOLETA]);
  // De abajo arriba: racimo (la raíz, apoyada en el piso), óvalo, racimo, óvalo, racimo, óvalo, [cruce], óvalo, racimo,
  // óvalo, racimo.
  const PIE = 2.8;
  const abajo = r2(PIE - LARGO_RACIMO / 2 + 3 * (LARGO_OVALO + LARGO_RACIMO));
  const CRUCE = r2(abajo + LARGO_RACIMO / 2);
  const m = montaje(
    { id: "racimo-abajo", nombre: "Racimo de 4 R-5 violeta del pie (la punta de abajo)", pieza: racimoPieza, origen: v(0, PIE, 0) },
    { nombre: "Varilla de la cruz (por dentro de los óvalos)", base: v(0, 0.5, 0), altoCm: 118, radioCm: 0.4, hex: "#5b2a7c" },
  );
  let y = abajo;
  for (let k = 3; k >= 1; k--) {
    m.globo(`ovalo-abajo-${k}`, `LOL-12 violeta de abajo ${k}`, ovalo12, v(0, r2(y - LARGO_OVALO / 2), 0), ARRIBA);
    y -= LARGO_OVALO;
    if (k > 1) { m.nivel(`racimo-abajo-${k}`, `Racimo de 4 R-5 violeta de abajo ${k}`, racimoPieza, v(0, r2(y - LARGO_RACIMO / 2), 0), 0); y -= LARGO_RACIMO; }
  }
  // El cruce: un racimo de frente (con el eje hacia quien mira).
  m.pieza("racimo-cruce", "Racimo de 4 R-5 violeta del cruce", racimoPieza, v(0, CRUCE, -2), AL_FRENTE);
  let arriba = CRUCE + LARGO_RACIMO / 2;
  for (let k = 1; k <= 2; k++) {
    m.globo(`ovalo-arriba-${k}`, `LOL-12 violeta de arriba ${k}`, ovalo12, v(0, r2(arriba + LARGO_OVALO / 2), 0), ARRIBA);
    arriba += LARGO_OVALO;
    m.nivel(`racimo-arriba-${k}`, `Racimo de 4 R-5 violeta de arriba ${k}`, racimoPieza, v(0, r2(arriba + LARGO_RACIMO / 2), 0), 0);
    arriba += LARGO_RACIMO;
  }
  for (const [lado, s, normal] of [["izquierdo", -1, IZQUIERDA], ["derecho", 1, DERECHA]] as const) {
    let x = LARGO_RACIMO / 2;
    for (let k = 1; k <= 2; k++) {
      m.globo(`ovalo-${lado}-${k}`, `LOL-12 violeta del brazo ${lado} ${k}`, ovaloBrazo, v(r2(s * (x + LARGO_BRAZO / 2)), CRUCE, 0), normal);
      x += LARGO_BRAZO;
      m.pieza(`racimo-${lado}-${k}`, `Racimo de 4 R-5 violeta del brazo ${lado} ${k}`, racimoPieza, v(r2(s * (x + LARGO_RACIMO / 2)), CRUCE, 0), normal);
      x += LARGO_RACIMO;
    }
  }
  // La espiral azul: 3 vueltas a 10 cm del eje, por delante en el cruce, un R-5 cada ~6,3 cm de recorrido.
  const desde = 6, hasta = 124, vueltas = 3, radio = 10.5, n = 35;
  const fase = -2 * Math.PI * vueltas * ((CRUCE - desde) / (hasta - desde));
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const a = fase + 2 * Math.PI * vueltas * t;
    const p = v(r2(radio * Math.sin(a)), r2(desde + (hasta - desde) * t), r2(radio * Math.cos(a)));
    m.globo(`azul-${k + 1}`, `R-5 azul rey de la espiral ${k + 1}`, R("R-5", 7, AZUL), p, unitario(v(p.x, 0, p.z)));
  }
  return m.escena(sala(300, 260, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 461 · Cumpleaños cupcakes
// ----------------------------------------------------------------------------------------------------------

/** El metalizado del cupcake (no hay esa forma en el generador): pirotín rosado de rayas, crema blanca con el letrero y la cereza. */
const CUPCAKE: ElementoEscenografia[] = [
  panelFoil([[-13, 0], [13, 0], [19.5, 28], [-19.5, 28]], 8, "#e8559a", { dibujo: "rayas", hex: "#f7c4dc" }, 1.5),
  panelFoil(ovalo(0, 43, 25.5, 18, 28), 10, "#f2f2f0", { dibujo: "texto", texto: "HAPPY\nBIRTHDAY", hex: "#7a3fb8" }),
  panelFoil(ovalo(0, 62, 4.3, 4.3, 16), 4, "#d0172f", undefined, 2),
];

/**
 * Foto de 740×570; los metalizados redondos de 18" miden ~93 px (~38 cm de frente) y el R-12 impreso de arriba ~75 px
 * (28 cm): 2,5 px/cm, con el piso en y = 555 px y el eje en x = 375. Columna de 5 cuartetos R-12 de un color (~70 px,
 * 25 cm) con un globo al frente, sin girar entre sí, a 19 cm por nivel: azul (12,5 cm), verde, amarillo, fucsia y lila
 * (88,5); entre nivel y nivel, 4 R-9 rosados (~45 px: 18 cm) en los huecos (se ven 2 por fila) y 2 R-5 rosados en cada
 * hueco del lila. Encima, el R-12 azul impreso «Happy Birthday» (113 cm) y, con cintas rosadas, los dos redondos
 * morados con cupcake (124 y 144 cm) y el cupcake metalizado (51 × 66 cm, de 150 a 216 cm). Medidos: azul #008fd1 →
 * Azul 040 (el Neón Azul queda 5 ΔE más cerca); verde #23b95d → Verde Trébol 029; amarillo #e8cd01 → Amarillo Miel 021;
 * fucsia #eb3993 → Rosa 011; lila #bf98ca → Lila 050; rosados #ed78b2 → Satín Fucsia 412 (ΔE 12; el Rosa 011 es el del
 * nivel fucsia y es más oscuro); el impreso, azul #5cb4e4 → Azul 040 (ΔE 9).
 */
const escena461 = (): Escena => {
  const AZUL = "040", VERDE = "029", AMARILLO = "021", ROSA = "011", LILA = "050", ROSADO = "412";
  const f = foto(375, 555, 2.5);
  const g = (c: string) => R("R-12", 25, c);
  const alturas = [12.5, 31.5, 50.5, 69.5, 88.5];
  const colores: ReadonlyArray<readonly [string, string]> = [[AZUL, "azul"], [VERDE, "verde trébol"], [AMARILLO, "amarillo miel"], [ROSA, "rosa"], [LILA, "lila"]];
  const m = montaje(
    { id: "base", nombre: "Columna cupcakes: cuarteto R-12 azul de abajo", pieza: cuarteto(g(AZUL), [AZUL]), origen: v(0, alturas[0]!, 0), giroGrados: 45 },
    { nombre: "Varilla de la columna (por dentro)", base: v(0, 0, 0), altoCm: 100, radioCm: 0.6, hex: VARILLA },
  );
  colores.slice(1).forEach(([c, nombre], k) => m.nivel(`nivel-${k + 2}`, `Cuarteto R-12 ${nombre}`, cuarteto(g(c), [c]), v(0, alturas[k + 1]!, 0), 45));
  // Los R-9 rosados en los huecos (±45° y ±135° con un globo al frente), entre nivel y nivel.
  alturas.slice(1).forEach((y, k) => [45, 135, 225, 315].forEach((a, q) =>
    m.globo(`rosado-${k + 1}-${q + 1}`, `R-9 rosado del hueco ${q + 1} entre los niveles ${k + 1} y ${k + 2}`, R("R-9", 18, ROSADO), enAnillo(a, 22.4, r2(y - 9.5)), haciaFuera(a, 0))));
  // Dos R-5 rosados en cada hueco del lila (en la foto se ven los de los lados).
  [45, 135, 225, 315].forEach((a, q) => {
    m.globo(`rosadito-${q + 1}-a`, `R-5 rosado del lila ${q + 1} (arriba)`, R("R-5", 7, ROSADO), enAnillo(a, 19, 92), haciaFuera(a, 30));
    m.globo(`rosadito-${q + 1}-b`, `R-5 rosado del lila ${q + 1} (abajo)`, R("R-5", 7, ROSADO), enAnillo(a, 22.5, 86), haciaFuera(a, 10));
  });
  m.globo("impreso", "R-12 azul «Happy Birthday» de arriba", R("R-12", 28, AZUL), v(4, 112.8, 2), ARRIBA, "infinity-happy-birthday-festivo-fashion-surtido");
  const redondo18 = (): OpcionesMetalizado => ({ forma: { tipo: "redondo" }, pulgadas: 18, color: "fucsia", impreso: { dibujo: "texto", texto: "HAPPY\nBIRTHDAY", hex: "#ffffff" } });
  m.foil("redondo-izquierda", "Redondo metalizado morado con cupcake de 18\" (izquierda)", redondo18(), f(321, 246, -4));
  m.foil("redondo-derecha", "Redondo metalizado morado con cupcake de 18\" (derecha)", redondo18(), f(423, 195, -8));
  m.foilPaneles("cupcake", "Cupcake metalizado «Happy Birthday» (paneles de foil)", CUPCAKE, f(367, 181, -10));
  m.cintas(v(0, 100, -4), CINTA_ROSADA, "Cintas rosadas de los metalizados");
  return m.escena(sala(320, 280, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 464 · Cumpleaños rock star
// ----------------------------------------------------------------------------------------------------------

/** La guitarra metalizada (no hay esa forma en el generador): silueta roja con su etiqueta «Rock star» en el cuerpo. */
const GUITARRA: ElementoEscenografia[] = [
  panelFoil([[0, 0], [14, 1], [20, 6], [21, 14], [17, 22], [18, 30], [24, 41], [16, 38], [10, 44], [4.5, 46], [4.5, 80], [6, 82], [6, 86], [-6, 86], [-6, 82], [-4.5, 80], [-4.5, 46], [-10, 44], [-17, 36], [-23, 40], [-19, 30], [-17, 22], [-21, 14], [-20, 6], [-14, 1]], 9, "#d8401f"),
  panelFoil(ovalo(0, 17, 11, 10, 20), 3, "#f2f2f0", { dibujo: "texto", texto: "ROCK\nSTAR", hex: "#1b1b1f" }, 3.5),
];

/**
 * Foto de 740×570; la estrella metalizada de 18" mide ~107 px (~42 cm): 2,55 px/cm, con el piso en y = 545 px y el eje
 * en x = 365. Base de dos cuartetos R-9 rojos (~40 px: 16 cm); columna de 13 cuartetos R-5 violeta (~70 px de ancho) de
 * 33 a 124 cm; un cuarteto R-5 negro (132 cm), uno rojo (140), el cuarteto R-12 dorado (~67 px: 26 cm; se ven 2) a
 * 152 cm con un R-5 violeta en medio, y la estrella «Happy Birthday Rock Star» encima (centro a 184 cm). Delante, la
 * guitarra metalizada (42 × 86 cm, de 27 a 113 cm) y en la base tres rizos de T-260 negro. Medidos: violeta #493382 →
 * Violeta 051 (ΔE 7,5); dorado #ffce4e → Mostaza 023 (ΔE 13, el mejor; brilla como metal pero el Metal Dorado queda a
 * 20); rojo #f22b11 → Rojo 015; negro 080.
 */
const escena464 = (): Escena => {
  const ROJO = "015", VIOLETA = "051", NEGRO = "080", DORADO = "023";
  const f = foto(365, 545, 2.55);
  const m = montaje(
    { id: "base", nombre: "Columna rock star: cuarteto R-9 rojo de abajo", pieza: cuarteto(R("R-9", 16, ROJO), [ROJO]), origen: v(0, 8.5, 0) },
    { nombre: "Varilla de la columna (por dentro)", base: v(0, 0, 0), altoCm: 160, radioCm: 0.5, hex: VARILLA },
  );
  m.nivel("base-arriba", "Cuarteto R-9 rojo de arriba de la base", cuarteto(R("R-9", 16, ROJO), [ROJO]), v(0, 22.5, 0), 45);
  m.nivel("columna", "Columna de 13 cuartetos R-5 violeta", columna(R("R-5", 9.5, VIOLETA), 13, [VIOLETA]), v(0, 33, 0), 0);
  m.nivel("negro", "Cuarteto R-5 negro", cuarteto(R("R-5", 12, NEGRO), [NEGRO]), v(0, 132.5, 0), 45);
  m.nivel("rojo", "Cuarteto R-5 rojo", cuarteto(R("R-5", 12, ROJO), [ROJO]), v(0, 140.5, 0), 0);
  m.nivel("dorado", "Cuarteto R-12 dorado (se ven 2)", cuarteto(R("R-12", 26, DORADO), [DORADO]), v(0, 152, 0), 0);
  m.globo("violeta-arriba", "R-5 violeta en medio del dorado", R("R-5", 10, VIOLETA), v(0, 160, 0), ARRIBA);
  m.foil("estrella", "Estrella metalizada roja «Happy Birthday Rock Star» de 18\"", { forma: { tipo: "estrella" }, pulgadas: 18, color: "rojo", impreso: { dibujo: "texto", texto: "ROCK\nSTAR", hex: "#ffe14a" } }, f(366, 80, 0), false);
  m.foilPaneles("guitarra", "Guitarra metalizada roja «Rock star» (paneles de foil)", GUITARRA, v(-0.8, 26.7, 15), false);
  // Los rizos de T-260 negro: dos a la izquierda (uno alto y uno bajo) y uno a la derecha, saliendo de la base.
  const negro = { formatoId: "T-260", grosorCm: 4, codigo: NEGRO };
  const rizoNegro = (vueltas: number, r0: number, r1: number, largoCm: number): Decoracion => rizo({ forma: "tirabuzon", tubito: negro, vueltas, radioInicialCm: r0, radioFinalCm: r1, largoCm, eje: "frente" });
  m.deco("rizo-izquierda-alto", "Rizo de T-260 negro (izquierda, alto)", rizoNegro(1.5, 6, 11, 22), v(-12, 36, 2), unitario(v(-1, 0.1, 0.35)));
  m.deco("rizo-izquierda-bajo", "Rizo de T-260 negro (izquierda, bajo)", rizoNegro(1.25, 5, 9, 18), v(-11, 20, 6), unitario(v(-1, -0.1, 0.6)));
  m.deco("rizo-derecha", "Rizo de T-260 negro (derecha)", rizoNegro(1.5, 6, 11, 22), v(12, 33, 2), unitario(v(1, 0.1, 0.35)));
  return m.escena(sala(320, 280, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 496 · Destello de corazones
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 impresos miden ~104 px (28 cm): 3,7 px/cm. Es una medusa de helio vista desde abajo: un
 * cuarteto de R-12 rojos con corazones blancos (la pareja de delante abajo, la de atrás arriba), un R-5 blanco en el
 * centro de los nudos (~8 cm) y 7 tentáculos de T-260 blanco ondulados (~3,8 cm de grueso) que bajan hasta 113 cm,
 * cada uno con un corazón rojo en la punta (~50 px: C-12 a 13,5 cm). Puntas medidas desde el centro (cm, a la derecha y
 * abajo): (−55, 71), (−34, 80), (−35, 87), (−12, 101), (−33, 113), (38, 82) y (54, 109). Medidos: rojo #dc1010 → Rojo
 * 015; el impreso de corazones blancos de varios tamaños es el «Corazones por Siempre» rojo de la tienda.
 */
const escena496 = (): Escena => {
  const ROJO = "015", BLANCO = "005";
  const ALTO = 175;
  const m = montaje(
    { id: "cuarteto", nombre: "Medusa: cuarteto R-12 rojo con corazones", pieza: cuarteto(R("R-12", 28, ROJO), [ROJO], "un_color", [{ impresoId: "infinity-corazones-por-siempre-fashion-rojo", codigo: ROJO }]), origen: v(0, ALTO, 0) },
    { nombre: "Amarre de los tentáculos (escondido entre los nudos)", base: v(0, ALTO - 3, 0), altoCm: 3, radioCm: 0.3, hex: "#f2f2f2" },
  );
  m.globo("centro", "R-5 blanco del centro", R("R-5", 8, BLANCO), v(0, ALTO - 7, 0), ABAJO);
  const tentaculos: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    [[0, 0], [-8, -28], [-28, -55], [-48, -68]],
    [[0, 0], [-6, -32], [-20, -60], [-31, -74]],
    [[0, 0], [-2, -38], [-18, -66], [-32, -81]],
    [[0, 0], [-3, -40], [-14, -72], [-12, -94]],
    [[0, 0], [-5, -45], [-22, -80], [-31, -106]],
    [[0, 0], [8, -25], [33, -46], [37, -76]],
    [[0, 0], [5, -40], [33, -78], [50, -102]],
  ];
  const t = T("T-260", 3.8, BLANCO);
  const origen = v(0, ALTO - 10, 0);
  tentaculos.forEach((p, k) => {
    const puntos = suave(p, 3);
    const z = r2(-6 + (12 * k) / (tentaculos.length - 1));
    m.trazo(`tentaculo-${k + 1}`, `Tentáculo de T-260 blanco ${k + 1}`, t, [{ tipo: "linea", puntos }], mas(origen, v(0, 0, z)), "a wavy white twisted-balloon jellyfish tentacle");
    const [xa, ya] = puntos[puntos.length - 2]!, [xb, yb] = puntos[puntos.length - 1]!;
    const d = unitario(v(xb - xa, yb - ya, 0));
    const punta = mas(origen, v(xb, yb, z));
    m.globo(`corazon-${k + 1}`, `Corazón C-12 rojo de la punta ${k + 1}`, R("C-12", 13.5, ROJO), mas(punta, por(d, 7.5)), d);
  });
  return m.escena(sala(320, 280, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 504 · Dorado - eucalipto - arena
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (PNG recortado); los R-12 miden ~95–105 px (27–28 cm): 3,75 px/cm, con el eje en x = 370; las
 * cintas siguen bajo el borde de la foto (el peso no sale): el piso de arena va a 95 cm. Ramo de helio por pisos: 4
 * arena (3 delante a 92–96 cm y uno detrás que asoma, 113), 2 eucalipto (124 cm), 3 Reflex Dorado (150 cm) y arriba la
 * burbuja cristal impresa (~176 px: R-24 a 47 cm, centro a 188 cm) con 3 eucalipto y 3 dorados chicos dentro (~50 px:
 * R-9 a 13,5 cm), con cintas rojas y blancas. Colores: los publicados (Arena 071, Eucalipto 027, Reflex Dorado 970;
 * medidos #d6cdb9, #afbd9b y #b7a171 lo confirman).
 */
const escena504 = (): Escena => {
  const ARENA = "071", EUCALIPTO = "027", DORADO = "970";
  const f = (x: number, y: number, z = 0) => v(r2((x - 370) / 3.75), r2(95 + (450 - y) / 3.75), z);
  const PESO = v(-2, 0, 0);
  const m = montaje(
    { id: "peso", nombre: "Peso del ramo", pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 4, altoCm: 5, hex: "#d9d2c3", acabado: "satinado" }] }, origen: PESO },
    { nombre: "Amarre de las cintas (dentro del peso)", base: v(-2, 3, 0), altoCm: 1.5, radioCm: 0.3, hex: "#d9d2c3" },
  );
  const amarre = v(-2, 5, 0);
  const sube = (c: Vec3) => unitario(mas(por(unitario(menos(c, amarre)), 0.35), por(ARRIBA, 0.65)));
  const globos: ReadonlyArray<readonly [string, string, string, number, Vec3]> = [
    ["arena-1", "R-12 arena (piso 1, delante)", ARENA, 28, f(360, 460, 10)],
    ["arena-2", "R-12 arena (piso 1, izquierda)", ARENA, 27, f(285, 445, -3)],
    ["arena-3", "R-12 arena (piso 1, derecha)", ARENA, 27, f(447, 445, -3)],
    ["arena-4", "R-12 arena (piso 1, detrás: asoma)", ARENA, 27, f(367, 380, -18)],
    ["eucalipto-1", "R-12 eucalipto (piso 2, izquierda)", EUCALIPTO, 28, f(312, 340, 3)],
    ["eucalipto-2", "R-12 eucalipto (piso 2, derecha)", EUCALIPTO, 28, f(418, 345, 3)],
    ["dorado-1", "R-12 Reflex Dorado (piso 3, izquierda)", DORADO, 26, f(290, 240, -5)],
    ["dorado-2", "R-12 Reflex Dorado (piso 3, delante)", DORADO, 27, f(370, 245, 8)],
    ["dorado-3", "R-12 Reflex Dorado (piso 3, derecha)", DORADO, 26, f(450, 235, -5)],
  ];
  for (const [id, nombre, c, d, centro] of globos) m.helio(id, nombre, R("R-12", d, c), centro, undefined, sube(centro));
  const exterior = R("R-24", 47, "390");
  const burbuja: Pieza = {
    tipo: "decoracion",
    decoracion: { tipo: "burbuja", propiedades: { exterior, interiores: [{ formatoId: "R-9", infladoCm: 13.5, codigos: [EUCALIPTO, DORADO], cantidad: 6 }], relleno: null, semilla: 504 } },
    impresos: [{ impresoId: "infinity-diamantes-dorados-fashion-transparente", globos: [0] }],
  };
  m.burbujaHelio("burbuja", "Burbuja R-24 cristal impresa con 3 eucalipto y 3 dorados dentro (piso 4)", burbuja, exterior, f(370, 101, 0));
  m.cintas(amarre, "#c8453f", "Cintas rojas y blancas del ramo");
  return m.escena(sala(320, 280, 260));
};

// ----------------------------------------------------------------------------------------------------------
// 512 · El duende
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 negros miden ~82 px (26 cm): 3,15 px/cm, con el piso en y = 548 px y el eje en x = 365.
 * Base de dos cuartetos R-12 negros sin girar entre sí (13,5 y 37,5 cm; con un hueco al frente: se ven 2 en cada uno) y un
 * R-12 blanco (~95 px: 30 cm) en el hueco del de arriba; el moño: dos R-12 rojos a los lados (±20 cm, a 61 cm) y un R-9 rojo de nudo; la cabeza
 * R-18 durazno (~150 px: 45 cm, centro a 98 cm) con los ojos y la sonrisa dibujados; el sombrero de copa: ala de
 * Link-O-Loon 660 negro en aro (~225 px: 71 cm de ancho y 13 de grueso) y copa R-18 negro (~150 px) hasta 169 cm.
 * Medidos: cabeza #ffccab → Durazno 060 (ΔE 4); rojo #fe2812 → Rojo 015; blanco #d7d4d7 (en sombra: el Silk Blanco
 * Nácar queda a 3, pero es un blanco liso) → Blanco 005; negro 080.
 */
const escena512 = (): Escena => {
  const NEGRO = "080", BLANCO = "005", ROJO = "015", DURAZNO = "060";
  const m = montaje(
    { id: "base", nombre: "Duende: cuarteto R-12 negro de abajo", pieza: cuarteto(R("R-12", 26, NEGRO), [NEGRO]), origen: v(0, 13.5, 0) },
    { nombre: "Varilla del duende (por dentro)", base: v(0, 0, 0), altoCm: 95, radioCm: 0.6, hex: VARILLA },
  );
  m.nivel("base-arriba", "Cuarteto R-12 negro de arriba", cuarteto(R("R-12", 26, NEGRO), [NEGRO]), v(0, 37.5, 0), 0);
  m.globo("blanco", "R-12 blanco en el hueco del cuarteto de arriba (la barriga)", R("R-12", 30, BLANCO), v(0, 37.5, 30), haciaFuera(0, 10));
  m.globo("rojo-izquierda", "R-12 rojo del moño (izquierda)", R("R-12", 28, ROJO), v(-20, 61, 0), unitario(v(-1, 0.15, 0.1)));
  m.globo("rojo-derecha", "R-12 rojo del moño (derecha)", R("R-12", 28, ROJO), v(20, 61, 0), unitario(v(1, 0.15, 0.1)));
  m.globo("nudo", "R-9 rojo del nudo del moño", R("R-9", 16, ROJO), v(0, 61, 12), AL_FRENTE);
  m.conCara("cabeza", "Cabeza R-18 durazno con ojos y sonrisa", R("R-18", 45, DURAZNO), v(0, 98, 0), { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#141414" }, boca: { estilo: "sonrisa", hex: "#141414" } }, "a peach balloon head with a smiling face");
  const sombrero = figura({
    queEs: "a black balloon top hat: a thick ring brim and a round crown",
    accesorios: [{ en: "base", forma: { tipo: "sombrero", ala: { ...T("LOL-660", 13, NEGRO), estilo: "aro", radioCm: 29 }, copa: { globo: R("R-18", 45, NEGRO) }, cinta: null, pompon: null, inclinacionGrados: 0 } }],
  });
  m.deco("sombrero", "Sombrero de copa: ala de LOL-660 negro y copa R-18 negro", sombrero, v(0, 117, 0), AL_FRENTE);
  return m.escena(sala(300, 260, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 543 · Fantasma Happy Halloween
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570, estirada a lo alto (los globos miden 1,25 veces más altos que anchos): el R-12 naranja mide ~118 px
 * de ancho (28 cm) → 4,2 px/cm a lo ancho y 5,25 a lo alto, con el piso en y = 520 px y el eje en x = 345. Base: un
 * cuarteto R-12 negro (~85–95 px: 22 cm) con uno al frente; encima el R-12 naranja con el sello «Happy Halloween»
 * (centro a 41 cm) y, arriba, el fantasma de globos blancos: la cabeza R-12 (~110 px: 24 cm, centro a 83 cm, 6 cm a la
 * derecha) con ojos y boca abierta, la cola (otro R-12 blanco hacia abajo a la izquierda), el brazo levantado y el otro
 * brazo de T-260, y abajo, a los lados de la base, dos rizos de T-260 blanco. Medidos: naranja #fe8936 → Naranja 061;
 * blanco en sombra #dbd1cf → Blanco 005 (el Silk Blanco Nácar queda a 5, pero es un blanco liso); negro 080.
 */
const escena543 = (): Escena => {
  const NEGRO = "080", NARANJA = "061", BLANCO = "005";
  const f = foto(345, 520, 4.2, 5.25);
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-12 negro (de chevrón en la foto)", pieza: cuarteto(R("R-12", 22, NEGRO), [NEGRO]), origen: v(0, 11, 0), giroGrados: 45 },
    { nombre: "Varilla del fantasma (por dentro)", base: v(0, 0, 0), altoCm: 40, radioCm: 0.5, hex: VARILLA },
  );
  m.globo("naranja", "R-12 naranja «Happy Halloween»", R("R-12", 28, NARANJA), v(0.7, 41, 0), ARRIBA, "2-caras-happy-halloween-fashion-surtido-negro-naranja");
  m.conCara("cabeza", "Cabeza del fantasma: R-12 blanco con cara", R("R-12", 24, BLANCO), f(370, 85, 2), { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#141414" }, boca: { estilo: "abierta", hex: "#141414" } }, "a white ghost balloon head with a happy face");
  m.globo("cola", "Cola del fantasma: R-12 blanco", R("R-12", 24, BLANCO), f(275, 200, -3), unitario(v(-0.87, -0.5, 0)));
  const t = T("T-260", 4, BLANCO);
  const pt = (x: number, y: number): readonly [number, number] => { const p = f(x, y); return [p.x, p.y]; };
  const centro = f(345, 150, 0);
  const rel = (x: number, y: number): readonly [number, number] => { const [a, b] = pt(x, y); return [r2(a - centro.x), r2(b - centro.y)]; };
  m.trazo("brazo-levantado", "Brazo levantado del fantasma (T-260 blanco)", t, [{ tipo: "linea", puntos: [rel(345, 150), rel(305, 100), rel(272, 52)] }], mas(centro, v(0, 0, 4)), "a white twisted-balloon ghost arm raised");
  m.trazo("brazo", "Brazo del fantasma (T-260 blanco)", t, [{ tipo: "linea", puntos: [rel(345, 150), rel(390, 168), rel(432, 182)] }], mas(centro, v(0, 0, 4)), "a white twisted-balloon ghost arm");
  // Los rizos de la base: el de la izquierda en caracol, el de la derecha sale y se enrosca en la punta.
  const izquierda = f(305, 368, 8);
  const relI = (x: number, y: number): readonly [number, number] => { const [a, b] = pt(x, y); return [r2(a - izquierda.x), r2(b - izquierda.y)]; };
  m.trazo("rizo-izquierda", "Rizo de T-260 blanco (izquierda de la base)", t, [{ tipo: "linea", puntos: suave([relI(305, 368), relI(262, 372), relI(226, 360), relI(212, 337), relI(226, 318), relI(256, 316), relI(272, 332), relI(262, 350), relI(240, 352), relI(232, 338)], 2) }], izquierda, "a white twisted-balloon curl");
  const derecha = f(385, 365, 8);
  const relD = (x: number, y: number): readonly [number, number] => { const [a, b] = pt(x, y); return [r2(a - derecha.x), r2(b - derecha.y)]; };
  m.trazo("rizo-derecha", "Rizo de T-260 blanco (derecha de la base)", t, [{ tipo: "linea", puntos: suave([relD(385, 365), relD(430, 360), relD(466, 345), relD(480, 320), relD(472, 300), relD(492, 288), relD(515, 295), relD(518, 315), relD(500, 322), relD(486, 310)], 2) }], derecha, "a white twisted-balloon curl");
  return m.escena(sala(300, 260, 220));
};

// ----------------------------------------------------------------------------------------------------------
// 545 · Farol navideño verde y 546 · Farol navideño
// ----------------------------------------------------------------------------------------------------------

/**
 * Los dos faroles son la misma columna con los colores al revés. Foto de 740×570; los R-12 de la base miden ~60 px y
 * el globo del farol ~64 px (R-12 a 27 cm): 2,4 px/cm, con el piso en y = 550 px y el eje en x = 368. De abajo arriba:
 * cuarteto R-12 (A; se ven 2) a 12,5 cm; cuarteto R-9 (B, ~45 px: 19 cm) con uno al frente a 32 cm; el bastón de dos
 * T-260 (blanco y A en el verde; blanco y rojo en el rojo) torcidos en espiral de 50 a 127 cm (3,5 vueltas); cuarteto
 * R-12 (A, ~55 px: 23 cm) a 135 cm; el farol: dos cuadrados de T-260 blanco (33 cm de lado, a 144 y 187 cm) con 4
 * postes y el R-12 (B) a 29 cm dentro, casi llenando el marco (centro a 167 cm); cuarteto R-12 (A) a 196 cm y el remate de 4 R-5 con uno encima (A,
 * ~32 px: 12,5 cm) hasta 215 cm. Colores: los publicados (el «Surtido Navidad» rojo 015 y verde selva 032 en los R-12 y
 * R-9 —su florecita blanca va junto al cuello— y los T-260 publicados); el verde del bastón (#046955) → Verde Selva 032.
 */
function farol(a: string, b: string, tubito: string, nombre: string): Escena {
  const SURTIDO = "fashion-surtido-navidad-rojo-y-verde-selva";
  const impreso = (c: string): ImpresoEnPieza[] => [{ impresoId: SURTIDO, codigo: c }];
  const colorA = a === "032" ? "verde" : "rojo", colorB = b === "032" ? "verde" : "rojo";
  const m = montaje(
    { id: "base", nombre: `${nombre}: cuarteto R-12 ${colorA} de la base`, pieza: cuarteto(R("R-12", 25, a), [a], "un_color", impreso(a)), origen: v(0, 12.5, 0) },
    { nombre: "Varilla del farol (por dentro del bastón)", base: v(0, 0, 0), altoCm: 196, radioCm: 0.4, hex: VARILLA },
  );
  m.nivel("base-arriba", `Cuarteto R-9 ${colorB} de la base`, cuarteto(R("R-9", 19, b), [b], "un_color", impreso(b)), v(0, 32, 0), 45);
  // El bastón: dos tubitos en resorte, en fase opuesta, colgando del cuarteto de debajo del farol.
  const baston = (codigo: string, giroGrados: number): Decoracion => rizo({ forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 4.5, codigo }, vueltas: 3.5, radioCm: 2.7, largoCm: 77, eje: "abajo", giroGrados });
  m.deco("baston-blanco", "Bastón: T-260 blanco en espiral", baston("005", 0), v(0, 127, 0), AL_FRENTE);
  m.deco(`baston-${tubito === "032" ? "verde" : "rojo"}`, `Bastón: T-260 ${tubito === "032" ? "verde selva" : "rojo"} en espiral`, baston(tubito, 180), v(0, 127, 0), AL_FRENTE);
  m.nivel("bajo-farol", `Cuarteto R-12 ${colorA} de debajo del farol`, cuarteto(R("R-12", 23, a), [a], "un_color", impreso(a)), v(0, 135.4, 0), 0);
  // El farol: dos cuadrados de T-260 blanco (4 burbujas de 33 cm) y 4 postes; el globo dentro.
  const cuadrado = rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3.5, codigos: ["005"], largosCm: [33], recorrido: "aro", cantidad: 4, giroGrados: 45 });
  m.deco("farol-abajo", "Farol: cuadrado de T-260 blanco de abajo", cuadrado, v(0, 144, 0), ARRIBA);
  m.deco("farol-arriba", "Farol: cuadrado de T-260 blanco de arriba", cuadrado, v(0, 187.5, 0), ARRIBA);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], k) =>
    m.palito(`poste-${k + 1}`, `Farol: poste de T-260 blanco ${k + 1}`, T("T-260", 3.5, "005"), v(r2(sx! * 16.5), 145.8, r2(sz! * 16.5)), v(r2(sx! * 16.5), 185.7, r2(sz! * 16.5))));
  m.globo("luz", `R-12 ${colorB} dentro del farol`, R("R-12", 29, b), v(0, 166.7, 0), ARRIBA, SURTIDO);
  m.nivel("remate", `Cuarteto R-12 ${colorA} de arriba`, cuarteto(R("R-12", 23, a), [a], "un_color", impreso(a)), v(0, 196, 0), 0);
  m.deco("remate-r5", `Remate: 4 R-5 ${colorA} y uno encima`, { tipo: "flor", propiedades: { petalos: { ...R("R-5", 12.5, a), cantidad: 4, aperturaGrados: 35, giroGrados: 45 }, centro: { ...R("R-5", 12.5, a), cantidad: 1 } } }, v(0, 204, 0), ARRIBA);
  return m.escena(sala(300, 260, 250));
}
const escena545 = (): Escena => farol("032", "015", "032", "Farol navideño verde");
const escena546 = (): Escena => farol("015", "032", "015", "Farol navideño");

// ----------------------------------------------------------------------------------------------------------
// 551 · Feliz cumpleaños neón
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 impresos miden ~90 px (27 cm): 3,3 px/cm, con el piso en y = 555 px y el eje en x = 355.
 * Base: cuarteto R-12 amarillo (~100 px: 30 cm) con uno al frente y 8 R-5 verdes en los huecos (se ven 6); encima,
 * apilados: un cuarteto R-5 verde (~38 px: 12,5 cm; a 45 cm), el R-12 naranja impreso (59,5), otro cuarteto verde (83), el R-12 rosado
 * impreso (106), otro cuarteto verde (128) y el R-12 verde impreso arriba (153; hasta 167 cm). En cada cuarteto verde,
 * una corona de dos rizos de T-260: rosados en el de abajo, dorados en el del medio y azules en el de arriba. Medidos:
 * amarillo #dbc101 → Amarillo Miel 021 (ΔE 10); verde #80c279 → Verde Lima 031; rizos azul #3680a5 → Reflex Azul 940
 * (ΔE 7), dorado #d3a955 → Metal Dorado 570 (ΔE 4) y rosado #fa689b → Rosa 011 (ΔE 10). El impreso «Feliz
 * cumpleaños» de splash neón es el de la tienda (2 caras, surtido neón): naranja 261, fucsia 212 y verde 230.
 */
const escena551 = (): Escena => {
  const AMARILLO = "021", VERDE = "031", AZUL = "940", DORADO = "570", ROSA = "011";
  const SPLASH = "2-caras-feliz-cumpleanos-splash-neon-neon-surtido";
  const m = montaje(
    { id: "base", nombre: "Columna neón: cuarteto R-12 amarillo de la base", pieza: cuarteto(R("R-12", 30, AMARILLO), [AMARILLO]), origen: v(0, 16.6, 0), giroGrados: 45 },
    { nombre: "Varilla de la columna (por dentro)", base: v(0, 0, 0), altoCm: 150, radioCm: 0.5, hex: VARILLA },
  );
  [45, 135, 225, 315].forEach((a, q) => {
    m.globo(`verde-base-${q + 1}-a`, `R-5 verde del hueco ${q + 1} de la base (abajo)`, R("R-5", 11, VERDE), enAnillo(a, 25, 7), haciaFuera(a, -10));
    m.globo(`verde-base-${q + 1}-b`, `R-5 verde del hueco ${q + 1} de la base (arriba)`, R("R-5", 11, VERDE), enAnillo(a, 19, 28), haciaFuera(a, 40));
  });
  const anillos: ReadonlyArray<readonly [number, number, string, string]> = [[45.5, 59.5, "261", "naranja"], [83, 106, "212", "fucsia"], [128, 153, "230", "verde"]];
  const rizos: ReadonlyArray<readonly [string, string]> = [[ROSA, "rosado"], [DORADO, "dorado"], [AZUL, "azul"]];
  anillos.forEach(([yAnillo, yGlobo, codigo, nombre], k) => {
    m.nivel(`anillo-${k + 1}`, `Cuarteto R-5 verde ${k + 1}`, cuarteto(R("R-5", 12.5, VERDE), [VERDE]), v(0, yAnillo, 0), 45);
    m.globo(`impreso-${k + 1}`, `R-12 ${nombre} «Feliz cumpleaños» de splash neón`, R("R-12", 27, codigo), v(0, yGlobo, 0), ARRIBA, SPLASH);
    const [c, color] = rizos[k]!;
    const corona = (giro: number): Decoracion => rizo({ forma: "tirabuzon", tubito: { formatoId: "T-260", grosorCm: 3.5, codigo: c }, vueltas: 2, radioInicialCm: 7, radioFinalCm: 9.5, largoCm: 16, eje: "frente", giroGrados: giro });
    m.deco(`rizo-${k + 1}-izquierda`, `Rizo de T-260 ${color} (corona ${k + 1}, izquierda)`, corona(0), v(-10, r2(yAnillo + 1), 1), unitario(v(-1, 0.1, 0.55)));
    m.deco(`rizo-${k + 1}-derecha`, `Rizo de T-260 ${color} (corona ${k + 1}, derecha)`, corona(180), v(10, r2(yAnillo + 1), 1), unitario(v(1, 0.1, 0.55)));
  });
  return m.escena(sala(300, 260, 220));
};

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

const P_SURTIDO_NAVIDAD = pub("GLOBO FASHION SURTIDO NAVIDAD", "/products/globo-para-fiesta-latex-redondo-fashion-surtido-navidad-rojo-y-verde-selva", "R-12", null);
const P_TUBITO_BLANCO = pub("GLOBO TUBITO FASHION BLANCO", "/products/globo-para-fiesta-latex-tubito-fashion-blanco", "T-260", "005");

const NOTA_CRUZ = "la columna de 18 cuartetos R-5 (8,5 cm) en espiral de dos colores (una pareja de cada color, girando 1/8 por nivel), el travesaño de dos brazos de 5 cuartetos acostados que salen de los costados de la columna, un R-5 en cada punta, el remate arriba y la base de un cuarteto R-9 y uno R-5 grande";
const DISTINTO_CRUZ = "la foto no trae nada de tamaño conocido: la escala sale de casar el ancho (~70–75 px) y el paso (~20 px) de la columna con la del taller (en la foto los cuartetos van más apretados: se cuentan ~20 filas y aquí van 18 al paso del taller, y la columna es un poco más angosta); en la foto el travesaño cruza por delante de la columna (aquí son dos brazos que salen de sus costados)";

export const LOTE_20: readonly IdeaDigitalizada[] = [
  idea(429, "corazon-love", "Corazón Love: corazón orgánico Reflex Cristal Rojo con «love» oro rosa", escena429, () =>
    "Igual: el corazón orgánico de 244 × 212 cm (escala por los R-12 de delante, ~166 px = 28 cm) con globos de dos tamaños —R-12 a ~27 cm y R-5 a ~9 cm en los bordes y huecos— del Reflex Cristal Rojo 915 publicado, y encima el «love» metalizado oro rosa (~94 × 76 cm en la foto) con su centro a 117 cm de la punta, algo a la derecha del eje. Distinto: el «love» de la foto es una palabra en cursiva de una pieza que la tienda no vende: van las letras «LOVE» metalizadas oro rosa de 16\" (genéricas, sin producto); los globos los da el motor orgánico para el contorno y el grueso medidos (no uno a uno): en la foto hay además R-12 a ~22 cm que aquí van a 27; el amarre del «love» va escondido detrás del corazón.", [pub("GLOBO REDONDO REFLEX CRISTAL ROJO", "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", "R-12", "915")]),
  idea(449, "cristal-centerpiece", "Cristal centerpiece: corazón en burbuja y contorno de tubito", escena449, () =>
    `Misma foto que #277 («Centro de mesa cristal», lote 17; idéntica píxel a píxel): se reusa su digitalización con su propio id y slug, con otros tonos de sala para que la biblioteca no las funda. ${idea277().nota}`),
  idea(450, "cruz-celestial", "Cruz celestial: cadena de óvalos violeta con espiral azul", escena450, () =>
    "Igual: la cruz de ~130 cm con travesaño de ~92 cm (escala por los óvalos, LOL-12 a 15,5 cm de ancho) hecha en cadena: óvalos de Link-O-Loon 12 violeta alternados con racimitos de 4 R-5 violeta en cada unión —3 óvalos abajo del cruce, 2 arriba y 2 en cada brazo, con un racimo en el cruce y otro en cada punta— y la hilera de 35 R-5 azul rey que sube en espiral (3 vueltas) y pasa por delante del cruce. Distinto: la idea no publica productos: colores medidos (morado #7b1b84 → Violeta 051: la Orquídea Morada queda 1,5 ΔE más cerca pero no se fabrica en LOL-12; azul #3c53a3 → Azul Rey 041); en la foto los óvalos son de tamaños desparejos (el de arriba más largo) y aquí van iguales (13 cm); en la foto se ven ~25 azules y el cálculo de la espiral pone 35 (los de detrás no se ven); la varilla va por dentro de los óvalos."),
  idea(451, "cruz-dorada", "Cruz dorada: columna en espiral dorada y perla", escena451, () =>
    `Igual: ${NOTA_CRUZ}; ~1,6 m de alto y ~1,1 m de travesaño. Colores medidos: rayas Metal Dorado 570 y Reflex Plata 981, base Silk Verde Menta 826 con Reflex Plata, remate y punta izquierda Azul Caribe 038, punta derecha Reflex Plata. Distinto: la idea no publica productos; el dorado de la foto (#bb7009) está sobresaturado y no queda cerca de ningún dorado de la tabla (va el Metal Dorado porque la idea es «dorada»); la perla mide #b8b7ac (el Reflex Plata es el más cercano; en la foto se ve blanca perlada); ${DISTINTO_CRUZ}.`),
  idea(452, "cruz-pink", "Cruz pink: columna en espiral rosada", escena452, () =>
    `Igual: ${NOTA_CRUZ}; ~1,55 m de alto y ~1 m de travesaño, el mismo armado que la cruz dorada. Colores medidos: rayas Coral Tropical 059 (#fc899b, ΔE 12: el Satín Fucsia queda igual de lejos) y Rosado 009 (#fcb4be, ΔE 7); base, puntas y remate Palo de Rosa 010 (#c5a9ae, una perla rosada en sombra). Distinto: la idea no publica productos; en la foto los globos son perlados (aquí lisos Fashion); ${DISTINTO_CRUZ}.`),
  idea(454, "cruz", "Cruz: columna en espiral aguamarina y perla", escena454, () =>
    `Igual: ${NOTA_CRUZ}; ~1,55 m de alto y ~1 m de travesaño (la misma foto de la cruz pink con otro color). Colores medidos: rayas Azul Caribe 038 (#04b1d2, ΔE 9) y Aguamarina 037 (#80c4da, ΔE 12: el Pastel Mate Azul queda 2,5 más cerca); base, puntas y remate Silk Azul Ártico 839 (#8dafbb, ΔE 8: una perla azulada). Distinto: la idea no publica productos; en la foto las rayas son perladas (aquí Fashion); ${DISTINTO_CRUZ}.`),
  idea(461, "cumpleanos-cupcakes", "Cumpleaños cupcakes: columna de colores con metalizados", escena461, () =>
    "Igual: la columna de 5 cuartetos R-12 de un color con un globo al frente y sin girar entre sí (azul, verde trébol, amarillo miel, rosa y lila, de 12,5 a 88,5 cm), los R-9 rosados en los huecos entre nivel y nivel (16) y los R-5 rosados del lila (8; en la foto se ven 4), el R-12 azul impreso «Happy Birthday» encima (113 cm) y, con cintas rosadas, los dos redondos morados de 18\" (124 y 144 cm) y el cupcake metalizado (51 × 66 cm, hasta 216 cm). Distinto: la idea no publica productos: colores medidos (azul #008fd1 → Azul 040, verde #23b95d → Verde Trébol 029, amarillo #e8cd01 → Amarillo Miel 021, fucsia #eb3993 → Rosa 011, lila #bf98ca → Lila 050, rosados #ed78b2 → Satín Fucsia 412); el R-12 impreso de la foto (Happy Birthday con lunares) va con el «Happy Birthday Festivo» de la tienda sobre Azul 040 (el más parecido); los redondos y el cupcake no están en la tienda: los redondos van genéricos fucsia (no hay morado de foil) con el letrero, y el cupcake como paneles de foil (pirotín rosado de rayas, crema blanca con el letrero y la cereza), ninguno cotiza; los dibujos de cupcakes y lunares de los metalizados no van."),
  idea(464, "cumpleanos-rock-star", "Cumpleaños rock star: columna violeta con guitarra y estrella", escena464, () =>
    "Igual: la base de dos cuartetos R-9 rojos, la columna de cuartetos R-5 violeta (de 33 a 124 cm), los cuartetos R-5 negro y rojo, el cuarteto R-12 dorado con un R-5 violeta en medio (152 cm), la estrella metalizada arriba (hasta ~205 cm), la guitarra metalizada delante (42 × 86 cm) y los tres rizos de T-260 negro de la base. Distinto: la idea no publica productos: colores medidos (violeta #493382 → Violeta 051; dorado #ffce4e → Mostaza 023, el más cercano, aunque en la foto brilla como metal; rojo #f22b11 → Rojo 015); la estrella «Happy Birthday Rock Star» y la guitarra no están en la tienda: la estrella va genérica roja con «ROCK STAR» y la guitarra como paneles de foil con su etiqueta (no cotizan); en la foto la columna lleva ~17 niveles más apretados (aquí 13 al paso del taller, R-5 a 9,5 cm) y la base y la columna de detrás de la guitarra no se ven (son supuestas); los rizos son tirabuzones del taller (en la foto, lazos más sueltos)."),
  idea(496, "destello-de-corazones", "Destello de corazones: medusa de helio con tentáculos y corazones", escena496, () =>
    "Igual: la medusa de helio (escala por los R-12, ~104 px = 28 cm): el cuarteto de R-12 rojos con corazones blancos —el «Corazones por Siempre» rojo de la tienda, el más parecido— con su R-5 blanco en el centro, y los 7 tentáculos ondulados de T-260 blanco con su corazón C-12 rojo en la punta, en las posiciones medidas (hasta 113 cm por debajo del centro). Distinto: la idea no publica productos: colores medidos (rojo #dc1010 → Rojo 015, blanco); la foto la ve desde abajo y aquí flota a 1,75 m (el alto es supuesto); los corazones de la punta van a 13,5 cm (C-12 casi sin inflar); los tentáculos van de frente (en un plano cada uno, apenas separados) y en la foto se cruzan; el amarre va escondido entre los nudos."),
  idea(504, "dorado-eucalipto-arena", "Dorado, eucalipto y arena: ramo de helio con burbuja impresa", escena504, () =>
    "Igual: el ramo de helio por pisos en sus sitios medidos (escala por los R-12, ~100 px = 28 cm): 4 R-12 Arena 071 (3 delante y uno detrás que asoma), 2 Eucalipto 027, 3 Reflex Dorado 970 y arriba la burbuja R-24 Cristal (~47 cm) con 3 eucalipto y 3 dorados chicos dentro, con cintas rojas y blancas: los colores publicados. Distinto: la burbuja de la foto lleva ángeles y palomas blancos, pero la idea publica el «Infinity® Diamantes Dorados» transparente (R-24) y ese va; los globos de dentro son R-9 a 13,5 cm (la foto no deja ver si son R-5); el peso y lo bajo de las cintas no salen en la foto (el piso de arena va a 95 cm, supuesto).", [
    pub("GLOBO REDONDO INFINITY® DIAMANTES DORADOS FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-diamantes-dorados-fashion-transparente", "R-12", null),
    pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
    pub("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027"),
    pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
  ]),
  idea(512, "el-duende", "El duende: columna de personaje con cara y sombrero de copa", escena512, () =>
    "Igual: la base de dos cuartetos R-12 negros (con un hueco al frente, sin girar entre sí) con el R-12 blanco en el hueco del de arriba, el moño de dos R-12 rojos con su nudo R-9, la cabeza R-18 durazno (~45 cm) con los ojos y la sonrisa dibujados y el sombrero de copa negro —ala de Link-O-Loon 660 en aro (~71 cm) y copa R-18— hasta ~1,7 m (escala por los R-12 negros, ~82 px = 26 cm). Distinto: la idea no publica productos: colores medidos (cabeza #ffccab → Durazno 060, rojo #fe2812 → Rojo 015, blanco #d7d4d7 en sombra → Blanco 005); la cara es la del taller (ojos ovalados y sonrisa); en la foto el moño es más ancho y aplastado y la copa más achatada; los globos de detrás del moño y de la base son supuestos."),
  idea(543, "fantasma-happy-halloween", "Fantasma Happy Halloween: centro de mesa con fantasma de globos", escena543, () =>
    "Igual: la base de cuarteto R-12 negro con uno al frente, el R-12 naranja con el letrero «Happy Halloween» y, encima, el fantasma blanco —cabeza R-12 con ojos y boca abierta, la cola de otro R-12 hacia abajo a la izquierda, un brazo levantado y el otro de T-260— y los dos rizos de T-260 blanco a los lados de la base (escala por el R-12 naranja; la foto está estirada a lo alto y se corrige). Distinto: la idea no publica productos: colores medidos (naranja #fe8936 → Naranja 061, blanco en sombra → Blanco 005); los negros de la foto tienen chevrón blanco, que no está en la tienda: van lisos; el sello del naranja (castillo, calabaza y fantasma) va con el «Happy Halloween» 2 caras negro y naranja de la tienda (el más parecido); la cabeza del fantasma de la foto tiene la punta (el nudo) arriba a la derecha y aquí va derecha."),
  idea(545, "farol-navideno-verde", "Farol navideño verde: columna farol con bastón de caramelo", escena545, () =>
    "Igual: la base de cuarteto R-12 verde (se ven 2) y R-9 rojo con uno al frente, el bastón de dos T-260 en espiral (blanco y verde) de 50 a 127 cm, el cuarteto verde de debajo del farol, el farol de dos cuadrados de T-260 blanco (33 cm) con sus 4 postes y el R-12 rojo dentro, el cuarteto verde de arriba y el remate de 5 R-5 verdes, hasta ~2,15 m (escala por los R-12, ~60 px = 25 cm): el «Surtido Navidad» y el tubito blanco publicados. Distinto: el verde del bastón no está publicado (medido #046955 → T-260 Verde Selva 032); los R-5 del remate van lisos (el surtido no se vende en R-5); en la foto el globo del farol se ve aplastado contra el marco (aquí redondo) y los postes un poco curvos.", [P_SURTIDO_NAVIDAD, P_TUBITO_BLANCO]),
  idea(546, "farol-navideno", "Farol navideño: columna farol roja con bastón de caramelo", escena546, () =>
    "Igual: la misma columna que el farol verde con los colores al revés: base de cuarteto R-12 rojo (se ven 2) y R-9 verde con uno al frente, el bastón de T-260 rojo y blanco en espiral, el cuarteto rojo de debajo del farol, el farol de dos cuadrados de T-260 blanco con 4 postes y el R-12 verde dentro, el cuarteto rojo de arriba y el remate de 5 R-5 rojos, hasta ~2,15 m: el «Surtido Navidad» y los tubitos blanco y rojo publicados. Distinto: los R-5 del remate van lisos (el surtido no se vende en R-5); en la foto el globo del farol se ve aplastado contra el marco y los postes un poco curvos.", [P_TUBITO_BLANCO, pub("GLOBO TUBITO FASHION ROJO", "/products/globo-para-fiesta-latex-tubito-fashion-rojo", "T-260", "015"), P_SURTIDO_NAVIDAD]),
  idea(551, "feliz-cumpleanos-neon", "Feliz cumpleaños neón: columna apilada con coronas de rizos", escena551, () =>
    "Igual: la base de cuarteto R-12 amarillo con 8 R-5 verdes en los huecos (se ven 6), los tres R-12 «Feliz cumpleaños» de splash neón apilados —naranja, fucsia y verde— separados por cuartetos de R-5 verde, y en cada cuarteto verde su corona de dos rizos de T-260 (rosados abajo, dorados en medio y azules arriba), hasta ~1,67 m (escala por los R-12 impresos, ~90 px = 27 cm). Distinto: la idea no publica productos: colores medidos (amarillo #dbc101 → Amarillo Miel 021; verde #80c279 → Verde Lima 031; rizos #3680a5 → Reflex Azul 940, #d3a955 → Metal Dorado 570 y #fa689b → Rosa 011); el impreso es el «Feliz Cumpleaños Splash» 2 caras neón de la tienda (el más parecido), que pone sus colores neón: en la foto el rosado y el verde de arriba son más pálidos (#da869e y #82b786); los rizos son tirabuzones del taller (en la foto, más sueltos y desparejos)."),
];
