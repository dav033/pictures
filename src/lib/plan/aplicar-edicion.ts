import "server-only";
import { z } from "zod";
import type { Pool } from "pg";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import { admitirVariantePython, editarPlanPython, exigirContextoPython } from "./edicion-python";
import { reemplazoIncompatible, MENSAJE_REEMPLAZO_INCOMPATIBLE } from "./edicion-compatibilidad";
import { abrirContextoPlan, allowlistDesdeMapa, crearTokenPlan, mapaDesdeAllowlist, verificarTokenAprobacion, type ContextoPlan } from "./aprobacion";
import { conFotosDeCatalogo } from "./cotizacion-fotos";
import { PlanEditError } from "./edicion-error";
import { getRagPool } from "@/lib/rag/db";
import { registrarPlanAudit } from "@/lib/rag/observability/log";
import { resolverPlan } from "./resolver-backend";
import type { PlanDecoracion } from "./tipos";
import type { PlanResuelto } from "./resuelto";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import type { BasePlan, EdicionPlan } from "./edicion-esquemas";

/**
 * Applies one edit (agregar/reemplazar/quitar/repartir/mezcla/patron) to an
 * already-approved plan. Shared by `src/app/api/plan-editar/route.ts` and the
 * chat tool `ajustar_plan_decoracion`
 * (`src/lib/ia/herramientas/registro-herramientas.ts`), so both run the exact
 * same checks.
 *
 * Orchestration only (ADR-0028 §9): the mutation of the declarative plan is
 * Python's (`services/ai-api/app/plan_edicion.py`, POST /internal/v1/plan/edit).
 * Here: the signed approval, the re-resolution of the base plan, the admission
 * of a new variant, the resolution of the edited plan, the new signature and
 * the audit row.
 *
 * No `Request`/`Response`: throws `PlanEditError` (business rejection, safe to
 * relay to the customer/model) or `PlanBackendNoDisponibleError`
 * /`AllowlistProductoVarianteError`/Python-adapter errors (infrastructure —
 * callers decide how to surface those).
 */

export const MENSAJE_APROBACION_INVALIDA = "La aprobación base expiró o no corresponde a este plan.";

/** Verifies the HMAC + expiry + plan_hash binding and opens the signed
 * provenance in one step; throws the same customer-facing rejection either
 * way so a stale or tampered token never reaches the resolver. */
export function abrirContextoExigido(token: string): ContextoPlan {
  const contexto = abrirContextoPlan(token);
  if (!contexto) throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);
  return contexto;
}

/** A candidate approval token/plan_hash pair, verified enough to open its context. */
function contextoBaseExigido(base: BasePlan): { aprobacion: { requestId: string; expiresAt: number }; contexto: ContextoPlan } {
  const aprobacion = verificarTokenAprobacion(base.approval_token, base.plan_hash);
  if (!aprobacion) throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);
  const contexto = abrirContextoExigido(base.approval_token);
  // Una propuesta con procedencia "next" ya no se puede re-resolver: ese
  // resolutor desapareció (ADR-0023 paso 5). Los tokens caducan a las 24 h.
  if (contexto.backend !== "python") throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);
  return { aprobacion, contexto };
}

/** A valid uuid candidate travels as the correlation id; anything else gets a fresh one. */
export function correlationDesde(candidato: string | undefined): string {
  const parsed = z.string().uuid().safeParse(candidato);
  return parsed.success ? parsed.data : crypto.randomUUID();
}

export function unicos(values: string[]): string[] {
  return [...new Set(values)];
}

/** Lines of the edited structure from the base resolution Next just verified against `plan_hash`. */
function lineasVerificadas(resuelto: PlanResuelto, estructuraId: string) {
  return resuelto.estructuras
    .filter((estructura) => estructura.estructura_id === estructuraId)
    .map((estructura) => ({
      estructura_id: estructura.estructura_id,
      lineas: estructura.lineas.map((linea) => ({ product_id: linea.product_id, variant_id: linea.variant_id, color: linea.color })),
    }));
}

/** What the audit row records of each edit: the operation, never the whole plan. */
function geometriaAuditada(edicion: EdicionPlan): Record<string, unknown> {
  switch (edicion.accion) {
    case "repartir":
      return { accion: edicion.accion, estructura_id: edicion.estructura_id, participaciones: edicion.participaciones };
    case "mezcla":
      return { accion: edicion.accion, estructura_id: edicion.estructura_id, mezcla: edicion.mezcla };
    case "patron":
      return { accion: edicion.accion, estructura_id: edicion.estructura_id, modo: edicion.patron_color?.base.modo ?? null };
    default:
      return { accion: edicion.accion, estructura_id: edicion.estructura_id, objetivo_variant_id: edicion.objetivo_variant_id, nueva_variant_id: edicion.variante?.variant_id };
  }
}

export type AplicarEdicionInput = {
  base: BasePlan;
  edicion: EdicionPlan;
  /** Already resolved by the caller (HTTP route or chat turn) — never derived here from a request body. */
  catalogAllowlist: CatalogAllowlist | null;
  /** Preferred correlation id (e.g. the chat turn's); falls back to the plan's own request id. */
  correlationId?: string;
  signal?: AbortSignal;
  pool?: Pool;
};

/** `avisos`: sentences for the decorator from the edit itself (e.g. a color pattern that was rebuilt). */
export type AplicarEdicionResultado = { plan: PlanResuelto; cotizacion: Cotizacion; avisos: string[] };

/**
 * Re-verifies the base plan's signed approval, re-resolves it against Python
 * to make sure nothing drifted since it was shown, admits the new variant
 * (when the edit adds one), has Python apply the edit and resolves the edited
 * plan — issuing a fresh approval token bound to the new `plan_hash`. Throws
 * instead of silently rebuilding when the token is stale, the backend isn't
 * Python, or the catalog changed underneath.
 */
export async function aplicarEdicionPlan(input: AplicarEdicionInput): Promise<AplicarEdicionResultado> {
  const pool = input.pool ?? getRagPool();
  const { base, edicion } = input;
  const { aprobacion, contexto: contextoPlan } = contextoBaseExigido(base);
  const snapshotPython = exigirContextoPython(contextoPlan);
  const whitelist = mapaDesdeAllowlist(contextoPlan.allowlist);
  const correlationId = correlationDesde(input.correlationId ?? base.request_id ?? aprobacion.requestId);

  const resolver = (plan: PlanDecoracion, allowlistPython: ContextoPlan["allowlist"]) =>
    resolverPlan({
      plan,
      allowlist: allowlistPython,
      catalogSnapshotId: snapshotPython,
      loraAllowlist: input.catalogAllowlist ?? undefined,
      requestId: crypto.randomUUID(),
      correlationId,
      ...(input.signal ? { signal: input.signal } : {}),
    });

  const planBaseVerificado = await resolver(base.plan, contextoPlan.allowlist);
  if (planBaseVerificado.resuelto.plan_hash !== base.plan_hash) {
    throw new PlanEditError(409, "El plan base cambió desde que se mostró. Vuelve a solicitar la propuesta.");
  }
  if (!verificarTokenAprobacion(base.approval_token, planBaseVerificado.resuelto.plan_hash)) {
    throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);
  }

  let coloresVariante: string[] = [];
  // Only adding or replacing brings a new variant to admit; the other edits do not.
  if (edicion.accion === "agregar" || edicion.accion === "reemplazar") {
    const variante = edicion.variante!;
    // Se exige la variante exacta: que el producto esté entrenado no dice
    // nada del tamaño concreto, y aceptarlo por `product_id` dejaba pasar
    // tamaños nunca fotografiados (R-24 de un producto entrenado en R-5..R-18).
    if (input.catalogAllowlist && !input.catalogAllowlist.variantIds.includes(variante.variant_id)) {
      throw new PlanEditError(409, `LORA_DATASET_ALLOWLIST_REJECTED: ${variante.variant_id}`);
    }
    // El resolutor admite el par dentro del snapshot firmado; Next no
    // consulta el catálogo por SQL.
    coloresVariante = await admitirVariantePython({ variante, catalogSnapshotId: snapshotPython, whitelist, correlationId, ...(input.signal ? { signal: input.signal } : {}) });
  }
  const { plan: planEditado, avisos } = await editarPlanPython({
    plan: base.plan,
    lineasBase: lineasVerificadas(planBaseVerificado.resuelto, edicion.estructura_id),
    edicion,
    coloresVariante,
    // ADR-0028: una pieza que pasa de uno a dos colores recibe su patrón
    // sugerido solo con la bandera, igual que al confirmar el plan.
    completarPatrones: featureEnabled("PATRONES_COLOR_V1"),
    correlationId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const allowlistFinal = allowlistDesdeMapa(whitelist);
  const resolucionEditada = await resolver(planEditado, allowlistFinal);
  const resuelto = resolucionEditada.resuelto;
  if (resuelto.compras.length === 0) throw new PlanEditError(422, "El cambio dejó la estructura sin piezas disponibles.");
  if (edicion.accion === "reemplazar") {
    // Server-verified lines on both sides: the base plan was just re-resolved.
    const objetivo = planBaseVerificado.resuelto.estructuras
      .find((item) => item.estructura_id === edicion.estructura_id)
      ?.lineas.find((linea) => linea.variant_id === edicion.objetivo_variant_id);
    const lineasNuevas = resuelto.estructuras
      .find((item) => item.estructura_id === edicion.estructura_id)
      ?.lineas.filter((linea) => linea.variant_id === edicion.variante?.variant_id) ?? [];
    if (objetivo && reemplazoIncompatible(objetivo, lineasNuevas)) {
      throw new PlanEditError(422, MENSAJE_REEMPLAZO_INCOMPATIBLE, "REEMPLAZO_INCOMPATIBLE");
    }
  }

  const requestId = base.request_id ?? aprobacion.requestId;
  resuelto.request_id = requestId;
  resuelto.approval_token = crearTokenPlan({
    planHash: resuelto.plan_hash,
    requestId,
    backend: "python",
    catalogSnapshotId: contextoPlan.catalogSnapshotId,
    allowlist: allowlistFinal,
    ...(contextoPlan.creatividad === null ? {} : { creatividad: contextoPlan.creatividad }),
  });
  await registrarPlanAudit(pool, {
    requestId,
    planHash: resuelto.plan_hash,
    restricciones: resuelto.plan.restricciones,
    selectedProductIds: resuelto.compras.map((compra) => compra.variant_id),
    geometry: geometriaAuditada(edicion),
    costChosenCop: resuelto.totales.total_cop,
    ceilingCop: resuelto.comercial.techo_cop,
    deltaCop: resuelto.comercial.delta_cop,
    packages: { ahorro_paquetes_cop: resuelto.totales.ahorro_paquetes_cop, lineas: resuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })) },
    status: "PLAN_EDITED",
  });

  return { plan: resuelto, cotizacion: conFotosDeCatalogo(resolucionEditada.cotizacion, resuelto.compras), avisos };
}
