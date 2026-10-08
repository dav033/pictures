import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { centroCuerpo } from "../geometria";
import { formatoPorId } from "../formatos";
import { sumarMateriales } from "../mezcla";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { opcionesRacimosLibres, type RacimoLibre } from "../estructuras-organicas";
import type { ColorOrganico, PuntoMezcla } from "../organico";
import type { PatronColumna } from "../columnas";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesMono } from "../figuras";
import type { Extremidad, PropiedadesFigura } from "../figuras-tubito";
import type { PropiedadesRizo, TubitoRizo } from "../rizos";
import type { InteriorBurbuja, RellenoBurbuja } from "../burbujas";
import { metalizadoDeTienda, type OpcionesMetalizado } from "../metalizados";
import { impresoPorId, type ImpresoEnPieza } from "../impresos-catalogo";
import { letrero } from "../utileria";
import type { OpcionesForma } from "../formas";
import type { Vec3 } from "../modulos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 19** (los números de `clasif/lote-19.json`): once columnas que
 * antes quedaban «a medias» (#375 el señor de bigotes, #381 la princesa, #382 feliz cumpleaños, #385 huellita, #390
 * mariposa, #396 neón, #397 niño, #401 papá superhéroe, #403 rellena, #407 te amo, #411 Toy Story) y cuatro corazones
 * (#423 de Reflex Plata, #426 en malla roja, #427 entrelazado de tubitos y #428 «Feliz Día» orgánico), todas como escena
 * con su sala.
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, recortada y ampliada con rejilla,
 * y su perfil fila a fila (dónde empieza y termina lo que no es fondo, con su color):
 * - **Escala**: la de un globo de tamaño conocido en la misma foto (R-5 ≈ 12 cm, R-12 ≈ 25–28 cm, el metalizado de 16" o
 *   18", el R-24 ≈ 55 cm) y con ella alturas, anchos, tamaños y posiciones (px → cm con `px(x, y)`, dicho en cada idea).
 *   El cuarteto del taller va más apretado que el de las fotos (de frente mide 1,6 diámetros con dos globos al frente y
 *   1,9 con tres): el tamaño de cada globo se toma del globo, no del ancho de la columna, y la nota lo dice.
 * - **Conteo**: niveles, cuartetos por nivel, globos de helio, rizos, flores, huesos y racimos contados uno a uno. Ninguna
 *   idea del lote publica «Materiales» con cantidades: todo lo contado va con `contada: true`. En lo orgánico (#428) el
 *   motor da los globos del grosor y el largo medidos (no se cuentan uno a uno: la nota lo dice).
 * - **Niveles**: en las fotos los cuartetos van casi siempre más juntos que el paso del taller (0,8 diámetros). Para
 *   respetar los niveles contados Y la medida real, cada nivel es su propia columna de un nivel puesta a la altura medida,
 *   con el giro que muestra la foto (0° = dos globos al frente, 45° = tres) —como en los lotes 05 y 15—. Cuando la foto va
 *   al paso del taller (el eje aguamarina de #401), es una sola columna.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice). Si
 *   no, se midió en la foto (Python/PIL: mediana de un parche sin brillos, ΔE76 en Lab contra `hexGlobo` de la tabla
 *   oficial) y se tomó el código más cercano que se fabrica en ese formato; si un Fashion queda a ≤ 6 ΔE del más
 *   cercano, el Fashion. Las fotos viejas (740 × 570) vienen sobresaturadas: se dice cuando pesa.
 * - **Impresos y metalizados**: el de la tienda (`impresos-catalogo.ts`, `metalizados.ts`) cuando es el de la foto; si la
 *   tienda no lo trae, el más parecido del catálogo (y la nota lo dice) o, si no hay ninguno que se le parezca, uno
 *   genérico sin producto (la corona de la princesa, la caja de regalo, la carita sonriente) o el liso.
 * - **Montaje**: cada estructura de globos es el nodo raíz (suelto, en su sitio) y lo suyo cuelga de ella por un
 *   **amarre** invisible (una escenografía sin elementos: no se dibuja nada) puesto en el piso lejos de sus globos: lo que
 *   cuelga del amarre queda exactamente donde lo pone la foto, sin que el contacto con los globos lo corra. Así la
 *   biblioteca saca «esta estructura con sus decoraciones». El corazón en malla (#426) no lleva nada colgado.
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
const grados = (r: number) => (r * 180) / Math.PI;
const ARRIBA = v(0, 1, 0);
const AL_FRENTE = v(0, 0, 1);
const ORIGEN = v(0, 0, 0);
/** Una dirección en el plano de la foto (x, y) con un poco de frente. */
const enPlano = (x: number, y: number, z = 0): Vec3 => unitario(v(x, y, z));
/** Con la normal arriba y girada 90° (como el amarre), una pieza colgada queda con el espacio del mundo y z al revés. */
const zAlReves = (p: Vec3): Vec3 => v(p.x, p.y, -p.z);
/** De píxeles de la foto a cm del mundo: x desde el eje `x0`, y desde el piso `y0`, a `k` px/cm. */
const escala = (x0: number, y0: number, k: number) => (x: number, y: number, z = 0): Vec3 => v(r2((x - x0) / k), r2((y0 - y) / k), z);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const T = (formatoId: string, grosorCm: number, codigo: string): TubitoRizo => ({ formatoId, grosorCm, codigo });
const libre = (xCm: number, yCm: number, zCm: number): Colocacion => ({ en: "libre", xCm: r2(xCm), yCm: r2(yCm), zCm: r2(zCm), giroGrados: 0 });
const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos?: Partial<Sala["tonos"]>): Sala =>
  ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm, tonos: { ...SALA_INICIAL.tonos, ...tonos } });

/**
 * El marco de una pieza puesta `sobre` con la normal `n` (en el mundo): su +y local mira hacia la normal, su x local
 * queda horizontal (o a lo largo de x si la normal es vertical) y `giroGrados` la gira sobre la normal (el marco de
 * `escena.ts`). Devuelve cómo pasa un vector local al mundo.
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

// ----------------------------------------------------------------------------------------------------------
// Piezas
// ----------------------------------------------------------------------------------------------------------

/** Un globo suelto (el centro de su cuerpo en el origen, el cuerpo hacia +y); con `impresoId`, con su impreso. */
const globo = (g: ParteGlobo, impresoId?: string): Pieza =>
  ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, globos: [0] }] } : {}) });
/** Un nivel de cuarteto: una columna de un nivel (su origen es el centro del cuarteto). */
const cuarteto = (g: ParteGlobo, colores: string[], patron: PatronColumna = "un_color", impresos?: ImpresoEnPieza[]): Pieza =>
  ({ tipo: "columna", formatoId: g.formatoId, infladoCm: g.infladoCm, alturaCm: r2(g.infladoCm * 0.8), patron, colores, ...(impresos?.length ? { impresos } : {}) });
/** Lo más bajo de un cuarteto bajo su centro: un nivel apoyado en el piso no puede ir más bajo. */
const bajoCuarteto = (g: ParteGlobo) => -armarPieza(cuarteto(g, [g.codigo])).caja.min.y;
const deco = (decoracion: Decoracion): Pieza => ({ tipo: "decoracion", decoracion });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
/** Un anillo de `cantidad` globos iguales alrededor de un centro (racimo de 4 R-5, pareja de R-5). */
const anillo = (g: ParteGlobo, cantidad: number, aperturaGrados = 0, giroGrados = 0): Decoracion =>
  flor({ petalos: { ...g, cantidad, aperturaGrados, giroGrados }, centro: null });
const burbujasTubito = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const florTubito = (petalos: AnilloTubito, centro: ParteGlobo | null = null): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { petalos, interior: null, corona: null, centro } });
const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });
const mono = (p: PropiedadesMono): Decoracion => ({ tipo: "mono", propiedades: p });
const figura = (p: Partial<PropiedadesFigura> & { queEs: string }): Decoracion => ({
  tipo: "figura",
  propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null, accesorios: [], ...p },
});
const burbuja = (exterior: ParteGlobo, interiores: InteriorBurbuja[], relleno: RellenoBurbuja | null, semilla: number): Decoracion =>
  ({ tipo: "burbuja", propiedades: { exterior, interiores, relleno, semilla } });
const metalizado = (m: OpcionesMetalizado): Pieza => ({ tipo: "metalizado", metalizado: m });
/** Un tirabuzón de tubito que sale de frente (eje +y de la decoración, que se lleva a la normal con que se cuelga). */
const tirabuzon = (t: TubitoRizo, vueltas: number, r0: number, r1: number, largoCm: number, giroGrados = 0): Pieza =>
  deco(rizo({ forma: "tirabuzon", tubito: t, vueltas, radioInicialCm: r0, radioFinalCm: r1, largoCm, eje: "frente", giroGrados }));
/**
 * Una hilera vertical de globitos que miran al frente (los R-5 apilados dentro del tubo transparente de #382 y #403):
 * una silueta de 0,6 globos de ancho y `altoCm` de alto rellena por celdas (solo cabe una fila), a franjas del alto de un
 * globo (de abajo arriba, un color por globo). Con `altoCm` = 5 × el paso que se quiere más medio globo, el relleno pone
 * `codigos.length` globos; su primer centro queda ~0,25 globos sobre el origen.
 */
const hilera = (g: ParteGlobo, codigos: string[], altoCm: number): Pieza => {
  const alto = r2(altoCm), pasoCm = alto / codigos.length;
  const ancho = r2(g.infladoCm * 0.6);
  const forma: OpcionesForma = {
    clase: "rellena", contorno: { tipo: "libre", puntos: [{ x: -ancho / 2, y: 0 }, { x: ancho / 2, y: 0 }, { x: ancho / 2, y: alto }, { x: -ancho / 2, y: alto }] },
    tecnica: { tipo: "celdas", formatoId: g.formatoId, infladoCm: g.infladoCm, celda: "cuadrada" }, colores: { codigos, patron: "franjas", franjaCm: pasoCm },
  };
  return { tipo: "forma", forma };
};

// Orgánico.
const colorOrg = (codigo: string, peso: number, formatos?: string[]): ColorOrganico => ({ codigo, peso, ...(formatos ? { formatos } : {}) });
const constante = (pesos: Readonly<Record<string, number>>): PuntoMezcla[] => [{ t: 0, pesos }, { t: 1, pesos }];
/** Racimos orgánicos (tramos de guirnalda) con sus inflados, su mezcla y un color. */
function racimos(o: { puntos: Vec3[]; radio: number; mezcla: Readonly<Record<string, number>>; codigo: string; semilla: number; inflados: Readonly<Record<string, number>> }): Pieza {
  const libres: RacimoLibre[] = [{ id: "racimo_1", nombre: "Racimo 1", puntos: o.puntos.map(redondo), radioInicioCm: o.radio, radioFinCm: o.radio, mezcla: constante(o.mezcla), tapas: { inicio: true, fin: true } }];
  const opciones = opcionesRacimosLibres({ racimos: libres, colores: [colorOrg(o.codigo, 1)], semilla: o.semilla, suelo: false, relleno: [] });
  return { tipo: "organico", opciones: { ...opciones, inflados: { ...o.inflados } }, flores: null };
}

// ----------------------------------------------------------------------------------------------------------
// Montaje: la raíz suelta, su amarre invisible y lo que cuelga de él
// ----------------------------------------------------------------------------------------------------------

type Montaje = {
  nodos: NodoEscena[];
  /** Una pieza con su origen en `origen` (mundo), su +y local hacia `normal` (mundo) y girada `giroGrados` sobre ella. */
  pieza: (id: string, nombre: string, pieza: Pieza, origen: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Lo mismo con el centro de su caja en `centro` (mundo). */
  centrada: (id: string, nombre: string, pieza: Pieza, centro: Vec3, normal?: Vec3, giroGrados?: number) => void;
  /** Un globo con el centro de su cuerpo en `centro` y el cuerpo hacia `direccion`. */
  globo: (id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion?: Vec3, impresoId?: string) => void;
  /** Un eslabón (Link-O-Loon) de nudo a nudo: su nudo en `desde`, hacia `hasta`. */
  eslabon: (id: string, nombre: string, g: ParteGlobo, desde: Vec3, hasta: Vec3) => void;
  /** Un nivel de cuarteto con su centro en `centro`, su eje hacia `eje` y girado `giroGrados` sobre él. */
  nivel: (id: string, nombre: string, g: ParteGlobo, colores: string[], centro: Vec3, giroGrados?: number, patron?: PatronColumna, impresos?: ImpresoEnPieza[]) => void;
  /** Un metalizado de frente (su cara hacia quien mira) con el centro de su caja en `centro`, inclinado `inclinacion` grados. */
  metalizado: (id: string, nombre: string, m: OpcionesMetalizado, centro: Vec3, inclinacionGrados?: number) => void;
  /**
   * Una burbuja recta de tubito de `desde` a `hasta` (en el plano de la foto: el corbatín, un tallo, un hueso), hecha
   * con las burbujas en cadena de `rizos.ts` (`largos` de torcedura a torcedura, en ciclo).
   */
  recta: (id: string, nombre: string, t: TubitoRizo, largos: number[], desde: Vec3, hasta: Vec3) => void;
};

/**
 * La raíz va suelta en `raiz.en` (mundo), girada `raiz.giroGrados` sobre la vertical (0 si no se pide). El amarre va
 * `sobre` ella en `amarreEn` (mundo, en el piso y lejos de sus globos: debajo y encima no puede tener ninguno), con la
 * normal arriba y girado 90° (comprobado: también con la raíz girada): su espacio queda como el del mundo con z al revés.
 * Es una escenografía sin elementos: no se dibuja (ni disco ni nada que se vea). Lo demás cuelga del amarre.
 */
function montaje(raiz: { id: string; nombre: string; pieza: Pieza; en: Vec3; giroGrados?: number }, amarreEn: Vec3): Montaje {
  const amarreId = `${raiz.id}-amarre`;
  const g = raiz.giroGrados ?? 0;
  // El punto del amarre, del mundo al espacio de la raíz: deshacer su giro sobre y (con 90°, el frente +z pasa a +x). El
  // marco de lo puesto `sobre` (con la normal arriba) no hereda el giro de la raíz: el amarre va siempre a 90°.
  const d = mas(menos(amarreEn, raiz.en), v(0, HUNDIMIENTO_SOBRE_CM, 0));
  const c = Math.cos(rad(g)), s = Math.sin(rad(g));
  const nodos: NodoEscena[] = [
    { id: raiz.id, nombre: raiz.nombre, pieza: raiz.pieza, colocacion: { en: "libre", xCm: r2(raiz.en.x), yCm: r2(raiz.en.y), zCm: r2(raiz.en.z), giroGrados: g } },
    {
      id: amarreId, nombre: `Amarre de ${raiz.nombre.charAt(0).toLowerCase()}${raiz.nombre.slice(1)} (no se ve)`,
      pieza: { tipo: "escenografia", elementos: [] },
      colocacion: { en: "sobre", padreId: raiz.id, puntoCm: redondo(v(d.x * c - d.z * s, d.y, d.x * s + d.z * c)), normal: ARRIBA, giroGrados: 90 },
    },
  ];
  const aAmarre = (p: Vec3): Vec3 => v(p.x - amarreEn.x, p.y - amarreEn.y, -(p.z - amarreEn.z));
  const dirAAmarre = (d: Vec3): Vec3 => v(d.x, d.y, -d.z);
  const pieza = (id: string, nombre: string, p: Pieza, origen: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const n = unitario(normal);
    const punto = mas(origen, por(n, armarPieza(p.tipo === "decoracion" ? { tipo: "decoracion", decoracion: p.decoracion } : p).caja.min.y + HUNDIMIENTO_SOBRE_CM));
    nodos.push({ id, nombre, pieza: p, colocacion: { en: "sobre", padreId: amarreId, puntoCm: redondo(aAmarre(punto)), normal: redondo(dirAAmarre(n)), giroGrados: r2(giroGrados) } });
  };
  const centrada = (id: string, nombre: string, p: Pieza, centro: Vec3, normal: Vec3 = ARRIBA, giroGrados = 0) => {
    const c = armarPieza(p).caja;
    const medio = por(mas(c.min, c.max), 0.5);
    pieza(id, nombre, p, menos(centro, marcoNormal(normal, giroGrados)(medio)), normal, giroGrados);
  };
  return {
    nodos, pieza, centrada,
    globo: (id, nombre, g, centro, direccion = ARRIBA, impresoId) => pieza(id, nombre, globo(g, impresoId), centro, direccion),
    // La pieza `globo` pone el nudo a un medio cuerpo de redondo bajo su origen.
    eslabon: (id, nombre, g, desde, hasta) => { const d = unitario(menos(hasta, desde)); pieza(id, nombre, globo(g), mas(desde, por(d, centroCuerpo("redondo", g.infladoCm))), d); },
    nivel: (id, nombre, g, colores, centro, giroGrados = 0, patron = "un_color", impresos) => pieza(id, nombre, cuarteto(g, colores, patron, impresos), centro, ARRIBA, giroGrados),
    // Con la normal arriba y girado −90°, el frente del metalizado (+z) mira a quien mira y su arriba queda arriba.
    metalizado: (id, nombre, m, centro, inclinacionGrados = 0) => centrada(id, nombre, metalizado(m), centro, v(-Math.sin(rad(inclinacionGrados)), Math.cos(rad(inclinacionGrados)), 0), -90),
    // La cadena de burbujas cuelga hacia −z de la decoración (abajo con la normal al frente): girarla sobre la normal
    // la lleva a la dirección de la foto.
    recta: (id, nombre, t, largos, desde, hasta) => {
      const d = menos(hasta, desde);
      const cantidad = Math.max(1, Math.round(largo(d) / (largos.reduce((s, l) => s + l, 0) / largos.length)));
      pieza(id, nombre, deco(rizo({ forma: "burbujas", formatoId: t.formatoId, grosorCm: t.grosorCm, codigos: [t.codigo], largosCm: largos, recorrido: "recta", cantidad })), desde, AL_FRENTE, r2(grados(Math.atan2(d.x, -d.y))));
    },
  };
}

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** Un producto que la idea publica (nombre, url y código tal cual; el formato, el del mapeo). */
type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };
const P = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos), con la cantidad contada. */
function liso(formatoId: string, codigo: string, cantidad: number): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const p = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const x = productoDeGlobo(formatoId, codigo); return { nombre: x.nombre, url: quitarOrigen(x.url) }; })();
  return { nombre: p.nombre, url: p.url, formato: formatoId, codigo, cantidad, contada: true };
}

const clave = (formatoId: string, codigo: string) => `${formatoId}|${codigo}`;

/**
 * Los productos de lo armado (que es lo contado en la foto): los metalizados de la tienda por las veces que quedaron
 * puestos; la utilería de la tienda (el cartel de #428) por sus paquetes; los impresos de la tienda por producto y por
 * látex (cada pedido de cada pieza, armado solo, dice qué globos toma); y los lisos del resto por formato y código. Lo
 * que la idea publica sale con su nombre y url tal cual (un liso publicado se reconoce por el tipo de globo y el
 * código); si la foto no lo tiene, sin cantidad.
 */
function productosDe(escena: Escena, publicados: readonly Publicado[]): ProductoDeIdea[] {
  const armada = armarEscena(escena);
  const salida: ProductoDeIdea[] = [];
  const usados = new Set<Publicado>();
  const tienda = new Map<string, { nombre: string; url: string; cantidad: number }>();
  const impresos = new Map<string, Map<string, number>>();
  for (const nodo of escena.nodos) {
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    if (copias === 0) continue;
    const deTienda = nodo.pieza.tipo === "metalizado" && nodo.pieza.metalizado.producto
      ? [{ ...nodo.pieza.metalizado.producto, cantidad: 1 }]
      : nodo.pieza.tipo === "escenografia" ? (nodo.pieza.productos ?? []).filter((p) => !p.generico) : [];
    for (const m of deTienda) {
      const previo = tienda.get(m.url) ?? { nombre: m.nombre, url: m.url, cantidad: 0 };
      previo.cantidad += m.cantidad * copias;
      tienda.set(m.url, previo);
    }
    for (const pedido of nodo.pieza.impresos ?? []) {
      const sola = armarPieza({ ...nodo.pieza, impresos: [pedido] });
      const porLatex = impresos.get(pedido.impresoId) ?? new Map<string, number>();
      for (const g of sola.globos.filter((x) => x.estampado?.impreso)) porLatex.set(clave(g.formatoId, g.codigo), (porLatex.get(clave(g.formatoId, g.codigo)) ?? 0) + copias);
      impresos.set(pedido.impresoId, porLatex);
    }
  }
  for (const m of tienda.values()) {
    const p = publicados.find((x) => x.url === m.url);
    if (p) usados.add(p);
    salida.push({ nombre: p?.nombre ?? m.nombre, url: m.url, formato: null, codigo: null, cantidad: m.cantidad, contada: true });
  }
  const impresosPorClave = new Map<string, number>();
  for (const [impresoId, porLatex] of impresos) {
    const i = impresoPorId(impresoId)!;
    const p = publicados.find((x) => x.url === i.url);
    if (p) usados.add(p);
    for (const [k, n] of porLatex) {
      const [f, c] = k.split("|") as [string, string];
      salida.push({ nombre: p?.nombre ?? i.nombre, url: i.url, formato: f, codigo: c, cantidad: n, contada: true });
      impresosPorClave.set(k, (impresosPorClave.get(k) ?? 0) + n);
    }
  }
  for (const m of sumarMateriales(armada.materiales)) {
    const cantidad = Math.ceil(m.cantidad - 1e-9) - (impresosPorClave.get(clave(m.formatoId, m.codigo)) ?? 0);
    if (cantidad <= 0) continue;
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const p = publicados.find((x) => x.formato !== null && x.codigo === m.codigo && formatoPorId(x.formato)?.tipo === tipo);
    if (p) { usados.add(p); salida.push({ nombre: p.nombre, url: p.url, formato: m.formatoId, codigo: m.codigo, cantidad, contada: true }); }
    else salida.push(liso(m.formatoId, m.codigo, cantidad));
  }
  for (const p of publicados) if (!usados.has(p)) salida.push({ ...p, cantidad: null });
  return salida;
}

function fuente(slug: string): FuenteIdea {
  const f = fuenteIdea(slug);
  if (!f) throw new Error(`La idea «${slug}» no está en las fuentes.`);
  return f;
}

/**
 * La idea con su número y foto de su fuente; sus ocasiones (de sus etiquetas, con `ocasionesDeEtiquetas`, que vive en
 * `index.ts`, que importa este lote: se calculan al leerlas) y sus productos (salen de armar la escena) se calculan la
 * primera vez que se piden.
 */
function idea(slug: string, nombre: string, escena: () => Escena, nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  // Perezosa (ver «Patrón perezoso» en tipos.ts): la escena se arma la primera vez que se pide.
  return ideaPerezosa({
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, clase: "escena", nota,
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
  }, () => ({ tipo: "escena", escena: escena() }), () => productosDe(escena(), publicados));
}

// Impresos de la tienda que usa el lote (ids de `impresos-catalogo.ts`).
const FIESTA_BIGOTES = "infinity-feliz-dia-fiesta-bigotes-fashion-surtido";
const POLKA_ROJO = "infinity-polka-blanco-fashion-rojo";
const TERRAZO_AZUL = "infinity-feliz-cumpleanos-terrazo-azul-fashion";
const GRAFFITI_NEGRO = "infinity-metalink-plata-graffiti-fashion-negro";

/** Que un impreso del lote esté en el catálogo (si no, el error sale al cargar, no en la tienda). */
for (const id of [FIESTA_BIGOTES, POLKA_ROJO, TERRAZO_AZUL, GRAFFITI_NEGRO]) if (!impresoPorId(id)) throw new Error(`Impreso desconocido: ${id}`);

// ----------------------------------------------------------------------------------------------------------
// 375 · Columna Feliz Día Fiesta Bigotes (el señor de sombrero)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000 (PNG recortado): el piso en y = 975 px, el eje en x = 510 px. La cabeza es el R-12 impreso de la
 * tienda, de 166 px de ancho: lleno (30 cm), da 5,53 px/cm. De abajo arriba: 1 nivel negro (centro a 900 px: 13,6 cm;
 * globos de ~125 px: 22,5 cm), 3 cafés (790, 690 y 590 px: 33,5, 51,5 y 69,6 cm; ~120 px: 21,7 cm) y 2 azul rey (485 y
 * 375 px: 88,6 y 108,5 cm): todos con dos globos al frente (giro 0°), a 18–20 cm por nivel (0,85–0,9 diámetros: más
 * separados que el paso del taller). El cuello: moño de T-260 arena (126 px: 23 cm de ancho, a 302 px) y el corbatín,
 * una burbuja de 13 cm que baja por el frente del azul. La cabeza a 205 px (139 cm). El sombrero: ala de T-260 negro en
 * aro (126 px: 21 cm) a 112 px y copa de R-12 negro a medio inflar (~16 cm) a 76 px: ~1,70 m en total. Colores: los
 * publicados (Fashion Negro 080, Fashion Café 074, Fashion Azul Rey 041, tubito Fashion Arena 071); la cabeza mide
 * #b99521 → Fashion Mostaza 023, pero el surtido del impreso (`impresos-catalogo.ts`) es Azul Rey, Amarillo, Café y
 * Azul: va el Amarillo 020 (el único dorado del surtido).
 */
const escena375 = perezoso((): Escena => {
  const px = escala(510, 975, 5.53);
  const NEGRO = R("R-12", 22.5, "080"), CAFE = R("R-12", 21.7, "074"), AZUL = R("R-12", 21.7, "041");
  const m = montaje({ id: "base", nombre: "Cuarteto R-12 Fashion Negro de la base", pieza: cuarteto(NEGRO, ["080"]), en: v(0, Math.max(px(0, 900).y, bajoCuarteto(NEGRO)), 0) }, v(0, 0, -45));
  [790, 690, 590].forEach((y, k) => m.nivel(`cafe-${k + 1}`, `Cuarteto R-12 Fashion Café (pantalón, nivel ${k + 1})`, CAFE, ["074"], v(0, px(0, y).y, 0)));
  [485, 375].forEach((y, k) => m.nivel(`azul-${k + 1}`, `Cuarteto R-12 Fashion Azul Rey (camisa, nivel ${k + 1})`, AZUL, ["041"], v(0, px(0, y).y, 0)));
  m.centrada("mono", "Moño de T-260 Fashion Arena (cuello)", deco(mono({ formatoId: "T-260", grosorCm: 4, codigo: "071", lazosPorLado: 1, largoLazoCm: 10.5, anchoLazoCm: 5.5, aberturaGrados: 0, colas: false, largoColaCm: 0, centro: null })), px(512, 302, 11), AL_FRENTE);
  m.recta("corbatin", "Corbatín: burbuja de T-260 Fashion Arena", T("T-260", 4.5, "071"), [13], px(512, 318, 20), px(512, 392, 20));
  m.globo("cabeza", "Cabeza: R-12 Feliz Día Fiesta Bigotes (amarillo)", R("R-12", 30, "020"), px(515, 205), ARRIBA, FIESTA_BIGOTES);
  m.centrada("sombrero-ala", "Ala del sombrero: aro de T-260 Fashion Negro", deco(figura({ queEs: "a black twisted-balloon hat brim", accesorios: [{ en: "base", forma: { tipo: "aro", tubito: { formatoId: "T-260", grosorCm: 4.5, codigo: "080" }, radioCm: 10.5, plano: "horizontal", desdeGrados: 0, hastaGrados: 360 } }] })), px(518, 112), AL_FRENTE);
  m.globo("sombrero-copa", "Copa del sombrero: R-12 Fashion Negro a medio inflar", R("R-12", 16, "080"), px(518, 76), ARRIBA);
  return { sala: sala(240, 220, 220), nodos: m.nodos };
});
const idea375 = idea("columna-feliz-dia-fiesta-bigotes", "Columna Feliz Día Fiesta Bigotes", escena375,
  "Igual: el señor de ~1,70 m: base de 1 cuarteto negro, pantalón de 3 cuartetos café y camisa de 2 azul rey (R-12 de ~22 cm, dos globos al frente en cada nivel, a la altura medida: 18–20 cm por nivel), cuello de moño y corbatín de T-260 arena, cabeza de R-12 «Feliz Día Fiesta Bigotes» de la tienda (lleno, 30 cm) y sombrero de copa negra (R-12 a medio inflar) con ala de T-260 negro en aro, con los productos que publica la idea. Distinto: la cabeza de la foto es mostaza (023) y el surtido del impreso en el catálogo no lo trae: va en Amarillo 020; el ala del sombrero es un T-260 negro que la idea no publica; el cuarteto del taller va más apretado que el de la foto (la columna sale ~20 % más angosta: 36 cm contra 45 de la foto, con globos del mismo tamaño); los cuartetos de la foto se ven de lado sin girar entre niveles (aquí también, a 0°).",
  [
    P("GLOBO REDONDO INFINITY®FELIZ DIA FIESTA BIGOTES", "/products/globo-latex-redondo-infinity-feliz-dia-fiesta-bigotes-fashion-surtido", "R-12", null),
    P("GLOBO TUBITO FASHION ARENA", "/products/globo-para-fiesta-latex-tubito-fashion-arena", "T-260", "071"),
    P("GLOBO REDONDO FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-fashion-negro", "R-12", "080"),
    P("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074"),
    P("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 381 · Columna Happy Birthday Princess
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 540 px, el eje en x = 368 px. Los R-5 de los anillos miden ~25 px (12 cm: 2,1 px/cm) y
 * los eslabones rosados ~50 px de ancho (LOL-12 a ~24 cm), con 75 px de nudo a nudo (36 cm = 1,47 × 24: cuadra). De
 * abajo arriba: base de 4 R-12 morados de ~65 px (30 cm) echados, un anillo de 4 R-5 blancos (466 px: 35 cm), 3
 * eslabones rosados separados por anillos de 4 R-5 (morado a 398 px, blanco a 325, morado a 247: 67,6, 102,4 y 139,5
 * cm), el corazón metalizado rosado de 18" con letrero (95 px: 45 cm; centro a 198 px, 163 cm), una pareja de R-5
 * morados y uno blanco encima (147 px: 187 cm) y la corona metalizada «Happy Birthday Princess!» (170 × 130 px: 81 × 62
 * cm, centro a 95 px: 212 cm): ~2,4 m en total (no 1,4 m: la escala sale de los R-5 y de los eslabones). Colores medidos
 * (no publica productos): morado #5a308e → Fashion Violeta 051 (ΔE 3); rosado #f7a7bb → Satín Rosado 409 (ΔE 4); blanco
 * #f3e5ea → Satín Blanco 405 (perlado; Pastel Dusk Crema 107 queda a 6 pero no es blanco).
 */
const escena381 = perezoso((): Escena => {
  const px = escala(368, 540, 2.1);
  const BASE = R("R-12", 30, "051");
  const m = montaje({ id: "base", nombre: "Base de 4 R-12 Fashion Violeta", pieza: cuarteto(BASE, ["051"]), en: v(0, Math.max(19, bajoCuarteto(BASE)), 0) }, v(0, 0, -50));
  const JUNTAS: ReadonlyArray<readonly [number, string]> = [[466, "405"], [398, "051"], [325, "405"], [247, "051"]];
  JUNTAS.forEach(([y, codigo], k) => m.centrada(`anillo-${k + 1}`, `Anillo de 4 R-5 ${codigo === "051" ? "Fashion Violeta" : "Satín Blanco"} (${k + 1})`, deco(anillo(R("R-5", 11.5, codigo), 4, 15, 45)), px(368, y), ARRIBA));
  for (let k = 0; k < 3; k++) {
    const a = px(368, JUNTAS[k]![0]), b = px(368, JUNTAS[k + 1]![0]);
    m.eslabon(`eslabon-${k + 1}`, `Eslabón LOL-12 Satín Rosado ${k + 1}`, R("LOL-12", r2(largo(menos(b, a)) / 1.47), "409"), a, b);
  }
  m.metalizado("corazon", "Corazón metalizado rosado de 18\" (el «Happy Birthday Princess» de la foto no está en la tienda)", metalizadoDeTienda("corazon-lavanda"), px(368, 198, 0));
  m.globo("par-izquierda", "R-5 Fashion Violeta sobre el corazón (izquierda)", R("R-5", 11, "051"), px(356, 148), enPlano(-1, 0.4));
  m.globo("par-derecha", "R-5 Fashion Violeta sobre el corazón (derecha)", R("R-5", 11, "051"), px(380, 148), enPlano(1, 0.4));
  m.globo("par-centro", "R-5 Satín Blanco sobre el corazón", R("R-5", 10, "405"), px(368, 156, 5), enPlano(0, 0.5, 1));
  m.metalizado("corona", "Corona metalizada «Happy Birthday Princess!» (genérica: nube fucsia con letrero)", { forma: { tipo: "nube" }, pulgadas: 26, color: "fucsia", impreso: { dibujo: "texto", texto: "Happy Birthday\nPrincess!", hex: "#ffffff" } }, px(368, 95, -2));
  return { sala: sala(240, 220, 280), nodos: m.nodos };
});
const idea381 = idea("columna-happy-birthday-princess", "Columna Happy Birthday Princess", escena381,
  "Igual: columna de ~2,4 m: base de 4 R-12 violeta, 3 eslabones Link-O-Loon 12 Satín Rosado de nudo a nudo con anillos de 4 R-5 en cada unión (blanco, violeta, blanco, violeta), el corazón metalizado rosado de 18\" de la tienda, una pareja de R-5 violeta con uno blanco encima y la corona arriba. Distinto: la idea no publica productos (colores medidos); la corona «Happy Birthday Princess!» y el corazón con letrero y borde blanco no están en la tienda: el corazón es el CORAZON ROSADO liso y la corona un metalizado genérico (sin producto) en forma de nube fucsia con el letrero, la silueta más parecida (ancha, con lóbulos arriba) —la de la foto tiene puntas y un corazón de joya—; la base de la foto va echada en el piso (aquí un cuarteto); la escala (R-5 y eslabones) da 2,4 m, más de lo que aparenta la foto.");

// ----------------------------------------------------------------------------------------------------------
// 382 · Columna Happy Birthday
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 552 px, el eje en x = 375 px. Los R-5 del tubo miden ~36 px (12 cm: 3 px/cm) y los R-12
 * de la base ~75 px (25 cm). De abajo arriba: base de 4 R-12 morados con lunares verde lima (centro a 510 px: 14 cm), un
 * anillo de 4 R-5 verde lima (460 px: 30,7 cm), el tubo transparente con 6 R-5 apilados uno sobre otro (amarillo a 440
 * px, rosado 412, azul caribe 384, naranja 355, lila 322 y azul 288: de 37 a 88 cm, ~10 cm por globo), otro anillo de 4
 * R-5 verde lima arriba (245 px: 102 cm) con dos rizos de T-260 morado a los lados (tres vueltas, ~18 cm) y el
 * metalizado «Happy Birthday» de caja de regalo con estallido amarillo (166 × 190 px: 55 × 63 cm; centro a 120 px: 144
 * cm): ~1,75 m. Colores medidos (no publica productos): morado #4e3992 → Fashion Violeta 051 (ΔE 6); verde #65bf4a →
 * Fashion Verde Lima 031 (ΔE 11; el de arriba #55bc36 da Verde Trébol 029 a 11 y Lima a 18: los dos anillos son el
 * mismo globo y van en Lima); amarillo #f5df11 → Fashion Amarillo 020; rosado #ff8fbd → Satín Fucsia 412; azul claro
 * #02c3e8 → Fashion Azul Caribe 038; naranja #fd7f17 → Fashion Naranja 061; lila #d3a3cf → Fashion Lila 050; azul
 * #266fb9 → Metal Azul 540.
 */
const escena382 = perezoso((): Escena => {
  const px = escala(375, 552, 3);
  const BASE = R("R-12", 25, "051");
  const m = montaje({ id: "base", nombre: "Cuarteto R-12 Fashion Violeta de la base", pieza: cuarteto(BASE, ["051"]), en: v(0, Math.max(14, bajoCuarteto(BASE)), 0) }, v(0, 0, -45));
  const VERDE = R("R-5", 11, "031");
  m.centrada("anillo-abajo", "Anillo de 4 R-5 Fashion Verde Lima (sobre la base)", deco(anillo(VERDE, 4, 15, 0)), px(375, 460), ARRIBA);
  m.pieza("tubo", "Seis R-5 apilados (los del tubo transparente)", hilera(R("R-5", 11.5, "020"), ["020", "412", "038", "061", "050", "540"], 58), v(0, 34.4, 0), ARRIBA, 90);
  m.centrada("anillo-arriba", "Anillo de 4 R-5 Fashion Verde Lima (arriba del tubo)", deco(anillo(VERDE, 4, 15, 0)), px(375, 245), ARRIBA);
  m.pieza("rizo-izquierda", "Rizo de T-260 Fashion Violeta (izquierda)", tirabuzon(T("T-260", 3.5, "051"), 3, 3.5, 4.5, 18), px(358, 250, 4), enPlano(-1, -0.35, 0.25));
  m.pieza("rizo-derecha", "Rizo de T-260 Fashion Violeta (derecha)", tirabuzon(T("T-260", 3.5, "051"), 3, 3.5, 4.5, 18, 180), px(392, 248, 4), enPlano(1, -0.45, 0.25));
  m.metalizado("regalo", "Metalizado «Happy Birthday» (genérico: estallido dorado con letrero)", { forma: { tipo: "estrella" }, pulgadas: 26, color: "oro", impreso: { dibujo: "texto", texto: "HAPPY\nBIRTHDAY!", hex: "#d42032" } }, px(375, 122, -2));
  return { sala: sala(240, 220, 220), nodos: m.nodos };
});
const idea382 = idea("columna-happy-birthday", "Columna Happy Birthday", escena382,
  "Igual: columna de ~1,75 m: base de 4 R-12 violeta, anillo de 4 R-5 verde lima, seis R-5 apilados de colores (amarillo, rosado, azul caribe, naranja, lila y azul, de abajo arriba), otro anillo verde lima con dos rizos de T-260 violeta a los lados y el metalizado de cumpleaños arriba. Distinto: la idea no publica productos (colores medidos); el tubo transparente que encierra los R-5 no es un globo Sempertex (el Link-O-Loon 660 no se fabrica en Cristal): los R-5 van apilados en su sitio sin el tubo; los lunares verde lima de la base no son un impreso de la tienda y el cuarteto no los dibuja: la base va lisa; el metalizado de la foto (estallido amarillo con letrero sobre una caja de regalo de lunares) no está en la tienda: va una estrella dorada genérica (sin producto) con «HAPPY BIRTHDAY!», sin la caja.");

// ----------------------------------------------------------------------------------------------------------
// 385 · Columna Huellita
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (PNG recortado): el piso en y = 573 px (bajo el borde: el primer nivel apoya), el eje en x = 367 px.
 * Cada globo de la columna mide ~87 px (R-12 a 25 cm: 3,5 px/cm). Seis niveles a ~62 px (17,7 cm: 0,7 diámetros, más
 * juntos que el paso del taller): de abajo arriba, impreso azul (525 px), azul liso (462), impreso azul rey (405), azul rey
 * liso (345), impreso rojo (282) y rojo liso (212): los impresos con dos globos al frente (0°) y los lisos con tres (45°).
 * Encima el R-24 azul con «Feliz cumpleaños» y una huella (180 px: 55 cm; centro a 99 px: 135 cm): ~1,63 m. Tres huesos
 * de T-260 blanco (~70 px: 20 cm): dos sobre el rojo liso (uno de 352,205 a 405,180 px y otro a la derecha, de 430,188 a
 * 465,225, metido detrás) y uno sobre el azul rey liso (de 345,350 a 405,320). Colores: los publicados (Fashion Rojo 015,
 * Fashion Azul Rey 041, Fashion Azul 040, tubito Fashion Blanco 005). Los impresos de huellas y huesos no están en la
 * tienda: van los más parecidos del catálogo, motivos blancos por todo el globo: el rojo, «Polka Blanco Fashion Rojo»
 * (lunares blancos sobre Rojo 015); el azul rey, «Terrazo Azul» (salpicado blanco y celeste, su surtido trae el Azul Rey
 * 041); el azul, también «Terrazo Azul», que no trae el Azul 040: va en su azul más claro, Azul Hortensia 042.
 */
const escena385 = perezoso((): Escena => {
  const px = escala(367, 573, 3.5);
  const G = (codigo: string) => R("R-12", 25, codigo);
  const NIVELES: ReadonlyArray<readonly [number, string, number, string | null, string]> = [
    [525, "042", 0, TERRAZO_AZUL, "impreso Terrazo Azul (Azul Hortensia)"], [462, "040", 45, null, "Fashion Azul liso"],
    [405, "041", 0, TERRAZO_AZUL, "impreso Terrazo Azul (Azul Rey)"], [345, "041", 45, null, "Fashion Azul Rey liso"],
    [282, "015", 0, POLKA_ROJO, "impreso Polka Blanco Rojo"], [212, "015", 45, null, "Fashion Rojo liso"],
  ];
  const [y0, c0, , i0, n0] = NIVELES[0]!;
  const m = montaje({ id: "nivel-1", nombre: `Cuarteto R-12 ${n0} (nivel 1)`, pieza: cuarteto(G(c0), [c0], "un_color", i0 ? [{ impresoId: i0, codigo: c0 }] : undefined), en: v(0, Math.max(px(0, y0).y, bajoCuarteto(G(c0))), 0) }, v(0, 0, -45));
  NIVELES.slice(1).forEach(([y, codigo, giro, impreso, nombre], k) => m.nivel(`nivel-${k + 2}`, `Cuarteto R-12 ${nombre} (nivel ${k + 2})`, G(codigo), [codigo], v(0, px(0, y).y, 0), giro, "un_color", impreso ? [{ impresoId: impreso, codigo }] : undefined));
  m.globo("remate", "Remate: R-24 Fashion Azul («Feliz cumpleaños» con huella en la foto)", R("R-24", 55, "040"), px(367, 99), ARRIBA);
  const HUESO = T("T-260", 4, "005");
  m.recta("hueso-1", "Hueso de T-260 Fashion Blanco (sobre el rojo, al frente)", HUESO, [3, 3, 13, 3, 3], px(352, 205, 25), px(405, 180, 25));
  m.recta("hueso-2", "Hueso de T-260 Fashion Blanco (sobre el rojo, a la derecha)", HUESO, [3, 3, 13, 3, 3], px(430, 188, 14), px(465, 225, 10));
  m.recta("hueso-3", "Hueso de T-260 Fashion Blanco (sobre el azul rey)", HUESO, [3, 3, 13, 3, 3], px(345, 350, 25), px(405, 320, 25));
  return { sala: sala(240, 220, 220), nodos: m.nodos };
});
const idea385 = idea("columna-huellita", "Columna Huellita", escena385,
  "Igual: columna de ~1,63 m de 6 cuartetos R-12 por bandas (de abajo arriba: azul impreso, azul, azul rey impreso, azul rey, rojo impreso y rojo), los impresos con dos globos al frente y los lisos con tres, a la altura medida (17,7 cm por nivel, más juntos que el paso del taller); remate de R-24 azul y tres huesos de T-260 blanco, con los productos que publica la idea. Distinto: los impresos de huellas y huesos y el R-24 con «Feliz cumpleaños» y huella no están en la tienda: el rojo va con «Polka Blanco Fashion Rojo» (lunares blancos), el azul rey y el azul con «Terrazo Azul» (salpicado blanco), que no trae el Azul 040: la banda impresa de abajo queda en Azul Hortensia 042; el R-24 va liso; los huesos son una cadena de burbujas en línea (en la foto las puntas se abren en dos); el cuarteto del taller es más angosto que el de la foto.",
  [
    P("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041"),
    P("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"),
    P("GLOBO REDONDO FASHION AZUL", "/products/globo-para-fiesta-latex-redondo-fashion-azul", "R-12", "040"),
    P("GLOBO TUBITO FASHION BLANCO", "/products/globo-para-fiesta-latex-tubito-fashion-blanco", "T-260", "005"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 390 · Columna Mariposa
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 560 px, el eje en x = 360 px. Los globos de la columna miden ~70 px (R-12 a 27 cm: 2,6
 * px/cm) y los R-5 de la flor amarilla ~25 px (10 cm). La columna (de 555 a 260 px: 1,15 m) es una espiral de cuatro
 * colores: frambuesa, naranja, amarillo y azul cromado, que da la vuelta subiendo; seis niveles a ~47 px (18 cm: 0,67
 * diámetros), centros a 525, 478, 430, 385, 335 y 290 px. Encima dos tallos de T-260 verde lima (de 258 a 150 px y de 258
 * a 168 px, este hacia la derecha), la mariposa metalizada (centro a 85 px: 182 cm) y, a su derecha, una flor de 4 R-5
 * amarillos con centro verde (422,148 px); en el tallo, dos R-5 frambuesa. Cuatro flores de tubito de 5 pétalos (~60 px:
 * 23 cm): rosada a la izquierda (290,285 px), naranja al frente (350,350), amarilla con centro azul (425,435) y una
 * naranja chica a la derecha (462,440). ~2 m en total. Colores medidos (no publica productos): frambuesa #fc2f60 →
 * Fashion Frambuesa 014 (ΔE 11–12); naranja #fe6013 → Fashion Naranja 061; amarillo #fbbd01 → Fashion Amarillo Miel 021
 * (ΔE 7); azul cromado #0b84ac → Reflex Azul 940 (ΔE 11); verde de los tallos #ccdf84 → Fashion Verde Lima 031; los R-5
 * amarillos #feec08 → Fashion Amarillo 020 (ΔE 3); la flor rosada → Fashion Rosado 009.
 */
const escena390 = perezoso((): Escena => {
  const px = escala(360, 560, 2.6);
  const G = R("R-12", 27, "014");
  const COLORES = ["014", "061", "021", "940"];
  const NIVELES = [525, 478, 430, 385, 335, 290];
  const m = montaje({ id: "nivel-1", nombre: "Cuarteto R-12 en espiral de 4 colores (nivel 1)", pieza: cuarteto(G, COLORES, "espiral"), en: v(0, Math.max(px(0, 525).y, bajoCuarteto(G)), 0) }, v(0, 0, -50));
  NIVELES.slice(1).forEach((y, k) => m.nivel(`nivel-${k + 2}`, `Cuarteto R-12 en espiral de 4 colores (nivel ${k + 2})`, G, COLORES, v(0, px(0, y).y, 0), 45 * (k + 1), "espiral"));
  const TALLO = T("T-260", 4.5, "031");
  m.recta("tallo-1", "Tallo de T-260 Fashion Verde Lima (a la mariposa)", TALLO, [36], px(368, 258), px(372, 150));
  m.recta("tallo-2", "Tallo de T-260 Fashion Verde Lima (a la flor amarilla)", TALLO, [36], px(378, 258), px(412, 168));
  m.metalizado("mariposa", "Mariposa metalizada (va la flor metalizada rosada de la tienda)", metalizadoDeTienda("flor-rosada"), px(360, 85, -3), 8);
  m.centrada("racimo-amarillo", "Flor de 4 R-5 Fashion Amarillo con centro Verde Lima", deco(flor({ petalos: { ...R("R-5", 10, "020"), cantidad: 4, aperturaGrados: 10, giroGrados: 45 }, centro: { ...R("R-5", 7, "031"), cantidad: 1 } })), px(422, 148, 4), AL_FRENTE);
  m.globo("tallo-r5-1", "R-5 Fashion Frambuesa en el tallo (arriba)", R("R-5", 10, "014"), px(357, 203, 3), enPlano(-0.5, 0.5, 0.5));
  m.globo("tallo-r5-2", "R-5 Fashion Frambuesa en el tallo (abajo)", R("R-5", 10, "014"), px(352, 218, 3), enPlano(-0.6, -0.2, 0.6));
  const FLORES: ReadonlyArray<readonly [string, string, string, number, number, number, number]> = [
    ["rosada", "009", "031", 290, 285, 14, 9], ["naranja", "061", "031", 350, 350, 22, 9], ["amarilla", "020", "040", 425, 435, 18, 9], ["naranja-chica", "061", "031", 462, 440, 10, 6],
  ];
  for (const [id, petalo, centro, x, y, z, l] of FLORES)
    m.centrada(`flor-${id}`, `Flor de tubito de 5 pétalos (${id})`, deco(florTubito(burbujasTubito("T-260", 3.5, [petalo], 5, l, 0, 0), R("R-5", 6, centro))), px(x, y, z), AL_FRENTE);
  return { sala: sala(240, 220, 240), nodos: m.nodos };
});
const idea390 = idea("columna-mariposa", "Columna Mariposa", escena390,
  "Igual: columna espiral de ~1,15 m de 6 cuartetos R-12 en cuatro colores (frambuesa, naranja, amarillo miel y azul cromado) a la altura medida (18 cm por nivel), dos tallos de T-260 verde lima, la flor de 4 R-5 amarillos con centro verde, dos R-5 frambuesa en el tallo y cuatro flores de tubito de 5 pétalos (rosada, naranja, amarilla con centro azul y una naranja chica): ~2 m. Distinto: la idea no publica productos (colores medidos); la mariposa metalizada no está en la tienda: va la flor metalizada rosada de 27\" (la silueta de pétalos más parecida, ~el mismo tamaño); en la foto los globos de la columna son algo desparejos (más «orgánica») y aquí cuartetos iguales.");

// ----------------------------------------------------------------------------------------------------------
// 396 · Columna Neón
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 555 px, el eje en x = 372 px. Los R-12 negros miden ~72 px (24 cm: 3 px/cm), los R-9
 * de colores ~55 px (18 cm) y los R-5 de dentro del cristal ~30 px (10 cm). De abajo arriba: base de 4 R-12 negros con
 * salpicado de neón (520 px), encima un racimo de 4 R-9 (naranja, amarillo y dos fucsia, a 472 px: 27,7 cm) con un R-5
 * verde; el tallo: tres T-260 trenzados (negro, azul y fucsia) de 445 a 245 px (37 a 103 cm, una vuelta cada ~22 cm);
 * arriba otro racimo de 4 R-9 (fucsia, naranja y dos fucsia, a 212 px: 114 cm) con un R-5 verde, un cuarteto de R-12
 * negros con salpicado (168 px: 129 cm) y el globo cristal (140 px: 45 cm → R-18 de 44 cm; centro a 78 px: 159 cm) con
 * 10 R-5 dentro amontonados abajo (5 fucsia, 2 naranja, 3 amarillos): ~1,8 m. Colores medidos (no publica productos),
 * en la familia Neón porque es la columna neón y la foto vieja los lava: fucsia #ff6ea2 → Neón Fucsia 212 (ΔE 9);
 * naranja #ffa080 → Neón Naranja 261 (ΔE 16; Metal Dorado Rosa a 15); amarillo #dcd27a → Neón Amarillo 220 (ΔE 30: la
 * foto lo deja casi crema); verde #0bc174 → Neón Verde 230; los tubitos: negro → Fashion Negro 080, azul #0d77a7 → Neón
 * Azul 240 (ΔE 17), fucsia → Neón Fucsia 212. El impreso negro con salpicado de colores neón no está en la tienda: va el
 * más parecido, «Metalink Plata Graffiti Fashion Negro» (negro con garabatos plateados por todo el globo).
 */
const escena396 = perezoso((): Escena => {
  const px = escala(372, 555, 3);
  const NEGRO = R("R-12", 24, "080");
  const GRAFFITI: ImpresoEnPieza[] = [{ impresoId: GRAFFITI_NEGRO, codigo: "080" }];
  const m = montaje({ id: "base", nombre: "Cuarteto R-12 negro impreso Metalink Plata Graffiti (base)", pieza: cuarteto(NEGRO, ["080"], "un_color", GRAFFITI), en: v(0, Math.max(px(0, 520).y, bajoCuarteto(NEGRO)), 0) }, v(0, 0, -45));
  const R9 = (codigo: string) => R("R-9", 18, codigo);
  const NEON: Readonly<Record<string, string>> = { "212": "Neón Fucsia", "261": "Neón Naranja", "220": "Neón Amarillo" };
  /** Un racimo de 4 R-9 de colores (al frente izquierda, al frente derecha, atrás derecha y atrás izquierda). */
  const racimo = (id: string, donde: string, centro: Vec3, codigos: readonly string[]) => codigos.forEach((codigo, k) => {
    const a = rad(135 - 90 * k);
    const fuera = v(Math.cos(a), 0, Math.sin(a));
    m.globo(`${id}-${k + 1}`, `R-9 ${NEON[codigo]} del racimo ${donde} (${k + 1})`, R9(codigo), mas(centro, por(fuera, 9.5)), unitario(mas(fuera, v(0, 0.45, 0))));
  });
  racimo("racimo-abajo", "de abajo", px(372, 472), ["261", "220", "212", "212"]);
  m.globo("verde-abajo", "R-5 Neón Verde sobre el racimo de abajo", R("R-5", 10, "230"), px(350, 452, 6), enPlano(0, 1, 0.4));
  ([["080", 0], ["240", 120], ["212", 240]] as const).forEach(([codigo, giro], k) =>
    m.pieza(`tallo-${k + 1}`, `Tallo: T-260 ${codigo === "080" ? "Fashion Negro" : codigo === "240" ? "Neón Azul" : "Neón Fucsia"} trenzado`, deco(rizo({ forma: "resorte", tubito: T("T-260", 4, codigo), vueltas: 3, radioCm: 1.8, largoCm: 66, eje: "abajo", giroGrados: giro })), px(372, 245), AL_FRENTE));
  racimo("racimo-arriba", "de arriba", px(372, 212), ["261", "212", "212", "212"]);
  m.globo("verde-arriba", "R-5 Neón Verde bajo el remate", R("R-5", 10, "230"), px(350, 238, 8), enPlano(0, -0.3, 1));
  m.nivel("negros-arriba", "Cuarteto R-12 negro impreso Metalink Plata Graffiti (arriba)", NEGRO, ["080"], px(372, 168), 0, "un_color", GRAFFITI);
  m.pieza("cristal", "Globo cristal R-18 con 10 R-5 neón dentro", deco(burbuja(R("R-18", 44, "390"), [{ formatoId: "R-5", infladoCm: 10, codigos: ["212", "261", "220", "212", "220", "212", "261", "220", "212", "212"], cantidad: 10 }], null, 396)), px(372, 142), AL_FRENTE);
  return { sala: sala(240, 220, 220), nodos: m.nodos };
});
const idea396 = idea("columna-neon", "Columna Neón", escena396,
  "Igual: columna de ~1,8 m: base de 4 R-12 negros impresos, racimo de 4 R-9 neón con un R-5 verde, tallo de tres T-260 trenzados (negro, azul y fucsia), otro racimo neón con su R-5 verde, cuarteto de R-12 negros impresos y el globo cristal R-18 con 10 R-5 neón dentro (fucsia, naranja y amarillo) amontonados abajo. Distinto: la idea no publica productos (colores medidos, en la familia Neón); el impreso negro con salpicado de colores neón no está en la tienda: va el «Metalink Plata Graffiti Fashion Negro» (garabatos plateados); el tallo trenzado es de tres resortes iguales que se cruzan.");

// ----------------------------------------------------------------------------------------------------------
// 397 · Columna Niño
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 555 px, el eje en x = 370 px. El metalizado redondo de la carita (104 px) es de 18" (~43
 * cm de ancho inflado: 2,4 px/cm); los globos de la columna miden ~54 px (R-12 a 22,5 cm) y los perlados de las juntas
 * ~36 px (R-9 a 15 cm). Trece niveles contados de abajo arriba (tres globos al frente = 45°, dos = 0°): amarillo (525 px,
 * 3), amarillo (488, 2), perla (458, mitad escondido), azul (440, 3), azul (405, 2), azul (365, 3), perla (338), verde
 * (305, 3), verde (272, 2), perla (240), amarillo (207, 2), amarillo (160, 3), perla (122); a ~35 px (14,6 cm: 0,65
 * diámetros, mucho más juntos que el paso del taller). Encima la carita sonriente azul (centro a 63 px: 205 cm): ~2,25 m.
 * Colores medidos (no publica productos; son perlados): amarillo #fac37e → Metal Dorado 570 (ΔE 10–12); verde #afb38d →
 * Fashion Eucalipto 027 (ΔE 8); azul #a1b7cc → Satín Azul 440 (ΔE 12; Pastel Mate Azul 640 a 11, pero es perlado); perla
 * #dcd4c6 → Silk Perla Crema 873 (ΔE 2).
 */
const escena397 = perezoso((): Escena => {
  const px = escala(370, 555, 2.4);
  const G = (codigo: string) => R("R-12", 22.5, codigo);
  const PERLA = R("R-9", 15, "873");
  const NIVELES: ReadonlyArray<readonly [number, ParteGlobo, number, string]> = [
    [525, G("570"), 45, "Metal Dorado"], [488, G("570"), 0, "Metal Dorado"], [458, PERLA, 22.5, "perla"], [440, G("440"), 45, "Satín Azul"], [405, G("440"), 0, "Satín Azul"],
    [365, G("440"), 45, "Satín Azul"], [338, PERLA, 22.5, "perla"], [305, G("027"), 45, "Fashion Eucalipto"], [272, G("027"), 0, "Fashion Eucalipto"], [240, PERLA, 22.5, "perla"],
    [207, G("570"), 0, "Metal Dorado"], [160, G("570"), 45, "Metal Dorado"], [122, PERLA, 22.5, "perla"],
  ];
  const [y0, g0] = NIVELES[0]!;
  const nombreDe = (g: ParteGlobo, que: string) => (g.formatoId === "R-9" ? "Cuarteto R-9 Silk Perla Crema (junta)" : `Cuarteto R-12 ${que}`);
  const m = montaje({ id: "nivel-1", nombre: `${nombreDe(g0, NIVELES[0]![3])} (nivel 1)`, pieza: cuarteto(g0, [g0.codigo]), en: v(0, Math.max(px(0, y0).y, bajoCuarteto(g0)), 0) }, v(0, 0, -45));
  NIVELES.slice(1).forEach(([y, g, giro, que], k) => m.nivel(`nivel-${k + 2}`, `${nombreDe(g, que)} (nivel ${k + 2})`, g, [g.codigo], v(0, px(0, y).y, 0), giro));
  m.metalizado("carita", "Carita sonriente metalizada azul (genérica: redondo azul de 18\")", { forma: { tipo: "redondo" }, pulgadas: 18, color: "azul" }, px(370, 63, -2));
  return { sala: sala(240, 220, 260), nodos: m.nodos };
});
const idea397 = idea("columna-nino", "Columna Niño", escena397,
  "Igual: columna de ~2,25 m por bandas perladas: 2 cuartetos amarillos, 3 azules, 2 verdes y 2 amarillos (R-12 de 22,5 cm, tres o dos globos al frente como en la foto) separados por juntas de cuartetos R-9 perla, a la altura medida (14,6 cm por nivel, mucho más juntos que el paso del taller), y el metalizado redondo azul de 18\" arriba. Distinto: la idea no publica productos (colores medidos: el amarillo perlado queda en Metal Dorado 570, el verde en Eucalipto 027, el azul en Satín Azul 440 y la perla en Silk Perla Crema 873); la carita sonriente con corbatín no está en la tienda ni se puede dibujar en el metalizado: va un redondo azul genérico liso (sin producto); los cuartetos del taller van más apretados que los de la foto (columna más angosta).");

// ----------------------------------------------------------------------------------------------------------
// 401 · Columna Papá Súper Héroe
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 560 px, el eje en x = 378 px. Los globos grandes miden ~67 px de ancho (R-12: 2,7
 * px/cm con R-12 a 25 cm) y los aguamarina ~30 px (R-5 a 11,6 cm). La columna: seis parejas de R-12 a los lados (de abajo
 * arriba: rojo impreso a 530 px, naranja 475, amarillo 432, rojo 387, naranja 343 y amarillo 293: 11, 31,5, 47,4, 64,1,
 * 80,4 y 98,9 cm; se ven aplastadas, ~45 px de alto: R-12 a 22 cm de costado) y por el frente el eje aguamarina: una
 * columna de R-5 que de frente muestra uno, dos, uno, dos… (495 px uno, 470 dos, … hasta 270 dos: 10 niveles a 25 px =
 * 9,26 cm, el paso del taller para R-5 de 11,6 cm). Encima tres rizos de T-260 (amarillo, naranja y rojo, a ~250 px) y
 * el ramo: 5 R-12 de helio (naranja con estrellas arriba a 40 px, amarillo «WOW» a 115, aguamarina detrás a 110, verde
 * claro con estrellas a 160 y rojo con estrellas a 205: de 131 a 193 cm) y dos estrellas metalizadas de 18" (dorada a
 * la izquierda, 135 px, y azul a la derecha, 200 px): ~2,05 m. Colores: los publicados (Fashion Aguamarina 037, Fashion
 * Amarillo 020, Fashion Naranja 061, Fashion Rojo 015); el verde claro mide #a6d39b → Pastel Dusk Té Verde 126 (no
 * publicado). Las estrellas: la dorada mide amarillo brillante y la tienda solo la trae «Dorado Mate»; la azul es azul rey
 * y la tienda la trae en «Azul» (celeste) y «Azul Vibrante»: va la Vibrante, la más oscura.
 */
const escena401 = perezoso((): Escena => {
  const px = escala(378, 560, 2.7);
  // El primer nivel (24,1 cm) muestra uno al frente: la columna va girada 45° (el taller empieza con dos al frente).
  const m = montaje({ id: "eje", nombre: "Eje: columna de R-5 Fashion Aguamarina", pieza: { tipo: "columna", formatoId: "R-5", infladoCm: 11.6, alturaCm: r2(10 * 0.8 * 11.6), patron: "un_color", colores: ["037"] }, en: v(0, px(0, 495).y, 0), giroGrados: 45 }, v(0, 0, -45));
  const PAREJAS: ReadonlyArray<readonly [number, string, string]> = [[530, "015", "Fashion Rojo"], [475, "061", "Fashion Naranja"], [432, "020", "Fashion Amarillo"], [387, "015", "Fashion Rojo"], [343, "061", "Fashion Naranja"], [293, "020", "Fashion Amarillo"]];
  PAREJAS.forEach(([y, codigo, nombre], k) => {
    for (const [lado, s] of [["izquierda", -1], ["derecha", 1]] as const)
      m.globo(`pareja-${k + 1}-${lado}`, `R-12 ${nombre} de la pareja ${k + 1} (${lado})`, R("R-12", 22, codigo), px(378 + s * 37, Math.min(y, 527), -5), enPlano(s, 0.1, 0));
  });
  const RIZOS: ReadonlyArray<readonly [string, string, number, number, string]> = [["amarillo", "020", 345, 250, "Fashion Amarillo"], ["naranja", "061", 378, 258, "Fashion Naranja"], ["rojo", "015", 413, 248, "Fashion Rojo"]];
  for (const [id, codigo, x, y, nombre] of RIZOS)
    m.centrada(`rizo-${id}`, `Rizo en espiral de T-260 ${nombre}`, deco(rizo({ forma: "voluta", tubito: T("T-260", 3, codigo), vueltas: 1.6, radioInicialCm: 1.5, radioFinalCm: 5 })), px(x, y, 8), AL_FRENTE);
  const HELIO: ReadonlyArray<readonly [string, string, number, number, number, string]> = [
    ["naranja", "061", 370, 40, -3, "Fashion Naranja"], ["amarillo", "020", 392, 115, 2, "Fashion Amarillo"], ["aguamarina", "037", 345, 110, -14, "Fashion Aguamarina"],
    ["verde", "126", 400, 160, -6, "Pastel Dusk Té Verde"], ["rojo", "015", 355, 205, 6, "Fashion Rojo"],
  ];
  for (const [id, codigo, x, y, z, nombre] of HELIO) m.globo(`helio-${id}`, `R-12 ${nombre} de helio (ramo)`, R("R-12", 28, codigo), px(x, y, z), ARRIBA);
  m.metalizado("estrella-dorada", "Estrella metalizada dorada de 18\" (ramo, izquierda)", metalizadoDeTienda("estrella-dorado-mate"), px(300, 135, 4), 12);
  m.metalizado("estrella-azul", "Estrella metalizada azul de 18\" (ramo, derecha)", metalizadoDeTienda("estrella-azul-vibrante"), px(420, 200, 9), -8);
  return { sala: sala(240, 220, 240), nodos: m.nodos };
});
const idea401 = idea("columna-papa-super-heroe", "Columna Papá Súper Héroe", escena401,
  "Igual: columna de ~1,1 m de seis parejas de R-12 (rojo, naranja, amarillo, rojo, naranja y amarillo, de abajo arriba, a la altura medida) con el eje de R-5 aguamarina por el frente (de frente, uno, dos, uno, dos…), tres rizos en espiral de T-260 (amarillo, naranja y rojo) y el ramo de 5 R-12 de helio (naranja, amarillo, aguamarina, verde claro y rojo) con dos estrellas metalizadas de 18\" de la tienda, ~2,05 m, con los productos que publica la idea. Distinto: los impresos de estrellas, el «WOW» y el rojo de la base no están en la tienda ni hay uno parecido en esos colores: van lisos en los colores publicados (el verde claro, en Pastel Dusk Té Verde 126, no publicado); la estrella dorada de la foto es brillante y la de la tienda dorado mate; la azul de la foto es azul rey y va la Azul Vibrante; las parejas de la foto se ven aplastadas (aquí R-12 a 22 cm de costado); el ramo va sin cintas (en la foto no se ven).");

// ----------------------------------------------------------------------------------------------------------
// 403 · Columna Rellena
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el piso en y = 555 px, el eje en x = 380 px. Los R-5 del tubo miden ~38 px (12 cm: 3,2 px/cm). De
 * abajo arriba: cuatro rizos de T-260 en la base (azul, rosado, verde y lila, de 430 a 555 px), el tubo transparente con
 * 6 R-5 apilados (rosado a 465 px, amarillo 425, azul 390, lila 350, verde 318 y rosado 280: de 28 a 86 cm), cuatro
 * rizos en la cabeza del tubo (amarillo, azul, lila y verde, de 160 a 300 px), el globo cristal (114 px: 36 cm → R-18
 * de 36 cm) lleno de confeti blanco (de 40 a 155 px) y tres R-5 en la punta (morado, rosado y verde, a ~20 px: 167 cm):
 * ~1,7 m. Colores medidos (no publica productos): rosado #f5aab4 → Fashion Rosado 009 (ΔE 9; Silk Rosa Primaveral a 6);
 * amarillo #f4d301 → Fashion Amarillo Miel 021; azul #03b5d7 → Fashion Azul Caribe 038; lila #cc9cc0 → Fashion Lila 050;
 * verde #abd147 → Neón Verde 230 (ΔE 8); la punta: morado #914e9e → Reflex Violeta 951, rosado #fe819c → Satín Fucsia 412,
 * verde #61bd0b → Fashion Verde Trébol 029; los rizos: azul #03b7e0 → Fashion Azul 040, amarillo → Amarillo Miel 021,
 * lila #bf7db2 → Fashion Lila 050, verde #6fbd09 → Verde Trébol 029, rosado → Fashion Rosado 009.
 */
const escena403 = perezoso((): Escena => {
  const px = escala(380, 555, 3.2);
  const m = montaje({ id: "tubo", nombre: "Fuste: seis R-5 apilados (los del tubo transparente)", pieza: hilera(R("R-5", 11.8, "009"), ["009", "021", "038", "050", "230", "009"], 64), en: v(0, 25.1, 0) }, v(0, 0, -40));
  m.pieza("cristal", "Globo cristal R-18 con confeti blanco", deco(burbuja(R("R-18", 36, "390"), [], { tipo: "confeti", colores: ["#f4f1ea", "#ffffff"], cantidad: 160 }, 403)), px(380, 160), AL_FRENTE);
  const PUNTA: ReadonlyArray<readonly [string, string, number, number, string]> = [["morado", "951", 357, 24, "Reflex Violeta"], ["rosado", "412", 372, 16, "Satín Fucsia"], ["verde", "029", 392, 22, "Fashion Verde Trébol"]];
  for (const [id, codigo, x, y, nombre] of PUNTA) m.globo(`punta-${id}`, `R-5 ${nombre} en la punta del cristal`, R("R-5", 10, codigo), px(x, y, id === "rosado" ? -2 : 2), enPlano((x - 375) / 20, 1, 0.2));
  const RIZOS: ReadonlyArray<readonly [string, TubitoRizo, number, number, number, Vec3, number, number, number]> = [
    ["cabeza-amarillo", T("T-260", 4, "021"), 360, 185, 10, enPlano(-0.6, -0.3, 1), 2, 6, 14],
    ["cabeza-azul", T("T-260", 4, "040"), 400, 175, 6, enPlano(1, -0.9, 0.3), 2.5, 6, 30],
    ["cabeza-lila", T("T-260", 4, "050"), 365, 220, 12, enPlano(-0.2, -0.7, 1), 2, 9, 22],
    ["cabeza-verde", T("T-260", 4, "029"), 345, 225, 4, enPlano(-1, -0.4, 0.2), 1.5, 4, 14],
    ["base-azul", T("T-260", 4, "040"), 350, 480, 4, enPlano(-1, -0.25, 0.3), 2.5, 7, 28],
    ["base-rosado", T("T-260", 4, "009"), 375, 495, 10, enPlano(0, -0.6, 1), 2, 6, 18],
    ["base-verde", T("T-260", 4, "029"), 400, 470, 4, enPlano(1, 0.2, 0.3), 2, 5, 18],
    ["base-lila", T("T-260", 4, "050"), 380, 455, 8, enPlano(0.3, 0.1, 1), 1, 7, 8],
  ];
  for (const [id, t, x, y, z, normal, vueltas, r, l] of RIZOS) m.pieza(`rizo-${id}`, `Rizo de T-260 (${id.replace("-", ", ")})`, tirabuzon(t, vueltas, r * 0.8, r, l), px(x, y, z), normal);
  return { sala: sala(240, 220, 220), nodos: m.nodos };
});
const idea403 = idea("columna-rellena", "Columna Rellena", escena403,
  "Igual: columna de ~1,7 m: seis R-5 de colores apilados (rosado, amarillo, azul caribe, lila, verde y rosado, de abajo arriba), cuatro rizos de T-260 en la base (azul, rosado, verde y lila) y cuatro en la cabeza (amarillo, azul, lila y verde), el globo cristal de 36 cm con confeti blanco y tres R-5 en su punta (morado, rosado y verde). Distinto: la idea no publica productos (colores medidos); el tubo transparente que encierra los R-5 no es un globo Sempertex (el Link-O-Loon 660 no se fabrica en Cristal): los R-5 van apilados en su sitio sin el tubo, y no hay una base que se vea (en la foto el tubo se para entre los rizos); el blanco de dentro del cristal (encaje o confeti en la foto) va como confeti; los rizos de la foto se enredan entre sí y aquí son tirabuzones sueltos.");

// ----------------------------------------------------------------------------------------------------------
// 407 · Columna Te Amo
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000: el piso en y = 945 px, el eje en x = 467 px. El corazón «Te Amo» de la tienda (16") mide ~300 px de
 * ancho (38 cm: 7,9 px/cm). De abajo arriba: base de 4 R-12 Reflex Champaña de ~185 px (23 cm), una corona de racimos de
 * 4 R-5 (~62 px: 8 cm) alrededor del pie del globo grande, que alterna champaña, verde aurora y perla (se ven 7: 12 en la
 * vuelta; a 25 cm del eje, centro a 725 px, 28 cm, inclinada: los de delante más bajos), el globo grande Pastel Dusk Rosa
 * (245 × 270 px: R-12 lleno, 30 cm; centro a 565 px: 48 cm), un cuarteto de R-5 champaña de ~11 cm (385 px: 71 cm) y el
 * corazón (centro a 200 px: 94 cm): ~1,12 m. Colores: los publicados (Reflex Champaña 971, Reflex Verde Aurora 932, Satín
 * Perla 406, Pastel Dusk Rosa 110 y el corazón metalizado Te Amo rosado).
 */
const escena407 = perezoso((): Escena => {
  const px = escala(467, 945, 7.9);
  const BASE = R("R-12", 23, "971");
  const m = montaje({ id: "base", nombre: "Cuarteto R-12 Reflex Champaña de la base", pieza: cuarteto(BASE, ["971"]), en: v(0, Math.max(px(0, 860).y, bajoCuarteto(BASE)), 0) }, v(0, 0, -45));
  m.globo("grande", "R-12 Pastel Dusk Rosa (el globo grande)", R("R-12", 30, "110"), px(467, 565), ARRIBA);
  const COLORES: ReadonlyArray<readonly [string, string]> = [["932", "Reflex Verde Aurora"], ["406", "Satín Perla"], ["971", "Reflex Champaña"]];
  for (let k = 0; k < 12; k++) {
    const a = rad(30 * k);
    const [codigo, nombre] = COLORES[k % 3]!;
    const centro = v(r2(25 * Math.sin(a)), r2(28 - 7 * Math.cos(a)), r2(25 * Math.cos(a)));
    m.centrada(`racimo-${k + 1}`, `Racimo de 4 R-5 ${nombre} (corona, ${k + 1})`, deco(anillo(R("R-5", 8, codigo), 4, 20, 45)), centro, unitario(v(Math.sin(a), 0.5, Math.cos(a))));
  }
  m.nivel("cuarteto-arriba", "Cuarteto R-5 Reflex Champaña (bajo el corazón)", R("R-5", 11, "971"), ["971"], px(467, 385));
  m.metalizado("corazon", "Corazón metalizado «Te Amo» rosado de 16\"", metalizadoDeTienda("corazon-te-amo-rosado"), px(490, 200, 0));
  return { sala: sala(220, 200, 200), nodos: m.nodos };
});
const idea407 = idea("columna-te-amo", "Columna Te Amo", escena407,
  "Igual: columna de ~1,12 m: base de 4 R-12 Reflex Champaña, corona de 12 racimos de 4 R-5 alrededor del pie (verde aurora, perla y champaña, alternados), el R-12 Pastel Dusk Rosa grande, un cuarteto de R-5 champaña y el corazón metalizado «Te Amo» rosado de 16\" de la tienda, con los productos que publica la idea. Distinto: la corona de la foto es más suelta (racimos de 2 a 4 metidos unos en otros) y aquí 12 racimos iguales en un anillo inclinado; de la vuelta se ven 7, los otros 5 se suponen; el globo grande de la foto parece algo alargado (30 × 34 cm): va un R-12 lleno.",
  [
    P("GLOBO REDONDO REFLEX CHAMPAÑA", "/products/globo-para-fiesta-latex-redondo-reflex-champana", "R-12", "971"),
    P("GLOBO REDONDO REFLEX VERDE AURORA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-aurora", "R-12", "932"),
    P("GLOBO REDONDO SATIN PERLA", "/products/globo-para-fiesta-latex-redondo-satin-perla", "R-12", "406"),
    P("GLOBO METALIZADO CORAZON TE AMO ROSADO", "/products/globo-metalizado-corazon-te-amo-rosado", null, null),
    P("GLOBO REDONDO PASTEL DUSK ROSA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-rosa", "R-12", "110"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 411 · Columna Toy Story
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570: el eje en x = 367 px; los globos miden ~90 px (R-12 a 28 cm: 3,25 px/cm). Cinco niveles con tres
 * globos al frente (45°) a ~82 px (25 cm: 0,9 diámetros, más separados que el paso del taller): de abajo arriba rojo (405
 * px), naranja (325), amarillo (245), verde (160) y azul (65), cada globo con el logo de Toy Story y estrellitas. Abajo
 * cinco rizos de T-260 (verde oscuro, rojo, naranja, amarillo y azul petróleo) que se enroscan hasta ~100 px por debajo del
 * nivel rojo: ~1,3 m de columna. Colores medidos (no publica productos): rojo #ef3555 → Fashion Frambuesa 014 (ΔE 9);
 * naranja #f88040 → Fashion Naranja 061; amarillo #e5e00e → Fashion Amarillo 020 (ΔE 6); verde #019956 → Fashion Verde
 * Selva 032 (ΔE 14; Metal Verde a 11: el Fashion a menos de 6); azul #0071ae → Metal Azul 540 (ΔE 8); los rizos: verde
 * #01812c → Metal Verde 530 (ΔE 4), rojo #ff2e03 → Fashion Rojo 015, azul petróleo #014d60 → Fashion Turquesa Profundo
 * 035 (ΔE 6). El impreso de Toy Story no está en la tienda y ninguno del catálogo se le parece en esos colores (el «Happy
 * Birthday Festivo» de colores cambiaría el rojo y el verde): van lisos.
 */
const escena411 = perezoso((): Escena => {
  const G = (codigo: string) => R("R-12", 28, codigo);
  const piso = bajoCuarteto(G("014"));
  // El nivel rojo apoya en el piso (en la foto queda ~30 cm arriba, sobre los rizos): los demás, a 82 px (25,2 cm).
  const NIVELES: ReadonlyArray<readonly [string, string]> = [["014", "Fashion Frambuesa"], ["061", "Fashion Naranja"], ["020", "Fashion Amarillo"], ["032", "Fashion Verde Selva"], ["540", "Metal Azul"]];
  const m = montaje({ id: "nivel-1", nombre: "Cuarteto R-12 Fashion Frambuesa (nivel 1)", pieza: cuarteto(G("014"), ["014"]), en: v(0, piso, 0), giroGrados: 45 }, v(0, 0, -50));
  NIVELES.slice(1).forEach(([codigo, nombre], k) => m.nivel(`nivel-${k + 2}`, `Cuarteto R-12 ${nombre} (nivel ${k + 2})`, G(codigo), [codigo], v(0, r2(piso + 25.2 * (k + 1)), 0), 45));
  const RIZOS: ReadonlyArray<readonly [string, string, string, number, number]> = [
    ["verde", "530", "Metal Verde", -0.8, 0], ["rojo", "015", "Fashion Rojo", -0.35, -0.15], ["naranja", "061", "Fashion Naranja", 0, -0.1], ["amarillo", "020", "Fashion Amarillo", 0.35, -0.15], ["petroleo", "035", "Fashion Turquesa Profundo", 0.8, 0],
  ];
  RIZOS.forEach(([id, codigo, nombre, x, y], k) =>
    m.pieza(`rizo-${id}`, `Rizo de T-260 ${nombre} (base)`, tirabuzon(T("T-260", 4, codigo), 2.5, 3.5, 5, 24, 70 * k), v(r2(16 * x), 13, 18), enPlano(x, y, 1)));
  return { sala: sala(240, 220, 200), nodos: m.nodos };
});
const idea411 = idea("columna-toy-story", "Columna Toy Story", escena411,
  "Igual: columna de 5 cuartetos R-12 (28 cm) por bandas de arcoíris (de abajo arriba: frambuesa, naranja, amarillo, verde selva y azul), con tres globos al frente en cada nivel y a 25 cm por nivel como la foto, y cinco rizos de T-260 en la base (verde, rojo, naranja, amarillo y azul petróleo). Distinto: la idea no publica productos (colores medidos); el impreso de Toy Story no está en la tienda ni hay uno parecido en esos colores: los globos van lisos; en la foto la columna queda alzada ~30 cm sobre los rizos (aquí apoya en el piso y los rizos salen de su base hacia delante); el cuarteto del taller es más angosto que el de la foto.");

// ----------------------------------------------------------------------------------------------------------
// 423 · Corazón de Link-O-Loon 6 con Reflex Plata
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (sin piso: va en la pared con su punta a 20 cm del piso), el eje en x = 375 px. Los R-12 Reflex Plata
 * miden ~98 px (28 cm: 3,5 px/cm): el corazón mide 661 × 535 px (1,89 × 1,53 m). Son dos capas de R-12 plata: una de
 * fondo en retícula y otra al frente, un globo en cada hueco de la de fondo; arriba, en las orejas, asoman cuatro R-5
 * plata (~38 px: 11 cm). El Link-O-Loon 6 del título es la malla que sostiene los R-12 por detrás (no se ve en la foto:
 * no se dibuja). Color: el publicado (Reflex Plata 981).
 */
const escena423 = perezoso((): Escena => {
  const px = escala(375, 625, 3.5);
  const forma: OpcionesForma = {
    clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 189, altoCm: 153 }, tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 28, celda: "cuadrada" },
    colores: { codigos: ["981"], patron: "un_color" }, acento: { formatoId: "R-12", infladoCm: 28, codigos: ["981"], cada: 1 },
  };
  const Z = -110 + 20;
  const m = montaje({ id: "corazon", nombre: "Corazón de R-12 Reflex Plata en dos capas", pieza: { tipo: "forma", forma }, en: v(0, 20, Z) }, v(0, 0, 40));
  ([[180, 55], [300, 45], [440, 45], [560, 40]] as const).forEach(([x, y], k) => m.globo(`r5-${k + 1}`, `R-5 Reflex Plata en la oreja del corazón (${k + 1})`, R("R-5", 11, "981"), px(x, y, Z - 4), enPlano(0, 1, 0.2)));
  return { sala: sala(300, 220, 220), nodos: m.nodos };
});
const idea423 = idea("corazon-de-link-o-loon-r-6-con-reflex-plata", "Corazón de Link-O-Loon 6 con Reflex Plata", escena423,
  "Igual: corazón de pared de ~1,9 × 1,5 m de R-12 Reflex Plata en dos capas (la de fondo en retícula y la del frente, un globo en cada hueco), con cuatro R-5 plata asomando en las orejas, con el producto que publica la idea. Distinto: la malla de Link-O-Loon 6 que lo sostiene por detrás no se ve en la foto ni se dibuja (ni se cotiza: la idea no la publica); el reparto de los globos lo hace el relleno del taller sobre la silueta del corazón, no globo a globo como en la foto (el borde de la foto es algo más irregular).",
  [P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981")]);

// ----------------------------------------------------------------------------------------------------------
// 426 · Corazón en malla
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (sin piso ni referencia de tamaño: va en la pared con la punta a 20 cm del piso). Los globos miden ~95
 * px; tomados como R-12 a 25 cm (el inflado de malla del taller) dan 3,8 px/cm y el corazón mide 665 × 533 px (1,75 ×
 * 1,40 m). La malla: filas a ~57 px con los globos a ~47 px a lo ancho, uno adelante y uno atrás (se ven los nudos entre
 * ellos): 4, 11, 13, 11, 9, 7, 5, 3 y 1 por fila, ~64 globos. Color medido (no publica productos): rojo #fe1c23 →
 * Fashion Rojo 015 (ΔE 15–17, el más cercano: la foto es un render saturado).
 */
const escena426 = perezoso((): Escena => {
  const forma: OpcionesForma = {
    clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 175, altoCm: 140 }, tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 25, celda: "cuadrada" },
    colores: { codigos: ["015"], patron: "un_color" }, acento: { formatoId: "R-12", infladoCm: 25, codigos: ["015"], cada: 1 },
  };
  return { sala: sala(280, 220, 220), nodos: [{ id: "corazon", nombre: "Corazón en malla de R-12 Fashion Rojo", pieza: { tipo: "forma", forma }, colocacion: libre(0, 20, -90) }] };
});
const idea426 = idea("corazon-en-malla", "Corazón en malla", escena426,
  "Igual: corazón de pared rojo de ~1,75 × 1,40 m en malla de R-12 en dos capas (la de fondo en retícula y la del frente, un globo en cada hueco), como los nudos de la foto. Distinto: la idea no publica productos ni trae una referencia de tamaño: los globos se toman como R-12 a 25 cm (el color medido es Fashion Rojo 015); el reparto lo hace el relleno del taller sobre la silueta (la foto cuenta ~64 globos en filas de 4, 11, 13, 11, 9, 7, 5, 3 y 1; el taller da los suyos, ver productos).");

// ----------------------------------------------------------------------------------------------------------
// 427 · Corazón entrelazado
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 740 × 570 (sin piso: va en la pared con la punta a 40 cm del piso), el eje en x = 372 px. Los R-5 rojos miden
 * ~62 px (12 cm: 5,2 px/cm): el corazón mide 555 × 540 px (1,07 × 1,04 m). La cuerda: cuatro T-260 trenzados (dos rojos y
 * dos rosados, ~60 px de grueso: 11,5 cm) que siguen el corazón: el centro de la cuerda baja de la muesca (372,135 px)
 * por las orejas (470,72 y 585,95), el costado (625,200) hasta la punta (372,530); en la muesca cuelgan las puntas
 * rojas. Diez R-5 rojos asoman por fuera: tres arriba (150,45; 530,45 y el del centro, metido en la muesca detrás de la cuerda, 370,40: aquí a 370,80 para que no quede suelto), dos en los costados (110,195; 620,195),
 * dos más abajo (120,365; 585,360), dos junto a la punta (225,450; 495,455) y uno en la punta (360,530). Colores medidos
 * (no publica productos): rojo #f20b10 → Fashion Rojo 015; rosado → Fashion Rosado 009.
 */
const escena427 = perezoso((): Escena => {
  const px = escala(372, 763, 5.2);
  const Z = -90;
  // La mitad derecha del centro de la cuerda, de la muesca a la punta (px de la foto).
  const MITAD: ReadonlyArray<readonly [number, number]> = [[372, 135], [420, 95], [470, 72], [530, 70], [585, 95], [615, 140], [625, 200], [615, 260], [590, 320], [550, 380], [500, 430], [450, 475], [400, 515], [372, 530]];
  /** Un brazo trenzado que sigue la mitad del corazón (el taller lo pone en espejo del otro lado). */
  const brazo = (codigo: string, encoge: number): Extremidad => {
    const p = MITAD.map(([x, y]) => [((x - 372) / 5.2) * encoge, ((285 - y) / 5.2) * encoge] as const);
    const tramos = p.slice(1).map(([x, y], i) => ({ dx: x - p[i]![0], dy: y - p[i]![1] }));
    return { formatoId: "T-260", grosorCm: 4.5, codigo, burbujasCm: tramos.map((t) => r2(Math.hypot(t.dx, t.dy))), angulosGrados: tramos.map((t) => r2(grados(Math.atan2(t.dy, t.dx)))), trenzado: true, punta: null };
  };
  const cuerda = (codigo: string, encoge: number): Pieza => deco(figura({ queEs: "a heart frame of twisted balloons", cuerpo: [{ tipo: "tubito", tubito: { formatoId: "T-260", grosorCm: 4.5, codigo }, largoCm: 4 }], brazos: brazo(codigo, encoge) }));
  const ROJOS: ReadonlyArray<readonly [number, number]> = [[150, 45], [370, 80], [530, 45], [110, 195], [620, 195], [120, 365], [585, 360], [225, 450], [495, 455], [360, 530]];
  // La raíz (la cuerda roja) va de frente, con el centro de su caja en el centro del corazón.
  const roja: Pieza = { tipo: "decoracion", decoracion: (cuerda("015", 1) as Extract<Pieza, { tipo: "decoracion" }>).decoracion, deFrente: true };
  const caja = armarPieza(roja).caja;
  const m = montaje({ id: "cuerda-roja", nombre: "Cuerda del corazón: dos T-260 Fashion Rojo trenzados", pieza: roja, en: menos(px(372, 290, Z + 1.5), por(mas(caja.min, caja.max), 0.5)) }, v(0, 0, 40));
  m.centrada("cuerda-rosada", "Cuerda del corazón: dos T-260 Fashion Rosado trenzados (por dentro)", cuerda("009", 0.955), px(372, 290, Z + 1), AL_FRENTE);
  ROJOS.forEach(([x, y], k) => m.globo(`rojo-${k + 1}`, `R-5 Fashion Rojo del corazón (${k + 1})`, R("R-5", 12, "015"), px(x, y, Z - 3), enPlano((x - 372) / 200, (285 - y) / 200, 0.6)));
  return { sala: sala(240, 220, 200), nodos: m.nodos };
});
const idea427 = idea("corazon-entrelazado", "Corazón entrelazado", escena427,
  "Igual: corazón de pared de ~1,07 × 1,04 m de tubitos trenzados (rojos y rosados) que siguen la silueta, con las puntas rojas colgando en la muesca y diez R-5 rojos asomando por fuera (tres arriba, dos en los costados, dos más abajo, dos junto a la punta y uno en la punta). Distinto: la idea no publica productos (colores medidos); en la foto los cuatro tubitos se entrelazan entre sí (rojo, rosado, rojo, rosado) y aquí son dos cuerdas de dos tubitos trenzados (una roja y una rosada un poco por dentro y por delante, que se cruzan) que siguen el mismo corazón; la curva va en 13 tramos rectos por lado.");

// ----------------------------------------------------------------------------------------------------------
// 428 · Corazón Feliz Día
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto 1000 × 1000 (sin piso: va en la pared con la punta a 25 cm del piso), el eje en x = 500 px. El cartel «Feliz Día
 * Corazones Modernos» de la tienda (1,60 m) se ve de ~500 px de ancho (3,1 px/cm) y con esa escala los globos (~70 px)
 * son R-12 a ~23 cm: el corazón mide 860 × 660 px (2,77 × 2,13 m) y la guirnalda ~170 px de grueso (55 cm). La guirnalda
 * va por bloques de un color, iguales a cada lado: rosado arriba al centro, rojo frambuesa, plata lila, orquídea, rosado,
 * frambuesa, plata lila y orquídea abajo en la punta (14 bloques). Colores: los publicados (Fashion Orquídea Morada
 * 056, Silk Amatista 850 —el plata lila—, Fashion Rosado 009 y el cartel); el frambuesa no está publicado: mide #b50038 →
 * Fashion Frambuesa 014 (ΔE 14; Metal Rojo a 12: el Fashion a menos de 6).
 */
const escena428 = perezoso((): Escena => {
  const px = escala(500, 967.5, 3.1);
  const Z = -110 + 30;
  // La mitad derecha del corazón (curva clásica), escalada a la foto: x de 155 a 845 px, de las orejas (300 px) a la punta (820 px).
  const curva = Array.from({ length: 241 }, (_, i) => {
    const t = (Math.PI * i) / 240;
    return { x: 16 * Math.sin(t) ** 3, y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) };
  });
  const yMax = Math.max(...curva.map((q) => q.y)), yMin = Math.min(...curva.map((q) => q.y));
  const mitad = curva.map((q) => px(500 + (q.x / 16) * 345, 300 + ((yMax - q.y) / (yMax - yMin)) * 520, Z));
  const acum = mitad.map((_, i) => mitad.slice(1, i + 1).reduce((s, q, j) => s + largo(menos(q, mitad[j]!)), 0));
  const total = acum[acum.length - 1]!;
  const tramo = (a: number, b: number) => mitad.filter((_, i) => acum[i]! >= a * total - 1e-9 && acum[i]! <= b * total + 1e-9).filter((_, i, l) => i % 6 === 0 || i === l.length - 1);
  const espejo = (puntos: Vec3[]) => puntos.map((q) => v(-q.x, q.y, q.z)).reverse();
  const NOMBRE: Readonly<Record<string, string>> = { "009": "Fashion Rosado", "014": "Fashion Frambuesa", "850": "Silk Amatista", "056": "Fashion Orquídea Morada" };
  const bloque = (codigo: string, puntos: Vec3[], semilla: number) => racimos({ puntos, radio: 24, mezcla: { "R-12": 1 }, codigo, semilla, inflados: { "R-12": 23 } });
  const m = montaje({ id: "rosado-arriba", nombre: "Corazón: tramo de Fashion Rosado (arriba al centro)", pieza: bloque("009", [...espejo(tramo(0, 1 / 14)), ...tramo(0, 1 / 14).slice(1)], 428), en: ORIGEN }, v(0, 0, 40));
  const LADO = ["014", "850", "056", "009", "014", "850"];
  for (const [lado, s] of [["derecha", 1], ["izquierda", -1]] as const) {
    LADO.forEach((codigo, k) => {
      const puntos = tramo((2 * k + 1) / 14, (2 * k + 3) / 14);
      const enMundo = s > 0 ? puntos : espejo(puntos);
      m.pieza(`${lado}-${k + 1}`, `Corazón: tramo de ${NOMBRE[codigo]} (${lado}, ${k + 1})`, bloque(codigo, enMundo.map(zAlReves), 430 + k + (s > 0 ? 0 : 10)), ORIGEN, ARRIBA, 90);
    });
  }
  const punta = tramo(13 / 14, 1);
  m.pieza("orquidea-punta", "Corazón: tramo de Fashion Orquídea Morada (punta)", bloque("056", [...punta, ...espejo(punta).slice(1)].map(zAlReves), 450), ORIGEN, ARRIBA, 90);
  m.pieza("cartel", "Cartel «Feliz Día Corazones Modernos» (dentro del corazón)", letrero({ forma: "rectangulo", anchoCm: 160, altoCm: 100, hex: "#fbf7f8", motivo: { dibujo: "texto", texto: "Feliz\nDía", hex: "#d42032" }, apoyo: "colgado", productoId: "cartel-decorativo-feliz-dia-corazones-modernos" }), v(0, 81, Z - 12), ARRIBA, 90);
  return { sala: sala(340, 220, 280), nodos: m.nodos };
});
const idea428 = idea("corazon-feliz-dia", "Corazón Feliz Día", escena428,
  "Igual: corazón de pared de ~2,8 × 2,1 m de guirnalda orgánica de R-12 (~55 cm de grueso) por bloques de color iguales a cada lado —rosado arriba al centro, frambuesa, plata lila, orquídea, rosado, frambuesa, plata lila y orquídea en la punta— con el cartel «Feliz Día» de la tienda dentro, con los productos que publica la idea. Distinto: los globos de cada bloque los reparte el motor orgánico (no se cuentan uno a uno: la foto tiene ~8–10 por bloque); el frambuesa no está publicado (Fashion Frambuesa 014, medido); el cartel de la foto lleva corazones dibujados y aquí solo el letrero; la curva es la del corazón clásico ajustada a la foto (las orejas de la foto son algo más planas).",
  [
    P("GLOBO REDONDO FASHION ORQUIDEA MORADA", "/products/globo-para-fiesta-latex-redondo-fashion-orquidea-morada", "R-12", "056"),
    P("GLOBO REDONDO SILK AMATISTA", "/products/globo-latex-redondo-silk-amatista", "R-12", "850"),
    P("CARTEL FELIZ DIA CORAZONES MODERNOS", "/products/cartel-decorativo-feliz-dia-corazones-modernos", null, null),
    P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
  ]);

/** Ideas de fiesta de sempertex.com digitalizadas: lote 19 (en el orden de `clasif/lote-19.json`). */
export const LOTE_19: readonly IdeaDigitalizada[] = [idea375, idea381, idea382, idea385, idea390, idea396, idea397, idea401, idea403, idea407, idea411, idea423, idea426, idea427, idea428];
