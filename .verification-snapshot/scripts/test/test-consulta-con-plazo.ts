/**
 * D-038, las lecturas del catálogo en el camino de un turno de chat tienen plazo (`consultaConPlazo`, `consultaDelCosteo`): una base lenta
 * o caída nunca deja el turno colgado, y la conexión interrumpida no vuelve al pool con una consulta a medias. Con un pool falso, sin red.
 * - la conexión que no llega, la que llega tarde y la consulta lenta fallan con `PlazoDeLecturaError` dentro de su plazo;
 * - se pide `query_timeout` a pg; abortar la señal del turno corta la espera; una conexión interrumpida se destruye (`release(true)`);
 * - el presupuesto de un costeo es de todas sus lecturas y empieza con la primera.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-consulta-con-plazo.ts
 */
import assert from "node:assert/strict";
import type { PoolClient, QueryConfig } from "pg";
import { consultaDelCosteo } from "../../src/lib/guiada-motor/consulta-del-costeo";
import { consultaConPlazo, PlazoDeLecturaError } from "../../src/lib/rag/consulta-con-plazo";

type Liberacion = boolean | undefined;
type Cliente = { query: (config: QueryConfig) => Promise<{ rows: unknown[] }> };

/** Un pool falso: cada `connect` espera `conectaEnMs` (nunca, si es `null`) y entrega un cliente cuya consulta hace lo que diga `consulta`. */
function poolFalso(opciones: { conectaEnMs: number | null; consulta: Cliente["query"] }) {
  const registro = { conexiones: 0, liberaciones: [] as Liberacion[], consultas: [] as QueryConfig[] };
  const cliente = {
    query: (config: QueryConfig) => { registro.consultas.push(config); return opciones.consulta(config); },
    release: (destruir?: boolean) => { registro.liberaciones.push(destruir); },
  } as unknown as PoolClient;
  return {
    registro,
    pool: {
      connect: () => {
        registro.conexiones += 1;
        return opciones.conectaEnMs === null ? new Promise<PoolClient>(() => undefined) : new Promise<PoolClient>((resolver) => setTimeout(() => resolver(cliente), opciones.conectaEnMs!));
      },
    },
  };
}

const esperar = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));
const nuncaResponde = (): Promise<{ rows: unknown[] }> => new Promise(() => undefined);
const fallaCon = async (accion: Promise<unknown>): Promise<PlazoDeLecturaError> => {
  const error = await accion.then(() => null, (e: unknown) => e);
  assert.ok(error instanceof PlazoDeLecturaError, `se esperaba PlazoDeLecturaError y fue ${String(error)}`);
  return error;
};
async function cronometrada<T>(accion: () => Promise<T>): Promise<{ resultado: T; ms: number }> {
  const inicio = performance.now();
  const resultado = await accion();
  return { resultado, ms: performance.now() - inicio };
}

async function main(): Promise<void> {
  // 1. La consulta que responde: filas, `query_timeout` pedido a pg y conexión devuelta sana.
  const bien = poolFalso({ conectaEnMs: 0, consulta: async () => ({ rows: [{ x: 1 }] }) });
  const resultado = await consultaConPlazo(bien.pool, { conexionMs: 200, consultaMs: 300 }).query("SELECT $1", [7]);
  assert.deepEqual(resultado.rows, [{ x: 1 }]);
  assert.deepEqual(bien.registro.liberaciones, [false], "una consulta que respondió devuelve la conexión sin destruirla");
  const pedida = bien.registro.consultas[0] as (QueryConfig & { query_timeout?: number }) | undefined;
  assert.deepEqual([pedida?.text, pedida?.values, pedida?.query_timeout], ["SELECT $1", [7], 300], "pg corta la consulta a los 300 ms por su cuenta");
  console.log("[PASS] la consulta que responde devuelve sus filas, pide query_timeout y devuelve la conexión sana");

  // 2. Una conexión que no llega: plazo de conexión, dentro del plazo.
  const sinConexion = poolFalso({ conectaEnMs: null, consulta: nuncaResponde });
  const colgada = await cronometrada(() => fallaCon(consultaConPlazo(sinConexion.pool, { conexionMs: 60, consultaMs: 5_000 }).query("SELECT 1")));
  assert.deepEqual([colgada.resultado.fase, colgada.resultado.causa], ["conexion", "plazo"]);
  assert.ok(colgada.ms < 400, `la espera de la conexión se corta a los 60 ms (fueron ${Math.round(colgada.ms)})`);
  assert.equal(sinConexion.registro.consultas.length, 0, "sin conexión no se consulta");

  // 3. Una conexión que llega tarde nunca ejecuta nada y vuelve al pool.
  const tarde = poolFalso({ conectaEnMs: 150, consulta: async () => ({ rows: [] }) });
  await fallaCon(consultaConPlazo(tarde.pool, { conexionMs: 40, consultaMs: 5_000 }).query("SELECT 1"));
  await esperar(250);
  assert.equal(tarde.registro.consultas.length, 0, "la conexión tardía no ejecuta la consulta que nadie espera");
  assert.deepEqual(tarde.registro.liberaciones, [undefined], "y se devuelve al pool");
  console.log("[PASS] una conexión que no llega, o que llega tarde, falla dentro de su plazo y no se queda con el pool");

  // 4. Una consulta lenta: plazo de consulta y conexión destruida.
  const lenta = poolFalso({ conectaEnMs: 0, consulta: nuncaResponde });
  const vencida = await cronometrada(() => fallaCon(consultaConPlazo(lenta.pool, { conexionMs: 200, consultaMs: 60 }).query("SELECT pg_sleep(60)")));
  assert.deepEqual([vencida.resultado.fase, vencida.resultado.causa], ["consulta", "plazo"]);
  assert.ok(vencida.ms < 400, `la espera de la consulta se corta a los 60 ms (fueron ${Math.round(vencida.ms)})`);
  assert.deepEqual(lenta.registro.liberaciones, [true], "la conexión con una consulta a medias se destruye");

  // 5. La señal del turno corta la espera ya empezada; una señal ya abortada ni conecta.
  const turno = new AbortController();
  const cancelable = poolFalso({ conectaEnMs: 0, consulta: nuncaResponde });
  const esperando = fallaCon(consultaConPlazo(cancelable.pool, { signal: turno.signal, conexionMs: 5_000, consultaMs: 5_000 }).query("SELECT 1"));
  await esperar(30);
  turno.abort();
  const cancelada = await cronometrada(() => esperando);
  assert.deepEqual([cancelada.resultado.fase, cancelada.resultado.causa], ["consulta", "cancelada"]);
  assert.deepEqual(cancelable.registro.liberaciones, [true]);
  const yaAbortada = poolFalso({ conectaEnMs: 0, consulta: async () => ({ rows: [] }) });
  assert.equal((await fallaCon(consultaConPlazo(yaAbortada.pool, { signal: AbortSignal.abort(), conexionMs: 100, consultaMs: 100 }).query("SELECT 1"))).causa, "cancelada");
  assert.equal(yaAbortada.registro.conexiones, 0, "una señal ya abortada no abre ninguna conexión");
  const presupuestoAgotado = poolFalso({ conectaEnMs: 0, consulta: async () => ({ rows: [] }) });
  assert.equal((await fallaCon(consultaConPlazo(presupuestoAgotado.pool, { presupuesto: AbortSignal.abort(), conexionMs: 100, consultaMs: 100 }).query("SELECT 1"))).causa, "plazo");
  assert.equal(presupuestoAgotado.registro.conexiones, 0);
  console.log("[PASS] la consulta lenta se corta y destruye su conexión; abortar el turno deja de esperar al instante");

  // 6. Un error de pg: su propio timeout destruye la conexión; cualquier otro, no.
  const pgCorta = poolFalso({ conectaEnMs: 0, consulta: async () => { throw new Error("Query read timeout"); } });
  await consultaConPlazo(pgCorta.pool, { conexionMs: 100, consultaMs: 100 }).query("SELECT 1").then(() => assert.fail("debía fallar"), (e: unknown) => assert.match(String(e), /Query read timeout/));
  assert.deepEqual(pgCorta.registro.liberaciones, [true]);
  const sintaxis = poolFalso({ conectaEnMs: 0, consulta: async () => { throw new Error("syntax error at or near"); } });
  await consultaConPlazo(sintaxis.pool, { conexionMs: 100, consultaMs: 100 }).query("SELEC 1").then(() => assert.fail("debía fallar"), (e: unknown) => assert.match(String(e), /syntax error/));
  assert.deepEqual(sintaxis.registro.liberaciones, [false], "un error de la consulta no daña la conexión");
  console.log("[PASS] solo el timeout de pg destruye la conexión; un error de SQL la devuelve sana");

  // 7. El presupuesto de un costeo es de todas sus lecturas y empieza con la primera.
  const unaVez = poolFalso({ conectaEnMs: 0, consulta: async () => ({ rows: [{ ok: true }] }) });
  const plazos = { presupuestoMs: 150, conexionMs: 1_000, consultaMs: 1_000 };
  const costeo = consultaDelCosteo(new AbortController().signal, async () => unaVez.pool, plazos);
  await esperar(200);
  assert.deepEqual((await costeo.query("SELECT 1")).rows, [{ ok: true }], "el presupuesto no corre mientras nadie consulta");
  const sinPresupuesto = poolFalso({ conectaEnMs: 0, consulta: nuncaResponde });
  const primera = consultaDelCosteo(new AbortController().signal, async () => sinPresupuesto.pool, plazos);
  const primeraLenta = await cronometrada(() => fallaCon(primera.query("SELECT 1")));
  assert.equal(primeraLenta.resultado.causa, "plazo");
  assert.ok(primeraLenta.ms >= 100 && primeraLenta.ms < 500, `la primera lectura agota el presupuesto (${Math.round(primeraLenta.ms)} ms)`);
  const conexionesAntes = sinPresupuesto.registro.conexiones;
  const segunda = await cronometrada(() => fallaCon(primera.query("SELECT 2")));
  assert.ok(segunda.ms < 50, `con el presupuesto agotado la segunda lectura falla al instante (${Math.round(segunda.ms)} ms)`);
  assert.equal(sinPresupuesto.registro.conexiones, conexionesAntes, "y no abre otra conexión");
  const delTurno = new AbortController();
  const cortada = consultaDelCosteo(delTurno.signal, async () => poolFalso({ conectaEnMs: 0, consulta: nuncaResponde }).pool, { presupuestoMs: 5_000, conexionMs: 5_000, consultaMs: 5_000 });
  const enCurso = fallaCon(cortada.query("SELECT 1"));
  await esperar(20);
  delTurno.abort();
  assert.equal((await enCurso).causa, "cancelada", "abortar el turno corta también las lecturas del costeo");
  console.log("[PASS] el presupuesto del costeo se comparte entre sus lecturas, empieza con la primera y se corta con el turno");

  console.log("\ntest-consulta-con-plazo: ok");
}

// `AbortSignal.timeout` no mantiene vivo el proceso: sin este latido, una espera que solo depende de un plazo dejaría salir a Node con 0 sin acabar.
const latido = setInterval(() => undefined, 1_000);
let acabo = false;
process.on("exit", (codigo) => { if (!acabo && codigo === 0) { console.error("test-consulta-con-plazo: el proceso terminó sin acabar la prueba"); process.exitCode = 1; } });
main().then(() => { acabo = true; clearInterval(latido); process.exit(0); }, (error: unknown) => { console.error(error); process.exit(1); });
