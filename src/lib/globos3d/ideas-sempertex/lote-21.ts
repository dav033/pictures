import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { sumarMateriales } from "../mezcla";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { ElementoEscenografia } from "../escenografia";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion } from "../figuras";
import type { Vec3 } from "../modulos";
import type { PatronColumna } from "../columnas";
import type { OpcionesMetalizado } from "../metalizados";
import { centroCuerpo } from "../geometria";
import type { Accesorio, PropiedadesFigura, SegmentoCuerpo } from "../figuras-tubito";
import type { ParteTubito } from "../halloween";
import type { PropiedadesRizo } from "../rizos";
import type { InteriorBurbuja } from "../burbujas";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { ColorOrganico, PuntoMezcla } from "../organico";
import type { OpcionesForma } from "../formas";
import type { OpcionesMural } from "../murales";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 21** (los números de `clasif/lote-21.json`): la flor navideña
 * de pared (#604), la columna de fútbol (#616), el globo cristal relleno (#635), la lámpara navideña colgante (#686), el
 * lápiz escolar (#687), el ramo de los Minions (#700), la malla «Es una niña» (#706), la máquina de dulces (#720), el
 * centro de mesa marino con peces payaso (#721), el marco para fotos de San Valentín (#725), la torre de boda (#741), la
 * guirnalda orgánica Silk (#746), el móvil de niña (#761) y los murales «2014» (#768) y animal print (#769).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, recortada, ampliada con rejilla de
 * píxeles y medida (perfiles, manchas de color y autocorrelación del paso de los murales):
 * - **Escala**: la de algo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 22 cm, R-12 ≈ 28 cm, R-18 ≈ 42 cm,
 *   R-24 ≈ 55 cm; un metalizado de 18" ≈ 45 cm); cada escena dice la suya. Las posiciones se escriben en el mundo con
 *   `foto(eje, piso, px/cm)`: x a la derecha del eje de la pieza, y desde el piso (o desde el techo, en lo colgante).
 * - **Conteo**: lo que se ve, uno a uno, y lo que la técnica obliga detrás (el cuarto globo de un cuarteto, la otra mitad
 *   de un aro); los niveles de las columnas, contados. Ninguna idea del lote publica «Materiales» con cantidades: todo lo
 *   contado va `contada: true`. En lo orgánico (#725, #741, #746) el motor da los globos del grosor y el largo medidos
 *   (no se cuentan uno a uno: la nota lo dice). Los murales (#768, #769) se cuentan celda a celda.
 * - **Colores**: si la idea publica productos, ESOS códigos (#616, #725, #746). Si no, medidos en la foto (Python/PIL:
 *   mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial) y el código más cercano que se
 *   fabrica en ese formato (un Fashion si queda a ≤ 6 ΔE del mejor). Las fotos viejas (740 × 570) vienen
 *   sobresaturadas: la nota lo dice cuando pesa.
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando la idea lo publica (el balón de #616); si no, el más
 *   parecido del catálogo y la nota lo dice (Graffiti Invierno rojo, Estrellas cristal, Polka rojo, «Es una niña»,
 *   Confetti dorado). Lo que la tienda no tiene (la carita sonriente, el corazón «Happy Valentine's Day», el animal print
 *   rosado, el letrero del tubito) va liso o genérico, sin producto.
 * - **Montaje** (como los lotes 19 y 20): la estructura principal es el nodo raíz (suelta) y de ella cuelga su
 *   **amarre**, un cilindro de 1 cm con `oculto: true` (sostiene y da su marco, pero no se dibuja ni sale en la lista)
 *   puesto en el piso lejos de sus globos; de él cuelga todo lo demás, en el sitio exacto de la foto. Los murales sin
 *   nada colgado (#768, #769) van solos. El ramo de los Minions (#700), sin estructura, lleva de raíz su peso (lote 20).
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
/** Hacia fuera en el plano del piso: 0° = al frente (+z), 90° = a la derecha de quien mira (+x). */
const fuera = (grados: number): Vec3 => v(r2(Math.sin(rad(grados))), 0, r2(Math.cos(rad(grados))));
/** Dirección hacia fuera `grados` alrededor y levantada `elevacion` grados sobre el plano del piso. */
const haciaFuera = (grados: number, elevacion: number): Vec3 => unitario(mas(por(fuera(grados), Math.cos(rad(elevacion))), por(ARRIBA, Math.sin(rad(elevacion)))));
/** Un punto a `radio` del eje vertical, en el ángulo `grados` (0° al frente), a la altura `y`. */
const enAnillo = (grados: number, radio: number, y: number): Vec3 => mas(por(fuera(grados), radio), v(0, y, 0));
/** Un punto de un aro en el plano de la foto: `grados` desde la derecha de quien mira, contra reloj (90° = arriba). */
const enAro = (centro: Vec3, radio: number, grados: number): Vec3 => mas(centro, v(r2(radio * Math.cos(rad(grados))), r2(radio * Math.sin(rad(grados))), 0));
/** Del píxel de una foto al mundo: x desde el eje de la pieza, y desde el piso (la fila `piso`), a `pxPorCm`. */
const foto = (eje: number, piso: number, pxPorCm: number) => (x: number, y: number, z = 0): Vec3 => v(r2((x - eje) / pxPorCm), r2((piso - y) / pxPorCm), z);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const T = (formatoId: string, grosorCm: number, codigo: string): ParteTubito => ({ formatoId, grosorCm, codigo });
const sala = (anchoCm = 340, fondoCm = 300, altoCm = 260): Sala => ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm });

/** El giro sobre la normal que deja la cara (+z local) de la pieza lo más hacia quien mira (+z): lo impreso al frente. */
function giroAlFrente(normal: Vec3): number {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  return Math.round((Math.atan2(-xL.z, zL.z) * 180) / Math.PI);
}

/**
 * El marco de una pieza puesta `sobre` con la normal `n` (en el mundo): su +y local mira hacia la normal, su x local
 * queda horizontal (o a lo largo de x si la normal es vertical) y `giroGrados` la gira sobre la normal (el marco de
 * `escena.ts`, el mismo del lote 19). Devuelve cómo pasa un vector local al mundo.
 */
function marcoNormal(n0: Vec3, giroGrados = 0): (p: Vec3) => Vec3 {
  const n = unitario(n0);
  const aux = Math.abs(n.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
  const xL = unitario(cruz(aux, n));
  const zL = cruz(n, xL);
  const c = Math.cos(rad(giroGrados)), s = Math.sin(rad(giroGrados));
  return (p: Vec3) => {
    const x = p.x * c - p.z * s, z = p.x * s + p.z * c;
    return mas(mas(por(xL, x), por(n, p.y)), por(zL, z));
  };
}

/** Remuestrea una polilínea cerrada en `n` puntos a la misma distancia (por su largo), empezando por el primero. */
function repartirCerrado(puntos: ReadonlyArray<readonly [number, number]>, n: number): Array<readonly [number, number]> {
  const tramos = puntos.map((p, i) => { const q = puntos[(i + 1) % puntos.length]!; return { p, q, l: Math.hypot(q[0] - p[0], q[1] - p[1]) }; });
  const total = tramos.reduce((s, t) => s + t.l, 0);
  const salida: Array<readonly [number, number]> = [];
  for (let k = 0; k < n; k++) {
    let d = (total * k) / n;
    for (const t of tramos) {
      if (d <= t.l || t === tramos[tramos.length - 1]) { const f = t.l ? Math.min(1, d / t.l) : 0; salida.push([r2(t.p[0] + (t.q[0] - t.p[0]) * f), r2(t.p[1] + (t.q[1] - t.p[1]) * f)]); break; }
      d -= t.l;
    }
  }
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Piezas sueltas
// ----------------------------------------------------------------------------------------------------------

/** Un nivel de cuarteto como columna de un nivel (`giro` 0: un hueco al frente; 45: un globo al frente). */
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color", impresos?: ImpresoEnPieza[]): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) });
/** Lo más bajo de un cuarteto bajo su centro: un nivel apoyado en el piso no puede ir más bajo. */
const bajoCuarteto = (g: ParteGlobo) => -armarPieza(cuarteto(g, [g.codigo])).caja.min.y;

const deco = (decoracion: Decoracion, impresos?: ImpresoEnPieza[]): Pieza => ({ tipo: "decoracion", decoracion, ...(impresos?.length ? { impresos } : {}) });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });
const figura = (p: Partial<PropiedadesFigura> & { queEs: string }): Decoracion => ({
  tipo: "figura",
  propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, accesorios: [], ...p },
});
const burbuja = (exterior: ParteGlobo, interiores: InteriorBurbuja[], semilla: number): Decoracion =>
  ({ tipo: "burbuja", propiedades: { exterior, interiores, relleno: null, semilla } });
const florTubito = (petalos: AnilloTubito, centro: ParteGlobo | null): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { petalos, interior: null, corona: null, centro } });

/**
 * Un tubito de frente que sigue líneas quebradas y arcos (marcos, chupetes): una figura vacía con cadenas de burbujas.
 * Las coordenadas van como las ve quien mira la foto (cm: a su derecha, arriba); como una pieza `sobre` queda en espejo
 * (el marco de un ancla es de mano izquierda), aquí se reflejan para que se vea como en la foto (lotes 17 y 20).
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

// Orgánico (como el lote 19).
const colorOrg = (codigo: string, peso: number): ColorOrganico => ({ codigo, peso });
const constante = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];
/** Un racimo orgánico (tramo de guirnalda) por unos puntos, con su grosor, su mezcla de tamaños, sus inflados y sus colores. */
function racimos(o: { puntos: Vec3[]; radio: number; mezcla: Readonly<Record<string, number>>; colores: ColorOrganico[]; semilla: number; inflados: Readonly<Record<string, number>> }): Pieza {
  const libres: RacimoLibre[] = [{ id: "racimo_1", nombre: "Racimo 1", puntos: o.puntos.map(redondo), radioInicioCm: o.radio, radioFinCm: o.radio, mezcla: constante(o.mezcla), tapas: { inicio: true, fin: true } }];
  const opciones = opcionesRacimosLibres({ racimos: libres, colores: o.colores, semilla: o.semilla, suelo: false, relleno: [] });
  return { tipo: "organico", opciones: { ...opciones, inflados: { ...o.inflados } }, flores: null };
}

// ----------------------------------------------------------------------------------------------------------
// Montaje: la estructura principal como raíz, su amarre oculto y lo que cuelga del amarre
// ----------------------------------------------------------------------------------------------------------

/** Lo que se hunde una pieza `sobre` otra (`HUNDIMIENTO_SOBRE_CM` de la escena). */
const HUNDIDO = 1.5;
/** Amarre con normal hacia arriba y giro −90°: su marco local es el del mundo con x al revés. */
const GIRO_AMARRE = -90;

/** Alto bajo el origen de una pieza armada (−min.y de su caja): lo que la escena corre al apoyarla `sobre` algo sin globos. */
const bajoOrigen = (pieza: Pieza): number => -armarPieza(pieza).caja.min.y;

type Montaje = {
  nodos: NodoEscena[];
  /** Una pieza con su origen en `origen` (mundo), su +y local hacia `normal` y girada `giroGrados` sobre ella. */
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Lo mismo con el centro de su caja en `centro` (mundo). */
  centrada: (id: string, nombre: string, pieza: Pieza, centro: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro del cuerpo en `centro`, hacia `direccion` (con su impreso de la tienda, al frente). */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un globo de helio (como `globo`): su nudo queda anotado para las cintas. */
  helio: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un metalizado de pie y de frente con el centro en `centro` (su base anotada para las cintas si `conCinta`). */
  foil: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3, conCinta?: boolean) => void;
  /** Un nivel de cuarteto con su centro en `centro`, girado `giroGrados` (0° = un hueco al frente; 45° = un globo al frente). */
  nivel: (id: string, nombre: string, pieza: Pieza, centro: Vec3, giroGrados: number) => void;
  /** Una decoración con su origen en `origen`, mirando hacia `normal` (su +y local) y girada `giroGrados`. */
  deco: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados?: number) => void;
  /** Unos trazos de tubito con su punto (0, 0) en `origen`, en el plano vertical de frente: su «arriba» es el del mundo. */
  trazo: (id: string, nombre: string, t: ParteTubito, partes: readonly TrazoFrente[], origen: Vec3, queEs: string) => void;
  /** Las cintas de los globos de helio anotados, desde `amarre` (mundo), y los tramos que cuelgan (`colgando`). */
  cintas: (amarre: Vec3, hex: string, nombre: string, colgando?: ReadonlyArray<readonly [Vec3, Vec3]>) => void;
  escena: (s: Sala) => Escena;
};

/** Una cinta (escenografía: no cotiza) de `desde` a `hasta`, en el mundo. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado: "satinado", en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

/**
 * Arma el montaje: `raiz` suelta con su origen en `origen` (mundo), girada `giroGrados` sobre la vertical; su amarre (un
 * cilindro de 1 cm oculto: sostiene y da su marco, pero no se dibuja) va `sobre` ella con la base en `amarreEn` (mundo, en
 * el piso y lejos de sus globos: ninguno encima ni debajo), así la escena no lo corre y queda donde se pide. Lo demás
 * cuelga del amarre, en el sitio exacto de la foto.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; origen: Vec3; giroGrados?: number }, amarreEn: Vec3): Montaje {
  const g = raiz.giroGrados ?? 0;
  const nodos: NodoEscena[] = [{ id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: { en: "libre", xCm: r2(raiz.origen.x), yCm: r2(raiz.origen.y), zCm: r2(raiz.origen.z), giroGrados: g } }];
  // El punto del amarre, del mundo al espacio de la raíz: deshacer su giro sobre y (el marco de lo puesto `sobre` con la
  // normal arriba no hereda el giro de la raíz).
  const d = mas(menos(amarreEn, raiz.origen), v(0, HUNDIDO, 0));
  const c = Math.cos(rad(g)), s = Math.sin(rad(g));
  nodos.push({
    id: "amarre", nombre: `Amarre de ${raiz.nombre.charAt(0).toLowerCase()}${raiz.nombre.slice(1)} (oculto: no se ve)`,
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 0.3, altoCm: 1, hex: "#d9d9d9", acabado: "mate", oculto: true }] },
    colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(v(d.x * c - d.z * s, d.y, d.x * s + d.z * c)), normal: ARRIBA, giroGrados: GIRO_AMARRE },
  });
  const O = amarreEn;
  const aAmarre = (p: Vec3): Vec3 => redondo(v(-(p.x - O.x), p.y - O.y, p.z - O.z));
  const dirAAmarre = (q: Vec3): Vec3 => redondo(v(-q.x, q.y, q.z));
  const nudos: Vec3[] = [];
  const pieza = (id: string, nombre: string, p: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    const punto = menos(origen, por(n, bajoOrigen(p) - HUNDIDO));
    nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: "amarre", puntoCm: aAmarre(punto), normal: dirAAmarre(n), giroGrados: r2(giroGrados) } });
  };
  const centrada = (id: string, nombre: string, p: Pieza, centro: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const caja = armarPieza(p).caja;
    const medio = por(mas(caja.min, caja.max), 0.5);
    pieza(id, nombre, p, menos(centro, marcoNormal(normal, giroGrados)(medio)), normal, giroGrados);
  };
  const globo = (id: string, nombre: string, gl: ParteGlobo, centro: Vec3, direccion: Vec3 = ARRIBA, impresoId?: string) => {
    const p: Pieza = { tipo: "globo", formatoId: gl.formatoId, infladoCm: gl.infladoCm, codigo: gl.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
    pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
  };
  const deco = (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados = 0) => pieza(id, nombre, { tipo: "decoracion", decoracion }, origen, normal, giroGrados);
  return {
    nodos, pieza, centrada, globo, deco,
    helio: (id, nombre, gl, centro, direccion = ARRIBA, impresoId) => {
      globo(id, nombre, gl, centro, direccion, impresoId);
      nudos.push(menos(centro, por(unitario(direccion), centroCuerpo("redondo", gl.infladoCm))));
    },
    foil: (id, nombre, m, centro, conCinta = true) => {
      const p: Pieza = { tipo: "metalizado", metalizado: m };
      const caja = armarPieza(p).caja;
      const base = v(centro.x, r2(centro.y - (caja.max.y - caja.min.y) / 2), centro.z);
      // Normal arriba y el giro del amarre: el panel queda de frente y sin espejo (lote 20).
      pieza(id, nombre, p, base, ARRIBA, GIRO_AMARRE);
      if (conCinta) nudos.push(base);
    },
    nivel: (id, nombre, p, centro, giroGrados) => pieza(id, nombre, p, centro, ARRIBA, GIRO_AMARRE - giroGrados),
    trazo: (id, nombre, t, partes, origen, queEs) => {
      const p: Pieza = { tipo: "decoracion", decoracion: trazos(t, partes, queEs) };
      // La figura se apoya en z = 0 (su arriba, con la normal al frente, es el del mundo): su (0, 0) sube lo que bajaba
      // el punto más bajo, más medio grosor.
      pieza(id, nombre, p, menos(origen, v(0, subidaDeTrazos(t, partes), 0)), AL_FRENTE);
    },
    cintas: (amarre, hex, nombre, colgando = []) => {
      const lista = [...nudos.map((n) => cinta(amarre, n, hex)), ...colgando.map(([a, b]) => cinta(a, b, hex))];
      if (!lista.length) return;
      const p: Pieza = { tipo: "escenografia", elementos: lista.map((e) => (e.en ? { ...e, en: { origen: aAmarre(e.en.origen), ejeX: dirAAmarre(e.en.ejeX), ejeY: dirAAmarre(e.en.ejeY) } } : e)) };
      nodos.push({ id: "cintas", nombre, pieza: p, colocacion: { en: "sobre", padreId: "amarre", puntoCm: v(0, r2(-bajoOrigen(p) + HUNDIDO), 0), normal: ARRIBA, giroGrados: GIRO_AMARRE } });
    },
    escena: (s) => ({ sala: s, nodos }),
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
  for (const m of sumarMateriales(armada.materiales)) {
    const cantidad = Math.ceil(m.cantidad - 1e-9) - (restar.get(`${m.formatoId}|${m.codigo}`) ?? 0);
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
 * vive en `index.ts` (que importa este lote): se calculan al leerlas, como en los lotes 17 a 20.
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

// Impresos de la tienda que usa el lote (ids de `impresos-catalogo.ts`).
const GRAFFITI_ROJO = "infinity-graffiti-invierno-fashion-rojo";
const BALON = "infinity-balon-de-futbol-fashion-blanco";
const ESTRELLAS_CRISTAL = "infinity-estrellas-fashion-transparente";
const POLKA_ROJO = "infinity-polka-blanco-fashion-rojo";
const ES_UNA_NINA = "infinity-es-una-nina-estrella-pastel-mate-rosado";
const CONFETTI_DORADO = "infinity-confetti-dorado-fashion-transparente";
/** Que un impreso del lote esté en el catálogo (si no, el error sale al cargar, no en la tienda). */
for (const id of [GRAFFITI_ROJO, BALON, ESTRELLAS_CRISTAL, POLKA_ROJO, ES_UNA_NINA, CONFETTI_DORADO]) if (!impresoPorId(id)) throw new Error(`Impreso desconocido: ${id}`);

const CINTA_BLANCA = "#f1f1ef";
const CINTA_ROSADA = "#f29ac0";

// ----------------------------------------------------------------------------------------------------------
// 604 · Flor navideña
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los 5 pétalos R-12 rojos impresos miden ~125 px (27 cm): 4,63 px/cm, con el centro de la flor en
 * (400, 300) px. Pétalos a 333°, 50°, 127°, 210° y 273° (de reloj, desde arriba), corona de 6 R-5 verdes (~60 px: 12,5
 * cm) y centro R-5 rojo (~45 px: 9,5 cm). Entre pétalo y pétalo sale un resorte de T-260 verde (~22 px de grueso: 4,7
 * cm), 5 en total, de ~2,5 vueltas y ~33 cm de largo, de los bordes de la flor hacia fuera. Medidos: verde #027c3e →
 * Fashion Verde Selva 032 (ΔE 4,5; la corona, #006a4e, igual de cerca del Reflex Verde Aurora); centro #c32a27 → Fashion
 * Rojo 015 (ΔE 13; el Metal Rojo queda a 8); pétalos #fa2f37 → Fashion Rojo 015, con el impreso de grafitis blancos de
 * invierno (bastones, copos y regalitos): el «Graffiti Invierno» rojo de la tienda.
 */
const escena604 = (): Escena => {
  const K = 4.63, Z = -100, ALTO = 150;
  const f = (x: number, y: number, z = Z) => v(r2((x - 400) / K), r2(ALTO + (300 - y) / K), z);
  const ROJO = "015", VERDE = "032";
  const propiedades: PropiedadesFlor = {
    petalos: { ...R("R-12", 27, ROJO), cantidad: 5, aperturaGrados: 0, giroGrados: 27 },
    corona: { ...R("R-5", 12.5, VERDE), cantidad: 6 },
    centro: { ...R("R-5", 9.5, ROJO), cantidad: 1 },
  };
  const m = montaje(
    { id: "flor", nombre: "Flor navideña: 5 R-12 rojos Graffiti Invierno, corona de 6 R-5 verde selva y centro R-5 rojo", pieza: deco(flor(propiedades), [{ impresoId: GRAFFITI_ROJO, globos: [0, 1, 2, 3, 4] }]), origen: v(0, ALTO, Z) },
    v(0, 0, Z + 70),
  );
  // Los resortes: de cada hueco entre pétalos hacia fuera (inicio y punta medidos en la foto).
  const resortes: ReadonlyArray<readonly [number, number, number, number]> = [
    [395, 180, 470, 50], [525, 285, 640, 335], [440, 430, 475, 545], [275, 375, 175, 470], [275, 250, 165, 160],
  ];
  resortes.forEach(([x0, y0, x1, y1], k) => {
    const a = f(x0, y0, Z - 4), b = f(x1, y1, Z - 4);
    m.deco(`resorte-${k + 1}`, `Resorte de T-260 verde selva ${k + 1}`, rizo({ forma: "resorte", tubito: T("T-260", 4.7, VERDE), vueltas: 2.5, radioCm: 7, largoCm: r2(largo(menos(b, a))), eje: "frente" }), a, unitario(menos(b, a)));
  });
  return m.escena(sala(300, 260, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 616 · Fútbol arreglo
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el balón grande de arriba mide ~140 px y los cuatro de la base ~65 px: con el R-24 a 54 cm, 2,6
 * px/cm (los de la base, R-12 a 25 cm; los negros, ~27 px: R-5 a 10,5 cm), con el piso en y = 555 px y el eje en x =
 * 370. De abajo arriba: base de 4 R-12 balón (se ven 2 delante y 2 detrás: un hueco al frente), y luego, alternados, 4
 * uniones de un cuarteto R-5 negro (a 29,5, 67, 109 y 150 cm; se ven 3: un globo al frente) y 3 Link-O-Loon cristal con
 * un balón R-12 dentro (globo dentro de globo; centros a 44, 86,5 y 127 cm; ~80 px: LOL a 28 cm), y arriba el R-24
 * balón (centro a 183 cm): ~2,1 m. En cada unión, un moño de flecos de tubito amarillo; de la 2.ª, 3.ª y 4.ª unión sale un
 * rizo de T-260 blanco con una estrellita dorada de burbujas en la punta (~40 px: 15 cm). Productos: los publicados
 * (balón de fútbol, Fashion Negro, Link-O-Loon Cristal Transparente). Medidos los que no publica: amarillo #eee863 → Neón
 * Amarillo 220 (ΔE 11), que la tienda no vende en tubito: va el Fashion Amarillo 020 (ΔE 25); estrellas #dcb055 → Metal
 * Dorado 570 (ΔE 2); rizos blancos 005.
 */
const escena616 = (): Escena => {
  const K = 2.6;
  const f = foto(370, 555, K);
  const BLANCO = "005", NEGRO = "080", AMARILLO = "020", DORADO = "570";
  const base = R("R-12", 25, BLANCO);
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-12 Balón de fútbol", pieza: cuarteto(base, [BLANCO], "un_color", [{ impresoId: BALON, codigo: BLANCO }]), origen: v(0, r2(Math.max(f(370, 520).y, bajoCuarteto(base))), 0) },
    v(0, 0, -50),
  );
  const uniones = [478, 380, 272, 165];
  uniones.forEach((py, k) => {
    m.nivel(`union-${k + 1}`, `Unión ${k + 1}: cuarteto R-5 Fashion Negro`, cuarteto(R("R-5", 10.5, NEGRO), [NEGRO]), f(370, py), 45);
    m.deco(`flecos-${k + 1}`, `Flecos de tubito Fashion Amarillo de la unión ${k + 1}`, { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 3, codigo: AMARILLO, lazosPorLado: 1, largoLazoCm: 9, anchoLazoCm: 5, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: null } }, f(370, py, 7), AL_FRENTE);
  });
  // Los Link-O-Loon cristal con su balón dentro: la burbuja con el nudo abajo (el origen), el cuerpo hacia arriba.
  const LOL = R("LOL-12", 28, "390");
  [440, 330, 225].forEach((py, k) => {
    const centro = f(370, py);
    m.pieza(`balon-en-lol-${k + 1}`, `Link-O-Loon Cristal con un R-12 Balón dentro ${k + 1}`, deco(burbuja(LOL, [{ formatoId: "R-12", infladoCm: 24, codigos: [BLANCO], cantidad: 1 }], 616 + k), [{ impresoId: BALON, globos: [1] }]), menos(centro, v(0, r2(centroCuerpo("redondo", LOL.infladoCm)), 0)), AL_FRENTE);
  });
  m.globo("balon-grande", "R-24 Balón de fútbol de remate", R("R-24", 54, BLANCO), f(370, 80), ARRIBA, BALON);
  // Rizos blancos de la 2.ª, 3.ª y 4.ª unión con su estrellita dorada (de la unión a la estrella, medidos en la foto).
  const rizos: ReadonlyArray<readonly [number, number, number, number]> = [[392, 275, 432, 305], [348, 372, 307, 382], [388, 470, 400, 462]];
  rizos.forEach(([x0, y0, x1, y1], k) => {
    const a = f(x0, y0, 6), b = f(x1, y1, 8);
    m.deco(`rizo-${k + 1}`, `Rizo de T-260 blanco ${k + 1}`, rizo({ forma: "tirabuzon", tubito: T("T-260", 3.5, BLANCO), vueltas: 1.5, radioInicialCm: 3.5, radioFinalCm: 4.5, largoCm: r2(Math.max(8, largo(menos(b, a)))), eje: "frente" }), a, unitario(menos(b, a)));
    m.deco(`estrella-${k + 1}`, `Estrellita de burbujas de T-260 Metal Dorado ${k + 1}`, rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3, codigos: [DORADO], largosCm: [3], recorrido: "estrella", cantidad: 10, puntas: 5, radioCm: 7, radioInteriorCm: 3.5 }), v(b.x, b.y, 9), AL_FRENTE);
  });
  return m.escena(sala(280, 240, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 635 · Globos cristal
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el globo de estrellas mide ~245 px de ancho: R-24 a 55 cm → 4,45 px/cm, con el piso en y = 555 px y
 * el eje en x = 368. Va boca arriba (el nudo arriba, a 66 cm): relleno de R-5 (~50 px: 11 cm) de colores amontonados
 * abajo (se ven 9; aquí 12 en tres capas de 3, 6 y 3), con un anillo de 8 R-5 rosados alrededor del cuello (se ven 5; a
 * 71 cm) y encima un cuarteto de R-12 perla (~125 px: 28 cm; dos al frente, a 91 cm) con una ramita de flores. Medidos
 * (no publica productos): cristal con estrellas blancas → el «Estrellas» cristal de la tienda (se vende en R-24); perla
 * #dcd5cf → Silk Perla Crema 873 (ΔE 3); anillo #d993a6 → Satín Rosado 409 (ΔE 8); dentro: blanco #e2dcde → Silk Blanco
 * Nácar 806, azul #c7d4df → Satín Azul 440, rosa pálido #fbe3e6 → Pastel Mate Rosado 609, rosa #f883b6 → Satín Fucsia
 * 412, lila #d890c3 → Satín Lila 450 y fresa #ef5c78 → Fashion Frambuesa 014.
 */
const escena635 = (): Escena => {
  const K = 4.45;
  const f = foto(368, 555, K);
  const PERLA = R("R-12", 28, "873");
  const m = montaje(
    { id: "cuarteto", nombre: "Cuarteto R-12 Silk Perla Crema de arriba", pieza: cuarteto(PERLA, ["873"]), origen: f(368, 150) },
    v(0, 0, -50),
  );
  m.globo("cristal", "R-24 Cristal «Estrellas» relleno, boca arriba", R("R-24", 55, "390"), v(0, 30, 0), ABAJO, ESTRELLAS_CRISTAL);
  // El relleno: 12 R-5 de 11 cm en tres capas dentro del cuerpo (centro a 30 cm, ~26 cm de radio por dentro).
  const colores = ["806", "440", "609", "412", "450", "014"];
  const capas: ReadonlyArray<readonly [number, number, number, number]> = [[3, 6.2, 7, 90], [6, 13, 16, 30], [3, 12, 25.5, 0]];
  let k = 0;
  for (const [n, radio, y, desde] of capas) {
    for (let i = 0; i < n; i++, k++) {
      const a = desde + (360 * i) / n;
      m.globo(`relleno-${k + 1}`, `R-5 del relleno ${k + 1}`, R("R-5", 11, colores[k % colores.length]!), enAnillo(a, radio, y), haciaFuera(a, y < 10 ? -40 : 25));
    }
  }
  m.deco("anillo", "Anillo de 8 R-5 Satín Rosado en el cuello", flor({ petalos: { ...R("R-5", 12, "409"), cantidad: 8, aperturaGrados: 0, giroGrados: 0 }, centro: null }), f(368, 240), ARRIBA);
  return m.escena(sala(260, 240, 220));
};

// ----------------------------------------------------------------------------------------------------------
// 686 · Lámpara navideña
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los R-12 verdes de la base miden ~65–70 px (28 cm): 2,4 px/cm, con el eje en x = 378; cuelga del
 * techo por la cadena (arriba, y = 15 px). Cono de anillos de R-12 verdes que se achican (de 28 a ~18 cm; ~1,17 m de
 * ancho abajo, 10 globos por anillo, se ven 4–5) con R-5 verdes (~25 px: 10 cm) en los huecos, rematado por un R-5
 * verde; cuelga de una cadena de 5 R-5 rojos (~30 px: 12,5 cm). Debajo, un cuarteto de R-12 rojos de lunares blancos
 * (se ven 3: un globo al frente) y un R-5 dorado en la punta. Medidos (no publica productos): verde #017e5b → Fashion
 * Verde Selva 032 (ΔE 11; en lo iluminado mide Fashion Verde 030); rojo de la cadena #fa3f4e → Fashion Rojo 015; los de
 * lunares, el «Polka Blanco» rojo de la tienda; el R-5 de la punta apenas asoma (~10 px): dorado → Metal Dorado 570.
 */
const escena686 = (): Escena => {
  const K = 2.4, ALTO = 260;
  const f = foto(378, 15 + ALTO * K, K);
  const VERDE = "032", ROJO = "015";
  const cono: OpcionesForma = {
    clase: "cono", altoCm: 116, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 28, infladoPuntaCm: 18, globosBase: 10, globosPunta: 4,
    colores: { codigos: [VERDE], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 10, codigos: [VERDE] }, remate: { formatoId: "R-5", infladoCm: 11, codigo: VERDE },
  };
  const m = montaje({ id: "cono", nombre: "Lámpara: cono de anillos de R-12 Verde Selva con R-5 en los huecos", pieza: { tipo: "forma", forma: cono }, origen: v(0, f(378, 505).y, 0) }, v(0, 0, -90));
  [35, 78, 120, 163, 206].forEach((py, k) => m.globo(`cadena-${k + 1}`, `R-5 Fashion Rojo de la cadena ${k + 1}`, R("R-5", 12.5, ROJO), f(378, py), ABAJO));
  m.nivel("lunares", "Cuarteto R-12 rojo Polka Blanco bajo el cono", cuarteto(R("R-12", 28, ROJO), [ROJO], "un_color", [{ impresoId: POLKA_ROJO, codigo: ROJO }]), f(378, 530), 45);
  m.globo("punta", "R-5 Metal Dorado de la punta", R("R-5", 8, "570"), f(378, 566), ABAJO);
  return m.escena(sala(300, 260, ALTO));
};

// ----------------------------------------------------------------------------------------------------------
// 687 · Lápiz escolar
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el cuerpo amarillo mide 160 px de ancho con globos de ~58 px: R-12 a 22 cm → 2,64 px/cm, con el eje en
 * x = 370. La punta negra (y = 545 px) va a 15 cm del piso (la foto no muestra cómo se sostiene). De abajo arriba: la
 * mina de 3 cuartetos R-5 negros que se achican (12,5, 11 y 9,5 cm) y un R-5 de punta; la madera de 3 cuartetos R-9
 * durazno (15, 17 y 19 cm); el cuerpo de 5 cuartetos R-12 amarillos (a 85, 100, 116,5, 133 y 149,5 cm: 16 cm por nivel,
 * con tres y dos globos al frente alternados); el anillo de un cuarteto R-9 perlado (~50 px: 19 cm, a 176 cm) y el
 * borrador, un R-18 rosado (~120 px: 44 cm; en la foto se ve achatado, 45 × 32 cm). Medidos (no publica productos):
 * amarillo #f7e601 → Fashion Amarillo 020 (ΔE 1); madera #f2b063 → Fashion Durazno 060 (ΔE 24: la foto está
 * sobresaturada; el Metal Dorado mide 10 pero no es madera); mina #010100 → Fashion Negro 080; anillo #d2c0ad → Fashion
 * Arena 071 (ΔE 7; brilla como perla); borrador #feb1b4 → Fashion Rosado 009 (ΔE 11).
 */
const escena687 = (): Escena => {
  const K = 2.64;
  const f = foto(370, 545 + 15 * K, K);
  const AMARILLO = R("R-12", 22, "020");
  const cuerpo: ReadonlyArray<readonly [number, number]> = [[330, 45], [290, 0], [247, 45], [203, 0], [160, 45]];
  const m = montaje(
    { id: "cuerpo-1", nombre: "Cuerpo del lápiz: cuarteto R-12 Fashion Amarillo 1", pieza: cuarteto(AMARILLO, ["020"]), origen: f(370, cuerpo[0]![0]), giroGrados: cuerpo[0]![1] },
    v(0, 0, -45),
  );
  cuerpo.slice(1).forEach(([py, giro], k) => m.nivel(`cuerpo-${k + 2}`, `Cuerpo del lápiz: cuarteto R-12 Fashion Amarillo ${k + 2}`, cuarteto(AMARILLO, ["020"]), f(370, py), giro));
  const madera: ReadonlyArray<readonly [number, number, number]> = [[375, 19, 0], [410, 17, 45], [440, 15, 0]];
  madera.forEach(([py, d, giro], k) => m.nivel(`madera-${k + 1}`, `Madera: cuarteto R-9 Fashion Durazno ${k + 1}`, cuarteto(R("R-9", d, "060"), ["060"]), f(370, py), giro));
  const mina: ReadonlyArray<readonly [number, number, number]> = [[470, 12.5, 45], [500, 11, 0], [525, 9.5, 45]];
  mina.forEach(([py, d, giro], k) => m.nivel(`mina-${k + 1}`, `Mina: cuarteto R-5 Fashion Negro ${k + 1}`, cuarteto(R("R-5", d, "080"), ["080"]), f(370, py), giro));
  m.globo("punta", "Punta de la mina: R-5 Fashion Negro", R("R-5", 8, "080"), f(370, 538), ABAJO);
  m.nivel("anillo", "Anillo: cuarteto R-9 Fashion Arena", cuarteto(R("R-9", 19, "071"), ["071"]), f(370, 120), 45);
  m.globo("borrador", "Borrador: R-18 Fashion Rosado", R("R-18", 42, "009"), f(370, 60), ARRIBA);
  return m.escena(sala(240, 220, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 700 · Los Minnions
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (vertical, de una fiesta real): sobre la mesa de cupcakes, un ramo de helio de 4 R-12 (dos violeta, uno
 * azul rey y uno amarillo que asoma detrás) amarrado entre los Minions de juguete. No hay nada de tamaño conocido salvo los
 * cupcakes (~6–7 cm): los R-12 van a 28 cm y el ramo, de 1,5 a 2 m de alto sobre la mesa de 75 cm, en el orden de la
 * foto (violeta a la izquierda, violeta arriba al centro, azul rey a la derecha, amarillo detrás). Medidos (no publica
 * productos): violeta #4b0066 → Fashion Violeta 051 (ΔE 14); azul #005ada → Fashion Azul Rey 041 (ΔE 30: la foto está muy
 * sobresaturada); amarillo #fecd00 → Fashion Amarillo Miel 021 (ΔE 4).
 */
const escena700 = (): Escena => {
  const MESA = 75;
  const PESO = v(0, MESA, -12);
  const m = montaje(
    { id: "peso", nombre: "Peso del ramo (sobre la mesa)", pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 4, altoCm: 5, hex: "#7a3a96", acabado: "satinado" }] }, origen: PESO },
    v(0, 0, -70),
  );
  const nudo = mas(PESO, v(0, 5, 0));
  const sube = (c: Vec3) => unitario(mas(por(unitario(menos(c, nudo)), 0.35), por(ARRIBA, 0.65)));
  const globos: ReadonlyArray<readonly [string, string, string, Vec3]> = [
    ["violeta-izquierda", "R-12 Fashion Violeta (izquierda)", "051", v(-42, 168, -10)],
    ["violeta-arriba", "R-12 Fashion Violeta (arriba, al centro)", "051", v(8, 196, -18)],
    ["azul-rey", "R-12 Fashion Azul Rey (derecha)", "041", v(40, 160, -4)],
    ["amarillo", "R-12 Fashion Amarillo Miel (detrás, asoma)", "021", v(-8, 176, -42)],
  ];
  for (const [id, nombre, c, centro] of globos) m.helio(id, nombre, R("R-12", 28, c), centro, sube(centro));
  m.cintas(nudo, CINTA_BLANCA, "Cintas del ramo");
  const s = sala(300, 260, 240);
  return {
    sala: s,
    nodos: [...m.nodos, { id: "mesa", nombre: "Mesa de los cupcakes (con mantel blanco)", pieza: { tipo: "escenografia", elementos: [{ forma: "caja", centro: v(0, MESA / 2, 0), tamano: v(150, MESA, 70), hex: "#f4f4f2", acabado: "tela" }] }, colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: -10, giroGrados: 0 } }],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 706 · Malla «Es una niña»
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los R-12 «Es una niña» miden ~45 px (22 cm), los blancos ~52 px (25 cm), los fucsia ~42 px (20 cm),
 * los lila chicos ~17 px (8 cm) y el marco son dos tubitos gruesos lado a lado (~13 px cada uno: T-360 a 6 cm): 2,1
 * px/cm, con el eje en x = 375. Fondo de 13 × 7 R-12 blancos (2,95 × 1,6 m, de 50 a 210 cm) y, delante, en los huecos
 * medidos: 8 R-12 «Es una niña», 12 R-9 fucsia y 22 R-5 lila; al centro, tres Link-O-Loon 660 (~30 px de grueso: 14 cm;
 * lila arriba y abajo, de 88 cm, y rosado en medio, de 117 cm, con un R-9 lila en cada punta). El marco: dos T-360
 * fucsia lado a lado en rectángulo de esquinas redondeadas (3,2 × 1,9 m), con 8 R-5 lila en las juntas y 10 florecitas
 * blancas de 4 burbujas de T-260 con su centro fucsia. Medidos (no publica productos): blanco 005 (en sombra mide rosado
 * pálido); fucsia #f2288c → Fashion Fucsia 012 (ΔE 17; Neón Fucsia y Fashion Rosa quedan 1–3 más cerca; el marco mide
 * 012 a 14); lila #b481bb → Fashion Lila 050 (ΔE 14; Satín Lila a 9,5); los centros rosados de puntos blancos → el «Es una
 * niña» de la tienda (Pastel Mate Rosado 609); los 660: lila #ce9ac9 → 050 y rosado #fbacce → Fashion Rosado 009.
 */
const escena706 = (): Escena => {
  const K = 2.1, BASE = 50, Z = -110;
  // Del píxel al mundo: el borde de abajo de los blancos (y = 460 px) es la base del mural (50 cm).
  const f = (x: number, y: number, z = Z) => v(r2((x - 375) / K), r2(BASE + (460 - y) / K), z);
  const COLS = 13, FILAS = 7, D = 25, PASO = D * 0.9;
  // De la foto a la celda del mural (columna, fila desde arriba), fraccionaria.
  const celda = (x: number, y: number): [number, number] => {
    const p = f(x, y);
    return [r2((COLS - 1) / 2 + p.x / PASO), r2(FILAS - 1 - (p.y - BASE - D / 2) / PASO)];
  };
  const impresos: Array<[number, number]> = [[155, 180], [155, 290], [155, 395], [375, 160], [375, 410], [590, 175], [590, 290], [590, 395]];
  const fucsias: Array<[number, number]> = [[269, 173], [488, 180], [120, 239], [224, 230], [534, 233], [634, 233], [114, 339], [231, 347], [530, 344], [634, 337], [484, 398], [273, 402]];
  const lilas: Array<[number, number]> = [[223, 174], [325, 168], [433, 172], [121, 187], [537, 179], [631, 185], [378, 219], [180, 236], [277, 225], [581, 237], [126, 288], [628, 287], [177, 340], [280, 348], [578, 337], [376, 355], [119, 389], [225, 399], [532, 392], [627, 385], [326, 406], [432, 401]];
  const mural: OpcionesMural = {
    disposicion: "simple", grande: { formatoId: "R-12", infladoCm: D }, chico: null,
    matriz: { colores: ["005"], filas: Array.from({ length: FILAS }, () => "a".repeat(COLS)) },
    encima: [
      { formatoId: "R-12", infladoCm: 22, codigo: "609", puntos: impresos.map(([x, y]) => celda(x, y)) },
      { formatoId: "R-9", infladoCm: 20, codigo: "012", puntos: fucsias.map(([x, y]) => celda(x, y)) },
      { formatoId: "R-5", infladoCm: 8.3, codigo: "050", puntos: lilas.map(([x, y]) => celda(x, y)) },
      { formatoId: "R-9", infladoCm: 14, codigo: "050", puntos: [celda(239, 291), celda(524, 289)] },
    ],
  };
  const m = montaje(
    { id: "malla", nombre: "Malla de 13 × 7 R-12 blancos con los centros «Es una niña», fucsia y lila", pieza: { tipo: "mural", mural, impresos: [{ impresoId: ES_UNA_NINA, codigo: "609" }] }, origen: v(0, BASE, Z) },
    v(0, 0, Z + 70),
  );
  // Las tres barras del centro, delante de la malla: el Link-O-Loon 660 rosado y, arriba y abajo, las lila (la tienda no
  // vende el 660 lila: cada una son dos T-260 Fashion Lila lado a lado, ~10 cm de grueso).
  const frente = Z + 26;
  const barra = (id: string, nombre: string, t: ParteTubito, x0: number, x1: number, y: number, comba: number) => {
    const a = f(x0, y, frente), b = f(x1, y, frente);
    const medio = (a.x + b.x) / 2;
    m.trazo(id, nombre, t, [{ tipo: "linea", puntos: [[a.x - medio, 0], [0, comba], [b.x - medio, 0]] }], v(r2(medio), a.y, frente), "a thick twisted balloon bar");
  };
  for (const [k, dy] of [[1, -1.2], [2, 1.2]] as const) {
    barra(`lila-arriba-${k}`, `Barra lila de arriba: T-260 Fashion Lila ${k}`, T("T-260", 5, "050"), 288, 470, 240 + dy * K, 3);
    barra(`lila-abajo-${k}`, `Barra lila de abajo: T-260 Fashion Lila ${k}`, T("T-260", 5, "050"), 288, 470, 340 + dy * K, -3);
  }
  barra("rosado", "Link-O-Loon 660 Fashion Rosado del centro (el «Es una niña» del tubito no está en la tienda)", T("LOL-660", 13.5, "009"), 258, 500, 290, 0);
  // El marco: dos T-360 fucsia lado a lado; cada lado, una cadena de burbujas largas (las esquinas, redondeadas).
  const izq = f(40, 0).x, der = f(706, 0).x, arriba = f(0, 92).y, abajo = f(0, 470).y, curva = 14;
  const lados: ReadonlyArray<readonly [string, string, ReadonlyArray<readonly [number, number]>]> = [
    ["marco-arriba", "arriba", [[izq, arriba - curva], [izq + 4, arriba - 4], [izq + curva, arriba], [f(272, 0).x, arriba], [f(491, 0).x, arriba], [der - curva, arriba], [der - 4, arriba - 4], [der, arriba - curva]]],
    ["marco-abajo", "abajo", [[izq, abajo + curva], [izq + 4, abajo + 4], [izq + curva, abajo], [f(270, 0).x, abajo], [f(487, 0).x, abajo], [der - curva, abajo], [der - 4, abajo + 4], [der, abajo + curva]]],
    ["marco-izquierda", "izquierda", [[izq, arriba - curva], [izq, abajo + curva]]],
    ["marco-derecha", "derecha", [[der, arriba - curva], [der, abajo + curva]]],
  ];
  for (const [id, lado, puntos] of lados) {
    for (const [k, dz] of [[1, 3], [2, -3]] as const) {
      const off = lado === "arriba" ? -3.2 * (k === 1 ? 1 : -1) : lado === "abajo" ? 3.2 * (k === 1 ? 1 : -1) : 0;
      const offX = lado === "izquierda" ? 3.2 * (k === 1 ? 1 : -1) : lado === "derecha" ? -3.2 * (k === 1 ? 1 : -1) : 0;
      const p = puntos.map(([x, y]): readonly [number, number] => [r2(x + offX), r2(y + off)]);
      const x0 = p[0]![0], y0 = p[0]![1];
      m.trazo(`${id}-${k}`, `Marco ${lado}: T-360 Fashion Fucsia ${k}`, T("T-360", 6, "012"), [{ tipo: "linea", puntos: p.map(([x, y]) => [r2(x - x0), r2(y - y0)] as const) }], v(x0, y0, Z + 6 + dz), "a fuchsia twisted-balloon frame");
    }
  }
  // Las juntas lila del marco y las florecitas blancas.
  const juntas: Array<[number, number]> = [[52, 147], [687, 149], [55, 428], [678, 424], [272, 98], [491, 98], [270, 466], [487, 466]];
  juntas.forEach(([x, y], k) => m.globo(`junta-${k + 1}`, `R-5 Fashion Lila de la junta ${k + 1} del marco`, R("R-5", 9, "050"), f(x, y, Z + 12), AL_FRENTE));
  const flores: Array<[number, number]> = [[155, 100], [385, 92], [596, 106], [159, 465], [377, 476], [583, 462], [49, 238], [49, 332], [689, 231], [690, 335]];
  const florecita = florTubito({ formatoId: "T-260", grosorCm: 4, codigos: ["005"], cantidad: 4, estilo: "burbuja", largoCm: 8, anchoCm: 4, aperturaGrados: 0, giroGrados: 45 }, R("R-5", 5.1, "012"));
  flores.forEach(([x, y], k) => m.deco(`flor-${k + 1}`, `Florecita de 4 burbujas de T-260 blanco ${k + 1}`, florecita, f(x, y, Z + 14), AL_FRENTE));
  return m.escena(sala(380, 260, 260));
};

// ----------------------------------------------------------------------------------------------------------
// 720 · Máquina de dulces
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el globo cristal mide ~205 px de ancho: R-24 a 50 cm → 4,1 px/cm, con el piso en y = 555 px y el eje
 * en x = 365. La base roja: dos cuartetos R-9 (14 cm, a 8 y 20 cm) y uno de 12 cm (a 31 cm) con 8 R-5 rojos chicos
 * (~35 px: 8,5 cm) en los huecos y el botón, un R-9 negro (~55 px: 13 cm) al frente; el cuello: dos cuartetos R-5 rojos
 * (10 cm, a 41,5 y 50 cm); el globo cristal con 8 «dulces» R-9 (~65 px: 15 cm; se ven 8) y la tapa: un cuarteto R-9 rojo
 * (a 114 cm) y uno R-5 (a 124 cm): ~1,3 m. Medidos (no publica productos): rojo #ca171d → Fashion Rojo 015 (ΔE 7); botón
 * negro 080; dentro: rosado #ffadba → Fashion Rosado 009 (ΔE 10), crema #fed896 → Fashion Durazno 060 (ΔE 18: se ve
 * amarillo pálido), verde claro #c0d4a1 y #99c889 → Fashion Eucalipto 027 (ΔE 17 y 19), fucsia #ff4a93 → Fashion Fucsia
 * 012, coral #ff6b63 → Fashion Frambuesa 014 (ΔE 21), azules #049dce y #088dc1 → Fashion Azul 040.
 */
const escena720 = (): Escena => {
  const K = 4.1;
  const f = foto(365, 555, K);
  const ROJO = "015";
  const R9 = R("R-9", 14, ROJO);
  const m = montaje({ id: "base", nombre: "Base: cuarteto R-9 Fashion Rojo de abajo", pieza: cuarteto(R9, [ROJO]), origen: v(0, r2(Math.max(8, bajoCuarteto(R9))), 0) }, v(0, 0, -50));
  m.nivel("base-2", "Base: cuarteto R-9 Fashion Rojo del medio", cuarteto(R9, [ROJO]), v(0, 20, 0), 0);
  m.nivel("base-3", "Base: cuarteto R-9 Fashion Rojo de arriba (12 cm)", cuarteto(R("R-9", 12, ROJO), [ROJO]), v(0, 31, 0), 45);
  [45, 135, 225, 315].forEach((a, k) => m.globo(`chico-abajo-${k + 1}`, `R-5 Fashion Rojo chico de la base (abajo ${k + 1})`, R("R-5", 8.5, ROJO), enAnillo(a, 19, 13), haciaFuera(a, 10)));
  [90, 180, 270, 0].forEach((a, k) => m.globo(`chico-arriba-${k + 1}`, `R-5 Fashion Rojo chico de la base (arriba ${k + 1})`, R("R-5", 8.5, ROJO), enAnillo(a, 15.5, 26), haciaFuera(a, 20)));
  m.globo("boton", "Botón: R-9 Fashion Negro", R("R-9", 13, "080"), v(0, 21, 13), AL_FRENTE);
  m.nivel("cuello-1", "Cuello: cuarteto R-5 Fashion Rojo 1", cuarteto(R("R-5", 10, ROJO), [ROJO]), f(365, 385), 0);
  m.nivel("cuello-2", "Cuello: cuarteto R-5 Fashion Rojo 2", cuarteto(R("R-5", 10, ROJO), [ROJO]), f(365, 350), 45);
  const dulces: InteriorBurbuja[] = [{ formatoId: "R-9", infladoCm: 15, codigos: ["009", "060", "027", "012", "014", "027", "040", "040"], cantidad: 8 }];
  m.deco("dulces", "Globo R-24 Cristal con 8 R-9 de colores dentro", burbuja(R("R-24", 50, "390"), dulces, 720), v(0, 53.5, 0), AL_FRENTE);
  m.nivel("tapa-1", "Tapa: cuarteto R-9 Fashion Rojo", cuarteto(R("R-9", 13, ROJO), [ROJO]), f(365, 88), 0);
  m.nivel("tapa-2", "Tapa: cuarteto R-5 Fashion Rojo", cuarteto(R("R-5", 10, ROJO), [ROJO]), f(365, 45), 45);
  return m.escena(sala(240, 220, 220));
};

// ----------------------------------------------------------------------------------------------------------
// 721 · Mar
// ----------------------------------------------------------------------------------------------------------

/** Un pez payaso de lado: cuerpo naranja con dos franjas blancas, cabeza con ojos, cola de abanico y aletas arriba y abajo. */
function pezPayaso(escala: number, queEs: string): Decoracion {
  const NARANJA = "061", BLANCO = "005";
  const g = (d: number, c: string) => R("R-5", r2(Math.max(5.1, d * escala)), c);
  const cuerpo: SegmentoCuerpo[] = [
    { tipo: "globo", globo: g(8, NARANJA) }, { tipo: "globo", globo: g(8, BLANCO) },
    { tipo: "globo", globo: g(10, NARANJA) }, { tipo: "globo", globo: g(9, BLANCO) },
  ];
  const aleta = T("T-260", r2(Math.max(2, 3.5 * escala)), NARANJA);
  return figura({
    postura: "horizontal", queEs, cuerpo,
    cabeza: { ...g(10, NARANJA), cara: { ojos: { estilo: "ovalos", hex: "#141414" }, boca: null, mejillas: null, bigote: null, nariz: null, cejas: null } },
    cabezaGrados: 0,
    // Aletas iguales arriba y abajo: el pez va cabeza abajo y en espejo (ver la escena) y se ve igual.
    accesorios: [
      { en: "cola", forma: { tipo: "cola", estilo: "plumas", tubito: aleta, largoCm: r2(9 * escala), anguloGrados: 180, cantidad: 3 } },
      { en: "lomo", forma: { tipo: "burbujas", tubito: aleta, largosCm: [r2(6 * escala)], angulosGrados: [90] } },
      { en: "barriga", forma: { tipo: "burbujas", tubito: aleta, largosCm: [r2(6 * escala)], angulosGrados: [-90] } },
    ],
  });
}

/**
 * Foto 740 × 570 (vista algo desde arriba): los R-12 azules miden ~85–110 px (los de delante, más cerca) y las algas ~30
 * px de grueso (T-360 a 7 cm): ~4 px/cm con el R-12 a 23 cm. Base: un aro de 12 R-12 azul rey (~1,15 m de ancho; se
 * ven 7 delante); dentro, un manojo de algas de T-360 en dos verdes (8 oscuras de ~85 cm y 6 claras de ~70 cm, abiertas
 * en cono) y dos peces payaso de globos: uno grande (~40 cm, a 86 cm) y uno chico (~24 cm, a 66 cm), los dos mirando a
 * la derecha. Medidos (no publica productos): azul #0014b8 → Fashion Azul Rey 041 (ΔE 54: la foto está muy
 * sobresaturada; el más cercano sería el Violeta y no es violeta); algas #005d42–#1c7259 → Fashion Verde Selva 032 y
 * #00b132 → Fashion Verde Lima 031 (en T-360 no se hace el Verde Trébol); peces #fc3b00 → Fashion Naranja 061 y blanco
 * 005.
 */
const escena721 = (): Escena => {
  const D = 23;
  const aro: OpcionesForma = { clase: "cono", altoCm: D, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: D, infladoPuntaCm: D, globosBase: 12, globosPunta: 12, colores: { codigos: ["041"], patron: "un_color" } };
  const m = montaje({ id: "aro", nombre: "Base: aro de 12 R-12 Fashion Azul Rey", pieza: { tipo: "forma", forma: aro }, origen: v(0, 0, 0) }, v(0, 0, -95));
  const penacho = (codigo: string, rizos: number, largoCm: number, apertura: number): Decoracion =>
    rizo({ forma: "penacho", formatoId: "T-360", grosorCm: 7, codigos: [codigo], rizos, vueltas: 0.3, radioInicialCm: 1, radioFinalCm: 7, largoCm, inclinacionGrados: 0, aperturaGrados: apertura });
  m.deco("algas-oscuras", "Algas: 8 T-360 Fashion Verde Selva", penacho("032", 8, 85, 28), v(0, 8, -4), AL_FRENTE);
  m.deco("algas-claras", "Algas: 6 T-360 Fashion Verde Lima", penacho("031", 6, 70, 42), v(0, 8, 2), AL_FRENTE);
  // Los peces: con la normal al frente y medio giro quedan con la cabeza a la derecha de quien mira (como en la foto).
  m.centrada("pez-grande", "Pez payaso grande (globos naranja y blanco)", deco(pezPayaso(1.2, "a big orange and white balloon clownfish seen from the side")), v(6, 86, 40), AL_FRENTE, 180);
  m.centrada("pez-chico", "Pez payaso chico (globos naranja y blanco)", deco(pezPayaso(0.72, "a small orange and white balloon clownfish seen from the side")), v(-6, 66, 42), AL_FRENTE, 180);
  return m.escena(sala(300, 280, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 725 · Marco para fotos San Valentín
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (el aro, visto algo de lado, sale en óvalo): los globitos miden ~30–50 px (R-5 a 11 cm y R-9 a 15 cm):
 * 3,4 px/cm. Un aro de ~1,45 m (60 cm de radio por el eje) con dos tramos de racimos orgánicos de R-5 y R-9 rosados,
 * frambuesa y fucsia (el de la izquierda de 140° a 255°, contra reloj desde la derecha; el de la derecha de −10° a 78°;
 * ~26 cm de grueso) y dos tramos de T-260 rosado enrollado en espiral (arriba, de 78° a 140°, y abajo a la derecha, de
 * −100° a −10°); arriba a la derecha, el corazón C-12 rosado (~30 cm, inclinado). Productos: los publicados (corazón
 * C-12 Fashion Rosado, Fashion Frambuesa, Fashion Rosado, Fashion Fucsia y tubito Fashion Rosado), en R-5 y R-9 (la
 * tienda los vende por color para todas las tallas). Medidos: los rojos #fc3534 miden Fashion Rojo 015 (ΔE 9), pero la
 * idea publica el Frambuesa: va el publicado; rosados #f6b7d7 → 009 (ΔE 7); fucsia #fc4b7f → 012 (ΔE 10,5).
 */
const escena725 = (): Escena => {
  const C = v(0, 95, -40), RADIO = 60;
  const colores = [colorOrg("009", 0.4), colorOrg("014", 0.35), colorOrg("012", 0.25)];
  const mezcla = { "R-5": 0.65, "R-9": 0.35 }, inflados = { "R-5": 11, "R-9": 15 };
  const arco = (desde: number, hasta: number, n: number): Vec3[] => Array.from({ length: n }, (_, i) => enAro(v(0, 0, 0), RADIO, desde + ((hasta - desde) * i) / (n - 1)));
  const izquierda = racimos({ puntos: arco(140, 255, 7), radio: 13, mezcla, colores, semilla: 725, inflados });
  const m = montaje({ id: "racimos-izquierda", nombre: "Aro: racimos de R-5 y R-9 rosado, frambuesa y fucsia (izquierda)", pieza: izquierda, origen: C }, v(0, 0, C.z - 70));
  // El tramo de la derecha, colgado del amarre con la normal al frente: su (x, y, z) local va al mundo como (x, z, y).
  const derecha = racimos({ puntos: arco(-10, 78, 6).map((p) => v(p.x, 0, p.y)), radio: 13, mezcla, colores, semilla: 726, inflados });
  m.pieza("racimos-derecha", "Aro: racimos de R-5 y R-9 rosado, frambuesa y fucsia (derecha)", derecha, C, AL_FRENTE);
  // Las espirales de T-260 rosado: resortes a lo largo de cuerdas cortas del aro (dos por tramo, para seguir la curva).
  const tramos: ReadonlyArray<readonly [number, number]> = [[78, 109], [109, 140], [-100, -55], [-55, -10]];
  tramos.forEach(([a0, a1], k) => {
    const a = enAro(C, RADIO, a0), b = enAro(C, RADIO, a1);
    m.deco(`espiral-${k + 1}`, `Espiral de T-260 Fashion Rosado ${k + 1}`, rizo({ forma: "resorte", tubito: T("T-260", 4.5, "009"), vueltas: 3, radioCm: 8, largoCm: r2(largo(menos(b, a))), eje: "frente" }), a, unitario(menos(b, a)));
  });
  m.globo("corazon", "Corazón C-12 Fashion Rosado (el «Happy Valentine's Day» no está en la tienda)", R("C-12", 30, "009"), mas(C, v(74, 63, 8)), unitario(v(0.5, 0.85, 0.15)));
  return m.escena(sala(300, 260, 240));
};

// ----------------------------------------------------------------------------------------------------------
// 741 · Mi boda
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (pequeña y borrosa): los tres globos de helio miden ~62 px (R-12 a 28 cm): 2,2 px/cm, con el piso en y
 * = 548 px y el eje en x = 370. Una torre orgánica dorada en cono de ~1,37 m (82 cm de ancho abajo, ~20 cm arriba) de
 * R-9 y R-5 (~30–45 px: 13–20 cm) con margaritas blancas de 5 R-5 y centro dorado subiendo en espiral (se ven ~10; aquí
 * 12), un R-12 blanco grande delante (~70 px: 30 cm, a 44,5 cm) y, de la punta, tres globos de helio: uno celeste con un
 * dibujo dorado y dos cristal con confeti dorado (a 192–229 cm). Medidos (no publica productos): dorado #d7a256 → Metal
 * Dorado 570 (ΔE 8); blanco #e7eaeb → Fashion Blanco 005; celeste #d1e2eb → Satín Azul 440 (ΔE 9); cristal con confeti
 * dorado → el «Confetti Dorado» cristal de la tienda.
 */
const escena741 = (): Escena => {
  const K = 2.2;
  const f = foto(370, 548, K);
  const DORADO = "570", BLANCO = "005";
  const ALTO = 137;
  const cono: OpcionesForma = { clase: "cono", altoCm: ALTO, tecnica: "organico", formatoId: "R-9", infladoBaseCm: 18, infladoPuntaCm: 12, globosBase: 10, globosPunta: 4, colores: { codigos: [DORADO], patron: "un_color" }, mezcla: { "R-9": 0.6, "R-5": 0.4 }, semilla: 741 };
  const m = montaje({ id: "torre", nombre: "Torre orgánica en cono de R-9 y R-5 Metal Dorado", pieza: { tipo: "forma", forma: cono }, origen: v(0, 0, 0) }, v(0, 0, -70));
  const margarita = flor({ petalos: { ...R("R-5", 9, BLANCO), cantidad: 5, aperturaGrados: 10, giroGrados: 0 }, centro: { ...R("R-5", 6, DORADO), cantidad: 1 } });
  for (let k = 0; k < 12; k++) {
    const h = 12 + (113 * k) / 11, a = -40 + 110 * k;
    const radio = r2(40 - (30 * h) / ALTO + 3);
    m.deco(`margarita-${k + 1}`, `Margarita de 5 R-5 Fashion Blanco ${k + 1}`, margarita, enAnillo(a, radio, r2(h)), haciaFuera(a, 10));
  }
  m.globo("blanco", "R-12 Fashion Blanco grande delante", R("R-12", 30, BLANCO), v(6.8, 44.5, 32), AL_FRENTE);
  const nudo = f(370, 245);
  m.helio("celeste", "R-12 Satín Azul de helio (el dibujo dorado no está en la tienda)", R("R-12", 27, "440"), f(305, 95, -5), unitario(menos(f(305, 95, -5), nudo)));
  m.helio("confeti-1", "R-12 Cristal «Confetti Dorado» de helio (arriba)", R("R-12", 27, "390"), f(360, 45, -10), unitario(menos(f(360, 45, -10), nudo)), CONFETTI_DORADO);
  m.helio("confeti-2", "R-12 Cristal «Confetti Dorado» de helio (abajo)", R("R-12", 27, "390"), f(385, 125, 5), unitario(menos(f(385, 125, 5), nudo)), CONFETTI_DORADO);
  m.cintas(nudo, CINTA_BLANCA, "Cintas de los globos de helio");
  return m.escena(sala(260, 240, 260));
};

// ----------------------------------------------------------------------------------------------------------
// 746 · MI Silk nuevos
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: los R-12 miden ~115 px (28 cm): 4,1 px/cm, y los grandes ~140–185 px (R-18 a 34–45 cm). Guirnalda
 * orgánica de pared de ~2,35 m por bloques de color, de izquierda a derecha: Silk Dorado, Silk Amatista, Pastel Dusk
 * Lavanda y Silk Blanco Nácar (cada bloque ~70–75 cm de largo y ~80 cm de alto, montados un poco unos sobre otros), con R-18,
 * R-12 y R-5; debajo de cada bloque cuelgan rizos de T-260 de su color (2 dorados, 3 amatista, 3 lavanda y 3 blancos).
 * Colores: los publicados (Silk Dorado 870, Silk Amatista 850, Pastel Dusk Lavanda 150, Silk Blanco Nácar 806); los
 * medidos lo confirman (#c1c2b3, #bbb9d5, #b898b6, #dde1dd).
 */
const escena746 = (): Escena => {
  const K = 4.1, Z = -90, ALTO = 170;
  const f = (x: number, y: number, z = Z) => v(r2((x - 500) / K), r2(ALTO + (430 - y) / K), z);
  type Bloque = { id: string; nombre: string; codigo: string; desde: [number, number]; hasta: [number, number]; radio: number; grandes: number };
  const bloques: Bloque[] = [
    { id: "dorado", nombre: "Silk Dorado", codigo: "870", desde: [70, 440], hasta: [255, 455], radio: 36, grandes: 0.12 },
    { id: "amatista", nombre: "Silk Amatista", codigo: "850", desde: [255, 440], hasta: [455, 450], radio: 36, grandes: 0 },
    { id: "lavanda", nombre: "Pastel Dusk Lavanda", codigo: "150", desde: [450, 425], hasta: [655, 455], radio: 40, grandes: 0 },
    { id: "blanco", nombre: "Silk Blanco Nácar", codigo: "806", desde: [725, 440], hasta: [920, 450], radio: 37, grandes: 0.18 },
  ];
  const pieza = (b: Bloque, deFrente: boolean): Pieza => {
    const a = f(b.desde[0], b.desde[1]), c = f(b.hasta[0], b.hasta[1]);
    const medio = por(mas(a, c), 0.5);
    const local = (p: Vec3) => (deFrente ? v(p.x - medio.x, 0, p.y - medio.y) : v(p.x - medio.x, p.y - medio.y, 0));
    const mezcla: Readonly<Record<string, number>> = b.grandes > 0 ? { "R-18": b.grandes, "R-12": 0.62 - b.grandes / 2, "R-5": 0.38 - b.grandes / 2 } : { "R-12": 0.65, "R-5": 0.35 };
    return racimos({ puntos: [local(a), local(c)], radio: b.radio, mezcla, colores: [colorOrg(b.codigo, 1)], semilla: 746 + bloques.indexOf(b), inflados: { "R-18": 38, "R-12": 27, "R-5": 13 } });
  };
  const centro = (b: Bloque) => por(mas(f(b.desde[0], b.desde[1]), f(b.hasta[0], b.hasta[1])), 0.5);
  const [primero, ...resto] = bloques;
  const m = montaje({ id: "bloque-dorado", nombre: "Guirnalda orgánica: bloque Silk Dorado", pieza: pieza(primero!, false), origen: centro(primero!) }, v(0, 0, Z + 70));
  // Los otros bloques cuelgan del amarre con la normal al frente: su (x, y, z) local va al mundo como (x, z, y).
  for (const b of resto) m.pieza(`bloque-${b.id}`, `Guirnalda orgánica: bloque ${b.nombre}`, pieza(b, true), centro(b), AL_FRENTE);
  // Los rizos, del tubito de la tienda más parecido a cada bloque (la tienda no vende tubitos Silk): Metal Dorado 570,
  // Fashion Lila 050, Pastel Dusk Lavanda 150 y Satín Perla 406.
  const rizos: ReadonlyArray<readonly [string, string, number, number, number, number]> = [
    ["570", "Metal Dorado", 200, 615, 25, 3], ["570", "Metal Dorado", 262, 620, 12, 2],
    ["050", "Fashion Lila", 300, 600, 18, 2.5], ["050", "Fashion Lila", 365, 595, 20, 2.5], ["050", "Fashion Lila", 440, 610, 15, 2],
    ["150", "Pastel Dusk Lavanda", 500, 600, 14, 2], ["150", "Pastel Dusk Lavanda", 560, 615, 16, 2], ["150", "Pastel Dusk Lavanda", 630, 615, 14, 2],
    ["406", "Satín Perla", 745, 610, 15, 2.5], ["406", "Satín Perla", 810, 625, 14, 2], ["406", "Satín Perla", 875, 610, 16, 2.5],
  ];
  rizos.forEach(([codigo, nombre, x, y, largoCm, vueltas], k) =>
    m.deco(`rizo-${k + 1}`, `Rizo de T-260 ${nombre} ${k + 1}`, rizo({ forma: "tirabuzon", tubito: T("T-260", 4, codigo), vueltas, radioInicialCm: 3.5, radioFinalCm: 5.5, largoCm, eje: "abajo" }), f(x, y, Z + 14), AL_FRENTE));
  return m.escena(sala(320, 290, 260));
};

// ----------------------------------------------------------------------------------------------------------
// 761 · Móvil niña
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los R-12 «Es una niña» miden ~110 px (28 cm): 3,9 px/cm, con el eje en x = 370; lo de más arriba (los
 * lila, y = 45 px) toca el techo. Ramo de helio colgante: arriba 3 R-12 lila (~120 px: 30 cm) contra el techo; debajo 4
 * R-12 rosados «Es una niña» (a 200–216 cm); al centro la carita sonriente metalizada rosada con su moñito (~140 px; un
 * redondo de 18"; centro a 175 cm); alrededor 6 chupetes de tubito: un aro de T-260 rosado y un R-5 (4 blancos y 2
 * lila); las cintas bajan rizadas hasta ~133 cm. Medidos (no publica productos): lila #be9ccd → Fashion Lila 050 (ΔE 5);
 * rosado de los chupetes #fdb6d4 → Fashion Rosado 009 (ΔE 7); R-5 lila #c8b1d7 → 050 y blancos 005; los impresos
 * rosados de puntos blancos con «Es una niña» → el «Es una niña» de la tienda (Pastel Mate Rosado 609: en la foto son
 * más rosados).
 */
const escena761 = (): Escena => {
  const K = 3.9, ALTO = 260;
  const f = foto(370, 18 + ALTO * K, K);
  const LILA = "050", ROSADO = "009", BLANCO = "005";
  const techo: Pieza = { tipo: "techo", techo: { elementos: [{ tipo: "helio", puntos: [{ xCm: -24, zCm: 0 }, { xCm: 10, zCm: 6 }, { xCm: 27, zCm: -24 }], globo: { formatoId: "R-12", infladoCm: 30.5 }, codigos: [LILA], cintaCm: 30, cintaHex: CINTA_ROSADA }] } };
  const m = montaje({ id: "lila", nombre: "Móvil: 3 R-12 Fashion Lila de helio contra el techo", pieza: techo, origen: v(0, ALTO, 0) }, v(0, 0, -80));
  const nudo = f(365, 470, 4);
  const impresos: ReadonlyArray<readonly [number, number, number]> = [[240, 255, -5], [320, 215, -10], [440, 225, -5], [370, 280, 8]];
  impresos.forEach(([x, y, z], k) => { const c = f(x, y, z); m.helio(`es-una-nina-${k + 1}`, `R-12 «Es una niña» de helio ${k + 1}`, R("R-12", 28, "609"), c, unitario(mas(por(unitario(menos(c, nudo)), 0.4), por(ARRIBA, 0.6))), ES_UNA_NINA); });
  m.foil("carita", "Carita sonriente metalizada rosada (genérica: redondo rosado de 18\")", { forma: { tipo: "redondo" }, pulgadas: 18, color: "rosado" }, f(360, 375, 12));
  // Los chupetes: el aro de T-260 rosado y su R-5 (centros medidos en la foto).
  const chupetes: ReadonlyArray<readonly [number, number, number, number, number, string]> = [
    [198, 130, 7, 232, 72, BLANCO], [508, 68, 7, 468, 40, BLANCO], [522, 150, 5.5, 557, 145, BLANCO],
    [192, 305, 7.5, 275, 330, LILA], [500, 335, 8, 575, 375, LILA], [272, 425, 6, 318, 410, BLANCO],
  ];
  chupetes.forEach(([xa, ya, radio, xb, yb, codigo], k) => {
    const centroAro = f(xa, ya, 14);
    m.trazo(`chupete-aro-${k + 1}`, `Chupete ${k + 1}: aro de T-260 Fashion Rosado`, T("T-260", 3.5, ROSADO), [{ tipo: "arco", centro: [0, 0], radioCm: radio, desdeGrados: 0, hastaGrados: 360 }], centroAro, "a pink twisted-balloon pacifier ring");
    m.globo(`chupete-globo-${k + 1}`, `Chupete ${k + 1}: R-5 ${codigo === LILA ? "Fashion Lila" : "Fashion Blanco"}`, R("R-5", 10, codigo), f(xb, yb, 14), unitario(menos(f(xb, yb, 14), centroAro)));
  });
  const fin = (x: number) => [nudo, f(x, 540, 4)] as const;
  m.cintas(nudo, CINTA_ROSADA, "Cintas rosadas del móvil", [fin(320), fin(395), fin(470)]);
  return m.escena(sala(300, 260, ALTO));
};

// ----------------------------------------------------------------------------------------------------------
// 768 · Mural 2014
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el paso de la malla, medido con la autocorrelación de la imagen, es de 16 px en las dos direcciones:
 * 42 columnas × 14 filas de R-5 (588 globos; con el R-5 a 12 cm y el paso del taller, 10,8 cm: 4,55 × 1,52 m). Los
 * números «2014» salen celda a celda de la foto (87 amarillos: cada celda vota por el color de su centro; se quitaron 4
 * celdas sueltas, 3 al borde del «0» y 1 a la izquierda del travesaño del «4»). Medidos (no publica productos): fucsia #fc178a → Fashion Fucsia 012 (ΔE 20; Neón y
 * Metal Fucsia quedan a 2: la foto está sobresaturada); amarillo #fad60f → Fashion Amarillo Miel 021 (ΔE 8).
 */
const MATRIZ_2014 = [
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaabbbbbbaaabbbbbbbaaaaabaaabaaaaabaaaaaa",
  "aaaaaaaaabaaabaaaaabaaaabbaaabaaaaabaaaaaa",
  "aaaaaaaaabaaabaaaaabaaababaaabaaaaabaaaaaa",
  "aaaaaaaaabaaabaaaaabaaaaabaaabaaaaabaaaaaa",
  "aaaabbbbbbaaabaaaaabaaaaabaaabbbbbbbaaaaaa",
  "aaaabaaaaaaaabaaaaabaaaaabaaaaaaaaabaaaaaa",
  "aaaabaaaaaaaabaaaaabaaaaabaaaaaaaaabaaaaaa",
  "aaaabaaaaaaaabaaaaabaaaaabaaaaaaaaabaaaaaa",
  "aaaabbbbbbaaabbbbbbbaabbbbbbaaaaaaabaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
];
const escena768 = (): Escena => {
  const mural: OpcionesMural = { disposicion: "simple", grande: { formatoId: "R-5", infladoCm: 12 }, chico: null, matriz: { colores: ["012", "021"], filas: MATRIZ_2014 } };
  return { sala: sala(520, 260, 260), nodos: [{ id: "mural", nombre: "Mural «2014»: 42 × 14 R-5 fucsia con los números amarillos", pieza: { tipo: "mural", mural }, colocacion: { en: "libre", xCm: 0, yCm: 60, zCm: -115, giroGrados: 0 } }] };
};

// ----------------------------------------------------------------------------------------------------------
// 769 · Mural animal print
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el paso de los negros (autocorrelación) es de 47 px a lo ancho y 46 a lo alto: 14 columnas × 10 filas
 * de R-12 negros tocándose (en la foto quedan rombos blancos entre cada cuatro); los R-5 rosados de los huecos miden ~30
 * px: con el R-5 a 12,5 cm, 2,4 px/cm, y los R-12 a 22 cm (paso 19,8 cm): 2,8 × 2 m. Dentro del corazón no hay negros
 * (celda a celda, de la foto: 32 vacías; quedan 108). En los huecos del borde, 20 R-5 rosados (cada dos huecos: 6 arriba, 6 abajo y 4
 * a cada lado); el corazón (~1,85 × 1,35 m) es una hilera de 30 R-9 rosados (~43 px: 18 cm), la mitad con manchas de
 * animal print. Medidos (no publica productos): negro 080; corazón #ea4e91 → Fashion Rosa 011 (ΔE 4); R-5 de los huecos
 * #fe80b5 → Satín Fucsia 412 (ΔE 12). El animal print rosado no está en la tienda (el «Animal Print» de la tienda viene
 * en arena, dorado y negro): van lisos.
 */
const escena769 = (): Escena => {
  const COLS = 14, FILAS = 10;
  const filas = ["aaaaaaaaaaaaaa", "aaaaaaaaaaaaaa", "aaaa..aa..aaaa", "aaa........aaa", "aaa........aaa", "aaaa......aaaa", "aaaaa....aaaaa", "aaaaaa..aaaaaa", "aaaaaaaaaaaaaa", "aaaaaaaaaaaaaa"];
  // De la foto a la celda (columna, fila desde arriba): el centro del primer negro en (68,5, 77) px, a 47 × 46 px.
  const celda = (x: number, y: number): [number, number] => [r2((x - 68.5) / 47), r2((y - 77) / 46)];
  const huecos: Array<[number, number]> = [];
  for (const i of [1.5, 3.5, 5.5, 7.5, 9.5, 11.5]) huecos.push([i, 0.5], [i, 8.5]);
  for (const j of [1.5, 3.5, 5.5, 7.5]) huecos.push([0.5, j], [12.5, j]);
  // El corazón: su eje medido en la foto (px), repartido en 30 globos a la misma distancia, desde la hendidura de arriba.
  const eje: ReadonlyArray<readonly [number, number]> = [
    [375, 240], [405, 205], [440, 170], [470, 148], [510, 160], [545, 190], [562, 232], [548, 275], [515, 305], [480, 335], [445, 365], [410, 395],
    [378, 425], [345, 398], [310, 368], [275, 338], [240, 305], [205, 272], [185, 240], [195, 200], [225, 165], [265, 148], [305, 165], [340, 200],
  ];
  const corazon = repartirCerrado(eje, 30).map(([x, y]) => celda(x, y));
  const mural: OpcionesMural = {
    disposicion: "simple", grande: { formatoId: "R-12", infladoCm: 22 }, chico: null, matriz: { colores: ["080"], filas },
    encima: [
      { formatoId: "R-5", infladoCm: 12.5, codigo: "412", puntos: huecos },
      { formatoId: "R-9", infladoCm: 18, codigo: "011", puntos: corazon },
    ],
  };
  if (filas.length !== FILAS || filas.some((x) => x.length !== COLS)) throw new Error("La matriz del mural animal print no es de 14 × 10.");
  return { sala: sala(340, 260, 260), nodos: [{ id: "mural", nombre: "Mural de 14 × 10 R-12 negros con el corazón rosado", pieza: { tipo: "mural", mural }, colocacion: { en: "libre", xCm: 0, yCm: 40, zCm: -115, giroGrados: 0 } }] };
};

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

export const LOTE_21: readonly IdeaDigitalizada[] = [
  idea(604, "flor-navidena", "Flor navideña: flor de pared roja con resortes verdes", escena604,
    "Igual: la flor de pared de ~1,1 m con sus resortes (escala por los pétalos, ~125 px = 27 cm): 5 pétalos R-12 rojos con el impreso de grafitis blancos de invierno (el «Graffiti Invierno» rojo de la tienda, el más parecido a los bastones, copos y regalitos de la foto), la corona de 6 R-5 Verde Selva y el centro R-5 rojo, y entre pétalo y pétalo un resorte de T-260 Verde Selva de ~2,5 vueltas que sale hacia fuera (5 en total, en las direcciones medidas). Distinto: la idea no publica productos (colores medidos: verde #027c3e → Verde Selva 032; rojos → Fashion Rojo 015); en la foto los resortes salen de debajo de los pétalos y se ven de lado, como zigzags; aquí son resortes rectos de radio fijo. La foto no dice a qué altura va: aquí, con el centro a 1,5 m en la pared."),
  idea(616, "futbol-arreglo", "Fútbol arreglo: columna de balones con estrellas doradas", escena616,
    "Igual: la columna de ~2,1 m (escala por el balón grande, R-24 a 54 cm): base de 4 R-12 balón, 4 uniones de cuarteto R-5 negro, 3 Link-O-Loon cristal con un R-12 balón dentro (globo dentro de globo) alternados con ellas y el R-24 balón de remate; en cada unión, un moño de flecos de tubito amarillo; y los 3 rizos de T-260 blanco con su estrellita dorada de burbujas. Productos: los publicados (el balón de fútbol exacto en R-12 y R-24, Fashion Negro en R-5, Link-O-Loon Cristal Transparente). Distinto: los flecos amarillos de la foto parecen papel o cinta crespa; aquí son lazos de T-260 Fashion Amarillo (medido #eee863, Neón Amarillo, que la tienda no vende en tubito); las estrellitas, de burbujas de T-260 Metal Dorado (medido #dcb055); el perfil del globo de fuera del doble globo se toma como el de un redondo (el Link-O-Loon real es algo más alargado). La foto pide ~1,6 m en la clasificación, pero con el balón grande como R-24 da ~2,1 m.",
    [
      pub("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", null, null),
      pub("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
      pub("GLOBO LINK-O-LOON® FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-link-o-loon-fashion-transparente", "LOL-12", "390"),
    ]),
  idea(635, "globos-cristal", "Globos cristal: globo de estrellas relleno con anillo y cuarteto perla", escena635,
    "Igual: el R-24 cristal de estrellas blancas (el «Estrellas» cristal de la tienda, que se vende en R-24) boca arriba, relleno de R-5 de colores amontonados abajo (12: se ven 9), el anillo de 8 R-5 Satín Rosado alrededor del cuello y el cuarteto R-12 perla encima (dos al frente), ~1,2 m (escala por el R-24, ~245 px = 55 cm). Colores medidos: perla → Silk Perla Crema 873; dentro, Silk Blanco Nácar, Satín Azul, Pastel Mate Rosado, Satín Fucsia, Satín Lila y Fashion Frambuesa. Distinto: la idea no publica productos; la ramita de flores naturales que sale del cuarteto no se modela (no es globo); el relleno va en tres capas ordenadas (3, 6 y 3) y en la foto se ve más suelto; las estrellas del impreso son un dibujo propio, aproximado."),
  idea(686, "lampara-navidena", "Lámpara navideña: cono verde colgante con cadena roja y lunares", escena686,
    "Igual: la lámpara colgante de ~2,3 m de la cadena a la punta (escala por los R-12 de la base, ~68 px = 28 cm): la cadena de 5 R-5 rojos desde el techo, el cono de anillos de R-12 Verde Selva que se achican (de 28 a 18 cm, 10 por anillo abajo y ~1,17 m de ancho) con R-5 verdes en los huecos y uno de remate, debajo el cuarteto R-12 rojo de lunares blancos (el «Polka Blanco» rojo de la tienda; se ven 3) y el R-5 dorado de la punta. Distinto: la idea no publica productos (verde medido #017e5b → Verde Selva 032; en lo iluminado mide Fashion Verde 030); el cono del taller sube 0,8 diámetros por anillo y sale con 6 anillos (en la foto se cuentan 4 o 5 más separados); el R-5 de la punta apenas asoma en la foto y su dorado es supuesto."),
  idea(687, "lapiz-escolar", "Lápiz escolar: columna lápiz amarilla con punta y borrador", escena687,
    "Igual: el lápiz de ~2 m (escala por los R-12 amarillos, ~58 px = 22 cm): la mina de 3 cuartetos R-5 negros que se achican y un R-5 de punta, la madera de 3 cuartetos R-9 durazno que se abren hacia arriba, el cuerpo de 5 cuartetos R-12 Fashion Amarillo (tres y dos globos al frente alternados, a 16 cm por nivel), el anillo de un cuarteto R-9 perlado y el borrador R-18 rosado. Colores medidos: amarillo → Fashion Amarillo 020 (ΔE 1); madera → Fashion Durazno 060 (medida #f2b063, más naranja: la foto está sobresaturada); anillo → Fashion Arena 071 (brilla como perla; el Satín Perla queda a 13); borrador → Fashion Rosado 009. Distinto: la idea no publica productos; la foto no muestra cómo se sostiene el lápiz con la punta abajo: aquí queda suelto con la punta a 15 cm del piso; el borrador de la foto se ve achatado (45 × 32 cm) y aquí es un R-18 redondo de 42 cm; la clasificación lo daba de ~1,5 m, pero con los amarillos de 22 cm mide ~2 m."),
  idea(700, "los-minnions", "Los Minnions: ramo de helio violeta, azul y amarillo sobre la mesa", escena700,
    "Igual: el ramo de helio de 4 R-12 sobre la mesa de los cupcakes, en el orden de la foto (Fashion Violeta a la izquierda y arriba, Fashion Azul Rey a la derecha y un Amarillo Miel que asoma detrás), con sus cintas al peso. Distinto: la idea no publica productos y la foto no trae nada de tamaño conocido fuera de los cupcakes: los R-12 van a 28 cm y el ramo, a 1,6–2 m; colores medidos con la foto muy sobresaturada (azul #005ada → Azul Rey 041 a ΔE 30); los Minions de juguete, los cupcakes, el 2 con la estrella de los palitos y el letrero «SEBASTIAN» no son de globos ni están en la tienda: no se modelan (la mesa va como una caja con mantel blanco)."),
  idea(706, "malla-es-una-nina", "Malla «Es una niña»: pared blanca con centros rosados y marco fucsia", escena706,
    "Igual: la pared de ~3,2 × 1,9 m (escala por los R-12 impresos, ~45 px = 22 cm): el fondo de 13 × 7 R-12 blancos, delante en los huecos medidos los 8 R-12 «Es una niña» (el de la tienda), 12 R-9 fucsia y 22 R-5 lila; al centro los tres Link-O-Loon 660 (lila arriba y abajo, rosado en medio con un R-9 lila en cada punta); el marco de dos T-360 fucsia lado a lado con 8 R-5 lila en las juntas y las 10 florecitas blancas de 4 burbujas de T-260 con su centro fucsia. Distinto: la idea no publica productos (colores medidos; el fucsia, #f2288c, va Fashion Fucsia 012 como el marco aunque el Neón Fucsia mida 3 más cerca); el «Es una niña!» escrito en el Link-O-Loon rosado no está en la tienda (va liso); los impresos de la foto son rosado fuerte con puntos y el de la tienda es Pastel Mate Rosado con estrellas; en la foto los blancos no van en retícula exacta (se acomodan alrededor de cada centro como pétalos) y aquí sí."),
  idea(720, "maquina-de-dulces", "Máquina de dulces: base roja, globo cristal con dulces y tapa", escena720,
    "Igual: la máquina de ~1,3 m (escala por el globo cristal, ~205 px: R-24 a 50 cm): la base roja de 3 cuartetos R-9 con 8 R-5 rojos chicos en los huecos y el botón R-9 negro al frente, el cuello de 2 cuartetos R-5 rojos, el globo R-24 cristal con 8 «dulces» R-9 de colores dentro (rosado, durazno, eucalipto, fucsia, frambuesa y azul) y la tapa de un cuarteto R-9 y uno R-5 rojos. Distinto: la idea no publica productos; colores medidos con la foto sobresaturada (el «amarillo» pálido mide Fashion Durazno 060 a ΔE 18; el coral, Fashion Frambuesa 014 a 21; los verdes claros, Eucalipto 027); los dulces quedan amontonados abajo por el motor (en la foto llenan el globo hasta arriba); la tapa de la foto se ve como dos rodetes achatados y aquí son dos cuartetos."),
  idea(721, "mar", "Mar: aro azul con algas de tubito y peces payaso", escena721,
    "Igual: el centro marino de ~1,15 m (escala por las algas, T-360 a 7 cm, y los R-12 a 23 cm): el aro de 12 R-12 Azul Rey, el manojo de algas de T-360 en dos verdes (8 Verde Selva y 6 Verde Lima) abiertas en cono y los dos peces payaso de globos naranja y blanco (uno grande y uno chico, los dos con la cabeza a la derecha). Distinto: la idea no publica productos y la foto está muy sobresaturada (el azul #0014b8 va Azul Rey 041); en la foto las algas se curvan y se cruzan y aquí salen casi rectas, en cono; los peces de la foto son de tubito torcido en burbujas con aletas de lazos y un ojo impreso de lado; aquí son figuras de R-5 (naranja, blanco, naranja, blanco) con cabeza de ojos dibujados y aletas de burbujas, puestas cabeza abajo y en espejo para que miren a la derecha (por eso las aletas van iguales arriba y abajo)."),
  idea(725, "marco-para-fotos-san-valentin", "Marco para fotos San Valentín: aro de racimos con espirales y corazón", escena725,
    "Igual: el aro de ~1,45 m para la foto (escala por los globitos, R-5 a 11 cm): dos tramos de racimos orgánicos de R-5 y R-9 en Fashion Rosado, Frambuesa y Fucsia (los publicados) a izquierda y derecha, los dos tramos de T-260 Fashion Rosado enrollado en espiral (arriba y abajo a la derecha) y el corazón C-12 Fashion Rosado arriba a la derecha. Distinto: el corazón de la foto lleva impreso «Happy Valentine's Day!», que no está en la tienda (va liso, como el producto publicado); los rojos miden Fashion Rojo 015 pero va el Frambuesa publicado; en lo orgánico el motor da los globitos del grosor y el largo medidos (no se cuentan uno a uno); las espirales son resortes rectos a lo largo de cuerdas del aro (dos por tramo) y en la foto siguen la curva; la foto (vista de lado) no muestra cómo se sostiene: aquí queda de pie, suelto, con el centro a 95 cm.",
    [
      pub("GLOBO CORAZON FASHION ROSADO", "/products/globo-para-fiesta-latex-corazon-fashion-rosado", "C-12", "009"),
      pub("GLOBO REDONDO FASHION FRAMBUESA", "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", "R-12", "014"),
      pub("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
      pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
      pub("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"),
    ]),
  idea(741, "mi-boda", "Mi boda: torre dorada con margaritas y globos de helio", escena741,
    "Igual: la torre orgánica en cono de ~1,37 m de R-9 y R-5 Metal Dorado (escala por los globos de helio, ~62 px = 28 cm), las 12 margaritas de 5 R-5 blancos con centro dorado que suben en espiral (se ven ~10), el R-12 blanco grande delante y, de la punta, los 3 globos de helio con sus cintas: uno Satín Azul y dos cristal con confeti dorado (el «Confetti Dorado» cristal de la tienda, el más parecido). Distinto: la idea no publica productos y la foto es pequeña y borrosa (colores medidos: dorado #d7a256 → Metal Dorado 570); la clasificación decía «tubitos dorados en burbujas» de ~60 cm, pero en la foto son globos redondos de 13–20 cm y con esa escala la torre mide ~1,4 m; el celeste lleva un dibujo dorado (unos anillos o un corazón) que no está en la tienda: va liso; en lo orgánico el motor da los globos del grosor medido."),
  idea(746, "mi-silk-nuevos", "MI Silk nuevos: guirnalda orgánica por bloques con rizos", escena746,
    "Igual: la guirnalda orgánica de pared de ~2,35 m por bloques de color (escala por los R-12, ~115 px = 28 cm), de izquierda a derecha Silk Dorado, Silk Amatista, Pastel Dusk Lavanda y Silk Blanco Nácar (los publicados), con R-18, R-12 y R-5, y los 11 rizos de T-260 de su color colgando debajo (2, 3, 3 y 3). Distinto: en lo orgánico el motor da los globos del grosor y el largo medidos (no se cuentan uno a uno: en la foto se ven ~9 por bloque); los rizos de la foto son tubitos sueltos en lazos y bucles y aquí son tirabuzones; los R-18 solo van en los bloques dorado y blanco, donde se ven; la foto no dice a qué altura va: aquí, con el centro a 1,7 m.",
    [
      pub("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870"),
      pub("GLOBO REDONDO SILK AMATISTA", "/products/globo-latex-redondo-silk-amatista", "R-12", "850"),
      pub("GLOBO REDONDO PASTEL DUSK LAVANDA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-lavanda", "R-12", "150"),
      pub("GLOBO REDONDO SILK BLANCO NÁCAR", "/products/globo-latex-redondo-silk-blanco-nacar", "R-12", "806"),
    ]),
  idea(761, "movil-nina", "Móvil niña: ramo colgante lila y rosado con carita y chupetes", escena761,
    "Igual: el móvil de helio colgado del techo (escala por los R-12 impresos, ~110 px = 28 cm): 3 R-12 Fashion Lila contra el techo, 4 R-12 «Es una niña» (el de la tienda) debajo, la carita metalizada rosada al centro, los 6 chupetes de tubito (aro de T-260 rosado con su R-5: 4 blancos y 2 lila) alrededor y las cintas rosadas que bajan hasta ~1,3 m. Distinto: la idea no publica productos; la carita sonriente con moñito no está en la tienda: va un redondo metalizado rosado de 18\" genérico, sin cara; los impresos de la foto son rosado fuerte con puntos blancos y el de la tienda es Pastel Mate Rosado con estrellas; en la foto las cintas bajan rizadas y aquí rectas; los chupetes de la foto llevan un nudito rosado entre el aro y la bola que aquí no va."),
  idea(768, "mural-2014", "Mural 2014: malla fucsia con los números amarillos", escena768,
    "Igual: el mural de 42 × 14 R-5 (588, contados por el paso de la malla en la foto: 16 px en las dos direcciones) en Fashion Fucsia con «2014» en Amarillo Miel celda a celda (87 amarillos, sacados de la foto), ~4,55 × 1,52 m con el R-5 a 12 cm. Distinto: la idea no publica productos y la foto (un dibujo) está sobresaturada: fucsia #fc178a → Fashion Fucsia 012 (Neón y Metal Fucsia quedan 2 más cerca), amarillo #fad60f → Amarillo Miel 021; en la foto los amarillos de los trazos alternan grandes y chicos, aquí todos del tamaño de la malla; la clasificación lo creía de Link-O-Loon, pero en la foto son redondos en retícula."),
  idea(769, "mural-animal-print", "Mural animal print: malla negra con corazón rosado", escena769,
    "Igual: el mural de 14 × 10 R-12 negros (paso medido en la foto: 47 × 46 px) sin los 32 del hueco del corazón (108), los 20 R-5 rosados en los huecos del borde (cada dos huecos) y el corazón de 30 R-9 rosados por su eje medido, ~2,8 × 2 m (escala por los R-5 de los huecos, ~30 px = 12,5 cm). Distinto: la idea no publica productos (colores medidos: corazón #ea4e91 → Fashion Rosa 011; huecos #fe80b5 → Satín Fucsia 412); la mitad de los rosados del corazón llevan manchas de animal print, que no hay en rosado en la tienda (el «Animal Print» viene en arena, dorado y negro): van lisos; la clasificación lo creía de Link-O-Loon, pero en la foto son redondos en retícula con rombos blancos entre cada cuatro."),
];
