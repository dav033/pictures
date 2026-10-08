import type { ParteGlobo } from "./decoraciones";
import type { ParteTubito } from "./halloween";
import type { Pieza } from "./piezas";
import { PLANTILLAS_FIGURA, type Cara, type DecoracionFigura, type PropiedadesFigura } from "./figuras-tubito";

/**
 * **Ideas de fiesta de sempertex.com digitalizadas con el generador de figuras** (`figuras-tubito.ts`): figuras de
 * complejidad ≤ 3, armadas mirando su foto. Cada una lleva la idea de donde sale (número, slug y enlace), los
 * productos que la idea lista en la tienda (tal cual; muchas no listan ninguno) y una nota honesta de qué se parece
 * y qué no. Los colores son códigos Sempertex que existen en cada formato: si la idea lista productos, se usan esos;
 * si no, se eligió el color de la tabla oficial más cercano a la foto (y así lo dice la nota).
 * Los «R-6» y «G6» de los textos de la tienda se arman con R-5, el redondo pequeño que modela el taller.
 */

/** Un producto tal como lo lista la idea en la tienda (formato y código exactos; null si no es un globo liso). */
export type ProductoIdea = { nombre: string; formato: string | null; codigo: string | null; color: string | null };

export type IdeaFigura = {
  id: string;
  /** Número de la idea en el listado de 987 «Ideas de fiesta». */
  numero: number;
  nombre: string;
  slug: string;
  url: string;
  productos: ProductoIdea[];
  pieza: Pieza;
  nota: string;
};

const G = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const T = (formatoId: string, grosorCm: number, codigo: string): ParteTubito => ({ formatoId, grosorCm, codigo });
const TINTA = "#1a1a1a";
const SIN_CARA: Cara = { ojos: null, boca: null, mejillas: null, bigote: null, nariz: null, cejas: null };
const url = (slug: string) => `https://sempertex.com/blogs/idea-de-fiesta/${slug}`;
const pieza = (propiedades: PropiedadesFigura): Pieza => ({ tipo: "decoracion", decoracion: { tipo: "figura", propiedades }, deFrente: true });

export const IDEAS_FIGURAS: readonly IdeaFigura[] = [
  {
    id: "figura_amigos_felices", numero: 8, nombre: "Amigo feliz (él)", slug: "amigos-felices", url: url("amigos-felices"), productos: [],
    nota: "Se parece: el muñeco del bigote — cabeza R-12 Amarillo con ojos y mostacho impresos, cuerpo largo de tubito Rojo, brazos de T-260 Rojo trenzado en jarra con manos de R-5 y pies de racimo de R-5 Amarillo. No: es solo él (ella, con el beso y el moño, no); en la foto el brazo de él abraza a ella y aquí los dos van en jarra; el cuerpo se tomó como un T-360. La idea no lista productos: colores elegidos de la foto (020 Amarillo, 015 Rojo).",
    pieza: pieza({
      postura: "de_pie", queEs: "a standing twisted-balloon man with a yellow round head with printed eyes and moustache, a long red tube body and twisted red arms on hips, on a yellow balloon base",
      base: [{ formatoId: "R-5", infladoCm: 11, codigos: ["020"], cantidad: 5 }, { formatoId: "R-5", infladoCm: 10, codigos: ["020"], cantidad: 4 }],
      piernas: null,
      cuerpo: [{ tipo: "tubito", tubito: T("T-360", 7, "015"), largoCm: 76 }],
      cuello: { ...G("R-5", 9, "020"), cantidad: 1 },
      cabeza: { ...G("R-12", 25, "020"), cara: { ...SIN_CARA, ojos: { estilo: "puntos", hex: TINTA }, bigote: { estilo: "mostacho", hex: TINTA } } },
      brazos: { ...T("T-260", 4, "015"), burbujasCm: [19, 25], angulosGrados: [-31, -127], adelanteGrados: [6, 12], trenzado: true, punta: { tipo: "globo", globo: G("R-5", 8, "020") } },
      accesorios: [],
    }),
  },
  {
    id: "figura_amiguitos", numero: 9, nombre: "Amiguito con sombrero", slug: "amiguitos", url: url("amiguitos"), productos: [],
    nota: "Se parece: el muñeco del sombrero — tres R-12 de base, cuerpo y cabeza R-12 verde limón con carita impresa, cuello de 4 R-5 azules, un brazo arriba (le da la mano a ella) y el otro abajo, manos de dedos de burbuja y bombín de tubito ladeado. No: falta ella (cuerpo fucsia y flor); el verde limón de la foto se tomó como Neón Amarillo (220) y el azul como Azul Hortensia (042): la idea no lista productos.",
    pieza: pieza({
      postura: "de_pie", queEs: "a balloon buddy made of stacked lime balloons with a printed smiley face, blue twisted-balloon arms waving and a little blue hat, on three blue balloons",
      base: [{ formatoId: "R-12", infladoCm: 27, codigos: ["042"], cantidad: 3 }],
      piernas: null,
      cuerpo: [{ tipo: "globo", globo: G("R-12", 28, "220") }],
      cuello: { ...G("R-5", 10, "042"), cantidad: 4 },
      cabeza: { ...G("R-12", 26, "220"), cara: { ...SIN_CARA, ojos: { estilo: "puntos", hex: TINTA }, boca: { estilo: "sonrisa", hex: TINTA } } },
      brazos: { ...T("T-260", 4.5, "042"), burbujasCm: [9, 11, 10], angulosGrados: [-5, 48, 72], adelanteGrados: [8], punta: { tipo: "dedos", cantidad: 3, largoCm: 4, aberturaGrados: 35 }, otroLado: { angulosGrados: [-40, -95, -70], adelanteGrados: [8] } },
      accesorios: [{ en: "coronilla", corrimientoCm: [-5, 0, -3], forma: { tipo: "sombrero", ala: { ...T("T-260", 4, "042"), estilo: "aro", radioCm: 9 }, copa: { globo: G("R-9", 14, "042") }, cinta: null, pompon: null, inclinacionGrados: -16 } }],
    }),
  },
  {
    id: "figura_angry_bird", numero: 21, nombre: "Pájaro rojo bravo", slug: "angry-bird", url: url("angry-bird"), productos: [],
    nota: "Se parece: «columnita de cuartetos R-12 de diferentes tamaños» (texto de la idea) — cuarteto blanco de vientre, cuarteto rojo encima y pareja roja arriba, ojos R-5 blancos con pupila, cejas bravas y cola de T-260 Negro, pico de lazos amarillos y cresta de dos burbujas rojas. No: los «R-6 rojo» pegados del texto no van; la cresta va en T-360 y los cuartetos quedan más regulares que en la foto. La idea no lista productos: 015 Rojo, 005 Blanco, 020 Amarillo, 080 Negro.",
    pieza: pieza({
      postura: "de_pie", queEs: "a red angry bird made of a small column of red balloon quads with a white belly, googly eyes, black twisted-balloon brows and tail and a yellow beak",
      base: [{ formatoId: "R-12", infladoCm: 25, codigos: ["005"], cantidad: 4 }, { formatoId: "R-12", infladoCm: 27, codigos: ["015"], cantidad: 4 }, { formatoId: "R-12", infladoCm: 26, codigos: ["015"], cantidad: 2 }],
      piernas: null, cuerpo: [], cuello: null, cabeza: null, brazos: null,
      accesorios: [
        { en: "coronilla", corrimientoCm: [0, -3, -4], forma: { tipo: "cresta", abanico: { ...T("T-360", 6, "015"), estilo: "burbujas", cantidad: 2, largoCm: 13, aberturaGrados: 42 }, anguloGrados: 90 } },
        { en: "cara", par: true, corrimientoCm: [5, 0, 3], forma: { tipo: "globo", globo: G("R-5", 8, "005"), anguloGrados: 25, adelanteGrados: 75, estampado: "ojo" } },
        { en: "cara", par: true, corrimientoCm: [2, 3, 9], forma: { tipo: "burbujas", tubito: T("T-260", 3.5, "080"), largosCm: [11], angulosGrados: [16] } },
        { en: "cara", corrimientoCm: [0, 2, -4], forma: { tipo: "pico", abanico: { ...T("T-260", 4, "020"), estilo: "lazos", cantidad: 2, largoCm: 9, anchoCm: 5, aberturaGrados: 46 }, anguloGrados: -10 } },
        { en: "espalda", corrimientoCm: [-14, 0, 6], forma: { tipo: "cola", estilo: "plumas", tubito: T("T-260", 4, "080"), largoCm: 20, anguloGrados: 165, cantidad: 2 } },
      ],
    }),
  },
  {
    id: "figura_ranita", numero: 83, nombre: "Ranita", slug: "arco-de-ranitas", url: url("arco-de-ranitas"), productos: [],
    nota: "Se parece: la rana del remate de las columnas — sentada, cuerpo R-12 y cabeza R-9 verdes, ojos saltones de R-5 blanco con pupila, sonrisa impresa, brazos y patas de T-260 verde con deditos de burbuja. No: es solo la rana (el arco, las columnas y los lazos Azul Caribe donde se sienta no van); la cabeza de la foto es más ancha y plana. La idea no lista productos: verde 029 Verde Trébol, el más cercano a la foto.",
    pieza: pieza({
      postura: "sentado", queEs: "a sitting green balloon frog with white googly eyes, a printed smile and twisted-balloon legs",
      base: [], piernas: { ...T("T-260", 4.5, "029"), burbujasCm: [11, 9], angulosGrados: [-5, -100], adelanteGrados: [35, 30], punta: { tipo: "dedos", cantidad: 3, largoCm: 4, aberturaGrados: 35 } },
      cuerpo: [{ tipo: "globo", globo: G("R-12", 24, "029") }],
      cuello: null,
      cabeza: { ...G("R-9", 19, "029"), cara: { ...SIN_CARA, boca: { estilo: "sonrisa", hex: TINTA } } },
      brazos: { ...T("T-260", 4, "029"), burbujasCm: [8, 8], angulosGrados: [-60, -96], adelanteGrados: [35, 25], punta: { tipo: "dedos", cantidad: 3, largoCm: 3.5, aberturaGrados: 32 } },
      accesorios: [{ en: "coronilla", par: true, corrimientoCm: [4.5, 1, -1.5], forma: { tipo: "globo", globo: G("R-5", 8, "005"), anguloGrados: 62, adelanteGrados: 40, estampado: "ojo" } }],
    }),
  },
  {
    id: "figura_cerdito", numero: 315, nombre: "Cerdito", slug: "cerdo", url: url("cerdo"), productos: [],
    nota: "Se parece: lo que dice la idea — «un globo de R12, para las orejas R6, tubitos 260 para la cola y para las patas un cuarteto R6 negro, y para los ojos R6 negro»: cuerpo R-12 rosado, orejas y hocico de R-5 rosado (con fosas impresas), ojos R-5 negros, ceja y cola en rizo de T-260 rosado. No: en la foto mira de tres cuartos hacia la derecha y aquí de frente; los R-6 van como R-5. La idea no lista productos: 009 Rosado y 080 Negro.",
    pieza: pieza({
      postura: "de_pie", queEs: "a pink balloon piggy with round ears, a snout, black eyes and a curly tail, standing on four black balloons",
      base: [{ formatoId: "R-5", infladoCm: 11, codigos: ["080"], cantidad: 4 }],
      piernas: null, cuerpo: [{ tipo: "globo", globo: G("R-12", 29, "009") }], cuello: null, cabeza: null, brazos: null,
      accesorios: [
        { en: "oreja", par: true, forma: { tipo: "orejas", estilo: "globo", globo: G("R-5", 12, "009"), largoCm: 12, anguloGrados: 55 } },
        { en: "pecho", par: true, corrimientoCm: [4.5, 0, 4], forma: { tipo: "globo", globo: G("R-5", 7, "080"), anguloGrados: 30, adelanteGrados: 75 } },
        { en: "pecho", par: true, corrimientoCm: [2.5, 1, 9], forma: { tipo: "burbujas", tubito: T("T-260", 2.8, "009"), largosCm: [6], angulosGrados: [12] } },
        { en: "pecho", corrimientoCm: [0, 0, -4], forma: { tipo: "globo", globo: G("R-5", 11, "009"), anguloGrados: 90, adelanteGrados: 82, estampado: "nariz_cerdo" } },
        { en: "cola", forma: { tipo: "cola", estilo: "rizo", tubito: T("T-260", 3.5, "009"), largoCm: 11, anguloGrados: 160 } },
      ],
    }),
  },
  {
    id: "figura_espantapajaros", numero: 528, nombre: "Espantapájaros", slug: "espantapajaros", url: url("espantapajaros"), productos: [],
    nota: "Se parece: base de dos R-12 (naranja y negro) con anillo de R-5 naranja, piernas largas de T-260 azul con zapatos R-5 negros, cuerpo R-12 naranja cobrizo con gajos impresos, moñito de R-5 verde, cabeza de calabaza impresa, brazos de T-260 con manos R-5 y pajita de T-160, sombrero de paja de flecos amarillos con copa de T-360. No: los R-12 de la base son impresos de lunares en la foto (aquí lisos); faltan el cuello rojo y las dos tiras de cada pierna. La idea no lista productos: colores de la foto (061, 062, 080, 042, 031, 020, 071).",
    pieza: pieza({
      postura: "de_pie", queEs: "a balloon scarecrow with a jack-o'-lantern face, a yellow straw hat of twisted balloons, long blue legs and an orange body, on an orange and black balloon base",
      base: [{ formatoId: "R-12", infladoCm: 26, codigos: ["061", "080"], cantidad: 2 }, { formatoId: "R-5", infladoCm: 11, codigos: ["061"], cantidad: 4 }],
      piernas: { ...T("T-260", 4.5, "042"), burbujasCm: [17, 16], angulosGrados: [-90], punta: { tipo: "globo", globo: G("R-5", 8, "080") } },
      cuerpo: [{ tipo: "globo", globo: G("R-12", 26, "062"), dibujo: { estilo: "gajos", hex: TINTA, cantidad: 4 } }],
      cuello: { ...G("R-5", 8, "031"), cantidad: 2 },
      cabeza: { ...G("R-12", 24, "061"), cara: { ...SIN_CARA, calabaza: { hex: TINTA } } },
      brazos: { ...T("T-260", 4, "062"), burbujasCm: [14, 13], angulosGrados: [-25, -38], punta: { tipo: "globo", globo: G("R-5", 7, "071") } },
      accesorios: [
        { en: "mano", par: true, forma: { tipo: "cresta", abanico: { ...T("T-160", 2.1, "020"), estilo: "flecos", cantidad: 4, largoCm: 7, aberturaGrados: 32 }, anguloGrados: -35 } },
        { en: "coronilla", corrimientoCm: [0, 0, -4], forma: { tipo: "sombrero", ala: { ...T("T-260", 4, "020"), estilo: "flecos", radioCm: 20, cantidad: 12 }, copa: { tubito: T("T-360", 7, "020"), largoCm: 15 }, cinta: T("T-160", 2.2, "080"), pompon: null, inclinacionGrados: 0 } },
      ],
    }),
  },
  {
    id: "figura_forky", numero: 611, nombre: "Tenedor con cara", slug: "forky", url: url("forky"),
    productos: [
      { nombre: "GLOBO TUBITO FASHION BLANCO", formato: "T-260", codigo: "005", color: "Fashion Blanco" },
      { nombre: "GLOBO TUBITO FASHION ROJO", formato: "T-260", codigo: "015", color: "Fashion Rojo" },
      { nombre: "GLOBO REDONDO FASHION DURAZNO", formato: "R-12", codigo: "060", color: "Fashion Durazno" },
    ],
    nota: "Se parece: cuerpo largo de tubito blanco, cabeza blanca con ojos, ceja roja, boca azul y mejillas impresas, cuatro dientes de T-260 blanco, brazos finos rojos con dedos y cinturón rojo, base de racimo y pies R-12 Durazno. Colores de la paleta de la idea (005, 015, 060). No: la paleta lista «tubito blanco» y aquí el cuerpo va en T-360 (005) y la cabeza en R-12 (005) para el grueso de la foto; los brazos rojos van en T-160; la base es Latte (073), que no está en la paleta; faltan los botones.",
    pieza: pieza({
      postura: "de_pie", queEs: "a spork character balloon figure: long white body, white head with googly eyes and a blue smile, four white prongs, thin red arms, on a beige balloon base with peach feet",
      base: [{ formatoId: "R-9", infladoCm: 16, codigos: ["073"], cantidad: 5 }, { formatoId: "R-9", infladoCm: 15, codigos: ["073"], cantidad: 4 }, { formatoId: "R-9", infladoCm: 14, codigos: ["073"], cantidad: 1 }],
      piernas: null,
      cuerpo: [{ tipo: "tubito", tubito: T("T-360", 7, "005"), largoCm: 52 }],
      cuello: { ...G("R-5", 7, "005"), cantidad: 2 },
      cabeza: { ...G("R-12", 22, "005"), cara: { ...SIN_CARA, ojos: { estilo: "ovalos", hex: TINTA }, boca: { estilo: "abierta", hex: "#3bb6cc" }, mejillas: { hex: "#f4b6c2" }, cejas: { hex: "#d8262e", bravas: false } } },
      brazos: { ...T("T-160", 2.2, "015"), burbujasCm: [15, 12], angulosGrados: [-4, 32], adelanteGrados: [10], punta: { tipo: "dedos", cantidad: 3, largoCm: 4, aberturaGrados: 40 } },
      accesorios: [
        { en: "coronilla", corrimientoCm: [0, 0, -2], forma: { tipo: "cresta", abanico: { ...T("T-260", 3.5, "005"), estilo: "burbujas", cantidad: 4, largoCm: 9, aberturaGrados: 13 }, anguloGrados: 90 } },
        { en: "hombro", corrimientoCm: [-3.5, 0, 0], forma: { tipo: "aro", tubito: T("T-160", 2.2, "015"), radioCm: 4.6, plano: "horizontal", desdeGrados: 0, hastaGrados: 360 } },
        { en: "pie", par: true, corrimientoCm: [4, 8, -2], forma: { tipo: "globo", globo: G("R-12", 18, "060"), anguloGrados: -15, adelanteGrados: 55 } },
      ],
    }),
  },
  {
    id: "figura_gallina", numero: 621, nombre: "Gallina", slug: "gallina", url: url("gallina"), productos: [],
    nota: "Se parece: lo del texto — «un LOL 12 y un cuarteto de G6»: cuerpo Link-O-Loon 12 blanco sobre cuarteto de R-5 blanco, ojos R-5 con pupila, pico y barbilla de T-260 rojo, cresta de dos lazos rojos, ala de dos burbujas largas blancas hacia atrás y patitas de T-160 amarillo. No: en la foto mira de lado (a la derecha) y aquí de frente; los G6 van como R-5. La idea no lista productos: 005 Blanco, 015 Rojo, 020 Amarillo.",
    pieza: pieza({
      postura: "de_pie", queEs: "a white balloon hen with googly eyes, a red twisted-balloon comb and beak and white tube wings, on a quad of white balloons",
      base: [{ formatoId: "R-5", infladoCm: 12, codigos: ["005"], cantidad: 4 }],
      piernas: null, cuerpo: [{ tipo: "globo", globo: G("LOL-12", 28, "005") }], cuello: null, cabeza: null, brazos: null,
      accesorios: [
        { en: "pecho", par: true, corrimientoCm: [4, 0, 6], forma: { tipo: "globo", globo: G("R-5", 7, "005"), anguloGrados: 40, adelanteGrados: 70, estampado: "ojo" } },
        { en: "pecho", corrimientoCm: [0, 0, 1], forma: { tipo: "pico", abanico: { ...T("T-260", 3.5, "015"), estilo: "lazos", cantidad: 2, largoCm: 6, anchoCm: 4, aberturaGrados: 50 } } },
        { en: "pecho", corrimientoCm: [0, 1, -3], forma: { tipo: "burbujas", tubito: T("T-260", 3, "015"), largosCm: [5], angulosGrados: [-95], adelanteGrados: [30] } },
        { en: "coronilla", corrimientoCm: [0, 0, -1], forma: { tipo: "cresta", abanico: { ...T("T-260", 4, "015"), estilo: "lazos", cantidad: 2, largoCm: 9, anchoCm: 6, aberturaGrados: 110 }, anguloGrados: 90 } },
        { en: "espalda", corrimientoCm: [-9, 0, 0], forma: { tipo: "alas", abanico: { ...T("T-260", 4.5, "005"), estilo: "burbujas", cantidad: 2, largoCm: 21, aberturaGrados: 14 }, anguloGrados: 178, adelanteGrados: 0 } },
        { en: "base", corrimientoCm: [0, 9, -1], forma: { tipo: "cresta", abanico: { ...T("T-160", 2.1, "020"), estilo: "flecos", cantidad: 5, largoCm: 10, aberturaGrados: 24 }, anguloGrados: -5, adelanteGrados: 45 } },
      ],
    }),
  },
  {
    id: "figura_gatito_negro", numero: 624, nombre: "Gatito negro", slug: "gatito-negro", url: url("gatito-negro"), productos: [],
    nota: "Se parece: cuerpo R-18 negro sobre cuarteto de R-5 negro, cabeza R-12 negra con ojos verdes, hocico blanco, bigotes y boquita impresos, orejas de lazo y cola curva de T-260 negro, moño de dos R-5 naranja. No: la cara de la foto es una calcomanía transparente con borde (aquí impresa directo); la cola sale un poco más abajo. La idea no lista productos: 080 Negro y 061 Naranja.",
    pieza: pieza({
      postura: "de_pie", queEs: "a black balloon cat with a printed face with green eyes and whiskers, loop ears, a curled twisted-balloon tail and an orange balloon bow",
      base: [{ formatoId: "R-5", infladoCm: 12, codigos: ["080"], cantidad: 4 }],
      piernas: null, cuerpo: [{ tipo: "globo", globo: G("R-18", 40, "080") }],
      cuello: { ...G("R-5", 11, "061"), cantidad: 2 },
      cabeza: { ...G("R-12", 26, "080"), cara: { ...SIN_CARA, ojos: { estilo: "ovalos", hex: "#2fb34a" }, nariz: { estilo: "punto", hex: "#ffffff" }, bigote: { estilo: "gato", hex: "#ffffff" }, boca: { estilo: "linea", hex: "#e0464f" } } },
      brazos: null,
      accesorios: [
        { en: "oreja", par: true, forma: { tipo: "orejas", estilo: "lazo", tubito: T("T-260", 4, "080"), largoCm: 14, anchoCm: 10, anguloGrados: 62 } },
        { en: "espalda", corrimientoCm: [-15, 0, 4], forma: { tipo: "cola", estilo: "curva", tubito: T("T-260", 4, "080"), largoCm: 32, anguloGrados: 112, giroGrados: 55 } },
      ],
    }),
  },
  {
    id: "figura_mariquita", numero: 734, nombre: "Mariquita", slug: "mariquita", url: url("mariquita"), productos: [],
    nota: "Se parece: un R-24 rojo grande con puntos negros, el T-260 sin inflar que marca las alas, seis R-9 negros de patas alrededor, cabeza R-12 negra y una antena de T-260 con su burbuja. No: en la foto los puntos son un globo negro dentro del rojo que se ve por huecos (aquí impresos); se ve desde arriba y aquí de lado. La idea no lista productos: 015 Rojo y 080 Negro.",
    pieza: pieza({
      postura: "horizontal", queEs: "a big red balloon ladybug with black spots, black balloon legs around it, a black head and a twisted-balloon antenna",
      base: [{ formatoId: "R-9", infladoCm: 18, codigos: ["080"], cantidad: 6 }],
      piernas: null, patasPorLado: 0,
      cuerpo: [{ tipo: "globo", globo: G("R-24", 50, "015"), dibujo: { estilo: "puntos", hex: "#111111", cantidad: 11 } }],
      cuello: null, cabeza: { ...G("R-12", 24, "080"), cara: null }, cabezaGrados: -20, brazos: null,
      accesorios: [
        { en: "lomo", corrimientoCm: [0, 0, -25], forma: { tipo: "aro", tubito: T("T-160", 2, "080"), radioCm: 26.5, plano: "lado", desdeGrados: -15, hastaGrados: 125 } },
        { en: "coronilla", corrimientoCm: [2, 0, -2], forma: { tipo: "antenas", tubito: T("T-260", 3.5, "080"), largoCm: 18, anguloGrados: 52, punta: G("R-5", 11, "080") } },
      ],
    }),
  },
  {
    id: "figura_muneco_nieve", numero: 749, nombre: "Mini muñeco de nieve", slug: "mini-muneco-de-nieve-pastel-mate", url: url("mini-muneco-de-nieve-pastel-mate"),
    productos: [
      { nombre: "GLOBO REDONDO FASHION BLANCO", formato: "R-12", codigo: "005", color: "Fashion Blanco" },
      { nombre: "GLOBO REDONDO PASTEL MATE VERDE", formato: "R-12", codigo: "630", color: "Pastel Mate Verde" },
      { nombre: "GLOBO TUBITO FASHION AZUL CELESTE", formato: "T-260", codigo: "040", color: "Fashion Azul" },
    ],
    nota: "Se parece: cuerpo de cuarteto R-12 Blanco (005), cabeza R-12 Blanco con ojos, nariz de zanahoria y sonrisa impresos, gorro R-12 Pastel Mate Verde (630) con ala de T-260 verde, cinta rosada y pompón lila, y bufanda de tres tubitos pastel trenzados. No: en la foto la cabeza es un racimo de R-12 (aquí un solo globo, para llevar la cara); la idea lista un tubito Azul Celeste (040) que no se ve en la foto: la bufanda y el gorro van en T-260 Pastel Mate rosado (609), lila (650) y verde (630), que no están en la lista.",
    pieza: pieza({
      postura: "de_pie", queEs: "a small pastel balloon snowman with a printed face and carrot nose, a mint balloon beanie with pink and lilac trims and a braided pastel twisted-balloon scarf",
      base: [{ formatoId: "R-12", infladoCm: 25, codigos: ["005"], cantidad: 4 }],
      piernas: null, cuerpo: [], cuello: null,
      cabeza: { ...G("R-12", 28, "005"), cara: { ...SIN_CARA, ojos: { estilo: "puntos", hex: TINTA }, nariz: { estilo: "zanahoria", hex: "#f26b1d" }, boca: { estilo: "sonrisa", hex: "#c0272d" } } },
      brazos: null,
      accesorios: [
        { en: "cuello", corrimientoCm: [0, -2, 1], forma: { tipo: "bufanda", formatoId: "T-260", grosorCm: 4, codigos: ["609", "650", "630"], radioCm: 14 } },
        { en: "coronilla", corrimientoCm: [0, -4, 1], forma: { tipo: "sombrero", ala: { ...T("T-260", 5, "630"), estilo: "aro", radioCm: 14 }, copa: { globo: G("R-12", 26, "630") }, cinta: T("T-260", 4.5, "609"), pompon: G("R-5", 10, "650"), inclinacionGrados: 0 } },
      ],
    }),
  },
  {
    id: "figura_pollito", numero: 852, nombre: "Pollito", slug: "pollito", url: url("pollito"), productos: [],
    nota: "Se parece: lo del texto — «un LOL 12 amarillo para el cuerpo, para el pico un T 260 rojo, ojos impresos topes y tubitos desinflados para la cresta»: Link-O-Loon 12 Amarillo, pico de dos lazos rojos, ojos R-5 blancos con pupila y cresta de flecos de T-260 amarillo casi sin inflar. No: las patas de la foto son lazos naranja de T-260 y aquí un anillo de seis R-5 Naranja; los «ojos topes» son calcomanías y aquí globitos; falta el ala dibujada. La idea no lista productos: 020 Amarillo, 015 Rojo, 061 Naranja.",
    pieza: pieza({
      postura: "de_pie", queEs: "a round yellow balloon chick with googly eyes, a red twisted-balloon beak and a tuft of deflated yellow balloons on top, on orange balloon feet",
      base: [{ formatoId: "R-5", infladoCm: 10, codigos: ["061"], cantidad: 6 }],
      piernas: null, cuerpo: [{ tipo: "globo", globo: G("LOL-12", 30, "020") }], cuello: null, cabeza: null, brazos: null,
      accesorios: [
        { en: "pecho", par: true, corrimientoCm: [5, 0, 5], forma: { tipo: "globo", globo: G("R-5", 8, "005"), anguloGrados: 30, adelanteGrados: 75, estampado: "ojo" } },
        { en: "pecho", corrimientoCm: [0, 0, -4], forma: { tipo: "pico", abanico: { ...T("T-260", 4, "015"), estilo: "lazos", cantidad: 2, largoCm: 7, anchoCm: 5, aberturaGrados: 55 } } },
        { en: "coronilla", corrimientoCm: [0, 0, -1], forma: { tipo: "cresta", abanico: { ...T("T-260", 2.1, "020"), estilo: "flecos", cantidad: 7, largoCm: 14, aberturaGrados: 16 }, anguloGrados: 90 } },
      ],
    }),
  },
];

/** La decoración de una idea (todas son figuras). */
export function decoracionDeIdea(idea: IdeaFigura): DecoracionFigura {
  if (idea.pieza.tipo !== "decoracion" || idea.pieza.decoracion.tipo !== "figura") throw new Error(`La idea ${idea.id} no es una figura.`);
  return idea.pieza.decoracion;
}

/**
 * Plantillas e ideas listas para «Decoraciones pequeñas» (grupo «Figuras»): primero las plantillas del generador y
 * después las ideas de la tienda, con su número.
 */
export const FIGURAS_PREDEFINIDAS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; decoracion: DecoracionFigura }> = [
  ...PLANTILLAS_FIGURA,
  ...IDEAS_FIGURAS.map((idea) => ({ id: idea.id, nombre: `${idea.nombre} · #${idea.numero}`, descripcion: `Idea #${idea.numero} de sempertex.com (${idea.slug}). ${idea.nota}`, decoracion: decoracionDeIdea(idea) })),
];
