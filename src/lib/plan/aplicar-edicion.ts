import "server-only";
import { z } from "zod";
import type { Pool } from "pg";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { admitirVariantePython, exigirContextoPython } from "./edicion-python";
import { reemplazoIncompatible, MENSAJE_REEMPLAZO_INCOMPATIBLE, MENSAJE_UNICO_MATERIAL } from "./edicion-compatibilidad";
import { abrirContextoPlan, allowlistDesdeMapa, crearTokenPlan, mapaDesdeAllowlist, verificarTokenAprobacion, type ContextoPlan } from "./aprobacion";
import { colorDeCatalogo } from "./colores-catalogo";
import { conFotosDeCatalogo } from "./cotizacion-fotos";
import { PlanEditError } from "./edicion-error";
import { getRagPool } from "@/lib/rag/db";
import { registrarPlanAudit } from "@/lib/rag/observability/log";
import { resolverPlan } from "./resolver-backend";
import { PlanDecoracionSchema, type MaterialPlan, type PlanDecoracion } from "./tipos";
import type { PlanResuelto } from "./resuelto";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import type { BasePlan, Edicion } from "./edicion-esquemas";

/**
 * Applies one edit (agregar/reemplazar/quitar) to an already-approved plan,
 * re-verified and re-resolved against Python — the same logic
 * `src/app/api/plan-editar/route.ts`'s `modo: "aplicar"` used to run inline.
 * Moved here so the chat tool `ajustar_plan_decoracion`
 * (`src/lib/ia/registro-herramientas.ts`) can call the exact same code
 * instead of re-implementing the approval/re-resolution checks.
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

function normalizar(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function normalizarParticipaciones(materiales: MaterialPlan[]): MaterialPlan[] {
  const total = materiales.reduce((sum, material) => sum + material.participacion, 0);
  if (total <= 0) throw new PlanEditError(400, "La estructura quedó sin participación de materiales.");

  let acumulado = 0;
  return materiales.map((material, index) => {
    const participacion = index === materiales.length - 1
      ? Math.max(0.000001, Number((1 - acumulado).toFixed(6)))
      : Number((material.participacion / total).toFixed(6));
    acumulado += participacion;
    return { ...material, participacion };
  });
}

function indiceMaterialParaLinea(
  materiales: MaterialPlan[],
  linea: { product_id: string; variant_id: string; color?: string | null },
): number {
  const porVariante = materiales.findIndex((material) => material.product_id === linea.product_id && material.variant_id === linea.variant_id);
  if (porVariante >= 0) return porVariante;
  const color = normalizar(linea.color ?? "");
  return materiales.findIndex((material) => material.product_id === linea.product_id && normalizar(material.color ?? "") === color);
}

/**
 * Color the edit writes for the variant the customer/model picked ("agregar"
 * and "reemplazar"). See the original comment in the HTTP route history: the
 * label must say what is actually bought, canonized through the catalog
 * vocabulary, never the color of the piece being replaced.
 */
function colorDeEdicion(color: string | undefined, coloresVariante: readonly string[]): string | undefined {
  const pedido = color?.trim() ? colorDeCatalogo(color.trim()) : undefined;
  if (coloresVariante.length !== 1) return pedido;
  const unico = coloresVariante[0]!;
  return pedido && normalizar(pedido) === normalizar(unico) ? pedido : unico;
}

/** Pure: builds the edited `PlanDecoracion` from the base envelope, the
 * requested edit and the real colors of the admitted variant. Never touches
 * the network or the database. */
function aplicarEdicion(base: BasePlan, edicion: Edicion, coloresVariante: readonly string[]): PlanDecoracion {
  const estructura = base.plan.estructuras.find((item) => item.estructura_id === edicion.estructura_id);
  if (!estructura) throw new PlanEditError(404, "No se encontró la estructura seleccionada.");
  const colorVariante = edicion.accion === "quitar" ? undefined : colorDeEdicion(edicion.variante?.color, coloresVariante);

  const materiales = estructura.materiales.map((material) => ({ ...material }));
  if (edicion.accion === "agregar") {
    const variante = edicion.variante!;
    const participacion = edicion.participacion ?? 0.2;
    const restante = 1 - participacion;
    const existentes = normalizarParticipaciones(materiales).map((material) => ({
      ...material,
      participacion: material.participacion * restante,
    }));
    materiales.splice(0, materiales.length, ...normalizarParticipaciones([
      ...existentes,
      {
        product_id: variante.product_id,
        variant_id: variante.variant_id,
        color: colorVariante,
        acabado: variante.acabado,
        participacion,
        rol_material: "acento",
      },
    ]));
  } else {
    const lineaObjetivo = base.estructuras
      .find((item) => item.estructura_id === edicion.estructura_id)
      ?.lineas.find((linea) => linea.variant_id === edicion.objetivo_variant_id);
    if (!lineaObjetivo) throw new PlanEditError(404, "No se encontró la variante objetivo en la estructura.");

    if (edicion.accion === "reemplazar" && ["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"].includes(estructura.tipo)) {
      // Las estructuras geométricas no mutan `materiales` (la "receta" de colores/participación);
      // el cambio vive en variant_overrides, que ya encadena ediciones sucesivas sobre la misma
      // pieza. Por eso esta rama no depende de indiceMaterialParaLinea: una pieza ya editada
      // antes puede tener un color que no está en `materiales`, y eso es válido.
      const overrides = (estructura.variant_overrides ?? []).filter((override) => override.objetivo_variant_id !== edicion.objetivo_variant_id);
      const variante = edicion.variante!;
      const overrideAnterior = overrides.find((override) => override.variant_id === edicion.objetivo_variant_id);
      const overridesSinCadena = overrides.filter((override) => override !== overrideAnterior);
      const nuevoOverride = {
        objetivo_variant_id: overrideAnterior?.objetivo_variant_id ?? edicion.objetivo_variant_id!,
        product_id: variante.product_id,
        variant_id: variante.variant_id,
        color: colorVariante,
      };
      const planEditado: PlanDecoracion = {
        ...base.plan,
        estructuras: base.plan.estructuras.map((item) => item.estructura_id === estructura.estructura_id
          ? { ...item, variant_overrides: [...overridesSinCadena, nuevoOverride] }
          : item),
      };
      return PlanDecoracionSchema.parse(planEditado);
    }

    const indice = indiceMaterialParaLinea(materiales, lineaObjetivo);
    if (indice < 0) throw new PlanEditError(409, "La variante visible no corresponde a un material editable.");

    if (edicion.accion === "quitar") {
      if (materiales.length === 1) throw new PlanEditError(400, MENSAJE_UNICO_MATERIAL, "UNICO_MATERIAL");
      materiales.splice(indice, 1);
      materiales.splice(0, materiales.length, ...normalizarParticipaciones(materiales));
    } else {
      const variante = edicion.variante!;
      materiales[indice] = {
        ...materiales[indice]!,
        product_id: variante.product_id,
        variant_id: variante.variant_id,
        color: colorVariante ?? materiales[indice]!.color,
        acabado: variante.acabado ?? materiales[indice]!.acabado,
      };
    }
  }

  const planEditado: PlanDecoracion = {
    ...base.plan,
    estructuras: base.plan.estructuras.map((item) => item.estructura_id === estructura.estructura_id ? { ...item, materiales } : item),
  };
  return PlanDecoracionSchema.parse(planEditado);
}

export type AplicarEdicionInput = {
  base: BasePlan;
  edicion: Edicion;
  /** Already resolved by the caller (HTTP route or chat turn) — never derived here from a request body. */
  catalogAllowlist: CatalogAllowlist | null;
  /** Preferred correlation id (e.g. the chat turn's); falls back to the plan's own request id. */
  correlationId?: string;
  signal?: AbortSignal;
  pool?: Pool;
};

export type AplicarEdicionResultado = { plan: PlanResuelto; cotizacion: Cotizacion };

/**
 * Re-verifies the base plan's signed approval, re-resolves it against Python
 * to make sure nothing drifted since it was shown, admits the new variant
 * (when the edit adds one) and resolves the edited plan — issuing a fresh
 * approval token bound to the new `plan_hash`. Throws instead of silently
 * rebuilding when the token is stale, the backend isn't Python, or the
 * catalog changed underneath.
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
  if (edicion.accion !== "quitar") {
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
  const planEditado = aplicarEdicion(base, edicion, coloresVariante);
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
    geometry: { accion: edicion.accion, estructura_id: edicion.estructura_id, objetivo_variant_id: edicion.objetivo_variant_id, nueva_variant_id: edicion.variante?.variant_id },
    costChosenCop: resuelto.totales.total_cop,
    ceilingCop: resuelto.comercial.techo_cop,
    deltaCop: resuelto.comercial.delta_cop,
    packages: { ahorro_paquetes_cop: resuelto.totales.ahorro_paquetes_cop, lineas: resuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })) },
    status: "PLAN_EDITED",
  });

  return { plan: resuelto, cotizacion: conFotosDeCatalogo(resolucionEditada.cotizacion, resuelto.compras) };
}
