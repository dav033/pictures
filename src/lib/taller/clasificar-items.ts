import type { ItemBiblioteca } from "../globos3d/biblioteca";
import { fuenteIdea } from "../globos3d/ideas-sempertex/fuentes";
import {
  OCASION_GENERAL, canonicalizarOcasiones, celebracionesDeTexto, normalizar, tematicaPorId, tematicasDeTexto, type Coincidencia,
} from "./taxonomia-celebraciones";

/**
 * **Clasificador por reglas** de la biblioteca (REQ-002, paso 1): propone celebraciones y temáticas para un item con
 * lo que ya sabemos de él, sin IA y sin red. Cada etiqueta lleva una confianza (0 a 1) y el motivo; solo se
 * devuelven las de confianza >= `UMBRAL_CONFIANZA`. Un item sin ninguna etiqueta confiable es `general`.
 *
 * Señales, de más a menos fiables:
 *  - ocasiones ya curadas del item (0,9) y etiquetas de la tienda Sempertex de su idea (0,85);
 *  - el nombre y el título de la fuente (0,85) con la taxonomía; la descripción y los nombres de sus piezas son notas
 *    de armado (mencionan globos «metalizados», colores «durazno», una «flor» sobre el arco): una sola mención vale 0,45
 *    (no alcanza) y dos menciones distintas de lo mismo, 0,6. Las paletas y acabados (neón, pastel, metálico…) nunca se
 *    sacan de esas notas: son atributos del globo, no una temática;
 *  - palabras ambiguas («mamá», «calabaza»): pistas débiles (0,35); dos o más pistas distintas de lo mismo suman;
 *  - nombres de personajes con licencia: solo como pista de lectura hacia una temática genérica (no son categorías);
 *  - colores: SOLO la regla estacional explícita (negro + naranja, con o sin morado → Halloween), y nunca si el item
 *    ya tiene una celebración. Un pastel, un dorado o un azul no dicen qué se celebra.
 */

export const UMBRAL_CONFIANZA = 0.5;

export type EtiquetaClasificada = { id: string; confianza: number; motivo: string };
export type ResultadoClasificacion = { celebraciones: EtiquetaClasificada[]; tematicas: EtiquetaClasificada[]; general: boolean };

/** Lo que el llamador puede añadir cuando ya lo tiene a mano (el item perezoso no se arma para clasificarlo). */
export type ContextoClasificacion = {
  /** Nombres de los colores dominantes en español («negro», «naranja»), si se conocen. */
  colores?: readonly string[];
  /** Nombres de las piezas de la escena. */
  piezas?: readonly string[];
};

const CONF_CURADA = 0.9;
/** Las ocasiones de una foto de internet son sugerencias generales del que la digitalizó, no lo que la foto celebra. */
const CONF_CURADA_WEB = 0.6;
const CONF_ETIQUETA = 0.85;
const CONF_NOMBRE = 0.85;
const CONF_NOTA = 0.45;
const CONF_NOTA_REPETIDA = 0.6;
const CONF_DEBIL = 0.35;
const SUMA_DEBIL = 0.2;
const CONF_INFANTIL = 0.55;
const CONF_ESTACIONAL = 0.55;
const CONF_ESTACIONAL_CON_MORADO = 0.65;
const CONF_LICENCIA = 0.8;

// ----------------------------------------------------------------------------------------------------------
// Tablas
// ----------------------------------------------------------------------------------------------------------

/** Etiqueta de la tienda Sempertex → celebraciones (las que dicen qué se celebra). */
const CELEBRACION_DE_ETIQUETA: Readonly<Record<string, readonly string[]>> = {
  halloween: ["halloween"], amor: ["san-valentin"], "amor-y-amistad": ["san-valentin"], "san-valentin": ["san-valentin"], "decoracion-con-amor": ["san-valentin"],
  navidad: ["navidad"], cumpleanos: ["cumpleanos"], "1-ano": ["primer-cumpleanos"], "baby-shower": ["baby-shower"],
  "aniversario-y-boda": ["boda", "aniversario"], boda: ["boda"], "despedida-de-soltera": ["despedida-soltera"],
  grados: ["graduacion"], grado: ["graduacion"], "quince-anos": ["quince-anos"], "15-anos": ["quince-anos"],
  bautizo: ["bautizo"], "primera-comunion": ["primera-comunion"], comunion: ["primera-comunion"],
  madres: ["dia-de-la-madre"], "dia-de-la-madre": ["dia-de-la-madre"], padres: ["dia-del-padre"], padre: ["dia-del-padre"],
  "ano-nuevo": ["ano-nuevo"], "feliz-ano": ["ano-nuevo"], pascua: ["pascua"], verano: ["fiesta-verano"], mundial: ["mundial-futbol"],
};

/** Etiquetas de la tienda de audiencia (no dicen qué se celebra, solo que es para niños): borde del umbral. */
const ETIQUETAS_INFANTILES: ReadonlySet<string> = new Set(["ninas", "ninos", "infantil"]);

/** Etiqueta de la tienda → temáticas. */
const TEMATICA_DE_ETIQUETA: Readonly<Record<string, readonly string[]>> = {
  marino: ["nautico"], espacio: ["espacio"], futbol: ["deportes"], jardin: ["flores-jardin"],
};

/**
 * Personajes con licencia → temática genérica. Son PISTAS DE LECTURA para entender lo que escribe el dueño
 * («Frozen», «Wonder Woman»); no son categorías ni sinónimos de la taxonomía, que no lleva marcas.
 */
const PISTAS_LICENCIA: ReadonlyArray<readonly [string, string]> = [
  ["frozen", "invierno"], ["elsa", "invierno"], ["let it go", "invierno"],
  ["wonder woman", "superheroes"], ["batman", "superheroes"], ["superman", "superheroes"], ["spiderman", "superheroes"], ["spider man", "superheroes"],
  ["avengers", "superheroes"], ["vengadores", "superheroes"],
  ["mario bros", "videojuegos"], ["minecraft", "videojuegos"], ["fortnite", "videojuegos"], ["roblox", "videojuegos"], ["pokemon", "videojuegos"], ["sonic", "videojuegos"],
];

// ----------------------------------------------------------------------------------------------------------
// Acumulación de evidencias
// ----------------------------------------------------------------------------------------------------------

type Evidencia = { confianza: number; motivo: string; debil: boolean; termino?: string; fuente: string };

class Acumulador {
  private readonly porId = new Map<string, Evidencia[]>();

  poner(id: string, confianza: number, motivo: string, fuente: string, debil = false, termino?: string): void {
    const lista = this.porId.get(id) ?? [];
    lista.push({ confianza, motivo, debil, termino, fuente });
    this.porId.set(id, lista);
  }

  /** `permitir` deja fuera ids que esa fuente no puede dar (p. ej. las paletas en una nota de armado). */
  coincidencias(aciertos: readonly Coincidencia[], fuente: string, fuerte: number, permitir: (id: string) => boolean = () => true): void {
    for (const a of aciertos) {
      if (!permitir(a.id)) continue;
      if (a.debil) for (const t of a.terminos) this.poner(a.id, CONF_DEBIL, `${fuente}: pista débil «${t}»`, fuente, true, t);
      else for (const t of a.terminos) this.poner(a.id, fuerte, `${fuente}: «${t}»`, fuente, false, t);
    }
  }

  /**
   * La mejor evidencia fuerte (dos fuentes que coinciden suben 0,05). Una nota de armado con dos términos distintos de
   * lo mismo sube a 0,6. Si solo hay pistas débiles: 0,35 y +0,2 por cada término distinto más (tope 0,7).
   */
  resolver(): EtiquetaClasificada[] {
    const salida: EtiquetaClasificada[] = [];
    for (const [id, lista] of this.porId) {
      const fuertes = lista.filter((e) => !e.debil).map((e) => {
        if (e.confianza >= UMBRAL_CONFIANZA) return e;
        const mismos = new Set(lista.filter((x) => !x.debil && x.fuente === e.fuente).map((x) => x.termino));
        return mismos.size >= 2 ? { ...e, confianza: CONF_NOTA_REPETIDA } : e;
      }).sort((a, b) => b.confianza - a.confianza);
      let confianza: number;
      let motivo: string;
      if (fuertes.length) {
        const distintas = new Set(fuertes.filter((e) => e.confianza >= UMBRAL_CONFIANZA).map((e) => e.fuente)).size;
        confianza = Math.min(0.98, fuertes[0]!.confianza + (distintas > 1 ? 0.05 : 0));
        motivo = fuertes.slice(0, 2).map((e) => e.motivo).join("; ");
      } else {
        const terminos = new Set(lista.map((e) => e.termino ?? e.motivo));
        confianza = Math.min(0.7, CONF_DEBIL + SUMA_DEBIL * (terminos.size - 1));
        motivo = lista.slice(0, 3).map((e) => e.motivo).join("; ");
      }
      if (confianza >= UMBRAL_CONFIANZA) salida.push({ id, confianza: Math.round(confianza * 100) / 100, motivo });
    }
    return salida.sort((a, b) => b.confianza - a.confianza || a.id.localeCompare(b.id));
  }
}

const slugDe = (url: string | undefined): string | null => {
  if (!url) return null;
  const partes = url.split("?")[0]!.split("/").filter(Boolean);
  return partes.length ? decodeURIComponent(partes[partes.length - 1]!) : null;
};

/** El título de la fuente sin la parte fija («Sempertex · Ideas de fiesta · …» es el sitio, no la idea). */
function tituloUtil(item: ItemBiblioteca): string {
  const titulo = item.fuente?.titulo ?? "";
  const dice = item.fuente?.tipo === "referencia-web" || item.fuente?.tipo === "propio";
  return dice && !/taller|predefinida|utilería/i.test(titulo) ? titulo : "";
}

/** Las palabras del id tras el prefijo («referencia:dino-menta-mesa» → «dino menta mesa»); vacío si el id no es descriptivo. */
function palabrasDelId(id: string): string {
  const i = id.indexOf(":");
  return i < 0 ? "" : id.slice(i + 1).replace(/[-_]+/g, " ");
}

const tieneColor = (colores: ReadonlySet<string>, ...nombres: string[]) => nombres.some((n) => colores.has(n));

/** Colores citados en un texto («negro», «naranja», «morado»/«violeta») para la regla estacional. */
function coloresDelTexto(texto: string): Set<string> {
  const palabras = new Set(normalizar(texto).split(" "));
  const salida = new Set<string>();
  for (const [palabra, color] of [["negro", "negro"], ["negra", "negro"], ["naranja", "naranja"], ["naranjado", "naranja"], ["morado", "morado"], ["violeta", "morado"], ["purpura", "morado"]] as const) {
    if (palabras.has(palabra)) salida.add(color);
  }
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Clasificar
// ----------------------------------------------------------------------------------------------------------

/** Celebraciones y temáticas de un item por reglas (nombre, descripción, fuente, ocasiones, piezas y colores). */
export function clasificarPorReglas(item: ItemBiblioteca, contexto: ContextoClasificacion = {}): ResultadoClasificacion {
  const celebraciones = new Acumulador();
  const tematicas = new Acumulador();
  const nombre = item.nombre;
  const descripcion = item.descripcion ?? "";
  const titulo = tituloUtil(item);

  // 1. Ocasiones ya curadas (ids canónicos; los viejos se migran).
  const confCurada = item.fuente?.tipo === "referencia-web" ? CONF_CURADA_WEB : CONF_CURADA;
  for (const id of canonicalizarOcasiones(item.ocasiones)) {
    if (id === OCASION_GENERAL) continue;
    celebraciones.poner(id, id === "fiesta-infantil" ? Math.min(CONF_INFANTIL, confCurada) : confCurada, "ocasión del item", "ocasión");
  }

  // 2. Etiquetas de la tienda Sempertex de su idea.
  const slug = item.fuente?.tipo === "idea-sempertex" ? slugDe(item.fuente.url) : null;
  const etiquetas = slug ? fuenteIdea(slug)?.etiquetas ?? [] : [];
  for (const e of etiquetas) {
    for (const id of CELEBRACION_DE_ETIQUETA[e] ?? []) celebraciones.poner(id, CONF_ETIQUETA, `etiqueta de la tienda «${e}»`, "etiqueta");
    if (ETIQUETAS_INFANTILES.has(e)) celebraciones.poner("fiesta-infantil", CONF_INFANTIL, `etiqueta de la tienda «${e}»`, "etiqueta");
    for (const id of TEMATICA_DE_ETIQUETA[e] ?? []) tematicas.poner(id, CONF_ETIQUETA - 0.05, `etiqueta de la tienda «${e}»`, "etiqueta");
  }

  // 3. Texto: nombre y título de la fuente (fuertes), descripción y piezas (menos).
  // El id descriptivo («idea:reyes-magos-4», «referencia:dino-menta-mesa») dice a veces más que el nombre.
  const textoNombre = [nombre, titulo, palabrasDelId(item.id)].filter(Boolean).join(" · ");
  celebraciones.coincidencias(celebracionesDeTexto(textoNombre), "nombre", CONF_NOMBRE);
  tematicas.coincidencias(tematicasDeTexto(textoNombre), "nombre", CONF_NOMBRE);
  const sinPaletas = (id: string) => tematicaPorId(id)?.grupo !== "paletas-y-acabados";
  if (descripcion) {
    celebraciones.coincidencias(celebracionesDeTexto(descripcion), "descripción", CONF_NOTA);
    tematicas.coincidencias(tematicasDeTexto(descripcion), "descripción", CONF_NOTA, sinPaletas);
  }
  if (contexto.piezas?.length) {
    const piezas = contexto.piezas.join(" · ");
    celebraciones.coincidencias(celebracionesDeTexto(piezas), "piezas", CONF_NOTA);
    tematicas.coincidencias(tematicasDeTexto(piezas), "piezas", CONF_NOTA, sinPaletas);
  }

  // 4. Personajes con licencia → temática genérica (pista de lectura).
  const plano = ` ${normalizar(`${nombre} ${titulo} ${descripcion}`)} `;
  for (const [pista, id] of PISTAS_LICENCIA) if (plano.includes(` ${pista} `)) tematicas.poner(id, CONF_LICENCIA, `personaje con licencia «${pista}» (pista de lectura)`, "licencia");

  // 5. Regla estacional explícita: negro + naranja (+ morado) → Halloween, solo si no hay otra celebración.
  const resueltasCelebracion = celebraciones.resolver();
  if (!resueltasCelebracion.length) {
    const colores = new Set([...(contexto.colores ?? []).map((c) => normalizar(c)), ...coloresDelTexto(textoNombre)]);
    if (tieneColor(colores, "negro") && tieneColor(colores, "naranja")) {
      const conMorado = tieneColor(colores, "morado");
      celebraciones.poner("halloween", conMorado ? CONF_ESTACIONAL_CON_MORADO : CONF_ESTACIONAL, `regla estacional de color: negro + naranja${conMorado ? " + morado" : ""}`, "color");
    }
  }

  const salidaCelebraciones = celebraciones.resolver();
  const salidaTematicas = tematicas.resolver();
  return { celebraciones: salidaCelebraciones, tematicas: salidaTematicas, general: salidaCelebraciones.length === 0 && salidaTematicas.length === 0 };
}
