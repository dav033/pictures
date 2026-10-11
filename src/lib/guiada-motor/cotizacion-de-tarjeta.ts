import type { z } from "zod";
import { CotizacionGuiadaSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { CotizacionDelMotor } from "@/lib/globos3d/motor/v1";

/**
 * La cotización del cotizador único (`cotizarBom`) con la forma de la tarjeta «¿Cuánto cuesta?» de la vista guiada
 * (`CotizacionGuiadaSchema`). El plan del 3D y la lista curada de las ideas sin plan pasan por aquí: así las dos pintan las
 * mismas líneas con la misma regla de compra.
 */
export type CotizacionIdea = z.infer<typeof CotizacionGuiadaSchema>;

export function cotizacionDeLaTarjeta(cotizada: CotizacionDelMotor) {
  const lineas = cotizada.cotizacion.lineas.map((linea) => ({
    id: linea.id, tamano: linea.tamano, cantidadNecesaria: linea.cantidadNecesaria, disponible: true, varianteId: linea.varianteId ?? linea.id, nombre: linea.nombre ?? linea.tamano,
    precioPaquete: linea.precioPaquete ?? 0, unidadesPaquete: linea.unidadesPaquete ?? 1, paquetes: linea.paquetes ?? 0, subtotal: linea.subtotal ?? 0, sobrante: linea.sobrante ?? 0,
  }));
  return CotizacionGuiadaSchema.safeParse({ lineas, total: cotizada.total, mermaPorcentaje: cotizada.cotizacion.mermaPorcentaje, incluyeIva: true, complementosSoportados: false });
}
