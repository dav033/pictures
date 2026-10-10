import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { ElementoEscenografia } from "../escenografia";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion } from "../figuras";
import type { Vec3 } from "../modulos";
import type { PatronColumna } from "../columnas";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import { centroCuerpo } from "../geometria";
import type { Accesorio, Cara, DibujoCuerpo, PropiedadesFigura } from "../figuras-tubito";
import type { ParteTubito } from "../halloween";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { ColorOrganico, PuntoMezcla } from "../organico";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 17** (los números de `clasif/lote-17.json`): 14 centros de mesa
 * y ramos que antes quedaban «a medias» (búho, calabazas apiladas, canasta de amor, papá, corazón, cristal, feliz
 * cumpleaños, mis quince, momento inolvidable, navidad, niño, topiario terra y primera comunión) y la calabaza de racimo
 * (#232). #264 y #303 son la misma pieza y la misma sesión de fotos con dos títulos: se digitaliza una vez y #303 reusa la
 * escena con su propio id, slug y foto.
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada con rejilla de
 * píxeles y medida:
 * - **Escala**: la de un globo de tamaño conocido en la misma foto (R-12 de helio ≈ 28 cm; si no hay, el grueso del T-260
 *   o el metalizado de 18"). Con ella, cada globo va a su altura, su lado y su tamaño (cada escena dice su escala). Las
 *   posiciones se escriben en el mundo con `foto(eje, piso, px/cm)`: x a la derecha del eje de la pieza, y desde la mesa.
 * - **Conteo**: los globos que se ven, uno a uno, y los que la técnica obliga detrás (el cuarto de un cuarteto); los de
 *   helio, piso por piso (uno por altura en estos ramos verticales). Ninguna idea publica «Materiales» con cantidades: lo
 *   contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana de un parche
 *   sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial), el código más cercano que se fabrica en ese formato
 *   (un Fashion si queda a ≤ 6 ΔE del mejor: las fotos viejas están sobresaturadas y no son Neón).
 * - **Impresos y metalizados**: el de la tienda (`impresos-catalogo.ts`, `metalizados.ts`) cuando es el de la foto; si
 *   no está, el más parecido del catálogo (y la nota lo dice). Los lunares de colores sin letrero (búho, feliz
 *   cumpleaños) no tienen impreso en la tienda: van como lunares dibujados sobre el liso (`dibujo` de una figura de un
 *   solo globo, no se cotiza) y el globo cuenta como liso.
 * - **Montaje** (como el lote 05): la estructura principal es el nodo raíz; de ella cuelga (`sobre`) su varilla
 *   (escenografía) y de la varilla, todo lo demás, en el sitio exacto de la foto. Los dos que no tienen varilla
 *   (la calabaza y el centro de flores de #293) cuelgan sus decoraciones directamente de la raíz.
 * Unidades: cm. Mundo: y arriba desde la mesa, x a la derecha de quien mira, +z hacia quien mira.
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
/** Hacia fuera en el plano de la mesa: 0° = al frente (+z), 90° = a la derecha de quien mira (+x). */
const fuera = (grados: number): Vec3 => v(r2(Math.sin(rad(grados))), 0, r2(Math.cos(rad(grados))));
/** Dirección hacia fuera `grados` alrededor y levantada `elevacion` grados sobre el plano de la mesa. */
const haciaFuera = (grados: number, elevacion: number): Vec3 => unitario(mas(por(fuera(grados), Math.cos(rad(elevacion))), por(ARRIBA, Math.sin(rad(elevacion)))));
/** Un punto a `radio` del eje vertical, en el ángulo `grados` (0° al frente), a la altura `y`. */
const enAnillo = (grados: number, radio: number, y: number): Vec3 => mas(por(fuera(grados), radio), v(0, y, 0));
/** Del píxel de una foto al mundo: x desde el eje de la pieza, y desde la mesa (la fila `piso`), a `pxPorCm`. */
const foto = (eje: number, piso: number, pxPorCm: number) => (x: number, y: number, z = 0): Vec3 => v(r2((x - eje) / pxPorCm), r2((piso - y) / pxPorCm), z);

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

/** Un globo con lunares de otro color dibujados (el impreso de lunares de la foto no está en la tienda): no cotiza el dibujo. */
const globoConLunares = (g: ParteGlobo, dibujo: DibujoCuerpo, queEs: string): Decoracion =>
  figura({ cuerpo: [{ tipo: "globo", globo: g, dibujo }], accesorios: [], queEs });

/**
 * Un tubito de frente que sigue líneas quebradas y arcos (contornos, caras, tallos, rizos): una figura vacía con
 * cadenas de burbujas (`burbujas`, ángulos absolutos en el plano de frente) y arcos (`aro`). Las coordenadas van como las
 * ve quien mira la foto (cm: a su derecha, arriba); como una pieza `sobre` queda en espejo (el marco de un ancla es de
 * mano izquierda), aquí se reflejan para que se vea como en la foto.
 */
type TrazoFrente = { tipo: "linea"; puntos: ReadonlyArray<readonly [number, number]> } | { tipo: "arco"; centro: readonly [number, number]; radioCm: number; desdeGrados: number; hastaGrados: number };
function trazos(t: ParteTubito, partes: readonly TrazoFrente[], queEs: string): Decoracion {
  const accesorios: Accesorio[] = partes.map((p): Accesorio => {
    if (p.tipo === "arco") {
      // Espejo: el ángulo a pasa a 180° − a (y el recorrido va al revés).
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

/** Contorno de corazón (cm, de frente) de `ancho` × `alto`, con la punta abajo en (0, 0): `n` vértices de la curva clásica. */
function contornoCorazon(anchoCm: number, altoCm: number, n = 16): Array<[number, number]> {
  const crudo: Array<[number, number]> = Array.from({ length: n + 1 }, (_, i) => {
    const t = Math.PI + (2 * Math.PI * i) / n;
    return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
  });
  const xs = crudo.map(([x]) => x), ys = crudo.map(([, y]) => y);
  const ancho = Math.max(...xs) - Math.min(...xs), bajo = Math.min(...ys), alto = Math.max(...ys) - bajo;
  return crudo.map(([x, y]) => [r2((x * anchoCm) / ancho), r2(((y - bajo) * altoCm) / alto)]);
}

// ----------------------------------------------------------------------------------------------------------
// Montaje: la estructura principal como raíz, su varilla y lo que cuelga de la varilla
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
  /** Un globo de helio con lunares dibujados (de pie, de frente). */
  helioConLunares: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, dibujo: DibujoCuerpo, queEs: string) => void;
  /** Un metalizado de pie y de frente con el centro en `centro` (su base anotada para las cintas si `conCinta`). */
  foil: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3, conCinta?: boolean) => void;
  /** Un nivel de cuarteto con su centro en `centro`, girado `giroGrados` (0° = un hueco al frente; 45° = un globo al frente). */
  nivel: (id: string, nombre: string, pieza: Pieza, centro: Vec3, giroGrados: number) => void;
  /** Una decoración con su origen en `origen`, mirando hacia `normal` (su +y local) y girada `giroGrados`. */
  deco: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados?: number) => void;
  /**
   * Unos trazos de tubito con su punto (0, 0) en `origen`, en el plano vertical que mira hacia `normal` (horizontal; de
   * frente por omisión): su «arriba» es el del mundo.
   */
  trazo: (id: string, nombre: string, t: ParteTubito, partes: readonly TrazoFrente[], origen: Vec3, queEs: string, normal?: Vec3) => void;
  /** Un tallo recto de tubito de `desde` a `hasta` (dos burbujas en línea). */
  palito: (id: string, nombre: string, t: ParteTubito, desde: Vec3, hasta: Vec3) => void;
  /** Escenografía (cintas, caja, hojas) con sus elementos en coordenadas del mundo. */
  escenografia: (id: string, nombre: string, elementos: ElementoEscenografia[]) => void;
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
 * sobre el eje de la raíz (que no corta ningún globo: el hueco del centro de los cuartetos). Lo demás cuelga de la varilla.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; origen: Vec3; giroGrados?: number }, varilla: { nombre: string; base: Vec3; altoCm: number; radioCm: number; hex: string; acabado?: "mate" | "metal" | "satinado" }): Montaje {
  const nodos: NodoEscena[] = [{ id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: { en: "libre", xCm: raiz.origen.x, yCm: raiz.origen.y, zCm: raiz.origen.z, giroGrados: raiz.giroGrados ?? 0 } }];
  const puntoVarilla = mas(menos(varilla.base, raiz.origen), v(0, HUNDIDO, 0));
  nodos.push({
    id: "varilla", nombre: varilla.nombre,
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: varilla.radioCm, altoCm: varilla.altoCm, hex: varilla.hex, acabado: varilla.acabado ?? "mate" }] },
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
    const p: Pieza = { tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(g.helio ? { helio: true as const } : {}), ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
    pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
  };
  const deco = (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados = 0) => pieza(id, nombre, { tipo: "decoracion", decoracion }, origen, normal, giroGrados);
  return {
    nodos, pieza, globo, deco,
    helio: (id, nombre, g, centro, impresoId, direccion = ARRIBA) => {
      globo(id, nombre, { ...g, helio: true }, centro, direccion, impresoId);
      nudos.push(menos(centro, por(unitario(direccion), centroCuerpo("redondo", g.infladoCm))));
    },
    helioConLunares: (id, nombre, g, centro, dibujo, queEs) => {
      // De pie y de frente (normal al frente): el +z de la figura sube y su +y mira a quien ve. El centro del globo de la
      // figura (en su espacio) se lleva a `centro`.
      const p: Pieza = { tipo: "decoracion", decoracion: globoConLunares({ ...g, helio: true }, dibujo, queEs) };
      const gl = armarPieza(p).globos[0]!;
      const c = mas(gl.nudo, por(gl.direccion, centroCuerpo("redondo", g.infladoCm)));
      pieza(id, nombre, p, menos(centro, v(c.x, c.z, c.y)), AL_FRENTE);
      nudos.push(menos(centro, v(0, centroCuerpo("redondo", g.infladoCm), 0)));
    },
    foil: (id, nombre, m, centro, conCinta = true) => {
      const p: Pieza = { tipo: "metalizado", metalizado: m };
      const caja = armarPieza(p).caja;
      const base = v(centro.x, r2(centro.y - (caja.max.y - caja.min.y) / 2), centro.z);
      // Normal arriba y el giro de la varilla: el panel queda de frente y sin espejo.
      pieza(id, nombre, p, base, ARRIBA, GIRO_VARILLA);
      if (conCinta) nudos.push(base);
    },
    nivel: (id, nombre, p, centro, giroGrados) => pieza(id, nombre, p, centro, ARRIBA, GIRO_VARILLA - giroGrados),
    trazo: (id, nombre, t, partes, origen, queEs, normal = AL_FRENTE) => {
      const p: Pieza = { tipo: "decoracion", decoracion: trazos(t, partes, queEs) };
      // La figura se apoya en z = 0 (su arriba, que con una normal horizontal es el del mundo): su (0, 0) sube lo que
      // bajaba el punto más bajo, más medio grosor.
      pieza(id, nombre, p, menos(origen, v(0, subidaDeTrazos(t, partes), 0)), normal);
    },
    palito: (id, nombre, t, desde, hasta) => {
      const d = menos(hasta, desde);
      const n = unitario(d);
      const p: Pieza = { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: t.formatoId, grosorCm: t.grosorCm, codigos: [t.codigo], cantidad: 2, estilo: "burbuja", largoCm: r2(largo(d)), anchoCm: t.grosorCm, aperturaGrados: -90, giroGrados: 0 }, interior: null, corona: null, centro: null } } };
      pieza(id, nombre, p, mas(desde, por(n, bajoOrigen(p))), n);
    },
    escenografia: (id, nombre, elementos) => {
      const local = elementos.map((e): ElementoEscenografia => {
        if (e.en) return { ...e, en: { origen: aVarilla(e.en.origen), ejeX: dirAVarilla(e.en.ejeX), ejeY: dirAVarilla(e.en.ejeY) } };
        if (e.forma === "cilindro") return { ...e, base: aVarilla(e.base) };
        if (e.forma === "caja") return { ...e, centro: aVarilla(e.centro) };
        return e;
      });
      const p: Pieza = { tipo: "escenografia", elementos: local };
      const bajo = bajoOrigen(p);
      nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: "varilla", puntoCm: v(0, r2(-bajo + HUNDIDO), 0), normal: ARRIBA, giroGrados: GIRO_VARILLA } });
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
 * La idea con su número, ocasiones y foto de su fuente, y sus productos calculados la primera vez que se piden (salen de
 * armar la escena). Las ocasiones salen de las etiquetas con `ocasionesDeEtiquetas`, que vive en `index.ts` (que importa
 * este lote): se calculan al leerlas, como en los lotes 06, 09 y 12.
 */
function idea(numero: number, slug: string, nombre: string, escena: () => Escena, nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  if (f.numero !== numero) throw new Error(`«${slug}» es la #${f.numero}, no la #${numero}.`);
  // Perezosa (ver «Patrón perezoso» en tipos.ts): la escena se arma la primera vez que se pide.
  return ideaPerezosa({
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
  }, () => ({ tipo: "escena", escena: escena() }), () => productosDe(escena(), publicados));
}

// Colores de cinta.
const CINTA_BLANCA = "#ececec";

// ----------------------------------------------------------------------------------------------------------
// 219 · Búho
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 de helio miden ~82 px (28 cm): 2,93 px/cm, con la mesa en y = 555 px y el eje en x = 370.
 * Base: cuarteto de R-5 verde trébol (~40 px: 13 cm; se ven 2). El búho (de 385 a 512 px: 43 cm) dentro de un aro de
 * T-260 rosado de ~118 px (40 cm): cabeza y cuerpo amarillo miel, panza fucsia, ojos, pico, orejas, moño fucsia arriba a
 * la derecha y patas rojas. Helio, uno por piso: verde (centro a 104 cm), fucsia con lunares amarillos (138) y amarillo
 * con lunares fucsia (169). Medidos: amarillo #efd204 → Amarillo Miel 021 (ΔE 9); fucsia #ff247f → Fucsia 012 (el
 * Fashion a 2 del Metal); verde #00bf01 → Verde Trébol 029; aro #f182ba → T-260 Rosa 011; patas y pico #fd1400 → Rojo 015.
 */
const escena219 = perezoso((): Escena => {
  const f = foto(370, 555, 2.93);
  const VERDE = "029", AMARILLO = "021", FUCSIA = "012", ROSA = "011", ROJO = "015";
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-5 verde trébol", pieza: cuarteto(R("R-5", 12.5, VERDE), [VERDE]), origen: v(0, 6.5, 0) },
    { nombre: "Varilla del búho", base: v(0, 0, 0), altoCm: 58, radioCm: 0.5, hex: "#e8e8e8" },
  );
  // El búho: el moño va a su izquierda en la figura (a la derecha de quien mira: el marco de un ancla es de mano izquierda).
  const buho = figura({
    queEs: "a balloon owl: yellow round body with a fuchsia belly, big black eyes, tiny ears, a pink bow and red feet, inside a pink twisted-balloon ring",
    base: [{ formatoId: "R-5", infladoCm: 7, codigos: [ROJO], cantidad: 2 }],
    cuerpo: [{ tipo: "globo", globo: R("R-12", 25, AMARILLO) }],
    cabeza: { ...R("R-12", 22, AMARILLO), cara: { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#141414" } } },
    accesorios: [
      { en: "barriga", corrimientoCm: [0, -1, 3], forma: { tipo: "globo", globo: R("R-9", 15, FUCSIA), anguloGrados: 90, adelanteGrados: 90 } },
      { en: "coronilla", par: true, corrimientoCm: [6, 0, -2], forma: { tipo: "orejas", estilo: "burbuja", tubito: T("T-260", 3.5, AMARILLO), largoCm: 6, anguloGrados: 70 } },
      { en: "cara", corrimientoCm: [0, 1, -2], forma: { tipo: "pico", abanico: { ...T("T-260", 3, ROJO), estilo: "burbujas", cantidad: 1, largoCm: 4, aberturaGrados: 0 }, anguloGrados: -40 } },
      { en: "coronilla", corrimientoCm: [-9, 1, -3], forma: { tipo: "mono", lazos: { ...T("T-260", 3, FUCSIA), largoCm: 5, anchoCm: 4 }, globos: null, centro: R("R-5", 5.5, FUCSIA) } },
      { en: "base", corrimientoCm: [0, -3, 19], forma: { tipo: "aro", tubito: T("T-260", 3, ROSA), radioCm: 19, plano: "frente", desdeGrados: 0, hastaGrados: 360 } },
    ],
  });
  m.deco("buho", "Búho amarillo y fucsia en su aro rosado", buho, v(0, 13, 1), AL_FRENTE);
  m.helio("helio-verde", "R-12 verde trébol con helio (piso 1)", R("R-12", 28, VERDE), f(377, 250));
  m.helioConLunares("helio-fucsia", "R-12 fucsia con lunares amarillos (piso 2)", R("R-12", 28, FUCSIA), f(368, 150), { estilo: "puntos", hex: "#ffd21a", cantidad: 11 }, "a fuchsia balloon with yellow polka dots");
  m.helioConLunares("helio-amarillo", "R-12 amarillo miel con lunares fucsia (piso 3)", R("R-12", 28, AMARILLO), f(345, 60), { estilo: "puntos", hex: "#f2207c", cantidad: 11 }, "a yellow balloon with fuchsia polka dots");
  m.cintas(f(370, 380, -2), CINTA_BLANCA);
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 232 · Calabaza
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570, sin globo de referencia: el grosor del T-260 (~25 px a ~4,3 cm) da 5,8 px/cm, con la mesa en y = 552
 * px y el eje en x = 362. Racimo de 7: un R-18 naranja al centro (~195 px: 34 cm) y 6 R-12 alrededor (los de los lados
 * ~140 px: 24 cm; arriba 120 y abajo 105 px, medio tapados); ojos de triángulo (lados de ~17 cm) y boca en arco de 50 cm
 * de T-260 negro; tallo de T-260 verde: dos tallos cortos, un rulo con un zarcillo largo a la izquierda y otro en
 * diagonal a la derecha; un trío de R-5 verde selva arriba. Medidos: naranja #ff7b23 → Naranja 061; negro → 080; verde
 * de los tubitos #009140 → Metal Verde 530 (el Fashion Verde Selva queda a 11 ΔE); R-5 verde #00762f → Verde Selva 032.
 */
const escena232 = perezoso((): Escena => {
  const f = foto(362, 552, 5.8);
  const NARANJA = "061", NEGRO = "080", VERDE_T = "530", VERDE_R5 = "032";
  const C = f(362, 385);
  const racimo: Pieza = { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: { petalos: { ...R("R-12", 24, NARANJA), cantidad: 6, aperturaGrados: 0, giroGrados: 0 }, centro: { ...R("R-18", 34, NARANJA), cantidad: 1 } } } };
  const m = montaje(
    { id: "racimo", nombre: "Racimo de calabaza: R-18 naranja al centro y 6 R-12", pieza: racimo, origen: C },
    { nombre: "Amarre del racimo (escondido detrás)", base: v(C.x, r2(C.y - 2), -16), altoCm: 3, radioCm: 0.3, hex: "#d06a2a" },
  );
  const negro = T("T-260", 4.3, NEGRO);
  // Ojos: triángulos con la punta arriba (de la foto), apoyados en los R-12 de los lados.
  const triangulo = (lado: number): TrazoFrente[] => [{ tipo: "linea", puntos: [[-lado / 2, 0], [lado / 2, 0], [0, r2(lado * 0.8)], [-lado / 2, 0]] }];
  m.trazo("ojo-izquierdo", "Ojo de triángulo de T-260 negro (izquierda)", negro, triangulo(16), f(245, 345, 14), "a black twisted-balloon triangle eye");
  m.trazo("ojo-derecho", "Ojo de triángulo de T-260 negro (derecha)", negro, triangulo(17), f(535, 345, 14), "a black twisted-balloon triangle eye");
  // Boca: arco de 50 cm de cuerda y 5 de flecha (radio ~65 cm, 45° de arco), centrado bajo el eje.
  m.trazo("boca", "Boca en arco de T-260 negro", negro, [{ tipo: "arco", centro: [0, 65], radioCm: 65, desdeGrados: 247.5, hastaGrados: 292.5 }], f(325, 497, 22), "a black twisted-balloon smile");
  // Tallo: dos tallos cortos en V, el rulo con su zarcillo largo a la izquierda y el zarcillo en diagonal a la derecha.
  const verde = T("T-260", 4.3, VERDE_T);
  const P0 = f(362, 205);
  const pt = (x: number, y: number): readonly [number, number] => { const q = f(x, y); return [r2(q.x - P0.x), r2(q.y - P0.y)]; };
  m.trazo("tallo", "Tallo y zarcillos de T-260 verde", verde, [
    { tipo: "linea", puntos: [pt(362, 205), pt(345, 150), pt(335, 95)] },
    { tipo: "linea", puntos: [pt(370, 205), pt(380, 160), pt(430, 95), pt(505, 40)] },
    { tipo: "arco", centro: pt(345, 62), radioCm: 6, desdeGrados: -90, hastaGrados: 200 },
    { tipo: "linea", puntos: [pt(330, 85), pt(260, 115), pt(170, 130)] },
  ], P0, "a green twisted-balloon pumpkin stem with curly tendrils");
  m.deco("hojas", "Trío de R-5 verde selva del tallo", { tipo: "flor", propiedades: { petalos: { ...R("R-5", 9, VERDE_R5), cantidad: 3, aperturaGrados: 35, giroGrados: 90 }, centro: null } }, f(375, 200, -2), ARRIBA);
  return m.escena(sala(300, 260, 220));
});

// ----------------------------------------------------------------------------------------------------------
// 233 · Calabazas apiladas
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 de helio miden ~90 px (28 cm): 3,2 px/cm, con la mesa en y = 555 px y el eje en x = 372.
 * Base: cuarteto R-5 de ~35 px (11 cm) con un violeta al frente y verde lima a los lados. Encima, tres calabacitas de
 * ~70 px (R-9 a 21 cm) apiladas en zigzag: negra con cara amarilla (centro a 17 cm), naranja con cara negra (30) y negra
 * con cara amarilla (47), cada una con su tallo de lazos verde lima. Helio, por pisos: 2 naranja impresos (100 y 106 cm)
 * y 2 negros impresos (131 y 150), con cintas lila. Medidos: violeta #312565 → Violeta 051; verde #83b65b → Verde Lima
 * 031; naranja #eb7b36 → Naranja 061; negro → 080.
 */
const escena233 = perezoso((): Escena => {
  const f = foto(372, 555, 3.2);
  const VIOLETA = "051", LIMA = "031", NARANJA = "061", NEGRO = "080";
  const HALLOWEEN = "2-caras-happy-halloween-fashion-surtido-negro-naranja";
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-5 violeta y verde lima", pieza: cuarteto(R("R-5", 11, VIOLETA), [VIOLETA, LIMA], "dos_colores"), origen: v(0, 5.5, 0), giroGrados: 45 },
    { nombre: "Varilla de las calabazas", base: v(0, 0, 0), altoCm: 52, radioCm: 0.5, hex: "#e8e8e8" },
  );
  const calabaza = (codigo: string, cara: string): Decoracion => ({ tipo: "calabaza", propiedades: { globo: R("R-9", 21, codigo), cara: { hex: cara }, tallo: { ...T("T-260", 3, LIMA), lazos: 2, largoLazoCm: 7, zarcillos: false } } });
  m.deco("calabaza-abajo", "Calabacita negra de cara amarilla (abajo)", calabaza(NEGRO, "#f4c21c"), f(380, 500, 0), AL_FRENTE);
  m.deco("calabaza-medio", "Calabacita naranja de cara negra (en medio)", calabaza(NARANJA, "#1b1b1f"), f(340, 460, -2), AL_FRENTE);
  m.deco("calabaza-arriba", "Calabacita negra de cara amarilla (arriba)", calabaza(NEGRO, "#f4c21c"), f(320, 405, -4), AL_FRENTE);
  m.helio("helio-naranja-1", "R-12 naranja «Happy Halloween» con helio (piso 1)", R("R-12", 28, NARANJA), f(425, 235, -4), HALLOWEEN, unitario(v(0.12, 1, 0)));
  m.helio("helio-naranja-2", "R-12 naranja «Happy Halloween» con helio (piso 2)", R("R-12", 28, NARANJA), f(340, 215, 2), HALLOWEEN, unitario(v(-0.1, 1, 0)));
  m.helio("helio-negro-1", "R-12 negro «Happy Halloween» con helio (piso 3)", R("R-12", 28, NEGRO), f(395, 135, -6), HALLOWEEN, unitario(v(0.1, 1, 0)));
  m.helio("helio-negro-2", "R-12 negro «Happy Halloween» con helio (piso 4)", R("R-12", 28, NEGRO), f(300, 75, -2), HALLOWEEN, unitario(v(-0.15, 1, 0)));
  m.cintas(f(375, 430, -3), "#9b7fc8", "Cintas lila del helio");
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 237 · Canasta de amor
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el R-12 rojo mide ~100 px (28 cm): 3,57 px/cm, con la mesa en y = 555 px y el eje en x = 360. El
 * florero (27 × 39 cm) es de globitos blancos de ~25 px (R-5 a 7 cm) en anillos. Encima, tres flores de 5 R-5 (~24 cm)
 * con centro verde lima: roja (izquierda, 53 cm), rosa (derecha, delante) y rosada (arriba, detrás, 66 cm), con tallos
 * y hojas de T-260 verde. Helio: rojo con corazón (99 cm), rosado con corazones (95) y cristal arriba (139), cintas
 * blancas. Medidos: rojo #dd3036 → Rojo 015; rosa #e94086 → Rosa 011 (el Fashion más cercano); rosado #f1cbdc → Rosado
 * 009; centro #71da82 → Verde Lima 031; el de arriba es Cristal 390 con letras blancas.
 */
const escena237 = perezoso((): Escena => {
  const f = foto(360, 555, 3.57);
  const BLANCO = "005", ROJO = "015", ROSA = "011", ROSADO = "009", LIMA = "031";
  const florero: Pieza = { tipo: "forma", forma: { clase: "cono", altoCm: 39, tecnica: "anillos", formatoId: "R-5", infladoBaseCm: 7, infladoPuntaCm: 7, globosBase: 10, globosPunta: 10, colores: { codigos: [BLANCO], patron: "un_color" } } };
  const m = montaje(
    { id: "florero", nombre: "Florero de anillos de R-5 blanco", pieza: florero, origen: v(0, 0, 0) },
    { nombre: "Varilla de las flores", base: v(0, 0, 0), altoCm: 46, radioCm: 0.5, hex: "#e8e8e8" },
  );
  const flor = (codigo: string): Decoracion => ({ tipo: "flor", propiedades: { petalos: { ...R("R-5", 9, codigo), cantidad: 5, aperturaGrados: 8, giroGrados: 90 }, centro: { ...R("R-5", 6, LIMA), cantidad: 1 } } });
  const tallo = T("T-260", 4, LIMA);
  m.palito("tallo-roja", "Tallo de T-260 verde lima (flor roja)", tallo, v(-2, 37, 0), f(325, 372, 0));
  m.palito("tallo-rosa", "Tallo de T-260 verde lima (flor rosa)", tallo, v(2, 37, 1), f(380, 372, 2));
  m.palito("tallo-rosada", "Tallo de T-260 verde lima (flor rosada)", tallo, v(0, 37, -2), f(365, 325, -3));
  m.deco("flor-roja", "Flor de 5 R-5 rojo", flor(ROJO), f(325, 365, 1), unitario(v(-0.2, 0.1, 1)));
  m.deco("flor-rosa", "Flor de 5 R-5 rosa", flor(ROSA), f(380, 365, 4), unitario(v(0.15, 0.05, 1)));
  m.deco("flor-rosada", "Flor de 5 R-5 rosado", flor(ROSADO), f(365, 318, -3), unitario(v(0, 0.3, 1)));
  m.helio("helio-rosado", "R-12 rosado con corazones con helio (piso 1)", R("R-12", 28, ROSADO), f(420, 215, -4), "infinity-corazones-modernos-fashion-surtido", unitario(v(0.15, 1, 0)));
  m.helio("helio-rojo", "R-12 rojo con corazón con helio (piso 2)", R("R-12", 28, ROJO), f(320, 200, 2), "infinity-love-fashion-surtido", unitario(v(-0.15, 1, 0)));
  m.helio("helio-cristal", "R-12 cristal con helio (piso 3)", R("R-12", 28, "390"), f(370, 60, -2));
  m.cintas(f(360, 300, -2), CINTA_BLANCA);
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 264 · Celebrando a papá (y 303 · Centro de mesa para papá: la misma pieza)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000 (la de #303, 1000×1500, es de la misma sesión); el R-12 mostaza de helio mide ~160 px (28 cm): 5,7
 * px/cm, con la mesa en y = 965 px y el eje en x = 462. Caja cilíndrica azul rey de lunares blancos (22 × 17,5 cm) y
 * encima: el corazón de R-5 Reflex Azul (~5,5 cm) con 2 Reflex Plata, 12 R-5 mostaza (~8,5 cm; 10 se ven) en dos
 * racimos a los lados, y dos R-12 «Feliz Día» de bigote a 21 cm (plata a la izquierda, azul a la derecha). Una varilla
 * blanca sube a la burbuja: R-18 Cristal de ~40 cm con el R-12 azul «Feliz Día Papá» dentro (centro a 66 cm), el
 * corbatín negro bajo la burbuja y el bombín negro arriba a la derecha. Helio: mostaza (116 cm), azul rey (117) y plata
 * «Feliz Día» (146), con cintas azules. Colores: los publicados (Mostaza 023, Azul Rey 041, Negro 080, Cristal 390; el
 * impreso de bigotes en Reflex Azul 940 y Plata 981).
 */
const escena264 = perezoso((): Escena => {
  const f = foto(462, 965, 5.7);
  const MOSTAZA = "023", AZUL = "940", PLATA = "981", AZUL_REY = "041", NEGRO = "080";
  const BIGOTES = "2-caras-feliz-dia-bigotes-reflex-surtido";
  const m = montaje(
    { id: "corazon", nombre: "Corazón de la base: cuarteto R-5 Reflex Azul", pieza: cuarteto(R("R-5", 6, AZUL), [AZUL]), origen: v(0, 21, 0), giroGrados: 45 },
    { nombre: "Varilla blanca de la burbuja", base: v(0, 17.5, 0), altoCm: 30, radioCm: 0.6, hex: "#f4f4f4" },
  );
  m.escenografia("caja", "Caja cilíndrica azul de lunares", [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 11, altoCm: 17.5, hex: "#1d56a8", acabado: "papel", motivo: { dibujo: "lunares", hex: "#ffffff" } }]);
  // Los R-5 Reflex Azul y Plata que asoman entre los mostaza (además del cuarteto).
  const azules: ReadonlyArray<readonly [number, number, number]> = [[445, 775, 2], [480, 772, -2], [438, 805, 5], [495, 800, 4], [432, 852, 6], [492, 856, 6]];
  azules.forEach(([x, y, z], k) => m.globo(`azul-${k + 1}`, `R-5 Reflex Azul ${k + 1}`, R("R-5", 5.5, AZUL), f(x, y, z), unitario(v((x - 462) * 0.02, 0.6, z * 0.1))));
  m.globo("plata-1", "R-5 Reflex Plata 1", R("R-5", 5.5, PLATA), f(468, 835, 7), haciaFuera(10, 20));
  m.globo("plata-2", "R-5 Reflex Plata 2", R("R-5", 5.5, PLATA), f(482, 862, 6), haciaFuera(30, 0));
  // Los 12 mostaza: dos racimos a los lados, uno delante y dos detrás (no se ven).
  const mostazas: ReadonlyArray<readonly [number, number, number]> = [
    [378, 797, 3], [352, 838, 5], [403, 838, 8], [362, 868, 4], [330, 822, -3],
    [515, 800, 3], [500, 840, 8], [555, 830, 5], [585, 845, -2], [540, 870, 5],
    [447, 830, 10], [462, 800, -9],
  ];
  mostazas.forEach(([x, y, z], k) => m.globo(`mostaza-${k + 1}`, `R-5 mostaza ${k + 1}`, R("R-5", 8.5, MOSTAZA), f(x, y, z), unitario(v((x - 462) * 0.03, 0.5, z * 0.1))));
  m.globo("feliz-dia-plata", "R-12 Reflex Plata «Feliz Día» de bigote (izquierda)", R("R-12", 21, PLATA), f(328, 745, 0), unitario(v(-0.55, 0.85, 0.1)), BIGOTES);
  m.globo("feliz-dia-azul", "R-12 Reflex Azul «Feliz Día» de bigote (derecha)", R("R-12", 21, AZUL), f(588, 738, 0), unitario(v(0.55, 0.85, 0.1)), BIGOTES);
  // La burbuja: el nudo en lo alto de la varilla; el globo de dentro lleva el impreso (índice 1: el 0 es el de fuera).
  const burbuja: Pieza = {
    tipo: "decoracion",
    decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-18", 40, "390"), interiores: [{ formatoId: "R-12", infladoCm: 30, codigos: [AZUL_REY], cantidad: 1 }], relleno: null, semilla: 264 } },
    impresos: [{ impresoId: "infinity-r-feliz-dia-papa-oeste-fashion-surtido", globos: [1] }],
  };
  m.pieza("burbuja", "Burbuja R-18 cristal con el R-12 azul «Feliz Día Papá» dentro", burbuja, v(0, 45, 0), AL_FRENTE);
  m.deco("corbatin", "Corbatín de T-260 negro", { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 4.5, codigo: NEGRO, lazosPorLado: 1, largoLazoCm: 7, anchoLazoCm: 6, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: R("R-5", 5.5, NEGRO) } }, f(460, 728, 6), AL_FRENTE);
  m.globo("corbatin-plata-1", "R-5 Reflex Plata del corbatín (izquierda)", R("R-5", 6, PLATA), f(415, 740, 2), haciaFuera(-80, 0));
  m.globo("corbatin-plata-2", "R-5 Reflex Plata del corbatín (derecha)", R("R-5", 6, PLATA), f(503, 740, 2), haciaFuera(80, 0));
  // El bombín, ladeado, en la cinta de la derecha (en la figura se inclina al otro lado: espejo del marco).
  const bombin = figura({ queEs: "a black twisted-balloon bowler hat", accesorios: [{ en: "base", corrimientoCm: [0, 0, 2], forma: { tipo: "sombrero", ala: { ...T("T-260", 4.5, NEGRO), estilo: "aro", radioCm: 9 }, copa: { globo: R("R-9", 13, NEGRO) }, cinta: null, pompon: null, inclinacionGrados: 18 } }] });
  m.deco("bombin", "Bombín de T-260 y R-9 negro", bombin, f(530, 515, 2), AL_FRENTE);
  m.helio("helio-mostaza", "R-12 mostaza con helio (piso 1, izquierda)", R("R-12", 28, MOSTAZA), f(392, 305, -2), undefined, unitario(v(-0.12, 1, 0)));
  m.helio("helio-azul-rey", "R-12 azul rey con helio (piso 1, derecha)", R("R-12", 28, AZUL_REY), f(543, 297, -4), undefined, unitario(v(0.12, 1, 0)));
  m.helio("helio-plata", "R-12 Reflex Plata «Feliz Día» de bigote con helio (piso 2)", R("R-12", 28, PLATA), f(485, 135, -6), BIGOTES);
  m.cintas(v(0, 86, -2), "#3fa3d8", "Cintas azules del helio");
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 274 · Centro de mesa corazón
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 blancos de helio miden ~90 px (28 cm): 3,2 px/cm, con la mesa en y = 555 px y el eje en x =
 * 370. El corazón (218 × 170 px: 68 × 53 cm) relleno de R-5 rojo de ~25 px (7,8 cm) al tresbolillo, con la punta a 16 cm,
 * enmarcado por un contorno de T-260 blanco (73 × 60 cm); debajo, la base de R-9 blanco (~50 px: 16 cm; se ven 2).
 * Helio: 2 blancos «Feliz Día Mamá» (111 y 117 cm) y el rojo «Te amo» arriba (147, ~73 px: 23 cm). Medidos: rojo
 * #fd0201 → Rojo 015; los blancos, en sombra #dad0cf, son Fashion Blanco 005 (en la luz #ffffff).
 */
const escena274 = perezoso((): Escena => {
  const f = foto(370, 555, 3.2);
  const ROJO = "015", BLANCO = "005";
  const corazon: Pieza = { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 66, altoCm: 52 }, tecnica: { tipo: "celdas", formatoId: "R-5", infladoCm: 7.6, celda: "tresbolillo" }, colores: { codigos: [ROJO], patron: "un_color" } } };
  const m = montaje(
    { id: "corazon", nombre: "Corazón relleno de R-5 rojo", pieza: corazon, origen: v(0, 14.5, 0) },
    { nombre: "Varilla del corazón", base: v(0, 0, -7), altoCm: 66, radioCm: 0.6, hex: "#e8e8e8" },
  );
  m.nivel("base", "Base: cuarteto R-9 blanco", cuarteto(R("R-9", 16, BLANCO), [BLANCO]), v(0, 8, -2), 0);
  m.trazo("contorno", "Contorno de corazón de T-260 blanco", T("T-260", 3, BLANCO), [{ tipo: "linea", puntos: contornoCorazon(73, 60, 18) }], v(0, 12, 2), "a white twisted-balloon heart outline");
  m.helio("helio-mama-1", "R-12 blanco «Feliz Día Mamá» con helio (piso 1)", R("R-12", 28, BLANCO), f(412, 200, -2), "infinity-feliz-dia-mama-corazones-fashion-surtido-rojo-blanco", unitario(v(0.12, 1, 0)));
  m.helio("helio-mama-2", "R-12 blanco «Feliz Día Mamá» con helio (piso 2)", R("R-12", 28, BLANCO), f(345, 180, -5), "infinity-feliz-dia-mama-corazones-fashion-surtido-rojo-blanco", unitario(v(-0.12, 1, 0)));
  m.helio("helio-te-amo", "R-12 rojo de amor con helio (piso 3; «Te amo» en la foto)", R("R-12", 23, ROJO), f(380, 85, -4), "infinity-i-love-you-moderno-fashion-rojo");
  m.cintas(f(370, 345, -6), CINTA_BLANCA);
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 277 · Centro de mesa cristal
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 rojos de helio miden ~90 px (28 cm): 3,2 px/cm, con la mesa en y = 555 px y el eje en x =
 * 372. Base de R-5 blanco (~30 px: 9,5 cm): un cuarteto con un globo al frente y otro encima (se ven 5). Encima, un R-12
 * Cristal de ~19 cm con un corazón rojo dentro (~14 cm) y, alrededor, el contorno de corazón de T-260 rojo, ancho y bajo
 * (68 × 38 cm, la punta a 16 cm). Helio: blanco (86 cm), rojo con corazones (122) y rojo «Feliz Día» (153), cintas
 * rosadas. Medidos: rojos #f6090f → Rojo 015; blanco en sombra #e0d5d4 → Blanco 005.
 */
const escena277 = perezoso((): Escena => {
  const f = foto(372, 555, 3.2);
  const BLANCO = "005", ROJO = "015";
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-5 blanco", pieza: cuarteto(R("R-5", 9.5, BLANCO), [BLANCO]), origen: v(0, 5.5, 0), giroGrados: 45 },
    { nombre: "Varilla del corazón", base: v(0, 0, 0), altoCm: 42, radioCm: 0.5, hex: "#e8e8e8" },
  );
  m.nivel("base-arriba", "Base: cuarteto R-5 blanco de arriba", cuarteto(R("R-5", 8.5, BLANCO), [BLANCO]), v(0, 12.5, 0), 0);
  const burbuja: Pieza = { tipo: "decoracion", decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-12", 19, "390"), interiores: [{ formatoId: "C-12", infladoCm: 13, codigos: [ROJO], cantidad: 1 }], relleno: null, semilla: 277 } } };
  m.pieza("burbuja", "R-12 cristal con un corazón rojo dentro", burbuja, v(0, 17.5, 1), AL_FRENTE);
  // Contorno: corazón ancho y bajo (68 × 38), la punta a 16 cm; los lóbulos llegan a 52.
  const contorno = contornoCorazon(68, 37, 20).map(([x, y]): [number, number] => [x, y]);
  m.trazo("contorno", "Contorno de corazón de T-260 rojo", T("T-260", 3, ROJO), [{ tipo: "linea", puntos: contorno }], v(0, 15.6, 2), "a red twisted-balloon heart outline");
  m.helio("helio-blanco", "R-12 blanco con helio (piso 1)", R("R-12", 26, BLANCO), f(330, 280, -2), undefined, unitario(v(-0.15, 1, 0)));
  m.helio("helio-corazones", "R-12 rojo con corazones con helio (piso 2)", R("R-12", 28, ROJO), f(363, 165, -4), "infinity-corazones-por-siempre-fashion-rojo");
  m.helio("helio-feliz-dia", "R-12 rojo «Feliz Día» con helio (piso 3)", R("R-12", 28, ROJO), f(375, 65, -4), "infinity-feliz-dia-corazones-brillantes-metal-surtido");
  m.cintas(f(372, 425, -2), "#f2a7c3", "Cintas rosadas del helio");
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 285 · Centro de mesa feliz cumpleaños
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el R-12 verde de helio mide ~92 px (28 cm): 3,3 px/cm, con la mesa en y = 555 px y el eje en x = 365.
 * Base de cuartetos: R-12 violeta de ~70 px (21 cm; se ven 3), R-5 amarillo (~12 cm) y R-5 naranja encima; un moño
 * grande de 4 lazos de T-260 verde lima (de 30 cm por lado); dos flores de 5 lazos (rosa y azul caribe, ~23 cm) con sus
 * tallos y dos hojas largas. Helio por pisos: naranja con lunares violeta (82 cm), verde con lunares azules (96), violeta
 * con lunares naranja (117) y el metalizado «Feliz cumpleaños» redondo arriba (~110 px: 33 cm, centro a 152). Medidos:
 * violeta #553e99 → Violeta 051; verde #99ce63 → Verde Lima 031; naranja #ff7c00 → Naranja 061; amarillo #f8dd05 →
 * Amarillo 020; flor rosa #ed6bab → Rosa 011; flor azul #0bc0e4 → Azul Caribe 038, que la tienda no vende en tubito: Azul 040 (a 3 ΔE).
 */
const escena285 = perezoso((): Escena => {
  const f = foto(365, 555, 3.3);
  const VIOLETA = "051", AMARILLO = "020", NARANJA = "061", LIMA = "031", ROSA = "011", AZUL = "040";
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-12 violeta", pieza: cuarteto(R("R-12", 21, VIOLETA), [VIOLETA]), origen: v(0, 11, 0), giroGrados: 45 },
    { nombre: "Varilla de las flores", base: v(0, 0, 0), altoCm: 40, radioCm: 0.5, hex: "#1f7a4a" },
  );
  m.nivel("amarillo", "Cuarteto R-5 amarillo", cuarteto(R("R-5", 12, AMARILLO), [AMARILLO]), v(0, 26.5, 0), 0);
  m.nivel("naranja", "Cuarteto R-5 naranja", cuarteto(R("R-5", 12, NARANJA), [NARANJA]), v(0, 34.5, 0), 45);
  m.deco("mono", "Moño de 4 lazos de T-260 verde lima", { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 4.5, codigo: LIMA, lazosPorLado: 2, largoLazoCm: 27, anchoLazoCm: 12, aberturaGrados: 26, colas: false, largoColaCm: 0, centro: null } }, v(0, 33, 6), AL_FRENTE);
  const flor = (codigo: string): Decoracion => ({ tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 3.5, codigos: [codigo], cantidad: 5, estilo: "lazo", largoCm: 10, anchoCm: 6, aperturaGrados: 6, giroGrados: 90 }, interior: null, corona: null, centro: null } });
  // Los tallos y las dos hojas largas: un solo trazo de T-260 desde el centro de la base.
  const pt = (x: number, y: number): readonly [number, number] => { const q = f(x, y); return [q.x, r2(q.y - 40)]; };
  m.trazo("tallos", "Tallos y hojas largas de T-260 verde lima", T("T-260", 3.5, LIMA), [
    { tipo: "linea", puntos: [[-1, 0], pt(338, 400), pt(325, 362)] },
    { tipo: "linea", puntos: [[1, 0], pt(372, 405), pt(378, 366)] },
    { tipo: "linea", puntos: [[0, 0], pt(352, 395), pt(345, 375)] },
    { tipo: "linea", puntos: [[2, 0], pt(395, 410), pt(400, 385)] },
  ], v(0, 40, 1), "green twisted-balloon flower stems");
  m.deco("flor-rosa", "Flor de 5 lazos de T-260 rosa", flor(ROSA), f(325, 355, 2), unitario(v(-0.1, 0.2, 1)));
  m.deco("flor-azul", "Flor de 5 lazos de T-260 azul", flor(AZUL), f(378, 360, 3), unitario(v(0.1, 0.2, 1)));
  m.helioConLunares("helio-naranja", "R-12 naranja con lunares violeta (piso 1)", R("R-12", 28, NARANJA), f(402, 285, -3), { estilo: "puntos", hex: "#5a3c9c", cantidad: 10 }, "an orange balloon with purple polka dots");
  m.helioConLunares("helio-verde", "R-12 verde lima con lunares azules (piso 2)", R("R-12", 28, LIMA), f(325, 237, -1), { estilo: "puntos", hex: "#2f6fd0", cantidad: 10 }, "a lime green balloon with blue polka dots");
  m.helioConLunares("helio-violeta", "R-12 violeta con lunares naranja (piso 3)", R("R-12", 28, VIOLETA), f(400, 170, -4), { estilo: "puntos", hex: "#f07a22", cantidad: 10 }, "a purple balloon with orange polka dots");
  m.foil("foil", "Metalizado «Feliz cumpleaños» redondo (piso 4)", { ...metalizadoDeTienda("festivo"), pulgadas: 14 }, f(373, 55, -6));
  m.cintas(v(0, 41, 0), CINTA_BLANCA);
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 292 · Centro de mesa mis quince
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570, sin helio: la estrella metalizada de 18" (~215 px: 45 cm) da 4,8 px/cm, con la mesa en y = 555 px y
 * el eje en x = 365. Columna: cuarteto de R-12 cristal con estrellas rosadas (~95 px: 20 cm; se ven 2 delante y 2
 * asoman), cuarteto R-12 rosa encima con uno al frente (centro a 35 cm) y 2 cristal más pequeños (~13 cm) arriba; una
 * vara con cintas rizadas rosadas, verdes y blancas sube a la estrella fucsia de 18" (base a 72 cm); al lado, una
 * mariposa de papel con una flor de tul. Medidos: rosa #ff64a8 → Rosa 011 (el Fashion más cercano: el mejor es Neón
 * Fucsia, 3 ΔE más cerca); la estrella, rosada vibrante.
 */
const escena292 = perezoso((): Escena => {
  const f = foto(365, 555, 4.8);
  const CRISTAL = "390", ROSA = "011";
  const ESTRELLAS = "infinity-estrellas-fashion-transparente";
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-12 cristal con estrellas", pieza: cuarteto(R("R-12", 21, CRISTAL), [CRISTAL], "un_color", [{ impresoId: ESTRELLAS, codigo: CRISTAL }]), origen: v(0, 11.5, 0) },
    { nombre: "Vara de la estrella", base: v(0, 0, 0), altoCm: 74, radioCm: 0.5, hex: "#e8e8e8" },
  );
  m.nivel("rosa", "Cuarteto R-12 rosa", cuarteto(R("R-12", 21, ROSA), [ROSA]), v(0, 33, 0), 45);
  m.globo("cristal-arriba-1", "R-12 cristal con estrellas de arriba (izquierda)", R("R-12", 13, CRISTAL), f(312, 310, 2), haciaFuera(-60, 40), ESTRELLAS);
  m.globo("cristal-arriba-2", "R-12 cristal con estrellas de arriba (detrás)", R("R-12", 13, CRISTAL), f(395, 305, -6), haciaFuera(150, 40), ESTRELLAS);
  m.foil("estrella", "Estrella metalizada rosada vibrante de 18\"", metalizadoDeTienda("estrella-rosada-vibrante"), f(352, 115, 0), false);
  // Cintas rizadas: zigzag alrededor de la vara, de 50 a 72 cm.
  const rizada = (hex: string, fase: number): ElementoEscenografia[] => Array.from({ length: 6 }, (_, k) => {
    const a = enAnillo(fase + 70 * k, 2.4, 50 + 3.8 * k), b = enAnillo(fase + 70 * (k + 1), 2.4, 50 + 3.8 * (k + 1));
    return cinta(mas(a, v(-2, 0, 0)), mas(b, v(-2, 0, 0)), hex, 0.35);
  });
  m.escenografia("cintas-rizadas", "Cintas rizadas rosadas, verdes y blancas", [...rizada("#e8457f", 0), ...rizada("#2e9b55", 120), ...rizada("#f5f5f5", 240)]);
  m.escenografia("mariposa", "Mariposa de papel brillante y flor de tul", [
    { forma: "panel", contorno: [{ x: 0, y: 0 }, { x: -7, y: 6 }, { x: -9, y: 1 }, { x: -4, y: -3 }], zCm: 0, grosorCm: 0.3, hex: "#b0124f", acabado: "brillante", en: { origen: f(420, 300, 6), ejeX: v(1, 0, 0), ejeY: v(0, 1, 0) } },
    { forma: "panel", contorno: [{ x: 0, y: 0 }, { x: 7, y: 6 }, { x: 9, y: 1 }, { x: 4, y: -3 }], zCm: 0, grosorCm: 0.3, hex: "#b0124f", acabado: "brillante", en: { origen: f(420, 300, 6), ejeX: v(1, 0, 0), ejeY: v(0, 1, 0) } },
    { forma: "cilindro", base: f(440, 290, 0), radioCm: 5, altoCm: 5, hex: "#ff4fa0", acabado: "tela", radioArribaCm: 2 },
  ]);
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 293 · Centro de mesa momento inolvidable
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; la bolita rosada del centro de cada flor mide ~115 px (R-5 a 12 cm): 9,6 px/cm, con la mesa en y =
 * 850 px y el eje en x = 500. Base: racimo bajo de R-5 fucsia (~120 px: 12,5 cm) de 1,05 m de ancho, más alto a la
 * derecha (54 cm) que a la izquierda (38). Encima, tres flores de 5 pétalos R-12 (~42 cm) con centro R-5 rosado: dos
 * Orquídea Morada abajo (centros a 19 y 20 cm) y una Lavanda arriba, detrás (56 cm). Detrás asoman tres rizos de T-260
 * rosado: el gancho de la derecha (sube 20 cm y se dobla en arco de 13 cm de radio), la «C» con rulo de la izquierda y
 * otra «C» detrás. Colores: los publicados (Fucsia 012, Orquídea Morada 056, Pastel Dusk Lavanda 150, Rosado 009 y T-260
 * Rosado 009); la foto mide fucsia #f176b4 (más cerca del Rosa 011) y se deja el publicado.
 */
const escena293 = perezoso((): Escena => {
  const f = foto(500, 850, 9.6);
  const FUCSIA = "012", ORQUIDEA = "056", LAVANDA = "150", ROSADO = "009";
  const mezcla: PuntoMezcla[] = [{ t: 0, pesos: { "R-5": 1 } }, { t: 1, pesos: { "R-5": 1 } }];
  const racimos: RacimoLibre[] = [
    { id: "izquierda", nombre: "Racimo de la izquierda", puntos: [v(-44, 15, 2), v(-30, 22, -2)], radioInicioCm: 14, radioFinCm: 15, mezcla, tapas: { inicio: true, fin: true } },
    { id: "centro", nombre: "Racimo del centro (detrás de las flores)", puntos: [v(-20, 24, -10), v(8, 30, -12)], radioInicioCm: 15, radioFinCm: 16, mezcla, tapas: { inicio: true, fin: true } },
    { id: "derecha", nombre: "Racimo de la derecha", puntos: [v(20, 26, -6), v(36, 36, -4), v(46, 24, 0)], radioInicioCm: 16, radioFinCm: 15, mezcla, tapas: { inicio: true, fin: true } },
  ];
  const colores: ColorOrganico[] = [{ codigo: FUCSIA, peso: 1 }];
  const base: Pieza = { tipo: "organico", opciones: { ...opcionesRacimosLibres({ racimos, colores, semilla: 293, suelo: true, relleno: [] }), inflados: { "R-5": 12 } }, flores: null };
  const nodos: NodoEscena[] = [{ id: "base", nombre: "Base: racimo bajo de R-5 fucsia", pieza: base, colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 } }];
  const sobre = (id: string, nombre: string, pieza: Pieza, punto: Vec3, normal: Vec3, giroGrados = 0) =>
    nodos.push({ id, nombre, pieza, colocacion: { en: "sobre", padreId: "base", puntoCm: redondo(punto), normal: redondo(unitario(normal)), giroGrados } });
  const flor = (codigo: string): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "flor", propiedades: { petalos: { ...R("R-12", 20, codigo), cantidad: 5, aperturaGrados: 4, giroGrados: 90 }, centro: { ...R("R-5", 12, ROSADO), cantidad: 1 } } } });
  sobre("flor-izquierda", "Flor de 5 R-12 Orquídea Morada (izquierda)", flor(ORQUIDEA), f(225, 670, 0), unitario(v(-0.1, 0.25, 1)), 8);
  sobre("flor-derecha", "Flor de 5 R-12 Orquídea Morada (derecha)", flor(ORQUIDEA), f(660, 655, 0), unitario(v(0.1, 0.25, 1)), -6);
  sobre("flor-arriba", "Flor de 5 R-12 Lavanda (arriba)", flor(LAVANDA), f(410, 310, -10), unitario(v(-0.05, 0.55, 1)), 0);
  // Los rizos: trazos de T-260 de frente (como los ve quien mira) con su (0, 0) en el punto de la foto, pegados detrás
  // de las flores (`sobre` los corre hacia delante hasta tocar la base).
  const tubitoRizo = T("T-260", 5, ROSADO);
  const rizo = (id: string, nombre: string, partes: TrazoFrente[], cero: Vec3, queEs: string) =>
    sobre(id, nombre, { tipo: "decoracion", decoracion: trazos(tubitoRizo, partes, queEs) }, menos(cero, v(0, subidaDeTrazos(tubitoRizo, partes), 0)), AL_FRENTE);
  rizo("rizo-derecha", "Rizo de T-260 rosado (gancho de la derecha)", [{ tipo: "linea", puntos: [[0, 0], [0.5, 20]] }, { tipo: "arco", centro: [13, 20], radioCm: 12.5, desdeGrados: -15, hastaGrados: 180 }], f(640, 450, -16), "a pink twisted-balloon hook curl");
  rizo("rizo-izquierda", "Rizo de T-260 rosado (la «C» con rulo de la izquierda)", [{ tipo: "arco", centro: [0, 0], radioCm: 9.5, desdeGrados: 20, hastaGrados: 260 }, { tipo: "linea", puntos: [[8.9, 3.2], [13, 6]] }], f(180, 285, -14), "a pink twisted-balloon C curl");
  rizo("rizo-detras", "Rizo de T-260 rosado (la «C» de detrás)", [{ tipo: "arco", centro: [0, 0], radioCm: 8, desdeGrados: 80, hastaGrados: 280 }], f(205, 400, -18), "a pink twisted-balloon C curl");
  return { sala: sala(), nodos };
});

// ----------------------------------------------------------------------------------------------------------
// 295 · Centro de mesa navidad (Jacob Megram)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000 (png recortado): los globitos de la base miden ~70 px y el copo metalizado ~440 px (≈ 81 cm): 5,4
 * px/cm, con la mesa en y = 935 px y el eje (la base de la derecha) en x = 545. Base: columna de 3 cuartetos R-9 (~15
 * cm) Satín Perla y Reflex Plata alternados (40 cm de alto) con la burbuja R-18 cristal (~45 cm) encima, con confeti
 * blanco y plata y 4 R-5 dentro. A la izquierda, un racimo bajo de R-5 perla, plata y cristal con el metalizado redondo
 * «Let it snow» (~26 cm) apoyado. Helio: 2 R-12 cristal Graffiti Invierno con un Reflex Plata dentro (79 y 71 cm), 2
 * R-12 perla (94 y 114) y el copo holográfico (centro a 136 cm), con cintas blancas; copos de escarcha (papel) alrededor.
 * Colores: los publicados (Satín Perla 406, Reflex Plata 981, Graffiti Invierno sobre Cristal 390).
 */
const escena295 = perezoso((): Escena => {
  const f = foto(545, 935, 5.4);
  const PERLA = "406", PLATA = "981", CRISTAL = "390";
  const INVIERNO = "infinity-graffiti-invierno-fashion-transparente";
  const columna: Pieza = { tipo: "columna", formatoId: "R-9", infladoCm: 15, alturaCm: 36, patron: "dos_colores", colores: [PERLA, PLATA] };
  const m = montaje(
    { id: "columna", nombre: "Base: columna de 3 cuartetos R-9 perla y plata", pieza: columna, origen: v(0, 7.5, 0) },
    { nombre: "Varilla de la base", base: v(0, 0, 0), altoCm: 40, radioCm: 0.5, hex: "#e8e8e8" },
  );
  const burbuja: Pieza = { tipo: "decoracion", decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-18", 45, CRISTAL), interiores: [{ formatoId: "R-5", infladoCm: 9, codigos: [PLATA, PERLA], cantidad: 4 }], relleno: { tipo: "confeti", colores: ["#ffffff", "#c9ccd1"], cantidad: 70 }, semilla: 295 } } };
  m.pieza("burbuja", "Burbuja R-18 cristal con confeti y 4 R-5 dentro", burbuja, v(2, 40.5, 0), AL_FRENTE);
  // El racimo de la izquierda: [x, y, z, código] (px de la foto; z a ojo).
  const racimo: ReadonlyArray<readonly [number, number, number, string]> = [
    [345, 822, 2, PLATA], [392, 805, 6, PERLA], [335, 862, 4, PERLA], [380, 880, 8, PERLA], [430, 878, 6, CRISTAL],
    [420, 835, 10, PLATA], [370, 845, -6, PLATA], [300, 860, -4, PERLA], [445, 840, -6, PERLA],
  ];
  racimo.forEach(([x, y, z, c], k) => m.globo(`racimo-${k + 1}`, `R-5 ${c === PLATA ? "Reflex Plata" : c === PERLA ? "Satín Perla" : "cristal"} del racimo ${k + 1}`, R("R-5", 8.5, c), f(x, y, z), unitario(v((x - 380) * 0.02, 0.6, z * 0.08))));
  m.foil("let-it-snow", "Metalizado redondo blanco «Let it snow»", { forma: { tipo: "redondo" }, pulgadas: 10, color: "blanco", impreso: { dibujo: "texto", texto: "LET it\nSnow", hex: "#1b1b1f" } }, f(420, 765, 8), false);
  // Helio: los dobles globos (cristal Graffiti Invierno con un Reflex Plata dentro), los perla y el copo.
  const doble = (exterior: number, interior: number, semilla: number): Pieza => ({
    tipo: "decoracion",
    decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-12", exterior, CRISTAL), interiores: [{ formatoId: "R-9", infladoCm: interior, codigos: [PLATA], cantidad: 1 }], relleno: null, semilla } },
    impresos: [{ impresoId: INVIERNO, globos: [0] }],
  });
  const helioDoble = (id: string, nombre: string, p: Pieza, centro: Vec3, d: number) => m.pieza(id, nombre, p, menos(centro, v(0, r2(centroCuerpo("redondo", d)), 0)), AL_FRENTE);
  helioDoble("doble-1", "R-12 cristal Graffiti Invierno con Reflex Plata dentro (izquierda)", doble(22, 16, 2951), f(300, 510, -4), 22);
  helioDoble("doble-2", "R-12 cristal Graffiti Invierno con Reflex Plata dentro (derecha)", doble(19, 14, 2952), f(420, 550, 4), 19);
  m.helio("helio-perla-1", "R-12 Satín Perla con helio (abajo)", R("R-12", 19, PERLA), f(420, 430, -4));
  m.helio("helio-perla-2", "R-12 Satín Perla con helio (arriba, detrás del copo)", R("R-12", 21, PERLA), f(330, 320, -12));
  m.globo("perlita", "R-5 Reflex Plata en la vara de los copos", R("R-5", 6, PLATA), f(335, 410, 2));
  m.foil("copo", "Copo de nieve metalizado holográfico (estrella plateada)", { forma: { tipo: "estrella" }, pulgadas: 32, color: "plata" }, f(400, 200, -8));
  m.cintas(f(395, 790, -2), CINTA_BLANCA);
  // Los copos de escarcha (picks de papel): estrellas planas plateadas alrededor de las bases.
  const copo = (c: Vec3, r: number): ElementoEscenografia => ({ forma: "panel", contorno: Array.from({ length: 12 }, (_, i) => { const a = (Math.PI * i) / 6, q = i % 2 ? r * 0.35 : r; return { x: r2(q * Math.cos(a)), y: r2(q * Math.sin(a)) }; }), zCm: 0, grosorCm: 0.2, hex: "#d6dbe2", acabado: "brillante", en: { origen: c, ejeX: v(1, 0, 0), ejeY: v(0, 1, 0) } });
  m.escenografia("copos", "Copos de escarcha (picks de papel)", [copo(f(300, 805, 10), 5), copo(f(650, 760, 6), 6), copo(f(690, 860, 8), 6), copo(f(345, 485, 6), 3.5), copo(f(395, 470, 4), 3)]);
  return m.escena(sala(360, 300, 280));
});

// ----------------------------------------------------------------------------------------------------------
// 298 · Centro de mesa niño
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 de helio miden ~95 px (28 cm): 3,4 px/cm, con la mesa en y = 553 px y el eje en x = 368.
 * Base: cuarteto R-12 azul «Es un niño» de ~75 px (22 cm; se ven 3, uno al frente) y encima un cuarteto R-12 blanco de
 * ~20 cm (se ven 2) con moños de cinta azul; tres biberones de tubito azul (~22 cm, tetina blanca) parados entre los
 * blancos. Helio: «Es un niño» (92 cm), blanco (119) y «Es un niño» arriba (147). Medidos: azul #38bee8 → Azul 040 (el
 * impreso de la tienda es Pastel Mate Azul 640); blanco #e0edf3 → Blanco 005 (a 6 del Cristal, que no es: es opaco).
 */
const escena298 = perezoso((): Escena => {
  const f = foto(368, 553, 3.4);
  const AZUL_IMPRESO = "640", BLANCO = "005", AZUL = "040";
  const NINO = "infinity-es-un-nino-estrella-pastel-mate-azul";
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-12 azul «Es un niño»", pieza: cuarteto(R("R-12", 22, AZUL_IMPRESO), [AZUL_IMPRESO], "un_color", [{ impresoId: NINO, codigo: AZUL_IMPRESO }]), origen: v(0, 11.5, 0), giroGrados: 45 },
    { nombre: "Varilla de los biberones", base: v(0, 0, 0), altoCm: 46, radioCm: 0.5, hex: "#e8e8e8" },
  );
  m.nivel("blancos", "Cuarteto R-12 blanco", cuarteto(R("R-12", 20, BLANCO), [BLANCO]), v(0, 32, 0), 0);
  const biberon: Decoracion = figura({
    queEs: "a small baby bottle made of a blue twisted balloon with a white nipple",
    cuerpo: [{ tipo: "tubito", tubito: T("T-360", 6.5, AZUL), largoCm: 18 }],
    accesorios: [
      { en: "coronilla", forma: { tipo: "globo", globo: R("R-5", 5.5, BLANCO), anguloGrados: 90 } },
      { en: "coronilla", par: true, corrimientoCm: [1.5, 0, -1], forma: { tipo: "orejas", estilo: "burbuja", tubito: T("T-260", 3, BLANCO), largoCm: 3.5, anguloGrados: 20 } },
    ],
  });
  m.deco("biberon-izquierda", "Biberón de T-360 azul (izquierda)", biberon, f(318, 380, -1), AL_FRENTE, -18);
  m.deco("biberon-derecha", "Biberón de T-360 azul (derecha)", biberon, f(388, 388, -3), AL_FRENTE, 14);
  m.deco("biberon-centro", "Biberón de T-360 azul (en medio)", biberon, f(365, 415, 4), AL_FRENTE, 0);
  // Moños de cinta azul (papel) entre los blancos.
  const mono = (c: Vec3): ElementoEscenografia[] => [
    { forma: "caja", centro: v(0, 0, 0), tamano: v(6, 3.5, 0.4), hex: "#3fb3e3", acabado: "satinado", en: { origen: mas(c, v(-3, 1, 0)), ejeX: v(0.9, 0.44, 0), ejeY: v(-0.44, 0.9, 0) } },
    { forma: "caja", centro: v(0, 0, 0), tamano: v(6, 3.5, 0.4), hex: "#3fb3e3", acabado: "satinado", en: { origen: mas(c, v(3, 1, 0)), ejeX: v(0.9, -0.44, 0), ejeY: v(0.44, 0.9, 0) } },
  ];
  m.escenografia("monos", "Moños de cinta azul", [...mono(f(300, 432, 10)), ...mono(f(392, 440, 12)), ...mono(f(440, 445, 6))]);
  m.helio("helio-nino-1", "R-12 «Es un niño» con helio (piso 1)", R("R-12", 28, AZUL_IMPRESO), f(372, 240, -2), NINO);
  m.helio("helio-blanco", "R-12 blanco con helio (piso 2)", R("R-12", 28, BLANCO), f(338, 150, -5));
  m.helio("helio-nino-2", "R-12 «Es un niño» con helio (piso 3)", R("R-12", 28, AZUL_IMPRESO), f(310, 55, -4), NINO, unitario(v(-0.12, 1, 0)));
  m.cintas(v(0, 44, -2), CINTA_BLANCA);
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 299 · Centro de mesa orgánica feliz cumpleaños terra
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; los R-12 impresos «Feliz cumpleaños» miden ~185 px (28 cm): 6,6 px/cm, con la mesa (el pedestal)
 * en y = 950 px y la vara en x = 510. Topiario: racimo de la base (64 × 41 cm) de R-12 terra y mostaza (~17–20 cm) con
 * R-5 Reflex Dorado de ~9 cm y hojas doradas; tallo de 9 R-5 Reflex Dorado chicos (~5,5 cm) en espiral sobre la vara;
 * racimo de arriba (67 cm de ancho, centro a ~89 cm) con un R-12 mostaza de ~29 cm al frente, terra, arena y dos Reflex
 * Dorado grandes, tres R-5 blancos, R-5 dorados y terra, y los dos impresos «Feliz cumpleaños» (terra y mostaza). El
 * «terra» de la foto (#8d4d41) no está en la tabla oficial: el más cercano es Café 074 (ΔE 14), que es además el color
 * del surtido del impreso que más se le parece; mostaza, arena y Reflex Dorado, los publicados; blancos #d9dad8 → Silk
 * Blanco Nácar 806.
 */
const escena299 = perezoso((): Escena => {
  const f = foto(510, 950, 6.6);
  const TERRA = "074", MOSTAZA = "023", ARENA = "071", DORADO = "970", BLANCO = "806";
  const TERRA_IMPRESO = "infinity-feliz-cumpleanos-terra-fashion-surtido";
  const m = montaje(
    { id: "base", nombre: "Base: cuarteto R-12 terra y mostaza", pieza: cuarteto(R("R-12", 18, TERRA), [TERRA, MOSTAZA], "dos_colores"), origen: v(0, 10, -4), giroGrados: 45 },
    { nombre: "Vara del topiario", base: v(0, 0, -4), altoCm: 70, radioCm: 0.5, hex: "#efe9de" },
  );
  type G = readonly [number, number, number, string, string, number];
  const NOMBRE: Readonly<Record<string, string>> = { [TERRA]: "terra (café)", [MOSTAZA]: "mostaza", [ARENA]: "arena", [DORADO]: "Reflex Dorado", [BLANCO]: "blanco nácar" };
  const poner = (prefijo: string, lista: readonly G[], centro: Vec3) => lista.forEach(([x, y, z, formato, codigo, d], k) => {
    const c = f(x, y, z);
    m.globo(`${prefijo}-${k + 1}`, `${formato} ${NOMBRE[codigo]} (${prefijo} ${k + 1})`, R(formato, d, codigo), c, unitario(mas(menos(c, centro), v(0, 2, 0))));
  });
  // Racimo de la base: [x, y, z, formato, código, inflado].
  const C_BASE = f(450, 820, -4);
  poner("base", [
    [335, 715, -6, "R-12", TERRA, 18], [258, 830, -4, "R-12", TERRA, 17], [315, 885, 4, "R-12", TERRA, 18], [420, 780, -10, "R-12", TERRA, 14], [590, 722, -8, "R-9", TERRA, 12],
    [690, 722, -4, "R-12", MOSTAZA, 17], [500, 792, 6, "R-12", MOSTAZA, 16], [560, 880, 8, "R-12", MOSTAZA, 20], [690, 850, 2, "R-12", MOSTAZA, 17],
    [300, 815, 10, "R-5", DORADO, 11], [365, 760, 8, "R-5", DORADO, 10], [450, 850, 12, "R-5", DORADO, 10], [510, 860, 14, "R-5", DORADO, 10], [470, 902, 12, "R-5", DORADO, 10],
    [575, 765, 10, "R-5", DORADO, 10], [630, 805, 10, "R-5", DORADO, 10], [530, 722, 4, "R-5", DORADO, 9], [478, 702, 2, "R-5", DORADO, 9], [620, 870, 10, "R-5", DORADO, 10],
  ], C_BASE);
  // Tallo: 9 R-5 Reflex Dorado chicos en espiral sobre la vara.
  [[490, 575], [512, 598], [540, 612], [520, 638], [498, 655], [528, 668], [500, 688], [522, 702], [488, 712]].forEach(([x, y], k) => {
    const a = 140 * k;
    m.globo(`tallo-${k + 1}`, `R-5 Reflex Dorado del tallo ${k + 1}`, R("R-5", 5.5, DORADO), f(x!, y!, r2(2.5 * Math.cos(rad(a)))), haciaFuera(a, 10));
  });
  // Racimo de arriba.
  const C_ARRIBA = f(530, 360, -4);
  poner("arriba", [
    [530, 360, 8, "R-12", MOSTAZA, 29], [400, 410, 0, "R-12", TERRA, 23], [612, 222, -4, "R-12", TERRA, 22], [690, 430, -4, "R-12", ARENA, 24],
    [455, 210, -4, "R-12", DORADO, 19], [570, 500, 2, "R-12", DORADO, 24], [420, 510, -6, "R-12", MOSTAZA, 18], [650, 495, -8, "R-12", ARENA, 18], [355, 300, -8, "R-12", ARENA, 17],
    [520, 202, 8, "R-5", BLANCO, 8], [567, 205, 8, "R-5", BLANCO, 8], [545, 245, 10, "R-5", BLANCO, 8],
    [392, 292, 8, "R-5", DORADO, 9], [438, 292, 9, "R-5", DORADO, 9], [410, 330, 10, "R-5", DORADO, 9], [640, 292, 6, "R-5", DORADO, 9], [660, 330, 6, "R-5", DORADO, 9],
    [578, 433, 10, "R-5", TERRA, 7], [620, 446, 8, "R-5", TERRA, 7], [600, 470, 6, "R-5", TERRA, 6],
  ], C_ARRIBA);
  m.globo("impreso-terra", "R-12 terra (café) «Feliz cumpleaños»", R("R-12", 28, TERRA), f(380, 165, -12), unitario(v(-0.4, 1, -0.1)), TERRA_IMPRESO);
  m.globo("impreso-mostaza", "R-12 mostaza «Feliz cumpleaños»", R("R-12", 28, MOSTAZA), f(808, 272, -10), unitario(v(0.9, 0.5, 0)), TERRA_IMPRESO);
  // Hojas doradas (follaje de papel): láminas en forma de hoja.
  const hoja = (c: Vec3, giro: number): ElementoEscenografia => ({
    forma: "panel", contorno: [{ x: 0, y: 0 }, { x: 3.5, y: 3 }, { x: 4.5, y: 7 }, { x: 0, y: 11 }, { x: -4.5, y: 7 }, { x: -3.5, y: 3 }], zCm: 0, grosorCm: 0.3, hex: "#b88d4e", acabado: "metal",
    en: { origen: c, ejeX: v(r2(Math.cos(rad(giro))), r2(Math.sin(rad(giro))), 0.3), ejeY: v(r2(-Math.sin(rad(giro))), r2(Math.cos(rad(giro))), 0.2) },
  });
  m.escenografia("hojas", "Hojas doradas (papel)", [
    hoja(f(270, 760, 12), 60), hoja(f(420, 805, 14), -40), hoja(f(530, 665, 8), 20), hoja(f(650, 750, 12), -60),
    hoja(f(440, 180, 10), 30), hoja(f(580, 170, 6), -30), hoja(f(660, 310, 10), -70), hoja(f(420, 250, 12), 50), hoja(f(375, 230, 6), 80), hoja(f(620, 360, 12), -20), hoja(f(470, 470, 10), 40),
  ]);
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// 306 · Centro de mesa primera comunión
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; el R-12 Reflex Dorado de arriba mide ~310 px (28 cm): 11 px/cm, con la mesa en y = 985 px y el eje
 * en x = 500. Base: tambor de dos anillos de R-5 Satín Blanco (~10 cm; se ven 4–5 por anillo: 10 en la vuelta), de 37
 * cm de ancho, con 6 bandas de T-260 (Reflex Plata al frente y a ±120°, Reflex Dorado a ±60° y detrás), cada una con un
 * par de burbujitas arriba y abajo. Tallo: un T-260 Reflex Plata en tirabuzón (1,6 vueltas, de 3 a 11 cm de radio) del
 * tambor al globo, con un racimito de burbujas plata en cada punta. Arriba, el R-12 Reflex Dorado con ángeles y palomas
 * blancos (centro a 72 cm). Colores: los publicados (Satín Blanco 405, T-260 Reflex Plata 981, Reflex Dorado 970).
 */
const escena306 = perezoso((): Escena => {
  const BLANCO = "405", PLATA = "981", DORADO = "970";
  const tambor: Pieza = { tipo: "forma", forma: { clase: "cono", altoCm: 19, tecnica: "anillos", formatoId: "R-5", infladoBaseCm: 10.5, infladoPuntaCm: 10.5, globosBase: 10, globosPunta: 10, colores: { codigos: [BLANCO], patron: "un_color" } } };
  const m = montaje(
    { id: "tambor", nombre: "Tambor de dos anillos de R-5 Satín Blanco", pieza: tambor, origen: v(0, 0, 0) },
    { nombre: "Varilla del tallo", base: v(0, 0, 0), altoCm: 58, radioCm: 0.4, hex: "#d9dadc" },
  );
  const radio = 19.5;
  // Cada banda: una burbuja larga vertical de 12 cm con un par de burbujitas arriba y abajo, de un mismo T-260.
  const banda: TrazoFrente[] = [
    { tipo: "linea", puntos: [[0, 1.5], [0, 13.5]] },
    { tipo: "linea", puntos: [[-3, 15], [0, 15], [3, 15]] },
    { tipo: "linea", puntos: [[-3, 0], [0, 0], [3, 0]] },
  ];
  [0, 60, 120, 180, 240, 300].forEach((a, k) => {
    const codigo = k % 2 === 0 ? PLATA : DORADO;
    m.trazo(`banda-${k + 1}`, `Banda de T-260 ${codigo === PLATA ? "Reflex Plata" : "Reflex Dorado"} ${k + 1} con sus burbujitas`, T("T-260", 3, codigo), banda, enAnillo(a, radio, 2.5), "a twisted-balloon band with tiny bubbles", fuera(a));
  });
  const burbujitas = (cantidad: number): Decoracion => ({ tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 3, codigos: [PLATA], cantidad, estilo: "burbuja", largoCm: 3.5, anchoCm: 3, aperturaGrados: 35, giroGrados: 0 }, interior: null, corona: null, centro: null } });
  m.deco("burbujitas-tambor", "Racimito de burbujas Reflex Plata sobre el tambor", burbujitas(3), v(-1.5, 19.5, 1), ARRIBA);
  m.deco("burbujitas-globo", "Racimito de burbujas Reflex Plata bajo el globo", burbujitas(4), v(0, 55, 0), ABAJO);
  m.deco("tirabuzon", "Tirabuzón de T-260 Reflex Plata", { tipo: "rizo", propiedades: { forma: "tirabuzon", tubito: T("T-260", 5, PLATA), vueltas: 1.6, radioInicialCm: 3, radioFinalCm: 11, largoCm: 26, eje: "abajo" } }, v(0, 52, 0), AL_FRENTE);
  m.globo("globo", "R-12 Reflex Dorado (con ángeles y palomas en la foto; impreso de estrellas)", R("R-12", 28, DORADO), v(0, 72, 0), ARRIBA, "infinity-estrellas-reflex-dorado");
  return m.escena();
});

// ----------------------------------------------------------------------------------------------------------
// Las 15 ideas
// ----------------------------------------------------------------------------------------------------------

/**
 * #303 es la misma foto de producto que #264 (en su versión sin recortar: pared gris claro y pedestal blanco): reusa sus
 * mismos nodos y solo cambia los tonos de la sala (así la biblioteca no la funde con #264 por tener el mismo contenido).
 */
const escena303 = perezoso((): Escena => ({ ...escena264(), sala: { ...escena264().sala, tonos: { piso: "#e9e7e2", paredes: "#e2dfd8", techo: "#f6f5f2" } } }));

const P_MOSTAZA = pub("GLOBO REDONDO FASHION MOSTAZA", "/products/globo-para-fiesta-latex-redondo-fashion-mostaza", "R-12", "023");
const P_DORADO = pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970");
const P_PLATA = pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981");

const PUBLICADOS_PAPA: readonly Publicado[] = [
  P_MOSTAZA,
  pub("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940"),
  pub("GLOBO LATEX REDONDO 2 CARAS FELIZ DIA BIGOTES REFLEX SURTIDO", "/products/globo-para-fiesta-latex-redondo-2-caras-feliz-dia-bigotes-reflex-surtido", "R-12", null),
  pub("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
  pub("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041"),
  pub("GLOBO REDONDO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-fashion-transparente", "R-12", "390"),
];

const NOTA_PAPA = "Igual: la caja cilíndrica azul de lunares blancos (22 × 17,5 cm), el corazón de R-5 Reflex Azul (10) con 2 Reflex Plata, los 12 R-5 mostaza (~8,5 cm) en dos racimos a los lados (10 se ven; 2 detrás), los dos R-12 Reflex «Feliz Día» de bigote a 21 cm (plata a la izquierda y azul a la derecha: el impreso publicado), la varilla blanca, la burbuja R-18 Cristal (~40 cm) con el R-12 Azul Rey dentro, el corbatín de T-260 negro con sus dos R-5 plata, el bombín negro ladeado y el helio por pisos —mostaza y azul rey (116–117 cm) y el Reflex Plata «Feliz Día» arriba (146)—, con cintas azules. Distinto: el globo de dentro de la foto dice «Feliz Día Papá» con sombreros, bigotes, corbatas y pipas, y la tienda no tiene ese impreso en el catálogo: va el «Infinity® Feliz Día Papá Oeste» sobre Azul Rey (el más parecido: letrero y sombrero) y en la foto el azul es algo más claro; los dos R-5 mostaza de detrás son supuestos; el Reflex Azul liso publicado es el de los R-5 (la idea lo da como R-12).";

export const LOTE_17: readonly IdeaDigitalizada[] = [
  idea(219, "buho", "Búho en su aro con ramo de 3 globos de helio", escena219,
    "Igual: la base de cuarteto R-5 Verde Trébol 029 (se ven 2), el búho de 43 cm en su aro de T-260 Rosa 011 (40 cm) —cabeza y cuerpo R-12 Amarillo Miel 021, panza fucsia, ojos negros, orejas, pico y patas rojas y el moño fucsia arriba a la derecha— y los tres globos de helio uno por piso con su cinta: verde (104 cm), fucsia con lunares amarillos (138) y amarillo con lunares fucsia (169). Distinto: la idea no publica productos y los colores son medidos (amarillo #efd204, fucsia #ff247f, verde #00bf01, aro #f182ba, patas #fd1400); los lunares de los R-12 no son un impreso de la tienda (van dibujados sobre el liso, no cotizan) y el verde lleva en la foto un adorno de colores pequeño que no va; la panza del búho es un R-9 fucsia sin el zigzag blanco de la foto, y su cara es más sencilla.",
  ),
  idea(232, "calabaza", "Calabaza de racimo con cara de tubito", escena232,
    "Igual: el racimo de 7 —un R-18 Naranja 061 al centro (~34 cm) y 6 R-12 alrededor (dos arriba, dos a los lados y dos abajo)—, los ojos de triángulo con la punta arriba y la boca en arco de T-260 Negro 080, el tallo de T-260 verde (dos tallos cortos, el rulo con su zarcillo largo a la izquierda y el zarcillo en diagonal a la derecha) y el trío de R-5 Verde Selva 032 en la base del tallo. Distinto: la idea no publica productos: colores medidos (naranja #ff7b23, verde del tubito #009140 → Metal Verde 530, R-5 verde #00762f); en la foto los R-12 de los lados son más grandes (~24 cm) que los de arriba y abajo (18–21, medio tapados) y aquí van todos a 24; no se sabe si hay globos detrás (no van); la escala sale del grueso del tubito (no hay globo de referencia).",
  ),
  idea(233, "calabazas-apiladas", "Calabazas apiladas con ramo de Halloween", escena233,
    "Igual: la base de cuarteto R-5 con un Violeta 051 al frente y Verde Lima 031 a los lados, las tres calabacitas de R-9 (~21 cm) apiladas en zigzag —negra con cara amarilla, naranja con cara negra y negra con cara amarilla—, cada una con su tallo de lazos verde lima, y el ramo de helio por pisos (2 naranja a 100–106 cm y 2 negros a 131–150) con cintas lila. Distinto: la idea no publica productos: colores medidos (violeta #312565, verde #83b65b, naranja #eb7b36, negro); los impresos de la foto (gato, murciélagos y caras de calabaza) no están en la tienda: va el «Happy Halloween» 2 caras negro y naranja (el más parecido, del mismo surtido); las caras de las calabacitas son las del taller (en la foto los ojos de las negras son más bravos).",
  ),
  idea(237, "canasta-de-amor", "Canasta de amor: florero de globos con 3 flores y ramo", escena237,
    "Igual: el florero de anillos de R-5 Fashion Blanco (27 × 39 cm), las tres flores de 5 R-5 con centro Verde Lima 031 —Rojo 015 a la izquierda, Rosa 011 a la derecha y delante, Rosado 009 arriba detrás— con sus tallos de T-260, y el ramo de helio por pisos (rosado a 95 cm, rojo a 99 y cristal arriba a 139) con cintas blancas. Distinto: la idea no publica productos: colores medidos (rojo #dd3036, rosa #e94086, rosado #f1cbdc, centro #71da82); en la foto el florero se angosta en el medio (aquí es recto) y sus globitos son más chicos y apretados; los impresos de la foto (corazón y letras) no están en la tienda: el rojo lleva el «Infinity® LOVE» (un corazón grande) y el rosado el «Corazones Modernos», los más parecidos; el cristal de arriba va liso (sus letras y corazones blancos no van); las hojas anchas de los tallos van como tallos.",
  ),
  idea(264, "celebrando-a-papa", "Celebrando a papá: caja de lunares, burbuja y ramo", escena264, NOTA_PAPA, PUBLICADOS_PAPA),
  idea(274, "centro-de-mesa-corazon", "Centro de mesa corazón de R-5 con ramo «Feliz Día Mamá»", escena274,
    "Igual: el corazón (66 × 52 cm) relleno de R-5 Rojo 015 al tresbolillo con la punta a 15 cm, su contorno de T-260 Blanco (73 × 60), la base de R-9 blanco (se ven 2) y el ramo por pisos: dos blancos «Feliz Día Mamá» con corazones (el impreso de la tienda, de tinta roja sobre blanco) a 111 y 117 cm y el rojo arriba (147), con cintas blancas. Distinto: la idea no publica productos: colores medidos (rojo #fd0201; los blancos, en sombra); el rojo de arriba dice «Te amo» con corazones de colores, que no está en la tienda: va el «I Love You Moderno» rojo (el más parecido) y mide ~23 cm (más chico que los blancos); en la foto el contorno es translúcido y el corazón lleva más celdas en los lóbulos.",
  ),
  idea(277, "centro-de-mesa-cristal", "Centro de mesa cristal: corazón en burbuja y contorno de tubito", escena277,
    "Igual: la base de R-5 Fashion Blanco (un cuarteto con uno al frente y otro encima: se ven 5), el R-12 Cristal de ~19 cm con el corazón rojo dentro, el contorno de corazón de T-260 Rojo 015 ancho y bajo (68 × 38 cm) y el ramo por pisos: blanco (86 cm), rojo con corazones (122) y rojo «Feliz Día» (153), con cintas rosadas. Distinto: la idea no publica productos: colores medidos (rojo #f6090f, blanco en sombra); el corazón de dentro es un C-12 a 13 cm; los impresos: el de corazones blancos va con el «Corazones por Siempre» rojo y el «Feliz Día» con el «Feliz Día Corazones Brillantes» de la tienda, que es Metal Rojo 515 (en la foto el rojo es Fashion); en la foto el tubito del contorno lleva unas marcas blancas que no van.",
  ),
  idea(285, "centro-de-mesa-feliz-cumpleanos", "Centro de mesa feliz cumpleaños con flores y lunares", escena285,
    "Igual: la base de cuartetos —R-12 Violeta 051 (~21 cm, se ven 3), R-5 Amarillo 020 y R-5 Naranja 061—, el moño de 4 lazos grandes de T-260 Verde Lima 031, las dos flores de 5 lazos (Rosa 011 y Azul 040) con sus tallos y dos hojas largas, y el ramo por pisos: naranja con lunares violeta (82 cm), verde lima con lunares azules (96), violeta con lunares naranja (117) y el metalizado «Feliz cumpleaños» de la tienda arriba (152), con cintas blancas. Distinto: la idea no publica productos: colores medidos (violeta #553e99, verde #99ce63, naranja #ff7c00, amarillo #f8dd05, rosa #ed6bab, azul #0bc0e4: el Azul Caribe 038 queda 3 ΔE más cerca, pero la tienda no lo vende en tubito); los R-12 de la foto son impresos de lunares con «Feliz Cumpleaños!» que la tienda no tiene: van lisos con los lunares dibujados (no cotizan) y sin el letrero; el metalizado mide ~33 cm en la foto y va a 14\" (la tienda lo vende de 18\"); en la foto los tallos son más curvos.",
  ),
  idea(292, "centro-de-mesa-mis-quince", "Centro de mesa mis quince con estrella fucsia", escena292,
    "Igual: la columna de cuarteto R-12 Cristal con estrellas, cuarteto R-12 Rosa 011 con uno al frente y 2 cristal más chicos arriba, la vara con cintas rizadas rosadas, verdes y blancas, la estrella metalizada rosada vibrante de 18\" de la tienda arriba (base a 72 cm) y la mariposa de papel con su flor de tul al lado. Distinto: la idea no publica productos: colores medidos (rosa #ff64a8: el Neón Fucsia queda 3 ΔE más cerca); las estrellas de los cristal son rosadas en la foto y el impreso de la tienda («Estrellas Fashion Transparente») las tiene blancas; los R-12 de la foto van a ~21 cm (y los dos de arriba a 13); la mariposa y la flor de tul son escenografía sencilla.",
  ),
  idea(293, "centro-de-mesa-momento-inolvidable", "Centro de mesa momento inolvidable: tres flores y rizos", escena293,
    "Igual: la base baja de R-5 Fucsia 012 (1 m de ancho, más alta a la derecha), las tres flores de 5 pétalos R-12 con centro R-5 Rosado 009 —dos Orquídea Morada 056 abajo y una Pastel Dusk Lavanda 150 arriba detrás— y los tres rizos de T-260 Rosado 009 que asoman detrás (el gancho de la derecha y las dos «C» de la izquierda): los productos publicados. Distinto: en la foto los pétalos tienen punta de corazón (aquí son R-12 a 20 cm redondos); los globos de la base los da el motor orgánico para el largo y el grosor medidos (no uno a uno); el fucsia de la foto mide #f176b4 (más cerca del Rosa 011) y se deja el publicado; los rizos son trazos de arco y línea (el de la izquierda no lleva su vuelta de atrás).",
    [
      pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
      pub("GLOBO REDONDO FASHION ORQUIDEA MORADA", "/products/globo-para-fiesta-latex-redondo-fashion-orquidea-morada", "R-12", "056"),
      pub("GLOBO REDONDO PASTEL DUSK LAVANDA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-lavanda", "R-12", "150"),
      pub("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
      pub("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"),
    ],
  ),
  idea(295, "centro-de-mesa-navidad-jacob-megram", "Centro de mesa navidad: burbuja de nieve y copo holográfico", escena295,
    "Igual: la columna de 3 cuartetos R-9 Satín Perla 406 y Reflex Plata 981 alternados con la burbuja R-18 Cristal (~45 cm) encima, con confeti blanco y plata y 4 R-5 dentro; el racimo bajo de la izquierda de R-5 perla, plata y cristal con el metalizado redondo «Let it snow» apoyado; el helio —dos R-12 Cristal Graffiti Invierno (el impreso publicado) con un Reflex Plata dentro, dos R-12 Satín Perla y el copo arriba (136 cm)— con cintas blancas, y los copos de escarcha de papel. Distinto: el copo holográfico y el «Let it snow» no están en la tienda: el copo va como una estrella metalizada plateada de 32\" (5 puntas, sin el holográfico) y el «Let it snow» como un redondo blanco de 10\" con el letrero (ninguno cotiza); la burbuja de la foto lleva un paisaje de casitas impreso que no va; el «Metalink Plata Graffiti» publicado no se distingue en la foto (sin cantidad); los globos de la base van a 15 cm (R-9; la idea los publica como R-12).",
    [
      pub("GLOBO REDONDO SATIN PERLA", "/products/globo-para-fiesta-latex-redondo-satin-perla", "R-12", "406"),
      P_PLATA,
      pub("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente", "R-12", null),
      pub("GLOBO REDONDO INFINITY® METALINK PLATA GRAFFITI FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-infinity-metalink-plata-graffiti-fashion-blanco", "R-12", null),
    ],
  ),
  idea(298, "centro-de-mesa-nino", "Centro de mesa niño con biberones", escena298,
    "Igual: la base de cuarteto R-12 «Es un niño» (se ven 3, uno al frente) con el cuarteto R-12 blanco encima y sus moños de cinta azul, los tres biberones de tubito azul con tetina blanca parados entre los blancos, y el ramo por pisos («Es un niño» a 92 cm, blanco a 119 y «Es un niño» a 147) con cintas blancas. Distinto: la idea no publica productos; el impreso de la foto («ES UN NIÑO!» con círculos sobre azul Fashion, medido #38bee8 → Azul 040) no está igual en la tienda: va el «Es un Niño Estrella» sobre Pastel Mate Azul 640 (el más parecido); los biberones son de T-360 Azul 040 y su tetina se simplifica (un R-5 y dos burbujitas blancas); los moños de cinta son escenografía sencilla.",
  ),
  idea(299, "centro-de-mesa-organica-feliz-cumpleanos-terra", "Topiario orgánico feliz cumpleaños terra", escena299,
    "Igual: el topiario de dos racimos (la mesa es el pedestal blanco de la foto) —la base (64 × 41 cm) de R-12 terra y mostaza con 10 R-5 Reflex Dorado; el tallo de 9 R-5 Reflex Dorado chicos en espiral sobre la vara; arriba, el R-12 mostaza de ~29 cm al frente, terra, arena, dos Reflex Dorado grandes, tres R-5 blancos, R-5 dorados y terra— y los dos R-12 «Feliz cumpleaños» del impreso publicado (Infinity® Terra: uno terra y uno mostaza), con hojas doradas. Distinto: el color terra de la foto (#8d4d41) no está en la tabla oficial: va el Café 074, el más cercano (ΔE 14) y el del surtido del impreso; los blancos son Silk Blanco Nácar 806 (medido); los globos de detrás de los racimos son supuestos; las hojas son láminas doradas sencillas.",
    [
      pub("GLOBO REDONDO INFINITY® FELIZ CUMPLEAÑOS TERRA FASHION SURTIDO", "/products/globo-para-fiesta-latex-redondo-infinity-feliz-cumpleanos-terra-fashion-surtido", "R-12", null),
      P_MOSTAZA,
      pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
      P_DORADO,
    ],
  ),
  idea(303, "centro-de-mesa-para-papa", "Centro de mesa para papá: caja de lunares, burbuja y ramo", escena303,
    `Misma foto que #264 (la misma pieza y la misma sesión; aquí sin recortar, sobre un pedestal blanco): se reusa su digitalización, con los tonos de esta foto en la sala. ${NOTA_PAPA}`, PUBLICADOS_PAPA),
  idea(306, "centro-de-mesa-primera-comunion-1", "Centro de mesa primera comunión con tallo en tirabuzón", escena306,
    "Igual: el tambor de dos anillos de R-5 Satín Blanco 405 (10 por anillo, ~37 cm de ancho) con sus 6 bandas de T-260 —Reflex Plata 981 al frente y a ±120°, Reflex Dorado 970 a ±60° y detrás— y sus burbujitas, el tallo de T-260 Reflex Plata en tirabuzón de 1,6 vueltas con un racimito de burbujas plata en cada punta y el R-12 Reflex Dorado arriba (centro a 72 cm): los colores publicados. Distinto: el globo de arriba es en la foto el «Mi Primera Comunión Palomas» 2 caras Reflex Dorado (publicado), que no está en el catálogo del taller: va el «Infinity® Estrellas» Reflex Dorado (el más parecido que conserva el dorado: estrellas blancas en vez de ángeles y palomas) y el publicado queda listado sin cantidad, como el «Infinity® Mi Primera Comunión Palomas» blanco, que la foto no tiene; en la foto los globos del tambor se ven más altos (26 cm de tambor; aquí 19).",
    [
      pub("GLOBO REDONDO MI PRIMERA COMUNIÓN PALOMAS", "/products/globo-para-fiesta-latex-redondo-2-caras-mi-primera-comunion-palomas-reflex-dorado", "R-12", null),
      pub("GLOBO REDONDO INFINITY® MI PRIMERA COMUNION PALOMAS FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-infinity-mi-primera-comunion-palomas-fashion-blanco", "R-12", null),
      P_DORADO,
      pub("GLOBO TUBITO REFLEX PLATA", "/products/globo-para-fiesta-latex-tubito-reflex-plata", "T-260", "981"),
      pub("GLOBO REDONDO SATIN BLANCO", "/products/globo-para-fiesta-latex-redondo-satin-blanco", "R-12", "405"),
    ],
  ),
];
