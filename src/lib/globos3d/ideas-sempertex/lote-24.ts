import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { coloresDelFormato, formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { AcabadoEscenografia, ElementoEscenografia, MotivoEscenografia } from "../escenografia";
import { platos, vasos } from "../utileria";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import type { ColorOrganico, OpcionesOrganico, PuntoGrosor, PuntoMezcla, RellenoOrganico, TramoOrganico } from "../organico";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion, PropiedadesFlorTubito } from "../figuras";
import type { Accesorio, Cara, PropiedadesFigura } from "../figuras-tubito";
import type { ParteTubito } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { PatronColumna } from "../columnas";
import type { OpcionesForma } from "../formas";
import type { Vec3 } from "../modulos";
import { centroCuerpo } from "../geometria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 24** (los números de `clasif/lote-24.json`): el arco de
 * teteros (#140), las escenas «Aurora Mist» (#157) y «Blue Tide» (#193) del Nacional 2025, el baby shower dorado y
 * rosado con la letra cursiva en la pared (#165), el bonsái cerezo (#195), los bouquets «Te amo» (#209) y tenebroso
 * (#210), la calabaza colorida (#228), la calabaza tenebrosa (#230), la calavera colorida (#234), la cartera fashion
 * (#253), el castillo de Enredados (#256), la catrina (#257) y los centros de mesa del ángel (#267) y de la araña (#268).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada con rejilla de
 * píxeles y medida:
 * - **Escala**: la de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-12 ≈ 25–28 cm, R-24 ≈ 55 cm, un
 *   metalizado de 18" ≈ 45 cm, una letra metalizada de 16" ≈ 38 cm de alto, el grueso de un Link-O-Loon 660 ≈ 13 cm).
 *   Las posiciones se escriben en el mundo con `foto(eje, piso, px/cm)`: x a la derecha del eje, y desde el piso.
 * - **Conteo**: niveles de las columnas, eslabones y uniones del arco, globos de helio, racimos de globitos metalizados,
 *   rizos, flores, patas… uno a uno, y lo que la técnica obliga detrás (el cuarto globo de un cuarteto). En lo orgánico
 *   (las paredes de #157 y #193, la copa del bonsái, las bases de los bouquets) el motor da los globos del grosor y el
 *   largo medidos (no se cuentan uno a uno: la nota lo dice). Ninguna idea publica «Materiales» con cantidades: lo
 *   contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana de un
 *   parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y el código más cercano que se fabrica en
 *   ese formato; en la foto de #165, con dominante naranja, después de equilibrar el blanco con un plato blanco.
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando la idea lo publica (terrazo azul de #193, araña
 *   transparente y monstruos de #210, metalizado acuarela de #157); si no, el más parecido del catálogo y la nota lo
 *   dice; lo que la tienda no tiene (la calabaza y las calaveras metalizadas, los cubos «Happy Halloween», el 660
 *   impreso) va genérico, sin producto.
 * - **Figuras de personaje** (la bruja de #210, la catrina, el ángel, las caras de calabaza): con globos reales —
 *   cabeza, cuerpo, rasgos de R-5, R-9 o T-260, caras impresas del generador de figuras— nunca con sólidos.
 * - **Montaje** (como los lotes 13, 20 y 23): cada estructura es su propio árbol. Su raíz es la estructura de globos
 *   (suelta, en su sitio); de la raíz cuelga (`sobre`) un **amarre** escondido (`oculto: true`: existe y da el marco,
 *   pero no se dibuja ni se compra) puesto en el piso bajo la estructura, donde no tiene globos debajo, y del amarre
 *   todo lo suyo, en el sitio exacto de la foto (también sus cintas de helio, sombreros y abanicos de papel y paneles
 *   de foil, que son de la estructura). Mesas, tortas, platos y papel de seda van aparte, sueltos.
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
const ABAJO = v(0, -1, 0);
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
    const p: Pieza = { tipo: "globo", formatoId: gl.formatoId, infladoCm: gl.infladoCm, codigo: gl.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
    pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
  };
  const deco = (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados = 0) => pieza(id, nombre, { tipo: "decoracion", decoracion }, origen, normal, giroGrados);
  return {
    nodos, amarre: idAmarre, pieza, globo, deco,
    conCara: (id, nombre, gl, centro, cara, queEs) => {
      // De pie y de frente (normal al frente): el +z de la figura sube y su +y mira a quien ve.
      const p: Pieza = { tipo: "decoracion", decoracion: figura({ cuerpo: [{ tipo: "globo", globo: gl, cara }], accesorios: [], queEs }) };
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

const escenaDe = (...montajes: Array<Montaje | NodoEscena[]>) => (s: Sala): Escena => ({ sala: s, nodos: montajes.flatMap((m) => (Array.isArray(m) ? m : m.nodos)) });


// ----------------------------------------------------------------------------------------------------------
// Ayudas del lote 24
// ----------------------------------------------------------------------------------------------------------

/** Nombre comercial de los códigos que usa el lote (para los nombres de los nodos). */
const NOMBRE: Readonly<Record<string, string>> = {
  "005": "Fashion Blanco", "009": "Fashion Rosado", "011": "Fashion Rosa", "012": "Fashion Fucsia", "014": "Fashion Frambuesa", "015": "Fashion Rojo",
  "018": "Fashion Merlot", "020": "Fashion Amarillo", "021": "Fashion Amarillo Miel", "023": "Fashion Mostaza", "029": "Fashion Verde Trébol",
  "031": "Fashion Verde Lima", "037": "Fashion Aguamarina", "038": "Fashion Azul Caribe", "040": "Fashion Azul", "044": "Fashion Azul Naval", "051": "Fashion Violeta",
  "056": "Fashion Orquídea Morada", "061": "Fashion Naranja", "071": "Fashion Arena", "080": "Fashion Negro", "110": "Pastel Dusk Rosa",
  "126": "Pastel Dusk Té Verde", "212": "Neón Fucsia", "240": "Neón Azul", "261": "Neón Naranja", "390": "Cristal Transparente", "409": "Satín Rosado",
  "450": "Satín Lila", "568": "Metal Dorado Rosa", "570": "Metal Dorado", "826": "Silk Verde Menta", "839": "Silk Azul Ártico",
  "880": "Silk Gris Medianoche", "931": "Reflex Verde Lima", "932": "Reflex Verde Aurora", "940": "Reflex Azul", "951": "Reflex Violeta",
  "968": "Reflex Dorado Rosa", "970": "Reflex Dorado", "981": "Reflex Plata",
};
const nombreDe = (codigo: string): string => NOMBRE[codigo] ?? codigo;

/** El centro de la caja de una pieza armada, en su espacio (para poner una esfera por su centro). */
function centroDe(pieza: Pieza): Vec3 {
  const k = armarPieza(pieza).caja;
  return v(r2((k.min.x + k.max.x) / 2), r2((k.min.y + k.max.y) / 2), r2((k.min.z + k.max.z) / 2));
}

/** Un globo de un ramo de helio: liso, impreso de la tienda o con cara (de pie y de frente). */
type GloboHelio = { id: string; nombre: string; globo: ParteGlobo; centro: Vec3; impresoId?: string; cara?: Cara; queEs?: string };

/**
 * Un ramo de helio amarrado a la estructura: cada globo en su sitio de la foto, mirando un poco hacia fuera del nudo,
 * y sus cintas (papel: no cotizan) del cuello de cada globo al nudo común, en una pieza aparte.
 */
function helio(m: Montaje, id: string, nombre: string, globos: readonly GloboHelio[], nudo: Vec3, hexCinta: string): void {
  const cintas: ElementoEscenografia[] = [];
  for (const h of globos) {
    const d = h.cara ? ARRIBA : unitario(v((h.centro.x - nudo.x) * 0.12, 1, (h.centro.z - nudo.z) * 0.12));
    if (h.cara) m.conCara(h.id, h.nombre, h.globo, h.centro, h.cara, h.queEs ?? "a balloon with a printed face");
    else m.globo(h.id, h.nombre, h.globo, h.centro, d, h.impresoId);
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

/** Un cono (sombrero de papel) de `base` hacia `eje`. */
function cono(base: Vec3, eje: Vec3, radioCm: number, altoCm: number, hex: string, acabado: AcabadoEscenografia = "papel"): ElementoEscenografia {
  const y = unitario(eje);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm, radioArribaCm: 0.6, hex, acabado, en: { origen: redondo(base), ejeX: redondo(x), ejeY: redondo(y) } };
}

/** Un metalizado en cubo (los «Happy Halloween» de #228), inclinado `grados` en el plano de frente. */
function cuboFoil(centro: Vec3, lado: number, hex: string, motivo: MotivoEscenografia, grados: number): ElementoEscenografia {
  const a = rad(grados);
  return { forma: "caja", centro: v(0, 0, 0), tamano: v(lado, lado, lado * 0.8), hex, acabado: "foil", motivo, en: { origen: redondo(centro), ejeX: v(r2(Math.cos(a)), r2(Math.sin(a)), 0), ejeY: v(r2(-Math.sin(a)), r2(Math.cos(a)), 0) } };
}

/** Un contorno girado `grados` alrededor de (0, 0) en su plano. */
const girarContorno = (puntos: ReadonlyArray<readonly [number, number]>, grados: number): Array<readonly [number, number]> =>
  puntos.map(([x, y]): readonly [number, number] => [r2(x * Math.cos(rad(grados)) - y * Math.sin(rad(grados))), r2(x * Math.sin(rad(grados)) + y * Math.cos(rad(grados)))]);

/** Silueta de calavera (cráneo ancho y mandíbula más angosta), de `ancho` × `alto`, centrada en (0, 0). */
function contornoCalavera(ancho: number, alto: number): Array<readonly [number, number]> {
  return Array.from({ length: 28 }, (_, i): readonly [number, number] => {
    const t = (2 * Math.PI * i) / 28;
    const s = Math.sin(t);
    // Abajo (la mandíbula) se angosta al 70 %.
    const k = s < 0 ? 1 - 0.3 * Math.min(1, -s * 1.4) : 1;
    return [r2((ancho / 2) * Math.cos(t) * k), r2((alto / 2) * s)];
  });
}

/** Silueta de calabaza (gajos marcados en el borde), de `ancho` × `alto`, centrada en (0, 0). */
function contornoCalabaza(ancho: number, alto: number): Array<readonly [number, number]> {
  return Array.from({ length: 40 }, (_, i): readonly [number, number] => {
    const t = (2 * Math.PI * i) / 40;
    const gajo = 1 - 0.05 * Math.abs(Math.cos(3 * t));
    return [r2((ancho / 2) * Math.cos(t) * gajo), r2((alto / 2) * Math.sin(t) * gajo)];
  });
}

/** Un abanico de papel (roseta plisada) de radio `radio`, centrado en (0, 0). */
const roseta = (radio: number): Array<readonly [number, number]> =>
  Array.from({ length: 32 }, (_, i): readonly [number, number] => {
    const r = i % 2 ? radio * 0.86 : radio;
    return [r2(r * Math.cos((2 * Math.PI * i) / 32)), r2(r * Math.sin((2 * Math.PI * i) / 32))];
  });

/** Un panel de papel (no cotiza) con su contorno de frente. */
const panelPapel = (contorno: ReadonlyArray<readonly [number, number]>, hex: string, motivo?: MotivoEscenografia): ElementoEscenografia => ({
  forma: "panel", contorno: contorno.map(([x, y]) => ({ x: r2(x), y: r2(y) })), zCm: -0.3, grosorCm: 0.6, hex, acabado: "papel", ...(motivo ? { motivo } : {}),
});

/** Mesa metálica de cubo (marco de barras y tapa de madera), apoyada en y = 0 y centrada. */
function mesaCubo(ancho: number, fondo: number, alto: number, hex: string): ElementoEscenografia[] {
  const a = ancho / 2 - 1, f = fondo / 2 - 1;
  const patas = [[-a, -f], [a, -f], [-a, f], [a, f]].map(([x, z]) => caja(v(x!, alto / 2, z!), v(2, alto, 2), hex, "metal"));
  const marco = [2, alto - 2].flatMap((y) => [caja(v(0, y, -f), v(ancho, 2, 2), hex, "metal"), caja(v(0, y, f), v(ancho, 2, 2), hex, "metal"), caja(v(-a, y, 0), v(2, 2, fondo), hex, "metal"), caja(v(a, y, 0), v(2, 2, fondo), hex, "metal")]);
  return [...patas, ...marco, caja(v(0, alto + 1.5, 0), v(ancho, 3, fondo), "#b98b5a", "madera")];
}

/** Mesa de alambre en reloj de arena (#193): aro de abajo, varillas cruzadas y tapa blanca. */
function mesaReloj(radio: number, alto: number): ElementoEscenografia[] {
  const varillas = Array.from({ length: 12 }, (_, k) => {
    const a = (2 * Math.PI * k) / 12, b = a + rad(150);
    return barra(v(r2(radio * 1.05 * Math.cos(a)), 1, r2(radio * 1.05 * Math.sin(a))), v(r2(radio * 0.9 * Math.cos(b)), alto - 3, r2(radio * 0.9 * Math.sin(b))), 0.5, "#c9ccd0", "metal");
  });
  return [cilindro(v(0, 0, 0), radio * 1.05, 2, "#c9ccd0", "metal"), ...varillas, cilindro(v(0, alto - 3, 0), radio, 3, "#f3f3f1", "mate")];
}

/** Torta de un piso con su cobertura y velitas, apoyada en y = 0. */
function torta(radio: number, alto: number, hex: string, cobertura: string, velas: number, hexVela: string): ElementoEscenografia[] {
  const v1 = Array.from({ length: velas }, (_, k) => cilindro(v(r2((k - (velas - 1) / 2) * 3), alto + 2, 0), 0.5, 9, hexVela, "mate"));
  return [cilindro(v(0, 0, 0), radio, alto, hex, "mate"), cilindro(v(0, alto - 3, 0), radio + 0.4, 5, cobertura, "brillante"), ...v1];
}

/** Puntos (en el mundo) a lo largo de una línea quebrada, cada `pasoCm`, desde el primero. */
function aLoLargo(puntos: readonly Vec3[], pasoCm: number): Array<{ p: Vec3; t: Vec3 }> {
  const salida: Array<{ p: Vec3; t: Vec3 }> = [];
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i]!, b = puntos[i + 1]!;
    const d = menos(b, a), L = largo(d), t = unitario(d);
    const n = Math.max(1, Math.round(L / pasoCm));
    for (let s = 0; s < n; s++) salida.push({ p: redondo(mas(a, por(d, s / n))), t });
  }
  salida.push({ p: puntos[puntos.length - 1]!, t: unitario(menos(puntos[puntos.length - 1]!, puntos[puntos.length - 2]!)) });
  return salida;
}

/** Una flor de tubito de pétalos en burbuja (las de la corona de la catrina y las de la trenza de Rapunzel). */
const florBurbuja = (formatoId: string, grosorCm: number, codigo: string, petalos: number, largoCm: number, centro: ParteGlobo | null): Decoracion => ({
  tipo: "flor_tubito",
  propiedades: { petalos: { formatoId, grosorCm, codigos: [codigo], cantidad: petalos, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados: 10, giroGrados: 90 }, interior: null, corona: null, centro },
});

/** Un punto sobre la cara de delante de una esfera de centro `c` y radio `radio`, a la altura y la x de la foto. */
const sobreEsfera = (c: Vec3, radio: number, p: Vec3, fuera = 0): Vec3 => {
  const dx = p.x - c.x, dy = p.y - c.y;
  return v(p.x, p.y, r2(c.z + Math.sqrt(Math.max(0, radio * radio - dx * dx - dy * dy)) + fuera));
};

const IMPRESO_CONFETI = "infinity-confetti-dorado-fashion-transparente";
const IMPRESO_HALLOWEEN = "2-caras-happy-halloween-fashion-surtido-negro-naranja";

// ----------------------------------------------------------------------------------------------------------
// 140 · Arco teteros
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (recortada, sin fondo). Escala por el arco: de unión a unión hay ~72 px y un eslabón de Link-O-Loon
 * 12 mide 1,47 inflados de nudo a nudo: inflado de ~49 px = 24,5 cm → 2 px/cm, que da los globos lila de ~50 px como
 * R-12 a 25 cm y las uniones de ~22 px como R-5 a 11 cm. Piso en y = 545 px; ejes de las columnas en x = 108 y 628
 * (2,6 m entre ejes). Cada columna: 6 cuartetos R-12 lila (filas de 305 a 545 px: 1,2 m), la rosca de un cuarteto R-12
 * blanco (centro a 285 px: 130 cm) y el chupo, un globo cristal de ~95 px de ancho (R-18 a 44 cm) con la boca hacia
 * arriba hasta ~2,07 m. El arco: 7 eslabones rosados entre 8 uniones contadas (lila, arena, lila…), cada unión con 4
 * globitos (2 arriba y 2 abajo), de chupo a chupo, que sube de ~2,1 m a ~2,5 m. Medidos: lila perlado #c4a9dc →
 * Satín Lila 450 (ΔE 7); eslabones #f9c9d5 → Pastel Dusk Rosa 110 (ΔE 7); uniones lila #e79bb9 → Satín Rosado 409
 * (ΔE 4) y amarillas #dec9aa → Fashion Arena 071 (ΔE 2); blanco 005; chupo cristal 390.
 */
const escena140 = (): Escena => {
  const LILA = "450", BLANCO = "005", CRISTAL = "390", ROSA = "110", UNION_LILA = "409", UNION_ARENA = "071";
  const f = foto(368, 545, 2);
  const tetero = (id: string, lado: string, px: number): Montaje => {
    const x = f(px, 545).x;
    const m = montaje({ id, nombre: `Columna ${lado}: 6 cuartetos R-12 Satín Lila`, pieza: columna(R("R-12", 25, LILA), 6, [LILA]), origen: v(x, 12.5, 0) }, v(x, 0, 0));
    m.nivel(`${id}-rosca`, `Tetero ${lado}: cuarteto R-12 Fashion Blanco (la rosca)`, cuarteto(R("R-12", 26, BLANCO), [BLANCO]), v(x, 130, 0), 45);
    m.globo(`${id}-chupo`, `Tetero ${lado}: chupo de R-18 Cristal Transparente con la boca hacia arriba`, R("R-18", 44, CRISTAL), v(x, 166, 0), ABAJO);
    return m;
  };
  const izq = tetero("columna-izquierda", "izquierda", 108);
  const der = tetero("columna-derecha", "derecha", 628);
  // El arco: de chupo a chupo, amarrado a la columna izquierda (la idea lo arma sobre las dos).
  const UNIONES: ReadonlyArray<readonly [number, number]> = [[120, 125], [185, 90], [260, 62], [335, 45], [405, 38], [475, 45], [555, 68], [625, 120]];
  const p = UNIONES.map(([x, y]) => f(x, y, 0));
  for (let k = 0; k < p.length - 1; k++) {
    const a = p[k]!, b = p[k + 1]!;
    izq.globo(`eslabon-${k + 1}`, `Arco: eslabón ${k + 1} de Link-O-Loon 12 Pastel Dusk Rosa`, R("LOL-12", 24, ROSA), redondo(por(mas(a, b), 0.5)), unitario(menos(b, a)));
  }
  p.forEach((q, k) => {
    const t = unitario(menos(p[Math.min(p.length - 1, k + 1)]!, p[Math.max(0, k - 1)]!));
    const n = v(-t.y, t.x, 0);
    const codigo = k % 2 ? UNION_ARENA : UNION_LILA;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([s, l], j) => {
      const d = unitario(mas(por(n, s! * Math.cos(rad(28))), por(t, l! * Math.sin(rad(28)))));
      izq.globo(`union-${k + 1}-${j + 1}`, `Arco: unión ${k + 1}, R-5 ${nombreDe(codigo)} ${j + 1}`, R("R-5", 11, codigo), redondo(mas(q, por(d, 6))), d);
    });
  });
  return escenaDe(izq, der)(sala(380, 240, 290, { piso: "#efeaee", paredes: "#f8f6f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 157 · Aurora Mist Nacional 2025
// ----------------------------------------------------------------------------------------------------------

/**
 * Render de 1000×1000 recortado. Escala por los metalizados redondos de 18" (~135 px = 45 cm): 3 px/cm, piso en
 * y = 935 px (las patas de las mesas), eje en x = 500. La pared de R-12 Reflex Violeta en retícula (~70 px: 24–25 cm,
 * filas alineadas) se ve de x = 300 a 760 px y de 115 px hacia abajo (hasta 2,73 m): 10 × 12 globos a 25 cm, que siguen
 * detrás de las columnas. A la izquierda la columna orgánica Azul Caribe de ~0,8 m de ancho hasta ~2,98 m con su R-24
 * del pie (~170 px); a la derecha la de Orquídea Morada hasta ~3 m con dos R-18; abajo, entre las mesas, la base
 * orgánica Reflex Verde Aurora de x = 270 a 720 px y de 28 a 125 cm. Cuatro metalizados redondos de 18": tres
 * «Feliz Cumpleaños» acuarela y uno «Happy Birthday» de arcoíris, con su borde de perlas impreso. Las mesas metálicas
 * amarilla (tapa a 1,25 m) y rosada (1,17 m), la torta de goteo, platos de arcoíris y vasos. Colores: los publicados
 * (Reflex Violeta 951, Orquídea Morada 056, Reflex Verde Aurora 932, Azul Caribe 038).
 */
const escena157 = (): Escena => {
  const VIOLETA = "951", ORQUIDEA = "056", AURORA = "932", CARIBE = "038";
  const f = foto(500, 935, 3);
  const Z = -45;
  const filas = Array.from({ length: 12 }, () => "a".repeat(10));
  const pared: Pieza = { tipo: "mural", mural: { matriz: { colores: [VIOLETA], filas }, disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 25 }, chico: null } };
  const mp = montaje({ id: "pared", nombre: "Pared de 10 × 12 R-12 Reflex Violeta en retícula", pieza: pared, origen: v(10, 0, -90) }, v(10, 0, -70));
  const izq = organico([{ id: "caribe", nombre: "Columna Azul Caribe", irregularidad: 0.2, puntos: [v(-108, 32, Z), v(-104, 100, Z), v(-100, 170, Z), v(-95, 232, Z), v(-90, 278, Z)], grosor: grosor(42, 36), mezcla: mezcla({ "R-18": 0.12, "R-12": 0.72, "R-9": 0.16 }) }],
    { colores: [color(CARIBE, 1)], semilla: 157, relleno: RELLENO_12_9 });
  const mi = montaje({ id: "organico-izquierdo", nombre: "Columna orgánica Fashion Azul Caribe (izquierda)", pieza: izq.pieza, origen: izq.origen }, v(-106, 0, 5));
  mi.globo("r24-caribe", "R-24 Fashion Azul Caribe del pie", R("R-24", 55, CARIBE), f(190, 600, -18), unitario(v(0.3, 0.6, 0.6)));
  mi.foil("happy-birthday", "Metalizado redondo «Happy Birthday» de arcoíris de 18\" (sin producto)", { forma: { tipo: "redondo" }, pulgadas: 18, color: "plata", impreso: { dibujo: "texto", texto: "Happy\nBirthday", hex: "#e2468a" } }, f(175, 185, 4));
  mi.foil("acuarela-izquierda", "Metalizado «Feliz Cumpleaños» acuarela de 18\" (izquierda)", metalizadoDeTienda("acuarela"), f(145, 380, 4));
  const der = organico([{ id: "orquidea", nombre: "Columna Orquídea Morada", irregularidad: 0.2, puntos: [v(88, 32, Z), v(90, 100, Z), v(88, 170, Z), v(85, 235, Z), v(82, 282, Z)], grosor: grosor(40, 34), mezcla: mezcla({ "R-18": 0.12, "R-12": 0.73, "R-5": 0.15 }) }],
    { colores: [color(ORQUIDEA, 1)], semilla: 158, relleno: RELLENO_12_5 });
  const md = montaje({ id: "organico-derecho", nombre: "Columna orgánica Fashion Orquídea Morada (derecha)", pieza: der.pieza, origen: der.origen }, v(88, 0, 5));
  md.globo("r18-arriba", "R-18 Fashion Orquídea Morada de arriba", R("R-18", 34, ORQUIDEA), f(745, 75, -30), unitario(v(0.2, 1, 0.3)));
  md.globo("r18-abajo", "R-18 Fashion Orquídea Morada de abajo", R("R-18", 38, ORQUIDEA), f(760, 505, -12), unitario(v(0.4, 0.4, 0.8)));
  md.foil("acuarela-arriba", "Metalizado «Feliz Cumpleaños» acuarela de 18\" (derecha, arriba)", metalizadoDeTienda("acuarela"), f(740, 195, 4));
  md.foil("acuarela-abajo", "Metalizado «Feliz Cumpleaños» acuarela de 18\" (derecha, abajo)", metalizadoDeTienda("acuarela"), f(730, 385, 4));
  const base = organico([{ id: "aurora", nombre: "Base Reflex Verde Aurora", irregularidad: 0.2, puntos: [v(-75, 74, Z), v(-35, 70, Z), v(0, 68, Z), v(35, 70, Z), v(73, 74, Z)], grosor: grosor(44, 44), mezcla: mezcla({ "R-18": 0.22, "R-12": 0.68, "R-5": 0.1 }) }],
    { colores: [color(AURORA, 1)], semilla: 159, relleno: RELLENO_12_5 });
  const mb = montaje({ id: "base", nombre: "Base orgánica Reflex Verde Aurora (entre las mesas)", pieza: base.pieza, origen: base.origen }, v(0, 0, 5));
  const mesas: NodoEscena[] = [
    suelto("mesa-amarilla", "Mesa metálica amarilla", escenografia(mesaCubo(63, 45, 125, "#f2c81e")), -46, 0, 25),
    suelto("mesa-rosada", "Mesa metálica rosada", escenografia(mesaCubo(57, 45, 117, "#ef4d6b")), 27, 0, 30),
    suelto("torta", "Torta de goteo con velas sobre su base", escenografia([cilindro(v(0, 0, 0), 9, 10, "#e8478a", "metal", 4), ...torta(13, 18, "#f6efe8", "#4a2c1d", 3, "#ef5aa0").map((e) => (e.forma === "cilindro" ? { ...e, base: v(e.base.x, e.base.y + 10, e.base.z) } : e))]), -40, 128, 25),
    suelto("platos-arcoiris", "Platos de arcoíris de pie", platos({ cantidad: 1, diametroCm: 24, hex: "#e93b7d", centro: "#f2a33b", motivo: { dibujo: "texto", texto: "FELIZ", hex: "#ffffff" }, dePie: true, productoId: null, descripcion: "plato de arcoíris «Feliz cumpleaños»" }), -64, 128, 18),
    suelto("plato-rosado", "Plato fucsia de pie", platos({ cantidad: 1, diametroCm: 24, hex: "#e93b7d", centro: "#d9dde3", dePie: true, productoId: null, descripcion: "plato fucsia y plata" }), 34, 120, 22),
    suelto("vasos", "Vasos fucsia con servilleta lila", vasos({ cantidad: 2, altoCm: 10, diametroCm: 7, hex: "#e93b7d", servilleta: "#a77ad6", productoId: null, descripcion: "vasos fucsia" }), 42, 120, 36),
  ];
  return escenaDe(mp, mi, md, mb, mesas)(sala(360, 260, 320, { piso: "#efede9", paredes: "#f8f7f5" }));
};

// ----------------------------------------------------------------------------------------------------------
// 165 · Baby shower dorado y rosado
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 con dominante naranja (la pared del salón sale salmón); se equilibró el blanco con un plato blanco
 * de la mesa (#f2b5a2). Escala por la estrella metalizada de 18" (~69 px de ancho ≈ 50 cm): 1,4 px/cm, piso en
 * y = 445 px, eje en x = 375 (centro de la pared). La pared (de x = 150 a 600 px y de 120 px al piso: ~3,2 × 2,3 m) es
 * un tablero de globos rosados perlados de ~22 px (R-9 a 16 cm) con R-5 (~12 px, 9 cm) en los huecos: 28 × 20
 * celdas. Encima, la letra cursiva («ℰ») de R-5 dorados de ~10 px (7,5 cm), dos hileras a lo largo del trazo, y dos
 * cadenas verticales de 9 globos con confeti dorado (~22 px: R-12 a 17 cm) en x = 175 y 570 px, cada ~34 px. A cada
 * lado una columna: base de globitos, palo forrado de tubito blanco y rosado en espiral, un racimo de globitos a 71 cm,
 * el cuarteto de globos con confeti dorado (centro a 131 cm), el de R-9 rosados (155 cm) y la estrella dorada
 * (193 cm). Delante, la mesa de postres de mantel a cuadros. Medidos (equilibrados): rosado #ffb7d0 → Satín Rosado 409
 * (ΔE 6,4; el Fashion Rosado 009 queda a 5,8 pero la pared es perlada); dorado #ffed83 → Metal Dorado 570 (ΔE 23, el
 * dorado más cercano); palo blanco #edffff → Fashion Blanco 005.
 */
const escena165 = (): Escena => {
  const ROSADO = "409", ORO = "570", CRISTAL = "390", BLANCO = "005";
  const f = foto(375, 445, 1.4);
  const COLUMNAS = 28, FILAS = 20, PASO = 11.25, ABAJO_MURAL = 8;
  /** Del mundo a la celda (columna, fila) del mural, con su centro en x = 0. */
  const celda = (q: Vec3): [number, number] => [r2(q.x / PASO + (COLUMNAS - 1) / 2), r2(FILAS - 1 - (q.y - ABAJO_MURAL) / PASO)];
  const TRAZO_E: ReadonlyArray<readonly [number, number]> = [
    [430, 165], [415, 143], [390, 140], [368, 155], [360, 180], [372, 205], [395, 220], [405, 232], [385, 245], [355, 258], [335, 268], [348, 252], [362, 262],
    [352, 280], [330, 282], [305, 295], [287, 322], [292, 352], [318, 372], [355, 372], [383, 352], [392, 325], [378, 305], [355, 300],
  ];
  const letra: Array<[number, number]> = [];
  for (const { p, t } of aLoLargo(TRAZO_E.map(([x, y]) => f(x, y)), 6.5)) {
    const n = v(-t.y, t.x, 0);
    for (const s of [-1, 1]) letra.push(celda(mas(p, por(n, s * 3.4))));
  }
  const cadena = (px: number): Array<[number, number]> => Array.from({ length: 9 }, (_, k) => celda(f(px, 125 + 34 * k)));
  const pared: Pieza = {
    tipo: "mural",
    mural: {
      matriz: { colores: [ROSADO], filas: Array.from({ length: FILAS }, () => "a".repeat(COLUMNAS)) }, disposicion: "tablero",
      grande: { formatoId: "R-9", infladoCm: 16 }, chico: { formatoId: "R-5", infladoCm: 9 },
      encima: [{ formatoId: "R-12", infladoCm: 17, codigo: CRISTAL, puntos: [...cadena(175), ...cadena(570)] }, { formatoId: "R-5", infladoCm: 7.5, codigo: ORO, puntos: letra }],
    },
    impresos: [{ impresoId: IMPRESO_CONFETI, codigo: CRISTAL }],
  };
  const mp = montaje({ id: "pared", nombre: "Pared de tablero R-9 y R-5 Satín Rosado con la letra cursiva de R-5 Metal Dorado", pieza: pared, origen: v(0, 0, -105) }, v(0, 0, -85));
  const columna165 = (id: string, lado: string, px: number): Montaje => {
    const x = f(px, 445).x, z = -60;
    const m = montaje({ id, nombre: `Columna ${lado}: base de cuarteto R-5 Satín Rosado y Metal Dorado`, pieza: cuarteto(R("R-5", 11, ROSADO), [ROSADO, ORO], "dos_colores"), origen: v(x, 5.5, z) }, v(x, 0, z));
    for (const [c, giro] of [[BLANCO, 0], [ROSADO, 180]] as const) {
      m.deco(`${id}-palo-${c}`, `Columna ${lado}: palo forrado de T-260 ${nombreDe(c)} en espiral`, rizo({ forma: "resorte", tubito: T("T-260", 3, c), vueltas: 9, radioCm: 2.2, largoCm: 106, eje: "frente", giroGrados: giro }), v(x, 11, z), ARRIBA);
    }
    m.nivel(`${id}-medio`, `Columna ${lado}: cuarteto R-5 Satín Rosado y Metal Dorado del medio`, cuarteto(R("R-5", 11, ROSADO), [ROSADO, ORO], "dos_colores"), v(x, 71, z), 45);
    m.nivel(`${id}-confeti`, `Columna ${lado}: cuarteto R-12 con confeti dorado`, cuarteto(R("R-12", 27, CRISTAL), [CRISTAL], "un_color", [{ impresoId: IMPRESO_CONFETI, codigo: CRISTAL }]), v(x, 131, z), 0);
    m.nivel(`${id}-rosado`, `Columna ${lado}: cuarteto R-9 Satín Rosado`, cuarteto(R("R-9", 20, ROSADO), [ROSADO]), v(x, 155, z), 45);
    m.foil(`${id}-estrella`, `Columna ${lado}: estrella metalizada dorada de 18"`, metalizadoDeTienda("estrella-dorado-mate"), v(x, 193, z));
    return m;
  };
  const ci = columna165("columna-izquierda", "izquierda", 115);
  const cd = columna165("columna-derecha", "derecha", 650);
  const mesa: NodoEscena[] = [
    suelto("mesa", "Mesa de postres con mantel rosado a cuadros", escenografia([caja(v(0, 27, 0), v(250, 54, 70), "#f6dfe6", "tela")]), 7, 0, -20),
    suelto("bases-cupcakes-izquierda", "Base de cupcakes de tres pisos (izquierda)", escenografia([0, 1, 2].flatMap((k) => [cilindro(v(0, k * 10, 0), 14 - k * 3, 1, "#b88a3e", "madera"), cilindro(v(0, k * 10, 0), 0.8, 10, "#b88a3e", "madera")])), -86, 54, -25),
    suelto("bases-cupcakes-derecha", "Base de cupcakes de tres pisos (derecha)", escenografia([0, 1, 2].flatMap((k) => [cilindro(v(0, k * 10, 0), 14 - k * 3, 1, "#b88a3e", "madera"), cilindro(v(0, k * 10, 0), 0.8, 10, "#b88a3e", "madera")])), 46, 54, -25),
    suelto("platos", "Platos y tazones blancos con pasabocas", platos({ cantidad: 6, diametroCm: 20, hex: "#fbfbfb", centro: "#f2c27a", productoId: null, descripcion: "platos blancos" }), -20, 54, 0),
  ];
  return escenaDe(mp, ci, cd, mesa)(sala(460, 280, 270, { piso: "#e6d6cf", paredes: "#f1e2da" }));
};

// ----------------------------------------------------------------------------------------------------------
// 193 · Blue Tide Nacional 2025
// ----------------------------------------------------------------------------------------------------------

/**
 * Render de 1000×1000 recortado. Escala por los R-12 del ramo de helio (~95 px = 28 cm): 3,4 px/cm, piso en
 * y = 850 px (los aros de las mesas), eje en x = 575 (centro de la pared). La pared orgánica va de x = 200 a 950 px
 * (~2,2 m) y de 770 a 180 px (de 23 cm a 1,97 m), en cinco franjas de abajo arriba: Reflex Azul con Silk Azul Ártico
 * (R-12, R-9 y R-5: 23–68 cm), Azul Naval (R-18 y R-12: 62–103 cm), Reflex Plata menuda (R-9 y R-5: 100–129 cm),
 * Reflex Verde Aurora con R-18 grandes (~130 px: 126–170 cm) y Pastel Dusk Té Verde con Silk Verde Menta (R-12 y R-5:
 * 167–197 cm). A la izquierda el ramo de helio: 6 R-12 —3 impresos «Feliz cumpleaños» terrazo azul y 3 plateados—
 * amarrados a una pesa de 3 cuartetos R-5 Reflex Azul (~45 px: 12–13 cm). Delante, las tres mesas de alambre en
 * reloj de arena (tapas a 76, 62 y 84 cm) con la torta, platos y vasos azules. Colores: los publicados; el impreso
 * terrazo de la tienda (surtido 042, 041 y 044) va en 044, el más oscuro (la foto lo da turquesa profundo #035471);
 * los plateados del ramo, que la idea no publica, #a7baca → Reflex Plata 981 (ΔE 11; el Satín Azul 440 queda igual).
 */
const escena193 = (): Escena => {
  const TE = "126", MENTA = "826", AURORA = "932", PLATA = "981", NAVAL = "044", AZUL = "940", ARTICO = "839";
  const TERRAZO = "infinity-feliz-cumpleanos-terrazo-azul-fashion-surtido";
  const f = foto(575, 850, 3.4);
  const Z = -70;
  const franja = (y: number): Vec3[] => [v(-106, y + 2, Z), v(-53, y - 2, Z), v(0, y + 1, Z), v(53, y - 2, Z), v(106, y + 1, Z)];
  const abajo = organico([{ id: "azul", nombre: "Franja Reflex Azul y Silk Azul Ártico", irregularidad: 0.22, puntos: franja(45), grosor: grosor(24, 24), mezcla: mezcla({ "R-12": 0.35, "R-9": 0.2, "R-5": 0.45 }) }],
    { colores: [color(AZUL, 0.55), color(ARTICO, 0.45)], semilla: 193, relleno: RELLENO_12_5 });
  const m = montaje({ id: "pared", nombre: "Pared orgánica Blue Tide: franja de abajo Reflex Azul y Silk Azul Ártico", pieza: abajo.pieza, origen: abajo.origen }, v(0, 0, -30));
  m.organico("franja-naval", "Pared orgánica: franja Fashion Azul Naval", [{ id: "naval", nombre: "Naval", irregularidad: 0.22, puntos: franja(82), grosor: grosor(21, 21), mezcla: mezcla({ "R-18": 0.22, "R-12": 0.6, "R-5": 0.18 }) }],
    { colores: [color(NAVAL, 1)], semilla: 194, relleno: RELLENO_12_5 });
  m.organico("franja-plata", "Pared orgánica: franja Reflex Plata", [{ id: "plata", nombre: "Plata", irregularidad: 0.22, puntos: franja(114), grosor: grosor(15, 15), mezcla: mezcla({ "R-12": 0.12, "R-9": 0.3, "R-5": 0.58 }) }],
    { colores: [color(PLATA, 1)], semilla: 195, relleno: RELLENO_12_5 });
  m.organico("franja-aurora", "Pared orgánica: franja Reflex Verde Aurora", [{ id: "aurora", nombre: "Aurora", irregularidad: 0.22, puntos: franja(148), grosor: grosor(23, 23), mezcla: mezcla({ "R-18": 0.32, "R-12": 0.5, "R-5": 0.18 }) }],
    { colores: [color(AURORA, 1)], semilla: 196, relleno: RELLENO_12_5 });
  m.organico("franja-te", "Pared orgánica: franja Pastel Dusk Té Verde y Silk Verde Menta", [{ id: "te", nombre: "Té verde", irregularidad: 0.22, puntos: franja(182), grosor: grosor(16, 16), mezcla: mezcla({ "R-12": 0.42, "R-5": 0.58 }) }],
    { colores: [color(TE, 0.6), color(MENTA, 0.4)], semilla: 197, relleno: RELLENO_12_5 });
  const xp = f(130, 850).x;
  const ramo = montaje({ id: "ramo", nombre: "Ramo de helio: pesa de 3 cuartetos R-5 Reflex Azul", pieza: columna(R("R-5", 12, AZUL), 3, [AZUL]), origen: v(xp, 6, 10) }, v(xp, 0, 10));
  helio(ramo, "cintas", "Ramo de helio: cintas azules", [
    { id: "terrazo-1", nombre: "R-12 «Feliz cumpleaños» terrazo azul (arriba a la izquierda)", globo: R("R-12", 28, NAVAL), centro: v(-146, 162, 4), impresoId: TERRAZO },
    { id: "plata-1", nombre: "R-12 Reflex Plata (arriba)", globo: R("R-12", 28, PLATA), centro: v(-121, 172, -4), },
    { id: "plata-2", nombre: "R-12 Reflex Plata (en medio)", globo: R("R-12", 28, PLATA), centro: v(-121, 143, 8) },
    { id: "terrazo-2", nombre: "R-12 «Feliz cumpleaños» terrazo azul (detrás)", globo: R("R-12", 28, NAVAL), centro: v(-140, 135, -10), impresoId: TERRAZO },
    { id: "plata-3", nombre: "R-12 Reflex Plata (abajo)", globo: R("R-12", 28, PLATA), centro: v(-137, 116, 6) },
    { id: "terrazo-3", nombre: "R-12 «Feliz cumpleaños» terrazo azul (abajo a la derecha)", globo: R("R-12", 28, NAVAL), centro: v(-116, 100, 12), impresoId: TERRAZO },
  ], v(xp, 33, 10), "#7fb7d9");
  const mesas: NodoEscena[] = [
    suelto("mesa-izquierda", "Mesa de alambre en reloj de arena (izquierda)", escenografia(mesaReloj(21, 76)), -69, 0, 15),
    suelto("mesa-centro", "Mesa de alambre en reloj de arena (centro)", escenografia(mesaReloj(21, 62)), -10, 0, 25),
    suelto("mesa-derecha", "Mesa de alambre en reloj de arena (derecha)", escenografia(mesaReloj(21, 84)), 50, 0, 15),
    suelto("torta", "Torta sobre su base de pie", escenografia([cilindro(v(0, 0, 0), 9, 18, "#9fd6dc", "mate", 3), ...torta(12, 10, "#d79a52", "#f0d9a8", 4, "#3a6fd8").map((e) => (e.forma === "cilindro" ? { ...e, base: v(e.base.x, e.base.y + 18, e.base.z) } : e))]), -10, 62, 25),
    suelto("platos-izquierda", "Platos azules de pie (izquierda)", platos({ cantidad: 2, diametroCm: 20, hex: "#2c5fd0", centro: "#9cc6ee", motivo: { dibujo: "lunares", hex: "#ffffff" }, dePie: true, productoId: null, descripcion: "platos azules" }), -72, 76, 8),
    suelto("platos-derecha", "Platos azules de pie (derecha)", platos({ cantidad: 2, diametroCm: 20, hex: "#2c5fd0", centro: "#9cc6ee", dePie: true, productoId: null, descripcion: "platos azules" }), 52, 84, 8),
    suelto("vasos", "Vasos azules con servilleta", vasos({ cantidad: 2, altoCm: 10, diametroCm: 7, hex: "#2c5fd0", servilleta: "#9cc6ee", productoId: null, descripcion: "vasos azules" }), -20, 62, 30),
  ];
  return escenaDe(m, ramo, mesas)(sala(360, 260, 260, { piso: "#eceef0", paredes: "#f7f8f9" }));
};

// ----------------------------------------------------------------------------------------------------------
// 195 · Bonsái cerezo
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 800×600 (fondo blanco). Escala por los R-24 de la copa (~110–120 px = 55 cm): 2 px/cm, piso en y = 590 px,
 * eje del tronco en x = 398. El tronco: columna de 7 cuartetos R-12 Reflex Dorado (~140 px de ancho) hasta ~1,5 m,
 * forrado con T-260 dorados enrollados en diagonal (se cuentan ~8 vueltas); a los lados las raíces de R-5 dorados en el
 * piso (de x = 228 a 568 px), ~24 por lado y ~10 al pie. La copa orgánica de ~2,9 m de ancho y de 1,3 m a 2,9 m, de
 * R-12, R-9 y R-5 Frambuesa, Fucsia, Rosado y Rojo, con los 4 R-24 de arriba (frambuesa, fucsia, rojo y rosado) en sus
 * sitios, 6 racimos de 4 R-5 dorados metidos en la copa, 4 colgantes de R-5 (frambuesa de 3, rosados de 4 y rojo de 4)
 * y los dos abanicos de papel rojos con corazón. Colores: los publicados (Frambuesa 014, Fucsia 012, Rosado 009,
 * Reflex Dorado 970 en R-12 y en T-260); el rojo, que no publica, #c40237 → Fashion Rojo 015 (ΔE 18; el Metal Rojo 515
 * queda a 10 pero la foto es mate y no se hace en R-24).
 */
const escena195 = (): Escena => {
  const ORO = "970", FRAMBUESA = "014", FUCSIA = "012", ROSADO = "009", ROJO = "015";
  const f = foto(398, 590, 2);
  const m = montaje({ id: "tronco", nombre: "Bonsái: tronco de 7 cuartetos R-12 Reflex Dorado", pieza: columna(R("R-12", 25, ORO), 7, [ORO]), origen: v(0, 12.5, 0) }, v(0, 0, 0));
  for (let k = 0; k < 8; k++) {
    m.deco(`envoltura-${k + 1}`, `Tronco: T-260 Reflex Dorado enrollado ${k + 1}`, rizo({ forma: "resorte", tubito: T("T-260", 4.5, ORO), vueltas: 0.64, radioCm: 29, largoCm: 20, eje: "frente", giroGrados: k * 65 }), v(0, 8 + k * 16, 0), ARRIBA);
  }
  // Las raíces: cuatro hileras de R-5 dorados a cada lado y el racimo del pie.
  const HILERAS: ReadonlyArray<readonly [number, number, number, number]> = [[8, 10, -4, 30], [7, 18, -2, 34], [5, 26, 0, 38], [4, 10, 8, 36]];
  for (const [s, lado] of [[-1, "izquierda"], [1, "derecha"]] as const) {
    let n = 0;
    for (const [cuantos, y, z, x0] of HILERAS) {
      for (let i = 0; i < cuantos; i++) {
        n++;
        m.globo(`raiz-${lado}-${n}`, `Raíz ${lado}: R-5 Reflex Dorado ${n}`, R("R-5", 11, ORO), v(r2(s * (x0 + i * 9)), y, z), unitario(v(s * 0.3, 1, 0.3)));
      }
    }
  }
  for (let i = 0; i < 10; i++) m.globo(`raiz-pie-${i + 1}`, `Raíz del pie: R-5 Reflex Dorado ${i + 1}`, R("R-5", 11, ORO), v(r2(-18 + (i % 5) * 9), i < 5 ? 10 : 18, i < 5 ? 30 : 27), unitario(v(0, 0.6, 1)));
  m.organico("copa", "Copa orgánica: Frambuesa, Fucsia, Rosado y Rojo", [
    { id: "copa", nombre: "Copa", irregularidad: 0.22, puntos: [v(-120, 185, 0), v(-60, 200, 0), v(0, 205, 0), v(60, 200, 0), v(122, 190, 0)], grosor: grosor(48, 46), mezcla: mezcla({ "R-12": 0.55, "R-9": 0.3, "R-5": 0.15 }) },
    { id: "copa-arriba", nombre: "Copa (arriba)", irregularidad: 0.22, puntos: [v(-90, 232, -5), v(0, 245, -5), v(95, 236, -5)], grosor: grosor(32, 30), mezcla: mezcla({ "R-12": 0.6, "R-9": 0.3, "R-5": 0.1 }) },
  ], { colores: [color(FRAMBUESA, 0.25), color(FUCSIA, 0.25), color(ROSADO, 0.3), color(ROJO, 0.2)], semilla: 195, relleno: RELLENO_12_9 });
  const GRANDES: ReadonlyArray<readonly [string, string, number, number, number]> = [["frambuesa", FRAMBUESA, 170, 120, 10], ["fucsia", FUCSIA, 395, 60, 0], ["rojo", ROJO, 510, 55, -5], ["rosado", ROSADO, 620, 115, 8]];
  for (const [id, c, px, py, z] of GRANDES) m.globo(`r24-${id}`, `R-24 ${nombreDe(c)} de la copa`, R("R-24", 55, c), f(px, py, z), unitario(v(f(px, py).x / 150, 1, 0.3)));
  const DORADOS: ReadonlyArray<readonly [number, number]> = [[157, 282], [232, 221], [339, 154], [439, 146], [504, 154], [514, 214]];
  DORADOS.forEach(([px, py], k) => racimo(m, `dorados-${k + 1}`, `Racimo dorado ${k + 1}`, [ORO, ORO, ORO, ORO], f(px, py, 46), 10));
  const COLGANTES: ReadonlyArray<readonly [number, string, number, number]> = [[218, FRAMBUESA, 3, 345], [252, ROSADO, 4, 315], [545, ROSADO, 4, 330], [603, ROJO, 4, 320]];
  COLGANTES.forEach(([px, c, cuantos, py], k) => {
    for (let i = 0; i < cuantos; i++) m.globo(`colgante-${k + 1}-${i + 1}`, `Colgante ${k + 1}: R-5 ${nombreDe(c)} ${i + 1}`, R("R-5", 10, c), mas(f(px, py, 22), v(0, -11 * i, 0)), ABAJO);
  });
  for (const [id, px, py] of [["abanico-izquierdo", 307, 329], ["abanico-derecho", 500, 350]] as const) {
    m.foilPaneles(id, `Abanico de papel rojo con corazón (${id === "abanico-izquierdo" ? "izquierda" : "derecha"})`, [panelPapel(roseta(14), "#d81b3c", { dibujo: "texto", texto: "♥", hex: "#f6c5cf" })], f(px, py, 44));
  }
  return escenaDe(m)(sala(360, 260, 330, { piso: "#efebe8", paredes: "#f8f6f4" }));
};

// ----------------------------------------------------------------------------------------------------------
// 209 · Bouquet te amo
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por las letras metalizadas de 16" («A» de ~77 px ≈ 38 cm): 2 px/cm, que da
 * los R-12 de la base de ~57 px (28 cm) y los globitos plateados del corazón de ~25 px (R-5 a 12 cm); piso en
 * y = 548 px, eje en x = 358 (centro del corazón). La base orgánica (de x = 190 a 560 px, hasta ~77 cm) de R-12 negros
 * —la mitad con el veteado plateado— y rojos con veteado blanco, con R-9 merlot, 3 globos cristal con confeti rojo y
 * plata, 3 corazoncitos rojos, 5 rizos de T-260 plata y el corazón rojo grande de la izquierda. Encima, el corazón de
 * R-5 Reflex Plata en tresbolillo (~125 × 80 cm, de 74 a 154 cm) y las letras metalizadas rojas «AMO» y «TE» con un
 * par de R-5 negros entre ellas. A la derecha el ramo de 6 R-12 de helio: rojo «te amo», negro, plateado, rojo con
 * corazón blanco, negro veteado y, abajo, otro rojo con corazón, amarrados a la base. La idea no publica productos:
 * medidos negro #0d0304 → 080; rojo 015; merlot #561415 → Fashion Merlot 018 (ΔE 15); plata 981; impresos más
 * parecidos del catálogo: veteado negro → Metalink Plata Graffiti Negro, veteado rojo → Graffiti Invierno Rojo,
 * «te amo» → I Love You Moderno Rojo, corazón blanco → Love Fashion Surtido (rojo).
 */
const escena209 = (): Escena => {
  const NEGRO = "080", ROJO = "015", MERLOT = "018", PLATA = "981", CRISTAL = "390";
  const f = foto(358, 548, 2);
  const base = organico([
    { id: "base", nombre: "Base", irregularidad: 0.2, puntos: [v(-72, 28, 0), v(-30, 32, 0), v(10, 34, 0), v(50, 32, 0), v(95, 28, 0)], grosor: grosor(30, 28), mezcla: mezcla({ "R-12": 0.72, "R-9": 0.18, "R-5": 0.1 }) },
    { id: "lomo", nombre: "Lomo", irregularidad: 0.2, puntos: [v(-25, 58, -8), v(30, 60, -8)], grosor: grosor(20, 18), mezcla: mezcla({ "R-12": 0.6, "R-9": 0.4 }) },
  ], { colores: [color(NEGRO, 0.62, ["R-12"]), color(ROJO, 0.14, ["R-12"]), color(MERLOT, 0.24, ["R-9", "R-5"])], semilla: 209, relleno: RELLENO_12_9 });
  const raiz: Pieza = { ...base.pieza, impresos: [{ impresoId: "infinity-metalink-plata-graffiti-fashion-negro", codigo: NEGRO, cada: 2 }, { impresoId: "infinity-graffiti-invierno-fashion-rojo", codigo: ROJO }] };
  const m = montaje({ id: "base", nombre: "Bouquet Te amo: base orgánica de R-12 negros y rojos veteados con R-9 merlot", pieza: raiz, origen: base.origen }, v(10, 0, -60));
  const corazon: Pieza = { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 125, altoCm: 80 }, tecnica: { tipo: "celdas", formatoId: "R-5", infladoCm: 12, celda: "tresbolillo" }, colores: { codigos: [PLATA], patron: "un_color" } } };
  m.pieza("corazon", "Corazón de R-5 Reflex Plata en tresbolillo", corazon, v(0, 74, -6), ARRIBA, GIRO_AMARRE);
  m.foil("letras-amo", "Letras metalizadas «AMO» rojas de 16\" (sin producto)", { forma: { tipo: "letras", texto: "AMO" }, pulgadas: 16, color: "rojo" }, f(360, 197, -4));
  m.foil("letras-te", "Letras metalizadas «TE» rojas de 16\" (sin producto)", { forma: { tipo: "letras", texto: "TE" }, pulgadas: 16, color: "rojo" }, f(342, 95, -6));
  racimo(m, "entre-letras", "Par entre las letras", [NEGRO, NEGRO], f(310, 165, 2), 10);
  helio(m, "cintas", "Ramo de helio: cintas blancas", [
    { id: "helio-te-amo", nombre: "R-12 rojo «te amo» (I Love You Moderno, el más parecido)", globo: R("R-12", 28, ROJO), centro: v(66, 249, -10), impresoId: "infinity-i-love-you-moderno-fashion-rojo" },
    { id: "helio-negro", nombre: "R-12 Fashion Negro de helio", globo: R("R-12", 28, NEGRO), centro: v(41, 219, -4) },
    { id: "helio-plata", nombre: "R-12 Reflex Plata de helio", globo: R("R-12", 28, PLATA), centro: v(68, 206, -22) },
    { id: "helio-corazon", nombre: "R-12 rojo con corazón blanco (Love Fashion Surtido)", globo: R("R-12", 28, ROJO), centro: v(76, 184, 2), impresoId: "infinity-love-fashion-surtido" },
    { id: "helio-veteado", nombre: "R-12 negro veteado de plata (Metalink Plata Graffiti)", globo: R("R-12", 28, NEGRO), centro: v(70, 150, -6), impresoId: "infinity-metalink-plata-graffiti-fashion-negro" },
    { id: "helio-corazon-abajo", nombre: "R-12 rojo con corazón blanco (abajo)", globo: R("R-12", 28, ROJO), centro: v(76, 64, 26), impresoId: "infinity-love-fashion-surtido" },
  ], f(470, 400, 10), "#f2f2f2");
  m.globo("corazon-grande", "Corazón C-12 Fashion Rojo de la izquierda", R("C-12", 30, ROJO), v(-74, 74, 22), unitario(v(-0.3, 1, 0.4)));
  ([[-39, 54, 30], [-14, 48, 32], [18, 64, 30]] as const).forEach(([x, y, z], k) => m.globo(`corazoncito-${k + 1}`, `Corazoncito C-12 Fashion Rojo ${k + 1}`, R("C-12", 18, ROJO), v(x, y, z), unitario(v(0, 1, 0.6))));
  ([[-60, 18, 28], [-38, 34, 32], [56, 22, 30]] as const).forEach(([x, y, z], k) => m.dePie(`confeti-${k + 1}`, `R-12 Cristal con confeti rojo y plata ${k + 1}`, { tipo: "burbuja", propiedades: { exterior: R("R-12", 26, CRISTAL), interiores: [], relleno: { tipo: "confeti", colores: ["#d0172f", "#d6d9de"], cantidad: 40 }, semilla: 209 + k } }, v(x, y, z)));
  ([[270, 395, 24], [190, 480, 30], [440, 480, 34], [560, 470, 26], [460, 385, 22]] as const).forEach(([px, py, z], k) => m.deco(`rizo-${k + 1}`, `Rizo ${k + 1}: T-260 Reflex Plata`, rizo({ forma: "tirabuzon", tubito: T("T-260", 4, PLATA), vueltas: 2, radioInicialCm: 4, radioFinalCm: 6.5, largoCm: 12, eje: "frente" }), f(px, py, z), unitario(v(k % 2 ? 1 : -1, 0.3, 0.6))));
  return escenaDe(m)(sala(300, 240, 320, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 210 · Bouquet tenebroso
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 1080×1080 recortado. Escala por los R-12 de helio (~147 px = 28 cm): 5,25 px/cm, piso en y = 1050 px, eje en
 * x = 550. La base orgánica de R-12 negros (~1 m de ancho, hasta 55 cm), uno de cada tres con la telaraña plateada,
 * con 5 racimos de R-5 Reflex Violeta y 4 de R-5 naranja; delante, «Boo» de T-260 blanco (la B de 3 a 51 cm). Encima,
 * la bruja: cuerpo en campana de R-12 Reflex Dorado con la boca hacia arriba, cuello de 3 R-5 dorados, cabeza R-12 negra
 * con la cara de calabaza verde impresa y el sombrero de bruja de papel negro; brazos de T-260 dorado y en la mano
 * izquierda una calabacita (R-5 naranja con cara) y un R-5 negro. A su lado la telaraña de papel naranja con la araña
 * negra. El ramo de 7 R-12 de helio: dos negros con telaraña, el cristal «Happy Halloween» con telaraña, el blanco con
 * cara de calavera, el naranja de calabaza, el verde de monstruo y el morado, con dos tríos de R-5 violeta en las
 * cintas. Colores: los publicados (Negro 080, Reflex Dorado 970, Reflex Violeta 951, T-260 Blanco 005); medidos los
 * demás: naranja #d57442 → Neón Naranja 261 (ΔE 12), morado #25155c → Fashion Violeta 051 (ΔE 17), blanco 005.
 */
const escena210 = (): Escena => {
  const NEGRO = "080", ORO = "970", VIOLETA = "951", BLANCO = "005", NARANJA = "261", MORADO = "051", VERDE = "031", NARANJA_12 = "061", CRISTAL = "390";
  const MONSTRUOS = "2-caras-monstruos-fashion-surtido";
  const f = foto(550, 1050, 5.25);
  const base = organico([
    { id: "base", nombre: "Base", irregularidad: 0.2, puntos: [v(-44, 25, 0), v(-15, 28, 0), v(15, 30, 0), v(47, 25, 0)], grosor: grosor(26, 24), mezcla: mezcla({ "R-12": 1 }) },
    { id: "lomo", nombre: "Lomo", irregularidad: 0.2, puntos: [v(0, 44, -6), v(22, 46, -6)], grosor: grosor(18, 16), mezcla: mezcla({ "R-12": 1 }) },
  ], { colores: [color(NEGRO, 1, ["R-12"])], semilla: 210, relleno: [{ formatoId: "R-12", infladoCm: 22, trios: false }] });
  const raiz: Pieza = { ...base.pieza, impresos: [{ impresoId: "infinity-arana-metalink-fashion-negro", codigo: NEGRO, cada: 3 }] };
  const m = montaje({ id: "base", nombre: "Bouquet tenebroso: base orgánica de R-12 Fashion Negro (con telarañas)", pieza: raiz, origen: base.origen }, v(0, 0, -50));
  // «Boo» de T-260 blanco.
  const t = T("T-260", 4.5, BLANCO);
  m.trazo("letra-b", "«B» de T-260 Fashion Blanco", t, [
    { tipo: "linea", puntos: [[0, 0], [0, 47]] },
    { tipo: "arco", centro: [4, 38], radioCm: 9, desdeGrados: -90, hastaGrados: 90 },
    { tipo: "arco", centro: [5, 13], radioCm: 12.5, desdeGrados: -90, hastaGrados: 90 },
  ], f(385, 1030, 36), "a white twisted-balloon letter B");
  m.trazo("letra-o-1", "Primera «o» de T-260 Fashion Blanco", t, [{ tipo: "arco", centro: [0, 0], radioCm: 7.5, desdeGrados: 0, hastaGrados: 360 }], f(520, 940, 36), "a white twisted-balloon letter o");
  m.trazo("letra-o-2", "Segunda «o» de T-260 Fashion Blanco", t, [{ tipo: "arco", centro: [0, 0], radioCm: 10, desdeGrados: -60, hastaGrados: 300 }, { tipo: "linea", puntos: [[5, -8.7], [4, -15]] }], f(645, 930, 36), "a white twisted-balloon letter o with a tail");
  ([[415, 870, 40], [415, 976, 40], [521, 918, 40], [645, 953, 40]] as const).forEach(([px, py, z], k) => racimo(m, `violeta-${k + 1}`, `Trío violeta ${k + 1}`, [VIOLETA, VIOLETA, VIOLETA], f(px, py, z), 10));
  racimo(m, "violeta-arriba", "Racimo violeta de arriba", [VIOLETA, VIOLETA, VIOLETA, VIOLETA], f(610, 770, 14), 12, unitario(v(0, 0.5, 1)));
  ([[315, 876, 26], [592, 829, 30], [604, 976, 34], [330, 1000, 26]] as const).forEach(([px, py, z], k) => racimo(m, `naranja-${k + 1}`, `Trío naranja ${k + 1}`, [NARANJA, NARANJA, NARANJA], f(px, py, z), 10));
  // La bruja.
  m.globo("bruja-cuerpo", "Bruja: cuerpo en campana, R-12 Reflex Dorado con la boca hacia arriba", R("R-12", 24, ORO), f(456, 720, 4), ABAJO);
  racimo(m, "bruja-cuello", "Bruja: cuello", [ORO, ORO, ORO], f(456, 641, 4), 9, ARRIBA);
  const cabeza = f(462, 576, 4);
  m.conCara("bruja-cabeza", "Bruja: cabeza R-12 Fashion Negro con cara de calabaza verde", R("R-12", 22, NEGRO), cabeza, { ...SIN_CARA, calabaza: { hex: "#c6e23a" } }, "a black witch head balloon with a glowing green jack-o'-lantern face");
  m.foilPaneles("bruja-sombrero", "Bruja: sombrero de papel negro con telarañas doradas", [
    { forma: "cilindro", base: v(0, 0, 0), radioCm: 20, altoCm: 1.2, hex: "#141414", acabado: "papel" },
    cono(v(0, 1, 0), v(-0.35, 1, 0), 9.5, 28, "#141414"),
  ], mas(cabeza, v(0, 9, -2)));
  m.trazo("bruja-brazos", "Bruja: brazos de T-260 Reflex Dorado", T("T-260", 3, ORO), [{ tipo: "linea", puntos: [[-24, 4], [-12, 1], [0, 0], [12, 3], [22, 8]] }], f(456, 650, 8), "gold twisted-balloon arms");
  m.conCara("calabacita", "Calabacita de la mano: R-5 Fashion Naranja con cara", R("R-5", 11, NARANJA_12), f(333, 659, 10), { ...SIN_CARA, calabaza: { hex: "#141414" } }, "a tiny jack-o'-lantern balloon");
  m.globo("mano-negra", "R-5 Fashion Negro de la mano izquierda", R("R-5", 10, NEGRO), f(353, 682, 10), AL_FRENTE);
  m.globo("mano-derecha", "R-5 Fashion Negro de la mano derecha", R("R-5", 10, NEGRO), f(556, 612, 10), AL_FRENTE);
  m.deco("telarana", "Telaraña de papel naranja", { tipo: "telarana", propiedades: { radioCm: 19, radios: 8, anillos: 4, hex: "#f07a1e", grosorCm: 0.8 } }, f(598, 718, 16), AL_FRENTE);
  m.foilPaneles("arana-papel", "Araña de papel negra (panal) sobre la telaraña", [panelPapel(ovalo(0, 0, 9, 6, 20), "#141414")], f(600, 712, 19));
  helio(m, "cintas", "Ramo de helio: cintas negras", [
    { id: "helio-telarana-arriba", nombre: "R-12 negro con telaraña de arriba (Araña Metalink, el más parecido)", globo: R("R-12", 28, NEGRO), centro: f(698, 82, -12), impresoId: "infinity-arana-metalink-fashion-negro" },
    { id: "helio-cristal", nombre: "R-12 Cristal «Happy Halloween» con telaraña (Araña Transparente)", globo: R("R-12", 28, CRISTAL), centro: f(668, 235, -4), impresoId: "infinity-arana-fashion-transparente" },
    { id: "helio-calavera", nombre: "R-12 Fashion Blanco con cara de calavera", globo: R("R-12", 28, BLANCO), centro: f(604, 294, -14), cara: { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#141414" }, nariz: { estilo: "punto", hex: "#141414" }, boca: { estilo: "linea", hex: "#141414" } }, queEs: "a white skeleton face balloon" },
    { id: "helio-calabaza", nombre: "R-12 naranja de calabaza (Monstruos 2 caras)", globo: R("R-12", 28, NARANJA_12), centro: f(786, 294, -2), impresoId: MONSTRUOS },
    { id: "helio-morado", nombre: "R-12 Fashion Violeta", globo: R("R-12", 28, MORADO), centro: f(703, 376, -16) },
    { id: "helio-monstruo", nombre: "R-12 verde de monstruo (Monstruos 2 caras)", globo: R("R-12", 28, VERDE), centro: f(604, 471, 2), impresoId: MONSTRUOS },
    { id: "helio-telarana-abajo", nombre: "R-12 negro con telaraña de abajo (Araña Metalink)", globo: R("R-12", 28, NEGRO), centro: f(733, 529, 6), impresoId: "infinity-arana-metalink-fashion-negro" },
  ], f(650, 760, 0), "#1b1b1b");
  racimo(m, "cinta-trio-arriba", "Trío violeta en las cintas (arriba)", [VIOLETA, VIOLETA, VIOLETA], f(668, 341, 4), 10);
  racimo(m, "cinta-trio-abajo", "Trío violeta en las cintas (abajo)", [VIOLETA, VIOLETA, VIOLETA], f(715, 635, 8), 10);
  return escenaDe(m)(sala(260, 220, 240, { piso: "#e9e9ea", paredes: "#f5f5f6" }));
};

// ----------------------------------------------------------------------------------------------------------
// 228 · Calabaza colorida y 234 · Calavera colorida (el mismo montaje)
// ----------------------------------------------------------------------------------------------------------

/** Un racimo de globitos metalizados de una de las dos fotos: [x px, y px, z cm, códigos]. */
type RacimoFoto = readonly [number, number, number, readonly string[]];

/**
 * Fotos de 1600×2208 (#228) y 1600×2133 (#234) contra la pared. Escala por el grueso del aro (dos Link-O-Loon 660 de
 * ~110 px ≈ 13 cm): 8,5 px/cm, que da los metalizados de 18" de ~380 px (45 cm) y los R-12 impresos de la base de
 * ~230–285 px (27–30 cm). Base: cuartetos de R-12 naranja «Happy Halloween» (estrellas y luna negras: el impreso
 * negro y naranja de la tienda) y R-9 negros; un palito sube al aro de ~94 cm (el 660 negro arriba y el naranja abajo,
 * impresos «Happy Halloween» en la foto: el catálogo no tiene 660 impresos, van lisos). Racimos de R-5 cobrizos, verde
 * oliva y violeta, y rizos de T-260. Medidos en #234: cobre #feb2a4 → Metal Dorado Rosa 568 (ΔE 5); verde #82965b →
 * Reflex Verde Lima 931 (ΔE 9); violeta → Reflex Violeta 951; rizo cobre #b6765b → Reflex Dorado Rosa 968 (ΔE 10);
 * naranja #f66001 → Fashion Naranja 061 (ΔE 11); negro 080.
 */
const COBRE = "568", OLIVA = "931", VIOLETA_M = "951", NEGRO_H = "080", NARANJA_H = "061", COBRE_RIZO = "968";

/** La base de un centro de mesa de Halloween: cuarteto impreso, cuarteto de R-9 negros y el palito. */
function baseHalloween(id: string, nombre: string, inflado: number, alturaR9: number, impresoArriba: number | null, palito: readonly [number, number]): Montaje {
  const m = montaje({ id, nombre, pieza: cuarteto(R("R-12", inflado, NARANJA_H), [NARANJA_H], "un_color", [{ impresoId: IMPRESO_HALLOWEEN, codigo: NARANJA_H }]), origen: v(0, r2(inflado / 2 + 0.6), 0) }, v(0, 0, 0));
  m.nivel(`${id}-negros`, "Cuarteto R-9 Fashion Negro", cuarteto(R("R-9", 20, NEGRO_H), [NEGRO_H]), v(0, alturaR9, 0), 45);
  if (impresoArriba !== null) {
    m.nivel(`${id}-impresos-arriba`, "Cuarteto R-12 naranja «Happy Halloween» de arriba", cuarteto(R("R-12", 26, NARANJA_H), [NARANJA_H], "un_color", [{ impresoId: IMPRESO_HALLOWEEN, codigo: NARANJA_H }]), v(0, impresoArriba, 0), 0);
    m.nivel(`${id}-negros-arriba`, "Cuarteto R-9 Fashion Negro de arriba", cuarteto(R("R-9", 20, NEGRO_H), [NEGRO_H]), v(0, impresoArriba + 18, 0), 45);
  }
  m.foilPaneles(`${id}-palito`, "Palito de madera que sostiene el aro", [barra(v(0, 0, 0), v(0, r2(palito[1] - palito[0]), 0), 0.6, "#c58b4a", "madera")], v(0, palito[0], -4));
  return m;
}

/** El aro de dos Link-O-Loon 660 (negro arriba, naranja abajo) con centro `c` y radio `r`. */
function aroHalloween(m: Montaje, c: Vec3, r: number, negro: readonly [number, number], naranja: readonly [number, number]): void {
  m.trazo("aro-negro", "Aro: Link-O-Loon 660 Fashion Negro (arriba)", T("LOL-660", 13, NEGRO_H), [{ tipo: "arco", centro: [0, 0], radioCm: r, desdeGrados: negro[0], hastaGrados: negro[1] }], c, "a black thick link balloon arc");
  m.trazo("aro-naranja", "Aro: Link-O-Loon 660 Fashion Naranja (abajo)", T("LOL-660", 13, NARANJA_H), [{ tipo: "arco", centro: [0, 0], radioCm: r, desdeGrados: naranja[0], hastaGrados: naranja[1] }], mas(c, v(0, 0, 2)), "an orange thick link balloon arc");
}

/** Los racimos de globitos metalizados y los rizos de una de las dos fotos. */
function adornosHalloween(m: Montaje, f: (x: number, y: number, z?: number) => Vec3, racimos: readonly RacimoFoto[], rizos: ReadonlyArray<readonly [number, number, number, string, number]>): void {
  racimos.forEach(([px, py, z, codigos], k) => racimo(m, `metalizados-${k + 1}`, `Racimo metalizado ${k + 1}`, codigos, f(px, py, z), 11));
  rizos.forEach(([px, py, z, c, lado], k) => m.deco(`rizo-${k + 1}`, `Rizo ${k + 1}: T-260 ${nombreDe(c)}`, rizo({ forma: "resorte", tubito: T("T-260", 4.5, c), vueltas: 1.6, radioCm: 7, largoCm: 26, eje: "frente" }), f(px, py, z), unitario(v(lado, 0.35, 0.25))));
}

const escena228 = (): Escena => {
  const f = foto(590, 2130, 8.5);
  const m = baseHalloween("base", "Calabaza colorida: base de cuarteto R-12 naranja «Happy Halloween»", 30, 37, 56, [82, 110]);
  aroHalloween(m, f(590, 830), 42, [40, 200], [200, 360]);
  m.foilPaneles("calabaza-metalizada", "Metalizado de calabaza calavera naranja (sin producto)", [
    panelFoil(contornoCalabaza(76, 66), 9, "#f07a1e", { dibujo: "calavera", hex: "#141414", escala: 0.75 }),
    panelFoil(girarContorno(ovalo(0, 0, 5, 3, 12), 20).map(([x, y]): readonly [number, number] => [x, r2(y + 35)]), 4, "#3a3a3a"),
  ], f(580, 790, 6));
  m.foilPaneles("cubo-arriba", "Metalizado en cubo «Happy Halloween» de arriba (sin producto)", [cuboFoil(v(0, 0, 0), 42, "#151515", { dibujo: "texto", texto: "HAPPY\nHALLOWEEN", hex: "#f28a1e" }, -12)], f(1060, 330, 4));
  m.foilPaneles("cubo-abajo", "Metalizado en cubo «Happy Halloween» de abajo (sin producto)", [cuboFoil(v(0, 0, 0), 36, "#151515", { dibujo: "texto", texto: "HAPPY\nHALLOWEEN", hex: "#f28a1e" }, 14)], f(290, 1610, 10));
  adornosHalloween(m, f, [
    [300, 320, 6, [COBRE, OLIVA, VIOLETA_M, COBRE]], [1300, 100, 4, [COBRE, OLIVA, VIOLETA_M]], [1050, 700, 8, [VIOLETA_M, OLIVA, COBRE, NEGRO_H]],
    [200, 1000, 8, [VIOLETA_M, COBRE, OLIVA, NEGRO_H]], [750, 1080, 10, [COBRE, OLIVA, VIOLETA_M, NEGRO_H, OLIVA]], [330, 1300, 12, [OLIVA, COBRE, VIOLETA_M]],
    [690, 1500, 16, [COBRE, VIOLETA_M, OLIVA]], [550, 1980, 18, [VIOLETA_M, OLIVA, COBRE]], [760, 1880, 18, [OLIVA, COBRE, VIOLETA_M]],
  ], [[880, 1380, 6, VIOLETA_M, 1], [200, 1750, 10, VIOLETA_M, -1], [930, 1880, 14, OLIVA, 1], [1000, 1000, 6, COBRE_RIZO, 1]]);
  return escenaDe(m)(sala(260, 220, 280, { piso: "#8d8a86", paredes: "#d9dadc" }));
};

const escena234 = (): Escena => {
  const f = foto(790, 1930, 8.5);
  const m = baseHalloween("base", "Calavera colorida: base de cuarteto R-12 naranja «Happy Halloween»", 27, 32, null, [42, 58]);
  aroHalloween(m, f(790, 1020), 42, [25, 195], [195, 345]);
  m.foilPaneles("calavera-metalizada", "Metalizado de calavera blanca de colores (sin producto)", [panelFoil(contornoCalavera(61, 73), 9, "#f4f2ee", { dibujo: "calavera", hex: "#141414", escala: 0.8 })], f(750, 950, 8));
  m.foilPaneles("calavera-izquierda", "Metalizado de calavera chica (izquierda, sin producto)", [panelFoil(girarContorno(contornoCalavera(30, 36), 25), 6, "#f4f2ee", { dibujo: "calavera", hex: "#141414", escala: 0.75 })], f(290, 830, 4));
  m.foilPaneles("calavera-derecha", "Metalizado de calavera chica (derecha, sin producto)", [panelFoil(girarContorno(contornoCalavera(25, 30), -15), 6, "#f4f2ee", { dibujo: "calavera", hex: "#141414", escala: 0.75 })], f(1300, 620, 2));
  m.foil("dia-de-muertos", "Metalizado redondo «Día de los Muertos» negro de 18\" (sin producto)", { forma: { tipo: "redondo" }, pulgadas: 18, color: "negro_mate", impreso: { dibujo: "texto", texto: "Día de\nlos Muertos", hex: "#f4f4f4" } }, f(1010, 1640, 10));
  ([[1060, 1040, 0], [1120, 1070, 2], [1180, 1020, -2], [400, 950, 2], [455, 965, 4]] as const).forEach(([px, py, z], k) => m.globo(`negro-${k + 1}`, `R-12 Fashion Negro junto al aro ${k + 1}`, R("R-12", 22, NEGRO_H), f(px, py, z), unitario(v(0, 0.4, 1))));
  adornosHalloween(m, f, [
    [700, 530, 6, [OLIVA, COBRE, VIOLETA_M]], [300, 960, 8, [OLIVA, VIOLETA_M, COBRE]], [1200, 1000, 10, [VIOLETA_M, COBRE, OLIVA, COBRE]],
    [560, 1250, 10, [OLIVA, COBRE, VIOLETA_M]], [970, 1250, 10, [VIOLETA_M, OLIVA, COBRE]], [800, 1620, 16, [OLIVA, VIOLETA_M, COBRE]],
  ], [[470, 1650, 14, COBRE_RIZO, -1], [560, 1350, 6, VIOLETA_M, -1], [480, 1500, 8, VIOLETA_M, -1], [1280, 600, 0, OLIVA, 1], [1130, 900, 2, OLIVA, 1]]);
  return escenaDe(m)(sala(260, 220, 260, { piso: "#8d8a86", paredes: "#d9dadc" }));
};

// ----------------------------------------------------------------------------------------------------------
// 230 · Calabaza tenebrosa
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 855×855 recortado. Escala por los R-12 de la base (~140 px = 28 cm): 5 px/cm, piso en y = 850 px, eje en
 * x = 435. Base Reflex Verde Lima: cuarteto R-12 abajo (centro a 16 cm), anillo de 8 R-5 (34 cm) y cuarteto R-12 más
 * chico (46 cm). La cabeza: esfera de ~82 cm (de 585 a 180 px) de R-9 naranja (~95 px: 19 cm) con R-5 (~45 px) en los
 * huecos, centro a 93 cm; la cara de globos negros: ojos (~90 px: R-9 a 18 cm), nariz (~110 px: R-12 a 22 cm) y la boca de
 * 4 R-9 a 15 cm con un R-5 naranja de diente. Arriba, el tallo de 2 R-5 verde lima y el penacho de 6 rizos de T-260
 * verde lima, hasta ~1,68 m. Colores: los publicados (Reflex Verde Lima 931 en R-12, R-5 y T-260; Naranja 061; Negro 080).
 */
const escena230 = (): Escena => {
  const LIMA = "931", NARANJA = "061", NEGRO = "080";
  const f = foto(435, 850, 5);
  const m = montaje({ id: "base", nombre: "Calabaza tenebrosa: cuarteto R-12 Reflex Verde Lima de la base", pieza: cuarteto(R("R-12", 28, LIMA), [LIMA]), origen: v(0, 16, 0) }, v(0, 0, 0));
  for (let k = 0; k < 8; k++) m.globo(`anillo-${k + 1}`, `Anillo de R-5 Reflex Verde Lima ${k + 1}`, R("R-5", 9, LIMA), enAnillo(22.5 + 45 * k, 22, 34), haciaFuera(22.5 + 45 * k, 15));
  m.nivel("base-arriba", "Cuarteto R-12 Reflex Verde Lima de arriba", cuarteto(R("R-12", 22, LIMA), [LIMA]), v(0, 46, 0), 45);
  const esfera: Pieza = { tipo: "forma", forma: { clase: "esfera", diametroCm: 82, globo: { formatoId: "R-9", infladoCm: 19 }, colores: { codigos: [NARANJA], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 9, codigos: [NARANJA], cada: 1 } } };
  const centro = v(0, 93, 0);
  m.pieza("cabeza", "Cabeza: esfera de R-9 Fashion Naranja con R-5 en los huecos", esfera, menos(centro, centroDe(esfera)), ARRIBA, GIRO_AMARRE);
  const RADIO = 44;
  const rasgo = (id: string, nombre: string, g: ParteGlobo, px: number, py: number) => {
    const p = sobreEsfera(centro, RADIO, f(px, py), g.infladoCm * 0.3);
    m.globo(id, nombre, g, p, unitario(menos(p, centro)));
  };
  rasgo("ojo-izquierdo", "Ojo izquierdo: R-9 Fashion Negro", R("R-9", 18, NEGRO), 318, 300);
  rasgo("ojo-derecho", "Ojo derecho: R-9 Fashion Negro", R("R-9", 18, NEGRO), 530, 290);
  rasgo("nariz", "Nariz: R-12 Fashion Negro", R("R-12", 22, NEGRO), 435, 395);
  ([[325, 485], [390, 510], [480, 510], [535, 480]] as const).forEach(([px, py], k) => rasgo(`boca-${k + 1}`, `Boca: R-9 Fashion Negro ${k + 1}`, R("R-9", 15, NEGRO), px, py));
  rasgo("diente", "Diente: R-5 Fashion Naranja", R("R-5", 10, NARANJA), 440, 470);
  m.globo("tallo-1", "Tallo: R-5 Reflex Verde Lima 1", R("R-5", 10, LIMA), f(428, 172), unitario(v(-0.3, 1, 0)));
  m.globo("tallo-2", "Tallo: R-5 Reflex Verde Lima 2", R("R-5", 10, LIMA), f(452, 168), unitario(v(0.3, 1, 0)));
  m.dePie("rizos", "Penacho de 6 rizos de T-260 Reflex Verde Lima", rizo({ forma: "penacho", formatoId: "T-260", grosorCm: 4.5, codigos: [LIMA], rizos: 6, vueltas: 2, radioInicialCm: 4, radioFinalCm: 8, largoCm: 30, inclinacionGrados: 0, aperturaGrados: 55 }), f(440, 165));
  return escenaDe(m)(sala(240, 220, 220, { piso: "#ecebe8", paredes: "#f7f6f4" }));
};

// ----------------------------------------------------------------------------------------------------------
// 253 · Cartera fashion
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570, pequeña y muy saturada. Escala por los R-12 de helio (~85 px = 28 cm): 3 px/cm, piso en y = 548 px,
 * eje en x = 375. La cartera: silueta de ~58 × 27 cm (de x = 290 a 462 px y de 465 a 548 px), ancha abajo y redondeada,
 * rellena de R-5 (~30 px: 10 cm) en tresbolillo; el asa, un arco de T-260 negro de ~17 cm de radio; delante el moño
 * de dos R-5 azules y su nudo. Amarrados a la cartera, 3 R-12 de helio: el azul de arriba (con una calcomanía de
 * cartera) y dos rosados con zapatos y gafas impresos, hasta ~1,78 m. Medidos: cartera #ff42af → Neón Fucsia 212
 * (ΔE 14–20: la foto está saturada); azul #04c7f7 → Fashion Azul 040 (ΔE 9); asa negra 080. Los rosados impresos van
 * con el impreso más parecido del catálogo (Corazones Modernos: rosado 009 y fucsia 012 de su surtido).
 */
const escena253 = (): Escena => {
  const FUCSIA_NEON = "212", AZUL = "040", NEGRO = "080", ROSADO = "009", FUCSIA = "012";
  const f = foto(375, 548, 3);
  const silueta: ReadonlyArray<readonly [number, number]> = [[-22, 27], [23, 27], [27, 20], [29.5, 11], [27, 4], [19, 0], [-19, 0], [-27, 4], [-29.5, 11], [-27, 20]];
  const cartera: Pieza = { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "libre", puntos: silueta.map(([x, y]) => ({ x, y })) }, tecnica: { tipo: "celdas", formatoId: "R-5", infladoCm: 10, celda: "tresbolillo" }, colores: { codigos: [FUCSIA_NEON], patron: "un_color" } } satisfies OpcionesForma };
  const m = montaje({ id: "cartera", nombre: "Cartera: silueta rellena de R-5 Neón Fucsia en tresbolillo", pieza: cartera, origen: v(0, 2.5, 0) }, v(0, 0, -20));
  m.trazo("asa", "Asa: T-260 Fashion Negro en arco", T("T-260", 4.5, NEGRO), [{ tipo: "arco", centro: [0, 0], radioCm: 17, desdeGrados: 0, hastaGrados: 180 }], f(368, 470, -1), "a black twisted-balloon purse handle");
  m.globo("mono-izquierdo", "Moño: lazo izquierdo R-5 Fashion Azul", R("R-5", 11, AZUL), f(345, 445, 6), unitario(v(-1, 0.2, 0.4)));
  m.globo("mono-derecho", "Moño: lazo derecho R-5 Fashion Azul", R("R-5", 11, AZUL), f(385, 445, 6), unitario(v(1, 0.2, 0.4)));
  m.globo("mono-nudo", "Moño: nudo R-5 Fashion Azul (poco inflado)", R("R-5", 6, AZUL), f(366, 446, 9), AL_FRENTE);
  helio(m, "cintas", "Ramo de helio: cintas rosadas", [
    { id: "helio-azul", nombre: "R-12 Fashion Azul de arriba", globo: R("R-12", 28, AZUL), centro: f(370, 80, -4) },
    { id: "helio-rosado", nombre: "R-12 rosado con zapatos y gafas (Corazones Modernos, el más parecido)", globo: R("R-12", 28, ROSADO), centro: f(325, 195, 0), impresoId: "infinity-corazones-modernos-fashion-surtido" },
    { id: "helio-fucsia", nombre: "R-12 fucsia con zapatos y gafas (Corazones Modernos, el más parecido)", globo: R("R-12", 28, FUCSIA), centro: f(420, 200, 0), impresoId: "infinity-corazones-modernos-fashion-surtido" },
  ], f(366, 465, 0), "#f4c4d8");
  return escenaDe(m)(sala(220, 200, 220, { piso: "#efeef0", paredes: "#faf9fa" }));
};

// ----------------------------------------------------------------------------------------------------------
// 256 · Castillo Enredados
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (render). Escala por los R-12 de helio (~57 px = 28 cm): 2 px/cm, piso en y = 548 px, eje en x = 400.
 * La torre: cuartetos de R-12 gris perla (~45–50 px) con R-5 en los huecos, de ~70 cm de ancho hasta ~2,05 m, y el
 * capitel que se afina hasta ~2,63 m; la ventana, un arco de T-260 del mismo gris (radio ~17 cm, arriba a 2,16 m) y
 * una línea de T-260 a 1,52 m. La trenza de Rapunzel: dos T-260 amarillos trenzados que bajan desde la ventana en
 * diagonal por delante de la torre y vuelven abajo, con 8 florecitas de tubito (rosadas, verde y azul turquesa) contadas.
 * A la izquierda 3 R-12 de helio impresos de princesa (fucsia, turquesa y lila) amarrados al pie de la torre. Medidos:
 * torre #806b68 → Silk Gris Medianoche 880 (ΔE 9); trenza #ffe32b → Fashion Amarillo 020 (ΔE 9); helio fucsia #f472a2
 * → Neón Fucsia 212 (ΔE 12), turquesa #4ec0ca → Azul Caribe 038 (ΔE 6), lila #c49cce → Satín Lila 450 (ΔE 5). La
 * tienda no tiene impresos de princesas: los de helio van lisos.
 */
const escena256 = (): Escena => {
  const GRIS = "880", AMARILLO = "020", ROSA = "011", TURQUESA = "038", AGUAMARINA = "037", VERDE = "031", FUCSIA_NEON = "212", LILA = "450";
  const f = foto(400, 548, 2);
  const torre: Pieza = { tipo: "forma", forma: { clase: "cono", altoCm: 205, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 27, infladoPuntaCm: 24, globosBase: 4, globosPunta: 4, colores: { codigos: [GRIS], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 11, codigos: [GRIS], cada: 1 } } };
  const m = montaje({ id: "torre", nombre: "Torre: cuartetos de R-12 Silk Gris Medianoche con R-5 en los huecos", pieza: torre, origen: v(0, 0, 0) }, v(0, 0, -50));
  const capitel: Pieza = { tipo: "forma", forma: { clase: "cono", altoCm: 62, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 22, infladoPuntaCm: 13, globosBase: 4, globosPunta: 3, colores: { codigos: [GRIS], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 9, codigos: [GRIS], cada: 2 } } };
  m.pieza("capitel", "Capitel: cono de R-12 Silk Gris Medianoche que se afina", capitel, v(0, 199, 0), ARRIBA, 0);
  const FRENTE = 32;
  m.trazo("ventana", "Ventana: arco de T-260 Silk Gris Medianoche", T("T-260", 4, GRIS), [{ tipo: "arco", centro: [0, 0], radioCm: 17, desdeGrados: 0, hastaGrados: 180 }, { tipo: "linea", puntos: [[-17, 0], [-17, -12]] }, { tipo: "linea", puntos: [[17, 0], [17, -12]] }], v(-4, 199, FRENTE), "a grey twisted-balloon window outline");
  m.trazo("linea", "Línea de T-260 Silk Gris Medianoche bajo la ventana", T("T-260", 4, GRIS), [{ tipo: "linea", puntos: [[-30, 0], [30, 0]] }], v(-5, 152, FRENTE), "a grey twisted-balloon line");
  // La trenza: dos tubitos que se cruzan a lo largo del recorrido (arriba, de la ventana a la izquierda; abajo, la vuelta).
  const tramos: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    [[400, 150], [425, 180], [445, 215], [450, 245], [430, 265], [395, 290], [360, 320], [335, 355], [325, 390], [322, 408]],
    [[470, 465], [440, 480], [400, 495], [365, 510], [335, 525]],
  ];
  tramos.forEach((tramo, j) => {
    const camino = aLoLargo(tramo.map(([x, y]) => f(x, y, FRENTE + 2)), 5);
    for (const fase of [0, 1]) {
      const puntos = camino.map(({ p, t }, i): readonly [number, number] => {
        const n = v(-t.y, t.x, 0);
        const o = (i % 2 === fase ? 1.8 : -1.8);
        return [r2(p.x + n.x * o - camino[0]!.p.x), r2(p.y + n.y * o - camino[0]!.p.y)];
      });
      m.trazo(`trenza-${j + 1}-${fase + 1}`, `Trenza ${j === 0 ? "de arriba" : "de abajo"}: T-260 Fashion Amarillo ${fase + 1}`, T("T-260", 3.5, AMARILLO), [{ tipo: "linea", puntos }], camino[0]!.p, "a yellow braided twisted-balloon hair strand");
    }
  });
  const FLORES: ReadonlyArray<readonly [number, number, string]> = [[377, 150, ROSA], [413, 181, VERDE], [430, 255, ROSA], [365, 318, AGUAMARINA], [322, 400, ROSA], [440, 475, AGUAMARINA], [458, 462, ROSA], [337, 527, ROSA]];
  FLORES.forEach(([px, py, c], k) => m.deco(`flor-${k + 1}`, `Florecita ${k + 1}: 5 pétalos de T-260 ${nombreDe(c)}`, florBurbuja("T-260", 3, c, 5, 4.5, null), f(px, py, FRENTE + 5), AL_FRENTE));
  helio(m, "cintas", "Ramo de helio: cintas blancas", [
    { id: "helio-fucsia", nombre: "R-12 Neón Fucsia de helio (arriba)", globo: R("R-12", 28, FUCSIA_NEON), centro: f(290, 300, 10) },
    { id: "helio-turquesa", nombre: "R-12 Fashion Azul Caribe de helio (en medio)", globo: R("R-12", 28, TURQUESA), centro: f(295, 360, 14) },
    { id: "helio-lila", nombre: "R-12 Satín Lila de helio (abajo)", globo: R("R-12", 28, LILA), centro: f(283, 425, 10) },
  ], f(305, 545, 10), "#f2f2f2");
  return escenaDe(m)(sala(260, 220, 300, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 257 · Catrina
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (fondo blanco). Escala por la cabeza R-12 (~95 px = 28 cm): 3,4 px/cm, piso en y = 555 px, eje en
 * x = 370. La falda: 4 cuartetos R-12 blancos (~85 px de largo de lado: 23 cm) hasta ~79 cm. Encima, el cuello de 2 R-5
 * blancos, los brazos de T-260 blanco que bajan a abrazar la rosa y la cabeza R-12 blanca con la cara de calavera
 * impresa (ojos ovalados, nariz y boca de línea); la corona de 5 flores de T-260 (verde, fucsia, azul, amarilla y
 * naranja) y la rosa roja de lazos de T-260 en el pecho (~34 cm), hasta ~1,59 m. Medidos: blanco 005; rosa #f20f3c →
 * Fashion Rojo 015 (ΔE 9); flores: verde #04cb00 → Verde Trébol 029, fucsia #f03489 → Neón Fucsia 212 (ΔE 11; el Metal
 * Fucsia 512 no se hace en T-260), azul #0097d3 → Neón Azul 240 (ΔE 10), amarillo #f9d505 → Amarillo Miel 021 (ΔE 8),
 * naranja #fa7202 → Fashion Naranja 061 (ΔE 14).
 */
const escena257 = (): Escena => {
  const BLANCO = "005", ROJO = "015";
  const f = foto(370, 555, 3.4);
  const m = montaje({ id: "falda", nombre: "Catrina: falda de 4 cuartetos R-12 Fashion Blanco", pieza: columna(R("R-12", 23, BLANCO), 4, [BLANCO]), origen: v(0, 11.5, 0), giroGrados: 45 }, v(0, 0, 0));
  m.globo("cuello-izquierdo", "Cuello: R-5 Fashion Blanco izquierdo", R("R-5", 10, BLANCO), f(356, 178, 2), unitario(v(-1, 0.3, 0.3)));
  m.globo("cuello-derecho", "Cuello: R-5 Fashion Blanco derecho", R("R-5", 10, BLANCO), f(384, 178, 2), unitario(v(1, 0.3, 0.3)));
  const cabeza = f(370, 110, 0);
  m.conCara("cabeza", "Cabeza: R-12 Fashion Blanco con cara de calavera", R("R-12", 28, BLANCO), cabeza, { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#141414" }, nariz: { estilo: "punto", hex: "#141414" }, boca: { estilo: "linea", hex: "#141414" }, cejas: { hex: "#141414", bravas: false } }, "a white sugar-skull face balloon");
  m.trazo("brazo-izquierdo", "Brazo izquierdo: T-260 Fashion Blanco", T("T-260", 4, BLANCO), [{ tipo: "linea", puntos: [[0, 0], [-8, -11], [-11, -24], [-9, -33], [-2, -36]] }], f(352, 188, 6), "a white twisted-balloon arm");
  m.trazo("brazo-derecho", "Brazo derecho: T-260 Fashion Blanco", T("T-260", 4, BLANCO), [{ tipo: "linea", puntos: [[0, 0], [8, -11], [11, -24], [9, -33], [2, -36]] }], f(388, 188, 6), "a white twisted-balloon arm");
  const rosa: PropiedadesFlorTubito = {
    petalos: { formatoId: "T-260", grosorCm: 3.5, codigos: [ROJO], cantidad: 10, estilo: "lazo", largoCm: 15, anchoCm: 9, aperturaGrados: 22, giroGrados: 0 },
    interior: { formatoId: "T-260", grosorCm: 3.5, codigos: [ROJO], cantidad: 6, estilo: "lazo", largoCm: 10, anchoCm: 7, aperturaGrados: 35, giroGrados: 30 },
    corona: null, centro: R("R-5", 9, ROJO),
  };
  m.deco("rosa", "Rosa roja de lazos de T-260 Fashion Rojo", { tipo: "flor_tubito", propiedades: rosa }, f(380, 300, 16), AL_FRENTE);
  const CORONA: ReadonlyArray<readonly [number, number, string]> = [[323, 48, "029"], [368, 30, "212"], [418, 45, "240"], [300, 85, "021"], [428, 95, "061"]];
  CORONA.forEach(([px, py, c], k) => m.deco(`flor-${k + 1}`, `Corona: flor de 5 pétalos de T-260 ${nombreDe(c)}`, florBurbuja("T-260", 3.5, c, 5, 6.5, null), sobreEsfera(cabeza, 13, f(px, py), 3), AL_FRENTE));
  return escenaDe(m)(sala(220, 200, 220, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 267 · Centro de mesa ángel
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570, pequeña. Escala por los R-12 de helio (~85 px = 28 cm): 3 px/cm, piso en y = 555 px, eje en
 * x = 405. El angelito (~63 cm con la aureola): pies de un cuarteto R-5 morado (se ven 2), cuerpo R-9 cristal, cuello
 * de 2 R-5 morados, cabeza R-9 durazno con ojos y sonrisa, alas de lazos de T-260 blanco, brazos de T-260 cristal con
 * manos de R-5 durazno (el izquierdo arriba, sosteniendo las cintas) y aureola de T-260 dorado. Amarrados a su mano,
 * 3 R-12 de helio: el impreso «Mi Primera Comunión» de arriba, el plateado (izquierda) y el dorado (derecha). Medidos:
 * pies #933c8d → Orquídea Morada 056 (ΔE 14); cuerpo #e8ecf5 → Cristal 390 (ΔE 4); cara #dbab95 → Metal Dorado Rosa
 * 568 (ΔE 10; el Durazno 060 queda a 10,3); plateado #ada49f → Reflex Plata 981 (ΔE 6); dorado #d69e15 → Fashion
 * Mostaza 023 (ΔE 5); aureola #cd9933 → Metal Dorado 570 (ΔE 12). El impreso de la foto es lila: el catálogo solo tiene
 * el «Mi Primera Comunión palomas» blanco, que es el que va.
 */
const escena267 = (): Escena => {
  const MORADO = "056", CRISTAL = "390", CARA = "568", PLATA = "981", MOSTAZA = "023", ORO = "570", BLANCO = "005";
  const f = foto(405, 555, 3);
  const m = montaje({ id: "pies", nombre: "Ángel: pies de cuarteto R-5 Fashion Orquídea Morada", pieza: cuarteto(R("R-5", 11, MORADO), [MORADO]), origen: v(0, 5.5, 0) }, v(0, 0, 0));
  const angel: PropiedadesFigura = {
    postura: "de_pie", base: [], piernas: null,
    cuerpo: [{ tipo: "globo", globo: R("R-9", 15, CRISTAL) }],
    cuello: { ...R("R-5", 8, MORADO), cantidad: 2 },
    cabeza: { ...R("R-9", 15, CARA), cara: { ...SIN_CARA, ojos: { estilo: "puntos", hex: "#141414" }, boca: { estilo: "sonrisa", hex: "#8a3a2a" }, mejillas: { hex: "#f2a3a3" } } },
    brazos: { ...T("T-260", 3, CRISTAL), burbujasCm: [7, 7], angulosGrados: [-25, 10], punta: { tipo: "globo", globo: R("R-5", 7, CARA) }, otroLado: { angulosGrados: [40, 75] } },
    accesorios: [
      { en: "espalda", par: true, forma: { tipo: "alas", abanico: { ...T("T-260", 3, BLANCO), estilo: "lazos", cantidad: 2, largoCm: 14, anchoCm: 8, aberturaGrados: 28 }, anguloGrados: 30 } },
      { en: "coronilla", corrimientoCm: [0, -1, 6], forma: { tipo: "aro", tubito: T("T-260", 2.5, ORO), radioCm: 6, plano: "frente", desdeGrados: 0, hastaGrados: 360 } },
    ] satisfies Accesorio[],
    queEs: "a small balloon angel with a gold halo and white wings",
  };
  m.dePie("angel", "Ángel: cuerpo R-9 Cristal, cabeza R-9 Metal Dorado Rosa, alas, brazos y aureola de T-260", { tipo: "figura", propiedades: angel }, v(0, 11, 0));
  helio(m, "cintas", "Ramo de helio: cintas doradas", [
    { id: "helio-comunion", nombre: "R-12 «Mi Primera Comunión» palomas (el impreso más parecido, blanco)", globo: R("R-12", 28, BLANCO), centro: f(370, 55, -6), impresoId: "infinity-mi-primera-comunion-palomas-fashion-blanco" },
    { id: "helio-plata", nombre: "R-12 Reflex Plata de helio", globo: R("R-12", 28, PLATA), centro: f(300, 180, 0) },
    { id: "helio-dorado", nombre: "R-12 Fashion Mostaza de helio", globo: R("R-12", 28, MOSTAZA), centro: f(395, 210, 6) },
  ], f(348, 420, 4), "#e6c15a");
  return escenaDe(m)(sala(200, 200, 220, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 268 · Centro de mesa araña
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570, pequeña. Escala por los R-12 de helio (~85 px = 28 cm): 3 px/cm, piso en y = 555 px, eje en x = 370.
 * La base: cuarteto R-9 negro (~55 px: 18 cm) entre papel de seda morado, verde y naranja. La araña: cuerpo de globo
 * cristal con un globo naranja dentro y el papel de seda, la panza cristal chica con puntos negros, la cabeza R-9
 * naranja con cara de calabaza y 8 patas de T-260 negro (se ven 3 por lado y 2 detrás). Amarrados a la araña, dos
 * monstruos de helio: cada uno un R-12 negro impreso (la calcomanía «Happy Halloween») sobre un R-12 naranja, con un
 * par de R-5 blancos (ojos) y verde lima, y un trío de R-5 negros. Medidos: naranja #fd6c0f → Fashion Naranja 061
 * (ΔE 12); verde #77c45c → Verde Lima 031 (ΔE 6); negro 080; cristal 390. El impreso más parecido del catálogo para la
 * calcomanía: «Happy Halloween Friends» negro.
 */
const escena268 = (): Escena => {
  const NEGRO = "080", NARANJA = "061", VERDE = "031", BLANCO = "005", CRISTAL = "390";
  const FRIENDS = "infinity-happy-halloween-friends-fashion-negro";
  const f = foto(370, 555, 3);
  const m = montaje({ id: "base", nombre: "Araña: base de cuarteto R-9 Fashion Negro", pieza: cuarteto(R("R-9", 18, NEGRO), [NEGRO]), origen: v(0, 9, 0) }, v(0, 0, 0));
  m.dePie("cuerpo", "Araña: cuerpo R-18 Cristal con un R-12 Fashion Naranja y papel de seda dentro", { tipo: "burbuja", propiedades: { exterior: R("R-18", 38, CRISTAL), interiores: [{ formatoId: "R-12", infladoCm: 22, codigos: [NARANJA], cantidad: 1 }], relleno: { tipo: "confeti", colores: ["#7b3fb0", "#7ac943", "#f28a1e"], cantidad: 30, tamanoCm: 4 }, semilla: 268 } }, v(-4, 16, 0));
  m.dePie("panza", "Araña: panza R-9 Cristal con puntos negros", { tipo: "burbuja", propiedades: { exterior: R("R-9", 14, CRISTAL), interiores: [], relleno: { tipo: "confeti", colores: ["#141414"], cantidad: 18, tamanoCm: 1.5 }, semilla: 269 } }, f(362, 397, -8));
  m.conCara("cabeza", "Araña: cabeza R-9 Fashion Naranja con cara de calabaza", R("R-9", 15, NARANJA), f(403, 420, 20), { ...SIN_CARA, calabaza: { hex: "#141414" } }, "an orange jack-o'-lantern balloon spider head");
  const PATAS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [number, number]>, number]> = [
    ["izquierda-1", [[345, 420], [300, 405], [255, 445]], 8], ["izquierda-2", [[345, 430], [290, 450], [265, 500]], 12], ["izquierda-3", [[350, 440], [305, 480], [285, 525]], 16], ["izquierda-4", [[350, 425], [300, 430], [280, 470]], -10],
    ["derecha-1", [[400, 425], [450, 420], [490, 470]], 8], ["derecha-2", [[400, 435], [450, 455], [470, 500]], 12], ["derecha-3", [[395, 445], [430, 485], [440, 520]], 16], ["derecha-4", [[400, 428], [445, 440], [470, 480]], -10],
  ];
  for (const [id, pts, z] of PATAS) {
    const p0 = f(pts[0]![0], pts[0]![1], z);
    const rel = pts.map(([x, y]): readonly [number, number] => { const q = f(x, y); return [r2(q.x - p0.x), r2(q.y - p0.y)]; });
    m.trazo(`pata-${id}`, `Pata ${id.replace("-", " ")}: T-260 Fashion Negro`, T("T-260", 3, NEGRO), [{ tipo: "linea", puntos: rel }], p0, "a black twisted-balloon spider leg");
  }
  helio(m, "cintas", "Ramo de helio: cintas blancas", [
    { id: "helio-negro-1", nombre: "R-12 negro impreso del primer monstruo (Happy Halloween Friends, el más parecido)", globo: R("R-12", 28, NEGRO), centro: f(300, 40, -6), impresoId: FRIENDS },
    { id: "helio-naranja-1", nombre: "R-12 Fashion Naranja del primer monstruo", globo: R("R-12", 26, NARANJA), centro: f(310, 140, -12) },
    { id: "helio-negro-2", nombre: "R-12 negro impreso del segundo monstruo", globo: R("R-12", 28, NEGRO), centro: f(395, 165, 4), impresoId: FRIENDS },
    { id: "helio-naranja-2", nombre: "R-12 Fashion Naranja del segundo monstruo", globo: R("R-12", 26, NARANJA), centro: f(400, 235, -6) },
  ], f(370, 380, 0), "#f2f2f2");
  racimo(m, "ojos-1", "Primer monstruo: ojos", [BLANCO, BLANCO], f(335, 140, 6), 10);
  racimo(m, "pies-1", "Primer monstruo: pies", [VERDE, VERDE], f(340, 215, 0), 11);
  racimo(m, "pies-2", "Segundo monstruo: pies", [NEGRO, NEGRO, NEGRO], f(402, 278, 4), 9);
  const seda = ([["#7b3fb0", 300, 470, -10], ["#7ac943", 430, 470, 0], ["#f28a1e", 330, 510, 30], ["#7b3fb0", 440, 515, 20], ["#7ac943", 280, 505, 20], ["#f28a1e", 455, 450, -20]] as const).map(([hex, px, py, giro], k) =>
    suelto(`papel-seda-${k + 1}`, `Papel de seda ${k + 1}`, escenografia([panelPapel(girarContorno([[-9, -6], [9, -8], [11, 7], [-7, 9]], giro), hex)]), f(px, py).x, f(px, py).y, 14 - (k % 3) * 8));
  return escenaDe(m, seda)(sala(200, 200, 220, { piso: "#efeeee", paredes: "#f8f8f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

const P_NEGRO = pub("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080");
const P_REFLEX_VIOLETA = pub("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951");
const P_REFLEX_DORADO = pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970");
const P_VERDE_AURORA = pub("GLOBO REDONDO REFLEX VERDE AURORA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-aurora", "R-12", "932");

export const LOTE_24: readonly IdeaDigitalizada[] = [
  idea(140, "arco-teteros", "Arco teteros: columnas lila rematadas en tetero y arco de eslabones rosados", escena140,
    "Igual: las dos columnas de 6 cuartetos R-12 lila (contados de 305 a 545 px: 1,2 m; escala por el arco, 2 px/cm) rematadas en tetero —la rosca de un cuarteto R-12 blanco y el chupo de globo cristal con la boca hacia arriba, hasta ~2,07 m— a 2,6 m entre ejes, y el arco de chupo a chupo: 7 eslabones de Link-O-Loon 12 rosados entre 8 uniones contadas de 4 R-5 cada una (lila y arena alternadas), que sube hasta ~2,5 m. Distinto: la idea no publica productos: los colores son los medidos en la foto (Satín Lila 450, Pastel Dusk Rosa 110, Satín Rosado 409 en las uniones «lila», que miden rosado perlado, y Fashion Arena 071); el chupo es un R-18 cristal liso (la foto lo deja ver retorcido por dentro); el arco cuelga del montaje de la columna izquierda (amarrado a las dos en la realidad); la escala sale de los eslabones (no hay nada de tamaño conocido).", []),
  idea(157, "aurora-mist-nacional-2025", "Aurora Mist Nacional 2025: pared Reflex Violeta entre columnas orgánicas caribe y orquídea", escena157,
    "Igual: la escena completa (escala por los metalizados de 18\", 3 px/cm): la pared de R-12 Reflex Violeta en retícula hasta ~2,7 m (10 × 12 globos, que siguen detrás de las columnas), la columna orgánica Azul Caribe a la izquierda con su R-24 al pie, la de Orquídea Morada a la derecha con dos R-18, la base orgánica Reflex Verde Aurora entre las mesas, los cuatro metalizados redondos de 18\" en sus sitios (tres «Feliz Cumpleaños» acuarela, el publicado, y el «Happy Birthday» de arcoíris), las dos mesas metálicas amarilla y rosada, la torta de goteo, los platos y los vasos: los productos publicados. Distinto: lo orgánico lo da el motor con el grosor y el largo medidos (no se cuentan uno a uno); el «Happy Birthday» de arcoíris no está en la tienda: va plata con el texto; el borde de perlas de los metalizados es impreso; las mesas son de 1,2 m como en la foto.",
    [P_REFLEX_VIOLETA, pub("GLOBO REDONDO FASHION ORQUIDEA MORADA", "/products/globo-para-fiesta-latex-redondo-fashion-orquidea-morada", "R-12", "056"), P_VERDE_AURORA, pub("GLOBO REDONDO FASHION AZUL CARIBE", "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", "R-12", "038"), pub("GLOBO METALIZADO FELIZ CUMPLEAÑOS ACUARELA", "/products/globo-metalizado-acuarela", null, null)]),
  idea(165, "baby-shower-dorado-y-rosado", "Baby shower dorado y rosado: pared rosada con letra cursiva dorada y columnas con estrella", escena165,
    "Igual: la pared de ~3,2 × 2,3 m (escala por la estrella de 18\", 1,4 px/cm) en tablero de R-9 rosados perlados con R-5 en los huecos (28 × 20 celdas), la letra cursiva de R-5 dorados en dos hileras a lo largo del trazo, las dos cadenas verticales de 9 globos con confeti dorado (el impreso Confetti Dorado de la tienda), las dos columnas con su palo forrado de tubito blanco y rosado en espiral, el racimo del medio, el cuarteto con confeti, el de R-9 rosados y la estrella metalizada dorada (~1,93 m), y la mesa de postres. Distinto: la idea no publica productos: los colores son los medidos con el blanco equilibrado (la foto tiene dominante naranja): Satín Rosado 409 y Metal Dorado 570; la letra es un trazo aproximado de la «ℰ» de la foto; la pared y las columnas siguen hasta el piso detrás de la mesa (la foto no lo deja ver); la mesa es más sencilla.", []),
  idea(193, "blue-tide-nacional-2025", "Blue Tide Nacional 2025: pared orgánica en franjas de verdes a azules y ramo de helio", escena193,
    "Igual: la escena completa (escala por los R-12 del ramo, 3,4 px/cm): la pared orgánica de ~2,2 × 1,75 m en cinco franjas de abajo arriba —Reflex Azul con Silk Azul Ártico, Azul Naval con R-18, Reflex Plata menuda, Reflex Verde Aurora con R-18 grandes y Pastel Dusk Té Verde con Silk Verde Menta— con sus alturas medidas, el ramo de helio de 6 R-12 (3 impresos «Feliz cumpleaños» terrazo azul, el producto publicado, y 3 plateados) con su pesa de 3 cuartetos R-5 Reflex Azul, las tres mesas de alambre en reloj de arena, la torta, platos y vasos: los productos publicados. Distinto: lo orgánico lo da el motor con el grosor medido de cada franja (no se cuentan uno a uno); el terrazo va en Azul Naval 044, del surtido de la tienda (la foto lo da turquesa profundo); los plateados del ramo no están publicados: Reflex Plata 981 (ΔE 11); los T-260 publicados no se ven en la foto: van listados sin cantidad.",
    [pub("GLOBO REDONDO PASTEL DUSK TÉ VERDE", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-te-verde", "R-12", "126"), P_VERDE_AURORA, pub("GLOBO REDONDO SILK VERDE MENTA", "/products/globo-latex-redondo-silk-verde-menta", "R-12", "826"), pub("GLOBO REDONDO FASHION AZUL NAVAL", "/products/globo-para-fiesta-latex-redondo-fashion-azul-naval", "R-12", "044"), pub("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940"), pub("GLOBO REDONDO SILK AZUL ÁRTICO", "/products/globo-latex-redondo-silk-azul-artico", "R-12", "839"), pub("GLOBO LATEX REDONDO INFINITY® FELIZ CUMPLEAÑOS TERRAZO AZUL FASHION SURTIDO", "/products/globo-latex-redondo-infinity-feliz-cumpleanos-terrazo-azul-fashion-surtido", "R-12", null), pub("GLOBO TUBITO FASHION AZUL NAVAL", "/products/globo-para-fiesta-latex-tubito-fashion-azul-naval", "T-260", "044"), pub("GLOBO TUBITO REFLEX VERDE AURORA", "/products/globo-para-fiesta-latex-tubito-reflex-verde-aurora", "T-260", "932"), pub("GLOBO TUBITO SILK AZUL ÁRTICO", "/products/globo-latex-tubito-silk-azul-artico", "T-260", "839"), pub("GLOBO TUBITO PASTEL DUSK TÉ VERDE", "/products/globo-para-fiesta-latex-tubito-pastel-dusk-te-verde", "T-260", "126")]),
  idea(195, "bonsai-cerezo", "Bonsái cerezo: tronco dorado enrollado y copa orgánica rosada y roja", escena195,
    "Igual: el bonsái de ~2,9 m (escala por los R-24 de la copa, 2 px/cm): el tronco de 7 cuartetos R-12 Reflex Dorado forrado con 8 vueltas de T-260 dorado en diagonal, las raíces de R-5 dorados en el piso a los dos lados (~24 por lado y 10 al pie), la copa orgánica de R-12, R-9 y R-5 Frambuesa, Fucsia, Rosado y Rojo con los 4 R-24 de arriba en sus sitios, los 6 racimos de R-5 dorados metidos en la copa, los 4 colgantes de R-5 y los dos abanicos de papel rojos con corazón: los productos publicados. Distinto: la copa la da el motor con el grosor medido (no se cuentan uno a uno); el rojo no está publicado: Fashion Rojo 015 medido; las vueltas de tubito son espiras regulares (en la foto se cruzan sueltas); los corazoncitos rosados de la copa no se ponen.",
    [pub("GLOBO REDONDO FASHION FRAMBUESA", "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", "R-12", "014"), pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"), pub("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"), pub("GLOBO TUBITO REFLEX DORADO", "/products/globo-para-fiesta-latex-tubito-reflex-dorado", "T-260", "970"), P_REFLEX_DORADO]),
  idea(209, "bouquet-te-amo", "Bouquet te amo: corazón plateado con letras rojas sobre base negra y roja y ramo de helio", escena209,
    "Igual: la base orgánica de R-12 negros (la mitad veteados de plata) y rojos veteados con R-9 merlot (escala por las letras de 16\", 2 px/cm), los 3 cristales con confeti rojo y plata, los 3 corazoncitos rojos, los 5 rizos de T-260 plata y el corazón rojo grande; encima el corazón de R-5 Reflex Plata en tresbolillo (~125 × 80 cm) con las letras metalizadas rojas «AMO» y «TE» y el par de R-5 negros; a la derecha el ramo de 6 R-12 de helio en sus sitios (rojo «te amo», negro, plata, rojo con corazón, negro veteado y otro rojo con corazón abajo), hasta ~2,6 m. Distinto: la idea no publica productos: impresos más parecidos del catálogo (Metalink Plata Graffiti Negro, Graffiti Invierno Rojo, I Love You Moderno en vez de «te amo», Love con corazón blanco); las letras de 16\" no están en la tienda en rojo: genéricas; la base la da el motor (no se cuenta uno a uno); el aro negro de la «T» no se pone.", []),
  idea(210, "bouquet-tenebroso", "Bouquet tenebroso: bruja de calabaza sobre base negra con «Boo» y ramo de helio de monstruos", escena210,
    "Igual: la base orgánica de R-12 negros con telarañas (escala por los R-12 de helio, 5,25 px/cm) con los 5 racimos de R-5 Reflex Violeta y los 4 tríos naranja, «Boo» de T-260 blanco delante, la bruja —cuerpo en campana de R-12 Reflex Dorado con la boca hacia arriba, cuello de R-5 dorados, cabeza R-12 negra con cara de calabaza verde, sombrero de papel negro, brazos de T-260 dorado, la calabacita y el R-5 negro en las manos—, la telaraña de papel naranja con su araña y el ramo de 7 R-12 de helio en sus sitios con los dos tríos violeta en las cintas, hasta ~1,95 m: los productos publicados (Araña Transparente en el cristal «Happy Halloween», Monstruos 2 caras en el naranja y el verde). Distinto: los negros con telaraña plateada de la foto no son el impreso publicado: van con el Araña Metalink negro, el más parecido; la calavera blanca no es del surtido de Monstruos: va lisa con cara impresa; el morado se ve liso; la base la da el motor.",
    [pub("GLOBO INFINITY® ARAÑA TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-arana-fashion-transparente", null, null), pub("GLOBO REDONDO 2 CARAS MONSTRUOS FASHION SURTIDO", "/products/globo-para-fiesta-latex-redondo-2-caras-monstruos-fashion-surtido", "R-12", null), pub("GLOBO TUBITO FASHION BLANCO", "/products/globo-para-fiesta-latex-tubito-fashion-blanco", "T-260", "005"), P_NEGRO, P_REFLEX_DORADO, P_REFLEX_VIOLETA]),
  idea(228, "calabaza-colorida", "Calabaza colorida: aro negro y naranja con calabaza calavera metalizada y cubos «Happy Halloween»", escena228,
    "Igual: la columna de ~2,4 m (escala por el grueso del aro, 8,5 px/cm): la base de cuartetos R-12 naranja «Happy Halloween» (el impreso negro y naranja de la tienda) y R-9 negros, el palito, el aro de ~94 cm de dos Link-O-Loon 660 (negro arriba, naranja abajo), la calabaza calavera metalizada naranja en el centro, los dos cubos metalizados «Happy Halloween», 9 racimos de R-5 metalizados (cobre, verde oliva y violeta) y 4 rizos de T-260 (dos violeta, uno verde y uno cobre) en sus sitios. Distinto: la idea no publica productos: los colores son los medidos en #234 (misma serie); el 660 impreso «Happy Halloween» no está en la tienda: va liso; la calabaza y los cubos metalizados tampoco: van genéricos (sin producto); los R-12 de abajo miden ~33 cm (a tope).", []),
  idea(230, "calabaza-tenebrosa", "Calabaza tenebrosa: cabeza de calabaza de globos naranja con cara negra sobre base verde lima", escena230,
    "Igual: la base Reflex Verde Lima (escala por sus R-12, 5 px/cm): cuarteto R-12, anillo de 8 R-5 y cuarteto R-12 más chico; la cabeza de calabaza en esfera de ~82 cm de R-9 naranja con R-5 en los huecos, la cara de globos negros en su sitio —dos ojos R-9, la nariz R-12 y la boca de 4 R-9 con el diente R-5 naranja—, el tallo de 2 R-5 verde lima y el penacho de 6 rizos de T-260 verde lima, hasta ~1,68 m: los productos publicados. Distinto: los ojos y la nariz de la foto son triangulares (globos apretados); aquí van redondos; la esfera la da el generador con su reparto (no se cuenta uno a uno en la foto).",
    [pub("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931"), pub("GLOBO TUBITO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-reflex-verde-lima", "T-260", "931"), pub("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"), P_NEGRO]),
  idea(234, "calavera-colorida", "Calavera colorida: aro negro y naranja con calavera metalizada y «Día de los Muertos»", escena234,
    "Igual: el centro de ~1,8 m (escala por el metalizado redondo de 18\" y el grueso del aro, 8,5 px/cm): la base de cuarteto R-12 naranja «Happy Halloween» (estrellas y luna: el impreso negro y naranja de la tienda) y R-9 negros, el palito, el aro de ~94 cm de dos Link-O-Loon 660 (negro arriba, naranja abajo), la calavera metalizada grande en el centro y las dos chicas a los lados, el redondo negro «Día de los Muertos», los 5 R-12 negros junto al aro, 6 racimos de R-5 metalizados y 5 rizos de T-260 (cobre, dos violeta y dos verdes) en sus sitios. Distinto: la idea no publica productos: los colores son los medidos (cobre Metal Dorado Rosa 568, verde Reflex Verde Lima 931, violeta 951, rizo Reflex Dorado Rosa 968); el 660 impreso no está en la tienda: va liso; las calaveras y el «Día de los Muertos» van genéricos (la calavera es una silueta con calavera impresa, sin las flores de colores).", []),
  idea(253, "cartera-fashion", "Cartera fashion: cartera de globitos fucsia con asa negra y ramo de helio", escena253,
    "Igual: la cartera de ~58 × 27 cm (escala por los R-12 de helio, 3 px/cm) rellena de R-5 en tresbolillo con su asa de T-260 negro en arco y el moño azul de dos R-5 con su nudo, y los 3 R-12 de helio amarrados a ella en sus sitios (el azul arriba y los dos rosados impresos), hasta ~1,78 m. Distinto: la idea no publica productos: los colores son los medidos en una foto pequeña y saturada (Neón Fucsia 212 la cartera, Fashion Azul 040); los rosados impresos de zapatos y gafas van con el impreso más parecido del catálogo (Corazones Modernos, en 009 y 012 de su surtido); la calcomanía del azul no se pone; la cartera es una capa (en la foto tiene volumen).", []),
  idea(256, "castillo-enredados", "Castillo Enredados: torre gris con la trenza amarilla de Rapunzel y ramo de helio", escena256,
    "Igual: la torre de ~2,6 m (escala por los R-12 de helio, 2 px/cm) de cuartetos R-12 gris perla con R-5 en los huecos y el capitel que se afina, la ventana de arco de T-260 y la línea bajo ella, la trenza de dos T-260 amarillos que baja en diagonal desde la ventana y vuelve abajo, las 8 florecitas de tubito contadas (rosadas, verde y turquesa) y los 3 R-12 de helio amarrados al pie (fucsia, turquesa y lila). Distinto: la idea no publica productos: los colores son los medidos (Silk Gris Medianoche 880, Fashion Amarillo 020); la tienda no tiene los impresos de princesas: los de helio van lisos; la trenza es plana sobre el frente de la torre (en la foto la rodea); el capitel de la foto es más puntiagudo.", []),
  idea(257, "catrina", "Catrina: falda de cuartetos blancos, cabeza de calavera, corona de flores y rosa roja", escena257,
    "Igual: la catrina de ~1,6 m (escala por la cabeza R-12, 3,4 px/cm): la falda de 4 cuartetos R-12 blancos, el cuello de 2 R-5, los brazos de T-260 blanco que abrazan la rosa, la cabeza R-12 blanca con la cara de calavera impresa, la corona de 5 flores de T-260 (verde, fucsia, azul, amarilla y naranja) en sus sitios y la rosa roja de lazos de T-260 en el pecho. Distinto: la idea no publica productos: los colores son los medidos; la cara impresa es la del generador (ojos ovalados, nariz y boca de línea), sin los adornos del maquillaje de catrina de la foto; los brazos son planos.", []),
  idea(267, "centro-de-mesa-angel", "Centro de mesa ángel: angelito de globos con aureola y ramo de helio de primera comunión", escena267,
    "Igual: el angelito de ~63 cm (escala por los R-12 de helio, 3 px/cm) armado con globos: pies de cuarteto R-5 morado, cuerpo R-9 cristal, cuello de 2 R-5 morados, cabeza R-9 con ojos, sonrisa y mejillas, alas de lazos de T-260 blanco, brazos de T-260 con manos de R-5 y aureola de T-260 dorado; los 3 R-12 de helio amarrados a su mano (el impreso de comunión arriba, el plateado y el dorado). Distinto: la idea no publica productos: los colores son los medidos (el dorado mide Fashion Mostaza 023, la cara Metal Dorado Rosa 568); el impreso «Mi Primera Comunión» de la foto es lila y el del catálogo es blanco (el que va); la postura de los brazos la da el generador de figuras.", []),
  idea(268, "centro-de-mesa-arana", "Centro de mesa araña: araña de globo cristal con cabeza de calabaza y monstruos de helio", escena268,
    "Igual: la base de cuarteto R-9 negro con el papel de seda morado, verde y naranja (escala por los R-12 de helio, 3 px/cm), la araña —cuerpo de globo cristal con un globo naranja y papel dentro, la panza cristal con puntos, la cabeza R-9 naranja con cara de calabaza y 8 patas de T-260 negro— y los dos monstruos de helio amarrados a ella (R-12 negro impreso sobre R-12 naranja, con los ojos blancos, los pies verdes y el trío negro), hasta ~1,8 m. Distinto: la idea no publica productos: los colores son los medidos; la calcomanía de los negros va con el impreso más parecido («Happy Halloween Friends»); el papel de seda es plano; las patas de atrás no se ven en la foto y van supuestas.", []),
];
