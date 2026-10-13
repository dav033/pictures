import { filaDeCotizacionDeIdea, type FilaAuditoriaPlan3d } from "./auditoria-plan";
import { costearDecoracion, type Costeo, type DecoracionCotizable, type DependenciasCosteo } from "./costear-idea";

export type UsoCosteo = "negocio" | "personal";

export type MotivoSinCosteo = "falta_que_el_cliente_elija_negocio_o_personal" | "uso_o_decoracion_no_validado_por_el_cliente";

export type CosteoIdeaElegida = { ok: false; motivo: MotivoSinCosteo } | { ok: true; uso: UsoCosteo; costeo: Costeo };

export type EntornoCosteoIdea = {
  decoraciones: ReadonlyArray<DecoracionCotizable>;
  requestId: string;
  superficie: string;
  costeo: DependenciasCosteo;
  /** La fila durable (`registrarAuditoriaPlan3d`, que espera la escritura y nunca lanza). */
  registrarAuditoria: (fila: FilaAuditoriaPlan3d) => Promise<void>;
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
  const costeo = await costearDecoracion(decoracion, confirmado.uso, entorno.costeo);
  // Durable (plan_audit_log): una fila por cada «¿cuánto cuesta?», con lo que decidió el costeo (motor 3D, plan de Python,
  // lista curada o sin precio), su motivo, el total y el hash del plan.
  await entorno.registrarAuditoria(filaDeCotizacionDeIdea(costeo.decision, decoracion.id, entorno.requestId, entorno.superficie));
  return { ok: true, uso: confirmado.uso, costeo };
}
