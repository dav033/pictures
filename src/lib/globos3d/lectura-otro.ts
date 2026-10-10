/**
 * Qué hacer con una pieza leída como `otro` (lo que el lector no supo tipar). Determinista, por la descripción, y de alta precisión:
 * ante la duda, `pendiente`.
 * - `catalogo`: el taller la tiene con otro nombre: solo si su SUSTANTIVO PRINCIPAL lo dice con exactitud («mesa de postres», «mesa
 *   alta», «mesa de regalos», «pedestales», «marco de tela», «escalera decorativa», «cortina de luces», «silla tapizada», «mesa auxiliar
 *   de metal dorado», «jarrón con pampas», «pared de lentejuelas», «tapete redondo»). Un estante, unos cupcakes, unos dulces o unas cajas
 *   de regalo NO son una mesa ni un carrito: describen lo que hay encima o cerca. Un material suelto tampoco es la pieza: unas lentejuelas
 *   son la pared solo si lo dice («de fondo», «en la pared»), un tapete es el redondo del catálogo solo si dice su forma o el piso (no
 *   uno cuadrado, ni uno de bienvenida con letras, ni uno de color sobre la mesa), y un pedestal solo no es el juego de tres del catálogo (azul, blanco y dorado).
 * - `escenografia`: fondo de la foto sin pieza (ventanales, césped, deck, cerca, cielo, florero): no es capacidad que falte. Solo si TODO
 *   lo que dice es fondo («ventanales y césped», «pared de ladrillo blanca»); lo que lleva puesto cuenta («pared con mariposas de papel»,
 *   «piso con tapete»), y un «muro de globos» o una «pared de flores» no son fondo. Un florero es fondo con sus flores y sus ramas, no
 *   con globos. Si después del fondo nombra una pieza del catálogo («pared blanca, mesa de postres a la izquierda», «ventanales, césped y
 *   una mesa de regalos»), es esa pieza.
 * - `pendiente`: el taller no la sabe armar (mariposas, flores de papel, muñecos, globos sueltos…): capacidad que falta.
 * El sustantivo principal es la primera palabra del tramo antes de la primera coma, dos puntos o preposición («cupcakes» en «cupcakes
 * sobre el pedestal»). Una descripción que EMPIEZA con una preposición («sobre el pedestal, un pastel») no nombra la pieza.
 * Además de qué es, devuelve el lado y la profundidad que nombra («a la izquierda», «al fondo») y cuántas dice («dos mesas»).
 */

export type LadoOtro = -1 | 0 | 1;
export type PistaOtro = { lado: LadoOtro; profundidad: "fondo" | "delante" | null; cantidad: number };
export type ResolucionOtro = ({ tipo: "catalogo"; id: string } & PistaOtro) | { tipo: "escenografia" } | { tipo: "pendiente" };
type Clase = { tipo: "catalogo"; id: string } | { tipo: "escenografia" } | { tipo: "pendiente" };

const PENDIENTE: Clase = { tipo: "pendiente" };
const ESCENOGRAFIA: Clase = { tipo: "escenografia" };

/** Sin acentos ni mayúsculas, para comparar. */
const normal = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const NUMEROS: Readonly<Record<string, number>> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
/** Lo que ya es un juego (tres pedestales, tres mesas nido): «tres» no son tres juegos. */
const JUEGOS = new Set(["pedestales", "mesas_nido_hexagonales"]);
const DETERMINANTES = /^(?:(?:el|la|los|las|un|una|unos|unas|dos|tres|cuatro|cinco|seis|\d+)\s+)+/;
const ADJETIVO_ANTES = /^(?:peque[nñ][oa]s?|gran|grandes?)\s+/;
const PREPOSICION_INICIAL = /^(?:sobre|encima|en|dentro|detras|tras|bajo|delante|cerca|al|a|por|junto|entre|hacia|con|sin|de|del)\b/;
/** Donde acaba el nombre: coma, dos puntos, punto y coma o paréntesis. */
const FIN_DE_CLAUSULA = /[,:;(]/;
/** Las preposiciones de lugar o de compañía que cortan el nombre («cerca de listones» es una cerca, «cerca de la mesa» es un lugar). */
const LUGARES = "sobre|encima|en|dentro|detras|tras|bajo|delante|al|a|por|junto|entre|colgad[oa]s?|pegad[oa]s?|hacia|que|sin|cerca (?:del|de (?:la|el|los|las))";
const FIN_DE_LUGAR = new RegExp(`\\s(?:${LUGARES})\\b`);
const FIN_DE_NOMBRE = new RegExp(`\\s(?:con|${LUGARES})\\b`);

/** Lo que un fondo de foto puede ser (la primera palabra) y las palabras que lo acompañan sin dejar de ser fondo. */
const FONDO = /^(?:ventanal(?:es)?|ventanas?|puertas?|persianas?|cesped|pasto|deck|cercas?|casas?|cielo|fachada|jardin|patio|plantas?|arbustos?|hierbas?|floreros?|pared(?:es)?|muros?|piso|suelo|iluminacion)$/;
const ACOMPANA_FONDO = /^(?:y|e|o|u|de|del|la|el|los|las|fondo|madera|vidrio|cristal|ladrillos?|piedra|concreto|cemento|yeso|listones|tablones|(?:blanc|negr|gris|verd|dorad|platead|rosad|morad|amarill|naranj|roj|clar|oscur|alt|baj|grand|larg|anch|pequen)[oa]s?|verdes?|grandes?|azul(?:es)?|cafe|marron|beige|crema|lila|rosa|natural(?:es)?)$/;
/** Una superficie: lo que importa es lo que lleva («pared de lentejuelas», «piso con tapete»). */
const SUPERFICIE = /^(?:pared(?:es)?|muros?|piso|suelo)$/;
/** Lo que un florero lleva sin dejar de ser fondo (el arreglo entero). */
const VEGETAL = /^(?:flor(?:es)?|ramas?|ramitas?|plantas?|hojas?|follaje|tallos?|rosas?|lavanda|eucalipto|hierbas?|espigas?)$/;
/** Un tapete o una alfombra con letras o un mensaje (el de bienvenida) no es la pieza redonda del catálogo. */
const CON_LETRAS = /\b(?:bienvenida|welcome|letras?|texto|frase|mensaje|logo|nombre)\b|«/;
/** Una forma que no es la redonda del catálogo. */
const NO_REDONDO = /\b(?:cuadrad[oa]s?|rectangular(?:es)?|ovalad[oa]s?|alargad[oa]s?)\b/;

const palabrasDe = (texto: string) => texto.split(/[\s-]+/).filter(Boolean);
const escenografiaPura = (nombre: string) => {
  const palabras = palabrasDe(nombre);
  return palabras.length > 0 && FONDO.test(palabras[0]!) && palabras.every((w) => FONDO.test(w) || ACOMPANA_FONDO.test(w));
};

/**
 * El nombre de la pieza: `cabeza` (hasta la primera preposición, «con» incluido), `util` (hasta la primera de lugar: conserva el «con»)
 * y `clausula` (hasta la primera coma: lo que dice de ella y dónde está).
 */
function nombreDe(texto: string): { cabeza: string; util: string; clausula: string } | null {
  const clausula = (texto.split(FIN_DE_CLAUSULA)[0] ?? texto).trim().replace(DETERMINANTES, "").replace(ADJETIVO_ANTES, "");
  if (!clausula || PREPOSICION_INICIAL.test(clausula)) return null;
  return { cabeza: (clausula.split(FIN_DE_NOMBRE)[0] ?? clausula).trim(), util: (clausula.split(FIN_DE_LUGAR)[0] ?? clausula).trim(), clausula };
}

/** El id del catálogo que nombra el sustantivo principal con exactitud, o null. `completa` es toda la descripción (o el fondo que lo lleva). */
function idDelCatalogo({ cabeza, util, clausula }: { cabeza: string; util: string; clausula: string }, completa: string): string | null {
  const primera = palabrasDe(cabeza)[0] ?? "";
  const dice = (re: RegExp, donde = cabeza) => re.test(donde);
  switch (primera) {
    case "mesa": case "mesas":
      if (dice(/\bpostres?\b/)) return "mesa_postres";
      if (dice(/\bregalos?\b/)) return "mesa_regalos";
      if (dice(/^mesas? altas?\b|\b(?:coctel|cocktail)\b/)) return "mesa_coctel";
      if (dice(/\bnido\b/)) return "mesas_nido_hexagonales";
      if (dice(/\bhexagonal(?:es)?\b/)) return "mesa_hexagonal";
      return dice(/\b(?:auxiliar(?:es)?|redondas?)\b/) && dice(/\b(?:alambre|metal)\b/) && dice(/\bdorad[oa]s?\b/) ? "mesa_hexagonal" : null;
    case "pedestales": return "pedestales";
    case "marco": case "marcos": case "bastidor": case "bastidores": return dice(/\b(?:de|con) tela\b/, util) && !dice(/\b(?:redond[oa]s?|circular(?:es)?|ovalad[oa]s?|hexagonal(?:es)?)\b/, util) ? "marco_tela" : null;
    case "escalera": case "escaleras": return dice(/\bdecorativ[oa]s?\b/) ? "escalera_decorativa" : null;
    case "cortina": case "cortinas": return dice(/\bluces\b/, util) ? "cortina_luces" : dice(/\b(?:flecos?|franjas?)\b/, util) ? "cortina_flecos" : null;
    case "carrito": case "carritos": return dice(/\bdulces\b/, util) ? "carrito_dulces" : null;
    case "alfombra": case "alfombras": return dice(/\bredond[oa]s?\b/) && !CON_LETRAS.test(completa) ? "alfombra_redonda" : null;
    case "silla": case "sillas": return dice(/\btapiz/) ? "silla_moderna" : null;
    case "jarron": case "jarrones": case "florero": case "floreros": return /\bpampas?\b/.test(completa) ? "jarron_pampas" : null;
    case "panel": case "paneles": return dice(/\bde lentejuelas\b/) ? "lentejuelas" : null;
    case "lentejuelas": return dice(/\b(?:pared(?:es)?|panel(?:es)?|muros?|telon(?:es)?)\b/, util) || /^(?:pared(?:es)?|muros?)\b/.test(completa) || /\b(?:en|de) (?:la )?pared\b|\b(?:de|como) fondo\b/.test(clausula) ? "lentejuelas" : null;
    case "tapete": case "tapetes":
      if (CON_LETRAS.test(completa) || dice(NO_REDONDO, util)) return null;
      // Su forma o el piso; un color solo no (un «tapete beige sobre la mesa» es un camino de mesa, no el tapete del piso).
      return dice(/\b(?:redond[oa]s?|circular(?:es)?)\b/, util) || /\b(?:piso|suelo)\b/.test(completa) ? "tapete_redondo" : null;
    default: return null;
  }
}

/** Lo que lleva el florero, todo vegetal («con flores y ramas»): sigue siendo el arreglo entero, sin pieza que falte. */
const soloVegetal = (llevados: readonly string[]) =>
  llevados.flatMap((c) => c.split(/\s+(?:y|e)\s+/)).every((c) => VEGETAL.test(palabrasDe(c.replace(DETERMINANTES, ""))[0] ?? ""));

/** Un fondo de foto (pared, piso, ventanales…) y lo que lleva puesto («con tapete»): solo es fondo si todo lo que dice lo es. */
function clasificarFondo(util: string): Clase {
  const [propia = "", ...llevados] = util.split(/\s+con\s+/);
  if (SUPERFICIE.test(palabrasDe(propia)[0] ?? "")) {
    const lleva = /^\S+\s+de\s+(.+)$/.exec(propia)?.[1];
    const interno = lleva ? clasificar(lleva, util) : PENDIENTE;
    if (interno.tipo === "catalogo") return interno;
  }
  if (!escenografiaPura(propia)) return PENDIENTE;
  // Un florero es el arreglo entero (con su planta, sus flores y sus ramas): no es una pieza que falte. Con globos, sí.
  if (/^floreros?$/.test(palabrasDe(propia)[0] ?? "") && soloVegetal(llevados)) return ESCENOGRAFIA;
  for (const c of llevados) {
    const r = clasificar(c, util);
    if (r.tipo === "catalogo") return r;
    if (r.tipo !== "escenografia") return PENDIENTE;
  }
  return ESCENOGRAFIA;
}

/** Lo que es el nombre principal de un tramo. `contexto` es de dónde sale (toda la descripción, o el fondo que lo lleva). */
function clasificar(texto: string, contexto = texto): Clase {
  const nombre = nombreDe(texto);
  if (!nombre) return PENDIENTE;
  const id = idDelCatalogo(nombre, contexto);
  if (id) return { tipo: "catalogo", id };
  return FONDO.test(palabrasDe(nombre.cabeza)[0] ?? "") ? clasificarFondo(nombre.util) : PENDIENTE;
}

/**
 * Lo que nombra una descripción además de su principio: cada cláusula (tras una coma, dos puntos o punto y coma) y cada elemento de
 * una lista con «y». Una cláusula que empieza con preposición dice dónde está algo y no nombra una pieza («sin piezas…», «a la izquierda
 * de la mesa»), salvo «con», que dice lo que hay («con una mesa de regalos delante»).
 */
function elementosDe(texto: string): string[] {
  return texto.split(FIN_DE_CLAUSULA).flatMap((parte) => {
    const clausula = parte.trim().replace(/^(?:y|e)\s+/, "").replace(/^con\s+/, "");
    return !clausula || PREPOSICION_INICIAL.test(clausula) ? [] : clausula.split(/\s+(?:y|e)\s+/);
  });
}

/** Una descripción que empieza por un fondo de la foto y nombra después una pieza del catálogo es esa pieza; si no, lo que dice su principio. */
function clasificarDescripcion(texto: string): Clase {
  const principio = clasificar(texto);
  const nombre = nombreDe(texto);
  if (principio.tipo === "catalogo" || !nombre || !FONDO.test(palabrasDe(nombre.cabeza)[0] ?? "")) return principio;
  for (const elemento of elementosDe(texto)) {
    const r = clasificar(elemento);
    if (r.tipo === "catalogo") return r;
  }
  return principio;
}

/** Lado, profundidad y cantidad que dice la descripción entera: solo lo que dice de DÓNDE está la pieza («a la izquierda», «al fondo»), no lo que describe de otra cosa («la columna derecha»). */
function pistaDe(completa: string, id: string): PistaOtro {
  const ladoDicho = (lado: string) => new RegExp(`\\b(?:a|hacia|en) la ${lado}\\b|\\b(?:esquina|lado|borde|costado)(?:\\s+(?:inferior|superior))?\\s+${lado.slice(0, -1)}[oa]\\b`).test(completa);
  const izquierda = ladoDicho("izquierda"), derecha = ladoDicho("derecha");
  const fondo = /\b(?:al|del|en el) fondo\b|\b(?:detras|tras) (?:de|del)\b/.test(completa);
  const delante = /\bdelante\b|\bal frente\b|\bfrente a(?:l)?\b|\benfrente\b/.test(completa);
  const primera = completa.replace(/^(?:el|la|los|las)\s+/, "").split(/\s/)[0] ?? "";
  return {
    lado: izquierda === derecha ? 0 : izquierda ? -1 : 1,
    profundidad: fondo === delante ? null : fondo ? "fondo" : "delante",
    cantidad: JUEGOS.has(id) ? 1 : NUMEROS[primera] ?? (/^\d+$/.test(primera) ? Number(primera) : 1),
  };
}

export function resolverOtro(descripcion: string): ResolucionOtro {
  const texto = normal(descripcion);
  const r = clasificarDescripcion(texto);
  return r.tipo === "catalogo" ? { ...r, ...pistaDe(texto, r.id) } : r;
}
