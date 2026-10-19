/**
 * Familias de estructura con que el arnés compara lo que la foto pide con lo que la escena tiene: arco, columna, guirnalda, pared,
 * figura y mueble/fondo. Puro y por reglas (sin modelo). Lo que se compara es la CLAVE de cada cosa: «guirnalda», «columna», «racimo»,
 * «metalizado», «decoracion:<id>» o «fondo:<id>» (un fondo o mueble del catálogo). Una pieza leída pide una clave, un nodo de la escena
 * la pone, y la familia de la clave dice qué clase de estructura falta. Comparar por clave y no por familia entera evita que sobre de
 * una cosa (las palabras de un metalizado son varios nodos) y tape lo que falta de otra.
 */
import type { FiguraOtro } from "@/lib/globos3d/lectura-otro-figura";

export const FAMILIAS = ["arco", "columna", "guirnalda", "pared", "figura", "mueble_fondo"] as const;
export type FamiliaEstructura = (typeof FAMILIAS)[number];

/** Una pieza de la lectura reducida a lo que la comparación necesita (`tipo` y, según el tipo, `id` de fondo o `descripcion` de un «otro»). */
export type PiezaResumida = { tipo: string; id?: string; descripcion?: string };
/** Un nodo de la escena: su id, el tipo de su pieza y, si es un mueble o un fondo del catálogo, el id con que se armó; y `contorno: "texto"` si es una forma rellena que dibuja un número o una letra. */
export type NodoResumido = { id: string; tipo: string; muebleId?: string; contorno?: "texto" };

export const FONDOS_DE_ARCO: ReadonlySet<string> = new Set(["arcos_chiara", "aro_metalico", "aro_hexagonal", "arco_metalico"]);
export const FONDOS_DE_COLUMNA: ReadonlySet<string> = new Set(["columna_griega"]);
export const FONDOS_DE_PARED: ReadonlySet<string> = new Set(["panel_redondo", "media_luna", "lentejuelas", "cortina_luces", "cortina_flecos", "marco_tela", "biombo"]);

/** Un fondo o mueble del catálogo (`FONDOS_CATALOGO`): los que no son arco, columna ni pared son mobiliario o decorado de piso. */
export function familiaDeFondo(id: string): FamiliaEstructura {
  if (FONDOS_DE_ARCO.has(id)) return "arco";
  if (FONDOS_DE_COLUMNA.has(id)) return "columna";
  if (FONDOS_DE_PARED.has(id)) return "pared";
  return "mueble_fondo";
}

/** El id de un nodo sin su sufijo de copia (`racimo-piso-2` → `racimo_piso`), que es el id del fondo o de la pieza que lo armó. */
const baseDeId = (id: string) => id.replace(/-\d+$/, "").replace(/-/g, "_");

/**
 * Lo que una pieza leída le pide a la escena. `otro` no está aquí (lo decide el clasificador, que sabe si el taller lo arma), ni los
 * globos, los ramos de helio y los corazones: se compilan a globos sueltos o se funden en un montón, y no dejan un nodo propio que contar.
 */
export function clavePedida(pieza: PiezaResumida): string | null {
  switch (pieza.tipo) {
    case "guirnalda_organica": case "guirnalda_clasica": return "guirnalda";
    case "columna_organica": case "columna_clasica": return "columna";
    case "racimo_piso": return "racimo";
    case "metalizado": return "metalizado";
    case "decoracion": return pieza.id ? `decoracion:${pieza.id}` : null;
    case "fondo": return pieza.id ? `fondo:${pieza.id}` : null;
    default: return null;
  }
}

/** Lo que una figura que la lectura escribió como «otro» le pide a la escena: la decoración de la biblioteca con que se arma, o una forma rellena (el número o la letra). */
export const clavePedidaDeFigura = (figura: FiguraOtro): string => (figura.clase === "decoracion" ? `decoracion:${figura.id}` : "forma:texto");

/** Lo que un nodo de la escena pone. Una guirnalda se puede rearmar como arco orgánico: ambos son la forma orgánica que la lectura llama guirnalda. */
export function clavePuesta({ id, tipo, muebleId, contorno }: NodoResumido): string | null {
  switch (tipo) {
    case "guirnalda": case "arco_organico": return "guirnalda";
    case "columna": return "columna";
    case "metalizado": return "metalizado";
    case "forma": return contorno === "texto" ? "forma:texto" : "forma";
    case "decoracion": return `decoracion:${baseDeId(id)}`;
    case "escenografia": return `fondo:${muebleId ?? baseDeId(id)}`;
    case "organico": {
      const base = baseDeId(id);
      if (/^(?:guirnalda|trazo|arco|aro|marco|semiarco)/.test(base)) return "guirnalda";
      if (/^columna/.test(base)) return "columna";
      if (/^racimo/.test(base)) return "racimo";
      return null;
    }
    default: return null;
  }
}

export function familiaDeClave(clave: string): FamiliaEstructura {
  if (clave.startsWith("fondo:")) return familiaDeFondo(clave.slice("fondo:".length));
  if (clave === "guirnalda") return "guirnalda";
  if (clave === "columna" || clave === "racimo") return "columna";
  return "figura";
}

/** Sin acentos ni mayúsculas, para comparar. */
const normal = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Donde acaba lo que la descripción dice de la pieza: coma, dos puntos, paréntesis, o una preposición de lugar o de compañía. */
const FIN_DE_LA_PIEZA = /[,:;(]|\s(?:con|sobre|encima|en|dentro|detras|tras|bajo|delante|al|a|por|junto|entre|hacia|que|sin|tipo|colgad[oa]s?|pegad[oa]s?|cortad[oa]s?|apoyad[oa]s?)\s/;

/**
 * Las palabras que dicen a qué familia pertenece lo descrito, sacadas de las descripciones de «otro» de las pasadas del arnés W4.
 * Manda la que aparece primero en el nombre de la pieza («escalera de madera y pared de ladrillo» es un mueble, no una pared); a igual
 * posición, la primera de la lista («cajas de regalo» es figura antes que mueble).
 */
const REGLAS_DE_OTRO: ReadonlyArray<readonly [FamiliaEstructura, RegExp]> = [
  ["figura", /\b(?:figuras?|mariposas?|foil|munec[oa]s?|osos?|ositos?|peluche|arbol(?:es)?|copos?|calabazas?|gatos?|murcielagos?|numeros?|letras?|estrellas?|corazon(?:es)?|monos?|lazos?|flor(?:es)?|pampas|ramas?|follaje|arreglos?|esferas?|bolas?|rizos?|espirales?|topiarios?|arbustos?|plantas?|macetas?|regalos?|cajas?(?: \w+){0,2} de regalos?)\b/],
  ["arco", /\b(?:arcoiris|semiarcos?|arcos?|medio arco|aros?)\b/],
  ["columna", /\b(?:columnas?|pilar(?:es)?|racimos?)\b/],
  ["guirnalda", /\b(?:guirnaldas?|festones?|cenefas?)\b/],
  ["pared", /\b(?:pared(?:es)?|muros?|telon(?:es)?|panel(?:es)?|cortinas?|biombos?|bastidor(?:es)?|tapi(?:z|ces))\b/],
  ["mueble_fondo", /\b(?:mesas?|estantes?|estanteria|repisas?|pedestal(?:es)?|sill[ao]s?|sillon(?:es)?|sofas?|bancos?|bancas?|caballetes?|escaleras?|bandejas?|platos?|soportes?|bases?|cubos?|cilindros?|carritos?|atriles?|bocinas?|cajas?|cajones|varillas?|jarron(?:es)?|floreros?|cerca|deck|ventanal(?:es)?|puertas?|tapetes?|alfombras?|postres?|pasteles?|tortas?|cupcakes?|dulces)\b/],
];

/** Lo que la medida de la foto agrega, como pieza `otro`, cuando detecta un fondo del catálogo que no puede poner: «base_pastel» detectado en x 0.45 sin una mesa debajo… */
const FONDO_DETECTADO_SIN_PONER = /^«([a-z0-9_]+)» detectado/;

/** La familia de una pieza `otro` por su descripción; `null` si el nombre de la pieza no dice ninguna (una marca de agua, un distintivo). */
export function familiaDeOtro(descripcion: string): FamiliaEstructura | null {
  const detectado = FONDO_DETECTADO_SIN_PONER.exec(descripcion)?.[1];
  if (detectado) return familiaDeFondo(detectado);
  const texto = normal(descripcion);
  const pieza = texto.split(FIN_DE_LA_PIEZA)[0] ?? texto;
  let mejor: { familia: FamiliaEstructura; posicion: number } | null = null;
  for (const [familia, regla] of REGLAS_DE_OTRO) {
    const posicion = pieza.search(regla);
    if (posicion >= 0 && (mejor === null || posicion < mejor.posicion)) mejor = { familia, posicion };
  }
  return mejor?.familia ?? null;
}
