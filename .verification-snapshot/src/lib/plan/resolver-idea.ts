import "server-only";
import { recordarResolucionDePedido, resolucionDePedido } from "./cache-resoluciones";
import { resolverPlan, type ResolucionPlan } from "./resolver-backend";
import type { EntradaAllowlist } from "./plan-de-idea";
import type { PlanDecoracion } from "./tipos";

/**
 * La resolución de UNA idea sola (`pedidoDeIdeaSola`: el plan guardado, su allowlist y su snapshot), recordada por su
 * pedido (D-038): «¿cuánto cuesta?» y «Crear mi plan con esta idea» piden lo mismo, así que el segundo reutiliza la del
 * primero en el mismo proceso y el cliente ve el mismo total sin esperar dos resoluciones. Resolver es determinista: si el
 * pedido llega a otra instancia, se resuelve otra vez y da lo mismo.
 */
export type PedidoIdea = { plan: PlanDecoracion; allowlist: EntradaAllowlist[]; catalogSnapshotId: string };

export type OpcionesResolverIdea = { requestId: string; correlationId: string; signal?: AbortSignal; deadlineMs?: number };

export async function resolverIdeaSola(pedido: PedidoIdea, opciones: OpcionesResolverIdea, resolver: typeof resolverPlan = resolverPlan): Promise<ResolucionPlan> {
  const recordada = resolucionDePedido(pedido);
  if (recordada) return recordada;
  const resolucion = await resolver({ ...pedido, ...opciones });
  recordarResolucionDePedido(pedido, resolucion);
  return resolucion;
}
