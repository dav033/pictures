import { z } from "zod";
import { FORMATOS_GLOBO } from "@/lib/globos3d/formatos";

/**
 * El precio de la «Lista de compra» del Taller 3D (D-038), lo que comparten el servidor (`cotizacion-taller.ts`) y el
 * navegador (`useCotizacionTaller`). Sin `server-only` a propósito.
 */

export const RUTA_COTIZACION_TALLER = "/api/taller/cotizacion";
/** Respuesta ampliada para llevar el precio del Taller al borrador profesional sin romper clientes de v1. */
export const RUTA_COTIZACION_TALLER_V2 = "/api/taller/cotizacion/v2";
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

/** Línea v2: conserva el resumen de compra y agrega la identidad que necesita `cotizacion-profesional.v1`. */
const LineaCotizacionTallerV2Schema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  formatoId: z.string(),
  codigo: z.string(),
  tamano: z.string(),
  tamanoCodigo: z.string(),
  color: z.string().optional(),
  nombre: z.string().min(1),
  cantidad: z.number().int().nonnegative(),
  cantidadNecesaria: z.number().int().positive(),
  disponible: z.literal(true),
  reserva: z.number().int().nonnegative(),
  varianteId: z.string().min(1),
  paquetes: z.number().int().positive(),
  unidadesPaquete: z.number().int().positive(),
  precioPaquete: z.number().int().positive(),
  subtotal: z.number().int().positive(),
  sobrante: z.number().int().nonnegative(),
}).strict();

/** Contrato versionado del Taller para integrar la lista con el cotizador profesional. */
export const CotizacionTallerV2Schema = z.object({
  schema_version: z.literal("taller-cotizacion.v2"),
  total: z.number().int().positive(),
  mermaPorcentaje: z.number().min(0).max(100),
  incluyeIva: z.literal(true),
  complementosSoportados: z.literal(false),
  lineas: z.array(LineaCotizacionTallerV2Schema).min(1),
  faltantes: z.array(FaltanteTallerSchema),
}).strict();
export type CotizacionTallerV2 = z.infer<typeof CotizacionTallerV2Schema>;

export const FalloCotizacionTallerSchema = z.object({
  error: z.string(),
  codigo: z.string(),
  faltantes: z.array(FaltanteTallerSchema).optional(),
}).strict();
