import { ideaPerezosa, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import type { ParteGlobo } from "../decoraciones";
import type { Decoracion } from "../figuras";
import type { PatronColumna } from "../columnas";
import type { PropiedadesRizo } from "../rizos";
import type { PropiedadesBurbuja } from "../burbujas";
import { opcionesRacimosLibres } from "../estructuras-organicas";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 06**, las que dependen sobre todo de **rizos de tubito**
 * (`rizos.ts`: tirabuzones, resortes, penachos, flecos, burbujas en cadena) o del **globo burbuja** con globos dentro
 * (`burbujas.ts`). Salen de `clasif/todas.json` buscando en «falta» rizo, espiral, resorte, burbuja o «dentro».
 *
 * Cómo se hizo (2026-10-07), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta y ampliada:
 * - **Foto, etiquetas y productos de la ficha**: de `fuenteIdea(slug)` (la foto pública del CDN, las etiquetas de la
 *   tienda —de ahí las ocasiones, con `ocasionesDeEtiquetas`— y los productos que enlaza la idea).
 * - **Medidas**: la escala sale de un globo de tamaño conocido en la misma foto (R-12 de estructura ≈ 25 cm) y con ella
 *   el largo de los rizos, el tamaño de la burbuja (R-24 ≈ 50 cm, R-36 ≈ 68 cm) y el de la estrella.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos. Si no, se midió en la foto (Python/PIL, k-medias de
 *   los píxeles que no son fondo) y se tomó el código más cercano que se fabrica en ese formato; la nota lo dice.
 * - **Cantidades**: contadas en la foto (`contada: true`); los tubitos, uno por rizo o fleco (ver `materialesRizo`).
 * - Impresos que la tienda no tiene en el catálogo del taller van en el liso de su color de fondo, y la nota lo dice.
 * Unidades: cm.
 */

// ----------------------------------------------------------------------------------------------------------
// Ayudas
// ----------------------------------------------------------------------------------------------------------

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
const libre = (xCm: number, yCm: number, zCm = 0, giroGrados = 0): Colocacion => ({ en: "libre", xCm, yCm, zCm, giroGrados });
const sala = (): Escena["sala"] => structuredClone(SALA_INICIAL);
const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** Una decoración de pie (rizo, burbuja, flor de pared…) en la escena: derecha y de frente al salón. */
const deco = (id: string, nombre: string, decoracion: Decoracion, colocacion: Colocacion, deFrente = true): NodoEscena =>
  ({ id, nombre, pieza: { tipo: "decoracion", decoracion, ...(deFrente ? { deFrente: true } : {}) }, colocacion });
const rizo = (p: PropiedadesRizo): Decoracion => ({ tipo: "rizo", propiedades: p });
const burbuja = (p: PropiedadesBurbuja): Decoracion => ({ tipo: "burbuja", propiedades: p });

/** El producto liso de la tienda para un formato y un código (nombre y url relativa exactos de `GLOBOS_TIENDA`). */
function liso(formatoId: string, codigo: string, cantidad: number): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const producto = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const p = productoDeGlobo(formatoId, codigo); return { nombre: p.nombre, url: quitarOrigen(p.url) }; })();
  return { nombre: producto.nombre, url: producto.url, formato: formatoId, codigo, cantidad, contada: true };
}

/**
 * Los productos de lo que se armó: un liso por formato y código con la cantidad del 3D (la contada en la foto). Si la
 * ficha de la idea enlaza ese producto, va con su nombre tal cual lo publica la idea.
 */
function productosDeContenido(contenido: IdeaDigitalizada["contenido"], publicados: ReadonlyArray<{ nombre: string; url: string }>): ProductoDeIdea[] {
  const materiales = contenido.tipo === "escena" ? armarEscena(contenido.escena).materiales : armarPieza(contenido.pieza).materiales;
  return materiales.filter((m) => m.cantidad > 0).map((m) => {
    const p = liso(m.formatoId, m.codigo, Math.ceil(m.cantidad - 1e-9));
    const publicado = publicados.find((q) => q.url === p.url);
    return publicado ? { ...p, nombre: publicado.nombre } : p;
  });
}

/** `contenido` es una función: la escena se arma la primera vez que se pide (patrón perezoso de `tipos.ts`). */
type Base = { slug: string; nombre: string; contenido: () => IdeaDigitalizada["contenido"]; nota: string };

/**
 * La idea en el formato común. Número, foto y productos publicados salen de `fuenteIdea`; las ocasiones, de sus
 * etiquetas con `ocasionesDeEtiquetas`. Esa función vive en `index.ts`, que importa este lote: se calculan al leerlas
 * (un getter), no al cargar el módulo, para no tropezar con el ciclo de importaciones. Contenido y productos son
 * perezosos (`ideaPerezosa`): nada se arma al importar el lote.
 */
function idea(b: Base): IdeaDigitalizada {
  const fuente = fuenteIdea(b.slug);
  if (!fuente) throw new Error(`Idea desconocida: ${b.slug}`);
  return ideaPerezosa({
    id: `idea:${b.slug}`, numero: fuente.numero, slug: b.slug, nombre: b.nombre, fotoUrl: fuente.fotoUrl, clase: "escena", nota: b.nota,
    get ocasiones() { return ocasionesDeEtiquetas(fuente.etiquetas); },
  }, b.contenido, (contenido) => productosDeContenido(contenido, fuente.productos));
}

type Banda = { id: string; nombre: string; formatoId: string; infladoCm: number; niveles: number; patron: PatronColumna; colores: string[] };

/**
 * Columnas apiladas (una por banda, como en el lote 01): la de abajo en el piso y las demás sueltas encima, con su primer
 * cuarteto a medio paso del último de la de abajo y giradas 1/8 de vuelta por nivel. Devuelve los nodos y la altura
 * de la cara de arriba del último nivel.
 */
function apilar(bandas: readonly Banda[]): { nodos: NodoEscena[]; arribaCm: number } {
  const nodos: NodoEscena[] = [];
  let centro = 0, pasoAnterior = 0, niveles = 0, arriba = 0;
  bandas.forEach((b, i) => {
    const paso = b.infladoCm * 0.8;
    const pieza: Pieza = { tipo: "columna", formatoId: b.formatoId, infladoCm: b.infladoCm, alturaCm: Math.round(b.niveles * paso * 10) / 10, patron: b.patron, colores: b.colores };
    const caja = armarPieza(pieza).caja;
    if (i === 0) centro = -caja.min.y;
    else centro += (pasoAnterior + paso) / 2;
    nodos.push({ id: b.id, nombre: b.nombre, pieza, colocacion: i === 0 ? PISO : libre(0, Math.round(centro * 100) / 100, 0, (niveles % 2) * 45) });
    centro += (b.niveles - 1) * paso;
    // La cara de arriba del último cuarteto: los globos de la trenza se tumban, sobresalen ~0,42 inflados del centro.
    arriba = centro + b.infladoCm * 0.42;
    pasoAnterior = paso;
    niveles += b.niveles;
  });
  return { nodos, arribaCm: Math.round(arriba * 10) / 10 };
}

// ----------------------------------------------------------------------------------------------------------
// 893 · Rizos alegres (colgante de techo)
// ----------------------------------------------------------------------------------------------------------

/** Un R-5 suelto (el centro de su cuerpo en el punto pedido). */
const r5 = (id: string, nombre: string, codigo: string, x: number, y: number, z: number): NodoEscena =>
  ({ id, nombre, pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 11, codigo }, colocacion: libre(x, y, z) });

/** Medido en la foto (1 px ≈ 0,25 cm con el R-12 de ~25 cm): racimo fucsia, R-12 mostaza, cuarteto fucsia y rizos de ~75 cm. */
const RIZOS_ALEGRES = (): Escena => {
  const yGlobo = 205;
  // Racimo de 7 R-5 encima del R-12 (6 en anillo y 1 arriba) y cuarteto debajo, con los globos tocándose.
  const anillo = Array.from({ length: 6 }, (_, k) => {
    const a = (k * Math.PI) / 3;
    return r5(`racimo-${k + 1}`, `Racimo fucsia de arriba ${k + 1}`, "012", Math.round(10 * Math.cos(a) * 10) / 10, yGlobo + 19, Math.round(10 * Math.sin(a) * 10) / 10);
  });
  const cuarteto = Array.from({ length: 4 }, (_, k) => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    return r5(`cuarteto-${k + 1}`, `Cuarteto fucsia de abajo ${k + 1}`, "012", Math.round(7.5 * Math.cos(a) * 10) / 10, yGlobo - 16, Math.round(7.5 * Math.sin(a) * 10) / 10);
  });
  return {
    sala: sala(),
    nodos: [
      ...anillo,
      r5("racimo-7", "Racimo fucsia de arriba 7", "012", 0, yGlobo + 27, 0),
      { id: "globo-mostaza", nombre: "Globo R-12 mostaza", pieza: { tipo: "globo", formatoId: "R-12", infladoCm: 25, codigo: "023" }, colocacion: libre(0, yGlobo) },
      ...cuarteto,
      deco("rizos", "Chorro de rizos de T-260", rizo({
        forma: "penacho", formatoId: "T-260", grosorCm: 3, codigos: ["051", "061", "035", "029", "012", "050", "041", "009", "061", "029"],
        rizos: 10, vueltas: 2.2, radioInicialCm: 3, radioFinalCm: 7, largoCm: 72, inclinacionGrados: 180, aperturaGrados: 32,
      }), libre(0, yGlobo - 20)),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 331 · Colgante para papá (guirnalda orgánica con flecos)
// ----------------------------------------------------------------------------------------------------------

const MEZCLA_COLGANTE = [{ t: 0, pesos: { "R-12": 0.45, "R-9": 0.2, "R-5": 0.35 } }, { t: 1, pesos: { "R-12": 0.45, "R-9": 0.2, "R-5": 0.35 } }];
const COLGANTE_PAPA = (): Escena => ({
  sala: sala(),
  nodos: [
    {
      id: "guirnalda", nombre: "Guirnalda orgánica azul",
      pieza: {
        tipo: "organico", flores: null,
        opciones: opcionesRacimosLibres({
          semilla: 331, suelo: false,
          racimos: [{ id: "guirnalda", nombre: "Guirnalda horizontal", puntos: [{ x: -48, y: 0, z: 0 }, { x: -16, y: 5, z: 0 }, { x: 16, y: 4, z: 0 }, { x: 48, y: -2, z: 0 }], radioInicioCm: 20, radioFinCm: 20, mezcla: MEZCLA_COLGANTE, tapas: { inicio: true, fin: true } }],
          colores: [
            { codigo: "040", peso: 22 }, // Fashion Azul (publicado)
            { codigo: "044", peso: 14 }, // Fashion Azul Naval (publicado)
            { codigo: "940", peso: 16 }, // Reflex Azul (publicado)
            { codigo: "981", peso: 10, formatos: ["R-5", "R-9", "R-12"] }, // Reflex Plata
            { codigo: "005", peso: 8 }, // Fashion Blanco
            { codigo: "038", peso: 6, formatos: ["R-5", "R-9"] }, // Azul Caribe (los chiquitos turquesa)
            { codigo: "390", peso: 8, confeti: true, formatos: ["R-12"] }, // Cristal con confeti plateado
            { codigo: "015", peso: 7, formatos: ["R-12"] }, // los rojos impresos «Feliz día papá»
          ],
        }),
      },
      // Colgada del techo a ~2,1 m: suelta, con su eje donde se pidió.
      colocacion: libre(0, 214),
    },
    deco("flecos", "Flecos de T-260 azules y plateados", rizo({
      forma: "flecos", formatoId: "T-260", grosorCm: 3, codigos: ["040", "940", "981", "044", "040", "940"], tiras: 30, anchoCm: 86, largoCm: 64, ondas: 0.9, amplitudCm: 3, disparejo: 0.25,
    }), libre(0, 204, 2)),
  ],
});

// ----------------------------------------------------------------------------------------------------------
// 532 · Estrella navideña (burbujas en cadena)
// ----------------------------------------------------------------------------------------------------------

/** Escala de la foto: la burbuja grande mide ~50 × 35 px y el T-260 a ~4,6 cm de grosor → ~0,13 cm/px; la estrella, ~74 cm. Las puntas de adentro tocan el aro. */
const ESTRELLA_NAVIDENA = (): Escena => ({
  sala: sala(),
  nodos: [
    deco("estrella", "Estrella de burbujas doradas", rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 4.6, codigos: ["570"], largosCm: [7.5, 3, 3], recorrido: "estrella", cantidad: 0, puntas: 5, radioCm: 37, radioInteriorCm: 12 }), libre(0, 170, -240)),
    deco("aro", "Aro verde de 5 burbujas", rizo({ forma: "burbujas", formatoId: "T-260", grosorCm: 3.8, codigos: ["032"], largosCm: [13], recorrido: "aro", cantidad: 5, giroGrados: 36 }), libre(0, 170, -238)),
    deco("flor", "Flor roja de 5 burbujas", { tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 5, codigos: ["015"], cantidad: 5, estilo: "burbuja", largoCm: 7, anchoCm: 5, aperturaGrados: 0, giroGrados: 90 }, interior: null, corona: null, centro: R("R-5", 4.5, "570") } }, libre(0, 170, -236)),
  ],
});

// ----------------------------------------------------------------------------------------------------------
// 939 · Topiario reflex (esfera sobre un nido de rizos)
// ----------------------------------------------------------------------------------------------------------

const TOPIARIO_REFLEX = (): Escena => ({
  sala: sala(),
  nodos: [
    deco("nido", "Nido de rizos de T-260 Reflex Plata", rizo({ forma: "penacho", formatoId: "T-260", grosorCm: 3.2, codigos: ["981"], rizos: 12, vueltas: 2.2, radioInicialCm: 4, radioFinalCm: 6.5, largoCm: 32, inclinacionGrados: 180, aperturaGrados: 88 }), libre(0, 33)),
    { id: "esfera", nombre: "Esfera de R-12 Reflex Dorado Rosa con R-5 Reflex Plata", pieza: { tipo: "forma", forma: { clase: "esfera", diametroCm: 60, globo: { formatoId: "R-12", infladoCm: 25 }, colores: { codigos: ["968"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 9, codigos: ["981"], cada: 1 } } }, colocacion: libre(0, 28) },
  ],
});

// ----------------------------------------------------------------------------------------------------------
// 405 · Columna romana (columna con burbuja de R-5 pastel)
// ----------------------------------------------------------------------------------------------------------

const COLUMNA_ROMANA = (): Escena => {
  const pila = apilar([
    { id: "base", nombre: "Base rosada (2 cuartetos)", formatoId: "R-12", infladoCm: 25, niveles: 2, patron: "un_color", colores: ["009"] },
    { id: "fuste", nombre: "Fuste en espiral de R-5 pastel", formatoId: "R-5", infladoCm: 12, niveles: 9, patron: "espiral", colores: ["059", "030", "020", "040"] },
    { id: "capitel", nombre: "Capitel rosado (2 cuartetos)", formatoId: "R-12", infladoCm: 25, niveles: 2, patron: "un_color", colores: ["009"] },
  ]);
  return {
    sala: sala(),
    nodos: [
      ...pila.nodos,
      deco("burbuja", "Burbuja con R-5 pastel dentro", burbuja({ exterior: R("R-24", 50, "390"), interiores: [{ formatoId: "R-5", infladoCm: 11, codigos: ["059", "020", "030", "040", "009"], cantidad: 15 }], relleno: null, semilla: 405 }), libre(0, pila.arribaCm - 4)),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 520 · Encanto navideño (burbuja con R-9 sobre base roja)
// ----------------------------------------------------------------------------------------------------------

const ENCANTO_NAVIDENO = (): Escena => {
  const pila = apilar([{ id: "base", nombre: "Base roja (2 cuartetos)", formatoId: "R-12", infladoCm: 25, niveles: 2, patron: "un_color", colores: ["015"] }]);
  const flor = (lado: number): NodoEscena => deco(`flor-${lado > 0 ? "derecha" : "izquierda"}`, `Flor de lazos amarilla (${lado > 0 ? "derecha" : "izquierda"})`, {
    tipo: "flor_tubito", propiedades: { petalos: { formatoId: "T-260", grosorCm: 3.5, codigos: ["021"], cantidad: 4, estilo: "lazo", largoCm: 13, anchoCm: 9, aperturaGrados: 0, giroGrados: 45 }, interior: null, corona: null, centro: R("R-5", 5, "021") },
  }, libre(lado * 48, pila.arribaCm - 8, 4));
  return {
    sala: sala(),
    nodos: [
      ...pila.nodos,
      deco("burbuja", "Burbuja con R-9 rojos, dorados y verdes", burbuja({ exterior: R("R-36", 68, "390"), interiores: [{ formatoId: "R-9", infladoCm: 18, codigos: ["015", "570", "029"], cantidad: 13 }], relleno: null, semilla: 520 }), libre(0, pila.arribaCm - 6)),
      flor(-1), flor(1),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// 541 · Fantasía neón (columna negra con rizos neón y burbuja)
// ----------------------------------------------------------------------------------------------------------

const RIZOS_NEON: ReadonlyArray<{ codigo: string; ancla: number; forma: "tirabuzon" | "resorte" }> = [
  { codigo: "212", ancla: 20, forma: "resorte" }, { codigo: "230", ancla: 23, forma: "resorte" }, { codigo: "230", ancla: 17, forma: "tirabuzon" },
  { codigo: "212", ancla: 13, forma: "tirabuzon" }, { codigo: "212", ancla: 10, forma: "resorte" }, { codigo: "240", ancla: 7, forma: "resorte" },
  { codigo: "261", ancla: 5, forma: "resorte" }, { codigo: "230", ancla: 2, forma: "resorte" },
];
const FANTASIA_NEON = (): Escena => {
  const pila = apilar([{ id: "columna", nombre: "Columna negra", formatoId: "R-12", infladoCm: 22, niveles: 7, patron: "un_color", colores: ["080"] }]);
  return {
    sala: sala(),
    nodos: [
      ...pila.nodos,
      ...RIZOS_NEON.map((r, k) => deco(`rizo-${k + 1}`, `Rizo neón ${k + 1}`, rizo(r.forma === "resorte"
        ? { forma: "resorte", tubito: { formatoId: "T-260", grosorCm: 3, codigo: r.codigo }, vueltas: 2.5, radioCm: 6.5, largoCm: 15, eje: "frente", giroGrados: k * 50 }
        : { forma: "tirabuzon", tubito: { formatoId: "T-260", grosorCm: 3, codigo: r.codigo }, vueltas: 2, radioInicialCm: 4, radioFinalCm: 7, largoCm: 17, eje: "frente", giroGrados: k * 50 }),
      { en: "ancla", padreId: "columna", ancla: r.ancla, cada: 0, giroGrados: 0 }, false)),
      deco("burbuja", "Burbuja con R-5 neón dentro", burbuja({ exterior: R("R-24", 46, "390"), interiores: [{ formatoId: "R-5", infladoCm: 11, codigos: ["212", "220", "261", "230", "240"], cantidad: 11 }], relleno: null, semilla: 541 }), libre(0, pila.arribaCm - 4)),
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------
// El lote
// ----------------------------------------------------------------------------------------------------------

const escena = (e: Escena): IdeaDigitalizada["contenido"] => ({ tipo: "escena", escena: e });

/** Ideas de fiesta de sempertex.com digitalizadas: lote 06 (rizos de tubito y globos burbuja). */
export const LOTE_06: readonly IdeaDigitalizada[] = [
  idea({
    slug: "rizos-alegres", nombre: "Rizos alegres", contenido: () => escena(RIZOS_ALEGRES()),
    nota: "Igual: colgante de techo con un racimo de 7 R-5 Fucsia arriba, un R-12 al medio, un cuarteto de R-5 Fucsia debajo y un chorro de 10 T-260 en rizos sueltos (~72 cm) de 8 colores. La idea no publica productos: colores medidos en la foto (R-12 #cfa415 → Fashion Mostaza 023, la clasificación decía «amarillo»; rosado #f62f70 → Fucsia 012; rizos violeta 051, naranja 061, turquesa profundo 035, verde trébol 029, lila 050, azul rey 041 y rosado 009). Distinto: en la foto los rizos caen enredados y desparejos; en el 3D son tirabuzones abiertos en cono, cada uno con su espiral regular.",
  }),
  idea({
    slug: "colgante-para-papa", nombre: "Colgante para papá", contenido: () => escena(COLGANTE_PAPA()),
    nota: "Igual: guirnalda orgánica horizontal de ~1 m (R-12, R-9 y R-5) con los 3 productos de la ficha —Fashion Azul 040, Azul Naval 044 y Reflex Azul 940— más blanco, plata, azul caribe y cristales con confeti plateado; debajo, 30 flecos de T-260 azules, reflex azul, plata y naval de ~64 cm, ondulados y desparejos. Distinto: los R-12 rojos de la foto llevan impreso «Feliz día papá», que no está en el catálogo de impresos del taller: van en Fashion Rojo liso; el reparto de colores del orgánico es al azar (semilla), no globo por globo.",
  }),
  idea({
    slug: "estrella-navidena", nombre: "Estrella navideña de burbujas", contenido: () => escena(ESTRELLA_NAVIDENA()),
    nota: "Igual: el contorno de una estrella de 5 puntas (~74 cm) hecho con T-260 dorados retorcidos en burbujas en cadena (una grande de ~7 cm y dos chiquitas, en ciclo), un aro verde de 5 burbujas en el centro y una flor roja de 5 burbujas con un botón dorado. Sin productos publicados: dorado medido #df9822 → Metal Dorado 570 (perlado, como la foto), verde #0f7152 → Verde Selva 032, rojo → Fashion Rojo 015. Distinto: en la foto las burbujas chiquitas son orejitas (pellizcos de 4) que salen a los lados de la cadena; en el 3D van en la misma línea.",
  }),
  idea({
    slug: "topiario-reflex", nombre: "Topiario reflex", contenido: () => escena(TOPIARIO_REFLEX()),
    nota: "Igual: los 2 productos de la ficha —R-12 Reflex Dorado Rosa 968 en una esfera de ~60 cm con R-5 Reflex Plata en los huecos y T-260 Reflex Plata en rizos— y el nido de 12 tirabuzones plateados que se abren hacia abajo y hacia los lados bajo la esfera. Distinto: los R-5 plata (Reflex Plata 981 en R-5) no están en la ficha; en la foto el nido es un enredo de lazos y rizos, aquí tirabuzones regulares.",
  }),
  idea({
    slug: "columna-romana", nombre: "Columna romana con burbuja", contenido: () => escena(COLUMNA_ROMANA()),
    nota: "Igual: base y capitel de 2 cuartetos R-12 rosados, fuste delgado de cuartetos R-5 en espiral de 4 colores y, arriba, una burbuja R-24 Cristal Transparente con 15 R-5 pastel amontonados dentro (globo dentro de globo). Sin productos publicados: colores medidos (rosado #e5bbd5 → Fashion Rosado 009, coral #f89ca6 → Coral Tropical 059, menta #09caa9 → Fashion Verde 030, amarillo #ead17b → Fashion Amarillo 020, azul #04b8d7 → Fashion Azul 040). Distinto: los R-12 rosados de la foto llevan estrellitas blancas impresas (van lisos); la burbuja es látex cristal de Sempertex, no un Deco Bubble de plástico.",
  }),
  idea({
    slug: "encanto-navideno", nombre: "Encanto navideño", contenido: () => escena(ENCANTO_NAVIDENO()),
    nota: "Igual: base de 2 cuartetos R-12 Fashion Rojo, encima una burbuja grande (R-36 Cristal Transparente a ~68 cm, medida contra el R-12) con 13 R-9 rojos, dorados y verdes dentro, y a cada lado una flor de 4 lazos de T-260 amarillo con su botón. Sin productos publicados: verde #2bad21 → Verde Trébol 029, rojo #fb342c → Rojo 015, dorado metálico → Metal Dorado 570, amarillo de los lazos → Amarillo Miel 021. Distinto: en la foto cada lado parece un moño de 6 lazos (aquí una flor de 4) y los globos de adentro llenan más arriba.",
  }),
  idea({
    slug: "fantasia-neon", nombre: "Fantasía neón", contenido: () => escena(FANTASIA_NEON()),
    nota: "Igual: columna de cuartetos R-12 Fashion Negro (~1,2 m) con 8 rizos de T-260 neón pegados de frente (resortes y tirabuzones cortos: fucsia, verde, azul y naranja; el amarillo neón no se vende en T-260, va verde) y, arriba, una burbuja R-24 Cristal Transparente con 11 R-5 neón dentro. Sin productos publicados: colores medidos y llevados a la familia Neón (212, 220, 230, 240, 261). Distinto: la columna de la foto es orgánica (R-12 y R-9 sueltos), aquí de cuartetos; el rizo morado de la foto va en Neón Fucsia (no hay violeta neón).",
  }),
];
