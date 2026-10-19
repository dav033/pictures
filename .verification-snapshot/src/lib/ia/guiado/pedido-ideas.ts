import { bibliotecaVisible, normalizarBusqueda, sinMotivosAjenos, tituloParaEvento, type CoincidenciaDecoracion } from "@/lib/biblioteca-sempertex/biblioteca";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { clasificarColores } from "@/lib/rag/taxonomy/v2";
import { eventoDeTexto } from "./ideas-guiadas";

/**
 * «Muéstrame otras ideas con columnas»: el cliente pide VER ideas del catálogo, no cambiar su plan.
 *
 * Por qué existe (verificador, 2026-10-06, guiada-20261006-231824-v43qux, solicitud 2c18cf03): con un plan hecho, el
 * modelo leyó la frase como un cambio, llamó `proponer_composicion`, la vista aceptó la propuesta sola y /api/chat armó
 * y cotizó un plan nuevo de 149 globos (≈74 000 tokens de entrada) sin que nadie lo pidiera; no salió ningún carrusel.
 * Ahora el servidor reconoce el pedido, busca las ideas reales él mismo (como en el cambio de temática) y en ese turno
 * el modelo solo las presenta, sin herramientas. Puro: sin servidor ni modelo.
 */

export type PedidoIdeas = { piezas: EstructuraOficialId[]; palabra: string | null };

/** Lo que se quiere ver: ideas, fotos, ejemplos, modelos, diseños, decoraciones, inspiración. */
const OBJETO = /\b(ideas?|fotos?|ejemplos?|modelos?|disenos?|decoraciones|inspiracion|opciones de decoracion)\b/;
/** Cómo se pide verlas: «muéstrame», «enséñame», «quiero ver», «dame», «tienes», «hay», «otras», «más». */
const VERBO = /\b(muestra\w*|muestrame|ensena\w*|ver|veamos|dame|tienes|tienen|hay|otras?|mas|busca\w*|sugiere\w*|sugerencias?)\b/;
/** Un cambio del plan o una propuesta a medida no es «ver ideas»: eso sigue siendo del modelo. */
const CAMBIO = /\b(proponme|propon\w*|arma\w*|cambia\w*|quita\w*|agrega\w*|anade\w*|pon|ponle|ponla|hazla|hazlo|haz|sube|baja|reemplaza\w*|cotiza\w*|precio|cuanto)\b/;

/** Palabra del cliente → piezas oficiales que la materializan. */
const PIEZAS: ReadonlyArray<readonly [RegExp, string, readonly EstructuraOficialId[]]> = [
  [/\bsemiarcos?\b|\bmedio arco\b/, "semiarco", ["semiarco", "semiarco_asimetrico"]],
  [/\barcos?\b/, "arco", ["arco", "arco_asimetrico", "arco_no_denso"]],
  [/\bcolumnas?\b|\btorres?\b/, "columna", ["columna", "columna_asimetrica", "columna_no_densa"]],
  [/\bguirnaldas?\b/, "guirnalda", ["guirnalda"]],
  [/\bparedes?\b|\bmuros?\b|\bbackdrops?\b|\bfondos?\b/, "pared", ["pared_densa", "pared_no_densa", "pared_organica", "racimo_pared"]],
  [/\bcentros? de mesa\b/, "centro de mesa", ["centro_mesa"]],
  [/\bbouquets?\b|\bramos?\b/, "bouquet", ["bouquet"]],
  [/\btechos?\b/, "techo", ["techo_globos"]],
  [/\baros?\b/, "aro", ["aro_circular"]],
  [/\bfiguras?\b/, "figura", ["figura"]],
];

/** El pedido de ver ideas en lo que escribió el cliente (y las piezas que nombró), o null si no lo es. */
export function pedidoDeIdeas(texto: string): PedidoIdeas | null {
  const limpio = normalizarBusqueda(texto);
  if (!limpio || !OBJETO.test(limpio) || !VERBO.test(limpio) || CAMBIO.test(limpio)) return null;
  for (const [patron, palabra, piezas] of PIEZAS) {
    if (patron.test(limpio)) return { piezas: [...piezas], palabra };
  }
  return { piezas: [], palabra: null };
}

/**
 * Las ideas en el orden en que se muestran: primero las que llevan la pieza que nombró (de la búsqueda y, si faltan,
 * del resto del evento), luego las demás. Como mucho `tope`. Sin pieza nombrada, la búsqueda tal cual.
 */
export function ordenarIdeasPorPieza<T extends Pick<DecoracionSempertex, "id" | "piezas">>(buscadas: readonly T[], delEvento: readonly T[], piezas: readonly EstructuraOficialId[], tope = 6): { ideas: T[]; conPieza: number } {
  if (!piezas.length) return { ideas: buscadas.slice(0, tope), conPieza: 0 };
  const tiene = (idea: T) => idea.piezas.some((pieza) => (piezas as readonly string[]).includes(pieza.estructura));
  const vistas = new Set<string>();
  const unica = (idea: T) => (vistas.has(idea.id) ? false : (vistas.add(idea.id), true));
  const conPieza = [...buscadas.filter(tiene), ...delEvento.filter(tiene)].filter(unica);
  const resto = buscadas.filter((idea) => !tiene(idea)).filter(unica);
  return { ideas: [...conPieza, ...resto].slice(0, tope), conPieza: Math.min(conPieza.length, tope) };
}

/**
 * «Muéstrame ideas parecidas a mi foto: Veo una columna en blanco mate y dorado cromado…»: el botón «Prefiero ver ideas
 * parecidas» de la lectura de una foto.
 */
export function esPedidoParecidasAFoto(texto: string): boolean {
  return /\bparecid\w* a (?:mi|la|tu|esta|esa) foto\b/.test(normalizarBusqueda(texto));
}

export type EntradaParecidasFoto = {
  /** Lo que la lectura vio («Veo una columna en blanco mate y dorado cromado»): sus colores. */
  texto: string;
  /** Las piezas oficiales de lo que vio (`pedidoDeIdeas(texto).piezas`). */
  piezas: readonly EstructuraOficialId[];
  evento?: string;
  edad?: number;
  /** Ideas que el cliente ya vio (`ideasYaVistas`): no se repiten. */
  excluir: ReadonlySet<string>;
};

function eventoCanonico(texto: string): string {
  return eventoDeTexto(texto) ?? normalizarBusqueda(texto);
}

function tituloComparable(titulo: string): string {
  return normalizarBusqueda(titulo).split(" ").filter((palabra) => palabra !== "en" && palabra !== "de").join(" ");
}

/** Eventos de adultos (los nombres canónicos de `eventoDeTexto`). */
const EVENTOS_DE_ADULTOS: ReadonlySet<string> = new Set(["boda", "graduación", "fiesta de empresa", "Día de la Madre", "San Valentín"]);

/**
 * Ideas reales parecidas a la foto del cliente: primero las de su MISMA estructura y sus colores, luego las de su
 * estructura, luego las de sus colores; a igualdad, las de su evento. Nunca las que ya vio, ni de un motivo que no
 * nombró (Halloween, fútbol…), ni de otra edad. Todas van como «cercana» (insignia «Parecida»).
 *
 * Probador (2026-10-07, guiada-20261007-000432-mi8qhp): boda en blanco y dorado, foto de una columna, «Prefiero ver ideas
 * parecidas» → `pedido_ideas` con `conPieza: 0` y el mismo aro que ya había visto, presentado como «parecidas a la foto».
 */
export function ideasParecidasAFoto(entrada: EntradaParecidasFoto, catalogo: DecoracionSempertex[] = bibliotecaVisible(), tope = 6): { ideas: CoincidenciaDecoracion[]; conPieza: number; conColor: number } {
  const colores = new Set(clasificarColores(entrada.texto).values.filter((color) => color !== "multicolor"));
  const evento = entrada.evento ? eventoCanonico(entrada.evento) : null;
  const edad = entrada.edad && entrada.edad > 0 ? entrada.edad : undefined;
  // Una boda o una graduación no es una fiesta infantil: sin edad, las ideas de niños no se ofrecen como parecidas.
  const deAdultos = edad !== undefined ? edad >= 18 : evento !== null && EVENTOS_DE_ADULTOS.has(evento);
  // «Arco de entrada blanco y negro» y «Arco de entrada en blanco y negro» son la misma idea para el cliente.
  const titulosVistos = new Set(catalogo.filter((idea) => entrada.excluir.has(idea.id)).map((idea) => tituloComparable(idea.titulo)));
  const candidatas = sinMotivosAjenos(catalogo, { ...(entrada.evento ? { evento: entrada.evento } : {}), tematica: entrada.texto })
    .filter((idea) => !entrada.excluir.has(idea.id) && !titulosVistos.has(tituloComparable(idea.titulo)))
    .filter((idea) => idea.edad === null || (edad !== undefined ? edad >= idea.edad.min && edad <= idea.edad.max : !deAdultos || idea.edad.max >= 18));
  const puntuadas = candidatas.map((idea, orden) => {
    const conPieza = idea.piezas.some((pieza) => (entrada.piezas as readonly string[]).includes(pieza.estructura));
    // Título y temática por separado: juntos, «…rosa, lila y dorado» + «Rosa y lila» se leía «dorado rosa».
    const suyos = new Set([...clasificarColores(idea.titulo).values, ...clasificarColores(idea.tematica).values]);
    const compartidos = [...colores].filter((color) => suyos.has(color)).length;
    // Los colores de la idea que la foto no tiene restan: a igualdad de estructura, la de los colores de la foto primero.
    const ajenos = [...suyos].filter((color) => color !== "multicolor" && !colores.has(color)).length;
    const mismoEvento = evento !== null && idea.eventos.some((otro) => eventoCanonico(otro) === evento);
    return { idea, conPieza, compartidos, puntaje: (conPieza ? 4 : 0) + compartidos * 2 - ajenos + (mismoEvento ? 1 : 0), orden };
  }).filter((item) => item.conPieza || item.compartidos > 0)
    .sort((a, b) => b.puntaje - a.puntaje || a.orden - b.orden)
    .slice(0, tope);
  return {
    ideas: puntuadas.map((item) => ({ ...item.idea, titulo: tituloParaEvento(item.idea.titulo, entrada.evento), coincidencia: "cercana" as const })),
    conPieza: puntuadas.filter((item) => item.conPieza).length,
    conColor: puntuadas.filter((item) => item.compartidos > 0).length,
  };
}
