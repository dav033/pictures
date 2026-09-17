import "server-only";
import { llamarPythonPlanResolution } from "@/lib/ia/python-adapter";
import type { DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { errorAllowlistDesdePython } from "./allowlist-producto-variante";
import { canonizarColoresPlan } from "./colores-catalogo";
import type { EntradaAllowlistPlan } from "./aprobacion";
import { cotizacionDesdePython, planResueltoDesdePython } from "./python-mapper";
import type { PlanResuelto } from "./resuelto";
import type { PlanDecoracion } from "./tipos";

/**
 * Única puerta de resolución de un plan (ADR-0023 paso 5).
 *
 * Hasta el paso 5 existía aquí un segundo camino, el resolutor TypeScript, que
 * era el destino del kill switch. Con él vivían las reglas de conteo, medidas,
 * estimación y cotización duplicadas a mano en los dos lenguajes; el 2026-09-16
 * esa duplicación produjo un fallo silencioso en producción. Ahora Python es el
 * único dueño: lo que devuelve no se recalcula ni se completa desde aquí, para
 * no volver a crear un segundo dueño de la misma regla comercial.
 *
 * No hay reserva implícita. Si Python falla, el error se propaga y quien llama
 * decide qué ve el cliente; responder con otra resolución escondería un corte
 * roto detrás de un plan que nadie verificó. La recuperación es desplegar la
 * revisión anterior del servicio, no cambiar una variable de entorno.
 */
export type ResolucionPlan = {
  resuelto: PlanResuelto;
  materialEstimate: DesignMaterialEstimate;
  cotizacion: Cotizacion;
};

export type EntradaResolucionPlan = {
  plan: PlanDecoracion;
  /** Allowlist del mismo turno, tal como quedó firmada en el contexto del plan. */
  allowlist: readonly EntradaAllowlistPlan[];
  catalogSnapshotId: string;
  loraAllowlist?: CatalogAllowlist | null;
  requestId: string;
  correlationId: string;
  signal?: AbortSignal;
  deadlineMs?: number;
};

export async function resolverPlan(entrada: EntradaResolucionPlan): Promise<ResolucionPlan> {
  // Python lee una `lora_variant_ids` vacía como "sin restricción", mientras que
  // un modo LoRA que no cubre ninguna variante tiene que fallar en cerrado.
  if (entrada.loraAllowlist && entrada.loraAllowlist.variantIds.length === 0) {
    throw new Error("LORA_DATASET_ALLOWLIST_REJECTED: el modo LoRA no cubre variantes");
  }

  // Los colores se canonizan AQUÍ y no en cada llamador (fase 2.7). De los tres
  // que entran por esta puerta, solo `registro-herramientas` canonizaba: la
  // generación y la edición mandaban a Python lo que el modelo hubiera escrito
  // ("rosa", "azul rey"), que el resolver compara literalmente y devuelve
  // SIN_COBERTURA. Eran dos comportamientos según el llamador, que es
  // exactamente lo que `AGENTS.md` prohíbe. Canonizar es idempotente, así que el
  // llamador que ya lo hacía sigue igual y conserva sus `cambios` para
  // reportárselos al cliente.
  const { plan } = canonizarColoresPlan(entrada.plan);

  let resultado: Awaited<ReturnType<typeof llamarPythonPlanResolution>>;
  try {
    resultado = await llamarPythonPlanResolution({
      plan,
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
    resuelto: planResueltoDesdePython(resultado.plan_resuelto),
    materialEstimate: resultado.material_estimate,
    cotizacion: cotizacionDesdePython(resultado),
  };
}

/**
 * Razón estable por la que un plan aprobado ya no se puede volver a resolver.
 * `PYTHON_NO_SELECCIONADO` desapareció con el kill switch (ADR-0023 paso 5);
 * queda el caso del snapshot, que sigue siendo real: el catálogo rota y una
 * propuesta con hasta 24 h de vida puede apuntar a uno que ya no se publica.
 */
export type MotivoBackendNoDisponible = "SIN_SNAPSHOT_CATALOGO";

export class PlanBackendNoDisponibleError extends Error {
  readonly motivo: MotivoBackendNoDisponible;

  constructor(motivo: MotivoBackendNoDisponible, message: string) {
    super(message);
    this.name = "PlanBackendNoDisponibleError";
    this.motivo = motivo;
  }
}
