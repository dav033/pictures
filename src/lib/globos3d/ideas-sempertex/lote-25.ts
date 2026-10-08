import type { IdeaDigitalizada, ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { coloresDelFormato, formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { AcabadoEscenografia, ElementoEscenografia } from "../escenografia";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import type { ColorOrganico, OpcionesOrganico, PuntoGrosor, PuntoMezcla, RellenoOrganico, TramoOrganico } from "../organico";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion, PropiedadesMono } from "../figuras";
import type { Accesorio, Cara, PropiedadesFigura } from "../figuras-tubito";
import type { EstiloOjo, ParteTubito } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { PropiedadesBurbuja } from "../burbujas";
import type { PatronColumna } from "../columnas";
import type { Vec3 } from "../modulos";
import { centroCuerpo } from "../geometria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 25** (los números de `clasif/lote-25.json`): los centros de
 * mesa del corazón foil «Te amo» (#272), de corazones surtidos (#275), de corazones brillantes (#276), de cumpleaños
 * (#278), «Feliz día» (#287), Frankie (#289), de Halloween (#291), de Navidad tradicional (#296), de Pascua (#304),
 * «Te amo» (#310) y del unicornio (#311); la ciudad cómic (#323), la cola de sirena (#327) y las columnas del pato
 * (#343) y de los bigotes (#345).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada con rejilla de
 * píxeles y medida:
 * - **Escala**: la de algo de tamaño conocido en la misma foto (un R-12 de helio a 28–30 cm, el metalizado de corazón
 *   de 16–18", el grueso de un T-260 ≈ 4,5–5 cm, un R-5 ≈ 11–12 cm). Las posiciones se escriben en el mundo con
 *   `foto(eje, piso, px/cm)`: x a la derecha del eje, y desde el piso (o desde lo alto del pedestal).
 * - **Conteo**: niveles y cuartetos de cada columna, globos de helio, pétalos, espirales, ventanas del mural, burbujas
 *   de las cadenas de tubito… uno a uno; lo que la técnica obliga detrás (el cuarto globo de un cuarteto, la nuca de
 *   una cabeza de racimo) va dicho en la nota. Lo orgánico (la base rosada de #287, la cola de sirena) lo da el motor
 *   con el grosor y el largo medidos. Ninguna idea publica «Materiales» con cantidades: lo contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana de un
 *   parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y el código más cercano que se fabrica en
 *   ese formato (un corazón solo en los colores del C-12/C-6; un tubito solo en los del T-260).
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando la idea lo publica (Corazones Brillantes en #275, Feliz
 *   Día Corazones Brillantes en #276 y #287, Polka Blanco Verde Lima en #304); si no, el más parecido del catálogo y la
 *   nota lo dice; lo que la tienda no tiene (el «40», los unicornios, los lunares azules) va liso o con la cara del
 *   generador.
 * - **Figuras de personaje y animal** (Frankie, el pollito, el unicornio, el pato, el señor de los bigotes): con globos
 *   reales —cabeza, cuerpo, rasgos de R-5 o T-260, caras impresas del generador de figuras— nunca con sólidos.
 * - **Montaje** (como los lotes 13, 23 y 24): cada estructura es su propio árbol. Su raíz es la estructura de globos
 *   (suelta, en su sitio); de la raíz cuelga (`sobre`) un **amarre** escondido (`oculto: true`) puesto bajo la
 *   estructura, donde no tiene globos debajo, y del amarre todo lo suyo, en el sitio exacto de la foto (también sus
 *   cintas de helio, palitos y metalizados). Los palos internos que la foto no deja ver van escondidos; pedestales,
 *   vasos y bases de césped van aparte, sueltos.
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
const AL_FRENTE = v(0, 0, 1);
/** Del píxel de una foto al mundo: x desde el eje de la pieza, y desde el piso (la fila `piso`) más `alzaCm`, a `pxPorCm`. */
const foto = (eje: number, piso: number, pxPorCm: number, alzaCm = 0) => (x: number, y: number, z = 0): Vec3 => v(r2((x - eje) / pxPorCm), r2((piso - y) / pxPorCm + alzaCm), z);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const T = (formatoId: string, grosorCm: number, codigo: string): ParteTubito => ({ formatoId, grosorCm, codigo });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos: Partial<Sala["tonos"]> = {}): Sala => {
  const s = structuredClone(SALA_INICIAL);
  return { ...s, anchoCm, fondoCm, altoCm, tonos: { ...s.tonos, ...tonos } };
};
const SIN_CARA: Cara = { ojos: null, boca: null, mejillas: null, bigote: null, nariz: null, cejas: null };
const TINTA = "#141414";

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
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color"): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores });

/** Una columna de `niveles` cuartetos al paso del taller (0,8 diámetros); su origen es el centro del primero. */
const columna = (g: ParteGlobo, niveles: number, colores: string[], patron: PatronColumna = "un_color"): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8 * niveles), patron, colores });

const figura = (p: Omit<PropiedadesFigura, "postura" | "base" | "piernas" | "cuerpo" | "cuello" | "cabeza" | "brazos"> & Partial<PropiedadesFigura>): Decoracion => ({
  tipo: "figura",
  propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, ...p },
});

const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });
const burbuja = (p: PropiedadesBurbuja): Decoracion => ({ tipo: "burbuja", propiedades: p });
const mono = (p: PropiedadesMono): Decoracion => ({ tipo: "mono", propiedades: p });

/** Un ojo saltón (globo blanco con la pupila impresa, el iris si se pide). */
const OJO_SALTON: EstiloOjo = { iris: null, pupila: { hex: TINTA, proporcion: 0.5 }, brillo: true, venas: null };
const ojo = (g: ParteGlobo, estilo: EstiloOjo = OJO_SALTON, miradaGrados = 0): Decoracion => ({ tipo: "ojo", propiedades: { globo: g, estilo, miradaGrados } });

/** Una flor de tubito de pétalos en burbuja o en lazo (colores pétalo a pétalo, en ciclo) con un globito al centro. */
const florTubito = (t: ParteTubito, codigos: string[], petalos: number, largoCm: number, estilo: "burbuja" | "lazo", centro: ParteGlobo | null, anchoCm?: number): Decoracion => ({
  tipo: "flor_tubito",
  propiedades: { petalos: { formatoId: t.formatoId, grosorCm: t.grosorCm, codigos, cantidad: petalos, estilo, largoCm, anchoCm: anchoCm ?? t.grosorCm, aperturaGrados: 10, giroGrados: 90 }, interior: null, corona: null, centro },
});

/**
 * Un tubito de frente que sigue líneas quebradas y arcos: una figura vacía con cadenas de burbujas. Las coordenadas van
 * como las ve quien mira la foto (cm: a su derecha, arriba); como una pieza `sobre` queda en espejo (el marco de un
 * ancla es de mano izquierda), aquí se reflejan para que se vea como en la foto.
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

/** Una línea quebrada de puntos del MUNDO (en un plano de frente) partida en burbujas de `pasoCm`: relativa al primero. */
function enBurbujas(puntos: readonly Vec3[], pasoCm: number): Array<readonly [number, number]> {
  const salida: Array<readonly [number, number]> = [[0, 0]];
  const o = puntos[0]!;
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1]!, b = puntos[i]!;
    const n = Math.max(1, Math.round(largo(menos(b, a)) / pasoCm));
    for (let k = 1; k <= n; k++) {
      const q = mas(a, por(menos(b, a), k / n));
      salida.push([r2(q.x - o.x), r2(q.y - o.y)]);
    }
  }
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Escenografía (no cotiza)
// ----------------------------------------------------------------------------------------------------------

const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: AcabadoEscenografia = "mate"): ElementoEscenografia =>
  ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado });
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: AcabadoEscenografia = "mate"): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado });
/** Un cilindro de `desde` a `hasta` (palito, cinta). */
function barra(desde: Vec3, hasta: Vec3, radioCm: number, hex: string, acabado: AcabadoEscenografia = "mate"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm: r2(radioCm), altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });
/** Una pieza suelta en el salón con su origen en (x, y, z). */
const suelto = (id: string, nombre: string, pieza: Pieza, x: number, y: number, z: number): NodoEscena =>
  ({ id, nombre, pieza, colocacion: { en: "libre", xCm: r2(x), yCm: r2(y), zCm: r2(z), giroGrados: 0 } });
/** Un palo interno que la foto no deja ver: sostiene, pero no se dibuja. */
const paloEscondido = (desde: Vec3, hasta: Vec3): ElementoEscenografia => ({ ...barra(desde, hasta, 0.5, "#f2f2f2", "madera"), oculto: true });

// ----------------------------------------------------------------------------------------------------------
// Orgánicos (la raíz de un montaje: un racimo de una paleta, en el mundo)
// ----------------------------------------------------------------------------------------------------------

const FORMATOS_REDONDOS = ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36"];
/** Un color de la paleta orgánica, solo en los formatos donde se fabrica (y, si se pide, solo en esos). */
function color(codigo: string, peso: number, soloEn?: string[]): ColorOrganico {
  const formatos = (soloEn ?? FORMATOS_REDONDOS).filter((f) => coloresDelFormato(f).some((r) => r.codigo === codigo));
  return { codigo, peso, formatos };
}
const mezcla = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];
/** Grosor de un racimo: de `inicio` a `fin` (y la punta, redondeada). */
const grosor = (inicio: number, fin: number): PuntoGrosor[] => [{ t: 0, radioCm: inicio }, { t: 0.85, radioCm: fin }, { t: 1, radioCm: fin * 0.85 }];

/** Un tramo de racimo con su recorrido en el MUNDO. */
type TramoDef = { id: string; nombre: string; puntos: Vec3[]; grosor: PuntoGrosor[]; mezcla: PuntoMezcla[]; irregularidad?: number };
type OpcionesPaleta = { colores: ColorOrganico[]; semilla: number; relleno: RellenoOrganico[]; inflados: Readonly<Record<string, number>> };

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
    irregularidad: d.irregularidad ?? 0.14, tapas: { inicio: true, fin: true },
  }));
  const opciones: OpcionesOrganico = {
    semilla: o.semilla, tramos: t, inflados: { ...o.inflados }, variacionInflado: 0.07,
    relleno: o.relleno.map((r) => ({ ...r })), colores: o.colores, suelo: true, huecosFlores: 0,
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
  /** Un globo con cara impresa (de pie y de frente) con el centro del cuerpo en `centro`, y lo que lleve pegado. */
  conCara: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, cara: Cara, queEs: string, accesorios?: Accesorio[]) => void;
  /** Un metalizado de pie y de frente con el centro en `centro`. */
  foil: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3) => void;
  /** Escenografía de papel, foil o madera (contorno de frente) con su origen en `base`, de pie y de frente. */
  foilPaneles: (id: string, nombre: string, elementos: ElementoEscenografia[], base: Vec3) => void;
  /** Un nivel de cuarteto (o una columna) con el centro del primer nivel en `centro`, girado `giroGrados`. */
  nivel: (id: string, nombre: string, pieza: Pieza, centro: Vec3, giroGrados: number) => void;
  /** Una decoración con su origen en `origen`, mirando hacia `normal` (su +y local) y girada `giroGrados`. */
  deco: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados?: number) => void;
  /** Una decoración de pie (figura, burbuja, moño: +z local arriba) con su origen en `origen`, de frente. */
  dePie: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, impresos?: ImpresoEnPieza[]) => void;
  /** Unos trazos de tubito con su punto (0, 0) en `origen`, en el plano vertical de frente: su «arriba» es el del mundo. */
  trazo: (id: string, nombre: string, t: ParteTubito, partes: readonly TrazoFrente[], origen: Vec3, queEs: string) => void;
};

/**
 * Arma el montaje: `raiz` suelta con su origen en `origen` (mundo); su amarre (escondido, `oculto`), con la base en
 * `amarre` (mundo), en un sitio sin globos debajo: así la escena no lo corre y queda donde se pide. Lo demás cuelga
 * del amarre, exacto.
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
    // El giro de una pieza `sobre` se cuenta en el mundo: el marco del amarre es el del mundo con x al revés.
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
    const p: Pieza = { tipo: "globo", formatoId: gl.formatoId, infladoCm: gl.infladoCm, codigo: gl.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
    pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
  };
  const deco = (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados = 0) => pieza(id, nombre, { tipo: "decoracion", decoracion }, origen, normal, giroGrados);
  return {
    nodos, amarre: idAmarre, pieza, globo, deco,
    conCara: (id, nombre, gl, centro, cara, queEs, accesorios = []) => {
      // De pie y de frente (normal al frente): el +z de la figura sube y su +y mira a quien ve.
      const p: Pieza = { tipo: "decoracion", decoracion: figura({ cuerpo: [{ tipo: "globo", globo: gl, cara }], accesorios, queEs }) };
      const gArmado = armarPieza(p).globos[0]!;
      const c = mas(gArmado.nudo, por(gArmado.direccion, centroCuerpo("redondo", gl.infladoCm)));
      pieza(id, nombre, p, menos(centro, v(c.x, c.z, c.y)), AL_FRENTE);
    },
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
  };
}

/** Una cadena de burbujas de tubito por puntos del MUNDO (en el plano de frente del primero), de `pasoCm` cada una. */
function cadena(m: Montaje, id: string, nombre: string, t: ParteTubito, puntos: readonly Vec3[], pasoCm: number, queEs: string): void {
  m.trazo(id, nombre, t, [{ tipo: "linea", puntos: enBurbujas(puntos, pasoCm) }], puntos[0]!, queEs);
}

/**
 * Un resorte de tubito de `desde` a `hasta` (mundo): el eje del rizo sale por la normal (su +y local), así que un
 * resorte «de frente» con la normal hacia `hasta` sube (o se tiende) por donde va en la foto.
 */
function resorte(m: Montaje, id: string, nombre: string, t: ParteTubito, desde: Vec3, hasta: Vec3, radioCm: number, vueltas: number): void {
  m.deco(id, nombre, rizo({ forma: "resorte", tubito: t, vueltas, radioCm, largoCm: r2(largo(menos(hasta, desde))), eje: "frente" }), desde, unitario(menos(hasta, desde)));
}

/** Un ramo de helio amarrado a la estructura: cada globo en su sitio de la foto, mirando un poco hacia fuera del nudo. */
type GloboHelio = { id: string; nombre: string; globo: ParteGlobo; centro: Vec3; impresoId?: string };
function helio(m: Montaje, id: string, nombre: string, globos: readonly GloboHelio[], nudo: Vec3, hexCinta: string): void {
  const cintas: ElementoEscenografia[] = [];
  for (const h of globos) {
    const d = unitario(v((h.centro.x - nudo.x) * 0.12, 1, (h.centro.z - nudo.z) * 0.12));
    m.globo(h.id, h.nombre, h.globo, h.centro, d, h.impresoId);
    const cuello = menos(h.centro, por(d, centroCuerpo("redondo", h.globo.infladoCm)));
    cintas.push(barra(v(0, 0, 0), menos(cuello, nudo), 0.2, hexCinta, "papel"));
  }
  m.foilPaneles(id, nombre, cintas, nudo);
}

/** Cintas de papel (no cotizan) de un nudo a varios puntos del mundo. */
function cintasDe(m: Montaje, id: string, nombre: string, nudo: Vec3, hasta: readonly Vec3[], hex: string): void {
  m.foilPaneles(id, nombre, hasta.map((p) => barra(v(0, 0, 0), menos(p, nudo), 0.2, hex, "papel")), nudo);
}

/** Globos sueltos amarrados (cabeza de racimo, pelo, antena): cada uno en su sitio, mirando hacia fuera de `centro`. */
function globos(m: Montaje, id: string, nombre: string, g: ParteGlobo, puntos: readonly Vec3[], centro: Vec3): void {
  puntos.forEach((p, k) => m.globo(`${id}-${k + 1}`, `${nombre} ${k + 1}`, g, p, unitario(menos(p, centro))));
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
  const lista = armarPieza({ ...pieza, impresos: [] }).globos.map((g) => ({ formatoId: g.formatoId, codigo: g.codigo }));
  const ya = new Set<number>();
  const salida = new Map<string, { impresoId: string; formatoId: string; codigo: string; cantidad: number }>();
  for (const pedido of pieza.impresos) {
    const i = impresoPorId(pedido.impresoId);
    if (!i) continue;
    let elegidos: number[];
    if ("globos" in pedido) elegidos = pedido.globos.filter((k) => k >= 0 && k < lista.length);
    else {
      const delColor = lista.map((g, k) => (g.codigo === pedido.codigo ? k : -1)).filter((k) => k >= 0);
      const cada = Math.max(1, pedido.cada ?? 1), desde = Math.max(0, pedido.desde ?? 0);
      elegidos = delColor.filter((_, n) => n >= desde && (n - desde) % cada === 0);
    }
    for (const k of elegidos.filter((x) => !ya.has(x))) {
      ya.add(k);
      const g = lista[k]!;
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
 * vive en `index.ts` (que importa este lote): se calculan al leerlas.
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

const escenaDe = (s: Sala, ...montajes: Array<Montaje | NodoEscena[]>): Escena => ({ sala: s, nodos: montajes.flatMap((m) => (Array.isArray(m) ? m : m.nodos)) });

const IMPRESO_FELIZ_DIA = "infinity-feliz-dia-corazones-brillantes-metal-surtido";

/** Un punto sobre la cara de delante de una esfera de centro `c` y radio `radio`, a la altura y la x de la foto. */
const sobreEsfera = (c: Vec3, radio: number, p: Vec3, fuera = 0): Vec3 => {
  const dx = p.x - c.x, dy = p.y - c.y;
  return v(p.x, p.y, r2(c.z + Math.sqrt(Math.max(0, radio * radio - dx * dx - dy * dy)) + fuera));
};

/** Puntos de una foto (px) relativos al primero, en cm (a la derecha y arriba), para un trazo de frente. */
const relativos = (pxPorCm: number, puntos: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> =>
  puntos.map(([x, y]): readonly [number, number] => [r2((x - puntos[0]![0]) / pxPorCm), r2((puntos[0]![1] - y) / pxPorCm)]);

/** Unos puntos (cm) girados `grados` en su plano alrededor de (0, 0). */
const girar = (puntos: ReadonlyArray<readonly [number, number]>, grados: number): Array<readonly [number, number]> =>
  puntos.map(([x, y]): readonly [number, number] => [r2(x * Math.cos(rad(grados)) - y * Math.sin(rad(grados))), r2(x * Math.sin(rad(grados)) + y * Math.cos(rad(grados)))]);

// ----------------------------------------------------------------------------------------------------------
// 272 · Centro de mesa corazón foil «Te amo»
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000 (pared gris). Escala por el metalizado de corazón «Te Amo» (~184 px de ancho ≈ 42 cm) y el R-12 de
 * helio (~128 px ≈ 29 cm): 4,4 px/cm; el pie del montaje en y = 888 px (lo alto del pedestal blanco, que la foto corta:
 * va de 40 cm), eje en x = 525. De abajo arriba: el corazón rojo (~86 px: C-12 a 19 cm) metido en el vaso blanco de
 * cinta de corazones; el cuarteto de R-5 plateados (~50 px: 11 cm; se ven 3), el aro de burbujitas fucsia metalizadas
 * (~14 px: un T-260 retorcido en ~26 burbujas, se ven 13 delante), el cuarteto de R-5 fucsia (~43 px: 10 cm); el marco de
 * corazón de T-260 plateado (~223 × 230 px: 51 × 52 cm) con el metalizado «Te Amo» dentro y el corazoncito rojo
 * (~82 px: C-12 a 18 cm) pegado arriba a la izquierda; y el ramo de helio: corazón plateado, R-12 rojo y corazón fucsia,
 * hasta ~1,85 m sobre el pedestal. Colores: los publicados (Reflex Plata 981 en R-5 y en T-260, Fashion Fucsia 012);
 * medidos los demás: rojo #db0c24 → Fashion Rojo 015 (ΔE 2,5; los corazones, en sombra, también 015: el C-12 no se hace
 * en otro rojo); burbujitas #8f344c → Reflex Fucsia 912 (ΔE 14). Los corazones cromados de helio no existen en látex
 * Sempertex (el C-12 no se hace en Reflex): van con los metalizados de la tienda más parecidos.
 */
const escena272 = (): Escena => {
  const PLATA = "981", FUCSIA = "012", ROJO = "015", PERLA = "912";
  const PEDESTAL = 40;
  const f = foto(525, 888, 4.4, PEDESTAL);
  const m = montaje({ id: "base", nombre: "Corazón «Te amo»: cuarteto R-5 Reflex Plata de la base", pieza: cuarteto(R("R-5", 11.4, PLATA), [PLATA]), origen: f(525, 782), giroGrados: 45 }, v(0, PEDESTAL, 0));
  m.globo("corazon-vaso", "Corazón C-12 Fashion Rojo metido en el vaso", R("C-12", 19, ROJO), f(532, 848), ARRIBA);
  m.deco("perlas", "Aro de 26 burbujitas de T-260 Reflex Fucsia", rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3, codigos: [PERLA], largosCm: [3.4], recorrido: "aro", cantidad: 26 }), f(525, 752), ARRIBA);
  m.nivel("fucsia", "Cuarteto R-5 Fashion Fucsia", cuarteto(R("R-5", 9.8, FUCSIA), [FUCSIA]), f(525, 725), 45);
  // El marco: dos lóbulos (arcos) y dos rectas hasta la punta, de 51 × 52 cm; su (0, 0) es la punta de abajo.
  m.trazo("marco", "Marco de corazón de T-260 Reflex Plata", T("T-260", 3.2, PLATA), [
    { tipo: "arco", centro: [-12, 38.5], radioCm: 13.5, desdeGrados: 0, hastaGrados: 215 },
    { tipo: "arco", centro: [12, 38.5], radioCm: 13.5, desdeGrados: -35, hastaGrados: 180 },
    { tipo: "linea", puntos: [[-23.06, 30.76], [0, 0]] },
    { tipo: "linea", puntos: [[23.06, 30.76], [0, 0]] },
  ], f(523, 723, -3), "a silver twisted-balloon heart-shaped frame");
  m.foil("te-amo", "Metalizado corazón «Te Amo» de 16\" (el de la tienda, rosa oro)", metalizadoDeTienda("corazon-te-amo-rosado"), f(527, 623));
  m.globo("corazon-chico", "Corazoncito C-12 Fashion Rojo pegado al marco", R("C-12", 18, ROJO), f(450, 507, 4), unitario(v(-0.5, 1, 0.3)));
  m.foil("helio-plata", "Corazón plateado de helio (metalizado Corazones Plata de 18\")", metalizadoDeTienda("corazones-plata"), f(472, 150, -8));
  m.globo("helio-rojo", "R-12 Fashion Rojo de helio", R("R-12", 29, ROJO), f(558, 228, -2), unitario(v(0.15, 1, 0)));
  m.foil("helio-fucsia", "Corazón fucsia de helio (metalizado Corazón Rosado de 18\")", metalizadoDeTienda("corazon-lavanda"), f(516, 345, 4));
  cintasDe(m, "cintas", "Ramo de helio: cintas rosadas", f(523, 540), [f(472, 243, -8), f(549, 293, -2), f(500, 432, 4)], "#e86aa6");
  const pedestal: NodoEscena[] = [
    suelto("pedestal", "Pedestal blanco con el vaso de cinta de corazones", escenografia([
      caja(v(0, PEDESTAL / 2, 0), v(34, PEDESTAL, 34), "#f4f4f2"),
      cilindro(v(0, PEDESTAL, 0), 10.5, 17, "#fafafa"),
      cilindro(v(0, PEDESTAL + 5, 0), 10.8, 3, "#e9a3b0", "papel"),
    ]), 0, 0, 0),
  ];
  return escenaDe(sala(220, 200, 260, { piso: "#e9e9ea", paredes: "#ececee" }), m, pedestal);
};

// ----------------------------------------------------------------------------------------------------------
// 275 · Centro de mesa corazones surtidos
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por el R-12 impreso de arriba (~167 px = 28 cm): 6 px/cm, piso en y = 545 px,
 * eje en x = 368. De abajo arriba: cuarteto de corazones rosados (~78 px: C-12 a 13 cm; se ven 2 con las puntas al
 * centro), la burbuja de R-12 cristal (~165 × 195 px: 27,5 cm; va a 30 para que quepa lo de dentro) con 3 R-5 dorados (~48 px: 8 cm), 3 corazones rojos y 3
 * fucsia dentro, el cuarteto de corazones rojos (C-12 a 13 cm) y el R-12 «Corazones Brillantes» dorado, hasta ~88 cm.
 * Colores: los publicados (Corazones Brillantes, Cristal 390, Corazón Fashion Rojo 015); medidos: corazones de la base
 * #d492af → Fashion Rosado 009 (ΔE 14, el único rosado del C-12); dorado de arriba #d7c57e → Metal Dorado 570, el del
 * surtido del impreso; los R-5 de dentro, vistos a través del cristal (#af9264), con el mismo 570; los corazones fucsia
 * de dentro (~50 px: 8–9 cm) son Corazón 6 Fashion Fucsia 012, el único color del C-6.
 */
const escena275 = (): Escena => {
  const f = foto(368, 545, 6);
  const m = montaje({ id: "base", nombre: "Corazones surtidos: cuarteto de corazones C-12 Fashion Rosado", pieza: cuarteto(R("C-12", 13, "009"), ["009"]), origen: v(0, 6.7, 0) }, v(0, 0, 0));
  m.dePie("burbuja", "Burbuja R-12 Cristal con 3 corazones rojos, 3 corazoncitos fucsia y 3 R-5 Metal Dorado dentro", burbuja({
    exterior: R("R-12", 30, "390"),
    interiores: [{ formatoId: "C-12", infladoCm: 12.2, codigos: ["015"], cantidad: 3 }, { formatoId: "C-6", infladoCm: 8, codigos: ["012"], cantidad: 3 }, { formatoId: "R-5", infladoCm: 7.5, codigos: ["570"], cantidad: 3 }],
    relleno: null, semilla: 275,
  }), f(368, 458));
  m.nivel("corazones-rojos", "Cuarteto de corazones C-12 Fashion Rojo", cuarteto(R("C-12", 13, "015"), ["015"]), f(368, 248), 0);
  m.globo("corazones-brillantes", "R-12 «Corazones Brillantes» Metal Dorado (el de la idea)", R("R-12", 28, "570"), f(368, 120), ARRIBA, "infinity-corazones-brillantes-fashion-metal-surtido");
  return escenaDe(sala(160, 160, 120), m);
};

// ----------------------------------------------------------------------------------------------------------
// 276 · Centro de mesa corazones (Feliz Día)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000 (fondo blanco). Escala por el R-12 impreso de arriba (~220 px = 30 cm) y el grueso del T-260
 * (~35 px ≈ 4,8 cm): 7,2 px/cm, piso en y = 963 px, eje en x = 480. La base: 3 cuartetos de R-12 Silk Blanco Nácar
 * (~130 px: a 19 cm; centros a 895, 770 y 660 px) con un R-12 rojo impreso (~130 px: 18 cm) al frente sostenido por el
 * moño de T-260 dorado de colas largas; encima un cuarteto de R-5 dorados (~60 px: 8,5 cm), la espiral de T-260 rojo
 * del centro (2,5 vueltas de ~10 cm de radio, contadas), otro cuarteto dorado y el R-12 rojo «Feliz Día» (hasta
 * ~1,28 m). A los lados, dos espirales de T-260 rojo (1¾ vueltas) que suben de la base a dos flores de 5 pétalos de T-260
 * perla con centro de R-5 rojo. Colores: los publicados (Silk Blanco Nácar 806, Silk Dorado 870, Rojo Imperial 016 en
 * T-260, Feliz Día Corazones Brillantes en su Metal Rojo 515); medidos: centro de las flores #9d071c → Metal Rojo 515
 * (ΔE 6,5); pétalos perlados como la base → Silk Blanco Nácar 806 en T-260.
 */
const escena276 = (): Escena => {
  const NACAR = "806", DORADO = "870", ROJO = "016", METAL_ROJO = "515";
  const f = foto(480, 963, 7.2);
  const m = montaje({ id: "base", nombre: "Corazones Feliz Día: 3 cuartetos R-12 Silk Blanco Nácar", pieza: columna(R("R-12", 19, NACAR), 3, [NACAR]), origen: v(0, 9.5, 0) }, v(0, 0, 0));
  m.globo("impreso-abajo", "R-12 «Feliz Día» Corazones Brillantes Metal Rojo al frente de la base", R("R-12", 18, METAL_ROJO), f(487, 790, 18), unitario(v(0, 0.35, 1)), IMPRESO_FELIZ_DIA);
  m.dePie("mono", "Moño de T-260 Silk Dorado con colas largas", mono({ formatoId: "T-260", grosorCm: 3.5, codigo: DORADO, lazosPorLado: 1, largoLazoCm: 9, anchoLazoCm: 6, aberturaGrados: 30, colas: true, largoColaCm: 22, centro: R("R-5", 5.5, DORADO) }), f(480, 640, 22));
  m.nivel("dorado-abajo", "Cuarteto R-5 Silk Dorado sobre la base", cuarteto(R("R-5", 8.5, DORADO), [DORADO]), f(480, 590), 45);
  m.foilPaneles("palo", "Palo del centro (escondido)", [paloEscondido(v(0, 0, 0), v(0, 32, 0))], f(480, 590));
  resorte(m, "espiral-centro", "Espiral de T-260 Fashion Rojo Imperial del centro (2,5 vueltas)", T("T-260", 4.8, ROJO), f(480, 560), f(480, 415), 9, 2.5);
  m.nivel("dorado-arriba", "Cuarteto R-5 Silk Dorado de arriba", cuarteto(R("R-5", 8.5, DORADO), [DORADO]), f(480, 370), 45);
  m.globo("impreso-arriba", "R-12 «Feliz Día» Corazones Brillantes Metal Rojo arriba", R("R-12", 30, METAL_ROJO), f(480, 165), ARRIBA, IMPRESO_FELIZ_DIA);
  resorte(m, "espiral-izquierda", "Espiral de T-260 Fashion Rojo Imperial (izquierda)", T("T-260", 4.8, ROJO), f(330, 610, -2), f(262, 412, -2), 8, 1.75);
  resorte(m, "espiral-derecha", "Espiral de T-260 Fashion Rojo Imperial (derecha)", T("T-260", 4.8, ROJO), f(632, 640, -2), f(603, 425, -2), 8, 1.75);
  const flor = florTubito(T("T-260", 4.5, NACAR), [NACAR], 5, 8, "burbuja", R("R-5", 5.2, METAL_ROJO));
  m.deco("flor-izquierda", "Flor de 5 pétalos de T-260 Silk Blanco Nácar con centro R-5 Metal Rojo (izquierda)", flor, f(250, 370), AL_FRENTE);
  m.deco("flor-derecha", "Flor de 5 pétalos de T-260 Silk Blanco Nácar con centro R-5 Metal Rojo (derecha)", flor, f(590, 380), AL_FRENTE);
  return escenaDe(sala(200, 180, 160), m);
};

// ----------------------------------------------------------------------------------------------------------
// 278 · Centro de mesa cumpleaños
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco), pequeña. Escala por los globitos del racimo (~57 px ≈ R-5 a 12 cm): 4,8 px/cm, piso en
 * y = 545 px, eje en x = 355. Abajo, la base cuadrada de césped (~15 cm) con su vasito naranja y el palito con cintas
 * rizadas de colores; la flor (~4 pétalos de ~70 px: R-9 a 13–14,5 cm, dos naranja arriba y dos turquesa abajo, con
 * lunares blancos) con el centro amarillo de carita feliz (~35 px: R-5 a 7 cm); en el palito un R-5 amarillo y uno verde
 * (~30 px: 6,5 cm); arriba el racimo de dos cuartetos de R-5 —verdes abajo (se ven 3) y naranja encima (se ven 2)— y la
 * burbuja de cristal (~150 px: R-18 a 33 cm) con el R-12 verde «40» dentro (~120 px: 25 cm), hasta ~1,09 m. La idea no
 * publica productos: medidos verde #75b644 → Fashion Verde Lima 031 (ΔE 7); naranja #ff8c05 → Fashion Naranja 061
 * (ΔE 24, el naranja más cercano); turquesa #51c5de → Azul Caribe 038 (ΔE 4,5); R-5 amarillo del palito #d2b62c →
 * Fashion Mostaza 023 (ΔE 11); el «40» con su marco de lunares no está en la tienda: va el Polka Blanco Verde Lima (031).
 */
const escena278 = (): Escena => {
  const VERDE = "031", NARANJA = "061", TURQUESA = "038";
  const f = foto(355, 545, 4.8);
  const m = montaje({ id: "racimo", nombre: "Cumpleaños: cuarteto R-5 Fashion Verde Lima del racimo", pieza: cuarteto(R("R-5", 12, VERDE), [VERDE]), origen: f(355, 268), giroGrados: 45 }, v(0, 15, 0));
  m.nivel("naranja", "Cuarteto R-5 Fashion Naranja del racimo", cuarteto(R("R-5", 12, NARANJA), [NARANJA]), f(355, 222), 0);
  m.dePie("burbuja", "Burbuja R-18 Cristal con el R-12 verde «40» dentro (Polka Blanco Verde Lima, el más parecido)", burbuja({ exterior: R("R-18", 33, "390"), interiores: [{ formatoId: "R-12", infladoCm: 25, codigos: [VERDE], cantidad: 1 }], relleno: null, semilla: 278 }), f(355, 200), [{ impresoId: "infinity-polka-blanco-fashion-verde-lima", globos: [1] }]);
  // El palito con sus cintas rizadas (papel): de la maceta al racimo.
  const cintas = (["#5b2d8e", "#f2d22e", "#7ac943", "#2b2b6e"] as const).flatMap((hex, k) => {
    const puntos = Array.from({ length: 7 }, (_, i) => v(r2((k % 2 ? 1 : -1) * (1 + 2.5 * Math.abs(Math.sin(i * 1.3 + k)))), r2(40 - k * 2 - i * 4.2), r2((k - 1.5) * 1.2)));
    return puntos.slice(1).map((p, i) => barra(puntos[i]!, p, 0.25, hex, "papel"));
  });
  m.foilPaneles("palito", "Palito de madera con cintas rizadas de colores", [barra(v(0, 0, 0), v(0, 40, 0), 0.5, "#5a4632", "madera"), ...cintas], f(355, 480));
  m.globo("palito-amarillo", "R-5 Fashion Mostaza en el palito", R("R-5", 6.5, "023"), f(365, 325, 2), unitario(v(0.6, 0.4, 0.5)));
  m.globo("palito-verde", "R-5 Fashion Verde Lima en el palito", R("R-5", 6.5, VERDE), f(380, 375, 2), unitario(v(0.7, 0.2, 0.5)));
  m.globo("petalo-naranja-izquierdo", "Flor: pétalo R-9 Fashion Naranja (arriba a la izquierda)", R("R-9", 14.5, NARANJA), f(332, 420, 2), unitario(v(-0.7, 0.6, 0.3)));
  m.globo("petalo-naranja-derecho", "Flor: pétalo R-9 Fashion Naranja (arriba a la derecha)", R("R-9", 14.5, NARANJA), f(400, 425, 2), unitario(v(0.7, 0.5, 0.3)));
  m.globo("petalo-turquesa-izquierdo", "Flor: pétalo R-9 Fashion Azul Caribe (abajo a la izquierda)", R("R-9", 13, TURQUESA), f(340, 468, 2), unitario(v(-0.7, -0.5, 0.3)));
  m.globo("petalo-turquesa-derecho", "Flor: pétalo R-9 Fashion Azul Caribe (abajo a la derecha)", R("R-9", 13, TURQUESA), f(382, 472, 2), unitario(v(0.6, -0.6, 0.3)));
  m.conCara("flor-centro", "Flor: centro R-5 Fashion Amarillo Miel con carita feliz", R("R-5", 7.3, "021"), f(363, 445, 7), { ...SIN_CARA, ojos: { estilo: "puntos", hex: TINTA }, boca: { estilo: "sonrisa", hex: TINTA } }, "a small yellow smiley-face balloon");
  const base: NodoEscena[] = [suelto("cesped", "Base cuadrada de césped con su vasito naranja", escenografia([caja(v(0, 1.5, 0), v(15, 3, 15), "#3f9a3a", "tela"), cilindro(v(0, 3, 0), 4, 12, "#e2672b")]), 0, 0, 0)];
  return escenaDe(sala(160, 160, 130), m, base);
};

// ----------------------------------------------------------------------------------------------------------
// 287 · Centro de mesa Feliz día
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000 (fondo blanco). Escala por el R-12 impreso de dentro (~240 px = 30 cm): 8 px/cm, piso en y = 845 px,
 * eje en x = 517. La base orgánica de globos rosados (~130 px: R-9 a 17 cm; de x = 245 a 725 px y hasta ~33 cm); encima
 * la burbuja de cristal (~350 px: R-18 a 45 cm) con el R-12 rojo «Feliz Día» dentro, el aro de T-260 rojo que la rodea
 * (radio ~202 px: 24,5 cm) y 3 flores de 8 lazos de T-260 (arriba a la derecha rosadas y fucsia con centro rojo; a la
 * izquierda rojas y fucsia; al frente rojas y rosadas), hasta ~90 cm. Colores: los publicados (Fashion Rosado 009,
 * Fucsia 012 y Rojo 015 en R-12 y en T-260, Cristal 390, Feliz Día Corazones Brillantes en Metal Rojo 515); medido el
 * centro de la flor de la izquierda #e02759 → Fashion Frambuesa 014 (ΔE 4,2; no publicado).
 */
const escena287 = (): Escena => {
  const ROSADO = "009", FUCSIA = "012", ROJO = "015";
  const f = foto(517, 845, 8);
  const base = organico([{ id: "base", nombre: "Base", irregularidad: 0.2, puntos: [v(-20, 15, 0), v(-8, 17, 2), v(4, 17, 2), v(14, 15, 0)], grosor: grosor(16.5, 16.5), mezcla: mezcla({ "R-9": 1 }) }],
    { colores: [color(ROSADO, 1, ["R-9"])], semilla: 287, relleno: [{ formatoId: "R-9", infladoCm: 14, trios: false }], inflados: { "R-9": 17 } });
  const m = montaje({ id: "base", nombre: "Feliz día: base orgánica de R-9 Fashion Rosado", pieza: base.pieza, origen: base.origen }, v(-3, 0, 30));
  m.dePie("burbuja", "Burbuja R-18 Cristal con el R-12 «Feliz Día» Corazones Brillantes Metal Rojo dentro", burbuja({ exterior: R("R-18", 45, "390"), interiores: [{ formatoId: "R-12", infladoCm: 30, codigos: ["515"], cantidad: 1 }], relleno: null, semilla: 287 }), f(517, 560), [{ impresoId: IMPRESO_FELIZ_DIA, globos: [1] }]);
  m.trazo("aro", "Aro de T-260 Fashion Rojo alrededor de la burbuja", T("T-260", 3.5, ROJO), [{ tipo: "arco", centro: [0, 0], radioCm: 24.5, desdeGrados: 0, hastaGrados: 360 }], f(517, 355), "a red twisted-balloon ring around a clear bubble balloon");
  m.deco("flor-arriba", "Flor de 8 lazos de T-260 Fashion Rosado y Fucsia con centro R-5 Fashion Rojo (arriba a la derecha)", florTubito(T("T-260", 3.5, ROSADO), [ROSADO, FUCSIA], 8, 9, "lazo", R("R-5", 5.5, ROJO), 5), f(680, 190, 6), AL_FRENTE);
  m.deco("flor-izquierda", "Flor de 8 lazos de T-260 Fashion Rojo y Fucsia con centro R-5 Fashion Frambuesa (izquierda)", florTubito(T("T-260", 3.5, ROJO), [ROJO, FUCSIA], 8, 7, "lazo", R("R-5", 5.5, "014"), 4.5), f(345, 545, 14), AL_FRENTE);
  m.deco("flor-frente", "Flor de 8 lazos de T-260 Fashion Rojo y Rosado con centro R-5 Fashion Fucsia (al frente)", florTubito(T("T-260", 3.5, ROJO), [ROJO, ROSADO], 8, 7.5, "lazo", R("R-5", 5.5, FUCSIA), 4.5), f(510, 600, 22), AL_FRENTE);
  return escenaDe(sala(180, 180, 130), m);
};

// ----------------------------------------------------------------------------------------------------------
// 289 · Centro de mesa Frankie
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco), pequeña. Escala por los R-12 de helio (~95 px = 28 cm): 3,4 px/cm, piso en y = 530 px,
 * eje en x = 363. Frankie (~62 cm): pies de cuarteto R-5 verde (se ven 2), cabeza de racimo de R-5 verdes (~40 px: 12 cm;
 * se ven 7 y la nariz, y van 3 detrás), pelo de 3 R-5 negros con picos de T-260 negro, la cicatriz de T-260 blanco en la
 * frente, ojos saltones (R-5 blancos de ~18 px con pupila), la boca de T-260 negro y los tornillos de T-260 blanco a los
 * lados. Amarrados a su pelo, 2 R-12 de helio: el naranja con la calcomanía «Happy Halloween» y el negro, hasta ~1,47 m.
 * La idea no publica productos: medidos verde #00bd57 → Fashion Verde Trébol 029 (ΔE 16, el verde más cercano); naranja
 * #fd8b1b → Fashion Naranja 061; negro 080; blanco 005. La calcomanía va con el impreso «Happy Halloween» negro y naranja
 * de la tienda (en su 061).
 */
const escena289 = (): Escena => {
  const VERDE = "029", NEGRO = "080", BLANCO = "005";
  const f = foto(363, 530, 3.4);
  const m = montaje({ id: "pies", nombre: "Frankie: pies de cuarteto R-5 Fashion Verde Trébol", pieza: cuarteto(R("R-5", 10.5, VERDE), [VERDE]), origen: v(0, 5.3, 0) }, v(0, 0, 0));
  const centro = f(363, 440);
  globos(m, "cabeza", "Cabeza de Frankie: R-5 Fashion Verde Trébol", R("R-5", 12, VERDE), [
    f(335, 405, 5), f(395, 405, 5), f(366, 398, 6), f(318, 442, 3), f(410, 442, 3), f(363, 455, 9), f(342, 480, 5), f(386, 480, 5),
    f(343, 425, -8), f(385, 425, -8), f(364, 470, -8),
  ], centro);
  globos(m, "pelo", "Pelo de Frankie: R-5 Fashion Negro", R("R-5", 11.5, NEGRO), [f(340, 377, 0), f(397, 375, 0), f(368, 382, -4)], centro);
  m.trazo("pelo-picos", "Pelo de Frankie: picos de T-260 Fashion Negro", T("T-260", 3, NEGRO), [{ tipo: "linea", puntos: relativos(3.4, [[322, 355], [332, 330], [345, 352], [355, 327], [366, 350], [380, 325], [394, 348], [405, 330]]) }], f(322, 355), "black twisted-balloon spiky hair");
  m.trazo("cicatriz", "Cicatriz de T-260 Fashion Blanco en la frente", T("T-260", 2.5, BLANCO), [{ tipo: "linea", puntos: relativos(3.4, [[335, 402], [346, 396], [357, 404], [368, 396], [379, 404], [390, 397]]) }], f(335, 402, 10), "a white twisted-balloon stitched scar");
  m.deco("ojo-izquierdo", "Ojo izquierdo: R-5 Fashion Blanco con pupila", ojo(R("R-5", 5.5, BLANCO)), f(348, 436, 11), AL_FRENTE);
  m.deco("ojo-derecho", "Ojo derecho: R-5 Fashion Blanco con pupila", ojo(R("R-5", 5.5, BLANCO)), f(376, 436, 11), AL_FRENTE);
  m.trazo("boca", "Boca de T-260 Fashion Negro", T("T-260", 3, NEGRO), [{ tipo: "linea", puntos: relativos(3.4, [[330, 465], [362, 490], [397, 462]]) }], f(330, 465, 12), "a black twisted-balloon smile");
  m.trazo("tornillo-izquierdo", "Tornillo izquierdo: T-260 Fashion Blanco", T("T-260", 3, BLANCO), [{ tipo: "linea", puntos: [[0, 0], [-5, 0], [-10.5, 0]] }], f(316, 430), "a white twisted-balloon neck bolt");
  m.trazo("tornillo-derecho", "Tornillo derecho: T-260 Fashion Blanco", T("T-260", 3, BLANCO), [{ tipo: "linea", puntos: [[0, 0], [6, 0], [12.5, 0]] }], f(412, 430), "a white twisted-balloon neck bolt");
  helio(m, "cintas", "Ramo de helio: cintas blancas", [
    { id: "helio-naranja", nombre: "R-12 Fashion Naranja «Happy Halloween» (el impreso negro y naranja de la tienda)", globo: R("R-12", 28, "061"), centro: f(339, 175, -6), impresoId: "2-caras-happy-halloween-fashion-surtido-negro-naranja" },
    { id: "helio-negro", nombre: "R-12 Fashion Negro de helio", globo: R("R-12", 28, NEGRO), centro: f(390, 85, -12) },
  ], f(365, 340, -2), "#f2f2f2");
  return escenaDe(sala(160, 160, 170), m);
};

// ----------------------------------------------------------------------------------------------------------
// 291 · Centro de mesa Halloween
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por el R-12 de la calavera (~95 px = 27 cm): 3,5 px/cm, piso en y = 540 px,
 * eje en x = 365. De abajo arriba: la base de dos cuartetos de R-9 verde lima y violeta (~60 px: 17–18 cm) con 3 ojos
 * saltones de R-5 (~35–40 px), el palo negro con la espiral de T-260 naranja, el R-12 negro de calaveras, otra espiral
 * naranja, un cuarteto de R-5 verde y violeta (~30 px: 9 cm), la calabaza naranja con cara y el R-12 negro con la cara
 * de calabaza amarilla y su tallo de T-260 verde con lazos, hasta ~1,5 m. La idea no publica productos: medidos verde
 * #75b644 → Fashion Verde Lima 031 (ΔE 16); violeta #4a1d73 → Fashion Violeta 051 (ΔE 6,5); tallo #86cb46 → Neón Verde
 * 230 (ΔE 5); naranja 061; negro 080. La tienda no tiene el impreso de calaveras: va la cara de calavera blanca del
 * generador.
 */
const escena291 = (): Escena => {
  const LIMA = "031", VIOLETA = "051", NARANJA = "061", NEGRO = "080";
  const f = foto(365, 540, 3.5);
  const m = montaje({ id: "base", nombre: "Halloween: cuarteto R-9 Fashion Verde Lima y Violeta de la base", pieza: cuarteto(R("R-9", 18, LIMA), [LIMA, VIOLETA], "dos_colores"), origen: v(0, 9, 0) }, v(0, 0, 0));
  m.nivel("base-arriba", "Cuarteto R-9 Fashion Verde Lima y Violeta de arriba", cuarteto(R("R-9", 17, LIMA), [LIMA, VIOLETA], "dos_colores"), v(0, 23, 0), 45);
  m.deco("ojo-1", "Ojo saltón: R-5 Fashion Blanco con pupila (derecha)", ojo(R("R-5", 11, "005")), f(398, 440, 12), AL_FRENTE);
  m.deco("ojo-2", "Ojo saltón: R-5 Fashion Blanco con pupila (al frente)", ojo(R("R-5", 10, "005"), OJO_SALTON, 200), f(342, 472, 15), AL_FRENTE);
  m.deco("ojo-3", "Ojo saltón: R-5 Fashion Blanco con pupila (izquierda)", ojo(R("R-5", 9, "005"), OJO_SALTON, 180), f(290, 468, 6), unitario(v(-0.8, 0, 0.6)));
  m.foilPaneles("palo", "Palo negro de la columna", [barra(v(0, 0, 0), v(0, 70, 0), 0.8, "#141414", "madera")], v(0, 28, 0));
  resorte(m, "espiral-abajo", "Espiral de T-260 Fashion Naranja (abajo)", T("T-260", 4, NARANJA), v(0, 31, 0), v(0, 41, 0), 3, 1.2);
  m.conCara("calavera", "R-12 Fashion Negro con calavera blanca impresa", R("R-12", 27, NEGRO), f(372, 350), { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#f4f4f4" }, nariz: { estilo: "punto", hex: "#f4f4f4" }, boca: { estilo: "linea", hex: "#f4f4f4" } }, "a black balloon printed with a white skull");
  resorte(m, "espiral-arriba", "Espiral de T-260 Fashion Naranja (arriba)", T("T-260", 4, NARANJA), v(0, 66, 0), v(0, 87.5, 0), 3.5, 2);
  m.nivel("cuarteto-chico", "Cuarteto R-5 Fashion Verde Lima y Violeta", cuarteto(R("R-5", 9, LIMA), [LIMA, VIOLETA], "dos_colores"), f(365, 220), 0);
  m.conCara("calabaza", "R-12 Fashion Naranja con cara de calabaza", R("R-12", 30, NARANJA), f(347, 150, 2), { ...SIN_CARA, calabaza: { hex: TINTA } }, "an orange jack-o'-lantern balloon");
  m.conCara("calabaza-negra", "R-12 Fashion Negro con cara de calabaza amarilla", R("R-12", 30, NEGRO), f(395, 85, -2), { ...SIN_CARA, calabaza: { hex: "#f2d22e" } }, "a black balloon with a glowing yellow jack-o'-lantern face");
  m.trazo("tallo", "Tallo de T-260 Neón Verde con lazos", T("T-260", 4, "230"), [{ tipo: "linea", puntos: [[0, 0], [3, 5], [8, 7], [12, 4], [14, -1], [10, -3]] }], f(420, 60, -2), "a green twisted-balloon pumpkin stem with curls");
  return escenaDe(sala(160, 160, 180), m);
};

// ----------------------------------------------------------------------------------------------------------
// 296 · Centro de mesa Navidad tradicional
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 1000×1000 recortado. Escala por la burbuja de cristal (~235 px = R-12 a 30 cm, el publicado): 7,8 px/cm, piso
 * en y = 950 px, eje en x = 490. De abajo arriba: cuarteto de R-5 dorados (~95 px: 12 cm) con una cadena de burbujitas
 * de T-260 dorado enroscada; la nochebuena de 5 pétalos rojos (~110 px: R-12 a 14 cm) con centro de burbujitas
 * doradas y dos ramitas de burbujitas de T-260 dorado (~18 y ~14 burbujas de ~2,3 cm, contadas); el tallo de T-260
 * verde en espiral (2,5 vueltas); cuarteto de R-5 rojos (~75 px: 10 cm); cuarteto de R-9 dorados (~115 px: 15 cm); la
 * burbuja de cristal con remolinos blancos y confeti dorado y el lacito de T-260 dorado arriba, hasta ~1,22 m. Colores:
 * los publicados (Reflex Dorado 970 en R-5, R-9 y T-260; Reflex Cristal Rojo 915; Reflex Verde Lima 931 en T-260;
 * Cristal 390). La burbuja tiene remolinos blancos impresos: el impreso más parecido es el Graffiti Invierno
 * Transparente (en vez del cristal liso publicado).
 */
const escena296 = (): Escena => {
  const ORO = "970", ROJO = "915";
  const f = foto(490, 950, 7.8);
  const m = montaje({ id: "base", nombre: "Navidad: cuarteto R-5 Reflex Dorado de la base", pieza: cuarteto(R("R-5", 12, ORO), [ORO]), origen: v(0, 6, 0) }, v(0, 0, 0));
  const dorado = T("T-260", 2.4, ORO);
  cadena(m, "cadena-base", "Cadena de burbujitas de T-260 Reflex Dorado en la base", dorado, [f(345, 835, 8), f(380, 862, 8), f(420, 878, 8), f(448, 868, 8)], 2.4, "a gold chain of tiny twisted-balloon bubbles");
  m.deco("flor", "Nochebuena: 5 pétalos R-12 Reflex Cristal Rojo con centro de 3 R-5 Reflex Dorado", { tipo: "flor", propiedades: { petalos: { ...R("R-12", 14, ROJO), cantidad: 5, aperturaGrados: 15, giroGrados: 0 }, centro: { ...R("R-5", 5.5, ORO), cantidad: 3 } } }, f(490, 720, 8), unitario(v(0, 0.3, 1)));
  cadena(m, "ramita-izquierda", "Ramita de burbujitas de T-260 Reflex Dorado (izquierda)", dorado, [f(395, 690, 4), f(350, 640, 4), f(305, 560, 4)], 2.3, "a gold sprig of tiny twisted-balloon bubbles");
  cadena(m, "ramita-derecha", "Ramita de burbujitas de T-260 Reflex Dorado (derecha)", dorado, [f(588, 700, 4), f(630, 650, 4), f(665, 600, 4)], 2.3, "a gold sprig of tiny twisted-balloon bubbles");
  m.foilPaneles("palo", "Palo del centro (escondido)", [paloEscondido(v(0, 0, 0), v(0, 72, 0))], v(0, 12, 0));
  resorte(m, "espiral", "Tallo de T-260 Reflex Verde Lima en espiral (2,5 vueltas)", T("T-260", 3.8, "931"), f(490, 620), f(490, 500), 6.5, 2.5);
  m.nivel("rojo", "Cuarteto R-5 Reflex Cristal Rojo", cuarteto(R("R-5", 10, ROJO), [ROJO]), f(490, 460), 45);
  m.nivel("dorado", "Cuarteto R-9 Reflex Dorado", cuarteto(R("R-9", 15, ORO), [ORO]), f(490, 355), 0);
  m.dePie("burbuja", "R-12 Cristal con remolinos blancos (Graffiti Invierno, el más parecido) y confeti dorado dentro", burbuja({ exterior: R("R-12", 30, "390"), interiores: [], relleno: { tipo: "confeti", colores: ["#e0b43c", "#f2cf5b"], cantidad: 90, tamanoCm: 2.2 }, semilla: 296 }), f(490, 300), [{ impresoId: "infinity-graffiti-invierno-fashion-transparente", globos: [0] }]);
  m.trazo("lacito", "Lacito de T-260 Reflex Dorado arriba", dorado, [{ tipo: "arco", centro: [0, 0], radioCm: 3.8, desdeGrados: 0, hastaGrados: 360 }, { tipo: "linea", puntos: [[-2.5, -4], [-5, -7], [-7.5, -8.5]] }], f(578, 32), "a small gold twisted-balloon loop");
  return escenaDe(sala(180, 160, 150), m);
};

// ----------------------------------------------------------------------------------------------------------
// 304 · Centro de mesa Pascua
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000 (fotograma del video de Guido Verhoef, oscuro). Escala por el huevo (~255 × 300 px: R-12 Polka a
 * 30 cm, el publicado): 8,5 px/cm, piso en y = 925 px (la base sigue bajo las manos), eje en x = 427. De abajo arriba:
 * dos cuartetos de R-5 de colores (~100 px: 11,8 cm; se ven 3 de cada uno: abajo verde, azul y amarillo; arriba
 * amarillo, lila y verde), el huevo verde de lunares blancos, el nido de dos T-260 arena trenzados (~210 px: aro de 11 cm
 * de radio) y el pollito: cuerpo R-12 amarillo (~205 px: 24 cm), cabeza R-9 (~145 px: 17 cm), ojos R-5 blancos (~55 px)
 * con iris azul y pico R-5 naranja (~45 px), hasta ~98 cm. Colores: los publicados (Polka Blanco Verde Lima, T-260 Arena
 * 071); medidos en la foto oscura: amarillo #f9e11d → Fashion Amarillo 020 (ΔE 6); lila #8b62a6 → Reflex Violeta 951
 * (ΔE 3,4); verdes #2c9034 → Metal Verde 530 (ΔE 7) y #006b2f → Verde Selva 032 (ΔE 7,7); azul #004373 → Azul Naval 044
 * (ΔE 12); pico #ff7b01 → Fashion Naranja 061.
 */
const escena304 = (): Escena => {
  const AMARILLO = "020";
  const f = foto(427, 925, 8.5);
  const m = montaje({ id: "base", nombre: "Pascua: cuarteto R-5 de colores de la base (abajo)", pieza: cuarteto(R("R-5", 11.8, "032"), ["032", "044", AMARILLO, "951"], "espiral"), origen: v(0, 7, 0), giroGrados: 45 }, v(0, 0, 0));
  m.nivel("base-arriba", "Cuarteto R-5 de colores de la base (arriba)", cuarteto(R("R-5", 11.8, AMARILLO), [AMARILLO, "951", "530", "044"], "espiral"), v(0, 17, 0), 0);
  m.globo("huevo", "Huevo: R-12 Polka Blanco Verde Lima (el de la idea)", R("R-12", 30, "031"), f(427, 595), ARRIBA, "infinity-polka-blanco-fashion-verde-lima");
  m.dePie("nido", "Nido: dos T-260 Fashion Arena trenzados en aro", figura({ accesorios: [{ en: "base", forma: { tipo: "bufanda", formatoId: "T-260", grosorCm: 4, codigos: ["071", "071"], radioCm: 11 } }], queEs: "a braided sand-colored twisted-balloon nest ring" }), f(427, 415));
  m.dePie("pollito", "Pollito: cuerpo R-12 y cabeza R-9 Fashion Amarillo, ojos R-5 Fashion Blanco y pico R-5 Fashion Naranja", figura({
    cuerpo: [{ tipo: "globo", globo: R("R-12", 24, AMARILLO) }],
    cabeza: { ...R("R-9", 17, AMARILLO), cara: null },
    accesorios: [
      { en: "cara", par: true, corrimientoCm: [3.6, 0, 1.5], forma: { tipo: "globo", globo: R("R-5", 6.5, "005"), anguloGrados: 0, adelanteGrados: 80, estampado: "ojo" } },
      { en: "cara", corrimientoCm: [1, 0, -5], forma: { tipo: "globo", globo: R("R-5", 5.5, "061"), anguloGrados: -90, adelanteGrados: 60 } },
    ],
    queEs: "a yellow balloon chick with big eyes and an orange beak",
  }), f(427, 395));
  return escenaDe(sala(160, 160, 130), m);
};

// ----------------------------------------------------------------------------------------------------------
// 310 · Centro de mesa Te amo
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco), pequeña. Escala por el R-12 «Te amo» (~155 px = 30 cm) y el grueso del T-260 (~25 px):
 * 5,2 px/cm, piso en y = 555 px, eje en x = 380. La base: 3 cuartetos de R-5 violeta (~60 px: 11,5 cm; se ven 5), las
 * ondas de T-260 lila a la izquierda (dos «U»), la espiral lila de dos lazos a la derecha con su cola hasta la base, los
 * dos lazos grandes de T-260 rosado fuerte al frente, la flor grande de 8 pétalos rosados y fucsia y la chica de 5
 * rosados (centros R-5 blancos), el moño rojo con centro blanco y el R-12 rojo «Te amo» en su palito blanco, hasta
 * ~1,04 m. La idea no publica productos: medidos lila #b395c6 → Fashion Lila 050 (ΔE 4,5); rosado fuerte #ef66a1 → Neón
 * Fucsia 212 (ΔE 7,8); pétalos #feb9d1 → Fashion Rosado 009 (ΔE 4,8) y #fa2f87 → Fashion Fucsia 012 (ΔE 15); violeta
 * #5b4498 → Fashion Violeta 051 (ΔE 10); rojo #ef2924 → Fashion Rojo 015 (ΔE 9). El «Te amo» de corazones no está en la
 * tienda: va el I Love You Moderno rojo, el más parecido.
 */
const escena310 = (): Escena => {
  const LILA = "050", ROSA = "212", ROSADO = "009", FUCSIA = "012", ROJO = "015", BLANCO = "005";
  const f = foto(380, 555, 5.2);
  const m = montaje({ id: "base", nombre: "Te amo: 3 cuartetos R-5 Fashion Violeta de la base", pieza: columna(R("R-5", 11.5, "051"), 3, ["051"]), origen: v(0, 6.5, 0) }, v(0, 0, 0));
  m.trazo("lila-izquierda", "Ondas de T-260 Fashion Lila (izquierda)", T("T-260", 4.8, LILA), [{ tipo: "linea", puntos: relativos(5.2, [[195, 300], [198, 345], [212, 372], [232, 372], [245, 345], [250, 305], [258, 350], [272, 375], [290, 368], [298, 340], [300, 300]]) }], f(195, 300, -6), "a lilac twisted balloon bent in waves");
  m.trazo("lila-derecha", "Espiral de dos lazos de T-260 Fashion Lila con su cola (derecha)", T("T-260", 4.8, LILA), [
    { tipo: "arco", centro: [0, 0], radioCm: 6.5, desdeGrados: 0, hastaGrados: 360 },
    { tipo: "arco", centro: [4.8, -7.7], radioCm: 7.5, desdeGrados: 0, hastaGrados: 360 },
    { tipo: "linea", puntos: [[4.8, -15.2], [5.8, -22.1], [-3.8, -26.9], [-11.5, -27.5]] },
  ], f(470, 325, -6), "a lilac twisted-balloon double curl");
  m.trazo("rosa-frente", "Dos lazos grandes de T-260 Neón Fucsia (al frente)", T("T-260", 4.8, ROSA), [
    { tipo: "arco", centro: [0, 0], radioCm: 9.5, desdeGrados: 0, hastaGrados: 360 },
    { tipo: "arco", centro: [11.5, -14.4], radioCm: 8, desdeGrados: 0, hastaGrados: 360 },
  ], f(270, 425, 12), "two big hot-pink twisted-balloon loops");
  m.foilPaneles("palito", "Palito blanco del R-12", [barra(v(0, 0, 0), v(0, 40, 0), 0.6, "#f4f4f4", "madera")], f(332, 445));
  m.globo("te-amo", "R-12 Fashion Rojo «Te amo» (I Love You Moderno, el más parecido)", R("R-12", 30, ROJO), f(318, 120, -4), unitario(v(-0.15, 1, 0)), "infinity-i-love-you-moderno-fashion-rojo");
  m.deco("flor-grande", "Flor de 8 pétalos de T-260 Fashion Rosado y Fucsia con centro R-5 Fashion Blanco", florTubito(T("T-260", 4.8, ROSADO), [ROSADO, FUCSIA], 8, 12, "burbuja", R("R-5", 6, BLANCO)), f(400, 232, 6), unitario(v(0.1, 0.4, 1)));
  m.deco("flor-chica", "Flor de 5 pétalos de T-260 Fashion Rosado con centro R-5 Fashion Blanco", florTubito(T("T-260", 4.5, ROSADO), [ROSADO], 5, 7.5, "burbuja", R("R-5", 5.5, BLANCO)), f(372, 345, 12), unitario(v(0, 0.2, 1)));
  m.dePie("mono", "Moño de T-260 Fashion Rojo con centro R-5 Fashion Blanco", mono({ formatoId: "T-260", grosorCm: 4.8, codigo: ROJO, lazosPorLado: 1, largoLazoCm: 9, anchoLazoCm: 7, aberturaGrados: 30, colas: false, largoColaCm: 0, centro: R("R-5", 5.5, BLANCO) }), f(300, 330, 10));
  return escenaDe(sala(180, 160, 130), m);
};

// ----------------------------------------------------------------------------------------------------------
// 311 · Centro de mesa unicornio
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco), pequeña. Escala por los R-12 de helio (~95 px ≈ 29 cm): 3,3 px/cm, piso en y = 555 px,
 * eje en x = 372. El unicornio: base de cuarteto R-9 blanco (~55 px: 17 cm; se ven 3), cabeza R-18 blanca (~115 px:
 * 35 cm) con los ojos cerrados, las pestañas y las mejillas rosadas impresas, orejas de lazo de T-260 blanco, el cuerno
 * de T-260 dorado retorcido (~115 px: 34 cm) y la corona de 5 florecitas de T-260 (amarilla, turquesa, fucsia, verde y
 * lila). Amarrados al cuerno, 5 R-12 de helio con unicornios y nubes impresos (amarillo, fucsia, lila, rosado y
 * turquesa), hasta ~1,66 m. La idea no publica productos: medidos amarillo #ffea11 → Fashion Amarillo 020 (ΔE 3);
 * turquesa #06bfda → Azul Caribe 038 (ΔE 7–9); fucsia #fe73d0 → Neón Fucsia 212 (ΔE 20–23); lila #ac8fe0 → Satín Lila
 * 450 (ΔE 15; en T-260, Fashion Lila 050); rosado #f8c3e1 → Fashion Rosado 009 (ΔE 8); verde #9af389 → Verde Lima 031
 * (ΔE 17); cuerno #e7c965 → Metal Dorado 570 (ΔE 11). La tienda no tiene impresos de unicornio: los de helio van lisos.
 */
const escena311 = (): Escena => {
  const BLANCO = "005";
  const f = foto(372, 555, 3.3);
  const m = montaje({ id: "base", nombre: "Unicornio: base de cuarteto R-9 Fashion Blanco", pieza: cuarteto(R("R-9", 17, BLANCO), [BLANCO]), origen: v(0, 9, 0), giroGrados: 45 }, v(0, 0, 0));
  const cabeza = f(372, 447);
  m.conCara("cabeza", "Cabeza: R-18 Fashion Blanco con ojos cerrados y mejillas impresos y orejas de lazo de T-260 Fashion Blanco", R("R-18", 35, BLANCO), cabeza,
    { ...SIN_CARA, cejas: { hex: "#3a3a3a", bravas: false }, mejillas: { hex: "#f6b8cc" } }, "a white unicorn head balloon with closed eyes, pink cheeks and twisted-balloon ears",
    [{ en: "oreja", par: true, forma: { tipo: "orejas", estilo: "lazo", tubito: T("T-260", 3.5, BLANCO), largoCm: 12, anchoCm: 6, anguloGrados: 70 } }]);
  m.deco("cuerno", "Cuerno: T-260 Metal Dorado retorcido", rizo({ forma: "resorte", tubito: T("T-260", 3, "570"), vueltas: 6, radioCm: 1.6, largoCm: 34, eje: "frente" }), f(390, 372, 2), unitario(v(0.08, 1, 0)));
  const CORONA: ReadonlyArray<readonly [number, number, string, string]> = [[340, 378, "020", "Fashion Amarillo"], [360, 372, "038", "Fashion Azul Caribe"], [384, 372, "212", "Neón Fucsia"], [404, 388, "031", "Fashion Verde Lima"], [416, 404, "050", "Fashion Lila"]];
  CORONA.forEach(([px, py, c, nombre], k) => {
    const p = sobreEsfera(cabeza, 17.5, f(px, py), 1.5);
    m.deco(`flor-${k + 1}`, `Corona: florecita de 5 burbujas de T-260 ${nombre}`, florTubito(T("T-260", 2.2, c), [c], 5, 3, "burbuja", null), p, unitario(menos(p, cabeza)));
  });
  helio(m, "cintas", "Ramo de helio: cintas rosadas", [
    { id: "helio-amarillo", nombre: "R-12 Fashion Amarillo de helio (unicornio impreso en la foto)", globo: R("R-12", 28, "020"), centro: f(355, 65, -8) },
    { id: "helio-fucsia", nombre: "R-12 Neón Fucsia de helio (nubes impresas en la foto)", globo: R("R-12", 28, "212"), centro: f(425, 115, -16) },
    { id: "helio-lila", nombre: "R-12 Satín Lila de helio (unicornio impreso en la foto)", globo: R("R-12", 28, "450"), centro: f(308, 140, -6) },
    { id: "helio-rosado", nombre: "R-12 Fashion Rosado de helio (unicornio impreso en la foto)", globo: R("R-12", 28, "009"), centro: f(430, 175, 0) },
    { id: "helio-turquesa", nombre: "R-12 Fashion Azul Caribe de helio (arcoíris y nubes en la foto)", globo: R("R-12", 28, "038"), centro: f(350, 195, 6) },
  ], f(386, 360, -2), "#f2a0c8");
  return escenaDe(sala(180, 180, 190), m);
};

// ----------------------------------------------------------------------------------------------------------
// 323 · Ciudad cómic
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por la retícula de R-5 negros (~14,4 px de paso: R-5 a 9 cm, paso 8,1 cm) y
 * las ventanas (~32 px: R-9 a 18 cm): 1,78 px/cm, piso en y = 505 px, eje en x = 375. El edificio de la izquierda: malla
 * de R-5 negros de 12 × 23 (de x = 120 a 290 px y de 175 a 505 px) con su anexo de 3 columnas, y 3 × 7 ventanas
 * amarillas contadas; el de la derecha: torre de 9 × 25 con anexos de 3 columnas a cada lado (el de la derecha más
 * bajo), 2 × 7 ventanas turquesa y una más arriba, y la antena de 5 R-5 negros. Detrás, el contorno blanco de R-9 (la
 * nube de arriba a la izquierda con el «WOW» de T-260 amarillo, la banda de arriba y los lados), la bomba negra (R-18 a
 * 36 cm con su cuello y la mecha de chispas de T-260) y el cartucho de dinamita de T-260 rojo. Colores: los publicados
 * (Fashion Negro 080, Amarillo 020, Azul Caribe 038 y Blanco 005).
 */
const escena323 = (): Escena => {
  const NEGRO = "080", AMARILLO = "020", TURQUESA = "038", BLANCO = "005";
  const PX = 1.78, PASO_PX = 8.1 * PX;
  const f = foto(375, 505, PX);
  const negro = { formatoId: "R-5", infladoCm: 9 };
  const celda = (x0: number, y0: number) => (x: number, y: number): [number, number] => [r2((x - x0) / PASO_PX - 0.5), r2((y - y0) / PASO_PX - 0.5)];
  // Edificio de la izquierda: 12 columnas, una de hueco y el anexo de 3 (que empieza una fila más abajo).
  const ci = celda(120, 175);
  const filasIzq = Array.from({ length: 23 }, (_, r) => "a".repeat(12) + "." + (r === 0 ? "..." : "aaa"));
  const ventanasIzq = [157, 205, 253].flatMap((x) => [210, 262, 312, 358, 403, 447, 492].map((y) => ci(x, y)));
  const izq: Pieza = { tipo: "mural", mural: { matriz: { colores: [NEGRO], filas: filasIzq }, disposicion: "simple", grande: negro, chico: null, encima: [{ formatoId: "R-9", infladoCm: 18, codigo: AMARILLO, puntos: ventanasIzq }] } };
  const xIzq = r2((120 + (16 * PASO_PX) / 2 - 375) / PX);
  const mi = montaje({ id: "edificio-izquierdo", nombre: "Edificio izquierdo: malla de R-5 Fashion Negro con 21 ventanas R-9 Fashion Amarillo", pieza: izq, origen: v(xIzq, 0, 0) }, v(xIzq, 0, 20));
  mi.trazo("dinamita", "Dinamita: 3 cartuchos de T-260 Fashion Rojo", T("T-260", 3, "015"), [{ tipo: "linea", puntos: [[0, 0], [7, -2.5]] }, { tipo: "linea", puntos: [[0, -3.2], [7, -5.7]] }, { tipo: "linea", puntos: [[0, -6.4], [7, -8.9]] }], f(322, 278, 8), "a red twisted-balloon dynamite bundle");
  mi.foilPaneles("mecha-dinamita", "Mecha de papel de la dinamita", [barra(v(0, 0, 0), v(-12, 3, 0), 0.25, "#f4f4f4", "papel")], f(322, 276, 8));
  // Edificio de la derecha: anexo de 3 (desde la fila 4), torre de 9 y anexo de 3 (desde la fila 15).
  const cd = celda(477, 140);
  const filasDer = Array.from({ length: 25 }, (_, r) => (r >= 4 ? "aaa" : "...") + "a".repeat(9) + (r >= 15 ? "aaa" : "..."));
  const ventanasDer = [...[572, 615].flatMap((x) => [209, 255, 300, 345, 390, 435, 481].map((y) => cd(x, y))), cd(590, 165)];
  const der: Pieza = { tipo: "mural", mural: { matriz: { colores: [NEGRO], filas: filasDer }, disposicion: "simple", grande: negro, chico: null, encima: [{ formatoId: "R-9", infladoCm: 18, codigo: TURQUESA, puntos: ventanasDer }] } };
  const xDer = r2((477 + (15 * PASO_PX) / 2 - 375) / PX);
  const md = montaje({ id: "edificio-derecho", nombre: "Edificio derecho: malla de R-5 Fashion Negro con 15 ventanas R-9 Fashion Azul Caribe", pieza: der, origen: v(xDer, 0, 0) }, v(xDer, 0, 20));
  [128, 113, 98, 83, 67].forEach((py, k) => md.globo(`antena-${k + 1}`, `Antena: R-5 Fashion Negro ${k + 1}`, R("R-5", 9, NEGRO), f(585, py, 2), ARRIBA));
  md.globo("bomba", "Bomba: R-18 Fashion Negro", R("R-18", 36, NEGRO), f(460, 168, 8), unitario(v(-0.5, 1, 0.2)));
  md.globo("bomba-cuello", "Bomba: cuello R-5 Fashion Negro", R("R-5", 8, NEGRO), f(441, 136, 8), unitario(v(-0.6, 1, 0)));
  md.trazo("chispas-naranja", "Mecha: chispas de T-260 Fashion Naranja", T("T-260", 2.5, "061"), [{ tipo: "linea", puntos: [[-5, -5], [5, 5]] }], f(437, 108, 8), "orange twisted-balloon fuse sparks");
  md.trazo("chispas-amarillas", "Mecha: chispas de T-260 Fashion Amarillo", T("T-260", 2.5, AMARILLO), [{ tipo: "linea", puntos: [[-5, 5], [5, -5]] }], f(437, 108, 10), "yellow twisted-balloon fuse sparks");
  // El contorno blanco: nube de arriba a la izquierda (filas 0–2), banda de arriba (3–5) y los lados (6–17).
  const PASO_B = 13.5 * PX;
  const filasBlanco = Array.from({ length: 18 }, (_, r) => Array.from({ length: 27 }, (_, c) => ((r < 3 ? c < 9 : r < 6 ? true : c < 3 || c > 24) ? "a" : ".")).join(""));
  const blanco: Pieza = { tipo: "mural", mural: { matriz: { colores: [BLANCO], filas: filasBlanco }, disposicion: "simple", grande: { formatoId: "R-9", infladoCm: 15 }, chico: null } };
  const xBlanco = r2((55 + (27 * PASO_B) / 2 - 375) / PX);
  const mb = montaje({ id: "contorno", nombre: "Contorno blanco de R-9 Fashion Blanco (nube, banda de arriba y lados)", pieza: blanco, origen: v(xBlanco, 0, -25) }, v(xBlanco, 0, -5));
  const W = girar([[-12, 11], [-6, -11], [0, 4], [6, -11], [12, 11]], 35);
  const amarillo = T("T-260", 4, AMARILLO);
  const letraW = (id: string, nombre: string, x: number, y: number) =>
    mb.trazo(id, nombre, amarillo, [{ tipo: "linea", puntos: W.map(([a, b]): readonly [number, number] => [r2(a - W[0]![0]), r2(b - W[0]![1])]) }], mas(f(x, y, -12), v(W[0]![0], W[0]![1], 0)), "a yellow twisted-balloon comic letter W");
  letraW("letra-w-1", "«W» de T-260 Fashion Amarillo (primera)", 90, 172);
  mb.trazo("letra-o", "«O» de T-260 Fashion Amarillo", amarillo, [{ tipo: "arco", centro: [0, 0], radioCm: 11, desdeGrados: 0, hastaGrados: 360 }], f(150, 135, -12), "a yellow twisted-balloon comic letter O");
  letraW("letra-w-2", "«W» de T-260 Fashion Amarillo (segunda)", 208, 105);
  return escenaDe(sala(420, 220, 280), mi, md, mb);
};

// ----------------------------------------------------------------------------------------------------------
// 327 · Cola de sirena
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 1000×1000 recortado. Escala por los R-12 de la columna (~110 px ≈ 25 cm) y el grueso del T-260 (~13 px ≈
 * 2,8 cm): 4,4 px/cm, piso en y = 962 px, eje en x = 460. La columna orgánica cónica de ~61 cm de ancho abajo (de
 * x = 320 a 590 px) a ~23 cm arriba (a 1,64 m), de R-12 y R-9 Reflex Violeta, Pastel Dusk Lavanda, Fashion Lila y
 * Aguamarina con R-5 Reflex Plata (~30 px: 7 cm) en los huecos; arriba, las dos aletas de la cola: espirales cónicas de
 * T-260 plata (~15 y ~13 vueltas contadas, de ~10 cm de radio a la punta), una hacia arriba (~47 cm, hasta ~2,1 m) y otra
 * hacia la derecha (~42 cm). Colores: los publicados (Reflex Violeta 951, Pastel Dusk Lavanda 150, Fashion Lila 050,
 * Aguamarina 037, Reflex Plata 981; el plata también en T-260).
 */
const escena327 = (): Escena => {
  const f = foto(460, 962, 4.4);
  const cola = organico([{ id: "cola", nombre: "Cola", irregularidad: 0.18, puntos: [v(-3, 14, 0), v(-2, 50, 0), v(0, 90, 0), v(1, 125, 0), v(2, 157, 0)], grosor: grosor(31, 12), mezcla: mezcla({ "R-12": 0.45, "R-9": 0.05, "R-5": 0.5 }) }], {
    // Las cuotas de color se reparten sobre todos los globos: aquí cada color va en un solo formato y pesa lo que
    // le toca de los globos de ese formato que da el motor (16 R-12, 22 R-9 y 17 R-5), así cada formato lleva su mezcla.
    colores: [
      color("951", 5, ["R-12"]), color("150", 4, ["R-12"]), color("050", 4, ["R-12"]), color("037", 3, ["R-12"]),
      color("150", 7, ["R-9"]), color("050", 8, ["R-9"]), color("037", 7, ["R-9"]), color("981", 17, ["R-5"]),
    ],
    semilla: 327, relleno: [{ formatoId: "R-9", infladoCm: 14, trios: false }], inflados: { "R-12": 25, "R-9": 17, "R-5": 7 },
  });
  const m = montaje({ id: "cola", nombre: "Cola de sirena: columna orgánica cónica violeta, lavanda, lila y aguamarina con R-5 plata", pieza: cola.pieza, origen: cola.origen }, v(0, 0, 0));
  const plata = T("T-260", 2.8, "981");
  m.deco("aleta-arriba", "Aleta de arriba: T-260 Reflex Plata en espiral cónica (15 vueltas)", rizo({ forma: "tirabuzon", tubito: plata, vueltas: 15, radioInicialCm: 10, radioFinalCm: 1.5, largoCm: 47, eje: "frente" }), f(478, 240), unitario(v(-0.03, 1, 0)));
  m.deco("aleta-derecha", "Aleta de la derecha: T-260 Reflex Plata en espiral cónica (13 vueltas)", rizo({ forma: "tirabuzon", tubito: plata, vueltas: 13, radioInicialCm: 10, radioFinalCm: 1.5, largoCm: 42, eje: "frente" }), f(522, 240), unitario(v(0.97, 0.24, 0)));
  return escenaDe(sala(240, 200, 240), m);
};

// ----------------------------------------------------------------------------------------------------------
// 343 · Columna baby shower pato
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por los R-9 de la base (~65 px = 20 cm): 3,3 px/cm, piso en y = 555 px, eje en
 * x = 358. De abajo arriba: cuarteto de R-9 azules (con lunares y encaje impresos en la foto; se ven 2), 6 cuartetos de
 * R-5 azules (~36 px: 11 cm; filas contadas a 345, 375, 405, 435, 460 y 485 px), el cuarteto de R-9 de lunares (se ven
 * 3), un cuarteto de R-5 y el pato: cuerpo R-12 amarillo (~90 × 105 px: a 29 cm) con el ala de lazo de T-260 amarillo, el
 * corbatín de 2 R-5 azul caribe, la cabeza R-12 (~80 × 110 px, ovalada: a 26 cm) con el ojo impreso y el pico de dos lazos de T-260
 * naranja, hasta ~1,6 m (la foto corta la cabeza). La idea no publica productos: medidos azul #00b9e2 → Fashion Azul 040 (ΔE 6,5–9); corbatín
 * #01bbd7 → Azul Caribe 038 (ΔE 6,8); amarillo #e7c700 → Amarillo Miel 021 (ΔE 6,7); pico #fe7601 → Fashion Naranja 061.
 * La tienda no tiene lunares ni encaje en azul: van lisos.
 */
const escena343 = (): Escena => {
  const AZUL = "040", AMARILLO = "021";
  const f = foto(358, 555, 3.3);
  const m = montaje({ id: "base", nombre: "Pato: cuarteto R-9 Fashion Azul de la base", pieza: cuarteto(R("R-9", 20, AZUL), [AZUL]), origen: v(0, 10, 0) }, v(0, 0, 0));
  m.nivel("columna", "Columna de 6 cuartetos R-5 Fashion Azul", columna(R("R-5", 11, AZUL), 6, [AZUL]), v(0, 20.5, 0), 45);
  m.nivel("cuarteto-arriba", "Cuarteto R-9 Fashion Azul de arriba", cuarteto(R("R-9", 20, AZUL), [AZUL]), f(358, 290), 45);
  m.nivel("anillo", "Cuarteto R-5 Fashion Azul bajo el pato", cuarteto(R("R-5", 10, AZUL), [AZUL]), f(358, 250), 0);
  m.dePie("pato", "Pato: cuerpo y cabeza R-12 Fashion Amarillo Miel, corbatín R-5 Azul Caribe, pico y alas de T-260", figura({
    cuerpo: [{ tipo: "globo", globo: R("R-12", 29, AMARILLO) }],
    cuello: { ...R("R-5", 9, "038"), cantidad: 2 },
    cabeza: { ...R("R-12", 26, AMARILLO), cara: { ...SIN_CARA, ojos: { estilo: "ovalos", hex: TINTA } } },
    accesorios: [
      { en: "cara", corrimientoCm: [0, 0, -3], forma: { tipo: "pico", abanico: { ...T("T-260", 4, "061"), estilo: "lazos", cantidad: 2, largoCm: 9, anchoCm: 5, aberturaGrados: 40 } } },
      { en: "hombro", par: true, forma: { tipo: "alas", abanico: { ...T("T-260", 4, AMARILLO), estilo: "lazos", cantidad: 1, largoCm: 11, anchoCm: 6, aberturaGrados: 20 }, anguloGrados: -10 } },
    ],
    queEs: "a yellow balloon duck with an orange twisted-balloon beak, loop wings and a blue bow tie",
  }), f(358, 238));
  return escenaDe(sala(160, 160, 190), m);
};

// ----------------------------------------------------------------------------------------------------------
// 345 · Columna bigotes
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por la cabeza R-12 (~120 px = 28 cm): 4,3 px/cm, piso en y = 565 px, eje en
 * x = 375. De abajo arriba: cuarteto de R-12 verde (~110 px: 25,6 cm; se ven 2), 4 cuartetos de R-12 azul rey que se
 * afinan hacia arriba (~85, 80, 75 y 65 px: 20, 18,5, 17 y 15 cm; centros a 420, 360, 305 y 255 px), el corbatín de un
 * cuarteto de R-5 naranja (~40 px: 9 cm; se ven 3), la cabeza R-12 verde con ojos y bigote impresos y el bombín: copa
 * R-9 azul (~80 px: 18 cm) con ala de T-260 azul rey, inclinado, hasta ~1,31 m. La idea no publica productos: medidos
 * verde #00af38 → Fashion Verde Trébol 029 (ΔE 6,4); azul rey #0e469d → Fashion Azul Rey 041 (ΔE 7,9); naranja #e23a0d →
 * Fashion Naranja 061 (ΔE 13); copa #00a5d9 → Fashion Azul 040 (ΔE 4,9); ala #0054a7 → Azul Rey 041 (ΔE 5,7).
 */
const escena345 = (): Escena => {
  const VERDE = "029", AZUL_REY = "041";
  const f = foto(375, 565, 4.3);
  const m = montaje({ id: "base", nombre: "Bigotes: cuarteto R-12 Fashion Verde Trébol de la base", pieza: cuarteto(R("R-12", 25.6, VERDE), [VERDE]), origen: v(0, 12.8, 0) }, v(0, 0, 0));
  ([[20, 33.7, 45], [18.5, 47.7, 0], [17, 60.5, 45], [15, 72, 0]] as const).forEach(([d, y, giro], k) =>
    m.nivel(`azul-${k + 1}`, `Cuarteto R-12 Fashion Azul Rey ${k + 1} (a ${String(d).replace(".", ",")} cm)`, cuarteto(R("R-12", d, AZUL_REY), [AZUL_REY]), v(0, y, 0), giro));
  m.nivel("corbatin", "Corbatín: cuarteto R-5 Fashion Naranja", cuarteto(R("R-5", 9, "061"), ["061"]), v(0, 81.4, 0), 45);
  m.conCara("cabeza", "Cabeza: R-12 Fashion Verde Trébol con ojos y bigote impresos", R("R-12", 28, VERDE), f(360, 145), { ...SIN_CARA, ojos: { estilo: "ovalos", hex: TINTA }, bigote: { estilo: "mostacho", hex: TINTA } }, "a green balloon head with printed eyes and a curly moustache");
  m.dePie("sombrero", "Bombín: copa R-9 Fashion Azul con ala de T-260 Fashion Azul Rey", figura({ accesorios: [{ en: "base", forma: { tipo: "sombrero", ala: { ...T("T-260", 4, AZUL_REY), estilo: "aro", radioCm: 9 }, copa: { globo: R("R-9", 18, "040") }, cinta: null, pompon: null, inclinacionGrados: 25 } }], queEs: "a blue balloon bowler hat" }), f(415, 82));
  return escenaDe(sala(160, 160, 160), m);
};

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

const P_FELIZ_DIA = pub("GLOBO REDONDO INFINITY® FELIZ DÍA CORAZONES BRILLANTES METAL SURTIDO", "/products/globo-para-fiesta-latex-redondo-infinity-feliz-dia-corazones-brillantes-metal-surtido", "C-12", null);
const P_TRANSPARENTE = pub("GLOBO REDONDO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-fashion-transparente", "R-12", "390");
const P_FUCSIA = pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012");
const P_PLATA = pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981");

export const LOTE_25: readonly IdeaDigitalizada[] = [
  idea(272, "centro-de-mesa-corazon-foil-te-amo", "Centro de mesa corazón foil «Te amo»: marco de corazón plateado con metalizado y ramo de corazones", escena272,
    "Igual: el centro de ~1,85 m sobre su pedestal (escala por el metalizado «Te Amo» y el R-12 de helio, 4,4 px/cm): el corazón rojo C-12 en el vaso blanco, el cuarteto de R-5 Reflex Plata, el aro de 26 burbujitas de T-260 fucsia metalizado, el cuarteto de R-5 Fashion Fucsia, el marco de corazón de T-260 Reflex Plata de 51 × 52 cm con el metalizado de corazón «Te Amo» dentro y el corazoncito rojo arriba a la izquierda, y el ramo de helio en sus sitios (corazón plateado, R-12 rojo y corazón fucsia) con sus cintas rosadas: los productos publicados (Reflex Plata en R-5 y en T-260, Fashion Fucsia). Distinto: el «Te Amo» de la foto es transparente con corazones rojos y letra negra: va el metalizado «Corazón Te Amo» de la tienda (rosa oro, 16\"), el más parecido; los corazones cromados de helio no existen en látex Sempertex (el C-12 no se hace en Reflex): van los metalizados de la tienda Corazones Plata (paquete de 4) y Corazón Rosado, de 18\"; el burbujeo fucsia mide Reflex Fucsia 912 (ΔE 14) y no está publicado; el pedestal y el vaso son escenografía (la foto corta el pedestal: va de 40 cm).",
    [pub("GLOBO TUBITO REFLEX PLATA", "/products/globo-para-fiesta-latex-tubito-reflex-plata", "T-260", "981"), P_PLATA, P_FUCSIA]),
  idea(275, "centro-de-mesa-corazones-surtidos", "Centro de mesa corazones surtidos: burbuja de cristal con corazones dentro entre cuartetos de corazones", escena275,
    "Igual: el centro de ~88 cm (escala por el R-12 impreso, 6 px/cm): el cuarteto de corazones C-12 rosados de la base, la burbuja de R-12 Cristal con 3 corazones rojos, 3 corazoncitos fucsia y 3 R-5 dorados dentro, el cuarteto de corazones C-12 Fashion Rojo y arriba el R-12 «Corazones Brillantes» en el Metal Dorado 570 de su surtido: los productos publicados (Corazones Brillantes, Cristal, Corazón Fashion Rojo). Distinto: los corazones rojos de dentro miden 8–9 cm en la foto y el C-12 no baja de 12,2: van a 12,2 cm, y para que quepan los 9 la burbuja va a 30 cm (en la foto, ~27,5); los fucsia son Corazón 6 Fashion Fucsia (el único color del C-6); el motor de burbujas los amontona abajo a su manera (en la foto van repartidos); los corazones rosados de la base son Fashion Rosado 009 (ΔE 14, el único rosado del C-12) y no están publicados; los R-5 de dentro se ven a través del cristal: van en Metal Dorado 570 como el de arriba.",
    [pub("GLOBO REDONDO INFINITY® CORAZONES BRILLANTES", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-brillantes-fashion-metal-surtido", "C-12", null), P_TRANSPARENTE, pub("GLOBO CORAZON FASHION ROJO", "/products/globo-para-fiesta-latex-corazon-fashion-rojo", "C-12", "015")]),
  idea(276, "centro-de-mesa-corazones", "Centro de mesa corazones brillantes: base nácar con moño dorado, espirales rojas y flores", escena276,
    "Igual: el centro de ~1,28 m (escala por el R-12 de arriba y el grueso del T-260, 7,2 px/cm): la base de 3 cuartetos de R-12 Silk Blanco Nácar con el R-12 rojo impreso al frente y el moño de T-260 Silk Dorado de colas largas, los dos cuartetos de R-5 Silk Dorado, la espiral de T-260 Rojo Imperial del centro (2,5 vueltas), el R-12 «Feliz Día» arriba, y las dos espirales de los lados (1¾ vueltas) con sus flores de 5 pétalos perlados y centro rojo: los productos publicados (Feliz Día Corazones Brillantes en su Metal Rojo 515, T-260 Rojo Imperial, Silk Blanco Nácar, Silk Dorado). Distinto: los R-12 nácar de la base van a 19 cm (en la foto, poco inflados); el R-12 impreso de abajo se ve de corazones sin el letrero y va con el mismo «Feliz Día» publicado; los pétalos (perla) y los centros (Metal Rojo 515, ΔE 6,5) no están publicados en T-260 ni en R-5; el palo blanco del centro va escondido; las espirales de los lados son resortes rectos (en la foto ondulan más).",
    [P_FELIZ_DIA, pub("GLOBO TUBITO FASHION ROJO IMPERIAL", "/products/globo-latex-tubito-fashion-rojo-imperial", "T-260", "016"), pub("GLOBO REDONDO SILK BLANCO NÁCAR", "/products/globo-latex-redondo-silk-blanco-nacar", "R-12", "806"), pub("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870")]),
  idea(278, "centro-de-mesa-cumpleanos", "Centro de mesa cumpleaños: topiario de racimo verde y naranja con burbuja «40» y florecita sonriente", escena278,
    "Igual: el topiario de ~1,09 m (escala por los R-5 del racimo, 4,8 px/cm): la base de césped con su vasito, el palito con cintas rizadas de colores, la flor de 4 pétalos (dos naranja y dos turquesa) con el centro amarillo de carita feliz, el R-5 amarillo y el verde del palito, el racimo de dos cuartetos de R-5 (verde abajo, naranja arriba) y la burbuja de cristal R-18 con el R-12 verde dentro. Distinto: la idea no publica productos: los colores son los medidos (Fashion Verde Lima 031, Naranja 061, Azul Caribe 038, Mostaza 023, Amarillo Miel 021); el «40» con su marco de puntitos no está en la tienda: va el Polka Blanco Verde Lima (lunares blancos), el más parecido; los pétalos de la foto son corazones con lunares y aquí R-9 lisos (el C-12 no se hace en naranja ni turquesa); las cintas rizadas son de papel y aproximadas.",
    []),
  idea(287, "centro-de-mesa-feliz-dia", "Centro de mesa Feliz día: burbuja con R-12 «Feliz Día» en un aro rojo sobre base rosada con flores", escena287,
    "Igual: el centro de ~90 cm (escala por el R-12 impreso de dentro, 8 px/cm): la base orgánica de R-9 Fashion Rosado, la burbuja de R-18 Cristal con el R-12 «Feliz Día» Corazones Brillantes dentro, el aro de T-260 Fashion Rojo que la rodea y las 3 flores de 8 lazos de T-260 (rosado y fucsia arriba a la derecha, rojo y fucsia a la izquierda, rojo y rosado al frente) con sus centros de R-5: los productos publicados (Fashion Rosado, Fucsia y Rojo en R-12 y en T-260, Cristal, Feliz Día Corazones Brillantes en su Metal Rojo 515). Distinto: la base la da el motor con el grosor medido (no se cuenta uno a uno); el centro de la flor de la izquierda mide Fashion Frambuesa 014 (ΔE 4,2), no publicado; el cristal publicado como R-12 aquí es un R-18 (el R-12 de dentro no cabe en otro R-12); el aro es un círculo cerrado (en la foto pasa detrás de la base).",
    [pub("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"), pub("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"), P_FUCSIA, pub("GLOBO TUBITO FASHION ROJO", "/products/globo-para-fiesta-latex-tubito-fashion-rojo", "T-260", "015"), pub("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"), pub("GLOBO TUBITO FASHION FUCSIA", "/products/globo-para-fiesta-latex-tubito-fashion-fucsia", "T-260", "012"), P_TRANSPARENTE, P_FELIZ_DIA]),
  idea(289, "centro-de-mesa-frankie", "Centro de mesa Frankie: Frankenstein de globitos verdes con pelo negro y ramo de helio", escena289,
    "Igual: Frankie de ~62 cm armado con globos (escala por los R-12 de helio, 3,4 px/cm): pies de cuarteto R-5, cabeza de racimo de R-5 verdes con la nariz al frente, pelo de 3 R-5 negros con picos de T-260 negro, la cicatriz de T-260 blanco en la frente, los ojos saltones de R-5 con pupila, la boca de T-260 negro y los tornillos de T-260 blanco a los lados; y amarrados a su pelo el R-12 naranja «Happy Halloween» y el negro, hasta ~1,47 m. Distinto: la idea no publica productos: el verde es el medido (Fashion Verde Trébol 029, ΔE 16); la calcomanía de la foto (cuadro morado con fantasma) va con el impreso «Happy Halloween» negro y naranja de la tienda, el más parecido; la cabeza lleva 3 R-5 detrás que la foto no deja ver; los picos del pelo son una sola cadena de burbujas.",
    []),
  idea(291, "centro-de-mesa-halloween", "Centro de mesa Halloween: columna de calavera, calabazas y espirales naranja sobre base con ojos", escena291,
    "Igual: la columna de ~1,5 m (escala por el R-12 de la calavera, 3,5 px/cm): la base de dos cuartetos de R-9 verde lima y violeta con 3 ojos saltones de R-5, el palo negro con las dos espirales de T-260 naranja, el R-12 negro con calavera, el cuarteto de R-5 verde y violeta, la calabaza naranja con cara y el R-12 negro con la cara de calabaza amarilla y su tallo de T-260 verde con lazos. Distinto: la idea no publica productos: los colores son los medidos (Fashion Verde Lima 031, Violeta 051, Naranja 061, Negro 080, Neón Verde 230 en el tallo); la tienda no tiene el impreso de calaveras y huesos: va una calavera blanca de cara impresa (sin los huesitos alrededor); las caras de calabaza son las del generador; el R-12 negro de arriba va derecho (en la foto, ladeado).",
    []),
  idea(296, "centro-de-mesa-navidad-tradicional", "Centro de mesa Navidad tradicional: nochebuena roja, tallo verde en espiral y burbuja de confeti dorado", escena296,
    "Igual: el topiario de ~1,22 m (escala por la burbuja, 7,8 px/cm): la base de cuarteto R-5 Reflex Dorado con su cadena de burbujitas de T-260 dorado, la nochebuena de 5 pétalos R-12 Reflex Cristal Rojo con centro dorado, las dos ramitas de burbujitas de T-260 dorado, el tallo de T-260 Reflex Verde Lima en espiral (2,5 vueltas), el cuarteto de R-5 Reflex Cristal Rojo, el de R-9 Reflex Dorado, la burbuja de cristal con confeti dorado dentro y el lacito dorado arriba: los productos publicados. Distinto: la burbuja de la foto tiene remolinos blancos impresos: va el Graffiti Invierno Transparente (el más parecido) y el cristal liso publicado queda listado sin cantidad; los pétalos de la foto son de punta (pellizcados) y aquí redondos; el palo del centro va escondido.",
    [P_TRANSPARENTE, pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"), pub("GLOBO REDONDO REFLEX CRISTAL ROJO", "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", "R-12", "915"), pub("GLOBO TUBITO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-reflex-verde-lima", "T-260", "931"), pub("GLOBO TUBITO REFLEX DORADO", "/products/globo-para-fiesta-latex-tubito-reflex-dorado", "T-260", "970")]),
  idea(304, "centro-de-mesa-pascua", "Centro de mesa Pascua: pollito sobre nido trenzado y huevo de lunares", escena304,
    "Igual: el centro de ~98 cm (escala por el huevo, 8,5 px/cm): la base de dos cuartetos de R-5 de colores, el huevo R-12 Polka Blanco Verde Lima, el nido de dos T-260 Arena trenzados y el pollito armado con globos (cuerpo R-12 y cabeza R-9 amarillos, ojos R-5 blancos con pupila y pico R-5 naranja): los productos publicados (Polka Blanco Verde Lima, T-260 Arena). Distinto: la foto es un fotograma oscuro: los colores de la base son los medidos (Verde Selva 032, Azul Naval 044, Amarillo 020, Reflex Violeta 951, Metal Verde 530) y el cuarto globo de cada cuarteto, que no se ve, repite un color; el «Fashion Surtido» publicado no tiene código: queda listado sin cantidad (sus colores van lisos); el T-260 Amarillo publicado no se ve en la foto: listado sin cantidad; los ojos llevan pupila negra (en la foto, iris azul).",
    [pub("GLOBO TUBITO FASHION AMARILLO", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", "T-260", "020"), pub("GLOBO TUBITO FASHION ARENA", "/products/globo-para-fiesta-latex-tubito-fashion-arena", "T-260", "071"), pub("GLOBO REDONDO INFINITY® POLKA BLANCO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-infinity-polka-blanco-fashion-verde-lima", "R-12", null), pub("GLOBO REDONDO FASHION SURTIDO", "/products/globo-para-fiesta-latex-redondo-fashion-surtido", "R-12", null)]),
  idea(310, "centro-de-mesa-te-amo", "Centro de mesa Te amo: rizos lila y rosados, flores y moño con R-12 «Te amo»", escena310,
    "Igual: el centro de ~1,04 m (escala por el R-12 y el grueso del T-260, 5,2 px/cm): la base de 3 cuartetos de R-5 violeta, las ondas de T-260 lila de la izquierda, la espiral lila de dos lazos con su cola a la derecha, los dos lazos grandes de T-260 rosado fuerte al frente, la flor grande de 8 pétalos rosados y fucsia, la chica de 5 rosados (centros R-5 blancos), el moño rojo con centro blanco y el R-12 rojo en su palito blanco. Distinto: la idea no publica productos: los colores son los medidos (Fashion Lila 050, Neón Fucsia 212, Rosado 009, Fucsia 012, Violeta 051, Rojo 015); el «Te amo» con corazones no está en la tienda: va el I Love You Moderno rojo, el más parecido; los rizos son trazos planos de frente (en la foto tienen fondo).",
    []),
  idea(311, "centro-de-mesa-unicornio", "Centro de mesa unicornio: cabeza blanca con cuerno dorado y corona de flores y ramo de helio", escena311,
    "Igual: el unicornio armado con globos (escala por los R-12 de helio, 3,3 px/cm): base de cuarteto R-9 blanco, cabeza R-18 blanca con ojos cerrados y mejillas impresos, orejas de lazo de T-260 blanco, el cuerno de T-260 Metal Dorado retorcido y la corona de 5 florecitas de T-260 (amarilla, turquesa, fucsia, verde y lila); y el ramo de 5 R-12 de helio amarrado al cuerno, hasta ~1,66 m. Distinto: la idea no publica productos: los colores son los medidos (Amarillo 020, Neón Fucsia 212, Satín Lila 450, Rosado 009, Azul Caribe 038); los R-12 de la foto llevan unicornios, nubes y arcoíris impresos que la tienda no tiene: van lisos; los ojos cerrados con pestañas van como dos arcos impresos (el generador de caras no tiene pestañas); las orejas no llevan el rosado de dentro.",
    []),
  idea(323, "ciudad-comic", "Ciudad cómic: dos edificios de malla negra con ventanas de color, contorno blanco, «WOW» y bomba", escena323,
    "Igual: el mural de ~3,7 × 2,5 m (escala por la retícula de R-5, 1,78 px/cm): el edificio de la izquierda (malla de R-5 negros de 12 × 23 con su anexo) con 3 × 7 ventanas R-9 amarillas contadas, el de la derecha (torre de 9 × 25 con anexos a los lados) con 2 × 7 ventanas turquesa y una arriba, la antena de 5 R-5 negros, el contorno blanco de R-9 detrás (la nube de arriba a la izquierda, la banda y los lados), el «WOW» de T-260 amarillo, la bomba R-18 negra con su mecha de chispas y la dinamita de T-260 rojo: los productos publicados (Fashion Negro, Amarillo, Azul Caribe y Blanco). Distinto: las mallas son retículas simples de R-5 (en la foto, más apretadas e irregulares) y el contorno blanco es un borde de dos o tres globos (detrás de los edificios la foto no deja ver); las letras «WOW» son trazos aproximados; la mecha de la dinamita es de papel.",
    [pub("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"), pub("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020"), pub("GLOBO REDONDO FASHION AZUL CARIBE", "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", "R-12", "038"), pub("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005")]),
  idea(327, "cola-de-sirena", "Cola de sirena: columna orgánica violeta, lavanda y aguamarina con aletas de espiral plateada", escena327,
    "Igual: la cola de ~2,1 m (escala por los R-12 y el grueso del T-260, 4,4 px/cm): la columna orgánica cónica de ~61 cm de ancho abajo a ~23 cm arriba, de R-12 y R-9 Reflex Violeta, Pastel Dusk Lavanda, Fashion Lila y Aguamarina con R-5 Reflex Plata en los huecos, y las dos aletas de espiral cónica de T-260 Reflex Plata (15 vueltas hacia arriba y 13 hacia la derecha): los productos publicados. Distinto: lo orgánico lo da el motor con el grosor medido (16 R-12, 22 R-9 y 17 R-5 plata; en la foto se ven ~22 bolitas plateadas solo por delante y más R-12 que R-9) y no copia el sitio de cada color; el Reflex Plata se publica como R-12 y en la foto es R-5 y T-260 (mismo producto por color).",
    [pub("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951"), pub("GLOBO REDONDO PASTEL DUSK LAVANDA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-lavanda", "R-12", "150"), pub("GLOBO REDONDO FASHION LILA", "/products/globo-para-fiesta-latex-redondo-fashion-lila", "R-12", "050"), pub("GLOBO LATEX REDONDO FASHION AGUAMARINA", "/products/globo-para-fiesta-latex-redondo-fashion-aguamarina", "R-12", "037"), P_PLATA]),
  idea(343, "columna-baby-shower-pato", "Columna baby shower pato: columna azul de cuartetos rematada con un pato amarillo", escena343,
    "Igual: la columna de ~1,6 m (escala por los R-9 de la base, 3,3 px/cm): el cuarteto de R-9 azules de la base, los 6 cuartetos de R-5 azules contados, el cuarteto de R-9 de arriba, el de R-5 bajo el pato y el pato armado con globos: cuerpo y cabeza R-12 amarillos, ojos impresos, corbatín de 2 R-5 azul caribe, pico de dos lazos de T-260 naranja y alas de lazo de T-260 amarillo. Distinto: la idea no publica productos: los colores son los medidos (Fashion Azul 040, Azul Caribe 038, Amarillo Miel 021, Naranja 061); los R-9 de la foto llevan lunares y encaje blancos impresos que la tienda no tiene en azul: van lisos; el pato mira al frente (en la foto, de perfil hacia la derecha).",
    []),
  idea(345, "columna-bigotes", "Columna bigotes: señor de cuartetos azul rey con corbatín, cabeza de bigote y bombín", escena345,
    "Igual: la columna-personaje de ~1,31 m (escala por la cabeza R-12, 4,3 px/cm): el cuarteto de R-12 verde de la base, los 4 cuartetos de R-12 azul rey que se afinan hacia arriba (20, 18,5, 17 y 15 cm), el corbatín de cuarteto R-5 naranja, la cabeza R-12 verde con ojos y bigote impresos y el bombín de copa R-9 azul con ala de T-260 azul rey, inclinado. Distinto: la idea no publica productos: los colores son los medidos (Fashion Verde Trébol 029, Azul Rey 041, Naranja 061, Azul 040); los ojos y el bigote son los del generador de caras (en la foto, calcomanía); el bombín va a un lado de la cabeza como en la foto, pero su ala es un aro de tubito plano.",
    []),
];
