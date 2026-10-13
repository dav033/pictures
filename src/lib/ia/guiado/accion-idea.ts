import type { AccionIdeaGuiada } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { CosteoIdeaElegida } from "@/lib/guiada-motor/costear-idea-elegida";
import { datosDelCosteo } from "@/lib/guiada-motor/dependencias-costeo";
import { pasoParaCliente } from "./pasos-cliente";

/*
 * Los chips «Cuánto cuesta» y «Aprender a hacerlo» de una idea elegida sin plan guardado (o que no se arma sola) se
 * responden por reglas (REQ-015, D-043): antes iban al turno del modelo, que todavía podía proponer y armar otro plan con
 * otras cifras. El precio sale de `costearIdeaElegida` (el mismo de `costear_decoracion`) y los pasos, de la idea.
 */
const OPCIONES = ["contratar", "costear", "comprar", "aprender"] as const;
const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export const PREGUNTA_USO = "¿Es para tu negocio o para uso personal?";

export type IdeaConPasos = { id: string; titulo: string; pasos: ReadonlyArray<{ orden: number; texto: string }> };
export type RespuestaAccionIdea = { texto: string; result: Record<string, unknown>; motivo: "pasos" | "falta_uso" | "cotizada" | "sin_precio" | "no_validada" };

function textoPrecio(titulo: string, costeo: Extract<CosteoIdeaElegida, { ok: true }>): string {
  const total = costeo.costeo.cotizacion?.total;
  if (!total) return "No pude calcular el precio de esta idea ahora. Si quieres, te busco un proveedor cerca que te la cotice.";
  if (costeo.uso === "negocio") return `Abajo tienes la cotización de «${titulo}» para tu negocio: el precio al cliente lo ajustas con tu mano de obra y tu ganancia.`;
  return `Los materiales de «${titulo}» te salen en ${pesos.format(total).replace(/\s/g, " ")} con IVA (sin helio ni montaje). Abajo te dejo el detalle por globo.`;
}

export async function responderAccionIdea(accion: AccionIdeaGuiada, idea: IdeaConPasos, costear: () => Promise<CosteoIdeaElegida>): Promise<RespuestaAccionIdea> {
  if (accion === "aprender") {
    // Solo orden y texto: es lo que admite la vista (sin fotos ni videos de la biblioteca).
    const pasos = idea.pasos.map((paso) => ({ orden: paso.orden, texto: pasoParaCliente(paso.texto) }));
    return { texto: `Así se arma «${idea.titulo}», paso a paso.`, result: { pasos, opciones: [...OPCIONES] }, motivo: "pasos" };
  }
  const costeo = await costear();
  if (!costeo.ok) {
    if (costeo.motivo === "falta_que_el_cliente_elija_negocio_o_personal") return { texto: PREGUNTA_USO, result: { preguntaUso: true }, motivo: "falta_uso" };
    return { texto: "No pude confirmar la idea que elegiste. Elígela otra vez y vuelve a tocar «Cuánto cuesta».", result: { opciones: [...OPCIONES] }, motivo: "no_validada" };
  }
  const result: Record<string, unknown> = { uso: costeo.uso, opciones: [...OPCIONES] };
  datosDelCosteo(result, costeo.costeo);
  return { texto: textoPrecio(idea.titulo, costeo), result, motivo: costeo.costeo.cotizacion ? "cotizada" : "sin_precio" };
}
