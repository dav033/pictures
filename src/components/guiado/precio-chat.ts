/**
 * Probador (2026-10-06): «y cuánto me sale todo?» abría la cotización DENTRO de la tarjeta del plan, arriba, y la
 * respuesta de abajo decía «Aquí tienes el cálculo detallado…» sin ningún precio a la vista. Cuando el modelo abre el
 * costeo del plan, la respuesta dice el total (el mismo `cotizacion.total` que muestra la tarjeta, calculado por
 * Python) y la vista va al total resaltado (`data-precio-total`). Puro: sin React.
 */

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

type Uso = "personal" | "negocio";

/** El selector del total de la cotización abierta (personal o de negocio): a él va la vista. */
export const SELECTOR_PRECIO_TOTAL = "[data-precio-total]";

/**
 * La respuesta del chat cuando el cliente pregunta el precio del plan y el costeo se abre en su tarjeta. `uso` es el
 * que se abre (el de la tarjeta, el que eligió el cliente o «personal»).
 */
export function respuestaPrecioPlan(plan: { cotizacion?: { total: number; incluyeIva?: boolean } | undefined }, uso: Uso): string {
  const cotizacion = plan.cotizacion;
  if (!cotizacion || !(cotizacion.total > 0)) return "Todavía no tengo el precio de estos materiales. En tu plan, arriba, puedes buscar un proveedor cerca que te lo cotice.";
  const total = pesos.format(cotizacion.total).replace(/\s/g, " ");
  // En el negocio el precio lo calcula Python con la mano de obra y la ganancia del decorador (y los globos pueden ir a
  // granel): aquí no se repite una cifra que no es la que ve en la tarjeta; se le dice dónde está.
  if (uso === "negocio") return "Te abrí arriba, en tu plan, la cotización para tu negocio: el precio al cliente está resaltado y lo ajustas con tu mano de obra y tu ganancia.";
  return `Los materiales de tu plan te salen en ${total}${cotizacion.incluyeIva === false ? "" : " con IVA"} (sin montaje). Arriba, en tu plan, te dejé el detalle por globo.`;
}
