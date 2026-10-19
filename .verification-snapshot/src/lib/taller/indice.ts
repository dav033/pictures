import { createHash } from "node:crypto";
import { esIdRepositorio } from "@/lib/catalogo/ids";
import type { IdRepositorio } from "@/lib/catalogo/tipos";

/**
 * Constructores PUROS del SQL que mantiene el índice de la biblioteca del taller (REQ-002, migración 028): no abren
 * conexiones ni leen archivos. Cada uno devuelve `{ texto, valores }` parametrizado para `pool.query`, así el orden y
 * la cantidad de parámetros se prueban sin base de datos. Quien ejecuta (`scripts/taller/indexar-biblioteca.ts`)
 * decide qué correr y dentro de qué transacción.
 *
 * `RegistroParaIndice` es estructural: lo que el extractor de fichas (`fichas.ts`, `RegistroTaller`) entrega. Los
 * campos opcionales son los que pueden faltar en el JSONL.
 *
 * Partición por repositorio de catálogo (REQ-013, migración 034): cada fila lleva su `repositorio`, y lo que el indexador lee o
 * desactiva de fábrica se acota al repositorio que indexa, así indexar `mobiliario` nunca toca a `sempertex`. El repositorio NO
 * entra en el `hash` de la ficha: asignarlo no obliga a volver a embeber.
 */

export type RegistroParaIndice = {
  id: string;
  /** Un JSONL de antes de REQ-013 no lo trae: todo lo que había era de Sempertex (regla R2). */
  repositorio: IdRepositorio;
  tipo: string;
  nombre: string;
  descripcion: string;
  fuente: { tipo: string; titulo: string; url?: string | null; foto?: string | null };
  ocasiones: string[];
  tiposPieza: string[];
  formatos: string[];
  colores: string[];
  partes: string[];
  lineasPartes: Array<{ parte: string; formatoId: string; codigo: string; cantidad: number }>;
  productos: string[];
  medidas: { altoCm?: number | null; anchoCm?: number | null; fondoCm?: number | null };
  globos: number;
  tubos: number;
  hash: string;
  ficha: string;
  clasificacion?: { celebraciones: string[]; tematicas: string[] };
};

export type ConsultaSql = { texto: string; valores: unknown[] };

export type OpcionesIndice = {
  /** `null` o ausente = de fábrica (lo regenera el indexador); un valor = item guardado por ese dueño. */
  propietario?: string | null;
};

export type Modalidad = "texto" | "imagen_foto" | "imagen_render";

export type EntradaEmbedding = {
  itemId: string;
  modalidad: Modalidad;
  modelo: string;
  vector: readonly number[];
  hashEntrada: string;
};

export const DIMENSIONES_VECTOR_TALLER = 768;
/** Mismo modelo que `MODELO_EMBEDDING` de `src/lib/rag/embeddings.ts` (no se importa aquí para no arrastrar el cliente de Gemini). */
export const MODELO_EMBEDDING_TALLER = "gemini-embedding-2";
/** Líneas de `taller_items_partes` por INSERT (4 parámetros cada una: lejos del tope de 65535 de Postgres). */
const LINEAS_POR_INSERT = 500;

const unicos = (valores: readonly string[]): string[] => [...new Set(valores.filter((v) => typeof v === "string" && v !== ""))];
const numeroONulo = (valor: number | null | undefined): number | null => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);
const entero = (valor: number | null | undefined): number => (typeof valor === "number" && Number.isFinite(valor) ? Math.max(0, Math.round(valor)) : 0);

/** Las líneas repetidas de (parte, formato, código) se suman: es la clave primaria de la tabla. */
export function lineasDePartes(registro: RegistroParaIndice): Array<{ parte: string; formatoId: string; codigo: string; cantidad: number }> {
  const porClave = new Map<string, { parte: string; formatoId: string; codigo: string; cantidad: number }>();
  for (const linea of registro.lineasPartes) {
    if (!linea.parte || !linea.formatoId) continue;
    const codigo = linea.codigo ?? "";
    const clave = `${linea.parte}\u0000${linea.formatoId}\u0000${codigo}`;
    const actual = porClave.get(clave);
    if (actual) actual.cantidad += entero(linea.cantidad);
    else porClave.set(clave, { parte: linea.parte, formatoId: linea.formatoId, codigo, cantidad: entero(linea.cantidad) });
  }
  return [...porClave.values()];
}

/** Columnas de `taller_items` que escribe el upsert, en el orden de los parámetros $1…$N. */
const COLUMNAS_ITEM = [
  "id", "tipo", "nombre", "descripcion", "fuente_tipo", "fuente_titulo", "fuente_url", "foto_url",
  "ocasiones", "celebraciones", "tematicas", "tipos_pieza", "formatos", "colores", "partes", "productos",
  "alto_cm", "ancho_cm", "fondo_cm", "globos", "tubos", "ficha", "hash", "propietario", "repositorio",
] as const;

/** Tipo de cada parámetro para el cast explícito (los arreglos vacíos de `pg` llegan sin tipo). */
const CAST_COLUMNA: Partial<Record<(typeof COLUMNAS_ITEM)[number], string>> = {
  ocasiones: "text[]", celebraciones: "text[]", tematicas: "text[]", tipos_pieza: "text[]", formatos: "text[]",
  colores: "text[]", partes: "text[]", productos: "text[]", alto_cm: "numeric", ancho_cm: "numeric", fondo_cm: "numeric",
  globos: "integer", tubos: "integer",
};

export function valoresDeItem(registro: RegistroParaIndice, opciones: OpcionesIndice = {}): unknown[] {
  return [
    registro.id,
    registro.tipo,
    registro.nombre,
    registro.descripcion ?? "",
    registro.fuente?.tipo ?? null,
    registro.fuente?.titulo ?? null,
    registro.fuente?.url ?? null,
    registro.fuente?.foto ?? null,
    unicos(registro.ocasiones ?? []),
    unicos(registro.clasificacion?.celebraciones ?? []),
    unicos(registro.clasificacion?.tematicas ?? []),
    unicos(registro.tiposPieza ?? []),
    unicos(registro.formatos ?? []),
    unicos(registro.colores ?? []),
    unicos(registro.partes ?? []),
    unicos(registro.productos ?? []),
    numeroONulo(registro.medidas?.altoCm),
    numeroONulo(registro.medidas?.anchoCm),
    numeroONulo(registro.medidas?.fondoCm),
    entero(registro.globos),
    entero(registro.tubos),
    registro.ficha ?? "",
    registro.hash,
    opciones.propietario ?? null,
    registro.repositorio,
  ];
}

/**
 * Upsert del item por hash: si la fila existe con el mismo hash (y activa) el `WHERE` del `DO UPDATE` no la toca y no
 * devuelve nada, que es la señal de «sin cambios». Devuelve `insertado` (xmax = 0) para contar nuevos y cambiados.
 * Una fila de otro repositorio nunca se toca (REQ-013): el indexador ya se niega antes (`erroresDeOcupacion`) y esto es la red.
 */
export function construirUpsertItem(registro: RegistroParaIndice, opciones: OpcionesIndice = {}): ConsultaSql {
  const valores = valoresDeItem(registro, opciones);
  const marcadores = COLUMNAS_ITEM.map((columna, i) => `$${i + 1}${CAST_COLUMNA[columna] ? `::${CAST_COLUMNA[columna]}` : ""}`);
  const asignaciones = COLUMNAS_ITEM.filter((c) => c !== "id" && c !== "repositorio").map((c) => `${c} = EXCLUDED.${c}`);
  const texto = `INSERT INTO taller_items (${COLUMNAS_ITEM.join(", ")})
VALUES (${marcadores.join(", ")})
ON CONFLICT (id) DO UPDATE SET ${asignaciones.join(", ")}, activo = TRUE, actualizado = now()
WHERE taller_items.repositorio = EXCLUDED.repositorio AND (taller_items.hash IS DISTINCT FROM EXCLUDED.hash OR NOT taller_items.activo)
RETURNING id, (xmax = 0) AS insertado`;
  return { texto, valores };
}

/** Borra las líneas de partes del item (se reinsertan enteras cuando su hash cambió). */
export function construirBorrarPartes(itemId: string): ConsultaSql {
  return { texto: "DELETE FROM taller_items_partes WHERE item_id = $1", valores: [itemId] };
}

/** INSERTs de las líneas de partes del item: $1 = item_id compartido y 4 parámetros por línea. Vacío si no hay líneas. */
export function construirInsertPartes(registro: RegistroParaIndice): ConsultaSql[] {
  const lineas = lineasDePartes(registro);
  const consultas: ConsultaSql[] = [];
  for (let desde = 0; desde < lineas.length; desde += LINEAS_POR_INSERT) {
    const trozo = lineas.slice(desde, desde + LINEAS_POR_INSERT);
    const valores: unknown[] = [registro.id];
    const filas = trozo.map((linea) => {
      const base = valores.length;
      valores.push(linea.parte, linea.formatoId, linea.codigo, linea.cantidad);
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::integer)`;
    });
    consultas.push({ texto: `INSERT INTO taller_items_partes (item_id, parte, formato_id, codigo, cantidad)\nVALUES ${filas.join(", ")}`, valores });
  }
  return consultas;
}

/** Hashes ya guardados de los items de fábrica del repositorio (para decidir qué insertar, cambiar u omitir). */
export function construirConsultaHashes(repositorio: IdRepositorio): ConsultaSql {
  return { texto: "SELECT id, hash, activo FROM taller_items WHERE propietario IS NULL AND repositorio = $1", valores: [repositorio] };
}

/**
 * Los items de fábrica del repositorio que ya no están en sus fichas se desactivan (no se borran: conservan sus embeddings).
 * Los de otro repositorio no se tocan: no están en estas fichas porque son de otras.
 */
export function construirDesactivarAusentes(idsVigentes: readonly string[], repositorio: IdRepositorio): ConsultaSql {
  return {
    texto: "UPDATE taller_items SET activo = FALSE, actualizado = now() WHERE propietario IS NULL AND repositorio = $2 AND activo AND id <> ALL($1::text[]) RETURNING id",
    valores: [[...idsVigentes], repositorio],
  };
}

/** Postgres 42703 (columna inexistente) sobre `repositorio`: la migración 034 no está aplicada en esa base. */
export function faltaColumnaRepositorio(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "42703" && typeof message === "string" && message.includes("repositorio");
}

export type Corrida = {
  registros: readonly RegistroParaIndice[];
  /** Las líneas del JSONL que no se pudieron leer (`leerFichasJsonl`). */
  erroresLectura: readonly string[];
  repositorio: IdRepositorio;
  permitirOtros: boolean;
};

/**
 * Lo que impide indexar una corrida (REQ-013, riesgo R-1), antes de tocar la base. Vacío = se puede.
 * - Una línea ilegible (también un repositorio inválido) es fatal: su item faltaría en las fichas y desactivar ausentes lo
 *   apagaría.
 * - Otro repositorio que Sempertex solo con `permitirOtros` (fase 3, cuando la búsqueda desplegada ya filtra por repositorio).
 * - Nunca un archivo con fichas de otro repositorio: desactivar ausentes las borraría del suyo.
 */
export function erroresDeCorrida({ registros, erroresLectura, repositorio, permitirOtros }: Corrida): string[] {
  const errores: string[] = [];
  if (erroresLectura.length) errores.push(`${erroresLectura.length} líneas inválidas en el archivo (p. ej. ${erroresLectura[0]}): corrígelas; no se indexa ni se desactiva nada.`);
  if (repositorio !== "sempertex" && !permitirOtros) {
    errores.push(`Indexar «${repositorio}» necesita --permitir-otros-repos: solo cuando la búsqueda desplegada ya filtra por repositorio (migración 034 y fase 2 en producción).`);
  }
  const ajenas = registros.filter((r) => r.repositorio !== repositorio);
  if (ajenas.length) errores.push(`${ajenas.length} fichas no son de «${repositorio}» (p. ej. ${ajenas[0]!.id}, de «${ajenas[0]!.repositorio}»): un archivo por repositorio.`);
  return errores;
}

/** La bandera con que quien aplica confirma que el código que lee `taller_items` en producción ya filtra por repositorio. */
export const CONFIRMO_FILTRO_EN_PRODUCCION = "--confirmo-filtro-en-produccion";

/**
 * Lo que impide ESCRIBIR una corrida de otro repositorio que Sempertex (REQ-013, riesgo R-1). Esas filas solo quedan invisibles si
 * todo lo que lee `taller_items` en producción filtra por `repositorio` (fase 2, d4b4020d o posterior): un despliegue anterior no
 * conoce la columna y las mostraría en la búsqueda del Taller, en la IA de escena y en la búsqueda por foto. Quien aplica lo
 * confirma a mano. Vacío = se puede.
 */
export function erroresDeAplicar(repositorio: IdRepositorio, confirmoFiltro: boolean): string[] {
  if (repositorio === "sempertex" || confirmoFiltro) return [];
  return [`Escribir «${repositorio}» en la base exige ${CONFIRMO_FILTRO_EN_PRODUCCION}: sus filas solo quedan invisibles si el código que lee taller_items en producción (VPS) ya filtra por repositorio (REQ-013 fase 2, d4b4020d o posterior); uno anterior las mostraría en la búsqueda del Taller, la IA de escena y la búsqueda por foto. Comprueba la versión desplegada y repite con la bandera.`];
}

/** Los ids de la corrida que ya existen en la base con otro repositorio (o de un dueño en otro): no se los apropia nadie. */
export function construirConsultaDeOtroRepositorio(ids: readonly string[], repositorio: IdRepositorio): ConsultaSql {
  return { texto: "SELECT id, repositorio FROM taller_items WHERE id = ANY($1::text[]) AND repositorio <> $2", valores: [[...ids], repositorio] };
}

/** Un id de la corrida que ya es de otro repositorio es fatal: un repositorio nunca toma las filas de otro. */
export function erroresDeOcupacion(filas: ReadonlyArray<{ id: string; repositorio: string }>, repositorio: IdRepositorio): string[] {
  if (!filas.length) return [];
  const [primera] = filas;
  return [`${filas.length} ids de «${repositorio}» ya existen en otro repositorio (p. ej. ${primera!.id}, de «${primera!.repositorio}»): un repositorio no se apropia de las filas de otro.`];
}

export type ClasificacionCambios = {
  nuevos: RegistroParaIndice[];
  cambiados: RegistroParaIndice[];
  reactivados: RegistroParaIndice[];
  sinCambio: RegistroParaIndice[];
  ausentes: string[];
};

/** La misma decisión del `WHERE` del upsert, en memoria: para el modo `--comparar` y para las pruebas. */
export function clasificarCambios(
  registros: readonly RegistroParaIndice[],
  existentes: ReadonlyMap<string, { hash: string; activo: boolean }>,
): ClasificacionCambios {
  const salida: ClasificacionCambios = { nuevos: [], cambiados: [], reactivados: [], sinCambio: [], ausentes: [] };
  const vigentes = new Set<string>();
  for (const registro of registros) {
    vigentes.add(registro.id);
    const actual = existentes.get(registro.id);
    if (!actual) salida.nuevos.push(registro);
    else if (actual.hash !== registro.hash) salida.cambiados.push(registro);
    else if (!actual.activo) salida.reactivados.push(registro);
    else salida.sinCambio.push(registro);
  }
  for (const [id, fila] of existentes) if (fila.activo && !vigentes.has(id)) salida.ausentes.push(id);
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Embeddings (se calculan en otro paso; aquí solo se guardan y se decide cuáles faltan)
// ----------------------------------------------------------------------------------------------------------

/** La tarea con que el lote de Python embebe las fichas (`TAREA_DOCUMENTO` de `plan_embeddings.py`): entra en el hash. */
export const TAREA_EMBEDDING_FICHA = "RETRIEVAL_DOCUMENT";

/**
 * Hash del texto que se embebe de un item: el MISMO que guarda el lote de Python en la caché (`hash_entrada_texto` de
 * `insumos_biblioteca.py`: sha256 de «tarea|ficha»). Si no cambia, el vector de texto sigue valiendo. Antes era el sha256 de
 * la ficha sola y ningún vector de la caché cuadraba: el indexador los daba todos por faltantes.
 */
export function hashEntradaTexto(ficha: string): string {
  return createHash("sha256").update(`${TAREA_EMBEDDING_FICHA}|${ficha}`, "utf-8").digest("hex");
}

export function vectorComoLiteral(vector: readonly number[]): string {
  if (vector.length !== DIMENSIONES_VECTOR_TALLER) throw new Error(`El vector debe tener ${DIMENSIONES_VECTOR_TALLER} dimensiones, trae ${vector.length}.`);
  if (!vector.every((n) => Number.isFinite(n))) throw new Error("El vector trae valores no finitos.");
  return `[${vector.join(",")}]`;
}

/** Upsert de un embedding; si el hash de entrada no cambió no se reescribe. */
export function construirUpsertEmbedding(entrada: EntradaEmbedding): ConsultaSql {
  const texto = `INSERT INTO taller_items_embeddings (item_id, modalidad, modelo, dims, vector, hash_entrada)
VALUES ($1, $2, $3, $4::integer, $5::vector, $6)
ON CONFLICT (item_id, modalidad, modelo) DO UPDATE
SET dims = EXCLUDED.dims, vector = EXCLUDED.vector, hash_entrada = EXCLUDED.hash_entrada, creado = now()
WHERE taller_items_embeddings.hash_entrada IS DISTINCT FROM EXCLUDED.hash_entrada
RETURNING item_id`;
  return {
    texto,
    valores: [entrada.itemId, entrada.modalidad, entrada.modelo, DIMENSIONES_VECTOR_TALLER, vectorComoLiteral(entrada.vector), entrada.hashEntrada],
  };
}

/** Cuántos vectores van por INSERT al subir la caché (6 parámetros cada uno: lejos del tope de 65535 de Postgres). */
export const VECTORES_POR_INSERT = 200;

/**
 * Upserts de muchos embeddings a la vez (lotes de `VECTORES_POR_INSERT`), con la misma regla que `construirUpsertEmbedding`:
 * si el hash de entrada no cambió, no se reescribe. Uno por uno, subir los ~6 500 vectores de la biblioteca a Neon
 * tardaba más de una hora (una ida y vuelta por vector).
 */
export function construirUpsertEmbeddingsLote(entradas: readonly EntradaEmbedding[]): ConsultaSql[] {
  const consultas: ConsultaSql[] = [];
  for (let desde = 0; desde < entradas.length; desde += VECTORES_POR_INSERT) {
    const trozo = entradas.slice(desde, desde + VECTORES_POR_INSERT);
    const valores: unknown[] = [];
    const filas = trozo.map((e, k) => {
      const b = k * 6;
      valores.push(e.itemId, e.modalidad, e.modelo, DIMENSIONES_VECTOR_TALLER, vectorComoLiteral(e.vector), e.hashEntrada);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::integer, $${b + 5}::vector, $${b + 6})`;
    });
    consultas.push({
      texto: `INSERT INTO taller_items_embeddings (item_id, modalidad, modelo, dims, vector, hash_entrada)
VALUES ${filas.join(", ")}
ON CONFLICT (item_id, modalidad, modelo) DO UPDATE
SET dims = EXCLUDED.dims, vector = EXCLUDED.vector, hash_entrada = EXCLUDED.hash_entrada, creado = now()
WHERE taller_items_embeddings.hash_entrada IS DISTINCT FROM EXCLUDED.hash_entrada
RETURNING item_id`,
      valores,
    });
  }
  return consultas;
}

/** Por cada item activo de fábrica del repositorio, el hash con el que se embebió su texto (NULL si no tiene vector de ese modelo). */
export function construirConsultaEmbeddingsDeTexto(repositorio: IdRepositorio, modelo: string = MODELO_EMBEDDING_TALLER): ConsultaSql {
  return {
    texto: `SELECT t.id, e.hash_entrada
FROM taller_items t
LEFT JOIN taller_items_embeddings e ON e.item_id = t.id AND e.modalidad = 'texto' AND e.modelo = $1
WHERE t.activo AND t.propietario IS NULL AND t.repositorio = $2`,
    valores: [modelo, repositorio],
  };
}

/** Items cuyo vector de texto falta o quedó viejo respecto de su ficha actual. */
export function itemsSinEmbeddingVigente(
  registros: readonly RegistroParaIndice[],
  hashesEmbebidos: ReadonlyMap<string, string | null>,
): RegistroParaIndice[] {
  return registros.filter((r) => hashesEmbebidos.get(r.id) !== hashEntradaTexto(r.ficha));
}

// ----------------------------------------------------------------------------------------------------------
// Lectura del JSONL de fichas
// ----------------------------------------------------------------------------------------------------------

const esTexto = (v: unknown): v is string => typeof v === "string";
const listaDeTextos = (v: unknown): string[] => (Array.isArray(v) ? v.filter(esTexto) : []);
/** Textos de una lista de textos u objetos (las fichas traen `{codigo, nombre}` en colores y `{nombre, url…}` en productos). */
const listaDeCampo = (v: unknown, campo: string): string[] =>
  Array.isArray(v) ? v.flatMap((x) => (esTexto(x) ? [x] : typeof x === "object" && x !== null && esTexto((x as Record<string, unknown>)[campo]) ? [(x as Record<string, string>)[campo]!] : [])) : [];
const numero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Valida y completa un registro crudo del JSONL; devuelve el motivo si no sirve. */
export function normalizarRegistro(crudo: unknown): { registro: RegistroParaIndice } | { error: string } {
  if (typeof crudo !== "object" || crudo === null) return { error: "no es un objeto" };
  const r = crudo as Record<string, unknown>;
  if (!esTexto(r.id) || r.id === "") return { error: "sin id" };
  if (!esTexto(r.nombre) || r.nombre === "") return { error: `${r.id}: sin nombre` };
  if (!esTexto(r.tipo) || r.tipo === "") return { error: `${r.id}: sin tipo` };
  if (!esTexto(r.hash) || r.hash === "") return { error: `${r.id}: sin hash` };
  if (r.repositorio !== undefined && !(esTexto(r.repositorio) && esIdRepositorio(r.repositorio))) return { error: `${r.id}: repositorio inválido` };
  const fuente = (typeof r.fuente === "object" && r.fuente !== null ? r.fuente : {}) as Record<string, unknown>;
  const medidas = (typeof r.medidas === "object" && r.medidas !== null ? r.medidas : {}) as Record<string, unknown>;
  const clasificacion = typeof r.clasificacion === "object" && r.clasificacion !== null ? (r.clasificacion as Record<string, unknown>) : null;
  const lineas = Array.isArray(r.lineasPartes) ? r.lineasPartes : [];
  const registro: RegistroParaIndice = {
    id: r.id,
    repositorio: esTexto(r.repositorio) && esIdRepositorio(r.repositorio) ? r.repositorio : "sempertex",
    tipo: r.tipo,
    nombre: r.nombre,
    descripcion: esTexto(r.descripcion) ? r.descripcion : "",
    fuente: { tipo: esTexto(fuente.tipo) ? fuente.tipo : "", titulo: esTexto(fuente.titulo) ? fuente.titulo : "", url: esTexto(fuente.url) ? fuente.url : null, foto: esTexto(fuente.foto) ? fuente.foto : null },
    ocasiones: listaDeTextos(r.ocasiones),
    tiposPieza: listaDeTextos(r.tiposPieza),
    formatos: listaDeTextos(r.formatos),
    colores: listaDeCampo(r.colores, "codigo"),
    partes: listaDeTextos(r.partes),
    lineasPartes: lineas.flatMap((l) => {
      if (typeof l !== "object" || l === null) return [];
      const x = l as Record<string, unknown>;
      return esTexto(x.parte) && esTexto(x.formatoId) ? [{ parte: x.parte, formatoId: x.formatoId, codigo: esTexto(x.codigo) ? x.codigo : "", cantidad: numero(x.cantidad) }] : [];
    }),
    productos: listaDeCampo(r.productos, "nombre"),
    medidas: { altoCm: typeof medidas.altoCm === "number" ? medidas.altoCm : null, anchoCm: typeof medidas.anchoCm === "number" ? medidas.anchoCm : null, fondoCm: typeof medidas.fondoCm === "number" ? medidas.fondoCm : null },
    globos: numero(r.globos),
    tubos: numero(r.tubos),
    hash: r.hash,
    ficha: esTexto(r.ficha) ? r.ficha : "",
    ...(clasificacion ? { clasificacion: { celebraciones: listaDeTextos(clasificacion.celebraciones), tematicas: listaDeTextos(clasificacion.tematicas) } } : {}),
  };
  return { registro };
}

/** Lee un JSONL: los registros válidos, y un error por línea inválida o id repetido (no aborta por una). */
export function leerFichasJsonl(contenido: string): { registros: RegistroParaIndice[]; errores: string[] } {
  const registros: RegistroParaIndice[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  contenido.split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    let crudo: unknown;
    try {
      crudo = JSON.parse(linea);
    } catch {
      errores.push(`línea ${i + 1}: JSON inválido`);
      return;
    }
    const resultado = normalizarRegistro(crudo);
    if ("error" in resultado) {
      errores.push(`línea ${i + 1}: ${resultado.error}`);
      return;
    }
    if (vistos.has(resultado.registro.id)) {
      errores.push(`línea ${i + 1}: id repetido ${resultado.registro.id}`);
      return;
    }
    vistos.add(resultado.registro.id);
    registros.push(resultado.registro);
  });
  return { registros, errores };
}
