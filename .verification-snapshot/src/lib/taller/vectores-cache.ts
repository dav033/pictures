import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Lector de la caché de vectores de la biblioteca del taller (REQ-002). La escribe el lote de Python
 * (`services/ai-api/app/taller/embeber_biblioteca.py`, ver `cache_vectores.py`) en `data/taller/embeddings/`:
 *
 * - `indice.jsonl`: una línea por vector `{ id, modalidad, modelo, dims, hash_entrada, offset, ts }`. Gana la última línea de
 *   cada `(id, modalidad, modelo, dims)`; una línea cortada o con el vector fuera del archivo se ignora.
 * - `vectores.f32`: float32 little-endian, un vector tras otro; `offset` es el byte donde empieza.
 *
 * Solo lee: el indexador (`scripts/taller/indexar-biblioteca.ts`) decide cuáles subir a la base con el `hashEntrada`.
 */
export type ModalidadVector = "texto" | "imagen_foto" | "imagen_render";

export const MODELO_VECTORES_BIBLIOTECA = "gemini-embedding-2";
export const DIMENSIONES_VECTORES_BIBLIOTECA = 768;
export const CARPETA_VECTORES_BIBLIOTECA = path.resolve(__dirname, "../../../data/taller/embeddings");

export type EntradaIndiceVector = {
  id: string;
  modalidad: ModalidadVector;
  modelo: string;
  dims: number;
  hashEntrada: string;
  /** Byte de `vectores.f32` donde empieza el vector. */
  offset: number;
};

export type VectorCacheado = EntradaIndiceVector & { vector: Float32Array };

export type FiltroVectores = {
  /** Por omisión `gemini-embedding-2`. */
  modelo?: string;
  /** Por omisión 768. */
  dims?: number;
  modalidades?: readonly ModalidadVector[];
  ids?: ReadonlySet<string>;
};

const MODALIDADES: readonly string[] = ["texto", "imagen_foto", "imagen_render"];

function entradaDeLinea(linea: string, tamanoVectores: number): EntradaIndiceVector | null {
  let bruto: Record<string, unknown>;
  try {
    bruto = JSON.parse(linea) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { id, modalidad, modelo, dims, hash_entrada: hashEntrada, offset } = bruto;
  if (typeof id !== "string" || typeof modelo !== "string" || typeof hashEntrada !== "string") return null;
  if (typeof modalidad !== "string" || !MODALIDADES.includes(modalidad)) return null;
  if (!Number.isInteger(dims) || !Number.isInteger(offset)) return null;
  const d = dims as number;
  const o = offset as number;
  if (d <= 0 || o < 0 || o + d * 4 > tamanoVectores) return null;
  return { id, modalidad: modalidad as ModalidadVector, modelo, dims: d, hashEntrada, offset: o };
}

/** Vectores vigentes (la última línea de cada clave), sin leer `vectores.f32`. */
export function leerIndiceVectores(carpeta: string = CARPETA_VECTORES_BIBLIOTECA, filtro: FiltroVectores = {}): EntradaIndiceVector[] {
  const rutaIndice = path.join(carpeta, "indice.jsonl");
  const rutaVectores = path.join(carpeta, "vectores.f32");
  if (!existsSync(rutaIndice) || !existsSync(rutaVectores)) return [];
  const tamano = statSync(rutaVectores).size;
  const modelo = filtro.modelo ?? MODELO_VECTORES_BIBLIOTECA;
  const dims = filtro.dims ?? DIMENSIONES_VECTORES_BIBLIOTECA;
  const vigentes = new Map<string, EntradaIndiceVector>();
  for (const linea of readFileSync(rutaIndice, "utf8").split("\n")) {
    if (!linea.trim()) continue;
    const entrada = entradaDeLinea(linea, tamano);
    if (!entrada || entrada.modelo !== modelo || entrada.dims !== dims) continue;
    vigentes.set(`${entrada.id}\u0000${entrada.modalidad}`, entrada);
  }
  return [...vigentes.values()].filter(
    (e) => (!filtro.modalidades || filtro.modalidades.includes(e.modalidad)) && (!filtro.ids || filtro.ids.has(e.id)),
  );
}

/** Vigentes con su vector. Lee `vectores.f32` una sola vez (≈ 3 KB por vector de 768). */
export function leerVectoresCacheados(carpeta: string = CARPETA_VECTORES_BIBLIOTECA, filtro: FiltroVectores = {}): VectorCacheado[] {
  const entradas = leerIndiceVectores(carpeta, filtro);
  if (entradas.length === 0) return [];
  const archivo = readFileSync(path.join(carpeta, "vectores.f32"));
  const vista = new DataView(archivo.buffer, archivo.byteOffset, archivo.byteLength);
  return entradas.map((entrada) => {
    const vector = new Float32Array(entrada.dims);
    for (let i = 0; i < entrada.dims; i++) vector[i] = vista.getFloat32(entrada.offset + i * 4, true);
    return { ...entrada, vector };
  });
}

/** `[0.1,0.2,…]` — el literal que pgvector acepta en `$1::vector`. */
export function vectorALiteralPgvector(vector: ArrayLike<number>): string {
  const partes: string[] = [];
  for (let i = 0; i < vector.length; i++) {
    const valor = vector[i];
    if (!Number.isFinite(valor)) throw new Error(`Vector con valor no finito en la posición ${i}.`);
    partes.push(String(valor));
  }
  return `[${partes.join(",")}]`;
}
