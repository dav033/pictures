import type { PeticionVistaPatron } from "@/lib/plan/peticion-patron";
import type { LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";

/**
 * La pieza sobre la que se pide una vista previa (/api/plan-patron): el plan,
 * la estructura y lo que compra (sus líneas resueltas, del mismo plan).
 */
export type PiezaVistaPrevia = {
  plan: PlanResuelto["plan"];
  estructuraId: string;
  lineas: readonly LineaMaterial[];
};

/** Lo que la vista previa pide además de la pieza: el patrón, un reparto o un estilo. */
export type PedidoVistaPatron = Omit<PeticionVistaPatron, "plan" | "estructura_id" | "lineas">;

/**
 * Cuerpo de /api/plan-patron para una pieza. Lleva sus líneas resueltas
 * (`lineas`): la vista previa no tiene catálogo y, con ellas, Python nombra
 * cada color por lo que se compra, como al resolver (ADR-0028 §8, §10).
 * `peticion-patron.ts` deja viajar solo los campos del contrato. Solo
 * transporte: qué nombre lleva cada número lo decide Python.
 */
export function peticionVistaPieza(pieza: PiezaVistaPrevia, pedido: PedidoVistaPatron): PeticionVistaPatron {
  // Sin anotar el literal: si `PeticionVistaPatron` declara `lineas`, se comprueba contra él.
  const cuerpo = { ...pedido, plan: pieza.plan, estructura_id: pieza.estructuraId, lineas: pieza.lineas };
  return cuerpo;
}
