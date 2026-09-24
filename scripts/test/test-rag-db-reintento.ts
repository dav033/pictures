/**
 * D8 (E2E 2026-09-14): `/api/chat` answered 502 "Connection terminated
 * unexpectedly" after ~5 minutes idle against Neon. Read-only statements are
 * retried once on a terminated connection; writes, transactions and other
 * errors are never replayed. No database: a fake pool simulates the failure.
 * Run: npx tsx --conditions=react-server scripts/test/test-rag-db-reintento.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { esConsultaSoloLectura, esErrorConexionTerminada, instalarReintentoLectura } from "../../src/lib/rag/db-reintento";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

function poolFalso(fallos: unknown[]): { pool: Pick<Pool, "query">; llamadas: string[] } {
  const llamadas: string[] = [];
  const pendientes = [...fallos];
  const pool = {
    query: async (texto: string | { text: string }) => {
      llamadas.push(typeof texto === "string" ? texto : texto.text);
      const fallo = pendientes.shift();
      if (fallo) throw fallo;
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
  } as unknown as Pick<Pool, "query">;
  return { pool, llamadas };
}

async function main(): Promise<void> {
  const terminada = new Error("Connection terminated unexpectedly");
  assert.equal(esErrorConexionTerminada(terminada), true);
  assert.equal(esErrorConexionTerminada(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(esErrorConexionTerminada(Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })), true);
  assert.equal(esErrorConexionTerminada(Object.assign(new Error("duplicate key value"), { code: "23505" })), false);
  assert.equal(esErrorConexionTerminada(new Error("canceling statement due to statement timeout")), false, "a timeout may have run: never replayed");
  assert.equal(esErrorConexionTerminada("Connection terminated"), false);
  ok("clasifica solo errores de conexión terminada");

  assert.equal(esConsultaSoloLectura("SELECT slots.slug FROM lora_mode_slots AS slots"), true);
  assert.equal(esConsultaSoloLectura("  -- comentario\n WITH x AS (SELECT 1) SELECT * FROM x;"), true);
  assert.equal(esConsultaSoloLectura("INSERT INTO rag_query_log (request_id) VALUES ($1)"), false);
  assert.equal(esConsultaSoloLectura("WITH moved AS (DELETE FROM t RETURNING *) SELECT * FROM moved"), false);
  assert.equal(esConsultaSoloLectura("UPDATE rag_query_log SET outcome = $2"), false);
  assert.equal(esConsultaSoloLectura("SELECT * FROM t FOR UPDATE"), false);
  assert.equal(esConsultaSoloLectura("SELECT nextval('seq')"), false);
  assert.equal(esConsultaSoloLectura("SELECT 1; DELETE FROM t"), false);
  assert.equal(esConsultaSoloLectura("BEGIN READ ONLY"), false, "transaction statements are not single reads");
  ok("reconoce lecturas de una sola sentencia sin efectos");

  const lectura = poolFalso([terminada]);
  const alReintentar: string[] = [];
  instalarReintentoLectura(lectura.pool, { alReintentar: (error) => alReintentar.push(error.message) });
  const resultado = await lectura.pool.query("SELECT 1 AS ok");
  assert.deepEqual(resultado.rows, [{ ok: 1 }]);
  assert.equal(lectura.llamadas.length, 2, "one retry after the terminated connection");
  assert.deepEqual(alReintentar, ["Connection terminated unexpectedly"], "the retry is observable");
  const config = poolFalso([terminada]);
  instalarReintentoLectura(config.pool);
  await config.pool.query({ text: "SELECT $1::int AS ok", values: [1] } as never);
  assert.equal(config.llamadas.length, 2, "query config objects are retried too");
  ok("una lectura con conexión terminada se reintenta una vez y funciona");

  const persistente = poolFalso([terminada, terminada, terminada]);
  instalarReintentoLectura(persistente.pool);
  await assert.rejects(persistente.pool.query("SELECT 1"), /Connection terminated/);
  assert.equal(persistente.llamadas.length, 2, "bounded: one retry, then the error surfaces");
  ok("el reintento está acotado");

  const escritura = poolFalso([terminada]);
  instalarReintentoLectura(escritura.pool);
  await assert.rejects(escritura.pool.query("INSERT INTO plan_audit_log (request_id) VALUES ($1)"), /Connection terminated/);
  assert.equal(escritura.llamadas.length, 1, "a write is never replayed");
  const otroError = poolFalso([Object.assign(new Error("relation does not exist"), { code: "42P01" })]);
  instalarReintentoLectura(otroError.pool);
  await assert.rejects(otroError.pool.query("SELECT * FROM nada"), /does not exist/);
  assert.equal(otroError.llamadas.length, 1, "other errors are not retried");
  ok("escrituras y otros errores no se reintentan");

  process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
  const { getRagPool } = await import("../../src/lib/rag/db");
  const real = getRagPool() as Pool & { options: Record<string, unknown> };
  assert.equal(real.options.keepAlive, true);
  assert.ok(Number(real.options.idleTimeoutMillis) > 0 && Number(real.options.idleTimeoutMillis) < 5 * 60_000, "idle clients are released before Neon closes them");
  assert.ok(Number(real.options.maxLifetimeSeconds) > 0 && Number(real.options.maxLifetimeSeconds) < 5 * 60, "clients are recycled before the Neon cut");
  assert.ok(real.listenerCount("error") > 0, "an idle client error never crashes the process");
  assert.notEqual(real.query, (Object.getPrototypeOf(real) as Pool).query, "the pool query goes through the read retry");
  await real.end();
  ok("el pool RAG usa keepalive, recicla conexiones antes del corte y reintenta lecturas");

  console.log(`\n${casos} casos OK (reintento de lecturas del pool RAG)`);
}

main().catch((error: unknown) => {
  console.error("[FAIL] reintento de lecturas del pool RAG", error);
  process.exitCode = 1;
});
