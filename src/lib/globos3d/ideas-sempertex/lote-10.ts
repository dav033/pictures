import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { impresoPorId, impresoPorUrl } from "../impresos-catalogo";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import { tapete, type ElementoEscenografia } from "../escenografia";
import { platos, vasos, velas } from "../utileria";
import { metalizadoDeTienda } from "../metalizados";
import type { ColorOrganico, OpcionesOrganico, PuntoMezcla, RellenoOrganico } from "../organico";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion } from "../figuras";
import type { PropiedadesFigura } from "../figuras-tubito";
import type { Vec3 } from "../modulos";
import { centroCuerpo } from "../geometria";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 10** (los números de `clasif/lote-10.json`: cuatro escenas
 * completas —#836 Peppa Pig, #260 Celebra con mamá, #319 Christmas y #333 Colorful Vibes— y seis estructuras: la
 * guirnalda Trufa y Champaña, el semiarco de color destacado, el arco «Techo», el aro orgánico Merlot-Coral-Arena,
 * el árbol de Halloween y el centro de mesa Feliz Día Mami).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, ampliada con rejilla y medida:
 * - **Escala**: la de un globo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-9 ≈ 22 cm, R-12 ≈ 28 cm, R-18 ≈ 42
 *   cm, R-24 ≈ 55 cm; un globo de helio, a 28–30 cm) o de un mueble (mesa de 75 cm). Cada idea dice su escala; con
 *   ella salen alturas, anchos, radios y largos. Las coordenadas de la foto pasan al mundo con una función `px` por idea.
 * - **Conteo**: lo que se ve, contando lo que asoma por detrás. En los orgánicos el motor da los globos para el grosor y
 *   el largo medidos (no se cuentan uno a uno: la nota lo dice); los racimos de «uvas», los globos de helio, los de la
 *   malla, las mariposas y las flores sí se cuentan uno a uno. Ninguna idea publica «Materiales» con cantidades: todo
 *   lo contado va con `contada: true`.
 * - **Colores**: si la idea publica productos, ESOS códigos. Si no, medidos en la foto (Python/PIL: mediana de un parche
 *   sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla oficial; en las fotos con dominante de color, primero se
 *   equilibra el blanco con algo blanco de la misma foto) y el código más cercano que se fabrica en ese formato.
 * - **Impresos y metalizados**: los del catálogo (`impresos-catalogo.ts`, `metalizados.ts`) cuando la foto los tiene y
 *   el catálogo los trae; si no, el liso de su color (la nota lo dice).
 * - **Montaje** (para que la biblioteca saque «esta estructura sola con sus decoraciones» y «esta decoración sola»):
 *   cada estructura es su propio árbol. Su raíz es la propia estructura o, cuando la estructura va por tramos de color
 *   (el motor orgánico pinta un tramo con una sola paleta), su **armazón** (el tubo de PVC o el marco que la sostiene,
 *   escondido entre los globos): de él cuelgan (`sobre`) sus tramos, y de cada tramo, sus decoraciones. El armazón no
 *   tiene globos, así que lo que cuelga de él queda exactamente donde se pide (`colgar`); los tramos llevan `suelo` (su
 *   cara de atrás contra la pared o el piso, como se arma de verdad). Lo que se apoya en los globos de una estructura
 *   (uvas, ojos, fantasmas, mariposas) va `sobre` ella y el motor lo asienta en su superficie (`apoyar`). Las mesas, la
 *   utilería y la escenografía van aparte, sueltas.
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

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos: Partial<Sala["tonos"]> = {}): Sala => {
  const s = structuredClone(SALA_INICIAL);
  return { ...s, anchoCm, fondoCm, altoCm, tonos: { ...s.tonos, ...tonos } };
};

// ----------------------------------------------------------------------------------------------------------
// Montaje: marcos, `colgar` (exacto, de una pieza sin globos) y `apoyar` (sobre los globos de una estructura)
// ----------------------------------------------------------------------------------------------------------

/** Matriz 3 × 3 por filas: de un espacio local al mundo (giro, o giro con espejo: el marco de `sobre` lo es). */
type M3 = readonly [number, number, number, number, number, number, number, number, number];
/** Un espacio local: v ↦ m·v + t. */
type Marco = { m: M3; t: Vec3 };

const IDENTIDAD: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const aplicar = (m: M3, a: Vec3): Vec3 => v(m[0] * a.x + m[1] * a.y + m[2] * a.z, m[3] * a.x + m[4] * a.y + m[5] * a.z, m[6] * a.x + m[7] * a.y + m[8] * a.z);
const trasladar = (m: M3, a: Vec3): Vec3 => v(m[0] * a.x + m[3] * a.y + m[6] * a.z, m[1] * a.x + m[4] * a.y + m[7] * a.z, m[2] * a.x + m[5] * a.y + m[8] * a.z);
const aLocal = (k: Marco, p: Vec3): Vec3 => trasladar(k.m, menos(p, k.t));

/**
 * El giro de una pieza `sobre` (el mismo que `marcoDeAncla` de la escena): y local = la normal, x local horizontal (o
 * a lo largo de x si la normal es vertical) y `giroGrados` sobre la normal. Con la normal hacia arriba y −90° queda el
 * mundo con x al revés; con la normal al frente y 0°, (x, y, z) local va a (x, z, y) del mundo.
 */
function giroSobre(normal: Vec3, giroGrados: number): M3 {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  const c = Math.cos(rad(giroGrados)), s = Math.sin(rad(giroGrados));
  // marco (columnas xL, n, zL) · giro sobre y local [c 0 −s; 0 1 0; s 0 c].
  const f = (a: number, b: number, d: number): [number, number, number] => [a * c + d * s, b, -a * s + d * c];
  const [m0, m1, m2] = f(xL.x, n.x, zL.x), [m3, m4, m5] = f(xL.y, n.y, zL.y), [m6, m7, m8] = f(xL.z, n.z, zL.z);
  const r = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
  return [r(m0), r(m1), r(m2), r(m3), r(m4), r(m5), r(m6), r(m7), r(m8)];
}

/** Lo que una pieza armada baja de su origen a lo largo de su y local (−min.y de su caja). */
const bajoDe = (pieza: Pieza): number => -armarPieza(pieza).caja.min.y;

type Padre = { id: string; marco: Marco };

/** Una pieza suelta (raíz), con su origen en `origen` del mundo y girada `giroGrados` sobre la vertical (0 = de frente). */
function suelta(id: string, nombre: string, pieza: Pieza, origen: Vec3, giroGrados = 0): { nodo: NodoEscena; padre: Padre } {
  const c = Math.cos(rad(giroGrados)), s = Math.sin(rad(giroGrados));
  const m: M3 = giroGrados === 0 ? IDENTIDAD : [c, 0, s, 0, 1, 0, -s, 0, c];
  return { nodo: { id, nombre, pieza, colocacion: { en: "libre", xCm: r2(origen.x), yCm: r2(origen.y), zCm: r2(origen.z), giroGrados } }, padre: { id, marco: { m, t: origen } } };
}

/**
 * Una pieza `sobre` una pieza **sin globos** (un armazón, una cinta): la escena la corre a lo largo de la normal lo que
 * baja su caja (−min.y) y la hunde `HUNDIMIENTO_SOBRE_CM`; aquí se descuenta, así que su origen queda en `origen`
 * (mundo), su y local hacia `normal` y girada `giroGrados`. `bajo`: lo que baja su caja (si no se da, se arma; los
 * orgánicos con `suelo` bajan ~0 y se les da 0: quedan a ±2 cm de su plano).
 */
function colgar(o: { id: string; nombre: string; pieza: Pieza; padre: Padre; origen: Vec3; normal: Vec3; giroGrados?: number; bajo?: number }): { nodo: NodoEscena; padre: Padre } {
  const n = unitario(o.normal);
  const giro = o.giroGrados ?? 0;
  const bajo = o.bajo ?? bajoDe(o.pieza);
  const punto = menos(o.origen, por(n, bajo - HUNDIMIENTO_SOBRE_CM));
  return {
    nodo: { id: o.id, nombre: o.nombre, pieza: o.pieza, colocacion: { en: "sobre", padreId: o.padre.id, puntoCm: redondo(aLocal(o.padre.marco, punto)), normal: redondo(trasladar(o.padre.marco.m, n)), giroGrados: giro } },
    padre: { id: o.id, marco: { m: giroSobre(n, giro), t: o.origen } },
  };
}

/**
 * Una pieza `sobre` los globos de una estructura: se da un punto (mundo) dentro de ella o en su cara y hacia dónde
 * mira; la escena la corre a lo largo de la normal hasta que su espalda toca los globos (la uva sobre la guirnalda, el
 * fantasma sobre el tronco). El marco del padre puede ser aproximado (±2 cm en un orgánico): el punto viaja con él.
 */
function apoyar(id: string, nombre: string, pieza: Pieza, padre: Padre, punto: Vec3, normal: Vec3, giroGrados = 0): NodoEscena {
  return { id, nombre, pieza, colocacion: { en: "sobre", padreId: padre.id, puntoCm: redondo(aLocal(padre.marco, punto)), normal: redondo(trasladar(padre.marco.m, unitario(normal))), giroGrados } };
}

// ----------------------------------------------------------------------------------------------------------
// Orgánicos por tramos de color
// ----------------------------------------------------------------------------------------------------------

/** Inflados de cada tramo (cm por formato): los medidos en la foto de cada idea. */
type Inflados = Readonly<Record<string, number>>;

/**
 * Un tramo orgánico de un color (o una paleta) sobre un recorrido del **mundo**, puesto `sobre` el armazón con su cara
 * de atrás contra un plano: la pared (`normal` al frente) o el piso (`normal` arriba). El motor (`suelo`) no deja que
 * ningún globo cruce ese plano, que es el y = 0 local del tramo; `origen` es un punto del plano (a 2 cm, para que el
 * ±2 cm del motor no lo meta en la pared). El recorrido se pasa al espacio local del tramo.
 */
function tramo(o: {
  id: string; nombre: string; padre: Padre; plano: "pared" | "piso"; origen: Vec3;
  racimos: ReadonlyArray<Omit<RacimoLibre, "puntos"> & { puntos: Vec3[] }>;
  colores: ColorOrganico[]; inflados: Inflados; semilla: number; relleno?: RellenoOrganico[]; variacion?: number;
}): { nodo: NodoEscena; padre: Padre } {
  const normal = o.plano === "pared" ? AL_FRENTE : ARRIBA;
  const giro = o.plano === "pared" ? 0 : -90;
  const marco: Marco = { m: giroSobre(normal, giro), t: o.origen };
  // Contra la pared, el eje va a 0,85 radios de ella (los globos de atrás se aplastan contra el plano): así el tramo
  // toca la pared y la escena lo deja donde se pide. En el piso, el recorrido se da completo y su punta baja lo toca.
  const racimos: RacimoLibre[] = o.racimos.map((r) => ({
    ...r,
    puntos: r.puntos.map((p, i, todos) => {
      const local = aLocal(marco, p);
      if (o.plano === "piso") return redondo(local);
      const radio = r.radioInicioCm + ((r.radioFinCm - r.radioInicioCm) * i) / Math.max(1, todos.length - 1);
      return redondo(v(local.x, radio * 0.85, local.z));
    }),
  }));
  const opciones: OpcionesOrganico = {
    ...opcionesRacimosLibres({ racimos, colores: o.colores, semilla: o.semilla, suelo: true, ...(o.relleno ? { relleno: o.relleno } : {}) }),
    inflados: { ...o.inflados }, variacionInflado: o.variacion ?? 0.07,
  };
  return colgar({ id: o.id, nombre: o.nombre, pieza: { tipo: "organico", opciones, flores: null }, padre: o.padre, origen: o.origen, normal, giroGrados: giro, bajo: 0 });
}

const mezcla = (pesos: Readonly<Record<string, number>>, fin?: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos: fin ?? pesos }];
const color = (codigo: string, peso = 1): ColorOrganico => ({ codigo, peso });
const solo = (formatoId: string, infladoCm: number): RellenoOrganico[] => [{ formatoId, infladoCm, trios: true }];

/** Un tubo de PVC (escenografía: no cotiza) que sigue unos puntos del mundo, en el espacio de la pieza con origen `o`. */
function tuboPvc(puntos: readonly Vec3[], o: Vec3, radioCm = 1.6, hex = "#dcdcd6"): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  for (let i = 0; i + 1 < puntos.length; i++) salida.push(cinta(menos(puntos[i]!, o), menos(puntos[i + 1]!, o), hex, radioCm, "mate"));
  return salida;
}

/** Un cilindro de `desde` a `hasta` (cinta, varilla, tubo), en el espacio de la pieza que lo lleva. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2, acabado: "satinado" | "mate" | "metal" = "satinado"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

/**
 * Las cintas de un ramo de helio, de `amarre` (mundo) a cada nudo: una escenografía `sobre` lo que sujeta el ramo (el
 * racimo de piso, el peso). Sobre un padre con globos, la escena la asienta en lo alto de ellos: el amarre real queda a
 * unos cm del pedido y lo que cuelga de las cintas (los globos) viaja con él.
 */
function cintasDesde(padre: Padre, id: string, nombre: string, amarre: Vec3, nudos: readonly Vec3[], hex: string): { nodo: NodoEscena; padre: Padre } {
  const m = giroSobre(ARRIBA, -90);
  const elementos = nudos.map((n) => cinta(v(0, 0, 0), trasladar(m, menos(n, amarre)), hex, 0.15));
  return colgar({ id, nombre, pieza: { tipo: "escenografia", elementos }, padre, origen: amarre, normal: ARRIBA, giroGrados: -90 });
}

/**
 * Un cordón de cuartetos chicos (la guirnalda de R-5 que cruza un tramo orgánico) por unos puntos del mundo (x, y) a la
 * profundidad `z`, colgado de un armazón: su plano queda de frente (normal arriba y −90°: el marco es el mundo con x al
 * revés, así que el recorrido se da con x al revés).
 */
function cordon(id: string, nombre: string, padre: Padre, g: ParteGlobo, puntos: readonly Vec3[], z: number): NodoEscena {
  const o = v(puntos[0]!.x, puntos[0]!.y, z);
  const pieza: Pieza = { tipo: "guirnalda", guirnalda: { formatoId: g.formatoId, infladoCm: g.infladoCm, patron: "un_color", colores: [g.codigo], anchoCm: 0, caidaCm: 0, recorrido: puntos.map((p) => ({ x: r2(-(p.x - o.x)), y: r2(p.y - o.y) })) } };
  return colgar({ id, nombre, pieza, padre, origen: o, normal: ARRIBA, giroGrados: -90 }).nodo;
}

// ----------------------------------------------------------------------------------------------------------
// Decoraciones
// ----------------------------------------------------------------------------------------------------------

const figura = (p: Partial<PropiedadesFigura> & Pick<PropiedadesFigura, "queEs">): Decoracion => ({
  tipo: "figura", propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, accesorios: [], ...p },
});
/** Un racimo de «uvas»: una bola de `cantidad` globitos iguales (R-5 casi sin inflar). */
const uvas = (g: ParteGlobo, cantidad: number): Pieza => ({ tipo: "decoracion", decoracion: figura({ cuerpo: [{ tipo: "racimo", globo: g, cantidad }], queEs: "a small cluster of tiny balloons like grapes" }) });
/** Tres globitos amarrados juntos (el trío de la técnica orgánica). */
const trio = (g: ParteGlobo, giroGrados = 0): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "flor", propiedades: { petalos: { ...g, cantidad: 3, aperturaGrados: 35, giroGrados }, centro: null } } });
const globo = (g: ParteGlobo, impresoId?: string): Pieza => ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) });

/** El giro sobre la normal que deja la cara (+z local) de la pieza lo más hacia quien mira (+z): lo impreso al frente. */
function giroAlFrente(normal: Vec3): number {
  const n = unitario(normal);
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n));
  const zL = cruz(n, xL);
  return Math.round((Math.atan2(-xL.z, zL.z) * 180) / Math.PI);
}

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

/** Un producto que la idea publica (nombre y url tal cual, con el formato y el código de la foto). */
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
 * y color de fondo, cada metalizado y los lisos (lo que queda de cada formato y código). Lo que la idea publica sale con
 * su nombre y url tal cual (si la foto no lo tiene, sin cantidad); lo demás, con el producto liso de la tienda.
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

const CDN = "https://sempertex.com/cdn/shop/articles/";

type Base = Omit<IdeaDigitalizada, "id" | "productos" | "contenido" | "clase"> & { escena: () => Escena; publicados?: Publicado[] };

/**
 * La idea perezosa (`ideaPerezosa`): su id «idea:<slug>»; su escena se arma la primera vez que se pide y sus productos
 * salen de armar esa escena (lo contado en la foto; los orgánicos tardan unas décimas). Importar el lote no arma nada.
 */
function idea(b: Base): IdeaDigitalizada {
  const { escena, publicados, ...resto } = b;
  return ideaPerezosa({ id: `idea:${b.slug}`, ...resto, clase: "escena" }, () => ({ tipo: "escena", escena: escena() }), (c) => (c.tipo === "escena" ? productosDe(c.escena, publicados) : []));
}

// Productos que publican varias ideas (nombre y url tal cual de la tienda).
const P_CHAMPANA = pub("GLOBO REDONDO REFLEX CHAMPAÑA", "/products/globo-para-fiesta-latex-redondo-reflex-champana", "R-12", "971");
const P_TUBITO_DORADO = pub("GLOBO TUBITO REFLEX DORADO", "/products/globo-para-fiesta-latex-tubito-reflex-dorado", "T-260", "970");
const P_DUSK_CREMA = pub("GLOBO LATEX REDONDO PASTEL DUSK CREMA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-crema", "R-12", "107");
const P_MERLOT = pub("GLOBO REDONDO FASHION MERLOT", "/products/globo-latex-redondo-fashion-merlot", "R-12", "018");
const P_FUCSIA = pub("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012");

// ==========================================================================================================
// 796 · Ocasiones especiales Trufa y Champaña (guirnalda orgánica diagonal, racimo de piso y ramo de helio)
// ==========================================================================================================

/**
 * Foto de 1080 × 1080: los R-12 del ramo de helio miden ~130 px (30 cm: 4,4 px/cm); el piso de la pared en y ≈ 935 px.
 * La guirnalda sube en diagonal de la esquina de abajo a la izquierda (sobre el piso, al pie de la pared) hasta ~2,1 m
 * arriba a la derecha (~2,4 m de largo, ~65 cm de grueso): Reflex Champaña abajo a la izquierda (con un R-18 de ~36 cm)
 * y arriba a la izquierda, Fashion Chocolate en la diagonal del medio y arriba a la derecha (R-12 a ~20 cm y R-5 a
 * ~10 cm), y encima 13 racimos de «uvas» (R-5 casi sin inflar, ~5 cm): 7 champaña y 6 chocolate. A la derecha, un
 * racimo de piso de ~22 R-5 chocolate (40 cm de alto) del que sale un ramo de 3 R-12 champaña con helio, con rizos de
 * T-260 Reflex Dorado y tres triítos chocolate en las cintas. Tapete negro de ~2,3 × 1,1 m en el piso.
 */
const px796 = (x: number, y: number, z: number): Vec3 => v(r2((x - 540) / 4.4), r2((935 - y) / 4.4), z);
const PARED_796 = -150;
/** Lo que se separan de la pared los tramos (el ±2 cm del motor no los mete en ella). */
const SEPARA = 2;
const INFLADOS_796: Inflados = { "R-18": 36, "R-12": 21, "R-5": 10 };
const UVA_CHAMPANA = R("R-5", 5.5, "971"), UVA_CHOCOLATE = R("R-5", 5.5, "076");
const escena796 = (): Escena => {
  const zEje = PARED_796 + 30;
  // El armazón: un tubo de PVC por el eje de la guirnalda (escondido entre los globos); su origen, al pie.
  const eje = [px796(40, 900, zEje + 25), px796(220, 700, zEje + 6), px796(480, 560, zEje), px796(700, 420, zEje), px796(800, 300, zEje)];
  const O = eje[0]!;
  const armazon = suelta("armazon", "Guirnalda orgánica Trufa y Champaña", { tipo: "escenografia", elementos: tuboPvc(eje, O) }, O);
  const pared = (x: number) => v(x, 0, PARED_796 + SEPARA);
  const champanaBajo = tramo({
    id: "tramo-champana-bajo", nombre: "Guirnalda: tramo champaña de abajo", padre: armazon.padre, plano: "piso", origen: v(px796(170, 0, 0).x, SEPARA, zEje + 20),
    racimos: [{ id: "champana_bajo", nombre: "Champaña de abajo", puntos: [px796(40, 880, zEje + 30), px796(150, 810, zEje + 22), px796(250, 735, zEje + 12), px796(330, 680, zEje + 4)], radioInicioCm: 34, radioFinCm: 26, mezcla: mezcla({ "R-18": 0.3, "R-12": 1 }, { "R-12": 1 }), tapas: { inicio: true, fin: false } }],
    colores: [color("971")], inflados: INFLADOS_796, semilla: 7961, relleno: solo("R-5", 10), variacion: 0.14,
  });
  const chocolate = tramo({
    id: "tramo-chocolate", nombre: "Guirnalda: tramo chocolate", padre: armazon.padre, plano: "pared", origen: pared(0),
    racimos: [{ id: "chocolate", nombre: "Chocolate", puntos: [px796(220, 640, 0), px796(360, 650, 0), px796(500, 655, 0), px796(620, 610, 0), px796(720, 500, 0), px796(770, 400, 0), px796(775, 315, 0)], radioInicioCm: 26, radioFinCm: 30, mezcla: mezcla({ "R-12": 1, "R-5": 0.7 }), tapas: { inicio: true, fin: true } }],
    colores: [color("076")], inflados: INFLADOS_796, semilla: 7962, relleno: solo("R-5", 10), variacion: 0.14,
  });
  const champanaAlto = tramo({
    id: "tramo-champana-alto", nombre: "Guirnalda: tramo champaña de arriba", padre: armazon.padre, plano: "pared", origen: pared(-30),
    racimos: [{ id: "champana_alto", nombre: "Champaña de arriba", puntos: [px796(290, 490, 0), px796(390, 440, 0), px796(500, 425, 0), px796(610, 440, 0)], radioInicioCm: 20, radioFinCm: 26, mezcla: mezcla({ "R-12": 1, "R-18": 0.08 }), tapas: { inicio: true, fin: true } }],
    colores: [color("971")], inflados: { ...INFLADOS_796, "R-18": 30 }, semilla: 7963, relleno: solo("R-5", 10), variacion: 0.16,
  });
  const champanaFrente = tramo({
    id: "tramo-champana-frente", nombre: "Guirnalda: tramo champaña de delante", padre: armazon.padre, plano: "piso", origen: v(px796(440, 0, 0).x, SEPARA, PARED_796 + 60),
    racimos: [{ id: "champana_frente", nombre: "Champaña de delante", puntos: [v(px796(340, 0, 0).x, 20, PARED_796 + 62), v(px796(430, 0, 0).x, 18, PARED_796 + 68), v(px796(520, 0, 0).x, 18, PARED_796 + 62)], radioInicioCm: 22, radioFinCm: 20, mezcla: mezcla({ "R-12": 1 }), tapas: { inicio: true, fin: true } }],
    colores: [color("971")], inflados: INFLADOS_796, semilla: 7964, relleno: solo("R-5", 10), variacion: 0.12,
  });
  // Las uvas: en la cara de cada tramo, donde la foto; se dan cerca de su cara de delante (z) y la escena las asienta.
  const UVAS_CHAMPANA: ReadonlyArray<[number, number, number, number, typeof champanaBajo]> = [
    [60, 790, 12, PARED_796 + 80, champanaBajo], [140, 705, 10, PARED_796 + 72, champanaBajo], [195, 655, 9, PARED_796 + 62, champanaBajo],
    [290, 490, 12, PARED_796 + 34, champanaAlto], [400, 465, 8, PARED_796 + 36, champanaAlto], [505, 420, 12, PARED_796 + 38, champanaAlto], [525, 510, 11, PARED_796 + 38, champanaAlto],
  ];
  const UVAS_CHOCOLATE: ReadonlyArray<[number, number, number]> = [[215, 610, 11], [330, 585, 12], [470, 575, 9], [650, 600, 12], [740, 370, 12], [720, 510, 10]];
  const nodos: NodoEscena[] = [
    armazon.nodo, champanaBajo.nodo, chocolate.nodo, champanaAlto.nodo, champanaFrente.nodo,
    ...UVAS_CHAMPANA.map(([x, y, n, z, t], k) => apoyar(`uvas-champana-${k + 1}`, `Uvas champaña ${k + 1}`, uvas(UVA_CHAMPANA, n), t.padre, px796(x, y, z), AL_FRENTE)),
    ...UVAS_CHOCOLATE.map(([x, y, n], k) => apoyar(`uvas-chocolate-${k + 1}`, `Uvas chocolate ${k + 1}`, uvas(UVA_CHOCOLATE, n), chocolate.padre, px796(x, y, PARED_796 + 45), AL_FRENTE)),
  ];
  // El racimo de piso, del que sale el ramo: sus cintas (escenografía) van sobre él y los globos, de las cintas.
  const piso = px796(885, 935, PARED_796 + 70);
  const racimoPiso = suelta("racimo-piso", "Racimo de piso chocolate con ramo de helio", {
    tipo: "organico", flores: null,
    opciones: { ...opcionesRacimosLibres({ racimos: [{ id: "racimo", nombre: "Racimo", puntos: [v(0, 9, 0), v(0, 20, 0), v(0, 31, 0)], radioInicioCm: 17, radioFinCm: 13, mezcla: mezcla({ "R-5": 1 }), tapas: { inicio: false, fin: true } }], colores: [color("076")], semilla: 7965, suelo: true, relleno: solo("R-5", 9) }), inflados: { "R-5": 11 } },
  }, v(piso.x, SEPARA, piso.z));
  const amarre = v(piso.x, 40, piso.z);
  const BOUQUET: ReadonlyArray<[number, number, number]> = [[905, 375, piso.z - 6], [830, 505, piso.z + 8], [960, 510, piso.z + 4]];
  const centros = BOUQUET.map(([x, y, z]) => px796(x, y, z));
  const CHAMPANA_HELIO = R("R-12", 30, "971");
  const nudos = centros.map((c) => menos(c, por(unitario(menos(c, amarre)), 15.5)));
  const cintas = cintasDesde(racimoPiso.padre, "cintas", "Cintas del ramo", amarre, nudos, "#d9c9a8");
  // `cintas` se apoya en lo alto del racimo: su marco real queda a unos cm de `amarre`; lo demás cuelga de él.
  const enCintas = (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal: Vec3, giro = 0) => colgar({ id, nombre, pieza, padre: cintas.padre, origen, normal, giroGrados: giro }).nodo;
  nodos.push(
    racimoPiso.nodo, cintas.nodo,
    ...centros.map((c, k) => enCintas(`helio-${k + 1}`, `R-12 Reflex Champaña con helio ${k + 1}`, globo(CHAMPANA_HELIO), c, unitario(menos(c, amarre)))),
    ...[[850, 600], [935, 600], [888, 748]].map(([x, y], k) => enCintas(`trio-cinta-${k + 1}`, `Triíto chocolate de la cinta ${k + 1}`, trio(R("R-5", 5.5, "076"), k * 40), px796(x!, y!, piso.z + 2), AL_FRENTE)),
    ...[[870, 590, 30, 4, 7, 4], [935, 600, 26, 3.5, 6, 3.5], [900, 640, 22, 4.5, 8, 4]].map(([x, y, largoCm, vueltas, r0, r1], k) => enCintas(`rizo-${k + 1}`, `Rizo de T-260 Reflex Dorado ${k + 1}`, { tipo: "decoracion", decoracion: { tipo: "rizo", propiedades: { forma: "tirabuzon", tubito: { formatoId: "T-260", grosorCm: 3, codigo: "970" }, vueltas: vueltas!, radioInicialCm: r0!, radioFinalCm: r1!, largoCm: largoCm!, eje: "abajo" } } }, px796(x!, y!, piso.z + 3), AL_FRENTE)),
    { id: "tapete", nombre: "Tapete negro", pieza: { tipo: "escenografia", elementos: tapete({ anchoCm: 232, fondoCm: 110, hex: "#141312" }) }, colocacion: { en: "piso", xCm: 8, zCm: PARED_796 + 60, giroGrados: 0 } },
  );
  return { sala: sala(340, 300, 270, { paredes: "#e8e7e3", piso: "#e3e0da" }), nodos };
};

const idea796 = idea({
  numero: 796, slug: "ocasiones-especiales-trufa-y-champana", nombre: "Guirnalda Trufa y Champaña con ramo de helio", ocasiones: ["general"],
  fotoUrl: `${CDN}Ocasiones_Especiales_Trufa_y_Champana.png`, escena: escena796,
  publicados: [P_CHAMPANA, P_TUBITO_DORADO],
  nota: "Igual: la guirnalda orgánica en diagonal de la foto (~2,4 m, de la esquina del piso a ~2,1 m arriba a la derecha) en sus tramos de color: Reflex Champaña abajo a la izquierda con su R-18, Fashion Chocolate en la diagonal y arriba a la derecha, champaña arriba a la izquierda y un poco por delante; los 13 racimos de «uvas» de R-5 casi sin inflar (7 champaña y 6 chocolate) en la cara; el racimo de piso de R-5 chocolate con el ramo de 3 R-12 champaña de helio, tres rizos de T-260 Reflex Dorado y los tres triítos chocolate de las cintas; tapete negro y pared blanca. Champaña y tubito dorado son los productos publicados; el chocolate (no publicado) se midió: #5c4130 → Fashion Chocolate 076. Distinto: los globos del cuerpo los pone el motor orgánico para el grueso y el largo medidos (no uno a uno); los chocolate grandes de la foto (~20–25 cm) van en R-12 (el Chocolate no se fabrica en R-9 ni R-18); los rizos de la foto son un ovillo de tubito y aquí tres tirabuzones.",
});

// ==========================================================================================================
// 904 · Semiarco color destacado (semiarco orgánico por bloques de color, cada uno con su cordón de R-5)
// ==========================================================================================================

/**
 * Foto de 1000 × 1000 (fondo blanco): los cordones de R-5 tienen globitos de ~29 px (10,5 cm: 2,8 px/cm); el R-24 crema
 * mide ~160 px (57 cm), los R-18 ~110–120 px y los R-12 ~80 px. El semiarco sube en diagonal ~3,6 m de ancho y ~2,6 m
 * de alto, en cinco bloques de color: Reflex Champaña abajo a la izquierda, Pastel Dusk Crema (con el R-24), Silk Perla
 * Crema, Reflex Dorado y Silk Dorado arriba a la derecha; cada bloque lleva encima su cordón de cuartetos de R-5 del
 * mismo color (el de Silk Dorado es un racimo ancho: dos cordones).
 */
const px904 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 500) / 2.8), r2((878 - y) / 2.8), z);
const PARED_904 = -150;
const INFLADOS_904: Inflados = { "R-24": 55, "R-18": 40, "R-12": 28, "R-5": 10.5 };
const escena904 = (): Escena => {
  const ejePx: ReadonlyArray<[number, number]> = [[70, 800], [270, 700], [330, 430], [520, 300], [650, 300], [850, 250]];
  const z = PARED_904 + 25;
  const eje = ejePx.map(([x, y]) => px904(x, y, z));
  const armazon = suelta("armazon", "Semiarco orgánico color destacado", { tipo: "escenografia", elementos: tuboPvc(eje, eje[0]!) }, eje[0]!);
  const pared = (x: number) => v(x, 0, PARED_904 + SEPARA);
  type Bloque = { id: string; nombre: string; codigo: string; puntos: Array<[number, number]>; radio: [number, number]; pesos: Readonly<Record<string, number>>; cordones: Array<Array<[number, number]>> };
  const BLOQUES: readonly Bloque[] = [
    { id: "champana", nombre: "Reflex Champaña", codigo: "971", puntos: [[65, 780], [175, 770], [270, 725], [300, 625]], radio: [36, 27], pesos: { "R-18": 0.4, "R-12": 1 }, cordones: [[[90, 705], [170, 730], [260, 760], [360, 775], [440, 745]]] },
    { id: "crema", nombre: "Pastel Dusk Crema", codigo: "107", puntos: [[230, 500], [300, 410], [400, 385], [450, 470]], radio: [32, 28], pesos: { "R-18": 0.3, "R-12": 1 }, cordones: [[[235, 320], [300, 345], [370, 395], [410, 455]]] },
    { id: "perla", nombre: "Silk Perla Crema", codigo: "873", puntos: [[420, 330], [510, 290], [560, 390], [535, 520]], radio: [30, 26], pesos: { "R-18": 0.25, "R-12": 1 }, cordones: [[[455, 240], [495, 320], [530, 410], [555, 500], [570, 575]]] },
    { id: "dorado", nombre: "Reflex Dorado", codigo: "970", puntos: [[595, 330], [650, 275], [690, 370], [650, 470]], radio: [30, 28], pesos: { "R-18": 0.15, "R-12": 1 }, cordones: [[[690, 205], [725, 290], [722, 390], [682, 482]]] },
    { id: "silk-dorado", nombre: "Silk Dorado", codigo: "870", puntos: [[760, 300], [840, 200], [920, 270], [890, 400]], radio: [34, 30], pesos: { "R-18": 0.2, "R-12": 1 }, cordones: [[[795, 165], [870, 215], [930, 285], [950, 365], [905, 430]], [[820, 250], [855, 330], [820, 410]]] },
  ];
  const nodos: NodoEscena[] = [armazon.nodo];
  BLOQUES.forEach((b, k) => {
    const t = tramo({
      id: `bloque-${b.id}`, nombre: `Semiarco: bloque ${b.nombre}`, padre: armazon.padre, plano: "pared", origen: pared(px904(b.puntos[0]![0], 0).x),
      racimos: [{ id: b.id, nombre: b.nombre, puntos: b.puntos.map(([x, y]) => px904(x, y)), radioInicioCm: b.radio[0], radioFinCm: b.radio[1], mezcla: mezcla(b.pesos), tapas: { inicio: true, fin: true } }],
      colores: [color(b.codigo)], inflados: INFLADOS_904, semilla: 9041 + k, relleno: [], variacion: 0.08,
    });
    nodos.push(t.nodo);
    // El cordón va sobre la cara del bloque (a ~1,5 radios de la pared).
    b.cordones.forEach((c, j) => nodos.push(cordon(`cordon-${b.id}${b.cordones.length > 1 ? `-${j + 1}` : ""}`, `Cordón de R-5 ${b.nombre}${b.cordones.length > 1 ? ` ${j + 1}` : ""}`, armazon.padre, R("R-5", 10.5, b.codigo), c.map(([x, y]) => px904(x, y)), PARED_904 + SEPARA + b.radio[0] * 1.55)));
  });
  // El R-24 crema de abajo, delante del bloque champaña (el más grande de la foto).
  nodos.push(colgar({ id: "r24-crema", nombre: "R-24 Pastel Dusk Crema", pieza: globo(R("R-24", 55, "107")), padre: armazon.padre, origen: px904(400, 675, PARED_904 + 50), normal: v(0.3, 0.2, 1), giroGrados: 0 }).nodo);
  return { sala: sala(400, 300, 300, { paredes: "#f4f3f1", piso: "#e6e3de" }), nodos };
};

const idea904 = idea({
  numero: 904, slug: "semiarco-color-destacado", nombre: "Semiarco orgánico de color destacado", ocasiones: ["general"],
  fotoUrl: `${CDN}Semiarco_color_destacado_e9a5f333-e339-4e17-b71f-bac972652de1.jpg`, escena: escena904,
  publicados: [P_CHAMPANA, pub("GLOBO REDONDO SILK PERLA CREMA", "/products/globo-latex-redondo-silk-perla-crema", "R-12", "873"), P_DUSK_CREMA, pub("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870"), pub("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970")],
  nota: "Igual: el semiarco en diagonal de la foto (~3,6 m de ancho y ~2,6 m de alto, contra la pared) en sus cinco bloques de color, en el orden de la foto y con los cinco productos que publica la idea: Reflex Champaña abajo a la izquierda (el cromado oscuro), Pastel Dusk Crema con su R-24, Silk Perla Crema, Reflex Dorado y Silk Dorado arriba a la derecha; R-18 y R-12 en cada bloque y, encima, su cordón de cuartetos de R-5 del mismo color (dos en el racimo de Silk Dorado). Distinto: los globos de cada bloque los pone el motor orgánico para el grueso y el largo medidos (no uno a uno); la clasificación decía grafito/plata para el bloque de abajo, pero la idea publica Reflex Champaña y es el que se usa (el cromado se ve oscuro en la foto); los cordones de la foto serpentean más sueltos.",
});

// ==========================================================================================================
// 927 · Techo (túnel de dos arcos de cuartetos: patas en espiral rojo y blanco, arriba rojo)
// ==========================================================================================================

/**
 * Foto de 740 × 570 (fondo blanco): los R-12 miden ~52 px (25 cm: 2,1 px/cm). Son dos arcos iguales, uno detrás del otro
 * (se ven cuatro patas: las de delante más abiertas, por la perspectiva): cada uno con dos patas de 5 cuartetos R-12 en
 * espiral doble rojo y blanco (~1 m) y arriba un arco de cuartetos rojo de eje 2,4 m entre patas, con la clave a ~1,9 m;
 * en lo alto asoman globitos R-5 blancos sueltos (cuatro por arco). El de atrás va ~1 m detrás.
 */
const PATA_927: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 100, patron: "dos_colores", colores: ["015", "005"] };
const BASE_ARCO_927 = perezoso(() => r2(-armarPieza(PATA_927).caja.min.y + 5 * 25 * 0.8));
const ARCO_927 = perezoso((): Pieza => ({ tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm: 240, altoCm: r2(176 - BASE_ARCO_927()), patron: "un_color", colores: ["015"] }));
const ANCLAS_927 = perezoso(() => armarPieza(ARCO_927()).anclas.length);
const escena927 = (): Escena => {
  const nodos: NodoEscena[] = [];
  for (const [lado, z] of [["delantero", 20], ["trasero", -85]] as const) {
    const arcoId = `arco-${lado}`;
    nodos.push(
      { id: arcoId, nombre: `Arco ${lado} de cuartetos rojo`, pieza: ARCO_927(), colocacion: { en: "libre", xCm: 0, yCm: BASE_ARCO_927(), zCm: z, giroGrados: 0 } },
      // Cuatro globitos blancos en lo alto (cada cuarto del arco, desde la primera cuarta parte).
      { id: `blancos-${lado}`, nombre: `Globitos R-5 blancos del arco ${lado}`, pieza: globo(R("R-5", 11, "005")), colocacion: { en: "ancla", padreId: arcoId, ancla: Math.round(ANCLAS_927() * 0.18), cada: Math.round(ANCLAS_927() * 0.21), giroGrados: 0 } },
      { id: `pata-${lado}-izquierda`, nombre: `Pata izquierda del arco ${lado} (espiral rojo y blanco)`, pieza: PATA_927, colocacion: { en: "piso", xCm: -120, zCm: z, giroGrados: 0 } },
      { id: `pata-${lado}-derecha`, nombre: `Pata derecha del arco ${lado} (espiral rojo y blanco)`, pieza: PATA_927, colocacion: { en: "piso", xCm: 120, zCm: z, giroGrados: 0 } },
    );
  }
  return { sala: sala(420, 380, 280, { paredes: "#f7f7f7", piso: "#efefef" }), nodos };
};

const idea927 = idea({
  numero: 927, slug: "techo", nombre: "Túnel de dos arcos rojo y blanco", ocasiones: ["amor"],
  fotoUrl: `${CDN}bb517c06260bea15cd6b1d3f40143b23.jpg`, escena: escena927,
  nota: "Igual: los dos arcos de la foto, uno detrás del otro (las cuatro patas que se ven): patas de 5 cuartetos R-12 en espiral doble rojo y blanco (~1 m) y arriba un arco de cuartetos rojo de 2,4 m entre patas con la clave a ~1,9 m, con globitos R-5 blancos asomando en lo alto. La idea no publica productos; medidos: rojo #fe0000 → Fashion Rojo 015 (la foto está saturada), blanco 005 (en la sombra se ve lila). Distinto: los niveles de arriba no se cuentan uno a uno (el motor los da para el ancho y el alto medidos); los globitos blancos de lo alto se reparten parejos (en la foto van algo desordenados); la distancia entre los dos arcos (~1 m) se estima por la perspectiva.",
});

// ==========================================================================================================
// 980 · Webinar aro orgánico Merlot – Coral – Arena
// ==========================================================================================================

/**
 * Foto de 1000 × 1000 (fondo blanco): los R-12 Merlot miden ~80 px (27,5 cm: 2,9 px/cm) y el piso está en y ≈ 940 px.
 * El aro es una cuerda de tres T-260 Reflex Dorado trenzados (~15 cm de grueso) de 2,3 m de diámetro (eje), con el centro
 * a 1,4 m del piso; el orgánico lo cubre 2/3 (de las 11 a las 7 en el sentido del reloj): Merlot arriba, Pastel Dusk
 * Crema, Pastel Dusk Rosa, Palo de Rosa (con un R-24 de ~48 cm) y Merlot abajo, apoyado en el piso. Dos mariposas: una
 * Merlot con alas de cristal y cuerpo blanco sobre la cuerda (a la izquierda) y una dorada con cuerpo rosado sobre el
 * Merlot de abajo.
 */
const px980 = (x: number, y: number, z: number): Vec3 => v(r2((x - 425) / 2.9), r2((940 - y) / 2.9), z);
const Z_ARO = -80;
const CENTRO_980 = px980(425, 533, Z_ARO);
const RADIO_980 = r2(335 / 2.9);
const enAro = (grados: number, z = Z_ARO, radio = RADIO_980): Vec3 => v(r2(CENTRO_980.x + radio * Math.cos(rad(grados))), r2(CENTRO_980.y + radio * Math.sin(rad(grados))), z);
const CUERDA_980: Pieza = { tipo: "decoracion", decoracion: figura({ accesorios: [{ en: "base", forma: { tipo: "bufanda", formatoId: "T-260", grosorCm: 5, codigos: ["970", "970", "970"], radioCm: RADIO_980 } }], queEs: "a hoop of three twisted gold balloon tubes" }) };
/** El centro de la cuerda en su espacio propio (la figura se apoya en su base): para poner el aro donde va. */
const CENTRO_CUERDA_980 = perezoso(() => {
  const pts = armarPieza(CUERDA_980).tubos.flatMap((t) => t.puntos);
  return v(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length, pts.reduce((a, p) => a + p.z, 0) / pts.length);
});
const MARIPOSA_MERLOT: Pieza = {
  tipo: "decoracion", decoracion: figura({
    cuerpo: [{ tipo: "tubito", tubito: { formatoId: "T-260", grosorCm: 4, codigo: "005" }, largoCm: 34 }],
    accesorios: [
      { en: "lomo", par: true, corrimientoCm: [2, 0, 8], forma: { tipo: "globo", globo: R("R-9", 17, "018"), anguloGrados: 30 } },
      { en: "lomo", par: true, corrimientoCm: [2, 0, -6], forma: { tipo: "globo", globo: R("R-12", 19, "390"), anguloGrados: -35 } },
      { en: "coronilla", forma: { tipo: "antenas", tubito: { formatoId: "T-260", grosorCm: 2.5, codigo: "005" }, largoCm: 10, anguloGrados: 65, punta: null } },
    ],
    queEs: "a balloon butterfly with burgundy and clear wings and a white twisted body",
  }),
};
const MARIPOSA_DORADA: Pieza = {
  tipo: "decoracion", decoracion: figura({
    cuerpo: [{ tipo: "tubito", tubito: { formatoId: "T-260", grosorCm: 3.5, codigo: "009" }, largoCm: 22 }],
    accesorios: [
      { en: "lomo", par: true, corrimientoCm: [1, 0, 5], forma: { tipo: "globo", globo: R("R-9", 19, "970"), anguloGrados: 35 } },
      { en: "lomo", par: true, corrimientoCm: [1, 0, -5], forma: { tipo: "globo", globo: R("R-9", 16, "970"), anguloGrados: -30 } },
      { en: "coronilla", forma: { tipo: "antenas", tubito: { formatoId: "T-260", grosorCm: 2, codigo: "009" }, largoCm: 8, anguloGrados: 70, punta: R("R-5", 5.5, "009") } },
    ],
    queEs: "a balloon butterfly with chrome gold wings and a pink body",
  }),
};
const INFLADOS_980: Inflados = { "R-24": 48, "R-18": 41, "R-12": 27, "R-5": 12 };
const escena980 = (): Escena => {
  // El aro metálico de dentro (escenografía, escondido en la cuerda): la raíz; su origen en el centro del aro.
  const circulo = (r: number) => Array.from({ length: 48 }, (_, k) => ({ x: r2(r * Math.cos((2 * Math.PI * k) / 48)), y: r2(r * Math.sin((2 * Math.PI * k) / 48)) }));
  const aro = suelta("aro", "Aro orgánico Merlot, Coral y Arena", { tipo: "escenografia", elementos: [{ forma: "panel", contorno: circulo(RADIO_980 + 1.2), huecos: [circulo(RADIO_980 - 1.2).reverse()], zCm: -1, grosorCm: 2, hex: "#c9a24a", acabado: "metal" }] }, CENTRO_980);
  // La cuerda de tubitos: su centro en el del aro (normal arriba, −90°: su plano queda de frente).
  const m = giroSobre(ARRIBA, -90);
  const cuerda = colgar({ id: "cuerda", nombre: "Cuerda de T-260 Reflex Dorado trenzados", pieza: CUERDA_980, padre: aro.padre, origen: menos(CENTRO_980, aplicar(m, CENTRO_CUERDA_980())), normal: ARRIBA, giroGrados: -90 });
  // Los tramos: contra un plano a 22 cm detrás del aro (los de arriba) o en el piso (los de abajo).
  const detras = v(0, 0, Z_ARO - 22);
  const arco = (desde: number, hasta: number, n: number) => Array.from({ length: n }, (_, k) => desde + ((hasta - desde) * k) / (n - 1));
  const T = (id: string, nombre: string, codigo: string, grados: number[], radio: [number, number], pesos: Readonly<Record<string, number>>, plano: "pared" | "piso", k: number, sobre = 0) => tramo({
    id, nombre, padre: aro.padre, plano, origen: plano === "pared" ? detras : v(CENTRO_980.x, SEPARA, Z_ARO),
    racimos: [{ id, nombre, puntos: grados.map((g, i) => { const p = enAro(g, Z_ARO, RADIO_980 + sobre); const r = radio[0] + ((radio[1] - radio[0]) * i) / Math.max(1, grados.length - 1); return plano === "piso" ? v(p.x, Math.max(p.y, r * 0.85), p.z) : p; }), radioInicioCm: radio[0], radioFinCm: radio[1], mezcla: mezcla(pesos), tapas: { inicio: true, fin: true } }],
    colores: [color(codigo)], inflados: INFLADOS_980, semilla: 9801 + k, relleno: [], variacion: 0.08,
  });
  const merlotArriba = T("tramo-merlot-arriba", "Aro: tramo Merlot de arriba", "018", arco(116, 60, 5), [30, 34], { "R-12": 1, "R-5": 0.9 }, "pared", 0, 18);
  const crema = T("tramo-crema", "Aro: tramo Pastel Dusk Crema", "107", arco(56, 8, 5), [32, 30], { "R-12": 1, "R-5": 0.5 }, "pared", 1, 12);
  const rosa = T("tramo-dusk-rosa", "Aro: tramo Pastel Dusk Rosa", "110", arco(6, -36, 4), [32, 33], { "R-12": 1, "R-5": 0.8 }, "pared", 2, 12);
  const paloRosa = T("tramo-palo-de-rosa", "Aro: tramo Palo de Rosa", "010", arco(-40, -96, 5), [34, 38], { "R-24": 0.1, "R-18": 0.2, "R-12": 1 }, "piso", 3);
  const merlotAbajo = T("tramo-merlot-abajo", "Aro: tramo Merlot de abajo", "018", arco(-98, -140, 4), [38, 32], { "R-18": 0.25, "R-12": 1, "R-5": 0.5 }, "piso", 4);
  const nodos: NodoEscena[] = [
    aro.nodo, cuerda.nodo, merlotArriba.nodo, crema.nodo, rosa.nodo, paloRosa.nodo, merlotAbajo.nodo,
    // La mariposa Merlot, sobre la cuerda a la izquierda (inclinada como en la foto); la dorada, sobre el Merlot de abajo.
    colgar({ id: "mariposa-merlot", nombre: "Mariposa Merlot con alas de cristal", pieza: MARIPOSA_MERLOT, padre: aro.padre, origen: px980(95, 515, Z_ARO + 6), normal: AL_FRENTE, giroGrados: -60 }).nodo,
    apoyar("mariposa-dorada", "Mariposa dorada", MARIPOSA_DORADA, merlotAbajo.padre, px980(310, 700, Z_ARO + 10), AL_FRENTE, -10),
  ];
  return { sala: sala(380, 300, 330, { paredes: "#f6f5f3", piso: "#eceae6" }), nodos };
};

const idea980 = idea({
  numero: 980, slug: "webinar-aro-organico-merlot-coral-arena", nombre: "Aro orgánico Merlot, Coral y Arena con mariposas", ocasiones: ["general"],
  fotoUrl: `${CDN}Webinar_Aro_Organico_Merlot-Coral-Arena.jpg`, escena: escena980,
  publicados: [P_MERLOT, pub("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010"), pub("GLOBO REDONDO PASTEL DUSK ROSA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-rosa", "R-12", "110"), P_DUSK_CREMA, P_TUBITO_DORADO],
  nota: "Igual: el aro de 2,3 m (eje) de cuerda de tres T-260 Reflex Dorado trenzados con el centro a 1,4 m, cubierto 2/3 por el orgánico en el orden de la foto —Merlot arriba, Pastel Dusk Crema, Pastel Dusk Rosa, Palo de Rosa (el «coral», con su R-24 y R-18) y Merlot abajo, apoyado en el piso—, con los productos que publica la idea; la mariposa Merlot de alas de cristal sobre la cuerda a la izquierda y la dorada (alas R-9 Reflex Dorado, cuerpo rosado) sobre el Merlot de abajo. Distinto: los globos de cada tramo los pone el motor orgánico para el grueso y el largo medidos (no uno a uno); la cuerda gira menos vueltas que la de la foto; las alas de cristal de la mariposa llevan dentro un globito Merlot que no se modela; las alas doradas (Reflex Dorado R-9) y los cuerpos (Fashion Blanco y Rosado) no están publicados: medidos; el aro metálico de dentro es escenografía.",
});

// ==========================================================================================================
// 51 · Árbol Halloween (base de racimos, tronco de tubitos trenzados, copa con ojos, ramas y fantasmas de papel)
// ==========================================================================================================

/**
 * Foto de 740 × 570 (fondo blanco): los R-12 de la base miden ~62 px (27 cm: 2,3 px/cm), los tubitos ~12 px (5 cm); el
 * piso en y ≈ 555 px. Árbol de ~2,35 m: base de racimos de ~1,5 m de ancho y ~75 cm de alto (R-12 Chocolate con R-5
 * Arena, Café y unos pocos dorados), tronco de globitos Chocolate y Café envuelto por T-260 Chocolate y Café en espiral y
 * dos T-260 Arena en vueltas anchas, copa de ~65 cm (R-12 Chocolate chicos con R-5 Café) con dos ojos naranja de ceja
 * brava, cuatro ramas de T-260 Chocolate trenzadas (las de arriba levantadas como brazos, ~78 cm; las de abajo, ~50 cm)
 * y cuatro fantasmas de papel blanco con su cola en espiral.
 */
const px51 = (x: number, y: number, z: number): Vec3 => v(r2((x - 400) / 2.3), r2((555 - y) / 2.3), z);
const Z_ARBOL = -100;
const OJO_51 = (lado: "izquierdo" | "derecho"): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "ojo", propiedades: { globo: R("R-5", 11, "062"), estilo: { iris: null, pupila: { hex: "#1b120d", proporcion: 0.34 }, brillo: true, venas: null }, miradaGrados: lado === "izquierdo" ? -20 : 200, ceja: { hex: "#1b120d", lado } } } });
const fantasma51 = (altoCm: number, vueltas: number, largoCm: number): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "fantasma", propiedades: { altoCm, hex: "#f5f3ee", hexCara: "#1a1a1a", cola: { vueltas, largoCm } } } });
const resorte51 = (codigo: string, radioCm: number, vueltas: number, largoCm: number): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "rizo", propiedades: { forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 4.5, codigo }, vueltas, radioCm, largoCm, eje: "abajo" } } });
const escena51 = (): Escena => {
  const pie = v(0, 0, Z_ARBOL);
  // El armazón: la varilla del centro del tronco (escondida), del piso a la copa.
  const armazon = suelta("armazon", "Árbol de Halloween", { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 1.6, altoCm: 215, hex: "#d6d0c4", acabado: "mate" }] }, pie);
  const base = tramo({
    id: "base", nombre: "Árbol: base de racimos", padre: armazon.padre, plano: "piso", origen: v(0, SEPARA, Z_ARBOL),
    racimos: [
      { id: "base_ancho", nombre: "Base a lo ancho", puntos: [px51(255, 500, Z_ARBOL + 5), px51(330, 470, Z_ARBOL + 10), px51(470, 470, Z_ARBOL + 10), px51(545, 495, Z_ARBOL + 5)], radioInicioCm: 30, radioFinCm: 30, mezcla: mezcla({ "R-12": 1, "R-5": 0.9 }), tapas: { inicio: true, fin: true } },
      { id: "base_alto", nombre: "Base hacia arriba", puntos: [px51(395, 520, Z_ARBOL + 18), px51(395, 430, Z_ARBOL + 5), px51(395, 395, Z_ARBOL)], radioInicioCm: 34, radioFinCm: 22, mezcla: mezcla({ "R-12": 1, "R-5": 0.5 }), tapas: { inicio: false, fin: true } },
    ],
    colores: [{ codigo: "076", peso: 2.6, formatos: ["R-12"] }, { codigo: "071", peso: 1, formatos: ["R-5"] }, { codigo: "074", peso: 0.8, formatos: ["R-5"] }, { codigo: "970", peso: 0.25, formatos: ["R-5"] }],
    inflados: { "R-12": 27, "R-5": 10 }, semilla: 511, relleno: [], variacion: 0.1,
  });
  // Tronco y copa: de globitos, con la espalda contra un plano detrás del eje (el árbol es exento: no se ve).
  const tronco = tramo({
    id: "tronco", nombre: "Árbol: tronco de globitos", padre: armazon.padre, plano: "pared", origen: v(0, 0, Z_ARBOL - 13),
    racimos: [{ id: "tronco", nombre: "Tronco", puntos: [px51(392, 395, 0), px51(385, 300, 0), px51(378, 220, 0), px51(372, 170, 0)], radioInicioCm: 16, radioFinCm: 14, mezcla: mezcla({ "R-5": 1 }), tapas: { inicio: false, fin: false } }],
    colores: [color("076", 2), color("074", 1)], inflados: { "R-5": 11 }, semilla: 512, relleno: [], variacion: 0.08,
  });
  // La copa: una bola de R-12 Chocolate chicos con R-5 Café en los huecos, más alta que ancha, sobre el armazón.
  const copa = colgar({
    id: "copa", nombre: "Árbol: copa", padre: armazon.padre, origen: px51(368, 165, Z_ARBOL - 2), normal: ARRIBA, giroGrados: -90,
    pieza: { tipo: "forma", forma: { clase: "esfera", diametroCm: 64, globo: { formatoId: "R-12", infladoCm: 15 }, colores: { codigos: ["076"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 10, codigos: ["074"], cada: 3 } } },
  });
  const ramas: Pieza = {
    tipo: "decoracion", decoracion: {
      tipo: "arbol_trenzado", propiedades: {
        alturaCm: 230, ramas: 4, tronco: { formatoId: "T-260", grosorCm: 4.5, codigo: "076", tubitos: 2 }, cintas: null,
        copa: { formatoId: "R-12", infladoCm: 15, codigos: ["076"] }, base: { grandes: R("R-12", 27, "076"), acentos: [] }, ojos: false,
        soloRamas: { radioTroncoCm: 15, alturasCm: [r2((555 - 165) / 2.3), r2((555 - 330) / 2.3)] },
      },
    },
  };
  const enArmazon = (id: string, nombre: string, pieza: Pieza, origen: Vec3, giro = 0) => colgar({ id, nombre, pieza, padre: armazon.padre, origen, normal: AL_FRENTE, giroGrados: giro }).nodo;
  const nodos: NodoEscena[] = [
    armazon.nodo, base.nodo, tronco.nodo, copa.nodo,
    enArmazon("ramas", "Ramas trenzadas de T-260 Chocolate", ramas, pie),
    // El tronco de tubitos: dos Chocolate y uno Café en espiral cerrada, y dos Arena en vueltas anchas por la mitad.
    enArmazon("tubitos-chocolate-1", "Tubito Chocolate del tronco 1", resorte51("076", 13, 4, 150), v(0, 205, Z_ARBOL)),
    enArmazon("tubitos-chocolate-2", "Tubito Chocolate del tronco 2", resorte51("076", 11.5, 4.5, 145), v(0, 200, Z_ARBOL)),
    enArmazon("tubito-cafe", "Tubito Café del tronco", resorte51("074", 15, 3.5, 140), v(0, 195, Z_ARBOL)),
    enArmazon("tubito-arena-1", "Tubito Arena en vueltas anchas 1", resorte51("071", 21, 2.5, 65), px51(390, 150, Z_ARBOL)),
    enArmazon("tubito-arena-2", "Tubito Arena en vueltas anchas 2", resorte51("071", 19, 2, 48), px51(390, 240, Z_ARBOL)),
    apoyar("ojo-izquierdo", "Ojo bravo izquierdo", OJO_51("izquierdo"), copa.padre, px51(357, 128, Z_ARBOL + 10), AL_FRENTE),
    apoyar("ojo-derecho", "Ojo bravo derecho", OJO_51("derecho"), copa.padre, px51(388, 130, Z_ARBOL + 10), AL_FRENTE),
    // Los fantasmas: el pie de su cuerpo (donde empieza la cola) en el sitio de la foto.
    enArmazon("fantasma-rama-izquierda", "Fantasma (rama izquierda)", fantasma51(36, 3, 80), px51(205, 205, Z_ARBOL + 20)),
    enArmazon("fantasma-rama-derecha", "Fantasma (rama derecha)", fantasma51(18, 2, 32), px51(498, 222, Z_ARBOL + 20)),
    enArmazon("fantasma-tronco", "Fantasma (tronco)", fantasma51(24, 2, 26), px51(405, 268, Z_ARBOL + 22)),
    enArmazon("fantasma-base", "Fantasma (base)", fantasma51(30, 2, 22), px51(372, 445, Z_ARBOL + 32)),
  ];
  return { sala: sala(320, 300, 280, { paredes: "#f5f4f2", piso: "#e9e6e1" }), nodos };
};

const idea51 = idea({
  numero: 51, slug: "arbol-halloween", nombre: "Árbol de Halloween con fantasmas", ocasiones: ["halloween"],
  fotoUrl: `${CDN}Arbol-HW.png`, escena: escena51,
  publicados: [
    pub("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
    pub("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074"),
    pub("GLOBO REDONDO FASHION CHOCOLATE", "/products/globo-para-fiesta-latex-redondo-fashion-chocolate", "R-12", "076"),
    pub("GLOBO TUBITO FASHION ARENA", "/products/globo-para-fiesta-latex-tubito-fashion-arena", "T-260", "071"),
    pub("GLOBO TUBITO FASHION CAFÉ", "/products/globo-para-fiesta-latex-tubito-fashion-cafe", "T-260", "074"),
    pub("GLOBO TUBITO FASHION CHOCOLATE", "/products/globo-para-fiesta-latex-tubito-fashion-chocolate", "T-260", "076"),
  ],
  nota: "Igual: el árbol de ~2,35 m de la foto con los seis productos que publica la idea: base de racimos de ~1,5 m (R-12 Chocolate con R-5 Arena y Café y unos pocos dorados), tronco de globitos Chocolate y Café envuelto por T-260 Chocolate y Café en espiral y dos T-260 Arena en vueltas anchas, copa de R-12 Chocolate chicos con R-5 Café y dos ojos naranja de ceja brava, cuatro ramas de T-260 Chocolate trenzadas (las de arriba levantadas como brazos) y los cuatro fantasmas de papel con cola en espiral (rama izquierda, rama derecha, tronco y base). Distinto: los globos de base, tronco y copa los pone el motor orgánico para las medidas de la foto (no uno a uno); los dorados de la base (R-5 Reflex Dorado) y los ojos (R-5 Naranja Cobrizo) no están publicados: medidos; las puntas de las ramas de la foto llevan burbujitas y unos rizos finos negros que no se modelan; los tubitos del tronco van en resortes parejos (en la foto se cruzan más sueltos).",
});

// ==========================================================================================================
// 286 · Centro de mesa Feliz Día Mami (florero rojo con flores de tubito y corazón de helio)
// ==========================================================================================================

/**
 * Foto de 740 × 570 (fondo blanco): el corazón C-12 mide ~180 px (30 cm: 6 px/cm); los R-5 blancos ~60 px (10 cm), los
 * R-9 rojos ~70 px (12 cm) y las flores ~75 px (12,5 cm). Florero de dos cuartetos R-9 Fashion Rojo (~25 cm) sobre la
 * mesa; detrás de las flores, un respaldo de 6 R-9 rojos y 8 R-5 blancos; 7 flores de 5 burbujas de T-260 (2 naranja, 2
 * amarillo miel, 2 fucsia y 1 azul) con botón R-5 verde, sus tallos y dos pares de hojas de T-260 verde trébol, y arriba
 * el corazón rojo de helio con su cinta. Todo cuelga de la varilla del florero (montaje del lote 05).
 */
const MESA_286 = 75;
const px286 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 365) / 6), r2(MESA_286 + (545 - y) / 6), z);
const FLORERO_286: Pieza = { tipo: "columna", formatoId: "R-9", infladoCm: 15, alturaCm: 24, patron: "un_color", colores: ["015"] };
const flor286 = (codigo: string): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 4, codigos: [codigo], cantidad: 5, estilo: "burbuja", largoCm: 6.5, anchoCm: 4, aperturaGrados: 10, giroGrados: 0 }, interior: null, corona: null, centro: R("R-5", 5.5, "029") } } });
const TALLO_286 = { formatoId: "T-260", grosorCm: 4.5, codigo: "029" };
const escena286 = (): Escena => {
  const z = 0;
  const bajoFlorero = bajoDe(FLORERO_286);
  const florero = suelta("florero", "Florero de cuartetos R-9 rojo (centro de mesa Feliz Día Mami)", FLORERO_286, v(0, r2(MESA_286 + 0.5 + bajoFlorero), z));
  // La varilla por el eje del florero (el hueco del centro de los cuartetos): de ella cuelga todo lo demás.
  const varilla = colgar({ id: "varilla", nombre: "Varilla del centro de mesa", padre: florero.padre, pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 0.5, altoCm: 52, hex: "#2f8f3a", acabado: "mate" }] }, origen: v(0, MESA_286 + 2, z), normal: ARRIBA, giroGrados: -90 });
  const nodos: NodoEscena[] = [
    { id: "mesa", nombre: "Mesa redonda blanca", pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 30, altoCm: MESA_286 - 2, hex: "#f2f0ec", acabado: "satinado" }, { forma: "cilindro", base: v(0, MESA_286 - 2, 0), radioCm: 31, altoCm: 2, hex: "#f2f0ec", acabado: "satinado" }] }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    florero.nodo, varilla.nodo,
  ];
  const deVarilla = (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal: Vec3, giro = 0) => nodos.push(colgar({ id, nombre, pieza, padre: varilla.padre, origen, normal, giroGrados: giro }).nodo);
  // El respaldo: R-9 rojos y R-5 blancos detrás de las flores.
  const ROJOS: ReadonlyArray<[number, number]> = [[265, 325], [330, 228], [410, 248], [455, 290], [440, 372], [292, 398]];
  const BLANCOS: ReadonlyArray<[number, number]> = [[245, 208], [325, 200], [395, 205], [350, 252], [240, 285], [232, 362], [287, 335], [485, 368]];
  ROJOS.forEach(([x, y], k) => deVarilla(`respaldo-rojo-${k + 1}`, `R-9 Fashion Rojo del respaldo ${k + 1}`, globo(R("R-9", 12, "015")), px286(x, y, z - 7), unitario(v((x - 365) / 80, 0.5, -0.3))));
  BLANCOS.forEach(([x, y], k) => deVarilla(`respaldo-blanco-${k + 1}`, `R-5 Fashion Blanco del respaldo ${k + 1}`, globo(R("R-5", 10, "005")), px286(x, y, z - 2), unitario(v((x - 365) / 90, 0.4, 0.2))));
  // Las flores (de frente, un poco abiertas hacia su lado) con su tallo desde la boca del florero.
  const boca = px286(365, 400, z + 2);
  const FLORES: ReadonlyArray<[string, number, number, string]> = [
    ["naranja", 300, 300, "061"], ["naranja", 370, 268, "061"], ["amarillo miel", 432, 292, "021"], ["amarillo miel", 255, 388, "021"],
    ["fucsia", 270, 268, "012"], ["fucsia", 482, 252, "012"], ["azul", 483, 328, "040"],
  ];
  FLORES.forEach(([nombre, x, y, codigo], k) => {
    const centro = px286(x, y, z + 9);
    deVarilla(`flor-${k + 1}`, `Flor de tubito ${nombre} ${k + 1}`, flor286(codigo), centro, unitario(v((x - 365) / 150, 0.15, 1)), k * 17);
    const d = menos(menos(centro, v(0, 0, 2)), boca), n = unitario(d);
    const tallo: Pieza = { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { ...TALLO_286, codigos: [TALLO_286.codigo], cantidad: 1, estilo: "burbuja", largoCm: r2(largo(d)), anchoCm: TALLO_286.grosorCm, aperturaGrados: -90, giroGrados: 0 }, interior: null, corona: null, centro: null } } };
    deVarilla(`tallo-${k + 1}`, `Tallo de T-260 verde trébol ${k + 1}`, tallo, mas(boca, por(n, bajoDe(tallo))), n);
  });
  // Dos pares de hojas en lazo a los lados de los tallos.
  const hojas = (giro: number): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 4.5, codigos: ["029"], cantidad: 2, estilo: "lazo", largoCm: 16, anchoCm: 7, aperturaGrados: 15, giroGrados: giro }, interior: null, corona: null, centro: null } } });
  deVarilla("hojas-izquierda", "Hojas en lazo verde trébol (izquierda)", hojas(20), px286(335, 375, z + 6), AL_FRENTE);
  deVarilla("hojas-derecha", "Hojas en lazo verde trébol (derecha)", hojas(-25), px286(410, 365, z + 6), AL_FRENTE);
  // El corazón de helio y su cinta, que baja a la boca del florero.
  const corazon = px286(330, 140, z - 4);
  deVarilla("corazon", "Corazón C-12 Fashion Rojo con helio («Feliz Día Mami»)", { tipo: "globo", formatoId: "C-12", infladoCm: 30, codigo: "015" }, corazon, ARRIBA);
  const m = giroSobre(ARRIBA, -90);
  const amarre = px286(352, 330, z - 4);
  deVarilla("cinta", "Cinta del corazón", { tipo: "escenografia", elementos: [cinta(v(0, 0, 0), trasladar(m, menos(v(corazon.x, corazon.y - 15, corazon.z), amarre)), "#e8222e", 0.15)] }, amarre, ARRIBA, -90);
  return { sala: sala(300, 260, 260, { paredes: "#f7f7f6", piso: "#ece9e4" }), nodos };
};

const idea286 = idea({
  numero: 286, slug: "centro-de-mesa-feliz-dia-mami", nombre: "Centro de mesa Feliz Día Mami", ocasiones: ["cumpleaños"],
  fotoUrl: `${CDN}1b852244b45b7c6322f9a4042a5ba08a_17bba687-cf14-4118-a0f2-65f4daa482a6.jpg`, escena: escena286,
  nota: "Igual: el florero de dos cuartetos R-9 rojos con el respaldo de 6 R-9 rojos y 8 R-5 blancos, las 7 flores de 5 burbujas de T-260 que se ven (2 naranja, 2 amarillo miel, 2 fucsia y 1 azul) con botón R-5 verde, sus tallos y dos pares de hojas verde trébol, y el corazón rojo de helio con su cinta; ~82 cm de alto sobre la mesa. La idea no publica productos; medidos: rojo #ee0331 → Fashion Rojo 015, naranja → Fashion Naranja 061 (en sombra mide más rojo), amarillo #ffcb01 → Amarillo Miel 021, fucsia #fd4b8a → Fashion Fucsia 012, azul #00a9d0 → Fashion Azul 040, verde #00aa1c → Verde Trébol 029, blanco 005. Distinto: el corazón lleva impreso «Feliz Día Mami» y la tienda no tiene ese impreso en C-12: va liso (Fashion Rojo); el florero de la foto es más abombado abajo; la foto no tiene mesa (se pone una redonda blanca de 75 cm).",
});

// ==========================================================================================================
// 836 · Peppa Pig (escena: guirnalda de cuartetos en lo alto de la cortina y mesa de postres)
// ==========================================================================================================

/** Una bola (pompón, farol de papel, cuerpo de peluche) de cilindros escalonados, con el centro en `c`. */
function bola(c: Vec3, radioCm: number, hex: string, acabado: "papel" | "tela" | "satinado" = "papel", motivo?: ElementoEscenografia["motivo"]): ElementoEscenografia[] {
  const n = 6;
  return Array.from({ length: n }, (_, k): ElementoEscenografia => {
    const a0 = -Math.PI / 2 + (Math.PI * k) / n, a1 = -Math.PI / 2 + (Math.PI * (k + 1)) / n;
    return { forma: "cilindro", base: v(c.x, r2(c.y + radioCm * Math.sin(a0)), c.z), radioCm: r2(Math.max(0.3, radioCm * Math.cos(a0))), radioArribaCm: r2(Math.max(0.3, radioCm * Math.cos(a1))), altoCm: r2(radioCm * (Math.sin(a1) - Math.sin(a0))), hex, acabado, ...(motivo && k >= 2 && k <= 3 ? { motivo } : {}) };
  });
}
const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: "mate" | "madera" | "tela" | "papel" | "satinado" | "brillante" | "metal" | "lentejuelas" = "mate", motivo?: ElementoEscenografia["motivo"]): ElementoEscenografia => ({ forma: "caja", centro, tamano, hex, acabado, ...(motivo ? { motivo } : {}) });

/**
 * Foto de 740 × 570 con dominante rosada (se equilibró con el blanco de los muebles): la mesa de postres mide ~285 px
 * (2,2 m: 1,3 px/cm); la pared de la cortina va de x ≈ 100 a 680 px (~4,4 m) y del piso (y ≈ 425 px) al techo (~2,85 m).
 * En lo alto, de pared a pared, una guirnalda de cuartetos R-9 (~16 cm) rosado y fucsia de ~4,5 m que baja un poco en las
 * esquinas; de ella cuelgan 4 pompones y 4 faroles de papel. Debajo: cortina blanca, cuadros, mesa con falda de tul lila,
 * repisas, mesitas blancas, percheros y el peluche de Peppa.
 */
const px836 = (x: number, y: number, z: number): Vec3 => v(r2((x - 390) / 1.3), r2((425 - y) / 1.3), z);
const PARED_836 = -200;
const escena836 = (): Escena => {
  const zG = PARED_836 + 18;
  // La guirnalda: recta a lo largo de la cortina, bajando en las esquinas (en su plano XY, de frente).
  const alto = px836(390, 103, 0).y;
  const recorrido = [px836(110, 130, 0), px836(118, 110, 0), px836(140, 101, 0), px836(390, 103, 0), px836(640, 100, 0), px836(662, 109, 0), px836(670, 128, 0)].map((p) => ({ x: p.x, y: r2(p.y - alto) }));
  const guirnalda = suelta("guirnalda", "Guirnalda de cuartetos rosado y fucsia", { tipo: "guirnalda", guirnalda: { formatoId: "R-9", infladoCm: 16, patron: "dos_colores", colores: ["009", "012"], anchoCm: 0, caidaCm: 0, recorrido } }, v(0, alto, zG));
  /** Un pompón o farol de papel colgado bajo la guirnalda: su hilo baja de su origen (la escena lo asienta bajo los globos). */
  const colgante = (id: string, nombre: string, x: number, yCentro: number, radio: number, hex: string, motivo?: ElementoEscenografia["motivo"]): NodoEscena => {
    const c = px836(x, yCentro, zG + 6);
    const caida = r2(alto - 8 - c.y - radio);
    // Normal hacia abajo: y local baja por el hilo (giroSobre: x local → −z, y local → −y, z local → x).
    const elementos: ElementoEscenografia[] = [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 0.15, altoCm: Math.max(1, caida), hex: "#f4f0ee", acabado: "papel" }, ...bola(v(0, Math.max(1, caida) + radio, 0), radio, hex, "papel", motivo)];
    return apoyar(id, nombre, { tipo: "escenografia", elementos }, guirnalda.padre, v(c.x, alto, zG + 6), v(0, -1, 0));
  };
  const lunares = (hex: string): ElementoEscenografia["motivo"] => ({ dibujo: "lunares", hex, cara: "frente" });
  const nodos: NodoEscena[] = [
    guirnalda.nodo,
    colgante("pompon-1", "Pompón de papel rosado pálido", 152, 97, 10, "#f4c9d2"),
    colgante("pompon-2", "Pompón de papel fucsia", 188, 100, 10, "#e8427c"),
    colgante("farol-1", "Farol de papel rosado pálido (izquierda)", 210, 123, 11, "#f6dfe2"),
    colgante("farol-2", "Farol de papel blanco con lunares (izquierda)", 180, 152, 13, "#f7f2f0", lunares("#e64a7c")),
    colgante("pompon-3", "Pompón de papel fucsia con lunares", 550, 100, 9, "#ea4f84", lunares("#ffffff")),
    colgante("farol-3", "Farol de papel rosado pálido (derecha)", 548, 130, 12, "#f6dfe2"),
    colgante("farol-4", "Farol de papel blanco con lunares (derecha)", 583, 160, 14, "#f7f2f0", lunares("#e64a7c")),
    colgante("pompon-4", "Pompón de papel blanco con lunares", 608, 107, 10, "#f7eef0", lunares("#e64a7c")),
  ];
  // Escenografía y utilería (sueltas): cortina, cuadros, mesa de postres, repisas, mesitas, percheros y peluche.
  const enPiso = (id: string, nombre: string, elementos: ElementoEscenografia[], x: number, z: number): NodoEscena => ({ id, nombre, pieza: { tipo: "escenografia", elementos }, colocacion: { en: "libre", xCm: r2(x), yCm: 0, zCm: r2(z), giroGrados: 0 } });
  const blanco = "#f4f1ee";
  const xDe = (px: number) => r2((px - 390) / 1.3);
  nodos.push(
    { id: "cortina", nombre: "Cortina blanca", pieza: { tipo: "escenografia", elementos: [caja(v(0, 140, 0), v(446, 280, 2), "#f7f0ee", "tela")] }, colocacion: { en: "libre", xCm: xDe(390), yCm: 0, zCm: PARED_836 + 2, giroGrados: 0 } },
    { id: "cuadros", nombre: "Cuadros de Peppa y letrero «Victoria»", pieza: { tipo: "escenografia", elementos: [
      caja(v(xDe(310), px836(0, 202, 0).y, 0), v(24, 16, 1.5), "#e95a88", "papel"), caja(v(xDe(307), px836(0, 240, 0).y, 0), v(24, 18, 1.5), "#e95a88", "papel"),
      caja(v(xDe(480), px836(0, 202, 0).y, 0), v(24, 16, 1.5), "#e95a88", "papel"), caja(v(xDe(480), px836(0, 240, 0).y, 0), v(24, 18, 1.5), "#e95a88", "papel"),
      caja(v(xDe(393), px836(0, 215, 0).y, 0), v(66, 38, 1.5), "#c69ad6", "papel", { dibujo: "texto", texto: "Victoria", hex: "#d2427a", cara: "frente" }),
    ] }, colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: PARED_836 + 5, giroGrados: 0 } },
    { id: "mesa", nombre: "Mesa de postres con falda de tul lila", pieza: { tipo: "escenografia", elementos: mesaConMantel286({ anchoCm: 220, fondoCm: 70, altoCm: 73, mantel: "#ebb6d8" }) }, colocacion: { en: "piso", xCm: xDe(372), zCm: PARED_836 + 60, giroGrados: 0 } },
    enPiso("torta", "Torta de Peppa de dos pisos", [{ forma: "cilindro", base: v(0, 73, 0), radioCm: 14, altoCm: 12, hex: "#f6c6d4", acabado: "mate" }, { forma: "cilindro", base: v(0, 85, 0), radioCm: 10, altoCm: 10, hex: "#f9e6ea", acabado: "mate" }, ...bola(v(0, 100, 0), 5, "#f39bb6", "satinado")], xDe(385), PARED_836 + 55),
    enPiso("repisa", "Repisa blanca con frascos y mueble de lunares lilas", [caja(v(0, 33, 0), v(54, 66, 40), "#bf8fbf", "madera", { dibujo: "lunares", hex: "#ffffff", cara: "frente" }), caja(v(0, 106, 0), v(54, 80, 30), blanco, "madera"), ...[0, 1, 2].flatMap((k) => bola(v(-15 + k * 15, 120, 5), 5, "#ef6f98", "satinado"))], xDe(150), PARED_836 + 45),
    enPiso("perchero-izquierdo", "Perchero blanco con tutús rosados", [caja(v(-34, 40, 0), v(3, 80, 3), blanco), caja(v(34, 40, 0), v(3, 80, 3), blanco), caja(v(0, 79, 0), v(72, 3, 3), blanco), ...[-22, -4, 14].map((x) => caja(v(x, 62, 0), v(16, 30, 10), "#f07fa2", "tela"))], -185, PARED_836 + 150),
    enPiso("mesita-noche", "Mesita blanca con jaula decorativa", [caja(v(0, 28, 0), v(42, 56, 32), blanco, "madera"), caja(v(0, 68, 0), v(18, 24, 18), "#f8f4f4", "metal")], xDe(198), PARED_836 + 105),
    enPiso("mesa-centro", "Mesa de centro blanca con cerditos", [caja(v(0, 20, 0), v(100, 40, 50), blanco, "madera"), ...[-30, -10, 10, 30].flatMap((x) => bola(v(x, 46, 0), 6, "#ee6c95", "satinado"))], xDe(375), PARED_836 + 175),
    enPiso("mesita-derecha", "Mesita blanca con caja de regalo", [caja(v(0, 23, 0), v(65, 46, 40), blanco, "madera"), caja(v(0, 54, 0), v(24, 16, 18), "#f5d6e0", "papel")], xDe(518), PARED_836 + 150),
    enPiso("perchero-peppa", "Perchero blanco con el peluche de Peppa", [caja(v(-42, 50, 0), v(3, 100, 3), blanco), caja(v(42, 50, 0), v(3, 100, 3), blanco), caja(v(0, 99, 0), v(88, 3, 3), blanco), ...bola(v(-12, 76, 4), 15, "#f19ab3", "tela"), ...bola(v(-12, 52, 4), 14, "#d8213f", "tela")], xDe(605), PARED_836 + 95),
    enPiso("repisa-derecha", "Repisa blanca baja con cerditos", [caja(v(0, 25, 0), v(55, 50, 32), blanco, "madera"), ...[-14, 0, 14].flatMap((x) => bola(v(x, 56, 0), 6, "#ee6c95", "satinado"))], xDe(645), PARED_836 + 150),
  );
  return { sala: sala(460, 400, 285, { paredes: "#f17f9e", piso: "#ebd4c6", techo: "#f6e3e4" }), nodos };
};

/** Mesa rectangular con mantel hasta el piso (la de `escenografia.ts`, con la falda de tul de la foto). */
function mesaConMantel286(o: { anchoCm: number; fondoCm: number; altoCm: number; mantel: string }): ElementoEscenografia[] {
  return [
    caja(v(0, o.altoCm - 1.5, 0), v(o.anchoCm + 2, 3, o.fondoCm + 2), "#f6eef3", "tela"),
    caja(v(0, (o.altoCm - 3) / 2, 0), v(o.anchoCm + 4, o.altoCm - 3, o.fondoCm + 4), o.mantel, "tela", { dibujo: "rayas", hex: "#f6d4ea", cara: "frente" }),
  ];
}

const idea836 = idea({
  numero: 836, slug: "peppa-pig", nombre: "Peppa Pig: guirnalda rosada y mesa de postres", ocasiones: ["cumpleaños"],
  fotoUrl: `${CDN}41b7d0a735f7030e742e3d88eba54640.jpg`, escena: escena836,
  nota: "Igual: la guirnalda de cuartetos R-9 rosado y fucsia en lo alto de la cortina, de pared a pared (~4,5 m, bajando en las esquinas), con los 4 pompones y 4 faroles de papel que cuelgan de ella; la cortina blanca entre paredes rosadas, los cuadros y el letrero «Victoria», la mesa de postres de 2,2 m con falda de tul lila y la torta, la repisa con frascos sobre el mueble de lunares lilas, el perchero de tutús, las mesitas blancas, la mesa de centro con cerditos y el perchero con el peluche de Peppa; piso claro. La idea no publica productos; medidos con el blanco equilibrado: fucsia #ff6895 → Fashion Fucsia 012 y rosado #ffadce → Fashion Rosado 009. Distinto: la foto es pequeña y no deja contar los cuartetos uno a uno (el largo y el globo dan los niveles); las dos tonalidades van en espiral doble (en la foto se mezclan); los pompones y faroles, el peluche, la carriola, el maniquí con tutú y la silla son volúmenes sencillos o no se ponen (carriola, maniquí y silla).",
});

// ==========================================================================================================
// 260 · Celebra con mamá (escena: malla plata y violeta, racimos de piso con ramos de helio y mesa)
// ==========================================================================================================

/**
 * Foto de 1600 × 1368: los R-5 fucsia de la malla miden ~45 px (11 cm: 4,1 px/cm); el piso de la pared en y ≈ 1240 px.
 * La malla (2,25 × 1,28 m, de 1,12 a 2,4 m del piso) es una retícula diagonal de paso 28 cm: 32 eslabones R-12 Reflex
 * Plata (~29 cm), 11 R-12 Reflex Violeta (~21 cm) en los nudos de dentro, 10 R-5 Fashion Fucsia en los huecos de dentro
 * y 12 parejas de R-5 fucsia amarrando la malla a su marco de T-260 Reflex Violeta. Debajo, una cortina de flecos violeta
 * y rosada; a cada lado, un racimo de piso (violeta reflex y fucsia) del que sale un ramo de helio: el izquierdo de 6
 * (plata, corazones rojos, corazón rosado «Me encantas», corazones violeta, «Feliz Día Mami» rosado y otro plata) y el
 * derecho de 5 (corazones violeta, rosado translúcido, corazón plata, «Feliz Día Mami» y corazones rojos). Delante, la
 * mesa con mantel «Feliz Día» de corazones, platos de pie, vasos y platitos violeta.
 */
const px260 = (x: number, y: number, z: number): Vec3 => v(r2((x - 860) / 4.1), r2((1240 - y) / 4.1), z);
const PARED_260 = -150;
const IMP_CORAZONES = "infinity-corazones-modernos-fashion-surtido";
const IMP_FELIZ_DIA_MAMI = "infinity-feliz-dia-mami-flores-fashion-surtido-rosa-silvestre";
const escena260 = (): Escena => {
  const zM = PARED_260 + 18;
  // La retícula: nudos (i, j) en x = 355 + 115·i, y = 278 + 116,75·j px (i 0…8, j 0…4); los eslabones en el centro de cada celda.
  const nudo = (i: number, j: number, dz = 0) => px260(355 + 115 * i, 278 + 116.75 * j, zM + dz);
  const centro = nudo(4, 2);
  const marcoPvc: ElementoEscenografia[] = [[0, 0, 8, 0], [8, 0, 8, 4], [8, 4, 0, 4], [0, 4, 0, 0]].map(([a, b, c, d]) => cinta(menos(nudo(a!, b!, -14), centro), menos(nudo(c!, d!, -14), centro), "#d9d6d0", 1.2, "mate"));
  const malla = suelta("malla", "Malla de globos plata y violeta", { tipo: "escenografia", elementos: marcoPvc }, centro);
  const nodos: NodoEscena[] = [malla.nodo];
  const enMalla = (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal: Vec3, giro = 0) => nodos.push(colgar({ id, nombre, pieza, padre: malla.padre, origen, normal, giroGrados: giro }).nodo);
  let k = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) {
    // Cada eslabón une los dos nudos pares de su celda (en diagonal).
    const desde = (i + j) % 2 === 0 ? nudo(i, j) : nudo(i + 1, j), hasta = (i + j) % 2 === 0 ? nudo(i + 1, j + 1) : nudo(i, j + 1);
    enMalla(`eslabon-${++k}`, `Eslabón R-12 Reflex Plata ${k}`, globo(R("R-12", 29, "981")), por(mas(desde, hasta), 0.5), menos(hasta, desde));
  }
  let violetas = 0, fucsias = 0, amarres = 0;
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 8; i++) {
    const borde = i === 0 || i === 8 || j === 0 || j === 4;
    if (!borde && (i + j) % 2 === 0) enMalla(`violeta-${++violetas}`, `R-12 Reflex Violeta del nudo ${violetas}`, globo(R("R-12", 21, "951")), nudo(i, j, 9), AL_FRENTE);
    else if (!borde) enMalla(`fucsia-${++fucsias}`, `R-5 Fashion Fucsia del hueco ${fucsias}`, globo(R("R-5", 11, "012")), nudo(i, j, 8), AL_FRENTE);
    else if ((i + j) % 2 === 1) enMalla(`amarre-${++amarres}`, `Pareja de R-5 fucsia del marco ${amarres}`, { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: { petalos: { ...R("R-5", 10, "012"), cantidad: 2, aperturaGrados: 0, giroGrados: i === 0 || i === 8 ? 0 : 90 }, centro: null } } }, nudo(i, j, 6), AL_FRENTE);
  }
  // El marco de T-260 Reflex Violeta: un tubito recto por lado (la escena cuenta los tubitos por largo).
  const lado = (id: string, nombre: string, a: Vec3, b: Vec3) => {
    const d = menos(b, a), n = unitario(d);
    const p: Pieza = { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 4, codigos: ["951"], cantidad: 1, estilo: "burbuja", largoCm: r2(largo(d)), anchoCm: 4, aperturaGrados: -90, giroGrados: 0 }, interior: null, corona: null, centro: null } } };
    enMalla(id, nombre, p, mas(a, por(n, bajoDe(p))), n);
  };
  const esquina = (i: number, j: number) => nudo(i, j, 3);
  lado("marco-arriba", "Marco de T-260 Reflex Violeta (arriba)", esquina(0, -0.1), esquina(8, -0.1));
  lado("marco-derecha", "Marco de T-260 Reflex Violeta (derecha)", esquina(8.05, -0.1), esquina(8.05, 4.1));
  lado("marco-abajo", "Marco de T-260 Reflex Violeta (abajo)", esquina(8, 4.1), esquina(0, 4.1));
  lado("marco-izquierda", "Marco de T-260 Reflex Violeta (izquierda)", esquina(-0.05, 4.1), esquina(-0.05, -0.1));
  // La cortina de flecos (escenografía, suelta): violeta al centro y rosada a los lados.
  const yFlecos = px260(0, 770, 0).y;
  nodos.push({ id: "flecos", nombre: "Cortina de flecos metalizada violeta y rosada", pieza: { tipo: "escenografia", elementos: [caja(v(0, yFlecos / 2, 0), v(120, yFlecos, 1), "#7b58c4", "metal", { dibujo: "rayas", hex: "#a68ae0", cara: "frente" }), caja(v(-82, yFlecos / 2, -0.5), v(50, yFlecos, 1), "#e7a9d4", "metal", { dibujo: "rayas", hex: "#f5d2ea", cara: "frente" }), caja(v(82, yFlecos / 2, -0.5), v(50, yFlecos, 1), "#e7a9d4", "metal", { dibujo: "rayas", hex: "#f5d2ea", cara: "frente" })] }, colocacion: { en: "libre", xCm: px260(850, 0, 0).x, yCm: 0, zCm: PARED_260 + 6, giroGrados: 0 } });
  // Los racimos de piso, cada uno con su ramo de helio (cintas sobre el racimo y los globos de las cintas).
  type Helio = { x: number; y: number; dz: number; pieza: Pieza; nombre: string };
  const R12 = (codigo: string, impreso?: string) => globo(R("R-12", 30, codigo), impreso);
  const racimoConRamo = (lado: "izquierdo" | "derecho", s: number, xBase: number, helio: readonly Helio[], nudoPx: [number, number], semilla: number) => {
    const base = px260(xBase, 1240, PARED_260 + 55);
    const puntos = [v(0, 22, 18), v(s * 22, 32, 8), v(s * 40, 48, -5), v(s * 52, 62, -15)];
    const racimo: NodoEscena = {
      id: `racimo-${lado}`, nombre: `Racimo de piso ${lado} con ramo de helio`,
      pieza: { tipo: "organico", flores: null, opciones: { ...opcionesRacimosLibres({ racimos: [{ id: "racimo", nombre: "Racimo", puntos, radioInicioCm: 36, radioFinCm: 26, mezcla: mezcla({ "R-12": 1, "R-5": 0.8 }), tapas: { inicio: true, fin: true } }], colores: [color("951", 1.1), color("012", 1)], semilla, suelo: true, relleno: [] }), inflados: { "R-12": 27, "R-5": 11 } } },
      colocacion: { en: "piso", xCm: r2(base.x + s * 22), zCm: base.z, giroGrados: 0 },
    };
    const padre: Padre = { id: racimo.id, marco: { m: IDENTIDAD, t: v(base.x, 0, base.z) } };
    const amarre = px260(nudoPx[0], nudoPx[1], base.z + 10);
    const centros = helio.map((h) => px260(h.x, h.y, base.z + h.dz));
    const cintas = cintasDesde(padre, `cintas-${lado}`, `Cintas del ramo ${lado}`, amarre, centros.map((c) => menos(c, por(unitario(menos(c, amarre)), 15))), "#d0257a");
    nodos.push(racimo, cintas.nodo);
    helio.forEach((h, n) => {
      const c = centros[n]!, dir = unitario(menos(c, amarre));
      const pieza = h.pieza;
      const giro = pieza.tipo === "globo" && pieza.impresos?.length ? giroAlFrente(dir) : pieza.tipo === "metalizado" ? -90 : 0;
      const normal = pieza.tipo === "metalizado" ? ARRIBA : dir;
      const origen = pieza.tipo === "metalizado" ? menos(c, v(0, 23, 0)) : c;
      nodos.push(colgar({ id: `helio-${lado}-${n + 1}`, nombre: `${h.nombre} (ramo ${lado})`, pieza, padre: cintas.padre, origen, normal, giroGrados: giro }).nodo);
    });
  };
  racimoConRamo("izquierdo", -1, 450, [
    { x: 375, y: 455, dz: -8, pieza: R12("981"), nombre: "R-12 Reflex Plata «Feliz Día»" },
    { x: 393, y: 565, dz: 0, pieza: R12("012", IMP_CORAZONES), nombre: "R-12 Corazones Modernos fucsia" },
    { x: 325, y: 650, dz: 12, pieza: { tipo: "globo", formatoId: "C-12", infladoCm: 28, codigo: "009" }, nombre: "Corazón C-12 rosado «Me encantas»" },
    { x: 468, y: 708, dz: 8, pieza: R12("051", IMP_CORAZONES), nombre: "R-12 Corazones Modernos violeta" },
    { x: 300, y: 805, dz: 14, pieza: R12("009", IMP_FELIZ_DIA_MAMI), nombre: "R-12 Feliz Día Mami rosado" },
    { x: 298, y: 700, dz: -12, pieza: R12("981"), nombre: "R-12 Reflex Plata de atrás" },
  ], [385, 1130], 2601);
  racimoConRamo("derecho", 1, 1300, [
    { x: 1395, y: 470, dz: -6, pieza: R12("051", IMP_CORAZONES), nombre: "R-12 Corazones Modernos violeta" },
    { x: 1262, y: 535, dz: 0, pieza: R12("009"), nombre: "R-12 rosado translúcido «Feliz Día»" },
    { x: 1385, y: 640, dz: -4, pieza: { tipo: "metalizado", metalizado: metalizadoDeTienda("corazones-plata", { pulgadas: 18 }) }, nombre: "Corazón metalizado plata" },
    { x: 1318, y: 745, dz: 10, pieza: R12("009", IMP_FELIZ_DIA_MAMI), nombre: "R-12 Feliz Día Mami rosado" },
    { x: 1320, y: 825, dz: 14, pieza: R12("012", IMP_CORAZONES), nombre: "R-12 Corazones Modernos fucsia" },
  ], [1335, 1140], 2602);
  // La mesa con el mantel «Feliz Día» y lo de encima.
  const zMesa = PARED_260 + 120, altoMesa = 88;
  const enMesa = (dx: number, dz: number): Colocacion => ({ en: "libre", xCm: r2(px260(858, 0, 0).x + dx), yCm: altoMesa, zCm: zMesa + dz, giroGrados: 0 });
  nodos.push(
    { id: "mesa", nombre: "Mesa con mantel «Feliz Día» de corazones", pieza: { tipo: "escenografia", elementos: [caja(v(0, 9, 0), v(118, 18, 56), "#f4f2ef", "madera"), caja(v(0, (altoMesa + 18) / 2, 0), v(124, altoMesa - 18, 62), "#f8f3f2", "papel", { dibujo: "texto", texto: "Feliz Día", hex: "#e2306c", cara: "frente" })] }, colocacion: { en: "piso", xCm: px260(858, 0, 0).x, zCm: zMesa, giroGrados: 0 } },
    { id: "plato-izquierdo", nombre: "Plato de pie de corazones", pieza: platos({ cantidad: 1, diametroCm: 18, hex: "#f6a8c8", motivo: { dibujo: "lunares", hex: "#e2306c" }, dePie: true, productoId: "plato-metalizado-corazones-pop" }), colocacion: enMesa(-46, -18) },
    { id: "plato-derecho", nombre: "Plato de pie rosado", pieza: platos({ cantidad: 1, diametroCm: 18, hex: "#f2a1c2", dePie: true, productoId: "plato-metalizado-corazones-pop" }), colocacion: enMesa(46, -18) },
    { id: "vasos-izquierda", nombre: "Vasos de corazones con servilleta", pieza: vasos({ cantidad: 3, altoCm: 9, diametroCm: 7, hex: "#f7b6cf", servilleta: "#e5a234", productoId: "vaso-corazones-pop" }), colocacion: enMesa(-28, -10) },
    { id: "vasos-derecha", nombre: "Vasos de corazones con servilleta lila", pieza: vasos({ cantidad: 3, altoCm: 9, diametroCm: 7, hex: "#f7b6cf", servilleta: "#a891db", productoId: "vaso-corazones-pop" }), colocacion: enMesa(26, -10) },
    { id: "platitos", nombre: "Platitos violeta", pieza: platos({ cantidad: 3, diametroCm: 15, hex: "#5b3fc0", productoId: "plato-desechable-deluxe-oxo-pequeno", variante: "lila" }), colocacion: enMesa(-2, 8) },
  );
  return { sala: sala(420, 300, 300, { paredes: "#f3f3f1", piso: "#efeeeb" }), nodos };
};

const idea260 = idea({
  numero: 260, slug: "celebra-con-mama", nombre: "Celebra con mamá: malla plata y violeta con mesa", ocasiones: ["día de la madre"],
  fotoUrl: `${CDN}DSC_7952_538713e4-5c8c-4253-a8a7-03bb77fd5d82.jpg`, escena: escena260,
  publicados: [P_FUCSIA, pub("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"), pub("GLOBO REDONDO INFINITY® CORAZONES MODERNOS", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-modernos-fashion-surtido", "C-12", null), pub("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951")],
  nota: "Igual: la malla de la foto contada globo a globo (32 eslabones R-12 Reflex Plata en diagonal, 11 R-12 Reflex Violeta en los nudos, 10 R-5 Fashion Fucsia en los huecos y 12 parejas de R-5 fucsia que la amarran al marco de T-260 Reflex Violeta), de 2,25 × 1,28 m y de 1,12 a 2,4 m del piso; la cortina de flecos violeta y rosada; los dos racimos de piso de Reflex Violeta y Fucsia con sus ramos de helio (6 y 5 globos, con los impresos Corazones Modernos en fucsia y violeta y Feliz Día Mami rosado, y un corazón metalizado plata); la mesa con mantel «Feliz Día», platos de pie, vasos de corazones con servilleta y platitos violeta. Distinto: la idea mapea Corazones Modernos como C-12, pero en la foto y en la tienda es redondo R-12; el plata «Feliz Día», el corazón rosado «Me encantas» y el rosado translúcido llevan impresos que el catálogo no trae: van lisos (Reflex Plata, C-12 y R-12 Fashion Rosado); el corazón plata va como metalizado (el C-12 no se fabrica en plata); los globos de los racimos los pone el motor orgánico; el mantel lleva el texto pero no los corazones; los platos y vasos son los «Corazones Pop» de la tienda que más se parecen.",
});

// ==========================================================================================================
// 319 · Christmas (escena: arco orgánico asimétrico sobre dos marcos dorados y panel de lentejuelas, mesita)
// ==========================================================================================================

/** Una hoja de palma dorada de papel (abanico): un medio círculo plano de frente que se abre hacia arriba (y local), con el pie en el origen. */
const palma = (radioCm: number): Pieza => ({
  tipo: "escenografia",
  elementos: [{ forma: "panel", contorno: [{ x: 0, y: 0 }, ...Array.from({ length: 11 }, (_, k) => ({ x: r2(radioCm * Math.cos(rad(15 + 15 * k))), y: r2(radioCm * Math.sin(rad(15 + 15 * k))) }))], zCm: 0, grosorCm: 0.4, hex: "#d8b95c", acabado: "papel", motivo: { dibujo: "rayas", hex: "#bf9a3e", cara: "frente" } }],
});
/** Un globo cristal R-12 con confeti dentro. */
const cristalConfeti = (colores: string[]): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-12", 29, "390"), interiores: [], relleno: { tipo: "confeti", colores, cantidad: 60 }, semilla: 319 } } });

/**
 * Foto de 1000 × 1000: los R-12 Merlot miden ~70 px (28 cm: 2,5 px/cm); la pared llega al piso en y ≈ 750 px. Dos marcos
 * de arco dorados (el de fuera de ~2,45 m, el de dentro de ~2 m) con el letrero «Merry Christmas», un panel de
 * lentejuelas plata de ~0,8 × 2,1 m a la derecha y el orgánico asimétrico que los envuelve: Merlot al pie izquierdo con
 * un R-36 crema en el piso, una columna roja y coral por el marco de dentro, Merlot arriba a la izquierda (con un R-18),
 * Pastel Dusk Crema arriba (R-18 y R-12), Coral Tropical arriba a la derecha y, por la derecha hasta el piso, Merlot y
 * rojo con un tramo coral; dos cristales con confeti y seis hojas de palma doradas. Delante, la mesita redonda de dos
 * pisos dorada con platos y vasos rojos, velas y una nochebuena.
 */
const px319 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 500) / 2.5), r2((750 - y) / 2.5), z);
const PARED_319 = -150;
const INFLADOS_319: Inflados = { "R-36": 70, "R-18": 40, "R-12": 27, "R-5": 12 };
const escena319 = (): Escena => {
  const zE = PARED_319 + 25;
  const eje = [px319(130, 720, zE + 20), px319(380, 600, zE), px319(400, 300, zE), px319(500, 130, zE), px319(760, 120, zE), px319(790, 400, zE), px319(770, 735, zE + 15)];
  const armazon = suelta("armazon", "Arco orgánico asimétrico navideño", { tipo: "escenografia", elementos: tuboPvc(eje, eje[0]!) }, eje[0]!);
  const pared = (x: number) => v(x, 0, PARED_319 + SEPARA);
  type Z = { id: string; nombre: string; plano: "pared" | "piso"; puntos: Vec3[]; radio: [number, number]; pesos: Readonly<Record<string, number>>; colores: ColorOrganico[] };
  const ZONAS: readonly Z[] = [
    { id: "merlot-pie", nombre: "Merlot del pie izquierdo", plano: "piso", puntos: [px319(125, 690, PARED_319 + 75), px319(165, 600, PARED_319 + 62), px319(235, 560, PARED_319 + 52), px319(305, 590, PARED_319 + 45)], radio: [36, 30], pesos: { "R-18": 0.3, "R-12": 1, "R-5": 0.4 }, colores: [color("018")] },
    { id: "columna-roja", nombre: "Columna roja y coral", plano: "pared", puntos: [px319(330, 640), px319(370, 540), px319(395, 440), px319(410, 350)], radio: [30, 26], pesos: { "R-12": 1, "R-5": 0.9 }, colores: [color("515", 1.2), color("059", 0.8), color("018", 0.5)] },
    { id: "merlot-arriba", nombre: "Merlot de arriba a la izquierda", plano: "pared", puntos: [px319(300, 200), px319(370, 150), px319(430, 100), px319(420, 260)], radio: [36, 30], pesos: { "R-18": 0.15, "R-12": 1, "R-5": 0.6 }, colores: [color("018")] },
    { id: "crema-arriba", nombre: "Pastel Dusk Crema de arriba", plano: "pared", puntos: [px319(460, 220), px319(510, 130), px319(600, 110), px319(650, 200)], radio: [34, 38], pesos: { "R-18": 0.3, "R-12": 1, "R-5": 0.5 }, colores: [color("107")] },
    { id: "coral-arriba", nombre: "Coral Tropical de arriba a la derecha", plano: "pared", puntos: [px319(660, 70), px319(740, 50), px319(800, 120), px319(820, 200)], radio: [34, 30], pesos: { "R-12": 1, "R-5": 0.6 }, colores: [color("059")] },
    { id: "merlot-derecha", nombre: "Merlot y rojo de la derecha", plano: "pared", puntos: [px319(740, 250), px319(810, 300), px319(790, 400), px319(700, 470)], radio: [36, 32], pesos: { "R-18": 0.1, "R-12": 1, "R-5": 0.6 }, colores: [color("018", 2), color("016", 1)] },
    { id: "coral-derecha", nombre: "Coral Tropical de la derecha", plano: "pared", puntos: [px319(690, 450), px319(760, 500), px319(800, 560)], radio: [30, 30], pesos: { "R-12": 1, "R-5": 0.6 }, colores: [color("059")] },
    { id: "merlot-pie-derecho", nombre: "Merlot y rojo del pie derecho", plano: "piso", puntos: [px319(690, 620, PARED_319 + 40), px319(740, 700, PARED_319 + 60), px319(790, 760, PARED_319 + 85), px319(860, 760, PARED_319 + 95)].map((p) => v(p.x, Math.max(28, Math.min(p.y, 95)), p.z)), radio: [32, 36], pesos: { "R-18": 0.2, "R-12": 1, "R-5": 0.7 }, colores: [color("018", 1.5), color("016", 1)] },
  ];
  const tramos = ZONAS.map((zona, k) => tramo({
    id: `tramo-${zona.id}`, nombre: `Arco: ${zona.nombre.charAt(0).toLowerCase()}${zona.nombre.slice(1)}`, padre: armazon.padre, plano: zona.plano,
    origen: zona.plano === "pared" ? pared(zona.puntos[0]!.x) : v(zona.puntos[0]!.x, SEPARA, zona.puntos[0]!.z),
    racimos: [{ id: zona.id, nombre: zona.nombre, puntos: zona.puntos, radioInicioCm: zona.radio[0], radioFinCm: zona.radio[1], mezcla: mezcla(zona.pesos), tapas: { inicio: true, fin: true } }],
    colores: zona.colores, inflados: INFLADOS_319, semilla: 3191 + k, relleno: [], variacion: 0.1,
  }));
  const de = (id: string) => tramos[ZONAS.findIndex((z) => z.id === id)]!.padre;
  const nodos: NodoEscena[] = [
    armazon.nodo, ...tramos.map((t) => t.nodo),
    // El R-36 crema del piso y un R-12 crema a su lado (delante del pie izquierdo).
    colgar({ id: "r36-crema", nombre: "R-36 Pastel Dusk Crema del piso", pieza: globo(R("R-36", 70, "107")), padre: armazon.padre, origen: v(px319(108, 0).x, r2(centroCuerpo("redondo", 70) + 1), PARED_319 + 120), normal: ARRIBA }).nodo,
    colgar({ id: "r12-crema-piso", nombre: "R-12 Pastel Dusk Crema del piso", pieza: globo(R("R-12", 27, "107")), padre: armazon.padre, origen: v(px319(205, 0).x, r2(centroCuerpo("redondo", 27) + 1), PARED_319 + 95), normal: ARRIBA }).nodo,
    apoyar("cristal-izquierdo", "Cristal con confeti plateado (izquierda)", cristalConfeti(["#d9d9de", "#f2f2f4"]), de("columna-roja"), px319(270, 550, PARED_319 + 40), v(-0.4, 0, 1)),
    apoyar("cristal-derecho", "Cristal con confeti plateado (derecha)", cristalConfeti(["#d9d9de", "#f2f2f4"]), de("merlot-derecha"), px319(830, 365, PARED_319 + 40), v(0.4, 0, 1)),
    // Las hojas de palma, metidas en la cara del orgánico (de frente, abriéndose hacia arriba), donde la foto.
    ...([[270, 455, 26, 58], [440, 400, 22, 52], [320, 555, 20, 58], [290, 715, 24, 105], [780, 620, 22, 58], [630, 700, 26, 100]] as const).map(([x, y, r, dz], k) => colgar({ id: `palma-${k + 1}`, nombre: `Hoja de palma dorada ${k + 1}`, pieza: palma(r), padre: armazon.padre, origen: px319(x, y, PARED_319 + dz), normal: ARRIBA, giroGrados: -90 }).nodo),
  ];
  // Escenografía y utilería: marcos de arco dorados, letrero, panel de lentejuelas y la mesita de dos pisos.
  const arcoMarco = (x0: number, x1: number, arriba: number): ElementoEscenografia[] => {
    const a = (px319(x1, 0).x - px319(x0, 0).x) / 2, cx = (px319(x1, 0).x + px319(x0, 0).x) / 2, yTop = px319(0, arriba).y;
    const pts: Vec3[] = [v(cx - a, 0, 0), v(cx - a, yTop - a, 0), ...Array.from({ length: 9 }, (_, k) => v(r2(cx - a * Math.cos(rad(k * 22.5))), r2(yTop - a + a * Math.sin(rad(k * 22.5))), 0)), v(cx + a, 0, 0)];
    return tuboPvc(pts, v(0, 0, 0), 1.6, "#c8a650").map((e) => (e.forma === "cilindro" ? { ...e, acabado: "metal" as const } : e));
  };
  nodos.push(
    { id: "marcos", nombre: "Marcos de arco dorados", pieza: { tipo: "escenografia", elementos: [...arcoMarco(180, 465, 120), ...arcoMarco(245, 460, 245)] }, colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: PARED_319 + 30, giroGrados: 0 } },
    { id: "letrero", nombre: "Letrero «Merry Christmas» dorado", pieza: { tipo: "escenografia", elementos: [caja(v(0, 0, 0), v(96, 50, 0.6), "#d4b45a", "metal", { dibujo: "texto", texto: "MERRY\nCHRISTMAS", hex: "#b48f3a", cara: "frente" })] }, colocacion: { en: "libre", xCm: px319(312, 0).x, yCm: px319(0, 335).y, zCm: PARED_319 + 34, giroGrados: 0 } },
    { id: "lentejuelas", nombre: "Panel de lentejuelas plata", pieza: { tipo: "escenografia", elementos: [caja(v(0, 106, 0), v(82, 212, 2), "#a79fb2", "lentejuelas")] }, colocacion: { en: "libre", xCm: px319(568, 0).x, yCm: 0, zCm: PARED_319 + 12, giroGrados: 0 } },
    { id: "mesita", nombre: "Mesita redonda dorada de dos pisos", pieza: { tipo: "escenografia", elementos: [
      { forma: "cilindro", base: v(0, 0, 0), radioCm: 30, altoCm: 1, hex: "#b49a52", acabado: "metal" },
      ...[0, 90, 180, 270].map((g): ElementoEscenografia => ({ forma: "cilindro", base: v(r2(26 * Math.sin(rad(g))), 0, r2(26 * Math.cos(rad(g)))), radioCm: 0.8, altoCm: 66, hex: "#b49a52", acabado: "metal" })),
      { forma: "cilindro", base: v(0, 38, 0), radioCm: 29, altoCm: 1.2, hex: "#3a3438", acabado: "brillante" },
      { forma: "cilindro", base: v(0, 65, 0), radioCm: 32, altoCm: 1.2, hex: "#3a3438", acabado: "brillante" },
    ] }, colocacion: { en: "piso", xCm: px319(455, 0).x, zCm: PARED_319 + 135, giroGrados: 0 } },
    { id: "platos-rojos", nombre: "Platos rojos navideños", pieza: platos({ cantidad: 2, diametroCm: 18, hex: "#c8141c", motivo: { dibujo: "texto", texto: "Navidad", hex: "#f2d48a" }, productoId: "plato-desechable-navidad" }), colocacion: { en: "libre", xCm: px319(420, 0).x, yCm: 66.2, zCm: PARED_319 + 130, giroGrados: 0 } },
    { id: "vasos-rojos", nombre: "Vasos rojos", pieza: vasos({ cantidad: 2, altoCm: 10, diametroCm: 7.5, hex: "#c8141c", productoId: "vaso-desechable-rojo-mate" }), colocacion: { en: "libre", xCm: px319(480, 0).x, yCm: 66.2, zCm: PARED_319 + 140, giroGrados: 0 } },
    { id: "vasos-rojos-abajo", nombre: "Vasos rojos (piso de abajo)", pieza: vasos({ cantidad: 3, altoCm: 10, diametroCm: 7.5, hex: "#c8141c", productoId: "vaso-desechable-rojo-mate" }), colocacion: { en: "libre", xCm: px319(450, 0).x, yCm: 39.2, zCm: PARED_319 + 140, giroGrados: 0 } },
    { id: "velas", nombre: "Velas LED", pieza: velas({ cantidad: 3, altoCm: 9, hex: "#efe6cf", productoId: null, descripcion: "velas LED" }), colocacion: { en: "libre", xCm: px319(455, 0).x, yCm: 66.2, zCm: PARED_319 + 120, giroGrados: 0 } },
    { id: "nochebuena", nombre: "Nochebuena en maceta roja", pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 6, radioArribaCm: 8, altoCm: 12, hex: "#b5121b", acabado: "satinado" }, ...bola(v(0, 18, 0), 9, "#c11622", "tela"), ...bola(v(0, 14, 0), 8, "#2d5a2e", "tela")] }, colocacion: { en: "libre", xCm: px319(470, 0).x, yCm: 66.2, zCm: PARED_319 + 110, giroGrados: 0 } },
  );
  return { sala: sala(420, 300, 310, { paredes: "#d9d5cf", piso: "#b88e66" }), nodos };
};

const idea319 = idea({
  numero: 319, slug: "christmas", nombre: "Christmas: arco orgánico Merlot, coral y crema", ocasiones: ["navidad"],
  fotoUrl: `${CDN}ideas_de_fiesta_t_o_christmas_3d188093-0184-4ec7-a70c-2bb645081e88.jpg`, escena: escena319,
  publicados: [pub("GLOBO REDONDO FASHION CORAL TROPICAL", "/products/globo-para-fiesta-latex-redondo-fashion-coral-tropical", "R-12", "059"), P_MERLOT, P_DUSK_CREMA],
  nota: "Igual: el orgánico asimétrico de la foto en sus tramos de color, con los tres productos que publica la idea —Merlot al pie izquierdo y arriba a la izquierda (con su R-18), Pastel Dusk Crema arriba (R-18 y R-12) y el R-36 crema del piso, Coral Tropical arriba a la derecha y en un tramo de la derecha—, la columna roja y coral por el marco de dentro y la caída de Merlot y rojo por la derecha hasta el piso; los dos cristales con confeti y las seis hojas de palma doradas; los dos marcos de arco dorados con el letrero «Merry Christmas», el panel de lentejuelas plata y la mesita dorada de dos pisos con platos y vasos rojos, velas y la nochebuena; pared gris claro y piso de madera. Distinto: los rojos no están publicados: medidos #a61820 → Metal Rojo 515 (los de la columna, brillantes) y #8f1813 → Rojo Imperial 016 (los de la derecha); el Coral Tropical solo se fabrica en R-5 y R-12, así que los coral grandes van en R-12; los globos de cada tramo los pone el motor orgánico (no uno a uno); los platos y vasos son los rojos de la tienda que más se parecen.",
});

// ==========================================================================================================
// 333 · Colorful Vibes Nacional 2025 (escena: dos orgánicos multicolor a los lados del panel «Happy Birthday»)
// ==========================================================================================================

/**
 * Foto de 1000 × 1000 (recortada arriba): las mesitas de alambre miden ~95 px (40 cm: 2,4 px/cm) y los R-24 ~130 px
 * (54 cm); el piso en y ≈ 960 px. En el medio, un panel blanco en arco de ~1,25 × 2,4 m con bombillos y un nicho lila
 * con el neón «Happy Birthday», sobre una tarima blanca con luces, y delante dos mesitas de alambre con la torta en un
 * soporte rosado y cupcakes. A cada lado, un orgánico de ~1,6 m de ancho y ~3 m de alto por tramos de color, de arriba
 * abajo: Verde Selva, Reflex Azul, Naranja (con un R-24), Amarillo (R-24) con Mostaza, otro racimito Reflex Azul y, hasta
 * el piso, Orquídea Morada (y Fucsia a la derecha) con R-24. Delante, el cactus con sombrero y la llama-piñata de cartón.
 */
const px333 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 510) / 2.4), r2((960 - y) / 2.4), z);
const PARED_333 = -150;
const INFLADOS_333: Inflados = { "R-24": 54, "R-18": 40, "R-12": 22, "R-5": 11 };
const escena333 = (): Escena => {
  const nodos: NodoEscena[] = [];
  type Zona = { id: string; nombre: string; plano: "pared" | "piso"; puntos: Array<[number, number]>; radio: [number, number]; pesos: Readonly<Record<string, number>>; colores: ColorOrganico[]; inflados?: Inflados };
  const lado = (s: -1 | 1, nombre: string, zonas: readonly Zona[], semilla: number) => {
    // Las zonas se dan para el lado izquierdo de la foto; el derecho es su espejo respecto al centro del panel (x = 510 px).
    const x = (px: number) => (s < 0 ? px : 1020 - px);
    const eje = [[300, 900], [280, 650], [240, 470]].map(([a, b]) => px333(x(a!), b!, PARED_333 + 30));
    const armazon = suelta(`armazon-${s < 0 ? "izquierdo" : "derecho"}`, nombre, { tipo: "escenografia", elementos: tuboPvc(eje, eje[0]!) }, eje[0]!);
    nodos.push(armazon.nodo);
    zonas.forEach((z, k) => {
      const puntos = z.puntos.map(([a, b]) => px333(x(a), b, PARED_333 + 45));
      const t = tramo({
        id: `${z.id}-${s < 0 ? "izquierda" : "derecha"}`, nombre: `${z.nombre} (${s < 0 ? "izquierda" : "derecha"})`, padre: armazon.padre, plano: z.plano,
        origen: z.plano === "pared" ? v(puntos[0]!.x, 0, PARED_333 + SEPARA) : v(puntos[0]!.x, SEPARA, PARED_333 + 45),
        racimos: [{ id: z.id, nombre: z.nombre, puntos, radioInicioCm: z.radio[0], radioFinCm: z.radio[1], mezcla: mezcla(z.pesos), tapas: { inicio: true, fin: true } }],
        colores: z.colores, inflados: z.inflados ?? INFLADOS_333, semilla: semilla + k, relleno: [], variacion: 0.1,
      });
      nodos.push(t.nodo);
    });
  };
  const comunes = (magenta: ColorOrganico[]): Zona[] => [
    { id: "verde", nombre: "Orgánico: Verde Selva", plano: "pared", puntos: [[215, 310], [290, 262], [370, 290]], radio: [26, 24], pesos: { "R-12": 1, "R-5": 0.5 }, colores: [color("032")] },
    { id: "azul", nombre: "Orgánico: Reflex Azul de arriba", plano: "pared", puntos: [[295, 360], [345, 400], [330, 445]], radio: [19, 17], pesos: { "R-12": 1 }, colores: [color("940")], inflados: { ...INFLADOS_333, "R-12": 17 } },
    { id: "naranja", nombre: "Orgánico: Naranja", plano: "pared", puntos: [[150, 425], [240, 420], [300, 470]], radio: [32, 26], pesos: { "R-24": 0.12, "R-12": 1, "R-5": 0.5 }, colores: [color("061")] },
    { id: "amarillo", nombre: "Orgánico: Amarillo y Mostaza", plano: "pared", puntos: [[95, 520], [170, 520], [260, 545], [315, 585]], radio: [32, 26], pesos: { "R-24": 0.12, "R-12": 1, "R-5": 0.7 }, colores: [{ codigo: "020", peso: 1, formatos: ["R-24"] }, { codigo: "023", peso: 2, formatos: ["R-12", "R-5"] }] },
    { id: "azul-bajo", nombre: "Orgánico: Reflex Azul de abajo", plano: "pared", puntos: [[150, 625], [225, 650]], radio: [19, 18], pesos: { "R-12": 1 }, colores: [color("940")], inflados: { ...INFLADOS_333, "R-12": 17 } },
    { id: "magenta", nombre: "Orgánico: Orquídea Morada hasta el piso", plano: "piso", puntos: [[60, 670], [180, 705], [300, 695], [360, 790], [330, 880], [200, 935]], radio: [40, 38], pesos: { "R-24": 0.15, "R-12": 1, "R-5": 0.6 }, colores: magenta },
  ];
  lado(-1, "Orgánico multicolor izquierdo", comunes([color("056")]), 3331);
  lado(1, "Orgánico multicolor derecho", comunes([{ codigo: "056", peso: 1.2, formatos: ["R-12", "R-5"] }, { codigo: "012", peso: 1, formatos: ["R-24", "R-12"] }]), 3341);
  // Escenografía: panel en arco con bombillos y neón, tarima, mesitas de alambre, torta, cupcakes, cactus y llama.
  const xC = px333(510, 0).x;
  const arcoPanel = (ancho: number, alto: number): Array<{ x: number; y: number }> => [{ x: -ancho / 2, y: 0 }, { x: ancho / 2, y: 0 }, { x: ancho / 2, y: alto - ancho / 2 }, ...Array.from({ length: 13 }, (_, k) => ({ x: r2((ancho / 2) * Math.cos(rad(15 * k))), y: r2(alto - ancho / 2 + (ancho / 2) * Math.sin(rad(15 * k))) })), { x: -ancho / 2, y: alto - ancho / 2 }];
  const BOMBILLOS: ReadonlyArray<[number, number]> = [[440, 375], [545, 375], [395, 450], [590, 450], [390, 530], [595, 530], [390, 630], [590, 630], [400, 710], [590, 700], [470, 910], [560, 910], [380, 920], [650, 920]];
  nodos.push(
    { id: "panel", nombre: "Panel blanco en arco con bombillos y neón «Happy Birthday»", pieza: { tipo: "escenografia", elementos: [
      { forma: "panel", contorno: arcoPanel(125, 240), zCm: 0, grosorCm: 8, hex: "#f4f3f1", acabado: "mate" },
      { forma: "panel", contorno: arcoPanel(80, 205).map((p) => ({ x: p.x, y: r2(p.y + 16) })), zCm: 8, grosorCm: 0.5, hex: "#e7e1f6", acabado: "satinado" },
      caja(v(0, px333(0, 490).y, 9), v(62, 34, 0.3), "#e7e1f6", "satinado", { dibujo: "texto", texto: "Happy\nBirthday", hex: "#ffffff", cara: "frente" }),
      ...BOMBILLOS.flatMap(([x, y]) => bola(v(r2(px333(x, 0).x - xC), px333(0, y).y, 9), 2.2, "#fff6dd", "satinado")),
    ] }, colocacion: { en: "libre", xCm: xC, yCm: 0, zCm: PARED_333 + 12, giroGrados: 0 } },
    { id: "tarima", nombre: "Tarima blanca con luces", pieza: { tipo: "escenografia", elementos: [caja(v(0, 9, 0), v(190, 18, 80), "#f6f5f3", "mate")] }, colocacion: { en: "piso", xCm: r2(px333(520, 0).x), zCm: PARED_333 + 70, giroGrados: 0 } },
    { id: "mesita-alta", nombre: "Mesita de alambre alta con la torta", pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 18, radioArribaCm: 14, altoCm: 45, hex: "#f1f1ef", acabado: "metal" }, { forma: "cilindro", base: v(0, 45, 0), radioCm: 14, radioArribaCm: 19, altoCm: 44, hex: "#f1f1ef", acabado: "metal" }, { forma: "cilindro", base: v(0, 89, 0), radioCm: 21, altoCm: 2, hex: "#f6f5f3", acabado: "satinado" },
      { forma: "cilindro", base: v(0, 91, 0), radioCm: 3, radioArribaCm: 9, altoCm: 14, hex: "#ec2f5c", acabado: "satinado" }, { forma: "cilindro", base: v(0, 105, 0), radioCm: 12, altoCm: 1.5, hex: "#ec2f5c", acabado: "satinado" }, { forma: "cilindro", base: v(0, 106.5, 0), radioCm: 9, altoCm: 9, hex: "#f6efe4", acabado: "mate" }, ...bola(v(0, 117, 0), 3, "#f2d522", "papel")] }, colocacion: { en: "libre", xCm: r2(px333(458, 0).x), yCm: 18, zCm: PARED_333 + 70, giroGrados: 0 } },
    { id: "mesita-baja", nombre: "Mesita de alambre baja con cupcakes", pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 20, radioArribaCm: 15, altoCm: 36, hex: "#f1f1ef", acabado: "metal" }, { forma: "cilindro", base: v(0, 36, 0), radioCm: 15, radioArribaCm: 22, altoCm: 37, hex: "#f1f1ef", acabado: "metal" }, { forma: "cilindro", base: v(0, 73, 0), radioCm: 25, altoCm: 2, hex: "#f6f5f3", acabado: "satinado" },
      ...[[-10, 0, "#45b649"], [0, 5, "#f28c28"], [10, -2, "#e94c89"], [-2, -8, "#4aa3df"]].flatMap(([x, z, hex]) => [{ forma: "cilindro" as const, base: v(x as number, 75, z as number), radioCm: 3, radioArribaCm: 3.6, altoCm: 4, hex: "#f2c14e", acabado: "papel" as const }, ...bola(v(x as number, 81, z as number), 3.4, hex as string, "satinado")])] }, colocacion: { en: "libre", xCm: r2(px333(532, 0).x), yCm: 18, zCm: PARED_333 + 92, giroGrados: 0 } },
    { id: "cactus", nombre: "Cactus de cartón con sombrero", pieza: { tipo: "escenografia", elementos: [
      { forma: "panel", contorno: [{ x: -28, y: 0 }, { x: 28, y: 0 }, { x: 30, y: 70 }, { x: 22, y: 95 }, { x: 0, y: 104 }, { x: -22, y: 95 }, { x: -30, y: 70 }], zCm: 0, grosorCm: 1, hex: "#9bd36b", acabado: "papel", motivo: { dibujo: "rayas", hex: "#7cbc4d", cara: "frente" } },
      { forma: "panel", contorno: Array.from({ length: 16 }, (_, k) => ({ x: r2(55 * Math.cos((2 * Math.PI * k) / 16)), y: r2(108 + 18 * Math.sin((2 * Math.PI * k) / 16)) })), zCm: 1, grosorCm: 1, hex: "#f3d36a", acabado: "papel" },
      { forma: "panel", contorno: [{ x: -26, y: 112 }, { x: 26, y: 112 }, { x: 18, y: 142 }, { x: -18, y: 142 }], zCm: 1.5, grosorCm: 1, hex: "#efc94f", acabado: "papel" },
    ] }, colocacion: { en: "piso", xCm: r2(px333(140, 0).x), zCm: PARED_333 + 175, giroGrados: 10 } },
    { id: "llama", nombre: "Llama-piñata de cartón", pieza: { tipo: "escenografia", elementos: [
      ...["#e94c89", "#f28c28", "#f6d32b", "#7cc35a", "#4aa3df", "#9b59b6"].map((hex, k): ElementoEscenografia => ({ forma: "panel", contorno: [{ x: -55, y: k * 14 }, { x: 55, y: k * 14 }, { x: 55, y: k * 14 + 15 }, { x: -55, y: k * 14 + 15 }], zCm: 0, grosorCm: 1, hex, acabado: "papel" })),
      { forma: "panel", contorno: [{ x: -55, y: 84 }, { x: -20, y: 84 }, { x: -18, y: 140 }, { x: -10, y: 160 }, { x: -40, y: 160 }, { x: -50, y: 130 }], zCm: 0.5, grosorCm: 1, hex: "#f6d32b", acabado: "papel", motivo: { dibujo: "rayas", hex: "#e94c89", cara: "frente" } },
    ] }, colocacion: { en: "piso", xCm: r2(px333(790, 0).x), zCm: PARED_333 + 175, giroGrados: -10 } },
  );
  return { sala: sala(440, 340, 330, { paredes: "#f3f2f0", piso: "#5f8f45" }), nodos };
};

const idea333 = idea({
  numero: 333, slug: "colorful-vibes-nacional-2025", nombre: "Colorful Vibes: orgánico multicolor con panel Happy Birthday", ocasiones: ["general"],
  fotoUrl: `${CDN}Colorful_Vibes_Nacional_2025_aae1b404-95a9-47ce-a9a2-4251e4eb4127.png`, escena: escena333,
  publicados: [
    P_FUCSIA, pub("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020"),
    pub("GLOBO REDONDO FASHION VERDE SELVA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-selva", "R-12", "032"),
    pub("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"),
    pub("GLOBO REDONDO FASHION ORQUIDEA MORADA", "/products/globo-para-fiesta-latex-redondo-fashion-orquidea-morada", "R-12", "056"),
    pub("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940"),
    pub("GLOBO REDONDO FASHION MOSTAZA", "/products/globo-para-fiesta-latex-redondo-fashion-mostaza", "R-12", "023"),
    pub("GLOBO TUBITO FASHION FUCSIA", "/products/globo-para-fiesta-latex-tubito-fashion-fucsia", "T-260", "012"),
    pub("GLOBO TUBITO FASHION NARANJA", "/products/globo-para-fiesta-latex-tubito-fashion-naranja", "T-260", "061"),
    pub("GLOBO TUBITO REFLEX AZUL", "/products/globo-para-fiesta-latex-tubito-reflex-azul", "T-260", "940"),
    pub("GLOBO TUBITO FASHION AMARILLO", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", "T-260", "020"),
  ],
  nota: "Igual: los dos orgánicos de la foto a los lados del panel (~1,6 × 3 m cada uno), en sus tramos de color y con los colores que publica la idea —Verde Selva arriba, Reflex Azul, Naranja con su R-24, Amarillo (R-24) con Mostaza, otro racimito Reflex Azul y Orquídea Morada hasta el piso con R-24 (a la derecha, también Fucsia)—; el panel blanco en arco con bombillos y el nicho lila con el neón «Happy Birthday», la tarima, las dos mesitas de alambre con la torta en su soporte rosado y los cupcakes, el cactus con sombrero y la llama-piñata de cartón y el piso de pasto. Distinto: los globos de cada tramo los pone el motor orgánico (no uno a uno) y el lado derecho repite el trazado del izquierdo en espejo (en la foto es parecido, no igual); los tubitos que publica la idea no se ven en la foto y quedan en la lista sin cantidad; el cactus y la llama son siluetas sencillas.",
});

/** Ideas de fiesta de sempertex.com digitalizadas: lote 10. */
export const LOTE_10: readonly IdeaDigitalizada[] = [idea796, idea836, idea904, idea927, idea980, idea51, idea260, idea286, idea319, idea333];
