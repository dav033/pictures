/**
 * Figuras y adornos que el taller SÍ arma, leídos como `otro` (el lector no tiene tipo para ellos): se reconocen por su descripción y se
 * arman con piezas que ya existen (la biblioteca de decoraciones y las formas rellenas de la IA de escena), no con geometría nueva.
 * Determinista y de alta precisión (como `lectura-otro.ts`): la descripción ENTERA tiene que ser lo que se reconoce, palabra por palabra
 * (un nombre, sus colores, su tamaño y su lugar); si dice otra cosa («calabazas con arañas», «número 5 con un oso de peluche al lado»), un
 * color que no es de la figura («calabaza sobre piso negro») o una palabra que no se conoce, no se arma a medias: queda como `otro`
 * pendiente («No pude: …»).
 * - calabazas → `calabaza_grande`, o `calabaza_bruja` si lleva sombrero (la de la foto puede ser inflable: se arma de globos); no si son de
 *   foil o metálicas (la tienda las vende: son otro producto), ni si cuelgan o van pegadas a la pared;
 * - espirales, volutas, rizos, tirabuzones y resortes → `rizo_voluta`, `rizo_tirabuzon` o `rizo_resorte`, sobre la estructura;
 * - flores «de globos» (o de un formato R-n) → `flor5`, sobre la estructura;
 * - un número o una letra RELLENOS de globos («número 5 de caja tipo mosaico, lleno de globos rosa y verde con flores de tela») → la forma
 *   rellena de su texto; varios números juntos («números 1 y 5») son varias formas. Lo que lleva encima (flores, cintas) y su soporte
 *   (caja, cartón) no se arman: lo dice la nota de quien los arma (`figuras-lectura.ts`). Un número «de globos metálicos» o «de foil» es el
 *   globo de foil de la tienda, no esto.
 * No son figuras: los globos de foil con forma (mariposa, murciélago, gato), que la tienda no vende; los muñecos de peluche, los adornos de
 * papel o de cartón, las flores de tela o naturales y las plantas.
 */

export type FiguraOtro =
  | { clase: "decoracion"; id: string; cantidad: number; /** La descripción solo dice el plural: «varias» (`VARIAS`), no una cuenta. */ cantidadSupuesta: boolean; colores: string[]; sobreEstructura: boolean }
  | { clase: "texto"; texto: string; colores: string[]; gigante: boolean };

export const NUMEROS: Readonly<Record<string, number>> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
export const DETERMINANTES = /^(?:(?:el|la|los|las|un|una|unos|unas|dos|tres|cuatro|cinco|seis|\d+)\s+)+/;

/** Cuántas son cuando la descripción dice solo el plural («calabazas», «espirales»). */
export const VARIAS = 3;
const MAXIMO_COPIAS = 6;
/** Alto (cm) de un número o una letra rellenos de globos: el de siempre, y el de uno «gigante»; la descripción no lo mide. */
export const ALTO_RELLENO_CM = 120;
export const ALTO_RELLENO_GIGANTE_CM = 150;

// ----------------------------------------------------------------------------------------------------------
// Vocabulario: lo único que puede decir una descripción para armarse
// ----------------------------------------------------------------------------------------------------------

/** Los colores que se dicen en un tramo, por su nombre y en el orden en que aparecen, sin repetir. */
const COLOR_DICHO = /\b(?:rosad[oa]s?|rosas?|malvas?|lilas?|morad[oa]s?|violetas?|verdes?(?: (?:menta|salvia|oliva|limon))?|salvia|menta|durazno|blanc[oa]s?|dorad[oa]s?|platead[oa]s?|negr[oa]s?|roj[oa]s?|azul(?:es)?(?: (?:marino|rey|cielo))?|amarill[oa]s?|naranjas?|cremas?|beiges?|vinos?|fucsias?|turquesas?|celestes?|gris(?:es)?|cafes?|marrones?|champan|corales?|nudes?|blush|lavandas?|terracotas?)\b/g;
const COLOR_SOLO = new RegExp(`^(?:${COLOR_DICHO.source})$`);
const COLOR_CON_GENERO = /^(rosad|morad|blanc|dorad|platead|negr|roj|amarill)[oa]s?$/;
const SINGULARES: Readonly<Record<string, string>> = { verdes: "verde", azules: "azul", grises: "gris", marrones: "marron", corales: "coral", beiges: "beige", nudes: "nude", celestes: "celeste", cafes: "cafe" };
/** El nombre en singular y masculino que entiende la tabla de colores («doradas» → «dorado», «rosas» → «rosa», «verdes menta» → «verde menta»). */
function nombreDeColor(color: string): string {
  const [primera = "", ...resto] = color.split(" ");
  const singular = SINGULARES[primera] ?? (COLOR_CON_GENERO.test(primera) ? primera.replace(COLOR_CON_GENERO, "$1o") : primera.replace(/(a|o)s$/, "$1"));
  return [singular, ...resto].join(" ");
}

export function coloresDichos(tramo: string): string[] {
  return [...new Set((tramo.match(COLOR_DICHO) ?? []).map(nombreDeColor))];
}

const palabras = (texto: string) => texto.match(/[a-z0-9ñ]+/g) ?? [];
const conjunto = (texto: string | readonly string[]): ReadonlySet<string> => new Set((typeof texto === "string" ? texto : texto.join(" ")).split(/\s+/));

/** Conectores, lugar, estado, tamaño y acabado: lo que una descripción dice de cualquier figura sin nombrar otra cosa. */
const NEUTRAS = conjunto([
  "el la los las un una unos unas y e o u de del al a en con sin sobre entre por para que como tipo cada mas muy ya se r color colores tono tonos",
  "dos tres cuatro cinco seis",
  "izquierda derecha centro fondo frente delante detras arriba abajo lado lados ambos esquina borde piso suelo pared muro techo junto cerca alrededor encima debajo atras adelante afuera adentro lateral laterales",
  "pegado pegados pegada pegadas apoyado apoyados apoyada apoyadas colgado colgados colgada colgadas colgando puesto puestos puesta puestas parado parados parada paradas visible visibles cortado cortados cortada cortadas",
  "grande grandes pequeno pequenos pequena pequenas gigante gigantes mediano medianos chico chicos inflable inflables metalico metalicos metalica metalicas brillante brillantes liso lisa lisos lisas mate pastel cromado cromados cromada cromadas perla cristal transparente transparentes foil latex globo globos globito globitos",
  "menta marino rey cielo oliva limon",
]);

/** ¿Todo lo que dice el texto es del vocabulario de la figura (neutras, colores, números y las palabras propias de ella)? */
function soloDiceLoConocido(texto: string, propias: ReadonlySet<string>): boolean {
  return palabras(texto).every((p) => /^\d+$/.test(p) || NEUTRAS.has(p) || propias.has(p) || COLOR_SOLO.test(p));
}

// ----------------------------------------------------------------------------------------------------------
// Decoraciones de la biblioteca
// ----------------------------------------------------------------------------------------------------------

type ReglaDecoracion = { id: string; nombre: RegExp; contexto?: RegExp; excluye?: RegExp; propias: ReadonlySet<string>; sobreEstructura: boolean; /** Toma el color que dice la descripción: la calabaza no (tiene el suyo, naranja con tubitos verdes). */ conColor: boolean };

/** Lo que dice que lo descrito NO es de globos (papel, tela, peluche, plantas…): la biblioteca no lo arma, queda pendiente. */
const NO_ES_DE_GLOBOS = /\b(?:papel|carton|tela|peluche|madera|ceramica|plastico|naturales?|reales?|artificiales?|secas?)\b/;
/** Donde acaba lo que se dice de la figura misma y empieza lo que se dice de otra cosa (su lugar, lo que lleva o con lo que está). */
const FIN_DEL_NOMBRE = /\b(?:con|sin|sobre|en|entre|junto|frente|detras|delante|encima|alrededor|pegad[oa]s?|colgad[oa]s?|apoyad[oa]s?|a|al|piso|suelo|pared|muro|techo|borde|esquina|lado|lados)\b/;
/** Otra cosa que se suma («y globos negros», «con globos»): no es la figura. */
const SE_SUMA_GLOBOS = /(?:,\s*|\b(?:y|e|con)\s+(?:los |las |unos |unas )?)(?:globos?|globitos?)\b/;
/** Calabazas de foil o metálicas son otro producto de la tienda; colgadas o pegadas, no van en el piso. */
const CALABAZA_DE_OTRO_MODO = /\b(?:foil|metalizad\w*|metalic\w*|cromad\w*|colgad\w*|colgando|techo|pegad\w*|arriba|en la pared)\b/;
const COLGADA = /\b(?:techo|colgad\w*|colgando)\b/;
const PALABRAS_DE_CALABAZA = conjunto("halloween jack lantern cara");
const PALABRAS_DE_RIZO = conjunto("cinta cintas rizada rizadas enrollada enrolladas guirnalda guirnaldas arco arcos columna columnas estructura aro marco");
const PALABRAS_DE_FLOR = conjunto("guirnalda guirnaldas arco arcos columna columnas estructura aro marco");

const REGLAS_DECORACION: readonly ReglaDecoracion[] = [
  { id: "calabaza_bruja", nombre: /calabazas?/, contexto: /\b(?:sombrero|bruja)\b/, excluye: CALABAZA_DE_OTRO_MODO, propias: new Set([...PALABRAS_DE_CALABAZA, "sombrero", "bruja"]), sobreEstructura: false, conColor: false },
  { id: "calabaza_grande", nombre: /calabazas?/, excluye: CALABAZA_DE_OTRO_MODO, propias: PALABRAS_DE_CALABAZA, sobreEstructura: false, conColor: false },
  { id: "rizo_voluta", nombre: /(?:espirales?|volutas?)/, excluye: COLGADA, propias: PALABRAS_DE_RIZO, sobreEstructura: true, conColor: true },
  { id: "rizo_tirabuzon", nombre: /(?:rizos?|tirabuzon(?:es)?)/, excluye: COLGADA, propias: PALABRAS_DE_RIZO, sobreEstructura: true, conColor: true },
  { id: "rizo_resorte", nombre: /resortes?/, excluye: COLGADA, propias: PALABRAS_DE_RIZO, sobreEstructura: true, conColor: true },
  { id: "flor5", nombre: /flores?/, contexto: /\bde (?:globos?|globitos?)\b|\br-?\d+\b/, excluye: COLGADA, propias: PALABRAS_DE_FLOR, sobreEstructura: true, conColor: true },
];

const ADJETIVO = "(?:(?:grandes?|pequen[oa]s?|gigantes?|inflables?)\\s+)?";

function cantidadDe(segmento: string, completa: string, plural: boolean): { cantidad: number; supuesta: boolean } {
  const primera = segmento.replace(/^(?:el|la|los|las|unos|unas)\s+/, "").split(/\s/)[0] ?? "";
  const dicha = NUMEROS[primera] ?? (/^\d+$/.test(primera) ? Number(primera) : undefined);
  if (dicha !== undefined) return { cantidad: Math.max(1, Math.min(MAXIMO_COPIAS, dicha)), supuesta: false };
  if (/\bambos lados\b/.test(completa)) return { cantidad: 2, supuesta: false };
  return plural ? { cantidad: VARIAS, supuesta: true } : { cantidad: 1, supuesta: false };
}

function decoracionDe(segmento: string, completa: string): FiguraOtro | null {
  const sinDeterminante = segmento.replace(DETERMINANTES, "");
  for (const regla of REGLAS_DECORACION) {
    const encaja = new RegExp(`^${ADJETIVO}(${regla.nombre.source})\\b`).exec(sinDeterminante);
    if (!encaja || (regla.contexto && !regla.contexto.test(segmento))) continue;
    if (NO_ES_DE_GLOBOS.test(segmento) || regla.excluye?.test(segmento) || SE_SUMA_GLOBOS.test(segmento) || !soloDiceLoConocido(sinDeterminante.slice(encaja[0].length), regla.propias)) return null;
    // Los colores son los del nombre de la figura: uno que viene después de su lugar o de lo que lleva («sobre piso negro», «con rosas») es de otra cosa.
    const propio = segmento.split(FIN_DEL_NOMBRE)[0] ?? segmento;
    if (coloresDichos(segmento.slice(propio.length)).length) return null;
    const { cantidad, supuesta } = cantidadDe(segmento, completa, /s$/.test(encaja[1]!));
    return { clase: "decoracion", id: regla.id, cantidad, cantidadSupuesta: supuesta, colores: regla.conColor ? coloresDichos(propio) : [], sobreEstructura: regla.sobreEstructura };
  }
  return null;
}

// ----------------------------------------------------------------------------------------------------------
// Un número o una letra rellenos de globos
// ----------------------------------------------------------------------------------------------------------

const CABEZAS = /\b(numeros?|letras?)\b/g;
/** «número 5», «número gigante «1»», «números 1 y 5»: el número y los que siguen en su lista. */
const LISTA_DE_NUMEROS = /\bnumeros?\s+(?:(?:gigantes?|grandes?)\s+)?[«"]?\d{1,2}\b[»"]?(?:\s*(?:,|y|e)\s*(?:numeros?\s+)?[«"]?\d{1,2}\b[»"]?)*/g;
/** Una letra («letra A de caja»): no una «a» que es un conector («letra a la izquierda»). */
const UNA_LETRA = /\bletras?\s+(?:(?:gigantes?|grandes?)\s+)?[«"]?([a-z])[»"]?(?=\s+(?:de|gigante|grande|llen|rellen|hech)|[,;.)]|$)/g;
const LLENO = /\b(?:re)?llen[oa]s?\b/;
/** Lleno o relleno de globos, o el número (o la letra) «de globos» a secas: un número rodeado de globos («junto a la guirnalda de globos») no es esto. */
const RELLENO_DE_GLOBOS = /\b(?:re)?llen[oa]s?\b[^,;]*\bglobos\b|\b(?:numero|letra)\s+(?:(?:gigante|grande)s?\s+)?[«"]?(?:\d{1,2}|[a-z])[»"]?\s+(?:(?:gigante|grande)s?\s+)?(?:hech[oa]\s+)?de globos\b/;
/** Un número «de globos metálicos» o «de foil» es el globo de foil de la tienda (salvo que esté «lleno de» globos metálicos). */
const DE_FOIL = /\b(?:foil|metalic\w*|metalizad\w*)\b/;
/** Lo que acaba la lista de colores de los globos de un relleno: lo que lleva encima (flores, cintas), su lugar o su soporte («lleno de globos rosa y verde con flores de tela»). */
const FIN_DE_LOS_COLORES = /\b(?:con|sin|flores?|cintas?|mo[nñ]os?|lazos?|de|sobre|en|entre|junto|frente|detras|delante|apoyad[oa]s?|a|al)\b/;
/** Lo propio de un número relleno: su soporte (caja, cartón, mosaico), «relleno» y lo que lleva encima (flores, cintas, moños). */
const PALABRAS_DE_RELLENO = conjunto("numero numeros letra letras caja cajas carton madera mosaico marco base estructura lleno llena llenos llenas relleno rellena rellenos rellenas hecho hecha flor flores cinta cintas mono monos lazo lazos tela papel");

/** «número 5 de caja tipo mosaico, lleno de globos verde y rosa»: los números (o la letra) y los colores de los globos. */
function textoRelleno(texto: string): FiguraOtro[] | null {
  const cabezas = new Set([...texto.matchAll(CABEZAS)].map((m) => (m[1]!.startsWith("numero") ? "numero" : "letra")));
  if (cabezas.size !== 1 || !RELLENO_DE_GLOBOS.test(texto) || !soloDiceLoConocido(texto, PALABRAS_DE_RELLENO)) return null;
  if (DE_FOIL.test(texto) && !LLENO.test(texto)) return null;
  const esNumero = cabezas.has("numero");
  const valores = esNumero ? [...texto.matchAll(LISTA_DE_NUMEROS)].flatMap((m) => m[0].match(/\d{1,2}/g) ?? []) : [...texto.matchAll(UNA_LETRA)].map((m) => m[1]!.toUpperCase());
  // Todo número que dice la descripción tiene que haberse leído (un «5» que no se leyó es algo que se dejaría caer), y una letra es una.
  const cifras = palabras(texto.replace(/\br-?\d+\b/g, " ")).filter((p) => /^\d+$/.test(p)).length;
  if (!valores.length || (esNumero ? cifras !== valores.length : cifras > 0 || valores.length !== 1)) return null;
  const tramo = texto.split(/\bglobos?\b/).slice(1).join(" ").split(FIN_DE_LOS_COLORES)[0] ?? "";
  return valores.map((valor): FiguraOtro => ({ clase: "texto", texto: valor, colores: coloresDichos(tramo), gigante: /\bgigantes?\b/.test(texto) }));
}

/** Parte la lista «espirales … y flores …» donde un «y» abre otra figura; un «y» entre colores («rosa y verde») no la parte. */
const ABRE_OTRA_FIGURA = /\s+(?:y|e)\s+(?=(?:(?:las|los|unas|unos|un|una|dos|tres|cuatro|cinco|seis|\d+)\s+)?(?:flores?|rizos?|espirales?|volutas?|tirabuzon(?:es)?|resortes?|calabazas?)\b)/;

/**
 * Las figuras que dice una descripción (sin acentos ni mayúsculas), o `null` si algo de lo que dice no se reconoce: una descripción
 * a medias no se arma a medias, queda entera como pendiente.
 */
export function figurasDeOtro(texto: string): FiguraOtro[] | null {
  const relleno = textoRelleno(texto);
  if (relleno) return relleno;
  const figuras: FiguraOtro[] = [];
  for (const segmento of texto.split(ABRE_OTRA_FIGURA)) {
    const figura = decoracionDe(segmento.trim(), texto);
    if (!figura) return null;
    figuras.push(figura);
  }
  return figuras;
}
