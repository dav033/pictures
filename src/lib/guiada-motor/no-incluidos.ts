import { z } from "zod";

/**
 * Lo que la lista de una idea sin plan pide y el cotizador único no pudo cotizar (D-038): un producto del que la tienda ya no vende
 * ninguna presentación, o un color o talla que ya no tiene. Queda fuera del total, como en el Taller (`faltantes`), y se dice con
 * estas palabras en la tarjeta de la vista guiada y en lo que lee el modelo. Puro: lo usan el servidor y el navegador.
 *
 * `NoIncluidosSchema` lo lee el navegador del turno (`datos.noIncluidos`): APARTE de la cotización, que se guarda en la sesión con un
 * esquema estricto (D-035). Con `.catch`, una nota que no cumple se descarta sola y el precio se pinta igual.
 */
export const NoIncluidosSchema = z.array(z.object({ nombre: z.string().min(1), cantidad: z.number().int().positive() }).strict()).optional().catch(undefined);
export type NoIncluidoEnPrecio = { nombre: string; cantidad: number };

/**
 * Por qué quedó fuera del precio (solo para la auditoría; el cliente lee siempre la misma nota): la tienda no vende ninguna presentación
 * de su producto, la lectura del catálogo no respondió a tiempo, o ya no vende ese color o talla (`faltantes` del Taller).
 */
export type MotivoFuera = "sin_presentaciones" | "catalogo_no_respondio" | "tienda_no_vende";

/** Lo mismo con la variante de la tienda de la que viene y el motivo, para la auditoría (el navegador solo ve el nombre y la cantidad). */
export type FueraDelPrecio = NoIncluidoEnPrecio & { variantId: string; motivo: MotivoFuera };

export function notaNoIncluidos(noIncluidos: ReadonlyArray<NoIncluidoEnPrecio> | undefined): string | null {
  if (!noIncluidos?.length) return null;
  const lista = noIncluidos.map((material) => `${material.cantidad} × ${material.nombre}`).join(", ");
  return `No incluido en el precio: ${lista}. No encontré su precio en la tienda ahora.`;
}
