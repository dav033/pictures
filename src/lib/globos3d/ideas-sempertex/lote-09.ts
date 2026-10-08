import type { IdeaDigitalizada, ProductoDeIdea } from "./tipos";
import { fuenteIdea, type FuenteIdea } from "./fuentes";
import { ocasionesDeEtiquetas } from "./index";
import { armarEscena, SALA_INICIAL, type Colocacion, type Escena, type Sala } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import type { OpcionesMural } from "../murales";
import type { ElementoTecho } from "../techo";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 09**, las que dependen de los tres generadores nuevos —
 * **murales pixelados** (`murales.ts`), **decoraciones de techo** (`techo.ts`) y **palmeras y árboles** (`arboles-globos.ts`)—:
 * 4 murales (#770 bandera de Brasil, #158 bandera de Australia, #824 pared corazón, #773 cancha de fútbol), 2 de techo
 * (#536 festones corporativos, #697 lluvia de globos) y 4 árboles (#816 y #817 palmeras, #48 árbol esfera, #53 árbol de
 * manzanas).
 *
 * Cómo se hizo (2026-10-08), idea por idea, con su foto (`fotos/<slug>--0.*`) ampliada con rejilla:
 * - **Murales**: se contaron las celdas en la foto (los huecos «corbatín» de la malla, los globos grandes y chicos por
 *   fila y columna) y se reconoció la disposición (malla Link-O-Loon, tablero de dos tamaños, rejilla con huecos). La
 *   matriz de #770 y #824 salió de la foto con el convertidor (`scripts/mural-desde-imagen.ts`, paleta limitada a los
 *   productos de la idea) y se limpió a mano (franjas, borde); la de #158 y #773 se dibujó a mano celda a celda sobre la
 *   foto (son líneas rectas). Cada celda es un globo en su sitio real: la medida del mural sale del paso de sus globos,
 *   no de la foto (las fotos de muestra no traen escala).
 * - **Techo** y **árboles**: la escala sale de algo de tamaño conocido (T-260 ≈ 5 cm de grueso, R-24 de remate ≈ 55 cm),
 *   y con ella largos, caídas e inflados; los niveles del tronco se cuentan por los bultos del borde.
 * - **Colores**: los códigos de los productos que publica la idea; si no publica, se midió en la foto (mediana de un
 *   parche sin brillos, ΔE76 en CIELAB contra `hexGlobo` de la tabla oficial) y se tomó el más cercano que se fabrica en el
 *   formato (Fashion si queda a ≤ 6 ΔE).
 * - **Productos**: lo que gasta el 3D (por formato y código) con la cantidad contada (`contada: true`); cada línea toma el
 *   producto publicado si es el mismo globo (mismo tipo y código: la talla va en `formato`) y si no, el liso de la tienda.
 * Unidades: cm.
 */

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

type Publicado = { nombre: string; url: string; formato: string | null; codigo: string | null };
const P = (nombre: string, url: string, formato: string | null, codigo: string | null): Publicado => ({ nombre, url, formato, codigo });

/** El liso de la tienda para un formato y un código (nombre y url relativa exactos). */
function lisoDeTienda(formatoId: string, codigo: string): { nombre: string; url: string } {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  if (fila) return { nombre: fila.nombre, url: fila.url };
  const x = productoDeGlobo(formatoId, codigo);
  return { nombre: x.nombre, url: quitarOrigen(x.url) };
}

/** Lo que gasta el 3D, con el producto publicado si es el mismo globo; lo publicado que no sale va sin cantidad. */
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

function fuente(slug: string): FuenteIdea {
  const f = fuenteIdea(slug);
  if (!f) throw new Error(`La idea «${slug}» no está en las fuentes.`);
  return f;
}

/**
 * La idea con su número, ocasiones y foto de su fuente, y sus productos calculados la primera vez que se piden (salen de
 * armar la pieza o la escena). Las ocasiones salen de las etiquetas con `ocasionesDeEtiquetas`, que vive en `index.ts`
 * (que importa este lote): se calculan al leerlas, como en el lote 06.
 */
function idea(slug: string, nombre: string, contenido: IdeaDigitalizada["contenido"], nota: string, publicados: readonly Publicado[] = []): IdeaDigitalizada {
  const f = fuente(slug);
  let hechos: ProductoDeIdea[] | null = null;
  return {
    id: `idea:${slug}`, numero: f.numero, slug, nombre, fotoUrl: f.fotoUrl, contenido, nota,
    get ocasiones() { return ocasionesDeEtiquetas(f.etiquetas); },
    get productos() { return (hechos ??= productosDe(contenido, publicados)); },
  };
}

const EN_LA_PARED: Colocacion = { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 };
const EN_EL_PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
const DEL_TECHO: Colocacion = { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 0, giroGrados: 0, volteada: false };

const mural = (m: OpcionesMural): Pieza => ({ tipo: "mural", mural: m });

// ----------------------------------------------------------------------------------------------------------
// 770 · Mural bandera Brasil (malla Link-O-Loon)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570 (un dibujo de muestra): malla de Link-O-Loon con su unión en cada nudo y huecos «corbatín»; 13 filas
 * de huecos y 13 columnas → 27 × 27 celdas (nudo, eslabón, nudo…). Matriz del convertidor (paleta: los 3 productos),
 * con la esquina de abajo a la izquierda completada (el borde está entero en la foto).
 */
const BRASIL: OpcionesMural = {
  disposicion: "malla", grande: { formatoId: "LOL-12", infladoCm: 15 }, chico: { formatoId: "R-5", infladoCm: 9 },
  matriz: {
    colores: ["032", "021", "041"],
    filas: [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "a.a.a.a.a.a.a.a.a.a.a.a.a.a",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "a.a.a.a.a.a.a.a.a.a.a.a.a.a",
      "aaaaaaaaaaaaabaaaaaaaaaaaaa",
      "a.a.a.a.a.a.b.b.a.a.a.a.a.a",
      "aaaaaaaaaaabbbbbbaaaaaaaaaa",
      "a.a.a.a.a.b.b.b.b.a.a.a.a.a",
      "aaaaaaaaabbbbcbbbbbaaaaaaaa",
      "a.a.a.a.b.b.c.c.b.b.a.a.a.a",
      "aaaaaaabbbbccccccbbbbaaaaaa",
      "a.a.a.b.b.c.c.c.c.b.b.a.a.a",
      "aaaaabbbbbcccccccbbbbbbaaaa",
      "a.a.b.b.b.c.c.c.c.b.b.b.a.a",
      "aaaaabbbbbcccccccbbbbbbaaaa",
      "a.a.a.b.b.c.c.c.c.b.b.a.a.a",
      "aaaaaaabbbbcccccbbbbbaaaaaa",
      "a.a.a.a.b.b.c.c.b.b.a.a.a.a",
      "aaaaaaaaabbbbcbbbbaaaaaaaaa",
      "a.a.a.a.a.b.b.b.b.a.a.a.a.a",
      "aaaaaaaaaaabbbbbaaaaaaaaaaa",
      "a.a.a.a.a.a.b.b.a.a.a.a.a.a",
      "aaaaaaaaaaaaabaaaaaaaaaaaaa",
      "a.a.a.a.a.a.a.a.a.a.a.a.a.a",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "a.a.a.a.a.a.a.a.a.a.a.a.a.a",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
  },
};
const idea770 = idea("mural-bandera-brasil", "Mural bandera de Brasil (malla Link-O-Loon)", { tipo: "pieza", pieza: mural(BRASIL), sugerida: EN_LA_PARED },
  "Igual: la malla Link-O-Loon de la foto, celda a celda (27 × 27: eslabones horizontales y verticales entre nudos, con su pareja de unión R-5 del mismo color en cada nudo y el hueco «corbatín» entre cuatro eslabones), fondo Verde Selva, rombo Amarillo Miel y círculo Azul Rey, con los 3 productos que publica la idea. Distinto: la foto es un dibujo sin escala; aquí la medida sale de los globos (LOL-12 inflado a 15 cm para que quepa en una sala de 3,2 m: ~3 × 3 m); el círculo azul de la foto es más hexagonal; las uniones R-5 no están entre los productos publicados (van con el liso de la tienda); falta la franja blanca «Ordem e Progresso» (la foto tampoco la trae).",
  [
    P("GLOBO LINK-O-LOON® FASHION AZUL REY", "/products/globo-para-fiesta-latex-link-o-loon-fashion-azul-rey", "LOL-12", "041"),
    P("GLOBO LINK-O-LOON® FASHION AMARILLO MIEL", "/products/globo-latex-link-o-loon-fashion-amarillo-miel", "LOL-12", "021"),
    P("GLOBO LINK-O-LOON® FASHION VERDE SELVA", "/products/globo-para-fiesta-latex-link-o-loon-fashion-verde-selva", "LOL-12", "032"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 158 · Australia Flag (tablero R-12 grande y chico, Union Jack con tubitos)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: tablero de R-12 grandes (~95 px) y chicos (~65 px) alternados, 17 columnas × 13 filas (paso
 * ~48,5 px). La Union Jack ocupa las 9 × 9 celdas de arriba a la izquierda: la cruz roja en la columna 4 y la fila 4, las
 * diagonales rojas son globitos amarrados encima (7 por brazo) y las rayas blancas, 12 T-260 (una L por cuadrante y dos
 * a cada lado de cada diagonal).
 */
const C_UJ = 4;
const BRAZOS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const AUSTRALIA: OpcionesMural = {
  disposicion: "tablero", grande: { formatoId: "R-12", infladoCm: 26 }, chico: { formatoId: "R-12", infladoCm: 18 },
  matriz: {
    colores: ["041", "015"],
    filas: [
      "aaaabaaaaaaaaaaaa",
      "aaaabaaaaaaaaaaaa",
      "aaaabaaaaaaaaaaaa",
      "aaaabaaaaaaaaaaaa",
      "bbbbbbbbbaaaaaaaa",
      "aaaabaaaaaaaaaaaa",
      "aaaabaaaaaaaaaaaa",
      "aaaabaaaaaaaaaaaa",
      "aaaabaaaaaaaaaaaa",
      "aaaaaaaaaaaaaaaaa",
      "aaaaaaaaaaaaaaaaa",
      "aaaaaaaaaaaaaaaaa",
      "aaaaaaaaaaaaaaaaa",
    ],
  },
  // Las diagonales rojas: 7 globitos por brazo, del centro hacia cada esquina de la Union Jack.
  encima: [{ formatoId: "R-12", infladoCm: 13, codigo: "015", puntos: BRAZOS.flatMap(([sx, sy]) => [1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25].map((t): [number, number] => [C_UJ + sx * t, C_UJ + sy * t])) }],
  aplicaciones: BRAZOS.flatMap(([sx, sy]) => {
    const p = (x: number, y: number): [number, number] => [Math.round((C_UJ + x) * 100) / 100, Math.round((C_UJ + y) * 100) / 100];
    const lado = 0.39; // 0,55 celdas a cada lado de la diagonal
    return [
      // La L blanca que bordea la cruz roja en ese cuadrante.
      { formatoId: "T-260", codigo: "005", puntos: [p(sx * 4.45, sy * 0.6), p(sx * 0.95, sy * 0.6), p(sx * 0.6, sy * 0.95), p(sx * 0.6, sy * 4.45)] },
      { formatoId: "T-260", codigo: "005", puntos: [p(sx * 1.0 + sx * lado, sy * 1.0 - sy * lado), p(sx * 4.3 + sx * lado, sy * 4.3 - sy * lado)] },
      { formatoId: "T-260", codigo: "005", puntos: [p(sx * 1.0 - sx * lado, sy * 1.0 + sy * lado), p(sx * 4.3 - sx * lado, sy * 4.3 + sy * lado)] },
    ];
  }),
};
const idea158 = idea("australia-flag", "Mural bandera de Australia", { tipo: "pieza", pieza: mural(AUSTRALIA), sugerida: EN_LA_PARED },
  "Igual: el tablero de la foto celda a celda (17 × 13, R-12 grande a 26 cm y chico a 18 cm alternados), Azul Rey, con la Union Jack arriba a la izquierda: la cruz roja (columna y fila 4, 9 celdas cada una), las diagonales de globitos rojos amarrados encima (7 por brazo) y 12 T-260 blancos bordeando la cruz y las diagonales, con los 3 productos que publica la idea (~3,4 × 2,6 m). Distinto: las 6 estrellas blancas de la foto son de papel (no son globos) y no van; las diagonales rojas de la foto van un poco corridas de la diagonal (como en la bandera) y aquí van centradas; los globitos rojos son R-12 a 13 cm (la idea no publica R-5).",
  [
    P("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041"),
    P("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015"),
    P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 824 · Pared Corazón (rejilla de dos tamaños en franjas, corazón blanco hueco)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: la malla de redondos con su unión (chico en los cruces, grande entre ellos, hueco al medio),
 * 37 columnas × 27 filas (paso ~26 px). Seis franjas (naranja, amarillo, verde lima, azul caribe, frambuesa, rosado) y un
 * corazón blanco de 2 a 4 celdas de grueso con el centro vacío (sin globos). Matriz del convertidor (paleta: los 6
 * productos y el blanco), con las franjas limpiadas por filas (la sombra confundía rosado y frambuesa).
 */
const CORAZON: OpcionesMural = {
  disposicion: "rejilla", grande: { formatoId: "R-9", infladoCm: 16 }, chico: { formatoId: "R-5", infladoCm: 8 },
  matriz: {
    colores: ["061", "009", "005", "020", "031", "038", "014"],
    filas: [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a",
      "aaaaaaacccccccccaaaaaacccccccccaaaaaa",
      "a.a.a.c.c.c.c.c.c.a.a.c.c.c.c.c.a.a.a",
      "aaaaaccccccccccccaaaccccccccccccaaaaa",
      "a.a.c.c.c.c.c.c.c.a.c.c.c.c.c.c.c.a.a",
      "ddddcccccc.....cccccccc.....cccccdddd",
      "d.d.c.c.c.......c.d.c.c.....c.c.c.d.d",
      "ddddcccc.......cccccccc.......ccccddd",
      "d.d.c.c.........c.c.c.c.......c.c.d.d",
      "eeeecccc.........cccc.........cccceee",
      "e.e.c.c.c.........c.........c.c.c.e.e",
      "eeeeeccccc..................cccceeeee",
      "e.e.e.c.c.c...............c.c.c.e.e.e",
      "fffffffccccc..............ccccfffffff",
      "f.f.f.f.f.c.c...........c.c.c.f.f.f.f",
      "ffffffffffcccc.........cccccfffffffff",
      "f.f.f.f.f.f.c.c.......c.c.c.f.f.f.f.f",
      "ggggggggggggcccc.....cccccggggggggggg",
      "g.g.g.g.g.g.g.c.c...c.c.g.g.g.g.g.g.g",
      "ggggggggggggggcccc.cccccggggggggggggg",
      "g.g.g.g.g.g.g.c.c.c.c.c.g.g.g.g.g.g.g",
      "gggggggggggggggcccccccggggggggggggggg",
      "b.b.b.b.b.b.b.b.b.c.b.b.b.b.b.b.b.b.b",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b.b",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ],
  },
};
const idea824 = idea("pared-corazon", "Pared corazón arcoíris", { tipo: "pieza", pieza: mural(CORAZON), sugerida: EN_LA_PARED },
  "Igual: la malla de la foto celda a celda (37 × 27: R-5 en los cruces, R-9 entre ellos y el hueco al medio), en seis franjas de arriba abajo con los 6 productos que publica la idea (Naranja, Amarillo, Verde Lima, Azul Caribe, Frambuesa, Rosado) y el corazón Blanco de 2 a 4 celdas de grueso con el centro vacío (se ve la pared). Distinto: en la foto los globos van más apretados (unos delante de otros); aquí no se pisan y el mural sale más grande (~4 × 3 m); el blanco no está entre los productos publicados (va con el liso de la tienda); los grandes son R-9 y los chicos R-5 (la idea publica los colores, sin talla); el corazón de la foto es un poco más ancho abajo.",
  [
    P("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061"),
    P("GLOBO REDONDO FASHION AMARILLO", "/products/globo-para-fiesta-latex-redondo-fashion-amarillo", "R-12", "020"),
    P("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031"),
    P("GLOBO REDONDO FASHION AZUL CARIBE", "/products/globo-para-fiesta-latex-redondo-fashion-azul-caribe", "R-12", "038"),
    P("GLOBO REDONDO FASHION FRAMBUESA", "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", "R-12", "014"),
    P("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 773 · Mural cancha de fútbol (tablero de dos tamaños)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570 (un dibujo de muestra): tablero de grandes y chicos, 27 × 21 celdas (paso ~25 px): borde blanco, línea
 * del medio, las dos áreas (5 × 9 celdas) y el círculo central como un bloque blanco de 3 × 3. Dibujada a mano celda a
 * celda.
 */
const CANCHA: OpcionesMural = {
  disposicion: "tablero", grande: { formatoId: "R-9", infladoCm: 18 }, chico: { formatoId: "R-5", infladoCm: 10 },
  matriz: {
    colores: ["005", "030"],
    filas: [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "aaaaabbbbbbbbabbbbbbbbaaaaa",
      "abbbabbbbbbbbabbbbbbbbabbba",
      "abbbabbbbbbbbabbbbbbbbabbba",
      "abbbabbbbbbbaaabbbbbbbabbba",
      "abbbabbbbbbbaaabbbbbbbabbba",
      "abbbabbbbbbbaaabbbbbbbabbba",
      "abbbabbbbbbbbabbbbbbbbabbba",
      "abbbabbbbbbbbabbbbbbbbabbba",
      "aaaaabbbbbbbbabbbbbbbbaaaaa",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "abbbbbbbbbbbbabbbbbbbbbbbba",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
  },
};
const idea773 = idea("mural-cancha-de-futbol", "Mural cancha de fútbol", { tipo: "pieza", pieza: mural(CANCHA), sugerida: EN_LA_PARED },
  "Igual: el tablero de la foto celda a celda (27 × 21, R-9 y R-5 alternados), Verde con las líneas Blancas de la cancha: el borde, la línea del medio, las dos áreas y el círculo central, con los 2 productos que publica la idea (~3,5 × 2,8 m). Distinto: la foto es un dibujo sin escala (la medida sale de los globos); el círculo central es un bloque de 3 × 3 celdas, como en la foto, no un aro; los grandes son R-9 y los chicos R-5 (la idea publica los colores, sin talla).",
  [
    P("GLOBO REDONDO FASHION VERDE", "/products/globo-para-fiesta-latex-redondo-fashion-verde", "R-12", "030"),
    P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 536 · Eventos corporativos (festones de techo en catenaria y globos colgantes)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570 de una sala de ventas: cinco festones de guirnalda espiral (dos colores) entre seis R-24 negros de
 * remate pegados al techo (con logo impreso), y una fila de R-12 negros (con logo) colgando de hilos junto a las ventanas
 * (se cuentan 9 y la ficha dice 10). Escala: el R-24 ≈ 55 cm; los globos de la guirnalda ≈ 1/3 de él (R-9 a 18 cm), unos 20
 * cuartetos por festón: ~2,4 m de luz y ~90 cm de caída. Colores medidos: Fashion Mostaza (ΔE 7,5) y Fashion Negro.
 */
const SALA_VENTAS: Sala = { ...structuredClone(SALA_INICIAL), anchoCm: 1400, fondoCm: 800, altoCm: 450 };
const FESTONES_536: ElementoTecho = {
  tipo: "festones", puntos: [-600, -360, -120, 120, 360, 600].map((x) => ({ xCm: x, zCm: 0 })), caidaCm: 90,
  guirnalda: { formatoId: "R-9", infladoCm: 18, patron: "dos_colores", colores: ["023", "080"] },
  remate: { formatoId: "R-24", infladoCm: 55, codigo: "080" },
};
const COLGANTES_536: ElementoTecho[] = Array.from({ length: 10 }, (_, k): ElementoTecho => ({
  tipo: "tira", punto: { xCm: -540 + k * 120, zCm: 0 }, hiloCm: 210, globos: [{ formatoId: "R-12", infladoCm: 28, codigo: "080", cantidad: 1 }],
}));
const escena536: Escena = {
  sala: SALA_VENTAS,
  nodos: [
    { id: "festones", nombre: "Festones de techo (guirnalda Mostaza y Negro con R-24 de remate)", pieza: { tipo: "techo", techo: { elementos: [FESTONES_536] } }, colocacion: { en: "techo", xCm: 0, zCm: -120, cuelgaCm: 0, giroGrados: 0, volteada: false } },
    { id: "colgantes", nombre: "R-12 negros colgantes (10)", pieza: { tipo: "techo", techo: { elementos: COLGANTES_536 } }, colocacion: { en: "techo", xCm: 0, zCm: 260, cuelgaCm: 0, giroGrados: 0, volteada: false } },
  ],
};
const idea536 = idea("eventos-corporativos", "Festones de techo para evento corporativo", { tipo: "escena", escena: escena536 },
  "Igual: cinco festones de guirnalda clásica de cuartetos R-9 en espiral de dos colores (Mostaza y Negro) colgando en catenaria de punto a punto del techo, ~2,4 m de luz y ~90 cm de caída, con un R-24 negro de remate en cada uno de los seis puntos, y una fila de 10 R-12 negros colgando de hilos a ~2 m del techo, en una sala de ventas de 14 × 8 m y 4,5 m de alto. Distinto: los globos de la foto llevan el logo impreso (aquí lisos: no hay ese impreso en la tienda); en la foto los festones van en una línea que se aleja en diagonal y aquí en una recta; la punta suelta de la primera guirnalda, que cae hasta abajo, no va; la idea no publica productos y el amarillo se midió en la foto (Mostaza; podría ser Amarillo Miel con poca luz).");

// ----------------------------------------------------------------------------------------------------------
// 697 · Lluvia de globos (tira colgante con flecos)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: de arriba abajo, un cuarteto de R-5 verdes, un R-9 naranja, una pareja verde, otro R-9 naranja y otra
 * pareja verde; de ahí bajan 4 T-260 naranjas que se abren y terminan cada uno en un racimito de ~5 R-5 (morado, azul,
 * amarillo, naranja). Escala: el R-9 ≈ 20 cm (75 px): todo mide ~1,5 m y los flecos ~90 cm. Colores medidos: Naranja,
 * Verde Lima, Violeta, Azul, Amarillo (Fashion).
 */
const LLUVIA: Pieza = {
  tipo: "techo",
  techo: {
    elementos: [{
      tipo: "tira", punto: { xCm: 0, zCm: 0 }, hiloCm: 25,
      globos: [
        { formatoId: "R-5", infladoCm: 11, codigo: "031", cantidad: 4 },
        { formatoId: "R-9", infladoCm: 20, codigo: "061", cantidad: 1 },
        { formatoId: "R-5", infladoCm: 11, codigo: "031", cantidad: 2 },
        { formatoId: "R-9", infladoCm: 20, codigo: "061", cantidad: 1 },
        { formatoId: "R-5", infladoCm: 11, codigo: "031", cantidad: 2 },
      ],
      flecos: { formatoId: "T-260", codigo: "061", cantidad: 4, largoCm: 90, aperturaCm: 24, racimo: { formatoId: "R-5", infladoCm: 11, codigos: ["051", "040", "020", "061"], globos: 5 } },
    }],
  },
};
const idea697 = idea("lluvia-de-globos", "Lluvia de globos (colgante de techo)", { tipo: "pieza", pieza: LLUVIA, sugerida: DEL_TECHO },
  "Igual: la tira colgante de la foto de arriba abajo —cuarteto de R-5 Verde Lima, R-9 Naranja, pareja Verde Lima, R-9 Naranja y pareja Verde Lima— y los 4 flecos de T-260 Naranja que bajan abriéndose ~90 cm y terminan cada uno en un racimito de 5 R-5 (Violeta, Azul, Amarillo y Naranja), colgada de un hilo del techo. Distinto: en la foto los flecos se cruzan y se enroscan, aquí bajan en curvas suaves sin cruzarse; los R-9 naranjas de la foto se ven un poco más alargados; la idea no publica productos (colores medidos en la foto).");

// ----------------------------------------------------------------------------------------------------------
// 816 · Palmera (tronco café con base, hojas T-260 Verde Selva)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 1000 × 1000: el T-260 de las hojas mide ~25 px de grueso (≈ 5 cm: 5 px/cm). Tronco de ~10 niveles de cuartetos
 * de ~48 px (R-5 a 10 cm), un poco torcido, sobre una base de 4 globos de ~70 px (14 cm: R-9); 12 hojas de ~60 cm que se
 * arquean hacia abajo. Alto total ~1,4 m.
 */
const PALMERA_816: Pieza = {
  tipo: "arbol_globos",
  arbol: {
    tronco: { formatoId: "R-5", infladoBaseCm: 10.5, infladoPuntaCm: 9.5, altoCm: 84, colores: ["074"], curvaCm: 6, base: { formatoId: "R-9", infladoCm: 14, codigo: "074", cantidad: 4 } },
    copa: { tipo: "palmera", hojas: { formatoId: "T-260", codigos: ["032"], cantidad: 12, largoCm: 62 } },
  },
};
const idea816 = idea("palmera-1", "Palmera café con hojas verde selva", { tipo: "pieza", pieza: PALMERA_816, sugerida: EN_EL_PISO },
  "Igual: con los 2 productos que publica la idea, tronco de cuartetos Café (~10 niveles, R-5 a ~10 cm) apenas torcido sobre una base de 4 globos Café más grandes (R-9 a 14 cm) y una copa de 12 hojas de T-260 Verde Selva de ~60 cm que suben y se arquean hacia abajo, alrededor; ~1,25 m de alto. Distinto: la foto mide ~1,4 m (las hojas suben más); en la foto unas hojas se quiebran en ángulo (aquí se arquean parejo); el tronco de la foto se afina menos; la idea publica el redondo Café sin talla (aquí R-5 y R-9).",
  [
    P("GLOBO TUBITO FASHION VERDE SELVA", "/products/globo-para-fiesta-latex-tubito-fashion-verde-selva", "T-260", "032"),
    P("GLOBO REDONDO FASHION CAFÉ", "/products/globo-para-fiesta-latex-redondo-fashion-cafe", "R-12", "074"),
  ]);

// ----------------------------------------------------------------------------------------------------------
// 817 · Palmera (tronco amarillo, hojas verdes)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: tronco de ~14 niveles de cuartetos amarillos de ~30 px, inclinado apenas a la derecha arriba; 7 hojas
 * verdes cortas (~140 px) y gruesas. Escala por las hojas (T-260): el tronco ~90 cm y las hojas ~40 cm. Colores medidos:
 * Fashion Amarillo Miel (ΔE 4) y Fashion Verde Trébol (ΔE 13).
 */
const PALMERA_817: Pieza = {
  tipo: "arbol_globos",
  arbol: {
    tronco: { formatoId: "R-5", infladoBaseCm: 8, infladoPuntaCm: 8, altoCm: 84, colores: ["021"], curvaCm: 5 },
    copa: { tipo: "palmera", hojas: { formatoId: "T-260", codigos: ["029"], cantidad: 7, largoCm: 40 } },
  },
};
const idea817 = idea("palmera", "Palmera amarilla de cuartetos", { tipo: "pieza", pieza: PALMERA_817, sugerida: EN_EL_PISO },
  "Igual: tronco recto y delgado de ~14 niveles de cuartetos Amarillo Miel (R-5 a 8 cm), apenas inclinado arriba, y 7 hojas cortas de T-260 Verde Trébol (~40 cm) que se abren y caen alrededor de la punta; ~1 m de alto. Distinto: las hojas de la foto se ven más gruesas (podrían ser T-360, que no viene en Verde Trébol) y más quebradas; la idea no publica productos (colores medidos en la foto).");

// ----------------------------------------------------------------------------------------------------------
// 48 · Árbol esfera LOL (tronco que se afina con acentos, copa de racimos verdes)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: tronco de cuartetos oscuros que se afina (~60 px abajo, ~40 px arriba) con globitos café en los
 * huecos, y una copa redonda de globos verdes de dos tonos (~75 px) con globitos verdes entre ellos. Escala: el tronco de
 * abajo ≈ R-12 a 22 cm (2,7 px/cm): tronco ~1 m y copa ~1,1 m. Colores medidos: el tronco casi negro (Metal Negro
 * ΔE 10, Chocolate ΔE 23: se toma Chocolate, la sombra lo oscurece y la ficha lo dice «chocolate»), copa Verde Trébol y
 * Verde (ΔE 14 y 7).
 */
const ARBOL_48: Pieza = {
  tipo: "arbol_globos",
  arbol: {
    tronco: { formatoId: "R-12", infladoBaseCm: 22, infladoPuntaCm: 15, altoCm: 100, colores: ["076"], curvaCm: 0, acento: { formatoId: "R-5", infladoCm: 9, codigo: "074", cada: 2 } },
    copa: { tipo: "racimos", diametroCm: 112, achatado: 0.85, globo: { formatoId: "R-12", infladoCm: 25 }, colores: ["029", "030"], pesos: [2, 1], semilla: 48, frutas: { formatoId: "R-5", infladoCm: 9, codigo: "029", cantidad: 4 } },
  },
};
const idea48 = idea("arbol-esfera-lol", "Árbol esfera verde", { tipo: "pieza", pieza: ARBOL_48, sugerida: EN_EL_PISO },
  "Igual: tronco de cuartetos Chocolate que se afina de abajo arriba (R-12 de 22 a 15 cm, ~1 m) con globitos Café en los huecos y una copa redonda (~1,1 m) de racimos de R-12 Verde Trébol y Verde con globitos verdes entre ellos. Distinto: la copa de la foto es una esfera de Link-O-Loon (eslabones); aquí son racimos de redondos; el tronco de la foto se ve casi negro (aquí Chocolate); la idea no publica productos (colores medidos en la foto).");

// ----------------------------------------------------------------------------------------------------------
// 53 · Árbol manzanas (tronco en degradé, copa de racimos con manzanitas)
// ----------------------------------------------------------------------------------------------------------

/**
 * Foto de 740 × 570: tronco de cuartetos de ~45 px (R-9 a 18 cm: 2,5 px/cm) que va de rojo oscuro abajo a vino arriba,
 * ~1,1 m, metido en una copa achatada (~1,3 m de ancho) de racimos verdes con 7 manzanitas rojas al frente. Colores
 * medidos: Rojo Imperial (ΔE 5) abajo, Merlot (ΔE 13) arriba, copa Verde Trébol (ΔE 4), manzanas Rojo (ΔE 12).
 */
const ARBOL_53: Pieza = {
  tipo: "arbol_globos",
  arbol: {
    tronco: { formatoId: "R-9", infladoBaseCm: 18, infladoPuntaCm: 16, altoCm: 110, colores: ["016", "016", "018"], curvaCm: 0 },
    copa: { tipo: "racimos", diametroCm: 128, achatado: 0.7, globo: { formatoId: "R-9", infladoCm: 18 }, colores: ["029"], semilla: 53, frutas: { formatoId: "R-5", infladoCm: 11, codigo: "015", cantidad: 7 } },
  },
};
const idea53 = idea("arbol-manzanas", "Árbol de manzanas", { tipo: "pieza", pieza: ARBOL_53, sugerida: EN_EL_PISO },
  "Igual: tronco de cuartetos R-9 (~1,1 m) en degradé de Rojo Imperial abajo a Merlot arriba, metido en una copa achatada (~1,3 m) de racimos de R-9 Verde Trébol con 7 manzanitas R-5 Rojo al frente; ~2 m de alto. Distinto: las manzanas de la foto llevan una hojita verde (aquí no); en la foto el tronco se ve también dentro de la copa, más oscuro; la ficha dice 12 manzanas y la foto deja ver 7; la idea no publica productos (colores medidos en la foto).");

/** Ideas de fiesta de sempertex.com digitalizadas: lote 09. */
export const LOTE_09: readonly IdeaDigitalizada[] = [idea770, idea158, idea824, idea773, idea536, idea697, idea816, idea817, idea48, idea53];
