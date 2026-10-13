import { avisosDelCambio, type DependenciasEdicion3d } from "../edicion-motor3d";
import { colorCliente, conMayuscula } from "../formato";
import type { RespuestaEditarMotor } from "@/lib/guiada-motor/editar-contrato";
import type { PedidoEdicionPlan } from "@/lib/ia/guiado/edicion-plan-chat";
import { plegarTexto } from "@/lib/rag/taxonomy/v2";
import { piezasAjustables, type PlanGuiado } from "./ajuste-plan-guiado";
import { confirmacionColorContada, type PreciosDelCambio, type Reemplazo } from "./diferencia-colores";
import type { EdicionChatHecha } from "./edicion-chat-guiada";

/**
 * Un cambio pedido por chat sobre un plan del motor 3D (REQ-007, fase 5): el mismo `PedidoEdicionPlan` que entendió el
 * chat va al servidor del 3D, que lo convierte en ediciones de la espec (`edicion-desde-pedido.ts`), rearma y cotiza. El
 * navegador no busca globos en el catálogo de Python ni toca el plan: si el servidor dice «No pude: …», eso es lo que el
 * cliente lee y su plan sigue como estaba.
 */
export type Motor3dDelChat = { dependencias: DependenciasEdicion3d; /** El id del turno del chat (el de la calificación). */ turnoId?: string };

type ReemplazoDelChat = Extract<PedidoEdicionPlan, { tipo: "reemplazar_color" }>;

/**
 * El cambio de color del chat como lo cuenta `diferencia-colores.ts`. El chat pide una familia («celeste») y el servidor
 * eligió el globo: se reconoce en el plan nuevo por su color en las piezas tocadas, y se nombra como lo ve el cliente.
 */
function reemplazoDelPedido(pedido: ReemplazoDelChat, hecho: RespuestaEditarMotor): Reemplazo {
  const tocadas = new Set(hecho.tocadas);
  const entrado = piezasAjustables(hecho.plan).filter((pieza) => tocadas.has(pieza.estructuraId))
    .flatMap((pieza) => pieza.colores).find((color) => plegarTexto(color.color) === plegarTexto(pedido.colorNuevo));
  return {
    tipo: "reemplazar-color",
    color: pedido.color,
    ...(pedido.piezas.length ? { estructuraIds: hecho.tocadas } : {}),
    // Chat selects a color family; each piece can buy a different product for that family.
    globo: { productId: "", color: pedido.colorNuevo, variantIds: [], nombre: entrado?.etiqueta ?? conMayuscula(colorCliente(pedido.colorNuevo)) },
  };
}

/**
 * `precios`: la cotización de antes y el uso; un cambio de color hecho entero dice la diferencia real por color y el precio
 * (la misma frase del camino de Python) en lugar de la frase general del servidor.
 */
export async function ejecutarEdicionChat3d(base: PlanGuiado, pedido: PedidoEdicionPlan, motor: Motor3dDelChat, precios: Omit<PreciosDelCambio, "despues"> = {}): Promise<EdicionChatHecha> {
  const hecho = await motor.dependencias.editar(base, { tipo: "pedido", pedido }, motor.turnoId ? { turnoId: motor.turnoId } : {});
  const avisos = avisosDelCambio(base, hecho);
  const nueva = pedido.tipo === "agregar_pieza" ? hecho.tocadas[0] : undefined;
  const contada = pedido.tipo === "reemplazar_color" && !hecho.noAplicadas.length
    ? confirmacionColorContada(base, hecho.plan, reemplazoDelPedido(pedido, hecho), hecho.tocadas, { ...precios, despues: hecho.cotizacion })
    : null;
  return {
    plan: hecho.plan,
    cotizacion: hecho.cotizacion,
    piezas: hecho.tocadas,
    descripcion: hecho.descripcion,
    confirmacion: [contada ?? hecho.confirmacion, ...avisos].join(" "),
    cambios: [],
    globos: [],
    avisos,
    turno: hecho.turno,
    ...(nueva ? { nueva } : {}),
  };
}
