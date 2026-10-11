import { z } from "zod";
import { FORMATOS_GLOBO } from "@/lib/globos3d/formatos";

/**
 * El precio de la «Lista de compra» del Taller 3D (D-038), lo que comparten el servidor (`cotizacion-taller.ts`) y el
 * navegador (`useCotizacionTaller`). Sin `server-only` a propósito.
 */

export const RUTA_COTIZACION_TALLER = "/api/taller/cotizacion";
/** Globos distintos (formato y color) de una lista del Taller. Sus compras se cotizan por trozos (`cotizarBom`). */
export const MAX_LINEAS_COTIZACION_TALLER = 256;
/**
 * Topes de globos de una lista: la combinación de paquetes se busca en el servidor, y su costo crece con la cantidad. Una
 * escena del Taller grande (un salón) lleva unos miles; más que esto no es una decoración sino un pedido abusivo.
 */
export const MAX_GLOBOS_LINEA_TALLER = 5_000;
export const MAX_GLOBOS_LISTA_TALLER = 20_000;

const IDS_FORMATO = FORMATOS_GLOBO.map((formato) => formato.id) as [string, ...string[]];

export const PedidoCotizacionTallerSchema = z.object({
  materiales: z.array(z.object({
    formatoId: z.enum(IDS_FORMATO),
    codigo: z.string().regex(/^[0-9A-Za-z-]{1,16}$/),
    cantidad: z.number().int().min(1).max(MAX_GLOBOS_LINEA_TALLER),
  }).strict()).min(1).max(MAX_LINEAS_COTIZACION_TALLER)
    .refine((lineas) => lineas.reduce((suma, linea) => suma + linea.cantidad, 0) <= MAX_GLOBOS_LISTA_TALLER, { message: `como mucho ${MAX_GLOBOS_LISTA_TALLER} globos` }),
}).strict();
export type PedidoCotizacionTaller = z.infer<typeof PedidoCotizacionTallerSchema>;

const FaltanteTallerSchema = z.object({ formatoId: z.string(), codigo: z.string(), cantidad: z.number().int().nonnegative(), motivo: z.string() }).strict();

export const CotizacionTallerSchema = z.object({
  total: z.number().int().positive(),
  mermaPorcentaje: z.number().min(0).max(100),
  incluyeIva: z.literal(true),
  lineas: z.array(z.object({
    formatoId: z.string(),
    codigo: z.string(),
    nombre: z.string(),
    /** Globos de la escena que cubre esta compra (sin la reserva). */
    cantidad: z.number().int().nonnegative(),
    reserva: z.number().int().nonnegative(),
    paquetes: z.number().int().positive(),
    unidadesPaquete: z.number().int().positive(),
    precioPaquete: z.number().int().positive(),
    subtotal: z.number().int().positive(),
  }).strict()).min(1),
  /** Globos de la escena que la tienda no vende en esa talla o color: quedan fuera del total. */
  faltantes: z.array(FaltanteTallerSchema),
}).strict();
export type CotizacionTaller = z.infer<typeof CotizacionTallerSchema>;

export const FalloCotizacionTallerSchema = z.object({
  error: z.string(),
  codigo: z.string(),
  faltantes: z.array(FaltanteTallerSchema).optional(),
}).strict();
