import type { IdeaDigitalizada, ProductoDeIdea } from "./tipos";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { centroCuerpo } from "../geometria";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { mesaCilindrica, mesaConMantel, type ElementoEscenografia } from "../escenografia";
import { paquetesPara, platos, productoDe, vasos, velas } from "../utileria";
import { opcionesArcoRectangular, opcionesRacimosLibres } from "../estructuras-organicas";
import type { ColorOrganico, PuntoMezcla } from "../organico";
import type { FormaArco } from "../arcos";
import type { PatronColumna } from "../columnas";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesFlorTubito } from "../figuras";
import type { PropiedadesArana } from "../halloween";
import type { PropiedadesFigura } from "../figuras-tubito";
import type { Vec3 } from "../modulos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 04** (los números de `clasif/lote-04.json`: 3 ramos de helio
 * por pisos, 9 arcos —de cuartetos y orgánicos—, 2 escenas con mesa, 4 centros de mesa y figuras, una araña de pared y
 * el juego de tenis con globo).
 *
 * Cómo se hizo (2026-10-07), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, ampliada con rejilla y con más
 * contraste:
 * - **Conteo**: los globos visibles, contando los que asoman por detrás (y nada más). Ninguna idea del lote publica
 *   «Materiales» con cantidades: lo contado va con `contada: true`. En los arcos de cuartetos se cuentan los niveles por
 *   los bultos del borde (uno por nivel) y la escala sale del globo; en los orgánicos, el motor da los globos para el
 *   grosor y el largo medidos (no se cuentan uno a uno: la nota lo dice). Los tubitos se cuentan por largo.
 * - **Medidas**: la escala sale de algo de tamaño conocido en la misma foto (R-12 de ramo ≈ 28 cm, R-12 de arco ≈ 25 cm,
 *   T-260 ≈ 5 cm de grueso, bloque de pared 40 × 20 cm) y con ella alturas, anchos y largos.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la foto mida otra cosa: la nota lo dice). Si
 *   no, se midió en la foto (Python/PIL: mediana de un parche sin brillos ni sombras, ΔE76 en Lab contra `hexGlobo` de la
 *   tabla oficial) y se tomó el código más cercano que se fabrica en ese formato; si un Fashion queda a ≤ 6 ΔE del más
 *   cercano, el Fashion.
 * - **Ramos**: por pisos, globo a globo (`globo` puesto `sobre` la pieza «Peso y cintas»), como en el lote 02.
 * - **Escenas** (#160, #184): cada estructura es un nodo raíz y lo suyo cuelga de ella (`sobre`/`ancla`), para que
 *   `extraerConjunto` saque «esta estructura con sus decoraciones»; la mesa y la utilería van aparte.
 * Unidades: cm. Espacio de cada escena: y arriba, +z hacia quien mira; los puntos `sobre` van en el espacio local del
 * padre (en una pieza de frente: x a la derecha, y arriba, z hacia el salón).
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
const punto3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const redondo = (p: Vec3): Vec3 => v(r2(p.x), r2(p.y), r2(p.z));
const rad = (g: number) => (g * Math.PI) / 180;
const ARRIBA = v(0, 1, 0);
const AL_FRENTE = v(0, 0, 1);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });

const sala = (anchoCm: number, fondoCm: number, altoCm: number, tonos?: Partial<Sala["tonos"]>): Sala => {
  const s = structuredClone(SALA_INICIAL);
  return { ...s, anchoCm, fondoCm, altoCm, tonos: { ...s.tonos, ...(tonos ?? {}) } };
};
const SALA_RAMO = sala(420, 380, 320);
const SALA_CHICA = sala(320, 280, 280);
const SALA_ARCO = sala(600, 500, 320);

/** Nombre de un globo para su nodo: «R-12 Fashion Verde Lima». */
function nombreGlobo(g: ParteGlobo): string {
  return `${g.formatoId} ${referenciaPorCodigo(g.codigo)?.nombreCompleto ?? g.codigo}`;
}

/** Dónde queda el nudo de un globo con el centro del cuerpo en `centro`, mirando hacia `direccion`. */
const nudoDe = (g: ParteGlobo, centro: Vec3, direccion: Vec3): Vec3 => menos(centro, por(unitario(direccion), centroCuerpo("redondo", g.infladoCm)));

/**
 * Un globo suelto `sobre` su padre, con el centro de su cuerpo en `centro` (espacio local del padre) y el cuerpo hacia
 * `direccion`. La colocación `sobre` apoya lo más bajo de la pieza (el nudo) en el punto, hundido 1,5 cm: se corrige.
 */
function globoSobre(id: string, nombre: string, padreId: string, g: ParteGlobo, centro: Vec3, direccion: Vec3 = ARRIBA): NodoEscena {
  const n = unitario(direccion);
  const p = menos(centro, por(n, centroCuerpo("redondo", g.infladoCm) - HUNDIMIENTO_SOBRE_CM));
  return { id, nombre, pieza: { tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo }, colocacion: { en: "sobre", padreId, puntoCm: redondo(p), normal: redondo(n), giroGrados: 0 } };
}

/** Una decoración `sobre` su padre, con su espalda en `espalda` (espacio local del padre) mirando a `normal`. */
function decoSobre(id: string, nombre: string, padreId: string, decoracion: Decoracion, espalda: Vec3, normal: Vec3, giroGrados = 0): NodoEscena {
  const n = unitario(normal);
  return { id, nombre, pieza: { tipo: "decoracion", decoracion }, colocacion: { en: "sobre", padreId, puntoCm: redondo(mas(espalda, por(n, HUNDIMIENTO_SOBRE_CM))), normal: redondo(n), giroGrados } };
}

type Tubito = { formatoId: string; grosorCm: number; codigo: string };

/**
 * Un tallo recto de tubito, de `desde` (la punta suelta) a `hasta` (donde se amarra), en el espacio local del padre:
 * una flor de tubito de dos burbujas con apertura −90° (las dos en la misma recta), puesta `sobre` con la normal de
 * `desde` a `hasta` (ver el lote 02).
 */
function palito(id: string, nombre: string, padreId: string, t: Tubito, desde: Vec3, hasta: Vec3): NodoEscena {
  const d = menos(hasta, desde);
  const petalos: AnilloTubito = { formatoId: t.formatoId, grosorCm: t.grosorCm, codigos: [t.codigo], cantidad: 2, estilo: "burbuja", largoCm: r2(largo(d)), anchoCm: t.grosorCm, aperturaGrados: -90, giroGrados: 0 };
  return decoSobre(id, nombre, padreId, { tipo: "flor_tubito", propiedades: { petalos, interior: null, corona: null, centro: null } }, desde, d);
}

/** Una cinta (escenografía: no cotiza) de `desde` a `hasta`, en el espacio de la pieza que la lleva. */
function cinta(desde: Vec3, hasta: Vec3, hex: string, radioCm = 0.2): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm, altoCm: r2(largo(d)), hex, acabado: "satinado", en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

const lazos = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, anchoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "lazo", largoCm, anchoCm, aperturaGrados, giroGrados });
const burbujas = (formatoId: string, grosorCm: number, codigos: string[], cantidad: number, largoCm: number, aperturaGrados: number, giroGrados: number): AnilloTubito =>
  ({ formatoId, grosorCm, codigos, cantidad, estilo: "burbuja", largoCm, anchoCm: grosorCm, aperturaGrados, giroGrados });
const florTubito = (p: Partial<PropiedadesFlorTubito> & Pick<PropiedadesFlorTubito, "petalos">): Decoracion =>
  ({ tipo: "flor_tubito", propiedades: { interior: null, corona: null, centro: null, ...p } });
const flor = (p: PropiedadesFlor): Decoracion => ({ tipo: "flor", propiedades: p });
const arana = (p: PropiedadesArana): Decoracion => ({ tipo: "arana", propiedades: p });

/** Alto de una pieza armada (para apoyarla en la pared). */
const altoDe = (pieza: Pieza): number => { const { caja } = armarPieza(pieza); return caja.max.y - caja.min.y; };

/** En la pared del fondo, con su centro a `centroCm` del piso. */
function enLaPared(pieza: Pieza, centroCm: number): Colocacion {
  return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: r2(centroCm - altoDe(pieza) / 2) };
}

/** El centro del cuerpo de cada globo de una pieza armada (en su espacio local). */
function centrosDe(pieza: Pieza): Array<{ c: Vec3; d: number }> {
  return armarPieza(pieza).globos.map((g) => ({ c: mas(g.nudo, por(g.direccion, centroCuerpo(g.formatoId.startsWith("LOL") ? "link" : "redondo", g.infladoCm) + g.cuelloExtraCm)), d: g.infladoCm }));
}

// ----------------------------------------------------------------------------------------------------------
// Ramo de helio por pisos (el del lote 02)
// ----------------------------------------------------------------------------------------------------------

/**
 * Un piso del ramo: sus globos (en `angulos`, 0° = de frente y 90° a la derecha de quien mira), con el centro del
 * cuerpo a `alturaCm` del piso y a `radioCm` del eje, inclinados hacia fuera `inclinacionGrados`.
 */
type PisoRamo = { alturaCm: number; radioCm: number; inclinacionGrados: number; angulos: readonly number[]; globo: ParteGlobo };

const tres = (giro: number) => [giro, giro + 120, giro + 240];
const cuatro = (giro: number) => [giro, giro + 90, giro + 180, giro + 270];
/** Dos de frente (izquierda y derecha) y uno que asoma detrás, a la derecha (150°) o a la izquierda (210°). */
const DOS_Y_DETRAS_DERECHA = [300, 60, 150];
const DOS_Y_DETRAS_IZQUIERDA = [300, 60, 210];
const DOS = [300, 60];
const ALTO_PESO = 7;

function escenaRamo(o: { pisos: readonly PisoRamo[]; cinta: string; peso: string }): Escena {
  const amarre = v(0, ALTO_PESO, 0);
  const globos: NodoEscena[] = [];
  const cintas: ElementoEscenografia[] = [];
  o.pisos.forEach((piso, k) => piso.angulos.forEach((angulo, i) => {
    const a = rad(angulo);
    const fuera = v(Math.sin(a), 0, Math.cos(a));
    const inc = rad(piso.inclinacionGrados);
    const direccion = unitario(mas(por(fuera, Math.sin(inc)), por(ARRIBA, Math.cos(inc))));
    const centro = v(fuera.x * piso.radioCm, piso.alturaCm, fuera.z * piso.radioCm);
    globos.push(globoSobre(`globo-${k + 1}-${i + 1}`, `${nombreGlobo(piso.globo)} (piso ${k + 1}, ${i + 1})`, "peso", piso.globo, centro, direccion));
    cintas.push(cinta(amarre, nudoDe(piso.globo, centro, direccion), o.cinta));
  }));
  const peso: NodoEscena = {
    id: "peso", nombre: "Peso y cintas",
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 4.5, altoCm: ALTO_PESO, hex: o.peso, acabado: "metal" }, ...cintas] },
    colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 },
  };
  return { sala: structuredClone(SALA_RAMO), nodos: [peso, ...globos] };
}

const piso = (alturaCm: number, angulos: readonly number[], globo: ParteGlobo, radioCm = 22, inclinacionGrados = 14): PisoRamo => ({ alturaCm, radioCm, inclinacionGrados, angulos, globo });

// ----------------------------------------------------------------------------------------------------------
// Arcos y columnas de cuartetos
// ----------------------------------------------------------------------------------------------------------

const arco = (formatoId: string, infladoCm: number, forma: FormaArco, anchoCm: number, altoCm: number, patron: PatronColumna, colores: string[]): Pieza =>
  ({ tipo: "arco", formatoId, infladoCm, forma, anchoCm, altoCm, patron, colores });
const columna = (formatoId: string, infladoCm: number, niveles: number, colores: string[]): Pieza =>
  ({ tipo: "columna", formatoId, infladoCm, alturaCm: r2(niveles * infladoCm * 0.8), patron: "un_color", colores });

const ANCLAS = new WeakMap<Pieza, ReturnType<typeof armarPieza>["anclas"]>();
const anclasDe = (pieza: Pieza) => { let a = ANCLAS.get(pieza); if (!a) { a = armarPieza(pieza).anclas; ANCLAS.set(pieza, a); } return a; };

/** El ancla más de frente (+z) de un nivel de un arco (4 anclas por nivel). */
function anclaDeFrente(pieza: Pieza, nivel: number): { posicion: Vec3; normal: Vec3 } {
  const anclas = anclasDe(pieza);
  let mejor = anclas[nivel * 4]!;
  for (let h = 1; h < 4; h++) { const a = anclas[nivel * 4 + h]; if (a && a.normal.z > mejor.normal.z) mejor = a; }
  return mejor;
}
const nivelesDe = (pieza: Pieza): number => Math.max(2, anclasDe(pieza).length / 4);

/** El centro del primer nivel de una columna puesta en el piso y el de cada nivel siguiente (paso 0,8 diámetros). */
function centroNivelColumna(pieza: Pieza, nivel: number): number {
  if (pieza.tipo !== "columna") return 0;
  return -armarPieza(pieza).caja.min.y + nivel * pieza.infladoCm * 0.8;
}

/** Una decoración sobre el ancla más de frente de un nivel del arco (amarrada encima, no enterrada en el hueco). */
function enNivel(id: string, nombre: string, padreId: string, pieza: Pieza, nivel: number, decoracion: Decoracion): NodoEscena {
  const a = anclaDeFrente(pieza, nivel);
  return { id, nombre, pieza: { tipo: "decoracion", decoracion }, colocacion: { en: "sobre", padreId, puntoCm: redondo(a.posicion), normal: redondo(a.normal), giroGrados: 0 } };
}

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

/**
 * Los productos de una idea: lo que gasta el 3D (por formato y código, en globos o tubitos enteros) es lo contado en la
 * foto; cada línea toma el producto que publica la idea si es el mismo globo (mismo tipo y código: la talla va en
 * `formato`) y si no, el liso de la tienda. Lo publicado que no sale en la foto queda sin cantidad.
 */
function productosDe(contenido: IdeaDigitalizada["contenido"], publicados: readonly Publicado[] = []): ProductoDeIdea[] {
  const materiales = contenido.tipo === "escena" ? armarEscena(contenido.escena).materiales : armarPieza(contenido.pieza).materiales;
  const usados = new Set<Publicado>();
  const salida: ProductoDeIdea[] = materiales.filter((m) => m.cantidad > 0).map((m) => {
    const tipo = formatoPorId(m.formatoId)?.tipo;
    const p = publicados.find((x) => x.codigo === m.codigo && x.formato !== null && formatoPorId(x.formato)?.tipo === tipo);
    if (p) usados.add(p);
    const base = p ?? lisoDeTienda(m.formatoId, m.codigo);
    return { nombre: base.nombre, url: base.url, formato: m.formatoId, codigo: m.codigo, cantidad: Math.ceil(m.cantidad - 1e-9), contada: true };
  });
  for (const p of publicados) if (!usados.has(p)) salida.push({ nombre: p.nombre, url: p.url, formato: p.formato, codigo: p.codigo, cantidad: null });
  return salida;
}

/**
 * La idea con sus productos calculados la primera vez que se piden: salen de armar la escena (los orgánicos tardan
 * unas décimas) y la biblioteca carga todas las ideas al abrir el taller.
 */
function idea(base: Omit<IdeaDigitalizada, "productos">, calcular: () => ProductoDeIdea[]): IdeaDigitalizada {
  let hechos: ProductoDeIdea[] | null = null;
  return { ...base, get productos() { return (hechos ??= calcular()); } };
}

const P = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });
const FOTO = (archivo: string) => `https://sempertex.com/cdn/shop/articles/${archivo}`;
const ALTO_MESA = 74;
const MESA = (hex = "#f3efe8"): ElementoEscenografia[] => mesaCilindrica({ diametroCm: 60, altoCm: ALTO_MESA, hex });

// Productos que publican varias ideas (nombre y url tal cual de la tienda).
const AMARILLO_MIEL = P("GLOBO REDONDO FASHION AMARILLO MIEL", "/products/copia-de-globo-latex-redondo-fashion-amarillomiel", "R-12", "021");
const EUCALIPTO = P("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027");
const NARANJA_COBRIZO = P("GLOBO REDONDO FASHION NARANJA COBRIZO", "/products/globo-latex-redondo-fashion-naranja-cobrizo", "R-12", "062");
const ORQUIDEA = P("GLOBO REDONDO FASHION ORQUIDEA MORADA", "/products/globo-para-fiesta-latex-redondo-fashion-orquidea-morada", "R-12", "056");
const REFLEX_DORADO = P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970");
const NARANJA = P("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061");
const FUCSIA = P("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012");
const ROSADO = P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009");

// ----------------------------------------------------------------------------------------------------------
// 930 · Tenis en casa (juego: un R-12 y dos raquetas de plato)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto cenital de 1000 × 1000: el R-12 mide ~520 px (28 cm: 18,6 px/cm); los platos, ~430 px (23 cm). Cada raqueta es un
 * plato Deluxe Oxo con un cuchillo negro pegado por detrás, el mango afuera (~8 cm).
 */
function raqueta(hex: string, variante: string): Pieza {
  const plato = platos({ cantidad: 1, diametroCm: 23, hex, productoId: "plato-deluxe-oxo", variante });
  if (plato.tipo !== "escenografia") throw new Error("platos() da escenografía");
  const cuchillo: ElementoEscenografia = { forma: "caja", centro: v(11.2, 0.35, 0), tamano: v(15.3, 0.5, 1.8), hex: "#151515", acabado: "brillante" };
  return {
    tipo: "escenografia", utileria: "plato", elementos: [...plato.elementos, cuchillo],
    productos: [...(plato.productos ?? []), productoDe("cuchillo-desechable-deluxe-oxo", paquetesPara("cuchillo-desechable-deluxe-oxo", 1), "cuchillo desechable", "negro")],
  };
}
const escena930: Escena = {
  sala: sala(320, 280, 280, { piso: "#a88c69" }),
  nodos: [
    { id: "globo", nombre: "R-12 Fashion Azul Hortensia (la pelota)", pieza: { tipo: "globo", formatoId: "R-12", infladoCm: 28, codigo: "042" }, colocacion: { en: "piso", xCm: -14, zCm: 16, giroGrados: 0 } },
    { id: "raqueta-naranja", nombre: "Raqueta de plato naranja", pieza: raqueta("#e2541c", "naranja"), colocacion: { en: "piso", xCm: -20, zCm: -18, giroGrados: -45 } },
    { id: "raqueta-verde", nombre: "Raqueta de plato verde lima", pieza: raqueta("#6fa312", "verde lima"), colocacion: { en: "piso", xCm: 24, zCm: -6, giroGrados: -130 } },
  ],
};
const idea930 = idea({
  id: "idea:tenis-en-casa", numero: 930, slug: "tenis-en-casa", nombre: "Tenis en casa (juego con globo)", ocasiones: ["general"],
  fotoUrl: FOTO("Sempertex-Tenis-en-Casa_1c34111c-200e-47af-83dd-3374c7b9381d.jpg"),
  contenido: { tipo: "escena", escena: escena930 },
  nota: "Igual: un R-12 azul de pelota (la idea no publica productos: medido #1484cd en la cara iluminada → Fashion Azul Hortensia 042) y dos raquetas hechas con un plato desechable de 23 cm (naranja y verde lima: el plato Deluxe Oxo de la tienda) y un cuchillo negro pegado de mango, sobre piso de madera, como en la foto cenital. Distinto: es un juego, no una decoración; el letrero «Indoor Balloon Tennis · Moms & Kids» de la foto no se modela y la cinta adhesiva no se ve.",
}, () => productosDe({ tipo: "escena", escena: escena930 }));

// ----------------------------------------------------------------------------------------------------------
// 940 · Topiario (bola de 12 R-12 con flores de tubito)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: cada R-12 mide ~160 px (28 cm: 5,7 px/cm) y la bola ~470 px (82 cm): los 12 de una geodésica de
 * icosaedro. Las flores rojas (5 burbujas de T-260, ~17 cm) van en los huecos de tres globos: se ven 11, casi todas en
 * el contorno y una sola de frente (arriba a la izquierda), así que en los huecos que miran de frente no hay.
 */
const BOLA_940: Pieza = { tipo: "forma", forma: { clase: "esfera", diametroCm: 80, globo: { formatoId: "R-12", infladoCm: 28 }, colores: { codigos: ["032"], patron: "un_color" } } };
const FLOR_ROJA_940 = florTubito({ petalos: burbujas("T-260", 4.5, ["015"], 5, 7.5, 10, 0) });
/** Los huecos de tres globos (caras de la geodésica): centro y normal hacia fuera, en el espacio de la bola. */
function huecosDeBola(pieza: Pieza): Array<{ p: Vec3; n: Vec3 }> {
  const cs = centrosDe(pieza).map((x) => x.c);
  const centro = por(cs.reduce((a, b) => mas(a, b), v(0, 0, 0)), 1 / cs.length);
  let minima = Infinity;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) minima = Math.min(minima, largo(menos(cs[i]!, cs[j]!)));
  const vecinos = (i: number, j: number) => largo(menos(cs[i]!, cs[j]!)) < minima * 1.25;
  const salida: Array<{ p: Vec3; n: Vec3 }> = [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) for (let k = j + 1; k < cs.length; k++) {
    if (!vecinos(i, j) || !vecinos(j, k) || !vecinos(i, k)) continue;
    const m = por(mas(cs[i]!, mas(cs[j]!, cs[k]!)), 1 / 3);
    salida.push({ p: m, n: unitario(menos(m, centro)) });
  }
  return salida.sort((a, b) => b.n.y - a.n.y || a.n.x - b.n.x || a.n.z - b.n.z);
}
const HUECOS_940 = (() => {
  const todos = huecosDeBola(BOLA_940);
  const frente = todos.reduce((a, b) => (punto3(b.n, unitario(v(-0.5, 0.35, 0.8))) > punto3(a.n, unitario(v(-0.5, 0.35, 0.8))) ? b : a));
  return todos.filter((h) => h.n.z <= 0.55 || h === frente);
})();
const escena940: Escena = {
  sala: structuredClone(SALA_CHICA),
  nodos: [
    { id: "mesa", nombre: "Mesa", pieza: { tipo: "escenografia", elementos: MESA() }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    { id: "bola", nombre: "Bola de 12 R-12 Verde Selva", pieza: BOLA_940, colocacion: { en: "libre", xCm: 0, yCm: ALTO_MESA + 0.5, zCm: 0, giroGrados: 0 } },
    ...HUECOS_940.map((h, i) => decoSobre(`flor-${i + 1}`, `Flor roja de 5 burbujas ${i + 1}`, "bola", FLOR_ROJA_940, h.p, h.n, i * 23)),
  ],
};
const idea940 = idea({
  id: "idea:topiario", numero: 940, slug: "topiario", nombre: "Topiario: bola verde con flores rojas", ocasiones: ["navidad"],
  fotoUrl: FOTO("dac52ce5b6558e12f6dd03416b5a1c94_d4e5fb4b-ece4-4618-8912-7fa25ea5de6d.jpg"),
  contenido: { tipo: "escena", escena: escena940 },
  nota: `Igual: bola de 12 R-12 (la geodésica de icosaedro: se ven 9 y 3 quedan detrás) en verde oscuro (la idea no publica productos: medido #086b38 → Fashion Verde Selva 032) de ~82 cm, con flores rojas de 5 burbujas de T-260 Fashion Rojo (medido #e51619 → 015) metidas en los huecos de tres globos: ${HUECOS_940.length} flores, todas las del contorno y la de frente arriba a la izquierda (en la foto se ven 11). Distinto: la foto no muestra base ni tallo (por «topiario» podría ir en una maceta): aquí va sobre una mesa redonda; las flores de detrás se suponen.`,
}, () => productosDe({ tipo: "escena", escena: escena940 }));

// ----------------------------------------------------------------------------------------------------------
// 947 · Tropical Sunset (ramo)
// ----------------------------------------------------------------------------------------------------------

/** Foto de 1000 × 1000: R-12 de 175 px (28 cm: 6,25 px/cm); un piso cada ~170 px (27 cm). */
const escena947 = escenaRamo({
  pisos: [
    piso(120, DOS_Y_DETRAS_DERECHA, R("R-12", 28, "056")),
    piso(147, tres(0), R("R-12", 28, "062")),
    piso(174, tres(60), R("R-12", 28, "027")),
    piso(201, tres(0), R("R-12", 28, "021")),
  ],
  cinta: "#ebe3cf", peso: "#c9c9cf",
});
const idea947 = idea({
  id: "idea:tropical-sunset-1", numero: 947, slug: "tropical-sunset-1", nombre: "Ramo Tropical Sunset", ocasiones: ["general"],
  fotoUrl: FOTO("Tropical_Sunset_b4855735-7136-480e-a1f8-cb3212265d63.jpg"),
  contenido: { tipo: "escena", escena: escena947 },
  nota: "Igual: 12 R-12 en 4 pisos con los 4 productos que publica la idea, de abajo arriba 3 Orquídea Morada (dos de frente y uno que asoma detrás a la derecha), 3 Naranja Cobrizo, 3 Eucalipto (el tercero asoma entre los dos de frente, por detrás) y 3 Amarillo Miel, cada piso girado sobre el de abajo y con su cinta crema al peso. Distinto: el peso no sale en la foto (cortada) y el largo de las cintas es supuesto; el naranja del centro se ve más claro por el brillo (mismo producto).",
}, () => productosDe({ tipo: "escena", escena: escena947 }, [AMARILLO_MIEL, EUCALIPTO, NARANJA_COBRIZO, ORQUIDEA]));

// ----------------------------------------------------------------------------------------------------------
// 974 · Vibrant Festival (ramo)
// ----------------------------------------------------------------------------------------------------------

/** Foto de 1000 × 1000: R-12 de ~165 px (28 cm: 5,9 px/cm); un piso cada ~170 px (29 cm). */
const escena974 = escenaRamo({
  pisos: [
    piso(120, DOS_Y_DETRAS_DERECHA, R("R-12", 28, "062")),
    piso(149, tres(0), R("R-12", 28, "037")),
    piso(178, DOS_Y_DETRAS_DERECHA, R("R-12", 28, "056")),
    piso(207, tres(0), R("R-12", 28, "029")),
    piso(236, cuatro(45), R("R-12", 28, "021"), 24),
  ],
  cinta: "#ebe3cf", peso: "#c9c9cf",
});
const idea974 = idea({
  id: "idea:vibrant-festival-1", numero: 974, slug: "vibrant-festival-1", nombre: "Ramo Vibrant Festival", ocasiones: ["general"],
  fotoUrl: FOTO("Vibrant_Festival.jpg"),
  contenido: { tipo: "escena", escena: escena974 },
  nota: "Igual: 16 R-12 en 5 pisos con los 5 productos que publica la idea, de abajo arriba 3 Naranja Cobrizo (dos de frente y uno que asoma detrás a la derecha), 3 Aguamarina, 3 Orquídea Morada (uno detrás a la derecha), 3 Verde Trébol y 4 Amarillo Miel (dos de frente y dos detrás), con cintas crema al peso. Distinto: la foto mide el turquesa más cerca de Azul Caribe 038 (#0097a4) y el naranja más cerca de Fashion Naranja 061 (#e25301), pero van los códigos publicados (Aguamarina 037 y Naranja Cobrizo 062); el peso no sale en la foto.",
}, () => productosDe({ tipo: "escena", escena: escena974 }, [
    AMARILLO_MIEL, P("GLOBO REDONDO FASHION VERDE TREBOL", "/products/globo-latex-redondo-fashion-verde-trebol", "R-12", "029"), ORQUIDEA,
    P("GLOBO LATEX REDONDO FASHION AGUAMARINA", "/products/globo-para-fiesta-latex-redondo-fashion-aguamarina", "R-12", "037"), NARANJA_COBRIZO,
  ]));

// ----------------------------------------------------------------------------------------------------------
// 979 · Watercolor Collection (ramo)
// ----------------------------------------------------------------------------------------------------------

/** Foto de 1000 × 1000: R-12 de ~160 px (28 cm: 5,7 px/cm); un piso cada ~160 px (28 cm). */
const escena979 = escenaRamo({
  pisos: [
    piso(120, DOS_Y_DETRAS_IZQUIERDA, R("R-12", 28, "009")),
    piso(148, tres(0), R("R-12", 28, "050")),
    piso(176, DOS, R("R-12", 28, "970"), 20),
    piso(204, tres(0), R("R-12", 28, "650")),
    piso(232, tres(60), R("R-12", 28, "609")),
  ],
  cinta: "#e9e2d8", peso: "#c9c9cf",
});
const idea979 = idea({
  id: "idea:watercolor-collection", numero: 979, slug: "watercolor-collection", nombre: "Ramo Watercolor Collection", ocasiones: ["general"],
  fotoUrl: FOTO("Watercolor_Collection.png"),
  contenido: { tipo: "escena", escena: escena979 },
  nota: "Igual: 14 R-12 en 5 pisos con los 5 productos que publica la idea, de abajo arriba 3 Fashion Rosado (el fucsia de la foto: dos de frente y uno detrás a la izquierda), 3 Fashion Lila (el morado), 2 Reflex Dorado lado a lado, 3 Pastel Mate Lila y 3 Pastel Mate Rosado (el tercero asoma entre los dos de arriba, por detrás), con cintas blancas al peso. Distinto: en la foto el «rosado» de abajo se ve fucsia (#c42d80) y el Fashion Lila, violeta (#9a76c4): van los códigos publicados; el peso no sale en la foto.",
}, () => productosDe({ tipo: "escena", escena: escena979 }, [
    P("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609"),
    P("GLOBO REDONDO PASTEL MATE LILA", "/products/globo-para-fiesta-latex-redondo-pastel-mate-lila", "R-12", "650"),
    REFLEX_DORADO,
    P("GLOBO REDONDO FASHION LILA", "/products/globo-para-fiesta-latex-redondo-fashion-lila", "R-12", "050"),
    ROSADO,
  ]));

// ----------------------------------------------------------------------------------------------------------
// 30 · Araña LOL (de pared)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: las patas de T-260 miden ~15 px de grueso (4,5 cm: 3,3 px/cm). Cabeza R-18 de ~155 px (44 cm) con
 * la cara impresa; el cuerpo es un racimo de R-5 (~40 px: 12 cm) detrás y debajo de la cabeza, de ~68 cm de ancho; las
 * 8 patas articuladas abren ~1,95 m de punta a punta. El racimo se arma sobre un R-12 negro de núcleo (del que salen las
 * patas): cada R-5 va hacia fuera del núcleo y se apoya en él o en la cabeza.
 */
const ARANA_30: Pieza = {
  tipo: "decoracion", deFrente: true,
  decoracion: arana({ cuerpo: R("R-12", 28, "080"), cabeza: R("R-18", 42, "080"), ojos: { hexIris: "#62b83c" }, patas: { formatoId: "T-260", grosorCm: 4.5, codigo: "080", largoCm: 112, estilo: "articuladas" }, giroGrados: 0 }),
};
/**
 * 22 direcciones repartidas (espiral de Fibonacci) alrededor del núcleo, en la franja que se ve: ni de frente (la tapa la
 * cabeza) ni del todo hacia atrás (ahí está la pared).
 */
const RACIMO_30: Vec3[] = (() => {
  const franja: Vec3[] = [];
  const n = 120;
  for (let k = 0; k < n; k++) {
    const y = 1 - (2 * (k + 0.5)) / n, r = Math.sqrt(1 - y * y), a = k * rad(137.5);
    const d = v(r * Math.cos(a), y, r * Math.sin(a));
    if (d.z >= -0.3 && d.z <= 0.45) franja.push(redondo(d));
  }
  return Array.from({ length: 22 }, (_, i) => franja[Math.floor((i * franja.length) / 22)]!);
})();
const escena30: Escena = {
  sala: structuredClone(SALA_CHICA),
  nodos: [
    { id: "arana", nombre: "Araña negra de patas articuladas", pieza: ARANA_30, colocacion: enLaPared(ARANA_30, 125) },
    ...RACIMO_30.map((d, i) => globoSobre(`racimo-${i + 1}`, `R-5 Fashion Negro del racimo ${i + 1}`, "arana", R("R-5", 12, "080"), por(d, 14 + 6), d)),
  ],
};
const idea30 = idea({
  id: "idea:arana-lol", numero: 30, slug: "arana-lol", nombre: "Araña de racimo y patas articuladas", ocasiones: ["halloween"],
  fotoUrl: FOTO("ba8ccfda07f4e6df573f8a6679987c09_0238027f-fa29-4917-997d-3e133d92c967.jpg"),
  contenido: { tipo: "escena", escena: escena30 },
  nota: "Igual: cabeza R-18 Fashion Negro (~44 cm) con los ojos verdes impresos (medido #62b83c), un racimo de 22 R-5 negros detrás y debajo de ella y 8 patas articuladas de T-260 negro (3 burbujas cada una, rodilla alta) que abren ~1,9 m, en la pared. La idea no publica productos: negro 080 (medido #1c1d1b). Distinto: la boca roja con colmillos no se modela; el racimo va sobre un R-12 negro de núcleo (no se ve en la foto) y por eso la cabeza queda algo más arriba del centro del racimo que en la foto; «LOL» del título no se ve en la foto (los globitos son redondos).",
}, () => productosDe({ tipo: "escena", escena: escena30 }));

// ----------------------------------------------------------------------------------------------------------
// 61 · Arco araña
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: R-12 de ~60 px (25 cm: 2,4 px/cm). Patas de doble columna (~73 cm de ancho, 6 niveles: 1,26 m)
 * y arriba un arco de cuartetos naranja de eje 206 × 80 cm con parejas de globitos verdes y morados en los huecos; dos
 * arañas (cuerpo R-12, cabeza R-9 con ojos, patas de T-260) encima: una en el pie izquierdo del arco y otra arriba a la
 * derecha.
 */
const PATA_61 = columna("R-12", 25, 6, ["061"]);
const ARCO_61 = arco("R-12", 25, "redondo", 206, 80, "un_color", ["061"]);
const BASE_ARCO_61 = r2(centroNivelColumna(PATA_61, 6));
const ARANA_61 = (giro: number): Decoracion => arana({ cuerpo: R("R-12", 25, "080"), cabeza: R("R-9", 18, "080"), ojos: { hexIris: "#56c8dc" }, patas: { formatoId: "T-260", grosorCm: 3.5, codigo: "080", largoCm: 50, estilo: "articuladas" }, giroGrados: giro });
const NIVELES_61 = nivelesDe(ARCO_61);
const escena61: Escena = {
  sala: structuredClone(SALA_ARCO),
  nodos: [
    { id: "arco", nombre: "Arco de cuartetos naranja", pieza: ARCO_61, colocacion: { en: "libre", xCm: 0, yCm: BASE_ARCO_61, zCm: 0, giroGrados: 0 } },
    { id: "parejas-verdes", nombre: "Globitos verdes de las parejas", pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 11, codigo: "030" }, colocacion: { en: "ancla", padreId: "arco", ancla: 0, cada: 2, giroGrados: 0 } },
    { id: "parejas-moradas", nombre: "Globitos morados de las parejas", pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 11, codigo: "051" }, colocacion: { en: "ancla", padreId: "arco", ancla: 1, cada: 2, giroGrados: 0 } },
    decoSobre("arana-izquierda", "Araña del pie izquierdo", "arco", ARANA_61(15), v(-80, 8, 0), v(0.35, -0.1, 0.93)),
    decoSobre("arana-derecha", "Araña de arriba a la derecha", "arco", ARANA_61(-20), v(62, 48, 0), v(0.1, 0.15, 0.98)),
    { id: "pata-izquierda-fuera", nombre: "Columna naranja (pata izquierda, fuera)", pieza: PATA_61, colocacion: { en: "piso", xCm: -120, zCm: 0, giroGrados: 0 } },
    { id: "pata-izquierda-dentro", nombre: "Columna naranja (pata izquierda, dentro)", pieza: PATA_61, colocacion: { en: "piso", xCm: -86, zCm: 0, giroGrados: 45 } },
    { id: "pata-derecha-dentro", nombre: "Columna naranja (pata derecha, dentro)", pieza: PATA_61, colocacion: { en: "piso", xCm: 86, zCm: 0, giroGrados: 45 } },
    { id: "pata-derecha-fuera", nombre: "Columna naranja (pata derecha, fuera)", pieza: PATA_61, colocacion: { en: "piso", xCm: 120, zCm: 0, giroGrados: 0 } },
  ],
};
const idea61 = idea({
  id: "idea:arco-arana", numero: 61, slug: "arco-arana", nombre: "Arco araña", ocasiones: ["halloween"],
  fotoUrl: FOTO("e7ad962fd565d000a05ceb7dcc7f7f32_42a4e56c-b49f-4fe5-85e8-3c434ea14fd5.jpg"),
  contenido: { tipo: "escena", escena: escena61 },
  nota: `Igual: patas gruesas de dos columnas de cuartetos R-12 Fashion Naranja cada una (6 niveles, 1,26 m), arriba un arco de ${NIVELES_61} cuartetos naranja (eje 2,06 × 0,8 m, sobre las patas) con un globito en cada hueco alternando verde y morado (las «parejas»), y las dos arañas negras del «set araña» (cuerpo R-12, cabeza R-9 con ojos celestes, patas articuladas de T-260) sobre el arco. Colores medidos (no publica productos): naranja #fe7401 → 061, verde #00c898 → Fashion Verde 030, morado #614aca → Violeta 051, negro 080. Distinto: el texto dice «malla con parejas de R-6» para la parte de arriba; aquí es un arco de cuartetos con los globitos en sus huecos (el taller no dobla una malla en arco) y van R-5 (el R-6 no está en la tabla de formatos); las caras pintadas de las arañas solo llevan ojos.`,
}, () => productosDe({ tipo: "escena", escena: escena61 }));

// ----------------------------------------------------------------------------------------------------------
// 65 · Arco azul
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: el arco mide ~130 px de grueso (cuarteto R-12 y R-5: ~50 cm, 2,6 px/cm), 690 px de fuera a fuera y
 * 490 px de alto: eje 209 × 160 cm, redondo. Espiral de tres azules con R-5 de los mismos en todos los huecos y una
 * placa blanca bajo cada pie.
 */
const ARCO_65 = arco("R-12", 25, "redondo", 209, 160, "espiral", ["040", "041", "044", "044"]);
const NIVELES_65 = nivelesDe(ARCO_65);
const RELLENO_65: ReadonlyArray<[number, string, string]> = [[0, "040", "Fashion Azul"], [1, "041", "Fashion Azul Rey"], [2, "044", "Fashion Azul Naval (1)"], [3, "044", "Fashion Azul Naval (2)"]];
const escena65: Escena = {
  sala: structuredClone(SALA_ARCO),
  nodos: [
    { id: "arco", nombre: "Arco espiral de tres azules", pieza: ARCO_65, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    ...RELLENO_65.map(([hueco, codigo, nombre]): NodoEscena => ({ id: `relleno-${hueco + 1}`, nombre: `R-5 ${nombre} en los huecos`, pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 11, codigo }, colocacion: { en: "ancla", padreId: "arco", ancla: hueco, cada: 4, giroGrados: 0 } })),
    ...[-1, 1].map((s): NodoEscena => ({ id: `base-${s < 0 ? "izquierda" : "derecha"}`, nombre: `Placa del pie ${s < 0 ? "izquierdo" : "derecho"}`, pieza: { tipo: "escenografia", elementos: [{ forma: "caja", centro: v(0, 0.5, 0), tamano: v(46, 1, 46), hex: "#dcdcdc", acabado: "satinado" }] }, colocacion: { en: "piso", xCm: s * 104.5, zCm: 0, giroGrados: 0 } })),
  ],
};
const idea65 = idea({
  id: "idea:arco-azul", numero: 65, slug: "arco-azul", nombre: "Arco azul en espiral", ocasiones: ["cumpleaños"],
  fotoUrl: FOTO("e63ea12705edd8a6ca1a0529d7426575_0f8c89ff-a852-4e3f-965b-fb0ac1a684aa.jpg"),
  contenido: { tipo: "escena", escena: escena65 },
  nota: `Igual: arco redondo de ${NIVELES_65} cuartetos R-12 (eje 2,09 × 1,6 m) en espiral de tres azules —claro, medio y oscuro, el oscuro de banda doble como en la foto— con un R-5 en cada hueco del color de su banda y una placa blanca bajo cada pie. La idea no publica productos; medidos (la foto está muy saturada): claro #00b4fa → Fashion Azul 040, medio #015cd9 → Fashion Azul Rey 041, oscuro #002f74 → Fashion Azul Naval 044. Distinto: los oscuros de la foto brillan como cristal o metal; van en Fashion (el más cercano de los azules); la espiral de la foto gira más despacio que la del taller (1/8 por nivel).`,
}, () => productosDe({ tipo: "escena", escena: escena65 }));

// ----------------------------------------------------------------------------------------------------------
// 87 · Arco espiral
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: R-12 de ~55 px (25 cm: 2,2 px/cm); 645 px de fuera a fuera y 525 de alto: eje 238 × 211 cm,
 * redondo. Espiral de cuatro: vino, perla, verde, perla, y una hilera seguida de R-5 perla que va en espiral sobre el
 * borde de una banda: un R-5 en un hueco de cada nivel (los huecos giran con la trenza) y otro entre nivel y nivel.
 */
const ARCO_87 = arco("R-12", 25, "redondo", 238, 211, "espiral", ["915", "806", "030", "806"]);
const NIVELES_87 = nivelesDe(ARCO_87);
const HUECO_HILERA_87 = 1;
const PERLA_87 = R("R-5", 10, "806");
const ENTRE_NIVELES_87: NodoEscena[] = (() => {
  const anclas = anclasDe(ARCO_87);
  const salida: NodoEscena[] = [];
  for (let k = 0; k + 1 < NIVELES_87; k++) {
    const a = anclas[k * 4 + HUECO_HILERA_87]!, b = anclas[(k + 1) * 4 + HUECO_HILERA_87]!;
    const n = unitario(mas(a.normal, b.normal));
    const p = por(mas(a.posicion, b.posicion), 0.5);
    salida.push(globoSobre(`hilera-${k + 1}`, `R-5 Silk Blanco Nácar de la hilera (entre los niveles ${k + 1} y ${k + 2})`, "arco", PERLA_87, mas(p, por(n, PERLA_87.infladoCm / 2)), n));
  }
  return salida;
})();
const escena87: Escena = {
  sala: structuredClone(SALA_ARCO),
  nodos: [
    { id: "arco", nombre: "Arco espiral vino, perla y verde", pieza: ARCO_87, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    { id: "hilera-huecos", nombre: "R-5 Silk Blanco Nácar de la hilera (en los huecos)", pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 10, codigo: "806" }, colocacion: { en: "ancla", padreId: "arco", ancla: HUECO_HILERA_87, cada: 4, giroGrados: 0 } },
    ...ENTRE_NIVELES_87,
  ],
};
const idea87 = idea({
  id: "idea:arco-espiral", numero: 87, slug: "arco-espiral", nombre: "Arco espiral vino, verde y perla", ocasiones: ["general"],
  fotoUrl: FOTO("9cf6347c9d24db5f5481ff1849c9e521_8716e337-a070-4d8c-8926-dc94fe28c4cc.jpg"),
  contenido: { tipo: "escena", escena: escena87 },
  nota: `Igual: arco redondo de ${NIVELES_87} cuartetos R-12 (eje 2,38 × 2,11 m) en espiral de cuatro bandas —vino, perla, verde, perla— y una hilera seguida de R-5 perla en espiral (${NIVELES_87 * 2 - 1} R-5: uno por nivel y otro entre nivel y nivel). La idea no publica productos; medidos: vino #af2244 → Reflex Cristal Rojo 915, perla #c9cfcb → Silk Blanco Nácar 806, verde #00987d → Fashion Verde 030 (los verdes perlados de la foto quedan entre 030 y Reflex Verde Aurora 932). Distinto: en la foto la espiral es algo más abierta y la hilera corre por el borde de la banda perla; aquí sigue un hueco de la trenza (va por el borde perla y verde).`,
}, () => productosDe({ tipo: "escena", escena: escena87 }));

// ----------------------------------------------------------------------------------------------------------
// 94 · Arco floral
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: un nivel cada ~30 px y globos de ~37 px (R-9 a 18 cm: 2 px/cm; con R-12 el arco saldría de 4 m).
 * Patas blancas de 7 niveles (~1 m) y arco verde encima, de eje 266 cm entre patas y 2,43 m de alto; 10 florecitas de
 * 5 burbujas de T-260 (~15 cm) alternando rojo y amarillo, desde el pie izquierdo.
 */
const PATA_94 = columna("R-9", 18, 7, ["005"]);
const BASE_ARCO_94 = r2(centroNivelColumna(PATA_94, 7));
const ARCO_94 = arco("R-9", 18, "redondo", 266, r2(243 - BASE_ARCO_94), "un_color", ["032"]);
const NIVELES_94 = nivelesDe(ARCO_94);
const FLOR_94 = (codigo: string) => florTubito({ petalos: burbujas("T-260", 3, [codigo], 5, 6.5, 0, 90) });
const FLORES_94 = Array.from({ length: 10 }, (_, k) => ({ nivel: Math.round((0.02 + (k * 0.96) / 9) * (NIVELES_94 - 1)), rojo: k % 2 === 0 }));
const escena94: Escena = {
  sala: structuredClone(SALA_ARCO),
  nodos: [
    { id: "arco", nombre: "Arco de cuartetos verde", pieza: ARCO_94, colocacion: { en: "libre", xCm: 0, yCm: BASE_ARCO_94, zCm: 0, giroGrados: 0 } },
    ...FLORES_94.map((f, k) => enNivel(`flor-${k + 1}`, `Florecita ${f.rojo ? "roja" : "amarilla"} ${k + 1}`, "arco", ARCO_94, f.nivel, FLOR_94(f.rojo ? "015" : "020"))),
    { id: "pata-izquierda", nombre: "Pata blanca izquierda", pieza: PATA_94, colocacion: { en: "piso", xCm: -133, zCm: 0, giroGrados: 0 } },
    { id: "pata-derecha", nombre: "Pata blanca derecha", pieza: PATA_94, colocacion: { en: "piso", xCm: 133, zCm: 0, giroGrados: 0 } },
  ],
};
const idea94 = idea({
  id: "idea:arco-floral", numero: 94, slug: "arco-floral", nombre: "Arco floral verde y blanco", ocasiones: ["navidad"],
  fotoUrl: FOTO("019e797eb4d9cf6285fcba02dd1ce53d_bb00538b-79db-43f9-b016-d7556b153c42.jpg"),
  contenido: { tipo: "escena", escena: escena94 },
  nota: `Igual: patas de 7 cuartetos R-9 blancos (~1 m) y encima un arco de ${NIVELES_94} cuartetos R-9 verdes hasta 2,43 m, con las 10 florecitas de 5 burbujas de T-260 que se ven de frente, alternando roja y amarilla desde el pie izquierdo. La idea no publica productos; medidos: verde #01631f → Fashion Verde Selva 032, blanco 005, rojo #ff3939 → Fashion Rojo 015, amarillo #cce103 → Fashion Amarillo 020 (Neón Amarillo 220 queda a 2 ΔE). Distinto: el texto dice «flores de T 260 Stdo» y la clasificación supone 14; en la foto se ven 10 (las de atrás no se ven y no se ponen); el tamaño sale de contar niveles (no hay otra referencia en la foto).`,
}, () => productosDe({ tipo: "escena", escena: escena94 }));

// ----------------------------------------------------------------------------------------------------------
// 95 · Arco flores rosadas y amarillas
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: globos de ~48 px (R-12 a 25 cm: 1,9 px/cm, con los R-5 de las flores a ~11 cm). Arco redondo de eje
 * 318 × 231 cm; 15 flores de 5 R-5 de frente, una cada dos niveles (donde el texto pone un LOL-12 para anudarla),
 * alternando rosada (centro amarillo) y amarilla (centro rosado) desde el pie izquierdo.
 */
const ARCO_95 = arco("R-12", 25, "redondo", 318, 231, "un_color", ["029"]);
const NIVELES_95 = nivelesDe(ARCO_95);
const FLOR_ROSADA_95 = flor({ petalos: { ...R("R-5", 11, "012"), cantidad: 5, aperturaGrados: 10, giroGrados: 90 }, centro: { ...R("R-5", 9, "023"), cantidad: 1 } });
const FLOR_AMARILLA_95 = flor({ petalos: { ...R("R-5", 11, "020"), cantidad: 5, aperturaGrados: 10, giroGrados: 90 }, centro: { ...R("R-5", 9, "012"), cantidad: 1 } });
const PRIMER_NIVEL_95 = Math.max(0, Math.round((NIVELES_95 - 1 - 28) / 2));
const escena95: Escena = {
  sala: structuredClone(SALA_ARCO),
  nodos: [
    { id: "arco", nombre: "Arco de cuartetos verde", pieza: ARCO_95, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    ...Array.from({ length: 15 }, (_, k) => enNivel(`flor-${k + 1}`, `Flor ${k % 2 === 0 ? "rosada" : "amarilla"} ${k + 1}`, "arco", ARCO_95, Math.min(NIVELES_95 - 1, PRIMER_NIVEL_95 + 2 * k), k % 2 === 0 ? FLOR_ROSADA_95 : FLOR_AMARILLA_95)),
  ],
};
const idea95 = idea({
  id: "idea:arco-flores-rosadas-y-amarillas", numero: 95, slug: "arco-flores-rosadas-y-amarillas", nombre: "Arco verde con flores rosadas y amarillas", ocasiones: ["cumpleaños"],
  fotoUrl: FOTO("f6b5f26ff1a97abf6c314c89fd4ec754_26c8e7ca-6eef-43fb-97a3-f5bb2b15350c.jpg"),
  contenido: { tipo: "escena", escena: escena95 },
  nota: `Igual: arco redondo de ${NIVELES_95} cuartetos R-12 verdes (eje 3,18 × 2,31 m) con las 15 flores de 5 R-5 que se ven, una cada dos cuartetos como dice el texto, alternando rosada con centro amarillo (8) y amarilla con centro rosado (7) desde el pie izquierdo. La idea no publica productos; medidos (foto muy saturada): verde #00c800 → Fashion Verde Trébol 029, pétalos rosados #fa4b86 → Fashion Fucsia 012, centro #ed9c02 → Fashion Mostaza 023, pétalos amarillos translúcidos sobre el verde → Fashion Amarillo 020. Distinto: el LOL-12 donde se anuda cada flor no se modela (el arco es todo de R-12) y los centros rosados van en el mismo Fucsia de los pétalos (miden algo más claro).`,
}, () => productosDe({ tipo: "escena", escena: escena95 }));

// ----------------------------------------------------------------------------------------------------------
// 97 · Arco girasoles
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: un nivel cada ~35 px (R-12 a 25 cm: 1,75 px/cm, con el centro de cada girasol, un R-9 de ~30 px).
 * Arco parabólico (patas rectas, arriba redondo) de eje 304 × 294 cm; 4 girasoles de 8 lazos de T-260 (~35 cm de pétalo)
 * donde el texto pone un LOL-12 para anudarlos.
 */
const ARCO_97 = arco("R-12", 25, "parabolico", 304, 294, "un_color", ["530"]);
const NIVELES_97 = nivelesDe(ARCO_97);
const GIRASOL_97 = florTubito({ petalos: lazos("T-260", 3, ["021"], 8, 33, 9, 0, 0), centro: R("R-9", 18, "018") });
/** Centro de cada girasol en la foto (px) → cm del arco (origen al centro, entre los pies). */
const GIRASOLES_97: ReadonlyArray<[number, number]> = [[290, 80], [590, 165], [135, 298], [590, 455]];
const escena97: Escena = {
  sala: sala(600, 500, 360),
  nodos: [
    { id: "arco", nombre: "Arco de cuartetos Metal Verde", pieza: ARCO_97, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    ...GIRASOLES_97.map(([px, py], k) => decoSobre(`girasol-${k + 1}`, `Girasol ${k + 1}`, "arco", GIRASOL_97, v(r2((px - 370) / 1.75), r2((545 - py) / 1.75 - 14), 0), AL_FRENTE, k * 11)),
  ],
};
const idea97 = idea({
  id: "idea:arco-girasoles", numero: 97, slug: "arco-girasoles", nombre: "Arco girasoles", ocasiones: ["cumpleaños"],
  fotoUrl: FOTO("6dce277157f9e7de735961972eea30e4_fcf9828e-08a3-4d5e-8449-1154ac7a69dd.jpg"),
  contenido: { tipo: "escena", escena: escena97 },
  nota: `Igual: arco de ${NIVELES_97} cuartetos R-12 Metal Verde 530 (el que dice el texto; la foto mide #019a00, más cerca de Verde Trébol 029, pero el texto manda) de patas rectas y arriba redondo (eje 3,04 × 2,94 m) con los 4 girasoles de la foto: 8 lazos de T-260 y un R-9 de centro. La idea no publica productos; medidos: lazos #bf9900 → el más cercano es Fashion Mostaza 023, que la tienda no vende en T-260: va el siguiente, Fashion Amarillo Miel 021 (sobre el verde la medida se corre); centro #5e1201 → Fashion Merlot 018. Distinto: el LOL-12 donde se anuda cada girasol no se modela; los lazos de la foto se ven más finos (T-260 poco inflado: va a 3 cm).`,
}, () => productosDe({ tipo: "escena", escena: escena97 }));

// ----------------------------------------------------------------------------------------------------------
// 119 · Arco orgánico amor (sin foto)
// ----------------------------------------------------------------------------------------------------------

const ARCO_119: Pieza = {
  tipo: "arco_organico",
  arco: { anchoCm: 220, altoCm: 230, radioBaseCm: 32, radioPuntaCm: 22, semilla: 119, densidad: 1, colores: [{ codigo: "970", peso: 1 }, { codigo: "015", peso: 1 }, { codigo: "012", peso: 1 }, { codigo: "009", peso: 1 }], flores: null, huecosFlores: 0 },
};
const escena119: Escena = { sala: structuredClone(SALA_ARCO), nodos: [{ id: "arco", nombre: "Arco orgánico dorado, rojo, fucsia y rosado", pieza: ARCO_119, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
const PUBLICADOS_119 = [REFLEX_DORADO, P("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"), FUCSIA, ROSADO];
const idea119: IdeaDigitalizada = {
  id: "idea:arco-organico-amor", numero: 119, slug: "arco-organico-amor", nombre: "Arco orgánico amor", ocasiones: ["amor"],
  fotoUrl: "https://sempertex.com/cdn/shop/files/logosptx_1200x1200_1.png",
  productos: PUBLICADOS_119.map((p) => ({ ...p, cantidad: null })),
  contenido: { tipo: "escena", escena: escena119 },
  nota: "Igual: los 4 productos que publica la idea (Reflex Dorado 970, Fashion Rojo 015, Fashion Fucsia 012 y Fashion Rosado 009) en un arco orgánico de dos patas (2,2 × 2,3 m, grandes abajo y finos arriba, relleno de R-9 y tríos de R-5), en partes iguales. Distinto: la idea no tiene foto (su imagen es el logo de Sempertex): la forma, el tamaño y la mezcla son los de un arco orgánico estándar del taller, no copiados de nada, y por eso los productos quedan sin cantidad.",
};

// ----------------------------------------------------------------------------------------------------------
// 125 · Arco orgánico satín pastel (rectangular)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-12 grandes miden ~55 px (25 cm: 2,2 px/cm). Arco de esquinas redondeadas, eje de 214 cm
 * entre patas y 220 cm de alto; patas de ~45 cm de grueso, base de ~73 y travesaño de ~50. Siete perlados en partes
 * iguales, de R-12 a R-5.
 */
const COLORES_125: ColorOrganico[] = ["450", "440", "409", "826", "870", "806", "663"].map((codigo) => ({ codigo, peso: 1 }));
const ARCO_125: Pieza = {
  tipo: "organico", flores: null,
  opciones: opcionesArcoRectangular({
    anchoEjeCm: 214, altoEjeCm: 220, radioEsquinaCm: 40, radioBaseCm: 36, radioPataCm: 23, radioArribaCm: 25, hueco: null,
    mezcla: { base: { "R-12": 1, "R-9": 0.6, "R-5": 0.3 }, pata: { "R-12": 1, "R-9": 0.8, "R-5": 0.4 }, arriba: { "R-12": 1, "R-9": 0.9, "R-5": 0.5 } },
    colores: COLORES_125, semilla: 125,
  }),
};
const escena125: Escena = { sala: structuredClone(SALA_ARCO), nodos: [{ id: "arco", nombre: "Arco orgánico rectangular perlado pastel", pieza: ARCO_125, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
const idea125 = idea({
  id: "idea:arco-organico-satin-pastel", numero: 125, slug: "arco-organico-satin-pastel", nombre: "Arco orgánico satín pastel", ocasiones: ["cumpleaños"],
  fotoUrl: FOTO("2785371d9264f570b6bc59b6951b896d.jpg"),
  contenido: { tipo: "escena", escena: escena125 },
  nota: "Igual: arco orgánico de esquinas redondeadas (eje 2,14 × 2,2 m) más grueso en la base, en siete perlados pastel en partes iguales, de R-12 a R-5 como en la foto. La idea no publica productos; medidos y del acabado perlado (Satín si lo hay en ese color): lila #c7a6e2 → Satín Lila 450, azul #b6daf0 → Satín Azul 440 (Pastel Mate Azul queda a 1 ΔE, pero es mate), rosado #e8b6cc → Satín Rosado 409, verde #7e9e91 → Silk Verde Menta 826, amarillo #b4a882 → Silk Dorado 870, perla #dddbe3 → Silk Blanco Nácar 806, durazno #e6c7b3 → Pastel Mate Melón 663 (no hay durazno perlado). Distinto: las cantidades son las del motor orgánico para ese tamaño, no contadas globo a globo; en la foto hay algunos perlados translúcidos chicos (tipo cristal) que no se distinguen.",
}, () => productosDe({ tipo: "escena", escena: escena125 }));

// ----------------------------------------------------------------------------------------------------------
// 126 · Arco orgánico tropical (semiarco en escalón)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los globos medianos miden ~45 px (R-9 a 17 cm: 2,65 px/cm), el R-24 amarillo de abajo ~150 px
 * (57 cm). Sube del piso junto al R-24, dobla arriba a la izquierda y sigue en horizontal hasta un R-18 fucsia y un
 * R-18 amarillo; un R-12 verde grande en la esquina. Origen: el piso bajo el R-24.
 */
const px126 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 165) / 2.65), r2((565 - y) / 2.65), z);
const COLORES_126: ColorOrganico[] = ["012", "031", "038", "020", "061"].map((codigo) => ({ codigo, peso: 1 }));
const MEZCLA_126: PuntoMezcla[] = [{ t: 0, pesos: { "R-12": 0.35, "R-9": 0.45, "R-5": 0.2 } }, { t: 1, pesos: { "R-12": 0.35, "R-9": 0.45, "R-5": 0.2 } }];
const SEMIARCO_126: Pieza = {
  tipo: "organico", flores: null,
  opciones: opcionesRacimosLibres({
    racimos: [{ id: "escalon", nombre: "Escalón", puntos: [px126(208, 388), px126(228, 320), px126(225, 240), px126(250, 175), px126(320, 160), px126(420, 150), px126(520, 150), px126(590, 150)], radioInicioCm: 14, radioFinCm: 18, mezcla: MEZCLA_126, tapas: { inicio: true, fin: true } }],
    colores: COLORES_126, semilla: 126, suelo: true,
  }),
};
const GRANDES_126: ReadonlyArray<{ id: string; nombre: string; g: ParteGlobo; centro: Vec3; hacia: Vec3 }> = [
  { id: "r24-amarillo", nombre: "R-24 Fashion Amarillo (abajo)", g: R("R-24", 56, "020"), centro: px126(158, 452, 4), hacia: v(-0.85, -0.3, 0.3) },
  { id: "r12-verde", nombre: "R-12 Fashion Verde Lima grande (esquina)", g: R("R-12", 30, "031"), centro: px126(230, 115, -4), hacia: v(-0.3, 0.9, -0.2) },
  { id: "r18-fucsia", nombre: "R-18 Fashion Fucsia (punta)", g: R("R-18", 42, "012"), centro: px126(550, 50, -6), hacia: v(0.2, 0.95, -0.2) },
  { id: "r18-amarillo", nombre: "R-18 Fashion Amarillo (punta)", g: R("R-18", 36, "020"), centro: px126(625, 95, -2), hacia: v(0.9, 0.35, 0) },
];
const escena126: Escena = {
  sala: structuredClone(SALA_CHICA),
  nodos: [
    { id: "semiarco", nombre: "Semiarco orgánico tropical en escalón", pieza: SEMIARCO_126, colocacion: { en: "libre", xCm: -95, yCm: 0, zCm: -90, giroGrados: 0 } },
    ...GRANDES_126.map((x) => globoSobre(x.id, x.nombre, "semiarco", x.g, x.centro, x.hacia)),
  ],
};
const idea126 = idea({
  id: "idea:arco-organico-tropical", numero: 126, slug: "arco-organico-tropical", nombre: "Arco orgánico tropical en escalón", ocasiones: ["general"],
  fotoUrl: FOTO("db2857dd0665c63f36c402bc295c67a7_d1b7dd2b-fa90-4e4a-8d9b-9ec00c97b6c1.jpg"),
  contenido: { tipo: "escena", escena: escena126 },
  nota: "Igual: semiarco orgánico en escalón (sube ~1,3 m desde el piso, dobla y sigue ~1,5 m en horizontal: 2,1 m de alto) de R-12, R-9 y R-5 en los 5 colores que publica la idea (Fucsia 012, Verde Lima 031, Azul Caribe 038, Amarillo 020 y Naranja 061) en partes iguales, con un R-24 amarillo en el pie, un R-12 verde grande en la esquina y un R-18 fucsia y otro amarillo en la punta, como en la foto. Distinto: la foto se ve casi neón (el fucsia mide #fe6cbe, más cerca de Neón Fucsia): van los códigos publicados; el «surtido tropical» queda sin cantidad (sus colores son los de la lista); las cantidades del cuerpo son las del motor orgánico, no contadas una a una.",
}, () => productosDe({ tipo: "escena", escena: escena126 }, [P("GLOBO REDONDO FASHION SURTIDO TROPICAL", "/products/globo-para-fiesta-latex-redondo-fashion-surtido-tropical", "R-12", null), NARANJA, FUCSIA, P("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031"), P("GLOBO REDONDO FASHION AZUL CARIBE", "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", "R-12", "038"), P("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020")]));

// ----------------------------------------------------------------------------------------------------------
// 154 · Arreglo de flores (centro de mesa)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: el tallo de T-260 mide ~45 px (5 cm: 9 px/cm). Base de ~9 burbujas amarillas de T-260 (~9 cm),
 * cuatro tallos de T-260 verde lima con hojas en lazo y cuatro flores de burbujas: azul (7 pétalos, adelante y abajo),
 * naranja (arriba a la izquierda, de lado), rosada (arriba a la derecha) y violeta (detrás, chica).
 */
const BASE_154 = v(0, ALTO_MESA + 9, 0);
const TALLO_154: Tubito = { formatoId: "T-260", grosorCm: 5, codigo: "031" };
const FLORES_154: ReadonlyArray<{ id: string; nombre: string; centro: Vec3; normal: Vec3; deco: Decoracion }> = [
  { id: "flor-azul", nombre: "Flor azul de 7 burbujas", centro: v(-19, ALTO_MESA + 22, 9), normal: v(-0.15, 0.25, 1), deco: florTubito({ petalos: burbujas("T-260", 5, ["040"], 7, 11, 5, 0), centro: R("R-5", 7, "031") }) },
  { id: "flor-naranja", nombre: "Flor naranja de 5 burbujas", centro: v(-29, ALTO_MESA + 49, -2), normal: v(-0.6, 0.55, 0.55), deco: florTubito({ petalos: burbujas("T-260", 5, ["061"], 5, 8, 25, 0) }) },
  { id: "flor-rosada", nombre: "Flor rosada de 5 burbujas", centro: v(13, ALTO_MESA + 47, 0), normal: v(0.45, 0.35, 0.82), deco: florTubito({ petalos: burbujas("T-260", 5, ["009"], 5, 9, 10, 0), centro: R("R-5", 7, "031") }) },
  { id: "flor-violeta", nombre: "Flor violeta de 5 burbujas (detrás)", centro: v(2, ALTO_MESA + 56, -9), normal: v(0, 0.6, 0.8), deco: florTubito({ petalos: burbujas("T-260", 4, ["051"], 5, 6, 15, 0) }) },
];
const escena154: Escena = {
  sala: structuredClone(SALA_CHICA),
  nodos: [
    { id: "mesa", nombre: "Mesa", pieza: { tipo: "escenografia", elementos: MESA() }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    decoSobre("base", "Base de burbujas amarillas", "mesa", florTubito({ petalos: burbujas("T-260", 5, ["020"], 6, 9, 35, 0), interior: burbujas("T-260", 5, ["020"], 3, 8, 70, 60) }), v(0, ALTO_MESA, 0), ARRIBA),
    ...FLORES_154.map((f) => palito(`tallo-${f.id}`, `Tallo de T-260 Verde Lima (${f.nombre.toLowerCase()})`, "mesa", TALLO_154, mas(f.centro, por(unitario(f.normal), -3)), BASE_154)),
    ...FLORES_154.map((f) => decoSobre(f.id, f.nombre, "mesa", f.deco, menos(f.centro, por(unitario(f.normal), 2.5)), f.normal)),
    decoSobre("hojas-izquierda", "Hojas en lazo (izquierda)", "mesa", florTubito({ petalos: lazos("T-260", 4.5, ["031"], 2, 10, 7, 15, 30) }), v(-11, ALTO_MESA + 27, 3), v(-0.4, 0.2, 1)),
    decoSobre("hojas-derecha", "Hojas en lazo (derecha)", "mesa", florTubito({ petalos: lazos("T-260", 4.5, ["031"], 2, 10, 7, 15, 200) }), v(6, ALTO_MESA + 30, 3), v(0.4, 0.2, 1)),
  ],
};
const idea154 = idea({
  id: "idea:arreglo-flores", numero: 154, slug: "arreglo-flores", nombre: "Arreglo de flores de tubito", ocasiones: ["general"],
  fotoUrl: FOTO("6cbc6203c4ebb96217d2c111c280d990_c28b3ee4-7cbb-49de-be85-1d06969f8400.jpg"),
  contenido: { tipo: "escena", escena: escena154 },
  nota: "Igual: base de 9 burbujas de T-260 amarillo, cuatro tallos de T-260 Verde Lima con dos pares de hojas en lazo y las cuatro flores de burbujas de la foto con los tubitos que publica la idea: azul de 7 pétalos adelante, rosada arriba a la derecha (las dos con botón verde), naranja de lado arriba a la izquierda y violeta chica detrás. Va sobre una mesa redonda. Distinto: la flor naranja no está entre los productos publicados (medida #fe8e3a → T-260 Fashion Naranja 061); los botones verdes son burbujitas de tubito y aquí R-5 Verde Lima al mínimo (7 cm); en la foto los tallos se curvan y aquí son rectos; la mesa no sale en la foto.",
}, () => productosDe({ tipo: "escena", escena: escena154 }, [
    P("GLOBO TUBITO FASHION AZUL", "/products/globo-para-fiesta-latex-tubito-fashion-azul", "T-260", "040"),
    P("GLOBO TUBITO FASHION AMARILLO", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", "T-260", "020"),
    P("GLOBO TUBITO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-fashion-verde-lima", "T-260", "031"),
    P("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"),
    P("GLOBO TUBITO FASHION VIOLETA", "/products/globo-para-fiesta-latex-tubito-fashion-violeta", "T-260", "051"),
  ]));

// ----------------------------------------------------------------------------------------------------------
// 160 · Autumn (escena: arco orgánico por tramos y mesa de torta)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: la pared es de bloques de 40 × 20 cm (~68 px por hilada: 3,4 px/cm en la pared). La guirnalda
 * va pegada a la pared desde arriba a la izquierda (sale de la foto), cruza y baja por la derecha hasta el piso; cada
 * color es un tramo: Merlot, Eucalipto, Naranja Cobrizo, Amarillo Miel y Naranja (este último ya en el piso, por
 * delante). R-12 a ~28 cm (~95 px) y algunos grandes (R-18, ~120–165 px). La mesa redonda (~85 cm, alta) va delante.
 */
const PARED_160 = -190;
const px160 = (x: number, y: number, z = 0): Vec3 => v(r2((x - 500) / 3.4), r2((780 - y) / 3.4), z);
type Tramo160 = { id: string; nombre: string; codigo: string; puntos: Vec3[]; radio: [number, number]; grandes: number };
const TRAMOS_160: readonly Tramo160[] = [
  { id: "tramo-merlot", nombre: "Arco orgánico: tramo Merlot", codigo: "018", puntos: [px160(-40, 140), px160(80, 120), px160(190, 150), px160(285, 135)], radio: [34, 34], grandes: 0.14 },
  { id: "tramo-eucalipto", nombre: "Arco orgánico: tramo Eucalipto", codigo: "027", puntos: [px160(300, 120), px160(400, 140), px160(500, 150), px160(590, 170)], radio: [36, 34], grandes: 0 },
  { id: "tramo-cobrizo", nombre: "Arco orgánico: tramo Naranja Cobrizo", codigo: "062", puntos: [px160(600, 190), px160(680, 250), px160(720, 330), px160(730, 410)], radio: [36, 34], grandes: 0.16 },
  { id: "tramo-amarillo", nombre: "Arco orgánico: tramo Amarillo Miel", codigo: "021", puntos: [px160(760, 420), px160(840, 440), px160(880, 520)], radio: [36, 34], grandes: 0.14 },
  { id: "tramo-naranja", nombre: "Arco orgánico: tramo Naranja", codigo: "061", puntos: [px160(820, 600, 10), px160(840, 690, 40), px160(820, 760, 75)], radio: [36, 38], grandes: 0.18 },
];
const tramo160 = (t: Tramo160): Pieza => ({
  tipo: "organico", flores: null,
  opciones: opcionesRacimosLibres({
    racimos: [{ id: t.id, nombre: t.nombre, puntos: t.puntos, radioInicioCm: t.radio[0], radioFinCm: t.radio[1], mezcla: [{ t: 0, pesos: { "R-12": 1, ...(t.grandes ? { "R-18": t.grandes } : {}) } }, { t: 1, pesos: { "R-12": 1, ...(t.grandes ? { "R-18": t.grandes } : {}) } }], tapas: { inicio: true, fin: true } }],
    colores: [{ codigo: t.codigo, peso: 1 }], semilla: 160, suelo: true, relleno: [],
  }),
});
const MESA_160 = { x: -22, z: -40, alto: 95, radio: 42 };
/** Mesa redonda alta con mantel plástico beige hasta el piso (un poco abierto abajo). */
const mesa160: ElementoEscenografia[] = [
  { forma: "cilindro", base: v(0, 0, 0), radioCm: MESA_160.radio + 7, radioArribaCm: MESA_160.radio + 1, altoCm: MESA_160.alto - 1.5, hex: "#e8d5b5", acabado: "brillante" },
  { forma: "cilindro", base: v(0, MESA_160.alto - 1.5, 0), radioCm: MESA_160.radio + 1, altoCm: 1.5, hex: "#e8d5b5", acabado: "brillante" },
];
/** Torta «naked» de tres capas en un pedestal amarillo. */
const torta160: ElementoEscenografia[] = [
  { forma: "cilindro", base: v(0, 0, 0), radioCm: 5, altoCm: 9, hex: "#f2c230", acabado: "satinado" },
  { forma: "cilindro", base: v(0, 9, 0), radioCm: 11, altoCm: 1.2, hex: "#f2c230", acabado: "satinado" },
  ...[0, 1, 2].flatMap((k): ElementoEscenografia[] => [
    { forma: "cilindro", base: v(0, 10.2 + k * 6, 0), radioCm: 9, altoCm: 4.2, hex: "#c58a43", acabado: "mate" },
    { forma: "cilindro", base: v(0, 14.4 + k * 6, 0), radioCm: 9.1, altoCm: 1.8, hex: "#f5efe2", acabado: "mate" },
  ]),
];
const enMesa160 = (dx: number, dz: number, giro = 0): Colocacion => ({ en: "libre", xCm: MESA_160.x + dx, yCm: MESA_160.alto, zCm: MESA_160.z + dz, giroGrados: giro });
const escena160: Escena = {
  sala: sala(420, 380, 300, { piso: "#d4591c", paredes: "#f2f0ec" }),
  nodos: [
    ...TRAMOS_160.map((t): NodoEscena => ({ id: t.id, nombre: t.nombre, pieza: tramo160(t), colocacion: { en: "libre", xCm: 0, yCm: 0, zCm: PARED_160 + 36, giroGrados: 0 } })),
    { id: "mesa", nombre: "Mesa redonda con mantel beige", pieza: { tipo: "escenografia", elementos: mesa160 }, colocacion: { en: "libre", xCm: MESA_160.x, yCm: 0, zCm: MESA_160.z, giroGrados: 0 } },
    { id: "torta", nombre: "Torta en pedestal amarillo", pieza: { tipo: "escenografia", elementos: torta160 }, colocacion: enMesa160(0, -10) },
    { id: "velas", nombre: "Velas doradas", pieza: velas({ cantidad: 3, altoCm: 6, hex: "#d9b04a", productoId: null, descripcion: "velas doradas" }), colocacion: enMesa160(0, -10 + 0, 0) },
    { id: "plato-flores", nombre: "Plato de flores de pie", pieza: platos({ cantidad: 1, diametroCm: 23, hex: "#f6eee6", centro: "#f2a37c", motivo: { dibujo: "lunares", hex: "#e8643a" }, dePie: true, productoId: null, descripcion: "plato desechable con flores naranja" }), colocacion: enMesa160(-26, -14) },
    { id: "plato-naranja", nombre: "Plato naranja de pie", pieza: platos({ cantidad: 1, diametroCm: 23, hex: "#f07a1a", dePie: true, productoId: "plato-deluxe-oxo", variante: "naranja" }), colocacion: enMesa160(25, -14) },
    { id: "platos-mesa", nombre: "Platos blancos", pieza: platos({ cantidad: 2, diametroCm: 18, hex: "#f4f1ec", productoId: null, descripcion: "platos desechables blancos" }), colocacion: enMesa160(4, 12) },
    { id: "vaso-izquierda", nombre: "Vaso con cubiertos (izquierda)", pieza: vasos({ cantidad: 1, altoCm: 9, diametroCm: 7, hex: "#f6eee6", servilleta: "#e9dcc4", productoId: null, descripcion: "vaso desechable estampado" }), colocacion: enMesa160(-31, 4) },
    { id: "vaso-derecha", nombre: "Vaso con cubiertos (derecha)", pieza: vasos({ cantidad: 1, altoCm: 9, diametroCm: 7, hex: "#f07a1a", servilleta: "#e9dcc4", productoId: "vaso-desechable-deluxe-oxo-pequeno", variante: "naranja" }), colocacion: enMesa160(30, 2) },
  ],
};
const idea160 = idea({
  id: "idea:autumn", numero: 160, slug: "autumn", nombre: "Autumn: arco orgánico de otoño y mesa de torta", ocasiones: ["general"],
  fotoUrl: FOTO("ideas_de_fiesta_t_o_autumn_3d51974a-e4f5-4c10-8a23-7d6f3a4de199.jpg"),
  contenido: { tipo: "escena", escena: escena160 },
  nota: "Igual: la guirnalda orgánica pegada a la pared en el orden de la foto —Merlot arriba a la izquierda, Eucalipto, Naranja Cobrizo bajando, Amarillo Miel y Naranja ya en el piso por delante—, cada color un tramo de R-12 con algunos R-18 (los grandes de la foto) y sin relleno de R-5 (la foto no lleva), con los 5 productos que publica la idea; delante, la mesa redonda alta con mantel beige hasta el piso, la torta de tres capas en pedestal amarillo con velas, un plato de pie naranja y otro estampado, platos blancos y dos vasos con cubiertos; piso naranja y pared blanca. Distinto: los R-18 no están entre los productos publicados (van los lisos del mismo color); el tramo Merlot sigue fuera de la foto a la izquierda y aquí acaba donde la foto; las cantidades del cuerpo son las del motor orgánico; el plato de flores va en un liso con lunares (la tienda no tiene ese estampado).",
}, () => productosDe({ tipo: "escena", escena: escena160 }, [
    P("GLOBO REDONDO FASHION MERLOT", "/products/globo-latex-redondo-fashion-merlot", "R-12", "018"), EUCALIPTO, NARANJA_COBRIZO, AMARILLO_MIEL, NARANJA,
  ]));

// ----------------------------------------------------------------------------------------------------------
// 176 · Base flor (flor en base, de Carolynn Hayman)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: el tubito mide ~45 px de grueso (5 cm: 9 px/cm). Flor de ~34 cm: 5 lazos amarillos (~15 cm) y 5
 * naranjas dentro (~8 cm) con un R-5 fucsia al centro; tallo verde de ~17 cm, dos hojas en lazo de ~20 cm y la base de
 * lazos rosados.
 */
const BASE_176 = v(0, ALTO_MESA, 0);
const escena176: Escena = {
  sala: structuredClone(SALA_CHICA),
  nodos: [
    { id: "mesa", nombre: "Mesa", pieza: { tipo: "escenografia", elementos: MESA() }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    decoSobre("base", "Base de lazos rosados", "mesa", florTubito({ petalos: lazos("T-260", 5, ["009"], 4, 18, 12, 8, 45) }), BASE_176, ARRIBA),
    decoSobre("hojas", "Hojas en lazo verdes", "mesa", florTubito({ petalos: lazos("T-260", 5, ["030"], 2, 20, 11, 12, 0) }), mas(BASE_176, v(0, 7, 0)), ARRIBA),
    palito("tallo", "Tallo de T-260 verde", "mesa", { formatoId: "T-260", grosorCm: 5, codigo: "030" }, mas(BASE_176, v(0, 9, 0)), mas(BASE_176, v(2, 30, 1))),
    decoSobre("flor", "Flor amarilla y naranja", "mesa", florTubito({ petalos: lazos("T-260", 5, ["020"], 5, 15, 10, 5, 90), interior: lazos("T-260", 5, ["061"], 5, 8, 6, 15, 126), centro: R("R-5", 12, "012") }), mas(BASE_176, v(2, 48, 0)), v(0.1, 0.15, 1)),
  ],
};
const idea176 = idea({
  id: "idea:base-flor", numero: 176, slug: "base-flor", nombre: "Flor en base (Carolynn Hayman)", ocasiones: ["general"],
  fotoUrl: FOTO("hayman.jpg"),
  contenido: { tipo: "escena", escena: escena176 },
  nota: "Igual: flor de 5 lazos de T-260 amarillo con 5 lazos naranja dentro y un R-5 fucsia al centro (~34 cm), tallo de T-260 verde de ~17 cm, dos hojas en lazo y la base de lazos rosados, con los tubitos que publica la idea; va sobre una mesa (en la foto la sostiene la artista). Distinto: el rosado de la base se ve fucsia en la foto (#f22f73) pero va el T-260 Fashion Rosado publicado; el R-5 del centro no está entre los productos (medido #fe3c90 → Fashion Fucsia 012); el Link-O-Loon de la base que dice el texto queda fuera de la foto y no se pone.",
}, () => productosDe({ tipo: "escena", escena: escena176 }, [
    P("GLOBO TUBITO FASHION AMARILLO", "/products/globo-para-fiesta-latex-tubito-fashion-amarillo", "T-260", "020"),
    P("GLOBO TUBITO FASHION NARANJA", "/products/globo-para-fiesta-latex-tubito-fashion-naranja", "T-260", "061"),
    P("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009"),
    P("GLOBO TUBITO FASHION VERDE", "/products/globo-para-fiesta-latex-tubito-fashion-verde", "T-260", "030"),
  ]));

// ----------------------------------------------------------------------------------------------------------
// 184 · Bautizo unisex (escena: mesa de postres y dos ramos sobre escaleras)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: los R-12 de los ramos miden ~58 px (28 cm: 2,05 px/cm en el plano de los ramos). Dos ramos
 * amarrados a escaleras blancas detrás de la mesa: el izquierdo de 7 (3 Amarillo Miel arriba, 4 perla), el derecho de 8
 * (3 amarillos, 5 perla); el de abajo a ~1,43 m y el de arriba a ~2,25 m del piso. Cada globo, en su sitio de la foto.
 */
type GloboFoto = { g: ParteGlobo; x: number; y: number; z: number };
const AMARILLO_184 = R("R-12", 28, "021"), PERLA_184 = R("R-12", 28, "873");
const fotoY184 = (py: number) => r2(75 + (395 - py) / 2.05);
const RAMOS_184: ReadonlyArray<{ id: string; nombre: string; x: number; px: number; globos: readonly GloboFoto[] }> = [
  {
    id: "ramo-izquierdo", nombre: "Ramo izquierdo sobre escalera", x: -75, px: 215, globos: [
      { g: AMARILLO_184, x: 220, y: 92, z: 0 }, { g: AMARILLO_184, x: 180, y: 145, z: -8 }, { g: AMARILLO_184, x: 255, y: 140, z: -8 },
      { g: PERLA_184, x: 208, y: 150, z: 14 }, { g: PERLA_184, x: 215, y: 210, z: 8 }, { g: PERLA_184, x: 185, y: 258, z: 4 }, { g: PERLA_184, x: 243, y: 255, z: 4 },
    ],
  },
  {
    id: "ramo-derecho", nombre: "Ramo derecho sobre escalera", x: 75, px: 520, globos: [
      { g: AMARILLO_184, x: 517, y: 85, z: 0 }, { g: AMARILLO_184, x: 482, y: 135, z: -8 }, { g: AMARILLO_184, x: 560, y: 118, z: -6 },
      { g: PERLA_184, x: 514, y: 155, z: 12 }, { g: PERLA_184, x: 543, y: 180, z: -10 }, { g: PERLA_184, x: 486, y: 218, z: 4 }, { g: PERLA_184, x: 553, y: 220, z: 2 }, { g: PERLA_184, x: 524, y: 255, z: 10 },
    ],
  },
];
const ALTO_ESCALERA = 160;
const AMARRE_184 = v(0, ALTO_ESCALERA, 0);
/** Escalera blanca (dos largueros y travesaños) y las cintas amarillas de su remate a cada globo. */
function escalera184(globos: readonly GloboFoto[], px: number): ElementoEscenografia[] {
  const blanco = "#e3e3df";
  const salida: ElementoEscenografia[] = [
    ...[-1, 1].map((s): ElementoEscenografia => ({ forma: "caja", centro: v(s * 16, ALTO_ESCALERA / 2, 0), tamano: v(3, ALTO_ESCALERA, 3), hex: blanco, acabado: "metal" })),
    ...Array.from({ length: 5 }, (_, k): ElementoEscenografia => ({ forma: "caja", centro: v(0, 20 + k * 32, 0), tamano: v(32, 2.5, 2.5), hex: blanco, acabado: "metal" })),
  ];
  for (const b of globos) {
    const centro = v(r2((b.x - px) / 2.05), fotoY184(b.y), b.z);
    salida.push(cinta(AMARRE_184, nudoDe(b.g, centro, menos(centro, AMARRE_184)), "#f0cf55"));
  }
  return salida;
}
const MESA_184 = { ancho: 240, fondo: 80, alto: 76, z: 10 };
const enMesa184 = (dx: number, dz: number): Colocacion => ({ en: "libre", xCm: dx, yCm: MESA_184.alto + 0.5, zCm: MESA_184.z + dz, giroGrados: 0 });
const torta184: ElementoEscenografia[] = [
  { forma: "caja", centro: v(0, 13, 0), tamano: v(46, 26, 30), hex: "#b07a45", acabado: "papel", motivo: { dibujo: "lunares", hex: "#f6f2ea", cara: "frente" } },
  { forma: "cilindro", base: v(0, 26, 0), radioCm: 5, altoCm: 8, hex: "#f4f2ee", acabado: "satinado" },
  { forma: "cilindro", base: v(0, 34, 0), radioCm: 16, altoCm: 1.2, hex: "#f4f2ee", acabado: "satinado" },
  { forma: "cilindro", base: v(0, 35.2, 0), radioCm: 14, altoCm: 16, hex: "#f7f1df", acabado: "mate" },
  { forma: "cilindro", base: v(0, 51.2, 0), radioCm: 14.2, altoCm: 1.5, hex: "#f2c94c", acabado: "satinado" },
];
const escena184: Escena = {
  sala: sala(520, 420, 320, { piso: "#cfc3ad" }),
  nodos: [
    ...RAMOS_184.flatMap((r): NodoEscena[] => [
      { id: r.id, nombre: r.nombre, pieza: { tipo: "escenografia", elementos: escalera184(r.globos, r.px) }, colocacion: { en: "libre", xCm: r.x, yCm: 0, zCm: -60, giroGrados: 0 } },
      ...r.globos.map((b, i) => {
        const centro = v(r2((b.x - r.px) / 2.05), fotoY184(b.y), b.z);
        return globoSobre(`${r.id}-globo-${i + 1}`, `${nombreGlobo(b.g)} (${r.nombre.toLowerCase().replace(" sobre escalera", "")}, ${i + 1})`, r.id, b.g, centro, menos(centro, AMARRE_184));
      }),
    ]),
    { id: "mesa", nombre: "Mesa de postres con mantel de encaje", pieza: { tipo: "escenografia", elementos: mesaConMantel({ anchoCm: MESA_184.ancho, fondoCm: MESA_184.fondo, altoCm: MESA_184.alto, mantel: "#f4f1ea" }) }, colocacion: { en: "piso", xCm: 0, zCm: MESA_184.z, giroGrados: 0 } },
    { id: "torta", nombre: "Torta blanca y amarilla sobre caja de lunares", pieza: { tipo: "escenografia", elementos: torta184 }, colocacion: enMesa184(0, -8) },
    { id: "botellas", nombre: "Seis botellitas de jugo", pieza: { tipo: "escenografia", elementos: Array.from({ length: 6 }, (_, k): ElementoEscenografia => ({ forma: "cilindro", base: v(-22 + k * 8.8, 0, 0), radioCm: 3, altoCm: 15, hex: "#f2a51c", acabado: "brillante" })) }, colocacion: enMesa184(0, 22) },
    ...[-1, 1].map((s): NodoEscena => ({ id: `ramas-${s < 0 ? "izquierda" : "derecha"}`, nombre: `Ramas secas blancas (${s < 0 ? "izquierda" : "derecha"})`, pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 5, altoCm: 2, hex: "#f2f2ef", acabado: "satinado" }, { forma: "cilindro", base: v(0, 2, 0), radioCm: 0.8, altoCm: 38, hex: "#f2f2ef", acabado: "mate" }] }, colocacion: enMesa184(s * 60, -10) })),
  ],
};
const idea184 = idea({
  id: "idea:bautizo-unisex", numero: 184, slug: "bautizo-unisex", nombre: "Bautizo unisex: mesa de postres con dos ramos", ocasiones: ["general"],
  fotoUrl: FOTO("449c887d70f14b358bb36c3a5f27ce17.jpg"),
  contenido: { tipo: "escena", escena: escena184 },
  nota: "Igual: los dos ramos de helio de la foto, cada globo en su sitio, amarrados con cinta amarilla al remate de una escalera blanca detrás de la mesa: el izquierdo de 7 (3 amarillos arriba y 4 perla) y el derecho de 8 (3 amarillos y 5 perla), de ~1,4 a ~2,25 m; la mesa larga con mantel blanco, la torta blanca con borde amarillo sobre una caja café de lunares, seis botellitas de jugo y dos ramas secas blancas. La idea no publica productos; medidos: amarillo #fac401 → Fashion Amarillo Miel 021, perla #d2cebf → Silk Perla Crema 873. Distinto: el encaje del mantel, los dulces, las galletas, la letra «E» y los frascos no se modelan; las ramas son un palito (sin ramitas); la etiqueta de la tienda no dice bautizo, así que la ocasión queda «general».",
}, () => productosDe({ tipo: "escena", escena: escena184 }));

// ----------------------------------------------------------------------------------------------------------
// 229 · Calabaza Reflex (centro de mesa)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: la calabaza grande mide ~250 px (R-18 a 42 cm: 6 px/cm); las chicas ~120–135 px (R-12 a 20–22 cm).
 * Cinco flores de T-260 Reflex Dorado Rosa (2 grandes de 5 burbujas al frente, la de 4 lazos sobre la grande y una
 * sobre cada calabaza dorada chica), coronas de burbujas doradas sobre las rosadas y cuatro matas de lazos verde lima.
 */
const GAJOS = "#d8b25a";
const calabaza229 = (g: ParteGlobo, queEs: string): Pieza => {
  const propiedades: PropiedadesFigura = { postura: "de_pie", base: [], piernas: null, cuerpo: [{ tipo: "globo", globo: g, dibujo: { estilo: "gajos", hex: GAJOS, cantidad: 6 } }], cuello: null, cabeza: null, brazos: null, accesorios: [], queEs };
  return { tipo: "decoracion", decoracion: { tipo: "figura", propiedades } };
};
const MESA_229 = { ancho: 130, fondo: 70, alto: 75 };
const enMesa229 = (dx: number, dz: number, giro = 0): Colocacion => ({ en: "libre", xCm: dx, yCm: MESA_229.alto + 0.5, zCm: dz, giroGrados: giro });
const FLOR_5_229 = florTubito({ petalos: burbujas("T-260", 5, ["968"], 5, 12, 5, 90), centro: R("R-5", 8, "970") });
const CORONA_ORO_229 = florTubito({ petalos: burbujas("T-260", 5, ["970"], 5, 6, 35, 0) });
const MATA_229 = (n: number, largoCm: number) => florTubito({ petalos: lazos("T-260", 5, ["931"], n, largoCm, 10, 70, 0) });
const escena229: Escena = {
  sala: structuredClone(SALA_CHICA),
  nodos: [
    { id: "mesa", nombre: "Mesa", pieza: { tipo: "escenografia", elementos: mesaConMantel({ anchoCm: MESA_229.ancho, fondoCm: MESA_229.fondo, altoCm: MESA_229.alto, mantel: "#efe9df" }) }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
    // Las matas verdes van detrás y a los lados, de pie sobre la mesa.
    decoSobre("mata-izquierda", "Mata de lazos verde lima (detrás, izquierda)", "mesa", MATA_229(6, 26), v(-22, MESA_229.alto, -20), ARRIBA),
    decoSobre("mata-derecha", "Mata de lazos verde lima (detrás, derecha)", "mesa", MATA_229(7, 30), v(26, MESA_229.alto, -18), ARRIBA, 20),
    decoSobre("mata-lado", "Mata de lazos verde lima (izquierda, delante)", "mesa", MATA_229(5, 18), v(-50, MESA_229.alto, 2), ARRIBA, 40),
    decoSobre("mata-chica", "Mata de lazos verde lima (derecha, delante)", "mesa", MATA_229(4, 14), v(46, MESA_229.alto, 8), ARRIBA, 10),
    { id: "calabaza-grande", nombre: "Calabaza grande R-18 Reflex Dorado", pieza: calabaza229(R("R-18", 42, "970"), "a big chrome gold balloon pumpkin with thin gold segment lines"), colocacion: enMesa229(0, -8) },
    decoSobre("flor-grande", "Flor de 4 lazos sobre la calabaza grande", "calabaza-grande", florTubito({ petalos: lazos("T-260", 5, ["968"], 4, 11, 8, 30, 45), centro: R("R-5", 8, "970") }), v(0, 44, 0), ARRIBA),
    { id: "calabaza-rosada-izquierda", nombre: "Calabaza chica R-12 Reflex Dorado Rosa (izquierda)", pieza: calabaza229(R("R-12", 20, "968"), "a small chrome rose gold balloon pumpkin with gold lines"), colocacion: enMesa229(-30, 2, 10) },
    decoSobre("corona-izquierda", "Corona de burbujas doradas (calabaza rosada izquierda)", "calabaza-rosada-izquierda", CORONA_ORO_229, v(0, 21, 0), ARRIBA),
    { id: "calabaza-rosada-derecha", nombre: "Calabaza chica R-12 Reflex Dorado Rosa (derecha)", pieza: calabaza229(R("R-12", 20, "968"), "a small chrome rose gold balloon pumpkin with gold lines"), colocacion: enMesa229(31, 0, -10) },
    decoSobre("corona-derecha", "Corona de burbujas doradas (calabaza rosada derecha)", "calabaza-rosada-derecha", CORONA_ORO_229, v(0, 21, 0), ARRIBA),
    { id: "calabaza-dorada-izquierda", nombre: "Calabaza chica R-12 Reflex Dorado (delante, izquierda)", pieza: calabaza229(R("R-12", 21, "970"), "a small chrome gold balloon pumpkin with gold lines"), colocacion: enMesa229(-30, 24, 5) },
    decoSobre("flor-dorada-izquierda", "Flor de 5 lazos (calabaza dorada izquierda)", "calabaza-dorada-izquierda", florTubito({ petalos: lazos("T-260", 5, ["968"], 5, 9, 7, 25, 0) }), v(-2, 22, 0), v(-0.2, 1, 0.3)),
    { id: "calabaza-dorada-derecha", nombre: "Calabaza chica R-12 Reflex Dorado (delante, derecha)", pieza: calabaza229(R("R-12", 22.5, "970"), "a small chrome gold balloon pumpkin with gold lines"), colocacion: enMesa229(32, 22, -5) },
    decoSobre("flor-dorada-derecha", "Flor de 5 lazos (calabaza dorada derecha)", "calabaza-dorada-derecha", florTubito({ petalos: lazos("T-260", 5, ["968"], 5, 9, 7, 25, 0) }), v(3, 23, 0), v(0.3, 1, 0.3)),
    { id: "globo-rosado", nombre: "R-12 Reflex Dorado Rosa (detrás de las flores)", pieza: { tipo: "globo", formatoId: "R-12", infladoCm: 22, codigo: "968" }, colocacion: { en: "libre", xCm: -10, yCm: MESA_229.alto + 11.5, zCm: 14, giroGrados: 0 } },
    decoSobre("flor-frente-izquierda", "Flor de 5 burbujas Reflex Dorado Rosa (frente, izquierda)", "mesa", FLOR_5_229, v(-12, MESA_229.alto + 22, 22), v(0, 0.2, 1)),
    decoSobre("flor-frente-derecha", "Flor de 5 burbujas Reflex Dorado Rosa (frente, derecha)", "mesa", FLOR_5_229, v(13, MESA_229.alto + 20, 22), v(0, 0.2, 1), 18),
  ],
};
const idea229 = idea({
  id: "idea:calabaza-reflex", numero: 229, slug: "calabaza-reflex", nombre: "Calabazas Reflex (centro de mesa)", ocasiones: ["halloween"],
  fotoUrl: FOTO("Calabaza-Reflex_5bef3466-e999-41f5-9fe9-029492d62194.png"),
  contenido: { tipo: "escena", escena: escena229 },
  nota: "Igual: con los 5 productos que publica la idea, una calabaza grande Reflex Dorado (R-18, ~42 cm) con su flor de 4 lazos Dorado Rosa encima, dos calabazas chicas Dorado Rosa con corona de burbujas doradas, dos chicas doradas con flor de lazos Dorado Rosa, un R-12 Dorado Rosa asomando detrás, dos flores grandes de 5 burbujas Dorado Rosa al frente con botón dorado y cuatro matas de lazos de T-260 Reflex Verde Lima detrás y a los lados, sobre una mesa. Distinto: los gajos de las calabazas son tiras finas de T-260 dorado en la foto; aquí van dibujados (no se cotizan); el R-18 no está entre los publicados (la tienda lo vende en el mismo producto, otra talla); las matas de la foto son columnas de burbujas apiladas y aquí lazos que se abren hacia arriba; la mesa no sale en la foto.",
}, () => productosDe({ tipo: "escena", escena: escena229 }, [
    REFLEX_DORADO,
    P("GLOBO REDONDO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-redondo-reflex-dorado-rosa", "R-12", "968"),
    P("GLOBO TUBITO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-tubito-reflex-verde-lima", "T-260", "931"),
    P("GLOBO TUBITO REFLEX DORADO", "/products/globo-para-fiesta-latex-tubito-reflex-dorado", "T-260", "970"),
    P("GLOBO TUBITO REFLEX DORADO ROSA", "/products/globo-para-fiesta-latex-tubito-reflex-dorado-rosa", "T-260", "968"),
  ]));

/** Ideas de fiesta de sempertex.com digitalizadas: lote 04. */
export const LOTE_04: readonly IdeaDigitalizada[] = [
  idea930, idea940, idea947, idea974, idea979, idea30, idea61, idea65, idea87, idea94,
  idea95, idea97, idea119, idea125, idea126, idea154, idea160, idea176, idea184, idea229,
];
