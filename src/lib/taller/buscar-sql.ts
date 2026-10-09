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
 *     puntajes por rama) en vez de ~4 listas de candidatos con todas sus columnas, y los refuerzos suaves se suman en el
 *     mismo lugar. El precio: la fusión no se prueba sin base; las pruebas fijan la forma del SQL y
 *     `scripts/taller/evaluar-rag-local.ts` la ejecuta de verdad sobre PGlite.
 *  4. Refuerzos suaves (glosario y `entender-consulta.ts` → formatos, partes, tipos de pieza, colores, celebraciones,
 *     temáticas, fuente, medida): bono si el item los trae. Nunca filtran.
 *  5. Fragmentos (`escena~pieza`): un fragmento comparte etiquetas y casi todo el texto con su escena y llenaba la lista
 *     de hermanos. Se agrupan por familia: la escena entera (se agrega aunque ninguna rama la haya traído) hereda
 *     `promocionPadre` × el puntaje de su mejor fragmento, y cada fragmento se multiplica por `factorHermano` elevado a su
 *     puesto entre los de su familia. Nada se quita: si la consulta pide la pieza, sigue ahí, justo detrás de su escena.
 */

export type RamaId = "fts" | "trigram" | "vector_texto" | "vector_imagen" | "filtro";

export type FiltrosTaller = {
  tipos?: string[];
  tiposPieza?: string[];
  /** Cómo se llama la pieza pedida («arco», «columna»): los items que lo llevan en el nombre ganan. */
  nombresPieza?: string[];
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

/**
 * Lo que se entendió de la consulta (glosario y `entender-consulta.ts`); refuerza, no filtra. Los formatos pueden ser
 * familias («LOL-*»). Las medidas son en cm: puntúan más cuanto más cerca esté el alto o el ancho del item.
 */
export type RefuerzosSuaves = {
  formatos: string[];
  partes: string[];
  tiposPieza: string[];
  colores: string[];
  celebraciones?: string[];
  tematicas?: string[];
  fuentes?: string[];
  altoCm?: number | null;
  anchoCm?: number | null;
  /** Palabras de la taxonomía (celebración, temática) que se suman al OR del texto: la ficha las lleva y la consulta no. */
  palabrasExtra?: string[];
};

export type ConsultaBusqueda = ConsultaSql & { ramas: RamaId[]; limite: number };

export const LIMITE_POR_DEFECTO = 12;
export const LIMITE_MAXIMO = 50;
/** Cada tipo de refuerzo suma lo de un puesto 1 con peso 0,5 (≈ 0,0082): desempata, no vence a una rama. */
export const BONO_REFUERZO = 0.5 / (RRF_K + 1);

/**
 * Lo que se afina con el oro (`scripts/taller/evaluar-rag-local.ts`): pesos de las ramas y bonos de los refuerzos (en
 * múltiplos de `BONO_REFUERZO`). Se pasa entero o a pedazos a `construirConsultaBusqueda`; los valores por defecto salen
 * de la evaluación con el oro de desarrollo y se comprobaron contra el de reserva.
 */
export type Afinado = {
  pesos: Readonly<Record<RamaId, number>>;
  bonos: { nombrePieza: number; formatos: number; partes: number; tiposPieza: number; colores: number; celebraciones: number; tematicas: number; fuentes: number; medida: number };
  /** Lo que conserva de su puntaje un fragmento, elevado a su puesto entre los fragmentos de su escena (0…1; 1 = no se agrupa). */
  factorHermano: number;
  /** Fracción del puntaje de su mejor fragmento que hereda la escena entera (0 = no hereda). */
  promocionPadre: number;
  /** Candidatos mínimos por rama (`CANDIDATOS_MAXIMO` es el tope). */
  candidatos: number;
};

export const AFINADO_POR_DEFECTO: Afinado = {
  // El vector de texto pesa más que las palabras (entiende «grado» = graduación, «cumple de sirena»); el trigram solo mira el nombre.
  pesos: { fts: 1, trigram: 0.5, vector_texto: 1.5, vector_imagen: 1, filtro: 1 },
  // Medida, fuente y celebración nombradas a las claras pesan más que el color o el tipo de pieza (que casi todo lleva).
  bonos: { nombrePieza: 2, formatos: 2, partes: 1, tiposPieza: 1, colores: 1, celebraciones: 2, tematicas: 1.5, fuentes: 3, medida: 6 },
  factorHermano: 0.7,
  promocionPadre: 0.8,
  candidatos: 200,
};
export const PESOS_RAMA: Readonly<Record<RamaId, number>> = AFINADO_POR_DEFECTO.pesos;
export const CANDIDATOS_MAXIMO = 300;
export const UMBRAL_TRIGRAM = 0.3;
const MAX_PALABRAS_FTS = 16;
const MAX_VALORES_FILTRO = 50;
/** Tolerancia de la medida: el bono baja linealmente a 0 a esta distancia (cm), con un mínimo de 25 cm. */
const TOLERANCIA_MEDIDA = 0.15;
const TOLERANCIA_MINIMA_CM = 25;

export const SIN_REFUERZOS: RefuerzosSuaves = { formatos: [], partes: [], tiposPieza: [], colores: [] };

export function fusionarAfinado(parcial: Partial<Afinado> = {}): Afinado {
  return {
    pesos: { ...AFINADO_POR_DEFECTO.pesos, ...parcial.pesos },
    bonos: { ...AFINADO_POR_DEFECTO.bonos, ...parcial.bonos },
    factorHermano: parcial.factorHermano ?? AFINADO_POR_DEFECTO.factorHermano,
    promocionPadre: parcial.promocionPadre ?? AFINADO_POR_DEFECTO.promocionPadre,
    candidatos: parcial.candidatos ?? AFINADO_POR_DEFECTO.candidatos,
  };
}

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

/**
 * Palabras del texto aptas para `to_tsquery` (solo letras y números), unidas con OR; `null` si no queda ninguna. Las
 * `extra` (palabras de la taxonomía) se suman al final sin repetir.
 */
export function consultaTsOr(texto: string, extra: readonly string[] = []): string | null {
  const palabras = [...new Set([...texto.toLowerCase().split(/[^\p{L}\p{N}]+/u), ...extra.map((e) => e.toLowerCase())].filter((p) => p.length >= 2))].slice(0, MAX_PALABRAS_FTS);
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

/** Cercanía (0…1) del alto o ancho del item a la medida pedida: 1 si coincide, 0 a la tolerancia o más lejos (o sin medida). */
function cercaniaMedida(columna: "t.alto_cm" | "t.ancho_cm", cm: number, p: Parametros): string {
  const pedido = p.agregar(cm, "numeric");
  const tolerancia = p.agregar(Math.max(TOLERANCIA_MINIMA_CM, cm * TOLERANCIA_MEDIDA), "numeric");
  return `COALESCE(GREATEST(0, 1 - ABS(${columna} - ${pedido}) / ${tolerancia}), 0)`;
}

export function construirConsultaBusqueda(entrada: EntradaBusqueda, refuerzos: RefuerzosSuaves = SIN_REFUERZOS, ajuste: Partial<Afinado> = {}): ConsultaBusqueda {
  const afinado = fusionarAfinado(ajuste);
  const p = new Parametros();
  const limite = limiteSeguro(entrada.limite);
  const filtros = entrada.filtros ?? {};
  const texto = (entrada.texto ?? "").trim();
  const ctes: string[] = [];
  const ramas: RamaId[] = [];

  ctes.push(`filtrados AS MATERIALIZED (\n  SELECT t.id FROM taller_items t\n  WHERE ${condicionesDuras(filtros, p).join("\n    AND ")}\n)`);

  const porRama = p.agregar(Math.min(CANDIDATOS_MAXIMO, Math.max(afinado.candidatos, limite * 3)), "integer");

  const tsQuery = texto ? consultaTsOr(texto, refuerzos.palabrasExtra) : null;
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
    .map((r) => `SELECT id, '${r}'::text AS rama, rango::integer AS rango, puntaje::float8 AS puntaje, ${afinado.pesos[r]}::float8 AS peso FROM ${r}`)
    .join("\n  UNION ALL\n  ");
  const porRamaColumnas = ramas
    .map((r) => `MIN(rango) FILTER (WHERE rama = '${r}') AS rango_${r},\n    MAX(puntaje) FILTER (WHERE rama = '${r}') AS puntaje_${r}`)
    .join(",\n    ");
  ctes.push(`ramas AS (\n  ${union}\n)`);
  ctes.push(`fusion AS (\n  SELECT id, SUM(peso / (${RRF_K} + rango)) AS rrf,\n    ${porRamaColumnas}\n  FROM ramas\n  GROUP BY id\n)`);
  const promocion = afinado.promocionPadre;
  if (promocion > 0) {
    // La escena entera de cada fragmento candidato entra aunque ninguna rama la haya traído (si pasa los filtros duros).
    const nulos = ramas.map((r) => `NULL::integer AS rango_${r}, NULL::float8 AS puntaje_${r}`).join(", ");
    ctes.push(`candidatos AS (
  SELECT * FROM fusion
  UNION ALL
  SELECT pa.id, 0::float8 AS rrf, ${nulos}
  FROM (SELECT DISTINCT split_part(x.id, '~', 1) AS id FROM fusion x JOIN taller_items xt ON xt.id = x.id WHERE position('~' in x.id) > 0 AND xt.tipo <> 'utileria') pa
  JOIN filtrados f ON f.id = pa.id
  WHERE NOT EXISTS (SELECT 1 FROM fusion y WHERE y.id = pa.id)
)`);
  }

  const refuerzo: string[] = [];
  const bono: string[] = [];
  const agregarRefuerzo = (nombre: string, condicion: string, multiplo: number, expresionBono?: string) => {
    refuerzo.push(`${condicion} AS refuerzo_${nombre}`);
    bono.push(expresionBono ?? `CASE WHEN ${condicion} THEN ${BONO_REFUERZO * multiplo} ELSE 0 END`);
  };
  const b = afinado.bonos;
  if (refuerzos.formatos.length) agregarRefuerzo("formatos", `EXISTS (SELECT 1 FROM unnest(t.formatos) AS x(f) WHERE x.f LIKE ANY(${p.agregar(refuerzos.formatos.map(patronLike), "text[]")}))`, b.formatos);
  if (refuerzos.partes.length) agregarRefuerzo("partes", `t.partes && ${p.agregar(refuerzos.partes, "text[]")}`, b.partes);
  if (refuerzos.tiposPieza.length) agregarRefuerzo("tipos", `t.tipos_pieza && ${p.agregar(refuerzos.tiposPieza, "text[]")}`, b.tiposPieza);
  if (refuerzos.colores.length) agregarRefuerzo("colores", `t.colores && ${p.agregar(refuerzos.colores, "text[]")}`, b.colores);
  if (refuerzos.celebraciones?.length) agregarRefuerzo("celebraciones", `t.celebraciones && ${p.agregar(refuerzos.celebraciones, "text[]")}`, b.celebraciones);
  if (refuerzos.tematicas?.length) agregarRefuerzo("tematicas", `t.tematicas && ${p.agregar(refuerzos.tematicas, "text[]")}`, b.tematicas);
  if (refuerzos.fuentes?.length) agregarRefuerzo("fuentes", `t.fuente_tipo = ANY(${p.agregar(refuerzos.fuentes, "text[]")})`, b.fuentes);
  if (refuerzos.nombresPieza?.length) {
    // `\y` = límite de palabra: «arco» no suma «arcoíris».
    agregarRefuerzo("nombre_pieza", `lower(unaccent(t.nombre)) ~ ANY(${p.agregar(refuerzos.nombresPieza.map((n) => `\\y${n.replace(/[^a-z0-9 ]/g, "")}`), "text[]")})`, b.nombrePieza);
  }
  const cercanias: string[] = [];
  if (typeof refuerzos.altoCm === "number") cercanias.push(cercaniaMedida("t.alto_cm", refuerzos.altoCm, p));
  if (typeof refuerzos.anchoCm === "number") cercanias.push(cercaniaMedida("t.ancho_cm", refuerzos.anchoCm, p));
  if (cercanias.length) {
    const suma = cercanias.join(" + ");
    agregarRefuerzo("medida", `(${suma}) > 0`, b.medida, `(${suma}) * ${BONO_REFUERZO * b.medida}`);
  }

  const columnasRamas = ramas.flatMap((r) => [`fu.rango_${r}`, `fu.puntaje_${r}`]);
  const puntajeBase = ["fu.rrf", ...bono].join(" + ");
  const limiteFinal = p.agregar(limite, "integer");
  const factor = afinado.factorHermano;
  const origen = promocion > 0 ? "candidatos" : "fusion";

  const sql = `WITH ${ctes.join(",\n")}
SELECT s.*
FROM (
  SELECT h.*, CASE WHEN h.es_fragmento THEN h.puntaje_base * power(${factor}::float8, h.puesto)
    ELSE GREATEST(h.puntaje_base, ${promocion}::float8 * COALESCE(h.mejor_fragmento, 0)) END AS puntaje
  FROM (
    SELECT i.*,
      MAX(CASE WHEN i.es_fragmento THEN i.puntaje_base END) OVER (PARTITION BY split_part(i.id, '~', 1)) AS mejor_fragmento,
      row_number() OVER (PARTITION BY split_part(i.id, '~', 1), i.es_fragmento ORDER BY i.puntaje_base DESC, i.id) AS puesto
    FROM (
      SELECT t.id, t.tipo, t.nombre, t.descripcion, t.fuente_tipo, t.fuente_titulo, t.fuente_url, t.foto_url,
        t.ocasiones, t.celebraciones, t.tematicas, t.tipos_pieza, t.formatos, t.colores, t.partes, t.productos,
        t.alto_cm::float8 AS alto_cm, t.ancho_cm::float8 AS ancho_cm, t.fondo_cm::float8 AS fondo_cm,
        t.globos, t.tubos, t.propietario,
        (position('~' in t.id) > 0 AND t.tipo <> 'utileria') AS es_fragmento,
        ${puntajeBase} AS puntaje_base, fu.rrf,
        ${[...columnasRamas, ...refuerzo].join(",\n        ")}
      FROM ${origen} fu
      JOIN taller_items t ON t.id = fu.id
    ) i
  ) h
) s
ORDER BY s.puntaje DESC, s.id
LIMIT ${limiteFinal}`;

  return { texto: sql, valores: p.valores, ramas, limite };
}
