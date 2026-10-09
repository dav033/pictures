import type { TipoPieza } from "./piezas";

/**
 * **Datos del glosario del taller** (la lógica está en `glosario-taller.ts`): cómo dice el decorador cada cosa —en
 * español, en inglés de Pinterest y con las faltas de ortografía de siempre— y a qué apunta en el taller: un formato
 * de globo («LOL-*», «R-24»), un tamaño (grandes, medianos, chicos), una técnica, un tipo de pieza o una parte de una
 * pieza (lo que va en `parte` de cada globo, ver `partes-globos.ts`).
 *
 * Los términos se escriben como se dicen (con tildes y guiones): al cargarse se normalizan (sin tildes, minúsculas,
 * «r24» → «r 24», «link-o-loon» → «link o loon»). Un término de una sola palabra de 7 letras o más tolera una falta
 * (dos desde 9 letras); los más cortos solo valen tal cual, así que sus faltas comunes van escritas aquí.
 */

export type ClaseTermino = "formato" | "tamano" | "tecnica" | "tipo" | "parte";

export type EntradaGlosario = {
  clase: ClaseTermino;
  /** Lo que significa en el taller: familia o formato («LOL-*», «R-24»), tamaño, técnica, tipo de pieza o parte. */
  canon: string;
  /** Cómo se muestra en el prompt (con tildes). */
  nombre: string;
  terminos: readonly string[];
  /** formato: el formato o la familia; tamano: los formatos de ese tamaño. */
  formatos?: readonly string[];
  /** tipo: los tipos de pieza del taller a los que se refiere. */
  tipos?: readonly TipoPieza[];
  /** familia: el número que la sigue → formato exacto («link-o-loon de 12» → LOL-12). */
  tallas?: Readonly<Record<string, string>>;
  /** Cómo se muestra en el prompt (si falta, los primeros términos sin repetir plurales). */
  muestra?: readonly string[];
  /** Términos que solo valen con un número detrás («r 24», «t 260», «c 6»). */
  requiereNumero?: readonly string[];
};

// ----------------------------------------------------------------------------------------------------------
// Formatos (familias): «link-o-loon» → LOL-*, «link-o-loon de 12» → LOL-12
// ----------------------------------------------------------------------------------------------------------

export const FAMILIAS_FORMATO: readonly EntradaGlosario[] = [
  {
    clase: "formato", canon: "LOL-*", nombre: "Link-O-Loon (eslabón con conector)", formatos: ["LOL-*"], muestra: ["link-o-loon", "linkoloon", "linkaloon", "lol", "eslabón", "link"],
    tallas: { "6": "LOL-6", "12": "LOL-12", "660": "LOL-660" },
    terminos: [
      "link-o-loon", "link-o-loons", "link o loon", "linkoloon", "linkoloons", "linkaloon", "linkaloons", "link a loon", "link-a-loon",
      "link a loons", "link o lon", "linkolon", "linkolun", "link o lun", "linkulun", "link loon", "link-loon", "lol", "lols",
      "eslabón", "eslabones", "eslavon", "eslavones", "link", "links", "globo con conector", "globos con conector", "globos enlazables", "enlazables",
    ],
  },
  {
    clase: "formato", canon: "T-*", nombre: "tubito (globo largo de modelar)", formatos: ["T-*"], muestra: ["tubito", "globo largo", "globo mágico", "de modelar", "twisting"],
    tallas: { "160": "T-160", "260": "T-260", "360": "T-360" },
    requiereNumero: ["t"],
    terminos: [
      "tubito", "tubitos", "tuvito", "tuvitos", "tubo", "tubos", "t", "globo largo", "globos largos", "globito largo", "globitos largos",
      "globo de modelar", "globos de modelar", "modelar", "globo mágico", "globos mágicos", "mágicos", "salchicha", "salchichas",
      "twisting", "twister", "modeling", "modelling", "modeling balloon", "modeling balloons", "pencil balloon",
    ],
  },
  {
    clase: "formato", canon: "R-*", nombre: "redondo", formatos: ["R-*"], muestra: ["redondo", "round"],
    tallas: { "5": "R-5", "9": "R-9", "12": "R-12", "18": "R-18", "24": "R-24", "36": "R-36" },
    requiereNumero: ["r"],
    terminos: ["redondo", "redondos", "redonda", "redondas", "globo redondo", "globos redondos", "round", "rounds", "r"],
  },
  {
    clase: "formato", canon: "C-*", nombre: "corazón de látex", formatos: ["C-*"], muestra: ["corazón", "heart"],
    tallas: { "6": "C-6", "12": "C-12" },
    requiereNumero: ["c"],
    terminos: ["corazón", "corazones", "globo corazón", "globos corazón", "globos de corazón", "corazoncito", "corazoncitos", "heart", "hearts", "c"],
  },
];

/** Formatos exactos que tienen nombre propio (sin número): «eslabón largo» es el LOL-660. */
export const FORMATOS_CON_NOMBRE: readonly EntradaGlosario[] = [
  { clase: "formato", canon: "LOL-660", nombre: "Link-O-Loon largo 660", formatos: ["LOL-660"], terminos: ["eslabón largo", "eslabones largos", "link largo", "links largos", "lol largo", "lols largos", "link-o-loon largo", "link-o-loons largos"] },
];

/** Números sueltos que ya dicen el formato («los 260», «unos 660»). */
export const NUMEROS_CON_FORMATO: Readonly<Record<string, string>> = { "160": "T-160", "260": "T-260", "360": "T-360", "660": "LOL-660" };

/** Pulgadas de los redondos (los formatos R-n que hay). */
export const TALLAS_REDONDO: Readonly<Record<string, string>> = { "5": "R-5", "9": "R-9", "12": "R-12", "18": "R-18", "24": "R-24", "36": "R-36" };

// ----------------------------------------------------------------------------------------------------------
// Tamaños por palabra (redondos): una partición sin huecos ni cruces
// ----------------------------------------------------------------------------------------------------------

/**
 * **Qué es grande, mediano y chico** (definido aquí, igual que en la regla de ajustar_tamanos del sistema de la ruta):
 * grandes = R-24 y R-36; medianos = R-12 y R-18; chicos = R-5 y R-9. Más fino: gigantes/jumbo = R-36 y
 * chiquitos/globitos/perlitas/mini = R-5. Si la pieza no tiene ninguno de esos, son sus globos más grandes (o más
 * chicos): eso lo decide quien mira la pieza (buscar_en_escena lo avisa), no el glosario.
 */
export const TAMANOS: readonly EntradaGlosario[] = [
  { clase: "tamano", canon: "gigantes", nombre: "gigantes", formatos: ["R-36"], terminos: ["gigante", "gigantes", "súper gigante", "super gigantes", "jumbo", "jumbos", "enorme", "enormes", "giant"] },
  { clase: "tamano", canon: "grandes", nombre: "grandes", formatos: ["R-24", "R-36"], terminos: ["grande", "grandes", "globo grande", "globos grandes", "big", "large", "gran formato"] },
  { clase: "tamano", canon: "medianos", nombre: "medianos", formatos: ["R-12", "R-18"], terminos: ["mediano", "medianos", "mediana", "medianas", "globos medianos", "medium"] },
  { clase: "tamano", canon: "chiquitos", nombre: "chiquitos", formatos: ["R-5"], muestra: ["chiquitos", "globitos", "perlitas", "mini"], terminos: ["chiquito", "chiquitos", "chiquita", "chiquitas", "chiquititos", "globito", "globitos", "perlita", "perlitas", "mini", "minis", "tiny"] },
  { clase: "tamano", canon: "chicos", nombre: "chicos", formatos: ["R-5", "R-9"], terminos: ["chico", "chicos", "chica", "chicas", "pequeño", "pequeños", "pequeña", "pequeñas", "small", "globos chicos", "globos pequeños"] },
];

/** Palabras que, justo antes de un tamaño, hablan de la pieza y no de los globos («hazla más grande»). */
export const INTENSIFICADORES: ReadonlySet<string> = new Set(["mas", "menos", "muy", "tan", "bien", "algo", "poco", "demasiado", "bastante"]);

// ----------------------------------------------------------------------------------------------------------
// Técnicas
// ----------------------------------------------------------------------------------------------------------

export const TECNICAS_TALLER: readonly EntradaGlosario[] = [
  { clase: "tecnica", canon: "pareja", nombre: "pareja (dúo)", terminos: ["pareja", "parejas", "dúo", "dúos", "duplet", "duplets"] },
  { clase: "tecnica", canon: "trio", nombre: "trío", terminos: ["trío", "tríos", "triplet", "triplets"] },
  { clase: "tecnica", canon: "cuarteto", nombre: "cuarteto", terminos: ["cuarteto", "cuartetos", "cuarteta", "quartet", "quartets", "de a cuatro"] },
  { clase: "tecnica", canon: "quinteto", nombre: "quinteto", terminos: ["quinteto", "quintetos", "quintet"] },
  { clase: "tecnica", canon: "sexteto", nombre: "sexteto", terminos: ["sexteto", "sextetos"] },
  { clase: "tecnica", canon: "racimo", nombre: "racimo", terminos: ["racimo", "racimos", "cluster", "clusters", "bola de globos"] },
  { clase: "tecnica", canon: "trenza", nombre: "trenza / espiral", terminos: ["trenza", "trenzas", "trenzado", "trenzada", "trenzados", "trenzadas", "espiral", "espirales", "braid", "braided", "spiral"] },
  { clase: "tecnica", canon: "malla", nombre: "malla (tejido)", terminos: ["malla", "mallas", "tejido", "tejida", "mesh", "grid"] },
  { clase: "tecnica", canon: "organico", nombre: "orgánico (varios tamaños)", terminos: ["orgánico", "orgánica", "orgánicos", "orgánicas", "organic", "de varios tamaños", "tipo burbuja"] },
  { clase: "tecnica", canon: "clasico", nombre: "clásico (de cuartetos)", terminos: ["clásico", "clásica", "clásicos", "clásicas", "classic"] },
  { clase: "tecnica", canon: "helio", nombre: "con helio (flotando)", terminos: ["helio", "con helio", "helium", "flotando", "flotantes"] },
  { clase: "tecnica", canon: "doble", nombre: "doble (globo dentro de globo)", terminos: ["doble", "globo doble", "globos dobles", "doble capa", "double stuff", "double stuffed", "globo dentro de globo"] },
];

// ----------------------------------------------------------------------------------------------------------
// Tipos de pieza
// ----------------------------------------------------------------------------------------------------------

export const TIPOS_TALLER: readonly EntradaGlosario[] = [
  { clase: "tipo", canon: "columna_organica", nombre: "columna orgánica", tipos: ["organico"], terminos: ["columna orgánica", "columnas orgánicas", "columna de varios tamaños", "columna irregular", "columna inclinada"] },
  { clase: "tipo", canon: "columna", nombre: "columna", tipos: ["columna"], terminos: ["columna", "columnas", "pilar", "pilares", "column", "columns", "colunma", "culumna"] },
  { clase: "tipo", canon: "arco_organico", nombre: "arco orgánico", tipos: ["arco_organico"], terminos: ["arco orgánico", "arcos orgánicos", "organic arch", "arco de varios tamaños"] },
  { clase: "tipo", canon: "arco", nombre: "arco", tipos: ["arco", "arco_organico"], terminos: ["arco", "arcos", "arch", "arches"] },
  { clase: "tipo", canon: "organico", nombre: "semiarco, aro, marco o guirnalda orgánicos", tipos: ["organico"], terminos: ["semiarco", "semiarcos", "medio arco", "aro", "aros", "aro orgánico", "marco orgánico", "guirnalda orgánica", "guirnaldas orgánicas", "trazo orgánico", "organic garland"] },
  { clase: "tipo", canon: "guirnalda", nombre: "guirnalda", tipos: ["guirnalda", "organico"], terminos: ["guirnalda", "guirnaldas", "guirlanda", "garland", "garlands", "festón", "festones"] },
  { clase: "tipo", canon: "pared_trenzas", nombre: "pared de trenzas", tipos: ["pared_trenzas"], terminos: ["pared de trenzas", "muro de trenzas"] },
  { clase: "tipo", canon: "pared", nombre: "pared de globos", tipos: ["pared_malla", "pared_trenzas"], terminos: ["pared", "paredes", "muro", "muros", "pared de globos", "pared de malla", "backdrop", "balloon wall"] },
  { clase: "tipo", canon: "metalizado", nombre: "globo metalizado (foil)", tipos: ["metalizado"], terminos: ["foil", "foils", "globo metalizado", "globos metalizados", "número metalizado", "números metalizados", "globo de foil", "mylar"] },
  { clase: "tipo", canon: "letras", nombre: "letras o números de globos", tipos: ["letras"], terminos: ["letra", "letras", "número", "números", "numero de globos", "letters"] },
  { clase: "tipo", canon: "forma", nombre: "forma de globos (figura rellena, esfera, cono)", tipos: ["forma"], terminos: ["forma", "formas", "figura de globos", "esfera", "esferas", "cono", "conos", "corazón de globos", "estrella de globos"] },
  { clase: "tipo", canon: "decoracion", nombre: "decoración (flor, moño, estrella, figura)", tipos: ["decoracion"], terminos: ["decoración", "decoraciones", "flor", "flores", "flor de globos", "moño", "moños", "estrella", "estrellas", "figura", "figuras", "muñeco", "muñecos", "animal", "animales", "calabaza", "calabazas", "araña", "arañas", "fantasma", "fantasmas", "ramo", "ramos", "rizo", "rizos", "burbuja", "burbujas", "telaraña", "mano", "flower", "bow", "star"] },
  { clase: "tipo", canon: "arbol_globos", nombre: "palmera o árbol de globos", tipos: ["arbol_globos"], terminos: ["palmera", "palmeras", "árbol", "árboles", "arbolito", "arbolitos", "palm tree", "palm trees", "tree"] },
  { clase: "tipo", canon: "mural", nombre: "mural pixelado", tipos: ["mural"], terminos: ["mural", "murales", "pixelado", "pixel"] },
  { clase: "tipo", canon: "techo", nombre: "decoración de techo", tipos: ["techo"], terminos: ["techo", "decoración de techo", "ceiling"] },
  { clase: "tipo", canon: "globo", nombre: "globo suelto", tipos: ["globo"], terminos: ["globo suelto", "globos sueltos"] },
  { clase: "tipo", canon: "escenografia", nombre: "escenografía (no es globo)", tipos: ["escenografia"], terminos: ["escenografía", "panel", "paneles", "mesa", "mesas", "silla", "sillas", "taburete", "sofa", "mueble", "muebles", "mobiliario", "tapete", "cilindro", "cilindros"] },
  { clase: "tipo", canon: "modulo", nombre: "módulo suelto", tipos: ["modulo"], terminos: ["módulo", "módulos"] },
];

// ----------------------------------------------------------------------------------------------------------
// Partes (lo que va en `parte` de cada globo: minúsculas, sin tildes, «/» para lo más fino)
// ----------------------------------------------------------------------------------------------------------

/** Las partes de oficio de base. Las de los módulos que etiquetan se suman en `glosario-taller.ts` (PARTES_DE_MODULOS). */
export const PARTES_TALLER: readonly EntradaGlosario[] = [
  { clase: "parte", canon: "petalos", nombre: "pétalos", terminos: ["pétalo", "pétalos", "petal", "petals"] },
  { clase: "parte", canon: "centro", nombre: "centro (botón)", terminos: ["centro", "centros", "botón", "botones", "núcleo", "center"] },
  { clase: "parte", canon: "corona", nombre: "corona (anillo)", terminos: ["corona", "coronas", "anillo", "anillos", "crown"] },
  { clase: "parte", canon: "lazos", nombre: "lazos", terminos: ["lazo", "lazos", "loop", "loops"] },
  { clase: "parte", canon: "colas", nombre: "colas", terminos: ["cola", "colas", "tail", "tails"] },
  { clase: "parte", canon: "ramas", nombre: "ramas", terminos: ["rama", "ramas", "ramita", "ramitas", "branch", "branches"] },
  { clase: "parte", canon: "tronco", nombre: "tronco", terminos: ["tronco", "troncos", "trunk"] },
  { clase: "parte", canon: "copa", nombre: "copa", terminos: ["copa", "copas", "canopy"] },
  { clase: "parte", canon: "hojas", nombre: "hojas (frondas)", terminos: ["hoja", "hojas", "hojita", "hojitas", "oja", "ojas", "fronda", "frondas", "leaf", "leaves"] },
  { clase: "parte", canon: "frutas", nombre: "frutas", terminos: ["fruta", "frutas", "frutita", "frutitas", "manzana", "manzanas", "manzanitas", "fruit", "fruits"] },
  { clase: "parte", canon: "cocos", nombre: "cocos", terminos: ["coco", "cocos", "coconut", "coconuts"] },
  { clase: "parte", canon: "collar", nombre: "collar", terminos: ["collar", "collares", "necklace"] },
  { clase: "parte", canon: "flecos", nombre: "flecos (borlas)", terminos: ["fleco", "flecos", "borla", "borlas", "fringe", "tassel", "tassels"] },
  { clase: "parte", canon: "relleno", nombre: "relleno", terminos: ["relleno", "rellenos", "relleno chico", "huecos", "filler", "fillers"] },
  { clase: "parte", canon: "estructura", nombre: "estructura (cuerpo de la pieza)", terminos: ["estructura", "estructuras", "armazón", "structure"] },
  { clase: "parte", canon: "pata/izquierda", nombre: "pata izquierda", terminos: ["pata izquierda", "lado izquierdo del arco"] },
  { clase: "parte", canon: "pata/derecha", nombre: "pata derecha", terminos: ["pata derecha", "lado derecho del arco"] },
  { clase: "parte", canon: "pata", nombre: "patas", terminos: ["pata", "patas", "pie", "pies", "leg", "legs"] },
  { clase: "parte", canon: "clave", nombre: "clave (lo alto del arco)", terminos: ["clave", "cima", "keystone", "parte de arriba del arco"] },
  { clase: "parte", canon: "base", nombre: "base", terminos: ["base", "bases", "montículo", "basecita"] },
  { clase: "parte", canon: "remate", nombre: "remate (punta)", terminos: ["remate", "remates", "punta", "puntas", "topper", "toppers"] },
  { clase: "parte", canon: "tallo", nombre: "tallo", terminos: ["tallo", "tallos", "stem", "stems"] },
  { clase: "parte", canon: "cuerpo", nombre: "cuerpo", terminos: ["cuerpo", "cuerpos", "body"] },
  { clase: "parte", canon: "cabeza", nombre: "cabeza", terminos: ["cabeza", "cabezas", "head"] },
  { clase: "parte", canon: "ojos", nombre: "ojos", terminos: ["ojo", "ojos", "eye", "eyes"] },
  { clase: "parte", canon: "brazos", nombre: "brazos", terminos: ["brazo", "brazos", "arm", "arms"] },
  { clase: "parte", canon: "alas", nombre: "alas", terminos: ["ala", "alas", "wing", "wings"] },
  { clase: "parte", canon: "borde", nombre: "borde (contorno)", terminos: ["borde", "bordes", "contorno", "orilla", "outline"] },
  { clase: "parte", canon: "rayos", nombre: "rayos", terminos: ["rayo", "rayos", "ray", "rays"] },
  { clase: "parte", canon: "cintas", nombre: "cintas", terminos: ["cinta", "cintas", "ribbon", "ribbons"] },
  { clase: "parte", canon: "sombrero", nombre: "sombrero", terminos: ["sombrero", "gorro", "hat"] },
];

// ----------------------------------------------------------------------------------------------------------
// Palabras que no dicen nada para buscar (y que no deben confundirse con un término por una falta)
// ----------------------------------------------------------------------------------------------------------

export const VACIAS_GLOSARIO: ReadonlySet<string> = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "lo", "le", "les", "se", "me", "mi", "mis", "su", "sus", "tu", "tus",
  "de", "del", "a", "al", "en", "y", "e", "o", "u", "por", "para", "con", "sin", "que", "como", "pero", "si", "no", "ya", "hay",
  "este", "esta", "esto", "estos", "estas", "ese", "esa", "eso", "esos", "esas", "aquel", "aquella", "otro", "otra", "otros", "otras",
  "todo", "toda", "todos", "todas", "solo", "sola", "solamente", "mas", "menos", "muy", "tan", "cada", "algun", "alguna", "algunos",
  "globo", "globos", "color", "colores", "tono", "tonos", "tamano", "tamanos", "pieza", "piezas", "cosa", "cosas", "parte", "partes",
  "cambia", "cambiar", "cambiale", "cambialos", "cambialas", "cambiame", "pon", "ponle", "ponlos", "ponlas", "poner", "pinta", "pintar",
  "quiero", "quisiera", "necesito", "haz", "hazlo", "hazla", "hacer", "deja", "dejar", "dejalo", "quita", "quitar", "quitale", "saca",
  "agrega", "agregar", "agregale", "suma", "sube", "baja", "mueve", "mover", "usa", "usar", "tiene", "tienen", "lleva", "llevan",
  "the", "of", "and", "to", "in", "on", "with", "for", "change", "make", "all", "favor", "porfa", "porfavor", "please", "gracias", "lados", "lado", "dentro", "hecho", "decoradora", "decorador",
]);

/** Unidades: un número seguido de esto es una medida o una cantidad, no un formato («de 12 cm», «24 globos»). */
export const UNIDADES: ReadonlySet<string> = new Set([
  "cm", "centimetros", "centimetro", "m", "mt", "mts", "metro", "metros", "mm", "%", "por", "porciento", "grados", "kg", "globos", "globo",
  "unidades", "unidad", "piezas", "veces", "x", "cuartetos", "racimos", "flores", "anos", "horas", "personas", "pies", "ft", "feet",
]);

/** Lo que viene tras un número para decir pulgadas («24 pulgadas», «24"», «24 in»: la normalización lo deja en «pulgadas»). */
export const PULGADAS: ReadonlySet<string> = new Set(["pulgadas", "pulgada", "pulg", "pulgs", "inch", "inches", "pulgadita"]);

/** Lo que puede ir entre una familia y su número sin cambiar nada («link-o-loon de 12», «tubito número 260»). */
export const RELLENO_ENTRE: ReadonlySet<string> = new Set(["de", "del", "numero", "no", "n", "tipo", "talla", "medida", "tamano"]);
