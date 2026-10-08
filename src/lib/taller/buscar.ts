import type { Pool } from "pg";
import { TALLER_RAG_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { interpretarTerminos, type Interpretacion } from "@/lib/globos3d/glosario-taller";
import { buscarEnBiblioteca, type FiltroIA } from "@/lib/globos3d/herramientas-escena-biblioteca";
import type { ItemBiblioteca, TipoItem } from "@/lib/globos3d/biblioteca";
import type { TipoPieza } from "@/lib/globos3d/piezas";
import { RRF_K } from "@/lib/rag/retrieval/rrf";
import {
  construirConsultaBusqueda,
  limiteSeguro,
  type EntradaBusqueda,
  type FiltrosTaller,
  type RamaId,
  type RefuerzosSuaves,
} from "./buscar-sql";

/**
 * Búsqueda de la biblioteca del taller 3D (REQ-002): Postgres (híbrida: palabras + nombre + vectores, ver
 * `buscar-sql.ts`) con la bandera `TALLER_RAG_ENABLED`, y la búsqueda en memoria de siempre (`buscarEnBiblioteca`)
 * cuando está apagada o la base falla. Las dos devuelven la MISMA forma; `fuente` dice cuál respondió.
 */

export type { EntradaBusqueda, FiltrosTaller, RamaId } from "./buscar-sql";

export type PuntajeRama = { rango: number; puntaje: number };

export type ResultadoTaller = {
  id: string;
  tipo: string;
  nombre: string;
  descripcion: string;
  /** De dónde salió el item (no confundir con `fuente` de la respuesta, que dice qué buscador respondió). */
  origen: { tipo: string | null; titulo: string | null; url: string | null; foto: string | null };
  ocasiones: string[];
  celebraciones: string[];
  tematicas: string[];
  tiposPieza: string[];
  formatos: string[];
  colores: string[];
  partes: string[];
  productos: string[];
  medidas: { altoCm: number | null; anchoCm: number | null; fondoCm: number | null };
  globos: number;
  tubos: number;
  propietario: string | null;
  puntaje: number;
  ramas: Record<Exclude<RamaId, "filtro">, PuntajeRama | null>;
  razones: string[];
};

export type RespuestaBusquedaTaller = {
  fuente: "rag" | "memoria";
  resultados: ResultadoTaller[];
  ids: string[];
  ramas: RamaId[];
  /** Lo que entendió el glosario (refuerzos suaves), para mostrarlo o depurar. */
  interpretacion: { formatos: string[]; partes: string[]; tiposPieza: string[]; colores: string[]; notas: string[] } | null;
  avisos: string[];
};

export type DependenciasBuscar = {
  /** Por defecto `TALLER_RAG_ENABLED`. */
  habilitado?: boolean;
  /** Por defecto el pool del RAG (`getRagPool`, importado al usarlo). */
  obtenerPool?: () => Promise<Pick<Pool, "query">> | Pick<Pool, "query">;
  memoria?: (filtro: FiltroIA) => ItemBiblioteca[];
  interpretar?: (texto: string) => Interpretacion;
};

type Fila = Record<string, unknown>;

const FILTROS_SIN_MEMORIA: ReadonlyArray<[keyof FiltrosTaller, string]> = [
  ["tematicas", "temáticas"], ["formatos", "formatos"], ["partes", "partes"], ["altoMin", "alto mínimo"], ["altoMax", "alto máximo"],
  ["anchoMin", "ancho mínimo"], ["anchoMax", "ancho máximo"], ["propietario", "propietario"],
];

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numeroONulo = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const textoONulo = (v: unknown): string | null => (typeof v === "string" ? v : null);

// ----------------------------------------------------------------------------------------------------------
// Glosario → refuerzos suaves
// ----------------------------------------------------------------------------------------------------------

export function refuerzosDeInterpretacion(i: Interpretacion): RefuerzosSuaves {
  return {
    formatos: [...new Set(i.formatos)],
    partes: [...new Set(i.partes)],
    tiposPieza: [...new Set(i.tipos as string[])],
    colores: [...new Set(i.colores.flatMap((c) => c.codigos))],
  };
}

const sinRefuerzos = (r: RefuerzosSuaves) => !r.formatos.length && !r.partes.length && !r.tiposPieza.length && !r.colores.length;

// ----------------------------------------------------------------------------------------------------------
// Filas de la base → respuesta
// ----------------------------------------------------------------------------------------------------------

const RAMAS_FILA: ReadonlyArray<Exclude<RamaId, "filtro">> = ["fts", "trigram", "vector_texto", "vector_imagen"];

function puntajeDeRama(fila: Fila, rama: RamaId): PuntajeRama | null {
  const rango = numeroONulo(fila[`rango_${rama}`]);
  const puntaje = numeroONulo(fila[`puntaje_${rama}`]);
  return rango === null || puntaje === null ? null : { rango, puntaje };
}

const redondeo = (n: number) => Math.round(n * 1000) / 1000;

function razonesDe(fila: Fila, ramas: Record<Exclude<RamaId, "filtro">, PuntajeRama | null>, refuerzos: RefuerzosSuaves, filtros: FiltrosTaller): string[] {
  const r: string[] = [];
  if (ramas.fts) r.push(`Las palabras de la consulta están en su nombre, celebración o ficha (puesto ${ramas.fts.rango} por texto)`);
  if (ramas.trigram) r.push(`Su nombre se parece a la consulta (similitud ${redondeo(ramas.trigram.puntaje)})`);
  if (ramas.vector_texto) r.push(`Su significado está cerca de lo pedido (coseno ${redondeo(ramas.vector_texto.puntaje)}, puesto ${ramas.vector_texto.rango})`);
  if (ramas.vector_imagen) r.push(`Se parece a la foto (coseno ${redondeo(ramas.vector_imagen.puntaje)}, puesto ${ramas.vector_imagen.rango})`);
  if (fila.refuerzo_formatos === true) r.push(`Trae los formatos pedidos (${refuerzos.formatos.join(", ")})`);
  if (fila.refuerzo_partes === true) r.push(`Tiene las partes pedidas (${refuerzos.partes.join(", ")})`);
  if (fila.refuerzo_tipos === true) r.push(`Es del tipo de pieza pedido (${refuerzos.tiposPieza.join(", ")})`);
  if (fila.refuerzo_colores === true) r.push(`Usa los colores pedidos (${refuerzos.colores.join(", ")})`);
  const aplicados = (Object.entries(filtros) as Array<[string, unknown]>).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false));
  if (aplicados.length) r.push(`Cumple los filtros: ${aplicados.map(([k]) => k).join(", ")}`);
  return r;
}

export function resultadoDeFila(fila: Fila, refuerzos: RefuerzosSuaves, filtros: FiltrosTaller): ResultadoTaller {
  const ramas = Object.fromEntries(RAMAS_FILA.map((rama) => [rama, puntajeDeRama(fila, rama)])) as Record<Exclude<RamaId, "filtro">, PuntajeRama | null>;
  return {
    id: String(fila.id),
    tipo: String(fila.tipo),
    nombre: String(fila.nombre),
    descripcion: textoONulo(fila.descripcion) ?? "",
    origen: { tipo: textoONulo(fila.fuente_tipo), titulo: textoONulo(fila.fuente_titulo), url: textoONulo(fila.fuente_url), foto: textoONulo(fila.foto_url) },
    ocasiones: lista(fila.ocasiones),
    celebraciones: lista(fila.celebraciones),
    tematicas: lista(fila.tematicas),
    tiposPieza: lista(fila.tipos_pieza),
    formatos: lista(fila.formatos),
    colores: lista(fila.colores),
    partes: lista(fila.partes),
    productos: lista(fila.productos),
    medidas: { altoCm: numeroONulo(fila.alto_cm), anchoCm: numeroONulo(fila.ancho_cm), fondoCm: numeroONulo(fila.fondo_cm) },
    globos: numeroONulo(fila.globos) ?? 0,
    tubos: numeroONulo(fila.tubos) ?? 0,
    propietario: textoONulo(fila.propietario),
    puntaje: Number(fila.puntaje) || 0,
    ramas,
    razones: razonesDe(fila, ramas, refuerzos, filtros),
  };
}

// ----------------------------------------------------------------------------------------------------------
// Búsqueda en memoria (la de hoy), con la misma forma de respuesta
// ----------------------------------------------------------------------------------------------------------

const SIN_RAMAS: ResultadoTaller["ramas"] = { fts: null, trigram: null, vector_texto: null, vector_imagen: null };

function resultadoDeItemMemoria(item: ItemBiblioteca, posicion: number): ResultadoTaller {
  return {
    id: item.id,
    tipo: item.tipo,
    nombre: item.nombre,
    descripcion: item.descripcion,
    origen: { tipo: item.fuente?.tipo ?? null, titulo: item.fuente?.titulo ?? null, url: item.fuente?.url ?? null, foto: item.fuente?.fotoUrl ?? null },
    ocasiones: item.ocasiones,
    celebraciones: [],
    tematicas: [],
    tiposPieza: [],
    formatos: [],
    colores: [],
    partes: [],
    productos: [],
    medidas: { altoCm: null, anchoCm: null, fondoCm: null },
    globos: 0,
    tubos: 0,
    propietario: item.propio ? "navegador" : null,
    puntaje: 1 / (RRF_K + posicion + 1),
    ramas: SIN_RAMAS,
    razones: ["Búsqueda por palabras en memoria del servidor (sin base de datos)"],
  };
}

function buscarEnMemoria(entrada: EntradaBusqueda, memoria: (f: FiltroIA) => ItemBiblioteca[], motivo: string | null): RespuestaBusquedaTaller {
  const filtros = entrada.filtros ?? {};
  const limite = limiteSeguro(entrada.limite);
  const avisos: string[] = [];
  if (motivo) avisos.push(motivo);
  const ignorados = FILTROS_SIN_MEMORIA.filter(([clave]) => {
    const v = filtros[clave];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;
  }).map(([, nombre]) => nombre);
  if (ignorados.length) avisos.push(`La búsqueda en memoria ignora estos filtros: ${ignorados.join(", ")}.`);
  if (entrada.vectorTexto || entrada.vectorImagen) avisos.push("La búsqueda en memoria no usa vectores.");
  if (limite > 15) avisos.push("La búsqueda en memoria devuelve como mucho 15 por tipo.");

  const colores = (filtros.colores ?? []).map((c) => [c]);
  const tipos: Array<TipoItem | undefined> = filtros.tipos?.length ? (filtros.tipos as TipoItem[]) : [undefined];
  const ocasiones: Array<string | undefined> = filtros.celebraciones?.length ? filtros.celebraciones : [undefined];
  const vistos = new Map<string, ItemBiblioteca>();
  for (const tipo of tipos) {
    for (const ocasion of ocasiones) {
      const encontrados = memoria({
        ...(entrada.texto?.trim() ? { texto: entrada.texto } : {}),
        ...(tipo ? { tipo } : {}),
        ...(ocasion ? { ocasion } : {}),
        ...(colores.length ? { colores } : {}),
        ...(filtros.tiposPieza?.[0] ? { tipoPieza: filtros.tiposPieza[0] as TipoPieza } : {}),
        limite,
      });
      for (const item of encontrados) if (!vistos.has(item.id)) vistos.set(item.id, item);
    }
  }
  const fuentes = filtros.fuente?.length ? new Set(filtros.fuente) : null;
  const items = [...vistos.values()].filter((i) => !fuentes || (i.fuente && fuentes.has(i.fuente.tipo))).slice(0, limite);
  const resultados = items.map(resultadoDeItemMemoria);
  return { fuente: "memoria", resultados, ids: resultados.map((r) => r.id), ramas: [], interpretacion: null, avisos };
}

// ----------------------------------------------------------------------------------------------------------
// Entrada principal
// ----------------------------------------------------------------------------------------------------------

async function poolPorDefecto(): Promise<Pick<Pool, "query">> {
  const { getRagPool } = await import("@/lib/rag/db");
  return getRagPool();
}

export async function buscarEnTaller(entrada: EntradaBusqueda, dependencias: DependenciasBuscar = {}): Promise<RespuestaBusquedaTaller> {
  const memoria = dependencias.memoria ?? buscarEnBiblioteca;
  if (!(dependencias.habilitado ?? TALLER_RAG_ENABLED)) return buscarEnMemoria(entrada, memoria, null);

  const texto = (entrada.texto ?? "").trim();
  const interpretacion = texto ? (dependencias.interpretar ?? interpretarTerminos)(texto) : null;
  const refuerzos = interpretacion ? refuerzosDeInterpretacion(interpretacion) : { formatos: [], partes: [], tiposPieza: [], colores: [] };

  // Fuera del try: una entrada inválida (vector de otro tamaño) es error de quien llama, no motivo para caer a memoria.
  const consulta = construirConsultaBusqueda(entrada, refuerzos);
  try {
    const pool = await (dependencias.obtenerPool ?? poolPorDefecto)();
    const { rows } = await pool.query(consulta.texto, consulta.valores);
    const resultados = (rows as Fila[]).map((fila) => resultadoDeFila(fila, refuerzos, entrada.filtros ?? {}));
    return {
      fuente: "rag",
      resultados,
      ids: resultados.map((r) => r.id),
      ramas: consulta.ramas,
      interpretacion: interpretacion && !sinRefuerzos(refuerzos) ? { ...refuerzos, notas: interpretacion.notas } : null,
      avisos: [],
    };
  } catch (error) {
    console.warn("[taller-rag] la base falló; se busca en memoria", { mensaje: error instanceof Error ? error.message : String(error) });
    return buscarEnMemoria(entrada, memoria, "La base de datos de la biblioteca no respondió; se buscó en memoria.");
  }
}
