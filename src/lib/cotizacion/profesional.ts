import { z } from "zod";

/**
 * Cotización profesional (`cotizacion-profesional.v1`): los costos que escribe
 * el decorador —mano de obra, equipos y transporte, indirectos y % de
 * utilidad— sobre los materiales que ya cotizó el plan. Python calcula
 * (`services/ai-api/app/cotizacion_profesional.py`); aquí solo vive la forma
 * de la frontera, sin server-only, para que la ruta, el adaptador y la tarjeta
 * usen el mismo esquema. Los límites son los del modelo de Python: una
 * entrada que no cumple se rechaza con 400 antes de llegar a él.
 */

export const MAX_LINEAS_MATERIALES = 256;
export const MAX_LINEAS_SECCION = 50;
export const MAX_COP = 1_000_000_000_000;
export const MAX_PAQUETES = 100_000;
export const MAX_CANTIDAD = 100_000;
export const MAX_UTILIDAD_PORCENTAJE = 1000;

export const SECCIONES_COSTO = ["mano_de_obra", "equipos_transporte", "indirectos"] as const;
export type SeccionCosto = (typeof SECCIONES_COSTO)[number];

/** A lo sumo dos decimales, como `decimal_places=2` en Python. */
function conCentesimas(valor: number): boolean {
  const centesimas = valor * 100;
  return Math.abs(centesimas - Math.round(centesimas)) < 1e-9;
}

const pesosSchema = z.number().int().nonnegative().max(MAX_COP);
const descripcionSchema = z.string().trim().min(1).max(120);

export const LineaMaterialProfesionalSchema = z.object({
  variant_id: z.string().trim().min(1).max(160),
  descripcion: descripcionSchema,
  paquetes: z.number().int().min(1).max(MAX_PAQUETES),
  precio_paquete_catalogo_cop: pesosSchema,
  /** El precio por bolsa que puso el decorador; ausente usa el del catálogo. */
  precio_paquete_cop: pesosSchema.optional(),
}).strict();

export const LineaCostoSchema = z.object({
  descripcion: descripcionSchema,
  costo_unitario_cop: pesosSchema,
  cantidad: z.number().positive().max(MAX_CANTIDAD).refine(conCentesimas, "A lo sumo dos decimales."),
}).strict();

export const EntradaCotizacionProfesionalSchema = z.object({
  materiales: z.array(LineaMaterialProfesionalSchema).min(1).max(MAX_LINEAS_MATERIALES)
    .refine((lineas) => new Set(lineas.map((linea) => linea.variant_id)).size === lineas.length, "Cada variante va una sola vez."),
  mano_de_obra: z.array(LineaCostoSchema).max(MAX_LINEAS_SECCION),
  equipos_transporte: z.array(LineaCostoSchema).max(MAX_LINEAS_SECCION),
  indirectos: z.array(LineaCostoSchema).max(MAX_LINEAS_SECCION),
  /** `null` mientras el decorador no escribe un porcentaje: sin utilidad. */
  utilidad_porcentaje: z.number().min(0).max(MAX_UTILIDAD_PORCENTAJE).refine(conCentesimas, "A lo sumo dos decimales.").nullable(),
}).strict();

export type LineaMaterialProfesional = z.infer<typeof LineaMaterialProfesionalSchema>;
export type LineaCosto = z.infer<typeof LineaCostoSchema>;
export type EntradaCotizacionProfesional = z.infer<typeof EntradaCotizacionProfesionalSchema>;

const seccionResultadoSchema = z.object({
  lineas: z.array(z.object({
    descripcion: z.string(),
    costo_unitario_cop: pesosSchema,
    cantidad: z.number().positive(),
    subtotal_cop: z.number().int().nonnegative(),
  }).strict()),
  total_cop: z.number().int().nonnegative(),
}).strict();

export const CotizacionProfesionalResultadoSchema = z.object({
  operation_schema_version: z.literal("cotizacion-profesional-result.v1"),
  currency: z.literal("COP"),
  materiales: z.object({
    lineas: z.array(z.object({
      variant_id: z.string().min(1),
      descripcion: z.string(),
      paquetes: z.number().int().positive(),
      precio_paquete_catalogo_cop: pesosSchema,
      precio_paquete_cop: pesosSchema,
      precio_editado: z.boolean(),
      subtotal_cop: z.number().int().nonnegative(),
    }).strict()),
    total_cop: z.number().int().nonnegative(),
  }).strict(),
  mano_de_obra: seccionResultadoSchema,
  equipos_transporte: seccionResultadoSchema,
  indirectos: seccionResultadoSchema,
  total_costos_cop: z.number().int().nonnegative(),
  utilidad_porcentaje: z.number().nonnegative().nullable(),
  utilidad_cop: z.number().int().nonnegative(),
  precio_sugerido_cop: z.number().int().nonnegative(),
  /** Utilidad sobre el precio sugerido; `null` con precio 0. */
  margen_porcentaje: z.number().nonnegative().nullable(),
}).strict();

export type CotizacionProfesionalResultado = z.infer<typeof CotizacionProfesionalResultadoSchema>;
