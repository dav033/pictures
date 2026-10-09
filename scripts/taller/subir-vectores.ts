import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { construirUpsertEmbeddingsLote, hashEntradaTexto, leerFichasJsonl, type ConsultaSql, type EntradaEmbedding } from "../../src/lib/taller/indice";
import { CARPETA_VECTORES_BIBLIOTECA, MODELO_VECTORES_BIBLIOTECA, leerVectoresCacheados } from "../../src/lib/taller/vectores-cache";

/**
 * Sube a Postgres (`taller_items_embeddings`) los vectores de la caché local de la biblioteca (REQ-002, paso 4 del
 * GO-LIVE): los calcula el lote de Python (`embeber_biblioteca.py`) en `data/taller/embeddings/` y hasta ahora ningún
 * script los llevaba a la base, así que la búsqueda por significado y por foto quedaba vacía.
 *
 * Solo sube vectores de items del archivo de fichas; el de texto, solo si se calculó con la ficha de hoy (mismo hash):
 * uno viejo se salta y lo dice. Por lotes (`construirUpsertEmbeddingsLote`), sin reescribir un vector del mismo hash.
 *   npx tsx --conditions=react-server scripts/taller/subir-vectores.ts              # ensayo: solo cuenta (sin base)
 *   npx tsx --conditions=react-server scripts/taller/subir-vectores.ts --comparar   # LEE la base: cuántos faltan o cambiaron
 *   npx tsx --conditions=react-server scripts/taller/subir-vectores.ts --aplicar    # ESCRIBE en la base
 * Nunca imprime variables de entorno.
 */

type Modo = "ensayo" | "comparar" | "aplicar";
type PoolMinimo = { query: (c: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; end: () => Promise<void> };

function cargarEntorno(): void {
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
}

async function abrirPool(): Promise<PoolMinimo> {
  cargarEntorno();
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL (en .env.local o en el entorno).");
  const { getRagPool } = await import("../../src/lib/rag/db");
  return getRagPool() as unknown as PoolMinimo;
}

/** Los vectores de la caché que valen para las fichas de hoy, y los de texto que quedaron viejos. */
export function vectoresVigentes(archivoFichas: string, carpeta: string = CARPETA_VECTORES_BIBLIOTECA): { entradas: EntradaEmbedding[]; viejos: number; ajenos: number } {
  const { registros } = leerFichasJsonl(readFileSync(archivoFichas, "utf8"));
  const hashDeTexto = new Map(registros.map((r) => [r.id, hashEntradaTexto(r.ficha)]));
  let viejos = 0, ajenos = 0;
  const entradas: EntradaEmbedding[] = [];
  for (const v of leerVectoresCacheados(carpeta, { modelo: MODELO_VECTORES_BIBLIOTECA })) {
    const hash = hashDeTexto.get(v.id);
    if (hash === undefined) { ajenos++; continue; }
    if (v.modalidad === "texto" && v.hashEntrada !== hash) { viejos++; continue; }
    entradas.push({ itemId: v.id, modalidad: v.modalidad, modelo: v.modelo, vector: Array.from(v.vector), hashEntrada: v.hashEntrada });
  }
  return { entradas, viejos, ajenos };
}

const clave = (itemId: string, modalidad: string) => `${itemId}|${modalidad}`;

async function main() {
  const args = process.argv.slice(2);
  const modo: Modo = args.includes("--aplicar") ? "aplicar" : args.includes("--comparar") ? "comparar" : "ensayo";
  const i = args.indexOf("--archivo");
  const archivo = path.resolve(i >= 0 && args[i + 1] ? args[i + 1]! : "data/taller/fichas.jsonl");
  const { entradas, viejos, ajenos } = vectoresVigentes(archivo);
  const porModalidad = new Map<string, number>();
  for (const e of entradas) porModalidad.set(e.modalidad, (porModalidad.get(e.modalidad) ?? 0) + 1);
  console.log(`Vectores vigentes en la caché: ${entradas.length} (${[...porModalidad].map(([m, n]) => `${m} ${n}`).join(" · ")}); de texto viejos (ficha cambiada): ${viejos}; de items que no están en las fichas: ${ajenos}.`);
  if (modo === "ensayo") { console.log("Ensayo: no se tocó la base. Usa --comparar o --aplicar."); return; }

  const pool = await abrirPool();
  try {
    const { rows } = await pool.query("SELECT item_id, modalidad, hash_entrada FROM taller_items_embeddings WHERE modelo = $1", [MODELO_VECTORES_BIBLIOTECA]);
    const enBase = new Map(rows.map((f) => [clave(String(f.item_id), String(f.modalidad)), String(f.hash_entrada)]));
    const pendientes = entradas.filter((e) => enBase.get(clave(e.itemId, e.modalidad)) !== e.hashEntrada);
    console.log(`En la base: ${enBase.size}; por subir (faltan o cambiaron): ${pendientes.length}.`);
    if (modo === "comparar") { console.log("Comparación hecha: no se escribió nada."); return; }
    const lotes: ConsultaSql[] = construirUpsertEmbeddingsLote(pendientes);
    let escritos = 0;
    for (const [k, c] of lotes.entries()) {
      escritos += (await pool.query(c.texto, c.valores)).rows.length;
      if ((k + 1) % 5 === 0 || k === lotes.length - 1) console.log(`  lote ${k + 1}/${lotes.length}: ${escritos} escritos`);
    }
    console.log(`Listo: ${escritos} vectores escritos.`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
