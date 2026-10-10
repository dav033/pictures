import type { IdeaDigitalizada, ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { coloresDelFormato, formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { AcabadoEscenografia, ElementoEscenografia, MotivoEscenografia } from "../escenografia";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import type { ColorOrganico, OpcionesOrganico, PuntoGrosor, PuntoMezcla, RellenoOrganico, TramoOrganico } from "../organico";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { Decoracion, PropiedadesMono } from "../figuras";
import type { Accesorio, Cara, DibujoCuerpo, PropiedadesFigura } from "../figuras-tubito";
import type { EstiloOjo, ParteTubito } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { PatronColumna } from "../columnas";
import type { Vec3 } from "../modulos";
import { centroCuerpo } from "../geometria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 26** (los números de `clasif/lote-26.json`): once columnas
 * rematadas con figura o con algo encima —la calabaza 2 (#347), la de «Feliz cumpleaños» orgánica con el «40»
 * (#371), la granja con la vaca (#379), Hello Kitty (#384), Lady Bug y Mariquita (#386 y #391, la misma foto), Love
 * (#387), la Marimonda (#388), la momia embrujada (#395), la nochebuena con el muñeco de nieve (#398) y el unicornio
 * (#412)—, la escena del conejo de Pascua (#416) y los corazones orgánico «te amo» (#430), orgánico (#431) y tejido
 * (#433).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada con rejilla de
 * píxeles y medida:
 * - **Escala**: la de algo de tamaño conocido en la misma foto (un metalizado redondo de 18" ≈ 41 cm de ancho, el
 *   grueso de un T-260 ≈ 4,5 cm, el de un Link-O-Loon 660 ≈ 15 cm, los R-12 de la idea ≈ 26–28 cm, una cenefa de R-12
 *   en el salón). Las posiciones se escriben en el mundo con `foto(eje, piso, px/cm)`: x a la derecha del eje, y desde
 *   el piso.
 * - **Conteo**: niveles de cada columna (de cuarteto en cuarteto: cuántos se ven de frente dice si va girado), globos
 *   de helio, calabacitas, resortes, rizos, flores, pétalos, letras, patas… uno a uno, y lo que la técnica obliga
 *   detrás (el cuarto globo de un cuarteto). En lo orgánico (#371, #430, #431) el motor da los globos del grosor y el
 *   largo medidos (no se cuentan uno a uno: la nota lo dice). Ninguna idea publica «Materiales» con cantidades: lo
 *   contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana de un
 *   parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y el código más cercano que se fabrica en
 *   ese formato.
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando la idea lo publica (Happy Birthday Diamante y Diamantes
 *   Cobre de #371, Metalink Plata Graffiti y Graffiti Invierno de #430 y #431) o cuando la foto lo muestra (el corazón
 *   «LOVE» de #387, el Polka Blanco rojo de las mariquitas, el número 4 plata de #371); si no, el más parecido del
 *   catálogo y la nota lo dice. Lo impreso que la tienda no vende (los lunares naranja sobre negro de #347, las manchas
 *   de la vaca, las nubes del unicornio, los lunares blancos sobre negro) va **dibujado** sobre el globo liso que se
 *   compra (`DibujoCuerpo` del generador de figuras), y lo metalizado que no está en la tienda (la calavera de #347, la
 *   momia y su calabaza, los redondos de calabaza de #395, el 0 de #371) va genérico, sin producto.
 * - **Figuras de remate** (la calabacita, la vaca, Hello Kitty, las mariquitas, la Marimonda, el muñeco de nieve, el
 *   unicornio): con globos reales —cabeza, cuerpo, orejas y rasgos de R-5, R-9 o T-260, caras impresas del generador de
 *   figuras— colgadas de la columna, nunca con sólidos (la momia de #395 es un metalizado en la foto: va como foil).
 * - **Montaje** (como los lotes 13, 23 y 24): cada estructura es su propio árbol. Su raíz es la estructura de globos
 *   (suelta, en su sitio); de la raíz cuelga (`sobre`) un **amarre** escondido (`oculto: true`: existe y da el marco,
 *   pero no se dibuja ni se compra) puesto en el piso bajo la estructura, donde no tiene globos encima, y del amarre
 *   todo lo suyo, en el sitio exacto de la foto (también sus cintas de helio y los paneles de foil). La utilería del
 *   salón de #416 (letras, conejos, carretillas, mesas, cortinas, tapete) va aparte, suelta.
 * Unidades: cm. Mundo: y arriba desde el piso, x a la derecha de quien mira, +z hacia quien mira; la pared del fondo
 * en z = −fondo/2.
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
/** Hacia fuera en el plano del piso: 0° = al frente (+z), 90° = a la derecha de quien mira (+x). */
const fuera = (grados: number): Vec3 => v(r2(Math.sin(rad(grados))), 0, r2(Math.cos(rad(grados))));
/** Dirección hacia fuera `grados` alrededor y levantada `elevacion` grados sobre el plano del piso. */
const haciaFuera = (grados: number, elevacion: number): Vec3 => unitario(mas(por(fuera(grados), Math.cos(rad(elevacion))), por(ARRIBA, Math.sin(rad(elevacion)))));
/** Un punto a `radio` del eje vertical, en el ángulo `grados` (0° al frente), a la altura `y`. */
const enAnillo = (grados: number, radio: number, y: number): Vec3 => mas(por(fuera(grados), radio), v(0, y, 0));
/** Del píxel de una foto al mundo: x desde el eje de la pieza, y desde el piso (la fila `piso`), a `pxPorCm`. */
const foto = (eje: number, piso: number, pxPorCm: number) => (x: number, y: number, z = 0): Vec3 => v(r2((x - eje) / pxPorCm), r2((piso - y) / pxPorCm), z);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const T = (formatoId: string, grosorCm: number, codigo: string): ParteTubito => ({ formatoId, grosorCm, codigo });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos: Partial<Sala["tonos"]> = {}): Sala => {
  const s = structuredClone(SALA_INICIAL);
  return { ...s, anchoCm, fondoCm, altoCm, tonos: { ...s.tonos, ...tonos } };
};
const SIN_CARA: Cara = { ojos: null, boca: null, mejillas: null, bigote: null, nariz: null, cejas: null };

/** El giro sobre la normal que deja la cara (+z local) de la pieza lo más hacia quien mira (+z): lo impreso al frente. */
function giroAlFrente(normal: Vec3): number {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  return Math.round((Math.atan2(-xL.z, zL.z) * 180) / Math.PI);
}


// ----------------------------------------------------------------------------------------------------------
// Piezas
// ----------------------------------------------------------------------------------------------------------

/** Un nivel de cuarteto como columna de un nivel (`giro` 0: un hueco al frente, se ven 2; 45: un globo al frente). */
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
 * Un tubito de frente que sigue líneas quebradas y arcos (patas, brazos, algas, peces): una figura vacía con cadenas
 * de burbujas. Las coordenadas van como las ve quien mira la foto (cm: a su derecha, arriba); como una pieza `sobre`
 * queda en espejo (el marco de un ancla es de mano izquierda), aquí se reflejan para que se vea como en la foto.
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
// Escenografía suelta (no cotiza)
// ----------------------------------------------------------------------------------------------------------

const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: AcabadoEscenografia = "mate", giroGrados = 0): ElementoEscenografia =>
  ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado, ...(giroGrados ? { giroGrados } : {}) });
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: AcabadoEscenografia = "mate", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });
/** Un cilindro de `desde` a `hasta` (palito, tallo, tubo del marco, cinta). */
function barra(desde: Vec3, hasta: Vec3, radioCm: number, hex: string, acabado: AcabadoEscenografia = "mate"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm: r2(radioCm), altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });
/** Una pieza suelta en el salón con su origen en (x, y, z). */
const suelto = (id: string, nombre: string, pieza: Pieza, x: number, y: number, z: number, giroGrados = 0): NodoEscena =>
  ({ id, nombre, pieza, colocacion: { en: "libre", xCm: r2(x), yCm: r2(y), zCm: r2(z), giroGrados } });

// ----------------------------------------------------------------------------------------------------------
// Orgánicos (la raíz de un montaje: un racimo de una paleta, en el mundo)
// ----------------------------------------------------------------------------------------------------------

const FORMATOS_REDONDOS = ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"];
/** Un color de la paleta orgánica, solo en los formatos donde se fabrica (y, si se pide, solo en esos). */
function color(codigo: string, peso: number, soloEn?: string[]): ColorOrganico {
  const formatos = (soloEn ?? FORMATOS_REDONDOS).filter((f) => coloresDelFormato(f).some((r) => r.codigo === codigo));
  return { codigo, peso, formatos };
}
const mezcla = (pesos: Readonly<Record<string, number>>, fin?: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos: fin ?? pesos }];
/** Grosor de un racimo: de `inicio` a `fin` (y la punta, redondeada). */
const grosor = (inicio: number, fin: number): PuntoGrosor[] => [{ t: 0, radioCm: inicio }, { t: 0.85, radioCm: fin }, { t: 1, radioCm: fin * 0.85 }];
const RELLENO_12_9: RellenoOrganico[] = [{ formatoId: "R-12", infladoCm: 22, trios: false }, { formatoId: "R-9", infladoCm: 16, trios: false }];
const RELLENO_12_5: RellenoOrganico[] = [{ formatoId: "R-12", infladoCm: 22, trios: false }, { formatoId: "R-5", infladoCm: 11, trios: true }];
/** Inflados de lo orgánico en estas fotos (los globos de estructura van un poco menos inflados que los de helio). */
const INFLADOS: Readonly<Record<string, number>> = { "R-36": 80, "R-24": 52, "R-18": 40, "R-12": 27, "R-9": 20, "R-5": 12 };

/** Un tramo de racimo con su recorrido en el MUNDO. */
type TramoDef = { id: string; nombre: string; puntos: Vec3[]; grosor: PuntoGrosor[]; mezcla: PuntoMezcla[]; tapas?: { inicio?: boolean; fin?: boolean }; irregularidad?: number };
type OpcionesPaleta = { colores: ColorOrganico[]; semilla: number; relleno: RellenoOrganico[]; inflados?: Readonly<Record<string, number>>; densidad?: number };

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

/** Un orgánico de una paleta, con su origen (el plano de apoyo) en `origen` del mundo: lo que va de raíz suelta. */
function organico(tramos: readonly TramoDef[], o: OpcionesPaleta): { pieza: Pieza; origen: Vec3 } {
  const origen = v(0, planoDe(tramos) || 2, 0);
  const t: TramoOrganico[] = tramos.map((d) => ({
    id: d.id, nombre: d.nombre, recorrido: d.puntos.map((p) => redondo(menos(p, origen))), grosor: d.grosor, mezcla: d.mezcla,
    irregularidad: d.irregularidad ?? 0.14, tapas: d.tapas ?? { inicio: true, fin: true },
  }));
  const opciones: OpcionesOrganico = {
    semilla: o.semilla, tramos: t, inflados: { ...(o.inflados ?? INFLADOS) }, variacionInflado: 0.07,
    relleno: o.relleno.map((r) => ({ ...r })), colores: o.colores, suelo: true, huecosFlores: 0, ...(o.densidad ? { densidad: o.densidad } : {}),
  };
  return { pieza: { tipo: "organico", opciones, flores: null }, origen };
}

// ----------------------------------------------------------------------------------------------------------
// Montaje: la estructura como raíz, su amarre escondido y lo que cuelga del amarre
// ----------------------------------------------------------------------------------------------------------

/** Lo que se hunde una pieza `sobre` otra (`HUNDIMIENTO_SOBRE_CM` de la escena). */
const HUNDIDO = 1.5;
/** Amarre con normal hacia arriba y giro −90°: su marco local es el del mundo con x al revés. */
const GIRO_AMARRE = -90;

/** Alto bajo el origen de una pieza armada (−min.y de su caja): lo que la escena corre al apoyarla `sobre` algo sin globos. */
const bajoOrigen = (pieza: Pieza): number => -armarPieza(pieza).caja.min.y;

type Montaje = {
  nodos: NodoEscena[];
  /** El id del amarre (para saber qué cuelga de qué). */
  amarre: string;
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro del cuerpo en `centro`, hacia `direccion` (con su impreso de la tienda, al frente). */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un globo con cara impresa (de pie y de frente) con el centro del cuerpo en `centro`. */
  conCara: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, cara: Cara, queEs: string) => void;
  /**
   * Una decoración de pie y de frente puesta por el centro del cuerpo de uno de sus globos (`indice`, el orden en que
   * la arma): un globo con lunares dibujados, una calabacita, un ojo. Así queda donde está en la foto.
   */
  centrado: (id: string, nombre: string, decoracion: Decoracion, centro: Vec3, indice?: number) => void;
  /** Un metalizado de pie y de frente con el centro en `centro`. */
  foil: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3) => void;
  /** Paneles de foil (contorno de frente con la base en y = 0, centrado) con la base en `base`, de pie y de frente. */
  foilPaneles: (id: string, nombre: string, elementos: ElementoEscenografia[], base: Vec3) => void;
  /** Un nivel de cuarteto (o una columna) con el centro del primer nivel en `centro`, girado `giroGrados`. */
  nivel: (id: string, nombre: string, pieza: Pieza, centro: Vec3, giroGrados: number) => void;
  /** Una decoración con su origen en `origen`, mirando hacia `normal` (su +y local) y girada `giroGrados`. */
  deco: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados?: number) => void;
  /** Una decoración de pie (rizo, figura, burbuja: +z local arriba) con su origen en `origen`, de frente. */
  dePie: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, impresos?: ImpresoEnPieza[]) => void;
  /** Unos trazos de tubito con su punto (0, 0) en `origen`, en el plano vertical de frente: su «arriba» es el del mundo. */
  trazo: (id: string, nombre: string, t: ParteTubito, partes: readonly TrazoFrente[], origen: Vec3, queEs: string) => void;
  /**
   * Un tramo orgánico de otra paleta (el motor pinta cada pieza con una sola) con su recorrido en el MUNDO: cuelga del
   * amarre con la normal arriba y girado 90° (su (x, y, z) local va a (x, y, −z) del mundo), con su plano de apoyo
   * justo bajo su globo más bajo.
   */
  organico: (id: string, nombre: string, tramos: readonly TramoDef[], o: OpcionesPaleta) => void;
};

/**
 * Arma el montaje: `raiz` suelta con su origen en `origen` (mundo); su amarre (escondido, `oculto`), con la base en
 * `amarre` (mundo), en un sitio sin globos encima (el eje hueco de los cuartetos, el piso bajo un arco o tras la pieza):
 * así la escena no lo corre y queda donde se pide. Lo demás cuelga del amarre, exacto.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; origen: Vec3; giroGrados?: number }, amarre: Vec3): Montaje {
  const idAmarre = `${raiz.id}-amarre`;
  const nodos: NodoEscena[] = [{ id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: { en: "libre", xCm: r2(raiz.origen.x), yCm: r2(raiz.origen.y), zCm: r2(raiz.origen.z), giroGrados: raiz.giroGrados ?? 0 } }];
  const g = rad(raiz.giroGrados ?? 0);
  const d = menos(amarre, raiz.origen);
  // Del mundo al espacio de la raíz (girada sobre la vertical).
  const local = v(d.x * Math.cos(g) - d.z * Math.sin(g), d.y + HUNDIDO, d.x * Math.sin(g) + d.z * Math.cos(g));
  nodos.push({
    id: idAmarre, nombre: `Amarre de «${raiz.nombre}» (escondido)`,
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 0.3, altoCm: 1, hex: "#d8d8d8", acabado: "mate", oculto: true }] },
    // El giro de una pieza `sobre` se cuenta en el mundo (no hereda el de la raíz): el marco del amarre es el del
    // mundo con x al revés, gire como gire la raíz.
    colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(local), normal: ARRIBA, giroGrados: GIRO_AMARRE },
  });
  const O = amarre;
  const aAmarre = (p: Vec3): Vec3 => redondo(v(-(p.x - O.x), p.y - O.y, p.z - O.z));
  const dirAAmarre = (n: Vec3): Vec3 => redondo(v(-n.x, n.y, n.z));
  const pieza = (id: string, nombre: string, p: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    const punto = menos(origen, por(n, bajoOrigen(p) - HUNDIDO));
    nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: idAmarre, puntoCm: aAmarre(punto), normal: dirAAmarre(n), giroGrados } });
  };
  const globo = (id: string, nombre: string, gl: ParteGlobo, centro: Vec3, direccion: Vec3 = ARRIBA, impresoId?: string) => {
    const p: Pieza = { tipo: "globo", formatoId: gl.formatoId, infladoCm: gl.infladoCm, codigo: gl.codigo, ...(gl.helio ? { helio: true as const } : {}), ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
    pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
  };
  const deco = (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados = 0) => pieza(id, nombre, { tipo: "decoracion", decoracion }, origen, normal, giroGrados);
  const centrado = (id: string, nombre: string, decoracion: Decoracion, centro: Vec3, indice = 0) => {
    // De pie y de frente (normal al frente): el +z de la decoración sube y su +y mira a quien ve.
    const p: Pieza = { tipo: "decoracion", decoracion };
    const g = armarPieza(p).globos[indice]!;
    const tipo = formatoPorId(g.formatoId)?.tipo === "link" ? "link" : "redondo";
    const c = mas(g.nudo, por(g.direccion, centroCuerpo(tipo, g.infladoCm)));
    pieza(id, nombre, p, menos(centro, v(c.x, c.z, c.y)), AL_FRENTE);
  };
  return {
    nodos, amarre: idAmarre, pieza, globo, deco,
    conCara: (id, nombre, gl, centro, cara, queEs) => centrado(id, nombre, figura({ cuerpo: [{ tipo: "globo", globo: gl, cara }], accesorios: [], queEs }), centro),
    centrado,
    foil: (id, nombre, m, centro) => {
      const p: Pieza = { tipo: "metalizado", metalizado: m };
      const k = armarPieza(p).caja;
      // Normal arriba y el giro del amarre: el panel queda de frente y sin espejo.
      pieza(id, nombre, p, v(centro.x, r2(centro.y - (k.max.y - k.min.y) / 2), centro.z), ARRIBA, GIRO_AMARRE);
    },
    foilPaneles: (id, nombre, elementos, base) => pieza(id, nombre, { tipo: "escenografia", elementos }, base, ARRIBA, GIRO_AMARRE),
    nivel: (id, nombre, p, centro, giroGrados) => pieza(id, nombre, p, centro, ARRIBA, GIRO_AMARRE - giroGrados),
    dePie: (id, nombre, decoracion, origen, impresos) => pieza(id, nombre, { tipo: "decoracion", decoracion, ...(impresos?.length ? { impresos } : {}) }, origen, AL_FRENTE),
    trazo: (id, nombre, t, partes, origen, queEs) => {
      const p: Pieza = { tipo: "decoracion", decoracion: trazos(t, partes, queEs) };
      // La figura se apoya en z = 0 (su arriba, con la normal al frente, es el del mundo): su (0, 0) sube lo que bajaba
      // el punto más bajo, más medio grosor.
      pieza(id, nombre, p, menos(origen, v(0, subidaDeTrazos(t, partes), 0)), AL_FRENTE);
    },
    organico: (id, nombre, tramos, o) => {
      const hecho = organico(tramos.map((d) => ({ ...d, puntos: d.puntos.map((q) => v(q.x, q.y, -q.z)) })), o);
      pieza(id, nombre, hecho.pieza, v(0, hecho.origen.y, 0), ARRIBA, 90);
    },
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
 * vive en `index.ts` (que importa este lote): se calculan al leerlas, como en los lotes 17 y 20.
 */
function idea(numero: number, slug: string, nombre: string, escena: () => Escena, nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  if (f.numero !== numero) throw new Error(`«${slug}» es la #${f.numero}, no la #${numero}.`);
  let hecha: Escena | null = null;
  let hechos: ProductoDeIdea[] | null = null;
  return {
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
    get contenido() { return { tipo: "escena" as const, escena: (hecha ??= escena()) }; },
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
    get productos() { return (hechos ??= productosDe((hecha ??= escena()), publicados)); },
  };
}

const escenaDe = (...montajes: Array<Montaje | NodoEscena[]>) => (s: Sala): Escena => ({ sala: s, nodos: montajes.flatMap((m) => (Array.isArray(m) ? m : m.nodos)) });


// ----------------------------------------------------------------------------------------------------------
// Ayudas del lote 26
// ----------------------------------------------------------------------------------------------------------

/** Nombre comercial de los códigos que usa el lote (para los nombres de los nodos). */
const NOMBRE: Readonly<Record<string, string>> = {
  "005": "Fashion Blanco", "009": "Fashion Rosado", "010": "Fashion Palo de Rosa", "012": "Fashion Fucsia", "015": "Fashion Rojo",
  "020": "Fashion Amarillo", "021": "Fashion Amarillo Miel", "027": "Fashion Eucalipto", "029": "Fashion Verde Trébol", "030": "Fashion Verde",
  "031": "Fashion Verde Lima", "032": "Fashion Verde Selva", "035": "Fashion Turquesa Profundo", "038": "Fashion Azul Caribe", "040": "Fashion Azul",
  "050": "Fashion Lila", "051": "Fashion Violeta", "061": "Fashion Naranja", "080": "Fashion Negro", "212": "Neón Fucsia", "240": "Neón Azul",
  "390": "Cristal Transparente", "409": "Satín Rosado", "570": "Metal Dorado", "609": "Pastel Mate Rosado", "809": "Silk Rosa Primaveral",
  "870": "Silk Dorado", "970": "Reflex Dorado", "981": "Reflex Plata",
};
const nombreDe = (codigo: string): string => NOMBRE[codigo] ?? codigo;

/** Lunares (o manchas) dibujados en la cara de un globo liso: lo impreso que la tienda no vende. */
const lunares = (hex: string, cantidad: number): DibujoCuerpo => ({ estilo: "puntos", hex, cantidad });

/** Un globo liso con lunares dibujados (una figura de un solo globo, de pie y de frente). */
const globoDibujado = (g: ParteGlobo, dibujo: DibujoCuerpo, queEs: string): Decoracion => figura({ cuerpo: [{ tipo: "globo", globo: g, dibujo }], accesorios: [], queEs });

/**
 * Un cuarteto de globos con lunares dibujados, globo a globo (la columna no sabe dibujar): con `giroGrados` 0 queda un
 * hueco al frente (se ven 2) y con 45 un globo al frente (se ven 3), como un nivel de la columna. Los globos van a
 * 0,62 diámetros del eje, como los aprieta la cuerda.
 */
function cuartetoDibujado(m: Montaje, id: string, nombre: string, g: ParteGlobo, codigos: readonly string[], dibujo: DibujoCuerpo, centro: Vec3, giroGrados: number, queEs: string): void {
  for (let k = 0; k < 4; k++) {
    const a = giroGrados + 45 + 90 * k;
    const c = mas(v(centro.x, 0, centro.z), enAnillo(a, r2(g.infladoCm * 0.62), centro.y));
    const codigo = codigos[k % codigos.length]!;
    m.centrado(`${id}-${k + 1}`, `${nombre} ${k + 1} (${g.formatoId} ${nombreDe(codigo)})`, globoDibujado({ ...g, codigo }, dibujo, queEs), redondo(c));
  }
}

/** Un globo de un ramo de helio: liso, impreso de la tienda o con lunares dibujados. */
type GloboHelio = { id: string; nombre: string; globo: ParteGlobo; centro: Vec3; impresoId?: string; dibujo?: DibujoCuerpo };

/**
 * Un ramo de helio amarrado a la estructura: cada globo en su sitio de la foto, mirando un poco hacia fuera del nudo,
 * y sus cintas (papel: no cotizan) del cuello de cada globo al nudo común, en una pieza aparte.
 */
function helio(m: Montaje, id: string, nombre: string, globos: readonly GloboHelio[], nudo: Vec3, hexCinta: string): void {
  const cintas: ElementoEscenografia[] = [];
  for (const h of globos) {
    const d = h.dibujo ? ARRIBA : unitario(v((h.centro.x - nudo.x) * 0.12, 1, (h.centro.z - nudo.z) * 0.12));
    if (h.dibujo) m.centrado(h.id, h.nombre, globoDibujado({ ...h.globo, helio: true }, h.dibujo, "a helium balloon with painted polka dots"), h.centro);
    else m.globo(h.id, h.nombre, { ...h.globo, helio: true }, h.centro, d, h.impresoId);
    const cuello = menos(h.centro, por(d, centroCuerpo("redondo", h.globo.infladoCm)));
    cintas.push(barra(v(0, 0, 0), menos(cuello, nudo), 0.2, hexCinta, "papel"));
  }
  m.foilPaneles(id, nombre, cintas, nudo);
}

/** Un racimito de globitos (trío, cuarteto…) alrededor de `centro`, mirando hacia `frente`. */
function racimo(m: Montaje, id: string, nombre: string, codigos: readonly string[], centro: Vec3, infladoCm = 11, frente: Vec3 = AL_FRENTE): void {
  const n = codigos.length;
  const fr = unitario(frente);
  const lado = unitario(Math.abs(fr.y) < 0.9 ? cruz(ARRIBA, fr) : v(1, 0, 0));
  const arriba = cruz(fr, lado);
  codigos.forEach((codigo, k) => {
    const a = (2 * Math.PI * k) / Math.max(1, n) + 0.4;
    const radial = mas(por(lado, Math.cos(a)), por(arriba, Math.sin(a)));
    const desvio = n > 1 ? infladoCm * 0.5 : 0;
    m.globo(`${id}-${k + 1}`, `${nombre} ${k + 1}: R-5 ${nombreDe(codigo)}`, R("R-5", infladoCm, codigo), redondo(mas(centro, por(radial, desvio))), unitario(mas(fr, por(radial, 0.6))));
  });
}

/** Una flor de tubito de pétalos en burbuja (las de la corona del unicornio y las de la base de la granja). */
const florBurbuja = (formatoId: string, grosorCm: number, codigo: string, petalos: number, largoCm: number, centro: ParteGlobo | null): Decoracion => ({
  tipo: "flor_tubito",
  propiedades: { petalos: { formatoId, grosorCm, codigos: [codigo], cantidad: petalos, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados: 10, giroGrados: 90 }, interior: null, corona: null, centro },
});

/** Un punto sobre la cara de delante de una esfera de centro `c` y radio `radio`, a la altura y la x de la foto. */
const sobreEsfera = (c: Vec3, radio: number, p: Vec3, afuera = 0): Vec3 => {
  const dx = p.x - c.x, dy = p.y - c.y;
  return v(p.x, p.y, r2(c.z + Math.sqrt(Math.max(0, radio * radio - dx * dx - dy * dy)) + afuera));
};

/** Puntos de una elipse (para trazos cerrados de tubito: ojos, labios, aros), en cm, empezando a la derecha. */
const elipse = (rx: number, ry: number, n = 14): Array<readonly [number, number]> =>
  Array.from({ length: n + 1 }, (_, i): readonly [number, number] => [r2(rx * Math.cos((2 * Math.PI * i) / n)), r2(ry * Math.sin((2 * Math.PI * i) / n))]);

/** Del píxel a cm relativos a un punto de la foto (para trazar de frente): [a la derecha, arriba]. */
const relativo = (escala: number, x0: number, y0: number) => (lista: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> =>
  lista.map(([x, y]): readonly [number, number] => [r2((x - x0) / escala), r2((y0 - y) / escala)]);

/** Un resorte de tubito de `desde` a `hasta` (mundo): sale de frente (+y local) hacia donde mira la normal. */
function resorte(m: Montaje, id: string, nombre: string, t: ParteTubito, desde: Vec3, hasta: Vec3, vueltas: number, radioCm: number): void {
  const d = menos(hasta, desde);
  m.deco(id, nombre, rizo({ forma: "resorte", tubito: t, vueltas, radioCm, largoCm: r2(largo(d)), eje: "frente" }), desde, unitario(d));
}

/** Un panel de papel (no cotiza) con su contorno de frente. */
const panelPapel = (contorno: ReadonlyArray<readonly [number, number]>, hex: string, motivo?: MotivoEscenografia, zCm = -0.3, grosorCm = 0.6): ElementoEscenografia => ({
  forma: "panel", contorno: contorno.map(([x, y]) => ({ x: r2(x), y: r2(y) })), zCm, grosorCm, hex, acabado: "papel", ...(motivo ? { motivo } : {}),
});

/** Un abanico de papel (pompón visto de frente): roseta plisada de radio `radio`, centrada en (0, 0). */
const roseta = (radio: number): Array<readonly [number, number]> =>
  Array.from({ length: 36 }, (_, i): readonly [number, number] => {
    const r = i % 2 ? radio * 0.84 : radio;
    return [r2(r * Math.cos((2 * Math.PI * i) / 36)), r2(r * Math.sin((2 * Math.PI * i) / 36))];
  });

/** Corre un contorno (x, y) en el plano. */
const mover = (puntos: ReadonlyArray<readonly [number, number]>, dx: number, dy: number): Array<readonly [number, number]> => puntos.map(([x, y]): readonly [number, number] => [r2(x + dx), r2(y + dy)]);

const SIN_DIBUJO_CINTA = "#f2f2f2";
const CARA_NEGRA = "#141414";

// ----------------------------------------------------------------------------------------------------------
// 347 · Columna calabaza 2
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por el metalizado redondo de 18" del remate (~82 px de ancho ≈ 41 cm): 2 px/cm,
 * que da los R-12 de lunares de ~52 px (26 cm), el naranja del medio de ~80 px (R-18 a 40 cm) y los globos del espiral
 * de ~28 px (R-9 a 14 cm: el ancho del espiral, ~70 px, pide 14–15 cm); piso en y = 527 px, eje en x = 365. De abajo
 * arriba: cuarteto R-12 negro con lunares naranja (se ven 2: hueco al frente), espiral de 4 cuartetos verde y morado
 * (filas contadas a 398, 418, 440 y 462 px), el R-18 naranja (centro a 88 cm), el anillo de un cuarteto R-9 negro
 * (108 cm), otro espiral de 4 cuartetos (filas a 225, 245, 265 y 285 px), el cuarteto R-12 naranja con lunares negros
 * (163 cm, se ven 2), el cuarteto R-12 negro con lunares (183 cm, se ven 3: girado) y el metalizado redondo con la
 * calavera y la banda «Happy Halloween» (centro a 220 cm, hasta ~2,4 m). Alrededor, 5 calabacitas (no 6: se cuentan 5
 * en la foto) colgadas de 5 resortes de tubito plateado. Medidos: verde #80be6e–#9ac982 → Fashion Verde Lima 031
 * (ΔE 14–20); morado #39197e → Fashion Violeta 051 (ΔE 10); naranja #f37b04 → Fashion Naranja 061 (ΔE 17); negro 080;
 * resortes plateados → Reflex Plata 981 en T-260.
 */
const escena347 = (): Escena => {
  const NEGRO = "080", NARANJA = "061", LIMA = "031", VIOLETA = "051", PLATA = "981";
  const f = foto(365, 527, 2);
  const espiral = columna(R("R-9", 14, LIMA), 4, [LIMA, VIOLETA], "dos_colores");
  const m = montaje({ id: "espiral-abajo", nombre: "Calabaza 2: espiral de 4 cuartetos R-9 Fashion Verde Lima y Violeta (abajo)", pieza: espiral, origen: v(0, 34, 0) }, v(0, 0, 0));
  const NARANJA_HEX = "#f39a2b";
  cuartetoDibujado(m, "base", "Base: R-12 negro con lunares naranja", R("R-12", 26, NEGRO), [NEGRO], lunares(NARANJA_HEX, 10), v(0, 18, 0), 0, "a black balloon with orange polka dots");
  m.globo("naranja-r18", "R-18 Fashion Naranja del medio", R("R-18", 40, NARANJA), v(0, 88, 0));
  m.nivel("anillo-negro", "Anillo: cuarteto R-9 Fashion Negro", cuarteto(R("R-9", 14, NEGRO), [NEGRO]), v(0, 108, 0), 0);
  m.nivel("espiral-arriba", "Espiral de 4 cuartetos R-9 Fashion Verde Lima y Violeta (arriba)", espiral, v(0, 121, 0), 0);
  cuartetoDibujado(m, "naranja-lunares", "R-12 naranja con lunares negros", R("R-12", 26, NARANJA), [NARANJA], lunares("#1a1a1a", 10), v(0, 163, 0), 0, "an orange balloon with black polka dots");
  cuartetoDibujado(m, "negro-lunares", "Remate: R-12 negro con lunares naranja", R("R-12", 27, NEGRO), [NEGRO], lunares(NARANJA_HEX, 10), v(0, 183, 0), 45, "a black balloon with orange polka dots");
  m.foil("calavera", "Metalizado redondo de 18\" con calavera y «Happy Halloween» (genérico, sin producto)", { forma: { tipo: "redondo" }, pulgadas: 18, color: "plata", impreso: { dibujo: "calavera", hex: "#1b1b1f" } }, f(364, 86, 0));
  // Las 5 calabacitas (centro medido) y su resorte (de la columna al tallo).
  const CALABAZAS: ReadonlyArray<readonly [string, number, number, number, number]> = [
    ["arriba-derecha", 450, 180, 396, 146], ["medio-izquierda", 310, 275, 324, 212], ["medio-derecha", 433, 275, 404, 212],
    ["abajo-izquierda", 299, 441, 330, 382], ["abajo-derecha", 401, 466, 386, 426],
  ];
  for (const [lado, px, py, qx, qy] of CALABAZAS) {
    const c = f(px, py, 8);
    m.centrado(`calabaza-${lado}`, `Calabacita ${lado.replace("-", " ")}: R-9 Fashion Naranja con cara de calabaza y tallo de T-260 Fashion Verde Lima`, {
      tipo: "calabaza", propiedades: { globo: R("R-9", 18, NARANJA), cara: { hex: "#1a1a1a" }, tallo: { ...T("T-260", 3, LIMA), lazos: 2, largoLazoCm: 6, zarcillos: false } },
    }, c);
    resorte(m, `resorte-${lado}`, `Resorte ${lado.replace("-", " ")}: T-260 Reflex Plata`, T("T-260", 2.2, PLATA), f(qx, qy, 6), mas(c, v(0, 9, 0)), 5, 2.2);
  }
  return escenaDe(m)(sala(240, 220, 270, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 371 · Columna feliz cumpleaños orgánico
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por los R-12 de helio (~58 px de ancho ≈ 28 cm): 2,07 px/cm, piso en
 * y = 556 px, eje en x = 375. La columna orgánica (de 300 a 455 px de ancho, hasta ~1 m) de R-12, R-9 y R-5 negros,
 * Reflex Dorado y Reflex Plata, con la base de un cuarteto R-12 negro (se ven 2: hueco al frente, ~60 px), el R-12
 * Metalink Plata Graffiti grande arriba a la izquierda (~60 px) y otros veteados en el cuerpo, dos R-12 dorados
 * grandes y uno plateado, los racimitos de R-5 dorados (uno de 6 y uno de 3) y plateados (dos de 3), y 4 rizos de T-260 blanco (dos
 * por lado). Encima, el «40» de metalizados plateados (el 4 inclinado a la izquierda, ~130 px ≈ 63 cm de alto: de
 * 26", entre los 16" y 32" que vende la tienda) y el ramo de 6 R-12 de helio contados: 2 «Diamantes Cobre» blancos,
 * 2 «Happy Birthday Diamante» negros y 2 Reflex Dorado, hasta ~2,6 m. Colores: los publicados (Reflex Dorado 970,
 * Reflex Plata 981, Fashion Negro 080 de los impresos); los rizos blancos medidos #ffffff → Fashion Blanco 005.
 */
const escena371 = (): Escena => {
  const NEGRO = "080", ORO = "970", PLATA = "981", BLANCO = "005";
  const HBD = "infinity-happy-birthday-diamante-escarchado-dorado-fashion-negro", COBRE = "infinity-diamantes-cobre-fashion-blanco", GRAFFITI = "infinity-metalink-plata-graffiti-fashion-negro";
  const f = foto(375, 556, 2.07);
  const col = organico([{
    id: "columna", nombre: "Columna", irregularidad: 0.22, puntos: [v(0, 38, -2), v(-3, 58, 0), v(2, 76, 0), v(-6, 94, 2)],
    grosor: [{ t: 0, radioCm: 29 }, { t: 0.5, radioCm: 27 }, { t: 1, radioCm: 22 }], mezcla: mezcla({ "R-12": 0.5, "R-9": 0.2, "R-5": 0.3 }),
  }], { colores: [color(NEGRO, 0.62), color(ORO, 0.16, ["R-5"]), color(PLATA, 0.22, ["R-9", "R-5"])], semilla: 371, relleno: RELLENO_12_5 });
  // El Metalink Plata Graffiti solo se vende en R-12: va en uno de cada tres R-12 negros de la columna.
  const negros12 = armarPieza(col.pieza).globos.map((g, k) => (g.formatoId === "R-12" && g.codigo === NEGRO ? k : -1)).filter((k) => k >= 0);
  const raiz: Pieza = { ...col.pieza, impresos: [{ impresoId: GRAFFITI, globos: negros12.filter((_, n) => n % 3 === 0) }] };
  const m = montaje({ id: "columna", nombre: "Columna orgánica de R-12, R-9 y R-5 Fashion Negro, Reflex Dorado y Reflex Plata", pieza: raiz, origen: col.origen }, v(0, 0, -45));
  m.nivel("base", "Base: cuarteto R-12 Fashion Negro", cuarteto(R("R-12", 29, NEGRO), [NEGRO]), v(0, 15.5, 0), 0);
  m.globo("graffiti-grande", "R-12 Metalink Plata Graffiti grande (arriba a la izquierda)", R("R-12", 29, NEGRO), f(330, 370, 6), unitario(v(-0.6, 0.6, 0.5)), GRAFFITI);
  m.globo("dorado-1", "R-12 Reflex Dorado grande (medio)", R("R-12", 27, ORO), f(402, 425, 16), unitario(v(0.2, 0.3, 1)));
  m.globo("dorado-2", "R-12 Reflex Dorado grande (abajo a la derecha)", R("R-12", 27, ORO), f(435, 472, 6), unitario(v(0.8, 0.1, 0.6)));
  m.globo("plateado", "R-12 Reflex Plata grande (abajo a la izquierda)", R("R-12", 26, PLATA), f(352, 478, 10), unitario(v(-0.4, 0.2, 1)));
  racimo(m, "oro-6", "Racimito de 6 R-5 Reflex Dorado", [ORO, ORO, ORO, ORO, ORO, ORO], f(350, 452, 24), 7.5);
  racimo(m, "oro-3", "Racimito de 3 R-5 Reflex Dorado", [ORO, ORO, ORO], f(428, 430, 22), 7.5);
  racimo(m, "plata-arriba", "Racimito de 3 R-5 Reflex Plata (arriba)", [PLATA, PLATA, PLATA], f(385, 382, 20), 8);
  racimo(m, "plata-abajo", "Racimito de 3 R-5 Reflex Plata (abajo)", [PLATA, PLATA, PLATA], f(442, 466, 20), 8);
  const RIZOS: ReadonlyArray<readonly [string, number, number, number, number]> = [
    ["izquierda-arriba", 300, 428, -1, 0.2], ["izquierda-abajo", 302, 485, -1, -0.3], ["derecha-arriba", 452, 362, 1, 0.4], ["derecha-abajo", 455, 420, 1, -0.1],
  ];
  for (const [lado, px, py, sx, sy] of RIZOS) {
    m.deco(`rizo-${lado}`, `Rizo ${lado.replace("-", " ")}: T-260 Fashion Blanco`, rizo({ forma: "tirabuzon", tubito: T("T-260", 4, BLANCO), vueltas: 3, radioInicialCm: 4, radioFinalCm: 6, largoCm: 20, eje: "frente" }), f(px, py, 8), unitario(v(sx, sy, 0.35)));
  }
  m.foil("numero-4", "Metalizado número 4 plata (NUMERO 4 PLATA de la tienda, a ~26\")", metalizadoDeTienda("numero-4-plata", { pulgadas: 26 }), f(318, 282, -6));
  m.foil("numero-0", "Metalizado número 0 plata de ~26\" (genérico: la tienda no lo tiene en plata)", { forma: { tipo: "numero", valor: 0 }, pulgadas: 26, color: "plata" }, f(402, 320, 2));
  helio(m, "cintas", "Ramo de helio: cintas blancas", [
    { id: "helio-cobre-arriba", nombre: "R-12 «Diamantes Cobre» blanco de helio (arriba)", globo: R("R-12", 28, BLANCO), centro: f(381, 50, -6), impresoId: COBRE },
    { id: "helio-hbd-1", nombre: "R-12 «Happy Birthday Diamante» negro de helio (izquierda)", globo: R("R-12", 28, NEGRO), centro: f(372, 118, 2), impresoId: HBD },
    { id: "helio-dorado-1", nombre: "R-12 Reflex Dorado de helio (derecha)", globo: R("R-12", 28, ORO), centro: f(405, 112, -10) },
    { id: "helio-cobre-abajo", nombre: "R-12 «Diamantes Cobre» blanco de helio (abajo)", globo: R("R-12", 28, BLANCO), centro: f(340, 155, 4), impresoId: COBRE },
    { id: "helio-hbd-2", nombre: "R-12 «Happy Birthday Diamante» negro de helio (derecha)", globo: R("R-12", 28, NEGRO), centro: f(412, 165, 6), impresoId: HBD },
    { id: "helio-dorado-2", nombre: "R-12 Reflex Dorado de helio (abajo)", globo: R("R-12", 28, ORO), centro: f(382, 232, 0) },
  ], f(378, 335, -4), SIN_DIBUJO_CINTA);
  return escenaDe(m)(sala(260, 220, 290, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 379 · Columna granja
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por los R-12 de la vaca y de la columna (~60 px ≈ 27 cm): 2,2 px/cm, piso en
 * y = 555 px, eje en x = 320. La base: cuarteto R-18 verde (~80 px: 37 cm; se ven 3: girado). La columna «alternando
 * tamaños» (lo dice la idea): en cada nivel dos R-12 impresos de granja a los lados y dos R-9 verdes impresos delante y
 * detrás (amarillo a 54 cm, rojo a 86, azul a 115 y naranja a 139), y entre nivel y nivel un cuarteto R-9 verde liso
 * (se ven 2). Encima, la vaca echada de 9 R-12 con manchas negras (la cabeza con la boca rosada y las orejas negras, el
 * cuello, el lomo, el anca y las cuatro patas) y la cola de T-260 blanco que sube y cae con su mechón negro, hasta
 * ~2,45 m. En la base, 3 flores de tubito (roja con tallo amarillo, azul con tallo rojo y amarilla; la idea habla de
 * flores, la foto deja ver 3), dos lazos de T-260 verde oscuro y tres de verde lima. Medidos: verde #73c775–#84c875 →
 * Fashion Verde Lima 031 (ΔE 13–15); azul #2fbbec → Fashion Azul 040 (ΔE 4); amarillo #d9be07 → Amarillo Miel 021
 * (ΔE 10); naranja #fd6304 → Fashion Naranja 061 (ΔE 13); rojo 015; lazos #06684a → Verde Selva 032 (ΔE 16).
 */
const escena379 = (): Escena => {
  const VERDE = "031", AZUL = "040", ROJO = "015", AMARILLO = "021", NARANJA = "061", BLANCO = "005", NEGRO = "080", SELVA = "032", ROSADO = "009";
  const f = foto(320, 555, 2.2);
  const POLKA_ROJO = "infinity-polka-blanco-fashion-rojo";
  const BLANCOS = lunares("#ffffff", 7);
  const m = montaje({ id: "base", nombre: "Granja: base de cuarteto R-18 Fashion Verde Lima", pieza: cuarteto(R("R-18", 37, VERDE), [VERDE]), origen: v(0, 19.5, 0), giroGrados: 45 }, v(0, 0, 0));
  const NIVELES: ReadonlyArray<readonly [string, string, number]> = [["amarillo", AMARILLO, 54.5], ["rojo", ROJO, 86.4], ["azul", AZUL, 115], ["naranja", NARANJA, 138.6]];
  for (const [nombre, codigo, y] of NIVELES) {
    for (const [lado, s] of [["izquierda", -1], ["derecha", 1]] as const) {
      const c = v(s * 19, y, -2);
      if (codigo === ROJO) m.globo(`${nombre}-${lado}`, `Nivel ${nombre}: R-12 Polka Blanco rojo (${lado}; el impreso de la tienda más parecido al de granja)`, R("R-12", 28, ROJO), c, haciaFuera(s * 90, 8), POLKA_ROJO);
      else m.centrado(`${nombre}-${lado}`, `Nivel ${nombre}: R-12 ${nombreDe(codigo)} con lunares blancos dibujados (${lado})`, globoDibujado(R("R-12", 28, codigo), BLANCOS, "a farm-print balloon with white spots"), c);
    }
    m.centrado(`${nombre}-delante`, `Nivel ${nombre}: R-9 Fashion Verde Lima con lunares blancos dibujados (delante)`, globoDibujado(R("R-9", 20, VERDE), BLANCOS, "a green farm-print balloon"), v(0, y, 13));
    m.globo(`${nombre}-detras`, `Nivel ${nombre}: R-9 Fashion Verde Lima (detrás)`, R("R-9", 20, VERDE), v(0, y, -15), haciaFuera(180, 8));
  }
  for (const [k, y] of [70.5, 100.7, 126.8].entries()) m.nivel(`verde-${k + 1}`, `Cuarteto R-9 Fashion Verde Lima entre niveles ${k + 1}`, cuarteto(R("R-9", 18, VERDE), [VERDE]), v(0, y, 0), 0);
  // La vaca: 9 R-12 blancos con manchas negras dibujadas.
  const MANCHAS = lunares("#141414", 6);
  const VACA: ReadonlyArray<readonly [string, number, number, number, number]> = [
    ["cabeza", 288, 82, 8, 26], ["cuello", 300, 122, 2, 26], ["lomo-izquierdo", 270, 165, 0, 28], ["lomo-derecho", 335, 170, 0, 27], ["anca", 315, 205, 6, 24],
    ["pata-izquierda-1", 250, 222, 12, 23], ["pata-izquierda-2", 230, 256, 10, 22], ["pata-derecha-1", 362, 212, 10, 23], ["pata-derecha-2", 398, 214, 6, 23],
  ];
  for (const [parte, px, py, z, d] of VACA) m.centrado(`vaca-${parte}`, `Vaca: ${parte.replace(/-/g, " ")}, R-12 Fashion Blanco con manchas negras dibujadas`, globoDibujado(R("R-12", d, BLANCO), MANCHAS, "a white cow-print balloon"), f(px, py, z));
  const cabeza = f(288, 82, 8);
  m.trazo("vaca-boca", "Vaca: boca de T-260 Fashion Rosado", T("T-260", 2.5, ROSADO), [{ tipo: "linea", puntos: elipse(7, 3) }], sobreEsfera(cabeza, 13, f(288, 88), 1.5), "a pink twisted-balloon cow mouth");
  m.globo("vaca-oreja-izquierda", "Vaca: oreja izquierda, R-9 Fashion Negro", R("R-9", 12, NEGRO), f(252, 32, 4), unitario(v(-1, 0.3, 0.2)));
  m.globo("vaca-oreja-derecha", "Vaca: oreja derecha, R-9 Fashion Negro", R("R-9", 12, NEGRO), f(328, 26, 4), unitario(v(1, 0.3, 0.2)));
  const cola = relativo(2.2, 405, 195)([[405, 195], [418, 158], [440, 132], [478, 124], [515, 140], [545, 160]]);
  m.trazo("vaca-cola", "Vaca: cola de T-260 Fashion Blanco", T("T-260", 4, BLANCO), [{ tipo: "linea", puntos: cola }], f(405, 195, -4), "a white twisted-balloon cow tail");
  m.deco("vaca-mechon", "Vaca: mechón de la cola, flecos de T-160 Fashion Negro", rizo({ forma: "flecos", formatoId: "T-160", grosorCm: 1.2, codigos: [NEGRO], tiras: 5, anchoCm: 4, largoCm: 18, ondas: 1.5, amplitudCm: 1.5, disparejo: 0.3 }), f(548, 165, -4), AL_FRENTE);
  // Las flores y los lazos de la base.
  m.deco("flor-roja", "Flor roja de 4 pétalos de T-260 Fashion Rojo con centro R-5 Amarillo Miel", florBurbuja("T-260", 3, ROJO, 4, 5, R("R-5", 5.5, AMARILLO)), f(183, 440, 22), AL_FRENTE);
  m.trazo("tallo-amarillo", "Tallo de la flor roja: T-260 Fashion Amarillo", T("T-260", 3, "020"), [{ tipo: "linea", puntos: relativo(2.2, 198, 446)([[198, 446], [222, 457], [246, 469]]) }], f(198, 446, 18), "a yellow twisted-balloon flower stem");
  m.deco("flor-azul", "Flor azul de 4 pétalos de T-260 Fashion Azul con centro R-5 Fashion Rojo", florBurbuja("T-260", 3, AZUL, 4, 5, R("R-5", 5.5, ROJO)), f(428, 443, 22), AL_FRENTE);
  m.trazo("tallo-rojo", "Tallo de la flor azul: T-260 Fashion Rojo", T("T-260", 3, ROJO), [{ tipo: "linea", puntos: relativo(2.2, 368, 449)([[368, 449], [392, 444], [418, 443]]) }], f(368, 449, 20), "a red twisted-balloon flower stem");
  m.deco("flor-amarilla", "Flor amarilla de 4 pétalos de T-260 Amarillo Miel con centro R-5 Fashion Naranja", florBurbuja("T-260", 3, AMARILLO, 4, 5, R("R-5", 5.5, NARANJA)), f(416, 384, 16), AL_FRENTE);
  m.trazo("lazo-selva-1", "Lazo de T-260 Fashion Verde Selva (izquierda)", T("T-260", 3.5, SELVA), [{ tipo: "linea", puntos: elipse(6, 9) }], f(273, 432, 22), "a dark green twisted-balloon loop");
  m.trazo("lazo-selva-2", "Lazo de T-260 Fashion Verde Selva (derecha)", T("T-260", 3.5, SELVA), [{ tipo: "linea", puntos: elipse(9, 4) }], f(352, 468, 22), "a dark green twisted-balloon loop");
  for (const [k, [px, py, r]] of ([[262, 480, 6], [312, 490, 5], [420, 486, 6]] as const).entries()) {
    m.trazo(`lazo-lima-${k + 1}`, `Lazo de T-260 Fashion Verde Lima ${k + 1}`, T("T-260", 3, VERDE), [{ tipo: "linea", puntos: elipse(r, r) }], f(px, py, 24), "a lime green twisted-balloon curl");
  }
  return escenaDe(m)(sala(260, 220, 280, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 384 · Columna Hello Kitty
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570, pequeña y desenfocada. Escala por los R-12 impresos (~80 px ≈ 28 cm): 2,86 px/cm, piso en
 * y = 557 px, eje en x = 370. De abajo arriba, tres niveles de un cuarteto R-12 impreso de corazones y moños blancos
 * (se ven 2: hueco al frente) con un cuarteto R-9 liso del mismo color encima (se ve 1 delante: girado): lila (centros
 * a 14 y 36 cm), fucsia (50 y 71 cm) y rosado (84 y 104 cm; el R-9 de arriba deja ver 3). Encima Hello Kitty de globos:
 * piernas de T-260 blanco, tutú de un aro de T-260 rosado, cuerpo de 4 T-260 rosados en vertical con las mangas
 * abullonadas, brazos de T-260 blanco, la cabeza R-12 blanca (~75 px: 26 cm) con ojos, nariz amarilla y bigotes
 * impresos, las orejas de R-5 y el moño de lazos de T-260 rosado, hasta ~1,9 m. Medidos: lila #c490c8–#cda3d3 →
 * Fashion Lila 050 (ΔE 8–11); fucsia #ff59a5 → Fashion Fucsia 012 (ΔE 14; el Neón 212 no está en el surtido del
 * impreso); rosado #ffc7df → Fashion Rosado 009 (ΔE 7). El impreso de Hello Kitty no está en la tienda: el más
 * parecido es «Corazones Modernos» (corazones blancos) en el fucsia y el rosado de su surtido; el lila no está en ese
 * surtido y va liso.
 */
const escena384 = (): Escena => {
  const LILA = "050", FUCSIA = "012", ROSADO = "009", BLANCO = "005";
  const CORAZONES = "infinity-corazones-modernos-fashion-surtido";
  const f = foto(370, 557, 2.86);
  const m = montaje({ id: "lila", nombre: "Hello Kitty: cuarteto R-12 Fashion Lila (base)", pieza: cuarteto(R("R-12", 28, LILA), [LILA]), origen: v(0, 14, 0) }, v(0, 0, 0));
  m.nivel("lila-chico", "Cuarteto R-9 Fashion Lila", cuarteto(R("R-9", 17, LILA), [LILA]), v(0, 35.7, 0), 45);
  m.nivel("fucsia", "Cuarteto R-12 Corazones Modernos fucsia", cuarteto(R("R-12", 28, FUCSIA), [FUCSIA], "un_color", [{ impresoId: CORAZONES, codigo: FUCSIA }]), v(0, 49.7, 0), 0);
  m.nivel("fucsia-chico", "Cuarteto R-9 Fashion Fucsia", cuarteto(R("R-9", 17, FUCSIA), [FUCSIA]), v(0, 70.6, 0), 45);
  m.nivel("rosado", "Cuarteto R-12 Corazones Modernos rosado", cuarteto(R("R-12", 28, ROSADO), [ROSADO], "un_color", [{ impresoId: CORAZONES, codigo: ROSADO }]), v(0, 83.6, 0), 0);
  m.nivel("rosado-chico", "Cuarteto R-9 Fashion Rosado", cuarteto(R("R-9", 17, ROSADO), [ROSADO]), v(0, 104.5, 0), 45);
  const tubo = (id: string, nombre: string, t: ParteTubito, lista: ReadonlyArray<readonly [number, number]>, z: number, queEs: string) => {
    const [x0, y0] = lista[0]!;
    m.trazo(id, nombre, t, [{ tipo: "linea", puntos: relativo(2.86, x0, y0)(lista) }], f(x0, y0, z), queEs);
  };
  tubo("pierna-izquierda", "Pierna izquierda: T-260 Fashion Blanco", T("T-260", 3.5, BLANCO), [[360, 186], [356, 210], [352, 232]], 0, "a white twisted-balloon leg");
  tubo("pierna-derecha", "Pierna derecha: T-260 Fashion Blanco", T("T-260", 3.5, BLANCO), [[382, 186], [386, 210], [390, 232]], 0, "a white twisted-balloon leg");
  m.dePie("tutu", "Tutú: aro de T-260 Fashion Rosado", figura({ accesorios: [{ en: "base", forma: { tipo: "aro", tubito: T("T-260", 4, ROSADO), radioCm: 12, plano: "horizontal", desdeGrados: 0, hastaGrados: 360 } }], queEs: "a pink twisted-balloon tutu ring" }), f(370, 180, 0));
  for (const [k, px] of [344, 358, 372, 386].entries()) tubo(`cuerpo-${k + 1}`, `Cuerpo: T-260 Fashion Rosado ${k + 1}`, T("T-260", 3.8, ROSADO), [[px, 172], [px + (px < 365 ? 2 : -2), 150], [px, 128]], 2, "a pink twisted-balloon dress stripe");
  for (const [lado, px] of [["izquierda", 342], ["derecha", 400]] as const) m.trazo(`manga-${lado}`, `Manga ${lado}: lazo de T-260 Fashion Rosado`, T("T-260", 3, ROSADO), [{ tipo: "linea", puntos: elipse(4, 3, 10) }], f(px, 140, 3), "a pink twisted-balloon puffed sleeve");
  tubo("brazo-izquierdo", "Brazo izquierdo: T-260 Fashion Blanco", T("T-260", 3.5, BLANCO), [[338, 146], [318, 158], [298, 172]], 0, "a white twisted-balloon arm");
  tubo("brazo-derecho", "Brazo derecho: T-260 Fashion Blanco", T("T-260", 3.5, BLANCO), [[402, 146], [422, 156], [445, 168]], 0, "a white twisted-balloon arm");
  const cabeza = f(368, 64, 0);
  m.conCara("cabeza", "Cabeza: R-12 Fashion Blanco con ojos, nariz amarilla y bigotes", R("R-12", 26, BLANCO), cabeza, { ...SIN_CARA, ojos: { estilo: "puntos", hex: CARA_NEGRA }, nariz: { estilo: "punto", hex: "#f2c200" }, bigote: { estilo: "gato", hex: CARA_NEGRA } }, "a white Hello Kitty face balloon");
  m.globo("oreja-izquierda", "Oreja izquierda: R-5 Fashion Blanco", R("R-5", 9, BLANCO), f(338, 30, -2), unitario(v(-0.6, 1, 0)));
  m.globo("oreja-derecha", "Oreja derecha: R-5 Fashion Blanco", R("R-5", 9, BLANCO), f(398, 28, -2), unitario(v(0.6, 1, 0)));
  const mono: PropiedadesMono = { formatoId: "T-260", grosorCm: 3, codigo: ROSADO, lazosPorLado: 1, largoLazoCm: 9, anchoLazoCm: 7, aberturaGrados: 30, colas: false, largoColaCm: 0, centro: R("R-5", 5.5, ROSADO) };
  m.deco("mono", "Moño de lazos de T-260 Fashion Rosado", { tipo: "mono", propiedades: mono }, sobreEsfera(cabeza, 13, f(420, 46), 1), AL_FRENTE, 70);
  return escenaDe(m)(sala(220, 200, 230, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 386 · Columna Lady Bug y 391 · Columna mariquita (la misma foto)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (la misma en las dos ideas). Escala por los R-12 de la columna (~60 px ≈ 28 cm): 2,14 px/cm, piso en
 * y = 555 px, eje en x = 370. La columna espiral de 7 cuartetos R-12 (de 525 a 245 px, ~1,5 m) con dos blancos, uno
 * negro y uno rojo de lunares blancos (el Polka Blanco rojo de la tienda) por cuarteto. Tres mariquitas pegadas: arriba
 * a la izquierda una de cuerpo rojo de lunares con la cabeza R-9 blanca y dos antenas de T-260 negro; en el medio la
 * carita roja de lunares de frente con dos ojos saltones (R-5 blanco con pupila), la nariz R-5 roja y sus antenas; y a
 * la derecha el cuerpo rojo de lunares de otra con su cabecita blanca y la antena. Arriba el ramo de 4 R-12 de helio
 * contados (rojo de lunares, negro de lunares blancos, negro y rojo), hasta ~2,5 m. Medidos: blanco #e8ebf8 → Fashion
 * Blanco 005 (ΔE 10, sombreado); negro 080; rojo 015. Los lunares blancos sobre negro no están en la tienda: van
 * dibujados en un R-12 negro liso.
 */
const escenaMariquitas = (titulo: string) => (): Escena => {
  const BLANCO = "005", NEGRO = "080", ROJO = "015";
  const POLKA = "infinity-polka-blanco-fashion-rojo";
  const f = foto(370, 555, 2.14);
  const col: Pieza = { ...columna(R("R-12", 28, BLANCO), 7, [BLANCO, NEGRO, BLANCO, ROJO], "espiral"), impresos: [{ impresoId: POLKA, codigo: ROJO }] };
  const m = montaje({ id: "columna", nombre: `${titulo}: espiral de 7 cuartetos R-12 blancos, negros y rojos de lunares`, pieza: col, origen: v(0, 14, 0) }, v(0, 0, 0));
  const antena = (id: string, nombre: string, lista: ReadonlyArray<readonly [number, number]>, z: number) => {
    const [x0, y0] = lista[0]!;
    m.trazo(id, nombre, T("T-260", 2.5, NEGRO), [{ tipo: "linea", puntos: relativo(2.14, x0, y0)(lista) }], f(x0, y0, z), "a black twisted-balloon antenna");
  };
  // Mariquita de arriba a la izquierda.
  m.globo("mariquita-1-cuerpo", "Mariquita 1: cuerpo R-12 Polka Blanco rojo", R("R-12", 27, ROJO), f(330, 250, 16), unitario(v(0.5, 0.4, 0.7)), POLKA);
  m.conCara("mariquita-1-cabeza", "Mariquita 1: cabeza R-9 Fashion Blanco con ojos", R("R-9", 13, BLANCO), f(298, 252, 22), { ...SIN_CARA, ojos: { estilo: "puntos", hex: CARA_NEGRA } }, "a white ladybug head balloon");
  antena("mariquita-1-antena-1", "Mariquita 1: antena de T-260 Fashion Negro 1", [[305, 242], [306, 226], [310, 214]], 24);
  antena("mariquita-1-antena-2", "Mariquita 1: antena de T-260 Fashion Negro 2", [[312, 242], [318, 228], [325, 216]], 24);
  // La carita del medio.
  const cara = f(356, 352, 18);
  m.globo("mariquita-2-cara", "Mariquita 2: carita R-12 Polka Blanco rojo", R("R-12", 26, ROJO), cara, AL_FRENTE, POLKA);
  const SALTON: EstiloOjo = { iris: null, pupila: { hex: CARA_NEGRA, proporcion: 0.5 }, brillo: true, venas: null };
  for (const [lado, px] of [["izquierdo", 340], ["derecho", 377]] as const) {
    m.centrado(`mariquita-2-ojo-${lado}`, `Mariquita 2: ojo ${lado}, R-5 Fashion Blanco con pupila`, { tipo: "ojo", propiedades: { globo: R("R-5", 8, BLANCO), estilo: SALTON, miradaGrados: 270 } }, sobreEsfera(cara, 13, f(px, 356), 2));
  }
  m.globo("mariquita-2-nariz", "Mariquita 2: nariz R-5 Fashion Rojo", R("R-5", 6, ROJO), sobreEsfera(cara, 13, f(358, 368), 2), AL_FRENTE);
  antena("mariquita-2-antena-1", "Mariquita 2: antena de T-260 Fashion Negro 1", [[345, 336], [336, 330], [326, 328]], 26);
  antena("mariquita-2-antena-2", "Mariquita 2: antena de T-260 Fashion Negro 2", [[366, 334], [370, 322], [374, 312]], 26);
  // La de la derecha.
  m.globo("mariquita-3-cuerpo", "Mariquita 3: cuerpo R-12 Polka Blanco rojo", R("R-12", 26, ROJO), f(396, 398, 14), unitario(v(0.6, -0.2, 0.7)), POLKA);
  m.conCara("mariquita-3-cabeza", "Mariquita 3: cabeza R-9 Fashion Blanco con ojos", R("R-9", 11, BLANCO), f(440, 416, 14), { ...SIN_CARA, ojos: { estilo: "puntos", hex: CARA_NEGRA } }, "a white ladybug head balloon");
  antena("mariquita-3-antena", "Mariquita 3: antena de T-260 Fashion Negro", [[438, 408], [440, 396], [445, 388]], 16);
  helio(m, "cintas", "Ramo de helio: cintas blancas", [
    { id: "helio-polka", nombre: "R-12 Polka Blanco rojo de helio (arriba)", globo: R("R-12", 28, ROJO), centro: f(378, 55, -4), impresoId: POLKA },
    { id: "helio-negro-lunares", nombre: "R-12 Fashion Negro con lunares blancos dibujados de helio", globo: R("R-12", 28, NEGRO), centro: f(408, 130, -8), dibujo: lunares("#ffffff", 9) },
    { id: "helio-negro", nombre: "R-12 Fashion Negro de helio", globo: R("R-12", 26, NEGRO), centro: f(345, 140, -14) },
    { id: "helio-rojo", nombre: "R-12 Fashion Rojo de helio", globo: R("R-12", 27, ROJO), centro: f(365, 160, 4) },
  ], f(378, 232, 0), SIN_DIBUJO_CINTA);
  return escenaDe(m)(sala(220, 200, 280, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 387 · Columna Love
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por los corazones «LOVE» (C-12, ~125 px de ancho ≈ 30 cm): 4,2 px/cm, que
 * da el T-260 de las letras de ~14 px (3,3 cm) y los pétalos blancos de ~35 px (R-5 a 8 cm); piso en y = 545 px, eje
 * en x = 345. La base: cuarteto R-9 rojo (~68 px: 16 cm; se ven 2) y encima un cuarteto R-5 blanco (~21 cm de ancho).
 * Sobre la base, «LOVE» de T-260: la L blanca, la O un corazoncito rojo, la V roja y la E blanca; el tallo de T-160
 * rojo retorcido en burbujas sube ~35 cm hasta la flor: 5 corazones C-12 «LOVE» (contados: arriba, dos a cada lado)
 * alrededor de una flor de 6 R-5 blancos con el centro R-5 rojo, hasta ~1,26 m. Medidos: rojo #e6021c → Fashion Rojo
 * 015 (ΔE 9); blanco 005. El corazón es el «CORAZON 2 CARAS LOVE» rojo de la tienda (el mismo dibujo).
 */
const escena387 = (): Escena => {
  const ROJO = "015", BLANCO = "005";
  const LOVE = "corazon-2-caras-love-fashion-rojo";
  const K = 4.2;
  const f = foto(345, 545, K);
  const m = montaje({ id: "base", nombre: "Love: base de cuarteto R-9 Fashion Rojo", pieza: cuarteto(R("R-9", 16.5, ROJO), [ROJO]), origen: v(0, 8.3, 0) }, v(0, 0, 0));
  m.nivel("base-blanca", "Cuarteto R-5 Fashion Blanco sobre la base", cuarteto(R("R-5", 9.5, BLANCO), [BLANCO]), v(0, 20.5, 0), 45);
  const tubo = (id: string, nombre: string, t: ParteTubito, lista: ReadonlyArray<readonly [number, number]>, z: number, queEs: string) => {
    const [x0, y0] = lista[0]!;
    m.trazo(id, nombre, t, [{ tipo: "linea", puntos: relativo(K, x0, y0)(lista) }], f(x0, y0, z), queEs);
  };
  const T260 = (c: string) => T("T-260", 3.3, c);
  tubo("letra-l", "Letra L: T-260 Fashion Blanco", T260(BLANCO), [[301, 340], [301, 368], [301, 396], [325, 395], [347, 393]], 6, "a white twisted-balloon letter L");
  m.globo("letra-o", "Letra O: corazón C-12 Fashion Rojo", R("C-12", 12.5, ROJO), f(341, 357, 8), AL_FRENTE);
  tubo("letra-v", "Letra V: T-260 Fashion Rojo", T260(ROJO), [[300, 398], [311, 422], [322, 446], [333, 421], [345, 396]], 8, "a red twisted-balloon letter V");
  tubo("letra-e", "Letra E: T-260 Fashion Blanco", T260(BLANCO), [[382, 387], [361, 389], [342, 391], [342, 418], [342, 446], [362, 444], [385, 441]], 4, "a white twisted-balloon letter E");
  tubo("letra-e-medio", "Letra E (palo del medio): T-260 Fashion Blanco", T260(BLANCO), [[342, 418], [360, 419], [376, 420]], 5, "a white twisted-balloon letter E bar");
  // El tallo: T-160 rojo retorcido en burbujas, de la base de las letras a la flor.
  const tallo: Array<readonly [number, number]> = Array.from({ length: 13 }, (_, k): readonly [number, number] => [343 + (k % 2 ? 4 : -4), 345 - k * 11.5]);
  tubo("tallo", "Tallo: T-160 Fashion Rojo retorcido en burbujas", T("T-160", 2.2, ROJO), tallo, 0, "a red twisted-balloon stem");
  const centro = f(345, 160, 2);
  const flor: PropiedadesFlor = { petalos: { formatoId: "R-5", infladoCm: 10, codigo: BLANCO, cantidad: 6, aperturaGrados: 10, giroGrados: 0 }, centro: { formatoId: "R-5", infladoCm: 7.5, codigo: ROJO, cantidad: 1 } };
  m.deco("flor", "Flor de 6 R-5 Fashion Blanco con centro R-5 Fashion Rojo", { tipo: "flor", propiedades: flor }, centro, AL_FRENTE);
  const CORAZONES: ReadonlyArray<readonly [string, number, number]> = [["arriba", 348, 65], ["derecha-arriba", 450, 150], ["derecha-abajo", 420, 245], ["izquierda-abajo", 270, 245], ["izquierda-arriba", 245, 150]];
  for (const [lado, px, py] of CORAZONES) {
    const c = f(px, py, -3);
    m.globo(`corazon-${lado}`, `Pétalo ${lado.replace("-", " ")}: corazón C-12 «LOVE» rojo`, R("C-12", 30, ROJO), c, unitario(v(c.x - centro.x, c.y - centro.y, 0)), LOVE);
  }
  return escenaDe(m)(sala(200, 200, 200, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 388 · Columna Marimonda
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por los R-12 del cuerpo (~75 px ≈ 26 cm): 2,9 px/cm, piso en y = 565 px, eje
 * en x = 360. El cuerpo: columna espiral de 6 cuartetos R-12 fucsia, amarillo, verde lima y naranja (de 565 a 205 px),
 * el cuello de un cuarteto R-5 de los mismos colores y la cabeza R-24 azul (~177 px: 61 cm, centro a 157 cm). La cara
 * de la Marimonda: los ojos de dos lazos de T-260 verde en «∞» con la pupila negra, la trompa de T-260 verde que baja
 * de entre los ojos hasta el pecho (~52 cm), los labios de T-260 neón fucsia y las orejas de T-260 naranja que salen de
 * lo alto de la cabeza, se abren en arco y vuelven a los hombros, hasta ~1,9 m. Colores: los publicados (Fucsia 012,
 * Amarillo 020, Verde Lima 031, Naranja 061, Neón Azul 240; T-260 Fashion Verde 030, Neón Fucsia 212, Fashion Naranja
 * 061); la cabeza mide #00b5e4, más cerca del Fashion Azul 040 (ΔE 4,5) que del Neón Azul publicado (ΔE 18): va el
 * publicado. Las pupilas negras no están publicadas: R-5 Fashion Negro.
 */
const escena388 = (): Escena => {
  const FUCSIA = "012", AMARILLO = "020", LIMA = "031", NARANJA = "061", AZUL = "240", VERDE = "030", NEON_FUCSIA = "212", NEGRO = "080";
  const K = 2.9;
  const f = foto(360, 565, K);
  const cuerpo = columna(R("R-12", 26, FUCSIA), 6, [FUCSIA, NARANJA, LIMA, AMARILLO], "espiral");
  const m = montaje({ id: "cuerpo", nombre: "Marimonda: cuerpo de 6 cuartetos R-12 en espiral fucsia, amarillo, verde lima y naranja", pieza: cuerpo, origen: v(0, 13, 0) }, v(0, 0, 0));
  m.nivel("cuello", "Cuello: cuarteto R-5 fucsia, amarillo, verde lima y naranja", cuarteto(R("R-5", 11, FUCSIA), [FUCSIA, AMARILLO, LIMA, NARANJA], "espiral"), v(0, 127, 0), 270);
  const cabeza = f(362, 110, 0);
  const RADIO = 30.5;
  m.globo("cabeza", "Cabeza: R-24 Neón Azul", R("R-24", 61, AZUL), cabeza);
  const tubo = (id: string, nombre: string, t: ParteTubito, lista: ReadonlyArray<readonly [number, number]>, origen: Vec3, queEs: string) =>
    m.trazo(id, nombre, t, [{ tipo: "linea", puntos: relativo(K, lista[0]![0], lista[0]![1])(lista) }], origen, queEs);
  for (const [lado, px] of [["izquierdo", 330], ["derecho", 392]] as const) {
    m.trazo(`ojo-${lado}`, `Ojo ${lado}: lazo de T-260 Fashion Verde`, T("T-260", 3.5, VERDE), [{ tipo: "linea", puntos: elipse(10, 7) }], sobreEsfera(cabeza, RADIO, f(px, 78), 1.5), "a green twisted-balloon eye loop");
    m.globo(`pupila-${lado}`, `Pupila ${lado}: R-5 Fashion Negro`, R("R-5", 9, NEGRO), sobreEsfera(cabeza, RADIO, f(px - 3, 79), 0), AL_FRENTE);
  }
  const nariz = [[362, 90], [362, 130], [363, 170], [364, 205], [365, 235]] as const;
  tubo("trompa", "Trompa: T-260 Fashion Verde", T("T-260", 3.5, VERDE), nariz, sobreEsfera(cabeza, RADIO, f(362, 90), 3), "a long green twisted-balloon trunk nose");
  m.trazo("labio-arriba", "Labio de arriba: T-260 Neón Fucsia", T("T-260", 3.5, NEON_FUCSIA), [{ tipo: "linea", puntos: elipse(9, 3) }], sobreEsfera(cabeza, RADIO, f(358, 148), 4), "a neon pink twisted-balloon upper lip");
  m.trazo("labio-abajo", "Labio de abajo: T-260 Neón Fucsia", T("T-260", 3.5, NEON_FUCSIA), [{ tipo: "linea", puntos: elipse(9, 3) }], sobreEsfera(cabeza, RADIO, f(358, 163), 3), "a neon pink twisted-balloon lower lip");
  tubo("oreja-izquierda", "Oreja izquierda: T-260 Fashion Naranja", T("T-260", 4.5, NARANJA), [[300, 28], [262, 14], [228, 16], [198, 40], [186, 82], [190, 118], [212, 152], [246, 172], [280, 185]], f(300, 28, -6), "an orange twisted-balloon ear arc");
  tubo("oreja-derecha", "Oreja derecha: T-260 Fashion Naranja", T("T-260", 4.5, NARANJA), [[425, 28], [462, 16], [500, 16], [532, 34], [550, 70], [552, 110], [536, 146], [500, 168], [440, 182]], f(425, 28, -6), "an orange twisted-balloon ear arc");
  return escenaDe(m)(sala(260, 220, 230, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 395 · Columna momia embrujada
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por los R-12 negros de helio (~63 px ≈ 30 cm) y los metalizados redondos de
 * 18" (~75 px): 2 px/cm, piso en y = 555 px, eje en x = 415. La base: un cuarteto R-12 negro acostado (se ven 3) con un
 * R-5 verde en la punta de cada globo y dos R-5 verdes encima, donde pisa la momia. La momia (de ~88 cm, de 455 a
 * 280 px) y la calabaza que sostiene son un metalizado (supershape) en la foto: van como paneles de foil (vendas
 * blancas con rayas verdes, la franja de los ojos amarillos y la calabaza), sin producto. Dos torres de helio contadas:
 * cada una un R-12 negro con un cuarteto R-5 verde encima y un metalizado redondo negro de 18" con la calabaza
 * «Happy Halloween» (centros a 136 y 230 cm, hasta ~2,7 m), con las cintas rojas a la mano de la momia. Medidos: verde
 * de la base #0caa2d → Fashion Verde Trébol 029 (ΔE 4); verde de las torres #5fc061 → Fashion Verde Lima 031
 * (ΔE 14); negro #010101 → 080.
 */
const escena395 = (): Escena => {
  const NEGRO = "080", TREBOL = "029", LIMA = "031";
  const f = foto(415, 555, 2);
  const m = montaje({ id: "base", nombre: "Momia: base de cuarteto R-12 Fashion Negro", pieza: cuarteto(R("R-12", 28, NEGRO), [NEGRO]), origen: v(0, 14, 0), giroGrados: 45 }, v(0, 0, 0));
  for (const [k, a] of [0, 90, 180, 270].entries()) m.globo(`punta-${k + 1}`, `Punta ${k + 1}: R-5 Fashion Verde Trébol`, R("R-5", 9, TREBOL), enAnillo(a, 35, 14), haciaFuera(a, 10));
  m.globo("pie-izquierdo", "Pie izquierdo de la momia: R-5 Fashion Verde Trébol", R("R-5", 9, TREBOL), v(-5, 31, 4), ARRIBA);
  m.globo("pie-derecho", "Pie derecho de la momia: R-5 Fashion Verde Trébol", R("R-5", 9, TREBOL), v(8, 31, 2), ARRIBA);
  // La momia: paneles de foil, con la base (los pies) en (x, 36) y medidas en cm sobre la foto (x a la derecha, y arriba).
  const P = relativo(2, 395, 455);
  const VENDA = "#f2f2f0", RAYA = "#2f9a4c", NEGRO_HEX = "#1b1b1f", AMARILLO_HEX = "#f5d21c", NARANJA_HEX = "#e8781c";
  const momia: ElementoEscenografia[] = [
    panelFoil(P([[318, 452], [332, 404], [356, 392], [362, 420], [345, 455]]), 5, VENDA),
    panelFoil(P([[388, 455], [380, 420], [395, 398], [420, 412], [430, 452]]), 5, VENDA),
    panelFoil(P([[340, 418], [345, 372], [365, 352], [395, 350], [410, 378], [405, 420], [372, 428]]), 6, VENDA),
    panelFoil(P([[350, 372], [400, 368], [402, 382], [352, 388]]), 1, RAYA, undefined, 3.2),
    panelFoil(P([[345, 372], [322, 392], [312, 400], [318, 410], [340, 395], [352, 385]]), 4, VENDA),
    panelFoil(P([[400, 372], [430, 392], [448, 398], [444, 410], [425, 404], [398, 390]]), 4, VENDA),
    panelFoil(mover(ovalo(0, 0, 21, 16), (365 - 395) / 2, (455 - 318) / 2), 6, VENDA),
    panelFoil(mover(ovalo(0, 0, 16, 5), (370 - 395) / 2, (455 - 320) / 2), 1, NEGRO_HEX, undefined, 3.2),
    panelFoil(mover(ovalo(0, 0, 4.5, 4.5), (356 - 395) / 2, (455 - 318) / 2), 1, AMARILLO_HEX, undefined, 3.8),
    panelFoil(mover(ovalo(0, 0, 4.5, 4.5), (384 - 395) / 2, (455 - 318) / 2), 1, AMARILLO_HEX, undefined, 3.8),
    panelFoil(mover(ovalo(0, 0, 15, 14), (450 - 395) / 2, (455 - 368) / 2), 5, NARANJA_HEX, { dibujo: "calabaza", hex: "#3a1d05" }, 2),
  ];
  m.foilPaneles("momia", "Momia con su calabaza: metalizado (supershape) genérico, sin producto", momia, f(395, 455, 2));
  const TORRES: ReadonlyArray<readonly [string, number, number, number, number, number]> = [["izquierda", 285, 228, 182, 138, -6], ["derecha", 350, 152, 108, 72, 4]];
  const cintas: ElementoEscenografia[] = [];
  const mano = f(330, 386, 6);
  for (const [lado, px, pyNegro, pyVerde, pyFoil, z] of TORRES) {
    const negro = f(px, pyNegro, z);
    m.globo(`torre-${lado}-negro`, `Torre ${lado}: R-12 Fashion Negro de helio`, { ...R("R-12", 30, NEGRO), helio: true }, negro, ARRIBA);
    m.nivel(`torre-${lado}-verde`, `Torre ${lado}: cuarteto R-5 Fashion Verde Lima`, cuarteto(R("R-5", 9, LIMA), [LIMA]), f(px - 4, pyVerde, z), 0);
    m.foil(`torre-${lado}-calabaza`, `Torre ${lado}: metalizado redondo negro de 18" con calabaza «Happy Halloween» (genérico)`, { forma: { tipo: "redondo" }, pulgadas: 18, color: "negro_mate", impreso: { dibujo: "calabaza", hex: NARANJA_HEX } }, f(px - 8, pyFoil, z - 2));
    cintas.push(barra(v(0, 0, 0), menos(menos(negro, v(0, centroCuerpo("redondo", 30), 0)), mano), 0.2, "#e05a5a", "papel"));
  }
  m.foilPaneles("cintas", "Cintas rojas de las torres de helio", cintas, mano);
  return escenaDe(m)(sala(240, 220, 300, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 398 · Columna nochebuena
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por el Link-O-Loon 660 rojo (~35 px de grueso ≈ 15 cm): 2,3 px/cm, que da
 * los R-12 rojos de ~55 px (24 cm); piso en y = 545 px, eje en x = 372. Lo dice la idea: «columna de 2 cuartetos y
 * globo de LoL 660 fashion rojo, encima un muñeco de nieve con LoL-12 blanco y R-12 blanco, decóralo con tubitos 160 y
 * 260». De abajo arriba: cuarteto R-12 rojo (se ven 3: girado), cuarteto R-9 verde (16,5 cm), el 660 rojo de pie
 * (~72 cm, de 455 a 290 px) con la espiral de T-260 verde (4 vueltas y media), un cuarteto R-9 verde chico, el cuarteto
 * R-12 rojo de arriba (se ven 2), los pies de un cuarteto R-9 negro y el muñeco: cuerpo LOL-12 blanco con 3 botones,
 * cabeza R-12 blanca con ojos, nariz de zanahoria y sonrisa impresas, bufanda de T-260 rojo, brazos de T-260 negro con
 * dedos y el sombrero de copa negro, hasta ~2,3 m. Medidos: rojo #ca0e0e → Fashion Rojo 015 (ΔE 10); verde de los
 * globos #01706a → Turquesa Profundo 035 (ΔE 25, el más cercano: en la foto es verde azulado); espiral #0c6636 →
 * Verde Selva 032 (ΔE 10); blanco (la idea) 005.
 */
const escena398 = (): Escena => {
  const ROJO = "015", VERDE = "035", SELVA = "032", BLANCO = "005", NEGRO = "080";
  const f = foto(372, 545, 2.3);
  const m = montaje({ id: "base", nombre: "Nochebuena: base de cuarteto R-12 Fashion Rojo", pieza: cuarteto(R("R-12", 24, ROJO), [ROJO]), origen: v(0, 12, 0), giroGrados: 45 }, v(0, 0, 0));
  m.nivel("verde-abajo", "Cuarteto R-9 Fashion Turquesa Profundo (abajo)", cuarteto(R("R-9", 16.5, VERDE), [VERDE]), v(0, 30, 0), 0);
  m.trazo("fuste", "Fuste: Link-O-Loon 660 Fashion Rojo de pie", T("LOL-660", 15, ROJO), [{ tipo: "linea", puntos: [[0, 0], [0, 72]] }], v(0, 38, 0), "a red long link balloon column");
  m.deco("espiral", "Espiral de T-260 Fashion Verde Selva alrededor del 660", rizo({ forma: "resorte", tubito: T("T-260", 3, SELVA), vueltas: 4.5, radioCm: 9, largoCm: 64, eje: "frente" }), v(0, 42, 0), ARRIBA);
  m.nivel("verde-arriba", "Cuarteto R-9 Fashion Turquesa Profundo (arriba)", cuarteto(R("R-9", 13, VERDE), [VERDE]), v(0, 113, 0), 45);
  m.nivel("rojo-arriba", "Cuarteto R-12 Fashion Rojo (arriba)", cuarteto(R("R-12", 24, ROJO), [ROJO]), v(0, 123, 0), 0);
  m.nivel("pies", "Pies del muñeco: cuarteto R-9 Fashion Negro", cuarteto(R("R-9", 15, NEGRO), [NEGRO]), v(0, 140, 0), 45);
  const muneco: PropiedadesFigura = {
    postura: "de_pie", base: [], piernas: null,
    cuerpo: [{ tipo: "globo", globo: R("LOL-12", 30, BLANCO) }],
    cuello: null,
    cabeza: { ...R("R-12", 30, BLANCO), cara: { ...SIN_CARA, ojos: { estilo: "puntos", hex: CARA_NEGRA }, nariz: { estilo: "zanahoria", hex: "#f07a1a" }, boca: { estilo: "sonrisa", hex: CARA_NEGRA } } },
    brazos: { ...T("T-260", 3, NEGRO), burbujasCm: [9, 7], angulosGrados: [15, 45], punta: { tipo: "dedos", cantidad: 3, largoCm: 4, aberturaGrados: 30 } },
    accesorios: [
      { en: "coronilla", corrimientoCm: [3, 0, -1], forma: { tipo: "sombrero", ala: { ...T("T-260", 2.5, NEGRO), estilo: "aro", radioCm: 7 }, copa: { tubito: T("T-260", 4.5, NEGRO), largoCm: 10 }, cinta: null, pompon: null, inclinacionGrados: 15 } },
      { en: "cuello", forma: { tipo: "bufanda", formatoId: "T-260", grosorCm: 3.5, codigos: [ROJO], radioCm: 10 } },
    ] satisfies Accesorio[],
    queEs: "a white balloon snowman with a black top hat and red scarf",
  };
  m.dePie("muneco", "Muñeco de nieve: cuerpo LOL-12 Fashion Blanco, cabeza R-12 Fashion Blanco, brazos, sombrero y bufanda de T-260", { tipo: "figura", propiedades: muneco }, v(0, 147, 0));
  for (const [k, py] of [147, 166, 185].entries()) m.globo(`boton-${k + 1}`, `Botón ${k + 1}: R-5 Fashion Negro`, R("R-5", 5.2, NEGRO), f(362, py, 14), AL_FRENTE);
  return escenaDe(m)(sala(220, 200, 260, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 412 · Columna unicornio
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por los R-12 impresos (~58 px ≈ 26 cm): 2,23 px/cm, piso en y = 565 px, eje
 * en x = 375. De abajo arriba: cuarteto R-12 de cuatro colores con nubes blancas (rosado, fucsia, amarillo y azul
 * caribe; se ven 3: girado, el fucsia delante), cuarteto R-9 blanco (36 cm), el espiral de 7 cuartetos R-9 (de 462 a
 * 318 px; ~70 px de ancho: R-9 a 15 cm) que va de fucsia y amarillo abajo a azul, lila y rosado arriba, cuarteto R-9 blanco (128 cm), el cuarteto R-12 de nubes (143
 * cm), otro R-9 blanco (161 cm) y la cabeza R-18 blanca (~100 px: 45 cm; centro a 190 cm) con los ojos cerrados y las
 * mejillas rosadas impresos, las orejas de lazo de T-260 blanco, la corona de 5 florecitas de T-260 (amarilla, azul,
 * fucsia, verde y lila) y el cuerno de T-260 dorado retorcido (~42 cm), hasta ~2,5 m. Medidos: fucsia #d73077 →
 * Fashion Fucsia 012 (ΔE 8); amarillo #d0bb00 → Amarillo Miel 021 (ΔE 13); azul #039cce → Fashion Azul 040 (ΔE 8);
 * lila #8d63c9–#a589de → Fashion Lila 050 (ΔE 24; el Violeta 051 queda igual de lejos y es más oscuro); rosado
 * #d9a2b5 → Fashion Rosado 009 (ΔE 8); cuerno #d7b44a → Metal Dorado 570 (ΔE 9). Las nubes blancas no están en la
 * tienda: van dibujadas sobre los lisos.
 */
const escena412 = (): Escena => {
  const BLANCO = "005", ROSADO = "009", FUCSIA = "012", AMARILLO = "021", AZUL = "040", CARIBE = "038", LILA = "050", ORO = "570", EUCALIPTO = "027";
  const f = foto(375, 565, 2.23);
  const NUBES = lunares("#ffffff", 8);
  const espiral = (c: string[]): Pieza => columna(R("R-9", 15, c[0]!), 2, c, "dos_colores");
  const m = montaje({ id: "espiral", nombre: "Unicornio: espiral de R-9 Fashion Fucsia y Amarillo Miel (niveles 1 y 2)", pieza: espiral([FUCSIA, AMARILLO]), origen: v(0, 46, 0) }, v(0, 0, 0));
  m.nivel("espiral-2", "Espiral: R-9 Amarillo Miel y Fashion Azul (niveles 3 y 4)", espiral([AMARILLO, AZUL]), v(0, 70, 0), 90);
  m.nivel("espiral-3", "Espiral: R-9 Fashion Azul y Fashion Lila (niveles 5 y 6)", espiral([AZUL, LILA]), v(0, 94, 0), 180);
  m.nivel("espiral-4", "Espiral: R-9 Fashion Lila y Fashion Rosado (nivel 7)", { ...cuarteto(R("R-9", 15, LILA), [LILA, ROSADO], "dos_colores") }, v(0, 118, 0), 270);
  cuartetoDibujado(m, "base", "Base: R-12 con nubes blancas", R("R-12", 26, ROSADO), [AMARILLO, CARIBE, ROSADO, FUCSIA], NUBES, v(0, 18, 0), 45, "a pastel unicorn balloon with white clouds");
  m.nivel("blanco-1", "Cuarteto R-9 Fashion Blanco (abajo)", cuarteto(R("R-9", 20, BLANCO), [BLANCO]), v(0, 35.9, 0), 0);
  m.nivel("blanco-2", "Cuarteto R-9 Fashion Blanco (medio)", cuarteto(R("R-9", 20, BLANCO), [BLANCO]), v(0, 128.5, 0), 0);
  cuartetoDibujado(m, "nubes", "Cuarteto de arriba: R-12 con nubes blancas", R("R-12", 26, ROSADO), [AMARILLO, CARIBE, ROSADO, FUCSIA], NUBES, v(0, 143, 0), 45, "a pastel unicorn balloon with white clouds");
  m.nivel("blanco-3", "Cuarteto R-9 Fashion Blanco (arriba)", cuarteto(R("R-9", 20, BLANCO), [BLANCO]), v(0, 161, 0), 0);
  const cabeza = f(370, 141, 0);
  m.conCara("cabeza", "Cabeza: R-18 Fashion Blanco con ojos cerrados y mejillas", R("R-18", 45, BLANCO), cabeza, { ...SIN_CARA, cejas: { hex: CARA_NEGRA, bravas: false }, mejillas: { hex: "#f4a8c4" } }, "a white unicorn head balloon with closed eyes");
  for (const [lado, px, s] of [["izquierda", 344, -1], ["derecha", 400, 1]] as const) {
    m.trazo(`oreja-${lado}`, `Oreja ${lado}: lazo de T-260 Fashion Blanco`, T("T-260", 3, BLANCO), [{ tipo: "linea", puntos: [[0, 0], [s * -2, 6], [s * 1, 11], [s * 4, 5], [0, 0]] }], sobreEsfera(cabeza, 22.5, f(px, 93), 1), "a white twisted-balloon unicorn ear");
  }
  const CORONA: ReadonlyArray<readonly [number, number, string]> = [[343, 98, AMARILLO], [358, 95, AZUL], [378, 91, FUCSIA], [397, 100, EUCALIPTO], [408, 109, LILA]];
  CORONA.forEach(([px, py, c], k) => m.deco(`flor-${k + 1}`, `Corona: florecita de 5 pétalos de T-260 ${nombreDe(c)}`, florBurbuja("T-260", 2.5, c, 5, 3, null), sobreEsfera(cabeza, 22.5, f(px, py), 2), AL_FRENTE));
  // El cuerno: dos T-260 dorados retorcidos (dos zigzag que se cruzan).
  const vueltas = Array.from({ length: 8 }, (_, k) => k);
  m.trazo("cuerno-1", "Cuerno: T-260 Metal Dorado retorcido 1", T("T-260", 3, ORO), [{ tipo: "linea", puntos: vueltas.map((k): readonly [number, number] => [k % 2 ? 1.6 : -1.6, k * 6]) }], f(376, 88, 0), "a gold twisted-balloon unicorn horn");
  m.trazo("cuerno-2", "Cuerno: T-260 Metal Dorado retorcido 2", T("T-260", 3, ORO), [{ tipo: "linea", puntos: vueltas.map((k): readonly [number, number] => [k % 2 ? -1.6 : 1.6, k * 6]) }], f(376, 88, 1), "a gold twisted-balloon unicorn horn");
  return escenaDe(m)(sala(220, 200, 280, { piso: "#efefef", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 416 · Conejo de Pascua
// ----------------------------------------------------------------------------------------------------------

/** Silueta de conejo de icopor de `alto` (cuerpo, cabeza y dos orejas), con la base en y = 0, corrida `dx` en x. */
function conejo(alto: number, hex: string, dx = 0): ElementoEscenografia[] {
  const k = alto / 100;
  const panel = (puntos: Array<readonly [number, number]>, z: number) => panelPapel(puntos.map(([x, y]): readonly [number, number] => [x * k + dx, y * k]), hex, undefined, z, 3);
  return [
    panel(ovalo(0, 30, 24, 30), 0),
    panel(ovalo(2, 66, 15, 13), 0.5),
    panel(ovalo(-6, 88, 4.5, 16), -0.5),
    panel(ovalo(8, 90, 4.5, 16), -0.5),
    panelPapel(ovalo(8 * k + dx, 90 * k, 2.4 * k, 11 * k), "#f4b4cc", undefined, 2.7, 0.4),
  ];
}

/**
 * Foto de 740×570 de un salón decorado: casi todo es utilería (lo dice la clasificación). Los globos son la cenefa de
 * la viga del techo: 3 hileras de R-12 (~21 px: el salón mide ~9 m de ancho, 0,79 px/cm, y da R-12 de ~27 cm) a lo
 * ancho de la viga, 32 globos por hilera contados de 15 a 640 px, y la vuelta de la derecha hacia el fondo (se ven ~8
 * columnas en escorzo). Lo demás va como escenografía suelta, medido a ojo en la foto: el tapete rosado, la mesa blanca
 * de postres con la torta, el arco rosado con el nombre en lila, las cortinas blancas con sus cenefas lila y verde, las
 * dos mesas redondas, el «1» rosado gigante, los conejos de icopor (dos grandes y tres chicos), las letras amarillas
 * «TALIANA» (~95 cm), las 4 carretillas con flores, los dos platos de huevitos y los dos pompones de papel rosado.
 * Medido: la cenefa #e22854–#ef3e7c → Fashion Frambuesa 014 (ΔE 5–9; el Fucsia 012 queda a 7–10).
 */
const escena416 = (): Escena => {
  const FRAMBUESA = "014";
  const ALTO = 320, FONDO = 700, ANCHO = 900;
  const cenefa = (n: number): Pieza => ({ tipo: "mural", mural: { matriz: { colores: [FRAMBUESA], filas: Array.from({ length: 3 }, () => "a".repeat(n)) }, disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 27 }, chico: null } });
  const caja32 = armarPieza(cenefa(32)).caja;
  const yCenefa = r2(ALTO - caja32.max.y - 1);
  const m = montaje({ id: "cenefa", nombre: "Cenefa de la viga: 3 hileras de 32 R-12 Fashion Frambuesa", pieza: cenefa(32), origen: v(0, yCenefa, 120) }, v(0, 0, 120));
  m.pieza("cenefa-derecha", "Cenefa: vuelta de la derecha hacia el fondo, 3 hileras de 8 R-12 Fashion Frambuesa", cenefa(8), v(r2(caja32.max.x - 14), yCenefa, 0), ARRIBA, GIRO_AMARRE - 90);
  const BLANCO = "#f7f3f5", ROSA = "#f2a9c9", LILA = "#8a55a6", VERDE = "#a8d14a", AMARILLO = "#f4d66a", MADERA = "#b98b5a", ICOPOR = "#fdfbfc";
  const letras: ElementoEscenografia[] = "TALIANA".split("").flatMap((l, k): ElementoEscenografia[] => [
    caja(v(-255 + k * 85, 47.5, 0), v(62, 95, 14), AMARILLO, "madera"),
    { ...caja(v(-255 + k * 85, 47.5, 7.2), v(58, 90, 0.4), AMARILLO, "madera"), motivo: { dibujo: "texto", texto: l, hex: "#d99a1e" } },
  ]);
  const carretilla = (flores: readonly string[]): ElementoEscenografia[] => [
    caja(v(0, 24, 0), v(58, 22, 32), MADERA, "madera"),
    barra(v(-31, 12, 0), v(-28, 12, 0), 12, "#3b2a20", "metal"),
    barra(v(28, 12, 0), v(31, 12, 0), 12, "#3b2a20", "metal"),
    ...flores.map((hex, k) => caja(v(-18 + k * 18, 41, 0), v(22, 16, 30), hex, "tela")),
  ];
  const uno: Array<readonly [number, number]> = [[-10, 0], [22, 0], [22, 165], [2, 165], [-24, 140], [-18, 130], [-10, 136]];
  const dulces = [-20, 0, 20].map((x) => cilindro(v(x, 82, 0), 6, 14, "#f6c9dc", "brillante"));
  const FLORES: ReadonlyArray<readonly [number, readonly string[]]> = [[-300, ["#f1b7d6", "#c9e3a6", "#f6e3a0"]], [-170, ["#e7a7cf", "#f9d7e6", "#b8dca0"]], [170, ["#f6c3dc", "#cfe7a9", "#f1b7d6"]], [300, ["#f9d7e6", "#e7a7cf", "#f6e3a0"]]];
  const HUEVOS = ["#f6a6c9", "#9fd3f2", "#f6e27a", "#c4a3e8"];
  const utileria: NodoEscena[] = [
    suelto("tapete", "Tapete rosado", escenografia([caja(v(0, 0.5, 0), v(640, 1, 300), ROSA, "tela")]), 0, 0, 150),
    suelto("cortinas", "Cortinas blancas con cenefas lila y verde", escenografia([
      ...[-330, -190, 190, 330].map((x) => caja(v(x, 125, 0), v(120, 230, 6), "#fbf2f6", "tela")),
      caja(v(-260, 236, 4), v(260, 22, 8), VERDE, "tela"), caja(v(260, 236, 4), v(260, 22, 8), VERDE, "tela"), caja(v(0, 236, 4), v(220, 22, 8), LILA, "tela"),
    ]), 0, 0, -FONDO / 2 + 8),
    suelto("arco-nombre", "Arco rosado con el nombre «Taliana» en lila", escenografia([
      caja(v(0, 100, 0), v(270, 200, 8), "#f5d7e6", "madera"),
      { ...caja(v(0, 225, 5), v(170, 50, 3), LILA, "madera"), motivo: { dibujo: "texto", texto: "Taliana", hex: "#ffffff" } },
    ]), 0, 0, -FONDO / 2 + 30),
    suelto("mesa", "Mesa blanca de postres con la torta", escenografia([
      caja(v(0, 45, 0), v(300, 90, 70), BLANCO, "madera"),
      cilindro(v(0, 90, 0), 22, 14, "#fbf6d8"), cilindro(v(0, 104, 0), 17, 14, "#c6e5b0"), cilindro(v(0, 118, 0), 12, 16, "#f6e27a"),
      ...[-100, -60, 60, 100].map((x) => cilindro(v(x, 90, 0), 9, 12, "#f3b5cf", "brillante")),
    ]), 0, 0, -230),
    suelto("conejitos-mesa", "Dos conejitos de icopor sobre la mesa", escenografia([...conejo(48, ICOPOR, -45), ...conejo(52, ICOPOR, 45)]), 0, 90, -250),
    suelto("mesa-izquierda", "Mesa redonda de la izquierda con dulces", escenografia([cilindro(v(0, 0, 0), 40, 82, BLANCO, "tela", 44), ...dulces]), -360, 0, -160),
    suelto("mesa-derecha", "Mesa redonda de la derecha con dulces", escenografia([cilindro(v(0, 0, 0), 40, 82, BLANCO, "tela", 44), ...dulces]), 360, 0, -160),
    suelto("conejo-mesa-izquierda", "Conejito de icopor de la mesa izquierda", escenografia(conejo(60, ICOPOR)), -360, 96, -175),
    suelto("numero-1", "Número 1 rosado gigante", escenografia([panelPapel(uno, "#f0a3c6", undefined, -6, 12)]), -175, 0, -60),
    suelto("conejo-izquierdo", "Conejo de icopor grande (izquierda)", escenografia(conejo(165, ICOPOR)), -245, 0, 30),
    suelto("conejo-derecho", "Conejo de icopor grande (derecha)", escenografia(conejo(150, ICOPOR)), 200, 0, 50),
    suelto("letras", "Letras gigantes amarillas «TALIANA»", escenografia(letras), 0, 0, 170),
    ...FLORES.map(([x, flores], k) => suelto(`carretilla-${k + 1}`, `Carretilla con flores ${k + 1}`, escenografia(carretilla(flores)), x, 0, 235)),
    ...[-45, 45].map((x, k) => suelto(`huevitos-${k + 1}`, `Plato de huevitos de Pascua ${k + 1}`, escenografia([cilindro(v(0, 0, 0), 22, 1.5, "#a8d14a"), ...[-10, -3, 4, 11].map((dx, j) => cilindro(v(dx, 1.5, j % 2 ? 4 : -4), 3.5, 6, HUEVOS[j]!, "brillante"))]), x, 0, 255)),
    suelto("pompones", "Pompones de papel rosado colgados (2)", escenografia([panelPapel(roseta(22), "#f3a9c9"), panelPapel(mover(roseta(18), -48, -30), "#f7bcd6")]), 400, 215, 40),
  ];
  return escenaDe(m, utileria)(sala(ANCHO, FONDO, ALTO, { piso: "#e9e3df", paredes: "#f5d9e6" }));
};

// ----------------------------------------------------------------------------------------------------------
// 430 · Corazón orgánico te amo
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco; la misma composición que el «Bouquet te amo» #209). Escala por las letras
 * metalizadas de 16" («A» de ~77 px ≈ 38 cm): 2 px/cm, que da los R-12 de la base de ~57 px (28 cm) y los globitos
 * plateados del corazón de ~25 px (R-5 a 12 cm); piso en y = 548 px, eje en x = 358. La base orgánica (de 190 a 560 px,
 * hasta ~77 cm) de R-12 negros —la mitad con el veteado plateado— y rojos veteados de blanco, con R-9 merlot, 3 globos
 * cristal con confeti rojo y plata, 3 corazoncitos rojos, 5 rizos de T-260 plata y el corazón rojo grande a la
 * izquierda. Encima el corazón de R-5 Reflex Plata en tresbolillo (~125 × 80 cm, de 74 a 154 cm) y las letras
 * metalizadas rojas «AMO» y «TE» con el par de R-5 negros entre ellas y el aro de T-260 negro en la «T». A la derecha el
 * ramo de 6 R-12 de helio contados (rojo «te amo», negro, plata, rojo con corazón blanco, negro veteado y otro rojo con
 * corazón abajo). Colores: los publicados (Metalink Plata Graffiti negro, Graffiti Invierno rojo, T-260 Reflex Plata);
 * lo demás medido: negro #0d0304 → 080; rojo 015; merlot #561415 → Fashion Merlot 018 (ΔE 15); plata 981.
 */
const escena430 = (): Escena => {
  const NEGRO = "080", ROJO = "015", MERLOT = "018", PLATA = "981", CRISTAL = "390";
  const GRAFFITI = "infinity-metalink-plata-graffiti-fashion-negro", INVIERNO = "infinity-graffiti-invierno-fashion-rojo", LOVE = "infinity-love-fashion-surtido";
  const f = foto(358, 548, 2);
  const base = organico([
    { id: "base", nombre: "Base", irregularidad: 0.2, puntos: [v(-72, 28, 0), v(-30, 32, 0), v(10, 34, 0), v(50, 32, 0), v(95, 28, 0)], grosor: grosor(30, 28), mezcla: mezcla({ "R-12": 0.72, "R-9": 0.18, "R-5": 0.1 }) },
    { id: "lomo", nombre: "Lomo", irregularidad: 0.2, puntos: [v(-25, 58, -8), v(30, 60, -8)], grosor: grosor(20, 18), mezcla: mezcla({ "R-12": 0.6, "R-9": 0.4 }) },
  ], { colores: [color(NEGRO, 0.55, ["R-12"]), color(ROJO, 0.21, ["R-12"]), color(MERLOT, 0.24, ["R-9", "R-5"])], semilla: 430, relleno: RELLENO_12_9 });
  const raiz: Pieza = { ...base.pieza, impresos: [{ impresoId: GRAFFITI, codigo: NEGRO, cada: 2 }, { impresoId: INVIERNO, codigo: ROJO }] };
  const m = montaje({ id: "base", nombre: "Te amo: base orgánica de R-12 negros y rojos veteados con R-9 merlot", pieza: raiz, origen: base.origen }, v(10, 0, -60));
  const corazon: Pieza = { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 125, altoCm: 80 }, tecnica: { tipo: "celdas", formatoId: "R-5", infladoCm: 12, celda: "tresbolillo" }, colores: { codigos: [PLATA], patron: "un_color" } } };
  m.pieza("corazon", "Corazón de R-5 Reflex Plata en tresbolillo", corazon, v(0, 74, -6), ARRIBA, GIRO_AMARRE);
  m.foil("letras-amo", "Letras metalizadas «AMO» rojas de 16\" (genéricas: la tienda no las tiene en rojo)", { forma: { tipo: "letras", texto: "AMO" }, pulgadas: 16, color: "rojo" }, f(360, 197, -4));
  m.foil("letras-te", "Letras metalizadas «TE» rojas de 16\" (genéricas)", { forma: { tipo: "letras", texto: "TE" }, pulgadas: 16, color: "rojo" }, f(342, 95, -6));
  m.trazo("aro-t", "Aro de T-260 Fashion Negro en la «T»", T("T-260", 2.5, NEGRO), [{ tipo: "linea", puntos: elipse(12, 2.5) }], f(338, 103, 2), "a black twisted-balloon ring");
  racimo(m, "entre-letras", "Par entre las letras", [NEGRO, NEGRO], f(310, 165, 2), 10);
  helio(m, "cintas", "Ramo de helio: cintas blancas", [
    { id: "helio-te-amo", nombre: "R-12 rojo «te amo» (I Love You Moderno, el más parecido)", globo: R("R-12", 28, ROJO), centro: v(66, 249, -10), impresoId: "infinity-i-love-you-moderno-fashion-rojo" },
    { id: "helio-negro", nombre: "R-12 Fashion Negro de helio", globo: R("R-12", 28, NEGRO), centro: v(41, 219, -4) },
    { id: "helio-plata", nombre: "R-12 Reflex Plata de helio", globo: R("R-12", 28, PLATA), centro: v(68, 206, -22) },
    { id: "helio-corazon", nombre: "R-12 rojo con corazón blanco (Love Fashion Surtido, el más parecido)", globo: R("R-12", 28, ROJO), centro: v(76, 184, 2), impresoId: LOVE },
    { id: "helio-veteado", nombre: "R-12 Metalink Plata Graffiti negro de helio", globo: R("R-12", 28, NEGRO), centro: v(70, 150, -6), impresoId: GRAFFITI },
    { id: "helio-corazon-abajo", nombre: "R-12 rojo con corazón blanco (abajo)", globo: R("R-12", 28, ROJO), centro: v(76, 64, 26), impresoId: LOVE },
  ], f(470, 400, 10), SIN_DIBUJO_CINTA);
  m.globo("corazon-grande", "Corazón C-12 Fashion Rojo de la izquierda", R("C-12", 30, ROJO), v(-74, 74, 22), unitario(v(-0.3, 1, 0.4)));
  ([[-39, 54, 30], [-14, 48, 32], [18, 64, 30]] as const).forEach(([x, y, z], k) => m.globo(`corazoncito-${k + 1}`, `Corazoncito C-12 Fashion Rojo ${k + 1}`, R("C-12", 18, ROJO), v(x, y, z), unitario(v(0, 1, 0.6))));
  ([[-60, 18, 28], [-38, 34, 32], [56, 22, 30]] as const).forEach(([x, y, z], k) => m.dePie(`confeti-${k + 1}`, `R-12 Cristal con confeti rojo y plata ${k + 1}`, { tipo: "burbuja", propiedades: { exterior: R("R-12", 26, CRISTAL), interiores: [], relleno: { tipo: "confeti", colores: ["#d0172f", "#d6d9de"], cantidad: 40 }, semilla: 430 + k } }, v(x, y, z)));
  ([[270, 395, 24], [190, 480, 30], [440, 480, 34], [560, 470, 26], [460, 385, 22]] as const).forEach(([px, py, z], k) => m.deco(`rizo-${k + 1}`, `Rizo ${k + 1}: T-260 Reflex Plata`, rizo({ forma: "tirabuzon", tubito: T("T-260", 4, PLATA), vueltas: 2, radioInicialCm: 4, radioFinalCm: 6.5, largoCm: 12, eje: "frente" }), f(px, py, z), unitario(v(k % 2 ? 1 : -1, 0.3, 0.6))));
  return escenaDe(m)(sala(300, 240, 320, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 431 · Corazón orgánico
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 recortada (sin fondo). Escala por el grueso de los T-260 plateados (~23 px ≈ 4,5 cm): 5 px/cm, que
 * da los rojos chicos de ~45 px (R-5 a 9 cm), los plateados de ~55 px (R-5 a 11 cm), los veteados grandes de 70 a
 * 115 px (R-12 de 14 a 23 cm) y un corazón de ~135 × 106 cm; eje en x = 362. Va colgado en la pared a 30 cm del piso
 * (la foto no lo dice). El corazón orgánico de R-9 y R-5 rojos y plateados con, encima y en su sitio: 5 R-12 Graffiti
 * Invierno rojos (veteados de blanco), el cristal con confeti plateado, el plateado grande, los dos R-12 rojos con un
 * corazón blanco, los corazones C-12 (2 rojos, uno cristal y uno rosado), los 6 adornos de T-260 Reflex Plata contados
 * (el «9», el gancho de la derecha, la «C» de la izquierda, los dos rizos de abajo a la derecha y la flor de 4 lazos
 * con su centro) y la florecita de 6 R-5 plateados con centro rojo. Colores: los publicados (Fashion Rojo 015, Reflex
 * Plata 981, Graffiti Invierno rojo, T-260 Reflex Plata); el corazón blanco de los R-12 rojos no está publicado: va el
 * «Love» de la tienda (el más parecido); el corazón rosado jaspeado, C-12 Fashion Rosado liso.
 */
const escena431 = (): Escena => {
  const ROJO = "015", PLATA = "981", CRISTAL = "390", ROSADO = "009";
  const INVIERNO = "infinity-graffiti-invierno-fashion-rojo", LOVE = "infinity-love-fashion-surtido";
  const K = 5;
  const f = foto(362, 545 + 30 * K, K);
  const corazon: Pieza = {
    tipo: "forma",
    forma: {
      clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 135, altoCm: 106 },
      tecnica: { tipo: "organico", radioCm: 11, mezcla: { "R-9": 0.35, "R-5": 0.65 }, semilla: 431, inflados: { "R-9": 13, "R-5": 10 } },
      colores: { codigos: [ROJO, PLATA], patron: "mezcla", pesos: [0.7, 0.3], semilla: 431 },
    },
  };
  const Z = -60;
  const m = montaje({ id: "corazon", nombre: "Corazón orgánico de R-9 y R-5 Fashion Rojo y Reflex Plata", pieza: corazon, origen: v(0, 30, Z) }, v(0, 0, Z + 40));
  const frente = (px: number, py: number, adelante = 0) => f(px, py, Z + 12 + adelante);
  const VETEADOS: ReadonlyArray<readonly [number, number, number]> = [[445, 140, 23], [420, 280, 17], [240, 375, 22], [550, 315, 18], [210, 245, 14]];
  VETEADOS.forEach(([px, py, d], k) => m.globo(`veteado-${k + 1}`, `R-12 Graffiti Invierno rojo ${k + 1}`, R("R-12", d, ROJO), frente(px, py), AL_FRENTE, INVIERNO));
  m.dePie("confeti", "R-12 Cristal con confeti plateado", { tipo: "burbuja", propiedades: { exterior: R("R-12", 18, CRISTAL), interiores: [], relleno: { tipo: "confeti", colores: ["#d6d9de"], cantidad: 30, tamanoCm: 2 }, semilla: 431 } }, frente(220, 205, -2));
  m.globo("plateado-grande", "R-9 Reflex Plata grande (abajo al centro)", R("R-9", 14, PLATA), frente(345, 375), AL_FRENTE);
  m.globo("corazon-blanco-1", "R-12 rojo con corazón blanco (Love, el más parecido; derecha)", R("R-12", 19, ROJO), frente(650, 265), AL_FRENTE, LOVE);
  m.globo("corazon-blanco-2", "R-12 rojo con corazón blanco (Love; abajo)", R("R-12", 16, ROJO), frente(425, 445), AL_FRENTE, LOVE);
  m.globo("corazon-rojo-1", "Corazón C-12 Fashion Rojo (arriba a la izquierda)", R("C-12", 13, ROJO), frente(95, 112), unitario(v(-0.4, 1, 0.3)));
  m.globo("corazon-rojo-2", "Corazón C-12 Fashion Rojo (arriba a la derecha)", R("C-12", 12.5, ROJO), frente(560, 108), unitario(v(0.3, 1, 0.3)));
  m.globo("corazon-cristal", "Corazón C-12 Cristal Transparente (arriba)", R("C-12", 13, CRISTAL), frente(520, 52, -4), unitario(v(0.2, 1, 0.2)));
  m.globo("corazon-rosado", "Corazón C-12 Fashion Rosado (izquierda; jaspeado en la foto)", R("C-12", 14, ROSADO), frente(115, 315), unitario(v(-1, 0.3, 0.3)));
  const tubo = (id: string, nombre: string, lista: ReadonlyArray<readonly [number, number]>, adelante = 4) =>
    m.trazo(id, nombre, T("T-260", 4.5, PLATA), [{ tipo: "linea", puntos: relativo(K, lista[0]![0], lista[0]![1])(lista) }], frente(lista[0]![0], lista[0]![1], adelante), "a silver twisted-balloon swirl");
  tubo("adorno-nueve", "Adorno «9» de T-260 Reflex Plata", [[262, 182], [270, 130], [300, 102], [330, 118], [330, 155], [300, 170], [280, 150]]);
  tubo("adorno-gancho", "Adorno en gancho de T-260 Reflex Plata (derecha)", [[615, 165], [612, 112], [630, 92], [655, 98], [668, 125], [668, 165]]);
  tubo("adorno-c", "Adorno «C» de T-260 Reflex Plata (izquierda)", [[95, 265], [60, 262], [35, 290], [45, 330], [80, 350]]);
  tubo("adorno-rizo-1", "Rizo de T-260 Reflex Plata (abajo a la derecha, arriba)", [[390, 345], [430, 330], [480, 335], [500, 355], [480, 372], [430, 368]]);
  tubo("adorno-rizo-2", "Rizo de T-260 Reflex Plata (abajo a la derecha, abajo)", [[395, 388], [450, 378], [495, 395], [510, 415], [480, 422]], 6);
  m.deco("adorno-flor", "Flor de 4 lazos de T-260 Reflex Plata con centro R-5", { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 4.5, codigos: [PLATA], cantidad: 4, estilo: "lazo", largoCm: 8, anchoCm: 5, aperturaGrados: 5, giroGrados: 45 }, interior: null, corona: null, centro: R("R-5", 7, PLATA) } }, frente(165, 95), AL_FRENTE);
  const florecita: PropiedadesFlor = { petalos: { formatoId: "R-5", infladoCm: 7, codigo: PLATA, cantidad: 6, aperturaGrados: 10, giroGrados: 0 }, centro: { formatoId: "R-5", infladoCm: 6, codigo: ROJO, cantidad: 1 } };
  m.deco("florecita", "Florecita de 6 R-5 Reflex Plata con centro R-5 Fashion Rojo", { tipo: "flor", propiedades: florecita }, frente(305, 425), AL_FRENTE);
  return escenaDe(m)(sala(240, 220, 220, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 433 · Corazón tejido
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 1000×1000 recortado. Escala por los R-12 de la base (~95 px ≈ 27 cm): 3,5 px/cm, que da los globitos de los
 * corazones de ~30 px (R-5 a 9 cm); piso en y = 870 px, eje en x = 515. El topiario: abajo un cuarteto R-12 palo de rosa
 * (se ven 2), el R-12 pastel (girado) y el R-12 silk perlado (se ven 2), con 3 racimitos de R-5 dorados; el tallo de dos
 * T-260 dorados trenzados (de 62 a 114 cm); arriba el R-12 palo de rosa (girado), el pastel y el silk (se ven 3), con 3
 * racimitos dorados más; encima el corazón tejido grande (~86 × 64 cm, de 160 a 224 cm) y a la izquierda, pegado al
 * tallo, el chico (~57 cm), los dos de R-5 rosados en tresbolillo. Colores: los publicados, asignados por lo medido:
 * corazones #e9a0b0 → Fashion Rosado 009 (ΔE 9; el Silk Rosa Primaveral 809 queda a 5, pero es el perlado malva de los
 * cuartetos, que no tiene otro publicado); palo de rosa → 010 (ΔE 9); pastel #d7c5c6 → Pastel Mate Rosado 609 (ΔE 6);
 * dorado #aa9c74 → Silk Dorado 870 (ΔE 4).
 */
const escena433 = (): Escena => {
  const PALO = "010", PASTEL = "609", SILK = "809", ORO = "870", ROSADO = "009";
  const f = foto(515, 870, 3.5);
  const m = montaje({ id: "base", nombre: "Corazón tejido: base de cuarteto R-12 Fashion Palo de Rosa", pieza: cuarteto(R("R-12", 27, PALO), [PALO]), origen: v(0, 13.5, 0) }, v(0, 0, 0));
  m.nivel("pastel-abajo", "Cuarteto R-12 Pastel Mate Rosado (abajo)", cuarteto(R("R-12", 25, PASTEL), [PASTEL]), v(0, 33, 0), 45);
  m.nivel("silk-abajo", "Cuarteto R-12 Silk Rosa Primaveral (abajo)", cuarteto(R("R-12", 25, SILK), [SILK]), v(0, 51.5, 0), 0);
  racimo(m, "oro-abajo-izquierda", "Racimito de R-5 Silk Dorado (abajo, izquierda)", [ORO, ORO, ORO], f(395, 798, 16), 8);
  racimo(m, "oro-abajo-medio", "Racimito de R-5 Silk Dorado (abajo, delante)", [ORO, ORO, ORO, ORO], f(515, 842, 22), 8);
  racimo(m, "oro-abajo-derecha", "Racimito de R-5 Silk Dorado (abajo, derecha)", [ORO, ORO, ORO], f(612, 790, 16), 8);
  const trenza = (fase: number) => Array.from({ length: 9 }, (_, k): readonly [number, number] => [(k + fase) % 2 ? 2.2 : -2.2, r2(k * 6.4)]);
  m.trazo("tallo-1", "Tallo: T-260 Silk Dorado trenzado 1", T("T-260", 4, ORO), [{ tipo: "linea", puntos: trenza(0) }], v(0, 62, 0), "a gold twisted-balloon braided stem");
  m.trazo("tallo-2", "Tallo: T-260 Silk Dorado trenzado 2", T("T-260", 4, ORO), [{ tipo: "linea", puntos: trenza(1) }], v(0, 62, 1.5), "a gold twisted-balloon braided stem");
  m.nivel("palo-arriba", "Cuarteto R-12 Fashion Palo de Rosa (arriba)", cuarteto(R("R-12", 26, PALO), [PALO]), v(0, 123, 0), 45);
  m.nivel("pastel-arriba", "Cuarteto R-12 Pastel Mate Rosado (arriba)", cuarteto(R("R-12", 24, PASTEL), [PASTEL]), v(0, 139.5, 0), 0);
  m.nivel("silk-arriba", "Cuarteto R-12 Silk Rosa Primaveral (arriba)", cuarteto(R("R-12", 20, SILK), [SILK]), v(0, 155, 0), 45);
  racimo(m, "oro-arriba-izquierda", "Racimito de R-5 Silk Dorado (arriba, izquierda)", [ORO, ORO, ORO, ORO], f(418, 378, 14), 8);
  racimo(m, "oro-arriba-medio", "Racimito de R-5 Silk Dorado (arriba, delante)", [ORO, ORO, ORO, ORO, ORO], f(515, 360, 18), 8);
  racimo(m, "oro-arriba-derecha", "Racimito de R-5 Silk Dorado (arriba, derecha)", [ORO, ORO, ORO], f(603, 376, 14), 8);
  const corazon = (ancho: number, alto: number): Pieza => ({ tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: ancho, altoCm: alto }, tecnica: { tipo: "celdas", formatoId: "R-5", infladoCm: 9, celda: "tresbolillo" }, colores: { codigos: [ROSADO], patron: "un_color" } } });
  m.pieza("corazon-grande", "Corazón tejido grande: R-5 Fashion Rosado en tresbolillo", corazon(86, 64), v(0, 162, -2), ARRIBA, GIRO_AMARRE);
  m.pieza("corazon-chico", "Corazón tejido chico: R-5 Fashion Rosado en tresbolillo", corazon(57, 55), v(-37, 51, 10), ARRIBA, GIRO_AMARRE);
  return escenaDe(m)(sala(220, 200, 260, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

const P_REFLEX_PLATA = pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981");
const P_GRAFFITI_NEGRO = pub("GLOBO REDONDO INFINITY® METALINK PLATA GRAFFITI FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-infinity-metalink-plata-graffiti-fashion-negro", "R-12", null);
const P_INVIERNO_ROJO = pub("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-rojo", "R-12", null);
const P_TUBITO_PLATA = pub("GLOBO TUBITO REFLEX PLATA", "/products/globo-para-fiesta-latex-tubito-reflex-plata", "T-260", "981");

const NOTA_MARIQUITAS =
  "Igual: la columna espiral de 7 cuartetos R-12 de ~1,5 m (escala por sus R-12, 2,14 px/cm) con dos blancos, uno negro y uno rojo de lunares blancos por cuarteto (el Polka Blanco rojo de la tienda), las tres mariquitas pegadas en su sitio —la de arriba a la izquierda con cabeza R-9 blanca y dos antenas de T-260 negro, la carita del medio de frente con dos ojos saltones, la nariz roja y sus antenas, y la de la derecha con su cabecita y su antena— y el ramo de 4 R-12 de helio contados (rojo de lunares, negro de lunares, negro y rojo), hasta ~2,5 m. Distinto: la idea no publica productos: los colores son los medidos (blanco 005, negro 080, rojo 015); los lunares blancos del negro de helio no están en la tienda: van dibujados en un R-12 negro liso; el reparto de colores del espiral es el del generador (2 blancos, 1 negro y 1 rojo por nivel), parecido pero no globo a globo; las antenas son trazos rectos.";

export const LOTE_26: readonly IdeaDigitalizada[] = [
  idea(347, "columna-calabaza-2", "Columna calabaza 2: espirales verde y morado, lunares naranja y negro y calabacitas en resortes plateados", escena347,
    "Igual: la columna de ~2,4 m (escala por el metalizado de 18\" del remate, 2 px/cm) de abajo arriba: cuarteto R-12 negro con lunares naranja, espiral de 4 cuartetos R-9 verde lima y violeta, el R-18 naranja, el anillo de un cuarteto R-9 negro, otro espiral de 4, el cuarteto R-12 naranja con lunares negros, el R-12 negro con lunares girado (se ven 3) y el metalizado redondo con la calavera; las 5 calabacitas contadas (R-9 naranja con cara de calabaza y tallo de lazos de T-260 verde lima) en su sitio, cada una en su resorte de T-260 plateado. Distinto: la idea no publica productos: los colores son los medidos (Verde Lima 031, Violeta 051, Naranja 061, Negro 080, Reflex Plata 981 en los resortes); los R-12 de lunares no existen en la tienda: van lisos con los lunares dibujados en la cara; el metalizado de calavera «Happy Halloween» tampoco: va genérico, plata con la calavera impresa; la clasificación habla de 6 calabacitas y la foto deja ver 5.", []),
  idea(371, "columna-feliz-cumpleanos-organico", "Columna feliz cumpleaños orgánico: columna negra, dorada y plateada con el «40» y ramo de helio", escena371,
    "Igual: la columna orgánica de ~1 m (escala por los R-12 de helio, 2,07 px/cm) de R-12, R-9 y R-5 negros, Reflex Dorado y Reflex Plata sobre su cuarteto R-12 negro, con el R-12 Metalink Plata Graffiti grande arriba a la izquierda y otros veteados (el impreso publicado), los dos R-12 dorados y el plateado grandes, los 4 racimitos de R-5 (dos dorados, dos plateados) y los 4 rizos de T-260 blanco; el «40» plateado (el 4 es el NUMERO 4 PLATA de la tienda) y el ramo de 6 R-12 de helio contados —2 «Diamantes Cobre», 2 «Happy Birthday Diamante» y 2 Reflex Dorado: los publicados—, hasta ~2,6 m. Distinto: lo orgánico lo da el motor con el grosor y el alto medidos (no se cuenta uno a uno); los números van a ~26\" como en la foto (la tienda los vende de 16\" y 32\"); el 0 plateado no está en la tienda: genérico; el 4 de la foto está inclinado y aquí va derecho; los rizos son tirabuzones (en la foto son lazos sueltos).",
    [pub("GLOBO REDONDO INFINITY® HAPPY BIRTHDAY DIAMANTE ESCARCHADO DORADO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-infinity-happy-birthday-diamante-escarchado-dorado-fashion-negro", "R-12", null), pub("GLOBO REDONDO INFINITY® DIAMANTES COBRE FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-infinity-diamantes-cobre-fashion-blanco", "R-12", null), P_GRAFFITI_NEGRO, pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"), P_REFLEX_PLATA]),
  idea(379, "columna-granja", "Columna granja: columna de impresos de colores con la vaca echada encima y flores de tubito", escena379,
    "Igual: la columna de ~2,45 m (escala por los R-12, 2,2 px/cm) sobre su cuarteto R-18 verde lima, «alternando tamaños» como dice la idea: en cada nivel dos R-12 impresos a los lados (amarillo, rojo, azul y naranja de abajo arriba) y dos R-9 verdes delante y detrás, y un cuarteto R-9 verde liso entre nivel y nivel; la vaca echada de 9 R-12 blancos con manchas (cabeza con la boca rosada y las orejas negras, cuello, lomo, anca y cuatro patas) y la cola de T-260 blanco con el mechón negro; abajo las 3 flores de tubito con sus tallos y los lazos verde oscuro y verde lima. Distinto: la idea no publica productos: los colores son los medidos; el impreso de granja (animalitos blancos) no está en la tienda: el rojo va con el Polka Blanco rojo (el más parecido) y los demás lisos con lunares blancos dibujados; las manchas de la vaca van dibujadas en R-12 blancos lisos (la tienda no tiene la vaca); se ven 3 flores (la clasificación dice 4); la vaca es más esquemática que la de la foto.", []),
  idea(384, "columna-hello-kitty", "Columna Hello Kitty: cuartetos lila, fucsia y rosado de corazones con Hello Kitty de globos encima", escena384,
    "Igual: la columna de ~1,9 m (escala por los R-12 impresos, 2,86 px/cm): tres niveles de cuarteto R-12 impreso (lila, fucsia y rosado) cada uno con su cuarteto R-9 liso del mismo color encima, girado; y Hello Kitty de globos encima: piernas y brazos de T-260 blanco, tutú de un aro de T-260 rosado, cuerpo de 4 T-260 rosados con las mangas, la cabeza R-12 blanca con ojos, nariz amarilla y bigotes impresos, las orejas de R-5 y el moño de lazos de T-260 rosado. Distinto: la idea no publica productos: los colores son los medidos (Lila 050, Fucsia 012, Rosado 009, Blanco 005); el impreso de Hello Kitty no está en la tienda: el fucsia y el rosado van con «Corazones Modernos» (el más parecido) y el lila, que no está en ese surtido, liso; la cabeza es un R-12 redondo (en la foto tiene la forma de Kitty, más ancha) y la cara es la del generador.", []),
  idea(386, "columna-lady-bug", "Columna Lady Bug: espiral blanca, negra y roja de lunares con mariquitas y ramo de helio", escenaMariquitas("Columna Lady Bug"), NOTA_MARIQUITAS, []),
  idea(387, "columna-love", "Columna Love: flor de corazones «LOVE» en un tallo rojo sobre las letras de tubito", escena387,
    "Igual: la columna de ~1,26 m (escala por los corazones, 4,2 px/cm): la base de cuarteto R-9 rojo con un cuarteto R-5 blanco encima, las letras «LOVE» de T-260 (L y E blancas, V roja y la O de un corazoncito rojo), el tallo de T-160 rojo en burbujas y la flor: 5 corazones C-12 «LOVE» rojos contados (el CORAZON 2 CARAS LOVE de la tienda, el mismo dibujo) alrededor de una flor de 6 R-5 blancos con el centro rojo. Distinto: la idea no publica productos: los colores son los medidos (Rojo 015, Blanco 005); la clasificación dice 6 corazones y la foto tiene 5; el palito blanco que sostiene la flor no se pone; las letras son trazos de burbujas (en la foto las burbujas son más largas).", []),
  idea(388, "columna-marimonda", "Columna Marimonda: cuerpo de cuartetos tropicales y la máscara del Carnaval de cabeza azul", escena388,
    "Igual: la columna de ~1,9 m (escala por los R-12, 2,9 px/cm): el cuerpo de 6 cuartetos R-12 en espiral fucsia, amarillo, verde lima y naranja, el cuello de un cuarteto R-5 de los mismos colores y la cabeza R-24 azul (~61 cm) con la cara de la Marimonda: los ojos de lazos de T-260 verde en «∞» con su pupila negra, la trompa de T-260 verde que baja hasta el pecho, los labios de T-260 neón fucsia y las orejas de T-260 naranja en arco de la cabeza a los hombros: los productos publicados. Distinto: la cabeza va en el Neón Azul publicado, aunque en la foto mide más cerca del Fashion Azul 040; las pupilas negras no están publicadas (R-5 Fashion Negro); el surtido tropical y el T-260 amarillo publicados no se ven aparte en la foto: van listados sin cantidad; los ojos son dos lazos ovalados (en la foto, un «∞» de un solo tubito).",
    [pub("GLOBO REDONDO FASHION SURTIDO TROPICAL", "/products/globo-para-fiesta-latex-redondo-fashion-surtido-tropical", "R-12", null), pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"), pub("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"), pub("GLOBO REDONDO NEON AZUL", "/products/globo-para-fiesta-latex-redondo-neon-azul", "R-12", "240"), pub("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031"), pub("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020"), pub("GLOBO TUBITO FASHION AMARILLO", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", "T-260", "020"), pub("GLOBO TUBITO FASHION VERDE", "/products/globo-para-fiesta-latex-tubito-fashion-verde", "T-260", "030"), pub("GLOBO TUBITO NEON FUCSIA", "/products/globo-para-fiesta-latex-tubito-neon-fucsia", "T-260", "212"), pub("GLOBO TUBITO FASHION NARANJA", "/products/globo-para-fiesta-latex-tubito-fashion-naranja", "T-260", "061")]),
  idea(391, "columna-mariquita", "Columna mariquita: espiral blanca, negra y roja de lunares con mariquitas y ramo de helio", escenaMariquitas("Columna mariquita"),
    `${NOTA_MARIQUITAS} Es la misma foto que «Columna Lady Bug» (#386): las dos ideas se digitalizan igual (solo cambia el nombre de la columna).`, []),
  idea(395, "columna-momia-embrujada", "Columna momia embrujada: momia metalizada sobre base negra y verde con dos torres de helio", escena395,
    "Igual: la base de un cuarteto R-12 negro con un R-5 verde en la punta de cada globo y los dos R-5 verdes donde pisa la momia (escala por los R-12 de helio y los metalizados, 2 px/cm); la momia de ~88 cm con su calabaza en la mano; las dos torres de helio contadas, cada una un R-12 negro, un cuarteto R-5 verde lima y el metalizado redondo negro de calabaza «Happy Halloween» encima, con sus cintas rojas a la mano de la momia, hasta ~2,7 m. Distinto: la clasificación la describe de tubitos, pero en la foto la momia y su calabaza son un metalizado (supershape): van como paneles de foil genéricos (vendas blancas con la franja verde, los ojos amarillos y la calabaza), sin producto, como los redondos de calabaza que la tienda no tiene; la idea no publica productos: los colores son los medidos (Verde Trébol 029 en la base, Verde Lima 031 en las torres, Negro 080); la silueta de la momia es aproximada.", []),
  idea(398, "columna-nochebuena", "Columna nochebuena: fuste de 660 rojo con espiral verde y muñeco de nieve encima", escena398,
    "Igual: lo que dice la idea y se cuenta en la foto (escala por el 660, 2,3 px/cm): cuarteto R-12 rojo, cuarteto R-9 verde, el Link-O-Loon 660 rojo de pie (~72 cm) con la espiral de T-260 verde de 4 vueltas y media, un cuarteto R-9 verde chico, el cuarteto R-12 rojo de arriba, los pies de un cuarteto R-9 negro y el muñeco de nieve: cuerpo LOL-12 blanco con 3 botones, cabeza R-12 blanca con ojos, nariz de zanahoria y sonrisa impresas, bufanda de T-260 rojo, brazos de T-260 negro con dedos y sombrero de copa negro, hasta ~2,3 m. Distinto: la idea no publica productos: los colores son los medidos (Rojo 015; el verde de los globos mide Turquesa Profundo 035 y la espiral Verde Selva 032); la sonrisa es un trazo (en la foto, puntitos); los botones son R-5 negros chicos (en la foto parecen pintados); la idea menciona T-160: no se distingue en la foto.", []),
  idea(412, "columna-unicornio", "Columna unicornio: espiral pastel con cuartetos de nubes y cabeza de unicornio con cuerno dorado", escena412,
    "Igual: la columna de ~2,5 m (escala por los R-12, 2,23 px/cm): el cuarteto de R-12 de nubes en cuatro colores (rosado, fucsia, amarillo y azul caribe), el R-9 blanco, el espiral de 7 cuartetos R-9 que pasa de fucsia y amarillo a azul, lila y rosado, otro R-9 blanco, el cuarteto de nubes de arriba, el último R-9 blanco y la cabeza R-18 blanca con los ojos cerrados y las mejillas rosadas, las orejas de lazo de T-260 blanco, la corona de 5 florecitas de T-260 contadas (amarilla, azul, fucsia, verde y lila) y el cuerno de T-260 dorado retorcido. Distinto: la idea no publica productos: los colores son los medidos; las nubes blancas no están en la tienda: van dibujadas (lunares) sobre los lisos; la florecita azul va en Fashion Azul 040 (la tienda no vende el T-260 Azul Caribe); los ojos cerrados son el trazo de cejas de la cara del generador, sin las pestañas; las orejas no llevan el rosado de adentro.", []),
  idea(416, "conejo-de-pascua", "Conejo de Pascua: salón rosado con la cenefa de globos en la viga, conejos, letras y carretillas", escena416,
    "Igual: lo único de globos, la cenefa de la viga del techo: 3 hileras de 32 R-12 frambuesa a lo ancho del salón (~9 m) y la vuelta de la derecha hacia el fondo; y la utilería del salón en su sitio, como escenografía suelta (no cotiza): el tapete rosado, la mesa blanca de postres con la torta, el arco con el nombre «Taliana», las cortinas blancas con sus cenefas lila y verde, las mesas redondas de los lados, el «1» rosado gigante, los conejos de icopor (dos grandes, dos en la mesa y uno en la mesa de la izquierda), las letras amarillas «TALIANA», las 4 carretillas con flores, los platos de huevitos y los dos pompones de papel. Distinto: la idea no publica productos: la cenefa va en Fashion Frambuesa 014 (medido); la escala del salón es aproximada (por los R-12 de la cenefa); los conejos, las carretillas, las flores y los cuadros son siluetas y bloques sencillos (los cuadros de las paredes no se ponen).", []),
  idea(430, "corazon-organico-te-amo", "Corazón orgánico te amo: corazón plateado con «TE AMO» rojo sobre base negra y roja y ramo de helio", escena430,
    "Igual: la misma composición que el «Bouquet te amo» (#209), medida en esta foto (2 px/cm): la base orgánica de R-12 negros —la mitad con el Metalink Plata Graffiti publicado— y rojos con el Graffiti Invierno publicado, con R-9 merlot, los 3 cristales con confeti rojo y plata, los 3 corazoncitos rojos, los 5 rizos de T-260 Reflex Plata (el publicado) y el corazón rojo grande; encima el corazón de R-5 Reflex Plata en tresbolillo (~125 × 80 cm), las letras metalizadas rojas «AMO» y «TE» con el par de R-5 negros y el aro de T-260 negro de la «T»; a la derecha el ramo de 6 R-12 de helio en sus sitios, hasta ~2,6 m. Distinto: el «te amo» de helio no está en la tienda: va el I Love You Moderno rojo (el más parecido), y el rojo con corazón blanco, el Love Fashion Surtido; las letras rojas de 16\" no están en la tienda en rojo: genéricas; el merlot y el plateado de helio no están publicados (medidos); la base la da el motor (no se cuenta uno a uno).",
    [P_GRAFFITI_NEGRO, P_INVIERNO_ROJO, P_TUBITO_PLATA]),
  idea(431, "corazon-organico", "Corazón orgánico: corazón de globos rojos y plateados con veteados, corazones y adornos de tubito", escena431,
    "Igual: el corazón orgánico de ~135 × 106 cm (escala por el grueso de los T-260, 5 px/cm) de R-9 y R-5 rojos y plateados, con encima y en su sitio los 5 R-12 Graffiti Invierno rojos (el publicado), el cristal con confeti plateado, el plateado grande, los dos R-12 rojos con corazón blanco, los 4 corazones C-12 (dos rojos, uno cristal y uno rosado), los 6 adornos de T-260 Reflex Plata contados (el «9», el gancho, la «C», los dos rizos de abajo y la flor de 4 lazos) y la florecita de R-5 plateados con centro rojo: los productos publicados. Distinto: el relleno orgánico lo da el motor con la silueta de corazón y el grosor medido (no se cuenta uno a uno); el corazón blanco de los R-12 rojos no está publicado: va el «Love» de la tienda (el más parecido, con letrero); el corazón rosado jaspeado va liso (C-12 Fashion Rosado) y el cristal sin el corazoncito rojo de adentro; colgado a 30 cm del piso (la foto no lo dice).",
    [P_INVIERNO_ROJO, pub("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"), P_REFLEX_PLATA, P_TUBITO_PLATA]),
  idea(433, "corazon-tejido", "Corazón tejido: topiario rosado y dorado con dos corazones tejidos de R-5", escena433,
    "Igual: el topiario de ~2,2 m (escala por los R-12, 3,5 px/cm): abajo los cuartetos R-12 palo de rosa, pastel y silk perlado con 3 racimitos de R-5 Silk Dorado, el tallo de dos T-260 Silk Dorado trenzados, arriba otros tres cuartetos (palo de rosa, pastel y silk, el último más chico) con 3 racimitos dorados, y los dos corazones tejidos de R-5 rosados en tresbolillo: el grande encima (~86 × 64 cm) y el chico pegado al tallo a la izquierda (~57 cm): los productos publicados. Distinto: los 5 colores publicados se asignan por lo medido (corazones Fashion Rosado 009, cuartetos Palo de Rosa 010, Pastel Mate Rosado 609 y Silk Rosa Primaveral 809, dorado Silk Dorado 870), aunque el rosado de los corazones mide aún más cerca del 809; el corazón chico de la foto está un poco girado y aquí va derecho; el trenzado del tallo es un zigzag de dos tubitos.",
    [pub("GLOBO REDONDO SILK ROSA PRIMAVERAL", "/products/globo-latex-redondo-silk-rosa-primaveral", "R-12", "809"), pub("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870"), pub("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"), pub("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010"), pub("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609")]),
];
