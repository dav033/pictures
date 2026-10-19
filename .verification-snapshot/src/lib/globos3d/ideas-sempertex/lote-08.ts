import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { centroCuerpo } from "../geometria";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import type { ElementoEscenografia } from "../escenografia";
import { platos, productoDe, vasos } from "../utileria";
import { opcionesRacimosLibres } from "../estructuras-organicas";
import { RELLENO_TUPIDO, type PuntoMezcla } from "../organico";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesFlorTubito, PropiedadesMono } from "../figuras";
import type { PropiedadesRizo } from "../rizos";
import type { PropiedadesCalabaza } from "../halloween";
import type { OpcionesForma } from "../formas";
import { impresoPorId, type ImpresoEnPieza } from "../impresos-catalogo";
import type { Vec3 } from "../modulos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 08** (los números de `clasif/lote-08.json`: una guirnalda
 * orgánica con cerezas, dos figuras de flores, tres columnas con flor, flores navideñas, un topiario de fútbol, la
 * guirnalda de grado con cortina, dos coronas de Link-O-Loon, dos ramos de Pascua, seis paredes —trenzas, mallas de
 * Link-O-Loon, celdas, orgánica— y la columna de Halloween).
 *
 * Cómo se hizo (2026-10-07), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, ampliada con rejilla:
 * - **Conteo**: los globos visibles, uno a uno en las piezas chicas (flores, coronas, columnas, mallas con globos
 *   encima, cuyas posiciones salen de la foto). Ninguna idea del lote publica «Materiales» con cantidades: lo contado
 *   va con `contada: true`. En lo orgánico (guirnaldas, la malla naval) y en los rellenos de pared el motor da los
 *   globos para el tamaño medido (no se cuentan uno a uno: la nota lo dice).
 * - **Medidas**: la escala sale de un globo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-12 ≈ 25 cm de
 *   cuarteto o 28 cm de ramo, T-260 ≈ 5 cm de grueso) y con ella alturas, anchos y posiciones (px → cm, dichas en el
 *   comentario de cada idea).
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice).
 *   Si no, se midió en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla
 *   oficial) y se tomó el código más cercano que se fabrica en ese formato; si un Fashion queda a ≤ 6 ΔE del más
 *   cercano, el Fashion.
 * - **Impresos**: los de `impresos-catalogo.ts` (productos reales de la tienda) cuando la foto los tiene; si la tienda
 *   no tiene ese impreso, el más parecido o el liso del color de fondo (la nota lo dice).
 * - **Estructuras**: cada estructura es un nodo raíz y lo suyo cuelga de ella (`sobre`/`ancla`), para que
 *   `extraerConjunto` saque «esta estructura con sus decoraciones». Lo que va puesto en un punto exacto (una flor
 *   arriba de una columna, una calabaza, los globos de helio) cuelga de un **amarre** (escenografía mínima sin globos:
 *   lo que cuelga de él queda donde se dice, sin que el contacto lo empuje).
 * Unidades: cm. Espacio de cada escena: y arriba, +z hacia quien mira; los puntos `sobre` van en el espacio local del
 * padre.
 */

// ----------------------------------------------------------------------------------------------------------
// Ayudas de geometría
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

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });

const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos?: Partial<Sala["tonos"]>): Sala => {
  const s = structuredClone(SALA_INICIAL);
  return { ...s, anchoCm, fondoCm, altoCm, tonos: { ...s.tonos, ...(tonos ?? {}) } };
};

/** Nombre de un globo para su nodo: «R-12 Fashion Verde Lima». */
function nombreGlobo(g: ParteGlobo): string {
  return `${g.formatoId} ${referenciaPorCodigo(g.codigo)?.nombreCompleto ?? g.codigo}`;
}

/** Un globo suelto como pieza (con su impreso de la tienda, si lo lleva). */
const piezaGlobo = (g: ParteGlobo, impresoId?: string): Pieza =>
  ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(g.helio ? { helio: true as const } : {}), ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) });

/**
 * Un globo `sobre` su padre, con el centro de su cuerpo en `centro` (espacio local del padre) y el cuerpo hacia
 * `direccion`. La colocación `sobre` apoya lo más bajo de la pieza (el nudo) en el punto, hundido 1,5 cm: se corrige.
 * Si el padre tiene globos debajo, el contacto lo corre a lo largo de la dirección hasta apoyarlo en ellos.
 */
function globoSobre(id: string, nombre: string, padreId: string, g: ParteGlobo, centro: Vec3, direccion: Vec3 = ARRIBA, impresoId?: string): NodoEscena {
  const n = unitario(direccion);
  const p = menos(centro, por(n, centroCuerpo("redondo", g.infladoCm) - HUNDIMIENTO_SOBRE_CM));
  return { id, nombre, pieza: piezaGlobo(g, impresoId), colocacion: { en: "sobre", padreId, puntoCm: redondo(p), normal: redondo(n), giroGrados: 0 } };
}

/** Lo mismo, dado el nudo (un eslabón de Link-O-Loon que va de nudo a nudo, una cereza colgada de su tallo). */
function globoDesdeNudo(id: string, nombre: string, padreId: string, g: ParteGlobo, nudo: Vec3, direccion: Vec3, impresoId?: string): NodoEscena {
  const n = unitario(direccion);
  return { id, nombre, pieza: piezaGlobo(g, impresoId), colocacion: { en: "sobre", padreId, puntoCm: redondo(mas(nudo, por(n, HUNDIMIENTO_SOBRE_CM))), normal: redondo(n), giroGrados: 0 } };
}

/** Una pieza `sobre` su padre, con su espalda en `espalda` (espacio local del padre) mirando a `normal`. */
function piezaSobre(id: string, nombre: string, padreId: string, pieza: Pieza, espalda: Vec3, normal: Vec3, giroGrados = 0): NodoEscena {
  const n = unitario(normal);
  return { id, nombre, pieza, colocacion: { en: "sobre", padreId, puntoCm: redondo(mas(espalda, por(n, HUNDIMIENTO_SOBRE_CM))), normal: redondo(n), giroGrados } };
}
const decoSobre = (id: string, nombre: string, padreId: string, decoracion: Decoracion, espalda: Vec3, normal: Vec3, giroGrados = 0, impresos?: ImpresoEnPieza[]): NodoEscena =>
  piezaSobre(id, nombre, padreId, { tipo: "decoracion", decoracion, ...(impresos?.length ? { impresos } : {}) }, espalda, normal, giroGrados);

type Tubito = { formatoId: string; grosorCm: number; codigo: string };

/**
 * Un tubito recto de `desde` a `hasta` (en el espacio local del padre; `aLocal` lleva un vector relativo del mundo a ese
 * espacio, p. ej. `enAmarre`): una cadena de una sola burbuja de ese largo (un rizo «burbujas» recto, que cuelga por
 * −z de su amarre), así cuenta su largo una vez. La colocación `sobre` arma su marco con la normal en el mundo: el giro
 * que lleva su −z a la dirección del tubito sale de ese marco (el mismo de `marcoDeAncla`).
 */
function palito(id: string, nombre: string, padreId: string, t: Tubito, desde: Vec3, hasta: Vec3, aLocal: (p: Vec3) => Vec3 = (p) => p): NodoEscena {
  const d = menos(hasta, desde), u = unitario(d);
  const quitar = (w: Vec3) => menos(w, por(u, u.x * w.x + u.y * w.y + u.z * w.z));
  const n = largo(quitar(AL_FRENTE)) > 0.2 ? unitario(quitar(AL_FRENTE)) : unitario(quitar(ARRIBA));
  const auxiliar = Math.abs(n.y) < 0.9 ? ARRIBA : v(1, 0, 0);
  const xL = unitario(cruz(auxiliar, n)), zL = cruz(n, xL);
  const s = u.x * xL.x + u.y * xL.y + u.z * xL.z, c = -(u.x * zL.x + u.y * zL.y + u.z * zL.z);
  const giro = r2((Math.atan2(s, c) * 180) / Math.PI);
  const cadena: PropiedadesRizo = { forma: "burbujas", formatoId: t.formatoId, grosorCm: t.grosorCm, codigos: [t.codigo], largosCm: [r2(largo(d))], recorrido: "recta", cantidad: 1 };
  return decoSobre(id, nombre, padreId, rizo(cadena), aLocal(menos(desde, por(n, t.grosorCm / 2))), aLocal(n), giro);
}

/** Una cinta (escenografía: no cotiza) de `desde` a `hasta`, en el espacio de la pieza que la lleva. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2, acabado: ElementoEscenografia["acabado"] = "satinado"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
const florTubito = (p: Partial<PropiedadesFlorTubito> & Pick<PropiedadesFlorTubito, "petalos">): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { interior: null, corona: null, centro: null, ...p } });
const mono = (p: PropiedadesMono): Decoracion => ({ tipo: "mono", propiedades: p });
const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });
const burbujas = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const lazos = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, anchoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados, giroGrados });

/**
 * El **amarre**: un disquito de cinta (escenografía, no cotiza) puesto `sobre` una estructura con la normal hacia
 * arriba y girado 90°, así su espacio local queda alineado con el mundo como (x, y, −z). No tiene globos: lo que
 * cuelga de él va exactamente donde se dice (el contacto con los globos de la estructura no lo corre).
 */
function amarre(id: string, nombre: string, padreId: string, punto: Vec3, hex: string): NodoEscena {
  return {
    id, nombre, pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 2.5, altoCm: 0.6, hex, acabado: "satinado" }] },
    colocacion: { en: "sobre", padreId, puntoCm: redondo(mas(punto, v(0, HUNDIMIENTO_SOBRE_CM, 0))), normal: ARRIBA, giroGrados: 90 },
  };
}
/** Un vector del mundo (relativo al amarre) en el espacio local del amarre: (x, y, z) → (x, y, −z). */
const enAmarre = (p: Vec3): Vec3 => v(p.x, p.y, -p.z);

/** Soporte de pared o base escondida (escenografía, no cotiza): un disco del que cuelga todo, sin globos. */
const soporte = (radioCm: number, altoCm: number, hex: string): Pieza => ({ tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm, hex, acabado: "satinado" }] });

/** Mezcla orgánica igual en todo el recorrido. */
const mezclaFija = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];

/** La altura de lo más alto de una pieza armada (para apoyar algo encima). */
const topeDe = (pieza: Pieza): number => armarPieza(pieza).caja.max.y;

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos). */
function lisoDeTienda(formatoId: string, codigo: string): { nombre: string; url: string } {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  if (fila) return { nombre: fila.nombre, url: fila.url };
  const x = productoDeGlobo(formatoId, codigo);
  return { nombre: x.nombre, url: quitarOrigen(x.url) };
}

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
 * Los productos de una idea a partir de lo armado (que es lo contado en la foto): cada impreso de la tienda por formato
 * y color de fondo; los lisos (lo que queda de cada formato y código, en globos o tubitos enteros); y la utilería que
 * es un producto de la tienda (no la genérica). Lo que la idea publica sale con su nombre y url tal cual (si la foto
 * no lo tiene, sin cantidad); lo demás, con el producto liso de la tienda.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[] = []): ProductoDeIdea[] {
  const armada = armarEscena(escena);
  const usados = new Set<Publicado>();
  const salida: ProductoDeIdea[] = [];
  const impresos = new Map<string, UsoImpreso>();
  const utileria = new Map<string, { nombre: string; url: string; cantidad: number }>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    if (!copias) continue;
    for (const u of usoDeImpresos(nodo.pieza)) {
      const k = `${u.impresoId}|${u.formatoId}|${u.codigo}`;
      const previo = impresos.get(k) ?? { ...u, cantidad: 0 };
      previo.cantidad += u.cantidad * copias;
      impresos.set(k, previo);
    }
    if (nodo.pieza.tipo === "escenografia") for (const p of nodo.pieza.productos ?? []) {
      if (p.generico || !p.url.startsWith("/products/")) continue;
      const previo = utileria.get(p.url) ?? { nombre: p.nombre, url: p.url, cantidad: 0 };
      previo.cantidad += p.cantidad * copias;
      utileria.set(p.url, previo);
    }
  }
  const lisos = new Map<string, { formatoId: string; codigo: string; cantidad: number }>();
  for (const m of armada.materiales) {
    const k = `${m.formatoId}|${m.codigo}`;
    const previo = lisos.get(k) ?? { formatoId: m.formatoId, codigo: m.codigo, cantidad: 0 };
    previo.cantidad += m.cantidad;
    lisos.set(k, previo);
  }
  for (const u of impresos.values()) {
    const i = impresoPorId(u.impresoId)!;
    const l = lisos.get(`${u.formatoId}|${u.codigo}`);
    if (l) l.cantidad -= u.cantidad;
    const p = publicados.find((x) => x.url === i.url);
    if (p) usados.add(p);
    salida.push({ nombre: p?.nombre ?? i.nombre, url: i.url, formato: u.formatoId, codigo: u.codigo, cantidad: u.cantidad, contada: true });
  }
  for (const m of lisos.values()) {
    if (m.cantidad <= 1e-9) continue;
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const p = publicados.find((x) => x.codigo === m.codigo && x.formato !== null && formatoPorId(x.formato)?.tipo === tipo);
    if (p) usados.add(p);
    const base = p ?? lisoDeTienda(m.formatoId, m.codigo);
    salida.push({ nombre: base.nombre, url: base.url, formato: m.formatoId, codigo: m.codigo, cantidad: Math.ceil(m.cantidad - 1e-9), contada: true });
  }
  for (const u of utileria.values()) {
    const p = publicados.find((x) => x.url === u.url);
    if (p) usados.add(p);
    salida.push({ nombre: u.nombre, url: u.url, formato: null, codigo: null, cantidad: u.cantidad, contada: true });
  }
  for (const p of publicados) if (!usados.has(p)) salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: null });
  return salida;
}

/**
 * La idea perezosa (`ideaPerezosa`): su escena se arma la primera vez que se pide y sus productos salen de armar esa
 * escena (los orgánicos tardan unas décimas); importar el lote no arma nada.
 */
function idea(base: Omit<IdeaDigitalizada, "productos" | "contenido" | "clase"> & { escena: () => Escena }, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const { escena, ...resto } = base;
  return ideaPerezosa({ ...resto, clase: "escena" }, () => ({ tipo: "escena", escena: escena() }), (c) => (c.tipo === "escena" ? productosDe(c.escena, publicados) : []));
}

const P = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });
const FOTO = (archivo: string) => `https://sempertex.com/cdn/shop/articles/${archivo}`;

// Impresos de la tienda que usa el lote (ids de `impresos-catalogo.ts`).
const BALON = "infinity-balon-de-futbol-fashion-blanco";
const GRAFFITI_INVIERNO = "infinity-graffiti-invierno-fashion-transparente";
const GRAFFITI_ROSA = "infinity-graffiti-rosa-fashion-transparente";
const GRAFFITI_CIELO = "infinity-graffiti-cielo-fashion-transparente";
const FELIZ_GRADO = "2-caras-mensajes-grado-reflex-plata";

// ----------------------------------------------------------------------------------------------------------
// 581 · Figura de amor y amistad (guirnalda orgánica con tres moños de cerezas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: los R-5 miden ~40–50 px (10–12,5 cm: 4 px/cm), los R-12 90–118 px (22–29 cm) y los grandes
 * 130–160 px (R-18 a 32–40 cm). La guirnalda va de x 88 a 940 (2,13 m) y mide ~88 cm de alto; son tres zonas de color:
 * la izquierda coral (Fucsia: 11 globos), la del medio frambuesa (11, sin grandes) y la derecha magenta (Rosa: 13),
 * cada globo contado con su centro y su diámetro. Tres moños de T-260 (~29 cm de ancho) con dos colas (23–35 cm) que
 * acaban cada una en un corazón rojo (C-12 de ~16 cm, la punta arriba: las cerezas). Origen: el centro de la guirnalda
 * (px 514, 420), en la pared.
 */
const px581 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 514) / 4), r2((420 - y) / 4), z);
const PARED_581 = -150;
const ALTO_581 = 160;
/** Cada globo de la foto: centro (px), diámetro (px) y su formato según el tamaño. */
type Globo581 = [number, number, number];
const ZONAS_581: ReadonlyArray<{ id: string; nombre: string; codigo: string; centro: [number, number]; globos: readonly Globo581[] }> = [
  { id: "fucsia", nombre: "Fucsia", codigo: "012", centro: [260, 420], globos: [
    [165, 515, 160], [229, 304, 118], [322, 328, 90], [329, 385, 103], [382, 465, 95], [293, 485, 110],
    [145, 395, 45], [185, 365, 50], [180, 422, 45], [225, 385, 45], [262, 360, 40],
  ] },
  { id: "frambuesa", nombre: "Frambuesa", codigo: "014", centro: [490, 420], globos: [
    [398, 340, 100], [571, 330, 100], [580, 441, 110], [505, 371, 80], [485, 503, 100], [440, 400, 80], [390, 540, 80],
    [455, 292, 42], [467, 318, 50], [502, 312, 40], [447, 362, 45],
  ] },
  { id: "rosa", nombre: "Rosa", codigo: "011", centro: [770, 420], globos: [
    [797, 312, 160], [782, 515, 130], [801, 333, 112], [885, 415, 115], [670, 340, 110], [727, 412, 95], [677, 495, 108],
    [677, 355, 50], [625, 372, 45], [655, 407, 50], [800, 407, 50], [857, 400, 60], [845, 452, 55],
  ] },
];
/** El formato por el tamaño medido: R-5 hasta 12,7 cm, R-9 hasta 17, R-12 hasta 30 y R-18 de ahí arriba. */
function globo581(codigo: string, diametroPx: number): ParteGlobo {
  const d = r2(diametroPx / 4);
  if (d <= 12.7) return R("R-5", d, codigo);
  if (d <= 17) return R("R-9", d, codigo);
  if (d <= 30) return R("R-12", d, codigo);
  return R("R-18", d, codigo);
}
/** Cada moño (un T-260: dos lazos y dos colas), su zona, su nudo (px) y el largo medio de sus colas en la foto. */
const MONOS_581: ReadonlyArray<{ id: string; nombre: string; nudo: [number, number]; colaCm: number }> = [
  { id: "izquierdo", nombre: "izquierdo", nudo: [227, 415], colaCm: 23 },
  { id: "centro", nombre: "del centro", nudo: [455, 417], colaCm: 33 },
  { id: "derecho", nombre: "derecho", nudo: [757, 460], colaCm: 35 },
];
const mono581 = (colaCm: number) => mono({ formatoId: "T-260", grosorCm: 3.8, codigo: "570", lazosPorLado: 1, largoLazoCm: 14, anchoLazoCm: 9, aberturaGrados: 0, colas: true, largoColaCm: colaCm, centro: null });
const CEREZA_581 = R("C-12", 16, "015");
/** La punta de cada cola del moño (`armarMono`: bajan a 28° de la vertical), en el espacio del moño (x, frente, arriba). */
const puntaCola581 = (colaCm: number, lado: number): Vec3 => { const phi = -Math.PI / 2 + lado * rad(28); return v(r2(Math.cos(phi) * colaCm), -0.8, r2(Math.sin(phi) * colaCm)); };
const escena581 = (): Escena => ({
  sala: sala(420, 300, 300, { paredes: "#f4f2ef" }),
  nodos: [
    { id: "soporte", nombre: "Soporte de la guirnalda (no se ve)", pieza: soporte(4, 1.5, "#efefef"), colocacion: { en: "libre", xCm: 0, yCm: ALTO_581, zCm: PARED_581 + 10, giroGrados: 0 } },
    ...ZONAS_581.flatMap((z) => z.globos.map(([x, y, d], k) => {
      const g = globo581(z.codigo, d);
      // El nudo contra la pared (los grandes) y los chicos por delante, mirando un poco hacia fuera de su zona.
      const delante = g.formatoId === "R-5" ? 18 : g.formatoId === "R-9" ? 12 : g.formatoId === "R-12" ? 5 : 0;
      const direccion = unitario(v((x - z.centro[0]) / 400, (z.centro[1] - y) / 400, 1));
      return globoSobre(`${z.id}-${k + 1}`, `${nombreGlobo(g)} (zona ${z.nombre}, ${k + 1})`, "soporte", g, px581(x, y, r2(centroCuerpo("redondo", g.infladoCm) + delante)), direccion);
    })),
    ...MONOS_581.flatMap((m): NodoEscena[] => {
      const id = `mono-${m.id}`;
      return [
        decoSobre(id, `Moño de las cerezas (${m.nombre})`, "soporte", mono581(m.colaCm), px581(m.nudo[0], m.nudo[1], 46), AL_FRENTE),
        ...[-1, 1].map((lado, k) => globoDesdeNudo(`cereza-${m.id}-${k + 1}`, `Corazón C-12 Fashion Rojo (moño ${m.nombre}, ${k + 1})`, id, CEREZA_581, puntaCola581(m.colaCm, lado), v(0, 0, -1))),
      ];
    }),
  ],
});
const idea581 = idea({
  id: "idea:figura-de-amor-y-amistad-1", numero: 581, slug: "figura-de-amor-y-amistad-1", nombre: "Guirnalda de amor y amistad con cerezas", ocasiones: ["san-valentin"],
  fotoUrl: FOTO("Figura_Amor_y_amistad.jpg"), escena: escena581,
  nota: "Igual: guirnalda de pared de ~2,1 × 0,9 m con sus 35 globos contados uno a uno, cada uno en su sitio y a su tamaño, en las tres zonas de color de la foto —coral a la izquierda (Fashion Fucsia 012, medido #da527c: 1 R-18, 5 R-12 y 5 R-5), frambuesa al medio (Fashion Frambuesa 014, medido #b62650: 7 R-12 y 4 R-5, sin grandes) y magenta a la derecha (Fashion Rosa 011, medido #cc3a7f: 2 R-18, 5 R-12, 2 R-9 y 4 R-5)— y tres moños de T-260 Metal Dorado con dos colas cada uno que acaban en un corazón C-12 Fashion Rojo con la punta arriba (las cerezas), con los productos que publica la idea (los grandes y los chicos son el mismo producto en otra talla). Distinto: los moños de la foto se ven verde metalizado (medido #767046): va el T-260 Metal Dorado 570 que publica la idea; el Fashion Rosado 009 publicado no se ve (sin cantidad); las colas bajan parejas a los lados (en la foto una de cada moño se va de lado); el soporte de pared no se ve (no cotiza).",
}, [
  P("GLOBO REDONDO FASHION FRAMBUESA", "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", "R-12", "014"),
  P("GLOBO REDONDO FASHION ROSA", "/products/globo-latex-redondo-fashion-rosa", "R-12", "011"),
  P("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
  P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
  P("GLOBO CORAZON FASHION ROJO", "/products/globo-para-fiesta-latex-corazon-fashion-rojo", "C-12", "015"),
  P("GLOBO TUBITO METAL DORADO", "/products/globo-para-fiesta-latex-tubito-metal-dorado-cobre", "T-260", "570"),
]);

// ----------------------------------------------------------------------------------------------------------
// 582 · Figura de amor y amistad (dos flores con tallo, ramitas y moño)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: los dos tubitos torcidos del tallo miden ~32 px cada uno (T-260 a ~5 cm: 6,4 px/cm); la figura
 * mide 910 px (1,42 m) del moño al pétalo de arriba. Flor lila de 6 pétalos (~16 cm) con un centro verde de ~12,5 cm y
 * un anillo de burbujitas verdes; flor malva de 5 pétalos (~22 cm) con un racimo de burbujas verdes al centro; dos
 * ramitas de burbujas rosadas y verdes; abajo un moño grande Silk Dorado (dos lazos arriba y dos abajo que hacen de
 * patas) con su bolita. Origen: el piso bajo el moño (px 505, 960).
 */
const px582 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 505) / 6.4), r2((960 - y) / 6.4), z);
const TALLO_582: Tubito = { formatoId: "T-260", grosorCm: 4.5, codigo: "126" };
const RAMITA_582: PropiedadesRizo = { forma: "burbujas", formatoId: "T-260", grosorCm: 4.2, codigos: ["126", "809", "809"], largosCm: [3.5, 4.5, 4.5], recorrido: "recta", cantidad: 6 };
const escena582 = (): Escena => ({
  sala: sala(320, 280, 280),
  nodos: [
    { id: "base", nombre: "Base de la figura (no se ve en la foto)", pieza: soporte(10, 1.5, "#e9e4da"), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    ...[-1.6, 1.6].map((dx, k) => palito(`tallo-lila-${k + 1}`, `Tallo torcido de la flor lila (${k + 1})`, "base", TALLO_582, mas(px582(452, 300, -3), v(dx, 0, 0)), mas(px582(500, 755, -3), v(dx * 0.5, 0, 0)))),
    ...[-1.6, 1.6].map((dx, k) => palito(`tallo-malva-${k + 1}`, `Tallo torcido de la flor malva (${k + 1})`, "base", TALLO_582, mas(px582(548, 560, -3), v(dx, 0, 0)), mas(px582(512, 755, -3), v(dx * 0.5, 0, 0)))),
    decoSobre("flor-lila", "Flor lila de 6 pétalos", "base", flor({ petalos: { ...R("R-12", 16, "650"), cantidad: 6, aperturaGrados: 8, giroGrados: 0 }, corona: { ...R("R-5", 5.2, "126"), cantidad: 8 }, centro: { ...R("R-5", 12.5, "126"), cantidad: 1 } }), px582(455, 160, 1), v(0, 0.15, 1)),
    decoSobre("flor-malva", "Flor malva de 5 pétalos", "base", flor({ petalos: { ...R("R-12", 22, "809"), cantidad: 5, aperturaGrados: 5, giroGrados: 60 }, corona: { ...R("R-5", 6, "126"), cantidad: 8 }, centro: { ...R("R-5", 6, "126"), cantidad: 3 } }), px582(560, 525, 4), AL_FRENTE),
    decoSobre("ramita-derecha", "Ramita de burbujas rosadas y verdes (derecha)", "base", rizo(RAMITA_582), px582(650, 392, 0), AL_FRENTE, 160),
    decoSobre("ramita-izquierda", "Ramita de burbujas rosadas y verdes (izquierda)", "base", rizo(RAMITA_582), px582(440, 600, 0), AL_FRENTE, -90),
    decoSobre("mono", "Moño Silk Dorado (las patas de la figura)", "base", mono({ formatoId: "T-260", grosorCm: 5, codigo: "870", lazosPorLado: 2, largoLazoCm: 21, anchoLazoCm: 15, aberturaGrados: 85, colas: false, largoColaCm: 0, centro: R("R-5", 6.2, "870") }), px582(505, 775, 6), AL_FRENTE),
  ],
});
const idea582 = idea({
  id: "idea:figura-de-amor-y-amistad", numero: 582, slug: "figura-de-amor-y-amistad", nombre: "Figura de amor y amistad: dos flores con moño", ocasiones: ["san-valentin"],
  fotoUrl: FOTO("Figura_amor_y_amistad_2.jpg"), escena: escena582,
  nota: "Igual: figura de ~1,4 m con la flor lila de 6 pétalos arriba (centro verde y anillo de 8 burbujitas verdes), la flor malva de 5 pétalos (~22 cm) con su racimo verde al centro, dos tallos de dos T-260 Té Verde torcidos, dos ramitas de burbujas rosadas y verdes y el moño Silk Dorado grande de abajo (dos lazos arriba, dos de patas y la bolita del centro), con los productos que publica la idea: Silk Dorado 870, Silk Rosa Primaveral 809 (los pétalos malva y las burbujas rosadas: la foto los mide más cromados y fucsia, #9b7b7c y #e985a7) y Pastel Dusk Té Verde 126. Distinto: los pétalos lilas no son de ningún producto publicado (medido #e0ddf1, el lila más cercano es Pastel Mate Lila 650); las burbujitas verdes de los centros son de tubito en la foto y aquí R-5 al mínimo; la base que sostiene la figura no se ve (escenografía, no cotiza); Fashion Rosa 011 y Satín Blanco 405 publicados no se ven (sin cantidad); los tallos van rectos.",
}, [
  P("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870"),
  P("GLOBO REDONDO SILK ROSA PRIMAVERAL", "/products/globo-latex-redondo-silk-rosa-primaveral", "R-12", "809"),
  P("GLOBO REDONDO FASHION ROSA", "/products/globo-latex-redondo-fashion-rosa", "R-12", "011"),
  P("GLOBO REDONDO PASTEL DUSK TÉ VERDE", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-te-verde", "R-12", "126"),
  P("GLOBO REDONDO SATIN BLANCO", "/products/globo-para-fiesta-latex-redondo-satin-blanco", "R-12", "405"),
  P("GLOBO TUBITO SILK DORADO", "/products/globo-latex-tubito-silk-rocio-de-oro", "T-260", "870"),
  P("GLOBO TUBITO SILK ROSA PRIMAVERAL", "/products/globo-latex-tubito-silk-rosa-primaveral", "T-260", "809"),
]);

// ----------------------------------------------------------------------------------------------------------
// 595 · Flor corazones dobles (de pared)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-12 impresos miden ~140 px (25 cm: 5,6 px/cm). Cinco pétalos R-12 rojos de corazones blancos,
 * encima una florecita de 5 R-5 blancos con un R-5 rojo al centro, y alrededor un aro de 10 R-9 blancos (~20 cm) con un
 * R-5 rojo (~8 cm) cada dos. Origen: el centro de la flor (px 360, 290).
 */
const px595 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 360) / 5.6), r2((290 - y) / 5.6), z);
const BLANCOS_595: ReadonlyArray<[number, number]> = [[275, 85], [385, 70], [530, 140], [590, 235], [565, 395], [490, 465], [325, 490], [230, 455], [150, 310], [155, 195]];
const ROJOS_595: ReadonlyArray<[number, number]> = [[210, 130], [460, 95], [595, 315], [175, 385], [405, 500]];
const radial595 = (x: number, y: number): Vec3 => unitario(px595(x, y, 0));
const escena595 = (): Escena => ({
  sala: sala(320, 280, 280),
  nodos: [
    { id: "soporte", nombre: "Soporte de pared (no se ve)", pieza: soporte(3, 1.5, "#efefef"), colocacion: { en: "libre", xCm: 0, yCm: 150, zCm: -138, giroGrados: 0 } },
    decoSobre("flor-corazones", "Flor de 5 R-12 de corazones", "soporte", flor({ petalos: { ...R("R-12", 25, "015"), cantidad: 5, aperturaGrados: 0, giroGrados: -10 }, centro: null }), v(0, 0, 4), AL_FRENTE, 0, [{ impresoId: "infinity-corazones-por-siempre-fashion-rojo", codigo: "015" }]),
    decoSobre("flor-blanca", "Florecita blanca con centro rojo", "soporte", flor({ petalos: { ...R("R-5", 12, "806"), cantidad: 5, aperturaGrados: 0, giroGrados: 90 }, centro: { ...R("R-5", 9.8, "015"), cantidad: 1 } }), v(0, 0, 27), AL_FRENTE),
    ...BLANCOS_595.map(([x, y], k) => globoSobre(`aro-blanco-${k + 1}`, `R-9 Silk Blanco Nácar del aro (${k + 1})`, "soporte", R("R-9", 20.5, "806"), px595(x, y, 10), radial595(x, y))),
    ...ROJOS_595.map(([x, y], k) => globoSobre(`aro-rojo-${k + 1}`, `R-5 Fashion Rojo del aro (${k + 1})`, "soporte", R("R-5", 8, "015"), px595(x, y, 12), radial595(x, y))),
  ],
});
const idea595 = idea({
  id: "idea:flor-corazones-dobles", numero: 595, slug: "flor-corazones-dobles", nombre: "Flor de corazones dobles", ocasiones: ["san-valentin"],
  fotoUrl: FOTO("27c854ad26216d2c684c05b370b3d15a.jpg"), escena: escena595,
  nota: "Igual: flor de pared de ~1 m: 5 pétalos R-12 rojos impresos con corazones blancos (el Infinity® Corazones por Siempre Fashion Rojo de la tienda), encima una florecita de 5 R-5 blancos con un R-5 rojo al centro y alrededor el aro de 10 R-9 blancos con un R-5 rojo cada dos (5), contados en la foto. La idea no publica productos; medidos: blancos #d7d5d9 → Silk Blanco Nácar 806 (perlado), rojos → Fashion Rojo 015. Distinto: los pétalos de la florecita blanca parecen corazoncitos (C-6 blanco, que no está en la tabla): van R-5 redondos; el soporte de pared no se ve (escenografía, no cotiza).",
});

// ----------------------------------------------------------------------------------------------------------
// 596 · Flor de corazones dorados (columna con flor y tres globos de helio)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los cuartetos dorados miden ~48 px (R-12 a 24 cm: 1,9 px/cm); la columna sube de y 552 a 330 (5
 * niveles, ~1,17 m con los aros rojos) con un R-5 rojo (~9 cm) en cada hueco entre niveles, un aro de R-5 rojos abajo
 * y otro arriba. Encima, la flor: 5 R-12 negros detrás y 5 pétalos alargados rojos de corazones dorados (Link-O-Loon
 * a ~22 cm: 42 cm de largo) con un racimo de R-5 dorados al centro (~1,68 m); y tres R-12 de helio (rojo de corazones,
 * dorado, rojo de corazones) hasta ~2,67 m. Origen: el piso bajo la columna (px 365, 552).
 */
const px596 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 365) / 1.9), r2((552 - y) / 1.9), z);
const ALZA_596 = 9;
const COLUMNA_596: Pieza = {
  tipo: "forma",
  forma: { clase: "cono", altoCm: 105, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 24, infladoPuntaCm: 24, globosBase: 4, globosPunta: 4, colores: { codigos: ["570"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 9, codigos: ["015"], cada: 1 } },
};
const TOPE_596 = perezoso(() => topeDe(COLUMNA_596));
const AMARRE_596 = perezoso(() => ALZA_596 + TOPE_596() - 2);
/** Un punto de la foto relativo al amarre (en el mundo). */
const rel596 = (x: number, y: number, z = 0): Vec3 => menos(px596(x, y, z), v(0, AMARRE_596(), 0));
const CORAZONES_SURTIDOS = "infinity-corazones-surtidos-fashion-y-metal-surtido";
const HELIO_596: ReadonlyArray<{ id: string; nombre: string; g: ParteGlobo; xy: [number, number]; z: number; impreso?: string }> = [
  { id: "helio-arriba", nombre: "R-12 rojo de corazones (helio, arriba)", g: R("R-12", 28, "015"), xy: [350, 45], z: -4, impreso: CORAZONES_SURTIDOS },
  { id: "helio-dorado", nombre: "R-12 Metal Dorado (helio)", g: R("R-12", 28, "570"), xy: [385, 80], z: 6 },
  { id: "helio-abajo", nombre: "R-12 rojo de corazones (helio, abajo)", g: R("R-12", 28, "015"), xy: [355, 130], z: 2, impreso: CORAZONES_SURTIDOS },
];
/** Las cintas de los globos de helio salen del centro de la flor. */
const NUDO_CINTAS_596 = perezoso(() => rel596(365, 205, 6));
const HELIO_PUESTO_596 = perezoso(() => HELIO_596.map((h) => {
  const centro = rel596(h.xy[0], h.xy[1], h.z);
  const direccion = unitario(mas(por(unitario(menos(centro, NUDO_CINTAS_596())), 0.5), ARRIBA));
  return { ...h, centro, direccion, nudo: menos(centro, por(direccion, centroCuerpo("redondo", h.g.infladoCm))) };
}));
const escena596 = (): Escena => ({
  sala: sala(320, 280, 300),
  nodos: [
    { id: "columna", nombre: "Columna de cuartetos Metal Dorado con R-5 rojos", pieza: COLUMNA_596, colocacion: { en: "libre", xCm: 0, yCm: ALZA_596, zCm: 0, giroGrados: 0 } },
    ...Array.from({ length: 10 }, (_, k) => { const a = rad(k * 36); return globoSobre(`aro-bajo-${k + 1}`, `R-5 Fashion Rojo del aro de abajo (${k + 1})`, "columna", R("R-5", 9, "015"), v(r2(20 * Math.cos(a)), -4.5, r2(20 * Math.sin(a))), v(Math.cos(a), 0, Math.sin(a))); }),
    ...Array.from({ length: 10 }, (_, k) => { const a = rad(18 + k * 36); return globoSobre(`aro-alto-${k + 1}`, `R-5 Fashion Rojo del aro de arriba (${k + 1})`, "columna", R("R-5", 9, "015"), v(r2(15 * Math.cos(a)), r2(TOPE_596() - 3), r2(15 * Math.sin(a))), v(Math.cos(a), 0.7, Math.sin(a))); }),
    amarre("amarre", "Amarre de la flor", "columna", v(0, r2(TOPE_596() - 2), 0), "#d9b04a"),
    decoSobre("flor-negra", "Flor de 5 R-12 negros", "amarre", flor({ petalos: { ...R("R-12", 24, "080"), cantidad: 5, aperturaGrados: 0, giroGrados: 90 }, centro: null }), enAmarre(rel596(365, 232, -2)), enAmarre(AL_FRENTE)),
    decoSobre("flor-roja", "Flor de 5 Link-O-Loon rojos con racimo dorado", "amarre", flor({ petalos: { ...R("LOL-12", 22, "015"), cantidad: 5, aperturaGrados: 0, giroGrados: 54 }, corona: { ...R("R-5", 7, "570"), cantidad: 6 }, centro: { ...R("R-5", 7, "570"), cantidad: 3 } }), enAmarre(rel596(365, 232, 10)), enAmarre(AL_FRENTE)),
    piezaSobre("cintas", "Cintas de los globos de helio", "amarre", { tipo: "escenografia", elementos: HELIO_PUESTO_596().map((h) => cinta(v(0, 0, 0), menos(h.nudo, NUDO_CINTAS_596()), "#f1efe9")) }, enAmarre(NUDO_CINTAS_596()), ARRIBA, 90),
    ...HELIO_PUESTO_596().map((h) => globoSobre(h.id, h.nombre, "amarre", { ...h.g, helio: true }, enAmarre(h.centro), enAmarre(h.direccion), h.impreso)),
  ],
});
const idea596 = idea({
  id: "idea:flor-de-corazones-dorados", numero: 596, slug: "flor-de-corazones-dorados", nombre: "Flor de corazones dorados (columna con flor y helio)", ocasiones: ["san-valentin", "cumpleanos", "fiesta-infantil"],
  fotoUrl: FOTO("6ede545660cd3d75e0b457fd50cab165_178e66d4-468e-4e1c-9cd0-4ec8e079325c.jpg"), escena: escena596,
  nota: "Igual: columna de 5 cuartetos dorados (~1,2 m con sus aros) con un R-5 rojo en cada hueco entre niveles (16), un aro de 10 R-5 rojos abajo y otro arriba, encima la flor de 5 R-12 negros con 5 pétalos alargados rojos (Link-O-Loon) y un racimo de 9 R-5 dorados al centro, y tres R-12 de helio con su cinta hasta ~2,7 m. La idea no publica productos; medidos: dorado #eba10a con brillo metalizado → Metal Dorado 570 (el dorado metal más cercano; por tono queda más cerca Fashion Mostaza 023), rojo → Fashion Rojo 015, negro 080. Distinto: en la foto los cuartetos alternan grande y chico; aquí van iguales (24 cm); los pétalos rojos llevan corazoncitos dorados impresos que la tienda no vende (van lisos) y los dos rojos de helio van con el Infinity® Corazones Surtidos (corazones blancos, el más parecido de la tienda).",
});

// ----------------------------------------------------------------------------------------------------------
// 601 · Jarrón de flores (flor en pote)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los cuartetos del medio miden ~70 px (Link-O-Loon a 25 cm: 2,8 px/cm) y los R-5 negros ~30 px
 * (~11 cm). El jarrón sube de y 555 a 195 (~1,3 m): abajo angosto (cuartetos a ~18 cm, 3 niveles), en medio la panza
 * (25 cm, 3 niveles) y arriba el cuello (21 cm, 2 niveles), con un R-5 negro en cada hueco y un borde de R-5 negros
 * arriba. Dos flores de T-260: la fucsia de 5 burbujas (~34 cm de pétalo) con un anillo de burbujitas amarillas, y la
 * de 5 lazos blancos con burbujitas amarillas; tallos de T-260 verde lima. Origen: el piso bajo el jarrón (px 375, 555).
 */
const columna = (formatoId: string, infladoCm: number, niveles: number, colores: string[]): Pieza =>
  ({ tipo: "columna", formatoId, infladoCm, alturaCm: r2(niveles * infladoCm * 0.8), patron: "un_color", colores });
const JARRON_601: ReadonlyArray<{ id: string; nombre: string; pieza: Pieza }> = [
  { id: "jarron-base", nombre: "Jarrón: base de cuartetos Link-O-Loon azul", pieza: columna("LOL-12", 18, 3, ["040"]) },
  { id: "jarron-panza", nombre: "Jarrón: panza de cuartetos Link-O-Loon azul", pieza: columna("LOL-12", 25, 3, ["040"]) },
  { id: "jarron-cuello", nombre: "Jarrón: cuello de cuartetos Link-O-Loon azul", pieza: columna("LOL-12", 21, 2, ["040"]) },
];
const NEGRO_601 = R("R-5", 10.7, "580");
/** Lo de arriba del jarrón, relativo al amarre del cuello (px 375, 200). */
const rel601 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 375) / 2.8), r2((200 - y) / 2.8), z);
const TALLO_601: Tubito = { formatoId: "T-260", grosorCm: 5, codigo: "031" };
const escena601 = (): Escena => ({
  sala: sala(320, 280, 280),
  nodos: [
    ...JARRON_601.map((c, k): NodoEscena => (k === 0
      ? { id: c.id, nombre: c.nombre, pieza: c.pieza, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }
      : piezaSobre(c.id, c.nombre, JARRON_601[k - 1]!.id, c.pieza, v(0, r2(topeDe(JARRON_601[k - 1]!.pieza)), 0), ARRIBA, 22.5))),
    ...JARRON_601.map((c): NodoEscena => ({ id: `${c.id}-negros`, nombre: `R-5 Metal Negro en los huecos (${c.nombre.split(": ")[1]!.split(" ")[0]})`, pieza: piezaGlobo(NEGRO_601), colocacion: { en: "ancla", padreId: c.id, ancla: 0, cada: 1, giroGrados: 0 } })),
    decoSobre("borde", "Borde de 8 R-5 Metal Negro", "jarron-cuello", flor({ petalos: { ...NEGRO_601, cantidad: 8, aperturaGrados: 15, giroGrados: 0 }, centro: null }), v(0, r2(topeDe(JARRON_601[2]!.pieza)), 0), ARRIBA),
    amarre("amarre", "Amarre de las flores", "jarron-cuello", v(0, r2(topeDe(JARRON_601[2]!.pieza) - 4), 0), "#3c8a2e"),
    palito("tallo-fucsia", "Tallo de T-260 Verde Lima (flor fucsia)", "amarre", TALLO_601, rel601(368, 200, 0), rel601(345, 85, 0), enAmarre),
    palito("tallo-blanca", "Tallo de T-260 Verde Lima (flor blanca)", "amarre", TALLO_601, rel601(382, 200, 0), rel601(425, 145, 3), enAmarre),
    decoSobre("flor-fucsia", "Flor fucsia de 5 burbujas", "amarre", florTubito({ petalos: burbujas("T-260", 5, ["012"], 5, 30, 0, 18), interior: burbujas("T-260", 4.5, ["020"], 6, 4.5, 25, 0) }), enAmarre(rel601(340, 70, 2)), enAmarre(v(0, 0.35, 1))),
    decoSobre("flor-blanca", "Flor de 5 lazos Satín Perla", "amarre", florTubito({ petalos: lazos("T-260", 5, ["406"], 5, 19, 12, 5, 10), interior: burbujas("T-260", 4, ["020"], 8, 3.5, 30, 0) }), enAmarre(rel601(435, 132, 6)), enAmarre(v(0.3, 0.25, 1))),
  ],
});
const idea601 = idea({
  id: "idea:flor-en-pote", numero: 601, slug: "flor-en-pote", nombre: "Jarrón de flores", ocasiones: ["general"],
  fotoUrl: FOTO("2e4b39f89b3296871500cc25402938dd_1fe42884-3025-4677-8ebe-7a2bbcd9004e.jpg"), escena: escena601,
  nota: "Igual: jarrón de ~1,3 m de cuartetos de Link-O-Loon Fashion Azul —angosto abajo, panza en medio y cuello arriba (3, 3 y 2 niveles a 18, 25 y 21 cm)— con un R-5 Metal Negro en cada hueco y un borde de 8 R-5 negros arriba, y dos flores de T-260 con sus tallos Verde Lima: la fucsia de 5 burbujas con anillo de 6 burbujitas amarillas y la de 5 lazos claros con 8 burbujitas amarillas, con los productos que publica la idea (el negro es el R-12 Metal Negro publicado, en talla R-5). Distinto: el turquesa de la foto mide #30eaea (más cerca de Azul Caribe 038): va el Fashion Azul 040 publicado; los pétalos fucsia se ven más gruesos que un T-260 (van al máximo, 5 cm) y el rizo fucsia del centro no se modela; la flor clara no es de un producto publicado (medido #feecdc → T-260 Satín Perla 406); en la foto el jarrón se ensancha poco a poco y aquí por tramos; el T-260 Rosado publicado no se ve (sin cantidad).",
}, [
  P("GLOBO TUBITO FASHION FUCSIA", "/products/globo-para-fiesta-latex-tubito-fashion-fucsia", "T-260", "012"),
  P("GLOBO TUBITO FASHION AMARILLO", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", "T-260", "020"),
  P("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"),
  P("GLOBO TUBITO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-fashion-verde-lima", "T-260", "031"),
  P("GLOBO REDONDO METAL NEGRO", "/products/globo-para-fiesta-latex-redondo-metal-negro", "R-12", "580"),
  P("GLOBO LINK-O-LOON® FASHION AZUL", "/products/globo-para-fiesta-latex-link-o-loon-fashion-azul", "LOL-12", "040"),
]);

// ----------------------------------------------------------------------------------------------------------
// 605 · Flor Reflex (columna con tallo trenzado y flor plateada)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-12 cromados de la base miden ~70 px (28 cm, llenos: 2,6 px/cm) y el tallo de dos T-260 trenzados
 * ~30 px (11,5 cm), lo que confirma la escala: la flor mide ~2,1 m. Base de dos cuartetos plateados con un aro de R-5
 * dorados encima, tallo hasta el centro de la flor (~1,58 m) y la flor de 9 pétalos plateados (gotas de ~44 cm, ~1 m
 * de diámetro) con un racimo de R-5 dorados. Origen: el piso bajo la base (px 360, 560).
 */
const BASE_605 = columna("R-12", 28, 2, ["981"]);
const TOPE_605 = perezoso(() => topeDe(BASE_605));
const AMARRE_605 = perezoso(() => TOPE_605() - 3);
/** El centro de la flor, relativo al amarre (en el mundo). */
const FLOR_605 = perezoso(() => v(0, r2((560 - 150) / 2.6 - AMARRE_605()), 4));
const escena605 = (): Escena => ({
  sala: sala(320, 280, 300),
  nodos: [
    { id: "base", nombre: "Base de dos cuartetos Reflex Plata", pieza: BASE_605, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    decoSobre("aro-dorado", "Aro de 8 R-5 Reflex Dorado", "base", flor({ petalos: { ...R("R-5", 11, "970"), cantidad: 8, aperturaGrados: 20, giroGrados: 0 }, centro: null }), v(0, r2(TOPE_605()), 0), ARRIBA),
    amarre("amarre", "Amarre del tallo", "base", v(0, r2(AMARRE_605()), 0), "#a08344"),
    ...[-1.6, 1.6].map((dx, k) => palito(`tallo-${k + 1}`, `Tallo trenzado de T-260 Reflex Dorado (${k + 1})`, "amarre", { formatoId: "T-260", grosorCm: 5, codigo: "970" }, v(dx, 0, 0), v(dx, FLOR_605().y, 0), enAmarre)),
    ...Array.from({ length: 9 }, (_, k) => {
      const a = rad(90 + k * 40);
      return globoSobre(`petalo-${k + 1}`, `Pétalo R-12 Reflex Plata (${k + 1})`, "amarre", R("R-12", 21, "981"), enAmarre(mas(FLOR_605(), v(r2(24 * Math.cos(a)), r2(24 * Math.sin(a)), 0))), enAmarre(v(Math.cos(a), Math.sin(a), 0.15)));
    }),
    decoSobre("centro-dorado", "Centro de R-5 Reflex Dorado", "amarre", flor({ petalos: { ...R("R-5", 9.6, "970"), cantidad: 6, aperturaGrados: 35, giroGrados: 0 }, centro: { ...R("R-5", 9, "970"), cantidad: 3 } }), enAmarre(mas(FLOR_605(), v(0, 0, 8))), enAmarre(AL_FRENTE)),
  ],
});
const idea605 = idea({
  id: "idea:flor-reflex", numero: 605, slug: "flor-reflex", nombre: "Flor Reflex plateada y dorada", ocasiones: ["general"],
  fotoUrl: FOTO("Flor-Reflex_a9a28552-336f-4721-b86e-449b243250d1.jpg"), escena: escena605,
  nota: "Igual: con los tres productos que publica la idea, base de dos cuartetos R-12 Reflex Plata con un aro de 8 R-5 Reflex Dorado encima, tallo de dos T-260 Reflex Dorado trenzados hasta ~1,6 m y la flor de 9 pétalos R-12 Reflex Plata con un racimo de 9 R-5 Reflex Dorado al centro: ~2,1 m en total (la escala sale de la base y del grosor del tallo). Distinto: los pétalos de la foto son gotas alargadas (~44 cm); aquí R-12 redondos a 21 cm, encimados; el tallo va recto (dos tubitos paralelos, no torcidos).",
}, [
  P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
  P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970"),
  P("GLOBO TUBITO REFLEX DORADO", "/products/globo-para-fiesta-latex-tubito-reflex-dorado", "T-260", "970"),
]);

// ----------------------------------------------------------------------------------------------------------
// 608 · Flores navideñas (tres flores unidas por un tubito)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-12 impresos miden ~95 px (25 cm: 3,8 px/cm). Dos flores de 4 R-12 rojos impresos (Papá Noel
 * y «Feliz Navidad») en X con 6 R-5 verde oscuro al centro, y en medio dos R-12 (arriba y abajo) con un aro de 8 R-5
 * verdes en la cintura; un T-260 rojo ondulado, con un bucle a cada lado, las une (1,8 m de punta a punta). Origen: el
 * centro de la flor del medio (px 365, 285).
 */
const px608 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 365) / 3.8), r2((285 - y) / 3.8), z);
const NAVIDAD = "infinity-feliz-navidad-corona-fashion-surtido-navidad";
const FLOR_608 = flor({ petalos: { ...R("R-12", 25, "015"), cantidad: 4, aperturaGrados: 0, giroGrados: 45 }, corona: { ...R("R-5", 9, "032"), cantidad: 6 }, centro: null });
const TUBO_608: Tubito = { formatoId: "T-260", grosorCm: 4.5, codigo: "015" };
/**
 * El tubito ondulado de cada lado: un resorte de 1,5 vueltas acostado (de frente se ve como la onda con su bucle), de
 * la flor de su lado a la del medio; cada uno es un T-260.
 */
const resorte608 = (largoCm: number): Decoracion => rizo({ forma: "resorte", tubito: TUBO_608, vueltas: 1.5, radioCm: 7, largoCm, eje: "abajo" });
const escena608 = (): Escena => ({
  sala: sala(320, 280, 280),
  nodos: [
    { id: "soporte", nombre: "Soporte de pared (no se ve)", pieza: soporte(3, 1.5, "#efefef"), colocacion: { en: "libre", xCm: 0, yCm: 150, zCm: -138, giroGrados: 0 } },
    decoSobre("flor-izquierda", "Flor de 4 R-12 navideños (izquierda)", "soporte", FLOR_608, px608(142, 285, 3), AL_FRENTE, 0, [{ impresoId: NAVIDAD, codigo: "015" }]),
    decoSobre("flor-derecha", "Flor de 4 R-12 navideños (derecha)", "soporte", FLOR_608, px608(575, 285, 3), AL_FRENTE, 0, [{ impresoId: NAVIDAD, codigo: "015" }]),
    globoDesdeNudo("medio-arriba", "R-12 navideño del medio (arriba)", "soporte", R("R-12", 25, "015"), px608(345, 277, 14), ARRIBA, NAVIDAD),
    globoDesdeNudo("medio-abajo", "R-12 navideño del medio (abajo)", "soporte", R("R-12", 25, "015"), px608(345, 277, 14), ABAJO, NAVIDAD),
    decoSobre("medio-aro", "Aro de 8 R-5 Verde Selva (cintura del medio)", "soporte", flor({ petalos: { ...R("R-5", 9, "032"), cantidad: 8, aperturaGrados: 0, giroGrados: 22.5 }, centro: null }), mas(px608(345, 277, 14), v(0, -4.5, 0)), ARRIBA),
    decoSobre("tubo-izquierda", "Tubito rojo ondulado (izquierda)", "soporte", resorte608(r2((330 - 150) / 3.8)), px608(150, 290, 2), AL_FRENTE, 90),
    decoSobre("tubo-derecha", "Tubito rojo ondulado (derecha)", "soporte", resorte608(r2((575 - 400) / 3.8)), px608(400, 280, 2), AL_FRENTE, 90),
  ],
});
const idea608 = idea({
  id: "idea:flores-navidenas", numero: 608, slug: "flores-navidenas", nombre: "Flores navideñas unidas por un tubito", ocasiones: ["navidad"],
  fotoUrl: FOTO("f343894d563ce02347c9344600d5a2e5_e85cef89-307b-46f1-a1a4-c0b0d77b2dd9.jpg"), escena: escena608,
  nota: "Igual: dos flores de pared de 4 R-12 rojos impresos en X con 6 R-5 verde oscuro al centro, en medio dos R-12 impresos (arriba y abajo) con un aro de 8 R-5 verdes en la cintura, y el T-260 rojo ondulado que las une con un bucle junto a cada flor (1,8 m de punta a punta), contado en la foto. La idea no publica productos; medidos: rojo → Fashion Rojo 015, verde #215334 → Fashion Verde Selva 032. Distinto: el impreso de la foto (Papá Noel, «Feliz Navidad» y puntos) no está en la tienda: va el Infinity® Feliz Navidad Corona (rojo con letras y copos blancos), el más parecido; el tubito de cada lado es un resorte acostado (la onda y el bucle de la foto no son tan regulares); el soporte de pared no se ve (no cotiza).",
});

// ----------------------------------------------------------------------------------------------------------
// 617 · Futbolmanía (topiario: bola roja y amarilla, tallo azul y balón)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-12 rojos miden ~80 px (25 cm: 3,2 px/cm). La bola mide ~90 × 88 cm: arriba y abajo un
 * cuarteto amarillo (2 a la vista), en medio dos anillos de 8 rojos (4 a la vista); de ella cuelga un tallo de 3 R-5 azul rey (~12 cm) en cadena, dos R-5
 * negros y uno blanco, y abajo el R-12 impreso de balón (~28 cm) apoyado en el piso. Centro de la bola a ~1,2 m.
 */
/** Los cuatro anillos de la bola (de arriba abajo): cuántos R-12, su radio (se tocan), altura, inclinación y color. */
const ANILLOS_617: ReadonlyArray<{ n: number; radio: number; y: number; inclinacion: number; giro: number; codigo: string; nombre: string }> = [
  { n: 4, radio: 15.6, y: 34, inclinacion: 50, giro: 45, codigo: "020", nombre: "cuarteto amarillo de arriba" },
  { n: 8, radio: 28.7, y: 12.5, inclinacion: 12, giro: 0, codigo: "015", nombre: "anillo rojo de arriba" },
  { n: 8, radio: 28.7, y: -12.5, inclinacion: -12, giro: 22.5, codigo: "015", nombre: "anillo rojo de abajo" },
  { n: 4, radio: 15.6, y: -34, inclinacion: -50, giro: 0, codigo: "020", nombre: "cuarteto amarillo de abajo" },
];
const ESLABON_617 = R("R-5", 12, "041");
const CC_ESLABON = perezoso(() => centroCuerpo("redondo", ESLABON_617.infladoCm));
/** Los nudos del tallo, del trío y del balón (relativos al centro de la bola): cada uno cuelga del de arriba. */
const NUDOS_617 = perezoso(() => {
  const eslabones = [-40];
  for (let k = 1; k < 3; k++) eslabones.push(r2(eslabones[k - 1]! - CC_ESLABON() - ESLABON_617.infladoCm / 2 + 1.5));
  const trio = r2(eslabones[2]! - CC_ESLABON() - ESLABON_617.infladoCm / 2 + 1.5);
  const balon = r2(trio - centroCuerpo("redondo", 10) - 10 + 2);
  return { eslabones, trio, balon, pie: r2(balon - centroCuerpo("redondo", 28) - 14) };
});
const escena617 = (): Escena => ({
  sala: sala(320, 280, 280),
  nodos: [
    { id: "nucleo", nombre: "Núcleo de la bola (no se ve)", pieza: soporte(4, 4, "#c9c9cf"), colocacion: { en: "libre", xCm: 0, yCm: r2(-NUDOS_617().pie), zCm: 0, giroGrados: 0 } },
    ...ANILLOS_617.flatMap((an) => Array.from({ length: an.n }, (_, k) => {
      const a = rad(an.giro + (360 * k) / an.n), t = rad(an.inclinacion);
      return globoSobre(`bola-${an.codigo}-${an.y > 0 ? "a" : "b"}${Math.abs(an.y) > 20 ? "1" : "2"}-${k + 1}`, `${nombreGlobo(R("R-12", 25, an.codigo))} del ${an.nombre} (${k + 1})`, "nucleo", R("R-12", 25, an.codigo),
        v(r2(an.radio * Math.cos(a)), an.y, r2(an.radio * Math.sin(a))), v(Math.cos(a) * Math.cos(t), Math.sin(t), Math.sin(a) * Math.cos(t)));
    })),
    ...NUDOS_617().eslabones.map((y, k) => globoDesdeNudo(`tallo-${k + 1}`, `R-5 Fashion Azul Rey del tallo (${k + 1})`, "nucleo", ESLABON_617, v(0, y, 0), ABAJO)),
    decoSobre("trio", "Tres R-5 negros y uno blanco", "nucleo", flor({ petalos: { ...R("R-5", 9.5, "080"), cantidad: 3, aperturaGrados: -25, giroGrados: 90 }, centro: { ...R("R-5", 10, "005"), cantidad: 1 } }), v(0, NUDOS_617().trio, 0), ABAJO),
    globoDesdeNudo("balon", "R-12 Infinity® Balón de Fútbol", "nucleo", R("R-12", 28, "005"), v(0, NUDOS_617().balon, 0), ABAJO, BALON),
  ],
});
const idea617 = idea({
  id: "idea:futbolmania", numero: 617, slug: "futbolmania", nombre: "Futbolmanía: topiario de fútbol", ocasiones: ["general"],
  fotoUrl: FOTO("e6fe49d0556062f68eb4ce3c166f4325_dd1b9668-c105-45f6-a384-9a8f037180f9.jpg"), escena: escena617,
  nota: "Igual: con los productos que publica la idea, una bola de 24 R-12 de ~82 × 93 cm —un cuarteto amarillo arriba, dos anillos de 8 rojos y un cuarteto amarillo abajo, como en la foto— (Fashion Amarillo 020 y Fashion Rojo 015), un tallo de 3 R-5 Fashion Azul Rey en cadena, dos R-5 negros y uno blanco, y abajo el R-12 Infinity® Balón de Fútbol apoyado en el piso (~1,6 m en total). Distinto: la bola cuelga de un núcleo que no se ve (escenografía, no cotiza); el amarillo mide #e3cb00 (más cerca de Amarillo Miel 021): va el 020 publicado; el R-5 negro y el blanco no son de productos publicados (Fashion Negro 080 y Blanco 005) y el trío lleva un tercer negro detrás.",
}, [
  P("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", null, null),
  P("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020"),
  P("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041"),
  P("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"),
]);

// ----------------------------------------------------------------------------------------------------------
// 623 · Garland Grado (guirnalda orgánica con impresos y cortina)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: los R-5 cromados miden ~48 px y los R-12 impresos ~140 px (30 cm: 4,6 px/cm). Guirnalda orgánica
 * de pared de x 30 a 975 (2,05 m) y ~88 cm de grueso, de perlados blancos, cromados plata y azules (R-18 a R-5, con
 * racimos de R-5 plata), tres R-12 plata «Feliz Grado» (arriba, en la punta izquierda y en la derecha), un azul con el
 * mismo impreso, un transparente de estrellas abajo a la izquierda, cinco cintas doradas rizadas colgando y una
 * cortina metálica azul y plata (~86 × 87 cm) bajo el centro. Origen: el centro de la guirnalda (px 500, 390).
 */
const px623 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 500) / 4.6), r2((390 - y) / 4.6), z);
const ALTO_623 = 170;
const PARED_623 = -150;
const GUIRNALDA_623: Pieza = {
  tipo: "organico", flores: null,
  opciones: opcionesRacimosLibres({
    racimos: [{ id: "guirnalda", nombre: "Guirnalda orgánica de grado", puntos: [px623(187, 415), px623(330, 375), px623(500, 330), px623(650, 340), px623(850, 410)], radioInicioCm: 38, radioFinCm: 40, mezcla: mezclaFija({ "R-18": 0.2, "R-12": 0.5, "R-9": 0.3 }), tapas: { inicio: true, fin: true } }],
    colores: [
      // El motor reparte por cuotas sobre todos los globos (también los R-5 de relleno, que van plata): pesos chicos para
      // que el blanco y el azul no se coman todos los grandes.
      { codigo: "806", peso: 0.2, formatos: ["R-18", "R-12", "R-9"] },
      { codigo: "981", peso: 0.71 },
      { codigo: "940", peso: 0.09, formatos: ["R-18", "R-12"] },
    ],
    semilla: 623, suelo: false, relleno: RELLENO_TUPIDO,
  }),
};
/** Cortina metálica: tiras finas que cuelgan de una barra, la plateada detrás (más ancha) y la azul delante. */
function tirasCortina(anchoCm: number, largoCm: number, hex: string, z: number, fondo: number): ElementoEscenografia[] {
  const tiras = Math.round(anchoCm / 2.2);
  return Array.from({ length: tiras }, (_, k): ElementoEscenografia => {
    const x = -anchoCm / 2 + (k + 0.5) * (anchoCm / tiras);
    const l = largoCm - fondo * (x / (anchoCm / 2)) ** 2 - (k % 3) * 1.5;
    return { forma: "caja", centro: v(r2(x), r2(-l / 2), z), tamano: v(1.7, r2(l), 0.15), hex, acabado: "metal" };
  });
}
const CORTINA_623: Pieza = {
  tipo: "escenografia", utileria: "otro",
  elementos: [...tirasCortina(86, 87, "#c9ccd1", 0, 10), ...tirasCortina(80, 84, "#2f86c9", 1.2, 14)],
  productos: [productoDe("cortina-decorativa-metalica-plata", 1, "cortina metálica plata"), productoDe(null, 1, "cortina metálica azul")],
};
/** Una cinta dorada rizada (escenografía) de `arriba` hacia abajo `largoCm`. */
function cintaRizada(arriba: Vec3, largoCm: number): ElementoEscenografia[] {
  const puntos = Array.from({ length: 41 }, (_, i) => { const t = i / 40, a = 2 * Math.PI * 5 * t; return mas(arriba, v(1.6 * Math.cos(a), -largoCm * t, 1.6 * Math.sin(a))); });
  return puntos.slice(1).map((q, i) => cinta(puntos[i]!, q, "#c9a54a", 0.3, "metal"));
}
const CINTAS_623: ReadonlyArray<[number, number, number]> = [[145, 520, 140], [285, 530, 130], [665, 560, 190], [750, 560, 100], [840, 550, 90]];
const escena623 = (): Escena => ({
  sala: sala(420, 300, 300),
  nodos: [
    { id: "guirnalda", nombre: "Guirnalda orgánica blanca, plata y azul", pieza: GUIRNALDA_623, colocacion: { en: "libre", xCm: 0, yCm: ALTO_623, zCm: PARED_623 + 40, giroGrados: 0 } },
    globoSobre("grado-arriba", "R-12 Feliz Grado (arriba)", "guirnalda", R("R-12", 29, "981"), px623(520, 245, 10), v(0.05, 1, 0.4), FELIZ_GRADO),
    globoSobre("grado-izquierda", "R-12 Feliz Grado (punta izquierda)", "guirnalda", R("R-12", 30, "981"), px623(165, 355, 12), v(-0.8, 0.3, 0.5), FELIZ_GRADO),
    globoSobre("grado-derecha", "R-12 Feliz Grado (punta derecha)", "guirnalda", R("R-12", 30, "981"), px623(900, 390, 8), v(0.9, 0.1, 0.4), FELIZ_GRADO),
    globoSobre("grado-azul", "R-12 Reflex Azul (el «Feliz Grado» azul de la foto)", "guirnalda", R("R-12", 28, "940"), px623(665, 265, 8), v(0.2, 1, 0.4)),
    globoSobre("estrellas", "R-12 Infinity® Estrellas transparente", "guirnalda", R("R-12", 26, "390"), px623(110, 520, 8), v(-0.6, -0.6, 0.5), "infinity-estrellas-fashion-transparente"),
    { id: "cortina", nombre: "Cortina metálica plata y azul", pieza: CORTINA_623, colocacion: { en: "libre", xCm: 3, yCm: r2(ALTO_623 + (390 - 465) / 4.6), zCm: PARED_623 + 5, giroGrados: 0 } },
    { id: "cintas", nombre: "Cintas doradas rizadas", pieza: { tipo: "escenografia", elementos: CINTAS_623.flatMap(([x, y, alto]) => cintaRizada(px623(x, y, 30), alto / 4.6)) }, colocacion: { en: "libre", xCm: 0, yCm: ALTO_623, zCm: PARED_623 + 40, giroGrados: 0 } },
  ],
});
const idea623 = idea({
  id: "idea:garland-grado", numero: 623, slug: "garland-grado", nombre: "Garland de grado con cortina", ocasiones: ["graduacion"],
  fotoUrl: FOTO("Garland_Grado.jpg"), escena: escena623,
  nota: "Igual: guirnalda orgánica de pared de ~2 × 0,9 m de perlados blancos, Reflex Plata y Reflex Azul (R-18 a R-9 con racimos de R-5 plata), con tres R-12 «Feliz Grado» plata (arriba y en las dos puntas), uno azul más, un transparente de estrellas abajo a la izquierda, cinco cintas doradas rizadas colgando y la cortina metálica (plata detrás, azul delante) bajo el centro, con los productos que publica la idea. Distinto: los perlados de la foto miden #d4d4d6 → Silk Blanco Nácar 806, que la idea no publica (el Fashion Gris 081 publicado no se ve: sin cantidad); el «Feliz Grado» azul de la foto no se vende (el impreso es solo plata): va Reflex Azul liso; la cortina azul no está en la tienda (genérica) y las cintas son escenografía (no cotizan); las cantidades de la guirnalda son las del motor orgánico, no contadas una a una.",
}, [
  P("GLOBO REDONDO FELIZ GRADO", "/products/globo-para-fiesta-latex-redondo-2-caras-mensajes-grado-reflex-plata", "R-12", null),
  P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
  P("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940"),
  P("GLOBO REDONDO FASHION GRIS", "/products/globo-para-fiesta-latex-redondo-fashion-gris", "R-12", "081"),
  P("CORTINA METALICA PLATA", "/products/cortina-decorativa-metalica-plata", null, null),
]);

// ----------------------------------------------------------------------------------------------------------
// 644 y 646 · Coronas navideñas de Link-O-Loon (de pared)
// ----------------------------------------------------------------------------------------------------------

/**
 * Corona de 6 eslabones de Link-O-Loon en hexágono (cada uno de nudo a nudo: 1,47 × su inflado), una pareja de R-5 en
 * cada unión (uno hacia dentro y otro hacia fuera, por delante) y un moño de T-260 arriba con sus rizos colgando.
 * Fotos de 740 × 570: las uniones quedan a ~190 px del centro y los eslabones miden ~100 px de ancho: Link-O-Loon a
 * ~29 cm (4,5 px/cm) y R-5 de ~10 cm; la corona mide ~1,2 m. Origen: el centro de la corona.
 */
type Corona = { eslabon: ParteGlobo; pareja: ParteGlobo; mono: PropiedadesMono; rizos: ReadonlyArray<{ desde: Vec3; giro: number; p: PropiedadesRizo }> };
function escenaCorona(c: Corona): Escena {
  const L = c.eslabon.infladoCm * 1.47;
  const union = (k: number): Vec3 => { const a = rad(90 + 60 * k); return v(r2(L * Math.cos(a)), r2(L * Math.sin(a)), 16); };
  const radial = (k: number): Vec3 => unitario(v(union(k).x, union(k).y, 0));
  const nombre = nombreGlobo(c.eslabon), nombrePareja = nombreGlobo(c.pareja);
  const arriba = union(0);
  return {
    sala: sala(320, 280, 280),
    nodos: [
      { id: "soporte", nombre: "Soporte de pared (no se ve)", pieza: soporte(3, 1.5, "#efefef"), colocacion: { en: "libre", xCm: 0, yCm: 150, zCm: -138, giroGrados: 0 } },
      ...Array.from({ length: 6 }, (_, k) => globoDesdeNudo(`eslabon-${k + 1}`, `${nombre} (eslabón ${k + 1})`, "soporte", c.eslabon, union(k), menos(union(k + 1), union(k)))),
      ...Array.from({ length: 6 }, (_, k) => [-1, 1].map((s, j) => globoSobre(`pareja-${k + 1}-${j + 1}`, `${nombrePareja} de la unión ${k + 1} (${j === 0 ? "dentro" : "fuera"})`, "soporte", c.pareja, mas(union(k), mas(por(radial(k), s * 4.8), v(0, 0, 8))), mas(por(radial(k), s), v(0, 0, 0.9))))).flat(),
      decoSobre("mono", "Moño de T-260", "soporte", mono(c.mono), mas(arriba, v(0, -2, 18)), AL_FRENTE),
      ...c.rizos.map((r, k) => decoSobre(`rizo-${k + 1}`, `Rizo del moño (${k + 1})`, "soporte", rizo(r.p), mas(arriba, mas(r.desde, v(0, 0, 17))), AL_FRENTE, r.giro)),
    ],
  };
}
const escena644 = (): Escena => escenaCorona({
  eslabon: R("LOL-12", 29, "031"), pareja: R("R-5", 10, "515"),
  mono: { formatoId: "T-260", grosorCm: 4.5, codigo: "570", lazosPorLado: 1, largoLazoCm: 20, anchoLazoCm: 16, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: R("R-5", 8, "570") },
  rizos: [-1, 1].map((s) => ({ desde: v(s * 7, -3, 0), giro: 0, p: { forma: "tirabuzon", tubito: { formatoId: "T-260", grosorCm: 4.5, codigo: "570" }, vueltas: 2, radioInicialCm: 7, radioFinalCm: 4, largoCm: 30, eje: "abajo", giroGrados: s > 0 ? 180 : 0 } })),
});
const idea644 = idea({
  id: "idea:guirnalda-navidena", numero: 644, slug: "guirnalda-navidena", nombre: "Corona navideña verde con moño dorado", ocasiones: ["navidad"],
  fotoUrl: FOTO("e6226669a4e619ad91ea2a3dd85cda57_87351aac-ffbb-47f4-b004-3ef7970f3d34.jpg"), escena: escena644,
  nota: "Igual: corona de pared de ~1,2 m: 6 eslabones Link-O-Loon verdes en hexágono, una pareja de R-5 Metal Rojo en cada unión (12) y arriba un moño de T-260 Metal Dorado de dos lazos con su bolita y dos rizos colgando, contado en la foto, con los dos productos que publica la idea (Metal Dorado 570 y Metal Rojo 515, el rojo en talla R-5). Distinto: el verde no es de un producto publicado (medido #56b048 → Link-O-Loon Fashion Verde Lima 031; el de la foto brilla como metalizado, que no se fabrica en Link-O-Loon); la unión de abajo lleva tres rojos en la foto (aquí dos); los rizos de la foto se enroscan en espiral plana; el soporte de pared no se ve (no cotiza).",
}, [
  P("GLOBO REDONDO METAL DORADO", "/products/globo-para-fiesta-latex-redondo-metal-dorado-cobre", "R-12", "570"),
  P("GLOBO REDONDO METAL ROJO", "/products/globo-para-fiesta-latex-redondo-metal-rojo", "R-12", "515"),
]);
const escena646 = (): Escena => escenaCorona({
  eslabon: R("LOL-12", 29, "015"), pareja: R("R-5", 10, "032"),
  mono: { formatoId: "T-260", grosorCm: 4, codigo: "021", lazosPorLado: 2, largoLazoCm: 22, anchoLazoCm: 9, aberturaGrados: 45, colas: false, largoColaCm: 0, centro: null },
  rizos: [-10, 0, 10].map((x, k) => ({ desde: v(x, k === 1 ? -6 : -4, 0), giro: 0, p: { forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 4, codigo: "021" }, vueltas: 1.6, radioCm: 6, largoCm: 18, eje: "abajo", giroGrados: k * 120 } })),
});
const idea646 = idea({
  id: "idea:guirnalda", numero: 646, slug: "guirnalda", nombre: "Corona navideña roja con moño amarillo", ocasiones: ["navidad"],
  fotoUrl: FOTO("6b251d07b7dc73caabde55a43c568487_8c8aedce-67b5-4955-81ab-b734065ef712.jpg"), escena: escena646,
  nota: "Igual: corona de pared de ~1,2 m: 6 eslabones Link-O-Loon rojos en hexágono, una pareja de R-5 verdes en cada unión (12) y arriba un moño de T-260 amarillo de cuatro lazos con tres rizos colgando, contado en la foto. La idea no publica productos; medidos: rojo #fe3637 → Link-O-Loon Fashion Rojo 015, verde #006e36 → Fashion Verde Selva 032 (Metal Verde 530 queda a 0,2 ΔE, va el Fashion), amarillo #f1b600 → T-260 Fashion Amarillo Miel 021. Distinto: los rizos de la foto son más largos y enredados; el soporte de pared no se ve (no cotiza).",
});

// ----------------------------------------------------------------------------------------------------------
// 668 · Huevos de Pascua polka (dos ramos de helio amarrados a huevos)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-12 de helio miden ~78 px (28 cm: 2,8 px/cm). Dos huevos de pie (R-18 de ~34 cm con el nudo
 * arriba): el rosado con tres aros de tubito (fucsia, amarillo y lila) y el verde con una cadena de burbujas blancas;
 * de cada uno sale un ramo de 3 R-12 de lunares (amarillo, azul y lila; verde, rosado y naranja) a 1,3–1,8 m, y en el
 * piso seis R-9 de lunares. Origen: el piso al centro (px 365, 560).
 */
const px668 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 365) / 2.8), r2((560 - y) / 2.8), z);
const POLKA_LIMA = "infinity-polka-blanco-fashion-verde-lima";
type Ramo668 = { id: string; nombre: string; huevoPx: number; huevo: ParteGlobo; bandas: ReadonlyArray<{ codigo: string; dy: number; cadena: boolean }>; globos: ReadonlyArray<{ g: ParteGlobo; xy: [number, number]; z: number; cinta: string; impreso?: string }> };
function ramo668(r: Ramo668): NodoEscena[] {
  const base = px668(r.huevoPx, 560);
  const d = r.huevo.infladoCm;
  // El huevo de pie: el nudo arriba y el cuerpo apoyado en el piso.
  const nudoHuevo = v(0, r2(centroCuerpo("redondo", d) + d / 2), 0);
  const centroHuevo = v(0, r2(d / 2), 0);
  const globos = r.globos.map((h, k) => {
    const centro = menos(px668(h.xy[0], h.xy[1], h.z), base);
    const direccion = unitario(mas(por(unitario(menos(centro, nudoHuevo)), 0.4), ARRIBA));
    return { ...h, k, centro, direccion, nudo: menos(centro, por(direccion, centroCuerpo("redondo", h.g.infladoCm))) };
  });
  return [
    { id: r.id, nombre: `Cintas del ${r.nombre}`, pieza: { tipo: "escenografia", elementos: globos.map((h) => cinta(nudoHuevo, h.nudo, h.cinta, 0.25)) }, colocacion: { en: "libre", xCm: base.x, yCm: 0, zCm: 0, giroGrados: 0 } },
    globoDesdeNudo(`${r.id}-huevo`, `Huevo ${nombreGlobo(r.huevo)} (${r.nombre})`, r.id, r.huevo, nudoHuevo, ABAJO),
    ...r.bandas.map((b, k) => decoSobre(`${r.id}-banda-${k + 1}`, `${b.cadena ? "Cadena de burbujas" : "Aro"} de T-260 ${referenciaPorCodigo(b.codigo)?.nombreCompleto ?? b.codigo} (${r.nombre})`, r.id,
      rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: b.cadena ? 4 : 3, codigos: [b.codigo], largosCm: [b.cadena ? 11.5 : 9.6], recorrido: "aro", cantidad: b.cadena ? 10 : 12 }), mas(centroHuevo, v(0, b.dy, 0)), ARRIBA)),
    ...globos.map((h) => globoSobre(`${r.id}-globo-${h.k + 1}`, `${nombreGlobo(h.g)} de lunares (${r.nombre}, ${h.k + 1})`, r.id, { ...h.g, helio: true }, h.centro, h.direccion, h.impreso)),
  ];
}
const PISO_668: ReadonlyArray<{ codigo: string; x: number; z: number }> = [
  { codigo: "021", x: 175, z: 34 }, { codigo: "029", x: 220, z: 46 }, { codigo: "450", x: 335, z: 44 },
  { codigo: "261", x: 450, z: 50 }, { codigo: "040", x: 505, z: 36 }, { codigo: "012", x: 565, z: 44 },
];
const escena668 = (): Escena => ({
  sala: sala(320, 280, 280, { piso: "#f1eee8" }),
  nodos: [
    ...ramo668({
      id: "ramo-rosado", nombre: "ramo del huevo rosado", huevoPx: 285, huevo: R("R-18", 34, "409"),
      bandas: [{ codigo: "012", dy: 2.6, cadena: false }, { codigo: "021", dy: -1, cadena: false }, { codigo: "150", dy: -4.6, cadena: false }],
      globos: [
        { g: R("R-12", 28, "021"), xy: [278, 65], z: 0, cinta: "#f3d34a" },
        { g: R("R-12", 28, "038"), xy: [237, 190], z: -4, cinta: "#62c6e6" },
        { g: R("R-12", 28, "450"), xy: [320, 195], z: 4, cinta: "#b98be0" },
      ],
    }),
    ...ramo668({
      id: "ramo-verde", nombre: "ramo del huevo verde", huevoPx: 440, huevo: R("R-18", 33, "030"),
      bandas: [{ codigo: "005", dy: 0, cadena: true }],
      globos: [
        { g: R("R-12", 28, "031"), xy: [447, 60], z: 0, cinta: "#9fd65a", impreso: POLKA_LIMA },
        { g: R("R-12", 28, "011"), xy: [400, 160], z: -4, cinta: "#f07aa8" },
        { g: R("R-12", 28, "061"), xy: [465, 180], z: 4, cinta: "#f39a4a" },
      ],
    }),
    ...PISO_668.map((p, k): NodoEscena => ({ id: `piso-${k + 1}`, nombre: `R-9 ${referenciaPorCodigo(p.codigo)?.nombreCompleto ?? p.codigo} de lunares en el piso (${k + 1})`, pieza: piezaGlobo(R("R-9", 20, p.codigo)), colocacion: { en: "piso", xCm: r2((p.x - 365) / 2.8), zCm: p.z, giroGrados: k * 40 } })),
  ],
});
const idea668 = idea({
  id: "idea:huevos-de-pascua-polka", numero: 668, slug: "huevos-de-pascua-polka", nombre: "Huevos de Pascua polka con ramos de helio", ocasiones: ["pascua"],
  fotoUrl: FOTO("2cbffc311b9229423c92f96a17232e29_ec4119a8-aa11-4cb8-bd1c-83a26d4aa80f.jpg"), escena: escena668,
  nota: "Igual: dos huevos de pie (R-18 con el nudo arriba: el rosado con tres aros de T-260 fucsia, amarillo y lila; el verde con una cadena de 10 burbujas blancas) y de cada uno un ramo de 3 R-12 de helio con su cinta (amarillo, azul y lila; verde, rosado y naranja) a 1,3–1,8 m, y seis R-9 en el piso, contados en la foto. La idea no publica productos; medidos (el más cercano en su formato): huevos #dd95b1 → Satín Rosado 409 y #8ad495 → Fashion Verde 030; helio amarillo 021, azul Caribe 038, lila Satín Lila 450, verde Lima 031, rosado → Fashion Rosa 011 (Neón Fucsia 212 a 2 ΔE), naranja 061; piso amarillo 021, verde Trébol 029, lila 450, naranja Neón 261, azul 040 y fucsia 012; aros: fucsia 012, Amarillo Miel 021 y Pastel Dusk Lavanda 150. Distinto: todos son de lunares blancos en la foto, pero la tienda solo vende el lunar en Verde Lima y Rojo: el verde de helio va con el Infinity® Polka Blanco Verde Lima y los demás lisos; la cadena blanca de la foto hace zigzag.",
});

// ----------------------------------------------------------------------------------------------------------
// 695 · Lime Citrus (pared de trenzas en franjas verticales y pedestal)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: los cuartetos grandes miden ~100 px y los chicos ~75 px (R-12 a 24 y 18 cm: 4 px/cm); cada trenza
 * mide ~190 px (47 cm) y son cinco, de x 50 a 945 (2,24 m), del piso hasta salirse de la foto (≥ 2,4 m): verde oscuro,
 * verde lima, gris verdoso, arena y verde oscuro. Delante, un pedestal de cartón kraft (~59 × 70 cm) con un plato verde
 * de pie, dos vasos con servilleta verde lima y tres cupcakes en platitos; piso verde.
 */
const PARED_695: Pieza = { tipo: "pared_trenzas", opciones: { grande: { formatoId: "R-12", infladoCm: 24 }, chico: { formatoId: "R-12", infladoCm: 18 }, anchoCm: 233, altoCm: 250, patron: "columnas", colores: ["029", "031", "481", "071", "029"], empiezaCon: "grande" } };
const PEDESTAL_695 = { x: -13.5, z: -120, alto: 70, radio: 29.5 };
const sobrePedestal695 = (dx: number, dz: number, giro = 0): Colocacion => ({ en: "libre", xCm: PEDESTAL_695.x + dx, yCm: PEDESTAL_695.alto, zCm: PEDESTAL_695.z + dz, giroGrados: giro });
const cupcake695: ElementoEscenografia[] = [
  { forma: "cilindro", base: v(0, 0, 0), radioCm: 6, altoCm: 0.6, hex: "#9fd65a", acabado: "papel" },
  { forma: "cilindro", base: v(0, 0.6, 0), radioCm: 3, radioArribaCm: 3.6, altoCm: 4, hex: "#f2eee4", acabado: "papel" },
  { forma: "cilindro", base: v(0, 4.6, 0), radioCm: 3.4, radioArribaCm: 0.6, altoCm: 4, hex: "#efd9c4", acabado: "mate" },
];
const escena695 = (): Escena => ({
  sala: sala(420, 400, 300, { piso: "#1d8a45", paredes: "#f1f0ec" }),
  nodos: [
    { id: "pared", nombre: "Pared de trenzas en franjas verdes, gris y arena", pieza: PARED_695, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } },
    { id: "pedestal", nombre: "Pedestal de cartón kraft", pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: PEDESTAL_695.radio, altoCm: PEDESTAL_695.alto, hex: "#c18c5d", acabado: "papel" }] }, colocacion: { en: "piso", xCm: PEDESTAL_695.x, zCm: PEDESTAL_695.z, giroGrados: 0 } },
    { id: "plato", nombre: "Plato verde de hojas, de pie", pieza: platos({ cantidad: 1, diametroCm: 23, hex: "#f3f4ec", centro: "#2f8a5a", dePie: true, productoId: null, descripcion: "plato desechable de hojas tropicales" }), colocacion: sobrePedestal695(0, -12) },
    { id: "vaso-izquierda", nombre: "Vaso con servilleta verde lima (izquierda)", pieza: vasos({ cantidad: 1, altoCm: 9, diametroCm: 7, hex: "#f4f6ef", servilleta: "#c8dc3c", productoId: null, descripcion: "vaso desechable de hojas" }), colocacion: sobrePedestal695(-19, -2) },
    { id: "vaso-derecha", nombre: "Vaso con servilleta verde lima (derecha)", pieza: vasos({ cantidad: 1, altoCm: 9, diametroCm: 7, hex: "#9fd65a", servilleta: "#c8dc3c", productoId: null, descripcion: "vaso desechable verde lima" }), colocacion: sobrePedestal695(19, -2) },
    ...[-12, 0, 12].map((dx, k): NodoEscena => ({ id: `cupcake-${k + 1}`, nombre: `Cupcake en platito (${k + 1})`, pieza: { tipo: "escenografia", elementos: cupcake695 }, colocacion: sobrePedestal695(dx, 10 - Math.abs(dx) * 0.4) })),
  ],
});
const idea695 = idea({
  id: "idea:lime-citrus", numero: 695, slug: "lime-citrus", nombre: "Lime Citrus: pared de trenzas y pedestal", ocasiones: ["fiesta-verano"],
  fotoUrl: FOTO("ideas_de_fiesta_t_o_lime_citrus_3e3a82cb-6648-4d23-b088-0d07f3bd1ef5.jpg"), escena: escena695,
  nota: "Igual: pared de 5 trenzas de cuartetos que alternan grande y chico (R-12 a 24 y 18 cm, ~2,3 × 2,5 m), cada trenza de un color como en la foto —Verde Trébol, Verde Lima, gris verdoso, Arena y Verde Trébol—, con los tres productos que publica la idea, y delante el pedestal de kraft con plato de pie, dos vasos con servilleta verde lima y tres cupcakes; piso verde y pared blanca. Distinto: el verde oscuro mide #069c47 (entre Verde Selva 032 y Metal Verde 530): va el Verde Trébol 029 publicado; la trenza gris no es de un producto publicado (medido #a3aaa5 mate → Satín Plata 481, el no cromado más cercano; el Reflex Plata es cromado); la foto se corta arriba (la altura es supuesta); el estampado de hojas del plato y los vasos no se dibuja (utilería genérica).",
}, [
  P("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031"),
  P("GLOBO REDONDO FASHION VERDE TREBOL", "/products/globo-latex-redondo-fashion-verde-trebol", "R-12", "029"),
  P("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071"),
]);

// ----------------------------------------------------------------------------------------------------------
// 709 · Malla fútbol (pared verde con balones y globos negros encima)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: la pared de trenzas verde va de x 30 a 690 y de y 85 a 500 (R-12 de ~70 px a 24 cm: ~2,8 px/cm;
 * 2,4 × 1,4 m). Encima, contados uno a uno: 4 balones grandes (R-24 de ~42 cm), 10 balones chicos (R-12 de ~16 cm),
 * 2 negros grandes (R-18 de ~40 cm), 3 negros medianos (R-12 de ~22 cm) y 9 negros chicos (R-9 de ~17 cm).
 */
const PARED_709: Pieza = { tipo: "pared_trenzas", opciones: { grande: { formatoId: "R-12", infladoCm: 24 }, chico: { formatoId: "R-12", infladoCm: 19 }, anchoCm: 236, altoCm: 148, patron: "un_color", colores: ["030"], empiezaCon: "grande" } };
/** Ancho y alto que arma la pared (5 trenzas de 47,8 cm; 9 cuartetos de 15,9 cm). */
const ANCHO_709 = 5 * ((24 + 19) * 50) / 45, ALTO_709 = 9 * (((24 + 19) / 2) * (100 / 6 / 22.5));
const px709 = (x: number, y: number): Vec3 => v(r2(((x - 30) / 660) * ANCHO_709), r2(((500 - y) / 415) * ALTO_709), 30);
const ENCIMA_709: ReadonlyArray<{ g: ParteGlobo; nombre: string; puntos: ReadonlyArray<[number, number]>; impreso?: string }> = [
  { g: R("R-24", 42, "005"), nombre: "R-24 Infinity® Balón de Fútbol", puntos: [[75, 100], [365, 110], [230, 390], [487, 347]], impreso: BALON },
  { g: R("R-12", 16, "005"), nombre: "R-12 Infinity® Balón de Fútbol", puntos: [[135, 180], [277, 225], [130, 377], [330, 377], [82, 477], [587, 127], [487, 230], [682, 322], [380, 430], [630, 467]], impreso: BALON },
  { g: R("R-18", 40, "080"), nombre: "R-18 Fashion Negro", puntos: [[82, 307], [665, 165]] },
  { g: R("R-12", 22, "080"), nombre: "R-12 Fashion Negro", puntos: [[230, 165], [330, 280], [487, 112]] },
  { g: R("R-9", 17, "080"), nombre: "R-9 Fashion Negro", puntos: [[175, 227], [132, 427], [280, 472], [432, 172], [430, 280], [642, 282], [582, 387], [477, 427], [680, 417]] },
];
const escena709 = (): Escena => ({
  sala: sala(420, 320, 280),
  nodos: [
    { id: "pared", nombre: "Pared de trenzas Fashion Verde", pieza: PARED_709, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 30 } },
    ...ENCIMA_709.flatMap((e, j) => e.puntos.map(([x, y], k) => globoSobre(`encima-${j + 1}-${k + 1}`, `${e.nombre} encima (${k + 1})`, "pared", e.g, px709(x, y), AL_FRENTE, e.impreso))),
  ],
});
const idea709 = idea({
  id: "idea:malla-futbol", numero: 709, slug: "malla-futbol", nombre: "Malla fútbol: pared verde con balones", ocasiones: ["cumpleanos", "fiesta-infantil"],
  fotoUrl: FOTO("a1d3e8359e951cd6ce43c7d988bbd198.jpg"), escena: escena709,
  nota: "Igual: pared de 5 trenzas de cuartetos verdes que alternan grande y chico (~2,4 × 1,4 m) y encima, en su sitio de la foto, 4 balones grandes (R-24) y 10 chicos (R-12 a 16 cm) del Infinity® Balón de Fútbol, 2 negros R-18, 3 negros R-12 y 9 negros R-9, con los tres productos que publica la idea. Distinto: el verde de la foto mide #02ae31 (Verde Trébol 029, a 4 ΔE) y tiene dos tonos por la luz: va el Fashion Verde 030 publicado, de un solo tono; los negros miden más cerca de Metal Negro 580, va el Fashion Negro 080 publicado; la pared va con su trenza (en la foto los globos se ven más sueltos).",
}, [
  P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
  P("GLOBO REDONDO FASHION VERDE", "/products/globo-para-fiesta-latex-redondo-fashion-verde", "R-12", "030"),
  P("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", null, null),
]);

// ----------------------------------------------------------------------------------------------------------
// 710 · Malla Link-O-Loon amor en fucsia y lila
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: malla de Link-O-Loon plateada (se ven sus colas en los bordes) de x 115 a 625 y de y 15 a 530
 * (R-12 de ~68 px a 25 cm: 2,7 px/cm; ~1,8 × 1,8 m) y encima una retícula de 7 × 7 globos (paso ~76 px = 26 cm, el de
 * la malla) en franjas diagonales: la diagonal de R-18 fucsia (7), a cada lado una de fucsia perlado (11) y otra de
 * rosado pastel (11), luego transparentes de confeti rosado (6) y el resto plata (14), contados uno a uno.
 */
const PASO_710 = (25 * 1.47) / Math.SQRT2;
const MALLA_710: Pieza = { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 25, anchoCm: r2(7 * PASO_710), altoCm: r2(7 * PASO_710), patron: "un_color", colores: ["481"], union: { infladoCm: 8, codigo: "481" } };
/** Las 7 filas de la foto, de arriba abajo: F fucsia grande, D fucsia perlado (Duo), P pastel, C confeti, S plata. */
const RETICULA_710 = ["FDPSCSS", "PFDPSCS", "DPFDPSC", "SDPFDPS", "CSDPFDP", "SCSDPFD", "SSCSDPF"];
const TIPOS_710: Readonly<Record<string, { g: ParteGlobo; nombre: string; impreso?: string }>> = {
  F: { g: R("R-18", 36, "012"), nombre: "R-18 Fashion Fucsia" },
  D: { g: R("R-12", 25, "512"), nombre: "R-12 Duo Fucsia" },
  P: { g: R("R-12", 25, "609"), nombre: "R-12 Pastel Mate Rosado" },
  C: { g: R("R-12", 25, "390"), nombre: "R-12 Infinity® Graffiti Rosa transparente", impreso: GRAFFITI_ROSA },
  S: { g: R("R-12", 25, "981"), nombre: "R-12 Reflex Plata" },
};
const escena710 = (): Escena => ({
  sala: sala(320, 280, 280),
  nodos: [
    { id: "malla", nombre: "Malla Link-O-Loon Satín Plata", pieza: MALLA_710, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 40 } },
    ...RETICULA_710.flatMap((fila, r) => [...fila].map((letra, c) => {
      const t = TIPOS_710[letra]!;
      return globoSobre(`encima-${r + 1}-${c + 1}`, `${t.nombre} (fila ${r + 1}, ${c + 1})`, "malla", t.g, v(r2((c + 0.5) * PASO_710), r2((6.5 - r) * PASO_710), 30), AL_FRENTE, t.impreso);
    })),
  ],
});
const idea710 = idea({
  id: "idea:malla-link-o-loon-r-amor-en-fucsia-y-lila", numero: 710, slug: "malla-link-o-loon-r-amor-en-fucsia-y-lila", nombre: "Malla Link-O-Loon amor en fucsia", ocasiones: ["san-valentin"],
  fotoUrl: FOTO("IMG_20200814_175713_59b3aa7e-e5f5-452a-87c3-7743835a140b.jpg"), escena: escena710,
  nota: "Igual: malla de Link-O-Loon de ~1,8 × 1,8 m y encima la retícula de 7 × 7 globos de la foto en franjas diagonales: la diagonal de 7 R-18 Fashion Fucsia, 11 Duo Fucsia, 11 Pastel Mate Rosado, 6 transparentes de confeti rosado y 14 Reflex Plata, contados uno a uno, con los productos que publica la idea. Distinto: el Reflex Plata no se fabrica en Link-O-Loon: la malla va en Link-O-Loon Satín Plata 481 (no publicado); el Duo Fucsia (un fucsia dentro de otro) no tiene código en la tabla: se dibuja como Metal Fucsia 512, el fucsia perlado más cercano (medido #b1216e); los transparentes de confeti van con el Infinity® Graffiti Rosa transparente (la idea no publica el impreso); el fucsia grande mide #cb3b84 (más cerca de Fashion Rosa 011): va el Fucsia 012 publicado.",
}, [
  P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981"),
  P("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609"),
  P("GLOBO REDONDO DUO FUCSIA", "/products/globo-para-fiesta-latex-redondo-duo-fucsia", "R-12", "512"),
  P("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012"),
]);

// ----------------------------------------------------------------------------------------------------------
// 712 · Malla marina (pared en franjas con mármol y dos ramos)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 579: los R-12 miden ~55 px (25 cm: 2,2 px/cm) y los R-5 de relleno ~25 px. Pared de x 182 a 532 (1,6 m)
 * y de y 15 a 568 (2,5 m) en cinco franjas de R-12 al tresbolillo con R-5 del mismo color en los huecos: de abajo
 * arriba azul (51 cm), aguamarina (55), violeta cromado (41), lila perlado (57) y rosado perlado (48); 14 de mármol
 * repartidos (4, 3, 2, 3 y 2). A cada lado un ramo de mármol con varillas lila: el izquierdo de 5 y el derecho de 6.
 */
type Franja712 = { id: string; nombre: string; codigo: string; alto: number; altoFoto: number; arriba: number; marmol: ReadonlyArray<[number, number]> };
/**
 * De abajo arriba; `arriba` es la y (px) de su borde de arriba y `altoFoto` lo que mide en la foto; el contorno (`alto`)
 * es 11 cm menor porque las celdas sobresalen ~6 cm arriba y abajo y cada franja se apoya en la de abajo. Los mármoles,
 * en px de la foto.
 */
const FRANJAS_712: readonly Franja712[] = [
  { id: "franja-azul", nombre: "Franja Fashion Azul", codigo: "040", alto: 40, altoFoto: 51, arriba: 455, marmol: [[350, 512], [242, 530]] },
  { id: "franja-aguamarina", nombre: "Franja Fashion Aguamarina", codigo: "037", alto: 44, altoFoto: 55, arriba: 335, marmol: [[235, 395], [390, 400], [507, 427]] },
  { id: "franja-violeta", nombre: "Franja Reflex Violeta", codigo: "951", alto: 30, altoFoto: 41, arriba: 245, marmol: [[512, 295], [317, 327]] },
  { id: "franja-lila", nombre: "Franja Satín Lila", codigo: "450", alto: 46, altoFoto: 57, arriba: 120, marmol: [[320, 177], [210, 215], [437, 222]] },
  { id: "franja-rosada", nombre: "Franja Satín Rosado", codigo: "409", alto: 37, altoFoto: 48, arriba: 15, marmol: [[325, 35], [475, 42], [247, 97], [395, 105]] },
];
const piezaFranja712 = (f: Franja712, impresos: ImpresoEnPieza[] = []): Pieza => ({
  tipo: "forma",
  forma: {
    clase: "rellena", contorno: { tipo: "libre", puntos: [{ x: -79.5, y: 0 }, { x: 79.5, y: 0 }, { x: 79.5, y: f.alto }, { x: -79.5, y: f.alto }] },
    tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 25, celda: "tresbolillo" }, colores: { codigos: [f.codigo], patron: "un_color" },
    acento: { formatoId: "R-5", infladoCm: 10, codigos: [f.codigo], cada: 1 },
  } satisfies OpcionesForma,
  ...(impresos.length ? { impresos } : {}),
});
/**
 * Los R-12 de una pieza más cercanos a unos puntos (x, y) de su espacio: ahí van los impresos. Cada franja apilada va
 * girada media vuelta sobre la anterior (la colocación `sobre` con la normal hacia arriba la refleja en x), así que
 * en las franjas impares la x de la foto va al revés.
 */
function indicesCercanos(pieza: Pieza, puntos: ReadonlyArray<{ x: number; y: number }>): number[] {
  const centros = armarPieza(pieza).globos.map((g, i) => ({ i, f: g.formatoId, c: mas(g.nudo, por(g.direccion, centroCuerpo("redondo", g.infladoCm) + g.cuelloExtraCm)) })).filter((g) => g.f === "R-12");
  const usados = new Set<number>();
  return puntos.map((p) => {
    let mejor = centros[0]!;
    for (const g of centros) if (!usados.has(g.i) && Math.hypot(g.c.x - p.x, g.c.y - p.y) < Math.hypot(mejor.c.x - p.x, mejor.c.y - p.y)) mejor = g;
    if (usados.has(mejor.i)) mejor = centros.find((g) => !usados.has(g.i)) ?? mejor;
    usados.add(mejor.i);
    return mejor.i;
  });
}
const PIEZAS_712 = perezoso(() => FRANJAS_712.map((f, k) => {
  const sinImpresos = piezaFranja712(f);
  const espejo = k % 2 === 1 ? -1 : 1;
  const puntos = f.marmol.map(([x, y]) => ({ x: espejo * ((x - 357) / 2.2), y: -6 + (f.alto + 12) * (1 - (y - f.arriba) / (f.altoFoto * 2.2)) }));
  return piezaFranja712(f, [{ impresoId: GRAFFITI_INVIERNO, globos: indicesCercanos(sinImpresos, puntos) }]);
}));
type Ramo712 = { id: string; nombre: string; basePx: number; z: number; globos: ReadonlyArray<{ impreso: string; xy: [number, number]; z: number }> };
const NOMBRE_GRAFFITI_712: Readonly<Record<string, string>> = { [GRAFFITI_INVIERNO]: "Graffiti Invierno", [GRAFFITI_CIELO]: "Graffiti Cielo", [GRAFFITI_ROSA]: "Graffiti Rosa" };
function ramo712(r: Ramo712): NodoEscena[] {
  const globos = r.globos.map((h, k) => {
    const centro = v(r2((h.xy[0] - r.basePx) / 2.2), r2((568 - h.xy[1]) / 2.2), h.z);
    const direccion = unitario(mas(por(unitario(centro), 0.3), ARRIBA));
    return { ...h, k, centro, direccion, nudo: menos(centro, por(direccion, centroCuerpo("redondo", 28))) };
  });
  return [
    { id: r.id, nombre: `Varillas del ${r.nombre}`, pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 3, altoCm: 1, hex: "#a37bd8", acabado: "satinado" }, ...globos.map((h) => cinta(v(0, 1, 0), h.nudo, "#a37bd8", 0.35))] }, colocacion: { en: "libre", xCm: r2((r.basePx - 357) / 2.2), yCm: 0, zCm: r.z, giroGrados: 0 } },
    ...globos.map((h) => globoSobre(`${r.id}-globo-${h.k + 1}`, `R-12 Infinity® ${NOMBRE_GRAFFITI_712[h.impreso]} (${r.nombre}, ${h.k + 1})`, r.id, R("R-12", 28, "390"), h.centro, h.direccion, h.impreso)),
  ];
}
const escena712 = (): Escena => ({
  sala: sala(420, 320, 300),
  nodos: [
    ...FRANJAS_712.map((f, k): NodoEscena => (k === 0
      ? { id: f.id, nombre: f.nombre, pieza: PIEZAS_712()[0]!, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } }
      : piezaSobre(f.id, f.nombre, FRANJAS_712[k - 1]!.id, PIEZAS_712()[k]!, v(0, r2(topeDe(PIEZAS_712()[k - 1]!) - 6), 0), ARRIBA, -90))),
    ...ramo712({ id: "ramo-izquierdo", nombre: "ramo izquierdo", basePx: 127, z: -95, globos: [
      { impreso: GRAFFITI_INVIERNO, xy: [132, 197], z: -4 }, { impreso: GRAFFITI_CIELO, xy: [97, 257], z: 0 }, { impreso: GRAFFITI_CIELO, xy: [152, 247], z: 4 },
      { impreso: GRAFFITI_INVIERNO, xy: [155, 282], z: -6 }, { impreso: GRAFFITI_ROSA, xy: [120, 337], z: 4 },
    ] }),
    ...ramo712({ id: "ramo-derecho", nombre: "ramo derecho", basePx: 594, z: -95, globos: [
      { impreso: GRAFFITI_INVIERNO, xy: [587, 212], z: -2 }, { impreso: GRAFFITI_INVIERNO, xy: [612, 242], z: -8 }, { impreso: GRAFFITI_CIELO, xy: [557, 277], z: 2 },
      { impreso: GRAFFITI_INVIERNO, xy: [622, 275], z: 0 }, { impreso: GRAFFITI_ROSA, xy: [572, 312], z: 6 }, { impreso: GRAFFITI_CIELO, xy: [637, 327], z: 4 },
    ] }),
  ],
});
const idea712 = idea({
  id: "idea:malla-marina", numero: 712, slug: "malla-marina", nombre: "Malla marina en franjas con ramos de mármol", ocasiones: ["primer-cumpleanos", "cumpleanos"],
  fotoUrl: FOTO("malla-Marina_d8c14a3b-9709-46b1-a5d2-7ef31d4d5552.jpg"), escena: escena712,
  nota: "Igual: pared de ~1,6 × 2,5 m en cinco franjas de R-12 al tresbolillo con R-5 del mismo color en los huecos —de abajo arriba Fashion Azul, Fashion Aguamarina, Reflex Violeta, Satín Lila y Satín Rosado, los cinco productos que publica la idea— con 14 R-12 Infinity® Graffiti Invierno repartidos como en la foto (4, 3, 2, 3 y 2), y a cada lado un ramo de mármol con varillas lila (5 y 6 globos: Graffiti Invierno, Cielo y Rosa). Distinto: en la foto los mármoles de la pared toman el color de su franja (llevan un globo de color dentro): aquí son el transparente con el impreso; el azul y el aguamarina miden #0284bd y #01b3ba (más cerca de Neón Azul y Azul Caribe): van los publicados; los Graffiti Cielo y Rosa de los ramos no los publica la idea; la cantidad de R-5 de relleno es la del motor de celdas.",
}, [
  P("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente", "R-12", null),
  P("GLOBO REDONDO SATIN ROSADO", "/products/globo-para-fiesta-latex-redondo-satin-rosado", "R-12", "409"),
  P("GLOBO REDONDO SATIN LILA", "/products/globo-para-fiesta-latex-redondo-satin-lila", "R-12", "450"),
  P("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951"),
  P("GLOBO LATEX REDONDO FASHION AGUAMARINA", "/products/globo-para-fiesta-latex-redondo-fashion-aguamarina", "R-12", "037"),
  P("GLOBO REDONDO FASHION AZUL", "/products/globo-para-fiesta-latex-redondo-fashion-azul", "R-12", "040"),
]);

// ----------------------------------------------------------------------------------------------------------
// 713 · Malla orgánica naval
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-5 miden ~30 px y los R-12 ~60 px (25 cm: 2,4 px/cm). Pared orgánica de x 75 a 665 y de y 15
 * a 560 (~2,45 × 2,25 m) de azul naval, rojo y blanco mezclados al azar, de R-5 a R-24 (los grandes, 95–115 px:
 * R-18 y algún R-24).
 */
const MALLA_713: Pieza = {
  tipo: "forma",
  forma: {
    clase: "rellena", contorno: { tipo: "libre", puntos: [{ x: -123, y: 0 }, { x: 123, y: 0 }, { x: 123, y: 227 }, { x: -123, y: 227 }] },
    tecnica: { tipo: "organico", radioCm: 22, mezcla: { "R-24": 0.04, "R-18": 0.14, "R-12": 0.52, "R-9": 0.3 }, semilla: 713, inflados: { "R-24": 48, "R-18": 36, "R-12": 25, "R-9": 18, "R-5": 12 } },
    colores: { codigos: ["044", "015", "005"], patron: "mezcla", pesos: [0.4, 0.32, 0.28], semilla: 713 },
  },
};
const escena713 = (): Escena => ({
  sala: sala(420, 300, 300),
  nodos: [{ id: "malla", nombre: "Malla orgánica azul naval, roja y blanca", pieza: MALLA_713, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 15 } }],
});
const idea713 = idea({
  id: "idea:malla-organica-naval", numero: 713, slug: "malla-organica-naval", nombre: "Malla orgánica naval", ocasiones: ["cumpleanos"],
  fotoUrl: FOTO("49e234b8402f01cf61dde963073e12bf.jpg"), escena: escena713,
  nota: "Igual: pared orgánica de ~2,45 × 2,25 m de azul naval, rojo y blanco mezclados al azar (más o menos 40 %, 32 % y 28 %, como en la foto), de R-5 a R-24 con la mayoría R-12. La idea no publica productos; medidos: azul #0e2c49 → Fashion Azul Naval 044, rojo #ff362f → Fashion Rojo 015, blanco #eaece7 → Fashion Blanco 005 (Satín Blanco queda a menos de 6 ΔE: va el Fashion). Distinto: las cantidades y el sitio de cada globo son los del motor orgánico (no contados uno a uno; su relleno de tríos de R-5 pone más chicos de los que se ven); el R-5 blanco suelto del centro de la foto no se pone aparte.",
});

// ----------------------------------------------------------------------------------------------------------
// 716 · Malla Pastel Mate Melón (flores sobre un fondo crema)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: los pétalos miden ~78 px (R-12 a 24 cm: 3,25 px/cm) y los R-5 crema ~28 px (~9 cm). Pared de x 60
 * a 950 y de y 90 a 890 (~2,7 × 2,5 m): 26 flores de 4 pétalos melón con un anillo de 6 R-5 crema y un R-5 melón al
 * centro, 9 florecitas de 5 R-5 melón con anillo crema, un R-18 melón en el borde derecho y el fondo crema asomando
 * entre las flores. Centros sacados de la foto (manchas de crema). Origen: el pie de la pared (px 505, 890).
 */
const px716 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 505) / 3.25), r2((890 - y) / 3.25), z);
const FONDO_716: Pieza = {
  tipo: "forma",
  forma: {
    clase: "rellena", contorno: { tipo: "libre", puntos: [{ x: -137, y: 0 }, { x: 137, y: 0 }, { x: 137, y: 248 }, { x: -137, y: 248 }] },
    tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 25, celda: "tresbolillo" }, colores: { codigos: ["107"], patron: "un_color" },
  },
};
const FLORES_716: ReadonlyArray<[number, number]> = [
  [338, 146], [193, 222], [510, 201], [665, 213], [818, 233], [329, 289], [434, 357], [669, 345], [182, 381], [854, 370], [331, 421], [584, 446], [773, 459],
  [434, 522], [305, 561], [566, 577], [692, 550], [834, 561], [187, 662], [585, 689], [755, 693], [841, 677], [316, 732], [445, 722], [128, 781], [526, 802],
];
const FLORECITAS_716: ReadonlyArray<[number, number]> = [[401, 249], [578, 301], [561, 361], [724, 362], [863, 467], [165, 537], [246, 480], [403, 637], [423, 836]];
const flor716 = (giro: number): Decoracion => flor({ petalos: { ...R("R-12", 24, "663"), cantidad: 4, aperturaGrados: 0, giroGrados: giro }, corona: { ...R("R-5", 8.8, "107"), cantidad: 6 }, centro: { ...R("R-5", 8, "663"), cantidad: 1 } });
const FLORECITA_716 = flor({ petalos: { ...R("R-5", 8, "663"), cantidad: 5, aperturaGrados: 0, giroGrados: 18 }, corona: { ...R("R-5", 5.2, "107"), cantidad: 6 }, centro: { ...R("R-5", 5.2, "663"), cantidad: 1 } });
const escena716 = (): Escena => ({
  sala: sala(420, 300, 300),
  nodos: [
    { id: "fondo", nombre: "Fondo de R-12 Pastel Dusk Crema", pieza: FONDO_716, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 10 } },
    ...FLORES_716.map(([x, y], k) => decoSobre(`flor-${k + 1}`, `Flor melón con anillo crema (${k + 1})`, "fondo", flor716((k * 37) % 90), px716(x, y, 30), AL_FRENTE)),
    ...FLORECITAS_716.map(([x, y], k) => decoSobre(`florecita-${k + 1}`, `Florecita de R-5 melón (${k + 1})`, "fondo", FLORECITA_716, px716(x, y, 30), AL_FRENTE)),
    globoSobre("melon-grande", "R-18 Pastel Mate Melón (borde derecho)", "fondo", R("R-18", 34, "663"), px716(900, 690, 30), AL_FRENTE),
  ],
});
const idea716 = idea({
  id: "idea:malla-pastel-mate-melon", numero: 716, slug: "malla-pastel-mate-melon", nombre: "Malla Pastel Mate Melón de flores", ocasiones: ["general"],
  fotoUrl: FOTO("Lanzamiento_PM_Melon_Decoracion.jpg"), escena: escena716,
  nota: "Igual: pared de ~2,7 × 2,5 m con las 26 flores de la foto (4 pétalos R-12 Pastel Mate Melón, anillo de 6 R-5 Pastel Dusk Crema y un R-5 melón al centro) y 9 florecitas de R-5 melón con anillo crema, cada una en su sitio, un R-18 melón en el borde derecho y el fondo crema asomando entre las flores, con los dos productos que publica la idea. Distinto: el melón de la foto mide más naranja (#ee9775, la foto está saturada: los crema miden justo Pastel Mate Melón) y va el 663 publicado; el fondo crema es una capa de R-12 al tresbolillo con R-5 en sus huecos (en la foto apenas se ve: la cantidad es la del motor de celdas, no contada); los pétalos de cada flor van todos del mismo tamaño.",
}, [
  P("GLOBO REDONDO PASTEL MATE MELON", "/products/globo-para-fiesta-latex-redondo-pastel-mate-melon", "R-12", "663"),
  P("GLOBO LATEX REDONDO PASTEL DUSK CREMA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-crema", "R-12", "107"),
]);

// ----------------------------------------------------------------------------------------------------------
// 751 · Mister Halloween (columna con calabaza)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: la columna mide ~170 px de ancho y sube 6 niveles en ~295 px (R-12 a 22 cm: 2,8 px/cm; paso de
 * 17,6 cm): naranja, negro impreso, naranja, negro, naranja, negro de abajo arriba; encima una calabaza de ~68 cm con
 * la cara impresa y rizos verdes en la coronilla (~2 m en total).
 */
const COLUMNA_751: Pieza = {
  tipo: "forma",
  forma: { clase: "cono", altoCm: 112, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 22, infladoPuntaCm: 22, globosBase: 4, globosPunta: 4, colores: { codigos: ["061", "080"], patron: "franjas", franjaNiveles: 1 } },
  impresos: [{ impresoId: "2-caras-happy-halloween-fashion-surtido-negro-naranja", codigo: "080" }],
};
const TOPE_751 = perezoso(() => topeDe(COLUMNA_751));
const CALABAZA_751: PropiedadesCalabaza = { globo: R("R-24", 60, "061"), cara: { hex: "#151515" }, tallo: { formatoId: "T-260", grosorCm: 4.5, codigo: "029", lazos: 4, largoLazoCm: 13, zarcillos: true } };
const escena751 = (): Escena => ({
  sala: sala(320, 280, 280),
  nodos: [
    { id: "columna", nombre: "Columna naranja y negra de Halloween", pieza: COLUMNA_751, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    amarre("amarre", "Amarre de la calabaza", "columna", v(0, r2(TOPE_751() - 8), 0), "#e75d1d"),
    decoSobre("calabaza", "Calabaza R-24 con cara (remate)", "amarre", { tipo: "calabaza", propiedades: CALABAZA_751 }, enAmarre(v(0, 32, -30)), enAmarre(AL_FRENTE)),
  ],
});
const idea751 = idea({
  id: "idea:mister-halloween", numero: 751, slug: "mister-halloween", nombre: "Mister Halloween: columna con calabaza", ocasiones: ["halloween"],
  fotoUrl: FOTO("106c4ba7d919252fb84055ad40c0a2d0_85bf869e-1dfa-4773-9674-aadba8036c42.jpg"), escena: escena751,
  nota: "Igual: columna de 6 cuartetos R-12 alternando naranja liso y negro impreso (los negros con el «Happy Halloween» naranja de la tienda, el Redondo Happy Halloween surtido negro y naranja) y encima una calabaza R-24 naranja con la cara negra y el tallo de T-260 verde con zarcillos: ~2 m. La idea no publica productos; medidos: naranja #e5620c → Fashion Naranja 061, negro 080, verde #2cb857 → Fashion Verde Trébol 029. Distinto: la calabaza de la foto mide ~68 cm (más que un R-24 lleno: va a 60 cm) y su cara es impresa; los rizos verdes de la foto son más sueltos; el impreso de la tienda lleva texto y una calabacita, no las calabazas de la foto.",
});

// ----------------------------------------------------------------------------------------------------------
// 779 · Mural neón (malla negra con neones en las celdas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: retícula de 13 × 9 neones con paso de ~48 px, alternando uno grande (~40 px) y uno chico (~23 px)
 * como un tablero, sobre una malla de Link-O-Loon negra: el paso de la retícula es el de la malla (Link-O-Loon a 24 cm:
 * 25 cm; 1,93 px/cm), así el mural mide ~3 × 2 m. Los grandes van en los nudos de la malla y los chicos en el centro
 * de cada rombo; los colores van en franjas diagonales de 4 columnas: verde, naranja y fucsia.
 */
const PASO_779 = (24 * 1.47) / Math.SQRT2;
const MALLA_779: Pieza = { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 24, anchoCm: r2(12 * PASO_779), altoCm: r2(8 * PASO_779), patron: "un_color", colores: ["080"], union: { infladoCm: 8, codigo: "080" } };
const NEON_779 = ["030", "261", "212"];
const escena779 = (): Escena => ({
  sala: sala(480, 320, 300),
  nodos: [
    { id: "malla", nombre: "Malla Link-O-Loon Fashion Negro", pieza: MALLA_779, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 30 } },
    ...Array.from({ length: 13 * 9 }, (_, n) => {
      const i = n % 13, j = Math.floor(n / 13);
      const grande = (i + j) % 2 === 0;
      const codigo = NEON_779[Math.floor((i + (8 - j)) / 4) % 3]!;
      const g = grande ? R("R-12", 21, codigo) : R("R-5", 12, codigo);
      return globoSobre(`neon-${i + 1}-${j + 1}`, `${nombreGlobo(g)} (columna ${i + 1}, fila ${9 - j})`, "malla", g, v(r2(i * PASO_779), r2(j * PASO_779), 30), AL_FRENTE);
    }),
  ],
});
const idea779 = idea({
  id: "idea:mural-neon", numero: 779, slug: "mural-neon", nombre: "Mural neón", ocasiones: ["cumpleanos"],
  fotoUrl: FOTO("b8e14c7a69386be4b3b5801b59a9eb42_6e49e98c-63cc-4166-889a-ac7a477fedd4.jpg"), escena: escena779,
  nota: "Igual: malla de Link-O-Loon negra de ~3 × 2 m y encima la retícula de 13 × 9 neones de la foto, alternando un R-12 (59) y un R-5 (58) como un tablero, en franjas diagonales de verde, naranja y fucsia, contada uno a uno. La idea no publica productos; medidos (el más cercano en su formato): verde #02c28d → Fashion Verde 030, naranja #ff8b63 → Neón Naranja 261, fucsia #e870b2 → Neón Fucsia 212, negro 080. Distinto: la escala sale de suponer Link-O-Loon de 12\" (con LOL-6 el mural mediría ~1,9 × 1,3 m y los neones serían R-5); el brillo neón (luz negra) no se modela.",
});

/** Ideas de fiesta de sempertex.com digitalizadas: lote 08. */
export const LOTE_08: readonly IdeaDigitalizada[] = [
  idea581, idea582, idea595, idea596, idea601, idea605, idea608, idea617, idea623, idea644,
  idea646, idea668, idea695, idea709, idea710, idea712, idea713, idea716, idea751, idea779,
];
