/**
 * Live local smoke of the real HTTP routes for the Python commercial-authority
 * cutover. It talks to an already running Next dev server (default
 * http://127.0.0.1:3100) and FastAPI (PYTHON_BACKEND_URL), and reads evidence
 * from the loopback PostgreSQL. It never starts or stops services.
 *
 *   npm run smoke:rutas-python-local -- --phase=python-on --state <archivo> [--paid-image]
 *
 * Phases: python-on (P0-P4, saves the final plan to --state) and python-down
 * (requires Next restarted by the operator; reads --state).
 * Any failed assertion or misconfiguration prints [FAIL] and exits 1.
 */
import type { Pool } from "pg";
import { isPythonAdapterError } from "../src/lib/ia/python-adapter";
import { leerConfig, type ConfigSmoke } from "./lib/smoke-rutas/entorno";
import type { Contexto } from "./lib/smoke-rutas/contexto";
import { contarNonces, crearPool, snapshotsPublicados } from "./lib/smoke-rutas/evidencia-db";
import { faseChat } from "./lib/smoke-rutas/fase-chat";
import { faseEditar } from "./lib/smoke-rutas/fase-editar";
import { faseFastapi } from "./lib/smoke-rutas/fase-fastapi";
import { faseGenerar } from "./lib/smoke-rutas/fase-generar";
import { echoPython, preflightFastapi, preflightSesion } from "./lib/smoke-rutas/fase-preflight";
import { fasePythonDown } from "./lib/smoke-rutas/fases-rollback";
import { ClienteNext } from "./lib/smoke-rutas/http";
import { guardarEstado, leerEstado, verificarTokenPlan, type PlanSmoke } from "./lib/smoke-rutas/plan";
import { AbortoFase, prefijo, Reporte } from "./lib/smoke-rutas/reporte";

async function fasePythonOn(ctx: Contexto): Promise<void> {
  await echoPython(ctx);
  const noncesAntes = await contarNonces(ctx.pool);
  await faseFastapi(ctx, noncesAntes);
  let planChat: PlanSmoke;
  if (ctx.config.reutilizarChat) {
    // Re-verifies a plan confirmed by an earlier paid chat run instead of paying again.
    const previo = await leerEstado(ctx.config.statePath);
    ctx.reporte.info(`P2.chat NO ejecutado: se reutiliza plan_chat del estado (plan_hash=${prefijo(previo.plan_chat.plan_hash)})`);
    planChat = previo.plan_chat;
    verificarTokenPlan(ctx.reporte, "P2.reutilizado", planChat, { snapshotId: ctx.snapshotId });
  } else {
    planChat = await faseChat(ctx);
  }
  await guardarEstado(ctx.config.statePath, { snapshot_id: ctx.snapshotId, plan_chat: planChat, plan: planChat });
  const planFinal = await faseEditar(ctx, planChat);
  await guardarEstado(ctx.config.statePath, { snapshot_id: ctx.snapshotId, plan_chat: planChat, plan: planFinal });
  ctx.reporte.info(`estado guardado en ${ctx.config.statePath} plan_hash=${prefijo(planFinal.plan_hash)} total_cop=${planFinal.totales.total_cop}`);
  await faseGenerar(ctx, planFinal);
}

async function ejecutar(config: ConfigSmoke, reporte: Reporte, pool: Pool): Promise<void> {
  const snapshots = await snapshotsPublicados(pool);
  reporte.exigir("P0.db snapshot products_catalog publicado único", snapshots.length === 1, `publicados=${snapshots.length}`);
  const ctx: Contexto = { config, reporte, next: new ClienteNext(config.nextUrl), pool, snapshotId: snapshots[0]! };
  reporte.info(`fase=${config.fase} next=${config.nextUrl.origin} fastapi=${config.fastapiUrl.origin} snapshot=${ctx.snapshotId}`);

  await preflightFastapi(ctx);
  await preflightSesion(ctx);

  if (config.fase === "python-on") {
    await fasePythonOn(ctx);
    return;
  }
  const estado = await leerEstado(config.statePath);
  reporte.exigir("estado.snapshot coincide", estado.snapshot_id === ctx.snapshotId, `estado=${estado.snapshot_id}`);
  await fasePythonDown(ctx, estado);
}

async function main(): Promise<void> {
  const reporte = new Reporte();
  const leido = leerConfig(process.argv.slice(2), process.env);
  if ("errores" in leido) {
    for (const error of leido.errores) reporte.fail("configuración", error);
    process.exitCode = 1;
    return;
  }
  const pool = crearPool(leido.config.databaseUrl);
  try {
    await ejecutar(leido.config, reporte, pool);
  } catch (error) {
    if (!(error instanceof AbortoFase)) {
      const detalle = isPythonAdapterError(error)
        ? `PythonAdapterError code=${error.code} domainCode=${error.domainCode ?? "-"} status=${error.status}`
        : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      reporte.fail("excepción no controlada", detalle);
    } else {
      reporte.info(`fase abortada: ${error.message}`);
    }
  } finally {
    await pool.end();
  }
  console.log(`\nResumen fase=${leido.config.fase}: ${reporte.totalAciertos} PASS, ${reporte.totalFallos} FAIL`);
  process.exitCode = reporte.totalFallos > 0 ? 1 : 0;
}

void main();
