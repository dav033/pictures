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
/** Globos de una línea a granel (los del plan, los extra o los de un paquete). */
export const MAX_UNIDADES = 100_000;

/**
 * Qué total de materiales entra al precio: los paquetes cerrados (siempre) o
 * los globos sueltos, a granel. El modo a granel solo lo sabe cotizar el
 * Python que lo anuncia en `modos_materiales` cuando recibe esta cabecera: a
 * un Python anterior (que prohíbe campos de más) nunca se le manda `granel`.
 */
export const MODOS_MATERIALES = ["paquete", "granel"] as const;
export type ModoMateriales = (typeof MODOS_MATERIALES)[number];
export const CABECERA_MODOS_MATERIALES = "x-cotizacion-modos";

export const SECCIONES_COSTO = ["mano_de_obra", "equipos_transporte", "indirectos"] as const;
export type SeccionCosto = (typeof SECCIONES_COSTO)[number];

/** A lo sumo dos decimales, como `decimal_places=2` en Python. */
function conCentesimas(valor: number): boolean {
  const centesimas = valor * 100;
  return Math.abs(centesimas - Math.round(centesimas)) < 1e-9;
}

const pesosSchema = z.number().int().nonnegative().max(MAX_COP);
const descripcionSchema = z.string().trim().min(1).max(120);
const unidadesSchema = z.number().int().min(1).max(MAX_UNIDADES);

/** Los globos sueltos de un material: los del plan (de la cotización de Python) y los que el decorador agrega. */
export const GranelMaterialSchema = z.object({
  unidades_plan: unidadesSchema,
  unidades_paquete: unidadesSchema,
  unidades_extra: z.number().int().min(0).max(MAX_UNIDADES).optional(),
  /** Lo que le cuesta cada globo al decorador; ausente usa el del paquete ÷ sus unidades. */
  precio_unidad_cop: pesosSchema.optional(),
}).strict();

export const LineaMaterialProfesionalSchema = z.object({
  variant_id: z.string().trim().min(1).max(160),
  descripcion: descripcionSchema,
  paquetes: z.number().int().min(1).max(MAX_PAQUETES),
  precio_paquete_catalogo_cop: pesosSchema,
  /** El precio por bolsa que puso el decorador; ausente usa el del catálogo. */
  precio_paquete_cop: pesosSchema.optional(),
  /** Solo hacia un Python que anunció el modo a granel. */
  granel: GranelMaterialSchema.optional(),
}).strict();

export const LineaCostoSchema = z.object({
  descripcion: descripcionSchema,
  costo_unitario_cop: pesosSchema,
  cantidad: z.number().positive().max(MAX_CANTIDAD).refine(conCentesimas, "A lo sumo dos decimales."),
}).strict();

export const EntradaCotizacionProfesionalSchema = z.object({
  materiales: z.array(LineaMaterialProfesionalSchema).min(1).max(MAX_LINEAS_MATERIALES)
    .refine((lineas) => new Set(lineas.map((linea) => linea.variant_id)).size === lineas.length, "Cada variante va una sola vez.")
    // Medio granel no tiene un total a granel (Python lo rechaza igual).
    .refine((lineas) => lineas.every((linea) => linea.granel) || lineas.every((linea) => !linea.granel), "Granel va en todos los materiales o en ninguno."),
  mano_de_obra: z.array(LineaCostoSchema).max(MAX_LINEAS_SECCION),
  equipos_transporte: z.array(LineaCostoSchema).max(MAX_LINEAS_SECCION),
  indirectos: z.array(LineaCostoSchema).max(MAX_LINEAS_SECCION),
  /** `null` mientras el decorador no escribe un porcentaje: sin utilidad. */
  utilidad_porcentaje: z.number().min(0).max(MAX_UTILIDAD_PORCENTAJE).refine(conCentesimas, "A lo sumo dos decimales.").nullable(),
  /** Ausente: por paquete, lo de siempre (y lo único que entiende un Python anterior). */
  modo_materiales: z.enum(MODOS_MATERIALES).optional(),
}).strict().refine(
  (entrada) => entrada.modo_materiales !== "granel" || entrada.materiales.every((linea) => linea.granel),
  { message: "El modo a granel necesita los globos sueltos de cada material.", path: ["modo_materiales"] },
);

export type GranelMaterial = z.infer<typeof GranelMaterialSchema>;
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

const enteroSchema = z.number().int().nonnegative();

/** Los globos sueltos de una línea, como los calculó Python (solo si se pidieron). */
const granelResultadoSchema = z.object({
  unidades_plan: enteroSchema,
  unidades_extra: enteroSchema,
  unidades: enteroSchema,
  unidades_paquete: z.number().int().positive(),
  /** Precio por globo de partida: el del paquete ÷ sus unidades, redondeado a pesos. */
  precio_unidad_base_cop: pesosSchema,
  /** `true` si sale de dividir un paquete de varias unidades; `false` si el paquete es de una. */
  precio_unidad_estimado: z.boolean(),
  precio_unidad_cop: pesosSchema,
  precio_unidad_editado: z.boolean(),
  subtotal_cop: enteroSchema,
  /** Globos del plan que sobrarían comprando los paquetes de la cotización. */
  sobrante_paquetes: enteroSchema,
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
      /** Siempre el de los paquetes; el de los globos sueltos va en `granel`. */
      subtotal_cop: z.number().int().nonnegative(),
      granel: granelResultadoSchema.optional(),
    }).strict()),
    /** El total del modo cotizado (sin `modo`: por paquete). */
    total_cop: z.number().int().nonnegative(),
    modo: z.enum(MODOS_MATERIALES).optional(),
    total_paquetes_cop: enteroSchema.optional(),
    granel: z.object({
      unidades_plan: enteroSchema,
      unidades_extra: enteroSchema,
      unidades: enteroSchema,
      sobrante_paquetes: enteroSchema,
      total_cop: enteroSchema,
    }).strict().optional(),
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
  /**
   * Los modos de materiales que sabe cotizar el Python que respondió (solo si
   * se le mandó la cabecera). Ausente: un Python anterior, solo por paquete.
   * Texto libre a propósito: un modo nuevo no debe tumbar la cotización.
   */
  modos_materiales: z.array(z.string()).optional(),
}).strict();

export type CotizacionProfesionalResultado = z.infer<typeof CotizacionProfesionalResultadoSchema>;
/** Los globos sueltos de una línea del resultado. */
export type GranelResultado = z.infer<typeof granelResultadoSchema>;
