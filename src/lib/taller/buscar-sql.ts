import { RRF_K } from "@/lib/rag/retrieval/rrf";
import { MODELO_EMBEDDING_TALLER, vectorComoLiteral, type ConsultaSql } from "./indice";

/**
 * SQL de la búsqueda híbrida de la biblioteca del taller (REQ-002). PURO: arma el texto y los parámetros; quien ejecuta
 * es `buscar.ts`. Una sola sentencia, un solo viaje a Neon (el pool de 20 conexiones lo comparte el RAG de productos).
 *
 * Estructura:
 *  1. `filtrados`: los filtros DUROS se aplican una vez aquí (CTE MATERIALIZED) y TODAS las ramas se unen a ella, así
 *     ninguna rama puede devolver algo que el filtro excluye.
 *  2. Ramas: `fts` (tsvector español sin acentos, OR de palabras), `trigram` (nombre, sin acentos), `vector_texto`
 *     (modalidad texto) y `vector_imagen` (fotos y renders: mismo espacio que el texto en gemini-embedding-2).
 *     Solo existen las ramas pedidas; sin texto ni vectores hay una rama `filtro` (explorar por filtros).
 *  3. Fusión RRF dentro de SQL: Σ peso / (k + rango), con la MISMA fórmula y k que `rrf.ts` (`fusionarRankingsLocal`).
 *     Se hace en SQL y no con `rrf.ts` porque así solo salen de la base las ≤ `limite` filas finales (con sus rangos y
 *     puntajes por rama) en vez de ~4 listas de candidatos con todas sus columnas, y los refuerzos suaves del glosario se
 *     suman en el mismo lugar. El precio: la fusión no se prueba sin base; las pruebas fijan la forma del SQL.
 *  4. Refuerzos suaves (glosario → formatos, partes, tipos de pieza, colores): bono fijo si el item los trae. Nunca filtran.
 */

export type RamaId = "fts" | "trigram" | "vector_texto" | "vector_imagen" | "filtro";

export type FiltrosTaller = {
  tipos?: string[];
  tiposPieza?: string[];
  celebraciones?: string[];
  tematicas?: string[];
  formatos?: string[];
  partes?: string[];
  colores?: string[];
  altoMin?: number;
  altoMax?: number;
  anchoMin?: number;
  anchoMax?: number;
  fuente?: string[];
  /** Con valor: lo de fábrica MÁS lo de ese dueño. Sin valor: solo lo de fábrica. */
  propietario?: string | null;
  /** Solo lo del dueño (necesita `propietario`). */
  soloPropios?: boolean;
};

export type EntradaBusqueda = {
  texto?: string;
  filtros?: FiltrosTaller;
  limite?: number;
  vectorTexto?: readonly number[];
  vectorImagen?: readonly number[];
};

/** Lo que el glosario entendió de la consulta; refuerza, no filtra. Los formatos pueden ser familias («LOL-*»). */
export type RefuerzosSuaves = { formatos: string[]; partes: string[]; tiposPieza: string[]; colores: string[] };

export type ConsultaBusqueda = ConsultaSql & { ramas: RamaId[]; limite: number };

export const LIMITE_POR_DEFECTO = 12;
export const LIMITE_MAXIMO = 50;
/** Pesos de cada rama en la fusión. Sin evaluación todavía (plan §7): todos iguales salvo el trigram, que solo mira el nombre. */
export const PESOS_RAMA: Readonly<Record<RamaId, number>> = { fts: 1, trigram: 0.5, vector_texto: 1, vector_imagen: 1, filtro: 1 };
/** Cada tipo de refuerzo suma lo de un puesto 1 con peso 0,5 (≈ 0,0082): desempata, no vence a una rama. */
export const BONO_REFUERZO = 0.5 / (RRF_K + 1);
export const UMBRAL_TRIGRAM = 0.3;
const MAX_PALABRAS_FTS = 12;
const MAX_VALORES_FILTRO = 50;

class Parametros {
  readonly valores: unknown[] = [];
  agregar(valor: unknown, tipo?: string): string {
    this.valores.push(valor);
    return `$${this.valores.length}${tipo ? `::${tipo}` : ""}`;
  }
}

const limpiarLista = (lista: readonly string[] | undefined): string[] =>
  [...new Set((lista ?? []).map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))].slice(0, MAX_VALORES_FILTRO);

export function limiteSeguro(limite: number | undefined): number {
  return Number.isFinite(limite) ? Math.max(1, Math.min(LIMITE_MAXIMO, Math.trunc(limite as number))) : LIMITE_POR_DEFECTO;
}

/** Palabras del texto aptas para `to_tsquery` (solo letras y números), unidas con OR; `null` si no queda ninguna. */
export function consultaTsOr(texto: string): string | null {
  const palabras = [...new Set(texto.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 2))].slice(0, MAX_PALABRAS_FTS);
  return palabras.length ? palabras.join(" | ") : null;
}

/** «LOL-*» → patrón LIKE «LOL-%» (el «_» y el «%» literales se escapan). */
export function patronLike(formato: string): string {
  return formato.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "%");
}

function condicionesDuras(f: FiltrosTaller, p: Parametros): string[] {
  const c = ["t.activo"];
  if (f.soloPropios) {
    if (!f.propietario) throw new Error("soloPropios necesita propietario.");
    c.push(`t.propietario = ${p.agregar(f.propietario, "text")}`);
  } else if (f.propietario) c.push(`(t.propietario IS NULL OR t.propietario = ${p.agregar(f.propietario, "text")})`);
  else c.push("t.propietario IS NULL");

  const igual = (columna: string, lista: string[] | undefined) => {
    const valores = limpiarLista(lista);
    if (valores.length) c.push(`${columna} = ANY(${p.agregar(valores, "text[]")})`);
  };
  const solapa = (columna: string, lista: string[] | undefined) => {
    const valores = limpiarLista(lista);
    if (valores.length) c.push(`${columna} && ${p.agregar(valores, "text[]")}`);
  };
  igual("t.tipo", f.tipos);
  igual("t.fuente_tipo", f.fuente);
  solapa("t.tipos_pieza", f.tiposPieza);
  solapa("t.celebraciones", f.celebraciones);
  solapa("t.tematicas", f.tematicas);
  solapa("t.formatos", f.formatos);
  solapa("t.partes", f.partes);
  solapa("t.colores", f.colores);
  const rango = (columna: string, operador: ">=" | "<=", valor: number | undefined) => {
    if (typeof valor === "number" && Number.isFinite(valor)) c.push(`${columna} ${operador} ${p.agregar(valor, "numeric")}`);
  };
  rango("t.alto_cm", ">=", f.altoMin);
  rango("t.alto_cm", "<=", f.altoMax);
  rango("t.ancho_cm", ">=", f.anchoMin);
  rango("t.ancho_cm", "<=", f.anchoMax);
  return c;
}

/** Una rama: toma `interior` (id, puntaje ya acotado con LIMIT) y le pone el rango 1…n. */
const rama = (nombre: string, interior: string) =>
  `${nombre} AS (\n  SELECT id, puntaje, row_number() OVER (ORDER BY puntaje DESC, id) AS rango\n  FROM (\n${interior}\n  ) c\n)`;

export function construirConsultaBusqueda(entrada: EntradaBusqueda, refuerzos: RefuerzosSuaves = { formatos: [], partes: [], tiposPieza: [], colores: [] }): ConsultaBusqueda {
  const p = new Parametros();
  const limite = limiteSeguro(entrada.limite);
  const filtros = entrada.filtros ?? {};
  const texto = (entrada.texto ?? "").trim();
  const ctes: string[] = [];
  const ramas: RamaId[] = [];

  ctes.push(`filtrados AS MATERIALIZED (\n  SELECT t.id FROM taller_items t\n  WHERE ${condicionesDuras(filtros, p).join("\n    AND ")}\n)`);

  const porRama = p.agregar(Math.min(150, Math.max(40, limite * 3)), "integer");

  const tsQuery = texto ? consultaTsOr(texto) : null;
  if (tsQuery) {
    const q = p.agregar(tsQuery, "text");
    ramas.push("fts");
    ctes.push(rama("fts", `    SELECT t.id, ts_rank_cd(t.search_tsv, q.consulta) AS puntaje
    FROM filtrados f
    JOIN taller_items t ON t.id = f.id
    CROSS JOIN (SELECT to_tsquery('spanish_unaccent', ${q}) AS consulta) q
    WHERE t.search_tsv @@ q.consulta
    ORDER BY puntaje DESC, t.id
    LIMIT ${porRama}`));
  }

  if (texto) {
    const q = p.agregar(texto.slice(0, 200), "text");
    ramas.push("trigram");
    ctes.push(rama("trigram", `    SELECT t.id, s.similitud AS puntaje
    FROM filtrados f
    JOIN taller_items t ON t.id = f.id
    CROSS JOIN (SELECT lower(unaccent(${q})) AS q) consulta
    CROSS JOIN LATERAL (SELECT GREATEST(similarity(lower(unaccent(t.nombre)), consulta.q), word_similarity(consulta.q, lower(unaccent(t.nombre)))) AS similitud) s
    WHERE s.similitud >= ${p.agregar(UMBRAL_TRIGRAM, "real")}
    ORDER BY puntaje DESC, t.id
    LIMIT ${porRama}`));
  }

  let modelo: string | null = null;
  const parametroModelo = () => (modelo ??= p.agregar(MODELO_EMBEDDING_TALLER, "text"));
  if (entrada.vectorTexto) {
    const v = p.agregar(vectorComoLiteral(entrada.vectorTexto), "vector");
    ramas.push("vector_texto");
    ctes.push(rama("vector_texto", `    SELECT e.item_id AS id, 1 - (e.vector <=> ${v}) AS puntaje
    FROM taller_items_embeddings e
    JOIN filtrados f ON f.id = e.item_id
    WHERE e.modalidad = 'texto' AND e.modelo = ${parametroModelo()}
    ORDER BY e.vector <=> ${v}, e.item_id
    LIMIT ${porRama}`));
  }
  if (entrada.vectorImagen) {
    const v = p.agregar(vectorComoLiteral(entrada.vectorImagen), "vector");
    ramas.push("vector_imagen");
    // `<> 'texto'` calza con el índice HNSW parcial de las imágenes (028); un item tiene foto y render: gana la mejor.
    ctes.push(rama("vector_imagen", `    SELECT id, MAX(puntaje) AS puntaje
    FROM (
      SELECT e.item_id AS id, 1 - (e.vector <=> ${v}) AS puntaje
      FROM taller_items_embeddings e
      JOIN filtrados f ON f.id = e.item_id
      WHERE e.modalidad <> 'texto' AND e.modelo = ${parametroModelo()}
      ORDER BY e.vector <=> ${v}, e.item_id
      LIMIT ${porRama} * 2
    ) m
    GROUP BY id
    ORDER BY puntaje DESC, id
    LIMIT ${porRama}`));
  }
  if (!ramas.length) {
    ramas.push("filtro");
    ctes.push(rama("filtro", `    SELECT t.id, 0::float8 AS puntaje FROM filtrados f JOIN taller_items t ON t.id = f.id ORDER BY t.id LIMIT ${porRama}`));
  }

  const union = ramas
    .map((r) => `SELECT id, '${r}'::text AS rama, rango::integer AS rango, puntaje::float8 AS puntaje, ${PESOS_RAMA[r]}::float8 AS peso FROM ${r}`)
    .join("\n  UNION ALL\n  ");
  const porRamaColumnas = ramas
    .map((r) => `MIN(rango) FILTER (WHERE rama = '${r}') AS rango_${r},\n    MAX(puntaje) FILTER (WHERE rama = '${r}') AS puntaje_${r}`)
    .join(",\n    ");
  ctes.push(`ramas AS (\n  ${union}\n)`);
  ctes.push(`fusion AS (\n  SELECT id, SUM(peso / (${RRF_K} + rango)) AS rrf,\n    ${porRamaColumnas}\n  FROM ramas\n  GROUP BY id\n)`);

  const refuerzo: string[] = [];
  const bono: string[] = [];
  const agregarRefuerzo = (nombre: string, condicion: string) => {
    refuerzo.push(`${condicion} AS refuerzo_${nombre}`);
    bono.push(`CASE WHEN ${condicion} THEN ${BONO_REFUERZO} ELSE 0 END`);
  };
  if (refuerzos.formatos.length) agregarRefuerzo("formatos", `EXISTS (SELECT 1 FROM unnest(t.formatos) AS x(f) WHERE x.f LIKE ANY(${p.agregar(refuerzos.formatos.map(patronLike), "text[]")}))`);
  if (refuerzos.partes.length) agregarRefuerzo("partes", `t.partes && ${p.agregar(refuerzos.partes, "text[]")}`);
  if (refuerzos.tiposPieza.length) agregarRefuerzo("tipos", `t.tipos_pieza && ${p.agregar(refuerzos.tiposPieza, "text[]")}`);
  if (refuerzos.colores.length) agregarRefuerzo("colores", `t.colores && ${p.agregar(refuerzos.colores, "text[]")}`);

  const columnasRamas = ramas.flatMap((r) => [`fu.rango_${r}`, `fu.puntaje_${r}`]);
  const puntaje = ["fu.rrf", ...bono].join(" + ");
  const limiteFinal = p.agregar(limite, "integer");

  const sql = `WITH ${ctes.join(",\n")}
SELECT s.*
FROM (
  SELECT t.id, t.tipo, t.nombre, t.descripcion, t.fuente_tipo, t.fuente_titulo, t.fuente_url, t.foto_url,
    t.ocasiones, t.celebraciones, t.tematicas, t.tipos_pieza, t.formatos, t.colores, t.partes, t.productos,
    t.alto_cm::float8 AS alto_cm, t.ancho_cm::float8 AS ancho_cm, t.fondo_cm::float8 AS fondo_cm,
    t.globos, t.tubos, t.propietario,
    ${puntaje} AS puntaje, fu.rrf,
    ${[...columnasRamas, ...refuerzo].join(",\n    ")}
  FROM fusion fu
  JOIN taller_items t ON t.id = fu.id
) s
ORDER BY s.puntaje DESC, s.id
LIMIT ${limiteFinal}`;

  return { texto: sql, valores: p.valores, ramas, limite };
}
