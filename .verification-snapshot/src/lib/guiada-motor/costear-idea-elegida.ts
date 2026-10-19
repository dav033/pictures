import { filaDeCotizacionDeIdea, type FilaAuditoriaPlan3d } from "./auditoria-plan";
import type { ResultadoTope } from "@/lib/topes/tope-durable";
import { costearDecoracion, type Costeo, type DecoracionCotizable, type DependenciasCosteo } from "./costear-idea";

export type UsoCosteo = "negocio" | "personal";

export type MotivoSinCosteo = "falta_que_el_cliente_elija_negocio_o_personal" | "uso_o_decoracion_no_validado_por_el_cliente" | "muchos_pedidos_de_precio";

export type CosteoIdeaElegida = { ok: false; motivo: MotivoSinCosteo } | { ok: true; uso: UsoCosteo; costeo: Costeo };

export type EntornoCosteoIdea = {
  decoraciones: ReadonlyArray<DecoracionCotizable>;
  requestId: string;
  superficie: string;
  costeo: DependenciasCosteo;
  /** La fila durable (`registrarAuditoriaPlan3d`, que espera la escritura y nunca lanza). */
  registrarAuditoria: (fila: FilaAuditoriaPlan3d) => Promise<void>;
  /** Reserve a quote slot before costing or writing its durable audit row. */
  tomarCosteo: () => Promise<ResultadoTope>;
  /** Refund interrupted quotes to the original counter. */
  devolverCosteo: (toma: ResultadoTope) => Promise<void>;
  /**
   * True once the request was aborted or its deadline expired. The costing never throws on that: it ends as `sin_precio`, so
   * such a result is an interrupted quote (slot refunded, no durable audit row), not a customer who got an answer.
   */
  interrumpido?: () => boolean;
};

/**
 * «¿Cuánto cuesta?» de la idea elegida, con la idea y el uso que el cliente confirmó en la interfaz (estadoGuiado), nunca
 * los que diga el navegador o el modelo por su cuenta: si `pedido` trae otros, no se cotiza. Lo llaman la herramienta
 * `costear_decoracion` y la regla del chip «Cuánto cuesta» (REQ-015, D-043), que así no pasa por el modelo.
 */
export async function costearIdeaElegida(
  pedido: { decoracionId?: string | undefined; uso?: UsoCosteo | undefined },
  confirmado: { decoracionId?: string | undefined; uso?: UsoCosteo | undefined },
  entorno: EntornoCosteoIdea,
): Promise<CosteoIdeaElegida> {
  const decoracionId = pedido.decoracionId ?? confirmado.decoracionId;
  const uso = pedido.uso ?? confirmado.uso;
  const decoracion = confirmado.decoracionId !== undefined && confirmado.decoracionId === decoracionId ? entorno.decoraciones.find((item) => item.id === decoracionId) : undefined;
  if (!confirmado.uso || uso !== confirmado.uso || !decoracion) {
    const motivo: MotivoSinCosteo = !confirmado.uso ? "falta_que_el_cliente_elija_negocio_o_personal" : "uso_o_decoracion_no_validado_por_el_cliente";
    entorno.costeo.auditar("regla:cotizacion_guiada", "costear la idea elegida", { cotiza: false, motivo }, { entrada: { pedida: pedido, decoracionConfirmada: confirmado.decoracionId ?? null, usoConfirmado: confirmado.uso ?? null } });
    return { ok: false, motivo };
  }
  const toma = await entorno.tomarCosteo();
  if (!toma.ok) {
    entorno.costeo.auditar("regla:cotizacion_guiada", "costear la idea elegida", { cotiza: false, motivo: "muchos_pedidos_de_precio", usadas: toma.usadas, tope: toma.tope }, { entrada: { decoracionId: decoracion.id } });
    return { ok: false, motivo: "muchos_pedidos_de_precio" };
  }
  try {
    const costeo = await costearDecoracion(decoracion, confirmado.uso, entorno.costeo);
    if (costeo.decision.usar === "sin_precio" && entorno.interrumpido?.()) {
      await entorno.devolverCosteo(toma);
      return { ok: true, uso: confirmado.uso, costeo };
    }
    // Durable (plan_audit_log): una fila por cada «¿cuánto cuesta?», con lo que decidió el costeo (motor 3D, plan de Python,
    // lista curada o sin precio), su motivo, el total y el hash del plan.
    await entorno.registrarAuditoria(filaDeCotizacionDeIdea(costeo.decision, decoracion.id, entorno.requestId, entorno.superficie));
    return { ok: true, uso: confirmado.uso, costeo };
  } catch (error) {
    await entorno.devolverCosteo(toma);
    throw error;
  }
}
