/**
 * Indexa la biblioteca del taller 3D en Postgres (REQ-002): lee `data/taller/fichas.jsonl` y hace upsert por hash en
 * `taller_items` y `taller_items_partes`. NO calcula embeddings (es otro paso); solo lista qué items los necesitan.
 *
 * Por defecto es un ensayo SIN base de datos: imprime conteos de lo que hay en el archivo y nada más.
 *   npx tsx --conditions=react-server scripts/taller/indexar-biblioteca.ts                 # ensayo (por defecto)
 *   npx tsx --conditions=react-server scripts/taller/indexar-biblioteca.ts --comparar      # solo LEE la base: nuevos / cambiados / sin cambio
 *   npx tsx --conditions=react-server scripts/taller/indexar-biblioteca.ts --aplicar       # ESCRIBE en la base (DATABASE_URL de .env.local / .env)
 * Opciones: `--archivo <ruta>` (otro JSONL). `--ensayo` es el valor por defecto, explícito. Nunca imprime variables de entorno.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  MODELO_EMBEDDING_TALLER,
  clasificarCambios,
  construirBorrarPartes,
  construirConsultaEmbeddingsDeTexto,
  construirConsultaHashes,
  construirDesactivarAusentes,
  construirInsertPartes,
  construirUpsertItem,
  itemsSinEmbeddingVigente,
  leerFichasJsonl,
  lineasDePartes,
  type ConsultaSql,
  type RegistroParaIndice,
} from "../../src/lib/taller/indice";

type Modo = "ensayo" | "comparar" | "aplicar";
type Opciones = { modo: Modo; archivo: string };

const ARCHIVO_POR_DEFECTO = path.join(process.cwd(), "data", "taller", "fichas.jsonl");

function leerOpciones(argv: string[]): Opciones {
  let modo: Modo | null = null;
  let archivo = ARCHIVO_POR_DEFECTO;
  const fijar = (nuevo: Modo) => {
    if (modo && modo !== nuevo) throw new Error("Usa una sola opción entre --ensayo, --comparar y --aplicar.");
    modo = nuevo;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--ensayo") fijar("ensayo");
    else if (arg === "--comparar") fijar("comparar");
    else if (arg === "--aplicar") fijar("aplicar");
    else if (arg === "--archivo") {
      const valor = argv[i + 1];
      if (!valor) throw new Error("--archivo necesita una ruta.");
      archivo = path.resolve(valor);
      i++;
    } else throw new Error(`Opción desconocida: ${arg}. Válidas: --dry-run (por defecto), --comparar, --aplicar, --archivo <ruta>.`);
  }
  return { modo: modo ?? "ensayo", archivo };
}

function cargarEntorno(): void {
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
}

function contarPor<T>(lista: readonly T[], clave: (x: T) => string): Array<[string, number]> {
  const conteo = new Map<string, number>();
  for (const x of lista) conteo.set(clave(x), (conteo.get(clave(x)) ?? 0) + 1);
  return [...conteo.entries()].sort((a, b) => b[1] - a[1]);
}

function imprimirResumen(registros: readonly RegistroParaIndice[], errores: readonly string[]): void {
  const lineas = registros.reduce((suma, r) => suma + lineasDePartes(r).length, 0);
  const caracteres = registros.reduce((suma, r) => suma + r.ficha.length, 0);
  console.log(`Registros válidos: ${registros.length}${errores.length ? ` (${errores.length} líneas descartadas)` : ""}`);
  for (const [tipo, n] of contarPor(registros, (r) => r.tipo)) console.log(`  tipo ${tipo}: ${n}`);
  for (const [fuente, n] of contarPor(registros, (r) => r.fuente.tipo || "(sin fuente)")) console.log(`  fuente ${fuente}: ${n}`);
  console.log(`Líneas de partes: ${lineas}`);
  console.log(`Con clasificación (celebraciones/temáticas): ${registros.filter((r) => r.clasificacion).length}`);
  console.log(`Sin ficha: ${registros.filter((r) => !r.ficha.trim()).length}`);
  console.log(`Con foto: ${registros.filter((r) => r.fuente.foto).length}`);
  console.log(`Texto a embeber: ~${caracteres} caracteres (~${Math.round(caracteres / 4)} tokens) en ${registros.length} fichas`);
  for (const e of errores.slice(0, 20)) console.log(`  AVISO ${e}`);
  if (errores.length > 20) console.log(`  … y ${errores.length - 20} avisos más`);
}

type PoolMinimo = { query: (c: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; connect: () => Promise<{ query: (c: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; release: () => void }>; end: () => Promise<void> };

async function abrirPool(): Promise<PoolMinimo> {
  cargarEntorno();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada (.env.local / .env).");
  const { getRagPool } = await import("../../src/lib/rag/db");
  return getRagPool() as unknown as PoolMinimo;
}

const ejecutar = (ejecutor: Pick<PoolMinimo, "query">, c: ConsultaSql) => ejecutor.query(c.texto, c.valores);

async function leerExistentes(pool: PoolMinimo): Promise<Map<string, { hash: string; activo: boolean }>> {
  const c = construirConsultaHashes();
  const { rows } = await ejecutar(pool, c);
  return new Map(rows.map((f) => [String(f.id), { hash: String(f.hash), activo: Boolean(f.activo) }]));
}

async function listarSinEmbedding(pool: PoolMinimo, registros: readonly RegistroParaIndice[]): Promise<RegistroParaIndice[]> {
  const { rows } = await ejecutar(pool, construirConsultaEmbeddingsDeTexto(MODELO_EMBEDDING_TALLER));
  const hashes = new Map(rows.map((f) => [String(f.id), f.hash_entrada === null ? null : String(f.hash_entrada)]));
  return itemsSinEmbeddingVigente(registros, hashes);
}

function imprimirCambios(c: ReturnType<typeof clasificarCambios>): void {
  console.log(`Nuevos: ${c.nuevos.length} · cambiados: ${c.cambiados.length} · reactivados: ${c.reactivados.length} · sin cambio: ${c.sinCambio.length} · ausentes del archivo (se desactivarían): ${c.ausentes.length}`);
}

async function escribirItem(pool: PoolMinimo, registro: RegistroParaIndice): Promise<"insertado" | "actualizado" | "sin-cambio"> {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const { rows } = await ejecutar(cliente, construirUpsertItem(registro));
    if (!rows.length) {
      await cliente.query("ROLLBACK");
      return "sin-cambio";
    }
    await ejecutar(cliente, construirBorrarPartes(registro.id));
    for (const insert of construirInsertPartes(registro)) await ejecutar(cliente, insert);
    await cliente.query("COMMIT");
    return rows[0]?.insertado ? "insertado" : "actualizado";
  } catch (error) {
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
  }
}

async function main(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));
  if (!existsSync(opciones.archivo)) throw new Error(`No existe ${opciones.archivo}. Genera data/taller/fichas.jsonl con el extractor antes de indexar.`);
  const { registros, errores } = leerFichasJsonl(readFileSync(opciones.archivo, "utf-8"));
  console.log(`Modo: ${opciones.modo} · archivo: ${path.relative(process.cwd(), opciones.archivo)}`);
  imprimirResumen(registros, errores);
  if (!registros.length) throw new Error("El archivo no trae registros válidos: no se hace nada.");

  if (opciones.modo === "ensayo") {
    console.log(`\nEnsayo: no se tocó ninguna base de datos. Embeddings de texto necesarios si la base está vacía: ${registros.length}.`);
    console.log("Usa --comparar para ver nuevos/cambiados contra la base (solo lectura) o --aplicar para escribir.");
    return;
  }

  const pool = await abrirPool();
  try {
    const cambios = clasificarCambios(registros, await leerExistentes(pool));
    imprimirCambios(cambios);
    if (opciones.modo === "comparar") {
      const faltan = await listarSinEmbedding(pool, registros).catch(() => null);
      console.log(faltan ? `Necesitan (re)embedding de texto: ${faltan.length}` : "No se pudo consultar embeddings (¿migración 028 sin aplicar?).");
      console.log("\nComparación hecha: no se escribió nada.");
      return;
    }

    if (errores.length) throw new Error(`Hay ${errores.length} líneas inválidas en el archivo: corrígelas antes de --aplicar.`);
    const aEscribir = [...cambios.nuevos, ...cambios.cambiados, ...cambios.reactivados];
    const resumen = { insertado: 0, actualizado: 0, "sin-cambio": 0 };
    for (const registro of aEscribir) resumen[await escribirItem(pool, registro)] += 1;
    const { rows: desactivados } = await ejecutar(pool, construirDesactivarAusentes(registros.map((r) => r.id)));
    console.log(`\nAplicado: ${resumen.insertado} insertados, ${resumen.actualizado} actualizados, ${cambios.sinCambio.length} sin cambio, ${desactivados.length} desactivados.`);

    const pendientes = await listarSinEmbedding(pool, registros);
    console.log(`Necesitan (re)embedding de texto (paso aparte): ${pendientes.length}`);
    for (const r of pendientes.slice(0, 30)) console.log(`  ${r.id}`);
    if (pendientes.length > 30) console.log(`  … y ${pendientes.length - 30} más`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
