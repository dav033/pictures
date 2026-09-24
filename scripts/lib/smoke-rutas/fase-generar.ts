import { writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { detalleRespuesta, type Contexto } from "./contexto";
import { esperarAuditoria, filasAuditoria } from "./evidencia-db";
import { campoTexto, esRegistro, type RespuestaHttp } from "./http";
import type { PlanSmoke } from "./plan";
import { prefijo, resumen, tokenRedactado, type Reporte } from "./reporte";
import { allowlistSinVariante, contextoVerificado, firmaManipulada, refirmar, SNAPSHOT_FALSO } from "./token";

/**
 * P4: /api/generate. The LORA_MODE_REQUIRED gate proves Python re-resolution,
 * hash binding, token verification and the CLIENT_APPROVED audit ran without a
 * paid call. Then, only with --paid-image, one real Gemini generation.
 */

export const RUTA_GENERAR = "/api/generate";
const TIMEOUT_IMAGEN_MS = 300_000;

export function cuerpoGenerar(plan: PlanSmoke, opciones: { usarLora: boolean }): Record<string, unknown> {
  return {
    productIds: [],
    ragVariantIds: plan.compras.map((compra) => compra.variant_id),
    plan,
    planHash: plan.plan_hash,
    brief: {},
    solicitudUsuario: "Smoke local: columna de globos redondos blancos",
    usarLora: opciones.usarLora,
    aspecto: "3:2",
  };
}

export async function llamarGenerar(ctx: Contexto, etiqueta: string, body: Record<string, unknown>, timeoutMs = 120_000): Promise<RespuestaHttp> {
  const plan = body.plan;
  const planLog = esRegistro(plan) ? `<PlanResuelto plan_hash=${prefijo(campoTexto(plan, "plan_hash"))} ${tokenRedactado(campoTexto(plan, "approval_token"))}>` : plan;
  ctx.reporte.info(`REQ ${etiqueta} POST ${RUTA_GENERAR} ${resumen({ ...body, plan: planLog }, 700)}`);
  return ctx.next.solicitar(RUTA_GENERAR, { body, headers: { "X-Correlation-ID": randomUUID() }, timeoutMs });
}

function errorEmpiezaCon(respuesta: RespuestaHttp, texto: string): boolean {
  return (campoTexto(respuesta.json, "error") ?? "").startsWith(texto);
}

export async function faseGenerar(ctx: Contexto, plan: PlanSmoke): Promise<void> {
  const reporte: Reporte = ctx.reporte;
  const contexto = contextoVerificado(plan.approval_token);
  reporte.exigir("P4.contexto token", contexto !== null, "token del plan final verificable");
  const conPlan = (planEnviado: PlanSmoke) => cuerpoGenerar(planEnviado, { usarLora: true });

  const desde = new Date(Date.now() - 1_000);
  const gate = await llamarGenerar(ctx, "P4.generate gate LoRA", conPlan(plan));
  reporte.check("P4.generate usarLora sin loraMode → 409 LORA_MODE_REQUIRED (tras revalidar)", gate.status === 409 && errorEmpiezaCon(gate, "LORA_MODE_REQUIRED:"), detalleRespuesta(gate, 250));
  const aprobadas = await esperarAuditoria(ctx.pool, { requestId: contexto.requestId, planHash: plan.plan_hash, estados: ["CLIENT_APPROVED"], desde });
  reporte.check("P4.audit CLIENT_APPROVED con plan_hash", aprobadas.length > 0, `filas=${aprobadas.length} request_id=${contexto.requestId} plan_hash=${prefijo(plan.plan_hash)}`);
  const aprobadasAntes = aprobadas.length;

  const compra = plan.compras[0]!;
  const sinVariante = await llamarGenerar(ctx, "P4.generate allowlist sin variante comprada", conPlan({ ...plan, approval_token: refirmar(contexto, { allowlist: allowlistSinVariante(contexto.allowlist, compra.variant_id) }) }));
  reporte.check("P4.diferencial allowlist sin variante → 400 hash mismatch", sinVariante.status === 400 && errorEmpiezaCon(sinVariante, "Plan hash does not match the validated server plan."), detalleRespuesta(sinVariante, 250));

  const hashAlterado = "f".repeat(64);
  const alterado = await llamarGenerar(ctx, "P4.generate plan_hash alterado", { ...conPlan({ ...plan, plan_hash: hashAlterado }), planHash: hashAlterado });
  reporte.check("P4.diferencial plan_hash alterado → 400", alterado.status === 400 && errorEmpiezaCon(alterado, "Plan hash does not match the validated server plan."), detalleRespuesta(alterado, 250));

  const manipulado = await llamarGenerar(ctx, "P4.generate token manipulado", conPlan({ ...plan, approval_token: firmaManipulada(plan.approval_token) }));
  reporte.check("P4.diferencial token manipulado → 400 APROBACION_REQUERIDA", manipulado.status === 400 && errorEmpiezaCon(manipulado, "APROBACION_REQUERIDA"), detalleRespuesta(manipulado, 250));

  const falso = await llamarGenerar(ctx, "P4.generate snapshot falsificado", conPlan({ ...plan, approval_token: refirmar(contexto, { catalogSnapshotId: SNAPSHOT_FALSO }) }));
  reporte.check("P4.diferencial snapshot falsificado → 400 variantes no validadas", falso.status === 400 && errorEmpiezaCon(falso, "One or more RAG variant IDs could not be validated"), detalleRespuesta(falso, 250));

  await esperar(1_500);
  const aprobadasDespues = (await filasAuditoria(ctx.pool, { requestId: contexto.requestId, planHash: plan.plan_hash, estados: ["CLIENT_APPROVED"], desde })).length;
  reporte.check("P4.diferenciales no escriben CLIENT_APPROVED", aprobadasDespues === aprobadasAntes, `antes=${aprobadasAntes} después=${aprobadasDespues}`);

  if (!ctx.config.imagenPagada) {
    reporte.info("P4.generación pagada no solicitada (usa --paid-image o SMOKE_ALLOW_PAID_IMAGE=true)");
    return;
  }
  await generacionPagada(ctx, plan);
}

async function generacionPagada(ctx: Contexto, plan: PlanSmoke): Promise<void> {
  const reporte: Reporte = ctx.reporte;
  const inicio = new Date();
  const inicioMs = Date.now();
  const respuesta = await llamarGenerar(ctx, "P4.generate PAGADA", cuerpoGenerar(plan, { usarLora: false }), TIMEOUT_IMAGEN_MS);
  const segundos = Math.round((Date.now() - inicioMs) / 1000);
  const json = esRegistro(respuesta.json) ? respuesta.json : {};
  const planDevuelto = esRegistro(json.plan) ? campoTexto(json.plan, "plan_hash") : undefined;
  reporte.info(`P4.generate PAGADA status=${respuesta.status} duración=${segundos}s proveedor=${campoTexto(json, "proveedor") ?? "-"} plan_hash_devuelto=${prefijo(planDevuelto)}`);

  if (respuesta.status === 200) {
    reporte.check("P4.generate pagada → 200", typeof json.imagen === "string" && json.imagen.startsWith("data:image/"), "imagen data URL presente");
    reporte.check("P4.generate pagada plan_hash eco", planDevuelto === plan.plan_hash, `devuelto=${prefijo(planDevuelto)} enviado=${prefijo(plan.plan_hash)}`);
    const match = typeof json.imagen === "string" ? /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(json.imagen) : null;
    if (reporte.check("P4.generate pagada imagen decodificable", match !== null, match ? `mime=image/${match[1]}` : "data URL inesperada") && match) {
      const extension = match[1]!.toLowerCase() === "jpeg" ? "jpg" : match[1]!.toLowerCase();
      const destino = path.join(ctx.config.artefactosDir, `smoke-image.${extension}`);
      const bytes = Buffer.from(match[2]!, "base64");
      await writeFile(destino, bytes);
      reporte.info(`P4.imagen guardada en ${destino} (${bytes.length} bytes)`);
    }
  } else {
    reporte.fail("P4.generate pagada", detalleRespuesta(respuesta, 400));
  }
  const filasImagen = await esperarAuditoria(ctx.pool, { requestId: plan.request_id, planHash: plan.plan_hash, estados: ["IMAGEN_GENERADA"], desde: inicio }, 5_000);
  reporte.info(`P4.audit imagen filas=${filasImagen.map((fila) => fila.status).join(",") || "(ninguna)"}`);
}
