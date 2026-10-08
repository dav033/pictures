import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { centroCuerpo } from "../geometria";
import { sumarMateriales } from "../mezcla";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import { mesaCilindrica, type ElementoEscenografia } from "../escenografia";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion } from "../figuras";
import type { Vec3 } from "../modulos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 14** (los números de `clasif/lote-14.json`): las que antes
 * quedaban «a medias» porque pedían globos impresos, metalizados o globo dentro de globo. 9 ramos de helio por pisos
 * (#29, #231, #821, #859, #863, #953 y los de base #203, #206, #211), 2 centros de mesa (#307, #884), 2 arcos (#68
 * cadena de eslabones, #131 polka) y 2 figuras (#5 algas, #31 araña de patas en rizo).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) recortada, ampliada y medida:
 * - **Medidas**: la escala sale de un globo de tamaño conocido en la misma foto (R-12 de ramo ≈ 28 cm, R-5 ≈ 12 cm, un
 *   metalizado de 18" ≈ 42 cm) y con ella las alturas de cada piso, los radios, los largos de tubitos y cintas. Cada
 *   idea dice su escala en el comentario.
 * - **Conteo**: los globos que se ven, contando los que asoman por detrás de otro (si un piso muestra dos, van dos).
 *   Ninguna idea del lote publica «Materiales» con cantidades: todo lo contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice).
 *   Si no, se midió en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla
 *   oficial) y se tomó el código más cercano que se fabrica en ese formato (un Fashion si queda a ≤ 6 ΔE del mejor).
 * - **Impresos y metalizados**: el EXACTO de la tienda cuando el catálogo del taller lo trae (`impresos-catalogo.ts`,
 *   `metalizados.ts`), con su producto. Si la idea enlaza un impreso de la tienda que el catálogo no trae («Mi Primera
 *   Comunión», «Te Amo Brillante», «Calabaza»), se lista ESE producto con su cantidad y su látex de fondo, y el globo va
 *   liso en ese fondo (poner otro impreso listaría un producto que no es el de la idea). Si la idea no enlaza nada, se
 *   usa el impreso de la tienda más parecido que se vende en el color de la foto (y la nota lo dice); si ninguno se
 *   vende en ese color, el liso del fondo y la nota nombra el más parecido.
 * - **Globo dentro de globo** (#29): la burbuja de `burbujas.ts` con un solo interior grande; el exterior lleva el
 *   impreso (la araña sobre cristal) y el interior es el cromado que se ve a través.
 * - **Montaje** (para que la biblioteca saque cada conjunto con lo suyo): cada estructura de globos (arco, letras,
 *   metalizado) es un nodo raíz. Un ramo cuelga de su peso (escenografía, raíz: el peso y las cintas a cada nudo), y
 *   cada globo, burbuja o figura del ramo va `sobre` el peso, con su centro donde lo pone la foto (el peso no tiene
 *   globos, así que nada se corre al apoyarse). Los metalizados flotan sueltos a su altura y su cinta sale del peso.
 *   La cadena del arco #68 cuelga de su cordón y la araña #31, de su hilo. Mesas: escenografía suelta.
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
const pto = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const redondo = (p: Vec3): Vec3 => v(r2(p.x), r2(p.y), r2(p.z));
const rad = (g: number) => (g * Math.PI) / 180;
const grados = (r: number) => (r * 180) / Math.PI;
const ARRIBA = v(0, 1, 0);
const AL_FRENTE = v(0, 0, 1);
/** Hacia fuera en el plano del piso: 0° = al frente (+z), 90° = a la derecha de quien mira (+x). */
const fuera = (g: number): Vec3 => v(Math.sin(rad(g)), 0, Math.cos(rad(g)));

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const libre = (p: Vec3, giroGrados = 0): Colocacion => ({ en: "libre", xCm: r2(p.x), yCm: r2(p.y), zCm: r2(p.z), giroGrados });
const sala = (anchoCm = 360, fondoCm = 320, altoCm = 300): Sala => ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm });

/** El marco de una pieza `sobre` con normal `n` y giro (el de `escena.ts`): x local horizontal, y local = n. */
function ejesSobre(n0: Vec3): { xL: Vec3; n: Vec3; zL: Vec3 } {
  const n = unitario(n0);
  const aux = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(aux, n));
  return { xL, n, zL: cruz(n, xL) };
}

/** El giro sobre la normal que deja la cara (+z local) de la pieza lo más hacia quien mira: lo impreso al frente. */
function giroAlFrente(normal: Vec3): number {
  const { xL, zL } = ejesSobre(normal);
  return Math.round(grados(Math.atan2(-xL.z, zL.z)));
}

/**
 * Normal y giro para una decoración «de pie» (su arriba es +z local y su frente +y, como el ramo, la burbuja o la
 * calabaza): su +z local queda hacia `arriba` y su +y local (la cara, lo impreso) lo más hacia quien mira.
 */
function deFrenteHacia(arriba: Vec3): { normal: Vec3; giroGrados: number } {
  const d = unitario(arriba);
  const n = unitario(menos(AL_FRENTE, por(d, pto(AL_FRENTE, d))));
  const { xL, zL } = ejesSobre(n);
  return { normal: n, giroGrados: r2(grados(Math.atan2(-pto(d, xL), pto(d, zL)))) };
}

// ----------------------------------------------------------------------------------------------------------
// Escenografía (en coordenadas del mundo; el montaje las pasa al espacio de su raíz)
// ----------------------------------------------------------------------------------------------------------

/** Un tubo (cinta, cordón, hilo) de `desde` a `hasta`. */
function tubo(desde: Vec3, hasta: Vec3, radioCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "satinado"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "metal", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });
const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: ElementoEscenografia["acabado"] = "mate"): ElementoEscenografia =>
  ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado });
/** Una bola (pompón, papel picado, el nudo de un moño) de cilindros apilados; `achatado` < 1 la aplasta. */
function bola(centro: Vec3, radioCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "papel", tramos = 7, achatado = 1): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  for (let i = 0; i < tramos; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * i) / tramos, a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / tramos;
    salida.push(cilindro(v(centro.x, centro.y + radioCm * achatado * Math.sin(a0), centro.z), Math.max(0.3, radioCm * Math.cos(a0)), radioCm * achatado * (Math.sin(a1) - Math.sin(a0)), hex, acabado, Math.max(0.3, radioCm * Math.cos(a1))));
  }
  return salida;
}

/** Pasa un elemento del mundo al espacio de una raíz puesta en `O` sin giro. */
function aLocal(e: ElementoEscenografia, O: Vec3): ElementoEscenografia {
  if (e.forma === "cilindro" && e.en) return { ...e, en: { ...e.en, origen: redondo(menos(e.en.origen, O)) } };
  if (e.forma === "cilindro") return { ...e, base: redondo(menos(e.base, O)) };
  if (e.forma === "caja") return { ...e, centro: redondo(menos(e.centro, O)) };
  return e;
}

// ----------------------------------------------------------------------------------------------------------
// Montaje: una raíz de escenografía (peso, cordón, hilo, caja de regalo, pompón) y lo que va sobre ella
// ----------------------------------------------------------------------------------------------------------

type Montaje = {
  /** Una pieza con su origen en `origen` (mundo), su +y local hacia `normal` y girada `giroGrados`. */
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro del cuerpo en `centro` y el cuerpo hacia `direccion` (con su impreso de la tienda, al frente). */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Una decoración «de pie» (+z local arriba) con su origen en `origen`, su arriba hacia `arriba` y la cara al frente. */
  dePie: (id: string, nombre: string, decoracion: Decoracion, origen: Vec3, arriba?: Vec3, impresos?: ImpresoEnPieza[]) => void;
  /** Elementos de la raíz (en el mundo). */
  escenografia: (...elementos: ElementoEscenografia[]) => void;
  /** Una cinta de `desde` a `hasta` (mundo), en la raíz. */
  cinta: (desde: Vec3, hasta: Vec3, hex: string) => void;
  /** Otra raíz suelta (metalizado, letras, mesa…) en la misma escena. */
  raiz: (nodo: NodoEscena) => void;
  escena: (s: Sala) => Escena;
};

function montaje(raiz: { id: string; nombre: string; origen: Vec3 }): Montaje {
  const O = raiz.origen;
  const hijos: NodoEscena[] = [];
  const otras: NodoEscena[] = [];
  const elementos: ElementoEscenografia[] = [];
  const pieza: Montaje["pieza"] = (id, nombre, p, origen, normal = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    // `sobre` un padre sin globos deja la espalda (lo más bajo de su caja) a HUNDIMIENTO antes del punto: así el
    // origen de la pieza cae justo en `origen`.
    const punto = mas(menos(origen, O), por(n, armarPieza(p).caja.min.y + HUNDIMIENTO_SOBRE_CM));
    hijos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(punto), normal: redondo(n), giroGrados: r2(giroGrados) } });
  };
  return {
    pieza,
    globo: (id, nombre, g, centro, direccion = ARRIBA, impresoId) => {
      const p: Pieza = { tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) };
      pieza(id, nombre, p, centro, direccion, impresoId ? giroAlFrente(direccion) : 0);
    },
    dePie: (id, nombre, decoracion, origen, arriba = ARRIBA, impresos) => {
      const { normal, giroGrados } = deFrenteHacia(arriba);
      pieza(id, nombre, { tipo: "decoracion", decoracion, ...(impresos?.length ? { impresos } : {}) }, origen, normal, giroGrados);
    },
    escenografia: (...e) => { elementos.push(...e); },
    cinta: (desde, hasta, hex) => { elementos.push(tubo(desde, hasta, 0.2, hex)); },
    raiz: (nodo) => { otras.push(nodo); },
    escena: (s) => ({
      sala: s,
      nodos: [{ id: raiz.id, nombre: raiz.nombre, pieza: { tipo: "escenografia", elementos: elementos.map((e) => aLocal(e, O)) }, colocacion: libre(O) }, ...hijos, ...otras],
    }),
  };
}

// ----------------------------------------------------------------------------------------------------------
// Ramo de helio por pisos
// ----------------------------------------------------------------------------------------------------------

/** Nombre corto de un color: «Fashion Negro». */
const color = (codigo: string) => referenciaPorCodigo(codigo)?.nombreCompleto ?? codigo;

/**
 * Un globo del ramo: liso (o con su impreso de la tienda), globo dentro de globo (`dentro`: el de adentro; el impreso
 * va en el de fuera) o la calabaza impresa con su tallo de lazos.
 */
type GloboRamo =
  | { tipo: "globo"; g: ParteGlobo; que: string; impresoId?: string }
  | { tipo: "doble"; g: ParteGlobo; dentro: ParteGlobo; que: string; impresoId?: string }
  | { tipo: "calabaza"; g: ParteGlobo; tallo: { codigo: string; lazos: number; largoLazoCm: number }; que: string };
/**
 * Un piso del ramo: sus globos en sus ángulos (0° = de frente, 90° = a la derecha de quien mira), con el centro del
 * cuerpo a `alturaCm` del piso y a `radioCm` del eje, inclinados hacia fuera `inclinacionGrados`.
 */
type PisoRamo = { alturaCm: number; radioCm: number; inclinacionGrados: number; globos: ReadonlyArray<readonly [number, GloboRamo]> };

const tres = (giro: number) => [giro, giro + 120, giro + 240];
/** Dos lado a lado, de frente. */
const DOS = [300, 60];
const LADO = ["frente", "derecha", "detrás a la derecha", "detrás", "detrás a la izquierda", "izquierda"];
const dondeEsta = (a: number) => LADO[Math.round((((a % 360) + 360) % 360) / 60) % 6]!;
const piso = (alturaCm: number, radioCm: number, angulos: readonly number[], g: GloboRamo | readonly GloboRamo[], inclinacionGrados = 14): PisoRamo =>
  ({ alturaCm, radioCm, inclinacionGrados, globos: angulos.map((a, i) => [a, Array.isArray(g) ? (g as readonly GloboRamo[])[i]! : (g as GloboRamo)] as const) });

/** Dónde queda el nudo de un globo de `d` cm con el centro del cuerpo en `centro`, mirando hacia `direccion`. */
const nudoDe = (d: number, centro: Vec3, direccion: Vec3): Vec3 => menos(centro, por(unitario(direccion), centroCuerpo("redondo", d)));

/** Un globo del ramo (o de una cadena, o de una figura) con el centro de su cuerpo en `centro`, hacia `direccion`. */
function ponerGloboRamo(m: Montaje, id: string, nombre: string, x: GloboRamo, centro: Vec3, direccion: Vec3): void {
  if (x.tipo === "globo") m.globo(id, nombre, x.g, centro, direccion, x.impresoId);
  else if (x.tipo === "doble") {
    const deco: Decoracion = { tipo: "burbuja", propiedades: { exterior: x.g, interiores: [{ formatoId: x.dentro.formatoId, infladoCm: x.dentro.infladoCm, codigos: [x.dentro.codigo], cantidad: 1 }], relleno: null, semilla: 1 } };
    m.dePie(id, nombre, deco, nudoDe(x.g.infladoCm, centro, direccion), direccion, x.impresoId ? [{ impresoId: x.impresoId, globos: [0] }] : undefined);
  } else {
    const deco: Decoracion = { tipo: "calabaza", propiedades: { globo: x.g, cara: { hex: "#141414" }, tallo: { formatoId: "T-260", grosorCm: 4.5, codigo: x.tallo.codigo, lazos: x.tallo.lazos, largoLazoCm: x.tallo.largoLazoCm, zarcillos: false } } };
    m.dePie(id, nombre, deco, centro, direccion);
  }
}

/** Los pisos del ramo `sobre` el peso, con una cinta del amarre a cada nudo. */
function ramo(m: Montaje, pisos: readonly PisoRamo[], o: { amarre: Vec3; cinta: string | readonly string[]; eje?: Vec3 }): void {
  const eje = o.eje ?? v(0, 0, 0);
  let k = 0;
  pisos.forEach((p, i) => p.globos.forEach(([a, x], j) => {
    const f = fuera(a);
    const inc = rad(p.inclinacionGrados);
    const direccion = unitario(mas(por(f, Math.sin(inc)), por(ARRIBA, Math.cos(inc))));
    const centro = mas(eje, v(f.x * p.radioCm, p.alturaCm, f.z * p.radioCm));
    ponerGloboRamo(m, `globo-${i + 1}-${j + 1}`, `${x.que} (piso ${i + 1}, ${dondeEsta(a)})`, x, centro, direccion);
    const hex = typeof o.cinta === "string" ? o.cinta : o.cinta[k++ % o.cinta.length]!;
    m.cinta(o.amarre, nudoDe(x.g.infladoCm, centro, direccion), hex);
  }));
}

/** El peso de un ramo (no se ve en las fotos: cortadas): un cilindro de 4,5 cm de radio y 7 de alto. */
const PESO = (hex: string, en: Vec3 = v(0, 0, 0)): ElementoEscenografia => cilindro(en, 4.5, 7, hex, "metal");
const AMARRE = v(0, 7, 0);

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

/** Un producto que la idea publica (nombre, url y código tal cual; el formato, el del mapeo). */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };
const P = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });
/**
 * Un producto de la tienda que la idea enlaza y que el taller no tiene tal cual (un impreso que el catálogo no trae, un
 * color que no está en la tabla oficial): va en el látex `formato` + `codigo` (el de fondo, o el más parecido) y se lista
 * con su cantidad contada (`"todos"`: todo lo de ese formato y código).
 */
type FueraDeCatalogo = { publicado: Publicado; formato: string; codigo: string; cantidad: number | "todos" };

type UsoImpreso = { impresoId: string; formatoId: string; codigo: string; cantidad: number };

/** Qué globos de una pieza toman cada impreso (la misma regla que `aplicarImpresos`): por impreso, formato y color. */
function usoDeImpresos(pieza: Pieza): UsoImpreso[] {
  if (!pieza.impresos?.length) return [];
  const globos = armarPieza({ ...pieza, impresos: [] }).globos.map((g) => ({ formatoId: g.formatoId, codigo: g.codigo }));
  const ya = new Set<number>();
  const salida = new Map<string, UsoImpreso>();
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
 * Los productos de la idea a partir de lo armado (que es lo contado en la foto): cada impreso del catálogo por formato
 * y color de fondo; cada metalizado; los impresos de la tienda que el catálogo no trae (con su fondo); y los lisos (lo
 * que queda de cada formato y código). Lo que la idea publica sale con su nombre y url tal cual (si la foto no lo
 * tiene, sin cantidad); lo demás, con el producto liso de la tienda.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[], fueraDeCatalogo: readonly FueraDeCatalogo[]): ProductoDeIdea[] {
  const armada = armarEscena(escena);
  const salida: ProductoDeIdea[] = [];
  const usados = new Set<Publicado>();
  const impresos = new Map<string, UsoImpreso>();
  const metalizados = new Map<string, { nombre: string; url: string; cantidad: number }>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    for (const u of usoDeImpresos(nodo.pieza)) {
      const k = `${u.impresoId}|${u.formatoId}|${u.codigo}`;
      const previo = impresos.get(k) ?? { ...u, cantidad: 0 };
      previo.cantidad += u.cantidad * copias;
      impresos.set(k, previo);
    }
    if (nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto && copias > 0) {
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
  for (const f of fueraDeCatalogo) {
    const delLatex = Math.ceil(sumarMateriales(armada.materiales).filter((m) => m.formatoId === f.formato && m.codigo === f.codigo).reduce((s, m) => s + m.cantidad, 0) - 1e-9);
    const cantidad = f.cantidad === "todos" ? delLatex : f.cantidad;
    if (cantidad <= 0) continue;
    usados.add(f.publicado);
    salida.push({ nombre: f.publicado.nombre, url: f.publicado.url, formato: f.formato, codigo: f.codigo, cantidad, contada: true });
    quitar(f.formato, f.codigo, cantidad);
  }
  for (const m of sumarMateriales(armada.materiales)) {
    const cantidad = Math.ceil(m.cantidad - (restar.get(`${m.formatoId}|${m.codigo}`) ?? 0) - 1e-9);
    if (cantidad <= 0) continue;
    // El producto de la tienda es uno por color para todas sus tallas: se reconoce por el tipo de globo y el código.
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const publicado = publicados.find((p) => p.formato !== null && formatoPorId(p.formato)?.tipo === tipo && p.codigo === m.codigo && !impresoPorUrl(p.url) && !fueraDeCatalogo.some((f) => f.publicado === p));
    if (publicado) { usados.add(publicado); salida.push({ ...publicado, formato: m.formatoId, cantidad, contada: true }); }
    else salida.push(liso(m.formatoId, m.codigo, cantidad));
  }
  // Lo publicado que la foto no tiene: listado, sin cantidad.
  for (const p of publicados) if (!usados.has(p)) salida.push({ ...p, cantidad: null });
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// La idea completa
// ----------------------------------------------------------------------------------------------------------

function fuente(slug: string): FuenteIdea {
  const f = fuenteIdea(slug);
  if (!f) throw new Error(`Idea sin fuente: ${slug}`);
  return f;
}

/**
 * La idea con su id «idea:<slug>», su foto y sus productos (los de lo armado). Escena, ocasiones y productos se
 * calculan al pedirlos: el índice importa este lote y este lote toma `ocasionesDeEtiquetas` del índice.
 */
function idea(slug: string, nombre: string, escena: () => Escena, nota: string, publicados: readonly Publicado[] = [], fueraDeCatalogo: readonly FueraDeCatalogo[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  // Perezosa (ver `ideaPerezosa` en tipos.ts): la escena se arma la primera vez que se pide, no al importar el lote.
  const laEscena = perezoso(escena);
  return ideaPerezosa(
    {
      id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
      get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
    },
    () => ({ tipo: "escena", escena: laEscena() }),
    () => productosDe(laEscena(), publicados, fueraDeCatalogo),
  );
}

const SALA_RAMO = () => sala(360, 320, 300);
const MESA_ALTO = 74;
/** Mesa redonda de 60 cm (escenografía suelta) para los centros de mesa. */
const mesa = (): NodoEscena => ({ id: "mesa", nombre: "Mesa redonda", pieza: { tipo: "escenografia", elementos: mesaCilindrica({ diametroCm: 60, altoCm: MESA_ALTO, hex: "#f2efe9" }) }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } });
/** Un metalizado suelto (raíz) con su base en `base` (mundo). */
const metalizadoSuelto = (id: string, nombre: string, m: OpcionesMetalizado, base: Vec3, giroGrados = 0): NodoEscena =>
  ({ id, nombre, pieza: { tipo: "metalizado", metalizado: m }, colocacion: libre(base, giroGrados) });
/** Alto de un metalizado (sin cinta). */
const altoMetal = (m: OpcionesMetalizado) => armarPieza({ tipo: "metalizado", metalizado: { ...m, cinta: null } }).caja.max.y;

// ----------------------------------------------------------------------------------------------------------
// 29 · Araña - Graffiti Invierno - Violeta
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; los R-12 miden ~237 px (28 cm): 8,4 px/cm; un piso cada ~245 px (29 cm). Abajo 3 violeta (dos de
 * frente, ~270 px entre centros, y uno detrás), en medio 3 naranja graffiti (uno al frente y dos a los lados) y arriba
 * 3 cristal araña (dos de frente y uno detrás, que asoma entre ellos).
 */
function escena29(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#c9cbd0"));
  const violeta: GloboRamo = { tipo: "doble", g: R("R-12", 28, "051"), dentro: R("R-12", 26, "481"), que: "Doble globo Fashion Violeta con Satín Plata dentro" };
  const naranja: GloboRamo = { tipo: "globo", g: R("R-12", 28, "061"), que: "R-12 Fashion Naranja" };
  const arana: GloboRamo = { tipo: "doble", g: R("R-12", 28, "390"), dentro: R("R-12", 26, "981"), que: "Doble globo Infinity® Araña con Reflex Plata dentro", impresoId: "infinity-arana-fashion-transparente" };
  ramo(m, [
    piso(120, 19, tres(60), violeta, 12),
    piso(149, 24, tres(0), naranja),
    piso(178, 17, tres(60), arana, 12),
  ], { amarre: AMARRE, cinta: ["#ececef", "#f07a22", "#ececef"] });
  return m.escena(SALA_RAMO());
}

const idea29 = idea("arana-graffiti-invierno-violeta", "Ramo Araña, Graffiti Invierno y Violeta (globo dentro de globo)", escena29,
  "Igual: 9 R-12 de helio contados en 3 pisos, de abajo arriba 3 violeta (dos de frente y uno detrás), 3 naranja (uno al frente y dos a los lados) y 3 cristal con arañas (dos de frente y uno que asoma detrás), cada piso girado sobre el de abajo como en la foto. Las arañas y los violeta son globo dentro de globo, como dice la idea: el Infinity® Araña Transparente de la tienda (exacto, con su producto) con un Reflex Plata dentro, y el violeta con un Satín Plata dentro. Distinto: el «Cristal Violeta» no está en la tabla oficial de color: va el Fashion Violeta 051 (opaco: el satín de dentro no se ve, como casi en la foto, que mide más oscuro, #24174e). El «061 - Fashion Graffiti Invierno» (remolinos blancos sobre naranja) no se vende en naranja (la tienda tiene el Graffiti Invierno en rojo y en cristal): va el Fashion Naranja 061 liso, que es el color publicado; el impreso más parecido sería el Graffiti Invierno Fashion Rojo. El peso y el largo de las cintas no salen en la foto (cortada).");

// ----------------------------------------------------------------------------------------------------------
// 68 · Arco bebito (cadena de eslabones R-12 y cuartetos de R-5)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 miden ~110 px (28 cm): 3,93 px/cm. 8 R-12 celestes impresos en cadena (4 por pata, el
 * cuarto de cada lado junto a la clave) y 9 nudos de R-5 azul rey: uno en cada pie, uno entre cada dos R-12 y uno en la
 * clave. El eje de la cadena es media elipse de 72,5 cm de semiancho y 104 cm de alto (de los nudos de los pies, x = 85
 * y 655 px, a la clave, y = 85 px), con los pies a 6 cm del piso.
 */
const CADENA = { semiancho: 72.5, alto: 104, pie: 6, nudos: 9 };
function puntosCadena(): { nudos: Vec3[]; fueraDe: (p: Vec3) => Vec3 } {
  // La media elipse muestreada fino y repartida en tramos de igual largo.
  const n = 400;
  const muestras = Array.from({ length: n + 1 }, (_, i) => { const t = Math.PI - (Math.PI * i) / n; return v(CADENA.semiancho * Math.cos(t), CADENA.pie + CADENA.alto * Math.sin(t), 0); });
  const acumulado = [0];
  for (let i = 1; i <= n; i++) acumulado.push(acumulado[i - 1]! + largo(menos(muestras[i]!, muestras[i - 1]!)));
  const total = acumulado[n]!;
  const nudos: Vec3[] = [];
  for (let k = 0; k < CADENA.nudos; k++) {
    const meta = (total * k) / (CADENA.nudos - 1);
    let i = acumulado.findIndex((s) => s >= meta - 1e-9);
    if (i < 1) i = 1;
    const t = (meta - acumulado[i - 1]!) / (acumulado[i]! - acumulado[i - 1]! || 1);
    nudos.push(redondo(mas(muestras[i - 1]!, por(menos(muestras[i]!, muestras[i - 1]!), Math.min(1, Math.max(0, t))))));
  }
  // Hacia fuera de la elipse (la normal en el plano de frente).
  const fueraDe = (p: Vec3) => unitario(v((p.x / CADENA.semiancho) / CADENA.semiancho, ((p.y - CADENA.pie) / CADENA.alto) / CADENA.alto, 0));
  return { nudos, fueraDe };
}

function escena68(): Escena {
  const { nudos, fueraDe } = puntosCadena();
  const m = montaje({ id: "cordon", nombre: "Cordón de la cadena", origen: v(0, 0, 0) });
  // El cordón por el que se ensartan los eslabones (nailon, casi no se ve).
  for (let k = 0; k + 1 < nudos.length; k++) m.escenografia(tubo(nudos[k]!, nudos[k + 1]!, 0.12, "#eef2f5"));
  const AZUL_REY = R("R-5", 11.5, "041");
  nudos.forEach((p, k) => {
    // Cuarteto de R-5 girado 1/8 de vuelta: dos al frente (fuera y dentro) y dos detrás.
    const o = k === 0 ? v(-1, 0, 0) : k === nudos.length - 1 ? v(1, 0, 0) : fueraDe(p);
    const lado = ["al frente, por fuera", "al frente, por dentro", "detrás, por dentro", "detrás, por fuera"];
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([a, b], j) => {
      const d = unitario(mas(por(o, a!), por(AL_FRENTE, b!)));
      m.globo(`nudo-${k + 1}-${j + 1}`, `R-5 Fashion Azul Rey del nudo ${k + 1} (${lado[j]})`, AZUL_REY, mas(p, por(d, 0.62 * AZUL_REY.infladoCm)), d);
    });
  });
  for (let k = 0; k + 1 < nudos.length; k++) {
    const a = nudos[k]!, b = nudos[k + 1]!;
    const d = unitario(menos(b, a));
    m.globo(`eslabon-${k + 1}`, `R-12 Infinity® Es un Niño Estrella, eslabón ${k + 1}`, R("R-12", 28, "640"), por(mas(a, b), 0.5), d, "infinity-es-un-nino-estrella-pastel-mate-azul");
  }
  return m.escena(sala(360, 300, 280));
}

const idea68 = idea("arco-bebito", "Arco bebito: cadena de R-12 celestes con nudos de R-5 azul rey", escena68,
  "Igual: 8 R-12 celestes impresos en cadena, 4 por pata, ensartados en un cordón que dibuja media elipse de 1,45 m entre pies y 1,04 m de alto al eje (1,25 m con los globos), y 9 nudos de cuarteto R-5 Fashion Azul Rey (uno en cada pie, uno entre cada dos R-12 y uno en la clave), contados en la foto: 8 R-12 y 36 R-5. Cada R-12 va a lo largo de la cadena con lo impreso al frente (en las patas el letrero queda de lado, como el eje del globo). Distinto: el impreso de la foto (biberones, coches y ositos blancos sobre celeste) no lo vende la tienda: va el impreso de bebé más parecido que sí vende, el Infinity® Es un Niño Estrella (estrellas blancas y «es un niño» sobre Pastel Mate Azul 640), un celeste más pálido que el de la foto (medido #66d4f7, entre Fashion Azul Caribe y Fashion Azul). Los R-5 miden casi violeta en la foto vieja y sobresaturada (#0a2ca9): por el tono van Azul Rey 041, el «azul rey» de la idea.");

// ----------------------------------------------------------------------------------------------------------
// 131 · Arco polka azul (cuartetos blancos con la franja azul de lunares al frente)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 blancos miden ~47 px y el paso entre niveles ~38 px. 36 niveles de cuarteto (contados a lo
 * largo de la franja azul: 18 por lado hasta la clave), cada uno con un azul al frente, y R-5 blancos en los huecos.
 * Con R-12 a 24 cm (1,96 px/cm) el arco mide 2,76 m de ancho y 2,7 m de alto por fuera: parabólico (patas rectas y la
 * clave redonda).
 */
const ARCO_131: Pieza = { tipo: "arco", formatoId: "R-12", infladoCm: 24, forma: "parabolico", anchoCm: 266, altoCm: 268, patron: "un_color", colores: ["005"] };
/** En cada nivel, el globo que da al frente (y, si dos dan igual, el de fuera): ahí va el azul impreso. */
function frentePorNivel(pieza: Pieza, altoCm: number): number[] {
  const globos = armarPieza(pieza).globos;
  const salida: number[] = [];
  for (let k = 0; k + 3 < globos.length; k += 4) {
    const centros = [0, 1, 2, 3].map((j) => { const g = globos[k + j]!; return mas(g.nudo, por(unitario(g.direccion), centroCuerpo("redondo", g.infladoCm))); });
    const medio = por(centros.reduce((s, c) => mas(s, c), v(0, 0, 0)), 0.25);
    const haciaFuera = unitario(v(medio.x, Math.max(0, medio.y - altoCm * 0.55), 0));
    let mejor = 0, puntaje = -Infinity;
    centros.forEach((c, j) => { const d = menos(c, medio); const s = d.z + 0.35 * pto(d, haciaFuera); if (s > puntaje) { puntaje = s; mejor = j; } });
    salida.push(k + mejor);
  }
  return salida;
}
function escena131(): Escena {
  const pieza: Pieza = { ...ARCO_131, impresos: [{ impresoId: "infinity-feliz-cumpleanos-terrazo-azul-fashion", globos: frentePorNivel(ARCO_131, 268) }] };
  return {
    sala: sala(500, 360, 320),
    nodos: [
      { id: "arco", nombre: "Arco de cuartetos blancos con la franja azul", pieza, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "relleno", nombre: "R-5 Fashion Blanco en los huecos", pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 12, codigo: "005" }, colocacion: { en: "ancla", padreId: "arco", ancla: 0, cada: 1, giroGrados: 0 } },
    ],
  };
}

const idea131 = idea("arco-polka-azul", "Arco polka azul: cuartetos blancos con franja azul de lunares", escena131,
  "Igual: arco parabólico de cuartetos de R-12 (patas rectas y clave redonda) de 2,7 m de ancho y de alto por fuera, con 36 niveles (contados a lo largo de la franja azul) de 3 R-12 Fashion Blanco y 1 azul impreso al frente, y un R-5 Fashion Blanco en cada hueco entre globos, como la foto. Distinto: la tienda no vende el Polka (lunares blancos) en azul (solo en rojo y en verde lima): va el impreso que vende más parecido, el Infinity® Terrazo Azul (manchitas blancas y celestes sobre azul), que en un globo blanco toma su fondo Azul Naval 044 (la foto mide #163082, un azul rey). El arco del taller gira cada cuarteto 1/8 de vuelta: el azul sale al frente en un nivel y al frente por fuera en el siguiente, una franja que culebrea un poco donde la foto es recta. Los R-5 de los huecos quedan metidos entre los R-12 (en la foto asoman un poco más).");

// ----------------------------------------------------------------------------------------------------------
// 203 · Bouquet Filigree con base
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el R-12 plateado mide ~83 px (28 cm): 2,96 px/cm, con el piso en y = 555 px y el eje en x = 372 px.
 * Tres R-12 de helio uno sobre otro (rosado a 115 cm, dorado a 141 y plateado a 167, al centro de cada uno), sus cintas
 * lila a la base: un globo cristal relleno (la «botella», 15 × 25 cm) sobre un anillo de R-5 dorados, perla, plata y
 * oro rosa de 52 cm de ancho y 23 de alto, en tres pisos.
 */
function escena203(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#c9b27a"));
  const colores = ["570", "481", "406", "568"];
  let c = 0;
  const anillo = (prefijo: string, cuantos: number, radio: number, alto: number, elevacion: number, desde: number) => {
    for (let k = 0; k < cuantos; k++) {
      const a = desde + (360 * k) / cuantos;
      const d = unitario(mas(por(fuera(a), Math.cos(rad(elevacion))), por(ARRIBA, Math.sin(rad(elevacion)))));
      const codigo = colores[c++ % colores.length]!;
      m.globo(`${prefijo}-${k + 1}`, `R-5 ${color(codigo)} de la base (${prefijo} ${k + 1})`, R("R-5", 8, codigo), mas(v(0, alto, 0), por(fuera(a), radio)), d);
    }
  };
  anillo("anillo-1", 16, 20, 4.5, 10, 0);
  anillo("anillo-2", 13, 15, 11, 30, 14);
  anillo("anillo-3", 9, 9.5, 16.5, 55, 7);
  const botella: Decoracion = { tipo: "burbuja", propiedades: { exterior: R("R-12", 22, "390"), interiores: [{ formatoId: "R-5", infladoCm: 6, codigos: ["481", "570", "406", "005"], cantidad: 8 }], relleno: { tipo: "confeti", colores: ["#c9a24a", "#e3c77a"], cantidad: 40, tamanoCm: 0.8 }, semilla: 4 } };
  m.dePie("botella", "Burbuja R-12 Cristal Transparente con R-5 y confeti dorado", botella, v(0, 21, 0));
  const amarre = v(0, 44, 0);
  const globos: Array<[string, string, ParteGlobo, Vec3]> = [
    ["rosado", "R-12 Metal Dorado Rosa (filigrana)", R("R-12", 28, "568"), v(-6, 115, 1)],
    ["dorado", "R-12 Metal Dorado", R("R-12", 28, "570"), v(7, 141, -4)],
    ["plata", "R-12 Reflex Plata (filigrana)", R("R-12", 28, "981"), v(-8, 167, 2)],
  ];
  for (const [id, nombre, g, centro] of globos) {
    const d = unitario(menos(centro, amarre));
    m.globo(id, nombre, g, centro, d);
    m.cinta(amarre, nudoDe(g.infladoCm, centro, d), "#d8c6e8");
  }
  return m.escena(SALA_RAMO());
}

const idea203 = idea("bouquet-filigree-con-base", "Bouquet Filigree con base de burbuja", escena203,
  "Igual: 3 R-12 de helio uno sobre otro a la altura de la foto (Metal Dorado Rosa a 1,15 m, Metal Dorado a 1,41 m y Reflex Plata a 1,67 m al centro), con sus cintas lila a la base, y la base de la foto: un R-12 Cristal Transparente relleno de R-5 (plata, dorado, perla y blanco) y confeti dorado sobre un anillo de 38 R-5 dorados, plata, perla y oro rosa en tres pisos (52 cm de ancho). Colores medidos en la foto (la idea no publica productos). Distinto: la filigrana blanca (encaje) del plateado y del oro rosa no la vende la tienda ni en otro color: van lisos en su fondo (Reflex Plata 981 y Metal Dorado Rosa 568). Los R-5 de la base van a 8 cm (en la foto se ven muy pequeños) y el anillo no se cuenta uno a uno: se ven unos 40.");

// ----------------------------------------------------------------------------------------------------------
// 206 · Bouquet regalo de cumpleaños
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el metalizado mide ~115 px de ancho (18" ≈ 42 cm): 2,74 px/cm, con el piso en y = 560 px y el eje en
 * x = 365 px. Dos metalizados (el de la izquierda con el centro a 142 cm, el de la derecha a 170), y debajo de cada uno,
 * ensartada en su cinta, una cadena de cuarteto R-5, R-12 amarillo (23 × 29 cm) y cuarteto R-5. Abajo, la base: moño de
 * T-260 naranja en X con un R-5 al centro y un cuarteto de R-5.
 */
function escena206(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso, base y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#e0c25a"));
  const foil = metalizadoDeTienda("festivo");
  const alto = altoMetal(foil);
  const cadenas: Array<{ lado: string; x: number; z: number; centro: number; anillos: [number, string[]][]; amarillo: number }> = [
    { lado: "izquierda", x: -16, z: 2, centro: 142, anillos: [[111, ["230", "011", "051", "040"]], [84, ["230", "040", "051", "011"]]], amarillo: 98 },
    { lado: "derecha", x: 17, z: -6, centro: 170, anillos: [[137, ["040", "230", "011", "051"]], [109, ["011", "230", "051", "040"]]], amarillo: 123 },
  ];
  const amarre = v(0, 14, 0);
  for (const c of cadenas) {
    const base = v(c.x, c.centro - alto / 2, c.z);
    m.raiz(metalizadoSuelto(`metalizado-${c.lado}`, `Metalizado Feliz Cumpleaños Festivo (${c.lado})`, foil, base));
    m.cinta(amarre, base, "#f3f1ec");
    // La cinta va del amarre a la base del metalizado: la cadena va ensartada en ella.
    const enCinta = (y: number) => mas(amarre, por(menos(base, amarre), (y - amarre.y) / (base.y - amarre.y)));
    c.anillos.forEach(([y, codigos], k) => codigos.forEach((codigo, j) => {
      const d = unitario(mas(fuera(45 + 90 * j), por(ARRIBA, 0.15)));
      m.globo(`cuarteto-${c.lado}-${k + 1}-${j + 1}`, `R-5 ${color(codigo)} del cuarteto ${k + 1} (${c.lado}, ${j + 1})`, R("R-5", 7.5, codigo), mas(enCinta(y), por(fuera(45 + 90 * j), 4.6)), d);
    }));
    m.globo(`amarillo-${c.lado}`, `R-12 Fashion Amarillo Miel de la cadena (${c.lado})`, R("R-12", 23, "021"), enCinta(c.amarillo), ARRIBA);
  }
  // La base: un cuarteto de R-5 y el moño naranja en X de frente, con su R-5 rosa al centro.
  ["051", "015", "040", "020"].forEach((codigo, j) => {
    const d = unitario(mas(fuera(45 + 90 * j), por(ARRIBA, 0.3)));
    m.globo(`base-${j + 1}`, `R-5 ${color(codigo)} de la base`, R("R-5", 7.5, codigo), mas(v(0, 9, 0), por(fuera(45 + 90 * j), 4.6)), d);
  });
  const mono: Decoracion = { tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 3.5, codigo: "061", lazosPorLado: 2, largoLazoCm: 10, anchoLazoCm: 4, aberturaGrados: 70, colas: false, largoColaCm: 0, centro: R("R-5", 7.5, "011") } };
  m.pieza("mono", "Moño de T-260 Fashion Naranja con R-5 Fashion Rosa", { tipo: "decoracion", decoracion: mono }, v(0, 13, 4.5), AL_FRENTE);
  return m.escena(SALA_RAMO());
}

const idea206 = idea("bouquet-regalo-de-cumpleano", "Bouquet regalo de cumpleaños con cadenas de R-5", escena206,
  "Igual: dos metalizados de cumpleaños de 18\" con helio (el de la izquierda más bajo, centros a 1,42 y 1,70 m), y debajo de cada uno, ensartada en su cinta, la cadena de la foto: cuarteto de R-5, R-12 Fashion Amarillo Miel (alargado, 23 cm) y otro cuarteto de R-5 (verde, rosa, violeta y azul); abajo, la base con un cuarteto de R-5 (violeta, rojo, azul y amarillo) y el moño de T-260 Fashion Naranja en X con su R-5 rosa al centro. Colores medidos (la idea no publica productos): el verde lima mide Neón Verde 230 y el azul Fashion Azul 040. Distinto: el metalizado de la foto (una caja de regalo con estallido amarillo y «Happy Birthday») no lo vende la tienda: va el metalizado de cumpleaños de 18\" que sí vende, el Feliz Cumpleaños Festivo (redondo, blanco y con letras), con su producto. Los R-5 van a 7,5 cm, como se ven.");

// ----------------------------------------------------------------------------------------------------------
// 211 · Bouquet (Feliz Día con estrella verde y base «2 ★ 0»)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 miden ~90 px (28 cm): 3,2 px/cm, con el piso en y = 548 px y el eje en x = 365 px. Estrella
 * metalizada verde arriba (centro a 150 cm), un R-12 amarillo (114 cm, a la izquierda) y uno fucsia (111 cm, a la
 * derecha) con cintas rojas. Base: «2» y «0» de T-260 verde de 20 cm, una estrellita roja de 8" entre ellos y 6 R-5
 * amarillos (3 abajo de frente, uno detrás y 2 arriba).
 */
function escena211(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso, base y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#e0c25a"));
  const amarre = v(0, 14, 0);
  const AMARILLO = R("R-5", 12, "020");
  [0, 1, 2, 3].forEach((j) => {
    const d = unitario(mas(fuera(45 + 90 * j), por(ARRIBA, 0.2)));
    m.globo(`base-${j + 1}`, `R-5 Fashion Amarillo de la base (abajo ${j + 1})`, AMARILLO, mas(v(0, 7.6, 0), por(fuera(45 + 90 * j), 7)), d);
  });
  [90, 270].forEach((a, j) => {
    const d = unitario(mas(fuera(a), por(ARRIBA, 0.8)));
    m.globo(`base-arriba-${j + 1}`, `R-5 Fashion Amarillo de la base (arriba ${j + 1})`, AMARILLO, mas(v(0, 16, -1), por(fuera(a), 5.5)), d);
  });
  const ramoGlobos: Array<[string, string, ParteGlobo, Vec3, string]> = [
    ["amarillo", "R-12 Infinity® Feliz Día Fiesta Bigotes en Fashion Amarillo", R("R-12", 28, "020"), v(-15, 114, 2), "infinity-feliz-dia-fiesta-bigotes-fashion-surtido"],
    ["fucsia", "R-12 Infinity® Corazones Brillantes «Feliz Día» en Fashion Fucsia", R("R-12", 28, "012"), v(13, 111, 1), "infinity-r-corazones-brillantes-fashion-surtido"],
  ];
  for (const [id, nombre, g, centro, impresoId] of ramoGlobos) {
    const d = unitario(mas(por(unitario(menos(centro, amarre)), 0.35), ARRIBA));
    m.globo(id, nombre, g, centro, d, impresoId);
    m.cinta(amarre, nudoDe(g.infladoCm, centro, d), "#d9262f");
  }
  const estrella = metalizadoDeTienda("estrella-verde-vibrante");
  const baseEstrella = v(0, 150 - altoMetal(estrella) / 2, -4);
  m.raiz(metalizadoSuelto("estrella", "Estrella metalizada Verde Vibrante", estrella, baseEstrella));
  m.cinta(amarre, baseEstrella, "#d9262f");
  const estrellita = metalizadoDeTienda("estrella-rosada-vibrante", { pulgadas: 8 });
  m.raiz(metalizadoSuelto("estrellita", "Estrellita metalizada de la base", estrellita, v(0, 20, 5)));
  m.raiz({
    id: "numeros", nombre: "Números 2 y 0 de T-260 Verde Trébol",
    pieza: { tipo: "letras", letras: { texto: "20", altoCm: 20, grosorCm: 3, disposicion: "fila", tecnica: "tubito", formatoId: "T-260", infladoCm: 3.5, colores: ["029"], patron: "un_color", separacionCm: 21 } },
    colocacion: libre(v(0, 17, -1)),
  });
  return m.escena(SALA_RAMO());
}

const idea211 = idea("bouquet", "Bouquet Feliz Día con estrella verde y base de números", escena211,
  "Igual: estrella metalizada verde de 18\" arriba (la Estrella Verde Vibrante de la tienda, exacta), dos R-12 de helio con «Feliz Día» blanco, el amarillo a la izquierda y el fucsia a la derecha, con cintas rojas, y la base de la foto: «2» y «0» de T-260 Verde Trébol de 20 cm de alto con una estrellita metalizada entre ellos y 6 R-5 Fashion Amarillo (5 a la vista). Colores medidos (la idea no publica productos): amarillo 020, fucsia 012, verde 029. Distinto: el «Feliz Día!» con estrellitas de la foto no lo vende la tienda; van los Infinity® con «Feliz Día» blanco que sí vende en esos colores: Feliz Día Fiesta Bigotes (en su Fashion Amarillo) y Corazones Brillantes con «Feliz Día» (en su Fashion Fucsia), con bigotes y corazones que la foto no tiene. La estrellita roja de 8\" tampoco: va la Estrella Rosada Vibrante de la tienda (18\") a 8\". Los números de la foto son de un solo T-260; el taller los trenza con dos.");

// ----------------------------------------------------------------------------------------------------------
// 231 · Calabaza - Verde Lima - Negro
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; los R-12 negros miden ~185 px (28 cm): 6,6 px/cm; un piso cada ~200 px (30 cm). Abajo 3 negro (uno
 * al frente y dos a los lados), en medio 3 Reflex Verde Lima (dos de frente y uno detrás, que refleja la calabaza) y
 * arriba la calabaza impresa (305 × 235 px: 46 × 36 cm, un R-18) con su tallo de 4 lazos de T-260 verde lima.
 */
const P_CALABAZA = P("GLOBO REDONDO CALABAZA NARANJA", "/products/globo-para-fiesta-latex-redondo-2-caras-calabaza-fashion-naranja", "R-12", null);
const P_TUBITO_VL = P("GLOBO TUBITO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-reflex-verde-lima", "T-260", "931");
const P_VERDE_LIMA = P("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931");
const P_NEGRO = P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080");
function escena231(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#2b2b2e"));
  ramo(m, [
    piso(120, 21, tres(0), { tipo: "globo", g: R("R-12", 28, "080"), que: "R-12 Fashion Negro" }),
    piso(150, 17, tres(60), { tipo: "globo", g: R("R-12", 28, "931"), que: "R-12 Reflex Verde Lima" }, 12),
    { alturaCm: 184, radioCm: 0, inclinacionGrados: 0, globos: [[0, { tipo: "calabaza", g: R("R-18", 42, "061"), tallo: { codigo: "931", lazos: 4, largoLazoCm: 18 }, que: "R-18 Calabaza Naranja impresa con tallo de T-260 Reflex Verde Lima" }]] },
  ], { amarre: AMARRE, cinta: "#e9e9ec" });
  return m.escena(SALA_RAMO());
}

const idea231 = idea("calabaza-verde-lima-negro", "Ramo Calabaza, Verde Lima y Negro", escena231,
  "Igual: 7 globos de helio contados en 3 pisos, de abajo arriba 3 R-12 Fashion Negro (uno al frente y dos a los lados), 3 R-12 Reflex Verde Lima (dos de frente y uno detrás) y arriba la calabaza naranja con su cara impresa (ojos y nariz de triángulo, boca con dientes) y el tallo de 4 lazos de T-260 Reflex Verde Lima, todo con los productos que publica la idea. Distinto: la «Calabaza Naranja» de la tienda (2 caras) no está en el catálogo de impresos del taller: va su producto con su cantidad y el globo Fashion Naranja 061 con la cara de calabaza del taller (un dibujo propio, parecido). En la foto la calabaza mide 46 × 36 cm, más que un R-12 (máx. 30 cm): va un R-18 a 42 cm, de pie (en la foto va acostada, con el nudo de lado). El peso y las cintas no salen en la foto.",
  [P_TUBITO_VL, P_CALABAZA, P_VERDE_LIMA, P_NEGRO],
  [{ publicado: P_CALABAZA, formato: "R-18", codigo: "061", cantidad: 1 }]);

// ----------------------------------------------------------------------------------------------------------
// 307 · Centro de mesa primera comunión
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 miden ~105 px (28 cm): 3,75 px/cm, con la mesa en y = 548 px y el eje en x = 380 px. Sobre
 * la mesa un pompón de papel verde (32 × 25 cm); tres R-12 de helio: rosado (130 cm sobre la mesa), verde perlado (102) y
 * lila (70); y dos estrellas metalizadas plateadas de ~20 cm (9") a 43 cm, a los lados.
 */
function escena307(): Escena {
  const T = MESA_ALTO;
  const m = montaje({ id: "pompon", nombre: "Pompón de papel verde y cintas", origen: v(0, T, 0) });
  m.escenografia(...bola(v(0, T + 12.5, 0), 16, "#4dc303", "papel", 8, 0.78));
  const amarre = v(0, T + 23, 0);
  const globos: Array<[string, string, ParteGlobo, Vec3, string]> = [
    ["rosado", "R-12 Satín Fucsia (Mi Primera Comunión)", R("R-12", 28, "412"), v(7, T + 130, -4), "#f2a0c0"],
    ["verde", "R-12 Pastel Dusk Té Verde", R("R-12", 28, "126"), v(12, T + 102, 2), "#9fd49a"],
    ["lila", "R-12 Reflex Violeta (Mi Primera Comunión)", R("R-12", 28, "951"), v(-5, T + 70, 4), "#f2a0c0"],
  ];
  for (const [id, nombre, g, centro, hex] of globos) {
    const d = unitario(mas(por(unitario(menos(centro, amarre)), 0.3), ARRIBA));
    m.globo(id, nombre, g, centro, d);
    m.cinta(amarre, nudoDe(g.infladoCm, centro, d), hex);
  }
  const estrella = metalizadoDeTienda("estrella-plata-1", { pulgadas: 9 });
  const alto = altoMetal(estrella);
  for (const [lado, x] of [["izquierda", -20], ["derecha", 17]] as const) {
    m.raiz(metalizadoSuelto(`estrella-${lado}`, `Estrella metalizada Plata (${lado})`, { ...estrella, cinta: { largoCm: r2(43 - alto / 2 - 23), hex: "#b9e39a" } }, v(x, T + 23, 3)));
  }
  m.raiz(mesa());
  return m.escena(sala(320, 300, 280));
}

const idea307 = idea("centro-de-mesa-primera-comunion", "Centro de mesa Primera Comunión con pompón y estrellas", escena307,
  "Igual: sobre una mesa, el pompón de papel verde (32 × 25 cm) con tres R-12 de helio a la altura de la foto (rosado a 1,30 m sobre la mesa, verde a 1,02 m y lila a 0,70 m) y sus cintas rosadas y verdes, y dos estrellas metalizadas plateadas de 9\" a los lados (la Estrella Plata de la tienda, exacta). Colores medidos (la idea no publica productos): rosado Satín Fucsia 412, verde Pastel Dusk Té Verde 126, lila Reflex Violeta 951 (el más cercano: en la foto se ve perlado). Distinto: el «Mi Primera Comunión» impreso del rosado y del lila no lo vende la tienda en esos colores (solo el Infinity® con palomas doradas sobre blanco): van lisos en su fondo. La tienda vende la estrella en 18\"; aquí a 9\", como se ve. Los rizos de cinta verde bajo las estrellas son la cinta de cada una (de papel), sin los bucles.");

// ----------------------------------------------------------------------------------------------------------
// 821 · Palomas - Perla - Azul
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; los R-12 miden ~240 px (28 cm): 8,6 px/cm; un piso cada ~240 px (28 cm). Abajo 4 Reflex Azul (dos de
 * frente, uno detrás a la derecha y uno detrás, bajo los otros), en medio 3 Satín Perla (uno al frente y dos a los lados)
 * y arriba 4 palomas y ángeles blancos sobre Reflex Dorado (dos de frente, uno detrás al centro y uno detrás a la derecha).
 */
const P_PALOMAS = P("GLOBO REDONDO MI PRIMERA COMUNIÓN PALOMAS", "/products/globo-para-fiesta-latex-redondo-2-caras-mi-primera-comunion-palomas-reflex-dorado", "R-12", null);
const P_PERLA = P("GLOBO REDONDO SATIN PERLA", "/products/globo-para-fiesta-latex-redondo-satin-perla", "R-12", "406");
const P_AZUL = P("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940");
function escena821(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#c9a24a"));
  ramo(m, [
    piso(120, 20, [315, 45, 125, 200], { tipo: "globo", g: R("R-12", 28, "940"), que: "R-12 Reflex Azul" }, 12),
    piso(148, 24, tres(0), { tipo: "globo", g: R("R-12", 28, "406"), que: "R-12 Satín Perla" }),
    piso(176, 21, [320, 40, 180, 105], { tipo: "globo", g: R("R-12", 28, "970"), que: "R-12 Mi Primera Comunión Palomas (Reflex Dorado)" }, 13),
  ], { amarre: AMARRE, cinta: "#d8b45a" });
  return m.escena(SALA_RAMO());
}

const idea821 = idea("palomas-perla-azul", "Ramo Palomas, Perla y Azul", escena821,
  "Igual: 11 R-12 de helio contados en 3 pisos, de abajo arriba 4 Reflex Azul (dos de frente, uno detrás a la derecha y uno que asoma debajo, detrás), 3 Satín Perla (uno al frente y dos a los lados) y arriba 4 «Mi Primera Comunión Palomas» (dos de frente y dos detrás), con los tres productos que publica la idea y cintas doradas al peso. Distinto: el impreso de palomas y ángeles blancos sobre Reflex Dorado de la tienda no está en el catálogo de impresos del taller: va su producto con su cantidad y el globo liso en su fondo, Reflex Dorado 970 (en la foto mide #895e3c por el cromado). El azul de la foto mide más oscuro (#203c55) que el Reflex Azul 940 publicado. El peso y las cintas no salen en la foto.",
  [P_PALOMAS, P_PERLA, P_AZUL],
  [{ publicado: P_PALOMAS, formato: "R-12", codigo: "970", cantidad: 4 }]);

// ----------------------------------------------------------------------------------------------------------
// 859 · Primera comunión - Blanco - Chocolate - Azul
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 miden ~110 px (28 cm): 3,9 px/cm; un piso cada ~120 px (31 cm). De abajo arriba: 2 Satín
 * Azul lisos lado a lado, 3 chocolate (uno al frente y dos a los lados), 3 blancos (dos de frente y uno que asoma detrás) y
 * 3 Satín Azul impresos «Mi Primera Comunión» (uno al frente y dos a los lados).
 */
const P_COMUNION_AZUL = P("GLOBO REDONDO MI PRIMERA COMUNIÓN", "/products/globo-para-fiesta-latex-redondo-2-caras-mi-primera-comunion-satin-azul", "R-12", null);
const P_BLANCO = P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005");
const P_CHOCOLATE = P("GLOBO REDONDO FASHION CHOCOLATE", "/products/globo-para-fiesta-latex-redondo-fashion-chocolate", "R-12", "076");
function escena859(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#d9d9de"));
  ramo(m, [
    piso(120, 18, DOS, { tipo: "globo", g: R("R-12", 28, "440"), que: "R-12 Satín Azul" }),
    piso(151, 27, [0, 105, 255], { tipo: "globo", g: R("R-12", 28, "076"), que: "R-12 Fashion Chocolate" }),
    piso(182, 18, tres(60), { tipo: "globo", g: R("R-12", 28, "005"), que: "R-12 Fashion Blanco" }),
    piso(212, 26, [0, 110, 250], { tipo: "globo", g: R("R-12", 28, "440"), que: "R-12 Mi Primera Comunión (Satín Azul)" }),
  ], { amarre: AMARRE, cinta: ["#f4a9c4", "#e8e8ec", "#f4a9c4"] });
  return m.escena(SALA_RAMO());
}

const idea859 = idea("primera-comunion-blanco-chocolate-azul", "Ramo Primera Comunión Blanco, Chocolate y Azul", escena859,
  "Igual: 11 R-12 de helio contados en 4 pisos, de abajo arriba 2 azul claro lado a lado, 3 Fashion Chocolate (uno al frente y dos a los lados), 3 Fashion Blanco (dos de frente y uno que asoma detrás) y arriba 3 «Mi Primera Comunión» Satín Azul (uno al frente y dos a los lados), con los productos que publica la idea y cintas rosadas y blancas. El azul claro liso de abajo mide Satín Azul 440 (#bed7e2): el mismo látex del impreso, liso. Distinto: el «Mi Primera Comunión» (cáliz y letras blancas) de la tienda no está en el catálogo de impresos del taller: va su producto con su cantidad y el globo liso en su fondo, Satín Azul 440. Abajo se ven 2 azules (si hay un tercero detrás, no asoma). El peso no sale en la foto.",
  [P_COMUNION_AZUL, P_BLANCO, P_CHOCOLATE],
  [{ publicado: P_COMUNION_AZUL, formato: "R-12", codigo: "440", cantidad: 3 }]);

// ----------------------------------------------------------------------------------------------------------
// 863 · Primera comunión - Verde - Arena - Café
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 miden ~110 px (28 cm): 3,9 px/cm; un piso cada ~115–130 px (30–33 cm). De abajo arriba: 3
 * café (dos de frente y uno detrás a la derecha), 3 arena (uno al frente y dos a los lados), 2 Metal Verde lado a lado y 3
 * Satín Perla impresos en dorado «Mi Primera Comunión» (uno al frente y dos a los lados).
 */
const P_COMUNION_PERLA = P("GLOBO REDONDO MI PRIMERA COMUNIÓN", "/products/globo-para-fiesta-latex-redondo-2-caras-mi-primera-comunion-satin-perla", "R-12", null);
const P_METAL_VERDE = P("GLOBO REDONDO METAL VERDE", "/products/globo-para-fiesta-latex-redondo-metal-verde", "R-12", "530");
const P_ARENA = P("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071");
const P_CAFE = P("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074");
function escena863(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#c9a24a"));
  ramo(m, [
    piso(120, 19, [295, 55, 125], { tipo: "globo", g: R("R-12", 28, "074"), que: "R-12 Fashion Café" }),
    piso(152, 26, [0, 110, 250], { tipo: "globo", g: R("R-12", 28, "071"), que: "R-12 Fashion Arena" }),
    piso(181, 17, DOS, { tipo: "globo", g: R("R-12", 28, "530"), que: "R-12 Metal Verde" }),
    piso(211, 25, [0, 110, 250], { tipo: "globo", g: R("R-12", 28, "406"), que: "R-12 Mi Primera Comunión (Satín Perla)" }),
  ], { amarre: AMARRE, cinta: ["#e8c74a", "#e86a8c", "#e8e8ec"] });
  return m.escena(SALA_RAMO());
}

const idea863 = idea("primera-comunion-verde-arena-cafe", "Ramo Primera Comunión Verde, Arena y Café", escena863,
  "Igual: 11 R-12 de helio contados en 4 pisos, de abajo arriba 3 Fashion Café (dos de frente y uno que asoma detrás a la derecha), 3 Fashion Arena (uno al frente y dos a los lados), 2 Metal Verde lado a lado y arriba 3 «Mi Primera Comunión» Satín Perla con su impreso dorado (uno al frente y dos a los lados), con los productos que publica la idea y cintas de colores al peso. Distinto: el «Mi Primera Comunión» dorado (niña, cáliz y letras) de la tienda no está en el catálogo de impresos del taller: va su producto con su cantidad y el globo liso en su fondo, Satín Perla 406. En la foto el Metal Verde mide más azulado (#5d9f76) y el café más claro (#9a6a33, Moca) que los publicados, que son los que van. El peso no sale en la foto.",
  [P_COMUNION_PERLA, P_METAL_VERDE, P_ARENA, P_CAFE],
  [{ publicado: P_COMUNION_PERLA, formato: "R-12", codigo: "406", cantidad: 3 }]);

// ----------------------------------------------------------------------------------------------------------
// 884 · Regalo con corazones (centro de mesa)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 miden ~117 px (28 cm): 4,2 px/cm, con la mesa en y = 550 px y el eje en x = 370 px. Caja de
 * regalo dorada de 20 cm con moño rojo y papel picado blanco; tres R-12 de helio: «Te Amo» (111 cm sobre la mesa, a la
 * izquierda), Reflex Dorado (98, detrás a la derecha) y el de corazones dorados (77, al frente); dos corazones metalizados
 * plateados de ~17 cm (7") en varillas a los lados (34 cm).
 */
const P_TE_AMO = P("GLOBO REDONDO TE AMO BRILLANTE", "/products/globo-para-fiesta-latex-redondo-2-caras-te-amo-brillante-reflex-surtido", "R-12", null);
const P_DORADO = P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970");
const P_CORAZONES_PLATA = P("GLOBO METALIZADO CORAZONES PLATA", "/products/globo-metalizado-corazones-plata", null, null);
function escena884(): Escena {
  const T = MESA_ALTO;
  const m = montaje({ id: "regalo", nombre: "Caja de regalo dorada con moño y cintas", origen: v(0, T, 0) });
  m.escenografia(
    caja(v(0, T + 10, 0), v(20, 20, 20), "#d6b04c", "foil"),
    caja(v(0, T + 10, 0), v(3, 20.2, 20.2), "#c8141f", "satinado"),
    caja(v(0, T + 10, 0), v(20.2, 20.2, 3), "#c8141f", "satinado"),
    ...bola(v(0, T + 12, 10.8), 5.5, "#d0141f", "satinado", 6, 0.7),
    ...bola(v(0, T + 20.5, 0), 8, "#f6f6f4", "papel", 5, 0.45),
  );
  const amarre = v(0, T + 21, 0);
  const globos: Array<[string, string, ParteGlobo, Vec3]> = [
    ["te-amo", "R-12 Te Amo Brillante (cara «Te Amo»)", R("R-12", 28, "015"), v(-13, T + 111, -2)],
    ["dorado", "R-12 Reflex Dorado", R("R-12", 28, "970"), v(14, T + 98, -9)],
    ["corazones", "R-12 Te Amo Brillante (cara de corazones)", R("R-12", 28, "015"), v(-1, T + 77, 5)],
  ];
  for (const [id, nombre, g, centro] of globos) {
    const d = unitario(mas(por(unitario(menos(centro, amarre)), 0.4), ARRIBA));
    m.globo(id, nombre, g, centro, d);
    m.cinta(amarre, nudoDe(g.infladoCm, centro, d), "#e7569d");
  }
  const corazon = metalizadoDeTienda("corazones-plata", { pulgadas: 7 });
  const alto = altoMetal(corazon);
  for (const [lado, x, centro] of [["izquierda", -15, 34], ["derecha", 17, 37]] as const) {
    m.raiz(metalizadoSuelto(`corazon-${lado}`, `Corazón metalizado plata (${lado})`, { ...corazon, cinta: { largoCm: r2(centro - alto / 2 - 20), hex: "#f2f2f2" } }, v(x, T + 20, 2)));
  }
  m.raiz(mesa());
  return m.escena(sala(320, 300, 280));
}

const idea884 = idea("regalo-con-corazones", "Regalo con corazones: caja dorada con globos Te Amo", escena884,
  "Igual: sobre una mesa, la caja de regalo dorada de 20 cm con su moño rojo y papel picado blanco, tres R-12 de helio a la altura de la foto con cintas rosadas (el «Te Amo» arriba a la izquierda, el Reflex Dorado detrás a la derecha y el de corazones al frente) y dos corazones metalizados plateados a los lados de la caja; con los productos que publica la idea. Los dos rojos son el mismo «Te Amo Brillante» (2 caras: «Te Amo» por una cara y corazones por la otra), cada uno mostrando una cara. Distinto: ese impreso de la tienda no está en el catálogo del taller: va su producto con su cantidad y el globo liso en su fondo; en la foto el rojo mide Fashion Rojo 015 (#ef2330), así que ese es el fondo. Los corazones de la foto miden ~17 cm (7\"): el producto de la tienda (paquete de 4) se lista por los 2 que se usan. Los corazones van en su cinta; en la foto, en varillas.",
  [P_TE_AMO, P_DORADO, P_CORAZONES_PLATA],
  [{ publicado: P_TE_AMO, formato: "R-12", codigo: "015", cantidad: 2 }]);

// ----------------------------------------------------------------------------------------------------------
// 953 · Turquesa - Azul Naval - Verde Lima
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000×1000; los R-12 miden ~180 px (28 cm): 6,4 px/cm; un piso cada ~190–200 px (30 cm). De abajo arriba: 3
 * Reflex Verde Lima (uno al frente y dos a los lados), 2 Azul Naval lado a lado, 3 Azul Caribe (uno al frente y dos a los
 * lados) y 3 Graffiti Cielo (dos de frente y uno detrás, más alto).
 */
const P_GRAFFITI_CIELO = P("GLOBO REDONDO INFINITY® GRAFFITI CIELO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-cielo-fashion-transparente", "R-12", null);
const P_CARIBE = P("GLOBO REDONDO FASHION AZUL CARIBE", "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", "R-12", "038");
const P_NAVAL = P("GLOBO REDONDO FASHION AZUL NAVAL", "/products/globo-para-fiesta-latex-redondo-fashion-azul-naval", "R-12", "044");
function escena953(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#c9a24a"));
  ramo(m, [
    piso(120, 20, [0, 115, 245], { tipo: "globo", g: R("R-12", 28, "931"), que: "R-12 Reflex Verde Lima" }),
    piso(151, 17, DOS, { tipo: "globo", g: R("R-12", 28, "044"), que: "R-12 Fashion Azul Naval" }),
    piso(181, 21.5, [0, 115, 245], { tipo: "globo", g: R("R-12", 28, "038"), que: "R-12 Fashion Azul Caribe" }),
    piso(211, 16.5, tres(60), { tipo: "globo", g: R("R-12", 28, "390"), que: "R-12 Infinity® Graffiti Cielo", impresoId: "infinity-graffiti-cielo-fashion-transparente" }, 12),
  ], { amarre: AMARRE, cinta: "#c9a24a" });
  return m.escena(SALA_RAMO());
}

const idea953 = idea("turquesa-azul-naval-verde-lima", "Ramo Turquesa, Azul Naval y Verde Lima con Graffiti Cielo", escena953,
  "Igual: 11 R-12 de helio contados en 4 pisos, de abajo arriba 3 Reflex Verde Lima (uno al frente y dos a los lados), 2 Fashion Azul Naval lado a lado, 3 Fashion Azul Caribe (uno al frente y dos a los lados) y arriba 3 Infinity® Graffiti Cielo (dos de frente y uno detrás), con los cuatro productos que publica la idea; el Graffiti Cielo es el impreso exacto de la tienda (remolinos celestes y blancos sobre cristal) y cintas doradas al peso. Distinto: el «turquesa» de la foto mide más verdoso y oscuro (#008a97) que el Azul Caribe 038 publicado, que es el que va; el dibujo del graffiti es el del taller (aproximado). El peso no sale en la foto.",
  [P_GRAFFITI_CIELO, P_CARIBE, P_NAVAL, P_VERDE_LIMA]);

// ----------------------------------------------------------------------------------------------------------
// 5 · Algas marinas
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; los R-12 miden ~110 px (28 cm): 3,9 px/cm, con el piso en y = 545 px y el eje en x = 380 px. Base: un
 * R-12 Reflex Verde Lima medio hundido (26 cm). De ella salen 5 T-260 curvos, cada uno con dos R-5 Reflex Verde Lima en la
 * punta: el largo de la izquierda (punta a −61, 78 cm), dos casi rectos al centro (−18, 76 y +8, 72), uno corto (+3, 51) y
 * el largo de la derecha (+54, 94). Arriba, dos R-12 de helio amarrados a la base (centros a 94 y 120 cm).
 */
const P_TUBITO_SATIN_VL = P("GLOBO TUBITO SATIN VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-satin-verde-lima", "T-260", null);
const tubitoCurvo = (codigo: string, largoCm: number, anguloGrados: number, giroGrados: number): Decoracion => ({
  tipo: "figura",
  propiedades: {
    postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, queEs: "a curved twisted-balloon stem",
    accesorios: [{ en: "base", forma: { tipo: "cola", estilo: "curva", tubito: { formatoId: "T-260", grosorCm: 4.2, codigo }, largoCm, anguloGrados, giroGrados } }],
  },
});
function escena5(): Escena {
  const m = montaje({ id: "peso", nombre: "Peso y cintas", origen: v(0, 0, 0) });
  m.escenografia(PESO("#5f8f4e"));
  // Acostada (el nudo hacia atrás): así la base es la cúpula baja de la foto, de 26 cm de alto.
  m.globo("base", "R-12 Reflex Verde Lima de la base", R("R-12", 26, "931"), v(0, 13.5, 0), AL_FRENTE);
  const VL = R("R-5", 10.5, "931");
  const origen = v(0, 20, 0);
  // Cada tubito: color, largo, ángulo de salida en el plano de frente (0° = a la derecha de quien mira, 90° = arriba) y
  // cuánto se dobla en cada tramo (+: hacia la izquierda de quien mira). Largo y salida, ajustados para que la punta caiga
  // donde la foto (desde el arranque, a 20 cm: −61, +56 · −18, +54 · +3, +29 · +8, +50 · +54, +72).
  const tallos: Array<[string, string, number, number, number]> = [
    ["izquierda", "931", 83, 124, 18],
    ["centro-izquierda", "031", 55, 111, -3],
    ["centro", "031", 28, 84, 0],
    ["centro-derecha", "931", 49, 79, 3],
    ["derecha", "931", 89, 63, -14],
  ];
  for (const [lado, codigo, L, salida, doblez] of tallos) {
    // La figura mide sus ángulos desde SU derecha, que de frente queda a la izquierda de quien mira: van al revés.
    const deco = tubitoCurvo(codigo, L, 180 - salida, -doblez);
    m.pieza(`tubito-${lado}`, `T-260 ${color(codigo)} curvo (${lado})`, { tipo: "decoracion", decoracion: deco }, origen, AL_FRENTE, 0);
    // La punta del tubito en el mundo (la pieza va con su +y al frente: x local → +x, z local → arriba).
    const tubos = armarPieza({ tipo: "decoracion", decoracion: deco }).tubos[0]!.puntos;
    const aMundo = (p: Vec3) => mas(origen, v(p.x, p.z, p.y));
    const punta = aMundo(tubos[tubos.length - 1]!), antes = aMundo(tubos[tubos.length - 2]!);
    const t = unitario(menos(punta, antes));
    const lateral = unitario(cruz(t, AL_FRENTE));
    [1, -1].forEach((s, j) => {
      const d = unitario(mas(t, por(lateral, 0.7 * s)));
      m.globo(`punta-${lado}-${j + 1}`, `R-5 Reflex Verde Lima en la punta (${lado}, ${j + 1})`, VL, mas(punta, por(d, 6)), d);
    });
  }
  const amarre = v(0, 24, 0);
  for (const [id, centro] of [["helio-abajo", v(-4, 94, 2)], ["helio-arriba", v(1, 120, -3)]] as const) {
    const g = R("R-12", 28, "931");
    m.globo(id, `R-12 Reflex Verde Lima de helio (${id === "helio-abajo" ? "abajo" : "arriba"})`, g, centro, ARRIBA);
    m.cinta(amarre, nudoDe(g.infladoCm, centro, ARRIBA), "#d9d9de");
  }
  return m.escena(sala(320, 280, 260));
}

const idea5 = idea("algas-marinas", "Algas marinas de tubitos con burbujas", escena5,
  "Igual: la figura de la foto de 1,35 m: un R-12 Reflex Verde Lima de base, 5 T-260 que salen de ella curvándose (los dos largos de los lados, dos casi rectos al centro y uno corto) con dos R-5 Reflex Verde Lima en la punta de cada uno, y arriba dos R-12 Reflex Verde Lima de helio amarrados a la base; con los productos que publica la idea. Tres tubitos son el Reflex Verde Lima publicado y los dos claros del centro el Satín Verde Lima publicado. Distinto: el Satín Verde Lima no está en la tabla oficial de color: el 3D lo pinta Fashion Verde Lima 031 y el producto se lista con ese color. En la foto los tubitos se ven verde vivo (#2dcc2a y #02c178), más que los publicados. La base de la foto está medio desinflada; aquí es un R-12 a 26 cm. Las puntas de las R-5 van de a dos, como se ven.",
  [P_VERDE_LIMA, P_TUBITO_VL, P_TUBITO_SATIN_VL],
  [{ publicado: P_TUBITO_SATIN_VL, formato: "T-260", codigo: "031", cantidad: "todos" }]);

// ----------------------------------------------------------------------------------------------------------
// 31 · Araña (patas en rizo)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el cuerpo R-12 mide ~145 px (26 cm): 5,6 px/cm. Cuerpo negro arriba, dos ojos blancos con pupila
 * (R-5 de 9 cm) debajo, una boquita negra y 8 patas de T-260 negro que salen a los lados en rizos, de 45 a 65 cm de
 * alcance. Colgada de su hilo, con el cuerpo a 1,5 m.
 */
function escena31(): Escena {
  const C = v(0, 150, 0);
  const m = montaje({ id: "hilo", nombre: "Hilo de la araña", origen: v(0, 0, 0) });
  m.escenografia(tubo(v(0, 163, -2), v(0, 300, -2), 0.12, "#e8e8e8"));
  m.globo("cuerpo", "R-12 Fashion Negro del cuerpo", R("R-12", 26, "080"), C, unitario(v(0.12, 1, 0)));
  const ojo = (miradaGrados: number): Decoracion => ({ tipo: "ojo", propiedades: { globo: R("R-5", 9, "005"), estilo: { iris: null, pupila: { hex: "#111111", proporcion: 0.36 }, brillo: true, venas: null }, miradaGrados } });
  m.pieza("ojo-izquierdo", "Ojo R-5 Fashion Blanco (izquierdo)", { tipo: "decoracion", decoracion: ojo(0) }, v(-4.6, 128, 5), AL_FRENTE);
  m.pieza("ojo-derecho", "Ojo R-5 Fashion Blanco (derecho)", { tipo: "decoracion", decoracion: ojo(180) }, v(4.6, 129, 5), AL_FRENTE);
  m.globo("boca", "R-5 Fashion Negro de la boca", R("R-5", 6, "080"), v(0, 121.5, 4), unitario(v(0, -1, 0.4)));
  // 8 patas: cuatro a cada lado, de la unión del cuerpo y la cabeza, en rizo (un resorte que avanza hacia fuera), cada
  // una su pieza. Su salida en el plano de frente (0° = a la derecha de quien mira; el resorte la tuerce ~18° al revés
  // de las agujas del reloj, ya descontado); la figura mide desde SU derecha.
  const arranque = v(0, 134, 0);
  [33, 18, -2, -22, 183, 198, 218, 238].forEach((salida, k) => {
    const pata: Decoracion = {
      tipo: "figura",
      propiedades: {
        postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, queEs: "a curly twisted-balloon spider leg",
        accesorios: [{ en: "base", forma: { tipo: "cola", estilo: "rizo", tubito: { formatoId: "T-260", grosorCm: 3.6, codigo: "080" }, largoCm: 42, anguloGrados: 180 - salida } }],
      },
    };
    // El tubo arranca un poco por encima del origen de la figura: se corre para que arranque justo en la unión.
    const inicio = armarPieza({ tipo: "decoracion", decoracion: pata }).tubos[0]!.puntos[0]!;
    const lado = k < 4 ? "derecha" : "izquierda";
    m.pieza(`pata-${k + 1}`, `Pata ${(k % 4) + 1} de T-260 Fashion Negro en rizo (${lado})`, { tipo: "decoracion", decoracion: pata }, menos(arranque, v(inicio.x, inicio.z, inicio.y)), AL_FRENTE);
  });
  return m.escena(sala(320, 280, 300));
}

const idea31 = idea("arana", "Araña de patas en rizo", escena31,
  "Igual: la araña de la foto colgada de su hilo: cuerpo R-12 Fashion Negro (26 cm), dos ojos R-5 Fashion Blanco con pupila negra debajo, una boquita R-5 negra y 8 patas de T-260 Fashion Negro (cuatro a cada lado) que salen en rizo, con bucles de ~13 cm, como en la foto. Colores medidos (la idea no publica productos): negro 080 y blanco 005. Distinto: en la foto cada pata hace sus bucles a su manera (unos sueltos, otros cerrados); en el 3D todas son el mismo resorte, abierto hacia su lado, y alcanzan ~40 cm desde la unión (en la foto, 45 a 65 cm: un T-260 por pata no da para más bucles tan grandes). La foto no dice cómo se cuelga: aquí va de un hilo, con el cuerpo a 1,5 m.");

/** Ideas de fiesta de sempertex.com digitalizadas: lote 14. */
export const LOTE_14: readonly IdeaDigitalizada[] = [idea29, idea68, idea131, idea203, idea206, idea211, idea231, idea307, idea821, idea859, idea863, idea884, idea953, idea5, idea31];
