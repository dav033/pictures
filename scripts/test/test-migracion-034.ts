/**
 * Migración 034 (REQ-013 fase 2, AC-7/AC-8) contra Postgres real en memoria (PGlite con pgvector, pg_trgm y unaccent):
 * - antes de 034 (Neon hoy) la búsqueda nueva avisa (una vez) y responde lo mismo que después, desde la base;
 * - 034 empieza con `SET LOCAL lock_timeout`, corre dos veces (en su transacción, como migrate.ts) sin error ni cambio, toda fila
 *   existente queda `sempertex` y el CHECK rechaza lo que no es repositorio;
 * - con 034, la partición separa repositorios (una fila de mobiliario no sale por defecto, sí si se ve y se pide), el indexador
 *   solo lee y desactiva lo del repositorio que indexa, y ningún repositorio se apropia de las filas de otro;
 * - el rollback del encabezado apaga primero lo que no es de Sempertex, borra su fila de schema_migrations, y la búsqueda
 *   sobrevive a él.
 *
 *   PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite y pglite-pgvector> \
 *     NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-migracion-034.ts
 *
 * PGlite no es dependencia del proyecto: sin él la prueba FALLA con ese aviso (no se salta en silencio).
 */
import assert from "node:assert/strict";
import { abrirPglite, leerMigracion, prepararEsquemaTaller, type BasePglite } from "../taller/pglite-taller";
import { buscarEnTaller, type DependenciasBuscar } from "../../src/lib/taller/buscar";
import {
  construirConsultaEmbeddingsDeTexto,
  construirConsultaDeOtroRepositorio,
  construirConsultaHashes,
  erroresDeOcupacion,
  construirDesactivarAusentes,
  construirUpsertItem,
  type RegistroParaIndice,
} from "../../src/lib/taller/indice";
import type { IdRepositorio } from "../../src/lib/catalogo/tipos";

const MIGRACION = "034_catalogo_repositorios.sql";
const DIR_PGLITE = process.argv.find((a) => a.startsWith("--pglite="))?.slice("--pglite=".length) ?? process.env.PGLITE_DIR;

let casos = 0;
const ok = (nombre: string) => { casos += 1; console.log(`ok ${casos} - ${nombre}`); };

/** Las sentencias del bloque `-- rollback:` del encabezado (las líneas `--   …;`, hasta la primera línea que no es comentario). */
function sentenciasDeRollback(sql: string): string[] {
  const lineas = sql.split("\n");
  const desde = lineas.findIndex((l) => /^--\s*rollback:/.test(l));
  assert.ok(desde >= 0, "la migración documenta su rollback");
  const sentencias: string[] = [];
  for (const linea of lineas.slice(desde + 1)) {
    if (!linea.startsWith("--")) break;
    const m = /^-- {3}(\S.*;)$/.exec(linea);
    if (m) sentencias.push(m[1]!);
  }
  return sentencias;
}

function registro(id: string, repositorio: IdRepositorio, nombre: string, ficha: string): RegistroParaIndice {
  return {
    id, repositorio, tipo: "estructura", nombre, descripcion: "", fuente: { tipo: "idea-sempertex", titulo: "t" }, ocasiones: [], tiposPieza: [], formatos: [],
    colores: [], partes: [], lineasPartes: [], productos: [], medidas: {}, globos: 0, tubos: 0, hash: `h-${id}`, ficha,
  };
}

async function esquemaDe(db: BasePglite): Promise<string> {
  const columnas = await db.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'taller_items' ORDER BY column_name");
  const restricciones = await db.query("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'taller_items'::regclass ORDER BY conname");
  const indices = await db.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'taller_items' ORDER BY indexname");
  return JSON.stringify([columnas.rows, restricciones.rows, indices.rows]);
}

async function conAvisos<T>(fn: () => Promise<T>): Promise<{ valor: T; avisos: string[] }> {
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };
  try {
    return { valor: await fn(), avisos };
  } finally {
    console.warn = original;
  }
}

async function main(): Promise<void> {
  if (!DIR_PGLITE) throw new Error("Falta PGlite: PGLITE_DIR=<carpeta> o --pglite=<carpeta> (npm i @electric-sql/pglite @electric-sql/pglite-pgvector en una carpeta aparte).");
  const db = await abrirPglite(DIR_PGLITE);
  await prepararEsquemaTaller(db, ["028_taller_biblioteca.sql"]);
  // Las filas de hoy en Neon: de fábrica y de un dueño, sin columna de repositorio.
  await db.exec(`INSERT INTO taller_items (id, tipo, nombre, ficha, hash, propietario) VALUES
    ('idea:arco-dorado', 'estructura', 'Arco dorado', 'arco orgánico dorado para boda', 'h1', NULL),
    ('idea:columna-uvas', 'estructura', 'Columna con uvas', 'columna dorada con uvas para grado', 'h2', NULL),
    ('escena:boda~arco', 'conjunto', 'Arco de la boda', 'arco dorado con flores', 'h3', NULL),
    ('propio:arco-dueno', 'estructura', 'Arco del dueño', 'arco dorado guardado', 'h4', 'dueno-1')`);
  const pool = { query: (texto: string, valores?: unknown[]) => db.query(texto, valores) };
  const deps = (extra: Partial<DependenciasBuscar> = {}): DependenciasBuscar => ({ habilitado: true, embeberConsulta: async () => undefined, obtenerPool: () => pool as never, ...extra });
  const consulta = { texto: "arco dorado", limite: 10, filtros: { propietario: "dueno-1" } };

  const antes = await conAvisos(() => buscarEnTaller(consulta, deps()));
  assert.equal(antes.valor.fuente, "rag", "sin 034 la búsqueda sigue en la base");
  assert.ok(antes.valor.ids.includes("idea:arco-dorado") && antes.valor.ids.includes("propio:arco-dueno"), antes.valor.ids.join());
  assert.ok(antes.valor.resultados.every((r) => r.repositorio === "sempertex"));
  assert.equal(antes.avisos.filter((a) => /migración 034 sin aplicar/.test(a)).length, 1, antes.avisos.join("\n"));
  ok("sin 034 (Neon hoy): aviso claro y búsqueda en la base, como antes de REQ-013");

  // Como migrate.ts: cada archivo en su transacción y su fila en schema_migrations.
  await db.exec("CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), checksum TEXT)");
  const aplicar034 = async () => {
    await db.exec(`BEGIN;\n${leerMigracion(MIGRACION)}\nINSERT INTO schema_migrations (filename) VALUES ('${MIGRACION}') ON CONFLICT DO NOTHING;\nCOMMIT;`);
  };
  const primeraSentencia = leerMigracion(MIGRACION).split("\n").find((l) => l.trim() && !l.startsWith("--"));
  assert.equal(primeraSentencia, "SET LOCAL lock_timeout = '3s';", "primero el tope de espera del bloqueo");
  await aplicar034();
  const esquema = await esquemaDe(db);
  await aplicar034();
  assert.equal(await esquemaDe(db), esquema, "la segunda pasada no cambia nada");
  assert.deepEqual((await db.query("SHOW lock_timeout")).rows, [{ lock_timeout: "0" }], "SET LOCAL no sale de la transacción");
  const repos = await db.query("SELECT repositorio, count(*)::int AS n FROM taller_items GROUP BY repositorio");
  assert.deepEqual(repos.rows, [{ repositorio: "sempertex", n: 4 }], "toda fila existente, también la del dueño, es de Sempertex");
  assert.match(esquema, /taller_items_repositorio_check/);
  assert.match(esquema, /ix_taller_items_repositorio/);
  ok("034 corre dos veces sin error ni cambio; toda fila existente queda en sempertex");

  const insertar = (id: string, repositorio: string) => db.query("INSERT INTO taller_items (id, tipo, nombre, hash, repositorio) VALUES ($1, 'x', 'x', 'h', $2)", [id, repositorio]);
  await assert.rejects(insertar("r1", "otro"), /taller_items_repositorio_check/);
  await assert.rejects(insertar("r2", "terceros/Acme"), /taller_items_repositorio_check/);
  await assert.rejects(insertar("r3", "terceros/"), /taller_items_repositorio_check/);
  await insertar("r4", "terceros/acme");
  await db.query("DELETE FROM taller_items WHERE id = 'r4'");
  ok("el CHECK solo acepta sempertex, mobiliario, escenografia y terceros/<slug>");

  const despues = await conAvisos(() => buscarEnTaller(consulta, deps()));
  assert.deepEqual(despues.valor.ids, antes.valor.ids, "mismos resultados, en el mismo orden");
  assert.deepEqual(despues.avisos, []);
  ok("con 034: los mismos resultados que antes y sin aviso");

  const silla = registro("silla_tiffany", "mobiliario", "Silla tiffany dorada", "silla tiffany dorada para el montaje");
  await db.query(construirUpsertItem(silla).texto, construirUpsertItem(silla).valores);
  const sillas = { texto: "silla tiffany dorada", limite: 10 };
  assert.ok(!(await buscarEnTaller(sillas, deps())).ids.includes("silla_tiffany"), "por defecto el RAG no ve mobiliario");
  const visibles = await buscarEnTaller(sillas, deps({ repositoriosVisibles: () => ["sempertex", "mobiliario"] }));
  assert.equal(visibles.ids[0], "silla_tiffany");
  assert.equal(visibles.resultados[0]!.repositorio, "mobiliario");
  const soloMobiliario = await buscarEnTaller({ texto: "dorada", limite: 10, filtros: { repositorios: ["mobiliario"] } }, deps({ repositoriosVisibles: () => ["sempertex", "mobiliario"] }));
  assert.deepEqual(soloMobiliario.ids, ["silla_tiffany"], "pedir mobiliario devuelve solo mobiliario");
  const pedidoInvisible = await buscarEnTaller({ texto: "dorada", limite: 10, filtros: { repositorios: ["mobiliario"] } }, deps());
  assert.deepEqual(pedidoInvisible.ids, [], "pedir un repositorio invisible no lo abre");
  ok("partición: mobiliario invisible por defecto, visible solo si se ve y, si se pide, solo él");

  const hashes = await db.query(construirConsultaHashes("sempertex").texto, construirConsultaHashes("sempertex").valores);
  assert.ok(!hashes.rows.some((f) => (f as { id: string }).id === "silla_tiffany"));
  const desactivar = construirDesactivarAusentes(["idea:arco-dorado", "escena:boda~arco"], "sempertex");
  const desactivados = await db.query(desactivar.texto, desactivar.valores);
  assert.deepEqual(desactivados.rows.map((f) => (f as { id: string }).id), ["idea:columna-uvas"], "solo el ausente de Sempertex; ni el mueble ni el del dueño");
  const sinVector = construirConsultaEmbeddingsDeTexto("mobiliario");
  assert.deepEqual((await db.query(sinVector.texto, sinVector.valores)).rows.map((f) => (f as { id: string }).id), ["silla_tiffany"]);
  assert.equal((await db.query(construirUpsertItem(silla).texto, construirUpsertItem(silla).valores)).rows.length, 0, "sin cambios: el upsert no toca la fila");
  ok("indexador: lee, desactiva y lista embeddings solo del repositorio que indexa; el repositorio no entra en el hash");

  const movida = { ...silla, repositorio: "escenografia" as const };
  const ocupados = construirConsultaDeOtroRepositorio(["silla_tiffany", "idea:arco-dorado", "panel_redondo"], "escenografia");
  const filasOcupadas = (await db.query(ocupados.texto, ocupados.valores)).rows as Array<{ id: string; repositorio: string }>;
  assert.deepEqual(filasOcupadas.map((f) => `${f.id}:${f.repositorio}`).sort(), ["idea:arco-dorado:sempertex", "silla_tiffany:mobiliario"]);
  assert.match(erroresDeOcupacion(filasOcupadas, "escenografia").join(), /2 ids de «escenografia» ya existen en otro repositorio/, "el indexador se niega antes de escribir");
  assert.equal((await db.query(construirUpsertItem(movida).texto, construirUpsertItem(movida).valores)).rows.length, 0, "y el upsert tampoco se apropia de la fila");
  const silla034 = await db.query("SELECT repositorio, activo FROM taller_items WHERE id = 'silla_tiffany'");
  assert.deepEqual(silla034.rows, [{ repositorio: "mobiliario", activo: true }], "la silla sigue en mobiliario");
  ok("ningún repositorio se apropia de las filas de otro: el indexador se niega y el upsert no toca la fila");

  const rollback = sentenciasDeRollback(leerMigracion(MIGRACION));
  assert.match(rollback[0]!, /^UPDATE taller_items SET activo = FALSE.*WHERE repositorio <> 'sempertex';$/, "primero se apaga lo que no es de Sempertex");
  assert.match(rollback.at(-1)!, /^DELETE FROM schema_migrations WHERE filename = '034_catalogo_repositorios\.sql';$/);
  for (const sentencia of rollback) await db.exec(sentencia);
  const columnas = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'taller_items' AND column_name = 'repositorio'");
  assert.equal(columnas.rows.length, 0, "el rollback quita la columna");
  assert.doesNotMatch(await esquemaDe(db), /repositorio/);
  assert.deepEqual((await db.query("SELECT activo FROM taller_items WHERE id = 'silla_tiffany'")).rows, [{ activo: false }], "el mueble queda apagado: sin la columna valdría como Sempertex");
  assert.deepEqual((await db.query("SELECT filename FROM schema_migrations")).rows, [], "y migrate.ts la volvería a aplicar");
  const trasRollback = await conAvisos(() => buscarEnTaller({ texto: "silla tiffany dorada", limite: 10 }, deps()));
  assert.equal(trasRollback.valor.fuente, "rag");
  assert.ok(!trasRollback.valor.ids.includes("silla_tiffany"), "el mueble apagado no aparece");
  assert.deepEqual(trasRollback.avisos, [], "el aviso de la columna faltante ya salió en este proceso");
  await aplicar034();
  assert.equal(await esquemaDe(db), esquema, "y 034 se vuelve a aplicar igual");
  ok("rollback del encabezado: apaga lo ajeno, quita columna, CHECK, índice y su fila de schema_migrations; la búsqueda sobrevive y 034 se reaplica");

  console.log(`\n${casos} casos ok`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
