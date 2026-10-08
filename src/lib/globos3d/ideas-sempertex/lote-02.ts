import { ideaPerezosa, perezoso, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { centroCuerpo } from "../geometria";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import { mesaCilindrica, type ElementoEscenografia } from "../escenografia";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { AnilloTubito, Decoracion, PropiedadesFlorTubito } from "../figuras";
import type { Vec3 } from "../modulos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 02** (los números de `clasif/lote-02.json`: 9 ramos de helio
 * por pisos, 5 centros de mesa y 6 figuras de pared, techo o mano).
 *
 * Cómo se hizo (2026-10-07), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, ampliada y con más contraste:
 * - **Conteo**: los globos visibles, contando los que asoman por detrás de otro (y nada más: si un piso muestra dos,
 *   van dos). Ninguna idea del lote publica «Materiales» con cantidades: todo es contado en la foto (`contada: true`).
 *   Los tubitos se cuentan por largo (lo que gasta el 3D, en tubitos enteros), que es lo que se compra.
 * - **Medidas**: la escala sale de un globo de tamaño conocido en la misma foto (R-12 de ramo ≈ 28 cm de ancho, R-24
 *   ≈ 55 cm, Corazón 12 ≈ 28 cm) y con ella las alturas de los pisos, los radios, el largo de varitas y tallos.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos (aunque la medida de un cromado salga corrida por
 *   los reflejos). Si no, se midió en la foto (Python/PIL: mediana de un parche sin brillos ni sombras, ΔE en Lab
 *   contra `hexGlobo` de la tabla oficial) y se tomó el código más cercano que se fabrica en ese formato; si un Fashion
 *   queda a ≤ 6 ΔE del más cercano, el Fashion (las fotos viejas de figuras están sobresaturadas y no son Neón).
 * - **Impresos** (Infinity®, «Feliz Navidad», «Feliz Día Mamá», graffiti, filigrana, corazones…): el taller no los
 *   imprime; van en el liso de su látex de fondo. Si la idea enlaza el impreso y su nombre o url dicen el fondo
 *   («… FASHION BLANCO»), ese producto lleva `codigo` = el color de fondo; si la foto muestra un impreso que la idea no
 *   enlaza, va el liso del mismo fondo como sustituto, y la nota lo dice.
 * - **Ramos**: por pisos, como en la foto (no la espiral del ramo de Halloween): cada globo es un `globo` puesto
 *   `sobre` la pieza «Peso y cintas» (escenografía: el peso en el piso y una cinta del peso al nudo de cada globo), en su
 *   ángulo, su radio, su altura y su inclinación. Así cada piso sale plano y con los globos que tiene.
 * - **Varitas y tallos** de tubito: una flor de tubito de dos burbujas con apertura −90°, que deja las dos burbujas una
 *   sobre otra en una sola recta; puesta `sobre` su padre con la normal hacia donde sube la varita (ver `palito`). El
 *   largo que gasta se cuenta doble, pero un tallo de hasta ~60 cm sigue saliendo de un solo T-260, como en la realidad.
 * Unidades: cm. Espacio de cada escena: y arriba, +z hacia quien mira; los puntos `sobre` van en el espacio local del
 * padre (en la pared y en el techo, de frente: x a la derecha, y arriba, z hacia el salón).
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
const AL_FRENTE = v(0, 0, 1);
/** Un punto a `radio` del centro en el ángulo `grados` (0° a la derecha, 90° arriba) del plano de frente, a `z`. */
const enCirculo = (grados: number, radio: number, z = 0): Vec3 => v(r2(Math.cos(rad(grados)) * radio), r2(Math.sin(rad(grados)) * radio), z);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });

const sala = (anchoCm: number, fondoCm: number, altoCm: number): Sala => ({ ...structuredClone(SALA_INICIAL), anchoCm, fondoCm, altoCm });
const SALA_RAMO = sala(420, 380, 320);
const SALA_CHICA = sala(320, 280, 280);

/** Nombre de un globo para su nodo: «R-12 Reflex Verde Lima». */
function nombreGlobo(g: ParteGlobo, impreso?: string): string {
  const color = referenciaPorCodigo(g.codigo)?.nombreCompleto ?? g.codigo;
  return `${g.formatoId} ${color}${impreso ? ` impreso «${impreso}»` : ""}`;
}

/** Dónde queda el nudo de un globo con el centro del cuerpo en `centro`, mirando hacia `direccion`. */
const nudoDe = (g: ParteGlobo, centro: Vec3, direccion: Vec3): Vec3 => menos(centro, por(unitario(direccion), centroCuerpo("redondo", g.infladoCm)));

/**
 * Un globo suelto `sobre` su padre, con el centro de su cuerpo en `centro` (espacio local del padre) y el cuerpo hacia
 * `direccion`. La colocación `sobre` apoya lo más bajo de la pieza (el nudo) en el punto, hundido 1,5 cm: se corrige.
 */
function globoSobre(id: string, nombre: string, padreId: string, g: ParteGlobo, centro: Vec3, direccion: Vec3 = ARRIBA): NodoEscena {
  const n = unitario(direccion);
  const punto = menos(centro, por(n, centroCuerpo("redondo", g.infladoCm) - HUNDIMIENTO_SOBRE_CM));
  return { id, nombre, pieza: { tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo }, colocacion: { en: "sobre", padreId, puntoCm: redondo(punto), normal: redondo(n), giroGrados: 0 } };
}

/** Una decoración `sobre` su padre, con su espalda en `espalda` (si no hay globos del padre debajo) mirando a `normal`. */
function decoSobre(id: string, nombre: string, padreId: string, decoracion: Decoracion, espalda: Vec3, normal: Vec3, giroGrados = 0): NodoEscena {
  const n = unitario(normal);
  return { id, nombre, pieza: { tipo: "decoracion", decoracion }, colocacion: { en: "sobre", padreId, puntoCm: redondo(mas(espalda, por(n, HUNDIMIENTO_SOBRE_CM))), normal: redondo(n), giroGrados } };
}

type Tubito = { formatoId: string; grosorCm: number; codigo: string };

/**
 * Una varita o un tallo recto de tubito, de `desde` (la punta suelta) a `hasta` (donde se amarra), en el espacio local
 * del padre. Es una flor de tubito de dos burbujas con apertura −90°: las dos quedan en la misma recta, hacia −y de la
 * pieza; puesta `sobre` con la normal de `desde` a `hasta`, su punta de abajo cae en `desde` y la de arriba en `hasta`.
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

/** Alto y ancho de una pieza armada (para apoyarla o centrarla donde va). */
function medidas(pieza: Pieza): { altoCm: number; anchoCm: number } {
  const { caja } = armarPieza(pieza);
  return { altoCm: caja.max.y - caja.min.y, anchoCm: caja.max.x - caja.min.x };
}

/** En la pared del fondo, con su centro a `centroCm` del piso. */
function enLaPared(pieza: Pieza, centroCm: number): Colocacion {
  return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: r2(centroCm - medidas(pieza).altoCm / 2) };
}

// ----------------------------------------------------------------------------------------------------------
// Ramo de helio por pisos
// ----------------------------------------------------------------------------------------------------------

type GloboRamo = ParteGlobo & { impreso?: string };
/**
 * Un piso del ramo: sus globos (en `angulos`, 0° = de frente y 90° a la derecha de quien mira), con el centro del
 * cuerpo a `alturaCm` del piso y a `radioCm` del eje, inclinados hacia fuera `inclinacionGrados`.
 */
type PisoRamo = { alturaCm: number; radioCm: number; inclinacionGrados: number; angulos: readonly number[]; globos: readonly GloboRamo[] };

const tres = (giro: number) => [giro, giro + 120, giro + 240];
const cuatro = (giro: number) => [giro, giro + 90, giro + 180, giro + 270];
/** Dos globos lado a lado, de frente (el izquierdo y el derecho). */
const DOS = [300, 60];
const ALTO_PESO = 7;

function escenaRamo(o: { pisos: readonly PisoRamo[]; remate?: { globo: GloboRamo; alturaCm: number }; cinta: string; peso: string }): Escena {
  const amarre = v(0, ALTO_PESO, 0);
  const globos: NodoEscena[] = [];
  const cintas: ElementoEscenografia[] = [];
  const poner = (g: GloboRamo, centro: Vec3, direccion: Vec3, id: string, donde: string) => {
    globos.push(globoSobre(id, `${nombreGlobo(g, g.impreso)} (${donde})`, "peso", g, centro, direccion));
    cintas.push(cinta(amarre, nudoDe(g, centro, direccion), o.cinta));
  };
  o.pisos.forEach((piso, k) => piso.globos.forEach((g, i) => {
    const a = rad(piso.angulos[i] ?? 0);
    const fuera = v(Math.sin(a), 0, Math.cos(a));
    const inc = rad(piso.inclinacionGrados);
    const direccion = unitario(mas(por(fuera, Math.sin(inc)), por(ARRIBA, Math.cos(inc))));
    poner(g, v(fuera.x * piso.radioCm, piso.alturaCm, fuera.z * piso.radioCm), direccion, `globo-${k + 1}-${i + 1}`, `piso ${k + 1}, ${i + 1}`);
  }));
  if (o.remate) poner(o.remate.globo, v(0, o.remate.alturaCm, 0), ARRIBA, "remate", "remate");
  const peso: NodoEscena = {
    id: "peso", nombre: "Peso y cintas",
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 4.5, altoCm: ALTO_PESO, hex: o.peso, acabado: "metal" }, ...cintas] },
    colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 },
  };
  return { sala: structuredClone(SALA_RAMO), nodos: [peso, ...globos] };
}

/** Un piso de `n` globos iguales. */
const piso = (alturaCm: number, angulos: readonly number[], g: GloboRamo, radioCm = 22, inclinacionGrados = 14): PisoRamo =>
  ({ alturaCm, radioCm, inclinacionGrados, angulos, globos: angulos.map(() => g) });

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

/** Un producto que la idea publica, tal cual (nombre, url), con la cantidad contada en la foto (o null si no sale). */
const publicado = (nombre: string, url: string, formato: string | null, codigo: string | null, cantidad: number | null): ProductoDeIdea =>
  (cantidad === null ? { nombre, url, formato, codigo, cantidad: null } : { nombre, url, formato, codigo, cantidad, contada: true });

const MESA = (hex = "#f3efe8"): ElementoEscenografia[] => mesaCilindrica({ diametroCm: 60, altoCm: 74, hex });
const ALTO_MESA = 74;
/** Una idea escrita como literal, con su contenido como función: se arma la primera vez que se pide (`ideaPerezosa`). */
type Literal = Omit<IdeaDigitalizada, "contenido"> & { contenido: () => IdeaDigitalizada["contenido"] };
function idea(l: Literal): IdeaDigitalizada {
  const { contenido, productos, ...fijo } = l;
  return ideaPerezosa(fijo, contenido, () => productos);
}

const FOTO = (archivo: string) => `https://sempertex.com/cdn/shop/articles/${archivo}`;
const INFINITY_FELIZ_NAVIDAD = { nombre: "GLOBO REDONDO INFINITY® FELIZ NAVIDAD DORADA FASHION BLANCO", url: "/products/globo-para-fiesta-latex-redondo-infinity-feliz-navidad-dorada-fashion-blanco" };

// ----------------------------------------------------------------------------------------------------------
// 503 · Dorado - Cristal Rojo - Verde Lima - Chocolate - Arena
// ----------------------------------------------------------------------------------------------------------

/** R-12 de ramo a 28 cm. Escala de la foto: 130 px = 28 cm (4,6 px/cm); un piso cada ~137 px = 29,5 cm. */
const idea503 = idea({
  id: "idea:dorado-cristal-rojo-verde-lima-chocolate-arena", numero: 503, slug: "dorado-cristal-rojo-verde-lima-chocolate-arena",
  nombre: "Ramo Dorado, Cristal Rojo, Verde Lima, Chocolate y Arena", ocasiones: ["boda", "general"],
  fotoUrl: FOTO("Bouquet-DSC_6363-000x1000_e0c48f13-2eed-426b-810a-0eb34476bd01.jpg"),
  productos: [
    publicado("GLOBO REDONDO INFINITY® ESTRELLAS", "/products/globo-para-fiesta-latex-redondo-infinity-estrellas-reflex-dorado", "R-12", null, null),
    publicado("GLOBO REDONDO REFLEX CRISTAL ROJO", "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", "R-12", "915", 3),
    publicado("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931", 3),
    publicado("GLOBO REDONDO FASHION CHOCOLATE", "/products/globo-para-fiesta-latex-redondo-fashion-chocolate", "R-12", "076", 3),
    publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", 3),
    liso("R-24", "970", 1),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, tres(0), R("R-12", 28, "071")),
        piso(150, tres(60), R("R-12", 28, "076")),
        piso(180, tres(0), R("R-12", 28, "931")),
        piso(210, tres(60), R("R-12", 28, "915")),
      ],
      remate: { globo: R("R-24", 55, "970"), alturaCm: 251 },
      cinta: "#d9a3b4", peso: "#b89a5e",
    }),
  }),
  nota: "Igual: 13 globos contados (de abajo arriba 3 R-12 Arena, 3 Chocolate, 3 Reflex Verde Lima y 3 Reflex Cristal Rojo —el tercero de los pisos de chocolate y rojo asoma por detrás— y arriba un R-24 Reflex Dorado del doble de ancho), cada piso girado 60° sobre el de abajo como en la foto, con su cinta al peso. Distinto: la idea enlaza el «Infinity® Estrellas» Reflex Dorado (R-12), pero el remate de la foto es un R-24 dorado liso: va el R-24 Reflex Dorado liso de la tienda. El peso no sale en la foto (cortada) y el alto de las cintas es supuesto.",
});

// ----------------------------------------------------------------------------------------------------------
// 505 · Dorado Rosa - Palo de Rosa - Arena - Reflex Dorado
// ----------------------------------------------------------------------------------------------------------

const idea505 = idea({
  id: "idea:dorado-rosa-palo-de-rosa-arena-reflex-dorado", numero: 505, slug: "dorado-rosa-palo-de-rosa-arena-reflex-dorado",
  nombre: "Ramo Dorado Rosa, Palo de Rosa, Arena y Reflex Dorado", ocasiones: ["general"],
  fotoUrl: FOTO("Dorado-Rosa-Palo-de-Rosa-Arena-Dorado.jpg"),
  productos: [
    publicado("GLOBO REDONDO REFLEX ROSADO", "/products/globo-para-fiesta-latex-redondo-reflex-rosado", "R-12", "909", 3),
    publicado("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010", 2),
    publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", 3),
    publicado("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, tres(60), R("R-12", 28, "970")),
        piso(149, tres(0), R("R-12", 28, "071")),
        piso(178, DOS, R("R-12", 28, "010"), 20),
        piso(207, tres(0), R("R-12", 28, "909")),
      ],
      cinta: "#c9c9ce", peso: "#b9bcc2",
    }),
  }),
  nota: "Igual: 11 R-12 contados en 4 pisos, de abajo arriba 3 Reflex Dorado (el tercero asoma detrás a la derecha), 3 Fashion Arena, 2 Fashion Palo de Rosa (lado a lado: no asoma un tercero) y 3 Reflex Rosado, cada piso girado sobre el de abajo como en la foto, cintas plateadas al peso. El «dorado rosa» del título es el Reflex Rosado 909 que publica la idea (en la foto se ve cobrizo por el cromado). Distinto: el peso y el largo de las cintas no salen en la foto.",
});

// ----------------------------------------------------------------------------------------------------------
// 550 · Feliz Cumpleaños Fantasía - Rosado - Plata
// ----------------------------------------------------------------------------------------------------------

const idea550 = idea({
  id: "idea:feliz-cumpleanos-fantasia-rosado-plata", numero: 550, slug: "feliz-cumpleanos-fantasia-rosado-plata",
  nombre: "Ramo Feliz Cumpleaños Fantasía Rosado y Plata", ocasiones: ["cumpleanos"],
  fotoUrl: FOTO("Rosado-Plata.jpg"),
  productos: [
    publicado("GLOBO REDONDO REFLEX ROSADO", "/products/globo-para-fiesta-latex-redondo-reflex-rosado", "R-12", "909", 3),
    publicado("GLOBO REDONDO INFINITY® FELIZ AÑO ESTRELLAS", "/products/globo-para-fiesta-latex-redondo-infinity-feliz-ano-estrellas-satin-y-metal-surtido-deluxe", "R-12", null, null),
    publicado("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 3),
    liso("R-12", "005", 2),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, tres(0), R("R-12", 28, "981")),
        { ...piso(147, DOS, R("R-12", 28, "005"), 20), globos: [{ ...R("R-12", 28, "005"), impreso: "Feliz Cumpleaños" }, { ...R("R-12", 28, "005"), impreso: "Feliz Cumpleaños" }] },
        piso(175, tres(0), R("R-12", 28, "909")),
      ],
      cinta: "#e6e6ea", peso: "#b9bcc2",
    }),
  }),
  nota: "Igual: 8 R-12 contados en 3 pisos, de abajo arriba 3 Reflex Plata, 2 blancos impresos «Feliz Cumpleaños» con estrellas plateadas (lado a lado; no asoma un tercero) y 3 Reflex Rosado, con sus cintas blancas al peso. Distinto: el impreso no se modela (van Fashion Blanco lisos) y la idea enlaza el «Infinity® Feliz Año Estrellas», que no es el de la foto: el impreso de la foto parece el «Feliz Cumpleaños Fantasía» (la tienda lo vende en Reflex surtido), así que se lista el Fashion Blanco liso de sustituto.",
});

// ----------------------------------------------------------------------------------------------------------
// 557 · Feliz Día Mamá - Reflex - Graffiti
// ----------------------------------------------------------------------------------------------------------

const MAMA = { nombre: "GLOBO REDONDO INFINITY® FELIZ DIA MAMA CORAZONES FASHION SURTIDO ROJO - BLANCO", url: "/products/globo-para-fiesta-latex-redondo-infinity-feliz-dia-mama-corazones-fashion-surtido-rojo-blanco" };
const idea557 = idea({
  id: "idea:feliz-dia-mama-reflex-graffiti", numero: 557, slug: "feliz-dia-mama-reflex-graffiti",
  nombre: "Ramo Feliz Día Mamá, Reflex y Graffiti", ocasiones: ["dia-de-la-madre"],
  fotoUrl: FOTO("Plata-Grafitti-Invierno-015.jpg"),
  productos: [
    // El surtido trae rojos y blancos: una fila por color de fondo. La idea lo mapea a C-12, pero el nombre dice
    // REDONDO y en la foto son redondos de 12".
    publicado(MAMA.nombre, MAMA.url, "R-12", "015", 1),
    publicado(MAMA.nombre, MAMA.url, "R-12", "005", 2),
    publicado("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 3),
    publicado("GLOBO REDONDO INFINITY® GRAFFITI DORADO ROSA FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-dorado-rosa-fashion-blanco", "R-12", "005", 4),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, cuatro(0), { ...R("R-12", 28, "005"), impreso: "Graffiti" }, 23),
        piso(149, tres(60), R("R-12", 28, "981")),
        {
          alturaCm: 179, radioCm: 21, inclinacionGrados: 14, angulos: tres(0),
          globos: [{ ...R("R-12", 28, "015"), impreso: "Feliz Día Mamá" }, { ...R("R-12", 28, "005"), impreso: "Feliz Día Mamá" }, { ...R("R-12", 28, "005"), impreso: "Feliz Día Mamá" }],
        },
      ],
      cinta: "#d2d2d6", peso: "#b9bcc2",
    }),
  }),
  nota: "Igual: 10 R-12 contados en 3 pisos, de abajo arriba 4 graffiti sobre blanco (el cuarto asoma detrás, entre los de delante), 3 Reflex Plata (uno asoma detrás a la izquierda) y arriba 3 «Feliz Día Mamá»: el rojo de frente y dos blancos detrás, con cintas plateadas al peso. Distinto: lo impreso no se modela (van lisos en su fondo, Fashion Rojo y Fashion Blanco); el graffiti de la foto se ve rojo, no dorado rosa como el producto que enlaza la idea, y la idea mapea el «Feliz Día Mamá» a C-12 aunque es redondo.",
});

// ----------------------------------------------------------------------------------------------------------
// 559 a 562 · Feliz Navidad (4 ramos de la misma sesión de fotos)
// ----------------------------------------------------------------------------------------------------------

const FN = (codigo = "005"): GloboRamo => ({ ...R("R-12", 28, codigo), impreso: "Feliz Navidad" });

const idea559 = idea({
  id: "idea:feliz-navidad-azul-naval-plata-azul", numero: 559, slug: "feliz-navidad-azul-naval-plata-azul",
  nombre: "Ramo Feliz Navidad Azul Naval, Plata y Azul", ocasiones: ["navidad"],
  fotoUrl: FOTO("Bouquet-DSC_6349-000x1000_c9f5e69a-1364-4d8d-ab56-b9ab5c3e7fb9.jpg"),
  productos: [
    // Lo que enlaza la idea no es lo de la foto (rojo, verde selva, rosado): queda sin cantidad.
    publicado("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-rojo", "R-12", null, null),
    publicado("GLOBO REDONDO FASHION VERDE SELVA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-selva", "R-12", "032", null),
    publicado("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609", null),
    publicado("GLOBO REDONDO REFLEX CRISTAL ROJO", "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", "R-12", "915", null),
    // Lo de la foto: el impreso es el mismo de los ramos 560-562 (letras doradas y hojas sobre Fashion Blanco).
    publicado(INFINITY_FELIZ_NAVIDAD.nombre, INFINITY_FELIZ_NAVIDAD.url, "R-12", "005", 4),
    liso("R-12", "044", 3),
    liso("R-12", "981", 2),
    liso("R-12", "640", 3),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, tres(0), R("R-12", 28, "640")),
        piso(150, DOS, R("R-12", 28, "981"), 20),
        piso(180, tres(0), R("R-12", 28, "044")),
        piso(210, cuatro(45), FN(), 23),
      ],
      cinta: "#c9a24a", peso: "#c9a24a",
    }),
  }),
  nota: "Igual: 12 R-12 contados en 4 pisos, de abajo arriba 3 azul claro (medido #a1cadf: Pastel Mate Azul 640), 2 Reflex Plata, 3 Fashion Azul Naval (#132747: 044) y 4 blancos impresos «Feliz Navidad» (dos de frente y dos que asoman detrás), con cintas doradas al peso. Distinto: los productos que enlaza la idea (Graffiti Invierno rojo, Verde Selva, Pastel Mate Rosado, Cristal Rojo) no son los de la foto: quedan listados sin cantidad y se añaden los de la foto; el impreso dorado no se modela (Fashion Blanco liso).",
});

const idea560 = idea({
  id: "idea:feliz-navidad-cristal-rojo-dorado-verde-lima", numero: 560, slug: "feliz-navidad-cristal-rojo-dorado-verde-lima",
  nombre: "Ramo Feliz Navidad Cristal Rojo, Dorado y Verde Lima", ocasiones: ["navidad"],
  fotoUrl: FOTO("Bouquet-DSC_6353-000x1000_e06ddb73-9741-4c74-a1a6-134a368ba041.jpg"),
  productos: [
    publicado(INFINITY_FELIZ_NAVIDAD.nombre, INFINITY_FELIZ_NAVIDAD.url, "R-12", "005", 3),
    publicado("GLOBO REDONDO REFLEX CRISTAL ROJO", "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", "R-12", "915", 3),
    publicado("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
    publicado("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931", 2),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, DOS, R("R-12", 28, "931"), 20),
        piso(149, tres(0), R("R-12", 28, "970"), 23),
        piso(178, tres(60), R("R-12", 28, "915")),
        piso(208, tres(0), FN()),
      ],
      cinta: "#e3a6ba", peso: "#c9a24a",
    }),
  }),
  nota: "Igual: 11 R-12 contados en 4 pisos, de abajo arriba 2 Reflex Verde Lima (lado a lado), 3 Reflex Dorado, 3 Reflex Cristal Rojo (el tercero asoma detrás a la derecha) y 3 blancos impresos «Feliz Navidad», con cintas rosadas al peso. Distinto: el impreso dorado no se modela (Fashion Blanco liso); el peso no sale en la foto.",
});

const idea561 = idea({
  id: "idea:feliz-navidad-dorado-arena", numero: 561, slug: "feliz-navidad-dorado-arena",
  nombre: "Ramo Feliz Navidad Dorado, Durazno y Arena", ocasiones: ["navidad"],
  fotoUrl: FOTO("Bouquet-DSC_6366-000x1000_b4184919-0fe4-4f29-bdea-8249a14b864b.jpg"),
  productos: [
    publicado(INFINITY_FELIZ_NAVIDAD.nombre, INFINITY_FELIZ_NAVIDAD.url, "R-12", "005", 4),
    publicado("GLOBO REDONDO METAL DORADO", "/products/globo-para-fiesta-latex-redondo-metal-dorado-cobre", "R-12", "570", 3),
    publicado("GLOBO REDONDO FASHION DURAZNO", "/products/globo-para-fiesta-latex-redondo-fashion-durazno", "R-12", "060", 4),
    publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", 4),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, cuatro(45), R("R-12", 28, "071"), 24),
        piso(150, cuatro(0), R("R-12", 28, "060"), 24),
        piso(180, tres(0), R("R-12", 28, "570")),
        piso(210, cuatro(45), FN(), 24),
      ],
      cinta: "#d9b36a", peso: "#c9a24a",
    }),
  }),
  nota: "Igual: 15 R-12 contados en 4 pisos, de abajo arriba 4 Fashion Arena, 4 Fashion Durazno, 3 Metal Dorado y 4 blancos impresos «Feliz Navidad» (en arena, durazno y blancos uno asoma por detrás entre los de delante), con cintas doradas y rosadas al peso. Distinto: el impreso dorado no se modela (Fashion Blanco liso); los pisos de 4 de la foto no son tan regulares como en el 3D.",
});

const idea562 = idea({
  id: "idea:feliz-navidad-dorado-cristal-rojo-plata", numero: 562, slug: "feliz-navidad-dorado-cristal-rojo-plata",
  nombre: "Ramo Feliz Navidad Dorado, Cristal Rojo y Plata", ocasiones: ["navidad"],
  fotoUrl: FOTO("Bouquet-DSC_6356-000x1000_1ceb9ad2-7de9-4043-bf29-e54f0b4653a8.jpg"),
  productos: [
    publicado(INFINITY_FELIZ_NAVIDAD.nombre, INFINITY_FELIZ_NAVIDAD.url, "R-12", "005", 3),
    publicado("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
    publicado("GLOBO REDONDO REFLEX CRISTAL ROJO", "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", "R-12", "915", 3),
    publicado("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 2),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, DOS, R("R-12", 28, "981"), 20),
        piso(149, tres(0), R("R-12", 28, "915"), 23),
        piso(178, tres(60), R("R-12", 28, "970")),
        piso(208, tres(0), FN()),
      ],
      cinta: "#e3a6ba", peso: "#b9bcc2",
    }),
  }),
  nota: "Igual: 11 R-12 contados en 4 pisos, de abajo arriba 2 Reflex Plata (lado a lado), 3 Reflex Cristal Rojo, 3 Reflex Dorado (el tercero asoma detrás a la izquierda) y 3 blancos impresos «Feliz Navidad», con cintas rosadas al peso. Distinto: el impreso dorado no se modela (Fashion Blanco liso).",
});

// ----------------------------------------------------------------------------------------------------------
// 593 · Filigree - Dorado - Arena
// ----------------------------------------------------------------------------------------------------------

const idea593 = idea({
  id: "idea:filigree-dorado-arena-cobre", numero: 593, slug: "filigree-dorado-arena-cobre",
  nombre: "Ramo Filigrana, Dorado, Arena y Cobre", ocasiones: ["general"],
  fotoUrl: FOTO("Bouquet-DSC_6351-000x1000.jpg"),
  productos: [
    publicado("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
    publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", 3),
    publicado("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 3),
    liso("R-12", "968", 2),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: escenaRamo({
      pisos: [
        piso(120, DOS, R("R-12", 28, "968"), 20),
        piso(149, tres(0), R("R-12", 28, "071"), 23),
        piso(178, tres(60), R("R-12", 28, "970")),
        piso(208, tres(0), { ...R("R-12", 28, "981"), impreso: "filigrana" }),
      ],
      cinta: "#e3b6c4", peso: "#c9a24a",
    }),
  }),
  nota: "Igual: 11 R-12 contados en 4 pisos, de abajo arriba 2 cobrizos cromados, 3 Fashion Arena, 3 Reflex Dorado (el tercero asoma detrás a la izquierda) y 3 Reflex Plata con filigrana blanca impresa, con cintas rosadas al peso. Distinto: la filigrana no se modela (Reflex Plata liso: la idea no enlaza el impreso) y el cobre no está entre los productos de la idea; medido #a25936, el Reflex más cercano en R-12 es el Dorado Rosa 968 (los Fashion café y moca quedan algo más cerca, pero son mates y el de la foto es cromado).",
});

// ----------------------------------------------------------------------------------------------------------
// 506 · Dulce corazón (dos varitas de corazón cruzadas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570 px; el Corazón 12 mide 200 px de ancho (28 cm): 7,1 px/cm. Se pasan los puntos de la foto a cm con
 * el moño de cada varita a 1,2 m del piso (como si se tuviera en la mano).
 */
function foto506(px: number, py: number, z: number): Vec3 {
  return v(r2((px - 370) / 7.1), r2(120 - (py - 215) / 7.1), z);
}

function varita(prefijo: string, nombre: string, corazon: string, palo: string, puntos: { moño: [number, number]; otroMoño: [number, number]; union: [number, number]; corazon: [number, number]; punta: [number, number] }, z: number): NodoEscena[] {
  const raiz = foto506(...puntos.moño, z);
  const local = (p: [number, number]) => menos(foto506(...p, z), raiz);
  const union = local(puntos.union), centroCorazon = local(puntos.corazon), punta = local(puntos.punta), otro = local(puntos.otroMoño);
  const eje = unitario(menos(centroCorazon, union));
  return [
    { id: `${prefijo}-mono`, nombre: `Moño de la varita ${nombre} (izquierda)`, pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 8, codigo: "005" }, colocacion: { en: "libre", xCm: raiz.x, yCm: raiz.y, zCm: raiz.z, giroGrados: 0 } },
    globoSobre(`${prefijo}-mono-2`, `Moño de la varita ${nombre} (derecha)`, `${prefijo}-mono`, R("R-5", 8, "005"), otro, unitario(menos(otro, union))),
    globoSobre(`${prefijo}-corazon`, `Corazón ${nombre}`, `${prefijo}-mono`, R("C-12", 28, corazon), centroCorazon, eje),
    palito(`${prefijo}-palo`, `Palo de la varita ${nombre}`, `${prefijo}-mono`, { formatoId: "T-260", grosorCm: 3.5, codigo: palo }, punta, union),
  ];
}

const idea506 = idea({
  id: "idea:dulce-corazon", numero: 506, slug: "dulce-corazon",
  nombre: "Dulce corazón: varitas de corazón", ocasiones: ["san-valentin", "general"],
  fotoUrl: FOTO("7d691f974802c05910667d6e5e77302e_06a6d74f-118f-4c7c-aaa1-61d62d7a12f9.jpg"),
  productos: [liso("C-12", "009", 1), liso("C-12", "015", 1), liso("T-260", "012", 1), liso("T-260", "015", 1), liso("R-5", "005", 4)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        ...varita("rosada", "rosada", "009", "012", { moño: [240, 232], otroMoño: [305, 200], union: [275, 215], corazon: [210, 100], punta: [420, 540] }, 0),
        ...varita("roja", "roja", "015", "015", { moño: [430, 195], otroMoño: [510, 235], union: [460, 220], corazon: [530, 100], punta: [330, 540] }, 6),
      ],
    },
  }),
  nota: "Igual: dos varitas cruzadas como en la foto (la roja por delante), cada una con un Corazón 12 en la punta del palo de T-260, inclinadas ~25°, y un moño de dos R-5 blancos donde el corazón se une al palo; palos de ~50 cm. Colores medidos: corazón rosado #ff7aa9 (el Corazón 12 solo viene en blanco, rosado, rojo y transparente: Fashion Rosado 009, más pálido que el de la foto), corazón rojo #f72223 (015), palo rosado #ff548e (T-260 Fashion Fucsia 012), palo rojo (T-260 Fashion Rojo 015), moños #efdfde (Fashion Blanco: el rosado es el reflejo de los corazones). Distinto: los moños son globos redondos y no burbujas torcidas del palo.",
});

// ----------------------------------------------------------------------------------------------------------
// 531 · Estrella Navidad (de techo)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740×570; el tubito se ve de ~15 px de grueso (T-260 a 3,5 cm): 4,3 px/cm. Brazos de ~56 cm del centro a la
 * punta, anillo de 10 R-5 Verde Selva a ~20 cm del centro, flor central de 5 burbujas Amarillo Miel.
 */
const ESTRELLA_531: Pieza = {
  tipo: "decoracion", deFrente: true,
  decoracion: florTubito({
    petalos: lazos("T-260", 3.5, ["015"], 5, 56, 11, 0, 90),
    interior: burbujas("T-260", 3.5, ["021"], 5, 9, 0, 90),
  }),
};
const BRAZOS_531 = [90, 162, 234, 306, 18];
const idea531 = idea({
  id: "idea:estrella-navidad", numero: 531, slug: "estrella-navidad",
  nombre: "Estrella de Navidad de tubitos", ocasiones: ["navidad", "general"],
  fotoUrl: FOTO("6fa9277b75290d764edcbddd4020edba_d7e80bb9-ed00-4639-892b-359c8f6a88cf.jpg"),
  productos: [liso("T-260", "015", 5), liso("T-260", "021", 1), liso("R-5", "032", 30), liso("R-5", "021", 5)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        { id: "estrella", nombre: "Estrella de lazos rojos", pieza: ESTRELLA_531, colocacion: { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 40, giroGrados: 0, volteada: false } },
        // Anillo de 10 R-5 Verde Selva: dos a cada lado de la base de cada brazo.
        ...BRAZOS_531.flatMap((a, k) => [-17, 17].map((d, j) => globoSobre(`anillo-${k * 2 + j + 1}`, `Anillo R-5 Verde Selva ${k * 2 + j + 1}`, "estrella", R("R-5", 9, "032"), enCirculo(a + d, 20, 4), AL_FRENTE))),
        // Burbujita verde en la base de cada brazo y amarilla entre los pétalos del centro.
        ...BRAZOS_531.map((a, k) => globoSobre(`base-brazo-${k + 1}`, `Burbujita verde ${k + 1}`, "estrella", R("R-5", 5.2, "032"), enCirculo(a, 26, 3), AL_FRENTE)),
        ...BRAZOS_531.map((a, k) => globoSobre(`burbujita-amarilla-${k + 1}`, `Burbujita amarilla ${k + 1}`, "estrella", R("R-5", 5.2, "021"), enCirculo(a + 36, 10, 5), AL_FRENTE)),
        // Tres burbujitas verdes en la punta de cada brazo.
        ...BRAZOS_531.map((a, k) => decoSobre(`punta-${k + 1}`, `Punta verde ${k + 1}`, "estrella",
          flor({ petalos: { ...R("R-5", 5.2, "032"), cantidad: 3, aperturaGrados: 10, giroGrados: a }, centro: null }), enCirculo(a, 60, 0), AL_FRENTE)),
      ],
    },
  }),
  nota: "Igual: estrella de 5 brazos, cada uno un lazo largo de T-260 Fashion Rojo (~56 cm), colgada del techo; en el centro una flor de 5 burbujas T-260 Amarillo Miel (medido #feb001) rodeada de un anillo de 10 R-5 Verde Selva (#00875b: 032), burbujitas verdes en la base de los brazos, amarillas entre los pétalos y tres en cada punta. Distinto: las burbujitas de la foto (~3 cm) son de tubito; aquí son R-5 al mínimo (5,2 cm), y el amarillo-naranja de los pétalos queda entre Amarillo Miel y Naranja (va Amarillo Miel; Mostaza no se vende en T-260).",
});

// ----------------------------------------------------------------------------------------------------------
// 544 · Farol encantado (centro de mesa)
// ----------------------------------------------------------------------------------------------------------

/** Foto: R-12 de 90 px = 28 cm (3,2 px/cm). Farol de 19 cm de ancho y pompón de 28 cm; globos a 0,8–1,2 m del pompón. */
const POMPON_544 = v(0, ALTO_MESA + 26, 0);
const GLOBOS_544: ReadonlyArray<{ g: GloboRamo; centro: Vec3 }> = [
  { g: { ...R("R-12", 28, "015"), impreso: "corazón" }, centro: v(3, POMPON_544.y + 120, 0) },
  { g: { ...R("R-12", 28, "015"), impreso: "corazones blancos" }, centro: v(-11, POMPON_544.y + 80, 4) },
  { g: { ...R("R-12", 28, "005"), impreso: "corazones rojos" }, centro: v(14, POMPON_544.y + 83, -5) },
];
const AMARRE_544 = v(0, POMPON_544.y + 6, 0);
const idea544 = idea({
  id: "idea:farol-encantado", numero: 544, slug: "farol-encantado",
  nombre: "Farol encantado", ocasiones: ["san-valentin", "general"],
  fotoUrl: FOTO("e372675cf997f22517ce075039d175ae.jpg"),
  productos: [liso("R-12", "015", 2), liso("R-12", "005", 1), liso("T-260", "029", 1)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        {
          id: "mesa", nombre: "Mesa, farol, pompón y cintas",
          pieza: {
            tipo: "escenografia",
            elementos: [
              ...MESA(),
              { forma: "cilindro", base: v(0, ALTO_MESA, 0), radioCm: 9.5, altoCm: 20, hex: "#f2f2f0", acabado: "papel" },
              { forma: "cilindro", base: v(0, ALTO_MESA + 19, 0), radioCm: 13, altoCm: 14, radioArribaCm: 8, hex: "#b8141b", acabado: "tela" },
              ...GLOBOS_544.map(({ g, centro }) => cinta(AMARRE_544, nudoDe(g, centro, menos(centro, AMARRE_544)), "#e4e4e8")),
            ],
          },
          colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 },
        },
        decoSobre("hojas", "Hojas de T-260 Verde Trébol", "mesa", florTubito({ petalos: lazos("T-260", 3.5, ["029"], 3, 15, 8, 0, 10) }), menos(POMPON_544, v(0, 0, 2)), AL_FRENTE),
        ...GLOBOS_544.map(({ g, centro }, i) => globoSobre(`globo-${i + 1}`, `${nombreGlobo(g, g.impreso)} ${i + 1}`, "mesa", g, centro, menos(centro, AMARRE_544))),
      ],
    },
  }),
  nota: "Igual: farol chino blanco con un pompón de papel rojo encima, tres hojas en lazo de T-260 Verde Trébol (medido #1bb12e: 029) asomando del pompón y tres R-12 de helio con su cinta: arriba el rojo con un corazón grande, a media altura el rojo de corazones blancos y el blanco de corazones rojos, a 0,8–1,2 m del pompón como en la foto. Va sobre una mesa redonda (la foto no la muestra). Distinto: los corazones impresos no se modelan (Fashion Rojo y Fashion Blanco lisos; la idea no enlaza el impreso) y farol y pompón son escenografía (no se cotizan).",
});

// ----------------------------------------------------------------------------------------------------------
// 563 · Feliz Navidad (R-24 de estrellas con base de cuartetos, de techo)
// ----------------------------------------------------------------------------------------------------------

/** Foto: R-24 de 195 px = 55 cm (3,55 px/cm); los verdes miden 80 px (22 cm: R-9), las flores rojas ~6 cm por pétalo. */
const CUARTETO_563 = flor({ petalos: { ...R("R-9", 22, "029"), cantidad: 4, aperturaGrados: 0, giroGrados: 45 }, centro: null });
const FLOR_ROJA_563 = flor({ petalos: { ...R("R-5", 6.5, "015"), cantidad: 5, aperturaGrados: 5, giroGrados: 90 }, centro: { ...R("R-5", 5.2, "015"), cantidad: 1 } });
const idea563 = idea({
  id: "idea:feliz-navidad", numero: 563, slug: "feliz-navidad",
  nombre: "Feliz Navidad: R-24 de estrellas con cuartetos", ocasiones: ["navidad", "general"],
  fotoUrl: FOTO("d5e98c36617ddf5431683eac63fa8cbc_e0f15c3c-b33c-4b61-a04b-677be7bd27ae.jpg"),
  productos: [liso("R-24", "015", 1), liso("R-9", "029", 8), liso("R-5", "015", 13)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        { id: "remate", nombre: "R-24 Fashion Rojo impreso «estrellas»", pieza: { tipo: "globo", formatoId: "R-24", infladoCm: 55, codigo: "015" }, colocacion: { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 0, giroGrados: 0, volteada: false } },
        // Los cuartetos cuelgan del R-24 mirando al piso: en su espacio, +y es abajo, +z la derecha y −x el frente.
        decoSobre("cuarteto-1", "Cuarteto R-9 Verde Trébol (arriba)", "remate", CUARTETO_563, v(0, -30, 0), v(0, -1, 0)),
        decoSobre("cuarteto-2", "Cuarteto R-9 Verde Trébol (abajo)", "cuarteto-1", CUARTETO_563, v(0, 14, 0), ARRIBA),
        decoSobre("flor-izquierda", "Flor roja (izquierda)", "cuarteto-1", FLOR_ROJA_563, v(0, 14, -21), v(0, 0, -1)),
        decoSobre("flor-derecha", "Flor roja (derecha)", "cuarteto-1", FLOR_ROJA_563, v(0, 14, 21), v(0, 0, 1)),
        globoSobre("centro", "R-5 Fashion Rojo (centro)", "cuarteto-1", R("R-5", 12, "015"), v(-16, 14, 0), v(-1, 0, 0)),
        {
          id: "cintas", nombre: "Cintas rojas y blancas",
          pieza: { tipo: "escenografia", elementos: [[-3, -2, "#d23a3f"], [2, 3, "#f0f0f0"], [4, -3, "#d23a3f"], [-2, 4, "#d23a3f"]].map(([x, z, hex]) => cinta(v(0, 0, 0), v(Number(x), 48, Number(z)), String(hex), 0.25)) },
          colocacion: { en: "sobre", padreId: "cuarteto-2", puntoCm: v(0, 12, 0), normal: ARRIBA, giroGrados: 0 },
        },
      ],
    },
  }),
  nota: "Igual: un R-24 rojo arriba (helio, contra el techo) y debajo dos cuartetos de R-9 Verde Trébol (medido #00ce66: 029) con un R-5 rojo asomando en el centro, una flor de 5 R-5 rojos a cada lado y las cintas rojas y blancas colgando. Distinto: las estrellas blancas impresas del R-24 no se modelan (Fashion Rojo liso) y se ponen solo las dos flores que se ven (puede haber otras detrás).",
});

// ----------------------------------------------------------------------------------------------------------
// 594 · Flor colorida
// ----------------------------------------------------------------------------------------------------------

/** Foto: tubito de ~35 px (T-260 a 5 cm): 7 px/cm. Flor de ~63 cm con 12 lazos de ~26 cm; tallo de ~50 cm. */
const FLOR_594: Pieza = {
  tipo: "decoracion", deFrente: true,
  decoracion: florTubito({ petalos: lazos("T-260", 5, ["020", "061", "011", "038"], 12, 26, 12, 20, 0), centro: R("R-5", 9, "031") }),
};
const idea594 = idea({
  id: "idea:flor-colorida", numero: 594, slug: "flor-colorida",
  nombre: "Flor colorida de lazos", ocasiones: ["cumpleanos"],
  fotoUrl: FOTO("c22ef704df61396b8786383d949fd597_5f361952-c16f-4dee-b5ce-d37b8fcf6fee.jpg"),
  productos: [liso("T-260", "020", 2), liso("T-260", "061", 2), liso("T-260", "011", 2), liso("T-260", "038", 2), liso("R-5", "031", 1), liso("T-260", "029", 2)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        { id: "flor", nombre: "Flor de 12 lazos", pieza: FLOR_594, colocacion: enLaPared(FLOR_594, 140) },
        palito("tallo", "Tallo de T-260 Verde Trébol", "flor", { formatoId: "T-260", grosorCm: 5, codigo: "029" }, v(8, -52, 0), v(0, -6, 0)),
        decoSobre("hojas", "Hojas de T-260 Verde Trébol", "flor", florTubito({ petalos: lazos("T-260", 4.5, ["029"], 2, 13, 8, 10, 190) }), v(4, -26, 0), AL_FRENTE),
      ],
    },
  }),
  nota: "Igual: flor de 12 lazos de T-260 en copa, de cuatro colores medidos en la foto (amarillo #faea28: Amarillo 020; naranja #fe9619: Naranja 061; rosa #fa4e9a: Fashion Rosa 011; azul #5dd6e8: Azul Caribe 038, que la tienda no lista en T-260), con un botón R-5 Verde Lima al centro, tallo de T-260 Verde Trébol (#4db925) y dos hojas en lazo. Distinto: en la foto los lazos se cruzan sin orden fijo de colores (aquí van en ciclo) y la flor mira un poco hacia arriba; tubitos contados por largo.",
});

// ----------------------------------------------------------------------------------------------------------
// 597 · Flor de corazones (centro de mesa)
// ----------------------------------------------------------------------------------------------------------

/** Foto: R-12 de 120 px = 28 cm (4,3 px/cm); base de ~37 cm; globos a 37 y 79 cm sobre la base. */
const BASE_597 = v(0, ALTO_MESA, 0);
const AMARRE_597 = v(0, ALTO_MESA + 8, 0);
const GLOBOS_597: ReadonlyArray<{ g: GloboRamo; centro: Vec3 }> = [
  { g: R("R-12", 28, "005"), centro: v(-8, ALTO_MESA + 10 + 37, -4) },
  { g: { ...R("R-12", 28, "015"), impreso: "corazones" }, centro: v(2, ALTO_MESA + 10 + 79, -2) },
];
const idea597 = idea({
  id: "idea:flor-de-corazones", numero: 597, slug: "flor-de-corazones",
  nombre: "Flor de corazones (centro de mesa)", ocasiones: ["san-valentin", "general"],
  fotoUrl: FOTO("dbe40e3ae348cbf8ee6ead7442221425_00c53ef5-dc4f-43d4-a44f-0fe6f53d429c.jpg"),
  productos: [liso("T-260", "005", 3), liso("C-12", "015", 5), liso("R-5", "015", 1), liso("R-12", "005", 1), liso("R-12", "015", 1)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        {
          id: "mesa", nombre: "Mesa y cintas",
          pieza: { tipo: "escenografia", elementos: [...MESA(), ...GLOBOS_597.map(({ g, centro }) => cinta(AMARRE_597, nudoDe(g, centro, menos(centro, AMARRE_597)), "#ececee"))] },
          colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 },
        },
        decoSobre("lazos", "Lazos blancos de T-260", "mesa", florTubito({ petalos: lazos("T-260", 4, ["005"], 5, 16, 11, 6, 0) }), BASE_597, ARRIBA),
        decoSobre("corazones", "Flor de corazones rojos", "lazos",
          { tipo: "flor_corazones", propiedades: { corazones: { ...R("C-12", 13, "015"), cantidad: 5, aperturaGrados: 35, giroGrados: 36 }, interior: burbujas("T-260", 3, ["005"], 5, 5, 40, 0), centro: R("R-5", 8, "015") } },
          v(0, 2, 0), ARRIBA),
        ...GLOBOS_597.map(({ g, centro }, i) => globoSobre(`globo-${i + 1}`, `${nombreGlobo(g, g.impreso)} ${i + 1}`, "mesa", g, centro, menos(centro, AMARRE_597))),
      ],
    },
  }),
  nota: "Igual: base de 5 lazos de T-260 blanco acostados sobre la mesa, encima una flor de 5 corazones rojos con burbujitas blancas y un R-5 rojo al centro, y dos R-12 de helio con su cinta: el blanco liso a ~37 cm de la base y el rojo de corazones a ~79 cm. Distinto: los corazones de la flor son Corazón 12 a 13 cm (el Corazón 6 rojo no está atestiguado), los corazones impresos del globo no se modelan (Fashion Rojo liso) y la mesa no sale en la foto.",
});

// ----------------------------------------------------------------------------------------------------------
// 598 · Flor destellos (centro de mesa)
// ----------------------------------------------------------------------------------------------------------

/** Foto: R-12 de 110 px = 28 cm (3,9 px/cm). Tallo de 17 cm hasta la flor; globos a 66, 97 y 128 cm de la mesa. */
const AMARRE_598 = v(0, ALTO_MESA + 9, 0);
const GLOBOS_598: ReadonlyArray<{ g: GloboRamo; centro: Vec3 }> = [
  { g: { ...R("R-12", 28, "015"), impreso: "Te amo" }, centro: v(0, ALTO_MESA + 128, -8) },
  { g: R("R-12", 28, "005"), centro: v(-6, ALTO_MESA + 97, -8) },
  { g: { ...R("R-12", 28, "015"), impreso: "Feliz Día" }, centro: v(13, ALTO_MESA + 66, -8) },
];
const idea598 = idea({
  id: "idea:flor-destellos", numero: 598, slug: "flor-destellos",
  nombre: "Flor destellos (centro de mesa)", ocasiones: ["san-valentin", "general"],
  fotoUrl: FOTO("98c584fcca04d6d7458f9831ead5d9e6.jpg"),
  productos: [liso("R-12", "015", 2), liso("R-12", "005", 1), liso("R-5", "015", 9), liso("R-5", "029", 1), liso("T-260", "005", 2), liso("T-260", "015", 1), liso("T-260", "029", 1)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        {
          id: "mesa", nombre: "Mesa y cintas",
          pieza: { tipo: "escenografia", elementos: [...MESA(), ...GLOBOS_598.map(({ g, centro }) => cinta(AMARRE_598, nudoDe(g, centro, menos(centro, AMARRE_598)), "#ececee"))] },
          colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 },
        },
        decoSobre("base", "Base de R-5 rojos", "mesa", flor({ petalos: { ...R("R-5", 8, "015"), cantidad: 6, aperturaGrados: 40, giroGrados: 0 }, centro: { ...R("R-5", 7, "015"), cantidad: 3 } }), v(0, ALTO_MESA, 0), ARRIBA),
        decoSobre("orejitas", "Burbujitas blancas", "base", florTubito({ petalos: burbujas("T-260", 3, ["005"], 6, 6, 55, 0) }), v(0, 9, 0), ARRIBA),
        palito("tallo", "Tallo de T-260 Verde Trébol", "mesa", { formatoId: "T-260", grosorCm: 3.5, codigo: "029" }, v(0, ALTO_MESA + 10, 0), v(0, ALTO_MESA + 27, 0)),
        decoSobre("flor", "Flor de burbujas roja y blanca", "mesa", florTubito({ petalos: burbujas("T-260", 3.5, ["015", "005"], 5, 13, 0, 90), centro: R("R-5", 6, "029") }), v(0, ALTO_MESA + 30, 1), AL_FRENTE),
        ...GLOBOS_598.map(({ g, centro }, i) => globoSobre(`globo-${i + 1}`, `${nombreGlobo(g, g.impreso)} ${i + 1}`, "mesa", g, centro, menos(centro, AMARRE_598))),
      ],
    },
  }),
  nota: "Igual: base de R-5 rojos con burbujitas blancas, tallo de T-260 Verde Trébol (medido #32ba5a: 029) de ~17 cm con una flor de 5 burbujas que alternan rojo y blanco y botón verde, y tres R-12 de helio con cinta a 66, 97 y 128 cm de la mesa: rojo «Feliz Día», blanco liso y rojo «Te amo». Distinto: los impresos no se modelan (Fashion Rojo liso), los pétalos de la foto llevan una perilla en la punta que aquí no está, y la mesa no sale en la foto.",
});

// ----------------------------------------------------------------------------------------------------------
// 600 · Flor en LOL (centro de mesa con corazones)
// ----------------------------------------------------------------------------------------------------------

/** Foto de 1000×1000: corazón de 230 px = 28 cm (8,2 px/cm). Flor de ~40 cm; corazones a ~41, 62 y 82 cm de su centro (con el hueco de la cinta). */
const FLOR_600 = flor({ petalos: { ...R("LOL-12", 20, "015"), cantidad: 6, aperturaGrados: 0, giroGrados: 90 }, centro: null });
/** De pie: su alto (el de la pieza mirando al frente) sale de su caja; se apoya en la mesa sin hundirse. */
const MEDIO_ALTO_600 = perezoso(() => medidas({ tipo: "decoracion", deFrente: true, decoracion: FLOR_600 }).altoCm / 2);
const CENTRO_600 = perezoso(() => v(0, r2(ALTO_MESA + MEDIO_ALTO_600() + 0.5), 0));
const CORAZONES_600 = perezoso((): ReadonlyArray<{ g: GloboRamo; centro: Vec3 }> => [
  { g: { ...R("C-12", 28, "009"), impreso: "Happy Valentine's Day" }, centro: mas(CENTRO_600(), v(0, 41, 0)) },
  { g: { ...R("C-12", 28, "015"), impreso: "Happy Valentine's Day" }, centro: mas(CENTRO_600(), v(0, 62, 0)) },
  { g: { ...R("C-12", 28, "009"), impreso: "Happy Valentine's Day" }, centro: mas(CENTRO_600(), v(0, 82, 0)) },
]);
const idea600 = idea({
  id: "idea:flor-en-lol-3", numero: 600, slug: "flor-en-lol-3",
  nombre: "Flor en LOL con corazones", ocasiones: ["san-valentin"],
  fotoUrl: FOTO("Flor_en_LOL_dc34d02f-0c81-470d-9acf-6d6d0e08c0b4.png"),
  productos: [
    // La idea los mapea a LOL-12; en la foto el centro dorado es de eslabones chicos (LOL-6, que el mismo producto vende).
    publicado("GLOBO LINK-O-LOON® METAL DORADO", "/products/globo-para-fiesta-latex-link-o-loon-metal-dorado-cobre", "LOL-6", "570", 6),
    publicado("GLOBO LINK-O-LOON® FASHION ROJO", "/products/globo-para-fiesta-latex-link-o-loon-fashion-rojo", "LOL-12", "015", 6),
    publicado("GLOBO TUBITO FASHION ROJO", "/products/globo-para-fiesta-latex-tubito-fashion-rojo", "T-260", "015", 1),
    publicado("GLOBO TUBITO FASHION ARENA", "/products/globo-para-fiesta-latex-tubito-fashion-arena", "T-260", "071", 1),
    liso("C-12", "009", 2),
    liso("C-12", "015", 1),
  ],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        {
          id: "mesa", nombre: "Mesa y cinta",
          pieza: { tipo: "escenografia", elementos: [...MESA(), ...CORAZONES_600().map(({ g, centro }) => cinta(v(0, ALTO_MESA, -3), nudoDe(g, centro, ARRIBA), "#e7b9c6"))] },
          colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 },
        },
        // De pie sobre la mesa, mirando al salón (su +y local hacia +z).
        decoSobre("flor", "Flor de 6 Link-O-Loon rojos", "mesa", FLOR_600, v(0, CENTRO_600().y, -6), AL_FRENTE),
        decoSobre("cuentas", "Cuentas de T-260 Fashion Rojo", "flor", florTubito({ petalos: burbujas("T-260", 3.5, ["015"], 12, 7, 0, 0) }), v(0, 3, 0), ARRIBA),
        decoSobre("centro-dorado", "Centro de 6 Link-O-Loon 6 Metal Dorado", "flor", flor({ petalos: { ...R("LOL-6", 8, "570"), cantidad: 6, aperturaGrados: 0, giroGrados: 90 }, centro: null }), v(0, 5, 0), ARRIBA),
        decoSobre("centro-arena", "Cuentas de T-260 Fashion Arena", "centro-dorado", florTubito({ petalos: burbujas("T-260", 3.5, ["071"], 6, 3.5, 0, 0) }), v(0, 3, 0), ARRIBA),
        ...CORAZONES_600().map(({ g, centro }, i) => globoSobre(`corazon-${i + 1}`, `${nombreGlobo(g, g.impreso)} ${i + 1}`, "mesa", g, centro, ARRIBA)),
      ],
    },
  }),
  nota: "Igual: flor de pie de 6 Link-O-Loon Fashion Rojo, un anillo de cuentas de T-260 rojo, centro de 6 eslabones Metal Dorado y cuentas de T-260 Arena (los productos que publica la idea), y encima tres Corazón 12 apilados con su cinta. Distinto: el anillo de la foto son ~22 cuentas redondas y aquí 12 burbujas cortas; el 7.º grano arena del centro no está; el corazón de abajo es fucsia en la foto (#fa56bb) y el Corazón 12 no viene en fucsia: va Fashion Rosado 009; «Happy Valentine's Day» no se modela.",
});

// ----------------------------------------------------------------------------------------------------------
// 603 · Flor fucsia (de pared)
// ----------------------------------------------------------------------------------------------------------

/** Foto: centro de 120 px (R-12 a 30 cm): 4 px/cm. Pétalos R-12 a 28 cm; parejas de R-5 a ~58 cm del centro. */
const FLOR_AMARILLA_603: Pieza = { tipo: "decoracion", deFrente: true, decoracion: flor({ petalos: { ...R("R-12", 26, "020"), cantidad: 6, aperturaGrados: 0, giroGrados: 30 }, centro: null }) };
/** Las 10 parejas de la foto: ángulo (0° a la derecha, 90° arriba) y color. */
const PAREJAS_603: ReadonlyArray<[number, string]> = [[94, "061"], [124, "011"], [56, "051"], [23, "020"], [192, "030"], [-10, "038"], [206, "061"], [245, "038"], [319, "051"], [277, "030"]];
const idea603 = idea({
  id: "idea:flor-fucsia", numero: 603, slug: "flor-fucsia",
  nombre: "Flor fucsia de pared", ocasiones: ["cumpleanos"],
  fotoUrl: FOTO("686a74b744eb4093d6512c31cf6196fa_24a34c41-44aa-4b99-84d2-c0f69378a4fd.jpg"),
  productos: [liso("R-12", "020", 6), liso("R-12", "011", 6), liso("R-12", "030", 1), liso("R-5", "061", 4), liso("R-5", "011", 2), liso("R-5", "051", 4), liso("R-5", "020", 2), liso("R-5", "030", 4), liso("R-5", "038", 4)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        { id: "flor-amarilla", nombre: "Flor de 6 R-12 Amarillo (detrás)", pieza: FLOR_AMARILLA_603, colocacion: enLaPared(FLOR_AMARILLA_603, 140) },
        decoSobre("flor-fucsia", "Flor de 6 R-12 Fashion Rosa con centro verde", "flor-amarilla", flor({ petalos: { ...R("R-12", 28, "011"), cantidad: 6, aperturaGrados: 0, giroGrados: 90 }, centro: { ...R("R-12", 30, "030"), cantidad: 1 } }), v(0, 0, 2), AL_FRENTE),
        ...PAREJAS_603.flatMap(([a, codigo], k) => {
          const radial = enCirculo(a, 1), tangente = v(-radial.y, radial.x, 0);
          return [-1, 1].map((s, j) => {
            const centro = mas(enCirculo(a, 58, 2), por(tangente, s * 5.5));
            return globoSobre(`pareja-${k + 1}-${j + 1}`, `Pareja ${k + 1}: ${nombreGlobo(R("R-5", 10, codigo))} ${j + 1}`, "flor-amarilla", R("R-5", 10, codigo), centro, mas(radial, v(0, 0, 0.8)));
          });
        }),
      ],
    },
  }),
  nota: "Igual: flor de 6 R-12 en Fashion Rosa (medido #ff66c5: el Fashion más cercano; el Neón Fucsia queda más cerca aún) con un R-12 Fashion Verde al centro (#00e4a1: 030), sobre una segunda flor de 6 R-12 Fashion Amarillo (#f2d900: 020) girada medio pétalo, y 10 parejas de R-5 en las puntas: naranja 061, rosa 011, violeta 051 (#6c0898), amarillo 020, verde 030 y azul caribe 038 (#00ceeb), en el orden de la foto. Distinto: en la foto alguna pareja asoma solo un globo; aquí todas van de a dos.",
});

// ----------------------------------------------------------------------------------------------------------
// 606 · Flores de corazones (de pared)
// ----------------------------------------------------------------------------------------------------------

/** Foto: corazón de 60 px (~13 cm): 4,6 px/cm. Lazos de ~50 cm de largo y ~39 de ancho en la foto; aquí 44 × 31, lo que da un T-260 por lazo. */
const LAZOS_606: Pieza = { tipo: "decoracion", deFrente: true, decoracion: florTubito({ petalos: lazos("T-260", 3, ["005"], 5, 44, 31, 0, 270) }) };
const idea606 = idea({
  id: "idea:flores-de-corazones", numero: 606, slug: "flores-de-corazones",
  nombre: "Flor de lazos blancos con corazones", ocasiones: ["san-valentin", "general"],
  fotoUrl: FOTO("33fe94b207f4b244e24138a9241325ef_79725f95-fa19-4e1f-9101-fd94c0686c75.jpg"),
  productos: [liso("T-260", "005", 5), liso("C-12", "015", 5), liso("R-5", "005", 1)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        { id: "lazos", nombre: "Flor de 5 lazos de T-260 blanco", pieza: LAZOS_606, colocacion: enLaPared(LAZOS_606, 140) },
        decoSobre("corazones", "Flor de 5 corazones rojos", "lazos",
          { tipo: "flor_corazones", propiedades: { corazones: { ...R("C-12", 13, "015"), cantidad: 5, aperturaGrados: 0, giroGrados: 270 }, interior: null, centro: R("R-5", 6, "005") } }, v(0, 0, 1), AL_FRENTE),
      ],
    },
  }),
  nota: "Igual: flor de 5 lazos grandes de T-260 Fashion Blanco (44 cm de largo, que se cruzan entre sí; en la foto ~50: así cada lazo sale de un T-260) con una flor de 5 corazones Fashion Rojo y un botón R-5 blanco al centro, en la pared. Distinto: los corazones de la foto (~13 cm) son Corazón 12 a medio inflar (el Corazón 6 rojo no está atestiguado); los lazos se cuentan por largo.",
});

// ----------------------------------------------------------------------------------------------------------
// 609 · Flores unidas (de pared)
// ----------------------------------------------------------------------------------------------------------

/** Foto: flor de 155 px (~30 cm): 5,2 px/cm. Centro de la violeta en (378, 232) px. */
const florR5 = (petalo: string, corona: string): Decoracion => flor({ petalos: { ...R("R-5", 11, petalo), cantidad: 5, aperturaGrados: 0, giroGrados: 90 }, corona: { ...R("R-5", 7, corona), cantidad: 5 }, centro: { ...R("R-5", 5.5, "021"), cantidad: 1 } });
const VIOLETA_609: Pieza = { tipo: "decoracion", deFrente: true, decoracion: florR5("051", "050") };
const TURQUESA_609 = v(-50, 27.7, 0), NARANJA_609 = v(43.7, 28.3, 0), PIE_609 = v(0, -60, 0);
const TALLO_609: Tubito = { formatoId: "T-260", grosorCm: 3.5, codigo: "031" };
const idea609 = idea({
  id: "idea:flores-unidas", numero: 609, slug: "flores-unidas",
  nombre: "Flores unidas de pared", ocasiones: ["cumpleanos"],
  fotoUrl: FOTO("483de01ed900867dfc58da130d4e9371_80f8f429-b380-46a7-9276-d1d7275a1338.jpg"),
  productos: [liso("R-5", "051", 5), liso("R-5", "050", 5), liso("R-5", "038", 5), liso("R-5", "011", 5), liso("R-5", "061", 5), liso("R-5", "029", 5), liso("R-5", "021", 3), liso("T-260", "031", 3)],
  clase: "escena", contenido: () => ({
    tipo: "escena",
    escena: {
      sala: structuredClone(SALA_CHICA),
      nodos: [
        { id: "violeta", nombre: "Flor violeta (centro)", pieza: VIOLETA_609, colocacion: enLaPared(VIOLETA_609, 150) },
        palito("tallo-abajo", "Tallo de abajo", "violeta", TALLO_609, mas(PIE_609, v(0, 0, -4)), v(0, 0, -4)),
        palito("tallo-izquierda", "Tallo a la flor turquesa", "violeta", TALLO_609, mas(TURQUESA_609, v(0, 0, -4)), v(0, 0, -4)),
        palito("tallo-derecha", "Tallo a la flor naranja", "violeta", TALLO_609, mas(NARANJA_609, v(0, 0, -4)), v(0, 0, -4)),
        decoSobre("turquesa", "Flor turquesa", "violeta", florR5("038", "011"), mas(TURQUESA_609, v(0, 0, -5.5)), AL_FRENTE),
        decoSobre("naranja", "Flor naranja", "violeta", florR5("061", "029"), mas(NARANJA_609, v(0, 0, -5.5)), AL_FRENTE),
      ],
    },
  }),
  nota: "Igual: tres flores de 5 R-5 con corona de 5 R-5 chicos y botón Amarillo Miel (medido #f3c801: 021), en la posición de la foto: turquesa (#00b1d0: Azul Caribe 038) con corona rosa (#ff56a3: Fashion Rosa 011), violeta (#520c7d: 051) con corona lila (#c58ac9: Fashion Lila 050) y naranja (061) con corona verde (#10ce64: Verde Trébol 029), unidas por tallos de T-260 Verde Lima (#65dc88: 031). Distinto: los tallos de la foto son ondulados; aquí son rectos (el taller no tuerce tubitos en ondas sueltas).",
});

/** Ideas de fiesta de sempertex.com digitalizadas: lote 02. */
export const LOTE_02: readonly IdeaDigitalizada[] = [
  idea503, idea505, idea506, idea531, idea544, idea550, idea557, idea559, idea560, idea561,
  idea562, idea563, idea593, idea594, idea597, idea598, idea600, idea603, idea606, idea609,
];
