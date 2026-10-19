import { z } from "zod";
import type { IdRepositorio } from "@/lib/catalogo/tipos";
import { celebracionesDeTexto, idsCelebracionCanonicos, tematicaPorId, tematicasDeTexto } from "../taller/taxonomia-celebraciones";

/**
 * Filtros nuevos de `buscar_en_biblioteca` (REQ-002 paso 6): celebración y temática (ids de la taxonomía o palabras
 * libres), formato de globo, parte, medidas aproximadas y de dónde sale el item. Los aprovecha la búsqueda de la
 * biblioteca con base de datos (`escena-ia-biblioteca.ts`); la búsqueda en memoria solo entiende la celebración.
 * Puro y sin red.
 */

export const FUENTES_PEDIBLES = ["referencias_dueno", "ideas_sempertex", "revista_celebra", "bases_organicas"] as const;
export type FuentePedible = (typeof FUENTES_PEDIBLES)[number];

/** Cada fuente pedible → el `fuente.tipo` con que quedó guardado en la biblioteca («bases orgánicas» son referencias web). */
export const TIPO_DE_FUENTE: Readonly<Record<FuentePedible, string>> = {
  referencias_dueno: "referencia-dueno",
  ideas_sempertex: "idea-sempertex",
  revista_celebra: "celebra",
  bases_organicas: "referencia-web",
};

/** Los campos que se suman al esquema de `buscar_en_biblioteca`. */
export const CAMPOS_FILTROS_BIBLIOTECA = {
  celebracion: z.string().trim().min(1).max(60).optional().describe("celebración por su id de la taxonomía («cumpleanos», «baby-shower», «quince-anos», «navidad») o en palabras («quince años», «día de la madre»)"),
  tematica: z.string().trim().min(1).max(60).optional().describe("temática por su id o en palabras («unicornio», «safari», «princesas», «bosque encantado»)"),
  formato: z.string().trim().min(1).max(40).optional().describe("formato o tamaño de globo que lleva («R-24», «R-12», «globos grandes», «link-o-loon»)"),
  parte: z.string().trim().min(1).max(40).optional().describe("parte de la estructura que tiene («hojas», «ramas», «pata izquierda»)"),
  alto_cm: z.number().min(10).max(3000).optional().describe("alto aproximado en cm (busca ±25 %)"),
  ancho_cm: z.number().min(10).max(3000).optional().describe("ancho aproximado en cm (busca ±25 %)"),
  fuente: z.enum(FUENTES_PEDIBLES).optional().describe("de dónde sale: referencias_dueno (fotos que pasó el dueño), ideas_sempertex (ideas de sempertex.com), revista_celebra (revista Celebra), bases_organicas (bases orgánicas de referencia)"),
};

/** Lo que el modelo necesita saber de cada repositorio para elegir (el manifiesto lo describe para las personas, más largo). */
const PISTA_DE_REPOSITORIO: Readonly<Partial<Record<IdRepositorio, string>>> = {
  sempertex: "ideas, estructuras y decoraciones de globos",
  mobiliario: "sillas, mesas, sofás",
  escenografia: "paneles, cortinas, aros, arcos metálicos, pedestales, pastel",
};

/**
 * El campo `repositorio` de `buscar_en_biblioteca` (REQ-013), que solo se declara con `CATALOGO_FILTRO_IA` (`catalogo/herramientas-ia.ts`).
 * Es un texto y no una enumeración: a Gemini le quedan pocos valores de enumeración (`test-esquema-gemini`); lo valida el servidor.
 */
export const campoRepositorio = (visibles: readonly IdRepositorio[]) =>
  z.string().trim().min(1).max(40).optional().describe(`repositorio del catálogo donde buscar: ${visibles.map((id) => `${id}${PISTA_DE_REPOSITORIO[id] ? ` (${PISTA_DE_REPOSITORIO[id]})` : ""}`).join("; ")}; sin él, en todos`);

export type FiltrosBibliotecaNuevos = {
  celebracion?: string;
  tematica?: string;
  formato?: string;
  parte?: string;
  alto_cm?: number;
  ancho_cm?: number;
  fuente?: FuentePedible;
};

/** Ids de celebración que dice un texto libre o un id (viejo o canónico); `[]` si no es una celebración conocida. */
export function celebracionesDePedido(texto: string): string[] {
  const exactas = idsCelebracionCanonicos(texto);
  return exactas.length ? exactas : celebracionesDeTexto(texto).map((c) => c.id);
}

/** Ids de temática que dice un texto libre o un id; `[]` si no es una temática conocida. */
export function tematicasDePedido(texto: string): string[] {
  const id = texto.trim().toLowerCase().replace(/\s+/g, "-");
  if (tematicaPorId(id)) return [id];
  return tematicasDeTexto(texto).map((t) => t.id);
}

const CLAVES_SIN_MEMORIA: ReadonlyArray<[keyof FiltrosBibliotecaNuevos, string]> = [
  ["tematica", "tematica"], ["formato", "formato"], ["parte", "parte"], ["alto_cm", "alto_cm"], ["ancho_cm", "ancho_cm"], ["fuente", "fuente"],
];

/** Aviso para la búsqueda en memoria: los filtros nuevos que trajo el pedido y que no se aplicaron (`""` si no hay). */
export function avisoFiltrosSinEfecto(a: FiltrosBibliotecaNuevos): string {
  const sin = CLAVES_SIN_MEMORIA.filter(([clave]) => a[clave] !== undefined).map(([, nombre]) => nombre);
  return sin.length ? `\n(Sin efecto en esta búsqueda: ${sin.join(", ")}. Busca por palabras en texto.)` : "";
}
