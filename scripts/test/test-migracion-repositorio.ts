/**
 * Migración `034_catalogo_repositorios.sql` (REQ-013, plan T24; el plan la llamaba 033, ocupada por `033_proveedor_anthropic.sql`).
 * Prueba ESTÁTICA, sin tocar ninguna base: el archivo existe, es aditivo, idempotente (IF NOT EXISTS) y no tiene DROP/ALTER TYPE
 * fuera de su bloque de rollback comentado; sus sentencias se parten como las parte `scripts/migrate.ts`; el dry-run de
 * `migrate.ts` lista el archivo. La ejecución real contra Postgres en memoria la cubre `test-migracion-034` (necesita PGlite).
 *
 * Run: npx tsx scripts/test/test-migracion-repositorio.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "scripts", "migrations");
const NOMBRE = "034_catalogo_repositorios.sql";
let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ok ${pruebas} - ${nombre}`); };

assert.ok(existsSync(join(DIR, NOMBRE)), `falta ${NOMBRE}`);
const sql = readFileSync(join(DIR, NOMBRE), "utf8");
/** El SQL ejecutable: sin comentarios de línea (el rollback documentado vive en ellos). */
const ejecutable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

prueba("el número 034 es único y sigue a 033_proveedor_anthropic", () => {
  const archivos = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
  assert.equal(archivos.filter((f) => f.startsWith("034_")).length, 1);
  assert.ok(archivos.includes("033_proveedor_anthropic.sql"));
  assert.deepEqual([...archivos].sort(), archivos, "el orden alfabético es el de aplicación");
});

prueba("aditiva: solo agrega columna, restricción e índice; sin DROP, TRUNCATE, DELETE ni ALTER TYPE", () => {
  assert.doesNotMatch(ejecutable, /\bDROP\b/i);
  assert.doesNotMatch(ejecutable, /\bTRUNCATE\b/i);
  assert.doesNotMatch(ejecutable, /\bDELETE\b/i);
  assert.doesNotMatch(ejecutable, /\bUPDATE\b/i);
  assert.doesNotMatch(ejecutable, /ALTER\s+COLUMN[\s\S]*?\bTYPE\b|ALTER\s+TYPE/i);
  assert.doesNotMatch(ejecutable, /RENAME/i);
});

prueba("idempotente: columna e índice con IF NOT EXISTS, restricción guardada por pg_constraint", () => {
  assert.match(ejecutable, /ADD COLUMN IF NOT EXISTS repositorio TEXT NOT NULL DEFAULT 'sempertex'/);
  assert.match(ejecutable, /CREATE INDEX IF NOT EXISTS ix_taller_items_repositorio ON taller_items/);
  assert.match(ejecutable, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'taller_items_repositorio_check'\)/);
  const creates = ejecutable.match(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/gi) ?? [];
  const guardados = ejecutable.match(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+IF NOT EXISTS\b/gi) ?? [];
  assert.equal(guardados.length, creates.length, "todo CREATE INDEX lleva IF NOT EXISTS");
  const adds = ejecutable.match(/\bADD\s+COLUMN\b/gi) ?? [];
  assert.equal((ejecutable.match(/\bADD\s+COLUMN\s+IF NOT EXISTS\b/gi) ?? []).length, adds.length, "toda columna lleva IF NOT EXISTS");
});

prueba("el CHECK admite fundadores y terceros/<slug> y la regla no deja otros ids", () => {
  const regex = /CHECK \(repositorio ~ '(.+?)'\)/.exec(ejecutable)?.[1];
  assert.ok(regex);
  const re = new RegExp(regex);
  for (const ok of ["sempertex", "mobiliario", "escenografia", "terceros/acme"]) assert.ok(re.test(ok), ok);
  for (const mal of ["otro", "terceros/", "terceros/Acme", "sempertex2", " sempertex"]) assert.ok(!re.test(mal), mal);
});

prueba("tope de espera del bloqueo y rollback documentado que apaga primero lo ajeno", () => {
  assert.equal(ejecutable.split("\n").find((l) => l.trim())?.trim(), "SET LOCAL lock_timeout = '3s';");
  const rollback = sql.split("\n").filter((l) => /^-- {3}\S/.test(l));
  assert.match(rollback[0]!, /^--   UPDATE taller_items SET activo = FALSE/);
  assert.ok(rollback.some((l) => /DROP COLUMN IF EXISTS repositorio;$/.test(l)));
  assert.ok(rollback.at(-1)!.includes(`DELETE FROM schema_migrations WHERE filename = '${NOMBRE}'`));
});

prueba("parseo en seco como migrate.ts (sin base): numeración sin colisiones, nota de rollback, bloques $$ balanceados", () => {
  const archivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const porNumero = new Map<string, string[]>();
  for (const a of archivos) {
    const numero = /^(\d+)_/.exec(a)?.[1];
    assert.ok(numero, `sin prefijo numérico: ${a}`);
    porNumero.set(numero, [...(porNumero.get(numero) ?? []), a]);
  }
  const colisiones = [...porNumero.values()].filter((l) => l.length > 1);
  assert.deepEqual(colisiones, [], "colisión de número de migración");
  assert.match(sql, /^\s*--\s*rollback:/im);
  assert.equal((ejecutable.match(/\$\$/g) ?? []).length % 2, 0, "bloques DO $$ sin cerrar");
  assert.ok(ejecutable.trim().endsWith(";"), "la última sentencia termina en ;");
  assert.ok(!sql.includes("\r"), "fin de línea LF");
});

console.log(`test-migracion-repositorio: ${pruebas} pruebas ok`);
