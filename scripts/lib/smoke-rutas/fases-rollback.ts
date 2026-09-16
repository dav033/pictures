import { setTimeout as esperar } from "node:timers/promises";
import { detalleRespuesta, type Contexto } from "./contexto";
import { filasAuditoria } from "./evidencia-db";
import { campoTexto, type RespuestaHttp } from "./http";
import { lineas, type EstadoSmoke } from "./plan";
import { cuerpoGenerar, llamarGenerar } from "./fase-generar";
import { llamarEditar } from "./fase-editar";
import { echoConIdempotencia } from "./fase-preflight";

/**
 * Rollback control, run after the orchestrator restarts Next:
 * - python-down: PYTHON_BACKEND_URL points to a closed port. No TS fallback:
 *   every Python-owned operation answers 502 PYTHON_UNAVAILABLE.
 * The phase may not write CLIENT_APPROVED/PLAN_EDITED rows for the saved plan.
 *
 * The kill-switch phase lived here until ADR-0023 step 5 retired
 * `PYTHON_BACKEND_KILL_SWITCH`: it asserted 409 PYTHON_NO_SELECCIONADO on the
 * four Python-owned operations, and neither the variable nor that cause exists
 * any more. Recovery is deploying the previous revision, not flipping a switch.
 */

const ESTADOS_ESCRITURA = ["CLIENT_APPROVED", "PLAN_EDITED"];

function espera(ctx: Contexto, nombre: string, respuesta: RespuestaHttp, status: number, campo: "code", valor: string): void {
  ctx.reporte.check(nombre, respuesta.status === status && campoTexto(respuesta.json, campo) === valor, detalleRespuesta(respuesta, 300));
}

async function operacionesPlan(ctx: Contexto, estado: EstadoSmoke, etiqueta: string): Promise<{ generar: RespuestaHttp; aplicar: RespuestaHttp; recomendadas: RespuestaHttp; buscarConToken: RespuestaHttp }> {
  const plan = estado.plan;
  const linea = lineas(plan)[0]!;
  const generar = await llamarGenerar(ctx, `${etiqueta}.generate`, cuerpoGenerar(plan, { usarLora: true, imageQaRequested: false }));
  const aplicar = await llamarEditar(ctx, `${etiqueta}.aplicar`, { modo: "aplicar", base: plan, edicion: { accion: "quitar", estructura_id: linea.estructura_id, objetivo_variant_id: linea.variant_id } });
  const recomendadas = await llamarEditar(ctx, `${etiqueta}.recomendadas`, { modo: "recomendadas", variant_id: linea.variant_id, approval_token: plan.approval_token });
  const buscarConToken = await llamarEditar(ctx, `${etiqueta}.buscar con token`, { modo: "buscar", consulta: "globo latex redondo fashion blanco", approval_token: plan.approval_token });
  return { generar, aplicar, recomendadas, buscarConToken };
}

async function sinEscrituras(ctx: Contexto, estado: EstadoSmoke, etiqueta: string, desde: Date): Promise<void> {
  await esperar(1_500);
  const filas = await filasAuditoria(ctx.pool, { requestId: estado.plan.request_id, estados: ESTADOS_ESCRITURA, desde });
  ctx.reporte.check(`${etiqueta}.sin filas CLIENT_APPROVED/PLAN_EDITED nuevas`, filas.length === 0, `filas=${filas.map((fila) => fila.status).join(",") || "0"}`);
}

export async function fasePythonDown(ctx: Contexto, estado: EstadoSmoke): Promise<void> {
  const desde = new Date();

  const { primera } = await echoConIdempotencia(ctx);
  espera(ctx, "D.echo → 502 PYTHON_UNAVAILABLE", primera, 502, "code", "PYTHON_UNAVAILABLE");

  const r = await operacionesPlan(ctx, estado, "D");
  espera(ctx, "D.generate plan python → 502 PYTHON_UNAVAILABLE (sin fallback TS)", r.generar, 502, "code", "PYTHON_UNAVAILABLE");
  espera(ctx, "D.plan-editar aplicar → 502 PYTHON_UNAVAILABLE", r.aplicar, 502, "code", "PYTHON_UNAVAILABLE");
  espera(ctx, "D.plan-editar recomendadas → 502 PYTHON_UNAVAILABLE (ya no es SQL de Next)", r.recomendadas, 502, "code", "PYTHON_UNAVAILABLE");
  espera(ctx, "D.plan-editar buscar con token → 502 PYTHON_UNAVAILABLE", r.buscarConToken, 502, "code", "PYTHON_UNAVAILABLE");

  await sinEscrituras(ctx, estado, "D", desde);
}
