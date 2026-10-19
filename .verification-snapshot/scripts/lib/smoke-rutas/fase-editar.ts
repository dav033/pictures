import { setTimeout as esperar } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { detalleRespuesta, type Contexto } from "./contexto";
import { esperarAuditoria, filasAuditoria, varianteFueraDe, variantesPorId } from "./evidencia-db";
import { campoTexto, esRegistro, type RespuestaHttp } from "./http";
import { lineas, PlanSmokeSchema, resumenPlan, verificarTokenPlan, type PlanSmoke } from "./plan";
import { prefijo, tokenRedactado, type Reporte } from "./reporte";
import { allowlistSinVariante, contextoVerificado, firmaManipulada, payloadManipuladoConFirmaVieja, refirmar, SNAPSHOT_FALSO } from "./token";

/**
 * P3: /api/plan-editar on the plan confirmed by the chat. Each successful step
 * feeds the next one; rejections use the latest valid plan as base.
 */

const VarianteSchema = z.looseObject({
  variantId: z.string().min(1),
  codigoTamano: z.string().nullable().optional(),
  diamPulg: z.number().nullable().optional(),
  colores: z.array(z.string()).optional(),
  disponible: z.boolean().optional(),
});
const CandidatoSchema = z.looseObject({ productId: z.string().min(1), variantes: z.array(VarianteSchema) });
const CandidatosSchema = z.looseObject({ candidatos: z.array(CandidatoSchema) });
type Candidato = z.infer<typeof CandidatoSchema>;
type Variante = { product_id: string; variant_id: string; color?: string };

export const RUTA_EDITAR = "/api/plan-editar";
const CONSULTA_AGREGAR = "globo latex redondo fashion rosado";

function bodyParaLog(body: Record<string, unknown>): Record<string, unknown> {
  const base = body.base;
  const baseLog = esRegistro(base) ? `<PlanResuelto plan_hash=${prefijo(campoTexto(base, "plan_hash"))} ${tokenRedactado(campoTexto(base, "approval_token"))}>` : undefined;
  return { ...body, ...(baseLog ? { base: baseLog } : {}) };
}

export async function llamarEditar(ctx: Contexto, etiqueta: string, body: Record<string, unknown>): Promise<RespuestaHttp> {
  ctx.reporte.info(`REQ ${etiqueta} POST ${RUTA_EDITAR} ${JSON.stringify(bodyParaLog(body), (clave, valor: unknown) => clave === "approval_token" && typeof valor === "string" ? tokenRedactado(valor) : valor)}`);
  return ctx.next.solicitar(RUTA_EDITAR, { body, headers: { "X-Correlation-ID": randomUUID() } });
}

function candidatos(respuesta: RespuestaHttp): Candidato[] | null {
  const parsed = CandidatosSchema.safeParse(respuesta.json);
  return parsed.success ? parsed.data.candidatos : null;
}

function variantesDe(lista: Candidato[]): Array<z.infer<typeof VarianteSchema> & { productId: string }> {
  return lista.flatMap((candidato) => candidato.variantes.map((variante) => ({ ...variante, productId: candidato.productId })));
}

async function todasEnSnapshot(ctx: Contexto, variantIds: string[]): Promise<{ ok: boolean; detalle: string }> {
  const filas = await variantesPorId(ctx.pool, variantIds);
  const fuera = variantIds.filter((id) => filas.get(id)?.source_snapshot_id !== ctx.snapshotId);
  return { ok: variantIds.length > 0 && fuera.length === 0, detalle: `variantes=${variantIds.length} fuera_de_snapshot=${fuera.length}` };
}

function planEditado(respuesta: RespuestaHttp): PlanSmoke | null {
  if (!esRegistro(respuesta.json)) return null;
  const parsed = PlanSmokeSchema.safeParse(respuesta.json.plan);
  return parsed.success ? parsed.data : null;
}

async function aplicarYVerificar(ctx: Contexto, etiqueta: string, base: PlanSmoke, edicion: Record<string, unknown>, nueva?: Variante): Promise<PlanSmoke> {
  const reporte: Reporte = ctx.reporte;
  const desde = new Date(Date.now() - 1_000);
  const respuesta = await llamarEditar(ctx, etiqueta, { modo: "aplicar", base, edicion });
  const plan = planEditado(respuesta);
  reporte.exigir(`${etiqueta} → 200`, respuesta.status === 200 && plan !== null, plan ? resumenPlan(plan) : detalleRespuesta(respuesta));
  const previa = contextoVerificado(base.approval_token)?.allowlist ?? [];
  verificarTokenPlan(reporte, etiqueta, plan, {
    snapshotId: ctx.snapshotId,
    requestId: base.request_id,
    allowlistPrevia: previa,
    ...(nueva ? { paresNuevos: [{ product_id: nueva.product_id, variant_id: nueva.variant_id }] } : {}),
  });
  reporte.check(`${etiqueta} plan_hash cambia`, plan.plan_hash !== base.plan_hash, `${prefijo(base.plan_hash)} → ${prefijo(plan.plan_hash)}`);
  const filas = await esperarAuditoria(ctx.pool, { requestId: plan.request_id, planHash: plan.plan_hash, estados: ["PLAN_EDITED"], desde });
  reporte.check(`${etiqueta} audit PLAN_EDITED`, filas.length > 0, `filas=${filas.length}`);
  return plan;
}

function esperarRechazo(ctx: Contexto, nombre: string, respuesta: RespuestaHttp, status: number, extra?: { causa?: string; code?: string }): void {
  const causa = campoTexto(respuesta.json, "causa");
  const code = campoTexto(respuesta.json, "code");
  const ok = respuesta.status === status && (extra?.causa === undefined || causa === extra.causa) && (extra?.code === undefined || code === extra.code);
  ctx.reporte.check(nombre, ok, detalleRespuesta(respuesta, 300));
}

export async function faseEditar(ctx: Contexto, planChat: PlanSmoke): Promise<PlanSmoke> {
  const reporte: Reporte = ctx.reporte;
  const consulta = "globo latex redondo fashion blanco";

  const sinToken = await llamarEditar(ctx, "P3.buscar sin token", { modo: "buscar", consulta });
  const listaSinToken = candidatos(sinToken);
  reporte.check("P3.buscar sin token → 200", sinToken.status === 200 && campoTexto(sinToken.json, "status") === "OK" && (listaSinToken?.length ?? 0) > 0, detalleRespuesta(sinToken, 200));
  const conToken = await llamarEditar(ctx, "P3.buscar con token", { modo: "buscar", consulta, approval_token: planChat.approval_token });
  const listaConToken = candidatos(conToken) ?? [];
  reporte.check("P3.buscar con token → 200", conToken.status === 200 && campoTexto(conToken.json, "status") === "OK" && listaConToken.length > 0, `status=${conToken.status} candidatos=${listaConToken.length}`);
  const enSnapshot = await todasEnSnapshot(ctx, variantesDe(listaConToken).map((item) => item.variantId));
  reporte.check("P3.buscar con token variantes ∈ snapshot firmado", enSnapshot.ok, enSnapshot.detalle);
  const contextoChat = contextoVerificado(planChat.approval_token);
  reporte.exigir("P3.contexto token chat verificable", contextoChat !== null, "abrirContextoPlan");
  const buscarFalso = await llamarEditar(ctx, "P3.buscar token con snapshot falsificado", { modo: "buscar", consulta, approval_token: refirmar(contextoChat, { catalogSnapshotId: SNAPSHOT_FALSO }) });
  // Security property: the forged snapshot reaches Python and nothing is returned.
  // Python search answers 200 NO_MATCH with catalog_snapshot_id=null for an unpublished
  // snapshot (plan/resolve and recommendations answer catalog_snapshot_not_found);
  // the adapter rejects the mismatch as PYTHON_INVALID_RESPONSE (502).
  reporte.check("P3.buscar token snapshot falsificado → rechazado sin candidatos", buscarFalso.status >= 400 && candidatos(buscarFalso) === null, detalleRespuesta(buscarFalso, 300));
  if (campoTexto(buscarFalso.json, "code") === "PYTHON_INVALID_RESPONSE") {
    reporte.info("P3.DEFECTO-CONTRATO catalog/search con snapshot no publicado responde 200 NO_MATCH catalog_snapshot_id=null (no catalog_snapshot_not_found); Next lo traduce a 502 PYTHON_INVALID_RESPONSE");
  }

  const referencia = lineas(planChat).find((linea) => linea.tamano_codigo) ?? lineas(planChat)[0]!;
  const recomendadas = await llamarEditar(ctx, "P3.recomendadas", { modo: "recomendadas", variant_id: referencia.variant_id, approval_token: planChat.approval_token });
  const listaRecomendadas = candidatos(recomendadas) ?? [];
  const variantesRecomendadas = variantesDe(listaRecomendadas);
  reporte.check("P3.recomendadas → 200 con candidatos", recomendadas.status === 200 && listaRecomendadas.length > 0 && listaRecomendadas.length <= 12, `status=${recomendadas.status} productos=${listaRecomendadas.length} variantes=${variantesRecomendadas.length} referencia=${referencia.variant_id} tamano=${referencia.tamano_codigo ?? "null"}`);
  const mismoTamano = variantesRecomendadas.every((item) => referencia.tamano_codigo ? item.codigoTamano === referencia.tamano_codigo : item.diamPulg === referencia.diam_pulg);
  reporte.check("P3.recomendadas mismo tamaño y sin la referencia", mismoTamano && variantesRecomendadas.every((item) => item.variantId !== referencia.variant_id), `tamaños=${[...new Set(variantesRecomendadas.map((item) => item.codigoTamano ?? String(item.diamPulg)))].join(",")}`);
  const recEnSnapshot = await todasEnSnapshot(ctx, variantesRecomendadas.map((item) => item.variantId));
  reporte.check("P3.recomendadas variantes ∈ snapshot firmado", recEnSnapshot.ok, recEnSnapshot.detalle);

  const idsPlan = new Set(lineas(planChat).map((linea) => linea.variant_id));
  const elegida = variantesRecomendadas.find((item) => !idsPlan.has(item.variantId)) ?? variantesRecomendadas[0];
  reporte.exigir("P3.recomendación utilizable para reemplazar", elegida !== undefined, elegida ? `variant=${elegida.variantId}` : "recomendadas no devolvió variantes");
  const reemplazo: Variante = { product_id: elegida.productId, variant_id: elegida.variantId, ...(elegida.colores?.[0] ? { color: elegida.colores[0] } : {}) };
  const planReemplazado = await aplicarYVerificar(ctx, "P3.aplicar reemplazar", planChat, {
    accion: "reemplazar", estructura_id: referencia.estructura_id, objetivo_variant_id: referencia.variant_id, variante: reemplazo,
  }, reemplazo);
  reporte.check("P3.aplicar reemplazar variante nueva en líneas", lineas(planReemplazado).some((linea) => linea.variant_id === reemplazo.variant_id), `variant=${reemplazo.variant_id}`);

  const estructura = planReemplazado.plan.estructuras.find((item) => item.estructura_id === referencia.estructura_id)!;
  const productosEstructura = new Set(estructura.materiales.map((material) => material.product_id));
  const idsReemplazado = new Set(lineas(planReemplazado).map((linea) => linea.variant_id));
  // The resolver assigns size cells by color: a second material with a color the
  // structure already has may legitimately get no line. Add a different color.
  const coloresEstructura = new Set(lineas(planReemplazado).map((linea) => (linea.color ?? "").toLowerCase()).filter(Boolean));
  const buscarAgregar = await llamarEditar(ctx, "P3.buscar con token (para agregar)", { modo: "buscar", consulta: CONSULTA_AGREGAR, approval_token: planReemplazado.approval_token });
  const listaAgregar = candidatos(buscarAgregar) ?? [];
  reporte.check("P3.buscar con token (para agregar) → 200", buscarAgregar.status === 200 && listaAgregar.length > 0, `status=${buscarAgregar.status} candidatos=${listaAgregar.length}`);
  const candidatasAgregar = [...listaAgregar]
    .sort((a, b) => b.variantes.length - a.variantes.length)
    .flatMap((candidato) => candidato.variantes.map((variante) => ({ ...variante, productId: candidato.productId })))
    .filter((item) => !productosEstructura.has(item.productId) && !idsReemplazado.has(item.variantId) && item.disponible !== false
      && (item.colores ?? []).length > 0 && !(item.colores ?? []).some((color) => coloresEstructura.has(color.toLowerCase())));
  const paraAgregar = candidatasAgregar.find((item) => item.codigoTamano === "R-12") ?? candidatasAgregar[0];
  reporte.exigir("P3.variante de buscar para agregar", paraAgregar !== undefined, paraAgregar ? `variant=${paraAgregar.variantId} tamaño=${paraAgregar.codigoTamano ?? "null"}` : "buscar con token no ofreció un producto nuevo");
  const agregada: Variante = { product_id: paraAgregar.productId, variant_id: paraAgregar.variantId, ...(paraAgregar.colores?.[0] ? { color: paraAgregar.colores[0] } : {}) };
  const planAgregado = await aplicarYVerificar(ctx, "P3.aplicar agregar", planReemplazado, {
    accion: "agregar", estructura_id: referencia.estructura_id, variante: agregada, participacion: 0.2,
  }, agregada);
  const materialesAntes = estructura.materiales.length;
  const materialesAgregado = planAgregado.plan.estructuras.find((item) => item.estructura_id === referencia.estructura_id)!.materiales.length;
  reporte.check("P3.aplicar agregar suma un material", materialesAgregado === materialesAntes + 1, `materiales ${materialesAntes} → ${materialesAgregado}`);

  const lineaAgregada = planAgregado.estructuras.find((item) => item.estructura_id === referencia.estructura_id)?.lineas
    .find((linea) => linea.product_id === agregada.product_id && linea.variant_id === agregada.variant_id)
    ?? lineas(planAgregado).find((linea) => linea.product_id === agregada.product_id);
  reporte.exigir("P3.línea del material agregado", lineaAgregada !== undefined, lineaAgregada ? `variant=${lineaAgregada.variant_id}` : `no hay línea con product_id=${agregada.product_id}; líneas=${lineas(planAgregado).map((linea) => `${linea.estructura_id}:${linea.product_id}/${linea.variant_id}`).join(",")} compras=${planAgregado.compras.map((compra) => `${compra.product_id}/${compra.variant_id}`).join(",")} materiales=${JSON.stringify(planAgregado.plan.estructuras.map((item) => item.materiales))} sin_cobertura=${JSON.stringify(planAgregado.sin_cobertura)}`);
  const planQuitado = await aplicarYVerificar(ctx, "P3.aplicar quitar", planAgregado, {
    accion: "quitar", estructura_id: referencia.estructura_id, objetivo_variant_id: lineaAgregada.variant_id,
  });
  const materialesQuitado = planQuitado.plan.estructuras.find((item) => item.estructura_id === referencia.estructura_id)!.materiales.length;
  reporte.check("P3.aplicar quitar resta un material", materialesQuitado === materialesAgregado - 1, `materiales ${materialesAgregado} → ${materialesQuitado}`);

  await rechazosEditar(ctx, planQuitado);
  return planQuitado;
}

async function rechazosEditar(ctx: Contexto, base: PlanSmoke): Promise<void> {
  const reporte: Reporte = ctx.reporte;
  const snapshotId = ctx.snapshotId;
  const contexto = contextoVerificado(base.approval_token);
  reporte.exigir("P3.rechazos contexto base", contexto !== null, "token base verificable");
  const editadosAntes = (await filasAuditoria(ctx.pool, { requestId: base.request_id, estados: ["PLAN_EDITED"] })).length;
  const lineaBase = lineas(base)[0]!;
  const edicionQuitar = { accion: "quitar", estructura_id: lineaBase.estructura_id, objetivo_variant_id: lineaBase.variant_id };
  const idsPlan = lineas(base).map((linea) => linea.variant_id);

  esperarRechazo(ctx, "P3.rechazo firma manipulada → 409", await llamarEditar(ctx, "P3.aplicar firma manipulada", { modo: "aplicar", base: { ...base, approval_token: firmaManipulada(base.approval_token) }, edicion: edicionQuitar }), 409);
  esperarRechazo(ctx, "P3.rechazo payload alterado con firma vieja → 409", await llamarEditar(ctx, "P3.aplicar payload alterado", { modo: "aplicar", base: { ...base, approval_token: payloadManipuladoConFirmaVieja(base.approval_token) }, edicion: edicionQuitar }), 409);
  esperarRechazo(ctx, "P3.rechazo recomendadas token manipulado → 409", await llamarEditar(ctx, "P3.recomendadas token manipulado", { modo: "recomendadas", variant_id: lineaBase.variant_id, approval_token: firmaManipulada(base.approval_token) }), 409);

  const falso = await llamarEditar(ctx, "P3.aplicar snapshot falsificado", { modo: "aplicar", base: { ...base, approval_token: refirmar(contexto, { catalogSnapshotId: SNAPSHOT_FALSO }) }, edicion: edicionQuitar });
  esperarRechazo(ctx, "P3.rechazo snapshot falsificado re-firmado → Python rechaza (422 PYTHON_INVALID_REQUEST)", falso, 422, { code: "PYTHON_INVALID_REQUEST" });

  const compra = base.compras[0]!;
  const sinCompra = await llamarEditar(ctx, "P3.aplicar allowlist sin variante comprada", { modo: "aplicar", base: { ...base, approval_token: refirmar(contexto, { allowlist: allowlistSinVariante(contexto.allowlist, compra.variant_id) }) }, edicion: edicionQuitar });
  esperarRechazo(ctx, `P3.rechazo allowlist sin ${compra.variant_id} → 409`, sinCompra, 409);

  const agregar = (variante: Variante) => ({ accion: "agregar", estructura_id: lineaBase.estructura_id, variante, participacion: 0.2 });
  const inexistente = { product_id: compra.product_id, variant_id: `smoke-fuera-de-snapshot-${randomUUID()}` };
  esperarRechazo(ctx, "P3.rechazo variante fuera del snapshot → 409 VARIANTE_NO_ADMITIDA", await llamarEditar(ctx, "P3.aplicar variante fuera de snapshot", { modo: "aplicar", base, edicion: agregar(inexistente) }), 409, { causa: "VARIANTE_NO_ADMITIDA" });

  const productoB = await varianteFueraDe(ctx.pool, snapshotId, idsPlan, [compra.product_id]);
  if (reporte.check("P3.producto B del snapshot para caso cruzado", productoB !== null, productoB ? `product_id=${productoB.product_id}` : "sin fila") && productoB) {
    const cruzada = { product_id: productoB.product_id, variant_id: compra.variant_id };
    esperarRechazo(ctx, "P3.rechazo variante de A declarada como B → 422 ALLOWLIST_PRODUCTO_VARIANTE", await llamarEditar(ctx, "P3.aplicar variante cruzada", { modo: "aplicar", base, edicion: agregar(cruzada) }), 422, { causa: "ALLOWLIST_PRODUCTO_VARIANTE" });
  }

  const allowlistIds = contexto.allowlist.flatMap((entrada) => entrada.variant_ids);
  const fueraAllowlist = await varianteFueraDe(ctx.pool, snapshotId, allowlistIds);
  if (reporte.check("P3.variante del snapshot fuera del allowlist", fueraAllowlist !== null, fueraAllowlist ? `variant_id=${fueraAllowlist.variant_id}` : "sin fila") && fueraAllowlist) {
    esperarRechazo(ctx, "P3.rechazo recomendadas referencia fuera del allowlist → 404 VARIANTE_REFERENCIA_NO_ENCONTRADA", await llamarEditar(ctx, "P3.recomendadas referencia fuera de allowlist", { modo: "recomendadas", variant_id: fueraAllowlist.variant_id, approval_token: base.approval_token }), 404, { causa: "VARIANTE_REFERENCIA_NO_ENCONTRADA" });
  }

  await esperar(1_500);
  const editadosDespues = (await filasAuditoria(ctx.pool, { requestId: base.request_id, estados: ["PLAN_EDITED"] })).length;
  reporte.check("P3.rechazos no escriben PLAN_EDITED", editadosDespues === editadosAntes, `antes=${editadosAntes} después=${editadosDespues}`);
}
