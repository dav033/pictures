import { randomUUID } from "node:crypto";
import {
  isPythonAdapterError,
  llamarPythonCatalogRecommendations,
  llamarPythonCatalogSearch,
  llamarPythonCatalogSelection,
  llamarPythonPlanResolution,
  PYTHON_PLAN_RESOLUTION_PATH,
  PYTHON_PLAN_RESOLUTION_SCOPE,
  PYTHON_CATALOG_SEARCH_SCOPE,
} from "../../../src/lib/ia/nucleo/python-adapter";
import { firmarRequestInterna, sha256Body } from "../../../src/lib/ia/contracts/operational-v1";
import { PlanDecoracionSchema, type PlanDecoracion } from "../../../src/lib/plan/tipos";
import type { Contexto } from "./contexto";
import { contarNonces } from "./evidencia-db";
import { campoTexto, esRegistro } from "./http";
import type { Reporte } from "./reporte";
import { SNAPSHOT_FALSO } from "./token";

/**
 * P1: direct FastAPI calls through the real adapter (HMAC, deadline, nonce) and
 * raw signed requests for the negative authentication cases.
 */

const ids = () => ({ requestId: randomUUID(), correlationId: randomUUID(), deadlineMs: 10_000 });

function planFixture(productId: string): PlanDecoracion {
  return PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: randomUUID(),
    concepto: { titulo: "Smoke rutas Python", descripcion: "Resolución local contra catálogo publicado.", paleta: [] },
    espacio: { tipo: "salon", fuente: "supuesto" },
    estructuras: [{
      estructura_id: "EST_01_SMOKE",
      nombre: "Arco de smoke",
      tipo: "arco",
      rol_escena: "focal",
      ubicacion: "arco_central",
      medidas: { ancho_m: 3, alto_m: 2.4 },
      repeticiones: 1,
      densidad: "media",
      mezcla: "clasica",
      materiales: [{ product_id: productId, participacion: 1, rol_material: "principal" }],
      porque: "Fixture de verificación local.",
    }],
    supuestos: [],
  });
}

async function capturarError(promesa: Promise<unknown>): Promise<{ code: string; domainCode?: string; status: number } | null> {
  try {
    await promesa;
    return null;
  } catch (error) {
    if (isPythonAdapterError(error)) return { code: error.code, domainCode: error.domainCode, status: error.status };
    throw error;
  }
}

type Firma = { scopes: string[]; nonce?: string; timestamp?: number; firmaCero?: boolean };

async function postFirmado(ctx: Contexto, operationBody: Record<string, unknown>, firma: Firma): Promise<{ status: number; code: string | undefined; nonce: string }> {
  const secret = process.env.INTERNAL_HMAC_SECRET?.trim() ?? "";
  const requestId = randomUUID();
  const correlationId = randomUUID();
  const deadlineMs = 10_000;
  const context = {
    schema_version: "operational.v1",
    request_id: requestId,
    correlation_id: correlationId,
    deadline_at: new Date(Date.now() + deadlineMs).toISOString(),
    deadline_ms: deadlineMs,
    body_sha256: sha256Body(JSON.stringify(operationBody)),
    scopes: firma.scopes,
  };
  const body = JSON.stringify({ context, ...operationBody });
  const target = new URL(PYTHON_PLAN_RESOLUTION_PATH, ctx.config.fastapiUrl);
  const signature = firmarRequestInterna({
    secret,
    method: "POST",
    path: target.pathname,
    bodySha256: sha256Body(body),
    scopes: firma.scopes,
    ...(firma.timestamp === undefined ? {} : { timestamp: firma.timestamp }),
    ...(firma.nonce === undefined ? {} : { nonce: firma.nonce }),
  });
  const response = await fetch(target, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
      "x-deadline-ms": String(deadlineMs),
      "x-internal-schema-version": signature.schema_version,
      "x-internal-timestamp": String(signature.timestamp),
      "x-internal-nonce": signature.nonce,
      "x-internal-signature": firma.firmaCero ? "0".repeat(64) : signature.signature,
      "x-internal-scopes": signature.scopes.join(","),
    },
    body,
  });
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  const code = esRegistro(json) ? campoTexto(json.detail, "code") : undefined;
  return { status: response.status, code, nonce: signature.nonce };
}

export async function faseFastapi(ctx: Contexto, noncesAntes: number): Promise<void> {
  const reporte: Reporte = ctx.reporte;
  const snapshotId = ctx.snapshotId;

  const busqueda = await llamarPythonCatalogSearch({
    message: "globo latex redondo rosado",
    filters: { available: true, shapes: ["redondo"] },
    allowlist: [],
    limit: 15,
    ...ids(),
  });
  reporte.exigir("P1.catalog/search", busqueda.status === "OK" && busqueda.candidates.length > 0 && busqueda.catalog_snapshot_id === snapshotId, `status=${busqueda.status} candidatos=${busqueda.candidates.length} snapshot=${busqueda.catalog_snapshot_id ?? "null"}`);

  const conVarias = busqueda.candidates.find((item) => item.variants.filter((variant) => variant.available).length >= 2)
    ?? busqueda.candidates.find((item) => item.variants.some((variant) => variant.available));
  reporte.exigir("P1.catalog/search variante disponible", conVarias !== undefined, "se requiere al menos una variante disponible");
  const variante = conVarias.variants.find((item) => item.available)!;
  const otroProducto = busqueda.candidates.find((item) => item.product_id !== conVarias.product_id);

  const seleccion = await llamarPythonCatalogSelection({
    items: [{ product_id: conVarias.product_id, variant_id: variante.variant_id, quantity: 2 }],
    allowlist: [{ product_id: conVarias.product_id, variant_ids: [variante.variant_id] }],
    catalogSnapshotId: snapshotId,
    ...ids(),
  });
  const validado = seleccion.validados[0];
  reporte.check("P1.catalog/selection ok", seleccion.status === "ok" && validado !== undefined && validado.subtotal_cop === validado.unit_price_cop * 2 && validado.unit_price_cop === Math.round(variante.price), `status=${seleccion.status} unit=${validado?.unit_price_cop ?? "?"} subtotal=${validado?.subtotal_cop ?? "?"} precio_busqueda=${variante.price}`);

  const rechazo = await llamarPythonCatalogSelection({
    items: [{ product_id: conVarias.product_id, variant_id: variante.variant_id, quantity: 1 }],
    allowlist: [],
    catalogSnapshotId: snapshotId,
    ...ids(),
  });
  reporte.check("P1.catalog/selection rechazo fuera de allowlist", rechazo.status === "empty" && rechazo.rechazados.length === 1 && rechazo.validados.length === 0, `status=${rechazo.status} rechazados=${rechazo.rechazados.length} motivo=${rechazo.rechazados[0]?.reason ?? "-"}`);

  if (reporte.check("P1.catalog/search segundo producto", otroProducto !== undefined, "necesario para el caso producto/variante cruzado") && otroProducto) {
    const cruzado = await capturarError(llamarPythonCatalogSelection({
      items: [{ product_id: otroProducto.product_id, variant_id: variante.variant_id, quantity: 1 }],
      allowlist: [{ product_id: otroProducto.product_id, variant_ids: [variante.variant_id] }],
      catalogSnapshotId: snapshotId,
      ...ids(),
    }));
    reporte.check("P1.catalog/selection variante de A declarada como B → 422 allowlist_product_mismatch", cruzado?.status === 422 && cruzado.domainCode === "allowlist_product_mismatch", `error=${JSON.stringify(cruzado)}`);
  }

  const recomendaciones = await llamarPythonCatalogRecommendations({ referenceVariantId: variante.variant_id, catalogSnapshotId: snapshotId, limit: 100, ...ids() });
  reporte.check("P1.catalog/recommendations", recomendaciones.catalog_snapshot_id === snapshotId && recomendaciones.reference.variant_id === variante.variant_id, `candidatos=${recomendaciones.candidates.length} ref_size=${recomendaciones.reference.size_code ?? "null"}`);
  const refFaltante = await capturarError(llamarPythonCatalogRecommendations({ referenceVariantId: `smoke-no-existe-${randomUUID()}`, catalogSnapshotId: snapshotId, ...ids() }));
  reporte.check("P1.catalog/recommendations referencia inexistente → reference_variant_not_found", refFaltante?.domainCode === "reference_variant_not_found", `error=${JSON.stringify(refFaltante)}`);

  const allowlist = busqueda.whitelist.filter((entry) => entry.product_id === conVarias.product_id);
  const plan = planFixture(conVarias.product_id);
  const resolucion = await llamarPythonPlanResolution({ plan, allowlist, catalogSnapshotId: snapshotId, ...ids() });
  const totales = resolucion.plan_resuelto.totales;
  reporte.check("P1.plan/resolve", resolucion.catalog_snapshot_id === snapshotId && resolucion.plan_resuelto.compras.length > 0 && totales.total_cop > 0 && resolucion.quote.total_cop === totales.total_cop && resolucion.quote.plan_hash === resolucion.plan_resuelto.plan_hash, `total_cop=${totales.total_cop} compras=${resolucion.plan_resuelto.compras.length} plan_hash=${resolucion.plan_resuelto.plan_hash.slice(0, 12)}…`);

  const snapshotFalso = await capturarError(llamarPythonPlanResolution({ plan, allowlist, catalogSnapshotId: SNAPSHOT_FALSO, ...ids() }));
  reporte.check("P1.plan/resolve snapshot inexistente → catalog_snapshot_not_found", snapshotFalso?.code === "PYTHON_INVALID_REQUEST" && snapshotFalso.domainCode === "catalog_snapshot_not_found", `error=${JSON.stringify(snapshotFalso)}`);

  const operationBody = { schema_version: "plan-resolution.v1", plan, allowlist, catalog_snapshot_id: snapshotId };
  const scope = await postFirmado(ctx, operationBody, { scopes: [PYTHON_CATALOG_SEARCH_SCOPE] });
  reporte.check("P1.raw scope incorrecto → 403 insufficient_scope", scope.status === 403 && scope.code === "insufficient_scope", `status=${scope.status} code=${scope.code ?? "-"}`);

  const valida = await postFirmado(ctx, operationBody, { scopes: [PYTHON_PLAN_RESOLUTION_SCOPE] });
  reporte.check("P1.raw firma válida → 200", valida.status === 200, `status=${valida.status} code=${valida.code ?? "-"}`);
  const replay = await postFirmado(ctx, operationBody, { scopes: [PYTHON_PLAN_RESOLUTION_SCOPE], nonce: valida.nonce });
  reporte.check("P1.raw nonce reutilizado → 401 nonce_replay", replay.status === 401 && replay.code === "nonce_replay", `status=${replay.status} code=${replay.code ?? "-"}`);

  const firmaMala = await postFirmado(ctx, operationBody, { scopes: [PYTHON_PLAN_RESOLUTION_SCOPE], firmaCero: true });
  reporte.check("P1.raw firma inválida → 401 invalid_signature", firmaMala.status === 401 && firmaMala.code === "invalid_signature", `status=${firmaMala.status} code=${firmaMala.code ?? "-"}`);

  const vieja = await postFirmado(ctx, operationBody, { scopes: [PYTHON_PLAN_RESOLUTION_SCOPE], timestamp: Math.floor(Date.now() / 1000) - 301 });
  reporte.check("P1.raw timestamp viejo → 401 stale_signature", vieja.status === 401 && vieja.code === "stale_signature", `status=${vieja.status} code=${vieja.code ?? "-"}`);

  const noncesDespues = await contarNonces(ctx.pool);
  reporte.check("P1.nonce store durable (operational_request_nonces crece)", noncesDespues > noncesAntes, `antes=${noncesAntes} después=${noncesDespues}`);
}
