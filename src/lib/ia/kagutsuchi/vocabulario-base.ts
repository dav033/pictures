import { aDescriptorPerceptual } from "./descriptor-perceptual";
import { ACABADO_EN } from "@/lib/ia/uzume/mezcla-color-escena";
import { referenciaDelCatalogo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { labDeRgb } from "@/lib/rag/catalog/similitud-color";

/**
 * Palabras de `nombreEn` que nombran el acabado o la línea comercial, no el color: el acabado se escribe
 * aparte (`acabadoVisible`) y «pastel», «neon», «reflex»… son nombres de línea que el preflight base rechaza.
 */
const PALABRAS_NO_COLOR = new Set(["matte", "satin", "chrome", "metallic", "pearlescent", "neon", "pastel", "glossy", "translucent", "crystal", "silk", "reflex", "fashion", "dusk"]);
const PALABRAS_OSCURO = /\b(?:deep|dark|navy|black|midnight)\b/;
const PALABRAS_CLARO = /\b(?:pale|light|baby|soft|white|cream|ivory)\b/;
const PALABRAS_APAGADO = /\b(?:muted|dusty|dusk|sage|grey|gray|smoky)\b/;
/** Familias cuyo color medido en el globo inflado lo oscurece el reflejo, no el pigmento. */
const FAMILIAS_ESPECULARES = new Set(["reflex", "metal", "cristal"]);

/**
 * El color de un globo con las palabras de su **referencia real de Sempertex**: el `nombreEn` de la lámina
 * del fabricante («chrome light pink», «dusty pastel light blue»), sin las palabras de acabado o de línea, y
 * matizado con el color **medido** del globo inflado (`hexGlobo`) cuando el nombre no dice ya lo oscuro,
 * claro o apagado que es: «deep», «pale», «muted». Así el dorado 970 Reflex y el 570 Metal, o el Lila 050
 * Fashion y el 650 Pastel Mate, dejan de ser la misma palabra (auditoría 2026-10-04).
 *
 * Nunca el código, el Pantone ni el hexadecimal: un modelo de difusión no sabe qué color es «PANTONE 10444»
 * y puede dibujar el número como texto. Las cifras van solo al prompt de Gemini (`bloqueColoresExactos`).
 *
 * El matiz medido no se aplica a Reflex, Metal ni Cristal: su `hexGlobo` lo oscurece el reflejo o la
 * transparencia, no el pigmento, y «deep» pintaría un dorado cromado como bronce.
 */
export function colorDeReferencia(referencia: ReferenciaSempertex): string {
  const nombre = referencia.nombreEn.toLowerCase().split(/\s+/).filter((palabra) => palabra && !PALABRAS_NO_COLOR.has(palabra)).join(" ");
  if (!nombre) return "";
  if (referencia.neutro || FAMILIAS_ESPECULARES.has(referencia.familia)) return nombre;
  const hex = referencia.hexGlobo.slice(1);
  const [l, a, b] = labDeRgb(Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16));
  const croma = Math.hypot(a, b);
  if (l < 35 && !PALABRAS_OSCURO.test(nombre)) return `deep ${nombre}`;
  if (l > 80 && croma < 30 && !PALABRAS_CLARO.test(nombre)) return `pale ${nombre}`;
  if (croma < 18 && !PALABRAS_APAGADO.test(nombre) && !PALABRAS_CLARO.test(nombre)) return `muted ${nombre}`;
  return nombre;
}

/**
 * El color visible de un material del plan (color y acabado en palabras del catálogo, en español), o
 * `undefined` si el color no es un nombre de la lámina: quien llama se queda con su descripción de siempre.
 */
export function colorVisibleDelCatalogo(color: string | null | undefined, acabado: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const referencia = referenciaDelCatalogo(color, acabado ?? null);
  const visible = referencia ? colorDeReferencia(referencia) : "";
  return visible || undefined;
}

/**
 * Vocabulario del caption para el modelo BASE de FLUX.2, sin LoRA.
 *
 * Los dialectos `product_v007` y `scene_v004` imitan las captions con las que se entrenó cada LoRA, y por eso
 * dicen «Reflex», «solid Fashion finish» o «Link-O-Loon®»: son las palabras que ese LoRA aprendió mirando
 * las fotos. El modelo base nunca vio esas captions. Para él «Reflex» es una marca o una palabra escrita, y
 * «Fashion» describe ropa. Aquí cada producto se dice con lo que una persona VE en el globo: el color real,
 * el acabado que se nota en la superficie, la forma, el tamaño en pulgadas con su escala relativa.
 *
 * Este módulo solo es dueño de las tablas de palabras visibles. No traduce colores del español
 * (`LORA_COLOR_NAMES_EN`/`translateLoraColor` del compilador), ni acabados del español al inglés llano
 * (`ACABADO_EN` de `mezcla-color-escena.ts`), ni nombres comerciales a perceptuales (`aDescriptorPerceptual`):
 * los reutiliza y añade solo lo que les falta. Puro: sin red, sin base de datos, sin variables de entorno.
 */

/**
 * Lo que el caption dice de un producto. Un globo se compone en la frase de materiales
 * («small 5-inch mirror-like chrome gold latex balloons»); cualquier otra pieza (un mural, un banderín, un
 * kit armado) no tiene esa gramática y se nombra entera con su etiqueta ya limpia.
 */
export type TerminosBase =
  | { kind: "balloon"; finish: string; color: string; noun: string }
  | { kind: "piece"; label: string };

/**
 * Acabado → lo que se ve en la superficie del globo. Se evalúa en orden y gana la primera regla, así que
 * los casos compuestos van antes que sus palabras sueltas («pastel dusk» antes de «pastel»); una mezcla
 * («mixed matte and glossy chrome») se reescribe parte por parte en `acabadoVisible`. Entra tanto el texto del vocabulario («Reflex high-shine», «solid Fashion») como el inglés llano
 * de `ACABADO_EN` («high-shine chrome») y las palabras de `FINISH_WORDS` del compilador («soft pearlescent»).
 *
 * Por qué cada frase:
 * - `mirror-like chrome`: «glossy» o «high-shine» a secas salen como plástico brillante; un modelo general
 *   asocia «chrome» y «mirror-like» a una superficie que refleja el entorno, que es lo que hace un Reflex.
 * - `shiny metallic foil`: el foil es una lámina metálica arrugada en los bordes, distinta del látex; sin
 *   «foil» el modelo la pinta como un globo de látex cromado.
 * - `muted dusty matte` y `soft matte`: los tonos apagados y pálidos. «pastel» no se usa: es nombre de línea
 *   comercial (`TERMINOS_COMERCIALES`) y el preflight base lo rechaza como tal.
 * - `satin pearlescent`: Silk, Satin y perlado tienen un brillo nacarado suave. «satin» solo sugiere tela
 *   (lo anota `descriptor-perceptual.ts`); «pearlescent» lo ancla al brillo de perla.
 * - `translucent`: el globo deja ver a través; «clear» solo se reserva para el color.
 * - `fluorescent`: «neon» se pinta como un tubo de neón o un letrero luminoso, que es texto e iluminación.
 * - `satin metallic`: el Metal/Metallic de látex tiene un brillo metálico suave, menos espejo que el Reflex;
 *   decir «chrome» lo confundiría con él.
 * - `matte`: Fashion, sólido y mate son el látex opaco sin brillo.
 */
const ACABADO_VISIBLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpastel dusk\b|\bmuted\b|\bdusty\b/i, "muted dusty matte"],
  [/\bpastel\b|\bsoft matte\b/i, "soft matte"],
  [/\bfoil\b|\bmetalli[sz]ed\b|\bmetalizad[oa]s?\b/i, "shiny metallic foil"],
  [/\breflex\b|\bchrome\b|\bcromad[oa]\b|\bhigh-shine\b|\bhigh-gloss\b|\bglossy\b/i, "mirror-like chrome"],
  [/\bsilk\b|\bseda\b|\bsatin\b|\bsatinad[oa]\b|\bpearl\w*\b|\bperlad[oa]s?\b|\bnacar\w*\b/i, "satin pearlescent"],
  [/\bcrystal\b|\bcristal\b|\btranslucent\b|\btransparente?s?\b/i, "translucent"],
  [/\bneon\b|\bfluorescent\b/i, "fluorescent"],
  [/\bmetal\w*\b/i, "satin metallic"],
  [/\bfashion\b|\bmatte?\b|\bsolid\b/i, "matte"],
];

/**
 * Familias del catálogo que `ACABADO_EN` todavía no traduce. Solo se añaden aquí porque ese mapa habla de
 * acabados canónicos del plan, y estas palabras aparecen en los títulos del catálogo («Globo Silk Rosa»). El
 * valor es inglés llano; la palabra visible la decide `ACABADO_VISIBLE`.
 */
const FAMILIAS_SIN_ACABADO_EN: Readonly<Record<string, string>> = {
  silk: "silk",
  seda: "silk",
  satinado: "satin",
  perla: "pearl",
  perlados: "pearl",
  nacarado: "pearl",
  pastel: "pastel",
  "pastel dusk": "pastel dusk",
  "pastel mate": "pastel",
  cristal: "crystal",
  crystal: "crystal",
  neon: "neon",
  metallic: "metallic",
  brillante: "high-shine chrome",
};

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Acabado visible para cualquier texto de acabado: el del vocabulario, el inglés llano o una familia del
 * catálogo en español. Cadena vacía cuando no se reconoce: es mejor no decir el acabado que inventarlo.
 */
export function acabadoVisible(texto: string | undefined): string {
  const limpio = plegar(texto ?? "");
  if (!limpio) return "";
  const ingles = ACABADO_EN[limpio] ?? FAMILIAS_SIN_ACABADO_EN[limpio] ?? limpio;
  if (/\bmixed\b/.test(ingles)) {
    // «mixed matte and glossy chrome finishes» → «mixed matte and mirror-like chrome»: cada acabado de la
    // mezcla con su palabra visible, sin repetir y sin la palabra «finishes».
    const partes = ingles.replace(/^mixed\s+/, "").replace(/\bfinish(?:es)?\b/g, "").split(/,|\band\b|\bwith\b|\bor\b/)
      .map((parte) => acabadoSimple(parte.trim()))
      .filter(Boolean);
    const unicas = [...new Set(partes)];
    return unicas.length ? `mixed ${unirNatural(unicas)}` : "";
  }
  return acabadoSimple(ingles);
}

function acabadoSimple(ingles: string): string {
  for (const [patron, visible] of ACABADO_VISIBLE) if (patron.test(ingles)) return visible;
  return "";
}

/**
 * Colores del vocabulario con nombre de fantasía que `aDescriptorPerceptual` todavía no corrige. Un modelo
 * general no sabe de qué color es «laurel green» o «imperial red»: lee el adjetivo como un estilo y vuelve
 * a su verde o su rojo por defecto. Cada entrada conserva la palabra del tono base («green», «brown», «red»)
 * porque es la que el plan aprobó y la que el preflight busca en el prompt.
 */
const COLORES_VISIBLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\blaurel green\b/gi, "muted olive green"],
  [/\bclover green\b/gi, "medium leaf green"],
  [/\beucalyptus green\b/gi, "muted grey-green"],
  [/\bjungle green\b/gi, "deep forest green"],
  [/\bcoffee brown\b/gi, "dark brown"],
  [/\blatte\b/gi, "light beige-brown"],
  [/\bmocha\b/gi, "medium warm brown"],
  [/\bcopper orange\b/gi, "burnt copper orange"],
  [/\bhoney yellow\b/gi, "warm golden yellow"],
  [/\bimperial red\b/gi, "deep red"],
  [/\bmerlot\b/gi, "deep burgundy red"],
  [/\bmalibu peach\b/gi, "soft peach"],
  [/\bmelon\b/gi, "light coral orange"],
  [/\bcaribbean blue\b/gi, "bright turquoise blue"],
  [/\bsand\b/gi, "sand beige"],
  [/\bpastel pink\b/gi, "pale pink"],
  [/\bpastel multicolor\b/gi, "pale multicolor"],
  [/\bmuted pastel\b/gi, "muted pale tones"],
  [/^pearl$/gi, "pearly white"],
];

/** Color de un producto con las palabras de lo que se ve; cadena vacía si el catálogo no lo sabe. */
export function colorVisible(color: string | undefined): string {
  const valor = aDescriptorPerceptual((color ?? "").trim());
  if (!valor || /^(?:unspecified|unknown|catalog color)$/i.test(valor)) return "";
  return limpiarEtiqueta(valor);
}

/**
 * Forma → sustantivo. «round» no se dice: un globo de látex ya es redondo para cualquier modelo, y la
 * palabra solo alargaría cada material. «modeling» es jerga del oficio; lo que se ve es un globo largo.
 * «Link-O-Loon®» es una marca registrada: escrita, el modelo tiende a pintarla como texto.
 */
const SUSTANTIVO_POR_FORMA: Readonly<Record<string, { latex: string; foil: string }>> = {
  round: { latex: "latex balloons", foil: "round foil balloons" },
  heart: { latex: "heart-shaped latex balloons", foil: "heart-shaped foil balloons" },
  star: { latex: "star-shaped latex balloons", foil: "star-shaped foil balloons" },
  modeling: { latex: "long twisting balloons", foil: "long twisting balloons" },
  link: { latex: "chain-linking latex balloons", foil: "chain-linking latex balloons" },
  "link-o-loon": { latex: "chain-linking latex balloons", foil: "chain-linking latex balloons" },
  number: { latex: "number-shaped balloons", foil: "number-shaped foil balloons" },
};

/**
 * Lo que queda de una etiqueta del vocabulario cuando se le quita lo que el modelo base no entiende o
 * escribiría: nombres de línea comercial, marcas registradas, paréntesis y punto y coma (en un prompt
 * de texto libre se leen como una nota al margen, y sueltan la palabra de su sustantivo).
 */
export function limpiarEtiqueta(texto: string): string {
  let valor = aDescriptorPerceptual(texto);
  // Los colores de fantasía también aparecen dentro de etiquetas enteras («in muted pastel with ...»).
  for (const [patron, visible] of COLORES_VISIBLES) valor = valor.replace(patron, visible);
  return valor
    .replace(/Link-O-Loon®?\s*/gi, "")
    .replace(/®|™/g, "")
    .replace(/\bPastel Dusk\b/g, "muted dusty")
    .replace(/\bPastel Matte\b/gi, "soft matte")
    // Ni como adjetivo: «pastel» es también la línea comercial, y el preflight base la rechaza.
    .replace(/\bpastel\b/gi, "pale")
    .replace(/\bNeon\b/g, "fluorescent")
    .replace(/\b(?:Fashion|Reflex|Silk|Crystal)\b\s*/g, "")
    .replace(/\s*\(([^)]*)\)/g, ", $1")
    .replace(/;/g, ",")
    .replace(/\bmatte matte\b/gi, "matte")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un color que ya trae su acabado («matte black») no lo repite: «matte matte black». */
function sinAcabadoEnColor(acabado: string, color: string): string {
  const palabras = new Set(color.toLowerCase().split(/\s+/));
  return acabado.split(/\s+/).every((palabra) => palabras.has(palabra)) ? "" : acabado;
}

/**
 * Términos base de un concepto del vocabulario. Un globo liso de una forma conocida se describe por partes
 * (acabado, color, sustantivo); un impreso, un surtido o cualquier pieza que no es un globo se nombra con su
 * etiqueta canónica limpia, porque ahí la etiqueta describe cosas (el estampado, las piezas del kit) que el
 * reparto por partes perdería.
 */
/** Lo que se pudo leer de un título del catálogo. Hechos del catálogo, nunca salida de un modelo. */
export type TituloCatalogoBase = {
  /** Forma del vocabulario (`round`, `heart`…), o undefined si el título no es de un globo. */
  forma?: string;
  material: "latex" | "foil";
  /** Acabado visible, ya resuelto. */
  acabado: string;
  /** Palabras del título que sobran tras quitar tipo, forma, material y familia: casi siempre el color, en español. */
  restoColor: string;
};

const FORMAS_TITULO: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcorazon(?:es)?\b/, "heart"],
  [/\bestrellas?\b/, "star"],
  [/\blink\b|\blink-o-loon\b/, "link"],
  [/\bmodelar\b|\bmoldeable\b|\b260\b|\b160\b/, "modeling"],
  [/\bnumeros?\b/, "number"],
  [/\bredond[oa]s?\b/, "round"],
];

/** Familias en el orden en que hay que buscarlas: las de dos palabras antes que sus partes. */
const FAMILIAS_TITULO = ["pastel dusk", "pastel mate", "reflex", "fashion", "silk", "seda", "satin", "satinado", "metalizado", "metal", "cromado", "perlado", "perla", "nacarado", "transparente", "cristal", "crystal", "neon", "pastel", "mate"];

/**
 * Lee forma, material, acabado y el resto (el color) de un título factual del catálogo de Shopify, p. ej.
 * «B2b Globo Latex Redondo Fashion Blanco». Solo para el dialecto base, cuando el producto no tiene concepto
 * en el vocabulario: el modelo base no necesita que el producto esté en un dataset, solo que se describa.
 * Devuelve undefined si el título no es de un globo, para que el elemento caiga al respaldo por colores.
 */
export function leerTituloCatalogo(titulo: string): TituloCatalogoBase | undefined {
  const texto = plegar(titulo).replace(/[^a-z0-9\- ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/\bglobos?\b/.test(texto)) return undefined;
  const forma = FORMAS_TITULO.find(([patron]) => patron.test(texto))?.[1] ?? "round";
  const foil = /\bmetalizad[oa]s?\b|\bfoil\b/.test(texto) && !/\blatex\b/.test(texto);
  const familia = FAMILIAS_TITULO.find((candidata) => new RegExp(`\\b${candidata}\\b`).test(texto));
  const acabado = foil ? "shiny metallic" : acabadoVisible(familia);
  const quitar = new RegExp(`\\b(?:b2b|b2c|globos?|latex|foil|${FAMILIAS_TITULO.join("|")}|redond[oa]s?|corazon(?:es)?|estrellas?|link|link-o-loon|modelar|moldeable|numeros?|r-?\\d+|\\d+|x|paquete|pulgadas?|in)\\b`, "g");
  const restoColor = texto.replace(quitar, " ").replace(/\s+/g, " ").trim();
  return { forma, material: foil ? "foil" : "latex", acabado, restoColor };
}

/** Términos base de un título leído y su color ya en inglés (lo traduce quien llama, con `translateLoraColor`). */
export function terminosBaseDeTitulo(leido: TituloCatalogoBase, colorIngles: string): TerminosBase | undefined {
  const color = colorVisible(colorIngles);
  const noun = leido.forma ? SUSTANTIVO_POR_FORMA[leido.forma]?.[leido.material] : undefined;
  if (!color || !noun) return undefined;
  return { kind: "balloon", finish: sinAcabadoEnColor(leido.acabado, color), color, noun };
}

/**
 * Escala relativa de un diámetro. El modelo base no tiene un patrón para «12-inch»: sabe qué es un globo
 * pequeño, mediano o gigante. Por eso el caption dice las dos cosas, la pulgada que el plan cotiza y la
 * palabra de escala que el modelo sí dibuja. Los cortes siguen los anclajes de `tamano-fisico.ts`
 * (5" un puño, 9"-12" una cabeza, 18" un balón de playa, 24" mayor que eso, 36" a la cintura de un adulto).
 */
export function escalaRelativa(pulgadas: number): string {
  if (pulgadas <= 7) return "small";
  if (pulgadas <= 13) return "medium";
  if (pulgadas <= 20) return "large";
  if (pulgadas <= 30) return "extra-large";
  return "giant";
}

function pulgadasDe(talla: string): number {
  const match = talla.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

/**
 * «mixed small 5-inch, medium 12-inch and large 18-inch»: pulgada y escala de cada talla confirmada. La
 * palabra de escala solo se repite cuando cambia («medium 9-inch, 12-inch»). En modo `range` quedan los
 * extremos. Sin tallas confirmadas no se dice nada: la talla nunca se inventa.
 */
export function fraseTallasBase(tallas: readonly string[], modo: "all" | "range" | "none"): string {
  if (modo === "none") return "";
  const diametros = [...new Set(tallas.map(pulgadasDe).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!diametros.length) return "";
  const elegidos = modo === "range" && diametros.length > 2 ? [diametros[0]!, diametros[diametros.length - 1]!] : diametros;
  let anterior = "";
  const partes = elegidos.map((pulgadas) => {
    const escala = escalaRelativa(pulgadas);
    const texto = escala === anterior ? `${pulgadas}-inch` : `${escala} ${pulgadas}-inch`;
    anterior = escala;
    return texto;
  });
  const lista = modo === "range" && diametros.length > 2 ? `${partes[0]} to ${partes[1]}` : unirNatural(partes);
  return diametros.length > 1 ? `mixed ${lista}` : lista;
}

function unirNatural(valores: readonly string[]): string {
  if (valores.length <= 1) return valores[0] ?? "";
  if (valores.length === 2) return `${valores[0]} and ${valores[1]}`;
  return `${valores.slice(0, -1).join(", ")} and ${valores[valores.length - 1]}`;
}

/**
 * Estructuras en inglés llano para el modelo base. Son los nombres con los que un catálogo o una galería de
 * decoración describen la pieza («balloon arch», «balloon column»), que es donde un modelo general las vio.
 * Se prefiere el `sustantivoEn` de la estructura oficial cuando el plan la declara: ya es inglés llano.
 */
export const SUSTANTIVOS_ESTRUCTURA_BASE = {
  arco: "organic balloon arch",
  // «half-arch» es jerga y un modelo general lo cierra en un arco entero; lo que se ve es una guirnalda
  // que sube por un lado y se curva.
  semiarco: "one-sided curved balloon garland",
  guirnalda: "organic balloon garland",
  columna: "balloon column",
  bouquet: "balloon bouquet",
  pared: "balloon wall",
  centro_mesa: "small balloon centerpiece",
  backdrop: "decorated backdrop",
  kit: "balloon decoration",
  accesorio: "decorative accent piece",
  escultura: "balloon sculpture",
} as const;

/**
 * Ubicaciones en palabras llanas de un sitio real. Sin «stage photo area» ni «approved»: el primero es jerga
 * de producción y el segundo una palabra de proceso que el modelo no puede dibujar. «main table», «rear
 * wall» y «ceiling» se mantienen literales porque el preflight comprueba con ellas el anclaje físico.
 */
export const UBICACIONES_BASE = {
  entrada: "framing the entrance doorway",
  arco_central: "as the centerpiece of the scene",
  sobre_mesa_principal: "on the main table",
  lateral_izquierdo: "standing on the left side",
  lateral_derecho: "standing on the right side",
  fondo_pared: "against the rear wall",
  piso_frontal: "resting on the floor in the foreground",
  mesas_invitados: "on the guest tables",
  techo: "hanging from the ceiling",
  zona_central: "in the middle of the room",
  fachada: "on the building facade",
  pared_lateral: "against the side wall",
  alrededor_mobiliario: "around the existing furniture",
  vegetacion: "among the existing greenery",
  techo_multipunto: "hanging from several points on the ceiling",
  recorrido_suelo: "running along the floor as a path",
  esquina: "in the corner of the room",
} as const;

/**
 * Cierre fotográfico para un modelo general. Las palabras de cámara y luz («professional event photograph»,
 * «natural reflections») son las que más mueven a un modelo base hacia una foto realista; «realistic latex
 * balloons» evita el globo de dibujo animado o de render 3D liso. Ninguna es un sustantivo que se pueda
 * escribir en la imagen (nada de «sign», «caption», «label» ni comillas).
 */
export const CIERRE_FOTOGRAFICO_BASE = "professional event photograph, realistic latex balloons with natural reflections, sharp detail";
