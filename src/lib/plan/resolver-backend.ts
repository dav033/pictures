import "server-only";
import type { Pool } from "pg";
import { cotizarPlan, type Cotizacion } from "@/lib/cotizacion/motor";
import { llamarPythonPlanResolution } from "@/lib/ia/python-adapter";
import { estimateFromPlan, type DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { errorAllowlistDesdePython } from "./allowlist-producto-variante";
import type { BackendPlan, EntradaAllowlistPlan } from "./aprobacion";
import { cotizacionDesdePython, planResueltoDesdePython } from "./python-mapper";
import { resolverPlan } from "./resolver";
import type { PlanResuelto } from "./resuelto";
import type { PlanDecoracion, PlanDecoracion1_1 } from "./tipos";

/**
 * Single place where "which backend resolves this plan" is decided and executed.
 *
 * Both paths return the same three domain outputs, so no consumer has to know
 * which one ran. What they must not do is mix them: the Python result already
 * carries its material estimate and quote, and re-running the TypeScript engines
 * on top of it would create a second owner for the same commercial rule.
 *
 * There is deliberately no implicit fallback. If the Python path fails, the
 * error propagates and the caller decides what the customer sees; silently
 * answering with a TypeScript resolution would hide a broken cutover behind a
 * plan the operator never verified. `PYTHON_BACKEND_KILL_SWITCH` is the rollback.
 */
export type ResolucionPlan = {
  backend: BackendPlan;
  resuelto: PlanResuelto;
  materialEstimate: DesignMaterialEstimate;
  cotizacion: Cotizacion;
};

/**
 * The two paths take different authorization inputs on purpose. The TypeScript
 * resolver keeps the whitelist each caller already derived — changing it would
 * change the plan hash of proposals in flight — while the Python resolver takes
 * the same-turn allowlist recorded in the signed plan context.
 */
export type EntradaResolucionPlan =
  | {
      backend: "next";
      pool: Pool;
      plan: PlanDecoracion | PlanDecoracion1_1;
      whitelist: ReadonlyMap<string, ReadonlySet<string>>;
      loraAllowlist?: CatalogAllowlist | null;
    }
  | {
      backend: "python";
      plan: PlanDecoracion;
      allowlist: readonly EntradaAllowlistPlan[];
      catalogSnapshotId: string;
      loraAllowlist?: CatalogAllowlist | null;
      requestId: string;
      correlationId: string;
      signal?: AbortSignal;
      deadlineMs?: number;
    };

export async function resolverPlanConBackend(entrada: EntradaResolucionPlan): Promise<ResolucionPlan> {
  if (entrada.backend === "next") {
    const resuelto = await resolverPlan(entrada.pool, entrada.plan, entrada.whitelist, entrada.loraAllowlist);
    return {
      backend: "next",
      resuelto,
      materialEstimate: estimateFromPlan(resuelto),
      cotizacion: cotizarPlan(resuelto),
    };
  }

  // Python reads an empty `lora_variant_ids` as "unrestricted", while the
  // TypeScript resolver filters everything out. A LoRA mode that covers no
  // variants must fail closed here instead of silently widening the catalog.
  if (entrada.loraAllowlist && entrada.loraAllowlist.variantIds.length === 0) {
    throw new Error("LORA_DATASET_ALLOWLIST_REJECTED: el modo LoRA no cubre variantes");
  }

  let resultado: Awaited<ReturnType<typeof llamarPythonPlanResolution>>;
  try {
    resultado = await llamarPythonPlanResolution({
      plan: entrada.plan,
      allowlist: entrada.allowlist.map((item) => ({ product_id: item.product_id, variant_ids: [...item.variant_ids] })),
      catalogSnapshotId: entrada.catalogSnapshotId,
      ...(entrada.loraAllowlist ? { loraVariantIds: [...entrada.loraAllowlist.variantIds] } : {}),
      requestId: entrada.requestId,
      correlationId: entrada.correlationId,
      ...(entrada.signal ? { parentSignal: entrada.signal } : {}),
      ...(entrada.deadlineMs === undefined ? {} : { deadlineMs: entrada.deadlineMs }),
    });
  } catch (error) {
    throw errorAllowlistDesdePython(error) ?? error;
  }
  return {
    backend: "python",
    resuelto: planResueltoDesdePython(resultado.plan_resuelto),
    materialEstimate: resultado.material_estimate,
    cotizacion: cotizacionDesdePython(resultado),
  };
}

/** Stable reasons a plan cannot be resolved by the backend its context requires. */
export type MotivoBackendNoDisponible = "SIN_SNAPSHOT_CATALOGO" | "PYTHON_NO_SELECCIONADO";

export class PlanBackendNoDisponibleError extends Error {
  readonly motivo: MotivoBackendNoDisponible;

  constructor(motivo: MotivoBackendNoDisponible, message: string) {
    super(message);
    this.name = "PlanBackendNoDisponibleError";
    this.motivo = motivo;
  }
}
