import { avisosDelCambio, type DependenciasEdicion3d } from "../edicion-motor3d";
import type { PedidoEdicionPlan } from "@/lib/ia/guiado/edicion-plan-chat";
import type { PlanGuiado } from "./ajuste-plan-guiado";
import type { EdicionChatHecha } from "./edicion-chat-guiada";

/**
 * Un cambio pedido por chat sobre un plan del motor 3D (REQ-007, fase 5): el mismo `PedidoEdicionPlan` que entendió el
 * chat va al servidor del 3D, que lo convierte en ediciones de la espec (`edicion-desde-pedido.ts`), rearma y cotiza. El
 * navegador no busca globos en el catálogo de Python ni toca el plan: si el servidor dice «No pude: …», eso es lo que el
 * cliente lee y su plan sigue como estaba.
 */
export type Motor3dDelChat = { dependencias: DependenciasEdicion3d; /** El id del turno del chat (el de la calificación). */ turnoId?: string };

export async function ejecutarEdicionChat3d(base: PlanGuiado, pedido: PedidoEdicionPlan, motor: Motor3dDelChat): Promise<EdicionChatHecha> {
  const hecho = await motor.dependencias.editar(base, { tipo: "pedido", pedido }, motor.turnoId ? { turnoId: motor.turnoId } : {});
  const avisos = avisosDelCambio(base, hecho);
  const nueva = pedido.tipo === "agregar_pieza" ? hecho.tocadas[0] : undefined;
  return {
    plan: hecho.plan,
    cotizacion: hecho.cotizacion,
    piezas: hecho.tocadas,
    descripcion: hecho.descripcion,
    confirmacion: [hecho.confirmacion, ...avisos].join(" "),
    cambios: [],
    globos: [],
    avisos,
    turno: hecho.turno,
    ...(nueva ? { nueva } : {}),
  };
}
