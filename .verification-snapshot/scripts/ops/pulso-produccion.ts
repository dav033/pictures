/**
 * Pulso de producción, gratis y de solo lectura: `npm run prod:pulso -- --env-file <ruta> [--horas 6] [--incluir-propio]`.
 *
 * Lee Neon (DATABASE_URL del archivo, dentro de `BEGIN READ ONLY`), sondea /login y mira el último despliegue de producción con
 * `vercel ls`. Sin llamadas de pago, sin imprimir secretos ni texto del cliente: solo agregados. Sale con 1 y una línea
 * `ALERTA:` por cada umbral pasado (`scripts/lib/pulso/pulso-produccion.ts`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { Pool } from "pg";
import { urlConSslExplicito } from "../../src/lib/rag/url-conexion";
import { evaluarAlertas, formatearPulso, resumirPulso, ultimoDespliegueDeProduccion, type DatosPulso, type Despliegue, type FilaFeedback, type FilaLlamada, type FilaPlan } from "../lib/pulso/pulso-produccion";

const URL_LOGIN = "https://demo-decoracion.vercel.app/login";
const PROYECTO_VERCEL = "demo-decoracion";
const HORAS_POR_DEFECTO = 6;
const PLAZO_CONSULTA_MS = 20_000;
const PLAZO_SONDA_MS = 10_000;
const PLAZO_VERCEL_MS = 30_000;

function leerOpciones(): { archivoEntorno: string; horas: number; incluirPropio: boolean } {
  const { values } = parseArgs({ options: { "env-file": { type: "string" }, horas: { type: "string" }, "incluir-propio": { type: "boolean" } }, allowPositionals: false });
  const archivoEntorno = values["env-file"];
  const horas = values.horas === undefined ? HORAS_POR_DEFECTO : Number(values.horas);
  if (!archivoEntorno) throw new Error("falta --env-file <archivo con DATABASE_URL>");
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 30) throw new Error("--horas debe ser un número entre 0 y 720");
  return { archivoEntorno, horas, incluirPropio: values["incluir-propio"] === true };
}

/** Solo se toma DATABASE_URL del archivo: el resto de sus variables (claves de proveedores) nunca entra al proceso. */
function leerUrlDeLaBase(archivoEntorno: string): string {
  const url = parseEnv(readFileSync(archivoEntorno, "utf8")).DATABASE_URL;
  if (!url) throw new Error("el archivo no trae DATABASE_URL");
  return urlConSslExplicito(url);
}

const numero = (valor: unknown): number => Number(valor ?? 0);

async function leerBase(url: string, horas: number): Promise<Pick<DatosPulso, "feedback" | "plan" | "llamadas">> {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN READ ONLY");
    await cliente.query(`SET LOCAL statement_timeout = ${PLAZO_CONSULTA_MS}`);
    const ventana = [horas];
    const feedback = await cliente.query(
      `SELECT producto, COALESCE(version_app LIKE '%+local', false) AS propio, calificacion, deshecho, count(*)::int AS cuantos
         FROM ai_feedback WHERE actualizado_en >= now() - ($1::float8 * interval '1 hour') GROUP BY 1, 2, 3, 4`, ventana);
    const plan = await cliente.query(
      `SELECT status AS estado, COALESCE(flag_snapshot->>'efectivo', 'n/d') AS motor, COALESCE(geometry->>'razon', '') AS razon, count(*)::int AS cuantos
         FROM plan_audit_log WHERE created_at >= now() - ($1::float8 * interval '1 hour') GROUP BY 1, 2, 3`, ventana);
    const llamadas = await cliente.query(
      `SELECT proveedor, modelo, COALESCE(superficie, 'n/d') AS superficie, resultado, (proveedor = 'anthropic') AS propio, count(*)::int AS cuantos,
              COALESCE(sum(coste_estimado), 0)::float8 AS coste, max(moneda) AS moneda
         FROM ai_call_log WHERE created_at >= now() - ($1::float8 * interval '1 hour') GROUP BY 1, 2, 3, 4, 5`, ventana);
    return {
      feedback: feedback.rows.map((f): FilaFeedback => ({ producto: String(f.producto), propio: f.propio === true, calificacion: f.calificacion === null ? null : numero(f.calificacion), deshecho: f.deshecho === true, cuantos: numero(f.cuantos) })),
      plan: plan.rows.map((f): FilaPlan => ({ estado: String(f.estado), motor: String(f.motor), razon: String(f.razon), cuantos: numero(f.cuantos) })),
      llamadas: llamadas.rows.map((f): FilaLlamada => ({ proveedor: String(f.proveedor), modelo: String(f.modelo), superficie: String(f.superficie), resultado: String(f.resultado), propio: f.propio === true, cuantos: numero(f.cuantos), coste: numero(f.coste), moneda: f.moneda === null ? null : String(f.moneda) })),
    };
  } finally {
    await cliente.query("ROLLBACK").catch(() => undefined);
    cliente.release();
    await pool.end();
  }
}

async function sondearLogin(): Promise<number | null> {
  try {
    const respuesta = await fetch(URL_LOGIN, { redirect: "manual", signal: AbortSignal.timeout(PLAZO_SONDA_MS) });
    return respuesta.status;
  } catch {
    return null;
  }
}

/** `vercel ls` con la CLI del PC; sin CLI, sin sesión o sin red, `null` (la sonda se omite sin romper el informe). */
function leerDespliegue(): Despliegue | null {
  try {
    const salida = spawnSync("vercel", ["ls", PROYECTO_VERCEL], { shell: true, encoding: "utf8", timeout: PLAZO_VERCEL_MS });
    return salida.status === 0 ? ultimoDespliegueDeProduccion(`${salida.stdout}\n${salida.stderr}`) : null;
  } catch {
    return null;
  }
}

async function principal(): Promise<number> {
  const opciones = leerOpciones();
  const url = leerUrlDeLaBase(opciones.archivoEntorno);
  const [base, login] = await Promise.all([leerBase(url, opciones.horas), sondearLogin()]);
  const resumen = resumirPulso({ horas: opciones.horas, incluirPropio: opciones.incluirPropio, ...base, login, despliegue: leerDespliegue() });
  const alertas = evaluarAlertas(resumen);
  console.log(formatearPulso(resumen, alertas, new Date()).join("\n"));
  return alertas.length ? 1 : 0;
}

principal().then(
  (codigo) => { process.exit(codigo); },
  (causa: unknown) => {
    // Con código (de `pg` o del sistema) solo el código: el mensaje de `pg` puede traer el servidor.
    const codigo = typeof causa === "object" && causa !== null && "code" in causa ? String((causa as { code: unknown }).code) : undefined;
    console.error(`prod:pulso no pudo correr: ${codigo ? `fallo ${codigo}` : causa instanceof Error ? causa.message : "fallo desconocido"}`);
    process.exit(2);
  },
);
