import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { coloresDelFormato, formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import { paredLentejuelas, tapete, type AcabadoEscenografia, type ElementoEscenografia, type MotivoEscenografia } from "../escenografia";
import { banderin, bolsaDulces, letrero, vasos } from "../utileria";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import type { ColorOrganico, OpcionesOrganico, PuntoGrosor, PuntoMezcla, RellenoOrganico, TramoOrganico } from "../organico";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion, PropiedadesEstrella, PropiedadesMono } from "../figuras";
import type { Accesorio, Cara, PropiedadesFigura } from "../figuras-tubito";
import type { ParteTubito } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { InteriorBurbuja } from "../burbujas";
import type { PatronColumna } from "../columnas";
import type { Vec3 } from "../modulos";
import { centroCuerpo } from "../geometria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 23** (los números de `clasif/lote-23.json`): el tetero de
 * baby shower (#931), el topiario Reflex dorado rosa y plata (#938), el rincón «Wedding shower» (#985), el orgánico de
 * amor y amistad que acaba en malteada (#12), la arañita de centro de mesa (#32), los cuatro árboles de Navidad (#38
 * de Chris Horne, #40 con regalos, #44 Terra y #56 de Link-O-Loon 660), los arcos acuático (#59), marimonda (#107),
 * muñeco de nieve (#111), orgánico aguamarina (#118) y sirenita (#139), y la escena del arco orgánico para papá (#123).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada con rejilla de
 * píxeles y medida (perfil de la silueta fila a fila en los PNG con transparencia):
 * - **Escala**: la de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 18–22 cm, R-12 ≈ 25–28 cm,
 *   R-18 ≈ 42 cm, R-24 ≈ 55 cm, un metalizado de 18" ≈ 45 cm, la cortina de flecos de 2 m). Cuando la foto no trae
 *   nada de tamaño conocido, la escala sale de los tamaños relativos (el anillo de R-5 de la arañita, el R-12 del
 *   tetero) y la nota lo dice. Las posiciones se escriben en el mundo con `foto(eje, piso, px/cm)`: x a la derecha del
 *   eje de la pieza, y desde el piso.
 * - **Conteo**: niveles de las columnas, anillos y filas de los árboles, esferas, ornamentos, rizos, peces, botones…
 *   uno a uno, y lo que la técnica obliga detrás (el cuarto globo de un cuarteto). En lo orgánico el motor da los
 *   globos del grosor y del largo medidos (no se cuentan uno a uno: la nota lo dice). Ninguna idea publica
 *   «Materiales» con cantidades: lo contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos (aunque la foto mida otra cosa: la nota lo dice). Si no,
 *   medidos en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla
 *   oficial) y el código más cercano que se fabrica en ese formato; en las fotos con dominante (la luz fría del
 *   «Wedding shower») después de equilibrar el blanco con algo blanco de la misma foto.
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando la idea lo publica; si no, el más parecido del catálogo
 *   y la nota lo dice; lo que la tienda no tiene (la flor de pascua, la Sirenita) va genérico, sin producto.
 * - **Montaje** (como los lotes 05, 17 y 20): cada estructura es su propio árbol. Su raíz es la estructura de globos
 *   (suelta, en su sitio) o, en la letra «P» de #123, su marco de marquesina (escenografía a la vista); de la raíz cuelga
 *   (`sobre`) un **amarre** escondido (`oculto: true`: existe y da el marco, pero no se dibuja ni se compra) puesto donde
 *   no tiene globos encima (el eje hueco de los cuartetos, el piso bajo un arco), y del amarre todo lo suyo, en el sitio
 *   exacto de la foto. Mesas, cortinas, pedestales y utilería van aparte, sueltos.
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

/** Curva suave (Catmull-Rom) por unos puntos de frente: `pasos` tramos entre cada par (las patas, las algas). */
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
const estrella = (p: PropiedadesEstrella): Decoracion => ({ tipo: "estrella", propiedades: p });
const mono = (p: PropiedadesMono): Decoracion => ({ tipo: "mono", propiedades: p });

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
    const p: Pieza = { tipo: "globo", formatoId: gl.formatoId, infladoCm: gl.infladoCm, codigo: gl.codigo, ...(gl.helio ? { helio: true as const } : {}), ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
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

/** El radio de fuera (cm, del eje vertical a la cara de fuera de los globos) de una pieza a la altura `y` de su espacio. */
function radioDeFuera(pieza: Pieza, y: number): number {
  let mejor = 0;
  for (const g of armarPieza(pieza).globos) {
    const c = mas(g.nudo, por(g.direccion, centroCuerpo("redondo", g.infladoCm)));
    const r = g.infladoCm / 2;
    if (Math.abs(c.y - y) < r) mejor = Math.max(mejor, Math.hypot(c.x, c.z) + Math.sqrt(r * r - (c.y - y) ** 2));
  }
  return mejor;
}

// ----------------------------------------------------------------------------------------------------------
// 931 · Tetero
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 sin nada de tamaño conocido: la escala sale de tomar los R-12 a 27 cm (los rosados miden ~80 px):
 * 2,9 px/cm, con el piso en y = 568 px y el eje en x = 364. Columna de 4 cuartetos R-12 rosados al paso del taller
 * (filas a 525, 460, 395 y 330 px: 65 px = 0,8 diámetros), el primero con un globo al frente; encima un cuarteto R-12
 * blanco algo más inflado (~88 px, centro a 248 px: 110 cm) y el chupo de globo cristal: un bulbo de ~34 cm de ancho
 * (centro a 150 px: 144 cm) que se angosta a una punta de ~16 cm (centro a 55 px: 177 cm) hasta 187 cm. Medidos: rosado
 * #ecb4d1 → Rosado 009 (ΔE 6); blanco en sombra #dce0ea → Blanco 005; el chupo, transparente → Cristal 390.
 */
const escena931 = (): Escena => {
  const ROSADO = "009", BLANCO = "005", CRISTAL = "390";
  const m = montaje({ id: "columna", nombre: "Tetero: columna de 4 cuartetos R-12 Fashion Rosado", pieza: columna(R("R-12", 27, ROSADO), 4, [ROSADO]), origen: v(0, 13.5, 0), giroGrados: 45 }, v(0, 0, 0));
  m.nivel("blanco", "Cuarteto R-12 Fashion Blanco (la rosca del tetero)", cuarteto(R("R-12", 29, BLANCO), [BLANCO]), v(0, 108, 0), 45);
  m.globo("bulbo", "Chupo: R-12 Cristal Transparente (el bulbo)", R("R-12", 30, CRISTAL), v(-4.8, 143, 0), ARRIBA);
  m.globo("punta", "Chupo: R-9 Cristal Transparente (la punta)", R("R-9", 16, CRISTAL), v(-4.5, 175, 0), ARRIBA);
  return escenaDe(m)(sala(260, 240, 230, { piso: "#e9e4de", paredes: "#f6f3ef" }));
};

// ----------------------------------------------------------------------------------------------------------
// 938 · Topiario Reflex dorado rosa y plata
// ----------------------------------------------------------------------------------------------------------

/**
 * Render de 740×570 visto desde arriba y de frente; los R-12 miden ~135 px (28 cm): 4,8 px/cm. La bola es un
 * icosaedro de 12 R-12 (se ven el del centro, que mira a la cámara, sus 5 vecinos y 4 de la segunda corona) de ~77 cm
 * de ancho (de 175 a 545 px), con R-5 Reflex Plata (~55 px: 11,5 cm) en los huecos: se ven 5, los de los triángulos
 * alrededor del globo del centro. Debajo, el nido de rizos de T-260 plata (~22 px de grueso: 4,5 cm) de ~92 cm de
 * ancho y ~47 cm de alto en la foto (se cuentan ~10 tubitos). Colores: los publicados (Reflex Dorado Rosa 968 en R-12,
 * Reflex Plata 981 en R-5 y en T-260).
 */
const escena938 = (): Escena => {
  const ROSA = "968", PLATA = "981";
  const BASE = 45;
  const esfera: Pieza = { tipo: "forma", forma: { clase: "esfera", diametroCm: 76, globo: { formatoId: "R-12", infladoCm: 28 }, colores: { codigos: [ROSA], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 11.5, codigos: [PLATA], cada: 2 } } };
  const m = montaje({ id: "bola", nombre: "Topiario: bola de 12 R-12 Reflex Dorado Rosa con R-5 Reflex Plata", pieza: esfera, origen: v(0, BASE, 0) }, v(0, 0, 0));
  m.dePie("rizos", "Nido de 10 rizos de T-260 Reflex Plata", rizo({ forma: "penacho", formatoId: "T-260", grosorCm: 4.5, codigos: [PLATA], rizos: 10, vueltas: 1.75, radioInicialCm: 4, radioFinalCm: 11, largoCm: 44, inclinacionGrados: 180, aperturaGrados: 62 }), v(0, BASE + 4, 0));
  return escenaDe(m)(sala(240, 220, 200, { piso: "#ebe8e4", paredes: "#f7f6f4" }));
};

// ----------------------------------------------------------------------------------------------------------
// 32 · Arañita centro de mesa
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 tomada un poco desde arriba; sin nada de tamaño conocido, la escala sale del anillo negro de R-5
 * (los de delante miden ~60 px: 12 cm): 5 px/cm, con el piso en y = 555 px y el eje en x = 365. Así la base morada
 * (~90 px) es un cuarteto R-9 (18 cm, uno al frente), la burbuja (220 px) un R-18 Cristal de 44 cm con 8 R-9 naranjas
 * dentro (~70 px: 14 cm; se ven 7), la cabeza (116 px) un R-12 negro a 23 cm con los ojos móviles y, detrás y encima, el
 * abdomen (130 px) otro R-12 negro a 26 cm. Las patas, 8 tubitos negros finos (~8 px: 1,6 cm → T-160) que salen de bajo
 * la cabeza y bajan sobre la burbuja; puntas medidas (cm desde el eje, desde el piso): izquierda (−26, 52), (−23, 57),
 * (−13, 41); derecha (25, 51), (21, 57), (9, 42); las dos de atrás no se ven. Medidos: morado #583d97 → Violeta 051
 * (ΔE 7); naranja #ff602f → Naranja 061 (ΔE 9); negro 080; la burbuja, Cristal 390.
 */
const escena32 = (): Escena => {
  const VIOLETA = "051", NEGRO = "080", NARANJA = "061", CRISTAL = "390";
  const f = foto(365, 555, 5);
  const m = montaje({ id: "base", nombre: "Arañita: cuarteto R-9 Fashion Violeta de la base", pieza: cuarteto(R("R-9", 18, VIOLETA), [VIOLETA]), origen: v(0, 9.5, 0), giroGrados: 45 }, v(0, 0, 0));
  m.nivel("anillo", "Cuarteto R-5 Fashion Negro", cuarteto(R("R-5", 12, NEGRO), [NEGRO]), v(0, 21.5, 0), 0);
  const burbuja: Decoracion = { tipo: "burbuja", propiedades: { exterior: R("R-18", 44, CRISTAL), interiores: [{ formatoId: "R-9", infladoCm: 14, codigos: [NARANJA], cantidad: 8 }], relleno: null, semilla: 32 } };
  m.dePie("burbuja", "Cuerpo: burbuja R-18 Cristal Transparente con 8 R-9 Fashion Naranja dentro", burbuja, v(0, 26, 0));
  m.globo("abdomen", "Abdomen: R-12 Fashion Negro", R("R-12", 26, NEGRO), v(-1, 99, -9), ARRIBA);
  m.conCara("cabeza", "Cabeza: R-12 Fashion Negro con ojos móviles", R("R-12", 23, NEGRO), v(-3, 83, 7), { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#141414" } }, "a black spider head balloon with googly eyes");
  // Las patas: de bajo la cabeza a la punta medida, con la rodilla en medio; las de fuera junto a la burbuja, las de
  // dentro sobre su cara de delante y las dos de atrás (que no se ven) detrás.
  const t = T("T-160", 1.6, NEGRO);
  const patas: ReadonlyArray<readonly [string, string, ReadonlyArray<readonly [number, number]>, number]> = [
    ["pata-izquierda-1", "Pata izquierda de fuera", [[305, 182], [268, 215], [233, 293]], 4],
    ["pata-izquierda-2", "Pata izquierda del medio", [[310, 188], [275, 228], [252, 272]], 10],
    ["pata-izquierda-3", "Pata izquierda de delante", [[318, 192], [306, 265], [300, 350]], 19],
    ["pata-izquierda-4", "Pata izquierda de atrás (no se ve)", [[322, 195], [312, 268], [310, 338]], -19],
    ["pata-derecha-1", "Pata derecha de fuera", [[400, 182], [455, 215], [492, 300]], 4],
    ["pata-derecha-2", "Pata derecha del medio", [[395, 188], [440, 220], [468, 268]], 10],
    ["pata-derecha-3", "Pata derecha de delante", [[388, 192], [402, 268], [410, 345]], 19],
    ["pata-derecha-4", "Pata derecha de atrás (no se ve)", [[384, 195], [398, 270], [402, 338]], -19],
  ];
  for (const [id, nombre, pts, z] of patas) {
    const p0 = f(pts[0]![0], pts[0]![1], z);
    const rel = pts.map(([x, y]): readonly [number, number] => { const q = f(x, y); return [r2(q.x - p0.x), r2(q.y - p0.y)]; });
    m.trazo(id, `${nombre}: T-160 Fashion Negro`, t, [{ tipo: "linea", puntos: rel }], p0, "a thin black twisted-balloon spider leg");
  }
  return escenaDe(m)(sala(240, 220, 180, { piso: "#ece9e6", paredes: "#f6f5f3" }));
};

// ----------------------------------------------------------------------------------------------------------
// 38 · Árbol de Navidad de Chris Horne
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 1000×1000 recortado; los R-12 verdes de abajo miden ~75 px (28 cm): 2,68 px/cm, con el piso en y = 990 px
 * y el eje en x = 500. Cono de anillos de R-12 Verde Selva de 3,08 m (de 990 a 165 px) que se achica de ~16 globos de
 * 28 cm por anillo abajo (1,54 m de ancho por fuera: 413 px) a ~9 de 17 cm arriba (63 cm: 168 px), ~17 anillos (las
 * filas de dorados se cuentan a lo largo); un R-5 dorado chico (~18 px: 7 cm) cada dos huecos entre anillos (en cada
 * fila, uno cada ~123 px). Encima, la flor de pascua metalizada roja (~180 × 155 px: 67 × 58 cm) con hojas verdes.
 * Esferas contadas una a una (44 visibles; las de detrás no se ven y no se ponen): 8 violeta, 5 azul rey, 3 azul claro,
 * 7 verde brillante, 2 verde lima, 5 amarillas, 7 rojas y 7 cristal; de ~35 px arriba a ~75 px abajo (R-9 las de menos
 * de 21 cm, R-12 las demás). Colores: los publicados (Verde Selva 032, Violeta 051, Azul Rey 041, Rojo 015, Amarillo
 * 020 y Verde Lima 031, las amarillo verdosas #c4d900); medidos los que no publica: dorados #b08b57 → Reflex Dorado 970
 * (ΔE 7,5), azul claro #009cdb → Azul 040 (ΔE 11), verde brillante #009a48 → Metal Verde 530 (ΔE 9) y cristal 390.
 */
const ESFERAS_38: ReadonlyArray<readonly [number, number, string]> = [
  [437, 180, "390"], [505, 178, "051"], [568, 185, "041"], [460, 210, "051"], [545, 215, "041"], [590, 225, "530"], [410, 250, "051"], [500, 245, "041"],
  [585, 262, "530"], [445, 290, "041"], [555, 295, "530"], [390, 295, "051"], [612, 300, "020"], [395, 340, "041"], [500, 335, "530"], [603, 340, "031"],
  [370, 380, "040"], [430, 390, "530"], [563, 385, "031"], [628, 385, "015"], [380, 450, "530"], [509, 445, "020"], [620, 440, "015"], [345, 490, "530"],
  [420, 505, "020"], [565, 500, "015"], [650, 500, "390"], [357, 560, "020"], [640, 560, "390"], [495, 580, "015"], [325, 620, "020"], [668, 620, "051"],
  [412, 645, "015"], [595, 665, "390"], [330, 715, "015"], [667, 710, "051"], [318, 755, "015"], [498, 735, "390"], [692, 760, "040"], [395, 810, "390"],
  [603, 820, "051"], [318, 870, "390"], [675, 870, "040"], [500, 915, "051"],
];
const NOMBRE_COLOR: Readonly<Record<string, string>> = {
  "390": "Cristal Transparente", "051": "Fashion Violeta", "041": "Fashion Azul Rey", "040": "Fashion Azul", "530": "Metal Verde", "031": "Fashion Verde Lima",
  "020": "Fashion Amarillo", "015": "Fashion Rojo", "970": "Reflex Dorado", "968": "Reflex Dorado Rosa", "071": "Fashion Arena", "027": "Fashion Eucalipto",
};
const escena38 = (): Escena => {
  const f = foto(500, 990, 2.68);
  const cono: Pieza = { tipo: "forma", forma: { clase: "cono", altoCm: 321, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 28, infladoPuntaCm: 17, globosBase: 16, globosPunta: 9, colores: { codigos: ["032"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 7, codigos: ["970"], cada: 2 } } };
  const m = montaje({ id: "cono", nombre: "Árbol: cono de anillos de R-12 Fashion Verde Selva con R-5 Reflex Dorado", pieza: cono, origen: v(0, 0, 0) }, v(0, 0, 0));
  ESFERAS_38.forEach(([px, py, codigo], k) => {
    const p = f(px, py);
    // El tamaño crece hacia abajo (~35 px arriba, ~75 px abajo); las de menos de 21 cm son R-9.
    const d = r2((35 + ((py - 180) * 40) / 735) / 2.68);
    const g = d < 21 ? R("R-9", Math.max(12, d), codigo) : R("R-12", Math.min(29, d), codigo);
    const rho = radioDeFuera(cono, p.y) + 0.15 * g.infladoCm;
    const x = Math.max(-0.95 * rho, Math.min(0.95 * rho, p.x));
    const z = Math.sqrt(rho * rho - x * x);
    m.globo(`esfera-${k + 1}`, `Esfera ${k + 1}: ${g.formatoId} ${NOMBRE_COLOR[codigo] ?? codigo}`, g, v(r2(x), p.y, r2(z)), unitario(v(x / rho, 0.16, z / rho)));
  });
  m.foil("flor-de-pascua", "Flor de pascua: estrella metalizada roja de 27\" (sin producto)", { forma: { tipo: "estrella" }, pulgadas: 27, color: "rojo" }, v(1.9, 335, 4));
  const hojas: ElementoEscenografia[] = [
    panelFoil([[-44, 9], [-30, 2], [-14, 6], [-24, 16], [-38, 18]], 3, "#2f8a3c"),
    panelFoil([[14, 36], [24, 30], [36, 34], [30, 44], [18, 44]], 3, "#2f8a3c"),
  ];
  m.foilPaneles("hojas", "Hojas de foil verde de la flor de pascua", hojas, v(1.9, 316, -3));
  return escenaDe(m)(sala(340, 300, 390, { piso: "#e6e1db", paredes: "#f5f2ee" }));
};

// ----------------------------------------------------------------------------------------------------------
// 40 · Árbol de Navidad con regalos
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 1000×1000 (fondo blanco); los globos grandes miden ~110 px (R-12 a 28 cm): 3,9 px/cm, con el piso en
 * y = 920 px y el eje en x = 515. Cono orgánico todo Reflex Dorado de 1,86 m (de 920 a 195 px) que se abre de ~16 cm
 * de radio arriba a ~55 cm abajo (430 px de ancho), con tres tamaños: R-12 grandes (~110 px), R-9 (~70 px) y racimos
 * de R-5 chicos (~28 px: 7 cm). Encima, la estrella de contorno de T-260 Reflex Dorado (205 px: radio de 26 cm, centro a
 * 208 cm) con sus perillas en las puntas. Al pie, dos bolsas de papel rojas con un arbolito y dos bolsas de celofán con
 * dulces. Colores: los publicados (Reflex Dorado 970 en R-12 y en T-260; medido #b39257 lo confirma).
 */
const escena40 = (): Escena => {
  const ORO = "970";
  const cono: Pieza = { tipo: "forma", forma: { clase: "cono", altoCm: 186, tecnica: "organico", formatoId: "R-12", infladoBaseCm: 28, infladoPuntaCm: 12, globosBase: 10, globosPunta: 4, colores: { codigos: [ORO], patron: "un_color" }, mezcla: { "R-12": 0.3, "R-9": 0.25, "R-5": 0.45 }, semilla: 40 } };
  const m = montaje({ id: "cono", nombre: "Árbol: cono orgánico de R-12, R-9 y R-5 Reflex Dorado", pieza: cono, origen: v(0, 0, 0) }, v(0, 0, 0));
  m.deco("estrella", "Estrella de contorno de T-260 Reflex Dorado", estrella({ formatoId: "T-260", grosorCm: 4.5, codigo: ORO, puntas: 5, radioCm: 26, estilo: "contorno", giroGrados: 0, centro: null }), v(-2, 208, 2), AL_FRENTE);
  const bolsaPapel = (ancho: number): Pieza => bolsaDulces({ anchoCm: ancho, altoCm: 48, fondoCm: 12, hex: "#d8423f", asas: "#b52a2a", motivo: { dibujo: "texto", texto: "🎄", hex: "#5fae3c" }, productoId: null, descripcion: "bolsa de regalo de papel roja con un arbolito" });
  const celofan = (ancho: number, alto: number): Pieza => bolsaDulces({ anchoCm: ancho, altoCm: alto, fondoCm: 18, hex: "#e8c76a", asas: "#e6e6e6", motivo: { dibujo: "lunares", hex: "#8a6a3c" }, productoId: null, descripcion: "bolsa de celofán con dulces" });
  const bolsas: NodoEscena[] = [
    suelto("bolsa-roja-izquierda", "Bolsa de regalo roja (izquierda)", bolsaPapel(20), -68, 0, 55, 10),
    suelto("bolsa-roja-derecha", "Bolsa de regalo roja (derecha)", bolsaPapel(28), 31, 0, 60, -8),
    suelto("dulces-izquierda", "Bolsa de celofán con dulces (izquierda)", celofan(32, 40), -40, 0, 78, 20),
    suelto("dulces-derecha", "Bolsa de celofán con dulces (derecha)", celofan(28, 36), 62, 0, 35, -25),
  ];
  return escenaDe(m, bolsas)(sala(300, 280, 260, { piso: "#e9e5e0", paredes: "#f7f5f2" }));
};

// ----------------------------------------------------------------------------------------------------------
// 44 · Árbol de Navidad Terra
// ----------------------------------------------------------------------------------------------------------

/**
 * PNG de 1000×1000 recortado; los R-5 que lo cubren miden ~50 px (12 cm): 4,2 px/cm, con el piso en y = 975 px y el
 * eje en x = 495. Cono orgánico de 2,18 m (de 975 a 60 px) con su radio medido fila a fila (de la silueta: 58 cm a
 * 27 cm del piso, 55 a 65, 47 a 113, 34 a 161, 20 a 199 y ~10 arriba), un alma de R-18 y R-12 Eucalipto (se ve abajo)
 * forrada de R-5 arena, dorados, dorado rosa y terracota; 9 esferas rojas (~60 px: R-9 a 14 cm) con su gancho de
 * T-260 dorado, y arriba el moño de lazos de T-260 dorado (235 × 130 px: 56 × 31 cm). Colores: los publicados (Arena
 * 071, Reflex Dorado 970, Reflex Dorado Rosa 968, Eucalipto 027; medidos #d8c6ae y los dorados lo confirman); medidos
 * los que no publica: terracota #b24d30 / #83341c en sombra → Merlot 018 (el más cercano en promedio, ΔE 16; el
 * Naranja Cobrizo 062 queda 7 más lejos) y las esferas #d53b43 → Metal Rojo 515 (ΔE 11; el Reflex Cristal Rojo no se
 * hace en R-9).
 */
const ESFERAS_44: ReadonlyArray<readonly [number, number]> = [[355, 192], [602, 277], [420, 259], [542, 331], [615, 456], [440, 510], [515, 640], [270, 600], [265, 750]];
const escena44 = (): Escena => {
  const ARENA = "071", ORO = "970", ROSA = "968", TERRA = "018", EUCALIPTO = "027", ROJO = "515";
  const f = foto(495, 975, 4.2);
  const g = (t: number, radioCm: number): PuntoGrosor => ({ t, radioCm });
  const arbol = organico([{
    id: "arbol", nombre: "Árbol", puntos: [v(0, 4, 0), v(0, 60, 0), v(0, 120, 0), v(0, 175, 0), v(0, 212, 0)], tapas: { inicio: false, fin: true }, irregularidad: 0.08,
    grosor: [g(0, 58), g(0.3, 55), g(0.52, 47), g(0.74, 34), g(0.91, 20), g(1, 10)],
    mezcla: mezcla({ "R-18": 0.06, "R-12": 0.06, "R-5": 0.88 }, { "R-12": 0.04, "R-5": 0.96 }),
  }], {
    colores: [color(EUCALIPTO, 0.12, ["R-18", "R-12"]), color(ARENA, 0.24, ["R-5"]), color(ORO, 0.24, ["R-5"]), color(ROSA, 0.22, ["R-5"]), color(TERRA, 0.18, ["R-5"])],
    semilla: 44, relleno: RELLENO_12_5,
  });
  const m = montaje({ id: "arbol", nombre: "Árbol Terra: cono orgánico de R-5 arena, dorado, dorado rosa y terracota sobre eucalipto", pieza: arbol.pieza, origen: arbol.origen }, v(0, 0, 0));
  const radio = (y: number) => (y < 27 ? 58 : y < 65 ? 58 - ((y - 27) * 3) / 38 : y < 113 ? 55 - ((y - 65) * 8) / 48 : y < 161 ? 47 - ((y - 113) * 13) / 48 : y < 199 ? 34 - ((y - 161) * 14) / 38 : 20 - ((y - 199) * 10) / 19);
  ESFERAS_44.forEach(([px, py], k) => {
    const p = f(px, py);
    const rho = radio(p.y) + 5;
    const x = Math.max(-0.95 * rho, Math.min(0.95 * rho, p.x));
    const z = r2(Math.sqrt(rho * rho - x * x));
    m.globo(`esfera-${k + 1}`, `Esfera ${k + 1}: R-9 Metal Rojo`, R("R-9", 14, ROJO), v(r2(x), p.y, z), ABAJO);
    m.deco(`gancho-${k + 1}`, `Gancho de la esfera ${k + 1}: lazos de T-260 Reflex Dorado`, mono({ formatoId: "T-260", grosorCm: 2.5, codigo: ORO, lazosPorLado: 1, largoLazoCm: 4.5, anchoLazoCm: 3.5, aberturaGrados: 30, colas: false, largoColaCm: 0, centro: null }), v(r2(x), r2(p.y + 8.5), r2(z + 1)), AL_FRENTE);
  });
  m.deco("mono", "Moño de lazos de T-260 Reflex Dorado", mono({ formatoId: "T-260", grosorCm: 4.5, codigo: ORO, lazosPorLado: 3, largoLazoCm: 24, anchoLazoCm: 13, aberturaGrados: 32, colas: false, largoColaCm: 0, centro: R("R-5", 12, ORO) }), v(-3, 210, 4), AL_FRENTE);
  return escenaDe(m)(sala(300, 280, 260, { piso: "#e8e4df", paredes: "#f6f3ef" }));
};

// ----------------------------------------------------------------------------------------------------------
// 56 · Arbolito de Navidad con Link-O-Loon 660
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; la estrella metalizada de 18" mide ~120 px de ancho (~44 cm): 2,7 px/cm, con el piso en y = 562 px
 * y el eje en x = 368. Base de dos cuartetos R-9 café (~58 px: 21,5 cm; el de abajo con uno al frente, el de arriba con
 * dos), tronco de 9 cuartetos R-9 Verde Selva (~45 px: 17 cm) de 44 a 166 cm, y 5 pisos de lazos de Link-O-Loon 660
 * verde (~38 px de grueso: 14 cm), 4 lazos por piso acostados alrededor del tronco, girados 45° de un piso a otro y
 * cada vez más cortos: a 56 cm (lazos de 50 cm), 82 (45), 107 (40), 130 (35) y 155 (25). Entre los lazos, 9 R-5 rojos
 * (~30 px: 11 cm) contados uno a uno (los de detrás no se ven); arriba, la estrella dorada (centro a 185 cm, hasta
 * 2,06 m). Medidos: café #824c19 → Café 074 (ΔE 13); verde #007d46 → Verde Selva 032 (ΔE 1); rojo 015.
 */
const ROJOS_56: ReadonlyArray<readonly [number, number, number]> = [[351, 148, 14], [330, 179, 12], [401, 183, 12], [401, 239, 13], [342, 267, 14], [363, 322, 15], [378, 371, 15], [312, 388, 10], [315, 173, 6]];
const escena56 = (): Escena => {
  const CAFE = "074", VERDE = "032", ROJO = "015";
  const f = foto(368, 562, 2.7);
  const m = montaje({ id: "base", nombre: "Arbolito: cuarteto R-9 Fashion Café de abajo", pieza: cuarteto(R("R-9", 21.5, CAFE), [CAFE]), origen: v(0, 11, 0), giroGrados: 45 }, v(0, 0, 0));
  m.nivel("base-arriba", "Cuarteto R-9 Fashion Café de arriba", cuarteto(R("R-9", 21.5, CAFE), [CAFE]), v(0, 28, 0), 0);
  m.nivel("tronco", "Tronco: 9 cuartetos R-9 Fashion Verde Selva", columna(R("R-9", 17, VERDE), 9, [VERDE]), v(0, 44, 0), 0);
  const pisos: ReadonlyArray<readonly [number, number, number]> = [[56, 50, 0], [82, 45, 45], [107, 40, 0], [130, 35, 45], [155, 25, 0]];
  pisos.forEach(([y, largoCm, giro], k) => m.deco(`piso-${k + 1}`, `Piso ${k + 1}: 4 lazos de Link-O-Loon 660 Verde Selva`, {
    tipo: "flor_tubito", propiedades: { petalos: { formatoId: "LOL-660", grosorCm: 14, codigos: [VERDE], cantidad: 4, estilo: "lazo", largoCm, anchoCm: r2(largoCm * 0.42), aperturaGrados: 6, giroGrados: giro }, interior: null, corona: null, centro: null },
  }, v(0, y, 0), ARRIBA));
  ROJOS_56.forEach(([px, py, z], k) => {
    const p = f(px, py, z);
    m.globo(`rojo-${k + 1}`, `R-5 Fashion Rojo ${k + 1}`, R("R-5", 11, ROJO), p, unitario(v(p.x, 0.3, Math.max(4, z))));
  });
  m.foil("estrella", "Estrella metalizada dorada de 18\"", metalizadoDeTienda("estrella-dorado-mate"), f(370, 62, 0));
  return escenaDe(m)(sala(260, 240, 240, { piso: "#e9e5e0", paredes: "#f6f4f1" }));
};

// ----------------------------------------------------------------------------------------------------------
// 59 · Arco acuático
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (dibujo); los óvalos de Link-O-Loon 12 azul miden ~48 px de ancho (21 cm): 2,3 px/cm, con el piso en
 * y = 490 px y el eje en x = 360. Arco de LOL-12 azul rey entrelazado con globitos azules claros en las uniones (la idea
 * dice R-6), por fuera de 3,0 m de ancho y 1,72 m de alto, con una banda de ~45 cm (dos hileras de óvalos). Bajo el
 * arco, tres peces colgados: el amarillo con cuerpo verde (centro a (−56, 96) cm), el naranja con cuerpo amarillo (9,
 * 114) y el blanco con cuerpo rojo (46, 91), cada uno de un R-12 (~60 px) con el contorno de T-260, la cola en V y un ojo;
 * en lo alto, dos caracolas de T-260 fucsia (~50 px: aro de 11 cm de radio) con un R-5 rojo dentro y algas de T-260
 * verde. Medidos: azul #023083 → Azul Rey 041 (ΔE 15; el dibujo está sobresaturado); globitos #0297df → Azul 040 (el
 * Neón Azul queda 4 más cerca: va el Fashion); algas #1cb130 → Verde Trébol 029 (ΔE 3); caracola #fb458c → Fucsia 012
 * (ΔE 10); cuerpos verde → Verde 030 (ΔE 16), amarillo 020 y rojo 015; contornos amarillo miel #e9c109 → 021 (ΔE 4),
 * naranja 061 y blanco 005.
 */
const escena59 = (): Escena => {
  const AZUL = "041", CLARO = "040";
  const f = foto(360, 490, 2.3);
  // El arco: la trenza de cuartetos del taller hecha con Link-O-Loon 12 por una media elipse, y una pareja de unión
  // (un R-5 azul) en cada ancla de la trenza: la banda de óvalos azules con globitos claros de la foto.
  const arco: Pieza = { tipo: "arco", formatoId: "LOL-12", infladoCm: 21, forma: "redondo", anchoCm: 255, altoCm: 150, patron: "un_color", colores: [AZUL] };
  const m = montaje({ id: "arco", nombre: "Arco de cuartetos de Link-O-Loon 12 Fashion Azul Rey", pieza: arco, origen: v(0, 11.5, 0) }, v(0, 0, 0));
  m.nodos.splice(1, 0, { id: "uniones", nombre: "Uniones: R-5 Fashion Azul en cada ancla del arco", pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 10, codigo: CLARO }, colocacion: { en: "ancla", padreId: "arco", ancla: 0, cada: 1, giroGrados: 0 } });
  const peces: ReadonlyArray<readonly [string, string, readonly [number, number], string, string, number]> = [
    ["amarillo", "amarillo con cuerpo verde", [232, 268], "030", "021", 1],
    ["naranja", "naranja con cuerpo amarillo", [380, 228], "020", "061", -1],
    ["blanco", "blanco con cuerpo rojo", [465, 282], "015", "005", -1],
  ];
  for (const [id, nombre, [px, py], cuerpo, contornoPez, mira] of peces) {
    const c = f(px, py, 0);
    const t = T("T-260", 3, contornoPez);
    m.globo(`pez-${id}-cuerpo`, `Pez ${nombre}: cuerpo R-12`, R("R-12", 24, cuerpo), c, AL_FRENTE);
    // El contorno (un aro de T-260 alrededor del cuerpo) y la cola en V detrás (hacia el lado contrario al que mira).
    m.trazo(`pez-${id}-contorno`, `Pez ${nombre}: contorno y cola de T-260`, t, [
      { tipo: "arco", centro: [0, 0], radioCm: 15, desdeGrados: 0, hastaGrados: 360 },
      { tipo: "linea", puntos: [[-mira * 15, 0], [-mira * 26, 8]] },
      { tipo: "linea", puntos: [[-mira * 15, 0], [-mira * 26, -8]] },
      { tipo: "linea", puntos: [[-mira * 26, 8], [-mira * 26, -8]] },
    ], mas(c, v(0, 0, 4)), "a twisted-balloon fish outline with a V tail");
    m.deco(`pez-${id}-ojo`, `Pez ${nombre}: ojo R-5 Fashion Blanco`, { tipo: "ojo", propiedades: { globo: R("R-5", 6, "005"), estilo: { iris: null, pupila: { hex: "#141414", proporcion: 0.5 }, brillo: true, venas: null }, miradaGrados: mira > 0 ? 0 : 180 } }, mas(c, v(mira * 13, 9, 10)), AL_FRENTE);
  }
  for (const [lado, px] of [["izquierda", 225], ["derecha", 497]] as const) {
    const c = f(px, 92, -8);
    m.trazo(`caracola-${lado}`, `Caracola ${lado}: aro de T-260 Fashion Fucsia`, T("T-260", 3.5, "012"), [{ tipo: "arco", centro: [0, 0], radioCm: 11, desdeGrados: 0, hastaGrados: 360 }], c, "a pink twisted-balloon ring");
    m.globo(`caracola-${lado}-centro`, `Caracola ${lado}: R-5 Fashion Rojo dentro`, R("R-5", 9, "015"), mas(c, v(0, 0, 2)), AL_FRENTE);
    [-1, 0, 1].forEach((s, k) => m.dePie(`alga-${lado}-${k + 1}`, `Alga ${k + 1} de la caracola ${lado}: rizo de T-260 Fashion Verde Trébol`, rizo({ forma: "tirabuzon", tubito: T("T-260", 3, "029"), vueltas: 2, radioInicialCm: 3, radioFinalCm: 5, largoCm: 16, eje: "frente" }), mas(f(px + s * 22, 108, 6), v(0, 0, 0))));
  }
  return escenaDe(m)(sala(380, 280, 230, { piso: "#e7eef3", paredes: "#f4f8fa" }));
};

// ----------------------------------------------------------------------------------------------------------
// 111 · Arco muñeco de nieve
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; la cabeza R-24 mide ~105 px (55 cm): 1,91 px/cm, con el piso en y = 555 px y el eje en x = 375. Arco
 * de cuartetos R-12 blancos (~47 px: 25 cm) de 3,04 m de ancho por fuera (de 85 a 665 px) y 1,91 m de alto (arriba en
 * 190 px), redondo con las patas casi rectas. Encima, la cabeza (centro a (−13, 233) cm) con los ojos negros de borde
 * blanco, la nariz de T-260 naranja y la sonrisa de T-260 rojo; el sombrero verde (ala de T-360 de ~42 cm y copa de
 * R-9 con un R-5 encima: la idea dice «R-4», que no existe en la tabla), la bufanda de R-5 rojos y verdes alrededor
 * del cuello con sus dos puntas colgando, los brazos de T-260 chocolate con los dedos en X (de 247 a 468 px) y un botón
 * R-5 negro (~25 px) en el frente del arco. Colores: los que dice el texto de la idea (R-12 blanco fashion 005, T-260
 * chocolate 076) y medidos los demás: verde #0f7a55 → Verde Selva 032; rojo 015; naranja 061; negro 080.
 */
const escena111 = (): Escena => {
  const BLANCO = "005", VERDE = "032", ROJO = "015", CHOCOLATE = "076", NEGRO = "080";
  const f = foto(375, 555, 1.91);
  const arco: Pieza = { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm: 248, altoCm: 155, patron: "un_color", colores: [BLANCO] };
  const m = montaje({ id: "arco", nombre: "Arco de cuartetos R-12 Fashion Blanco", pieza: arco, origen: v(0, 13, 0) }, v(0, 0, 0));
  const cabeza = f(350, 110);
  m.conCara("cabeza", "Cabeza: R-24 Fashion Blanco con ojos", R("R-24", 55, BLANCO), cabeza, { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#141414" } }, "a white snowman head balloon with black eyes");
  m.trazo("nariz", "Nariz: T-260 Fashion Naranja", T("T-260", 3, "061"), [{ tipo: "linea", puntos: [[0, 0], [2.5, -1]] }], mas(f(349, 96), v(0, 0, 27)), "a tiny orange twisted-balloon carrot nose");
  m.trazo("boca", "Sonrisa: T-260 Fashion Rojo", T("T-260", 2.5, ROJO), [{ tipo: "arco", centro: [0, 6], radioCm: 9, desdeGrados: 215, hastaGrados: 325 }], mas(f(351, 108), v(0, 0, 26)), "a red twisted-balloon smile");
  m.dePie("sombrero", "Sombrero: ala de T-360 Fashion Verde Selva, copa R-9 y R-5 encima", figura({
    queEs: "a green balloon hat: a twisted-balloon ring brim and a short crown",
    accesorios: [{ en: "base", forma: { tipo: "sombrero", ala: { ...T("T-360", 7, VERDE), estilo: "aro", radioCm: 17 }, copa: { globo: R("R-9", 20, VERDE) }, cinta: null, pompon: R("R-5", 12, VERDE), inclinacionGrados: 10 } }],
  }), f(345, 57, -2));
  // La bufanda: 12 R-5 rojos y verdes alrededor del cuello y dos puntas de 2 que cuelgan al frente.
  const cuello = f(352, 175);
  for (let k = 0; k < 12; k++) {
    const a = 30 * k + 15;
    m.globo(`bufanda-${k + 1}`, `Bufanda: R-5 ${k % 2 ? "Fashion Verde Selva" : "Fashion Rojo"} ${k + 1}`, R("R-5", 11, k % 2 ? VERDE : ROJO), mas(cuello, enAnillo(a, 17, 0)), haciaFuera(a, 10));
  }
  const puntas: ReadonlyArray<readonly [string, number, number, string]> = [["punta-1", 342, 190, VERDE], ["punta-2", 332, 205, ROJO], ["punta-3", 370, 195, VERDE], ["punta-4", 372, 211, ROJO]];
  for (const [id, px, py, c] of puntas) m.globo(`bufanda-${id}`, `Bufanda, ${id.replace("-", " ")}: R-5 ${c === VERDE ? "Fashion Verde Selva" : "Fashion Rojo"}`, R("R-5", 11, c), f(px, py, 19), unitario(v(0, -0.4, 1)));
  const brazo = T("T-260", 3.5, CHOCOLATE);
  const hombroIzq = f(320, 171), manoIzq = f(247, 196), hombroDer = f(385, 168), manoDer = f(468, 150);
  const rel = (o: Vec3, p: Vec3): readonly [number, number] => [r2(p.x - o.x), r2(p.y - o.y)];
  m.trazo("brazo-izquierdo", "Brazo izquierdo: T-260 Fashion Chocolate con dedos en X", brazo, [
    { tipo: "linea", puntos: [[0, 0], rel(hombroIzq, manoIzq)] },
    { tipo: "linea", puntos: [rel(hombroIzq, f(258, 166)), rel(hombroIzq, f(272, 203))] },
  ], mas(hombroIzq, v(0, 0, -4)), "a brown twisted-balloon snowman arm with crossed fingers");
  m.trazo("brazo-derecho", "Brazo derecho: T-260 Fashion Chocolate con dedos en X", brazo, [
    { tipo: "linea", puntos: [[0, 0], rel(hombroDer, manoDer)] },
    { tipo: "linea", puntos: [rel(hombroDer, f(448, 135)), rel(hombroDer, f(462, 175))] },
  ], mas(hombroDer, v(0, 0, -4)), "a brown twisted-balloon snowman arm with crossed fingers");
  m.globo("boton", "Botón: R-5 Fashion Negro", R("R-5", 12, NEGRO), f(350, 222, 30), AL_FRENTE);
  return escenaDe(m)(sala(380, 280, 300, { piso: "#e8e8ea", paredes: "#f5f6f8" }));
};

// ----------------------------------------------------------------------------------------------------------
// 107 · Arco marimonda
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el R-24 amarillo de abajo a la izquierda mide ~140 px (55 cm): 2,55 px/cm, con el piso en
 * y = 565 px y el eje en x = 375. Dos estructuras: la guirnalda orgánica tropical en «L» invertida (sube por la
 * izquierda desde el R-24 amarillo, cruza arriba a 1,8 m y acaba sobre la cabeza, con el R-18 fucsia de ~41 cm —
 * 105 px, la idea dice R-24— arriba a la derecha) de R-12, R-9 (~48 px: 19 cm) y R-5; y la marimonda: columna de 6
 * cuartetos R-9 en espiral de cuatro colores (naranja, fucsia, azul caribe y verde lima; de 505 a 630 px de ancho) y la
 * cabeza R-24 amarilla (~130 px: 51 cm, centro a (75, 115) cm) con los ojos de aro de T-260 verde neón y pupila negra,
 * la nariz larga de T-260 verde hacia arriba, la boca de labios de T-260 rojo y las orejas-brazos de T-260 azul rey
 * que bajan de lo alto de la cabeza a los hombros. La cara de la foto está corrida a la derecha (la cabeza mira un poco
 * de lado): así va. Colores: los publicados (Amarillo 020, Fucsia 012, Azul Caribe 038, Verde Lima 031, Naranja 061;
 * T-260 Neón Verde 230, Rojo 015 y Azul Rey 041; medidos #dec415 → Amarillo Miel y #ff64af → Neón Fucsia: van los
 * publicados).
 */
const escena107 = (): Escena => {
  const AMARILLO = "020", FUCSIA = "012", CARIBE = "038", LIMA = "031", NARANJA = "061";
  const f = foto(375, 565, 2.55);
  const pts = (lista: ReadonlyArray<readonly [number, number]>, z = 0) => lista.map(([x, y]) => f(x, y, z));
  const guirnalda = organico([{
    id: "guirnalda", nombre: "Guirnalda", tapas: { inicio: true, fin: true }, irregularidad: 0.2,
    puntos: pts([[215, 455], [240, 380], [235, 300], [228, 220], [222, 140], [250, 110], [320, 112], [390, 118], [455, 125], [520, 118], [575, 100], [600, 140], [590, 185]]),
    grosor: [{ t: 0, radioCm: 18 }, { t: 0.4, radioCm: 15 }, { t: 0.9, radioCm: 16 }, { t: 1, radioCm: 13 }],
    mezcla: mezcla({ "R-12": 0.3, "R-9": 0.4, "R-5": 0.3 }),
  }], { colores: [color(AMARILLO, 1), color(FUCSIA, 1), color(CARIBE, 1), color(LIMA, 1), color(NARANJA, 1)], semilla: 107, relleno: RELLENO_12_9, inflados: { ...INFLADOS, "R-9": 19, "R-5": 10 } });
  const g = montaje({ id: "guirnalda", nombre: "Guirnalda orgánica tropical en «L»", pieza: guirnalda.pieza, origen: guirnalda.origen }, v(-10, 0, 0));
  g.globo("r24-amarillo", "R-24 Fashion Amarillo (pie de la guirnalda)", R("R-24", 55, AMARILLO), v(r2((145 - 375) / 2.55), 40, 6), ARRIBA);
  g.globo("r18-fucsia", "R-18 Fashion Fucsia (punta de arriba)", R("R-18", 41, FUCSIA), f(513, 52, -4), unitario(v(0.2, 1, 0.2)));
  g.globo("r12-verde", "R-12 Fashion Verde Lima (esquina de arriba)", R("R-12", 29, LIMA), f(210, 105, 6), unitario(v(-0.5, 1, 0.3)));
  g.globo("r12-amarillo", "R-12 Fashion Amarillo (esquina derecha)", R("R-12", 27, AMARILLO), f(585, 85, 8), unitario(v(0.6, 1, 0.3)));
  // La marimonda: columna, cabeza y su cara.
  const cuerpo: Pieza = { tipo: "columna", formatoId: "R-9", infladoCm: 19, alturaCm: r2(19 * 0.8 * 6), patron: "espiral", colores: [NARANJA, FUCSIA, CARIBE, LIMA] };
  const base = f(567, 565);
  const mm = montaje({ id: "marimonda", nombre: "Marimonda: columna de 6 cuartetos R-9 en espiral de cuatro colores", pieza: cuerpo, origen: v(base.x, 9.5, 0) }, v(base.x, 0, 0));
  const cabeza = f(568, 272);
  mm.conCara("cabeza", "Cabeza de la marimonda: R-24 Fashion Amarillo con las pupilas", R("R-24", 51, AMARILLO), cabeza, { ...SIN_CARA }, "a yellow carnival mask balloon head");
  const sobreCara = (px: number, py: number, fuera = 0) => { const p = f(px, py); const dx = p.x - cabeza.x, dy = p.y - cabeza.y; return v(p.x, p.y, r2(Math.sqrt(Math.max(0, 25.5 ** 2 - dx * dx - dy * dy)) + fuera)); };
  for (const [lado, px] of [["izquierdo", 572], ["derecho", 605]] as const) {
    mm.trazo(`ojo-${lado}`, `Ojo ${lado}: aro de T-260 Neón Verde`, T("T-260", 3, "230"), [{ tipo: "arco", centro: [0, 0], radioCm: 5, desdeGrados: 0, hastaGrados: 360 }], sobreCara(px, 270, 1), "a green twisted-balloon eye ring");
    mm.globo(`pupila-${lado}`, `Pupila ${lado}: R-5 Fashion Negro`, R("R-5", 5.2, "080"), sobreCara(px, 270, 1.5), unitario(v((f(px, 270).x - cabeza.x) / 25, 0, 1)));
  }
  mm.trazo("nariz", "Nariz larga: T-260 Neón Verde hacia arriba", T("T-260", 3.5, "230"), [{ tipo: "linea", puntos: [[0, 0], [0.5, 8], [0.8, 14]] }], sobreCara(599, 262, 4), "a long green twisted-balloon nose pointing up");
  mm.trazo("labios", "Labios: T-260 Fashion Rojo", T("T-260", 3.5, "015"), [{ tipo: "linea", puntos: [[-5, 1.5], [0, 2.5], [5, 1.5]] }, { tipo: "linea", puntos: [[-5, -1], [0, -2.5], [5, -1]] }], sobreCara(587, 300, 1), "red twisted-balloon lips");
  const oreja = (lista: ReadonlyArray<readonly [number, number]>): { origen: Vec3; puntos: Array<readonly [number, number]> } => {
    const ps = pts(lista);
    const o = ps[0]!;
    return { origen: v(o.x, o.y, 0), puntos: suave(ps.map((p): readonly [number, number] => [r2(p.x - o.x), r2(p.y - o.y)]), 2) };
  };
  const izq = oreja([[515, 242], [482, 250], [470, 275], [480, 300], [515, 322], [542, 330]]);
  const der = oreja([[630, 244], [655, 250], [665, 272], [660, 300], [625, 322], [595, 330]]);
  mm.trazo("oreja-izquierda", "Oreja-brazo izquierda: T-260 Fashion Azul Rey", T("T-260", 4, "041"), [{ tipo: "linea", puntos: izq.puntos }], izq.origen, "a blue twisted-balloon arm-ear curving from the head to the shoulder");
  mm.trazo("oreja-derecha", "Oreja-brazo derecha: T-260 Fashion Azul Rey", T("T-260", 4, "041"), [{ tipo: "linea", puntos: der.puntos }], der.origen, "a blue twisted-balloon arm-ear curving from the head to the shoulder");
  return escenaDe(g, mm)(sala(340, 280, 260, { piso: "#ece8e4", paredes: "#f8f6f3" }));
};

// ----------------------------------------------------------------------------------------------------------
// 118 · Arco orgánico aguamarina
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el R-24 blanco de la izquierda mide ~115 px (55 cm): 2,1 px/cm, con el piso en y = 555 px y el
 * eje en x = 350. Arco orgánico de 2,95 m de ancho y 2,57 m de alto: pata izquierda gruesa (~28 cm de radio abajo),
 * arriba más fino (~20) y la pata derecha con una rama que sale a la derecha a media altura; R-18, R-12, R-9 y R-5
 * aguamarina, dorado rosa cromado, perla y champaña cromado. Encima: el R-24 blanco (centro a (−121, 110) cm), dos
 * burbujas cristal —la de arriba a la derecha (R-18, ~43 cm) con un R-12 aguamarina dentro y la del centro (R-24, ~46
 * cm) con globitos rosados, aguamarina y perla— y 6 rizos de T-260 aguamarina. Medidos: aguamarina #4cd4d1 →
 * Aguamarina 037 (ΔE 16; el Azul Caribe queda igual de lejos); rosado cromado #f6b1a3 → Metal Dorado Rosa 568 (ΔE 4);
 * perla #efe7d4 → Satín Perla 406 (ΔE 4); el «plata» cromado #caad9a → Reflex Champaña 971 (ΔE 8); el R-24 blanco
 * #fcfaf6 → Satín Blanco 405 (ΔE 2).
 */
const escena118 = (): Escena => {
  const AGUA = "037", ROSA = "568", PERLA = "406", CHAMPANA = "971", CRISTAL = "390";
  const f = foto(350, 555, 2.1);
  const pts = (lista: ReadonlyArray<readonly [number, number]>, z = 0) => lista.map(([x, y]) => f(x, y, z));
  const arco = organico([
    { id: "izquierda", nombre: "Pata izquierda", tapas: { inicio: true, fin: false }, irregularidad: 0.2, puntos: pts([[95, 540], [100, 460], [112, 390], [145, 290], [165, 200], [200, 140], [240, 105]]), grosor: grosor(28, 22), mezcla: mezcla({ "R-18": 0.08, "R-12": 0.47, "R-9": 0.17, "R-5": 0.28 }) },
    { id: "arriba", nombre: "Arriba", tapas: { inicio: false, fin: false }, irregularidad: 0.2, puntos: pts([[240, 105], [300, 80], [370, 85], [430, 100], [470, 90]]), grosor: grosor(20, 20), mezcla: mezcla({ "R-12": 0.5, "R-9": 0.2, "R-5": 0.3 }) },
    { id: "derecha", nombre: "Pata derecha", tapas: { inicio: false, fin: true }, irregularidad: 0.2, puntos: pts([[470, 90], [475, 150], [470, 230], [465, 320], [460, 420], [470, 520]]), grosor: [{ t: 0, radioCm: 21 }, { t: 0.5, radioCm: 25 }, { t: 1, radioCm: 26 }], mezcla: mezcla({ "R-18": 0.08, "R-12": 0.47, "R-9": 0.17, "R-5": 0.28 }) },
    { id: "rama", nombre: "Rama de la derecha", tapas: { inicio: false, fin: true }, irregularidad: 0.25, puntos: pts([[480, 200], [540, 210], [590, 232], [612, 272]]), grosor: grosor(17, 13), mezcla: mezcla({ "R-12": 0.45, "R-9": 0.2, "R-5": 0.35 }) },
  ], { colores: [color(AGUA, 0.35), color(ROSA, 0.3), color(PERLA, 0.2), color(CHAMPANA, 0.15)], semilla: 118, relleno: RELLENO_12_9 });
  const m = montaje({ id: "arco", nombre: "Arco orgánico aguamarina, dorado rosa, perla y champaña", pieza: arco.pieza, origen: arco.origen }, v(0, 0, 0));
  m.globo("r24-blanco", "R-24 Satín Blanco de la izquierda", R("R-24", 55, "405"), f(95, 325, 14), unitario(v(-0.4, 0.3, 1)));
  const burbuja = (exterior: ParteGlobo, interiores: InteriorBurbuja[], semilla: number): Decoracion => ({ tipo: "burbuja", propiedades: { exterior, interiores, relleno: null, semilla } });
  const nudoBajo = (centro: Vec3, d: number) => v(centro.x, r2(centro.y - centroCuerpo("redondo", d)), centro.z);
  m.dePie("burbuja-arriba", "Burbuja R-18 Cristal Transparente con un R-12 Fashion Aguamarina dentro", burbuja(R("R-18", 43, CRISTAL), [{ formatoId: "R-12", infladoCm: 25, codigos: [AGUA], cantidad: 1 }], 1181), nudoBajo(f(500, 62, 14), 43));
  m.dePie("burbuja-centro", "Burbuja R-24 Cristal Transparente con R-5 dorado rosa, aguamarina y perla dentro", burbuja(R("R-24", 46, CRISTAL), [{ formatoId: "R-5", infladoCm: 11, codigos: [ROSA, AGUA, PERLA], cantidad: 7 }], 1182), nudoBajo(f(300, 183, 22), 46));
  const rizos: ReadonlyArray<readonly [number, number]> = [[232, 80], [118, 165], [78, 192], [102, 215], [408, 262], [522, 440]];
  rizos.forEach(([px, py], k) => m.dePie(`rizo-${k + 1}`, `Rizo ${k + 1} de T-260 Fashion Aguamarina`, rizo({ forma: "tirabuzon", tubito: T("T-260", 4, AGUA), vueltas: 2.5, radioInicialCm: 4, radioFinalCm: 7, largoCm: 18, eje: "frente" }), f(px, py, 18)));
  return escenaDe(m)(sala(360, 280, 290, { piso: "#ebe9e6", paredes: "#f8f7f5" }));
};

// ----------------------------------------------------------------------------------------------------------
// 12 · Amor y amistad: orgánico que acaba en malteada
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; el R-24 rosado de arriba mide ~112 px y la cortina de flecos ~430 px de alto (≈ 1,85 m): 2,35
 * px/cm, con el piso en y = 770 px y el eje en x = 500. Dos estructuras: el orgánico (3,7 m de ancho y 2,6 m de alto)
 * por tramos de color —la pata izquierda rojo imperial (40 → 30 cm de radio), el fucsia de la esquina, el rosado de
 * arriba con su R-24 y el blanco y perla que baja a la derecha— y la malteada (eje en x = 790 px, 123 cm): dos
 * cuartetos R-12 plata de base, 6 cuartetos rosados que se abren de R-9 (~45 px: 19 cm) a R-12 (~70 px: 29 cm) como un
 * vaso, la «crema» de un cuarteto R-12 perla y un racimito de R-9 perla, la cereza (R-9 rojo con su tallo de T-260) y
 * el pitillo de dos T-260 rojo y blanco torcidos que sale a la derecha. Detrás, la cortina de flecos roja y plata.
 * Colores: los publicados (Rojo Imperial 016, Fucsia 012, Rosado 009 en el vaso, Pastel Mate Rosado 609 arriba,
 * Blanco 005 y Satín Blanco 405); medidos los que no publica: la base #8b7b73 → Satín Plata 481 (ΔE 11), la cereza
 * #bb0004 → Rojo 015 (ΔE 13). Los rojos de la foto (#c41030) son más claros que el Rojo Imperial publicado.
 */
const escena12 = (): Escena => {
  const IMPERIAL = "016", FUCSIA = "012", ROSADO = "009", PASTEL = "609", BLANCO = "005", SATIN = "405", PLATA = "481", ROJO = "015";
  const f = foto(500, 770, 2.35);
  const pts = (lista: ReadonlyArray<readonly [number, number]>, z = 0) => lista.map(([x, y]) => f(x, y, z));
  const MEZCLA_GRANDE = mezcla({ "R-18": 0.2, "R-12": 0.45, "R-9": 0.1, "R-5": 0.25 });
  const rojo = organico([{ id: "rojo", nombre: "Pata roja", tapas: { inicio: true, fin: true }, irregularidad: 0.18, puntos: pts([[165, 745], [175, 650], [185, 560], [200, 470], [212, 415]], -60), grosor: grosor(40, 30), mezcla: MEZCLA_GRANDE }],
    { colores: [color(IMPERIAL, 1)], semilla: 121, relleno: RELLENO_12_9 });
  const o = montaje({ id: "organico", nombre: "Orgánico: pata Fashion Rojo Imperial", pieza: rojo.pieza, origen: rojo.origen }, v(0, 0, -60));
  o.organico("fucsia", "Orgánico: esquina Fashion Fucsia", [{ id: "fucsia", nombre: "Fucsia", irregularidad: 0.18, puntos: pts([[205, 430], [225, 360], [250, 300], [275, 258]], -60), grosor: grosor(36, 30), mezcla: MEZCLA_GRANDE }],
    { colores: [color(FUCSIA, 1)], semilla: 122, relleno: RELLENO_12_9 });
  o.organico("rosado", "Orgánico: arriba Pastel Mate Rosado y Fashion Rosado", [{ id: "rosado", nombre: "Rosado", irregularidad: 0.18, puntos: pts([[262, 262], [300, 218], [370, 200], [440, 205], [500, 212]], -60), grosor: grosor(30, 30), mezcla: mezcla({ "R-18": 0.1, "R-12": 0.55, "R-9": 0.1, "R-5": 0.25 }) }],
    { colores: [color(PASTEL, 0.6), color(ROSADO, 0.4)], semilla: 123, relleno: RELLENO_12_9 });
  o.organico("blanco", "Orgánico: blanco y perla hacia la malteada", [{ id: "blanco", nombre: "Blanco", irregularidad: 0.18, puntos: pts([[520, 255], [580, 275], [650, 258], [715, 245], [760, 275]], -60), grosor: grosor(28, 26), mezcla: mezcla({ "R-12": 0.6, "R-9": 0.15, "R-5": 0.25 }) }],
    { colores: [color(BLANCO, 0.5), color(SATIN, 0.5)], semilla: 124, relleno: RELLENO_12_9 });
  o.globo("r24-rosado", "R-24 Pastel Mate Rosado de arriba", R("R-24", 48, PASTEL), f(500, 205, -50), unitario(v(0, 1, 0.4)));
  o.globo("r24-perla", "R-24 Satín Blanco de arriba a la derecha (poco inflado)", R("R-24", 40, SATIN), f(750, 228, -55), unitario(v(0.3, 1, 0.3)));
  // La malteada: base plata, vaso rosado que se abre, crema perla, cereza y pitillo.
  const eje = f(790, 770);
  const mt = montaje({ id: "malteada", nombre: "Malteada: cuarteto R-12 Satín Plata de la base", pieza: cuarteto(R("R-12", 27, PLATA), [PLATA]), origen: v(eje.x, 13.5, -40), giroGrados: 45 }, v(eje.x, 0, -40));
  const sobreEje = (y: number) => v(eje.x, y, -40);
  mt.nivel("base-arriba", "Cuarteto R-12 Satín Plata de la base (arriba)", cuarteto(R("R-12", 27, PLATA), [PLATA]), sobreEje(35), 0);
  const vaso: ReadonlyArray<readonly [number, string, number]> = [[640, "R-9", 19], [600, "R-9", 21], [555, "R-12", 23], [508, "R-12", 25], [460, "R-12", 27], [412, "R-12", 29]];
  vaso.forEach(([py, fmt, d], k) => mt.nivel(`vaso-${k + 1}`, `Vaso: cuarteto ${fmt} Fashion Rosado ${k + 1}`, cuarteto(R(fmt, d, ROSADO), [ROSADO]), sobreEje(r2((770 - py) / 2.35)), k % 2 ? 45 : 0));
  mt.nivel("crema", "Crema: cuarteto R-12 Satín Blanco", cuarteto(R("R-12", 29, SATIN), [SATIN]), sobreEje(177), 45);
  mt.nivel("crema-arriba", "Crema: cuarteto R-9 Satín Blanco de arriba", cuarteto(R("R-9", 20, SATIN), [SATIN]), sobreEje(195), 0);
  const cereza = mas(sobreEje(206), v(4, 0, 2));
  mt.globo("cereza", "Cereza: R-9 Fashion Rojo", R("R-9", 17, ROJO), cereza, ARRIBA);
  mt.trazo("tallo", "Tallo de la cereza: T-260 Fashion Rojo", T("T-260", 2.5, ROJO), [{ tipo: "linea", puntos: [[0, 0], [-2, 9], [-6, 16]] }], mas(cereza, v(0, 8, 0)), "a red twisted-balloon cherry stem");
  const desde = f(857, 345, -40), hasta = f(975, 285, -40);
  const dir = unitario(menos(hasta, desde));
  for (const [c, giro, nombre] of [[ROJO, 0, "Fashion Rojo"], [BLANCO, 180, "Fashion Blanco"]] as const) {
    mt.deco(`pitillo-${c === ROJO ? "rojo" : "blanco"}`, `Pitillo: T-260 ${nombre} torcido`, rizo({ forma: "resorte", tubito: T("T-260", 3, c), vueltas: 4, radioCm: 1.6, largoCm: r2(largo(menos(hasta, desde))), eje: "frente", giroGrados: giro }), desde, dir);
  }
  // La cortina de flecos (no cotiza): tiras rojas y plateadas colgadas detrás del orgánico.
  const cortina: ElementoEscenografia[] = [];
  for (let k = 0; k < 44; k++) {
    const x = -106 + k * 4.8;
    cortina.push(caja(v(r2(x), 104, 0), v(4.2, 172, 0.4), k % 3 === 2 ? "#cfd2d6" : "#c0182c", "metal"));
  }
  const fondo: NodoEscena[] = [suelto("cortina", "Cortina de flecos metalizada roja y plata", escenografia(cortina), 0, 6, -110)];
  return escenaDe(o, mt, fondo)(sala(480, 300, 300, { piso: "#efebe7", paredes: "#f8f6f3" }));
};

// ----------------------------------------------------------------------------------------------------------
// 139 · Arco sirenita
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 muy pequeña y lavada (dibujo de catálogo) sin nada de tamaño conocido: la escala sale de tomar el
 * arco de ~2,5 m de ancho (505 px): 2 px/cm, con el piso en y = 460 px y el eje en x = 302. Por fuera 2,52 m de ancho
 * y 2,07 m de alto; por dentro 1,07 m de ancho y 1,57 m de alto: la banda mide ~72 cm en las patas y ~50 arriba. Es
 * de tiras de Link-O-Loon 12 en degradé de azules —oscuro por dentro, claro por fuera— con globitos aguamarina
 * entrelazados y cubierta de tubitos cristal entorchados (la espuma); en la base de la derecha, la Sirenita
 * metalizada (~55 × 50 cm) y en las dos bases racimos de R-9 pastel. Medidos: tira de dentro #005298 → Azul Rey 041
 * (ΔE 8), la del medio #016dbe y la de fuera #009ee1 → Azul 040 (ΔE 12; el Azul Hortensia no se vende en LOL-12): la
 * del medio va Azul y la de fuera, que en la foto se ve celeste bajo la espuma, Pastel Mate Azul 640 para que haya
 * degradé; globitos #84cccf → Aguamarina 037 (ΔE 3); bases rosado #f5a3d2 → Satín Rosado
 * 409, amarillo #f9f3b7 → Pastel Mate Amarillo 620 y verde amarillo #acb803 → Neón Amarillo 220.
 */
const escena139 = (): Escena => {
  const DENTRO = "041", MEDIO = "040", FUERA = "640", AGUA = "037", CRISTAL = "390";
  const f = foto(302, 460, 2);
  const tira = (anchoCm: number, altoCm: number, codigo: string): Pieza => ({ tipo: "arco", formatoId: "LOL-12", infladoCm: 12.5, forma: "redondo", anchoCm, altoCm, patron: "un_color", colores: [codigo] });
  const m = montaje({ id: "arco", nombre: "Arco sirenita: tira del medio de Link-O-Loon 12 Fashion Azul", pieza: tira(179, 172, MEDIO), origen: v(0, 7, 0) }, v(0, 0, 0));
  m.nodos.splice(1, 0, { id: "globitos", nombre: "Globitos R-5 Fashion Aguamarina entrelazados en la tira del medio", pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 9, codigo: AGUA }, colocacion: { en: "ancla", padreId: "arco", ancla: 0, cada: 2, giroGrados: 0 } });
  m.pieza("tira-dentro", "Tira de dentro: Link-O-Loon 12 Fashion Azul Rey", tira(131, 158, DENTRO), v(0, 7, -4), ARRIBA, 90);
  m.pieza("tira-fuera", "Tira de fuera: Link-O-Loon 12 Pastel Mate Azul", tira(227, 186, FUERA), v(0, 7, -4), ARRIBA, 90);
  // La espuma: tubitos cristal entorchados por el borde de fuera y en las bases.
  const espuma = rizo({ forma: "tirabuzon", tubito: T("T-260", 3, CRISTAL), vueltas: 3, radioInicialCm: 3, radioFinalCm: 6, largoCm: 16, eje: "frente" });
  [12, 32, 52, 72, 90, 108, 128, 148, 168].forEach((a, k) => m.dePie(`espuma-${k + 1}`, `Espuma ${k + 1}: T-260 Cristal Transparente entorchado`, espuma, v(r2(-118 * Math.cos(rad(a))), r2(10 + 190 * Math.sin(rad(a))), 14)));
  const bases: ReadonlyArray<readonly [number, number]> = [[70, 400], [140, 395], [470, 400], [560, 420], [655, 400], [690, 360]];
  bases.forEach(([px, py], k) => m.dePie(`espuma-base-${k + 1}`, `Espuma de la base ${k + 1}: T-260 Cristal Transparente entorchado`, espuma, f(px, py, 22)));
  const pastel: ReadonlyArray<readonly [string, number, number, string, string]> = [
    ["rosado-izquierda", 55, 445, "409", "Satín Rosado"], ["amarillo-izquierda-1", 90, 448, "620", "Pastel Mate Amarillo"], ["amarillo-izquierda-2", 135, 445, "620", "Pastel Mate Amarillo"],
    ["verde-derecha-1", 650, 448, "220", "Neón Amarillo"], ["verde-derecha-2", 620, 452, "220", "Neón Amarillo"], ["amarillo-derecha", 585, 450, "620", "Pastel Mate Amarillo"],
  ];
  for (const [id, px, py, c, nombre] of pastel) m.globo(`base-${id}`, `Base (${id.replace(/-/g, " ")}): R-9 ${nombre}`, R("R-9", 19, c), v(r2((px - 302) / 2), r2(Math.max(16, (460 - py) / 2 + 9)), 26), unitario(v(0, 1, 0.5)));
  // La Sirenita (la tienda no la tiene: paneles de foil genéricos): cola verde, cuerpo, concha lila y el pelo rojo.
  const sirenita: ElementoEscenografia[] = [
    panelFoil([[-4, 0], [10, 2], [16, 8], [12, 20], [4, 22], [-6, 14]], 5, "#2fa36b"),
    panelFoil(ovalo(-2, 26, 8, 9, 16), 5, "#f6c9b0", undefined, 1),
    panelFoil(ovalo(-2, 30, 7, 3, 12), 3, "#8e5bb5", undefined, 3),
    panelFoil([[-12, 32], [-22, 38], [-26, 46], [-14, 50], [4, 50], [10, 44], [6, 36], [-4, 40]], 5, "#d8262e", undefined, -1),
  ];
  m.foilPaneles("sirenita", "La Sirenita: paneles de foil genéricos (sin producto)", sirenita, f(545, 410, 30));
  return escenaDe(m)(sala(420, 280, 260, { piso: "#e8eff3", paredes: "#f5f9fb" }));
};

// ----------------------------------------------------------------------------------------------------------
// 123 · Arco orgánico para papá (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1062 de la escena completa; el R-24 Reflex Azul de abajo mide ~175 px (55 cm): 3,2 px/cm, con el piso
 * del frente en y = 940 px y el eje en x = 500. Dos estructuras, cada una su árbol: el orgánico que enmarca el panel
 * (arriba de 95 a 800 px, a ~2,7 m, y la pata derecha que baja hasta el piso, con un pie hacia la izquierda junto al
 * pedestal) de R-24, R-18 y R-12 Reflex Azul, Azul Rey, Negro y Mostaza con tríos de R-5 Reflex Plata; y la letra «P»
 * de marquesina plateada (69 × 119 cm, de 165 a 385 px y de 545 a 925 px) con 12 globos dentro contados uno a uno: 3
 * azules impresos «Feliz día papá», 4 mostaza, 4 negros y 1 azul liso. Escenografía y utilería: el panel de lentejuelas
 * plata (98 × 170 cm), el banderín de bigotes y «Feliz Día», el pedestal blanco (38 × 66 cm) con el plato «Feliz Día»
 * y dos vasos. Colores: los publicados (Mostaza 023, Azul Rey 041, Negro 080, Reflex Plata 981, Reflex Azul 940). Los
 * globos de la «P» miden ~58 px (17 cm): R-12 poco inflados (el impreso solo se vende en R-12).
 */
const escena123 = (): Escena => {
  const REFLEX = "940", AZUL = "041", NEGRO = "080", MOSTAZA = "023", PLATA = "981";
  const f = foto(500, 940, 3.2);
  const Z = -105;
  const pts = (lista: ReadonlyArray<readonly [number, number]>) => lista.map(([x, y]) => f(x, y, Z));
  const MEZCLA = mezcla({ "R-24": 0.15, "R-18": 0.2, "R-12": 0.3, "R-5": 0.35 });
  const marco = organico([
    { id: "arriba", nombre: "Arriba", tapas: { inicio: true, fin: false }, irregularidad: 0.22, puntos: pts([[95, 215], [140, 150], [250, 130], [350, 135], [450, 145], [560, 130], [690, 110], [800, 175]]), grosor: [{ t: 0, radioCm: 34 }, { t: 0.5, radioCm: 30 }, { t: 1, radioCm: 36 }], mezcla: MEZCLA },
    { id: "derecha", nombre: "Pata derecha", tapas: { inicio: false, fin: false }, irregularidad: 0.22, puntos: pts([[800, 175], [770, 260], [735, 360], [705, 460], [690, 560], [680, 660], [688, 760], [685, 860], [672, 915]]), grosor: [{ t: 0, radioCm: 36 }, { t: 0.5, radioCm: 40 }, { t: 1, radioCm: 38 }], mezcla: MEZCLA },
    { id: "pie", nombre: "Pie hacia el pedestal", tapas: { inicio: false, fin: true }, irregularidad: 0.22, puntos: pts([[688, 760], [610, 805], [560, 870]]), grosor: grosor(30, 22), mezcla: mezcla({ "R-18": 0.15, "R-12": 0.4, "R-5": 0.45 }) },
  ], { colores: [color(REFLEX, 0.085), color(AZUL, 0.05), color(NEGRO, 0.05), color(MOSTAZA, 0.035), color(PLATA, 0.78, ["R-5"])], semilla: 123, relleno: RELLENO_12_5 });
  const o = montaje({ id: "organico", nombre: "Orgánico Reflex Azul, Azul Rey, Negro y Mostaza con Reflex Plata", pieza: marco.pieza, origen: marco.origen }, v(-20, 0, Z));
  // La «P» de marquesina: el marco de tubo plateado con su fondo (a la vista) y sus 12 globos dentro.
  const P: Array<readonly [number, number]> = [[0, 0], [44, 0], [44, 24], [30, 24], [30, 58], [50, 58], [60, 61], [67, 70], [69, 88], [67, 106], [60, 115], [50, 119], [0, 119]];
  const hueco: Array<readonly [number, number]> = [[30, 72], [46, 72], [51, 80], [52, 88], [51, 96], [46, 104], [30, 104]];
  const PLATEADO = "#c9ccd1";
  const contornoP = (lista: ReadonlyArray<readonly [number, number]>) => lista.map(([x, y]) => ({ x: r2(x - 34.5), y }));
  const marquesina: ElementoEscenografia[] = [
    { forma: "panel", contorno: contornoP(P), huecos: [contornoP([...hueco].reverse())], zCm: -10, grosorCm: 1.5, hex: PLATEADO, acabado: "metal" },
    ...[...P, P[0]!].slice(1).map((q, k) => barra(v(r2(P[k]![0] - 34.5), P[k]![1], 0), v(r2(q[0] - 34.5), q[1], 0), 2, PLATEADO, "metal")),
    ...[...hueco, hueco[0]!].slice(1).map((q, k) => barra(v(r2(hueco[k]![0] - 34.5), hueco[k]![1], 0), v(r2(q[0] - 34.5), q[1], 0), 2, PLATEADO, "metal")),
  ];
  const baseP = v(r2((165 + 110 - 500) / 3.2), 2, -60);
  const p = montaje({ id: "letra-p", nombre: "Letra «P» de marquesina plateada", pieza: escenografia(marquesina), origen: baseP }, v(baseP.x, 0, -66));
  const PAPA = "infinity-r-feliz-dia-papa-oeste-fashion-surtido";
  const globosP: ReadonlyArray<readonly [number, number, string, boolean]> = [
    [225, 585, AZUL, true], [280, 585, MOSTAZA, false], [330, 590, NEGRO, false], [225, 645, NEGRO, false], [345, 650, AZUL, true], [230, 700, MOSTAZA, false],
    [285, 715, NEGRO, false], [335, 700, MOSTAZA, false], [230, 760, AZUL, true], [235, 825, NEGRO, false], [210, 880, AZUL, false], [270, 880, MOSTAZA, false],
  ];
  const NOMBRES: Readonly<Record<string, string>> = { [AZUL]: "Fashion Azul Rey", [MOSTAZA]: "Fashion Mostaza", [NEGRO]: "Fashion Negro" };
  globosP.forEach(([px, py, c, impreso], k) => {
    const q = v(r2((px - 500) / 3.2), r2((925 - py) / 3.2), -60);
    p.globo(`p-globo-${k + 1}`, `«P», globo ${k + 1}: R-12 ${impreso ? "Infinity® Feliz Día Papá (azul rey)" : NOMBRES[c]}`, R("R-12", 17, c), q, AL_FRENTE, impreso ? PAPA : undefined);
  });
  const banderin123 = banderin({
    recorrido: { tipo: "recto", desde: v(-68, 0, 0), hasta: v(68, -26, 0) }, caidaCm: 10, cantidad: 4, forma: "triangulo", anchoCm: 22, altoCm: 30,
    colores: ["#1b1b1d", "#f3f3f1", "#1b1b1d", "#f3f3f1"], motivos: [{ dibujo: "rayas", hex: "#f3f3f1" }, { dibujo: "texto", texto: "Feliz Día", hex: "#2442a8" }],
    cordon: "#1b1b1d", productoId: null, descripcion: "banderín de papel de bigotes «Feliz Día»",
  });
  const pedestal: ElementoEscenografia[] = [caja(v(0, 33, 0), v(38, 66, 38), "#f7f7f5", "mate")];
  const escenario: NodoEscena[] = [
    suelto("panel", "Panel de lentejuelas plata", escenografia([paredLentejuelas({ anchoCm: 98, altoCm: 170, hex: "#d9dce0" })]), -18, 26, -149),
    suelto("banderin", "Banderín de bigotes «Feliz Día»", banderin123, -32, 196, -140),
    suelto("pedestal", "Pedestal blanco", escenografia(pedestal), -21, 0, -25),
    suelto("plato", "Plato «Feliz Día» de bigotes en su atril", letrero({ forma: "circulo", anchoCm: 26, altoCm: 26, hex: "#1d2f6e", motivo: { dibujo: "texto", texto: "Feliz Día", hex: "#ffffff" }, apoyo: "atril", productoId: null, descripcion: "plato de bigotes «Feliz Día»" }), -27, 66, -30),
    suelto("vasos", "Vasos azules de bigotes", vasos({ cantidad: 2, altoCm: 10, diametroCm: 7, hex: "#2442a8", motivo: { dibujo: "rayas", hex: "#ffffff" }, productoId: null, descripcion: "vasos de bigotes" }), -9, 66, -22),
    suelto("tapete", "Piso de madera", escenografia(tapete({ anchoCm: 420, fondoCm: 300, hex: "#d9a77a" })), 0, 0, 0),
  ];
  return escenaDe(o, p, escenario)(sala(420, 300, 300, { piso: "#d9a77a", paredes: "#efe9df" }));
};

// ----------------------------------------------------------------------------------------------------------
// 985 · Wedding shower
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 con luz fría (los blancos miden azulados: las rosas blancas #b7ccd1). La pared de globos perla cubre
 * todo el fondo: R-12 de ~52 px en retícula (~7,5 por fila a lo ancho de la foto y ~11 filas a lo alto); la foto la
 * corta por los lados, así que su tamaño (10 × 11 globos, ~2,3 × 2,5 m) es supuesto. Delante, tres R-12 de helio con su
 * cinta (dos perla y el cristal impreso de filigrana blanca) amarrados al florero, el florero de vidrio con rosas
 * blancas y los letreros de foto («Best day ever!», «Love», el anillo) sobre un pedestal espejado. Medidos: la pared
 * #adc6cc → Satín Azul 440 sin equilibrar; con el blanco de las rosas, blanco perlado → Satín Blanco 405; el de helio
 * cristal → 390.
 */
const escena985 = (): Escena => {
  const PERLA = "405", CRISTAL = "390";
  const filas = Array.from({ length: 11 }, () => "aaaaaaaaaa");
  const pared: Pieza = { tipo: "mural", mural: { matriz: { colores: [PERLA], filas }, disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 25 }, chico: null } };
  const m = montaje({ id: "pared", nombre: "Pared de R-12 Satín Blanco en retícula", pieza: pared, origen: v(0, 0, -122) }, v(0, 0, -102));
  const ALTO_PEDESTAL = 75;
  const ramo: Pieza = {
    tipo: "decoracion",
    decoracion: { tipo: "ramo_helio", propiedades: { globos: [R("R-12", 28, CRISTAL), R("R-12", 27, PERLA), R("R-12", 27, PERLA)], alturaCm: 158, cinta: { hex: "#f4f4f2" }, peso: { hex: "#dfe7ea" } } },
    impresos: [{ impresoId: "infinity-graffiti-invierno-fashion-transparente", globos: [0] }],
  };
  const pedestal: ElementoEscenografia[] = [caja(v(0, ALTO_PEDESTAL / 2, 0), v(50, ALTO_PEDESTAL, 50), "#cfd8dc", "metal")];
  const florero: ElementoEscenografia[] = [
    cilindro(v(0, 0, 0), 6, 12, "#e3eef0", "brillante", 9), cilindro(v(0, 12, 0), 9, 16, "#e3eef0", "brillante", 6),
    ...[[-4, 22, 3], [4, 23, 2], [0, 25, -3], [-3, 18, 5], [3, 18, 4]].map(([x, y, z]) => cilindro(v(x!, y!, z!), 3.5, 5, "#f4f2ee", "tela", 3)),
  ];
  const anillo: ElementoEscenografia[] = [
    { forma: "panel", contorno: [{ x: -6, y: 52 }, { x: 6, y: 52 }, { x: 9, y: 57 }, { x: 0, y: 64 }, { x: -9, y: 57 }], zCm: -0.3, grosorCm: 0.6, hex: "#d9b44a", acabado: "papel" },
    { forma: "panel", contorno: ovalo(0, 44, 8, 8, 20).map(([x, y]) => ({ x, y })), huecos: [ovalo(0, 44, 6, 6, 20).map(([x, y]) => ({ x, y })).reverse()], zCm: -0.3, grosorCm: 0.6, hex: "#d9b44a", acabado: "papel" },
    barra(v(0, 0, 0), v(0, 36, 0), 0.25, "#e9dcc4", "madera"),
  ];
  const sobrePedestal = ALTO_PEDESTAL;
  const escenario: NodoEscena[] = [
    suelto("ramo", "Ramo de helio: 3 R-12 (dos Satín Blanco y uno Cristal con filigrana)", ramo, -6, sobrePedestal, -40),
    suelto("pedestal", "Pedestal espejado", escenografia(pedestal), -6, 0, -40),
    suelto("florero", "Florero de vidrio con rosas blancas", escenografia(florero), -6, sobrePedestal, -40),
    suelto("letrero-best-day", "Letrero «Best day ever!»", letrero({ forma: "rectangulo", anchoCm: 22, altoCm: 13, hex: "#1d1d1f", motivo: { dibujo: "texto", texto: "BEST DAY\nEVER!", hex: "#ffffff" }, apoyo: "palito", productoId: null, descripcion: "letrero de foto «Best day ever!»" }), -18, sobrePedestal + 22, -36),
    suelto("letrero-love", "Letrero «Love»", letrero({ forma: "circulo", anchoCm: 16, altoCm: 16, hex: "#1d1d1f", motivo: { dibujo: "texto", texto: "Love", hex: "#e8c9c0" }, apoyo: "palito", productoId: null, descripcion: "letrero de foto «Love»" }), 2, sobrePedestal + 22, -34),
    suelto("anillo", "Letrero del anillo dorado", escenografia(anillo), -14, sobrePedestal + 24, -44),
  ];
  return escenaDe(m, escenario)(sala(320, 280, 290, { piso: "#cfd6da", paredes: "#eef3f5" }));
};

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

const P_REFLEX_DORADO = pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970");
const P_AMARILLO = pub("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020");
const P_FUCSIA = pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012");
const P_VERDE_LIMA = pub("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031");
const P_AZUL_REY = pub("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041");
const P_REFLEX_PLATA = pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981");
const P_REFLEX_DORADO_ROSA = pub("GLOBO REDONDO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa", "R-12", "968");

export const LOTE_23: readonly IdeaDigitalizada[] = [
  idea(931, "tetero", "Tetero: columna rosada con rosca blanca y chupo cristal", escena931,
    "Igual: el tetero de baby shower como columna: 4 cuartetos R-12 rosados al paso del taller (el primero con un globo al frente, filas contadas a 525, 460, 395 y 330 px), la rosca de un cuarteto R-12 blanco algo más inflado y el chupo de globo cristal (bulbo de ~30 cm y punta de ~16 cm), hasta ~1,87 m. Distinto: la foto no trae nada de tamaño conocido: la escala sale de tomar los R-12 a 27 cm (si fueran R-9, mediría ~1,3 m); la idea no publica productos: colores medidos (rosado #ecb4d1 → Fashion Rosado 009, ΔE 6; blanco → Fashion Blanco 005; cristal 390); el chupo de la foto es un solo globo cristal alargado que se angosta (aquí un R-12 y un R-9 Cristal Transparente uno sobre otro); el amarre va escondido por el eje."),
  idea(938, "topiario-reflex-dorado-rosa-plata", "Topiario Reflex dorado rosa y plata: bola de 12 R-12 sobre un nido de rizos", escena938,
    "Igual: la bola de 12 R-12 Reflex Dorado Rosa en icosaedro (~77 cm de ancho, escala por los R-12 de ~135 px = 28 cm) con R-5 Reflex Plata en los huecos y debajo el nido de 10 rizos de T-260 Reflex Plata (~4,5 cm de grueso) de ~80 cm de ancho: los productos publicados. Distinto: la foto es un render visto desde arriba y solo deja ver 5 R-5 (los de los triángulos alrededor del globo de frente); aquí van 10 (uno de cada dos huecos de la bola, repartidos alrededor) y el icosaedro queda con otra cara al frente; los tubitos del nido se cuentan aproximados (~10) y los rizos del taller son tirabuzones abiertos en cono, más ordenados que el enredo de la foto; el alto (bola a 45 cm del piso) es supuesto.",
    [P_REFLEX_PLATA, P_REFLEX_DORADO_ROSA, pub("GLOBO TUBITO REFLEX PLATA", "/products/globo-para-fiesta-latex-tubito-reflex-plata", "T-260", "981")]),
  idea(985, "wedding-shower", "Wedding shower: pared de R-12 perla y ramo de helio con letreros", escena985,
    "Igual: el rincón de despedida de soltera: la pared de R-12 perla en retícula al fondo (10 × 11 globos, ~2,3 × 2,5 m), delante el ramo de tres R-12 de helio —dos perla y uno cristal impreso— amarrado al pedestal espejado, el florero de vidrio con rosas blancas y los letreros de foto («Best day ever!», «Love» y el anillo dorado). Distinto: la foto corta la pared por los lados y arriba: su tamaño y su número de globos son supuestos (en la foto se ven ~7,5 por fila y ~11 filas); la foto tiene una dominante fría (las rosas blancas miden #b7ccd1 y la pared #adc6cc → Satín Azul 440): equilibrada con el blanco de las rosas, la pared es blanca perlada → Satín Blanco 405; la idea no publica productos; la filigrana blanca del globo cristal no está en la tienda: va el «Graffiti Invierno» cristal (copos blancos), el más parecido; el ramo del taller reparte los tres globos en espiral (en la foto, dos arriba a los lados y uno al centro); el sombrero rosado y los letreros más pequeños no van; pedestal, florero y letreros son escenografía (no cotizan)."),
  idea(12, "amor-y-amistad-organico-malteada", "Amor y amistad: orgánico rojo, fucsia, rosado y blanco que acaba en malteada", escena12,
    "Igual: las dos estructuras (escala por el R-24 rosado y la cortina de ~1,85 m: 2,35 px/cm): el orgánico de ~3,7 × 2,6 m por tramos de color —la pata Rojo Imperial, la esquina Fucsia, el rosado de arriba (Pastel Mate Rosado y Rosado) con su R-24 y el blanco y Satín Blanco que baja a la derecha— y la malteada: base de dos cuartetos plata, el vaso de 6 cuartetos Rosado que se abren de R-9 a R-12, la crema de Satín Blanco, la cereza con su tallo y el pitillo de T-260 rojo y blanco torcidos; detrás, la cortina de flecos roja y plata. Distinto: los globos de lo orgánico los da el motor para el grosor y el largo medidos (no uno a uno); los rojos de la foto (#c41030) son más claros que el Rojo Imperial publicado, que es el que va; la base plata no está publicada (medida #8b7b73 → Satín Plata 481) ni la cereza (→ Rojo 015, un R-9); los corazones de foil de la cortina no van y la cortina es escenografía (no cotiza); los amarres van escondidos.",
    [pub("GLOBO REDONDO FASHION ROJO IMPERIAL", "/products/globo-latex-redondo-fashion-rojo-imperial", "R-12", "016"), P_FUCSIA, pub("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"), pub("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609"), pub("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005"), pub("GLOBO REDONDO SATIN BLANCO", "/products/globo-para-fiesta-latex-redondo-satin-blanco", "R-12", "405")]),
  idea(32, "aranita-centro-de-mesa", "Arañita centro de mesa: burbuja con globitos naranja y cabeza con ojos", escena32,
    "Igual: de abajo arriba, la base de cuarteto morado con uno al frente, el anillo de 4 R-5 negros, el cuerpo de la araña —la burbuja cristal con 8 globitos naranja dentro (se ven 7)—, la cabeza negra con los ojos (blancos con pupila negra) y detrás el abdomen negro, y las 8 patas de tubito negro fino que bajan sobre la burbuja hasta las puntas medidas, hasta ~1,07 m. Distinto: sin nada de tamaño conocido la escala sale del anillo de R-5 (60 px = 12 cm): así la base es de R-9 (no R-12 como la ficha) y la burbuja un R-18 de 44 cm; la idea no publica productos: colores medidos (morado #583d97 → Violeta 051; naranja #ff602f → Naranja 061); las patas van de T-160 (miden ~1,6 cm de grueso); las dos patas de atrás no se ven en la foto y aquí van detrás; los ojos van impresos en la cabeza (en la foto son ojos móviles pegados)."),
  idea(38, "arbol-de-navidad-chris-horne", "Árbol de Navidad de Chris Horne: cono verde con esferas de colores y flor de pascua", escena38,
    "Igual: el cono de anillos de R-12 Verde Selva de ~3,1 m (escala por los R-12 de abajo, ~75 px = 28 cm) que se achica de 16 globos de 28 cm por anillo a 9 de 17 cm, con un R-5 dorado chico cada dos huecos entre anillos, las 44 esferas que se ven contadas una a una en su sitio (8 violeta, 5 azul rey, 3 azul claro, 7 verde brillante, 2 verde lima, 5 amarillas, 7 rojas y 7 cristal; R-9 arriba y R-12 abajo, como en la foto) y la flor de pascua roja con hojas verdes arriba (~3,67 m en total). Distinto: las esferas de detrás no se ven y no se ponen; los colores que no publica la idea van medidos (dorados → Reflex Dorado 970, azul claro → Azul 040, verde brillante → Metal Verde 530, cristal 390); la flor de pascua no está en la tienda: va una estrella metalizada roja de 27\" genérica (sin producto) y las hojas como foil; el alto real depende de que los verdes sean R-12 (lo publicado).",
    [pub("GLOBO REDONDO FASHION VERDE SELVA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-selva", "R-12", "032"), pub("GLOBO REDONDO FASHION VIOLETA", "/products/globo-para-fiesta-latex-redondo-fashion-violeta", "R-12", "051"), P_AZUL_REY, pub("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"), P_AMARILLO, P_VERDE_LIMA]),
  idea(40, "arbol-de-navidad-con-regalos", "Árbol de Navidad con regalos: cono orgánico Reflex Dorado con estrella de tubito", escena40,
    "Igual: el árbol cónico orgánico todo Reflex Dorado de ~1,86 m y ~1,1 m de ancho abajo (escala por los R-12 grandes, ~110 px = 28 cm) con R-12, R-9 y R-5, la estrella de contorno de T-260 Reflex Dorado arriba (radio de 26 cm, hasta ~2,34 m) y al pie las dos bolsas rojas de regalo con un arbolito y las dos bolsas de celofán con dulces: los productos publicados. Distinto: los globos los da el motor orgánico para el cono medido (no uno a uno) y sus R-5 van a 12 cm: en la foto son racimos de R-5 muy chicos (~7 cm) como uvas; la estrella del taller es el contorno sin las perillas de las puntas; las bolsas son escenografía genérica (no cotizan).",
    [P_REFLEX_DORADO, pub("GLOBO TUBITO REFLEX DORADO", "/products/globo-para-fiesta-latex-tubito-reflex-dorado", "T-260", "970")]),
  idea(44, "arbol-de-navidad-terra", "Árbol de Navidad Terra: cono orgánico de R-5 con esferas y moño dorado", escena44,
    "Igual: el árbol cónico de ~2,2 m (escala por los R-5 de ~50 px = 12 cm) con el radio medido fila a fila, un alma de R-18 y R-12 Eucalipto forrada de R-5 Arena, Reflex Dorado, Reflex Dorado Rosa y terracota, las 9 esferas rojas que se ven con su gancho de T-260 dorado, y arriba el moño de lazos de T-260 Reflex Dorado (~56 cm): los productos publicados. Distinto: los globos los da el motor orgánico (no uno a uno); la terracota no está publicada (medida #b24d30 → Merlot 018, el más cercano) ni las esferas (→ Metal Rojo 515, R-9 a 14 cm); los ganchos son dos lacitos de T-260 (en la foto, un aro de tubito sobre cada esfera); las esferas de detrás no se ven y no se ponen.",
    [P_REFLEX_DORADO, pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"), P_REFLEX_DORADO_ROSA, pub("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027")]),
  idea(56, "arbolito-navidad-con-lol660", "Arbolito de Navidad con Link-O-Loon 660: pisos de lazos verdes y estrella", escena56,
    "Igual: la base de dos cuartetos R-9 café, el tronco de 9 cuartetos R-9 Verde Selva, los 5 pisos de 4 lazos de Link-O-Loon 660 verde acostados alrededor del tronco, girados 45° de un piso a otro y cada vez más cortos, los 9 R-5 rojos contados entre los lazos y la estrella metalizada dorada arriba, hasta ~2,06 m (escala por la estrella de 18\", ~120 px). Distinto: la idea no publica productos: colores medidos (café #824c19 → Café 074; verde #007d46 → Verde Selva 032, ΔE 1; rojo 015); la estrella de la foto es dorada brillante: va la Estrella Dorado Mate de la tienda, la más parecida; los lazos del taller son gotas planas iguales por piso (en la foto se doblan y se montan unos sobre otros); los R-5 de detrás no se ven y no se ponen."),
  idea(59, "arco-acuatico", "Arco acuático: arco de Link-O-Loon azul con peces y caracolas", escena59,
    "Igual: el arco de Link-O-Loon 12 Azul Rey de ~3 m de ancho y ~1,8 m de alto con globitos azul claro en cada unión, los tres peces colgados bajo el arco en sus sitios (amarillo con cuerpo verde, naranja con cuerpo amarillo y blanco con cuerpo rojo: cuerpo R-12, contorno y cola en V de T-260 y un ojo) y arriba las dos caracolas de T-260 fucsia con su R-5 rojo y 3 algas de T-260 verde cada una (escala por los óvalos, ~48 px = 21 cm). Distinto: el arco del taller es la trenza de cuartetos hecha con Link-O-Loon (en la foto es una malla de dos hileras de óvalos entrelazados); las «parejas de R-6» del texto van como un R-5 por unión (el R-6 no está en la tabla de colores); la idea no publica productos: colores medidos (azul #023083 → Azul Rey 041; globitos → Azul 040; algas → Verde Trébol 029; caracolas → Fucsia 012); las rayas impresas de los peces y la espiral de las caracolas no van."),
  idea(107, "arco-marimonda", "Arco marimonda: orgánico tropical en «L» y la marimonda del Carnaval", escena107,
    "Igual: las dos estructuras (escala por el R-24 amarillo, ~140 px = 55 cm): la guirnalda orgánica tropical en «L» invertida de R-12, R-9 y R-5 amarillo, fucsia, azul caribe, verde lima y naranja con el R-24 amarillo al pie y el globo fucsia grande arriba a la derecha, y la marimonda: columna de 6 cuartetos R-9 en espiral de cuatro colores y la cabeza R-24 amarilla con los ojos de aro de T-260 verde neón con pupila negra, la nariz larga de T-260 verde hacia arriba, los labios de T-260 rojo y las orejas-brazos de T-260 azul rey: los colores publicados. Distinto: los globos de la guirnalda los da el motor (no uno a uno); el globo fucsia de arriba mide ~41 cm (un R-18; la ficha dice R-24); el «Surtido Tropical» publicado no tiene código y va listado sin cantidad (sus colores salen de los lisos publicados); las pupilas van como R-5 negros chicos y la cara corrida a la derecha, como en la foto.",
    [pub("GLOBO REDONDO FASHION SURTIDO TROPICAL", "/products/globo-para-fiesta-latex-redondo-fashion-surtido-tropical", "R-12", null), P_AMARILLO, P_FUCSIA, pub("GLOBO REDONDO FASHION AZUL CARIBE", "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", "R-12", "038"), P_VERDE_LIMA, pub("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"), pub("GLOBO TUBITO NEON VERDE", "/products/globo-para-fiesta-latex-tubito-neon-verde", "T-260", "230"), pub("GLOBO TUBITO FASHION ROJO", "/products/globo-para-fiesta-latex-tubito-fashion-rojo", "T-260", "015"), pub("GLOBO TUBITO FASHION AZUL REY", "/products/globo-para-fiesta-latex-tubito-fashion-azul-rey", "T-260", "041")]),
  idea(111, "arco-muneco-de-nieve", "Arco muñeco de nieve: arco blanco de cuartetos con la cabeza del muñeco", escena111,
    "Igual: el arco de cuartetos R-12 blanco fashion de ~3 m de ancho y ~1,9 m de alto (escala por la cabeza R-24, ~105 px = 55 cm) y encima el muñeco: cabeza R-24 blanca con ojos negros, nariz de T-260 naranja y sonrisa de T-260 rojo, sombrero verde (ala de T-360 y copa) con un globito encima, bufanda de 12 R-5 rojos y verdes con dos puntas colgando, brazos de T-260 chocolate con los dedos en X y el botón negro en el frente del arco (lo que dice el texto de la idea). Distinto: la idea no publica productos: colores medidos (verde → Verde Selva 032; rojo 015; naranja 061; negro 080); el «R-4» del sombrero no está en la tabla: va un R-5; la copa del sombrero es un R-9 verde (en la foto, el T-360 doblado en dos lazos sobre el ala); los ojos van impresos (en la foto parecen globitos negros pegados)."),
  idea(118, "arco-organico-aguamarina", "Arco orgánico aguamarina: dorado rosa, perla y champaña con burbujas y rizos", escena118,
    "Igual: el arco orgánico de ~2,95 × 2,57 m (escala por el R-24 blanco, ~115 px = 55 cm) con la pata izquierda más gruesa, la rama que sale a la derecha y sus cuatro colores, el R-24 blanco de la izquierda, las dos burbujas cristal (la de arriba con un R-12 aguamarina dentro y la del centro con 7 globitos) y los 6 rizos de T-260 aguamarina en sus sitios. Distinto: la idea no publica productos: colores medidos (aguamarina #4cd4d1 → Aguamarina 037; rosado cromado → Metal Dorado Rosa 568; perla → Satín Perla 406; el «plata» cromado mide champaña → Reflex Champaña 971; el R-24 → Satín Blanco 405); los globos los da el motor (no uno a uno); los rizos son tirabuzones del taller (en la foto, lazos más sueltos); el racimo rosado de la rama no lleva la figurita de tubito que asoma en la foto."),
  idea(123, "arco-organico-para-papa", "Arco orgánico para papá: escena con orgánico azul y mostaza, «P» de marquesina y panel", escena123,
    "Igual: la escena completa (escala por el R-24 Reflex Azul, ~175 px = 55 cm): el orgánico que enmarca el panel —arriba a ~2,9 m y la pata derecha hasta el piso con su pie hacia el pedestal— de R-24, R-18 y R-12 Reflex Azul, Azul Rey, Negro y Mostaza con tríos de R-5 Reflex Plata (los publicados), la letra «P» de marquesina plateada (~69 × 119 cm) con sus 12 globos contados en su sitio (3 impresos de «Feliz día papá», 4 mostaza, 4 negros, 1 azul), el panel de lentejuelas plata, el banderín de bigotes y «Feliz Día», el pedestal blanco con el plato y los vasos. Distinto: los globos del orgánico los da el motor (no uno a uno); el impreso de la «P» (azul con «Feliz día papá», sombreros y moños) no está publicado: va el «Feliz Día Papá Oeste» de la tienda en azul rey, el más parecido; los globos de la «P» van como R-12 poco inflados (~17 cm); el banderín, el plato y los vasos son genéricos (sin producto) y la marquesina, el panel y el pedestal son escenografía.",
    [pub("GLOBO REDONDO FASHION MOSTAZA", "/products/globo-para-fiesta-latex-redondo-fashion-mostaza", "R-12", "023"), P_AZUL_REY, pub("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"), P_REFLEX_PLATA, pub("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940")]),
  idea(139, "arco-sirenita", "Arco sirenita: tiras de Link-O-Loon en degradé de azules con espuma y Sirenita", escena139,
    "Igual: el arco de ~2,5 m de ancho y ~2 m de alto de tres tiras de Link-O-Loon 12 en degradé (azul rey por dentro, azul en medio y celeste por fuera) con globitos aguamarina entrelazados, la espuma de tubitos cristal entorchados por el borde de fuera y en las bases, los racimos de R-9 pastel al pie y la Sirenita metalizada en la base derecha. Distinto: la foto es un dibujo pequeño y lavado sin nada de tamaño conocido: la escala es supuesta (el arco a 2,5 m); cada tira del taller es una trenza de cuartetos de LOL-12 poco inflados (en la foto, tiras de eslabones); los «R-6» del texto van como R-5 (el R-6 no está en la tabla); la idea no publica productos: colores medidos (dentro #005298 → Azul Rey 041; medio y fuera #016dbe y #009ee1 → Azul 040, y la de fuera, celeste bajo la espuma, va Pastel Mate Azul 640 para el degradé; globitos → Aguamarina 037; bases → Satín Rosado 409, Pastel Mate Amarillo 620, Neón Amarillo 220); la Sirenita no está en la tienda: va como paneles de foil genéricos (cola, cuerpo, concha y pelo, sin producto); la espuma son tirabuzones del taller (en la foto, una maraña de tubitos)."),
];
