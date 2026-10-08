import { ideaPerezosa, perezoso, type ClaseIdea, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { mesaConMantel, type ElementoEscenografia } from "../escenografia";
import { banderin } from "../utileria";
import { opcionesAroOrganico, opcionesRacimosLibres, opcionesTroncoConBase, type RacimoLibre } from "../estructuras-organicas";
import { formaColumna, type ColorOrganico, type OpcionesOrganico, type RellenoOrganico } from "../organico";
import type { PatronColumna } from "../columnas";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesMono } from "../figuras";
import type { PropiedadesArana, PropiedadesCalabaza } from "../halloween";
import { impresoPorId, impresoPorUrl, type ImpresoEnPieza } from "../impresos-catalogo";
import type { Vec3 } from "../modulos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 07** (los números de `clasif/lote-07.json`: 9 columnas —de
 * cuartetos, topiarios de tubito trenzado y orgánicas—, un arco, 3 aros, 4 escenas, 2 centros de mesa y 2 figuras).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, recortada, ampliada y con más
 * contraste, y con el perfil de ancho por filas de píxeles (dónde empieza y acaba cada nivel):
 * - **Conteo**: los globos visibles, contando los que asoman por detrás; cuartetos por nivel (2 de frente = cuarteto
 *   derecho; 3 = girado 1/8) y niveles por los bultos del borde. Ninguna idea del lote publica «Materiales» con
 *   cantidades: todo lo contado va con `contada: true`. En lo orgánico el motor da los globos para el grosor y el largo
 *   medidos (no se cuentan uno a uno: la nota lo dice). Los tubitos se cuentan por largo, en tubitos enteros.
 * - **Medidas**: la escala sale de un globo de tamaño conocido en la misma foto (R-24 de remate ≈ 55–58 cm, R-12 de
 *   estructura ≈ 25 cm, R-12 de helio ≈ 28 cm, R-5 ≈ 12 cm, T-260 ≈ 5 cm de grueso) y con ella alturas, anchos y tamaños.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice). Si
 *   no, se midió en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla
 *   oficial) y se tomó el código más cercano que se fabrica en ese formato; si la sombra o el brillo engañan, se dice.
 * - **Impresos**: si la tienda lo tiene (`impresos-catalogo.ts`: Bigotes y Corbatines Cristal, Mi Primera Comunión
 *   Palomas, Corazones Brillantes, Feliz Cumpleaños Destellos, Happy Halloween), el globo lo lleva sobre su látex; si no
 *   (logos, «15», «PAPÁ», lunares sobre fucsia, corazones neón…), va el liso de su fondo y la nota lo dice.
 * - **Jerarquía**: cada estructura es una raíz y lo suyo cuelga de ella (`sobre`), para que la biblioteca saque «esta
 *   estructura con sus decoraciones» y «esta decoración sola». En los topiarios de tubito trenzado la raíz es el tallo
 *   (tubitos: sin cuerpos de globo), así lo que va sobre él queda exactamente donde se pide. En las columnas de cuartetos
 *   de tamaños distintos los niveles van sueltos y apilados (giro de 1/8 por nivel, como en los lotes 01 y 03) y lo que
 *   va encima (cruces, remates, flores) va `sobre` el nivel que lo lleva o pegado a él.
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
const pto = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const redondo = (p: Vec3): Vec3 => v(r2(p.x), r2(p.y), r2(p.z));
const rad = (g: number) => (g * Math.PI) / 180;
const ARRIBA = v(0, 1, 0);
const ABAJO = v(0, -1, 0);
const AL_FRENTE = v(0, 0, 1);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
const libre = (xCm: number, yCm: number, zCm: number, giroGrados = 0): Colocacion => ({ en: "libre", xCm: r2(xCm), yCm: r2(yCm), zCm: r2(zCm), giroGrados });
const enPiso = (xCm: number, zCm: number, giroGrados = 0): Colocacion => ({ en: "piso", xCm, zCm, giroGrados });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos?: Partial<Sala["tonos"]>): Sala =>
  ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm, tonos: { ...SALA_INICIAL.tonos, ...tonos } });

/** Un globo suelto; con `impresoId`, con el impreso de la tienda sobre su látex. */
const globo = (g: ParteGlobo, impresoId?: string): Pieza =>
  ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, codigo: g.codigo }] } : {}) });

/** Una columna de cuartetos de `niveles` niveles (la trenza de Sempertex: un nivel cada 0,8 diámetros). */
function columna(formatoId: string, infladoCm: number, niveles: number, colores: string[], patron: PatronColumna = "un_color", impresos?: ImpresoEnPieza[]): Pieza {
  return { tipo: "columna", formatoId, infladoCm, alturaCm: r2(niveles * infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) };
}

const deco = (decoracion: Decoracion, deFrente = false): Pieza => ({ tipo: "decoracion", decoracion, ...(deFrente ? { deFrente: true } : {}) });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
/** Un anillo de `cantidad` globos iguales alrededor de un centro (collar de R-5, quinteto, tercia). */
const anillo = (g: ParteGlobo, cantidad: number, aperturaGrados = 0, giroGrados = 0, centro: (ParteGlobo & { cantidad: 1 | 3 }) | null = null): Decoracion =>
  flor({ petalos: { ...g, cantidad, aperturaGrados, giroGrados }, centro });
const lazos = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, anchoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados, giroGrados });
const burbujas = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const florTubito = (petalos: AnilloTubito, centro: ParteGlobo | null = null, interior: AnilloTubito | null = null): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { petalos, interior, corona: null, centro } });

/** Un giro (de un espacio local al de su padre). */
type Giro = (p: Vec3) => Vec3;
const IDENTIDAD: Giro = (p) => p;
/** El giro de una pieza suelta o en el piso girada `g` grados sobre la vertical (el de `escena.ts`). */
const giroY = (g: number): Giro => { const c = Math.cos(rad(g)), s = Math.sin(rad(g)); return (p) => v(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); };
/** El giro inverso (los giros son ortonormales: la traspuesta). */
function inverso(f: Giro): Giro {
  const ex = f(v(1, 0, 0)), ey = f(v(0, 1, 0)), ez = f(v(0, 0, 1));
  return (w) => v(pto(ex, w), pto(ey, w), pto(ez, w));
}

/**
 * El giro de una pieza puesta `sobre` (o en un ancla) con la normal `n` y `giroGrados`: el mismo marco de `escena.ts`
 * (su +y local mira hacia la normal; x local horizontal).
 */
function marcoNormal(n0: Vec3, giroGrados = 0): Giro {
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

/** La pieza como la arma `sobre`: una decoración, sin «de frente». */
const comoSobre = (pieza: Pieza): Pieza => (pieza.tipo === "decoracion" && pieza.deFrente ? { tipo: "decoracion", decoracion: pieza.decoracion } : pieza);

/**
 * Una pieza `sobre` un padre SIN globos donde se apoya (el tallo de tubitos, la escenografía, o lejos de sus globos):
 * `sobre` no encuentra cuerpos y deja su espalda a `HUNDIMIENTO_SOBRE_CM` antes del punto, así que el origen de la pieza
 * queda exactamente en `origen` (espacio local del padre), con su +y hacia `normal`. Ojo: `sobre` arma el marco de la
 * pieza en el MUNDO (con la normal ya girada por el padre), no en el espacio del padre.
 */
function sobreEn(id: string, nombre: string, padreId: string, pieza: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0): NodoEscena {
  const n = unitario(normal);
  const punto = mas(origen, por(n, armarPieza(comoSobre(pieza)).caja.min.y + HUNDIMIENTO_SOBRE_CM));
  return { id, nombre, pieza, colocacion: { en: "sobre", padreId, puntoCm: redondo(punto), normal: redondo(n), giroGrados } };
}

/** Como `sobreEn`, con el centro de la caja de la pieza en `centro` (espacio local del padre, que gira `padre`). */
function sobreCentrada(id: string, nombre: string, padreId: string, pieza: Pieza, centro: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0, padre: Giro = IDENTIDAD): NodoEscena {
  const c = armarPieza(comoSobre(pieza)).caja;
  const medio = por(mas(c.min, c.max), 0.5);
  const enMundo = marcoNormal(padre(normal), giroGrados)(medio);
  return sobreEn(id, nombre, padreId, pieza, menos(centro, inverso(padre)(enMundo)), normal, giroGrados);
}

/** Una pieza `sobre` la superficie de globos de su padre: `sobre` la corre a lo largo de la normal hasta apoyarla. */
const sobre = (id: string, nombre: string, padreId: string, pieza: Pieza, punto: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0): NodoEscena =>
  ({ id, nombre, pieza, colocacion: { en: "sobre", padreId, puntoCm: redondo(punto), normal: redondo(unitario(normal)), giroGrados } });

/** Lo bajo de una pieza armada (para apoyarla). */
const bajoDe = (pieza: Pieza): number => armarPieza(pieza).caja.min.y;

/**
 * Una varita o tallo corto de tubito de `desde` a `hasta` (espacio local del padre): flor de tubito de dos burbujas con
 * apertura −90° (las dos en una recta hacia −y), puesta con la normal de `desde` a `hasta`. El largo se cuenta doble,
 * pero un tallo de hasta ~60 cm sale de un solo T-260, como en la realidad.
 */
function palito(id: string, nombre: string, padreId: string, t: { formatoId: string; grosorCm: number; codigo: string }, desde: Vec3, hasta: Vec3): NodoEscena {
  const d = menos(hasta, desde);
  const n = unitario(d);
  return { id, nombre, pieza: deco(florTubito(burbujas(t.formatoId, t.grosorCm, [t.codigo], 2, r2(largo(d)), -90, 0))), colocacion: { en: "sobre", padreId, puntoCm: redondo(mas(desde, por(n, HUNDIMIENTO_SOBRE_CM))), normal: redondo(n), giroGrados: 0 } };
}

/**
 * Un tallo largo de tubito (de `largoCm` a cada lado de su centro), recto a lo largo de `direccion`: flor de tubito de
 * dos burbujas opuestas y planas (cada una de su centro a una punta), así el largo se cuenta una vez. Va `sobre` un padre
 * sin globos con su centro en `centro` (espacio local del padre). Entre las dos burbujas queda un nudo de ~10 cm: va
 * escondido en el amarre.
 */
function tallo(id: string, nombre: string, padreId: string, t: { formatoId: string; grosorCm: number; codigo: string }, centro: Vec3, direccion: Vec3, largoCm: number, padre: Giro = IDENTIDAD): NodoEscena {
  // En el mundo: una normal perpendicular al tallo (hacia quien mira, si se puede) y el giro que lleva su x local a lo
  // largo de él (`sobre` arma el marco con la normal ya en el mundo).
  const d = unitario(padre(direccion));
  const n = unitario(Math.abs(d.z) < 0.9 ? menos(AL_FRENTE, por(d, d.z)) : menos(ARRIBA, por(d, d.y)));
  const m0 = marcoNormal(n, 0);
  const xL = m0(v(1, 0, 0)), zL = m0(v(0, 0, 1));
  const giro = (Math.atan2(pto(d, zL), pto(d, xL)) * 180) / Math.PI;
  return sobreEn(id, nombre, padreId, deco(florTubito(burbujas(t.formatoId, t.grosorCm, [t.codigo], 2, r2(largoCm), 0, 0))), centro, inverso(padre)(n), r2(giro));
}

/** Una cinta (escenografía: no cotiza) de `desde` a `hasta`. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado: "satinado", en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

/** Una caja de escenografía. */
const caja = (centro: Vec3, tamano: Vec3, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", giroGrados = 0): ElementoEscenografia =>
  ({ forma: "caja", centro: redondo(centro), tamano: redondo(tamano), hex, acabado, ...(giroGrados ? { giroGrados } : {}) });
const cilindro = (base: Vec3, radioCm: number, altoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate", radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base: redondo(base), radioCm: r2(radioCm), altoCm: r2(altoCm), hex, acabado, ...(radioArribaCm !== undefined ? { radioArribaCm: r2(radioArribaCm) } : {}) });
/** Una bola (farol de papel, fruta, flor) hecha de cilindros apilados. */
function bola(centro: Vec3, radioCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "papel", tramos = 6): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  for (let i = 0; i < tramos; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * i) / tramos, a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / tramos;
    salida.push(cilindro(v(centro.x, centro.y + radioCm * Math.sin(a0), centro.z), Math.max(0.3, radioCm * Math.cos(a0)), radioCm * (Math.sin(a1) - Math.sin(a0)), hex, acabado, Math.max(0.3, radioCm * Math.cos(a1))));
  }
  return salida;
}
/** Un tablón inclinado (hoja de palma, tira): una caja con su propio marco, de `desde` a `hasta`. */
function tablon(desde: Vec3, hasta: Vec3, anchoCm: number, gruesoCm: number, hex: string, acabado: ElementoEscenografia["acabado"] = "mate"): ElementoEscenografia {
  const d = menos(hasta, desde);
  const x = unitario(d);
  const y = unitario(Math.abs(x.y) < 0.95 ? cruz(AL_FRENTE, x) : cruz(x, v(1, 0, 0)));
  return { forma: "caja", centro: v(r2(largo(d) / 2), 0, 0), tamano: v(r2(largo(d)), r2(gruesoCm), r2(anchoCm)), hex, acabado, en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}
const escenografia = (elementos: ElementoEscenografia[]): Pieza => ({ tipo: "escenografia", elementos });

// ----------------------------------------------------------------------------------------------------------
// Pila de cuartetos sueltos (columnas de niveles de tamaños distintos)
// ----------------------------------------------------------------------------------------------------------

type Nivel = { id: string; nombre: string; formatoId: string; infladoCm: number; niveles?: number; colores: string[]; patron?: PatronColumna; impresos?: ImpresoEnPieza[] };
type Pila = { nodos: NodoEscena[]; ultimoCm: number; ultimoInfladoCm: number; centros: number[]; giros: number[] };

/**
 * Niveles de cuartetos apilados: el primero en el piso y cada uno con su primer cuarteto a medio paso del último del de
 * abajo, girado 1/8 de vuelta por nivel ya puesto (sigue la trenza). Devuelve los nodos, el centro del primer cuarteto
 * de cada uno, su giro y el centro del último cuarteto.
 */
function apilar(niveles: readonly Nivel[]): Pila {
  const nodos: NodoEscena[] = [];
  const centros: number[] = [], giros: number[] = [];
  let centro = 0, pasoAnterior = 0, puestos = 0;
  niveles.forEach((b, i) => {
    const paso = b.infladoCm * 0.8;
    const n = b.niveles ?? 1;
    const pieza = columna(b.formatoId, b.infladoCm, n, b.colores, b.patron ?? "un_color", b.impresos);
    if (i === 0) centro = -bajoDe(pieza);
    else centro += (pasoAnterior + paso) / 2;
    const giro = (puestos % 2) * 45;
    nodos.push({ id: b.id, nombre: b.nombre, pieza, colocacion: i === 0 ? PISO : libre(0, centro, 0, giro) });
    centros.push(r2(centro));
    giros.push(giro);
    centro += (n - 1) * paso;
    pasoAnterior = paso;
    puestos += n;
  });
  const ultimo = niveles[niveles.length - 1]!;
  return { nodos, ultimoCm: centro, ultimoInfladoCm: ultimo.infladoCm, centros, giros };
}

/** Un globo de remate (R-24) apoyado sobre el último cuarteto de una pila: suelto, pegado a él. */
function remate(id: string, nombre: string, g: ParteGlobo, pila: Pila): NodoEscena {
  return { id, nombre, pieza: globo(g), colocacion: libre(0, pila.ultimoCm + pila.ultimoInfladoCm * 0.42 + g.infladoCm * 0.45, 0) };
}

/** Hacia quien mira, en el espacio de un nivel suelto girado `g` grados. */
const frenteEn = (g: number): Vec3 => redondo(v(-Math.sin(rad(g)), 0, Math.cos(rad(g))));

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

/** Un producto que la idea publica (nombre, url y código tal cual; el formato, el de la foto). */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };

const clave = (formatoId: string, codigo: string) => `${formatoId}|${codigo}`;

/**
 * Los productos de lo armado: primero los que publica la idea (con la cantidad del 3D, que es la contada en la foto; sin
 * cantidad si la foto no los muestra), luego los impresos de la tienda que lleva el 3D y los lisos del resto. Un impreso
 * va con el formato y el código de su látex (el color del globo), así cada línea del 3D cuadra con un producto.
 */
function productosDe(contenido: IdeaDigitalizada["contenido"], publicados: readonly Publicado[] = []): ProductoDeIdea[] {
  const escena: Escena = contenido.tipo === "escena" ? contenido.escena : { sala: structuredClone(SALA_INICIAL), nodos: [{ id: "pieza", nombre: "pieza", pieza: contenido.pieza, colocacion: PISO }] };
  const armada = armarEscena(escena);
  const total = new Map<string, number>();
  for (const m of armada.materiales) total.set(clave(m.formatoId, m.codigo), (total.get(clave(m.formatoId, m.codigo)) ?? 0) + m.cantidad);
  // Los globos impresos, por impreso y por látex (cada pieza lleva a lo sumo un impreso).
  const impresos = new Map<string, Map<string, number>>();
  for (const nodo of armada.porNodo) {
    const impresoId = escena.nodos.find((n) => n.id === nodo.id)?.pieza.impresos?.[0]?.impresoId;
    if (!impresoId) continue;
    for (const g of nodo.globos.filter((x) => x.estampado?.impreso)) {
      const porLatex = impresos.get(impresoId) ?? new Map<string, number>();
      porLatex.set(clave(g.formatoId, g.codigo), (porLatex.get(clave(g.formatoId, g.codigo)) ?? 0) + 1);
      impresos.set(impresoId, porLatex);
    }
  }
  const impresosPorClave = new Map<string, number>();
  for (const porLatex of impresos.values()) for (const [k, n] of porLatex) impresosPorClave.set(k, (impresosPorClave.get(k) ?? 0) + n);
  const lisos = new Map<string, number>();
  for (const [k, n] of total) { const resto = Math.ceil(n - 1e-9) - (impresosPorClave.get(k) ?? 0); if (resto > 0) lisos.set(k, resto); }

  const salida: ProductoDeIdea[] = [];
  const usados = new Set<string>();
  for (const p of publicados) {
    if (p.codigo === null) {
      const i = impresoPorUrl(p.url);
      const porLatex = i ? impresos.get(i.id) : undefined;
      if (i && porLatex?.size) {
        for (const [k, n] of porLatex) { const [f, c] = k.split("|") as [string, string]; salida.push({ nombre: p.nombre, url: p.url, formato: f, codigo: c, cantidad: n, contada: true }); }
        impresos.delete(i.id);
      } else salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: null, cantidad: null });
      continue;
    }
    const k = p.formato ? clave(p.formato, p.codigo) : "";
    const n = lisos.get(k);
    if (n && !usados.has(k)) { salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: n, contada: true }); usados.add(k); }
    else salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: null });
  }
  for (const [impresoId, porLatex] of impresos) {
    const i = impresoPorId(impresoId)!;
    for (const [k, n] of porLatex) { const [f, c] = k.split("|") as [string, string]; salida.push({ nombre: i.nombre, url: i.url, formato: f, codigo: c, cantidad: n, contada: true }); }
  }
  for (const [k, n] of lisos) if (!usados.has(k)) { const [f, c] = k.split("|") as [string, string]; salida.push(liso(f, c, n)); }
  return salida;
}

const FOTO = (archivo: string) => `https://sempertex.com/cdn/shop/articles/${archivo}`;
const ESCENA = (escena: Escena): IdeaDigitalizada["contenido"] => ({ tipo: "escena", escena });

/**
 * Base de una idea: id «idea:<slug>» y productos del 3D (con los publicados primero). Perezosa (`ideaPerezosa`): el
 * contenido es una función que se llama la primera vez que se pide; `clase` es «escena» si no se dice otra.
 */
type Base = Omit<IdeaDigitalizada, "id" | "productos" | "contenido" | "clase"> & { contenido: () => IdeaDigitalizada["contenido"]; clase?: ClaseIdea; publicados?: Publicado[] };
function idea(b: Base): IdeaDigitalizada {
  const { publicados, contenido, clase, ...resto } = b;
  return ideaPerezosa({ id: `idea:${b.slug}`, ...resto, clase: clase ?? "escena" }, contenido, (c) => productosDe(c, publicados ?? []));
}

/** Los colores de una pieza orgánica (pesos relativos; `formatos` limita en qué globos va cada color). */
const colorOrg = (codigo: string, peso: number, formatos?: string[]): ColorOrganico => ({ codigo, peso, ...(formatos ? { formatos } : {}) });
const organico = (opciones: OpcionesOrganico, flores: Extract<Pieza, { tipo: "organico" }>["flores"] = null): Pieza => ({ tipo: "organico", opciones, flores });

// ----------------------------------------------------------------------------------------------------------
// 380 · Columna Halloween
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el tallo de tubitos mide 30 px de grueso (tubitos T-260 torcidos ≈ 11 cm): 2,7 px/cm, y con eso la
 * calabaza (113 px) es un R-18 a 41 cm, los impresos naranjas (66 px) R-12 a 25, los lisos de arriba (52 px) R-9 a
 * 19,5, el cuerpo de la araña (105 px) un R-18 y su cabeza (73 px) un R-12. Alto total 540 px ≈ 2 m. De abajo arriba:
 * 4 R-5 verdes, la calabaza, 4 R-5 verdes, el tallo de 60 cm, 4 R-5 negros, 4 R-12 naranjas impresos, 4 R-9 naranjas
 * y la araña de 8 patas. La raíz es el tallo: todo va `sobre` él, a la altura medida.
 */
const escena380 = (): Escena => {
  const Y0 = 45; // el tallo nace dentro de la calabaza y acaba dentro del cuarteto impreso (sus remates no se ven)
  const tallo380: Pieza = { tipo: "letras", letras: { texto: "I", altoCm: 83, grosorCm: 11, disposicion: "fila", tecnica: "tubito", formatoId: "T-260", infladoCm: 5, colores: ["029"], patron: "un_color" } };
  const calabaza: PropiedadesCalabaza = { globo: R("R-18", 41, "061"), cara: { hex: "#1a1a1a" }, tallo: null };
  const arana: PropiedadesArana = { cuerpo: R("R-18", 36, "080"), cabeza: R("R-12", 25, "080"), ojos: { hexIris: "#3fae4a" }, patas: { formatoId: "T-260", grosorCm: 4, codigo: "080", largoCm: 50, estilo: "articuladas" }, giroGrados: 180 };
  const enTallo = (x: number, y: number, z: number) => v(x, y - Y0, z);
  return {
    sala: sala(420, 380, 300),
    nodos: [
      { id: "tallo", nombre: "Tallo de tubitos verdes trenzados", pieza: tallo380, colocacion: libre(0, Y0, 0) },
      sobreCentrada("base", "Base de 4 R-5 verdes", "tallo", columna("R-5", 8.5, 1, ["029"]), enTallo(0, 4.7, 0)),
      sobreCentrada("calabaza", "Calabaza R-18 naranja con cara", "tallo", deco({ tipo: "calabaza", propiedades: calabaza }), enTallo(0, 30, 0), AL_FRENTE),
      sobreCentrada("cuello", "Cuello de 4 R-5 verdes", "tallo", columna("R-5", 8.5, 1, ["029"]), enTallo(0, 54.5, 0)),
      sobreCentrada("negros", "4 R-5 negros", "tallo", columna("R-5", 10, 1, ["080"]), enTallo(0, 118.5, 0), ARRIBA, 45),
      sobreCentrada("impresos", "Cuarteto R-12 naranja Happy Halloween", "tallo", columna("R-12", 25, 1, ["061"], "un_color", [{ impresoId: "infinity-happy-halloween-noche-fashion-surtido", codigo: "061" }]), enTallo(0, 134.5, 0)),
      sobreCentrada("lisos", "Cuarteto R-9 naranja", "tallo", columna("R-9", 19.5, 1, ["061"]), enTallo(0, 153.5, 0), ARRIBA, 45),
      sobreCentrada("arana", "Araña negra de 8 patas", "tallo", deco({ tipo: "arana", propiedades: arana }), enTallo(0, 197, -2), AL_FRENTE),
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 392 y 394 · Columnas Mi Primera Comunión y Mis Quince Años (el mismo armado)
// ----------------------------------------------------------------------------------------------------------

/**
 * 392. Foto 740 × 570: el R-24 mide 184 px (≈ 58 cm): 3,17 px/cm; alto total 545 px ≈ 1,72 m. De abajo arriba: un
 * cuarteto R-12 de perlas (dos con el impreso «Mi Primera Comunión», alternados: de frente se ve uno liso entre dos
 * impresos), uno lila, 4 R-5 dorados, el tallo de 8 niveles de R-5 perla (47 px de ancho ≈ 15 cm) con dos cruces lila
 * de tubito, 4 R-5 dorados, un cuarteto de impresos y el R-24 dorado.
 */
const COMUNION = "infinity-mi-primera-comunion-palomas-fashion-blanco";
const pila392 = perezoso(() => apilar([
  { id: "base", nombre: "Cuarteto R-12 perla y Mi Primera Comunión", formatoId: "R-12", infladoCm: 22, colores: ["005", "406", "005", "406"], patron: "espiral", impresos: [{ impresoId: COMUNION, codigo: "005" }] },
  { id: "lila", nombre: "Cuarteto R-12 lila", formatoId: "R-12", infladoCm: 21, colores: ["450"] },
  { id: "dorados-abajo", nombre: "4 R-5 dorados (abajo)", formatoId: "R-5", infladoCm: 12, colores: ["570"] },
  { id: "tallo", nombre: "Tallo de R-5 perla", formatoId: "R-5", infladoCm: 6.6, niveles: 8, colores: ["406"] },
  { id: "dorados-arriba", nombre: "4 R-5 dorados (arriba)", formatoId: "R-5", infladoCm: 12, colores: ["570"] },
  { id: "impresos", nombre: "Cuarteto R-12 Mi Primera Comunión", formatoId: "R-12", infladoCm: 23, colores: ["005"], impresos: [{ impresoId: COMUNION, codigo: "005" }] },
]));
const escena392 = (): Escena => {
  const cruz392 = deco(florTubito(burbujas("T-260", 2.5, ["050"], 4, 7, 0, 45)));
  const yTallo = pila392().centros[3]!, gTallo = pila392().giros[3]!;
  return {
    sala: sala(380, 340, 280),
    nodos: [
      ...pila392().nodos,
      // Las cruces, de frente, sobre el tallo (en su espacio: el del primer cuarteto del tallo), a la altura medida.
      sobre("cruz-abajo", "Cruz lila de tubito (abajo)", "tallo", cruz392, v(0, r2(57 - yTallo), 0), frenteEn(gTallo)),
      sobre("cruz-arriba", "Cruz lila de tubito (arriba)", "tallo", cruz392, v(0, r2(72.5 - yTallo), 0), frenteEn(gTallo)),
      remate("remate", "R-24 Metal Dorado (impreso de palomas y «Mi Primera Comunión»)", R("R-24", 58, "570"), pila392()),
    ],
  };
};


/**
 * 394. Foto 740 × 570: el R-24 mide 164 px (≈ 55 cm): 2,98 px/cm; alto total 545 px ≈ 1,83 m. De abajo arriba un
 * cuarteto R-12 frambuesa (de lunares blancos), uno verde (de destellos), 4 R-5 rosados, el tallo de 10 niveles de R-5
 * perla con dos cruces verdes de tubito, 4 R-5 rosados, un cuarteto verde y el R-24 fucsia del «15».
 */
const pila394 = perezoso(() => apilar([
  { id: "base", nombre: "Cuarteto R-12 frambuesa (de lunares)", formatoId: "R-12", infladoCm: 22, colores: ["014"] },
  { id: "verde-abajo", nombre: "Cuarteto R-12 verde (de destellos, abajo)", formatoId: "R-12", infladoCm: 22, colores: ["029"] },
  { id: "rosados-abajo", nombre: "4 R-5 rosados (abajo)", formatoId: "R-5", infladoCm: 10, colores: ["009"] },
  { id: "tallo", nombre: "Tallo de R-5 perla", formatoId: "R-5", infladoCm: 6.9, niveles: 10, colores: ["406"] },
  { id: "rosados-arriba", nombre: "4 R-5 rosados (arriba)", formatoId: "R-5", infladoCm: 10, colores: ["009"] },
  { id: "verde-arriba", nombre: "Cuarteto R-12 verde (de destellos, arriba)", formatoId: "R-12", infladoCm: 23, colores: ["029"] },
]));
const escena394 = (): Escena => {
  const cruz394 = deco(florTubito(burbujas("T-260", 2.5, ["029"], 4, 7, 0, 45)));
  const yTallo = pila394().centros[3]!, gTallo = pila394().giros[3]!;
  return {
    sala: sala(380, 340, 280),
    nodos: [
      ...pila394().nodos,
      sobre("cruz-abajo", "Cruz verde de tubito (abajo)", "tallo", cruz394, v(0, r2(55.4 - yTallo), 0), frenteEn(gTallo)),
      sobre("cruz-arriba", "Cruz verde de tubito (arriba)", "tallo", cruz394, v(0, r2(75.5 - yTallo), 0), frenteEn(gTallo)),
      remate("remate", "R-24 Neón Fucsia (impreso «15» y estrellas)", R("R-24", 55, "212"), pila394()),
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 399 · Columna orgánica Encanto Dorado
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: las perlas R-12 miden ~43 px (≈ 25 cm): 1,7 px/cm. El cuerpo orgánico sube 315 px (≈ 1,85 m) con
 * 140 px de ancho (≈ 80 cm), algo torcido; el R-24 dorado (100 px ≈ 58 cm) va arriba a la derecha y de lo alto salen 5
 * R-12 de cristal impresos con helio, el más alto a 1,1 m sobre la columna.
 */
const escena399 = (): Escena => {
  const tramo = formaColumna({
    id: "columna", nombre: "Columna", altoCm: 185, radioBaseCm: 31, radioMedioCm: 27, radioPuntaCm: 33, inclinacionCm: 12, serpenteoCm: 10, irregularidad: 0.24,
    mezcla: [{ t: 0, pesos: { "R-12": 3, "R-9": 1 } }, { t: 1, pesos: { "R-12": 3, "R-9": 1 } }],
  });
  const opciones: OpcionesOrganico = {
    semilla: 399, tramos: [{ ...tramo, tapas: { fin: true } }], inflados: { "R-12": 25, "R-9": 19, "R-5": 12 }, variacionInflado: 0.07, densidad: 1,
    relleno: [{ formatoId: "R-12", infladoCm: 22, trios: false }, { formatoId: "R-9", infladoCm: 16, trios: false }],
    colores: [colorOrg("405", 4), colorOrg("406", 4), colorOrg("970", 1.1, ["R-12", "R-9"]), colorOrg("390", 0.7, ["R-12"])], suelo: true, huecosFlores: 0, vista: AL_FRENTE,
  };
  // Los 5 de helio, respecto al amarre (lo alto de la columna): de la foto, (x, y) en cm.
  const helio: Vec3[] = [v(-1, 112, -4), v(-7, 82, 3), v(10, 71, -6), v(-17, 36, 4), v(7, 38, 8)];
  const R12 = R("R-12", 28, "390");
  const nudo = (c: Vec3) => menos(c, por(unitario(c), 14));
  // Las cintas van `sobre` la columna con la normal hacia arriba: en su espacio, x y z se cambian.
  const enCintas = (p: Vec3) => v(p.z, p.y, p.x);
  return {
    sala: sala(420, 380, 360),
    nodos: [
      { id: "columna", nombre: "Columna orgánica blanca, perla y dorada", pieza: organico(opciones), colocacion: PISO },
      sobre("gigante", "R-24 Reflex Dorado", "columna", globo(R("R-24", 58, "970")), v(32, 160, 0), v(0.55, 0.8, 0.25)),
      sobre("cintas", "Cintas del ramo de helio", "columna", escenografia(helio.map((c) => cinta(v(0, 0, 0), enCintas(nudo(c)), "#e9dcc0"))), v(-8, 175, 0)),
      ...helio.map((c, i) => sobreEn(`helio-${i + 1}`, `R-12 Cristal (impreso) con helio ${i + 1}`, "cintas", globo(R12), enCintas(c), enCintas(unitario(c)))),
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 400 · Columna orgánica (reloj de arena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el R-24 de arriba mide 165 px (≈ 55 cm): 3 px/cm; alto 555 px ≈ 1,85 m. Base ancha (230 px ≈ 77 cm)
 * de unos 30 cm de alto, cintura de 60 px (≈ 20 cm) de R-5 y R-9 hasta 1,25 m, y el R-24 perla con 4 corazoncitos
 * dorados. Unas ramitas de gypsophila en la cintura.
 */
const escena400 = (): Escena => {
  const opciones = opcionesTroncoConBase({
    base: { radioAnilloCm: 21, radioCm: 21, mezcla: { "R-12": 3, "R-9": 2 } },
    tronco: { desdeCm: 28, altoCm: 128, radioCm: 11, radioCopaCm: 13, mezcla: { "R-9": 1, "R-5": 3 } },
    colores: [colorOrg("406", 3), colorOrg("481", 2.2), colorOrg("409", 2), colorOrg("405", 1.5), colorOrg("570", 0.8), colorOrg("390", 0.8, ["R-12", "R-9"])],
    inflados: { "R-12": 24, "R-9": 16, "R-5": 11 },
    relleno: [{ formatoId: "R-5", infladoCm: 11, trios: true }],
    semilla: 400,
  });
  const corazon: Pieza = { tipo: "metalizado", metalizado: { forma: { tipo: "corazon" }, pulgadas: 4, color: "dorado_mate", acostado: true } };
  // Los corazones alrededor del R-24, a 50° sobre su ecuador, de frente y a los lados (espacio del R-24: x ↔ z).
  const azimuts = [-60, -20, 20, 60];
  return {
    sala: sala(380, 340, 280),
    nodos: [
      { id: "columna", nombre: "Columna orgánica perla, plata y rosada", pieza: organico({ ...opciones, huecosFlores: 3 }, { semilla: 400, proporcion: [{ tipo: "gypsophila", colorId: "blanca", peso: 1 }], tallosPorRacimo: 2 }), colocacion: PISO },
      sobre("remate", "R-24 Satín Perla", "columna", globo(R("R-24", 55, "406")), v(0, 130, 0)),
      ...azimuts.map((az, i) => {
        const el = rad(50);
        const mundo = v(Math.sin(rad(az)) * Math.cos(el), Math.sin(el), Math.cos(rad(az)) * Math.cos(el));
        const local = v(mundo.z, mundo.y, mundo.x);
        return sobre(`corazon-${i + 1}`, `Corazoncito dorado ${i + 1}`, "remate", corazon, por(local, 20), local);
      }),
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 404 · Columna romana Bigotes
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el R-24 mide 211 px (≈ 55 cm): 3,84 px/cm; alto 852 px ≈ 2,2 m. Por el perfil de ancho, de abajo
 * arriba: cuarteto R-12 azul naval (a 25 cm), cuarteto de Bigotes y Corbatines (a 23), cuarteto Silk Verde Menta (a 20),
 * cintura de 3 niveles de R-5 en espiral (menta, dorado, naval y naval, a 10), cuarteto R-9 naval (a 16), otra cintura
 * igual, menta, impresos, naval y el R-24 Silk Azul Ártico del «PAPÁ».
 */
const BIGOTES = "infinity-bigotes-y-corbatines-fashion-transparente";
const pila404 = perezoso(() => apilar([
  { id: "naval-abajo", nombre: "Cuarteto R-12 azul naval (abajo)", formatoId: "R-12", infladoCm: 25, colores: ["044"] },
  { id: "bigotes-abajo", nombre: "Cuarteto Bigotes y Corbatines (abajo)", formatoId: "R-12", infladoCm: 23, colores: ["390"], impresos: [{ impresoId: BIGOTES, codigo: "390" }] },
  { id: "menta-abajo", nombre: "Cuarteto R-12 verde menta (abajo)", formatoId: "R-12", infladoCm: 20, colores: ["826"] },
  { id: "cintura-abajo", nombre: "Cintura de R-5 en espiral (abajo)", formatoId: "R-5", infladoCm: 10, niveles: 3, colores: ["826", "870", "044", "044"], patron: "espiral" },
  { id: "anillo-naval", nombre: "Cuarteto R-9 azul naval (centro)", formatoId: "R-9", infladoCm: 16, colores: ["044"] },
  { id: "cintura-arriba", nombre: "Cintura de R-5 en espiral (arriba)", formatoId: "R-5", infladoCm: 10, niveles: 3, colores: ["826", "870", "044", "044"], patron: "espiral" },
  { id: "menta-arriba", nombre: "Cuarteto R-12 verde menta (arriba)", formatoId: "R-12", infladoCm: 20, colores: ["826"] },
  { id: "bigotes-arriba", nombre: "Cuarteto Bigotes y Corbatines (arriba)", formatoId: "R-12", infladoCm: 23, colores: ["390"], impresos: [{ impresoId: BIGOTES, codigo: "390" }] },
  { id: "naval-arriba", nombre: "Cuarteto R-12 azul naval (arriba)", formatoId: "R-12", infladoCm: 25, colores: ["044"] },
]));
const escena404 = (): Escena => ({
  sala: sala(400, 360, 300),
  nodos: [...pila404().nodos, remate("remate", "R-24 Silk Azul Ártico (impreso «PAPÁ»)", R("R-24", 55, "839"), pila404())],
});

// ----------------------------------------------------------------------------------------------------------
// 409 · Columna tejida
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el R-24 mide 156 px (≈ 55 cm): 2,84 px/cm; alto 545 px ≈ 1,92 m. De abajo arriba: cuarteto R-12
 * blanco, cuarteto fucsia de lunares, cuarteto blanco, el tallo trenzado fucsia y rosado (46 cm a la vista) con un
 * racimo de R-5 al medio, cuarteto fucsia de lunares, cuarteto blanco y el R-24 fucsia de lunares grandes. La raíz es
 * el tallo (dos tubitos fucsia y dos rosados trenzados): lo demás va `sobre` él a la altura medida.
 */
const escena409 = (): Escena => {
  const Y0 = 46;
  const letras = (codigo: string): Pieza => ({ tipo: "letras", letras: { texto: "I", altoCm: 64, grosorCm: 9, disposicion: "fila", tecnica: "tubito", formatoId: "T-260", infladoCm: 5, colores: [codigo], patron: "un_color" } });
  const en = (y: number) => v(0, y - Y0, 0);
  const cuarteto = (codigo: string, d: number) => columna("R-12", d, 1, [codigo]);
  return {
    sala: sala(380, 340, 300),
    nodos: [
      { id: "tallo", nombre: "Tallo de tubitos fucsia trenzados", pieza: letras("012"), colocacion: libre(0, Y0, 0) },
      // El segundo par (rosado), cruzado: `sobre` con la normal hacia arriba pone su plano de canto respecto al primero.
      sobreEn("tallo-rosado", "Tubitos rosados trenzados del tallo", "tallo", letras("009"), v(0, 0, 0)),
      sobreCentrada("blanco-abajo", "Cuarteto R-12 blanco (abajo)", "tallo", cuarteto("405", 25), en(13.8)),
      sobreCentrada("fucsia-abajo", "Cuarteto R-12 fucsia de lunares (abajo)", "tallo", cuarteto("012", 24), en(31.6), ARRIBA, 45),
      sobreCentrada("blanco-medio", "Cuarteto R-12 blanco (medio)", "tallo", cuarteto("405", 24), en(49.5)),
      sobreCentrada("racimo-arriba", "Anillo de R-5 rosados (racimo, arriba)", "tallo", deco(anillo(R("R-5", 7, "409"), 5, 35)), en(85)),
      sobreCentrada("racimo-medio", "Anillo de R-5 fucsia (racimo)", "tallo", deco(anillo(R("R-5", 7.5, "212"), 6, 0, 30)), en(79)),
      sobreCentrada("racimo-abajo", "Anillo de R-5 rosados (racimo, abajo)", "tallo", deco(anillo(R("R-5", 7, "409"), 5, 35, 36)), en(73), ABAJO),
      sobreCentrada("fucsia-arriba", "Cuarteto R-12 fucsia de lunares (arriba)", "tallo", cuarteto("012", 24), en(111)),
      sobreCentrada("blanco-arriba", "Cuarteto R-12 blanco (arriba)", "tallo", cuarteto("405", 24), en(129.5), ARRIBA, 45),
      sobreCentrada("remate", "R-24 Fashion Fucsia (de lunares grandes)", "tallo", globo(R("R-24", 55, "012")), en(164)),
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 436 · Corazones neón (arco)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: arco en herradura (las puntas se curvan hacia dentro abajo), 655 × 490 px. Cada globo mide ~45 px y
 * el paso entre niveles 36 px (0,8 diámetros): con R-9 a 18 cm, 2,5 px/cm (≈ 2,6 × 1,95 m). Bandas de 4 niveles de
 * cada lado: fucsia, naranja, verde y verde lima, y 4 niveles azules arriba: 36 cuartetos.
 */
const arco436 = (): Pieza => {
  // Media elipse de 300° (de 240° a −60°), escalada para que salgan 36 niveles con el paso de la trenza.
  const elipse = (k: number) => {
    const puntos: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 120; i++) {
      const t = rad(240 - (300 * i) / 120);
      puntos.push({ x: r2(108 * k * Math.cos(t)), y: r2(84 * k * (1 + Math.sin(t))) });
    }
    return puntos;
  };
  const largoDe = (ps: Array<{ x: number; y: number }>) => ps.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - ps[i]!.x, p.y - ps[i]!.y), 0);
  const k = (35 * 18 * 0.8) / largoDe(elipse(1));
  const bandas = ["212", "212", "261", "261", "030", "030", "230", "230", "240", "240", "230", "230", "030", "030", "261", "261", "212", "212"];
  return { tipo: "guirnalda", guirnalda: { formatoId: "R-9", infladoCm: 18, patron: "salvavidas", colores: bandas, anchoCm: 0, caidaCm: 0, recorrido: elipse(k) } };
};


// ----------------------------------------------------------------------------------------------------------
// 441 · Corona navideña
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: los R-5 dorados miden ~55 px (≈ 12 cm): 4,6 px/cm. Corona de 645 px (≈ 1,4 m) de R-12 Verde
 * Trébol por fuera y R-9 y R-5 verdes y dorados por dentro, con 3 rizos de tubito dorado y un moño Merlot de 505 px
 * (≈ 1,1 m) con dos colas de ~60 cm.
 */
const escena441 = (): Escena => {
  const opciones = opcionesAroOrganico({
    diametroCm: 140, exterior: { formatoId: "R-12", radioCm: 13 }, interior: { pesos: { "R-9": 2, "R-5": 1.6 }, radioCm: 10, adelanteCm: 7 },
    colores: [colorOrg("029", 5), colorOrg("970", 1.1, ["R-5"])], semilla: 441,
  });
  const corona441: OpcionesOrganico = { ...opciones, relleno: [], densidad: 0.85 };
  const mono: PropiedadesMono = { formatoId: "T-260", grosorCm: 5, codigo: "018", lazosPorLado: 1, largoLazoCm: 42, anchoLazoCm: 30, aberturaGrados: 0, colas: true, largoColaCm: 58, centro: null };
  const rizo = deco(florTubito(burbujas("T-260", 2.5, ["970"], 3, 5, 10, 0)));
  return {
    sala: sala(380, 320, 290),
    nodos: [
      { id: "corona", nombre: "Corona orgánica Verde Trébol", pieza: organico(corona441), colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 70 } },
      sobre("mono", "Moño de tubito Merlot", "corona", deco({ tipo: "mono", propiedades: mono }), v(0, 4, 0), AL_FRENTE),
      sobre("rizo-1", "Rizo de tubito dorado (izquierda, arriba)", "corona", rizo, v(-52, 79, 0), AL_FRENTE),
      sobre("rizo-2", "Rizo de tubito dorado (izquierda, abajo)", "corona", rizo, v(-57, 70, 0), AL_FRENTE, 40),
      sobre("rizo-3", "Rizo de tubito dorado (derecha)", "corona", rizo, v(49, 86, 0), AL_FRENTE, 20),
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 443 · Corporativo (escena: supermercado)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 de un supermercado: 6 colgantes de techo de 6 cuartetos R-12 (2 azules, 2 blancos con el logo, 2
 * rojos, de arriba abajo; el del centro mide 230 px ≈ 1,25 m) a varias distancias, y 2 racimos de ~12 R-12 (azul y rojo,
 * con algún blanco) sobre el exhibidor de naranjas. Góndolas, la franja roja de la pared con el cartel de frutas y el
 * exhibidor son escenografía.
 */
const escena443 = (): Escena => {
  const colgante = columna("R-12", 25, 6, ["015", "005", "040"], "salvavidas");
  const colgantes: Array<{ id: string; x: number; z: number }> = [
    { id: "colgante-centro", x: -40, z: 120 }, { id: "colgante-izquierda", x: -260, z: -40 }, { id: "colgante-izquierda-fondo", x: -400, z: -200 },
    { id: "colgante-derecha", x: 300, z: -120 }, { id: "colgante-fondo-1", x: 130, z: -330 }, { id: "colgante-fondo-2", x: 220, z: -320 },
  ];
  const racimo = (codigos: string[], pesos: number[]): Pieza => ({ tipo: "forma", forma: { clase: "esfera", diametroCm: 62, globo: { formatoId: "R-12", infladoCm: 25 }, colores: { codigos, patron: "mezcla", pesos, semilla: 443 } } });
  const ROJO_PARED = "#d8262e", GRIS = "#a9b0b8", NEGRO = "#2a2a2c";
  const gondola = (x: number, z: number, ancho: number, giro = 0): ElementoEscenografia[] => [
    caja(v(x, 80, z), v(ancho, 160, 60), GRIS, "metal", giro),
    ...[30, 65, 100, 135].map((y, k) => caja(v(x, y, z + (giro ? 0 : 31)), v(ancho - 6, 16, 2), ["#3d7fd6", "#e5b23b", "#d94f4f", "#5fb35f"][k % 4]!, "papel", giro)),
  ];
  const escenario: ElementoEscenografia[] = [
    // La franja roja de la pared del fondo, con el cartel de frutas.
    caja(v(0, 255, -448), v(1000, 90, 2), ROJO_PARED, "mate"),
    caja(v(150, 255, -446), v(260, 85, 2), "#9fd27a", "papel"),
    ...gondola(-300, -180, 280), ...gondola(60, -260, 320), ...gondola(-430, 60, 200, 90),
    // El exhibidor de naranjas (mesa inclinada sobre ruedas) y la nevera negra de la derecha.
    caja(v(60, 45, 120), v(150, 90, 90), "#e8e8e8", "metal"),
    caja(v(60, 95, 120), v(160, 10, 100), NEGRO, "mate"),
    ...[-45, 0, 45].flatMap((dx) => [-25, 15].map((dz) => caja(v(60 + dx, 103, 120 + dz), v(38, 6, 34), "#f07a1a", "mate"))),
    caja(v(230, 50, 140), v(120, 100, 70), NEGRO, "mate"),
    // Las sillas negras de la izquierda (bloques) y las cajas rojas apiladas de la derecha.
    caja(v(-200, 45, 200), v(50, 90, 50), NEGRO, "mate"), caja(v(380, 60, 40), v(70, 120, 60), "#c8202a", "mate"),
  ];
  return {
    sala: sala(1000, 900, 360, { piso: "#e9e6e1", paredes: "#f2f2f2", techo: "#f7f7f7" }),
    nodos: [
      ...colgantes.map((c, i) => ({ id: c.id, nombre: `Colgante de cuartetos azul, blanco y rojo ${i + 1}`, pieza: colgante, colocacion: { en: "techo" as const, xCm: c.x, zCm: c.z, cuelgaCm: 85, giroGrados: 0, volteada: false } })),
      { id: "racimo-azul", nombre: "Racimo azul del exhibidor", pieza: racimo(["041", "005"], [5, 1]), colocacion: libre(25, 134, 120) },
      { id: "racimo-rojo", nombre: "Racimo rojo del exhibidor", pieza: racimo(["015", "005"], [5, 1]), colocacion: libre(95, 134, 120) },
      { id: "supermercado", nombre: "Góndolas, exhibidor y pared del supermercado", pieza: escenografia(escenario), colocacion: libre(0, 0, 0) },
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 460 · Cumpleaño hawaiano (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: malla de eslabones turquesa (16 columnas y 8 filas a la vista, 530 × 265 px) detrás de la mesa con
 * mantel de yute, con 10 flores de R-5 de dos pisos (5 pétalos, 5 más chicos encima y un centro) en las dos esquinas
 * de arriba; palmeras en materas negras a los lados, pastel y regalos.
 */
const FLORES_460: ReadonlyArray<{ px: number; py: number; petalos: string; corona: string; centro: string }> = [
  { px: 130, py: 115, petalos: "061", corona: "029", centro: "015" }, { px: 155, py: 148, petalos: "020", corona: "212", centro: "050" },
  { px: 200, py: 128, petalos: "031", corona: "450", centro: "061" }, { px: 200, py: 172, petalos: "212", corona: "061", centro: "029" },
  { px: 160, py: 192, petalos: "020", corona: "050", centro: "029" }, { px: 560, py: 98, petalos: "212", corona: "038", centro: "031" },
  { px: 618, py: 108, petalos: "212", corona: "061", centro: "021" }, { px: 590, py: 135, petalos: "050", corona: "020", centro: "029" },
  { px: 555, py: 158, petalos: "031", corona: "050", centro: "020" }, { px: 588, py: 188, petalos: "061", corona: "038", centro: "020" },
];
const escena460 = (): Escena => {
  const malla: Pieza = { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 20, anchoCm: 300, altoCm: 175, patron: "un_color", colores: ["040"], union: { infladoCm: 10, codigo: "040" } };
  const ALTO_MALLA = 50; // la malla arranca detrás de la mesa
  const flor460 = (f: (typeof FLORES_460)[number]) => deco(flor({ petalos: { ...R("R-5", 12.5, f.petalos), cantidad: 5, aperturaGrados: 0, giroGrados: 18 }, corona: { ...R("R-5", 9, f.corona), cantidad: 5 }, centro: { ...R("R-5", 6, f.centro), cantidad: 1 } }));
  // De la foto a la malla (en su espacio, por su caja): 530 px (x de 105 a 635) son su ancho y la fila de arriba (y = 85
  // px) es su borde de arriba; 265 px de alto a la vista son 160 cm.
  const c = armarPieza(malla).caja;
  const enMalla = (px: number, py: number) => v(r2(c.min.x + ((px - 105) / 530) * (c.max.x - c.min.x)), r2(c.max.y - 8 - ((py - 85) / 265) * 160), 0);
  const YUTE = "#b98f5e";
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 200, fondoCm: 75, altoCm: 76, mantel: "#f4f4f2" }),
    caja(v(0, 77, 0), v(230, 1, 100), YUTE, "tela"),
    caja(v(0, 60, 50), v(230, 34, 1), YUTE, "tela"), caja(v(-115, 60, 0), v(1, 34, 100), YUTE, "tela"), caja(v(115, 60, 0), v(1, 34, 100), YUTE, "tela"),
    // El pastel de tres pisos sobre su base de yute, y los regalos de colores a los dos lados.
    caja(v(0, 90, -10), v(50, 26, 40), YUTE, "tela"),
    cilindro(v(0, 103, -10), 14, 9, "#9be06a", "mate"), cilindro(v(0, 112, -10), 11, 9, "#b48ad6", "mate"), cilindro(v(0, 121, -10), 8, 9, "#f49ac4", "mate"),
    ...[-90, -72, -55, -38, 38, 55, 72, 90].flatMap((x, k) => [
      caja(v(x, 87 + (k % 3) * 2, 5 + (k % 2) * 8), v(14, 20 + (k % 3) * 6, 8), ["#f5d23c", "#f06ab0", "#f28c2a", "#8fd24a", "#b07ad6", "#2fa3e0"][k % 6]!, "papel", (k * 23) % 40 - 20),
      caja(v(x + 6, 82, 22), v(12, 8, 14), ["#f06ab0", "#f5d23c", "#8fd24a", "#f28c2a"][k % 4]!, "papel", (k * 31) % 50 - 25),
    ]),
  ];
  const palmera = (x: number): ElementoEscenografia[] => [
    cilindro(v(x, 0, -60), 22, 45, "#26272a", "mate", 26),
    cilindro(v(x, 45, -60), 3, 60, "#6b5a3a", "madera"),
    ...[0, 50, 100, 150, 200, 250, 300].map((a, k) => tablon(v(x, 100 + (k % 3) * 12, -60), v(x + Math.cos(rad(a)) * 55, 150 + (k % 2) * 30, -60 + Math.sin(rad(a)) * 40), 12, 1, "#3f8f3a")),
  ];
  return {
    sala: sala(560, 420, 300, { piso: "#c4734c", paredes: "#d9ccb4", techo: "#efe9df" }),
    nodos: [
      { id: "malla", nombre: "Malla de eslabones turquesa", pieza: malla, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: ALTO_MALLA } },
      ...FLORES_460.map((f, i) => sobre(`flor-${i + 1}`, `Flor de R-5 ${i < 5 ? "de la izquierda" : "de la derecha"} ${i < 5 ? i + 1 : i - 4}`, "malla", flor460(f), enMalla(f.px, f.py), AL_FRENTE)),
      { id: "mesa", nombre: "Mesa con mantel de yute, pastel y regalos", pieza: escenografia(mesa), colocacion: enPiso(0, -95) },
      { id: "palmeras", nombre: "Palmeras en materas negras", pieza: escenografia([...palmera(-215), ...palmera(215)]), colocacion: libre(0, 0, 0) },
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 465 · Cumpleaños violeta y plata (escena: mesa de postres)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 de una mesa de postres: los globos son una fila de R-12 champaña colgados bajo el borde de la mesa (7 a
 * la vista; la foto corta la mesa a la izquierda: se completan 11 a lo largo de los 3 m), con cintas lila entre ellos.
 * Estanterías caladas, marco de espejo, torre de macarons, frascos de dulces, cake pops y serpentinas lila y plata.
 */
const escena465 = (): Escena => {
  // Una hilera: el contorno es más bajo que un globo, así las celdas dejan una sola fila (11 R-12 a 30 cm).
  const fila: Pieza = { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "libre", puntos: [{ x: -120, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 12 }, { x: -120, y: 12 }] }, tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 30, celda: "cuadrada" }, colores: { codigos: ["971"], patron: "un_color" } } };
  const c = armarPieza(fila).caja;
  const ORO = "#c9b48c", LILA = "#9b7cc4", PLATA = "#cfd0d8", MADERA = "#cbbda6";
  const ALTO = 86;
  const mesa: ElementoEscenografia[] = [
    caja(v(0, ALTO - 3, 0), v(310, 6, 90), ORO, "satinado"),
    caja(v(0, ALTO - 12, 44), v(300, 12, 2), ORO, "satinado"),
    ...[-145, 145].flatMap((x) => [-38, 38].map((z) => cilindro(v(x, 0, z), 4, ALTO - 6, ORO, "satinado", 6))),
    // Torre de macarons, cake pops, frascos y bandejas.
    cilindro(v(-40, ALTO, -15), 16, 50, "#8e7aa8", "mate", 3),
    caja(v(-85, ALTO + 10, 10), v(50, 20, 30), PLATA, "lentejuelas"), ...[-100, -90, -80, -70].map((x) => cilindro(v(x, ALTO + 20, 10), 0.4, 25, "#f4f4f4")),
    ...[-100, -90, -80, -70].map((x) => cilindro(v(x, ALTO + 44, 10), 3, 4, "#7a2f86", "brillante")),
    cilindro(v(-130, ALTO, 15), 14, 32, "#c8b9e2", "brillante"), cilindro(v(110, ALTO, -10), 10, 28, "#c8b9e2", "brillante"),
    ...[-20, 25, 70].map((x) => cilindro(v(x, ALTO, 20), 18, 3, PLATA, "metal")),
    ...[-30, -20, -10, 20, 30, 40, 60, 70, 80].map((x, k) => cilindro(v(x, ALTO + 3, 15 + (k % 3) * 6), 2.5, 5, "#d8a24a", "mate")),
  ];
  const fondo: ElementoEscenografia[] = [
    // Estanterías caladas a los lados y el marco de espejo del centro.
    ...[-170, 170].flatMap((x) => [caja(v(x, 110, -40), v(70, 220, 30), MADERA, "madera"), ...[60, 110, 160].map((y) => caja(v(x, y, -25), v(64, 3, 30), "#b8aa92", "madera"))]),
    { forma: "panel", contorno: Array.from({ length: 24 }, (_, i) => ({ x: r2(32 * Math.cos((2 * Math.PI * i) / 24)), y: r2(150 + 52 * Math.sin((2 * Math.PI * i) / 24)) })), huecos: [Array.from({ length: 24 }, (_, i) => ({ x: r2(24 * Math.cos((-2 * Math.PI * i) / 24)), y: r2(150 + 44 * Math.sin((-2 * Math.PI * i) / 24)) }))], zCm: -60, grosorCm: 3, hex: "#b5a68d", acabado: "madera" },
    // Serpentinas lila y plata que cuelgan del techo.
    ...[-230, -180, -120, -60, 10, 70, 130, 190, 240].map((x, k) => cilindro(v(x, 180 + (k % 3) * 15, -80 + (k % 4) * 30), 0.6, 120 - (k % 3) * 15, k % 2 ? PLATA : LILA, "satinado")),
    ...bola(v(-150, 230, -30), 16, "#f6f4ee", "papel"),
  ];
  return {
    sala: sala(620, 460, 300, { piso: "#d8cfc4", paredes: "#ece6f2" }),
    nodos: [
      // La fila de globos cuelga bajo el borde de delante (su fila, de frente, con lo alto a 2 cm bajo la tapa).
      { id: "globos-faldon", nombre: "Fila de R-12 champaña bajo el borde de la mesa", pieza: fila, colocacion: libre(-(c.min.x + c.max.x) / 2, ALTO - 8 - c.max.y, 47 - c.min.z) },
      { id: "mesa", nombre: "Mesa de postres dorada", pieza: escenografia(mesa), colocacion: libre(0, 0, 0) },
      { id: "fondo", nombre: "Estanterías, marco de espejo y serpentinas", pieza: escenografia(fondo), colocacion: libre(0, 0, -100) },
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 467 · Cupcakes 2 (escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el fondo rosado mide 540 px y la mesa 615 px (≈ 2,4 m): 2,56 px/cm; fondo de 2,1 × 2,3 m. Encima,
 * una guirnalda de R-9 (los globos miden ~34 px ≈ 15 cm) en bloques de color —verde y rosado a la izquierda, rosado,
 * violeta, amarillo, verde y azul arriba, rosado y fucsia a la derecha—, faroles de papel, el banderín de 14 triángulos
 * pastel, 3 cuadros de cupcakes, la mesa blanca con el pastel y los frascos.
 */
const escena467 = (): Escena => {
  const recorrido = [
    { x: -128, y: 160 }, { x: -130, y: 195 }, { x: -128, y: 222 }, { x: -110, y: 240 }, { x: -60, y: 244 }, { x: 0, y: 245 },
    { x: 60, y: 244 }, { x: 110, y: 240 }, { x: 128, y: 222 }, { x: 131, y: 198 }, { x: 130, y: 175 },
  ];
  const bloques = ["032", "032", "409", "409", "409", "051", "051", "020", "020", "029", "029", "140", "140", "409", "412"];
  const guirnalda: Pieza = { tipo: "guirnalda", guirnalda: { formatoId: "R-9", infladoCm: 18, patron: "salvavidas", colores: bloques, anchoCm: 0, caidaCm: 0, recorrido } };
  const ROSA = "#f2a9c4";
  const banderin467 = banderin({
    recorrido: { tipo: "recto", desde: v(-118, 0, 0), hasta: v(118, 0, 0) }, caidaCm: 5, cantidad: 14, forma: "triangulo", anchoCm: 15, altoCm: 20,
    colores: ["#c8a6dc", "#f6b2cc", "#f4d36c", "#9fd47c", "#f6b2cc", "#c8a6dc", "#f4d36c", "#6fc4e8", "#f08fb8", "#c8a6dc", "#f6b2cc", "#f4d36c", "#c8a6dc", "#f4d36c"],
    motivos: [null, null, { dibujo: "lunares", hex: "#ffffff" }, null, null, null, { dibujo: "lunares", hex: "#ffffff" }, null, { dibujo: "lunares", hex: "#ffffff" }, null, null, null, null, null],
    cordon: "#f7f2ee", productoId: null, descripcion: "banderín de papel de triángulos pastel",
  });
  const fondo: ElementoEscenografia[] = [
    caja(v(0, 117, -2), v(210, 234, 4), ROSA, "mate"),
    // Los 3 cuadros de cupcakes (marco y lámina).
    ...[[-75, "#3dbbe0"], [0, "#f06aa4"], [75, "#8fd24a"]].flatMap(([x, marco]) => [caja(v(Number(x), 155, 1), v(36, 36, 2), String(marco), "papel"), caja(v(Number(x), 155, 2.2), v(28, 28, 1), "#f7e7c9", "papel")]),
  ];
  const mesa: ElementoEscenografia[] = [
    ...mesaConMantel({ anchoCm: 230, fondoCm: 70, altoCm: 75, mantel: "#f7f7f5" }),
    // El pastel en su base verde, la torre de cajas con el farolito, la regadera azul y los frascos.
    cilindro(v(0, 75, 0), 3, 20, "#4caf50", "satinado"), cilindro(v(0, 95, 0), 20, 3, "#3dbbe0", "satinado"),
    cilindro(v(0, 98, 0), 17, 12, "#f6b2cc", "mate"), cilindro(v(0, 110, 0), 14, 12, "#9ad7d0", "mate"), cilindro(v(0, 122, 0), 11, 10, "#fbf3f0", "mate"),
    caja(v(-55, 82, -5), v(22, 14, 22), "#6fc4b0", "papel"), caja(v(-55, 96, -5), v(18, 14, 18), "#f4c6d6", "papel"), caja(v(-55, 115, -5), v(10, 24, 10), "#ffffff", "metal"),
    cilindro(v(60, 75, -5), 9, 16, "#2fa3c8", "brillante"), ...bola(v(60, 100, -5), 9, "#e7e3b0", "mate"),
    ...[-100, -88, -76, 76, 88, 100].flatMap((x, k) => [cilindro(v(x, 75, 12), 6, 12, ["#f6b2cc", "#9ad7d0", "#c8a6dc"][k % 3]!, "brillante"), cilindro(v(x, 87, 12), 6.5, 2, "#8fd24a", "papel")]),
  ];
  const faroles: ElementoEscenografia[] = [
    ...bola(v(-175, 215, -20), 26, "#f2ea48"), ...bola(v(-210, 250, 10), 22, "#9ccf3c"), ...bola(v(-185, 160, 0), 22, "#f6c3cf"),
    ...bola(v(178, 165, 0), 24, "#f070a0"), ...bola(v(165, 245, 5), 23, "#f4f1ea"),
  ];
  return {
    sala: sala(560, 420, 300, { piso: "#d9cbbd", paredes: "#efe9e4" }),
    nodos: [
      { id: "guirnalda", nombre: "Guirnalda de R-9 en bloques de color", pieza: guirnalda, colocacion: libre(0, 0, -150) },
      { id: "banderin", nombre: "Banderín de triángulos pastel", pieza: banderin467, colocacion: libre(0, 205, -146) },
      { id: "fondo", nombre: "Fondo rosado con cuadros de cupcakes", pieza: escenografia(fondo), colocacion: libre(0, 0, -152) },
      { id: "mesa", nombre: "Mesa blanca con pastel y frascos", pieza: escenografia(mesa), colocacion: enPiso(0, -60) },
      { id: "faroles", nombre: "Faroles de papel", pieza: escenografia(faroles), colocacion: libre(0, 0, -140) },
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 489 · Decoración pastel melón (aro de mesa)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el R-12 dorado impreso mide 250 px (≈ 30 cm): 8,3 px/cm. Aro forrado de 78 cm (650 px), racimos de
 * R-5 Pastel Mate Melón (70–90 px ≈ 9–11 cm) arriba a la izquierda, arriba a la derecha y abajo de lado a lado, 4 flores
 * blancas de papel (≈ 16 cm, van como hortensias blancas) en el racimo de abajo y hojas verdes.
 */
const escena489 = (): Escena => {
  const RADIO = 37, CENTRO_Y = 42;
  const arco = (desde: number, hasta: number, pasos = 8) => Array.from({ length: pasos + 1 }, (_, i) => {
    const a = rad(desde + ((hasta - desde) * i) / pasos);
    return v(r2(RADIO * Math.cos(a)), r2(CENTRO_Y + RADIO * Math.sin(a)), 0);
  });
  const mezcla = [{ t: 0, pesos: { "R-9": 1, "R-5": 3 } }, { t: 1, pesos: { "R-9": 1, "R-5": 3 } }];
  const racimos: RacimoLibre[] = [
    { id: "arriba_izquierda", nombre: "Racimo de arriba a la izquierda", puntos: arco(134, 166, 4), radioInicioCm: 9, radioFinCm: 10, mezcla, tapas: { inicio: true, fin: true } },
    { id: "arriba_derecha", nombre: "Racimo de arriba a la derecha", puntos: arco(40, 74, 4), radioInicioCm: 10.5, radioFinCm: 9.5, mezcla, tapas: { inicio: true, fin: true } },
    { id: "abajo", nombre: "Racimo de abajo", puntos: arco(208, 332, 10).map((p) => v(p.x, Math.max(10, p.y), p.z + 3)), radioInicioCm: 10, radioFinCm: 11, mezcla, tapas: { inicio: true, fin: true } },
  ];
  const relleno: RellenoOrganico[] = [{ formatoId: "R-5", infladoCm: 8, trios: true }];
  const opciones = { ...opcionesRacimosLibres({ racimos, colores: [colorOrg("663", 1)], semilla: 489, suelo: true, relleno }), inflados: { "R-9": 13, "R-5": 10 }, huecosFlores: 4 };
  const aro: ElementoEscenografia = {
    forma: "panel", zCm: -1.5, grosorCm: 3, hex: "#efe6dc", acabado: "tela",
    contorno: Array.from({ length: 48 }, (_, i) => ({ x: r2(39 * Math.cos((2 * Math.PI * i) / 48)), y: r2(CENTRO_Y + 39 * Math.sin((2 * Math.PI * i) / 48)) })),
    huecos: [Array.from({ length: 48 }, (_, i) => ({ x: r2(35.5 * Math.cos((-2 * Math.PI * i) / 48)), y: r2(CENTRO_Y + 35.5 * Math.sin((-2 * Math.PI * i) / 48)) }))],
  };
  const MESA = 75;
  return {
    sala: sala(360, 320, 260),
    nodos: [
      { id: "racimos", nombre: "Racimos de R-5 Pastel Mate Melón", pieza: organico(opciones, { semilla: 489, proporcion: [{ tipo: "hortensia", colorId: "blanca", peso: 1 }], tallosPorRacimo: 1 }), colocacion: libre(0, MESA, 0) },
      // Suelto y pegado al racimo de abajo: `sobre` los racimos, el rayo vertical tocaría también el de arriba.
      { id: "impreso", nombre: "R-12 Reflex Dorado Feliz Cumpleaños Destellos", pieza: globo(R("R-12", 30, "970"), "2-caras-feliz-cumpleanos-fiesta-destellos-reflex-surtido"), colocacion: libre(21, MESA + 46, 3) },
      { id: "aro", nombre: "Aro forrado blanco", pieza: escenografia([aro]), colocacion: libre(0, MESA, 0) },
      { id: "mesa", nombre: "Mesa", pieza: escenografia(mesaConMantel({ anchoCm: 120, fondoCm: 60, altoCm: MESA, mantel: "#f7f5f2" })), colocacion: PISO },
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 495 · Desayuno sorpresa
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el R-12 rosado mide 275 px (≈ 28 cm): 9,8 px/cm; el huacal, 487 px (≈ 50 cm). La «M» de mamá es una
 * trenza de R-5 Silk Dorado diminutos (~50 px ≈ 5,5 cm, dos de ancho: 120 px ≈ 12 cm) que sube por la izquierda, hace
 * dos jorobas y baja por la derecha, con 3 flores de 5 R-5 Silk Azul Ártico y centro dorado, y el R-12 rosado de
 * Corazones Brillantes con helio arriba a la derecha.
 */
const escena495 = (): Escena => {
  const BASE = 75 + 1.5; // la mesa y el fondo del huacal
  const m = [
    { x: -18.3, y: 25 }, { x: -18.3, y: 45 }, { x: -16, y: 53 }, { x: -11, y: 56 }, { x: -5, y: 55 }, { x: -1, y: 50 }, { x: 2, y: 45.5 },
    { x: 6, y: 50 }, { x: 11, y: 55 }, { x: 17, y: 57.5 }, { x: 22, y: 55 }, { x: 24, y: 48 }, { x: 24, y: 26 },
  ];
  const guirnalda: Pieza = { tipo: "guirnalda", guirnalda: { formatoId: "R-5", infladoCm: 5.5, patron: "un_color", colores: ["870"], anchoCm: 0, caidaCm: 0, recorrido: m } };
  const flor495 = deco(flor({ petalos: { ...R("R-5", 6, "839"), cantidad: 5, aperturaGrados: 0, giroGrados: 18 }, centro: { ...R("R-5", 5.1, "870"), cantidad: 1 } }));
  const MADERA = "#d8b886";
  const huacal: ElementoEscenografia[] = [
    caja(v(0, 0.75, 0), v(50, 1.5, 30), MADERA, "madera"),
    ...[-14.25, 14.25].flatMap((z) => [5, 12, 18.5].map((y) => caja(v(0, y, z), v(50, 5, 1.5), MADERA, "madera"))),
    ...[-24.25, 24.25].map((x) => caja(v(x, 10.5, 0), v(1.5, 21, 30), MADERA, "madera")),
    // El papel de corazones del frente, los croissants, las frutas, la miel y el vaso con el muffin.
    caja(v(0, 11, 15.4), v(36, 9, 0.3), "#f7dbe3", "papel"),
    ...[[-14, 6], [-6, 4], [-9, -2]].map(([x, z]) => cilindro(v(x!, 14, z!), 5, 5, "#d79a4c", "mate", 3.5)),
    ...bola(v(7, 21, 0), 4.5, "#a8c44a", "brillante"), ...bola(v(12, 20, 4), 4, "#7fbf3a", "brillante"), ...bola(v(15, 19, -3), 3.5, "#6a2a4a", "brillante"),
    cilindro(v(2, 14, -6), 3, 7, "#e3b23c", "brillante"), cilindro(v(-6, 14, -8), 4, 9, "#f4e4ea", "papel", 4.5),
  ];
  return {
    sala: sala(300, 280, 260),
    nodos: [
      { id: "m", nombre: "M de R-5 Silk Dorado", pieza: guirnalda, colocacion: libre(0, BASE, -4) },
      sobre("flor-1", "Flor de R-5 Silk Azul Ártico (izquierda)", "m", flor495, v(-17.3, 49, 0), AL_FRENTE),
      sobre("flor-2", "Flor de R-5 Silk Azul Ártico (derecha, arriba)", "m", flor495, v(18.8, 54, 0), AL_FRENTE),
      sobre("flor-3", "Flor de R-5 Silk Azul Ártico (derecha, abajo)", "m", flor495, v(22.5, 40, 0), AL_FRENTE),
      sobre("helio", "R-12 rosado Corazones Brillantes con helio", "m", globo(R("R-12", 28, "009"), "infinity-corazones-brillantes-fashion-metal-surtido"), v(16.4, 62, 0)),
      { id: "huacal", nombre: "Huacal con croissants y frutas", pieza: escenografia(huacal), colocacion: libre(0, 75, 0) },
      { id: "mesa", nombre: "Mesa", pieza: escenografia(mesaConMantel({ anchoCm: 90, fondoCm: 60, altoCm: 75, mantel: "#f7f5f2" })), colocacion: PISO },
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 519 · Encanto floral (ramo de tallos de tubito)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los R-12 amarillos de la base miden 70 px (≈ 26 cm): 2,7 px/cm; alto 525 px ≈ 1,95 m. Base de 4 R-12
 * amarillos (de confeti rosado), 5 R-5 fucsia, 7 tubitos largos (lila, fucsia, naranja, verde lima, amarillo y dos de
 * cristal) amarrados con un moñito verde a 1 m y 5 flores de R-5 en las puntas (rosada, azul, lila, fucsia y amarilla).
 */
const escena519 = (): Escena => {
  const MONO = v(-5, 103, 0);
  const tubitos: ReadonlyArray<{ id: string; codigo: string; punta: Vec3; flor?: { petalos: string; centro: string; nombre: string } }> = [
    { id: "lila", codigo: "050", punta: v(-34, 152, 2), flor: { petalos: "040", centro: "031", nombre: "azul" } },
    { id: "fucsia", codigo: "012", punta: v(-29, 188, -2), flor: { petalos: "009", centro: "951", nombre: "rosada" } },
    { id: "naranja", codigo: "061", punta: v(19, 177, 0), flor: { petalos: "951", centro: "012", nombre: "lila" } },
    { id: "verde-lima", codigo: "031", punta: v(49, 158, 3), flor: { petalos: "021", centro: "061", nombre: "amarilla" } },
    { id: "amarillo", codigo: "020", punta: v(29, 165, -8), flor: { petalos: "012", centro: "012", nombre: "fucsia" } },
    { id: "cristal-1", codigo: "390", punta: v(-12, 150, -6) },
    { id: "cristal-2", codigo: "390", punta: v(10, 155, -9) },
  ];
  const base = columna("R-12", 26, 1, ["023"]);
  const mono = deco({ tipo: "mono", propiedades: { formatoId: "T-260", grosorCm: 3.5, codigo: "029", lazosPorLado: 1, largoLazoCm: 9, anchoLazoCm: 6, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: null } });
  const baseCentro = -bajoDe(base);
  // El moño va sobre la base (lejos de sus globos: queda donde se pide) mirando al frente: en su espacio x → x, y → z, z → y.
  const enBase = (p: Vec3) => v(p.x, p.y - baseCentro, p.z);
  const giroMono = marcoNormal(AL_FRENTE);
  const aMono = inverso(giroMono);
  const nodos: NodoEscena[] = [
    { id: "base", nombre: "Base de 4 R-12 amarillos (de confeti)", pieza: base, colocacion: PISO },
    sobre("anillo", "5 R-5 fucsia de la base", "base", deco(anillo(R("R-5", 9, "012"), 5, 20)), v(0, 12, 0)),
    sobreCentrada("mono", "Moñito verde que amarra los tallos", "base", mono, enBase(MONO), AL_FRENTE),
  ];
  for (const t of tubitos) {
    const d = menos(t.punta, MONO);
    const L = largo(d);
    // Cada tallo es recto, de su punta (con la flor) al mismo largo por debajo del moño: el nudo del centro va en el moño.
    nodos.push(tallo(`tallo-${t.id}`, `Tallo de tubito ${t.id.replace("-", " ")}`, "mono", { formatoId: "T-260", grosorCm: 4, codigo: t.codigo }, aMono(v(0, 0, 0)), aMono(d), L, giroMono));
    if (t.flor) {
      const f = deco(flor({ petalos: { ...R("R-5", 8.5, t.flor.petalos), cantidad: 5, aperturaGrados: 5, giroGrados: 18 }, centro: { ...R("R-5", 7, t.flor.centro), cantidad: 1 } }));
      nodos.push(sobreCentrada(`flor-${t.id}`, `Flor ${t.flor.nombre} de R-5`, "mono", f, aMono(mas(d, por(unitario(d), 2))), aMono(unitario(mas(AL_FRENTE, por(unitario(d), 0.4)))), 0, giroMono));
    }
  }
  return { sala: sala(380, 340, 280), nodos };
};


// ----------------------------------------------------------------------------------------------------------
// 521 · Encanto orgánico (aro)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el fondo de tablillas mide 250 px (≈ 1 m de ancho) y los R-12 ~60 px: 2,4 px/cm. Aro orgánico de 590
 * × 520 px (≈ 2,4 m) de R-18, R-12, R-9 y R-5 blancos, Metal Dorado (el «durazno» perlado), cobre cromado y plata, con
 * el fondo de tablillas de madera en el centro.
 */
const escena521 = (): Escena => {
  const opciones = opcionesAroOrganico({
    diametroCm: 235, exterior: { formatoId: "R-12", radioCm: 14 }, interior: { pesos: { "R-18": 0.6, "R-12": 1.4, "R-9": 1.4, "R-5": 1 }, radioCm: 19, adelanteCm: 9 },
    colores: [colorOrg("405", 3, ["R-5", "R-9", "R-12"]), colorOrg("406", 0.5, ["R-18"]), colorOrg("570", 2), colorOrg("968", 1.6, ["R-5", "R-12", "R-18"]), colorOrg("481", 1.4)], semilla: 521,
  });
  const aro521: OpcionesOrganico = { ...opciones, relleno: [{ formatoId: "R-12", infladoCm: 22, trios: false }], densidad: 1 };
  const tablillas: ElementoEscenografia[] = Array.from({ length: 9 }, (_, i) => caja(v(0, 70 + i * 11.5, -14), v(108, 10, 2.5), i % 2 ? "#d9b88c" : "#e2c39a", "madera"));
  return {
    sala: sala(460, 380, 300),
    nodos: [
      { id: "aro", nombre: "Aro orgánico blanco, dorado, cobre y plata", pieza: organico(aro521), colocacion: PISO },
      { id: "tablillas", nombre: "Fondo de tablillas de madera", pieza: escenografia(tablillas), colocacion: libre(0, 0, 0) },
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// 530 · Estrella del Norte (de techo)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los R-5 rojos de la flor miden 56 px (≈ 12 cm): 4,75 px/cm; aro de 560 px (≈ 1,18 m). En el centro
 * una flor de 5 R-12 Verde Aurora (133 px ≈ 28 cm) con una flor de 5 R-5 rojos y centro verde encima; alrededor, 15
 * Link-O-Loon 6 rojos en cadena (3 entre cada par de R-5 verdes) y 5 R-5 verdes en las uniones, frente a cada pétalo.
 */
const escena530 = (): Escena => {
  const RADIO = 53;
  const nodos: NodoEscena[] = [
    { id: "flor-verde", nombre: "Flor de 5 R-12 Verde Aurora", pieza: deco(anillo(R("R-12", 28, "932"), 5, 0, 54), true), colocacion: { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 60, giroGrados: 0, volteada: false } },
    sobre("flor-roja", "Flor de 5 R-5 rojos con centro verde", "flor-verde", deco(anillo(R("R-5", 12, "015"), 5, 0, 18, { ...R("R-5", 10, "932"), cantidad: 1 })), v(0, 0, 4), AL_FRENTE),
  ];
  // El aro: 5 uniones (R-5 verdes) frente a cada pétalo y 3 eslabones rojos entre cada dos (en la flor, de frente: x, y).
  for (let k = 0; k < 5; k++) {
    const a = 50 + 72 * k;
    const p = v(r2(RADIO * Math.cos(rad(a))), r2(RADIO * Math.sin(rad(a))), 0);
    nodos.push(sobreCentrada(`union-${k + 1}`, `R-5 verde de la unión ${k + 1}`, "flor-verde", globo(R("R-5", 9.5, "932")), p, AL_FRENTE));
    for (let j = 1; j <= 3; j++) {
      const b = a + (72 * j) / 4;
      const q = v(r2(RADIO * Math.cos(rad(b))), r2(RADIO * Math.sin(rad(b))), 0);
      const tangente = v(-Math.sin(rad(b)), Math.cos(rad(b)), 0);
      nodos.push(sobreCentrada(`eslabon-${k * 3 + j}`, `Link-O-Loon 6 rojo ${k * 3 + j}`, "flor-verde", globo(R("LOL-6", 12, "015")), q, tangente));
    }
  }
  return { sala: sala(380, 340, 300), nodos };
};


// ----------------------------------------------------------------------------------------------------------
// 534 · Eterna primavera (jarrón con flores de tubito)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: los cuartetos miden ~92 px de ancho de frente (≈ 2,24 diámetros): R-12 a 23 cm, 3,7 px/cm; alto 545
 * px ≈ 1,47 m. De abajo arriba: cuarteto Satín Lila, 3 Fashion Fucsia con un R-12 amarillo de frente en el del medio, y
 * cuarteto lila; encima 5 flores de tubito (amarilla, fucsia en copa, lila, fucsia de 5 pétalos y otra fucsia chica)
 * con tallos verde lima y hojas.
 */
const pila534 = perezoso(() => apilar([
  { id: "lila-abajo", nombre: "Cuarteto R-12 Satín Lila (abajo)", formatoId: "R-12", infladoCm: 23, colores: ["450"] },
  { id: "fucsia", nombre: "3 cuartetos R-12 Fashion Fucsia", formatoId: "R-12", infladoCm: 23, niveles: 3, colores: ["012"] },
  { id: "lila-arriba", nombre: "Cuarteto R-12 Satín Lila (arriba)", formatoId: "R-12", infladoCm: 23, colores: ["450"] },
]));
const escena534 = (): Escena => {
  const yArriba = pila534().centros[2]!, gArriba = pila534().giros[2]!;
  const aLocal = inverso(giroY(gArriba));
  const TALLO = { formatoId: "T-260", grosorCm: 3.5, codigo: "031" };
  // Las flores (centro de la cabeza, en cm del piso y del eje) y su forma.
  const flores: ReadonlyArray<{ id: string; nombre: string; cabeza: Vec3; flor: Decoracion }> = [
    { id: "amarilla", nombre: "Flor amarilla de 5 pétalos", cabeza: v(-28, 124, 4), flor: florTubito(lazos("T-260", 3.5, ["020"], 5, 9, 6, 10, 0), R("R-5", 6, "031")) },
    { id: "fucsia-copa", nombre: "Flor fucsia en copa", cabeza: v(-12, 124, 8), flor: florTubito(lazos("T-260", 3.5, ["012"], 3, 8, 6, 55, 0), R("R-5", 6, "031")) },
    { id: "lila", nombre: "Flor lila de 4 pétalos", cabeza: v(-3, 142, -2), flor: florTubito(lazos("T-260", 3.5, ["050"], 4, 9, 6, 10, 45), R("R-5", 6, "031")) },
    { id: "fucsia-estrella", nombre: "Flor fucsia de 5 pétalos", cabeza: v(14, 126, 4), flor: florTubito(lazos("T-260", 3.5, ["012"], 5, 10, 5, 5, 0), R("R-5", 6, "031")) },
    { id: "fucsia-chica", nombre: "Flor fucsia chica", cabeza: v(-7, 114, -8), flor: florTubito(lazos("T-260", 3.5, ["012"], 3, 7, 5, 45, 0), R("R-5", 6, "031")) },
  ];
  const ALTO_TALLOS = yArriba + 9; // los tallos salen de entre los globos del cuarteto de arriba
  const nodos: NodoEscena[] = [
    ...pila534().nodos,
    // El amarillo, de frente en el cuarteto del medio de los fucsia (en su espacio: el del primero, girado).
    sobre("amarillo", "R-12 Fashion Amarillo de frente", "fucsia", globo(R("R-12", 23, "020")), v(0, 18.4, 0), frenteEn(pila534().giros[1]!)),
    sobreCentrada("hojas", "Hojas de tubito verde lima", "lila-arriba", deco(florTubito(lazos("T-260", 3.5, ["031"], 4, 11, 7, 30, 20))), aLocal(v(0, ALTO_TALLOS - yArriba + 3, 0))),
  ];
  for (const f of flores) {
    const desde = v(f.cabeza.x * 0.25, ALTO_TALLOS, f.cabeza.z * 0.25);
    const hasta = menos(f.cabeza, por(unitario(menos(f.cabeza, desde)), 5));
    // Los tallos se apoyan en los globos del cuarteto de arriba; la cabeza, de frente y algo hacia arriba.
    nodos.push(palito(`tallo-${f.id}`, `Tallo verde lima (${f.nombre.toLowerCase()})`, "lila-arriba", TALLO, aLocal(v(desde.x, desde.y - yArriba, desde.z)), aLocal(v(hasta.x, hasta.y - yArriba, hasta.z))));
    nodos.push(sobreCentrada(`flor-${f.id}`, f.nombre, "lila-arriba", deco(f.flor), aLocal(v(f.cabeza.x, f.cabeza.y - yArriba, f.cabeza.z)), aLocal(unitario(v(0, 0.5, 1)))));
  }
  return { sala: sala(360, 320, 260), nodos };
};


// ----------------------------------------------------------------------------------------------------------
// 538 · Fantasía en satín (flor de pared)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: las tercias de R-5 miden ~45 px (≈ 9 cm): 5 px/cm; flor de 570 px (≈ 1,14 m). Dos capas de 5 pétalos
 * R-12 Silk Perla Crema (la de atrás girada media vuelta de pétalo), el centro de 4 R-5 Metal Verde con otro al medio y
 * una tercia de R-5 en la punta de cada pétalo: violeta, azul, naranja, amarilla y rosada delante; durazno, amarillo
 * pálido, fucsia satinado, violeta oscuro y verde detrás.
 */
const escena538 = (): Escena => {
  const petalos = (giro: number, d: number) => deco(anillo(R("R-18", d, "873"), 5, 0, giro), true);
  // La capa de delante va `sobre` la de atrás mirando al frente: en su espacio x → x, y → z, z → y.
  const aDelante = inverso(marcoNormal(AL_FRENTE));
  // De frente, los pétalos de la capa de delante apuntan a 90° (arriba), 18°, −54°, −126° y 162°; los de atrás, entre ellos.
  const delante: ReadonlyArray<[number, string]> = [[90, "951"], [18, "040"], [-54, "570"], [-126, "023"], [162, "014"]];
  const atras: ReadonlyArray<[number, string]> = [[126, "060"], [54, "620"], [-18, "412"], [-90, "051"], [-162, "030"]];
  const tercia = (codigo: string) => deco(anillo(R("R-5", 9, codigo), 3, 0, 30));
  const enFlor = (grados: number, radio: number, z: number) => v(r2(radio * Math.cos(rad(grados))), r2(radio * Math.sin(rad(grados))), z);
  return {
    sala: sala(380, 320, 280),
    nodos: [
      // De frente en la pared, el pétalo de ángulo φ queda a 180° − φ; puesta `sobre` mirando al frente, a φ.
      { id: "atras", nombre: "Capa de atrás: 5 R-18 Silk Perla Crema", pieza: petalos(54, 32), colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 70 } },
      sobre("delante", "Capa de delante: 5 R-18 Silk Perla Crema", "atras", petalos(18, 34), v(0, 0, 0), AL_FRENTE),
      sobre("centro", "Centro de 4 R-5 Metal Verde", "delante", deco(anillo(R("R-5", 10, "530"), 4, 0, 45, { ...R("R-5", 10, "530"), cantidad: 1 })), aDelante(v(0, 0, 0)), aDelante(AL_FRENTE)),
      ...delante.map(([g, c], i) => sobre(`tercia-delante-${i + 1}`, `Tercia de R-5 (delante, ${i + 1})`, "delante", tercia(c), aDelante(enFlor(g, 38, 0)), aDelante(AL_FRENTE))),
      ...atras.map(([g, c], i) => sobre(`tercia-atras-${i + 1}`, `Tercia de R-5 (atrás, ${i + 1})`, "atras", tercia(c), enFlor(g, 36, 0), AL_FRENTE)),
    ],
  };
};


// ----------------------------------------------------------------------------------------------------------
// Las 20 ideas
// ----------------------------------------------------------------------------------------------------------

/** Ideas de fiesta de sempertex.com digitalizadas: lote 07. */
export const LOTE_07: readonly IdeaDigitalizada[] = [
  idea({
    numero: 380, slug: "columna-halloween", nombre: "Columna Halloween: araña y calabaza", ocasiones: ["halloween"],
    fotoUrl: FOTO("1768f8eb71fb968f874cd1fb6ee1e423_2a452da6-c30b-415b-abf9-31e2a8e4f503.jpg"),
    contenido: () => ESCENA(escena380()),
    nota: "Igual: de abajo arriba 4 R-5 Verde Trébol 029, la calabaza R-18 Fashion Naranja 061 con cara (41 cm, 113 px a 2,7 px/cm), 4 R-5 verdes, el tallo trenzado de T-260 029 (60 cm a la vista), 4 R-5 negros, 4 R-12 naranjas con el impreso Infinity® Happy Halloween de la tienda (sobre su naranja), 4 R-9 naranjas y la araña de 8 patas articuladas de T-260 negro con cuerpo R-18 y cabeza R-12 con ojos verdes; ~2 m de alto. Colores medidos (no publica productos): naranja #ff7501 → 061, verde #00a125 → 029. Distinto: en la foto el tallo es de tres tubitos torcidos y aquí de dos trenzados; la cabeza de la araña va debajo del cuerpo (en la foto, delante) y las patas suben (en la foto caen a los lados) y la boca roja no se dibuja, así que la columna queda unos 20 cm más alta; el impreso naranja de la foto es otro Halloween (el más parecido de la tienda).",
  }),
  idea({
    numero: 392, slug: "columna-mi-primera-comunion", nombre: "Columna Mi Primera Comunión", ocasiones: ["bautizo y comunión"],
    fotoUrl: FOTO("c3d469550d5115218ab27359389e67b6_5f2169b3-e35e-4f20-836e-e92ae601a9b8.jpg"),
    contenido: () => ESCENA(escena392()),
    nota: "Igual: el armado de la foto con sus tamaños relativos (R-24 de 184 px ≈ 58 cm: 3,17 px/cm; ~1,7 m): cuarteto R-12 de perlas con 2 Infinity® Mi Primera Comunión Palomas alternados, cuarteto Satín Lila 450, 4 R-5 Metal Dorado 570, el tallo de 8 niveles de R-5 Satín Perla (15 cm de ancho), 4 R-5 dorados, un cuarteto de impresos Mi Primera Comunión y el R-24 dorado arriba, con 2 cruces de tubito T-260 Fashion Lila en el tallo. Colores medidos (no publica productos). Distinto: el R-24 de la foto es un cristal dorado impreso con palomas y letras: va liso en Metal Dorado 570 (no hay cristal dorado en la tabla ni ese impreso en R-24); la tienda vende el impreso de comunión sobre blanco (005) y en la foto se ven perlados; faltan los aros de tubito lila de arriba y abajo de cada cruz; el lila medido queda entre Fashion Lila y Satín Lila (se tomó el satinado por el brillo perlado).",
  }),
  idea({
    numero: 394, slug: "columna-mis-quince-anos", nombre: "Columna Mis Quince Años", ocasiones: ["cumpleaños"],
    fotoUrl: FOTO("dab399c343f8343ba5a78ceb7921af75_fb958938-a3db-4213-be14-727feea9ca13.jpg"),
    contenido: () => ESCENA(escena394()),
    nota: "Igual: el mismo armado de la #392 (R-24 de 164 px ≈ 55 cm: 2,98 px/cm; ~1,8 m): cuarteto R-12 Frambuesa 014, cuarteto Verde Trébol 029, 4 R-5 Fashion Rosado 009, tallo de 10 niveles de R-5 Satín Perla con 2 cruces de T-260 verde, 4 R-5 rosados, cuarteto verde y el R-24 Neón Fucsia 212 arriba. Colores medidos (no publica productos): fucsia del R-24 #ff51bd → 212, verde #019a22 → 029, frambuesa #f6325a → 014. Distinto: los impresos de la foto (lunares blancos sobre frambuesa, destellos blancos sobre verde, «15» con estrellas en el R-24) no están en la tienda: van lisos en su fondo; faltan los aros verdes de tubito del tallo; en la foto los anillos rosados parecen de 5–6 R-5 y aquí son cuartetos.",
  }),
  idea({
    numero: 399, slug: "columna-organica-encanto-dorado", nombre: "Columna orgánica Encanto Dorado", ocasiones: ["boda", "baby shower", "bautizo y comunión"],
    fotoUrl: FOTO("Columna-Org_C3_A1nica-Encanto-Dorado.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO SATIN BLANCO", url: "/products/globo-para-fiesta-latex-redondo-satin-blanco", formato: "R-12", codigo: "405" },
      { nombre: "GLOBO REDONDO SATIN PERLA", url: "/products/globo-para-fiesta-latex-redondo-satin-perla", formato: "R-12", codigo: "406" },
      { nombre: "GLOBO LATEX REDONDO REFLEX DORADO", url: "/products/globo-para-fiesta-latex-redondo-reflex-dorado", formato: "R-12", codigo: "970" },
    ],
    contenido: () => ESCENA(escena399()),
    nota: "Igual: columna orgánica algo torcida de ~1,85 m (las perlas R-12 de 43 px ≈ 25 cm: 1,7 px/cm) en los productos publicados —Satín Blanco 405, Satín Perla 406 y Reflex Dorado 970— con cristales, R-12 y R-9 sobre todo (la foto casi no tiene R-5), el R-24 Reflex Dorado arriba a la derecha y el ramo de 5 R-12 de cristal con helio amarrado en lo alto, con sus cintas. Distinto: el motor orgánico da 63 globos en el cuerpo (la foto muestra ~52 de frente: no se cuentan uno a uno) y la silueta no sigue exactamente la S de la foto; los cristales de la columna se ven color champaña y van en Cristal Transparente 390, y los 5 de helio llevan un impreso dorado que no está en la tienda (van lisos).",
  }),
  idea({
    numero: 400, slug: "columna-organica", nombre: "Columna orgánica reloj de arena", ocasiones: ["boda"],
    fotoUrl: FOTO("1f120d7f649d4350fc6de93b3aa08afd.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO SATIN ROSADO", url: "/products/globo-para-fiesta-latex-redondo-satin-rosado", formato: "R-12", codigo: "409" },
      { nombre: "GLOBO REDONDO SATIN PLATA", url: "/products/globo-para-fiesta-latex-redondo-satin-plata", formato: "R-12", codigo: "481" },
      { nombre: "GLOBO REDONDO SATIN PERLA", url: "/products/globo-para-fiesta-latex-redondo-satin-perla", formato: "R-12", codigo: "406" },
      { nombre: "GLOBO REDONDO SATIN BLANCO", url: "/products/globo-para-fiesta-latex-redondo-satin-blanco", formato: "R-12", codigo: "405" },
    ],
    contenido: () => ESCENA(escena400()),
    nota: "Igual: reloj de arena de ~1,85 m (R-24 de 165 px ≈ 55 cm: 3 px/cm): base ancha (77 cm) de R-12 y R-9 de unos 30 cm de alto y cintura de R-5 y R-9 de ~22 cm hasta 1,25 m, en los Satín publicados —Rosado 409, Plata 481, Perla 406 y Blanco 405— con algo de Metal Dorado 570 y cristal, unas ramitas de gypsophila, el R-24 Satín Perla arriba y 4 corazoncitos dorados alrededor de él. Distinto: el motor orgánico da 69 globos (no se cuentan uno a uno); los corazoncitos van como metalizados de 4\" dorado mate sin producto de la tienda (no hay corazón de látex dorado en la tabla) y falta el aro de tubito perla que los sostiene; el dorado y el cristal no están entre los productos publicados (se ven en la foto).",
  }),
  idea({
    numero: 404, slug: "columna-romana-bigotes", nombre: "Columna romana Bigotes", ocasiones: ["general"],
    fotoUrl: FOTO("COLUMNA_ROMANA_BIGOTES.jpg"),
    publicados: [
      { nombre: "GLOBO INFINITY® BIGOTES Y CORBATINES CRISTAL", url: "/products/globo-para-fiesta-latex-redondo-infinity-bigotes-y-corbatines-fashion-transparente", formato: "R-12", codigo: null },
      { nombre: "GLOBO REDONDO FASHION AZUL NAVAL", url: "/products/globo-para-fiesta-latex-redondo-fashion-azul-naval", formato: "R-12", codigo: "044" },
      { nombre: "GLOBO REDONDO SILK AZUL ÁRTICO", url: "/products/globo-latex-redondo-silk-azul-artico", formato: "R-24", codigo: "839" },
      { nombre: "GLOBO REDONDO SILK VERDE MENTA", url: "/products/globo-latex-redondo-silk-verde-menta", formato: "R-12", codigo: "826" },
      { nombre: "GLOBO REDONDO SILK DORADO", url: "/products/globo-latex-redondo-silk-rocio-de-oro", formato: "R-5", codigo: "870" },
    ],
    contenido: () => ESCENA(escena404()),
    nota: "Igual: por el perfil de ancho (R-24 de 211 px ≈ 55 cm: 3,84 px/cm; ~2,2 m), de abajo arriba cuarteto R-12 Azul Naval 044 a 25 cm, cuarteto Infinity® Bigotes y Corbatines Cristal a 23, cuarteto Silk Verde Menta 826 a 20, cintura de 3 niveles de R-5 en espiral (menta, Silk Dorado 870 y naval) a 10, cuarteto R-9 naval a 16, otra cintura igual, menta, bigotes, naval y el R-24 Silk Azul Ártico 839 arriba: los productos publicados. Distinto: el R-24 lleva impreso «PAPÁ» con sombrero y bigote (no está en la tienda: va liso); el Silk Dorado y el Azul Ártico se publican como R-12 y en la foto son R-5 y R-24; en la cintura no se ve el cuarto globo de cada nivel (va naval).",
  }),
  idea({
    numero: 409, slug: "columna-tejida", nombre: "Columna tejida fucsia y blanca", ocasiones: ["cumpleaños", "infantil"],
    fotoUrl: FOTO("1979811bf8713a7f6709e0372f50b039_cc48d187-22d6-4c68-ae1d-605443395ee7.jpg"),
    contenido: () => ESCENA(escena409()),
    nota: "Igual: de abajo arriba cuarteto R-12 Satín Blanco 405, cuarteto Fashion Fucsia 012, cuarteto blanco, el tallo de tubitos fucsia y rosados trenzados (46 cm a la vista) con su racimo de R-5 al medio (rosados Satín Rosado 409 arriba y abajo y un anillo Neón Fucsia 212), cuarteto fucsia, cuarteto blanco y el R-24 fucsia arriba; ~1,9 m (R-24 de 156 px ≈ 55 cm). Colores medidos (no publica productos). Distinto: los lunares blancos de los cuartetos fucsia y los lunares rosados grandes del R-24 son impresos que la tienda no vende sobre fucsia (Polka solo en rojo y verde lima): van lisos; el tallo son 2 + 2 tubitos trenzados (en la foto se ve una sola trenza de dos colores).",
  }),
  idea({
    numero: 436, slug: "corazones-neon", nombre: "Arco Corazones neón", ocasiones: ["amor", "cumpleaños"],
    fotoUrl: FOTO("ff69d3ea302863c238fce50ed727a1f0_40d1be4b-253a-4bd0-9692-1e05a70e6b83.jpg"),
    clase: "estructura", contenido: () => ({ tipo: "pieza", pieza: arco436(), sugerida: PISO }),
    nota: "Igual: arco en herradura de 36 cuartetos de R-9 a 18 cm (~2,6 × 1,95 m: el globo mide 45 px y el paso 36 px), con las puntas curvadas hacia dentro y bandas de 4 niveles de cada lado —Neón Fucsia 212, Neón Naranja 261, Fashion Verde 030 y Neón Verde 230— y 4 niveles Neón Azul 240 arriba (colores medidos; no publica productos). Distinto: en la foto el globo de fuera de cada cuarteto lleva corazoncitos blancos impresos y el de dentro es liso, sin girar; aquí son lisos y la trenza gira 1/8 por nivel; faltan los globitos blancos de relleno entre cuartetos.",
  }),
  idea({
    numero: 441, slug: "corona-navidena", nombre: "Corona navideña con moño", ocasiones: ["navidad"],
    fotoUrl: FOTO("Corona_navidena.png"),
    publicados: [
      { nombre: "GLOBO REDONDO FASHION VERDE TREBOL", url: "/products/globo-latex-redondo-fashion-verde-trebol", formato: "R-12", codigo: "029" },
      { nombre: "GLOBO LATEX REDONDO REFLEX DORADO", url: "/products/globo-para-fiesta-latex-redondo-reflex-dorado", formato: "R-5", codigo: "970" },
      { nombre: "GLOBO REDONDO FASHION MERLOT", url: "/products/globo-latex-redondo-fashion-merlot", formato: "R-12", codigo: "018" },
      { nombre: "GLOBO TUBITO FASHION MERLOT", url: "/products/globo-latex-tubito-fashion-merlot", formato: "T-260", codigo: "018" },
    ],
    contenido: () => ESCENA(escena441()),
    nota: "Igual: corona de ~1,4 m (R-5 dorados de 55 px ≈ 12 cm: 4,6 px/cm) de R-12 Fashion Verde Trébol 029 por fuera y R-9 verdes con R-5 Reflex Dorado 970 por dentro (los publicados), 3 rizos de tubito dorado y el moño de T-260 Fashion Merlot 018 de dos lazos y dos colas de ~60 cm, en la pared. Distinto: el motor orgánico da 44 globos (la foto: ~16 + ~18 + 8 dorados); el dorado de la foto mide como Metal Dorado y va el Reflex Dorado publicado (que la idea mapea a R-12: es R-5); el moño de la foto se ve más grueso que un T-260; el R-12 Merlot publicado no aparece en la foto (va sin cantidad).",
  }),
  idea({
    numero: 443, slug: "corporativo", nombre: "Corporativo: colgantes de supermercado", ocasiones: ["general"],
    fotoUrl: FOTO("58c142520ad7ed61c568cbe716377a1f.jpg"),
    contenido: () => ESCENA(escena443()),
    nota: "Igual: el supermercado con sus 6 colgantes de techo de 6 cuartetos R-12 (2 Fashion Azul 040, 2 blancos y 2 Fashion Rojo 015 de arriba abajo) a distintas distancias y los 2 racimos de 12 R-12 (azul rey con algún blanco y rojo con algún blanco) sobre el exhibidor de naranjas; góndolas, la franja roja con el cartel de frutas, el exhibidor, la nevera y las cajas como escenografía. Colores medidos (no publica productos). Distinto: los blancos (y algunos azules y rojos) llevan el logo de la tienda impreso, que no se modela; en la foto los cuartetos de los colgantes van alineados y aquí giran 1/8 por nivel; las góndolas y productos son bloques.",
  }),
  idea({
    numero: 460, slug: "cumpleano-hawaiano", nombre: "Cumpleaño hawaiano: malla turquesa con flores", ocasiones: ["cumpleaños"],
    fotoUrl: FOTO("749eb5c0cd4c88e5229d4c1897a46100_640c3cae-2d08-40fb-95bc-fb88774499a5.jpg"),
    contenido: () => ESCENA(escena460()),
    nota: "Igual: la malla de eslabones turquesa (300 × 175 cm: 112 eslabones de Link-O-Loon 12 a 20 cm con sus parejas de unión de R-5) en la pared, detrás de la mesa con mantel de yute sobre el blanco, con las 10 flores de dos pisos de R-5 en las esquinas de arriba —5 a cada lado, cada una con 5 pétalos, 5 más chicos encima y un centro, en los colores medidos de la foto—, las palmeras en materas negras, el pastel de 3 pisos y los regalos de colores. Distinto: el turquesa medido es Fashion Azul Caribe 038, que no se fabrica en Link-O-Loon: la malla va en Fashion Azul 040; la malla de la foto se ve en cuadrícula (aquí rombos de la técnica de Sempertex); palmeras, pastel y regalos son escenografía sencilla.",
  }),
  idea({
    numero: 465, slug: "cumpleanos-violeta-y-plata", nombre: "Cumpleaños violeta y plata: mesa de postres", ocasiones: ["bautizo y comunión"],
    fotoUrl: FOTO("4c055bd05c996c70207adfd16dfb5877.jpg"),
    contenido: () => ESCENA(escena465()),
    nota: "Igual: la mesa de postres dorada con la fila de R-12 Reflex Champaña 971 colgados bajo su borde (el color medido entre plata y champaña: #a3998e → 971), las estanterías caladas, el marco de espejo, la torre de macarons, los cake pops, los frascos y las serpentinas lila y plata. Distinto: en la foto se ven 7 globos y la mesa sale cortada a la izquierda: se completan 11 a lo largo; las cintas lila entre los globos, las flores y los postres son escenografía sencilla.",
  }),
  idea({
    numero: 467, slug: "cupcakes-2", nombre: "Cupcakes 2: guirnalda y banderín", ocasiones: ["cumpleaños", "infantil"],
    fotoUrl: FOTO("0b8950981a9aae0cb19e1651a18f2cd2_3be6551d-7faa-4b12-bec5-d648e3db9c5d.jpg"),
    contenido: () => ESCENA(escena467()),
    nota: "Igual: el fondo rosado (2,1 × 2,3 m, a 2,56 px/cm) con la guirnalda de R-9 por arriba y por los lados en bloques de color medidos —Verde Selva 032, Satín Rosado 409, Fashion Violeta 051, Fashion Amarillo 020, Verde Trébol 029, Pastel Dusk Azul 140 y Satín Fucsia 412—, el banderín de 14 triángulos pastel (tres de lunares), los 3 cuadros de cupcakes, los faroles de papel y la mesa blanca con el pastel, la regadera y los frascos. Distinto: la guirnalda de la foto es de globos sueltos en dos filas y aquí es la trenza de cuartetos; el amarillo se midió en sombra (#b4a801) y va el Fashion Amarillo; el banderín no es un producto de la tienda (genérico).",
  }),
  idea({
    numero: 489, slug: "decoracion-pastel-melon", nombre: "Aro pastel melón Feliz Cumpleaños", ocasiones: ["cumpleaños"],
    fotoUrl: FOTO("Decoracion_Pastel_Melon.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO PASTEL MATE MELON", url: "/products/globo-para-fiesta-latex-redondo-pastel-mate-melon", formato: "R-5", codigo: "663" },
      { nombre: "GLOBO FELIZ CUMPLEAÑOS DESTELLOS", url: "/products/globo-para-fiesta-latex-redondo-2-caras-feliz-cumpleanos-fiesta-destellos-reflex-surtido", formato: "R-12", codigo: null },
    ],
    contenido: () => ESCENA(escena489()),
    nota: "Igual: aro forrado de 78 cm de centro de mesa (el R-12 impreso mide 250 px ≈ 30 cm: 8,3 px/cm) con 3 racimos de Pastel Mate Melón 663 —arriba a la izquierda, arriba a la derecha y abajo de lado a lado— de R-5 a 10 cm y algunos R-9, el R-12 Reflex Dorado con el impreso Feliz Cumpleaños Destellos de la tienda adentro, a la derecha, y 4 flores blancas de papel en el racimo de abajo. Distinto: el motor orgánico da 60 globos (la foto: ~63); el melón se publica como R-12 y en la foto son R-5 (70–90 px); las flores de papel van como hortensias blancas y faltan las hojas verdes; la mesa no sale en la foto.",
  }),
  idea({
    numero: 495, slug: "desayuno-sorpresa", nombre: "Desayuno sorpresa: M de mamá", ocasiones: ["amor", "día de la madre"],
    fotoUrl: FOTO("DESAYUNO_SORPRESA_-_SURPRISE_BREAKFAST.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO SILK DORADO", url: "/products/globo-latex-redondo-silk-rocio-de-oro", formato: "R-5", codigo: "870" },
      { nombre: "GLOBO REDONDO SILK AZUL ÁRTICO", url: "/products/globo-latex-redondo-silk-azul-artico", formato: "R-5", codigo: "839" },
      { nombre: "GLOBO REDONDO INFINITY® CORAZONES BRILLANTES", url: "/products/globo-para-fiesta-latex-redondo-infinity-corazones-brillantes-fashion-metal-surtido", formato: "R-12", codigo: null },
    ],
    contenido: () => ESCENA(escena495()),
    nota: "Igual: huacal de madera de 50 cm (el R-12 rosado de 275 px ≈ 28 cm: 9,8 px/cm) con la «M» de mamá en trenza de R-5 Silk Dorado 870 diminutos (5,5 cm: 25 niveles, 2 de ancho), 3 flores de 5 R-5 Silk Azul Ártico 839 con centro dorado y el R-12 rosado con el impreso Infinity® Corazones Brillantes de la tienda con helio, los productos publicados; croissants, frutas, miel y vaso. Distinto: el azul de las flores mide como Silk Verde Menta (#8fb6b4) y va el Ártico publicado; la idea mapea el dorado y el ártico a R-12 y en la foto son R-5; el papel de corazones y la comida son escenografía sencilla; la mesa no sale en la foto.",
  }),
  idea({
    numero: 519, slug: "encanto-floral", nombre: "Encanto floral: ramo de tallos de tubito", ocasiones: ["general"],
    fotoUrl: FOTO("0b136c7423b22dde3852dcf94f39bccf_52b6fdb8-96b3-40b7-87dc-4aae3cc79c89.jpg"),
    contenido: () => ESCENA(escena519()),
    nota: "Igual: base de 4 R-12 Fashion Mostaza 023 y 5 R-5 Fashion Fucsia 012, 7 tallos de T-260 (lila, fucsia, naranja, verde lima, amarillo y 2 de cristal) amarrados con un moñito verde a 1 m y las 5 flores de 5 R-5 en las puntas (azul 040 con centro verde lima, rosada 009 con centro violeta, violeta 951 con centro fucsia, amarilla miel 021 con centro naranja y fucsia), ~1,95 m (base de 70 px ≈ 26 cm). Colores medidos (no publica productos). Distinto: los amarillos de la base llevan confeti rosado impreso (no está en la tienda: van lisos); los tallos son rectos de punta a punta pasando por el moño (en la foto se curvan) y los más largos cuentan 2 tubitos.",
  }),
  idea({
    numero: 521, slug: "encanto-organico", nombre: "Aro Encanto orgánico", ocasiones: ["boda", "baby shower", "bautizo y comunión", "navidad"],
    fotoUrl: FOTO("Encanto-org_C3_A1nico.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO SATIN PLATA", url: "/products/globo-para-fiesta-latex-redondo-satin-plata", formato: "R-12", codigo: "481" },
      { nombre: "GLOBO REDONDO METAL DORADO", url: "/products/globo-para-fiesta-latex-redondo-metal-dorado-cobre", formato: "R-12", codigo: "570" },
    ],
    contenido: () => ESCENA(escena521()),
    nota: "Igual: aro orgánico de ~2,35 m (el fondo de tablillas mide 250 px ≈ 1 m: 2,4 px/cm) de R-18, R-12, R-9 y R-5 en blanco satinado, Metal Dorado 570 (el «durazno» perlado), cobre cromado y Satín Plata 481 (los dos publicados), con el fondo de tablillas de madera en el centro. Distinto: el motor orgánico da 139 globos (no se cuentan uno a uno); el cobre no está entre los productos publicados: medido #ce817a → Reflex Dorado Rosa 968; el blanco va en Satín Blanco 405 y, en R-18 (donde no se fabrica), en Satín Perla 406; la foto es algo ovalada.",
  }),
  idea({
    numero: 530, slug: "estrella-del-norte", nombre: "Estrella del Norte (de techo)", ocasiones: ["navidad"],
    fotoUrl: FOTO("694993c1a89c15b6816f262a840e7055_c8cd0429-0bb3-4abf-9227-4ef8a8a78f87.jpg"),
    contenido: () => ESCENA(escena530()),
    nota: "Igual: estrella de techo de ~1,2 m (los R-5 rojos miden 56 px ≈ 12 cm: 4,75 px/cm): flor de 5 R-12 Reflex Verde Aurora 932 con una flor de 5 R-5 Fashion Rojo 015 y centro verde encima, y el aro de 15 Link-O-Loon 6 rojos en cadena (3 entre cada par) con 5 R-5 verdes en las uniones, frente a cada pétalo. Colores medidos (no publica productos): verde azulado #00a192 → 932, rojo #ff0027 → 015. Distinto: el verde de la foto es mate y el Verde Aurora es Reflex (el Fashion más cercano, Azul Caribe 038, es más claro); los eslabones del aro van uno a uno, sin amarrarse entre sí.",
  }),
  idea({
    numero: 534, slug: "eterna-primavera", nombre: "Eterna primavera: jarrón con flores de tubito", ocasiones: ["general"],
    fotoUrl: FOTO("161ef3af6334b53b1dfe4a8dc7dcab30_979959ff-264f-4a7a-b14c-20c71fef381d.jpg"),
    publicados: [
      { nombre: "GLOBO REDONDO SATIN LILA", url: "/products/globo-para-fiesta-latex-redondo-satin-lila", formato: "R-12", codigo: "450" },
      { nombre: "GLOBO REDONDO FASHION FUCSIA", url: "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", formato: "R-12", codigo: "012" },
      { nombre: "GLOBO REDONDO FASHION AMARILLO", url: "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", formato: "R-12", codigo: "020" },
      { nombre: "GLOBO TUBITO FASHION AMARILLO", url: "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", formato: "T-260", codigo: "020" },
      { nombre: "GLOBO TUBITO FASHION VERDE LIMA", url: "/products/globo-para-fiesta-latex-tubito-fashion-verde-lima", formato: "T-260", codigo: "031" },
      { nombre: "GLOBO TUBITO FASHION FUCSIA", url: "/products/globo-para-fiesta-latex-tubito-fashion-fucsia", formato: "T-260", codigo: "012" },
      { nombre: "GLOBO TUBITO FASHION LILA", url: "/products/globo-para-fiesta-latex-tubito-fashion-lila", formato: "T-260", codigo: "050" },
    ],
    contenido: () => ESCENA(escena534()),
    nota: "Igual: jarrón de 5 niveles de cuartetos R-12 a 23 cm (92 px de ancho de frente: 3,7 px/cm; ~1,5 m con las flores): Satín Lila 450, 3 de Fashion Fucsia 012 con el R-12 Fashion Amarillo 020 de frente en el del medio, y Satín Lila; encima 5 flores de tubito (amarilla 020, fucsia en copa, lila 050, fucsia de 5 pétalos y una fucsia chica) con tallos y hojas de T-260 Verde Lima 031: los productos publicados. Distinto: los centros de las flores son R-5 verde lima (en la foto, nudos del tallo); el amarillo de la foto mide como Amarillo Miel 021 y va el Amarillo 020 publicado; las flores de la foto son más irregulares.",
  }),
  idea({
    numero: 538, slug: "fantasia-en-satin", nombre: "Fantasía en satín: flor de pared", ocasiones: ["general"],
    fotoUrl: FOTO("6f819750957084531f3f10b2d70ef3a9_6709a2df-9a92-44bb-8346-41f8635ea9d4.jpg"),
    contenido: () => ESCENA(escena538()),
    nota: "Igual: flor de pared de ~85 cm con dos capas de 5 pétalos de Silk Perla Crema 873 (medido #d8d2c6, ΔE 0,7), la de atrás entre los de delante, el centro de 4 R-5 Metal Verde con otro al medio y una tercia de R-5 en la punta de cada pétalo en los colores medidos: violeta, azul, naranja perlado, amarillo y frambuesa delante; durazno, amarillo pálido, fucsia satinado, violeta oscuro y verde detrás. Distinto: los pétalos son R-18 a 32–34 cm (en la foto se ven algo alargados y la flor mide ~1,1 m); falta el globo perla de detrás del centro; los perlados de las tercias van en el código más cercano aunque sea mate.",
  }),
];
