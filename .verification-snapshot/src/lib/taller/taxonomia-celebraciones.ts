import { CELEBRACIONES_CALENDARIO } from "./taxonomia/celebraciones-calendario";
import { CELEBRACIONES_VIDA } from "./taxonomia/celebraciones-vida";
import { TEMATICAS } from "./taxonomia/tematicas";
import type { Celebracion, Coincidencia, EntradaTaxonomia, Tematica } from "./taxonomia/tipos";

export * from "./taxonomia/tipos";

/**
 * **La taxonomía del taller**: la única fuente de verdad de qué se celebra y cómo se ve. Dos ejes cerrados e
 * independientes (una pieza puede ser de «cumpleaños» con temática «dinosaurios», o de ninguna celebración y solo
 * «boho»). Sin personajes ni marcas con licencia: se describen de forma genérica («princesas», «invierno»).
 *
 * Los ids son slugs ascii estables: se guardan en los items, en el navegador del dueño y en la base. Los datos viven
 * en `./taxonomia/*`; aquí están la búsqueda por texto y la migración de los ids viejos.
 *
 * Equivalencias con vocabularios que NO se tocan (otros conceptos, no comparten ids; ver `EQUIVALENCIA_EXTERNA`):
 *  - catálogo Shopify (`OCASIONES_CATALOGO_V2`, filtros del RAG de productos): `xv_anos`, `dia_madre`…
 *  - asistente guiado (`/asistente`: `EVENTOS_CONOCIDOS` de `ideas-guiadas.ts`) y `EventoEntorno` del entorno de escena.
 */

export const CELEBRACIONES: readonly Celebracion[] = [...CELEBRACIONES_VIDA, ...CELEBRACIONES_CALENDARIO];
export { TEMATICAS };

/** Una pieza sin celebración concreta (la «ocasión» comodín que ya existía en la biblioteca). No es una celebración. */
export const OCASION_GENERAL = "general";

const POR_ID_CELEBRACION: ReadonlyMap<string, Celebracion> = new Map(CELEBRACIONES.map((c) => [c.id, c]));
const POR_ID_TEMATICA: ReadonlyMap<string, Tematica> = new Map(TEMATICAS.map((t) => [t.id, t]));

export const celebracionPorId = (id: string): Celebracion | undefined => POR_ID_CELEBRACION.get(id);
export const tematicaPorId = (id: string): Tematica | undefined => POR_ID_TEMATICA.get(id);

/** Ids que puede llevar `ItemBiblioteca.ocasiones`: el comodín primero y luego las celebraciones en orden de grupo. */
export const IDS_OCASION: readonly string[] = [OCASION_GENERAL, ...CELEBRACIONES.map((c) => c.id)];

/** El nombre para mostrar de una ocasión guardada (id canónico, o el texto tal cual si es desconocida). */
export function nombreOcasion(id: string): string {
  if (id === OCASION_GENERAL) return "General";
  return celebracionPorId(id)?.nombre ?? id;
}

// ----------------------------------------------------------------------------------------------------------
// Normalizar y buscar por texto
// ----------------------------------------------------------------------------------------------------------

/** Minúsculas, sin tildes ni ñ, solo letras y cifras separadas por un espacio («15años» → «15 anos»). */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2")
    .trim();
}

/** El singular tosco que se usa a ambos lados al comparar («globos» = «globo», «años» = «año»). */
const raiz = (palabra: string): string => (palabra.length > 3 && palabra.endsWith("s") ? palabra.slice(0, -1) : palabra);
const palabrasDe = (texto: string): string[] => { const n = normalizar(texto); return n ? n.split(" ").map(raiz) : []; };

type Termino = { id: string; termino: string; debil: boolean };
type Buscador = { indice: ReadonlyMap<string, Termino[]>; largoMaximo: number };

function crearBuscador(entradas: readonly EntradaTaxonomia<string>[]): Buscador {
  const indice = new Map<string, Termino[]>();
  let largoMaximo = 1;
  for (const e of entradas) {
    const fuertes = [e.nombre, e.en, ...e.sinonimos].map((t) => ({ t, debil: false }));
    const debiles = (e.ambiguos ?? []).map((t) => ({ t, debil: true }));
    for (const { t, debil } of [...fuertes, ...debiles]) {
      const palabras = palabrasDe(t);
      if (!palabras.length) continue;
      const clave = palabras.join(" ");
      indice.set(clave, [...(indice.get(clave) ?? []), { id: e.id, termino: t, debil }]);
      largoMaximo = Math.max(largoMaximo, palabras.length);
    }
  }
  return { indice, largoMaximo };
}

let BUSC_CELEBRACIONES: Buscador | null = null;
let BUSC_TEMATICAS: Buscador | null = null;
const buscadorCelebraciones = (): Buscador => (BUSC_CELEBRACIONES ??= crearBuscador(CELEBRACIONES));
const buscadorTematicas = (): Buscador => (BUSC_TEMATICAS ??= crearBuscador(TEMATICAS));

/** Los términos que nombran a más de un id dentro de un mismo eje (no debería haber ninguno): lo usa el test. */
export function terminosRepetidos(eje: "celebraciones" | "tematicas"): Array<{ clave: string; ids: string[] }> {
  const b = eje === "celebraciones" ? buscadorCelebraciones() : buscadorTematicas();
  return [...b.indice.entries()].flatMap(([clave, lista]) => {
    const ids = [...new Set(lista.map((x) => x.id))];
    return ids.length > 1 ? [{ clave, ids }] : [];
  });
}

/**
 * Los términos de un eje que aparecen en el texto, como palabras o frases completas, el más largo primero (lo ya
 * cubierto por una frase larga no vuelve a contar para una corta: «cumpleaños infantil» no suma «cumpleaños»).
 * Devuelve un resultado por id, en el orden del texto, con el término de la taxonomía que casó y si fue pista débil.
 */
function buscarEnTexto(b: Buscador, texto: string): Coincidencia[] {
  const palabras = palabrasDe(texto);
  type Candidato = { inicio: number; largo: number; t: Termino };
  const candidatos: Candidato[] = [];
  for (let i = 0; i < palabras.length; i++) {
    for (let largo = Math.min(b.largoMaximo, palabras.length - i); largo >= 1; largo--) {
      const lista = b.indice.get(palabras.slice(i, i + largo).join(" "));
      if (lista) for (const t of lista) candidatos.push({ inicio: i, largo, t });
    }
  }
  candidatos.sort((a, c) => c.largo - a.largo || Number(a.t.debil) - Number(c.t.debil) || a.inicio - c.inicio);
  const usado = new Array<boolean>(palabras.length).fill(false);
  const elegidos: Candidato[] = [];
  for (const c of candidatos) {
    let libre = true;
    for (let k = c.inicio; k < c.inicio + c.largo; k++) if (usado[k]) { libre = false; break; }
    if (!libre) continue;
    for (let k = c.inicio; k < c.inicio + c.largo; k++) usado[k] = true;
    elegidos.push(c);
  }
  elegidos.sort((a, c) => a.inicio - c.inicio);
  const porId = new Map<string, Coincidencia>();
  for (const { t } of elegidos) {
    const previo = porId.get(t.id);
    if (!previo) { porId.set(t.id, { id: t.id, termino: t.termino, debil: t.debil, terminos: [t.termino] }); continue; }
    if (!previo.terminos.includes(t.termino)) previo.terminos.push(t.termino);
    if (previo.debil && !t.debil) { previo.termino = t.termino; previo.debil = false; }
  }
  return [...porId.values()];
}

export const celebracionesDeTexto = (texto: string): Coincidencia[] => buscarEnTexto(buscadorCelebraciones(), texto);
export const tematicasDeTexto = (texto: string): Coincidencia[] => buscarEnTexto(buscadorTematicas(), texto);

/** Los términos de una entrada: nombre, inglés y sinónimos (fuertes) y ambiguos (débiles). */
export function terminosDe(entrada: EntradaTaxonomia<string>): { fuertes: string[]; debiles: string[] } {
  return { fuertes: [entrada.nombre, entrada.en, ...entrada.sinonimos], debiles: [...(entrada.ambiguos ?? [])] };
}

// ----------------------------------------------------------------------------------------------------------
// Ids viejos
// ----------------------------------------------------------------------------------------------------------

/**
 * Los ids/etiquetas que usaba la biblioteca antes de la taxonomía (y los de otros vocabularios que se pueden colar:
 * catálogo, asistente guiado). Claves ya normalizadas. `[]` = no es una celebración (era una temática o un adjetivo).
 */
const LEGADO: Readonly<Record<string, readonly string[]>> = {
  general: [OCASION_GENERAL],
  cumpleanos: ["cumpleanos"], cumple: ["cumpleanos"], "cumple infantil": ["cumpleanos-infantil"], "cumple adulto": ["cumpleanos-adulto"],
  infantil: ["fiesta-infantil"], ninos: ["fiesta-infantil"], ninas: ["fiesta-infantil"],
  "baby shower": ["baby-shower"],
  boda: ["boda"], matrimonio: ["boda"],
  grado: ["graduacion"], grados: ["graduacion"], graduacion: ["graduacion"],
  "quince anos": ["quince-anos"], "15 anos": ["quince-anos"], xv: ["quince-anos"], "xv anos": ["quince-anos"], quinceanera: ["quince-anos"],
  "bautizo y comunion": ["bautizo", "primera-comunion"], bautizo: ["bautizo"], comunion: ["primera-comunion"],
  "primera comunion": ["primera-comunion"],
  "dia de la madre": ["dia-de-la-madre"], "dia madre": ["dia-de-la-madre"], madres: ["dia-de-la-madre"],
  "dia padre": ["dia-del-padre"], "dia del padre": ["dia-del-padre"], padres: ["dia-del-padre"],
  "dia mujer": ["dia-de-la-mujer"],
  "ano nuevo": ["ano-nuevo"], "feliz ano": ["ano-nuevo"],
  amor: ["san-valentin"], "san valentin": ["san-valentin"], "amor y amistad": ["san-valentin"],
  halloween: ["halloween"], navidad: ["navidad"],
  verano: ["fiesta-verano"], despedida: ["despedida"],
  corporativo: ["evento-corporativo"], familia: ["reunion-familiar"], fiesta: ["fiesta-tematica"], revelacion: ["revelacion-genero"],
  elegante: [],
};

/**
 * Los ids canónicos de una ocasión guardada con un id viejo (`cumpleanos`, `cumpleaños`, `grado`, `graduacion`,
 * `bautizo y comunión`…). Uno de los viejos puede ser dos celebraciones. `[]` si no es una celebración. Un id que ya
 * es canónico, o un nombre o sinónimo exacto de la taxonomía, también se reconoce.
 */
export function idsCelebracionCanonicos(idViejo: string): string[] {
  const clave = normalizar(idViejo);
  if (!clave) return [];
  const legado = LEGADO[clave];
  if (legado) return [...legado];
  const comoId = clave.replace(/ /g, "-");
  if (POR_ID_CELEBRACION.has(comoId)) return [comoId];
  const exacta = celebracionesDeTexto(idViejo).find((c) => !c.debil && normalizar(c.termino) === clave);
  return exacta ? [exacta.id] : [];
}

/** El id canónico de una ocasión vieja (el primero si eran dos), o `null` si no es una celebración conocida. */
export const idCelebracionCanonico = (idViejo: string): string | null => idsCelebracionCanonicos(idViejo)[0] ?? null;

/** Lista de ocasiones (viejas o nuevas) → ids canónicos sin repetir; lo que no se reconoce se descarta; vacía → `general`. */
export function canonicalizarOcasiones(lista: readonly string[]): string[] {
  const salida = [...new Set(lista.flatMap(idsCelebracionCanonicos))];
  return salida.length ? salida : [OCASION_GENERAL];
}

/** Equivalencias de vocabularios externos (catálogo Shopify, asistente guiado, entorno de escena) con la taxonomía. */
export const EQUIVALENCIA_EXTERNA: Readonly<Record<string, string>> = {
  // OCASIONES_CATALOGO_V2 (src/lib/rag/taxonomy/v2.ts)
  san_valentin: "san-valentin", dia_madre: "dia-de-la-madre", dia_padre: "dia-del-padre", dia_mujer: "dia-de-la-mujer",
  xv_anos: "quince-anos", baby_shower: "baby-shower",
  // EventoEntorno (src/lib/ia/escena/entorno-escena.ts) y EVENTOS_CONOCIDOS (src/lib/ia/guiado/ideas-guiadas.ts)
  cumple_infantil: "cumpleanos-infantil", cumple_adulto: "cumpleanos-adulto", cumple: "cumpleanos", xv: "quince-anos",
  revelacion: "revelacion-genero", corporativo: "evento-corporativo", amor: "san-valentin", familia: "reunion-familiar", fiesta: "fiesta-tematica",
};
