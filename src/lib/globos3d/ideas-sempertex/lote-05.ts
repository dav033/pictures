import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
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
import { metalizadoDeTienda } from "../metalizados";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 05** (los números de `clasif/lote-05.json`: 9 centros de mesa
 * y 11 columnas).
 *
 * Cómo se hizo (2026-10-07), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, ampliada con una cuadrícula
 * de píxeles y medida:
 * - **Escala**: la de un globo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 22 cm, R-12 ≈ 28 cm, R-18 ≈ 42
 *   cm, R-24 ≈ 55 cm; en una columna, el R-12 a 25–28 cm). Con ella salen las alturas de cada nivel, los radios, los
 *   largos de varas y lazos. Cada idea dice su escala en el comentario.
 * - **Conteo**: los globos que se ven, contando los que asoman por detrás; lo que no se ve y la técnica obliga (el
 *   cuarto globo de un cuarteto, los moños de la cara de atrás) se pone y se dice en la nota. Ninguna idea del lote
 *   publica «Materiales» con cantidades: todas son contadas (`contada: true`).
 * - **Niveles**: en las fotos los cuartetos van más juntos que el paso del taller (0,8 diámetros). Para que salgan
 *   los niveles contados Y la altura real, cada nivel (o tramo de niveles) es su propia columna de un nivel, puesta a
 *   la altura medida en la foto y girada 1/8 de vuelta sobre la de abajo (como la trenza). Cuando la foto va al paso
 *   del taller, es una sola columna.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos. Si no, se midió en la foto (Python/PIL: mediana
 *   de un parche sin brillos, distancia en Lab contra `hexGlobo` de la tabla oficial) y se tomó el código más cercano
 *   que se fabrica en ese formato; si un Fashion queda a ≤ 6 de distancia del más cercano, el Fashion (las fotos
 *   viejas están sobresaturadas y no son Neón).
 * - **Impresos y metalizados**: los de la tienda (`impresos-catalogo.ts`, `metalizados.ts`) cuando la foto los tiene y
 *   el catálogo los trae (con su producto exacto). Un impreso que el catálogo no trae (copa, emoji, cebra, chevrón,
 *   «Te amo»…) va en el liso de su color de fondo, y la nota lo dice.
 * - **Montaje** (para que la biblioteca saque la estructura principal «sola con sus decoraciones»): la estructura
 *   principal es el nodo raíz. De ella cuelga (`sobre`) su varilla (la vara de la foto o la varilla de PVC de dentro
 *   de la columna, escenografía), y de la varilla cuelga todo lo demás: bases, niveles, remates, flores, moños,
 *   globos con helio y sus cintas. La varilla no tiene globos, así que nada se corre al apoyarse: cada pieza queda
 *   donde la pone la foto (las coordenadas se escriben en el mundo y se pasan al espacio de la varilla).
 *   Como la varilla es escenografía con globos colgados, la biblioteca también la ofrece «con sus decoraciones»
 *   (todo menos la raíz); la que se lleva todo es la de la estructura principal.
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
/** Hacia fuera en el plano del piso: 0° = al frente (+z), 90° = a la derecha de quien mira (+x). */
const fuera = (grados: number): Vec3 => v(r2(Math.sin(rad(grados))), 0, r2(Math.cos(rad(grados))));
/** Dirección hacia fuera `grados` alrededor y levantada `elevacion` grados sobre el plano del piso. */
const haciaFuera = (grados: number, elevacion: number): Vec3 => unitario(mas(por(fuera(grados), Math.cos(rad(elevacion))), por(ARRIBA, Math.sin(rad(elevacion)))));
/** Un punto a `radio` del eje vertical, en el ángulo `grados` (0° al frente), a la altura `y`. */
const enAnillo = (grados: number, radio: number, y: number): Vec3 => mas(por(fuera(grados), radio), v(0, y, 0));

/** Los 12 vértices del icosaedro (unitarios), con uno arriba y uno abajo: el racimo redondo de 12 globos. */
const ICOSAEDRO = perezoso((): readonly Vec3[] => {
  const salida: Vec3[] = [ARRIBA, v(0, -1, 0)];
  const y = 1 / Math.sqrt(5), r = 2 / Math.sqrt(5);
  for (let k = 0; k < 5; k++) { salida.push(v(r * Math.sin(rad(72 * k)), y, r * Math.cos(rad(72 * k)))); salida.push(v(r * Math.sin(rad(72 * k + 36)), -y, r * Math.cos(rad(72 * k + 36)))); }
  return salida;
});

/** Los centros de las 20 caras del icosaedro (unitarios): los huecos entre sus 12 globos. */
const CARAS_ICOSAEDRO = perezoso((): readonly Vec3[] => {
  const salida: Vec3[] = [];
  const n = ICOSAEDRO().length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    const [p, q, w] = [ICOSAEDRO()[a]!, ICOSAEDRO()[b]!, ICOSAEDRO()[c]!];
    if (largo(menos(p, q)) < 1.2 && largo(menos(q, w)) < 1.2 && largo(menos(p, w)) < 1.2) salida.push(unitario(mas(mas(p, q), w)));
  }
  return salida;
});


const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const sala = (anchoCm = 360, fondoCm = 320, altoCm = 300): Sala => ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm });

/** El giro sobre la normal que deja la cara (+z local) de la pieza lo más hacia quien mira (+z): lo impreso al frente. */
function giroAlFrente(normal: Vec3): number {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  return Math.round((Math.atan2(-xL.z, zL.z) * 180) / Math.PI);
}

// ----------------------------------------------------------------------------------------------------------
// Montaje: la estructura principal como raíz, su varilla y lo que cuelga de la varilla
// ----------------------------------------------------------------------------------------------------------

/** Lo que se hunde una pieza `sobre` otra (`HUNDIMIENTO_SOBRE_CM` de la escena). */
const HUNDIDO = 1.5;
/** Varilla con normal hacia arriba y giro −90°: su marco local es el del mundo con x al revés. */
const GIRO_VARILLA = -90;

/** Alto bajo el origen de una pieza armada (−min.y de su caja): lo que la escena corre al apoyarla `sobre` algo sin globos. */
function bajoOrigen(pieza: Pieza): number {
  return -armarPieza(pieza).caja.min.y;
}

type Montaje = {
  nodos: NodoEscena[];
  /** Una pieza cualquiera con su origen en `origen` (mundo), su +y local hacia `normal` y girada `giroGrados`. */
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro del cuerpo en `centro` y el cuerpo hacia `direccion` (con su impreso de la tienda, al frente). */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un nivel de cuarteto (columna de un nivel) con su centro en `centro`, girado `giroGrados` (0° = un hueco al frente, como el primer nivel de una columna; 45° = un globo al frente). */
  nivel: (id: string, nombre: string, g: ParteGlobo, colores: string[], centro: Vec3, giroGrados: number, patron?: PatronColumna, impresos?: ImpresoEnPieza[]) => void;
  /** Una decoración (moño, flor…) con su origen en `origen`, mirando hacia `normal` (su +y local) y girada `giroGrados`. */
  deco: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, normal: Vec3, giroGrados?: number) => void;
  /** Un anillo de `n` globos iguales a `radio` del eje y a la altura `y`, mirando hacia fuera y levantados `elevacion` grados. */
  anillo: (prefijo: string, nombre: string, g: ParteGlobo, n: number, y: number, radio: number, elevacion: number, desdeGrados?: number) => void;
  /** Un tallo recto de tubito de `desde` a `hasta` (dos burbujas en línea: ver `palito`). */
  palito: (id: string, nombre: string, t: { formatoId: string; grosorCm: number; codigo: string }, desde: Vec3, hasta: Vec3) => void;
  /** Una escenografía (cintas, vara) con sus elementos en coordenadas del mundo. */
  escenografia: (id: string, nombre: string, elementos: ElementoEscenografia[]) => void;
  escena: (s?: Sala) => Escena;
};

/**
 * Arma el montaje: `raiz` (la estructura principal) suelta con su origen en `origenRaiz` (mundo); su varilla de alto
 * `varilla.altoCm` y radio `varilla.radioCm`, con la base en `varilla.base` (mundo), sobre el eje de la raíz (que no
 * corta ningún globo: el hueco del centro de los cuartetos). Lo demás cuelga de la varilla.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; origen: Vec3; giroGrados?: number }, varilla: { nombre: string; base: Vec3; altoCm: number; radioCm: number; hex: string; acabado?: "mate" | "metal" | "satinado" }): Montaje {
  const nodos: NodoEscena[] = [{ id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: { en: "libre", xCm: raiz.origen.x, yCm: raiz.origen.y, zCm: raiz.origen.z, giroGrados: raiz.giroGrados ?? 0 } }];
  // La varilla: su base queda `HUNDIDO` por debajo del punto pedido. Va sobre el eje de la raíz, así que el giro de la
  // raíz no la mueve, y su marco sale de la normal del mundo (no del giro de la raíz).
  const puntoVarilla = mas(menos(varilla.base, raiz.origen), v(0, HUNDIDO, 0));
  nodos.push({
    id: "varilla", nombre: varilla.nombre,
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: varilla.radioCm, altoCm: varilla.altoCm, hex: varilla.hex, acabado: varilla.acabado ?? "mate" }] },
    colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(puntoVarilla), normal: ARRIBA, giroGrados: GIRO_VARILLA },
  });
  const O = varilla.base;
  /** Del mundo al espacio de la varilla (x al revés: ver `GIRO_VARILLA`). */
  const aVarilla = (p: Vec3): Vec3 => redondo(v(-(p.x - O.x), p.y - O.y, p.z - O.z));
  const dirAVarilla = (d: Vec3): Vec3 => redondo(v(-d.x, d.y, d.z));
  const pieza = (id: string, nombre: string, p: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    const punto = menos(origen, por(n, bajoOrigen(p) - HUNDIDO));
    nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: "varilla", puntoCm: aVarilla(punto), normal: dirAVarilla(n), giroGrados } });
  };
  return {
    nodos,
    pieza,
    globo: (id, nombre, g, centro, direccion = ARRIBA, impresoId) => {
      const p: Pieza = { tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
      pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
    },
    nivel: (id, nombre, g, colores, centro, giroGrados, patron = "un_color", impresos) => {
      const p: Pieza = { tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) };
      // El origen de la columna es el centro de su primer cuarteto; con la normal arriba, el giro de la varilla (−90°)
      // deja su marco como el del mundo con x al revés, y el pedido lo gira sobre la vertical.
      pieza(id, nombre, p, centro, ARRIBA, GIRO_VARILLA - giroGrados);
    },
    deco: (id, nombre, decoracion, origen, normal, giroGrados = 0) => pieza(id, nombre, { tipo: "decoracion", decoracion }, origen, normal, giroGrados),
    anillo: (prefijo, nombre, g, n, y, radio, elevacion, desdeGrados = 0) => {
      for (let k = 0; k < n; k++) {
        const a = desdeGrados + (360 * k) / n;
        const d = haciaFuera(a, elevacion);
        const p: Pieza = { tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo };
        pieza(`${prefijo}-${k + 1}`, `${nombre} ${k + 1}`, p, enAnillo(a, radio, y), d);
      }
    },
    palito: (id, nombre, t, desde, hasta) => {
      // Una flor de tubito de dos burbujas con apertura −90°: las dos quedan en la misma recta hacia −y de la pieza;
      // con su +y de `desde` a `hasta`, la punta de abajo cae en `desde` y la de arriba en `hasta`.
      const d = menos(hasta, desde);
      const n = unitario(d);
      const p: Pieza = { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: t.formatoId, grosorCm: t.grosorCm, codigos: [t.codigo], cantidad: 2, estilo: "burbuja", largoCm: r2(largo(d)), anchoCm: t.grosorCm, aperturaGrados: -90, giroGrados: 0 }, interior: null, corona: null, centro: null } } };
      pieza(id, nombre, p, mas(desde, por(n, bajoOrigen(p))), n);
    },
    escenografia: (id, nombre, elementos) => {
      // Sus elementos van en el mundo: se pasan al espacio de la varilla (x al revés) y se cuelga con su origen en O.
      const local = elementos.map((e): ElementoEscenografia => {
        if (e.forma === "cilindro" && e.en) return { ...e, en: { origen: aVarilla(e.en.origen), ejeX: dirAVarilla(e.en.ejeX), ejeY: dirAVarilla(e.en.ejeY) } };
        if (e.forma === "cilindro") return { ...e, base: aVarilla(e.base) };
        if (e.forma === "caja") return { ...e, centro: aVarilla(e.centro) };
        return e;
      });
      const p: Pieza = { tipo: "escenografia", elementos: local };
      const bajo = bajoOrigen(p);
      nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: "varilla", puntoCm: v(0, r2(-bajo + HUNDIDO), 0), normal: ARRIBA, giroGrados: GIRO_VARILLA } });
    },
    escena: (s = sala()) => ({ sala: s, nodos }),
  };
}

/**
 * La espiral sigue de la raíz a los niveles colgados: los colgados quedan en espejo (el marco de una pieza `sobre` es de mano izquierda), así que la raíz
 * lleva sus colores al revés (el primero igual) y el nivel `k` se gira para que su primer color quede 45° más allá.
 */
const alReves = (c: readonly string[]): string[] => [c[0]!, ...c.slice(1).reverse()];
const giroEspiral = (k: number): number => 45 * k - 90;

/** Un nivel de cuarteto como columna de un nivel (la raíz de un montaje). */
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color", niveles = 1, impresos?: ImpresoEnPieza[]): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8 * niveles), patron, colores, ...(impresos?.length ? { impresos } : {}) });

/** Una cinta (escenografía: no cotiza) de `desde` a `hasta`, en el mundo. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado: "satinado", en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

/**
 * Un aro de tubito (el accesorio «aro» de las figuras, sin figura): `horizontal`, alrededor de un tallo (puesto mirando
 * al frente queda acostado); `frente`, de pie mirando a quien ve. El origen es su centro.
 */
const aro = (t: { formatoId: string; grosorCm: number; codigo: string }, radioCm: number, plano: "horizontal" | "frente"): Decoracion => ({
  tipo: "figura",
  propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, queEs: "a twisted-balloon ring", accesorios: [{ en: "base", forma: { tipo: "aro", tubito: t, radioCm, plano, desdeGrados: 0, hastaGrados: 360 } }] },
});

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos), con la cantidad contada. */
function liso(formatoId: string, codigo: string, cantidad: number | null): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const p = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const x = productoDeGlobo(formatoId, codigo); return { nombre: x.nombre, url: quitarOrigen(x.url) }; })();
  return cantidad === null ? { nombre: p.nombre, url: p.url, formato: formatoId, codigo, cantidad: null } : { nombre: p.nombre, url: p.url, formato: formatoId, codigo, cantidad, contada: true };
}

/** Un producto que la idea publica (nombre y url tal cual, con el formato y código de la foto). */
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
 * y color de fondo; cada metalizado; y los lisos (lo que queda de cada formato y código). Lo que la idea publica sale
 * con su nombre y url tal cual (si la foto no lo tiene, sin cantidad); lo demás, con el producto liso de la tienda.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[] = []): ProductoDeIdea[] {
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

// ----------------------------------------------------------------------------------------------------------
// Las 20 ideas
// ----------------------------------------------------------------------------------------------------------

const CDN = "https://sempertex.com/cdn/shop/articles/";

type Base = Omit<IdeaDigitalizada, "id" | "productos" | "contenido" | "clase"> & { escena: () => Escena; publicados?: Publicado[] };

/**
 * La idea completa: su id «idea:<slug>» y sus productos (los de lo armado, que es lo contado en la foto). Perezosa
 * (`ideaPerezosa`): la escena se arma la primera vez que se pide su contenido o sus productos, y una sola vez.
 */
function idea(b: Base): IdeaDigitalizada {
  const { escena, publicados, ...resto } = b;
  const hecha = perezoso(escena);
  return ideaPerezosa({ id: `idea:${b.slug}`, ...resto, clase: "escena" }, () => ({ tipo: "escena", escena: hecha() }), () => productosDe(hecha(), publicados));
}

// ----------------------------------------------------------------------------------------------------------
// 270 · Centro de mesa copa despedida de soltera
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el R-12 de la base mide ~95 px (28 cm): 3,4 px/cm, con el piso en y = 545 px. De abajo arriba:
 * base de un cuarteto R-12 con un globo al frente (centro a 13 cm) y 4 moños rosados; dos cuartetos R-9 de ~67 px
 * (20 cm), sin girar entre sí (los dos con un hueco al frente), a 33 y 49 cm, con R-5 en los huecos; la copa: 4 R-12
 * abiertos alrededor del cuello del R-24 (~88 px, 26 cm: el ancho de la copa, 65 cm, pide ~22 cm del eje a cada
 * globo), con un collar de perlas; y el R-24 negro de la copa (222 px: ~65 cm; el R-24 llega a 61) con lo más ancho
 * a 112 cm.
 */
const MONO_270: Decoracion = { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 3.5, codigo: "009", lazosPorLado: 1, largoLazoCm: 13, anchoLazoCm: 9, aberturaGrados: 40, colas: true, largoColaCm: 16, centro: R("R-5", 9, "011") } };
const escena270 = (): Escena => {
  const FUCSIA = "011", PERLA = "406";
  const m = montaje(
    { id: "columna", nombre: "Columna fucsia de la copa", pieza: cuarteto(R("R-9", 20, FUCSIA), [FUCSIA]), origen: v(0, 33, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 90, radioCm: 0.7, hex: "#e8e8e8" },
  );
  m.nivel("nivel-2", "Cuarteto R-9 fucsia de arriba", R("R-9", 20, FUCSIA), [FUCSIA], v(0, 49, 0), 0);
  m.nivel("base", "Base: cuarteto R-12 fucsia", R("R-12", 28, FUCSIA), [FUCSIA], v(0, 15.5, 0), 45);
  // Un R-5 en cada hueco entre los dos R-9 (el de delante se ve) y entre el R-9 de arriba y la copa.
  m.anillo("relleno-bajo", "R-5 fucsia entre los R-9", R("R-5", 8, FUCSIA), 4, 41, 11, 0);
  m.anillo("relleno-alto", "R-5 fucsia bajo la copa", R("R-5", 9, FUCSIA), 4, 61, 13, 10);
  // La copa: 4 R-12 abiertos (huecos al frente y atrás, como en la foto) que sostienen el R-24.
  m.anillo("copa", "R-12 fucsia de la copa", R("R-12", 27, FUCSIA), 4, 72, 21, 25, 45);
  m.anillo("perla", "Perla R-5 Satín Perla", R("R-5", 7, PERLA), 26, 81, 29, 35, 0);
  m.globo("remate", "R-24 negro (impreso de copa)", R("R-24", 60, "080"), v(0, 112, 0));
  // Los moños, en los huecos de la base (los dos de delante se ven; los de atrás, por simetría).
  [-50, 50, 130, -130].forEach((a, k) => m.deco(`mono-${k + 1}`, `Moño rosado ${k + 1}`, MONO_270, enAnillo(a, 30, 15), fuera(a)));
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 271 · Centro de mesa corazón
// ----------------------------------------------------------------------------------------------------------

/** Un trío de globitos (flor de 3 sin centro) metido en un hueco, mirando hacia `normal`. */
const trio = (g: ParteGlobo, giroGrados = 0): Decoracion => ({ tipo: "flor", propiedades: { petalos: { ...g, cantidad: 3, aperturaGrados: 35, giroGrados }, centro: null } });

/**
 * Foto de 1600×1600; el Corazón 12 «LOVE» y el R-12 «Feliz día Mamá» miden ~400 px (28 cm): 14,3 px/cm (los dos van
 * delante y se ven un poco más grandes), con el piso en y = 1565 px y la vara en x = 770 px. Base (31 × 36 cm): dos
 * anillos de R-5 rojo imperial de ~6 cm en el piso, un cuarteto de R-5 a 11 cm (los rojos grandes de los lados), dos
 * R-5 blancos de 8,5 cm al frente, un anillo de R-5 plata y rojo a 23 cm, cuatro plata a 30 cm y un trío blanco
 * arriba. Vara roja forrada con un T-260 sin inflar hasta el racimo de arriba (centro a 70 cm, 43 cm de ancho): 12
 * plata de ~17 cm (R-9) en racimo redondo con tríos de R-5 rojo imperial de ~6 cm en sus huecos.
 */
const escena271 = (): Escena => {
  const ROJO = "016", PLATA = "981", BLANCO = "005";
  const m = montaje(
    { id: "base", nombre: "Base de racimo rojo imperial, plata y blanco", pieza: cuarteto(R("R-5", 11, ROJO), [ROJO]), origen: v(0, 15, 0) },
    { nombre: "Vara roja", base: v(0, 0, 0), altoCm: 66, radioCm: 0.45, hex: "#7a0d12", acabado: "satinado" },
  );
  m.anillo("piso-1", "R-5 rojo imperial del piso", R("R-5", 6, ROJO), 12, 3.5, 11, 0);
  m.anillo("piso-2", "R-5 rojo imperial del segundo anillo", R("R-5", 6, ROJO), 11, 9, 10, 10, 16);
  m.globo("blanco-1", "R-5 blanco de la base (izquierda)", R("R-5", 8.5, BLANCO), v(-4.2, 16, 8.5), haciaFuera(-25, 10));
  m.globo("blanco-2", "R-5 blanco de la base (derecha)", R("R-5", 8.5, BLANCO), v(4.5, 16, 8.5), haciaFuera(25, 10));
  [PLATA, PLATA, ROJO, ROJO, ROJO, PLATA, PLATA, PLATA].forEach((c, k) => {
    const a = -100 + k * 45;
    m.globo(`medio-${k + 1}`, `R-5 ${c === PLATA ? "plata" : "rojo imperial"} del medio ${k + 1}`, R("R-5", 7, c), enAnillo(a, 7.5, 23), haciaFuera(a, 20));
  });
  m.anillo("plata-arriba", "R-5 plata de arriba", R("R-5", 9, PLATA), 4, 29.5, 6, 35, 45);
  m.deco("trio-blanco", "Trío R-5 blanco de arriba", trio(R("R-5", 5.5, BLANCO)), v(0, 33, 4), haciaFuera(0, 50));
  // La vara va forrada con un T-260 sin inflar (el «tallo de tubito rojo»).
  m.palito("forro", "T-260 rojo imperial que forra la vara", { formatoId: "T-260", grosorCm: 1.1, codigo: ROJO }, v(0, 33, 0), v(0, 62, 0));
  // Racimo de arriba: 12 plata en los vértices de un icosaedro y un trío rojo en cada una de sus 20 caras.
  const C = v(0, 70, 0);
  ICOSAEDRO().forEach((d, k) => m.globo(`plata-${k + 1}`, `R-9 plata del racimo ${k + 1}`, R("R-9", 17, PLATA), mas(C, por(d, 14)), d));
  CARAS_ICOSAEDRO().forEach((d, k) => m.deco(`trio-${k + 1}`, `Trío R-5 rojo imperial del racimo ${k + 1}`, trio(R("R-5", 6, ROJO), 20 * k), mas(C, por(d, 17.5)), d));
  m.globo("feliz-mama", "R-12 rojo impreso «Feliz día Mami»", R("R-12", 28, "015"), v(19.6, 90.5, 6), haciaFuera(70, 60), "infinity-feliz-dia-mami-flores-fashion-surtido-rojo-blanco");
  m.globo("corazon", "Corazón 12 rojo «LOVE»", R("C-12", 30, "015"), v(-19.6, 36.7, 10), haciaFuera(-70, 45), "corazon-2-caras-love-fashion-rojo");
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 273 · Centro de mesa corazón reflex
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; el R-12 palo de rosa grande de la base mide ~140 px (28 cm): 5 px/cm, con la mesa en y = 960 px y
 * la vara dorada en x = 488 px. Base (80 cm de ancho, montículo de hasta 60 cm a la izquierda): R-12 palo de rosa,
 * R-9 arena de ~16 cm, R-5 reflex rosado, dorados con estrellas y palo de rosa. Racimo de arriba (centro a ~108 cm, 100
 * cm de ancho con el dorado): R-12 arena, palo de rosa y reflex rosado, un R-18 dorado «Feliz día mamá» arriba a la
 * izquierda (~225 px: 45 cm) y R-5 entre ellos. El corazón cromado (~240 px: 47 cm) es el metalizado de 18".
 */
const escena273 = (): Escena => {
  const ARENA = "071", PALO = "010", REFLEX = "909", DORADO = "970";
  const ESTRELLAS = "infinity-estrellas-reflex-dorado";
  const m = montaje(
    { id: "base", nombre: "Base de racimo palo de rosa, arena y reflex", pieza: cuarteto(R("R-12", 27, PALO), [PALO]), origen: v(0, 15, 0) },
    { nombre: "Vara dorada", base: v(0, 0, 0), altoCm: 92, radioCm: 0.6, hex: "#c9a14a", acabado: "metal" },
  );
  const b = (id: string, nombre: string, g: ParteGlobo, a: number, radio: number, y: number, elev: number, impreso?: string) => m.globo(id, nombre, g, enAnillo(a, radio, y), haciaFuera(a, elev), impreso);
  // Segundo piso de la base y el montículo de la izquierda.
  b("base-arena-1", "R-9 arena de la base 1", R("R-9", 16, ARENA), -55, 15, 33, 30);
  b("base-arena-2", "R-9 arena de la base 2", R("R-9", 16, ARENA), 25, 14, 31, 30);
  b("base-arena-3", "R-9 arena de la base 3", R("R-9", 16, ARENA), 150, 14, 32, 30);
  b("base-reflex-1", "R-5 reflex rosado de la base 1", R("R-5", 12.5, REFLEX), -25, 18, 37, 30);
  b("base-reflex-2", "R-5 reflex rosado de la base 2", R("R-5", 12.5, REFLEX), 70, 20, 38, 20);
  b("base-reflex-3", "R-5 reflex rosado de la base 3", R("R-5", 12.5, REFLEX), 115, 26, 16, 10);
  b("base-reflex-4", "R-5 reflex rosado de la base 4", R("R-5", 12.5, REFLEX), -100, 21, 47, 35);
  b("base-estrellas-1", "R-5 dorado con estrellas de la base 1", R("R-5", 12.5, DORADO), 5, 13, 44, 45, ESTRELLAS);
  b("base-estrellas-2", "R-5 dorado con estrellas de la base 2", R("R-5", 12.5, DORADO), 55, 22, 33, 25, ESTRELLAS);
  b("base-estrellas-3", "R-5 dorado con estrellas de la base 3", R("R-5", 12.5, DORADO), -75, 28, 14, 10, ESTRELLAS);
  b("base-palo-1", "R-5 palo de rosa de la base 1", R("R-5", 11, PALO), -60, 30, 24, 15);
  b("base-palo-2", "R-5 palo de rosa de la base 2", R("R-5", 11, PALO), 95, 30, 30, 10);
  b("base-palo-3", "R-5 palo de rosa de la base 3", R("R-5", 11, PALO), -110, 30, 51, 30);
  b("base-palo-4", "R-9 palo de rosa del montículo", R("R-9", 16, PALO), -130, 24, 55, 40);
  b("base-arena-4", "R-5 arena de la base 1", R("R-5", 10, ARENA), -50, 30, 6, 0);
  b("base-arena-5", "R-5 arena de la base 2", R("R-5", 10, ARENA), 40, 31, 7, 0);
  b("base-arena-6", "R-5 arena de la base 3", R("R-5", 10, ARENA), 80, 30, 48, 30);
  // El corazón metalizado, inclinado a la derecha, apoyado en el lado derecho de la base.
  const inclinado = unitario(v(0.45, 1, 0));
  m.pieza("corazon", "Corazón metalizado rosado de 18\"", { tipo: "metalizado", metalizado: metalizadoDeTienda("corazon-lavanda") }, v(38, 30, 4), inclinado, giroAlFrente(inclinado));
  // Racimo de arriba.
  const t = (id: string, nombre: string, g: ParteGlobo, x: number, y: number, z: number, d: Vec3, impreso?: string) => m.globo(id, nombre, g, v(x, y, z), d, impreso);
  t("arriba-arena-1", "R-12 arena de arriba", R("R-12", 29, ARENA), -3.6, 132, -4, haciaFuera(0, 70));
  t("arriba-palo-1", "R-12 palo de rosa del frente", R("R-12", 30, PALO), 6, 105, 13, haciaFuera(10, 10));
  t("arriba-arena-2", "R-12 arena de la izquierda", R("R-12", 27, ARENA), -24, 105, 4, haciaFuera(-70, 10));
  t("arriba-arena-3", "R-12 arena de la derecha", R("R-12", 27, ARENA), 29, 89, 2, haciaFuera(80, -10));
  t("arriba-reflex-1", "R-12 reflex rosado de la derecha", R("R-12", 24, REFLEX), 28, 122, -2, haciaFuera(70, 40));
  t("arriba-reflex-2", "R-12 reflex rosado de abajo", R("R-12", 28, REFLEX), -3.6, 78, 6, haciaFuera(0, -60));
  t("arriba-palo-2", "R-12 palo de rosa de atrás", R("R-12", 28, PALO), 0, 110, -20, haciaFuera(180, 10));
  t("arriba-arena-4", "R-12 arena de atrás", R("R-12", 27, ARENA), 18, 98, -18, haciaFuera(140, 0));
  t("arriba-reflex-3", "R-12 reflex rosado de atrás", R("R-12", 26, REFLEX), -18, 96, -16, haciaFuera(-140, 0));
  t("feliz-mama", "R-18 reflex dorado (impreso «Feliz día mamá»)", R("R-18", 44, DORADO), -40, 138, 6, haciaFuera(-60, 45));
  t("arriba-estrellas-1", "R-5 dorado con estrellas de arriba 1", R("R-5", 12.5, DORADO), 15, 127, 12, haciaFuera(30, 40), ESTRELLAS);
  t("arriba-estrellas-2", "R-5 dorado con estrellas de arriba 2", R("R-5", 12.5, DORADO), -24, 83, 10, haciaFuera(-40, -20), ESTRELLAS);
  t("arriba-estrellas-3", "R-5 dorado con estrellas de arriba 3", R("R-5", 12.5, DORADO), 15, 83, 13, haciaFuera(40, -20), ESTRELLAS);
  t("arriba-reflex-4", "R-5 reflex rosado de arriba 1", R("R-5", 10, REFLEX), -11, 118, 14, haciaFuera(-20, 30));
  t("arriba-reflex-5", "R-5 reflex rosado de arriba 2", R("R-5", 10, REFLEX), -14, 110, 16, haciaFuera(-30, 10));
  t("arriba-reflex-6", "R-5 reflex rosado de arriba 3", R("R-5", 10, REFLEX), -10, 88, 15, haciaFuera(-20, -20));
  t("arriba-reflex-7", "R-5 reflex rosado de arriba 4", R("R-5", 10, REFLEX), 26, 111, 12, haciaFuera(50, 20));
  t("arriba-reflex-8", "R-5 reflex rosado de arriba 5", R("R-5", 10, REFLEX), 26, 105, 13, haciaFuera(50, 0));
  t("arriba-palo-3", "R-5 palo de rosa de arriba 1", R("R-5", 11, PALO), -19, 92, 14, haciaFuera(-40, -10));
  t("arriba-palo-4", "R-5 palo de rosa de arriba 2", R("R-5", 11, PALO), -13, 96, 15, haciaFuera(-20, 0));
  t("arriba-palo-5", "R-5 palo de rosa de arriba 3", R("R-5", 11, PALO), 33, 108, 8, haciaFuera(80, 10));
  t("arriba-arena-5", "R-5 arena de arriba 1", R("R-5", 10, ARENA), -20, 117, 14, haciaFuera(-40, 30));
  t("arriba-arena-6", "R-5 arena de arriba 2", R("R-5", 10, ARENA), 38, 106, 2, haciaFuera(90, 10));
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 279 · Centro de mesa de amor en fucsia y lila
// ----------------------------------------------------------------------------------------------------------

/** Flor de 5 burbujas de T-260 blanco con un R-5 al centro. */
const florBurbujas = (codigo: string, centro: ParteGlobo, largoCm = 8): Decoracion => ({
  tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 5, codigos: [codigo], cantidad: 5, estilo: "burbuja", largoCm, anchoCm: 5, aperturaGrados: 10, giroGrados: 90 }, interior: null, corona: null, centro },
});

/**
 * Foto de 740×570; los globitos de la base miden ~60 px (R-5 a 12 cm): 5 px/cm, con la mesa en y = 505 px y el centro
 * en x = 370 px. Base orgánica baja de 106 × 41 cm: R-5 y R-9 fucsia, lila, pastel rosado y plata (los cuatro colores
 * publicados), con tres flores de burbujas blancas de centro plata. Encima, de pie, el corazón fucsia «Te amo» de
 * ~335 px (67 cm) de ancho.
 */
const escena279 = (): Escena => {
  const LILA = "050", ROSADO = "609", FUCSIA = "012", PLATA = "981";
  const corazon: Pieza = { tipo: "metalizado", metalizado: { ...metalizadoDeTienda("corazon-lavanda"), impreso: { dibujo: "texto", texto: "TE ♥\nAMO", hex: "#ffffff" } } };
  const m = montaje(
    { id: "corazon", nombre: "Corazón fucsia «Te amo»", pieza: corazon, origen: v(-6, 33, -2) },
    { nombre: "Varilla del corazón", base: v(-6, 0, -2), altoCm: 40, radioCm: 0.5, hex: "#e8e8e8" },
  );
  const COLOR: Readonly<Record<string, string>> = { [LILA]: "lila", [ROSADO]: "pastel rosado", [FUCSIA]: "fucsia", [PLATA]: "plata" };
  // [x, y, z, formato, inflado, código], medidos en la foto (delante) y supuestos detrás (la foto no los muestra).
  const globos: ReadonlyArray<[number, number, number, string, number, string]> = [
    [-61, 35, 0, "R-5", 9, PLATA], [-55, 19, 4, "R-9", 14, ROSADO], [-38, 22, 8, "R-9", 14, FUCSIA], [-41, 9, 6, "R-5", 11, FUCSIA],
    [-23, 19, 10, "R-5", 12, PLATA], [-25, 9, 10, "R-5", 12, LILA], [-13, 10, 12, "R-5", 12, FUCSIA], [-4, 19, 12, "R-9", 15, LILA],
    [-3, 6, 12, "R-5", 9, PLATA], [10, 22, 6, "R-9", 13, LILA], [20, 19, 8, "R-5", 12, FUCSIA], [27, 12, 10, "R-5", 12, PLATA],
    [35, 22, 6, "R-9", 15, FUCSIA], [43, 6, 6, "R-5", 10, PLATA], [24, 4, 10, "R-5", 9, FUCSIA], [37, 10, 0, "R-5", 9, ROSADO],
    [-18, 34, -2, "R-5", 9, PLATA], [-10, 30, 0, "R-5", 12, PLATA], [3, 31, 0, "R-5", 11, PLATA], [11, 31, -4, "R-5", 8, ROSADO],
    [23, 27, -4, "R-9", 19, ROSADO], [26, 35, -10, "R-5", 10, LILA], [-8, 25, 4, "R-5", 10, FUCSIA], [-19, 24, 0, "R-5", 10, ROSADO],
    [-50, 32, -8, "R-5", 10, FUCSIA], [48, 28, -6, "R-9", 15, FUCSIA], [56, 14, 0, "R-5", 11, ROSADO],
    [-40, 14, -10, "R-5", 12, FUCSIA], [-20, 14, -12, "R-5", 12, LILA], [0, 13, -12, "R-5", 12, PLATA], [20, 14, -12, "R-5", 12, FUCSIA], [40, 14, -10, "R-5", 12, ROSADO],
    [-32, 12, -2, "R-9", 14, LILA], [-12, 18, -4, "R-9", 14, ROSADO], [8, 10, -2, "R-9", 14, FUCSIA], [30, 18, -4, "R-5", 12, LILA], [-48, 22, -4, "R-5", 12, PLATA], [14, 34, -10, "R-5", 11, FUCSIA],
  ];
  globos.forEach(([x, y, z, f, d, c], k) => {
    // La base se ve más apretada que lo medido de frente (los globos de atrás tapan los huecos): se junta un 15 % a lo ancho.
    const centro = v(r2(x * 0.85), Math.max(y, d * 0.62 + 2.5), z);
    m.globo(`base-${k + 1}`, `${f} ${COLOR[c]} de la base ${k + 1}`, R(f, d, c), centro, unitario(v(x * 0.02, 1, z * 0.04 + 0.3)));
  });
  m.deco("flor-1", "Flor de burbujas blancas (izquierda)", florBurbujas("005", R("R-5", 7, PLATA)), v(-32, 37, 8), unitario(v(-0.2, 0.6, 1)));
  m.deco("flor-2", "Flor de burbujas blancas (derecha)", florBurbujas("005", R("R-5", 7, PLATA)), v(44, 37, 6), unitario(v(0.2, 0.6, 1)));
  m.deco("flor-3", "Flor de burbujas blancas (abajo)", florBurbujas("005", R("R-5", 7, PLATA)), v(12, 11, 17), AL_FRENTE);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 280 · Centro de mesa del oeste
// ----------------------------------------------------------------------------------------------------------

const PAPA_OESTE = "infinity-r-feliz-dia-papa-oeste-fashion-surtido";

/**
 * Foto de 1000×1000; el R-12 azul impreso de arriba mide ~150 px (28 cm): 5,4 px/cm, con el piso en y = 958 px y el eje
 * en x = 515 px. Base (40 × 25 cm): dos cuartetos R-9 azul rey de ~95 px (18 cm) y 8 R-5 azul rey de ~6,5 cm en sus
 * huecos. Columna de 6 niveles de cuartetos R-5 de ~52 px (10 cm) en espiral de 4 colores (arena, latte, azul rey y
 * café), de 42 cm de alto: los niveles van a 6,2 cm (0,62 diámetros), no a los 8 del paso del taller. Encima, el R-12
 * «Feliz día papá» azul; con helio, el café a 151 cm y el mostaza a 122 cm, con cintas doradas.
 */
const escena280 = (): Escena => {
  const ARENA = "071", LATTE = "073", CAFE = "074", AZUL = "041";
  const ESPIRAL = [ARENA, LATTE, AZUL, CAFE];
  const R5 = R("R-5", 10, ARENA);
  const m = montaje(
    { id: "columna", nombre: "Columna espiral arena, latte, azul y café", pieza: cuarteto(R5, alReves(ESPIRAL), "espiral"), origen: v(0, 33.5, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 72, radioCm: 0.5, hex: "#e8e8e8" },
  );
  for (let k = 1; k < 6; k++) m.nivel(`nivel-${k + 1}`, `Nivel ${k + 1} de la columna espiral`, R5, ESPIRAL, v(0, r2(33.5 + 6.2 * k), 0), giroEspiral(k), "espiral");
  m.nivel("base-1", "Base: cuarteto R-9 azul rey de abajo", R("R-9", 18, AZUL), [AZUL], v(0, 9, 0), 45);
  m.nivel("base-2", "Base: cuarteto R-9 azul rey de arriba", R("R-9", 18, AZUL), [AZUL], v(0, 21.5, 0), 0);
  m.anillo("base-r5", "R-5 azul rey de la base", R("R-5", 6.5, AZUL), 8, 7, 18, 0, 22.5);
  m.globo("remate", "R-12 azul rey «Feliz día papá»", R("R-12", 28, AZUL), v(0, 78, 2), ARRIBA, PAPA_OESTE);
  m.globo("helio-cafe", "R-12 café «Feliz día papá» con helio", R("R-12", 28, CAFE), v(-11, 151, -6), unitario(v(-0.15, 1, 0)), PAPA_OESTE);
  m.globo("helio-mostaza", "R-12 mostaza «Feliz día papá» con helio", R("R-12", 28, "023"), v(5, 122, -10), unitario(v(0.1, 1, 0)), PAPA_OESTE);
  const amarre = v(0, 68, -4);
  m.escenografia("cintas", "Cintas doradas", [cinta(amarre, v(-9.5, 135, -6), "#c9a14a"), cinta(amarre, v(4, 106, -10), "#c9a14a")]);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 282 · Centro de mesa emoji
// ----------------------------------------------------------------------------------------------------------

/**
 * Una cara de emoji sobre un globo (el impreso de la foto no está en el catálogo): la cabeza de una figura sin cuerpo,
 * con ojos, sonrisa y mejillas dibujados (no cotizan). El globo es el liso de su color.
 */
const emoji = (g: ParteGlobo, cara: { ojos: "puntos" | "ovalos"; boca: "sonrisa" | "abierta" | "beso"; mejillas: string | null }, queEs: string): Decoracion => ({
  tipo: "figura",
  propiedades: {
    postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, brazos: null, accesorios: [], queEs,
    cabeza: { ...g, cara: { ojos: { estilo: cara.ojos, hex: "#1b1b1f" }, boca: { estilo: cara.boca, hex: "#1b1b1f" }, mejillas: cara.mejillas ? { hex: cara.mejillas } : null, bigote: null, nariz: null, cejas: null } },
  },
});

/**
 * Foto de 740×570; el R-12 emoji mide ~165 px (28 cm): 5,9 px/cm, con la mesa en y = 550 px y el eje en x = 375 px.
 * Base (34 × 30 cm): tres cuartetos R-9 amarillo miel de ~14 cm, con 12 R-5 de colores de ~7,5 cm clavados alrededor
 * (10 se ven). Tallo de T-260 negro inflado (~30 px: 5 cm) de 24 a 62 cm, corbatín de dos R-5 negros y cintas rizadas;
 * el emoji, con su centro a 78 cm.
 */
const escena282 = (): Escena => {
  const AMARILLO = "021";
  const g = R("R-9", 14, AMARILLO);
  const m = montaje(
    { id: "base", nombre: "Base de racimo amarillo", pieza: cuarteto(g, [AMARILLO]), origen: v(0, 15, 0) },
    { nombre: "Varilla del tallo", base: v(0, 0, 0), altoCm: 64, radioCm: 0.5, hex: "#1b1b1f" },
  );
  m.nivel("base-abajo", "Cuarteto amarillo de abajo", g, [AMARILLO], v(0, 8, 0), 45);
  m.nivel("base-arriba", "Cuarteto amarillo de arriba", g, [AMARILLO], v(0, 24, 0), 45);
  // Los R-5 de colores, clavados alrededor de la base: [x, y, código] de frente (z sale del radio) y dos detrás.
  const acentos: ReadonlyArray<[number, number, string, string]> = [
    [-14.6, 31.5, "061", "naranja"], [14.4, 31.5, "040", "azul"], [18.1, 23.4, "029", "verde trébol"], [-18.1, 21, "040", "azul"],
    [-20.5, 10.8, "029", "verde trébol"], [-5, 18.6, "014", "frambuesa"], [17.3, 9, "061", "naranja"], [18.1, 4.6, "014", "frambuesa"],
    [-3, 4.5, "038", "azul caribe"], [-12.7, 5.9, "015", "rojo"], [8, 26, "014", "frambuesa"], [-6, 12, "038", "azul caribe"],
  ];
  acentos.forEach(([x, y, c, nombre], k) => {
    const atras = k >= 10;
    const z = (atras ? -1 : 1) * Math.sqrt(Math.max(0, 21 ** 2 - x * x));
    const d = unitario(v(x, (y - 15) * 0.6, z));
    m.globo(`acento-${k + 1}`, `R-5 ${nombre} clavado ${k + 1}`, R("R-5", 7.5, c), v(x, y, r2(z)), d);
  });
  m.palito("tallo", "Tallo de T-260 negro", { formatoId: "T-260", grosorCm: 5, codigo: "080" }, v(0, 26, 0), v(0, 62, 0));
  m.globo("corbatin-1", "R-5 negro del corbatín (izquierda)", R("R-5", 7.5, "080"), v(-4, 60, 2), unitario(v(-1, 0.2, 0.3)));
  m.globo("corbatin-2", "R-5 negro del corbatín (derecha)", R("R-5", 7.5, "080"), v(4, 60, 2), unitario(v(1, 0.2, 0.3)));
  m.escenografia("cintas", "Cintas rizadas de colores", [
    cinta(v(-1, 57, 3), v(-4.5, 39, 4), "#f29a1d", 0.3), cinta(v(0, 57, 3), v(-2, 42, 4), "#e8306f", 0.3),
    cinta(v(1, 57, 3), v(1.5, 37, 4), "#3fbf3a", 0.3), cinta(v(2, 57, 3), v(4.8, 41, 4), "#e23a2a", 0.3),
  ]);
  m.deco("emoji", "R-12 amarillo miel con cara de emoji", emoji(R("R-12", 28, AMARILLO), { ojos: "ovalos", boca: "sonrisa", mejillas: "#f0605d" }, "a yellow smiley-face emoji balloon"), v(0, 66, 0), AL_FRENTE);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 284 · Centro de mesa feliz cumpleaños flor
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el grosor del T-260 (~25 px a 5 cm) da 5 px/cm, con la mesa en y = 570 px y el eje en x = 377 px.
 * Base: un cuarteto R-5 verde de ~11 cm y encima uno verde trébol de ~8,5 cm; dos hojas en lazo de T-260 verde selva;
 * tallo de dos T-260 (verde y verde selva) torcidos, de 22 a 53 cm; dos R-5 fucsia en el cuello. La flor (centro a 75
 * cm, 72 cm de punta a punta): 8 lazos de T-260 amarillo de 36 cm en estrella, un aro de 12 burbujas amarillas
 * alrededor del metalizado «Feliz cumpleaños» de rayas (~133 px: 27 cm, ~10").
 */
const escena284 = (): Escena => {
  const AMARILLO = "020", VERDE = "030", TREBOL = "029", SELVA = "032";
  const foil = { ...metalizadoDeTienda("festivo"), pulgadas: 10 };
  const altoFoil = armarPieza({ tipo: "metalizado", metalizado: foil }).caja;
  const C = v(0, 75, 0);
  const m = montaje(
    { id: "metalizado", nombre: "Metalizado «Feliz cumpleaños» de la flor", pieza: { tipo: "metalizado", metalizado: foil }, origen: v(0, r2(C.y - (altoFoil.max.y - altoFoil.min.y) / 2), 1) },
    { nombre: "Varilla del tallo", base: v(0, 0, 0), altoCm: 70, radioCm: 0.5, hex: "#1f7a4a" },
  );
  m.nivel("base-verde", "Base: cuarteto R-5 verde", R("R-5", 11, VERDE), [VERDE], v(0, 7, 0), 45);
  m.nivel("base-trebol", "Base: cuarteto R-5 verde trébol", R("R-5", 8.5, TREBOL), [TREBOL], v(0, 15.5, 0), 0);
  m.deco("hojas", "Hojas en lazo de T-260 verde selva", { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 3.5, codigos: [SELVA], cantidad: 2, estilo: "lazo", largoCm: 15, anchoCm: 7, aperturaGrados: 35, giroGrados: 0 }, interior: null, corona: null, centro: null } }, v(0, 21, 0), ARRIBA, 90);
  const T = (codigo: string) => ({ formatoId: "T-260", grosorCm: 3.5, codigo });
  m.palito("tallo-verde", "Tallo de T-260 verde", T(VERDE), v(-1.2, 21, 0), v(1.2, 53, 0.5));
  m.palito("tallo-selva", "Tallo de T-260 verde selva", T(SELVA), v(1.2, 21, 0.5), v(-1.2, 53, 0));
  m.globo("cuello-1", "R-5 fucsia del cuello (izquierda)", R("R-5", 7, "011"), v(-3.6, 55.5, 2), unitario(v(-1, 0.3, 0.4)));
  m.globo("cuello-2", "R-5 fucsia del cuello (derecha)", R("R-5", 7, "011"), v(3.6, 55.5, 2), unitario(v(1, 0.3, 0.4)));
  m.deco("petalos", "Flor de 8 lazos amarillos", { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 5, codigos: [AMARILLO], cantidad: 8, estilo: "lazo", largoCm: 36, anchoCm: 11, aperturaGrados: 0, giroGrados: 15 }, interior: null, corona: null, centro: null } }, mas(C, v(0, 0, -3)), AL_FRENTE);
  // El aro de burbujas alrededor del metalizado: un aro de T-260 de 16 cm de radio, de pie.
  m.deco("aro", "Aro de T-260 amarillo alrededor del metalizado", aro({ formatoId: "T-260", grosorCm: 5, codigo: AMARILLO }, 16, "frente"), mas(C, v(0, -18.5, -1)), AL_FRENTE);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 290 · Centro de mesa fútbol
// ----------------------------------------------------------------------------------------------------------

const BALON_BLANCO = "infinity-balon-de-futbol-fashion-blanco", BALON_SURTIDO = "infinity-balon-de-futbol-fashion-surtido";

/**
 * Foto de 740×570; el balón R-12 de arriba mide ~100 px (30 cm): 3,2 px/cm, con el piso en y = 560 px y el eje en x =
 * 400 px. Base (37 cm de ancho): dos cuartetos R-9 blancos de ~12,5 cm con R-5 negros en los huecos (un balón). Columna
 * de 5 niveles de cuartetos R-5 de colores de ~8 cm (35 cm de alto, ~7 cm por nivel) en espiral; encima el balón
 * blanco impreso; con helio, tres balones de colores (amarillo a 155, verde a 127 y naranja a 120 cm) con cintas rosadas.
 */
const escena290 = (): Escena => {
  const VERDE = "029", NARANJA = "061", AZUL = "040", ROJO = "015", AMARILLO = "021";
  const SERIE = [VERDE, NARANJA, AZUL, ROJO, AMARILLO];
  const colores = (k: number) => [0, 1, 2, 3].map((i) => SERIE[(k + i) % SERIE.length]!);
  const r5 = R("R-5", 8, VERDE);
  const y0 = 27;
  const m = montaje(
    { id: "columna", nombre: "Columna de colores del balón", pieza: cuarteto(r5, alReves(colores(0)), "espiral"), origen: v(0, y0, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 80, radioCm: 0.4, hex: "#e8e8e8" },
  );
  for (let k = 1; k < 5; k++) m.nivel(`nivel-${k + 1}`, `Nivel ${k + 1} de la columna de colores`, r5, colores(k), v(0, y0 + 7 * k, 0), giroEspiral(k), "espiral");
  m.nivel("base-abajo", "Base: cuarteto R-9 blanco de abajo", R("R-9", 13, "005"), ["005"], v(0, 7, 0), 45);
  m.nivel("base-arriba", "Base: cuarteto R-9 blanco de arriba", R("R-9", 13, "005"), ["005"], v(0, 17, 0), 0);
  m.anillo("negro-abajo", "R-5 negro de la base (abajo)", R("R-5", 8, "080"), 4, 6, 15, 0, 45);
  m.anillo("negro-arriba", "R-5 negro de la base (arriba)", R("R-5", 8, "080"), 4, 15, 14, 15, 0);
  m.globo("balon", "Balón R-12 blanco", R("R-12", 30, "005"), v(0, 74, 1), ARRIBA, BALON_BLANCO);
  m.globo("helio-amarillo", "Balón R-12 amarillo con helio", R("R-12", 28, "020"), v(-12, 155, -6), unitario(v(-0.1, 1, 0)), BALON_SURTIDO);
  m.globo("helio-verde", "Balón R-12 verde lima con helio", R("R-12", 28, "031"), v(-28, 127, -4), unitario(v(-0.35, 1, 0)), BALON_SURTIDO);
  m.globo("helio-naranja", "Balón R-12 naranja con helio", R("R-12", 28, "061"), v(2, 120, 2), unitario(v(0.15, 1, 0)), BALON_SURTIDO);
  const amarre = v(-1, 86, -4);
  m.escenografia("cintas", "Cintas rosadas", [cinta(amarre, v(-10, 140, -6), "#f2a7c3"), cinta(amarre, v(-23, 112, -4), "#f2a7c3"), cinta(amarre, v(0, 104, 2), "#f2a7c3")]);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 302 · Centro de mesa para mamá
// ----------------------------------------------------------------------------------------------------------

/** Una flor de globos redondos (pétalos y, si se pide, un centro). */
const florGlobos = (g: ParteGlobo, cantidad: number, aperturaGrados: number, centro: ParteGlobo | null = null, giroGrados = 0): Decoracion =>
  ({ tipo: "flor", propiedades: { petalos: { ...g, cantidad, aperturaGrados, giroGrados }, centro: centro ? { ...centro, cantidad: 1 } : null } });

/**
 * Foto de 1000×1000; los dos R-12 rojos de abajo miden ~155 px (28 cm): 5,5 px/cm, con el piso en y = 925 px y el eje
 * en x = 500 px. De abajo arriba: dos R-12 reflex cristal rojo con una flor de R-5 plata al frente; tres R-5 rojos y
 * dos racimos de 7 R-5 plata; los R-12 «Feliz día mamá» rojo y dorado a los lados (~165 px: 30 cm) y el corazón
 * plata al centro (~215 px: 39 cm, metalizado de 18"); un aro de 10 R-5 dorados y un trío al frente a 74 cm; los dos
 * corazones rojos «Feliz día» (~225 px), una flor de R-5 dorados a 113 cm y el corazón plata de arriba (centro a 135
 * cm).
 */
const escena302 = (): Escena => {
  const CRISTAL_ROJO = "915", PLATA = "981", DORADO = "970";
  const CORAZONES = "infinity-feliz-dia-corazones-brillantes-metal-surtido";
  const plata = (): Pieza => ({ tipo: "metalizado", metalizado: metalizadoDeTienda("corazones-plata") });
  const rojo = (): Pieza => ({ tipo: "metalizado", metalizado: { ...metalizadoDeTienda("corazon-rojo-2"), impreso: { dibujo: "texto", texto: "Feliz\nDÍA", hex: "#ffffff" } } });
  const m = montaje(
    { id: "corazon-centro", nombre: "Corazón metalizado plata del centro", pieza: plata(), origen: v(0, 41, 0) },
    { nombre: "Varilla de la composición", base: v(0, 0, -7), altoCm: 120, radioCm: 0.5, hex: "#e8e8e8" },
  );
  m.globo("rojo-izquierda", "R-12 reflex cristal rojo de abajo (izquierda)", R("R-12", 28, CRISTAL_ROJO), v(-15, 17, 0), haciaFuera(-60, 10));
  m.globo("rojo-derecha", "R-12 reflex cristal rojo de abajo (derecha)", R("R-12", 28, CRISTAL_ROJO), v(14, 17, 0), haciaFuera(60, 10));
  m.deco("flor-plata", "Flor de R-5 plata del frente", florGlobos(R("R-5", 9, PLATA), 5, 20, R("R-5", 9, PLATA)), v(0, 22.7, 12), AL_FRENTE);
  m.globo("rojo-medio-1", "R-5 reflex cristal rojo del medio 1", R("R-5", 11, CRISTAL_ROJO), v(-9, 38, 4), haciaFuera(-30, 30));
  m.globo("rojo-medio-2", "R-5 reflex cristal rojo del medio 2", R("R-5", 11, CRISTAL_ROJO), v(0, 35.5, 7), haciaFuera(0, 20));
  m.globo("rojo-medio-3", "R-5 reflex cristal rojo del medio 3", R("R-5", 11, CRISTAL_ROJO), v(8.7, 38, 4), haciaFuera(30, 30));
  m.deco("plata-izquierda", "Racimo de R-5 plata (izquierda)", florGlobos(R("R-5", 10, PLATA), 6, 40, R("R-5", 10, PLATA)), v(-25.5, 34.5, 2), unitario(v(-0.6, 0.2, 0.8)));
  m.deco("plata-derecha", "Racimo de R-5 plata (derecha)", florGlobos(R("R-5", 10, PLATA), 6, 40, R("R-5", 10, PLATA)), v(23.6, 36, 2), unitario(v(0.6, 0.2, 0.8)));
  m.globo("mama-rojo", "R-12 metal rojo «Feliz día»", R("R-12", 30, "515"), v(-32.7, 52.7, 2), haciaFuera(-70, 20), CORAZONES);
  m.globo("mama-dorado", "R-12 metal dorado «Feliz día»", R("R-12", 30, "570"), v(32.7, 53.6, 2), haciaFuera(70, 20), CORAZONES);
  m.anillo("aro-dorado", "R-5 dorado del aro", R("R-5", 10.5, DORADO), 10, 74, 25, 15, 18);
  m.deco("trio-dorado", "Trío de R-5 dorados del frente", trio(R("R-5", 7, DORADO)), v(0, 78, 10), haciaFuera(0, 40));
  const izq = unitario(v(-0.3, 1, 0)), der = unitario(v(0.3, 1, 0));
  m.pieza("corazon-rojo-1", "Corazón metalizado rojo «Feliz día» (izquierda)", rojo(), v(-17, 78, -2), izq, giroAlFrente(izq));
  m.pieza("corazon-rojo-2", "Corazón metalizado rojo «Feliz día» (derecha)", rojo(), v(17, 78, -2), der, giroAlFrente(der));
  m.deco("flor-dorada", "Flor de R-5 dorados", florGlobos(R("R-5", 8, DORADO), 7, 10, R("R-5", 7, DORADO)), v(0, 112.7, 3), AL_FRENTE);
  m.pieza("corazon-arriba", "Corazón metalizado plata de arriba", plata(), v(0, 118, -1), ARRIBA, giroAlFrente(ARRIBA));
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 337 · Columna araña (orgánica de otoño)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto recortada de 1600×1585; los R-12 de la columna miden ~280 px (28 cm): 10 px/cm, con el pie en y ≈ 1580 px y
 * el eje en x = 1145 px. Columna de 6 cuartetos R-12 en espiral de cuatro colores (eucalipto, coral, arena y naranja:
 * el color del frente cambia cada dos niveles), a ~220 px por nivel (0,79 diámetros: el paso del taller). La araña
 * trepa por la izquierda a 109 cm: cuerpo R-12 negro con telarañas impresas (~23 cm), cabeza R-12 negra (~23 cm) con
 * cara de calabaza impresa y patas de T-260 negro de ~60 cm.
 */
const escena337 = (): Escena => {
  const EUCALIPTO = "027", CORAL = "059", ARENA = "071", NARANJA = "061";
  const columna: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 28, alturaCm: r2(6 * 0.8 * 28), patron: "espiral", colores: [EUCALIPTO, CORAL, ARENA, NARANJA] };
  const m = montaje(
    { id: "columna", nombre: "Columna espiral eucalipto, coral, arena y naranja", pieza: columna, origen: v(0, 15.5, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 140, radioCm: 0.8, hex: "#e8e8e8" },
  );
  const arana: Pieza = {
    tipo: "decoracion",
    decoracion: { tipo: "arana", propiedades: { cuerpo: R("R-12", 23, "080"), cabeza: R("R-12", 23, "080"), ojos: null, patas: { formatoId: "T-260", grosorCm: 3.5, codigo: "080", largoCm: 60, estilo: "articuladas" }, giroGrados: 90 } },
    impresos: [{ impresoId: "infinity-arana-metalink-fashion-negro", globos: [0] }],
  };
  const hacia = unitario(v(-0.65, 0.15, 0.75));
  m.pieza("arana", "Araña negra con telarañas impresas", arana, v(-36, 109, 16), hacia, 0);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 339 · Columna araña (negra con calabazas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 negros de la base miden ~75 px (28 cm): 2,7 px/cm, con el piso en y = 550 px y el eje en
 * x = 375 px. Base: un cuarteto R-12 negro; encima dos calabazas naranja de ~65 px (24 cm) con hojas y zarcillo de T-260
 * verde selva; tallo de escarcha roja (no es globo) hasta el remate: dos cuartetos R-12 negros (a 113 y 129 cm) con
 * gasa blanca de telaraña, y la araña encima: cabeza con ojos verdes a ~180 cm y patas de T-260 negro de ~55 cm.
 */
const escena339 = (): Escena => {
  const NEGRO = "080";
  const m = montaje(
    { id: "base", nombre: "Columna araña: cuarteto negro de la base", pieza: cuarteto(R("R-12", 28, NEGRO), [NEGRO]), origen: v(0, 15, 0) },
    { nombre: "Varilla con escarcha roja", base: v(0, 0, 0), altoCm: 112, radioCm: 1.6, hex: "#c8361c", acabado: "metal" },
  );
  const calabaza: Decoracion = { tipo: "calabaza", propiedades: { globo: R("R-12", 24, "061"), cara: null, tallo: { formatoId: "T-260", grosorCm: 3.5, codigo: "032", lazos: 3, largoLazoCm: 9, zarcillos: true } } };
  m.deco("calabaza-1", "Calabaza naranja (izquierda)", calabaza, v(-16.6, 40, 4), AL_FRENTE);
  m.deco("calabaza-2", "Calabaza naranja (derecha)", calabaza, v(16.6, 40, 4), AL_FRENTE);
  m.nivel("remate-1", "Remate: cuarteto R-12 negro de abajo", R("R-12", 24, NEGRO), [NEGRO], v(0, 113, 0), 45);
  m.nivel("remate-2", "Remate: cuarteto R-12 negro de arriba", R("R-12", 24, NEGRO), [NEGRO], v(0, 129, 0), 0);
  m.deco("gasa", "Gasa blanca de telaraña (no es globo)", { tipo: "telarana", propiedades: { radioCm: 24, radios: 9, anillos: 4, hex: "#f1f1ee", grosorCm: 1.2 } }, v(4, 122, 22), AL_FRENTE);
  m.deco("arana", "Araña negra de ojos verdes", {
    tipo: "arana",
    propiedades: { cuerpo: R("R-12", 26, NEGRO), cabeza: R("R-12", 26, NEGRO), ojos: { hexIris: "#2fae6a" }, patas: { formatoId: "T-260", grosorCm: 3.5, codigo: NEGRO, largoCm: 55, estilo: "articuladas" }, giroGrados: 0 },
  }, v(5, 156, -2), AL_FRENTE);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 346 · Columna bosque silvestre
// ----------------------------------------------------------------------------------------------------------

/**
 * Una decoración pegada a la cara de una columna: a `x` de su eje (lo que se ve en la foto) y a la altura `y`, sobre
 * un cilindro de radio `radio` (por delante, o por detrás con `atras`), mirando hacia fuera.
 */
function enColumna(x: number, y: number, radio: number, atras = false): { punto: Vec3; normal: Vec3 } {
  const s = Math.max(-1, Math.min(1, x / radio));
  const a = (Math.asin(s) * 180) / Math.PI;
  const grados = atras ? 180 - a : a;
  const r = Math.max(radio, Math.abs(x));
  return { punto: enAnillo(grados, r, y), normal: fuera(grados) };
}

/**
 * Foto de 740×570; los R-12 de la columna miden ~62 px (25 cm, el inflado de columna): 2,48 px/cm, con el piso en
 * y = 560 px y el eje en x = 355 px. Columna de 10 cuartetos R-12 verde a ~50 px por nivel (0,8 diámetros: el paso del
 * taller): 2,06 m. Nueve flores de 5 R-5 (~10 cm) trepando: lilas con botón verde amarillento y verde amarillentas
 * con botón lila.
 */
const escena346 = (): Escena => {
  const VERDE = "030", LILA = "050", PALIDO = "027";
  const columna: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 200, patron: "un_color", colores: [VERDE] };
  const m = montaje(
    { id: "columna", nombre: "Columna verde bosque silvestre", pieza: columna, origen: v(0, 13.5, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 200, radioCm: 0.8, hex: "#e8e8e8" },
  );
  const lila = florGlobos(R("R-5", 10, LILA), 5, 15, R("R-5", 6, PALIDO));
  const palida = florGlobos(R("R-5", 10, PALIDO), 5, 15, R("R-5", 6, LILA));
  // [x, y, lila?, detrás?] medidos en la foto.
  const flores: ReadonlyArray<[number, number, boolean, boolean]> = [
    [26, 206, true, false], [34, 175, false, false], [-26, 117, true, true], [-30, 100, false, false], [-22, 83, true, false],
    [8, 52, false, false], [34, 40, true, false], [44, 20, false, false], [-30, 150, true, true],
  ];
  flores.forEach(([x, y, esLila, atras], k) => {
    const { punto, normal } = enColumna(x, y, 30, atras);
    m.deco(`flor-${k + 1}`, `Flor ${esLila ? "lila" : "verde pálida"} ${k + 1}`, esLila ? lila : palida, punto, normal, 18 * k);
  });
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 352 · Columna cebra fashion girl
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 fucsia de cebra miden ~65 px (25 cm): 2,6 px/cm, con el piso en y = 555 px y el eje en
 * x = 368 px. Base de dos cuartetos R-12 fucsia (impresos de cebra) a 15 y 33 cm; columna de 13 cuartetos R-5 rosado de
 * ~29 px (11,5 cm) a ~24 px por nivel (0,8 diámetros: el paso del taller), de 44 a 165 cm; un cuarteto R-12 fucsia de
 * cebra arriba (177 cm) y el corazón metalizado de cebra rosado (~80 px: 31 cm).
 */
const escena352 = (): Escena => {
  const FUCSIA = "011", ROSADO = "009";
  const columna: Pieza = { tipo: "columna", formatoId: "R-5", infladoCm: 11.5, alturaCm: r2(13 * 0.8 * 11.5), patron: "un_color", colores: [ROSADO] };
  const m = montaje(
    { id: "columna", nombre: "Columna rosada de R-5", pieza: columna, origen: v(0, 44, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 185, radioCm: 0.5, hex: "#e8e8e8" },
  );
  const cebra = R("R-12", 25, FUCSIA);
  m.nivel("base-1", "Base: cuarteto R-12 fucsia (impreso de cebra) de abajo", cebra, [FUCSIA], v(0, 15, 0), 45);
  m.nivel("base-2", "Base: cuarteto R-12 fucsia (impreso de cebra) de arriba", cebra, [FUCSIA], v(0, 33, 0), 0);
  m.nivel("remate", "Remate: cuarteto R-12 fucsia (impreso de cebra)", cebra, [FUCSIA], v(0, 177, 0), 0);
  m.pieza("corazon", "Corazón metalizado rosado (de cebra en la foto)", { tipo: "metalizado", metalizado: { ...metalizadoDeTienda("corazon-lavanda"), pulgadas: 13 } }, v(0, 186, 2), ARRIBA, giroAlFrente(ARRIBA));
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 355 · Columna chevrón
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-5 verdes miden ~40 px (12,5 cm): 3,15 px/cm, con el piso en y = 555 px y el eje en x = 368 px.
 * Base: un cuarteto R-9 naranja de chevrón (~50 px, 16 cm) con un hueco al frente y encima uno amarillo con un globo al
 * frente. Columna de 7 cuartetos R-5 verde trébol a ~31,5 px por nivel (0,79 diámetros: el paso del taller), de 38 a 98
 * cm; un cuarteto R-9 azul de chevrón y el remate: un R-24 blanco (~160 px: 51 cm) con cinco rayas de colores de
 * T-260 que le dan la vuelta (amarillo, verde, naranja, azul y morado).
 */
const escena355 = (): Escena => {
  const VERDE = "029";
  const columna: Pieza = { tipo: "columna", formatoId: "R-5", infladoCm: 12.5, alturaCm: 70, patron: "un_color", colores: [VERDE] };
  const m = montaje(
    { id: "columna", nombre: "Columna verde chevrón", pieza: columna, origen: v(0, 38, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 125, radioCm: 0.5, hex: "#e8e8e8" },
  );
  m.nivel("base-naranja", "Base: cuarteto R-9 naranja (impreso de chevrón)", R("R-9", 16, "061"), ["061"], v(0, 9.5, 0), 0);
  m.nivel("base-amarillo", "Base: cuarteto R-9 amarillo miel (impreso de chevrón)", R("R-9", 16, "021"), ["021"], v(0, 27, 0), 45);
  m.nivel("azul", "Cuarteto R-9 azul (impreso de chevrón)", R("R-9", 17, "040"), ["040"], v(0, 111, 0), 45);
  m.globo("remate", "R-24 blanco del remate", R("R-24", 51, "005"), v(0, 149, 0));
  m.deco("rayas", "Rayas de T-260 de colores alrededor del remate", {
    tipo: "flor_tubito",
    propiedades: { petalos: { formatoId: "T-260", grosorCm: 2.5, codigos: ["020", "029", "061", "040", "051"], cantidad: 5, estilo: "lazo", largoCm: 64, anchoCm: 66, aperturaGrados: 90, giroGrados: 18 }, interior: null, corona: null, centro: null },
  }, v(0, 116, 0), ARRIBA);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 361 · Columna corazones
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-5 de la columnita miden ~48 px (12 cm): 4 px/cm, con el piso en y = 560 px y el eje en x =
 * 375 px. Base: cuarteto R-9 (verde trébol y amarillo miel al frente) de ~90 px (22 cm); tres cuartetos R-5 en espiral
 * (amarillo, azul, naranja, verde) a ~9 cm por nivel (0,75 diámetros); un R-18 azul de ~140 × 130 px (33 cm) a 66 cm
 * y la flor de cuatro corazones de ~165 px (41 cm: Corazón 17") naranja, amarillo, verde y rojo (detrás), con un R-5
 * naranja al centro a 90 cm.
 */
const escena361 = (): Escena => {
  const VERDE = "029", AMARILLO = "021", NARANJA = "061", AZUL = "040", ROJO = "015";
  const ESPIRAL = [AMARILLO, AZUL, NARANJA, VERDE];
  const m = montaje(
    { id: "base", nombre: "Columna de colores de la flor de corazones", pieza: cuarteto(R("R-9", 22, AMARILLO), [AMARILLO, VERDE, AZUL, NARANJA], "espiral"), origen: v(0, 12, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 85, radioCm: 0.5, hex: "#e8e8e8" },
  );
  const r5 = R("R-5", 12, AMARILLO);
  [29, 38.5, 47.5].forEach((y, k) => m.nivel(`nivel-${k + 1}`, `Cuarteto R-5 de colores ${k + 1}`, r5, ESPIRAL, v(0, y, 0), giroEspiral(k + 1), "espiral"));
  m.globo("azul", "R-18 azul", R("R-18", 33, AZUL), v(0, 66, 0));
  const C = v(0, 92, 0);
  const petalo = (id: string, nombre: string, codigo: string, centro: Vec3) => m.globo(id, nombre, R("R-18", 40, codigo), centro, unitario(mas(menos(centro, C), v(0, 0, 6))));
  petalo("petalo-naranja", "Pétalo naranja (corazón en la foto)", NARANJA, v(-27, 94, 0));
  petalo("petalo-amarillo", "Pétalo amarillo (corazón impreso en la foto)", AMARILLO, v(2.5, 121, -2));
  petalo("petalo-verde", "Pétalo verde trébol (corazón en la foto)", VERDE, v(24, 91, 0));
  petalo("petalo-rojo", "Pétalo rojo (corazón en la foto, detrás)", ROJO, v(0, 70, -16));
  m.globo("centro", "R-5 naranja del centro de la flor", R("R-5", 12, NARANJA), v(0, 90, 12), AL_FRENTE);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 366 · Columna de flores
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 perlados miden ~60 px (25 cm): 2,4 px/cm, con el piso en y = 560 px y el eje en x = 355 px.
 * Columna de 6 cuartetos R-12 Silk blanco nácar a ~55 px por nivel (0,9 diámetros: más sueltos que el paso del taller),
 * de 17 a 127 cm; el R-24 rosado impreso (~160 px: 66 cm; el R-24 llega a 61) con un moño de 4 R-5 satín rosado
 * encima, y seis flores de 4 R-5 satinados (~10 cm) con su centro: cuatro lilas (una violeta) y dos fucsia.
 */
const escena366 = (): Escena => {
  const PERLA = "806";
  const g = R("R-12", 25, PERLA);
  const alturas = [16.7, 37.5, 58, 81, 104, 127];
  const m = montaje(
    { id: "columna", nombre: "Columna perlada de flores", pieza: cuarteto(g, [PERLA]), origen: v(0, alturas[0]!, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 160, radioCm: 0.8, hex: "#e8e8e8" },
  );
  alturas.slice(1).forEach((y, k) => m.nivel(`nivel-${k + 2}`, `Cuarteto perlado ${k + 2}`, g, [PERLA], v(0, y, 0), (k + 1) % 2 ? 45 : 0));
  m.globo("remate", "R-24 rosado (impreso en la foto)", R("R-24", 60, "009"), v(0, 175, 0));
  m.deco("mono", "Moño de 4 R-5 satín rosado", florGlobos(R("R-5", 9, "409"), 4, 25), v(0, 209, 0), unitario(v(0, 1, 0.4)), 45);
  const flor = (c: string) => florGlobos(R("R-5", 10, c), 4, 15, R("R-5", 9, c), 45);
  const flores: ReadonlyArray<[number, number, string, string]> = [
    [-46, 131, "450", "lila"], [44, 133, "450", "lila"], [-37, 106, "412", "fucsia"], [-6, 79, "450", "lila"], [31, 48, "412", "fucsia"], [-4, 19, "951", "violeta"],
  ];
  flores.forEach(([x, y, c, nombre], k) => {
    const { punto, normal } = enColumna(x, y, 30);
    m.deco(`flor-${k + 1}`, `Flor ${nombre} ${k + 1}`, flor(c), punto, normal);
  });
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 368 · Columna emoji amor
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 emoji miden ~75 px (28 cm): 2,7 px/cm, con el piso en y = 560 px y el eje en x = 368 px.
 * Base: dos cuartetos R-12 negros (~70 px, 26 cm) y un anillo de 4 R-5 amarillos donde nace el tallo; tallo rojo de
 * ~40 px (15 cm: un Link-O-Loon 660) de 33 a 133 cm con dos aros de T-260 negro (a 76 y 100 cm) y un corazoncito
 * amarillo entre ellos; la flor (85 cm de ancho, centro a 165 cm): 6 R-12 amarillos con cara de beso al frente, 6
 * detrás y un R-12 rojo al centro.
 */
const escena368 = (): Escena => {
  const NEGRO = "080", AMARILLO = "021", ROJO = "015";
  const m = montaje(
    { id: "base", nombre: "Columna emoji amor", pieza: cuarteto(R("R-12", 26, NEGRO), [NEGRO]), origen: v(0, 14.5, 0) },
    { nombre: "Varilla del tallo", base: v(0, 0, 0), altoCm: 160, radioCm: 0.6, hex: "#e8e8e8" },
  );
  m.nivel("base-arriba", "Cuarteto R-12 negro de arriba", R("R-12", 26, NEGRO), [NEGRO], v(0, 32, 0), 45);
  m.anillo("amarillo", "R-5 amarillo del pie del tallo", R("R-5", 12, AMARILLO), 4, 38, 9, 25, 0);
  m.palito("tallo", "Tallo de T-360 rojo", { formatoId: "T-360", grosorCm: 7.6, codigo: ROJO }, v(0, 36, 0), v(0, 150, 0));
  m.deco("aro-bajo", "Aro de T-260 negro de abajo", aro({ formatoId: "T-260", grosorCm: 3, codigo: NEGRO }, 8, "horizontal"), v(0, 75, 0), AL_FRENTE);
  m.deco("aro-alto", "Aro de T-260 negro de arriba", aro({ formatoId: "T-260", grosorCm: 3, codigo: NEGRO }, 8, "horizontal"), v(0, 99, 0), AL_FRENTE);
  m.globo("corazoncito", "R-5 amarillo (corazoncito en la foto)", R("R-5", 11, AMARILLO), v(0, 87, 6), AL_FRENTE);
  const C = v(0, 165, 0);
  const cara = emoji(R("R-12", 26, AMARILLO), { ojos: "puntos", boca: "beso", mejillas: "#e8473a" }, "a yellow kissing-face emoji balloon");
  for (let k = 0; k < 6; k++) {
    const a = rad(90 + 60 * k);
    m.deco(`emoji-${k + 1}`, `R-12 amarillo con cara de beso ${k + 1}`, cara, mas(C, v(r2(26 * Math.cos(a)), r2(26 * Math.sin(a) - 13), 4)), AL_FRENTE);
    const b = rad(120 + 60 * k);
    m.globo(`atras-${k + 1}`, `R-12 amarillo de atrás ${k + 1}`, R("R-12", 26, AMARILLO), mas(C, v(r2(24 * Math.cos(b)), r2(24 * Math.sin(b)), -12)), unitario(v(Math.cos(b), Math.sin(b), -0.4)));
  }
  m.globo("centro", "R-12 rojo del centro de la flor", R("R-12", 27, ROJO), mas(C, v(0, 0, 14)), AL_FRENTE);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 369 · Columna espiral fútbol
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 de la columna miden ~70 px (28 cm): 2,5 px/cm, con el piso en y = 555 px y el eje en
 * x = 368 px. Columna de 6 cuartetos R-12 a ~57 px por nivel (0,81 diámetros: el paso del taller): abajo y arriba,
 * cuartetos de balones de colores (surtido); en medio, un nivel rojo, uno azul rey, uno naranja y uno amarillo, cada
 * uno con un balón blanco que sube en espiral (de la derecha a la izquierda). Remate: el balón blanco grande (~200 px:
 * 80 cm, un R-36).
 */
const escena369 = (): Escena => {
  const ROJO = "015", AZUL_REY = "041", NARANJA = "061", AMARILLO = "020", BLANCO = "005";
  const g = R("R-12", 28, ROJO);
  const surtido = (c: string[]): ImpresoEnPieza[] => [{ impresoId: BALON_SURTIDO, globos: c.map((_, k) => k) }];
  const abajo = [ROJO, "031", "040", AMARILLO];
  const m = montaje(
    { id: "columna", nombre: "Columna espiral fútbol", pieza: cuarteto(g, abajo, "espiral", 1, surtido(abajo)), origen: v(0, 15.5, 0) },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 150, radioCm: 0.8, hex: "#e8e8e8" },
  );
  // El balón blanco va primero en cada nivel; con el giro `−45 − A` queda en el ángulo A (0° = al frente).
  const medio: ReadonlyArray<[number, string, string, number]> = [[39.5, ROJO, "rojo", 45], [63.5, AZUL_REY, "azul rey", 0], [87.5, NARANJA, "naranja", -45], [109.5, AMARILLO, "amarillo", -90]];
  medio.forEach(([y, c, nombre, a], k) => m.nivel(`nivel-${k + 2}`, `Cuarteto ${nombre} con un balón blanco`, g, [BLANCO, c, c, c], v(0, y, 0), -45 - a, "espiral", [{ impresoId: BALON_BLANCO, globos: [0] }]));
  const arriba = [NARANJA, ROJO, AMARILLO, "040"];
  m.nivel("nivel-6", "Cuarteto de balones de colores de arriba", g, arriba, v(0, 131.5, 0), 0, "espiral", surtido(arriba));
  m.globo("remate", "Balón R-36 blanco", R("R-36", 80, BLANCO), v(0, 181.5, 0), ARRIBA, BALON_BLANCO);
  return m.escena();
};


// ----------------------------------------------------------------------------------------------------------
// 373 · Columna Feliz Cumpleaños R-40
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el globo de arriba mide ~165 px: con el R-36 a su máximo (90 cm, lo más cerca del «R-40» del título
 * que hace el taller) son 1,83 px/cm, con el piso en y = 565 px y el eje en x = 372 px. De abajo arriba: cuarteto R-12
 * naranja impreso (~55 px, 30 cm), cuarteto R-12 amarillo cristal impreso, cuarteto R-9 verde trébol (~30 px, 16 cm);
 * 6 cuartetos R-5 azul (~22 px, 12 cm) a ~34 px por nivel (1,5 diámetros: van separados por 3 aros de T-260
 * amarillo, y dos niveles llevan un moño amarillo en cruz); arriba otro verde, otro amarillo y el R-36 naranja impreso
 * «Feliz cumpleaños» (centro a 257 cm).
 */
const escena373 = (): Escena => {
  const NARANJA = "061", AMARILLO = "021", VERDE = "029", AZUL = "040", T_AMARILLO = { formatoId: "T-260", grosorCm: 3, codigo: "020" };
  const m = montaje(
    { id: "base", nombre: "Columna Feliz Cumpleaños", pieza: cuarteto(R("R-12", 30, NARANJA), [NARANJA]), origen: v(0, 19, 0), giroGrados: 45 },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 215, radioCm: 0.8, hex: "#e8e8e8" },
  );
  m.nivel("amarillo-abajo", "Cuarteto R-12 amarillo cristal (impreso en la foto) de abajo", R("R-12", 30, AMARILLO), [AMARILLO], v(0, 44, 0), 0);
  m.nivel("verde-abajo", "Cuarteto R-9 verde trébol de abajo", R("R-9", 16, VERDE), [VERDE], v(0, 64, 0), 45);
  [76, 94.6, 113.2, 131.8, 150.4, 169].forEach((y, k) => m.nivel(`azul-${k + 1}`, `Cuarteto R-5 azul ${k + 1}`, R("R-5", 12, AZUL), [AZUL], v(0, y, 0), 0));
  [85, 122, 159].forEach((y, k) => m.deco(`aro-${k + 1}`, `Aro de T-260 amarillo ${k + 1}`, aro(T_AMARILLO, 9.5, "horizontal"), v(0, y, 0), AL_FRENTE));
  const mono: Decoracion = { tipo: "mono", propiedades: { ...T_AMARILLO, lazosPorLado: 1, largoLazoCm: 7, anchoLazoCm: 5, aberturaGrados: 40, colas: true, largoColaCm: 8, centro: null } };
  m.deco("mono-1", "Moño amarillo en cruz de abajo", mono, v(0, 104, 12), AL_FRENTE);
  m.deco("mono-2", "Moño amarillo en cruz de arriba", mono, v(0, 141, 12), AL_FRENTE);
  m.nivel("verde-arriba", "Cuarteto R-9 verde trébol de arriba", R("R-9", 16, VERDE), [VERDE], v(0, 179, 0), 45);
  m.nivel("amarillo-arriba", "Cuarteto R-12 amarillo cristal (impreso en la foto) de arriba", R("R-12", 30, AMARILLO), [AMARILLO], v(0, 197, 0), 0);
  m.globo("remate", "R-36 naranja (impreso «Feliz cumpleaños» en la foto)", R("R-36", 90, NARANJA), v(0, 257, 0));
  return m.escena(sala(380, 340, 340));
};


// ----------------------------------------------------------------------------------------------------------
// 378 · Columna foil luna
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el R-24 de arriba mide ~140 px (55 cm): 2,55 px/cm, con el piso en y = 560 px y el eje en x =
 * 372 px. De abajo arriba: cuarteto R-9 blanco (~50 px, 20 cm) con un disco de 24 R-5 azul caribe (~22 px, 8,5 cm)
 * de 68 cm; 5 cuartetos R-9 rojos (~45 px, 18 cm) con un globo azul de lunares que sube en espiral, muy apretados (~24
 * px por nivel: 0,52 diámetros); otro cuarteto blanco con su disco azul, tres R-5 rojos y un R-12 azul de lunares
 * (~70 px) con una banda verde; arriba otro cuarteto blanco con disco, tres R-5 rojos y el R-24 azul caribe de lunares.
 */
const escena378 = (): Escena => {
  const BLANCO = "005", CARIBE = "038", ROJO = "015";
  const blanco = R("R-9", 20, BLANCO);
  const m = montaje(
    { id: "base", nombre: "Columna azul caribe, blanca y roja", pieza: cuarteto(blanco, [BLANCO]), origen: v(0, 23.5, 0), giroGrados: 45 },
    { nombre: "Varilla de la columna", base: v(0, 0, 0), altoCm: 170, radioCm: 0.6, hex: "#e8e8e8" },
  );
  m.anillo("disco-bajo", "R-5 azul caribe del disco de abajo", R("R-5", 8.5, CARIBE), 24, 15.7, 30, 0);
  // El globo de lunares primero en cada nivel, subiendo en espiral (giro −45 − A deja el primero en el ángulo A).
  [35, 44.5, 54, 63.5, 73].forEach((y, k) => m.nivel(`rojo-${k + 1}`, `Cuarteto R-9 rojo con uno azul de lunares ${k + 1}`, R("R-9", 18, ROJO), [CARIBE, ROJO, ROJO, ROJO], v(0, y, 0), -45 - (60 - 40 * k), "espiral"));
  m.nivel("blanco-medio", "Cuarteto R-9 blanco del medio", blanco, [BLANCO], v(0, 86, 0), 45);
  m.anillo("disco-medio", "R-5 azul caribe del disco del medio", R("R-5", 8.5, CARIBE), 24, 97, 30, 10);
  m.deco("trio-medio", "Tres R-5 rojos del medio", trio(R("R-5", 7, ROJO)), v(0, 101, 0), ARRIBA);
  m.globo("lunares", "R-12 azul caribe de lunares (con banda verde en la foto)", R("R-12", 27, CARIBE), v(0, 121.6, 0));
  m.nivel("blanco-arriba", "Cuarteto R-9 blanco de arriba", blanco, [BLANCO], v(0, 143, 0), 45);
  m.anillo("disco-alto", "R-5 azul caribe del disco de arriba", R("R-5", 8.5, CARIBE), 24, 135, 30, 0);
  m.deco("trio-alto", "Tres R-5 rojos de arriba", trio(R("R-5", 7, ROJO)), v(0, 154, 0), ARRIBA);
  m.globo("remate", "R-24 azul caribe de lunares", R("R-24", 55, CARIBE), v(0, 188, 0));
  return m.escena();
};


/** Ideas de fiesta de sempertex.com digitalizadas: lote 05. */
export const LOTE_05: readonly IdeaDigitalizada[] = [
  idea({
    numero: 270, slug: "centro-de-mesa-copa-despedida-de-soltera", nombre: "Centro de mesa copa despedida de soltera", ocasiones: ["general"],
    fotoUrl: `${CDN}b1a43713d9fdaed99622818c9688a4ca_3e564405-470a-4539-8d72-cf66f42fbdd6.jpg`,
    escena: escena270,
    nota: "Igual: base de un cuarteto R-12 con un globo al frente, dos cuartetos R-9 sin girar entre sí (como en la foto) con R-5 en los huecos, la copa de 4 R-12 abiertos alrededor del cuello del R-24 negro, un collar de 26 perlas R-5 Satín Perla (medido #dae7e0) y 4 moños de T-260 Fashion Rosado (medido #ffc5db) con centro R-5 en la base (se ven 2; los de atrás, por simetría). El fucsia (medido #fe4d9d) queda más cerca del Neón Fucsia 212; va el Fashion más cercano, Rosa 011. Distinto: el globo de la copa mide ~65 cm (el R-24 llega a 61) y la copa impresa no está en el catálogo: va un R-24 Fashion Negro liso; las perlas de la foto cuelgan algo más hacia el frente; los R-5 de relleno de atrás son supuestos.",
  }),
  idea({
    numero: 271, slug: "centro-de-mesa-corazon-1", nombre: "Centro de mesa corazón", ocasiones: ["amor", "día de la madre"],
    fotoUrl: `${CDN}HEARTH_CENTER_PIECE_-_CENTRO_DE_MESA_CORAZON.jpg`,
    escena: escena271,
    publicados: [
      pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
      pub("GLOBO REDONDO FASHION ROJO IMPERIAL", "/products/globo-latex-redondo-fashion-rojo-imperial", "R-12", "016"),
      pub("GLOBO TUBITO FASHION ROJO IMPERIAL", "/products/globo-latex-tubito-fashion-rojo-imperial", "T-260", "016"),
      pub("GLOBO CORAZON 2 CARAS LOVE FASHION ROJO", "/products/globo-para-fiesta-latex-corazon-2-caras-love-fashion-rojo", "C-12", "015"),
    ],
    nota: "Igual: base de racimo de R-5 Rojo Imperial (publicado) con plata y blanco, vara roja forrada con un T-260 Rojo Imperial sin inflar (publicado), racimo de arriba de 12 Reflex Plata (publicado) con un trío de R-5 rojo imperial en cada hueco (60), el R-12 rojo impreso «Feliz Día Mami» del catálogo arriba a la derecha y el Corazón 12 «LOVE» publicado abajo a la izquierda. Distinto: la ficha da R-12 para el plata y el rojo; por tamaño, los plata del racimo son de ~17 cm (R-9) y los rojos R-5; el impreso de la foto dice «Feliz día Mamá» con flores y corazones y el del catálogo con flores es «Feliz Día Mami»; la base de la foto es más irregular (aquí va por anillos) y el corazón y el impreso se ven más grandes porque van delante.",
  }),
  idea({
    numero: 273, slug: "centro-de-mesa-corazon-reflex", nombre: "Centro de mesa corazón reflex", ocasiones: ["amor", "día de la madre"],
    fotoUrl: `${CDN}Centro-de-Mesa-Corazon-Reflex_6a6411e0-59c1-4fc5-8e24-7dc9c1ec1196.jpg`,
    escena: escena273,
    publicados: [
      pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
      pub("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010"),
      pub("GLOBO REDONDO REFLEX ROSADO", "/products/globo-para-fiesta-latex-redondo-reflex-rosado", "R-12", "909"),
    ],
    nota: "Igual: los tres colores publicados (Arena 071, Palo de Rosa 010 y Reflex Rosado 909) en la base y el racimo, vara dorada, R-5 Reflex Dorado con estrellas blancas (el «Infinity® Estrellas» del catálogo), el dorado grande arriba a la izquierda y el corazón cromado a la derecha (metalizado «Corazón rosado» de 18\", ~47 cm como en la foto). Distinto: los cromados magenta miden más cerca de Reflex Fucsia 912 que del 909 publicado (se deja el publicado); el dorado «Feliz día mamá» mide ~45 cm y ese impreso no está en el catálogo: va un R-18 Reflex Dorado liso; los globitos de estrellas miden ~14 cm y el impreso se vende en R-5 (va a 12,5 cm); la base de la foto es más ancha (80 cm) que el cuarteto que la arma y los globos de atrás son supuestos.",
  }),
  idea({
    numero: 279, slug: "centro-de-mesa-de-amor-en-fucsia-y-lila", nombre: "Centro de mesa de amor en fucsia y lila", ocasiones: ["amor"],
    fotoUrl: `${CDN}IMG_20200814_175418.jpg`,
    escena: escena279,
    publicados: [
      pub("GLOBO REDONDO FASHION LILA", "/products/globo-para-fiesta-latex-redondo-fashion-lila", "R-12", "050"),
      pub("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609"),
      pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
      pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
    ],
    nota: "Igual: base orgánica baja de ~106 cm con 41 R-5 y R-9 en los cuatro colores publicados (Fucsia 012, Lila 050, Pastel Mate Rosado 609 y Reflex Plata 981), tres flores de 5 burbujas de T-260 blanco con centro R-5 plata donde las pone la foto, y el corazón fucsia «Te amo» de pie encima. Distinto: el corazón de la foto es de látex (~67 cm de ancho) y el Corazón 12 solo se fabrica en blanco, rosado, rojo y transparente: va el metalizado «Corazón rosado» de 18\" (45 cm) con «TE ♥ AMO» en blanco; la ficha da R-12 y por tamaño son R-5 y R-9; los globos de atrás son supuestos; la clasificación decía 4 flores y la foto muestra 3.",
  }),
  idea({
    numero: 280, slug: "centro-de-mesa-del-oeste", nombre: "Centro de mesa del oeste", ocasiones: ["general"],
    fotoUrl: `${CDN}CENTRO_DE_MESA_DEL_OESTE.jpg`,
    escena: escena280,
    publicados: [
      pub("GLOBO REDONDO INFINITY® FELIZ DIA PAPA OESTE FASHION SURTIDO", "/products/globo-latex-redondo-infinity-r-feliz-dia-papa-oeste-fashion-surtido", "R-12", null),
      pub("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041"),
      pub("GLOBO REDONDO FASHION LATTE", "/products/globo-para-fiesta-latex-redondo-fashion-latte", "R-12", "073"),
      pub("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074"),
      pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
      pub("GLOBO LINK-O-LOON® FASHION AZUL REY", "/products/globo-para-fiesta-latex-link-o-loon-fashion-azul-rey", "LOL-12", "041"),
    ],
    nota: "Igual: base de dos cuartetos R-9 Azul Rey con 8 R-5 en los huecos, columna de 6 niveles de cuartetos R-5 en espiral arena, latte, azul rey y café (los publicados) con la altura real de la foto (6,2 cm por nivel: más juntos que el paso del taller, 8), el R-12 azul «Feliz día papá» del oeste encima y dos con helio (café y mostaza) con cintas doradas. Distinto: el impreso es un surtido (azul rey, café y mostaza): el claro de la foto parece latte y va en Mostaza 023, el color del surtido; los cactus y herraduras del impreso no se dibujan; el Link-O-Loon azul rey que publica la ficha no sale en la foto (sin cantidad); la ficha da R-12 y la columna es de R-5.",
  }),
  idea({
    numero: 282, slug: "centro-de-mesa-emoji", nombre: "Centro de mesa emoji", ocasiones: ["cumpleaños"],
    fotoUrl: `${CDN}91e43d760dc32993e23b24603113bc4b.jpg`,
    escena: escena282,
    nota: "Igual: base de tres cuartetos R-9 Amarillo Miel (medido #fdcd00) con 12 R-5 clavados de colores medidos (naranja, azul, verde trébol, frambuesa, azul caribe y rojo; se ven 10), tallo de T-260 negro inflado, corbatín de dos R-5 negros, cintas rizadas de colores y el R-12 Amarillo Miel con cara de emoji arriba. Distinto: el emoji impreso no está en el catálogo: la cara se dibuja (ojos, sonrisa y mejillas, no cotiza) sobre el R-12 liso, y en la foto tiene los ojos cerrados de risa; los dos R-5 de atrás son supuestos.",
  }),
  idea({
    numero: 284, slug: "centro-de-mesa-feliz-cumpleanos-flor", nombre: "Centro de mesa feliz cumpleaños flor", ocasiones: ["cumpleaños"],
    fotoUrl: `${CDN}35d0f6131e90edb4a6382ec38fb6bf23_7da3003e-be66-4c8a-ad02-850acc4e1f69.jpg`,
    escena: escena284,
    nota: "Igual: base de un cuarteto R-5 Verde y otro Verde Trébol, dos hojas en lazo y tallo de dos T-260 (Verde y Verde Selva), dos R-5 en el cuello, la flor de 8 lazos de T-260 Amarillo de 36 cm en estrella y el aro amarillo alrededor del metalizado «Feliz cumpleaños» de rayas de colores (el «Festivo» del catálogo). Distinto: el metalizado de la foto es de ~10\" y la tienda lo vende de 18\": se dibuja a 10\"; el aro de la foto son 12 burbujas y aquí es un aro liso de T-260; el tallo de la foto va trenzado y aquí son dos tubitos cruzados; los R-5 del cuello miden entre Neón Fucsia y Fashion Rosa (va Fashion Rosa 011).",
  }),
  idea({
    numero: 290, slug: "centro-de-mesa-futbol", nombre: "Centro de mesa fútbol", ocasiones: ["general"],
    fotoUrl: `${CDN}1efadd50775edc1ba14e949b9ea2348f_ce810a39-dfdb-49c6-b9cd-8677097fc9fe.jpg`,
    escena: escena290,
    publicados: [
      pub("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-surtido", "R-12", null),
      pub("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", "R-12", "005"),
      pub("GLOBO REDONDO FASHION SURTIDO", "/products/globo-para-fiesta-latex-redondo-fashion-surtido", "R-12", null),
    ],
    nota: "Igual: base de dos cuartetos R-9 blancos con R-5 negros en los huecos (un balón), columna de 5 cuartetos R-5 de colores en espiral con la altura medida (~7 cm por nivel), el balón R-12 blanco impreso encima y tres balones de colores con helio (amarillo, verde lima y naranja, del surtido «Balón de fútbol» publicado) con cintas rosadas. Distinto: en la foto el verde es Verde Trébol y el amarillo Amarillo Miel: van en los colores del surtido (031 y 020); la ficha publica el «Fashion Surtido» en R-12 sin color y la columna es de R-5 (queda listado sin cantidad; los R-5 van por color); el orden de colores de la espiral es aproximado.",
  }),
  idea({
    numero: 302, slug: "centro-de-mesa-para-mama", nombre: "Centro de mesa para mamá", ocasiones: ["amor", "día de la madre"],
    fotoUrl: `${CDN}Centro-de-mesa-para-mama_f3431fe2-953c-478f-9972-9166f7745ff0.jpg`,
    escena: escena302,
    publicados: [
      pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
      pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
    ],
    nota: "Igual: de abajo arriba dos R-12 Reflex Cristal Rojo con una flor de R-5 Reflex Plata (publicado) al frente, tres R-5 rojos, dos racimos de 7 R-5 plata, los R-12 rojo y dorado impresos «Feliz Día» del catálogo (corazones brillantes, metal), el corazón metalizado plata del centro, un aro de 10 R-5 Reflex Dorado (publicado) con un trío al frente, los dos corazones metalizados rojos «Feliz DÍA», la flor de R-5 dorados y el corazón plata de arriba. Distinto: los corazones de la foto (~40 cm, cromados) van como metalizados de 18\" de la tienda (el rojo con el letrero dibujado); los R-12 impresos de la foto dicen «Feliz Día Mamá» y el del catálogo «Feliz Día»; los racimos plata de la foto son algo más sueltos.",
  }),
  idea({
    numero: 337, slug: "columna-arana-1", nombre: "Columna araña de otoño", ocasiones: ["halloween"],
    fotoUrl: `${CDN}Columna_Arana.png`,
    escena: escena337,
    publicados: [
      pub("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027"),
      pub("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"),
      pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
      pub("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
    ],
    nota: "Igual: columna de 6 cuartetos R-12 al paso del taller (en la foto ~0,79 diámetros por nivel) en espiral de cuatro colores (Eucalipto, Arena y Naranja publicados y el terracota), y la araña trepando por la izquierda: cuerpo R-12 negro con telarañas impresas (la «Araña Metalink» del catálogo), cabeza R-12 negra y patas de T-260 negro (Negro publicado). Distinto: el terracota no está publicado ni en la tabla: medido #c36d55, el más cercano es Reflex Dorado Rosa 968 (cromado) y va el Fashion más cercano, Coral Tropical 059; la cara de calabaza impresa de la cabeza no está en el catálogo (va lisa); las patas del 3D van en tres burbujas y las de la foto son largas y curvas.",
  }),
  idea({
    numero: 339, slug: "columna-arana", nombre: "Columna araña con calabazas", ocasiones: ["halloween"],
    fotoUrl: `${CDN}f04e8309da5d016400658957184b9a29_be87e96c-883a-4314-a5df-cece7c8c3876.jpg`,
    escena: escena339,
    nota: "Igual: base de un cuarteto R-12 negro, dos calabazas R-12 naranja con hojas y zarcillo de T-260 Verde Selva (medido #018057), el tallo de escarcha roja hasta el remate (escenografía), dos cuartetos R-12 negros con gasa blanca de telaraña y la araña negra de ojos verdes con patas de T-260 negro. Colores medidos (no publica productos). Distinto: la boca roja de la araña no se dibuja; la gasa es una telaraña de papel y no tela; la escarcha va como un cilindro (la varilla), sin flecos.",
  }),
  idea({
    numero: 346, slug: "columna-bosque-silvestre", nombre: "Columna bosque silvestre", ocasiones: ["general"],
    fotoUrl: `${CDN}119064bd60adc1e5b7b7e9dc728058d9_c39bb926-15ca-4b41-ae61-5f4f3a3955cf.jpg`,
    escena: escena346,
    nota: "Igual: columna de 10 cuartetos R-12 Fashion Verde (medido #04b096) al paso del taller (en la foto ~0,8 diámetros por nivel: 2,06 m) y 9 flores de 5 R-5 que la trepan donde las pone la foto: lilas (Fashion Lila 050, medido #ba9bc5) con botón verde pálido y verde pálidas con botón lila. Distinto: los pétalos verde pálido parecen Cristal Amarillo sobre el verde (no está en la tabla): medidos, el más cercano es Eucalipto 027; dos de las flores de atrás son supuestas.",
  }),
  idea({
    numero: 352, slug: "columna-cebra-fashion-girl", nombre: "Columna cebra fashion girl", ocasiones: ["general"],
    fotoUrl: `${CDN}2a01ce11c01670069a95b6136e2590fe_c51a500b-368d-42b1-beeb-4acae459fe8f.jpg`,
    escena: escena352,
    nota: "Igual: base de dos cuartetos R-12 fucsia, columna de 13 cuartetos R-5 rosados al paso del taller (en la foto ~24 px por nivel), un cuarteto fucsia arriba y el corazón metalizado de remate. Distinto: los fucsia son impresos de cebra que no están en el catálogo: van lisos en Fashion Rosa 011 (medido entre Neón Fucsia y Fashion Rosa); el corazón de la foto es de cebra: va el «Corazón rosado» del catálogo dibujado a 13\" (~31 cm, el de la foto; la tienda lo vende de 18\"); el rosado mide Fashion Rosado 009 (la clasificación decía pastel).",
  }),
  idea({
    numero: 355, slug: "columna-chevron", nombre: "Columna chevrón", ocasiones: ["cumpleaños"],
    fotoUrl: `${CDN}291166fef881f58c094247820f95c010_3b0cec49-f01c-4f72-9bf9-379746c322ef.jpg`,
    escena: escena355,
    nota: "Igual: base de un cuarteto R-9 naranja y uno amarillo, columna de 7 cuartetos R-5 Verde Trébol (medido #02aa23) al paso del taller, un cuarteto R-9 azul y el R-24 blanco de remate con cinco rayas de T-260 de colores que lo rodean (amarillo, verde, naranja, azul y violeta). Distinto: los chevrones blancos de la base y del cuarteto azul son impresos que no están en el catálogo: van lisos en los colores medidos más cercanos (Naranja 061, Amarillo Miel 021, Azul 040); las rayas de la foto son arcos de tubito pegados al globo y aquí son lazos que lo rodean.",
  }),
  idea({
    numero: 361, slug: "columna-corazones", nombre: "Columna corazones", ocasiones: ["amor", "cumpleaños"],
    fotoUrl: `${CDN}f9bdc13db5b922aca8de6407df613e99.jpg`,
    escena: escena361,
    nota: "Igual: base de un cuarteto R-9 (verde trébol y amarillo miel al frente), tres cuartetos R-5 en espiral (amarillo, azul, naranja y verde) a la altura medida (~0,75 diámetros por nivel), un R-18 Azul (medido #00aeea) y la flor de cuatro pétalos naranja, amarillo, verde y rojo con un R-5 naranja al centro. Distinto: los pétalos de la foto son corazones de ~41 cm (un Corazón 17\" que el taller no tiene) y el Corazón 12 no se fabrica en naranja, amarillo ni verde: van R-18 redondos de esos colores; el «Happy Birthday» impreso del amarillo no se dibuja; el rojo de atrás es supuesto.",
  }),
  idea({
    numero: 366, slug: "columna-de-flores", nombre: "Columna de flores", ocasiones: ["general"],
    fotoUrl: `${CDN}5f7dbe2c5106d2037468eb713173eb11_ff7ad6ee-8ccc-4f30-b0e7-d2371aee217e.jpg`,
    escena: escena366,
    nota: "Igual: columna de 6 cuartetos R-12 Silk Blanco Nácar (medido #d3ced2) con la altura de la foto (~0,9 diámetros por nivel: más sueltos que el paso del taller), el R-24 Fashion Rosado (medido #fcc8df) con un moño de 4 R-5 Satín Rosado encima y las seis flores de 4 R-5 satinados con su centro donde las pone la foto: tres lilas (Satín Lila 450), una violeta (Reflex Violeta 951) y dos fucsia (Satín Fucsia 412). Distinto: el R-24 de la foto mide ~66 cm (el R-24 llega a 61) y lleva un impreso blanco que no está en el catálogo (va liso).",
  }),
  idea({
    numero: 368, slug: "columna-emoji-amor", nombre: "Columna emoji amor", ocasiones: ["amor", "cumpleaños"],
    fotoUrl: `${CDN}14795ab9cf82eaf3ba4732f8f2ee76b0.jpg`,
    escena: escena368,
    nota: "Igual: base de dos cuartetos R-12 negros con un anillo de 4 R-5 amarillos, tallo rojo con dos aros de T-260 negro y un amarillo entre ellos, y la flor de 6 R-12 amarillos con cara de beso al frente, 6 detrás y un R-12 rojo al centro (colores medidos). Distinto: el tallo de la foto es de ~15 cm de grueso (un Link-O-Loon 660) y aquí es un T-360 rojo de 7,6 cm; el corazoncito amarillo va como un R-5 redondo (el Corazón no se fabrica en amarillo); las caras son dibujadas: el impreso de emoji no está en el catálogo.",
  }),
  idea({
    numero: 369, slug: "columna-espiral-futbol", nombre: "Columna espiral fútbol", ocasiones: ["cumpleaños", "infantil"],
    fotoUrl: `${CDN}abceb412194b6ad7a257d3cdac4ee31b_fc58a956-0936-4679-95f5-5c753c109cab.jpg`,
    escena: escena369,
    publicados: [
      pub("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-surtido", "R-12", null),
      pub("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", "R-12", "005"),
      pub("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020"),
      pub("GLOBO REDONDO FASHION AZUL CARIBE", "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", "R-12", "038"),
      pub("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041"),
    ],
    nota: "Igual: columna de 6 cuartetos R-12 al paso del taller (en la foto ~0,81 diámetros por nivel): abajo y arriba balones de colores (el surtido «Balón de fútbol» publicado); en medio un nivel rojo, uno Azul Rey y uno Amarillo (publicados) y uno naranja, cada uno con un balón blanco impreso que sube en espiral de derecha a izquierda; y el balón blanco grande de remate. Distinto: el balón de arriba mide ~80 cm: va en R-36 (la clasificación decía R-24; la tienda lo vende en R-36); el Azul Caribe publicado no se distingue en la foto (sin cantidad); en los niveles de surtido el orden de colores es aproximado.",
  }),
  idea({
    numero: 373, slug: "columna-feliz-cumpleanos-r-40", nombre: "Columna Feliz Cumpleaños R-40", ocasiones: ["cumpleaños"],
    fotoUrl: `${CDN}e87e797b850735f590a65311128e8185_ce634d14-7835-4fa1-89ad-44988ac2330a.jpg`,
    escena: escena373,
    nota: "Igual: de abajo arriba un cuarteto naranja, uno amarillo, uno verde trébol, 6 cuartetos R-5 Azul (medido #08a2de) separados por 3 aros de T-260 amarillo y con dos moños en cruz, otro verde, otro amarillo y el globo naranja gigante (~3 m en total). Distinto: el «R-40» no existe en el taller: va un R-36 a su máximo (90 cm); los impresos «Feliz cumpleaños» del naranja y los garabatos del amarillo cristal no están en el catálogo: van lisos en Fashion Naranja 061 y Amarillo Miel 021 (los más cercanos medidos).",
  }),
  idea({
    numero: 378, slug: "columna-foil-luna", nombre: "Columna foil luna", ocasiones: ["baby shower", "infantil"],
    fotoUrl: `${CDN}4fd8634520f1ed8d36a0539b5cbc5ec1_1932f226-ee8a-4945-9b42-12a8527e4384.jpg`,
    escena: escena378,
    nota: "Igual: tres discos de 24 R-5 Azul Caribe (medido #04c7e7) sobre cuartetos R-9 blancos, la columna de 5 cuartetos R-9 rojos tan apretados como en la foto (~0,52 diámetros por nivel) con un azul que sube en espiral, dos tríos de R-5 rojos, el R-12 azul del medio y el R-24 Azul Caribe de remate. Distinto: los lunares blancos de los azules no están en el catálogo (los polka son verde lima y rojo): van lisos en Azul Caribe 038; la banda verde «Feliz día» del globo del medio no se modela; no hay ningún metalizado pese al título.",
  }),
];
