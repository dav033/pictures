import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
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
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import { centroCuerpo } from "../geometria";
import type { Accesorio, Cara, PropiedadesFigura } from "../figuras-tubito";
import type { ParteTubito } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { OpcionesOrganico, PuntoMezcla } from "../organico";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { OpcionesMural } from "../murales";
import { letrero, paquete, productoDe, vasos } from "../utileria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 22** (los números de `clasif/lote-22.json`): los dos murales
 * (#774 corazones clásicos, malla Link-O-Loon roja con R-12 de corazones en cada hueco, y #778 navideño, pared de R-12
 * rojos y verdes con R-5 dorados y R-12 impresos en los huecos), la calabaza noche (#786, con sus «Materiales»), la nota
 * musical (#787), la olla embrujada (#802), el mural primaveral (#856), el regalo con amor (#883, la canasta), la
 * revelación de género (#887), los tres semiarcos orgánicos (#902 tropical con animal print, #903 amor y amistad con
 * flores y rizos, #905 combinaciones con Reflex), el sorbete (#917), la sorpresa neón (#919), Tazmania (#925) y la
 * telaraña (#928, con sus «Materiales»).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada con rejilla de
 * píxeles y medida:
 * - **Escala**: la de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 22 cm, R-12 ≈ 28 cm, R-18 ≈ 42 cm,
 *   R-24 ≈ 55 cm, un metalizado de 18" ≈ 45 cm, un T-260 ≈ 5 cm de grueso); cada escena dice la suya. Las posiciones
 *   se escriben en el mundo con `foto(eje, piso, px/cm)`: x a la derecha del eje de la pieza, y desde el piso.
 * - **Conteo**: lo que se ve, uno a uno (globos, cuartetos, niveles, nudos y huecos de las mallas, tríos, impresos), y
 *   lo que la técnica obliga detrás (el cuarto globo de un cuarteto). #786 y #928 publican «Materiales»: el 3D gasta
 *   exactamente esas cantidades (las de los orgánicos, afinando el recorrido hasta que el motor da ese número); en las
 *   demás, lo contado va `contada: true`. Los orgánicos sin «Materiales» (bases y semiarcos) los pone el motor para el
 *   recorrido y el grueso medidos: sus cantidades son las del motor, no contadas una a una.
 * - **Colores**: si la idea publica productos, ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana de un
 *   parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y el código más cercano que se fabrica en
 *   ese formato (un Fashion si queda a ≤ 6 ΔE del mejor). Cada nota dice lo medido cuando se aparta.
 * - **Impresos, metalizados y utilería**: el EXACTO de la tienda cuando la idea lo publica; si no, el más parecido del
 *   catálogo y la nota lo dice. Lo que la tienda no tiene (la nota musical, Taz, la abeja, la mariposa y el caracol
 *   metalizados) va como paneles de foil (escenografía, no cotizan); la canasta, las hojas de monstera y los dulces,
 *   como escenografía.
 * - **Montaje** (como los lotes 17 y 20): la estructura principal es el nodo raíz (suelta); de ella cuelga (`sobre`)
 *   un amarre interno **oculto** (`oculto: true`: existe y da el marco, pero no se dibuja) y del amarre todo lo demás,
 *   en el sitio exacto de la foto. El amarre va por el eje de las columnas o detrás de la estructura, donde no tiene
 *   globos debajo (así la escena no lo corre). El mural navideño, que no lleva nada colgado, es solo su raíz.
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
/** Del píxel de una foto al mundo: x desde el eje de la pieza, y desde el piso (la fila `piso`), a `pxPorCm`. */
const foto = (eje: number, piso: number, pxPorCm: number) => (x: number, y: number, z = 0): Vec3 => v(r2((x - eje) / pxPorCm), r2((piso - y) / pxPorCm), z);
/** Dirección en el plano de frente: 0° = a la derecha de quien mira, 90° = arriba; `adelante` la saca hacia quien mira. */
const deFrente = (grados: number, adelante = 0): Vec3 => unitario(v(Math.cos(rad(grados)) * Math.cos(rad(adelante)), Math.sin(rad(grados)) * Math.cos(rad(adelante)), Math.sin(rad(adelante))));

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

/** Curva suave (Catmull-Rom) por unos puntos de frente: `pasos` tramos entre cada par (los rizos, los tallos). */
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

/** Corre una línea de frente (x, y) `d` cm hacia su izquierda (la normal (−dy, dx)): el borde de fuera de un semiarco. */
function desplazar(puntos: ReadonlyArray<readonly [number, number]>, d: number): Array<readonly [number, number]> {
  return puntos.map(([x, y], i) => {
    const [xa, ya] = puntos[Math.max(0, i - 1)]!, [xb, yb] = puntos[Math.min(puntos.length - 1, i + 1)]!;
    const l = Math.hypot(xb - xa, yb - ya) || 1;
    return [r2(x - (d * (yb - ya)) / l), r2(y + (d * (xb - xa)) / l)] as const;
  });
}

// ----------------------------------------------------------------------------------------------------------
// Piezas sueltas
// ----------------------------------------------------------------------------------------------------------

/** Un nivel de cuarteto como columna de un nivel (`giro` 0: un hueco al frente; 45: un globo al frente). */
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color", impresos?: ImpresoEnPieza[]): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) });

const figura = (p: Omit<PropiedadesFigura, "postura" | "base" | "piernas" | "cuerpo" | "cuello" | "cabeza" | "brazos"> & Partial<PropiedadesFigura>): Decoracion => ({
  tipo: "figura",
  propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, ...p },
});

const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });

/**
 * Un tubito de frente que sigue líneas quebradas (tallos, rizos, cintas de regalo): una figura vacía con cadenas de
 * burbujas. Las coordenadas van como las ve quien mira la foto (cm: a su derecha, arriba); como una pieza `sobre` queda
 * en espejo (el marco de un ancla es de mano izquierda), aquí se reflejan para que se vea como en la foto (lote 17).
 */
type TrazoFrente = { puntos: ReadonlyArray<readonly [number, number]> };
function accesoriosDeTrazos(t: ParteTubito, partes: readonly TrazoFrente[]): Accesorio[] {
  return partes.map((p): Accesorio => {
    const [x0, y0] = p.puntos[0]!;
    const largos: number[] = [], angulos: number[] = [];
    for (let i = 1; i < p.puntos.length; i++) {
      const [xa, ya] = p.puntos[i - 1]!, [xb, yb] = p.puntos[i]!;
      largos.push(r2(Math.hypot(xb - xa, yb - ya)));
      angulos.push(r2((Math.atan2(yb - ya, -(xb - xa)) * 180) / Math.PI));
    }
    return { en: "base", corrimientoCm: [-x0, 0, y0], forma: { tipo: "burbujas", tubito: t, largosCm: largos, angulosGrados: angulos } };
  });
}
const trazos = (t: ParteTubito, partes: readonly TrazoFrente[], queEs: string): Decoracion => figura({ accesorios: accesoriosDeTrazos(t, partes), queEs });

/** El punto más bajo que dibujan unos trazos (antes de que la figura se apoye en z = 0). */
const bajoDeTrazos = (partes: readonly TrazoFrente[]): number => Math.min(...partes.flatMap((p) => p.puntos.map(([, y]) => y)));

/**
 * Lo que sube una figura de tubitos al apoyarse (la figura deja lo más bajo en z = 0): se arma con y sin una marca que
 * baja recta 400 cm desde su base (la marca es lo más bajo y su largo se conoce) y se comparan los dos armados.
 */
function subidaDeFigura(d: Decoracion): number {
  if (d.tipo !== "figura") return 0;
  const L = 400, g = 2;
  const marca: Accesorio = { en: "base", forma: { tipo: "burbujas", tubito: T("T-260", g, "005"), largosCm: [L], angulosGrados: [-90] } };
  const a = armarPieza({ tipo: "decoracion", decoracion: d });
  const b = armarPieza({ tipo: "decoracion", decoracion: { tipo: "figura", propiedades: { ...d.propiedades, accesorios: [...d.propiedades.accesorios, marca] } } });
  const za = a.tubos[0]?.puntos[0]?.z ?? a.globos[0]?.nudo.z ?? 0, zb = b.tubos[0]?.puntos[0]?.z ?? b.globos[0]?.nudo.z ?? 0;
  return r2(za - zb + L + g / 2);
}

/** Un panel de foil o de papel (escenografía) con su contorno de frente (cm, base en y = 0). */
const panel = (contorno: ReadonlyArray<readonly [number, number]>, grosorCm: number, hex: string, acabado: "foil" | "papel" | "tela" = "foil", motivo?: MotivoEscenografia, adelanteCm = 0): ElementoEscenografia => ({
  forma: "panel", contorno: contorno.map(([x, y]) => ({ x: r2(x), y: r2(y) })), zCm: r2(-grosorCm / 2 + adelanteCm), grosorCm, hex, acabado, ...(motivo ? { motivo } : {}),
});

/** Una elipse de `n` puntos (antihoraria) con centro (x, y), girada `giro` grados. */
const elipse = (x: number, y: number, rx: number, ry: number, giro = 0, n = 24): Array<readonly [number, number]> =>
  Array.from({ length: n }, (_, i): readonly [number, number] => {
    const a = (2 * Math.PI * i) / n, c = Math.cos(rad(giro)), s = Math.sin(rad(giro));
    const u = rx * Math.cos(a), w = ry * Math.sin(a);
    return [r2(x + u * c - w * s), r2(y + u * s + w * c)];
  });

/** Un cilindro delgado (escenografía) de `desde` a `hasta`: las cintas del helio. */
function hilo(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado: "satinado", en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

/**
 * Un orgánico por racimos libres con sus inflados y su relleno (sin relleno: solo la estructura), con el color
 * **repartido por formato**: `reparto` dice, para cada formato, qué códigos lleva y en qué proporción. El motor pone
 * los tamaños sin mirar los colores; así que primero se arma para contar los globos de cada formato y luego cada color
 * entra con su cuota exacta, limitado a su formato (el motor reparte por cuotas: «12 de cada uno» sale 12 de cada uno).
 */
type Reparto = Readonly<Record<string, ReadonlyArray<readonly [string, number]>>>;
function organico(racimos: readonly RacimoLibre[], reparto: Reparto, semilla: number, o: { suelo: boolean; inflados: Readonly<Record<string, number>>; relleno?: OpcionesOrganico["relleno"]; densidad?: number; densidadTramo?: Readonly<Record<string, number>> }): Pieza {
  const pieza = (colores: OpcionesOrganico["colores"]): Pieza => {
    const base = opcionesRacimosLibres({ racimos, colores: [...colores], semilla, suelo: o.suelo, relleno: o.relleno ?? [] });
    const tramos = base.tramos.map((t) => (o.densidadTramo?.[t.id] ? { ...t, densidad: o.densidadTramo[t.id] } : t));
    return { tipo: "organico", opciones: { ...base, tramos, inflados: o.inflados, variacionInflado: 0.05, ...(o.densidad ? { densidad: o.densidad } : {}) }, flores: null };
  };
  const formatos = Object.keys(reparto);
  const prueba = armarPieza(pieza(formatos.map((f) => ({ codigo: reparto[f]![0]![0], peso: 1, formatos: [f] }))));
  const colores: Array<OpcionesOrganico["colores"][number]> = [];
  for (const f of formatos) {
    const n = prueba.globos.filter((g) => g.formatoId === f).length;
    if (!n) continue;
    // Resto mayor: la cuota de cada código en su formato, en enteros que suman los globos de ese formato.
    const partes = reparto[f]!, total = partes.reduce((s, [, p]) => s + p, 0);
    const exactas = partes.map(([, p]) => (p / total) * n), cuotas = exactas.map(Math.floor);
    [...exactas.keys()].sort((a, b) => (exactas[b]! - cuotas[b]!) - (exactas[a]! - cuotas[a]!) || a - b).slice(0, n - cuotas.reduce((s, c) => s + c, 0)).forEach((k) => { cuotas[k]! += 1; });
    partes.forEach(([codigo], k) => { if (cuotas[k]! > 0) colores.push({ codigo, peso: cuotas[k]!, formatos: [f] }); });
  }
  return pieza(colores);
}
const mezcla = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];

// ----------------------------------------------------------------------------------------------------------
// Montaje: la estructura principal como raíz, su amarre (oculto) y lo que cuelga del amarre
// ----------------------------------------------------------------------------------------------------------

/** Lo que se hunde una pieza `sobre` otra (`HUNDIMIENTO_SOBRE_CM` de la escena). */
const HUNDIDO = 1.5;
/** Amarre con normal hacia arriba y giro −90°: su marco local es el del mundo con x al revés. */
const GIRO_AMARRE = -90;

/** Alto bajo el origen de una pieza armada (−min.y de su caja): lo que la escena corre al apoyarla `sobre` algo sin globos. */
const bajoOrigen = (pieza: Pieza): number => -armarPieza(pieza).caja.min.y;

type Montaje = {
  nodos: NodoEscena[];
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro del cuerpo en `centro`, hacia `direccion` (con su impreso de la tienda, al frente). */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un globo de helio (como `globo`): su nudo queda anotado para las cintas. */
  helio: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, impresoId?: string, direccion?: Vec3) => void;
  /** Un globo con cara impresa (de pie y de frente) con el centro del cuerpo en `centro`. */
  conCara: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, cara: Cara, queEs: string) => void;
  /** Un metalizado de pie y de frente con el centro en `centro` (su base anotada para las cintas si `conCinta`). */
  foil: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3, conCinta?: boolean) => void;
  /** Escenografía o utilería (contorno de frente con la base en y = 0) con su origen en `base`, de pie y de frente. */
  plano: (id: string, nombre: string, pieza: Pieza, base: Vec3) => void;
  /** Un nivel de cuarteto con su centro en `centro`, girado `giroGrados` (0° = un hueco al frente; 45° = un globo al frente). */
  nivel: (id: string, nombre: string, pieza: Pieza, centro: Vec3, giroGrados: number) => void;
  /** Una decoración con su origen en `origen`, mirando hacia `normal` (su +y local) y girada `giroGrados`. */
  deco: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados?: number) => void;
  /** Una figura de tubitos de pie y de frente con su base (el punto «base») en `origen` (sin el apoyo de la figura). */
  figuraFrente: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3) => void;
  /** Unos trazos de tubito con su punto (0, 0) en `origen`, en el plano vertical de frente: su «arriba» es el del mundo. */
  trazo: (id: string, nombre: string, t: ParteTubito, partes: readonly TrazoFrente[], origen: Vec3, queEs: string) => void;
  /** Un tallo recto de tubito de `desde` a `hasta` (dos burbujas en línea). */
  palito: (id: string, nombre: string, t: ParteTubito, desde: Vec3, hasta: Vec3) => void;
  /** Las cintas de los globos de helio anotados, desde `amarre` (mundo). */
  cintas: (amarre: Vec3, hex: string, nombre?: string) => void;
  escena: (s?: Sala) => Escena;
};

/**
 * Arma el montaje: `raiz` suelta con su origen en `origen` (mundo); su amarre, con la base en `amarre.base` (mundo),
 * en un sitio sin globos debajo (el eje hueco de los cuartetos o detrás de la estructura), así la escena no lo corre y
 * queda donde se pide; es un cilindro delgado **oculto** (no se dibuja). Lo demás cuelga del amarre.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; origen: Vec3; giroGrados?: number }, amarre: { nombre: string; base: Vec3; altoCm?: number }): Montaje {
  const nodos: NodoEscena[] = [{ id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: { en: "libre", xCm: raiz.origen.x, yCm: raiz.origen.y, zCm: raiz.origen.z, giroGrados: raiz.giroGrados ?? 0 } }];
  const puntoAmarre = mas(menos(amarre.base, raiz.origen), v(0, HUNDIDO, 0));
  nodos.push({
    id: "amarre", nombre: amarre.nombre,
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 0.4, altoCm: amarre.altoCm ?? 2, hex: "#e8e6e1", acabado: "mate", oculto: true }] },
    colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(puntoAmarre), normal: ARRIBA, giroGrados: GIRO_AMARRE },
  });
  const O = amarre.base;
  const aAmarre = (p: Vec3): Vec3 => redondo(v(-(p.x - O.x), p.y - O.y, p.z - O.z));
  const dirAAmarre = (d: Vec3): Vec3 => redondo(v(-d.x, d.y, d.z));
  const nudos: Vec3[] = [];
  const pieza = (id: string, nombre: string, p: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    const punto = menos(origen, por(n, bajoOrigen(p) - HUNDIDO));
    nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: "amarre", puntoCm: aAmarre(punto), normal: dirAAmarre(n), giroGrados } });
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
      // Normal arriba y el giro del amarre: el panel queda de frente y sin espejo.
      pieza(id, nombre, p, base, ARRIBA, GIRO_AMARRE);
      if (conCinta) nudos.push(base);
    },
    plano: (id, nombre, p, base) => pieza(id, nombre, p, base, ARRIBA, GIRO_AMARRE),
    nivel: (id, nombre, p, centro, giroGrados) => pieza(id, nombre, p, centro, ARRIBA, GIRO_AMARRE - giroGrados),
    figuraFrente: (id, nombre, decoracion, origen) => deco(id, nombre, decoracion, menos(origen, v(0, subidaDeFigura(decoracion), 0)), AL_FRENTE),
    trazo: (id, nombre, t, partes, origen, queEs) => {
      const p: Pieza = { tipo: "decoracion", decoracion: trazos(t, partes, queEs) };
      // La figura se apoya en z = 0 (su arriba, con la normal al frente, es el del mundo): su (0, 0) sube lo que bajaba
      // el punto más bajo, más medio grosor.
      pieza(id, nombre, p, menos(origen, v(0, r2(t.grosorCm / 2 - bajoDeTrazos(partes)), 0)), AL_FRENTE);
    },
    palito: (id, nombre, t, desde, hasta) => {
      const d = menos(hasta, desde);
      const n = unitario(d);
      const p: Pieza = { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: t.formatoId, grosorCm: t.grosorCm, codigos: [t.codigo], cantidad: 2, estilo: "burbuja", largoCm: r2(largo(d)), anchoCm: t.grosorCm, aperturaGrados: -90, giroGrados: 0 }, interior: null, corona: null, centro: null } } };
      pieza(id, nombre, p, mas(desde, por(n, bajoOrigen(p))), n);
    },
    cintas: (amarreCintas, hex, nombre = "Cintas del helio") => {
      const lista = nudos.map((n) => hilo(amarreCintas, n, hex));
      if (!lista.length) return;
      const p: Pieza = { tipo: "escenografia", elementos: lista.map((e) => (e.en ? { ...e, en: { origen: aAmarre(e.en.origen), ejeX: dirAAmarre(e.en.ejeX), ejeY: dirAAmarre(e.en.ejeY) } } : e)) };
      nodos.push({ id: "cintas", nombre, pieza: p, colocacion: { en: "sobre", padreId: "amarre", puntoCm: v(0, r2(-bajoOrigen(p) + HUNDIDO), 0), normal: ARRIBA, giroGrados: GIRO_AMARRE } });
    },
    escena: (s = sala()) => ({ sala: s, nodos }),
  };
}

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos). */
function lisoDeTienda(formatoId: string, codigo: string): { nombre: string; url: string } {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  if (fila) return { nombre: fila.nombre, url: fila.url };
  const x = productoDeGlobo(formatoId, codigo);
  return { nombre: x.nombre, url: quitarOrigen(x.url) };
}

/**
 * Un producto que la idea publica: nombre y url tal cual, con el formato y el código del mapeo de la idea. `cantidades`:
 * lo que dice su lista «Materiales», por formato (el 3D gasta exactamente eso; sale sin `contada`). `representa`: los
 * globos lisos del 3D que son este producto, cuando es un impreso que el catálogo de impresos no trae (la calabaza
 * «Calabaza Luz» de #786 va como un R-12 negro con cara de calabaza). `piezas`: utilería que la escena no puede cotizar
 * (el kit de la canasta), contada en la foto.
 */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null; cantidades?: Readonly<Record<string, number>>; representa?: { formatoId: string; codigo: string }; piezas?: number };
const pub = (nombre: string, url: string, formato: string | null, codigo: string | null, extra: Pick<Publicado, "cantidades" | "representa" | "piezas"> = {}): Publicado => ({ nombre, url, formato, codigo, ...extra });
/** Un liso que la lista «Materiales» pide sin enlazarlo a la tienda (va el de la tienda, con la cantidad publicada). */
const deMateriales = (formatoId: string, codigo: string, cantidad: number): Publicado => ({ ...lisoDeTienda(formatoId, codigo), formato: formatoId, codigo, cantidades: { [formatoId]: cantidad } });

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
 * y color de fondo; cada metalizado y cada utilería de la tienda; y los lisos (lo que queda de cada formato y código).
 * Lo que la idea publica sale con su nombre y url tal cual (con la cantidad de sus «Materiales» si los hay; si la foto
 * no lo tiene, sin cantidad); lo demás, con el liso de la tienda y `contada: true`.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[]): ProductoDeIdea[] {
  const armada = armarEscena(escena);
  const salida: ProductoDeIdea[] = [];
  const usados = new Set<Publicado>();
  const linea = (publicado: Publicado | undefined, base: { nombre: string; url: string; formato: string | null; codigo: string | null }, cantidad: number): ProductoDeIdea => {
    if (publicado) usados.add(publicado);
    const publicada = publicado?.cantidades?.[base.formato ?? ""];
    return { nombre: publicado?.nombre ?? base.nombre, url: base.url, formato: base.formato, codigo: base.codigo, cantidad, ...(publicada === undefined ? { contada: true } : {}) };
  };
  const impresos = new Map<string, { impresoId: string; formatoId: string; codigo: string; cantidad: number }>();
  const metalizados = new Map<string, { nombre: string; url: string; cantidad: number }>();
  const utileria = new Map<string, { nombre: string; url: string; cantidad: number }>();
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
    if (nodo.pieza.tipo === "escenografia") {
      for (const p of nodo.pieza.productos ?? []) {
        if (p.generico || !p.url) continue;
        const previo = utileria.get(p.url) ?? { nombre: p.nombre, url: p.url, cantidad: 0 };
        previo.cantidad += p.cantidad * copias;
        utileria.set(p.url, previo);
      }
    }
  }
  const restar = new Map<string, number>();
  const quitar = (formatoId: string, codigo: string, n: number) => restar.set(`${formatoId}|${codigo}`, (restar.get(`${formatoId}|${codigo}`) ?? 0) + n);
  for (const u of impresos.values()) {
    const i = impresoPorId(u.impresoId)!;
    salida.push(linea(publicados.find((p) => p.url === i.url), { nombre: i.nombre, url: i.url, formato: u.formatoId, codigo: u.codigo }, u.cantidad));
    quitar(u.formatoId, u.codigo, u.cantidad);
  }
  for (const m of metalizados.values()) salida.push(linea(publicados.find((p) => p.url === m.url), { nombre: m.nombre, url: m.url, formato: null, codigo: null }, m.cantidad));
  for (const u of utileria.values()) salida.push(linea(publicados.find((p) => p.url === u.url), { nombre: u.nombre, url: u.url, formato: null, codigo: null }, u.cantidad));
  for (const m of armada.materiales) {
    let cantidad = Math.ceil(m.cantidad - (restar.get(`${m.formatoId}|${m.codigo}`) ?? 0) - 1e-9);
    if (cantidad <= 0) continue;
    // Lo que representa un impreso publicado que el catálogo no trae.
    const representado = publicados.find((p) => p.representa?.formatoId === m.formatoId && p.representa.codigo === m.codigo);
    if (representado) {
      salida.push(linea(representado, { nombre: representado.nombre, url: representado.url, formato: m.formatoId, codigo: m.codigo }, cantidad));
      cantidad = 0;
      continue;
    }
    // El producto de la tienda es uno por color para todas sus tallas: se reconoce por el tipo de globo y el código.
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const publicado = publicados.find((p) => p.formato !== null && !p.representa && formatoPorId(p.formato)?.tipo === tipo && p.codigo === m.codigo && !impresoPorUrl(p.url));
    const tienda = lisoDeTienda(m.formatoId, m.codigo);
    salida.push(linea(publicado, publicado ? { nombre: publicado.nombre, url: publicado.url, formato: m.formatoId, codigo: m.codigo } : { ...tienda, formato: m.formatoId, codigo: m.codigo }, cantidad));
  }
  // Utilería contada que la escena no cotiza (sin producto en el catálogo de utilería).
  for (const p of publicados) if (p.piezas !== undefined && !usados.has(p)) { usados.add(p); salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: p.piezas, contada: true }); }
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

// ----------------------------------------------------------------------------------------------------------
// 774 · Mural corazones clásicos
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570. Malla de Link-O-Loon rojo en rombos (los eslabones en diagonal) con una pareja de unión de R-5
 * fucsia en cada nudo y, en cada hueco, un R-12 blanco con corazones rojos. Contados: 7 filas de huecos, 8 y 7
 * alternadas (53 blancos: x 65…665 px a 85,7 px, y 160…415 a 42,5) y 52 nudos fucsia a la vista (más los del borde,
 * tapados por los eslabones). El paso de la retícula (~42,7 px) y los blancos (~56 px, R-12 a 28 cm) dan 2 px/cm:
 * eslabones LOL-12 a 20,5 cm (paso de 21,3 cm), R-5 de unión a 11 cm; la malla mide ~3,4 × 1,9 m. Medidos: rojo
 * #fe2a2f → Rojo 015; fucsia #ff227e–#fe379a → Fucsia 012 (ΔE 18; el Neón Fucsia y el Metal Fucsia quedan 2–3 más
 * cerca, el Fashion más cercano); el impreso de corazones rojos sobre blanco es el «Corazones por Siempre» rojo-blanco
 * de la tienda.
 */
const LOL_774 = 20.5;
const PASO_774 = r2((LOL_774 * 1.47) / Math.SQRT2);
const escena774 = (): Escena => {
  const pared: Pieza = { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: LOL_774, anchoCm: r2(16 * PASO_774), altoCm: r2(9 * PASO_774), patron: "un_color", colores: ["015"], union: { infladoCm: 11, codigo: "012" } };
  const sube = r2(-armarPieza(pared).caja.min.y);
  const m = montaje(
    { id: "malla", nombre: "Malla Link-O-Loon rojo de 15 × 7 rombos con uniones R-5 fucsia", pieza: pared, origen: v(r2(-8 * PASO_774), sube, 0) },
    { nombre: "Amarre de los blancos (oculto, detrás de la malla)", base: v(0, 100, -20) },
  );
  // Los huecos de la foto (i de 0 a 14, j de 0 a 6, i + j par) en la retícula de la malla: columna i + 1, fila 8 − j.
  for (let j = 0; j < 7; j++) {
    for (let i = j % 2; i < 15; i += 2) {
      m.globo(`blanco-${j + 1}-${i + 1}`, `R-12 blanco con corazones del hueco ${i + 1} de la fila ${j + 1}`, R("R-12", 28, "005"), v(r2((i - 7) * PASO_774), r2((8 - j) * PASO_774 + sube), 8), AL_FRENTE, "infinity-corazones-por-siempre-fashion-surtido-rojo-blanco");
    }
  }
  return m.escena(sala(420, 300, 260));
};

// ----------------------------------------------------------------------------------------------------------
// 778 · Mural navideño
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570. Pared de 10 × 10 R-12 en retícula (columnas a 53,5 px: R-12 a ~26 cm, 2 px/cm): dos columnas de
 * rojos a cada lado y seis de verdes en medio. En los cruces de cuatro globos, alternados: un R-5 dorado (55: 30 en
 * las filas de cruces impares, incluidos los bordes de los lados, y 25 en las pares, con la fila de arriba; abajo no
 * hay) o un globo impreso navideño (25: verdes en las columnas rojas, rojos en las verdes); los 16 cruces que quedan,
 * vacíos (se ve la pared). Medidos: rojo #d80f10–#fc0b1f → Rojo 015; verde #009682–#019d87 → Verde 030 (el Reflex
 * Verde Aurora queda 5 más cerca: es un Fashion brillante); dorado #eec876 → Metal Dorado 570. El impreso de Santa con
 * lunares no está en la tienda: va el «Feliz Navidad Corona» rojo y verde selva (el más parecido), en R-12 a 15 cm.
 */
const NAVIDAD_778 = "infinity-feliz-navidad-corona-fashion-surtido-navidad";
const escena778 = (): Escena => {
  const filas = Array.from({ length: 10 }, () => "aabbbbbbaa");
  const dorados: Array<[number, number]> = [];
  const verdes: Array<[number, number]> = [], rojos: Array<[number, number]> = [];
  // Cruces: k de 0 a 10 entre columnas (k − 0,5 en celdas), m de 0 a 10 entre filas (m − 0,5).
  for (let m = 0; m <= 9; m++) {
    for (let k = 0; k <= 10; k++) {
      const p: [number, number] = [k - 0.5, m - 0.5];
      if (k % 2 === 0 && m % 2 === 1) dorados.push(p);
      else if (k % 2 === 1 && m % 2 === 0) dorados.push(p);
      else if (k % 2 === 1 && m % 2 === 1) (k === 1 || k === 9 ? verdes : rojos).push(p);
    }
  }
  const mural: OpcionesMural = {
    matriz: { colores: ["015", "030"], filas }, disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 28 }, chico: null,
    encima: [
      { formatoId: "R-5", infladoCm: 10.5, codigo: "570", puntos: dorados },
      { formatoId: "R-12", infladoCm: 15, codigo: "032", puntos: verdes },
      { formatoId: "R-12", infladoCm: 15, codigo: "015", puntos: rojos },
    ],
  };
  const total = armarPieza({ tipo: "mural", mural }).globos.length;
  const impresos = Array.from({ length: verdes.length + rojos.length }, (_, k) => total - verdes.length - rojos.length + k);
  return {
    sala: sala(380, 300, 280),
    nodos: [{ id: "mural", nombre: "Mural navideño: 10 × 10 R-12 rojos y verdes con dorados e impresos en los cruces", pieza: { tipo: "mural", mural, impresos: [{ impresoId: NAVIDAD_778, globos: impresos }] }, colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } }],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 786 · Calabaza noche
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1600×1600; los R-12 negros miden ~390 px (30 cm): 13 px/cm, con el piso en y = 1345 px y el eje en x = 705
 * (el centro de la base). Publica «Materiales»: 20 R-9 Pastel Dusk Té Verde (la base, ~143 px: R-9 a 11 cm, de x
 * 300 a 1110 px: 62 cm de ancho y 24 de alto), 2 R-12 «Calabaza Luz» (negros con cara de calabaza amarilla, apilados a
 * la derecha: centros a (+20, 30) y (+24, 63) cm), 1 R-12 «Happy Halloween» naranja (a la izquierda, centro a (−16,
 * 37) cm, ~360 px: 28 cm) y 2 T-260 Reflex Verde Lima: el cuello de lazos entre las calabazas (48 cm), el moño de
 * arriba (81 cm) y el tallo que sube en diagonal hasta 98 cm.
 */
const escena786 = (): Escena => {
  const f = foto(705, 1345, 13);
  const base = organico([{ id: "base", nombre: "Base", puntos: [v(-28, 8.5, 0), v(0, 9.5, 0), v(28, 8.5, 0)], radioInicioCm: 13, radioFinCm: 13, mezcla: mezcla({ "R-9": 1 }), tapas: { inicio: true, fin: true } }], { "R-9": [["126", 1]] }, 788, { suelo: true, inflados: { "R-9": 11.5 } });
  const m = montaje(
    { id: "base", nombre: "Base orgánica de 20 R-9 Pastel Dusk Té Verde", pieza: base, origen: v(0, 0, 0) },
    { nombre: "Amarre de las calabazas (oculto, detrás de la base)", base: v(0, 2, -24) },
  );
  const LIMA = T("T-260", 3.6, "931");
  m.globo("naranja", "R-12 naranja «Happy Halloween»", R("R-12", 28, "061"), f(492, 860, 4), ARRIBA, "2-caras-happy-halloween-fashion-surtido-negro-naranja");
  const calabaza: Cara = { ...SIN_CARA, calabaza: { hex: "#f2d531" } };
  m.conCara("calabaza-abajo", "Calabaza de abajo: R-12 negro con cara (Calabaza Luz)", R("R-12", 30, "080"), f(968, 950, 2), calabaza, "a black balloon with a glowing yellow jack-o'-lantern face");
  m.conCara("calabaza-arriba", "Calabaza de arriba: R-12 negro con cara (Calabaza Luz)", R("R-12", 30, "080"), f(1014, 525, 2), calabaza, "a black balloon with a glowing yellow jack-o'-lantern face");
  // Los dos T-260 Reflex Verde Lima en una sola figura: el cuello de lazos (4) entre las calabazas, el moño de arriba
  // (2 lazos por lado) y el tallo en diagonal. Coordenadas de la figura: [a la derecha (reflejada), al frente, arriba].
  const cuello = f(990, 720, 0), mono = f(1060, 290, 0), punta = f(1190, 70, 0);
  const lazo = (largoCm: number, anchoCm: number, cantidad: number, abertura: number) => ({ ...LIMA, estilo: "lazos" as const, cantidad, largoCm, anchoCm, aberturaGrados: abertura });
  const tallo = menos(punta, mono);
  const tubitos = figura({
    queEs: "lime green twisted-balloon collars and a stem on top of the pumpkins",
    accesorios: [
      { en: "base", par: true, corrimientoCm: [0, 0, 0], forma: { tipo: "alas", abanico: lazo(10, 6, 2, 70), anguloGrados: 0, adelanteGrados: 0 } },
      { en: "base", par: true, corrimientoCm: [r2(-(mono.x - cuello.x)), 0, r2(mono.y - cuello.y)], forma: { tipo: "alas", abanico: lazo(7.5, 4.5, 2, 40), anguloGrados: 8, adelanteGrados: 0 } },
      { en: "base", corrimientoCm: [r2(-(mono.x - cuello.x)), 0, r2(mono.y - cuello.y)], forma: { tipo: "burbujas", tubito: LIMA, largosCm: [r2(largo(tallo))], angulosGrados: [r2((Math.atan2(tallo.y, -tallo.x) * 180) / Math.PI)] } },
    ],
  });
  m.figuraFrente("tubitos", "Cuello de lazos, moño y tallo de T-260 Reflex Verde Lima", tubitos, cuello);
  return m.escena(sala(300, 260, 220));
};

// ----------------------------------------------------------------------------------------------------------
// 787 · Nota musical
// ----------------------------------------------------------------------------------------------------------

/** La nota musical metalizada (♫, dos corcheas unidas; no la tiene la tienda): cabezas, plicas y barra, en foil negro. */
const NOTA_787: ElementoEscenografia[] = [
  panel([[-21.4, 9], [-16.4, 9], [-16.4, 39.5], [5.4, 39.5], [5.4, 8], [10.7, 8], [10.7, 52], [-24, 52], [-24, 46], [-21.4, 44]], 7, "#1b1b1f"),
  panel(elipse(-29.5, 7.6, 12.5, 7.2, 18, 20), 9, "#1b1b1f"),
  panel(elipse(-4.5, 7, 12, 6.8, 18, 20), 9, "#1b1b1f"),
];

/**
 * Foto de 740×570; el tallo de T-260 mide ~14 px (5 cm): 2,8 px/cm, con el piso en y = 520 px y el eje en x = 390.
 * De abajo arriba: cuarteto R-9 azul (~50 px: 18 cm) con uno al frente, cuarteto R-9 fucsia (19,5 cm, uno al frente)
 * a 23 cm, anillo de 4 R-5 negros (32 cm), el tallo de T-260 azul de 34 a 84 cm con dos anillos de R-5 negros (50 y 70
 * cm), otro anillo negro (86 cm), cuarteto fucsia con un hueco al frente (100 cm), cuarteto azul con uno al frente
 * (115 cm) y la nota metalizada negra (55 × 52 cm, de 120 a 171 cm, corrida a la izquierda). Medidos: azul
 * #01a7d2–#32c3e7 → Azul 040 (el Azul Caribe queda 2,5 más lejos); fucsia #fe3890 → Fucsia 012; negro 080; el tallo
 * #01b4e4 → Azul 040.
 */
const escena787 = (): Escena => {
  const AZUL = "040", FUCSIA = "012", NEGRO = "080";
  const m = montaje(
    { id: "base", nombre: "Columna nota musical: cuarteto R-9 azul de la base", pieza: cuarteto(R("R-9", 18, AZUL), [AZUL]), origen: v(0, 9, 0), giroGrados: 45 },
    { nombre: "Varilla de la columna (oculta, por dentro)", base: v(0, 0, 0), altoCm: 110 },
  );
  m.nivel("fucsia-abajo", "Cuarteto R-9 fucsia de abajo", cuarteto(R("R-9", 19.5, FUCSIA), [FUCSIA]), v(0, 23.2, 0), 45);
  m.nivel("negro-1", "Anillo de 4 R-5 negros (abajo)", cuarteto(R("R-5", 9.5, NEGRO), [NEGRO]), v(0, 32, 0), 0);
  m.palito("tallo", "Tallo de T-260 azul", T("T-260", 5, AZUL), v(0, 33, 0), v(0, 85, 0));
  m.nivel("negro-2", "Anillo de 4 R-5 negros sobre el tallo (50 cm)", cuarteto(R("R-5", 7.5, NEGRO), [NEGRO]), v(0, 50, 0), 0);
  m.nivel("negro-3", "Anillo de 4 R-5 negros sobre el tallo (70 cm)", cuarteto(R("R-5", 7.5, NEGRO), [NEGRO]), v(0, 69.6, 0), 0);
  m.nivel("negro-4", "Anillo de 4 R-5 negros (arriba)", cuarteto(R("R-5", 10, NEGRO), [NEGRO]), v(0, 86.4, 0), 0);
  m.nivel("fucsia-arriba", "Cuarteto R-9 fucsia de arriba", cuarteto(R("R-9", 19.5, FUCSIA), [FUCSIA]), v(0, 100, 0), 0);
  m.nivel("azul-arriba", "Cuarteto R-9 azul de arriba", cuarteto(R("R-9", 18, AZUL), [AZUL]), v(0, 115, 0), 45);
  m.plano("nota", "Nota musical metalizada negra (paneles de foil)", { tipo: "escenografia", elementos: NOTA_787 }, v(0, 119.6, 0));
  return m.escena(sala(300, 260, 220));
};

// ----------------------------------------------------------------------------------------------------------
// 802 · Olla embrujada
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 de helio miden ~140 px (28 cm): 5 px/cm, con el piso en y = 525 px y el eje en x = 368.
 * La olla: un R-12 negro (~140 px) sobre 4 R-5 negros de patas (se ven 2), con la boca de T-260 blanco (aro de 17,6 cm
 * a 28 cm), un asa de T-260 blanco a cada lado (la derecha tapada por la araña) y 4 llamas de T-260 naranja que salen
 * por debajo (se ven 2); la araña de T-260 violeta sobre el borde derecho (centro a +10 cm, 29 cm). Helio con cintas
 * naranja desde la olla: R-12 negro arriba (85 cm), naranja a la izquierda (56) y a la derecha (53). Medidos: naranja
 * #ff5e1f–#ff731c → Naranja 061; violeta #50127e → Violeta 051; negro 080; blanco 005.
 */
const escena802 = (): Escena => {
  const f = foto(368, 525, 5);
  const NEGRO = "080", NARANJA = "061", BLANCO = "005", VIOLETA = "051";
  const m = montaje(
    { id: "patas", nombre: "Olla embrujada: 4 R-5 negros de patas", pieza: cuarteto(R("R-5", 9, NEGRO), [NEGRO]), origen: v(0, 4.5, 0), giroGrados: 45 },
    { nombre: "Amarre de la olla (oculto, por el eje)", base: v(0, 0, 0), altoCm: 8 },
  );
  m.globo("olla", "Olla: R-12 negro", R("R-12", 28, NEGRO), v(0, 19, 0), ARRIBA);
  const blanco = T("T-260", 3.2, BLANCO);
  const olla = figura({
    queEs: "a white balloon rim and two white handles of a witch's cauldron",
    accesorios: [
      { en: "base", corrimientoCm: [0, 0, 0], forma: { tipo: "aro", tubito: blanco, radioCm: 8.8, plano: "horizontal", desdeGrados: 0, hastaGrados: 360 } },
      { en: "base", par: true, corrimientoCm: [13.5, 0, -3], forma: { tipo: "aro", tubito: blanco, radioCm: 4.5, plano: "frente", desdeGrados: -90, hastaGrados: 90 } },
    ],
  });
  m.figuraFrente("boca", "Boca y asas de T-260 blanco", olla, v(0, 30, 0));
  const llamas = figura({
    queEs: "four short orange twisted-balloon flames under the cauldron",
    accesorios: [45, 135].map((a): Accesorio => ({ en: "base", par: true, forma: { tipo: "burbujas", tubito: T("T-260", 3.6, NARANJA), largosCm: [9], angulosGrados: [-8], adelanteGrados: [a > 90 ? -40 : 40] } })),
  });
  m.figuraFrente("llamas", "4 llamas de T-260 naranja (se ven 2)", llamas, v(0, 4, 0));
  const arana: Decoracion = { tipo: "arana", propiedades: { cuerpo: R("R-5", 8, VIOLETA), cabeza: R("R-5", 6, VIOLETA), ojos: null, patas: { ...T("T-260", 2.4, VIOLETA), largoCm: 11, estilo: "articuladas" }, giroGrados: 25 } };
  m.deco("arana", "Araña violeta de R-5 y T-260", arana, f(420, 380, 6), AL_FRENTE);
  const amarre = v(0, 27, 0);
  const sube = (c: Vec3) => unitario(mas(por(unitario(menos(c, amarre)), 0.3), por(ARRIBA, 0.7)));
  const negroHelio = f(385, 100, -6), izquierda = f(310, 245, 0), derecha = f(448, 258, -2);
  m.helio("helio-negro", "R-12 negro con helio (arriba)", R("R-12", 28, NEGRO), negroHelio, undefined, sube(negroHelio));
  m.helio("helio-izquierda", "R-12 naranja con helio (izquierda)", R("R-12", 28, NARANJA), izquierda, undefined, sube(izquierda));
  m.helio("helio-derecha", "R-12 naranja con helio (derecha)", R("R-12", 28, NARANJA), derecha, undefined, sube(derecha));
  m.cintas(amarre, "#f07a2a", "Cintas naranja del helio");
  return m.escena(sala(300, 260, 220));
};

// ----------------------------------------------------------------------------------------------------------
// 856 · Primaveral
// ----------------------------------------------------------------------------------------------------------

/** Los tres metalizados de figura de la foto (no los tiene la tienda), como paneles de foil con su dibujo. */
const ABEJA_856: ElementoEscenografia[] = [
  panel(elipse(-10, 21, 10, 7.5, 35, 18), 4, "#8cc6ea", "foil", { dibujo: "lunares", hex: "#e2306c" }, -2),
  panel(elipse(14, -19, 10, 7.5, 35, 18), 4, "#8cc6ea", "foil", { dibujo: "lunares", hex: "#e2306c" }, -2),
  panel(elipse(0, 0, 27, 18, -38, 26), 8, "#e9d23a", "foil", { dibujo: "rayas", hex: "#2b2f7a" }),
  panel(elipse(19, 14, 8, 7, 0, 16), 6, "#b0309a", "foil", undefined, 1),
];
const MARIPOSA_856: ElementoEscenografia[] = [
  panel(elipse(-25, 24, 24, 15, 15, 20), 5, "#b8d23a", "foil", { dibujo: "lunares", hex: "#e2463a" }),
  panel(elipse(30, -22, 26, 17, 20, 20), 5, "#b8d23a", "foil", { dibujo: "lunares", hex: "#e2463a" }),
  panel(elipse(18, 34, 10, 26, -25, 18), 5, "#3c8fd8", "foil", { dibujo: "rayas", hex: "#1b3f7a" }),
  panel(elipse(-2, 4, 9, 13, 35, 16), 7, "#b0309a", "foil", undefined, 1),
  panel(elipse(-13, -8, 6.5, 6.5, 0, 14), 7, "#e2306c", "foil", undefined, 1.5),
];
const CARACOL_856: ElementoEscenografia[] = [
  panel([[-37, -27], [37, -27], [30, -20], [-14, -18], [-18, 5], [-24, 20], [-30, 24], [-34, 18], [-30, 5], [-33, -15]], 6, "#c8307a"),
  panel(elipse(9, 3, 25, 25, 0, 28), 8, "#e6c43a", "foil", { dibujo: "lunares", hex: "#7a3fb8" }, 1),
];

/**
 * Foto de 740×570; los R-5 del pasto y los pétalos miden ~25 px (11 cm): 2,3 px/cm, con el piso en y = 558 px y el eje
 * en x = 375. Malla de Link-O-Loon blanco (LOL-12 a 20 cm, de 183 × 177 cm) con uniones de R-5 blanco; delante, el pasto
 * de R-5 y R-9 verdes de lado a lado (187 cm, hasta ~47 cm), la flor rosada de 5 R-5 con centro amarillo (−60, 62),
 * la flor naranja de 4 R-5 con centro amarillo (−37, 80), sus tallos de T-260 verde oscuro con un zarcillo, y los tres
 * metalizados: abeja (63 × 70 cm, centro a (−45, 136)), mariposa (106 × 108, (+25, 182)) y caracol (74 × 59, (+37,
 * 72)). Medidos: verdes #00974a–#018e2e → Metal Verde 530 y los claros #54b175 → Verde 030; rosado #fd98c0 → Satín
 * Fucsia 412; amarillo #edbd00 → Amarillo Miel 021; naranja #f47f00 → Naranja 061; tallo #097a6d → Reflex Verde
 * Aurora 932 (no se fabrica en T-260: va el Verde Selva 032); malla #cfc4bd (blanco en sombra) → Blanco 005.
 */
const escena856 = (): Escena => {
  const f = foto(375, 558, 2.3);
  const LOL = 20, PASO = r2((LOL * 1.47) / Math.SQRT2);
  const pared: Pieza = { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: LOL, anchoCm: r2(9 * PASO), altoCm: r2(8 * PASO), patron: "un_color", colores: ["005"], union: { infladoCm: 10, codigo: "005" } };
  const sube = r2(-armarPieza(pared).caja.min.y);
  const m = montaje(
    { id: "malla", nombre: "Malla Link-O-Loon blanco de 1,8 × 1,8 m", pieza: pared, origen: v(r2(-4.5 * PASO), sube, 0) },
    { nombre: "Amarre del jardín (oculto, detrás de la malla)", base: v(0, 90, -20) },
  );
  const pasto = organico([{ id: "pasto", nombre: "Pasto", puntos: [v(-84, 20, 20), v(-30, 22, 24), v(30, 22, 24), v(86, 20, 20)], radioInicioCm: 22, radioFinCm: 22, mezcla: mezcla({ "R-5": 0.6, "R-9": 0.4 }), tapas: { inicio: true, fin: true } }],
    { "R-5": [["530", 3], ["030", 1]], "R-9": [["530", 3], ["030", 1]] }, 856, { suelo: true, inflados: { "R-5": 11, "R-9": 15 } });
  m.pieza("pasto", "Pasto orgánico de R-5 y R-9 verdes", pasto, v(0, 0, 0), ARRIBA, GIRO_AMARRE);
  const flor = (petalo: string, cantidad: number, giro: number): Decoracion => ({ tipo: "flor", propiedades: { petalos: { ...R("R-5", 11, petalo), cantidad, aperturaGrados: 8, giroGrados: giro }, centro: { ...R("R-5", 10, "021"), cantidad: 1 } } });
  const verde = T("T-260", 3.5, "932");
  m.trazo("tallos", "Tallos de T-260 verde con zarcillo", verde, [
    { puntos: [[-61, 52], [-62, 44], [-64, 34]] },
    { puntos: suave([[-35, 72], [-28, 69], [-22, 68], [-24, 58], [-25, 45], [-26, 34]], 2) },
    { puntos: suave([[-22, 68], [-17, 72], [-14, 69], [-17, 66]], 2) },
  ], v(0, 0, 30), "dark green twisted-balloon flower stems with a curl");
  m.deco("flor-rosada", "Flor de 5 R-5 rosado con centro amarillo", flor("412", 5, 0), f(237, 415, 33), unitario(v(-0.05, 0.1, 1)));
  m.deco("flor-naranja", "Flor de 4 R-5 naranja con centro amarillo", flor("061", 4, 20), f(290, 375, 30), unitario(v(0.1, 0.1, 1)));
  m.plano("abeja", "Abeja metalizada (paneles de foil)", { tipo: "escenografia", elementos: ABEJA_856 }, mas(f(272, 245, 14), v(0, 0, 0)));
  m.plano("mariposa", "Mariposa metalizada (paneles de foil)", { tipo: "escenografia", elementos: MARIPOSA_856 }, f(432, 140, 14));
  m.plano("caracol", "Caracol metalizado (paneles de foil)", { tipo: "escenografia", elementos: CARACOL_856 }, mas(f(460, 392, 26), v(0, 0, 0)));
  return m.escena(sala(340, 280, 260));
};

// ----------------------------------------------------------------------------------------------------------
// 883 · Regalo con amor
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; el metalizado redondo «LOVE» de 18" mide ~385 px (45 cm): 8,55 px/cm, con la mesa en y = 945 px y
 * el eje en x = 500. Canasta de mimbre (46 × 22 cm, forro blanco); dentro, la caja del kit «Sweet Love» (28 × 19 cm),
 * la cajita de velitas, el vaso «LOVE» con la servilleta rosada y el plato «LOVE» en un palito (a −21 cm); encima, un
 * racimo en herradura de R-5 (~65 px: 7,6 cm) rojos a la izquierda, rosados en medio y rosa a la derecha (de 45 a 60
 * cm) y el redondo «LOVE» (centro a 81 cm). Medidos: rojo #e6353f → Rojo 015; rosado #f6d4df–#fadfe5 → Pastel Mate
 * Rosado 609; rosa #e33e92 → Rosa 011; canasta #c3b895 (mimbre).
 */
const escena883 = (): Escena => {
  const f = foto(500, 945, 8.55);
  const racimo = organico([{ id: "racimo", nombre: "Racimo", puntos: [v(-12, 54, -2), v(-4, 47, 2), v(7, 45, 3), v(16, 49, 2), v(23, 57, -1)], radioInicioCm: 8, radioFinCm: 7.5, mezcla: mezcla({ "R-5": 1 }), tapas: { inicio: true, fin: true } }],
    { "R-5": [["015", 0.28], ["609", 0.47], ["011", 0.25]] }, 883, { suelo: false, inflados: { "R-5": 7.6 } });
  const m = montaje(
    { id: "racimo", nombre: "Racimo en herradura de R-5 rojo, rosado y rosa", pieza: racimo, origen: v(0, 0, 0) },
    { nombre: "Amarre de la canasta (oculto, detrás del racimo)", base: v(4, 40, -16) },
  );
  m.foil("love", "Redondo metalizado «LOVE» de 18\"", metalizadoDeTienda("love-1"), f(557, 252, -3), false);
  const canasta: ElementoEscenografia[] = [
    { forma: "caja", centro: v(0, 10.8, 0), tamano: v(45.6, 21.6, 30), hex: "#cbb98f", acabado: "madera", motivo: { dibujo: "rayas", hex: "#b39c6c", cara: "frente" } },
    { forma: "caja", centro: v(0, 21.4, 0), tamano: v(47.5, 3, 31.5), hex: "#ecebe6", acabado: "tela" },
  ];
  m.plano("canasta", "Canasta de mimbre con forro blanco", { tipo: "escenografia", elementos: canasta }, f(495, 945, 0));
  m.plano("kit", "Caja del kit «Sweet Love»", paquete({ anchoCm: 28, altoCm: 19, fondoCm: 6, hex: "#f4f1f5", motivo: { dibujo: "texto", texto: "Sweet Love", hex: "#6b4fb8" }, productoId: null, descripcion: "kit DIY guirnalda Sweet Love" }), f(480, 790, -4));
  m.plano("velitas", "Cajita de velitas de corazón", paquete({ anchoCm: 14, altoCm: 11, fondoCm: 3, hex: "#f6f3f4", motivo: { dibujo: "texto", texto: "Sempertex", hex: "#6b4fb8" }, productoId: null, descripcion: "velitas de corazón" }), f(550, 770, 4));
  m.plano("vaso", "Vaso «LOVE» con servilleta «LOVE»", vasos({ cantidad: 1, altoCm: 10, diametroCm: 8, hex: "#f7f3f4", motivo: { dibujo: "texto", texto: "LOVE", hex: "#d42032" }, servilleta: "#f2a7c3", productoId: "vaso-love", servilletaProductoId: "servilleta-pequena-love" }), f(655, 770, 6));
  m.plano("plato", "Plato «LOVE» en un palito", letrero({ forma: "circulo", anchoCm: 18, altoCm: 18, hex: "#f7eef0", motivo: { dibujo: "texto", texto: "LOVE", hex: "#d42032" }, apoyo: "palito", productoId: "plato-love", tipo: "topper" }), f(318, 755, 8));
  return m.escena(sala(260, 240, 200));
};

// ----------------------------------------------------------------------------------------------------------
// 887 · Revelación de género
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; los R-5 del collar miden ~65 px (12 cm): 5,4 px/cm, con el piso en y = 935 px y el eje en x = 500.
 * El R-36 negro «?» (~372 px: 69 cm, centro a (−16, 122) cm) con su collar de 22 R-5 azul y rosado alternados (a
 * ~40 cm del centro) sobre una base orgánica perla y nude de 157 × 86 cm (R-18, R-12 y R-5); en la base, los «baby»:
 * dos rosados a la izquierda (−71, 91) y (−39, 71) y dos azules a la derecha (+42, 97) y (+67, 82); y los lisos de
 * acento: azul pizarra (+17, 45) y (−42, 29), rosado (−4, 36) y (+69, 46). Colores: los publicados (Pastel Mate
 * Azul 640 y Rosado 609 en el collar, Pastel Dusk Azul 140 y Rosa 110 en los acentos); la base, medida: perla
 * #dbd5c1–#e8ddc8 → Silk Perla Crema 873; nude #e8cfb4 → Pastel Mate Nude 661.
 */
const escena887 = (): Escena => {
  const f = foto(500, 935, 5.4);
  const base = organico([
    { id: "izquierda", nombre: "Base izquierda", puntos: [v(-50, 26, 0), v(-33, 38, 4), v(-13, 50, 6)], radioInicioCm: 26, radioFinCm: 38, mezcla: mezcla({ "R-18": 0.25, "R-12": 0.5, "R-9": 0.25 }), tapas: { inicio: true, fin: false } },
    { id: "derecha", nombre: "Base derecha", puntos: [v(-13, 50, 6), v(20, 42, 6), v(47, 32, 2), v(64, 24, 0)], radioInicioCm: 38, radioFinCm: 23, mezcla: mezcla({ "R-18": 0.25, "R-12": 0.5, "R-9": 0.25 }), tapas: { inicio: false, fin: true } },
  ], { "R-18": [["661", 0.6], ["873", 0.4]], "R-12": [["873", 0.6], ["661", 0.4]], "R-9": [["873", 1]], "R-5": [["873", 1]] }, 887, { suelo: true, inflados: { "R-18": 34, "R-12": 25, "R-9": 17, "R-5": 9 }, relleno: [{ formatoId: "R-5", infladoCm: 9, trios: true }] });
  const m = montaje(
    { id: "base", nombre: "Base orgánica perla y nude", pieza: base, origen: v(0, 0, 0) },
    { nombre: "Amarre del collar (oculto, detrás de la base)", base: v(0, 2, -45) },
  );
  const centro = f(414, 275, -6);
  m.globo("interrogacion", "R-36 negro «?» (Infinity Interrogación)", R("R-36", 69, "080"), centro, ARRIBA, "infinity-interrogacion-fashion-negro");
  for (let k = 0; k < 22; k++) {
    const a = 90 + (360 * k) / 22;
    const d = deFrente(a);
    m.globo(`collar-${k + 1}`, `R-5 ${k % 2 === 0 ? "azul" : "rosado"} del collar ${k + 1}`, R("R-5", 12, k % 2 === 0 ? "640" : "609"), mas(centro, por(v(d.x, d.y, 0), 40)), unitario(v(d.x, d.y, 0.25)));
  }
  m.globo("baby-rosado-1", "R-12 rosado «Es una niña» (izquierda)", R("R-12", 30, "609"), f(115, 445, 18), unitario(v(-0.4, 1, 0.3)), "infinity-es-una-nina-estrella-pastel-mate-rosado");
  m.globo("baby-rosado-2", "R-12 rosado «Es una niña» (delante)", R("R-12", 28, "609"), f(290, 550, 30), unitario(v(-0.2, 1, 0.5)), "infinity-es-una-nina-estrella-pastel-mate-rosado");
  m.globo("baby-azul-1", "R-12 azul «Es un niño» (derecha, arriba)", R("R-12", 30, "640"), f(725, 410, 10), unitario(v(0.3, 1, 0.3)), "infinity-es-un-nino-estrella-pastel-mate-azul");
  m.globo("baby-azul-2", "R-12 azul «Es un niño» (derecha)", R("R-12", 28, "640"), f(860, 495, 4), unitario(v(0.6, 1, 0.2)), "infinity-es-un-nino-estrella-pastel-mate-azul");
  m.globo("pizarra-1", "R-12 azul pizarra de acento (delante)", R("R-12", 25, "140"), f(590, 690, 34), unitario(v(0.1, 0.3, 1)));
  m.globo("pizarra-2", "R-12 azul pizarra de acento (abajo a la izquierda)", R("R-12", 19, "140"), f(275, 780, 32), unitario(v(-0.2, 0.2, 1)));
  m.globo("rosa-1", "R-12 rosa de acento (delante)", R("R-12", 22, "110"), f(480, 740, 34), unitario(v(0, 0.2, 1)));
  m.globo("rosa-2", "R-12 rosa de acento (derecha)", R("R-12", 28, "110"), f(875, 685, 20), unitario(v(0.5, 0.3, 1)));
  return m.escena(sala(320, 280, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 902 · Semi arco orgánico tropical con toques de animal print
// ----------------------------------------------------------------------------------------------------------

/** Una hoja de monstera (follaje de papel): corazón alargado con sus cortes, de `largoCm` y girada `giro`. */
function monstera(largoCm: number, giro: number): ElementoEscenografia {
  const k = largoCm / 40;
  const puntos: Array<readonly [number, number]> = [[0, 0], [8, 3], [13, 10], [10, 13], [17, 18], [17, 26], [11, 25], [12, 33], [5, 40], [0, 36], [-5, 40], [-12, 33], [-11, 25], [-17, 26], [-17, 18], [-10, 13], [-13, 10], [-8, 3]];
  const c = Math.cos(rad(giro)), s = Math.sin(rad(giro));
  return panel(puntos.map(([x, y]) => [x * k * c - (y - 20) * k * s, x * k * s + (y - 20) * k * c] as const), 0.4, "#2f6b35", "papel");
}

/**
 * Foto de 740×570 (PNG recortado); los R-12 miden ~52 px (27 cm) y el R-24 dorado ~107 px (55 cm): 1,95 px/cm, con el
 * piso en y = 552 px y el eje en x = 300. Semiarco orgánico que sube del piso (−26 cm) hasta 2,3 m y dobla a la
 * derecha hasta +118 cm, con un R-24 dorado en la punta (+141, 234) y uno arena al pie (−77, 78); grueso de ~34 cm de
 * radio abajo a ~26 arriba, de R-12, R-9 y tríos de R-5. Seis animal print (dos cebras, dos jirafas, un leopardo
 * dorado y uno de manchas cafés) y seis hojas de monstera. Colores: los publicados (Eucalipto 027, Arena 071, Café 074
 * y Reflex Dorado 970; medidos #869a77, #e0ceaf, #8c5d4b y dorado lo confirman; los cremas más claros, #f0dbc6, quedan
 * a 7 del Arena) y el «Infinity® Animal Print» publicado (arena, dorado y negro).
 */
const escena902 = (): Escena => {
  const f = foto(300, 552, 1.95);
  const recorrido = [f(250, 545), f(285, 470), f(298, 380), f(300, 300), f(312, 222), f(362, 162), f(430, 122), f(500, 98), f(532, 92)].map((p) => v(p.x, p.y, 0));
  const arco = organico([{ id: "semiarco", nombre: "Semiarco", puntos: recorrido, radioInicioCm: 34, radioFinCm: 26, mezcla: mezcla({ "R-12": 0.4, "R-9": 0.12, "R-5": 0.48 }), tapas: { inicio: false, fin: true } }],
    { "R-12": [["027", 0.3], ["071", 0.28], ["074", 0.2], ["970", 0.22]], "R-9": [["074", 0.5], ["970", 0.5]], "R-5": [["074", 0.3], ["970", 0.3], ["027", 0.2], ["071", 0.2]] }, 902,
    { suelo: true, inflados: { "R-12": 26, "R-9": 18, "R-5": 10 }, densidad: 1.6 });
  const m = montaje(
    { id: "semiarco", nombre: "Semiarco orgánico tropical eucalipto, arena, café y dorado", pieza: arco, origen: v(0, 0, 0) },
    { nombre: "Amarre de los acentos (oculto, detrás del semiarco)", base: v(0, 2, -40) },
  );
  m.globo("dorado-punta", "R-24 Reflex Dorado de la punta", R("R-24", 55, "970"), f(575, 95, 0), unitario(v(1, 0.2, 0.2)));
  m.globo("arena-pie", "R-24 arena del pie", R("R-24", 47, "071"), f(150, 400, -4), unitario(v(-1, 0.1, 0.2)));
  const ANIMAL = "infinity-animal-print-fashion-y-metal-surtido";
  const impresos: ReadonlyArray<readonly [string, string, string, number, number]> = [
    ["cebra-1", "R-12 negro cebra (arriba)", "080", 320, 155], ["jirafa-1", "R-12 arena jirafa (arriba)", "071", 445, 110], ["leopardo", "R-12 dorado leopardo", "570", 300, 270],
    ["manchas", "R-12 arena de manchas (abajo)", "071", 250, 415], ["jirafa-2", "R-12 arena jirafa (abajo)", "071", 310, 455], ["cebra-2", "R-12 negro cebra (abajo)", "080", 277, 492],
  ];
  for (const [id, nombre, codigo, x, y] of impresos) m.globo(id, nombre, R("R-12", 26, codigo), f(x, y, 24), unitario(v(0, 0.25, 1)), ANIMAL);
  const hojas: ReadonlyArray<readonly [number, number, number, number]> = [[275, 140, 45, 40], [460, 50, 40, -20], [420, 190, 42, -150], [355, 285, 36, -110], [210, 395, 34, 60], [350, 400, 36, -100]];
  hojas.forEach(([x, y, l, g], k) => m.plano(`hoja-${k + 1}`, `Hoja de monstera ${k + 1} (papel)`, { tipo: "escenografia", elementos: [monstera(l, g)] }, f(x, y, 30)));
  return m.escena(sala(380, 300, 300));
};

// ----------------------------------------------------------------------------------------------------------
// 903 · Semiarco amor y amistad
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; los R-12 rosados de fuera miden ~100 px (28 cm): 3,6 px/cm, con el piso en y = 950 px y el eje en
 * x = 300. Semiarco de 2 × 2,6 m: por fuera una fila de R-12 Pastel Dusk Rosa (a 28 cm) y por dentro R-9 Palo de Rosa
 * con un cordón de R-5 Reflex Dorado (~40 px: 11 cm); delante, 5 flores de 5 pétalos de R-12 Pastel Dusk Lavanda (la de
 * arriba a la derecha con pétalos de 26 cm y un racimo de 7 R-5 palo de rosa al centro; las otras de 19–22 cm con un
 * R-5 de centro) y 4 rizos de T-260 Reflex Dorado. Colores: los publicados (Pastel Dusk Rosa 110 #c9b3b7, Palo de Rosa
 * 010, Pastel Dusk Lavanda 150 #947595 y Reflex Dorado 970).
 */
const escena903 = (): Escena => {
  const f = foto(300, 950, 3.6);
  const eje: Array<readonly [number, number]> = [[190, 940], [188, 720], [195, 540], [232, 410], [310, 300], [420, 215], [550, 160], [690, 135], [830, 135]].map(([x, y]) => { const p = f(x!, y!); return [p.x, p.y] as const; });
  const fueraEje = desplazar(eje, 12), cordonEje = desplazar(eje, -4), dentroEje = desplazar(eje, -13);
  const arco = organico([
    { id: "fuera", nombre: "Fila de fuera", puntos: fueraEje.map(([x, y]) => v(x, y, -2)), radioInicioCm: 15, radioFinCm: 15, mezcla: mezcla({ "R-12": 1 }), tapas: { inicio: false, fin: true } },
    { id: "cordon", nombre: "Cordón dorado", puntos: cordonEje.map(([x, y]) => v(x, y, 13)), radioInicioCm: 8, radioFinCm: 8, mezcla: mezcla({ "R-5": 1 }), tapas: { inicio: false, fin: true } },
    { id: "dentro", nombre: "Fila de dentro", puntos: dentroEje.map(([x, y]) => v(x, y, -3)), radioInicioCm: 11, radioFinCm: 11, mezcla: mezcla({ "R-9": 1 }), tapas: { inicio: false, fin: true } },
  ], { "R-12": [["110", 1]], "R-9": [["010", 1]], "R-5": [["970", 1]] }, 903,
  { suelo: true, inflados: { "R-12": 28, "R-9": 19, "R-5": 11 }, densidad: 1.5, densidadTramo: { cordon: 2.6 } });
  const m = montaje(
    { id: "semiarco", nombre: "Semiarco orgánico rosa dusk, palo de rosa y dorado", pieza: arco, origen: v(0, 0, 0) },
    { nombre: "Amarre de las flores y los rizos (oculto, detrás del semiarco)", base: v(0, 2, -30) },
  );
  const flor = (petalo: number, centro: string, corona: boolean): Decoracion => ({
    tipo: "flor",
    propiedades: { petalos: { ...R("R-12", petalo, "150"), cantidad: 5, aperturaGrados: 10, giroGrados: 0 }, centro: { ...R("R-5", corona ? 7 : 9, centro), cantidad: 1 }, ...(corona ? { corona: { ...R("R-5", 7, "010"), cantidad: 6 } } : {}) },
  });
  m.deco("flor-1", "Flor de 5 pétalos R-12 lavanda con racimo palo de rosa (arriba)", flor(26, "010", true), f(625, 190, 16), unitario(v(0.1, 0.15, 1)));
  m.deco("flor-2", "Flor de 5 pétalos R-12 lavanda (centro palo de rosa)", flor(20, "010", false), f(245, 285, 16), unitario(v(-0.1, 0.15, 1)));
  m.deco("flor-3", "Flor de 5 pétalos R-12 lavanda (centro rosa)", flor(20, "110", false), f(130, 390, 16), unitario(v(-0.2, 0.1, 1)));
  m.deco("flor-4", "Flor de 5 pétalos R-12 lavanda (centro palo de rosa, abajo del codo)", flor(19, "010", false), f(255, 415, 20), unitario(v(0.1, 0, 1)));
  m.deco("flor-5", "Flor de 5 pétalos R-12 lavanda (abajo)", flor(22, "110", false), f(155, 835, 18), unitario(v(-0.1, 0, 1)));
  const dorado = T("T-260", 3.2, "970");
  const de = (o: Vec3) => (x: number, y: number): readonly [number, number] => { const p = f(x, y); return [r2(p.x - o.x), r2(p.y - o.y)] as const; };
  const o1 = f(330, 300, 12), o2 = f(480, 235, 12), o3 = f(205, 520, 12), o4 = f(205, 690, 12);
  m.trazo("rizo-1", "Rizo de T-260 Reflex Dorado (codo, ondulado)", dorado, [{ puntos: suave([de(o1)(330, 300), de(o1)(350, 330), de(o1)(372, 290), de(o1)(392, 330), de(o1)(410, 285), de(o1)(428, 315)], 3) }], o1, "a wavy gold twisted-balloon curl");
  m.trazo("rizo-2", "Rizo de T-260 Reflex Dorado (arriba, lazo)", dorado, [{ puntos: suave([de(o2)(480, 235), de(o2)(500, 260), de(o2)(530, 250), de(o2)(520, 225), de(o2)(500, 232), de(o2)(510, 255), de(o2)(545, 262)], 3) }], o2, "a looping gold twisted-balloon curl");
  m.trazo("rizo-3", "Rizo de T-260 Reflex Dorado (izquierda, resorte)", dorado, [{ puntos: suave([de(o3)(205, 520), de(o3)(232, 545), de(o3)(210, 575), de(o3)(235, 600), de(o3)(212, 625), de(o3)(238, 650), de(o3)(222, 672)], 3) }], o3, "a spiral gold twisted-balloon curl");
  m.trazo("rizo-4", "Rizo de T-260 Reflex Dorado (abajo, rulo)", dorado, [{ puntos: suave([de(o4)(205, 690), de(o4)(232, 700), de(o4)(240, 725), de(o4)(222, 742), de(o4)(205, 728), de(o4)(214, 708), de(o4)(238, 712)], 3) }], o4, "a curly gold twisted-balloon loop");
  return m.escena(sala(380, 300, 300));
};

// ----------------------------------------------------------------------------------------------------------
// 905 · Semiarco orgánico combinaciones con Reflex
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 (PNG recortado); el R-24 dorado de arriba mide ~130 px (55 cm): 2,36 px/cm, con el piso en y = 560
 * px y el eje en x = 330. Semiarco de 2,3 × 2,3 m que sube en diagonal de (−55, 17) a (+85, 191) cm, de R-18 rosados,
 * R-12 rosados, fucsia, Reflex Dorado Rosa y Reflex Dorado y tríos de R-5 dorados; dos R-24 Reflex Dorado (arriba a la
 * derecha (+98, 163) y a la izquierda (−53, 95)) y seis R-12 cristal «Graffiti Invierno» (~52 px: 22 cm). Colores: los
 * publicados (Rosado 009 #f9cadf, Fucsia 012, Reflex Dorado Rosa 968, Reflex Dorado 970 y el Graffiti Invierno).
 */
const escena905 = (): Escena => {
  const f = foto(330, 560, 2.36);
  const recorrido = [f(200, 520), f(262, 440), f(322, 372), f(340, 300), f(352, 232), f(420, 170), f(500, 122), f(530, 110)].map((p) => v(p.x, p.y, 0));
  const arco = organico([{ id: "semiarco", nombre: "Semiarco", puntos: recorrido, radioInicioCm: 32, radioFinCm: 26, mezcla: mezcla({ "R-18": 0.12, "R-12": 0.58, "R-5": 0.3 }), tapas: { inicio: true, fin: true } }],
    { "R-18": [["009", 1]], "R-12": [["012", 0.3], ["009", 0.25], ["968", 0.22], ["970", 0.23]], "R-5": [["970", 1]] }, 905,
    { suelo: true, inflados: { "R-18": 36, "R-12": 22, "R-5": 9 }, densidad: 1.6 });
  const m = montaje(
    { id: "semiarco", nombre: "Semiarco orgánico rosado, fucsia y Reflex", pieza: arco, origen: v(0, 0, 0) },
    { nombre: "Amarre de los acentos (oculto, detrás del semiarco)", base: v(0, 2, -40) },
  );
  m.globo("dorado-arriba", "R-24 Reflex Dorado (arriba a la derecha)", R("R-24", 55, "970"), f(560, 175, 0), unitario(v(1, 0.3, 0.2)));
  m.globo("dorado-izquierda", "R-24 Reflex Dorado (izquierda)", R("R-24", 50, "970"), f(205, 335, -2), unitario(v(-1, 0.2, 0.2)));
  const graffiti: ReadonlyArray<readonly [number, number]> = [[445, 70], [330, 168], [278, 230], [337, 385], [290, 418], [185, 477]];
  graffiti.forEach(([x, y], k) => m.globo(`graffiti-${k + 1}`, `R-12 cristal «Graffiti Invierno» ${k + 1}`, R("R-12", 22, "390"), f(x, y, 22), unitario(v(0, 0.2, 1)), "infinity-graffiti-invierno-fashion-transparente"));
  return m.escena(sala(360, 300, 280));
};

// ----------------------------------------------------------------------------------------------------------
// 917 · Sorbete infantil
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 blancos grandes miden ~78 px (28 cm): 2,8 px/cm, con el piso en y = 552 px y el eje en x =
 * 330. El vaso de malteada en 9 cuartetos (de abajo arriba): pie blanco R-12 (27 cm, a 15 cm), el pie rosado que se
 * abre (R-9 de 15, 16,5 y 19 cm y R-12 de 22 y 26 cm, de 34 a 83 cm), la crema blanca (R-12 de 28, 23 y 17 cm, de 101 a
 * 139 cm), la cereza (R-9 rojo de 19 cm, a la izquierda arriba) y el pitillo de dos T-260 blanco y rojo torcidos (56
 * cm, en diagonal hasta 188 cm). Medidos: rosado #f9b5d3–#fdb7d4 → Rosado 009 (el Satín Rosado queda 1–3 más cerca);
 * blanco (azulado por la luz) → Blanco 005; rojo → Rojo 015.
 */
const escena917 = (): Escena => {
  const ROSADO = "009", BLANCO = "005", ROJO = "015";
  const f = foto(330, 552, 2.8);
  const m = montaje(
    { id: "pie", nombre: "Sorbete: cuarteto R-12 blanco del pie", pieza: cuarteto(R("R-12", 27, BLANCO), [BLANCO]), origen: v(0, 15, 0) },
    { nombre: "Varilla del sorbete (oculta, por dentro)", base: v(0, 0, 0), altoCm: 130 },
  );
  const niveles: ReadonlyArray<readonly [string, string, ParteGlobo, number, number]> = [
    ["rosado-1", "Cuarteto R-9 rosado (15 cm)", R("R-9", 15, ROSADO), 33.6, 45],
    ["rosado-2", "Cuarteto R-9 rosado (16,5 cm)", R("R-9", 16.5, ROSADO), 45, 0],
    ["rosado-3", "Cuarteto R-9 rosado (19 cm)", R("R-9", 19, ROSADO), 59.6, 45],
    ["rosado-4", "Cuarteto R-12 rosado (22 cm)", R("R-12", 22, ROSADO), 72, 0],
    ["rosado-5", "Cuarteto R-12 rosado (26 cm)", R("R-12", 26, ROSADO), 83, 45],
    ["crema-1", "Cuarteto R-12 blanco de la crema (28 cm)", R("R-12", 28, BLANCO), 101, 0],
    ["crema-2", "Cuarteto R-12 blanco de la crema (23 cm)", R("R-12", 23, BLANCO), 121, 45],
    ["crema-3", "Cuarteto R-12 blanco de arriba (17 cm)", R("R-12", 17, BLANCO), 139, 0],
  ];
  for (const [id, nombre, g, y, giro] of niveles) m.nivel(id, nombre, cuarteto(g, [g.codigo]), v(0, y, 0), giro);
  m.globo("cereza", "Cereza: R-9 rojo", R("R-9", 19, ROJO), f(300, 168, 6), unitario(v(-0.3, 1, 0.3)));
  // El pitillo: dos T-260 (blanco y rojo) en resorte, en fase opuesta, colgando de la punta hacia el vaso.
  const punta = f(480, 25, -2), pie = f(385, 150, -2);
  const d = menos(pie, punta);
  const pitillo = (codigo: string, giroGrados: number): Decoracion => rizo({ forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 3.6, codigo }, vueltas: 4, radioCm: 1.9, largoCm: r2(largo(d)), eje: "abajo", giroGrados });
  const giro = r2((Math.atan2(d.x, -d.y) * 180) / Math.PI);
  m.deco("pitillo-blanco", "Pitillo: T-260 blanco torcido", pitillo(BLANCO, 0), punta, AL_FRENTE, giro);
  m.deco("pitillo-rojo", "Pitillo: T-260 rojo torcido", pitillo(ROJO, 180), punta, AL_FRENTE, giro);
  return m.escena(sala(300, 260, 230));
};

// ----------------------------------------------------------------------------------------------------------
// 919 · Sorpresa neón
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 de helio miden ~60 px (28 cm): 2,15 px/cm, con el piso en y = 553 px y el eje en x = 360.
 * Tres «regalos» apilados, cada uno de dos cuartetos de R-12 (~45 px: 21 cm) con un hueco al frente (se ven 2 por
 * nivel): verde (13 y 39 cm), fucsia (60 y 83) y amarillo (104 y 127), cada regalo con su cinta de T-260 (una vertical
 * al frente y una vuelta a la cintura): rosa con moño en el verde, naranja en el fucsia y azul con moño en el amarillo.
 * Encima, con cintas blancas, tres R-12 de helio impresos: verde (171 cm), fucsia (208) y amarillo (236). Medidos
 * (lo oscuro, sin las estrellas): verde → Neón Verde 230; fucsia → Neón Fucsia 212; amarillo limón #c8d26e → Neón
 * Amarillo 220; cintas azul #06a2da → Azul 040, naranja #fd774f → Naranja 061 y rosa #fe62a3 → Rosa 011.
 */
const escena919 = (): Escena => {
  const VERDE = "230", FUCSIA = "212", AMARILLO = "220";
  const f = foto(360, 553, 2.15);
  const g = (c: string) => R("R-12", 21, c);
  const m = montaje(
    { id: "base", nombre: "Sorpresa neón: cuarteto R-12 verde de abajo", pieza: cuarteto(g(VERDE), [VERDE]), origen: v(0, 13, 0) },
    { nombre: "Varilla de la columna (oculta, por dentro)", base: v(0, 0, 0), altoCm: 130 },
  );
  const niveles: ReadonlyArray<readonly [string, string, string, number]> = [["verde-2", "Cuarteto R-12 verde de arriba", VERDE, 38.6], ["fucsia-1", "Cuarteto R-12 fucsia de abajo", FUCSIA, 59.5], ["fucsia-2", "Cuarteto R-12 fucsia de arriba", FUCSIA, 82.8], ["amarillo-1", "Cuarteto R-12 amarillo de abajo", AMARILLO, 103.7], ["amarillo-2", "Cuarteto R-12 amarillo de arriba", AMARILLO, 127]];
  for (const [id, nombre, c, y] of niveles) m.nivel(id, nombre, cuarteto(g(c), [c]), v(0, y, 0), 0);
  // Las cintas de cada regalo: una vertical por el hueco de delante, una vuelta a la cintura y, en dos, el moño.
  const cintas: ReadonlyArray<readonly [string, string, string, number, number, boolean]> = [["verde", "rosa", "011", 2, 50, true], ["fucsia", "naranja", "061", 49, 93, false], ["amarillo", "azul", "040", 93, 137, true]];
  for (const [regalo, color, c, desde, hasta, conMono] of cintas) {
    const t = T("T-260", 2.6, c);
    m.palito(`cinta-${regalo}`, `Cinta vertical de T-260 ${color} (regalo ${regalo})`, t, v(0, desde, 13), v(0, hasta, 13));
    m.deco(`vuelta-${regalo}`, `Vuelta de T-260 ${color} a la cintura (regalo ${regalo})`, rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 2.6, codigos: [c], largosCm: [11.5], recorrido: "aro", cantidad: 8, giroGrados: 22.5 }), v(0, r2((desde + hasta) / 2), 0), ARRIBA);
    if (conMono) m.deco(`mono-${regalo}`, `Moño de T-260 ${color} (regalo ${regalo})`, { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 2.6, codigo: c, lazosPorLado: 2, largoLazoCm: 8, anchoLazoCm: 4.5, aberturaGrados: 40, colas: false, largoColaCm: 0, centro: null } }, v(0, regalo === "verde" ? 17.7 : r2((desde + hasta) / 2), 15), AL_FRENTE);
  }
  const SPLASH = "2-caras-feliz-cumpleanos-splash-neon-neon-surtido";
  const amarre = v(0, 138, 0);
  const sube = (c: Vec3) => unitario(mas(por(unitario(menos(c, amarre)), 0.3), por(ARRIBA, 0.7)));
  const helio: ReadonlyArray<readonly [string, string, string, Vec3]> = [["helio-verde", "R-12 verde impreso con helio (abajo)", VERDE, f(365, 185, 0)], ["helio-fucsia", "R-12 fucsia impreso con helio (medio)", FUCSIA, f(395, 105, -4)], ["helio-amarillo", "R-12 amarillo impreso con helio (arriba)", AMARILLO, f(345, 45, -8)]];
  for (const [id, nombre, c, centro] of helio) m.helio(id, nombre, R("R-12", 28, c), centro, SPLASH, sube(centro));
  m.cintas(amarre, "#f2f2f2", "Cintas blancas del helio");
  return m.escena(sala(300, 260, 260));
};

// ----------------------------------------------------------------------------------------------------------
// 925 · Tazmania
// ----------------------------------------------------------------------------------------------------------

/** El metalizado de Taz (personaje: no está en la tienda): remolino, cabeza, cara y brazos, en paneles de foil. */
const TAZ_925: ElementoEscenografia[] = [
  panel([[-7, 0], [4, 0], [16, 22], [-14, 26]], 6, "#cfe3f0", "foil", { dibujo: "rayas", hex: "#7fb3d8" }),
  panel(elipse(10, 40, 15, 13.5, -15, 22), 9, "#c4652a", "foil", undefined, 1),
  panel(elipse(8, 36, 9.5, 8, -15, 18), 4, "#f2c99a", "foil", { dibujo: "texto", texto: "Taz", hex: "#3a1a10" }, 5),
  panel([[-4, 45], [-16, 55], [-20, 58], [-18, 61], [-13, 57], [-2, 49]], 3, "#a23a1e", "foil", undefined, 2),
  panel([[22, 30], [33, 20], [38, 12], [41, 14], [37, 22], [25, 34]], 3, "#a23a1e", "foil", undefined, 2),
];

/**
 * Foto de 740×570; la columna mide ~140 px de ancho (2,24 diámetros: R-12 a ~26,5 cm): 2,5 px/cm, con el piso en y =
 * 545 px y el eje en x = 372. Columna de 6 cuartetos R-12 de un color (los dos de abajo a 28 cm), alternados uno al
 * frente y un hueco al frente, de 15 a 121 cm (hasta 134); encima, un cuarteto R-5 naranja (se ven 2) y el metalizado
 * de Taz (58 × 64 cm, de 136 a 200 cm, corrido a la derecha). Medidos: la columna (mediana #7c444c, un café rosado) →
 * Reflex Fucsia 912 (ΔE 8; el Chocolate 076 queda a 16 y el Merlot 018 a 21); naranja #ff7f01 → Naranja 061.
 */
const escena925 = (): Escena => {
  const COLOR = "912", NARANJA = "061";
  const m = montaje(
    { id: "base", nombre: "Columna Tazmania: cuarteto R-12 de abajo", pieza: cuarteto(R("R-12", 28, COLOR), [COLOR]), origen: v(0, 15, 0) },
    { nombre: "Varilla de la columna (oculta, por dentro)", base: v(0, 0, 0), altoCm: 130 },
  );
  const niveles: ReadonlyArray<readonly [number, number, number]> = [[28, 37.5, 45], [26.5, 58.6, 0], [26.5, 79.8, 45], [26.5, 101, 0], [26.5, 122.2, 45]];
  niveles.forEach(([d, y, giro], k) => m.nivel(`nivel-${k + 2}`, `Cuarteto R-12 ${k + 2}`, cuarteto(R("R-12", d, COLOR), [COLOR]), v(0, y, 0), giro));
  m.nivel("naranja", "Cuarteto R-5 naranja de remate", cuarteto(R("R-5", 10, NARANJA), [NARANJA]), v(0, 136.5, 0), 0);
  m.plano("taz", "Metalizado de Taz (paneles de foil)", { tipo: "escenografia", elementos: TAZ_925 }, v(0, 138, 0));
  return m.escena(sala(300, 260, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 928 · Telaraña
// ----------------------------------------------------------------------------------------------------------

/** Un hilo de tela plano (un panel delgado de frente) de `a` a `b`, en el plano de la pieza. */
function hiloPlano(a: readonly [number, number], b: readonly [number, number], anchoCm: number): ElementoEscenografia {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (-(b[1] - a[1]) / l) * (anchoCm / 2), ny = ((b[0] - a[0]) / l) * (anchoCm / 2);
  return panel([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], 0.3, "#151515", "tela");
}

/** El mantel redondo de telaraña (utilería de la tienda): radios e hilos combados de tela negra, de `radioCm`. */
function mantelTelarana(radioCm: number): Pieza {
  const n = 12, anillos = 5;
  const angulos = Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n + 0.08 * Math.sin(i * 2.3));
  const largos = Array.from({ length: n }, (_, i) => radioCm * (0.9 + 0.1 * Math.sin(i * 1.7 + 0.5)));
  const p = (r: number, a: number): readonly [number, number] => [r2(r * Math.cos(a)), r2(radioCm + r * Math.sin(a))];
  const elementos: ElementoEscenografia[] = angulos.map((a, i) => hiloPlano(p(0, 0), p(largos[i]!, a), 0.7));
  for (let k = 1; k <= anillos; k++) {
    const f = k / (anillos + 0.15);
    for (let i = 0; i < n; i++) {
      const a = angulos[i]!, b = angulos[(i + 1) % n]! + (i === n - 1 ? 2 * Math.PI : 0);
      const m = p(((largos[i]! + largos[(i + 1) % n]!) / 2) * f * Math.cos((b - a) / 2) * 0.86, (a + b) / 2);
      elementos.push(hiloPlano(p(largos[i]! * f, a), m, 0.6), hiloPlano(m, p(largos[(i + 1) % n]! * f, b), 0.6));
    }
  }
  return { tipo: "escenografia", utileria: "mantel", elementos, productos: [productoDe("mantel-fiesta-desechable-redondo-poliester-telarana", 1, "mantel redondo de telaraña")] };
}

/**
 * Foto de 1600×1600; el R-18 de la derecha mide ~275 px (45 cm) y los R-12 ~160 px (27 cm): 6 px/cm, con el piso en
 * y = 1460 px y el eje en x = 800. Publica «Materiales»: 12 R-12 Silk Gris Medianoche, 12 Naranja Cobrizo, 12 Latte, 12
 * R-5 Silk Dorado, 2 R-18 Silk Gris Medianoche, 1 R-9 negro, 3 T-260 negros, 1 R-12 Infinity Metalink de telaraña y el
 * mantel redondo de telaraña. Medio aro orgánico de 1,95 × 2 m que sube por la izquierda y dobla a la derecha (los 36
 * R-12), con un R-18 gris a cada punta del lado (izquierda (−81, 88) y derecha (+75, 135)), 4 tríos de R-5 dorado
 * contados ((−35, 110), (−4, 138), (+33, 167), (+68, 159)), la araña (cuerpo R-12 Metalink de telaraña a (−63, 70),
 * cabeza R-9 negra con ojos verdes a su derecha, 8 patas en lazo de 3 T-260 negros) y el mantel de telaraña (~87 cm)
 * colgado dentro del aro (centro a (+27, 93)). Colores: los publicados.
 */
const escena928 = (): Escena => {
  const f = foto(800, 1460, 6);
  const GRIS = "880", COBRIZO = "062", LATTE = "073", DORADO = "870", NEGRO = "080";
  const recorrido = [f(640, 1385), f(560, 1200), f(472, 965), f(515, 760), f(640, 565), f(780, 405), f(920, 330), f(1080, 330), f(1195, 430), f(1235, 545)].map((p) => v(p.x, p.y, 0));
  const arco = organico([{ id: "aro", nombre: "Medio aro", puntos: recorrido, radioInicioCm: 24, radioFinCm: 24, mezcla: mezcla({ "R-12": 1 }), tapas: { inicio: true, fin: true } }],
    { "R-12": [[GRIS, 1], [COBRIZO, 1], [LATTE, 1]] }, SEMILLA_928, { suelo: true, inflados: { "R-12": 27 }, densidad: DENSIDAD_928 });
  const m = montaje(
    { id: "aro", nombre: "Medio aro orgánico gris medianoche, naranja cobrizo y latte", pieza: arco, origen: v(0, 0, 0) },
    { nombre: "Amarre de la araña y el mantel (oculto, detrás del aro)", base: v(0, 2, -35) },
  );
  m.globo("gris-izquierda", "R-18 Silk Gris Medianoche (izquierda)", R("R-18", 40, GRIS), f(315, 930, -6), unitario(v(-1, 0.1, 0.2)));
  m.globo("gris-derecha", "R-18 Silk Gris Medianoche (derecha)", R("R-18", 45, GRIS), f(1250, 650, -4), unitario(v(1, -0.2, 0.2)));
  const trio: Decoracion = { tipo: "flor", propiedades: { petalos: { ...R("R-5", 12, DORADO), cantidad: 3, aperturaGrados: 35, giroGrados: 0 }, centro: null } };
  ([[590, 800], [775, 630], [995, 460], [1205, 505]] as const).forEach(([x, y], k) => m.deco(`trio-${k + 1}`, `Trío de R-5 Silk Dorado ${k + 1}`, trio, f(x, y, 20), unitario(v(0, 0.2, 1))));
  const arana: Pieza = {
    tipo: "decoracion",
    decoracion: { tipo: "arana", propiedades: { cuerpo: R("R-12", 30, NEGRO), cabeza: R("R-9", 22, NEGRO), ojos: { hexIris: "#5aa02c" }, patas: { ...T("T-260", 4, NEGRO), largoCm: PATA_928, estilo: "lazos" }, giroGrados: -90 } },
    impresos: [{ impresoId: "infinity-arana-metalink-fashion-negro", globos: [0] }],
  };
  m.pieza("arana", "Araña: cuerpo R-12 Metalink de telaraña, cabeza R-9 negra y 8 patas de T-260 negro", arana, f(420, 1040, 26), AL_FRENTE);
  m.plano("mantel", "Mantel redondo de telaraña colgado dentro del aro", mantelTelarana(43), f(960, 1160, -2));
  return m.escena(sala(320, 280, 260));
};
/** Afinados para que el motor dé los 36 R-12 publicados y las patas gasten los 3 T-260 (la prueba lo comprueba). */
const SEMILLA_928 = 928;
const DENSIDAD_928 = 1;
const PATA_928 = 18;

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

export const LOTE_22: readonly IdeaDigitalizada[] = [
  idea(774, "mural-corazones-clasicos", "Mural corazones clásicos: malla roja con R-12 de corazones", escena774,
    "Igual: la malla de Link-O-Loon rojo en rombos (LOL-12 a 20,5 cm, ~3,4 × 1,9 m; escala por la retícula, 42,7 px por paso, y los blancos de ~56 px = 28 cm) con su pareja de unión R-5 fucsia en cada nudo y los 53 R-12 blancos con corazones rojos en los huecos, 8 y 7 por fila alternados en 7 filas, contados uno a uno. Distinto: la idea no publica productos: colores medidos (rojo #fe2a2f → Rojo 015; fucsia #ff227e → Fucsia 012, el Fashion más cercano: el Neón y el Metal Fucsia quedan 2–3 ΔE más cerca); los corazones de la foto son puntitos rojos sobre blanco: va el «Corazones por Siempre» rojo-blanco de la tienda (el más parecido); la malla del taller arranca con un nudo en cada esquina, así que para que los huecos caigan donde en la foto lleva una fila de eslabones de más abajo (un zigzag de 16 eslabones y 9 uniones que no se ve en la foto); los blancos van algo por delante de los eslabones (en la foto, metidos en el hueco)."),
  idea(778, "mural-navideno", "Mural navideño: pared roja y verde con dorados e impresos", escena778,
    "Igual: la pared de 10 × 10 R-12 (escala por las columnas, 53,5 px = un globo de ~26 cm): dos columnas de rojos a cada lado y seis de verdes en medio; en los cruces de cuatro globos, alternados, 55 R-5 dorados (con los de los bordes de los lados y de arriba, como en la foto) y 25 globos impresos navideños (10 verdes en las columnas rojas y 15 rojos en las verdes), y los 16 cruces vacíos. Distinto: la idea no publica productos: colores medidos (rojo → Rojo 015; verde #009682 → Verde 030, a 5 ΔE del Reflex Verde Aurora; dorado #eec876 → Metal Dorado 570); el impreso de Santa con lunares no está en la tienda: va el «Feliz Navidad Corona» rojo y verde selva (el más parecido), en R-12 a 15 cm delante del cruce (en la foto se ve metido en el hueco, como un rombo); la retícula del taller pone los R-12 a 0,9 inflados (en la foto, tocándose: la pared queda ~10 % más apretada)."),
  idea(786, "nombre-calabaza-noche", "Calabaza noche: dos calabazas negras sobre base té verde", escena786,
    "Igual: con los «Materiales» publicados, exactos: la base orgánica de 20 R-9 Pastel Dusk Té Verde (~11 cm, ~58 cm de ancho y 28 de alto: en la foto, 62 × 24; escala por los R-12 negros, ~390 px = 30 cm), las 2 calabazas «Calabaza Luz» apiladas a la derecha (R-12 negro con cara de calabaza amarilla, a 30 y 63 cm), el R-12 naranja «Happy Halloween» a la izquierda y los 2 T-260 Reflex Verde Lima: el cuello de 4 lazos entre las calabazas, el moño de arriba y el tallo en diagonal hasta ~98 cm. Distinto: el impreso «Calabaza Luz» no está en el catálogo de impresos del taller: va un R-12 negro con la cara de calabaza del taller (ojos y nariz de triángulo y boca con dientes) y el producto publicado; los globos de la base los pone el motor orgánico (20, como en la lista; su sitio no es el de la foto uno a uno); los lazos del taller son más finos y regulares que los de la foto.",
    [
      pub("GLOBO REDONDO CALABAZA LUZ", "/products/globo-para-fiesta-latex-redondo-2-caras-calabaza-luz-fashion-negro", "R-12", null, { cantidades: { "R-12": 2 }, representa: { formatoId: "R-12", codigo: "080" } }),
      pub("GLOBO REDONDO HAPPY HALLOWEEN", "/products/globo-para-fiesta-latex-redondo-2-caras-happy-halloween-fashion-surtido-negro-naranja", "R-12", null, { cantidades: { "R-12": 1 } }),
      pub("GLOBO TUBITO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-reflex-verde-lima", "T-260", "931", { cantidades: { "T-260": 2 } }),
      pub("GLOBO REDONDO PASTEL DUSK TÉ VERDE", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-te-verde", "R-12", "126", { cantidades: { "R-9": 20 } }),
    ]),
  idea(787, "nota-musical", "Nota musical: columna azul y fucsia con nota metalizada", escena787,
    "Igual: la columna de ~1,7 m (escala por el tallo de T-260, ~14 px = 5 cm): cuarteto R-9 azul y R-9 fucsia abajo, un anillo de 4 R-5 negros, el tallo de T-260 azul con dos anillos de R-5 negros, otro anillo negro, cuarteto fucsia (hueco al frente) y azul (uno al frente) arriba, y la nota musical negra (♫, 55 × 52 cm) encima, corrida a la izquierda como en la foto. Distinto: la idea no publica productos: colores medidos (azul #01a7d2 → Azul 040; fucsia #fe3890 → Fucsia 012; negro 080); los azules de la foto llevan pintitas negras que no están en la tienda (van lisos); la nota metalizada no está en la tienda: va como paneles de foil (no cotiza); en la foto los anillos negros parecen de 5–6 globitos (aquí cuartetos de R-5)."),
  idea(802, "olla-embrujada", "Olla embrujada: caldero de globos con araña y helio", escena802,
    "Igual: la olla de R-12 negro (escala por los R-12 de helio, ~140 px = 28 cm) sobre 4 R-5 negros de patas, con la boca de T-260 blanco, un asa blanca a cada lado y 4 llamas de T-260 naranja por debajo (se ven 2), la araña violeta sobre el borde derecho y los 3 R-12 de helio (negro arriba a 85 cm y dos naranja a los lados) con cintas naranja que salen de la olla. Distinto: la idea no publica productos: colores medidos (naranja #ff5e1f → Naranja 061; violeta #50127e → Violeta 051); la araña de la foto es toda de T-260 (aquí cuerpo y cabeza de R-5 violeta con patas de T-260); el asa blanca de la foto se ve hecha de burbujitas (aquí un medio aro) y la perilla negra del borde no va; la derecha va tapada por la araña."),
  idea(856, "primaveral", "Primaveral: malla blanca con pasto, flores y metalizados", escena856,
    "Igual: la malla de Link-O-Loon blanco (~1,8 × 1,8 m; escala por los R-5 del pasto y los pétalos, ~25 px = 11 cm) con el pasto orgánico de R-5 y R-9 verdes delante de lado a lado, la flor de 5 R-5 rosados y la de 4 R-5 naranja, ambas con centro amarillo, sus tallos de T-260 verde con un zarcillo, y los tres metalizados de figura en sus sitios: abeja arriba a la izquierda, mariposa arriba a la derecha (sobresale de la malla) y caracol abajo a la derecha. Distinto: la idea no publica productos: colores medidos (verdes #00974a → Metal Verde 530 y #54b175 → Verde 030; rosado #fd98c0 → Satín Fucsia 412; amarillo → Amarillo Miel 021; naranja → Naranja 061; el tallo #097a6d → Reflex Verde Aurora, que no se hace en T-260: va el Verde Selva 032); la abeja, la mariposa y el caracol no están en la tienda: van como paneles de foil sencillos (óvalos con rayas o lunares, no cotizan); el pasto lo pone el motor orgánico (no contado uno a uno)."),
  idea(883, "regalo-con-amor", "Regalo con amor: canasta con racimo, «LOVE» y utilería", escena883,
    "Igual: la canasta de mimbre con forro blanco (46 × 22 cm; escala por el redondo de 18\", ~385 px = 45 cm), dentro la caja del kit «Sweet Love», la cajita de velitas, el vaso «LOVE» con su servilleta y el plato «LOVE» en un palito; encima, el racimo en herradura de R-5 rojos, rosados y rosa (~7,6 cm) y el redondo metalizado «LOVE» de la tienda (centro a 81 cm). Distinto: el Infinity® LOVE publicado (R-12) no se ve en la foto: va listado sin cantidad, y el racimo va con R-5 lisos medidos (rojo #e6353f → Rojo 015, rosado #f6d4df → Pastel Mate Rosado 609, rosa #e33e92 → Rosa 011; los pone el motor orgánico); el kit «Sweet Love» y las velitas no están en el catálogo de utilería del taller (van como cajas con su letrero; el kit, contado); los dulces y la guirnalda de papel no van; el plato va a 18 cm (el de la tienda) aunque en la foto, más cerca de la cámara, se vea más grande.",
    [
      pub("GLOBO REDONDO INFINITY® LOVE FASHION SURTIDO", "/products/globo-para-fiesta-latex-redondo-infinity-love-fashion-surtido", "R-12", null),
      pub("GLOBO METALIZADO LOVE", "/products/globo-metalizado-love-1", null, null),
      pub("PLATO LOVE", "/products/plato-love", null, null),
      pub("VASO LOVE", "/products/vaso-love", null, null),
      pub("SERVILLETA PEQUEÑA LOVE", "/products/servilleta-pequena-love", null, null),
      pub("KIT DIY GUIRNALDA SWEET LOVE", "/products/kit-diy-guirnalda-amor-y-amistad", null, null, { piezas: 1 }),
    ]),
  idea(887, "revelacion-de-genero", "Revelación de género: globo «?» con collar sobre base orgánica", escena887,
    "Igual: el R-36 negro «?» (~69 cm; escala por los R-5 del collar, ~65 px = 12 cm) con su collar de 22 R-5 Pastel Mate Azul y Rosado alternados, sobre la base orgánica perla y nude de ~1,6 × 0,9 m; los 4 «baby» en sus sitios (2 rosados a la izquierda y 2 azules a la derecha) y los 4 lisos de acento (2 Pastel Dusk Azul y 2 Pastel Dusk Rosa) delante. Colores: los publicados en el collar y los acentos; la base, medida (perla #dbd5c1 → Silk Perla Crema 873; nude #e8cfb4 → Pastel Mate Nude 661). Distinto: los «baby» de la foto (rosado durazno y azul pizarra con nubes) no están en la tienda: van el «Es una niña» Pastel Mate Rosado y el «Es un niño» Pastel Mate Azul (los más parecidos: baby shower y tonos pastel); la base la pone el motor orgánico (no contada uno a uno); el Interrogación de la tienda es R-36 y aquí va a 69 cm (la idea lo mapeaba como R-12).",
    [
      pub("GLOBO REDONDO INFINITY® INTERROGACION FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-infinity-interrogacion-fashion-negro", "R-12", null),
      pub("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609"),
      pub("GLOBO REDONDO PASTEL DUSK ROSA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-rosa", "R-12", "110"),
      pub("GLOBO REDONDO PASTEL MATE AZUL", "/products/globo-para-fiesta-latex-redondo-pastel-mate-azul", "R-12", "640"),
      pub("GLOBO REDONDO PASTEL DUSK AZUL", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-azul", "R-12", "140"),
    ]),
  idea(902, "semi-arco-organico-tropical-con-toques-de-animal-print", "Semiarco orgánico tropical con animal print", escena902,
    "Igual: el semiarco que sube del piso hasta ~2,3 m y dobla a la derecha (escala por los R-12, ~52 px = 27 cm, y el R-24 dorado, ~107 px = 55 cm), de R-12, R-9 y tríos de R-5 en los cuatro colores publicados (Eucalipto 027, Arena 071, Café 074 y Reflex Dorado 970), con el R-24 dorado en la punta y el R-24 arena al pie, 6 «Infinity® Animal Print» de la tienda (dos cebras en negro, dos jirafas y uno de manchas en arena y un leopardo en dorado) y 6 hojas de monstera. Distinto: los cremas más claros de la foto (#f0dbc6) quedan a 7 ΔE del Arena publicado, que es el que va; el animal print del taller es de manchas (no rayas de cebra ni rosetas); dos globos de la foto que podrían ser impresos (uno cristal con hojas y uno café con rayas) van lisos; los globos del cuerpo los pone el motor orgánico (no contados uno a uno); las hojas son láminas de papel.",
    [
      pub("GLOBO REDONDO INFINITY® ANIMAL PRINT", "/products/globo-para-fiesta-latex-redondo-infinity-animal-print-fashion-y-metal-surtido", "R-12", null),
      pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
      pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
      pub("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027"),
      pub("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074"),
    ]),
  idea(903, "semiarco-amor-y-amistad", "Semiarco amor y amistad: rosa dusk con flores lavanda y rizos dorados", escena903,
    "Igual: el semiarco de ~2 × 2,6 m (escala por los R-12 rosados de fuera, ~100 px = 28 cm) con la fila de fuera de R-12 Pastel Dusk Rosa, el cordón de dentro de R-9 Palo de Rosa y R-5 Reflex Dorado, las 5 flores de 5 pétalos de R-12 Pastel Dusk Lavanda (la grande de arriba con su racimo de 7 R-5 palo de rosa al centro, las otras con un R-5 de centro) y los 4 rizos de T-260 Reflex Dorado (ondulado en el codo, lazo arriba, resorte y rulo a la izquierda), con los colores publicados. Distinto: los globos de las dos filas los pone el motor orgánico (no contados uno a uno); los centros rosa claro de dos flores van en Pastel Dusk Rosa (el publicado más parecido); los pétalos de la foto tienen forma de corazón (aquí redondos).",
    [
      pub("GLOBO REDONDO PASTEL DUSK LAVANDA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-lavanda", "R-12", "150"),
      pub("GLOBO REDONDO PASTEL DUSK ROSA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-rosa", "R-12", "110"),
      pub("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010"),
      pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
    ]),
  idea(905, "semiarco-organico-combinaciones-con-reflex", "Semiarco orgánico rosado, fucsia y Reflex", escena905,
    "Igual: el semiarco de ~2,3 × 2,3 m en diagonal (escala por el R-24 dorado de arriba, ~130 px = 55 cm) de R-18 y R-12 rosados, R-12 fucsia, Reflex Dorado Rosa y Reflex Dorado y tríos de R-5 dorados, con los dos R-24 Reflex Dorado (arriba a la derecha y a la izquierda) y los 6 R-12 cristal «Graffiti Invierno» contados, con los productos publicados. Distinto: los Reflex rojizos de la foto miden #a32b28 (más cerca del Reflex Cristal Rojo) pero la idea publica el Reflex Dorado Rosa y es el que va; los globos del cuerpo los pone el motor orgánico (no contados uno a uno).",
    [
      pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
      pub("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
      pub("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente", "R-12", null),
      pub("GLOBO REDONDO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa", "R-12", "968"),
      pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
    ]),
  idea(917, "sorbete-infantil", "Sorbete infantil: vaso de malteada con cereza y pitillo", escena917,
    "Igual: el vaso de malteada de 9 cuartetos (escala por los R-12 blancos, ~78 px = 28 cm): pie blanco, cinco cuartetos rosados que se abren hacia arriba (R-9 de 15 a 19 cm y R-12 de 22 y 26), la crema de tres cuartetos blancos que se cierran (28, 23 y 17 cm), la cereza roja a la izquierda arriba y el pitillo de T-260 blanco y rojo torcidos en diagonal hasta ~1,9 m. Distinto: la idea no publica productos: colores medidos (rosado #f9b5d3 → Rosado 009, a 1–3 ΔE del Satín Rosado; blanco, azulado por la luz → Blanco 005; rojo → Rojo 015); la cereza de la foto es un R-9 a ~19 cm (la clasificación decía R-5); los cuartetos de detrás son supuestos."),
  idea(919, "sorpresa-neon", "Sorpresa neón: tres regalos de cuartetos con cintas y helio", escena919,
    "Igual: los tres regalos apilados de dos cuartetos R-12 cada uno con un hueco al frente (verde, fucsia y amarillo, de abajo arriba; escala por los R-12 de helio, ~60 px = 28 cm), cada uno con su cinta de T-260 (vertical al frente y vuelta a la cintura): rosa con moño en el verde, naranja en el fucsia y azul con moño en el amarillo; encima, los 3 R-12 de helio impresos (verde, fucsia y amarillo) con cintas blancas, hasta ~2,4 m. Distinto: la idea no publica productos: colores medidos (verde → Neón Verde 230; fucsia → Neón Fucsia 212; amarillo limón #c8d26e → Neón Amarillo 220; cintas → Azul 040, Naranja 061 y Rosa 011); las estrellas blancas de los globos de la columna no están en la tienda (van lisos neón) y los de helio van con el «Feliz Cumpleaños Splash» 2 caras neón (el más parecido a sus manchas y flores)."),
  idea(925, "tazmania", "Tazmania: columna café rosado con Taz metalizado", escena925,
    "Igual: la columna de 6 cuartetos R-12 de un color alternados (escala por su ancho, ~140 px = 2,24 diámetros: R-12 a ~26,5 cm; los dos de abajo a 28), de ~1,35 m, con el cuarteto R-5 naranja de remate (se ven 2) y el metalizado de Taz encima, corrido a la derecha, hasta ~2 m. Distinto: la idea no publica productos: color medido (mediana #7c444c, un café rosado → Reflex Fucsia 912, el más cercano a 8 ΔE; el Chocolate 076 queda a 16 y el Merlot 018 a 21); el metalizado de Taz no está en la tienda: va como paneles de foil sencillos (remolino, cabeza, cara y brazos; no cotiza)."),
  idea(928, "telarana", "Telaraña: medio aro orgánico con araña y mantel de telaraña", escena928,
    "Igual: con los «Materiales» publicados, exactos: el medio aro orgánico de ~1,95 × 2 m (escala por el R-18 de la derecha, ~275 px = 45 cm, y los R-12, ~160 px = 27 cm) con sus 12 R-12 Silk Gris Medianoche, 12 Naranja Cobrizo y 12 Latte, los 2 R-18 Silk Gris Medianoche a los lados, los 12 R-5 Silk Dorado en los 4 tríos de la foto, la araña (cuerpo R-12 Infinity® Araña Metalink, cabeza R-9 negra con ojos verdes y 8 patas en lazo de 3 T-260 negros) abajo a la izquierda y el mantel redondo de telaraña colgado dentro del aro. Distinto: los R-12 del aro los pone el motor orgánico (36, como en la lista; su sitio y su color no son los de la foto uno a uno); el impreso de la lista («Metalink telaraña») va con el «Infinity® Araña Metalink» de la tienda (el que hay); la cabeza lleva los ojos del taller (sin colmillos); el kit «Spooky Spider» publicado va listado sin cantidad (sus piezas son las de la araña).",
    [
      pub("KIT DIY SPOOKY SPIDER", "/products/kit-diy-arana", null, null),
      pub("MANTEL REDONDO POLIESTER TELARAÑA", "/products/mantel-fiesta-desechable-redondo-poliester-telarana", null, null, { cantidades: { "": 1 } }),
      pub("GLOBO REDONDO FASHION LATTE", "/products/globo-para-fiesta-latex-redondo-fashion-latte", "R-12", "073", { cantidades: { "R-12": 12 } }),
      pub("GLOBO REDONDO SILK GRIS MEDIANOCHE", "/products/globo-latex-redondo-silk-gris-medianoche", "R-12", "880", { cantidades: { "R-12": 12, "R-18": 2 } }),
      pub("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870", { cantidades: { "R-5": 12 } }),
      pub("GLOBO REDONDO FASHION NARANJA COBRIZO", "/products/globo-latex-redondo-fashion-naranja-cobrizo", "R-12", "062", { cantidades: { "R-12": 12 } }),
      deMateriales("R-9", "080", 1),
      deMateriales("T-260", "080", 3),
      { ...pub("GLOBO INFINITY® ARAÑA METALINK", "/products/globo-para-fiesta-latex-redondo-infinity-arana-metalink-fashion-negro", "R-12", null, { cantidades: { "R-12": 1 } }) },
    ]),
];
