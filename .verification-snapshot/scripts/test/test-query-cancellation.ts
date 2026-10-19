import { existsSync } from "node:fs";
import { Pool } from "pg";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

/**
 * Fase 7.4 (plan §Fase 7): "abortar una query en curso no está probado y
 * depende del driver y del pool. Hasta que se pruebe, el sistema no puede
 * prometer cancelación física." Este script prueba tres cosas reales contra
 * Postgres real (local, nunca Neon):
 *
 * A. ¿`statement_timeout` (ya configurado en src/lib/rag/db.ts, 30000ms en
 *    producción) cancela de verdad una consulta que se pasa de tiempo, o
 *    solo hace que el cliente deje de esperar mientras Postgres sigue
 *    trabajando? Se verifica contra `pg_stat_activity` de una conexión
 *    separada, no solo contra el rechazo de la promesa.
 * B. El patrón real de src/app/api/chat/route.ts (`conLimiteDeEspera`):
 *    cuando el LADO CLIENTE deja de esperar una promesa (race contra un
 *    timeout, sin abortar nada), ¿la query en Postgres se detiene con ella,
 *    o sigue corriendo huérfana hasta terminar o hasta `statement_timeout`?
 * C. ¿Existe un mecanismo real en el driver (`pg` 8.23) para cancelar
 *    físicamente una query en curso? Se prueba con `pool.connect()` +
 *    `client.query()` + el método interno `client.cancel(client, query)` —
 *    no documentado en el README pero presente y funcional en
 *    node_modules/pg/lib/client.js:574.
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL es requerido (usar el Postgres local, nunca Neon, para esta prueba)");

type PgActivityRow = { pid: number; state: string | null; query: string | null; query_start: string | null };

// pg_stat_activity.query conserva el TEXTO de la última consulta ejecutada
// en esa sesión incluso cuando la conexión queda idle en el pool -- no
// desaparece solo porque la query terminó. "Ya no está corriendo" se prueba
// con state <> 'active', nunca con la ausencia de la fila.
async function actividadPara(monitorPool: Pool, query_like: string): Promise<PgActivityRow[]> {
  const { rows } = await monitorPool.query<PgActivityRow>(
    `SELECT pid, state, query, query_start::text
       FROM pg_stat_activity
      WHERE query ILIKE $1 AND pid <> pg_backend_pid()`,
    [`%${query_like}%`],
  );
  return rows;
}

function ningunoActivo(rows: PgActivityRow[]): boolean {
  return rows.every((row) => row.state !== "active");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let fallos = 0;
function reportar(ok: boolean, nombre: string, detalle: string): void {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${nombre} — ${detalle}`);
  if (!ok) fallos++;
}

async function testA_statementTimeoutCancelaDeVerdad(monitorPool: Pool): Promise<void> {
  // statement_timeout corto (2s) para que la prueba sea rápida — MISMO
  // mecanismo que production (30s en src/lib/rag/db.ts), solo más rápido de
  // observar. Marcador único en la query para encontrarla en pg_stat_activity
  // sin ambigüedad con otras conexiones.
  const marker = "cancel_test_a_marker";
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 2000 });
  try {
    const started = Date.now();
    let error: unknown;
    try {
      await pool.query(`SELECT pg_sleep(10) /* ${marker} */`);
    } catch (e) {
      error = e;
    }
    const elapsedMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    reportar(
      Boolean(error) && elapsedMs < 5000,
      "Test A1: statement_timeout=2000ms rechaza la promesa cerca de 2s, no espera los 10s de pg_sleep",
      `elapsed=${elapsedMs}ms, error=${JSON.stringify(message)}`,
    );
    reportar(
      /statement timeout|canceling statement/i.test(message),
      "Test A2: el error es identificable como cancelación de Postgres por statement_timeout, no un timeout genérico del cliente",
      `mensaje="${message}"`,
    );
    // Postgres necesita un instante para limpiar el backend después de cancelar.
    await sleep(300);
    const activos = await actividadPara(monitorPool, marker);
    reportar(
      ningunoActivo(activos),
      "Test A3: pg_stat_activity confirma que el backend ya no está 'active' ejecutando esa query — cancelación física real, no solo el cliente dejando de esperar",
      `filas: ${JSON.stringify(activos)}`,
    );
  } finally {
    await pool.end();
  }
}

async function testB_abandonoDelClienteNoCancelaNada(monitorPool: Pool): Promise<void> {
  // Replica el patrón real de conLimiteDeEspera (src/app/api/chat/route.ts):
  // race la promesa de la query contra un timeout del LADO CLIENTE, sin
  // llamar a ningún método de cancelación ni pasar ningún AbortSignal al
  // driver — exactamente lo que hace hoy el código de producción.
  const marker = "cancel_test_b_marker";
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 30000 });
  try {
    const queryPromise = pool.query(`SELECT pg_sleep(4) /* ${marker} */`);
    // "Dar por perdida" la espera, tal como conLimiteDeEspera: el cliente
    // deja de awaitear, pero la promesa original sigue viva sin abortar nada.
    const clienteTimeout = new Promise<"cliente_desistio">((resolve) => setTimeout(() => resolve("cliente_desistio"), 500));
    const carrera = await Promise.race([queryPromise.then(() => "query_completo" as const), clienteTimeout]);
    reportar(
      carrera === "cliente_desistio",
      "Test B1: el cliente deja de esperar a los 500ms (simula conLimiteDeEspera dando por perdida la espera)",
      `resultado de la carrera=${carrera}`,
    );
    // Mientras el cliente ya "se rindió", ¿sigue corriendo el backend real?
    await sleep(200);
    const activosMientrasCorre = await actividadPara(monitorPool, marker);
    reportar(
      activosMientrasCorre.length === 1 && activosMientrasCorre[0].state === "active",
      "Test B2: el backend de Postgres SIGUE corriendo la query después de que el cliente se rindió — el abandono del lado cliente no cancela nada en el servidor",
      `backends activos con ese marcador tras el abandono: ${JSON.stringify(activosMientrasCorre)}`,
    );
    // Dejar que termine sola para no ensuciar el pool para el siguiente test.
    await queryPromise.catch(() => undefined);
    await sleep(200);
    const activosDespues = await actividadPara(monitorPool, marker);
    reportar(
      ningunoActivo(activosDespues),
      "Test B3: control — una vez que pg_sleep(4) termina por sí sola (no por cancelación), el backend deja de estar 'active'",
      `filas: ${JSON.stringify(activosDespues)}`,
    );
  } finally {
    await pool.end();
  }
}

async function testC_cancelacionFisicaRealEsPosibleConLaAPIInterna(monitorPool: Pool): Promise<void> {
  // pool.query() NUNCA expone el Client subyacente ni el objeto Query activo
  // -- para cancelar de verdad hace falta pool.connect() + client.query() +
  // guardar el objeto Query, y llamar al método interno (no documentado en
  // el README, pero público y estable en esta versión) client.cancel().
  const marker = "cancel_test_c_marker";
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 30000 });
  try {
    const client = await pool.connect();
    try {
      const started = Date.now();
      // client.query(text) sin callback ni Query preconstruido devuelve una
      // Promise, no el objeto Query -- y ese objeto Query es justamente lo
      // que client.cancel(client, query) necesita para identificar cuál
      // query activa cancelar. Pasar un objeto Query ya construido
      // (`typeof config.submit === "function"`, client.js:677) hace que
      // client.query() devuelva ESE MISMO objeto Query en vez de una
      // Promise -- su API es de eventos (`row`, `end`, `error`), no thenable.
      const { Query } = await import("pg");
      const query = new Query(`SELECT pg_sleep(10) /* ${marker} */`);
      client.query(query);
      let cancelError: unknown;
      const resultOutcome = new Promise<"completed" | "rejected">((resolve) => {
        query.on("end", () => resolve("completed"));
        query.on("error", (error: unknown) => { cancelError = error; resolve("rejected"); });
      });

      // Espera a que el backend esté realmente ejecutando la query antes de
      // cancelar -- cancelar antes de que Postgres la reciba no prueba nada.
      let vistoActivo = false;
      for (let i = 0; i < 20 && !vistoActivo; i++) {
        await sleep(100);
        const activos = await actividadPara(monitorPool, marker);
        vistoActivo = activos.length === 1 && activos[0].state === "active";
      }
      reportar(vistoActivo, "Test C1: el backend de Postgres llegó a ejecutar la query antes de intentar cancelarla", `visto activo=${vistoActivo}`);

      // client.cancel(target, query) NO se llama sobre la conexión ocupada
      // -- esa está bloqueada esperando el resultado de pg_sleep y no puede
      // atender nada más. El protocolo de cancelación de Postgres exige una
      // conexión NUEVA que envíe un CancelRequest con el processID/secretKey
      // de la conexión ocupada (node_modules/pg/lib/client.js:574-587: `con
      // = this.connection` es la conexión de QUIEN LLAMA, no la del target).
      // Se usa un Client nuevo, sin conectar, exclusivamente para esto.
      const { Client } = await import("pg");
      const canceller = new Client({ connectionString: DATABASE_URL });
      (canceller as unknown as { cancel: (target: unknown, q: unknown) => void }).cancel(client, query);

      const outcome = await resultOutcome;
      const elapsedMs = Date.now() - started;
      const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
      reportar(
        outcome === "rejected" && elapsedMs < 5000,
        "Test C2: client.cancel(client, query) hace que la promesa rechace mucho antes de los 10s de pg_sleep",
        `outcome=${outcome}, elapsed=${elapsedMs}ms`,
      );
      reportar(
        /canceling statement due to user request/i.test(message),
        "Test C3: el error es la cancelación real de Postgres por solicitud del usuario, no un error genérico",
        `mensaje="${message}"`,
      );
      await sleep(300);
      const activosDespues = await actividadPara(monitorPool, marker);
      reportar(
        ningunoActivo(activosDespues),
        "Test C4: pg_stat_activity confirma que el backend dejó de estar 'active' — cancelación física real, verificable, disponible en el driver hoy",
        `filas: ${JSON.stringify(activosDespues)}`,
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const monitorPool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    console.log("=== Test A: ¿statement_timeout cancela de verdad? ===");
    await testA_statementTimeoutCancelaDeVerdad(monitorPool);
    console.log("\n=== Test B: ¿el abandono del cliente (patrón conLimiteDeEspera) cancela algo? ===");
    await testB_abandonoDelClienteNoCancelaNada(monitorPool);
    console.log("\n=== Test C: ¿existe un mecanismo real de cancelación física en el driver? ===");
    await testC_cancelacionFisicaRealEsPosibleConLaAPIInterna(monitorPool);
  } finally {
    await monitorPool.end();
  }
  console.log(`\n${fallos === 0 ? "OK" : `${fallos} FALLO(S)`}`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
