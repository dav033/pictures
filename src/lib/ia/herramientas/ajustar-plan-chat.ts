import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { AplicarEdicionResultado } from "@/lib/plan/aplicar-edicion";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { BasePlanSchema, type BasePlan } from "@/lib/plan/edicion-esquemas";
import { varianteNuevaDe, type EdicionChat } from "@/lib/plan/edicion-chat";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { detectarJergaInterna } from "@/lib/ia/omoikane/jerga-interna";

/**
 * Orchestration of the chat tool `ajustar_plan_decoracion` when the model sends
 * several edits (`ediciones`). Policy only: every edit is applied by
 * `aplicarEdicionPlan` (Python owns the edit and the numbers, this module never
 * touches a count or a price), injected as `aplicar` so the sequence can be tested
 * without a server.
 *
 * Atomic by construction: nothing is written anywhere until the last edit has
 * been applied. The caller publishes the final plan on its turn state only after
 * `aplicarEdicionesEncadenadas` resolves; if any edit throws, the original
 * proposal is exactly as it was and the error says which edit failed.
 */

/** An edit failed while the sequence was being applied. `indice` is 1-based. */
export class EdicionEncadenadaError extends Error {
  readonly indice: number;
  readonly total: number;
  readonly causa: unknown;

  constructor(indice: number, total: number, causa: unknown) {
    super(`La edición ${indice} de ${total} falló.`);
    this.name = "EdicionEncadenadaError";
    this.indice = indice;
    this.total = total;
    this.causa = causa;
  }
}

/** First edit whose new variant this turn's catalog search never returned (1-based), or null. */
export function primeraVarianteNoBuscada(
  ediciones: readonly EdicionChat[],
  vistas: ReadonlyMap<string, ReadonlySet<string>>,
): { indice: number; product_id: string; variant_id: string } | null {
  for (const [posicion, edicion] of ediciones.entries()) {
    const variante = varianteNuevaDe(edicion);
    if (variante && !vistas.get(variante.product_id)?.has(variante.variant_id)) {
      return { indice: posicion + 1, product_id: variante.product_id, variant_id: variante.variant_id };
    }
  }
  return null;
}

export type PasoAplicado = { edicion: EdicionChat; avisos: string[] };
export type ResultadoEncadenado = { plan: PlanResuelto; cotizacion: Cotizacion; pasos: PasoAplicado[] };

/**
 * `aplicar` receives `esUltima` so the caller can skip the audit row of a plan
 * that is only an intermediate step: if a later edit fails, that plan never
 * existed for the customer.
 */
export type AplicarUna = (entrada: { base: BasePlan; edicion: EdicionChat; esUltima: boolean }) => Promise<AplicarEdicionResultado>;

export async function aplicarEdicionesEncadenadas(entrada: {
  base: BasePlan;
  ediciones: readonly EdicionChat[];
  aplicar: AplicarUna;
}): Promise<ResultadoEncadenado> {
  const total = entrada.ediciones.length;
  let base = entrada.base;
  const pasos: PasoAplicado[] = [];
  let ultimo: AplicarEdicionResultado | undefined;
  for (const [posicion, edicion] of entrada.ediciones.entries()) {
    const esUltima = posicion === total - 1;
    try {
      ultimo = await entrada.aplicar({ base, edicion, esUltima });
    } catch (error) {
      throw new EdicionEncadenadaError(posicion + 1, total, error);
    }
    pasos.push({ edicion, avisos: ultimo.avisos });
    if (esUltima) break;
    // The plan the previous edit resolved and signed is the base of the next: the
    // same envelope the browser echoes back after a card edit.
    const siguiente = BasePlanSchema.safeParse(ultimo.plan);
    if (!siguiente.success) {
      throw new EdicionEncadenadaError(posicion + 2, total, new PlanEditError(409, "No pude seguir ajustando la propuesta después del cambio anterior."));
    }
    base = siguiente.data;
  }
  if (!ultimo) throw new EdicionEncadenadaError(1, total, new PlanEditError(400, "No hay ediciones que aplicar."));
  return { plan: ultimo.plan, cotizacion: ultimo.cotizacion, pasos };
}

export const MENSAJE_CLIENTE_PIEZA_FUERA_DEL_ESTILO = "Esa pieza no está disponible en el catálogo de este estilo de decoración; elige otra.";
const MENSAJE_CLIENTE_AJUSTE_GENERICO = "No pude aplicar ese cambio a la propuesta.";

/**
 * The sentence of a rejected edit as the customer may hear it. `PlanEditError`
 * messages are written for people, except the LoRA pool rejection, which carries
 * its code (`aplicar-edicion.ts`): that one is translated, and anything else that
 * still reads as internal jargon is replaced rather than relayed.
 */
export function mensajeClienteDeRechazo(mensaje: string): string {
  if (mensaje.startsWith("FLUX_DATASET_ALLOWLIST_REJECTED")) return MENSAJE_CLIENTE_PIEZA_FUERA_DEL_ESTILO;
  return detectarJergaInterna(mensaje).length > 0 ? MENSAJE_CLIENTE_AJUSTE_GENERICO : mensaje;
}

/** What the tool answer tells the model about one applied edit (never a price or a count). */
export function cambioParaElModelo(edicion: EdicionChat, posicion: number): Record<string, unknown> {
  const base = { edicion: posicion, accion: edicion.accion, estructura_id: edicion.estructura_id };
  switch (edicion.accion) {
    case "agregar":
    case "reemplazar": {
      const variante = varianteNuevaDe(edicion);
      return { ...base, ...(variante ? { material_nuevo: `${variante.product_id}/${variante.variant_id}` } : {}), ...(edicion.objetivo_variant_id ? { reemplaza: edicion.objetivo_variant_id } : {}) };
    }
    case "quitar":
      return { ...base, quita: edicion.objetivo_variant_id };
    case "repartir":
      return { ...base, participaciones: edicion.participaciones };
    case "mezcla":
      return { ...base, mezcla: edicion.mezcla };
  }
}

/** What the audit row records of the chat edits: the operations, never the whole plan. */
export function geometriaAuditadaChat(ediciones: readonly EdicionChat[]): Record<string, unknown> {
  const una = (edicion: EdicionChat): Record<string, unknown> => {
    switch (edicion.accion) {
      case "repartir":
        return { accion: edicion.accion, estructura_id: edicion.estructura_id, participaciones: edicion.participaciones };
      case "mezcla":
        return { accion: edicion.accion, estructura_id: edicion.estructura_id, mezcla: edicion.mezcla };
      default:
        return { accion: edicion.accion, estructura_id: edicion.estructura_id, objetivo_variant_id: edicion.objetivo_variant_id, nueva_variant_id: edicion.variante?.variant_id };
    }
  };
  // One edit keeps the shape this audit always had; several are listed in order.
  return ediciones.length === 1 ? una(ediciones[0]!) : { ediciones: ediciones.map(una) };
}
