import { z } from "zod";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";

const FotoSchema = z.object({ url: z.union([z.url(), z.string().regex(/^\/[\w./-]+$/)]), fuente: z.string().trim().min(1), licencia: z.enum(["sempertex_propia", "pexels", "ejemplo_sin_licencia", "referencia_web_sin_licencia"]) }).strict();
/**
 * De dónde sale la cantidad de un material: «plan_python» (la resolvió el plan de Python para la pieza), «estimado_foto»
 * (contada a mano sobre la foto, porque Python no modela esa parte: flores, esculturas, impresos sueltos…) o
 * «plan_python_y_foto» (suma de las dos). Sin el campo, la cantidad viene del plan de Python (biblioteca hecha por script).
 */
export const ORIGENES_CANTIDAD = ["plan_python", "estimado_foto", "plan_python_y_foto"] as const;
const MaterialSchema = z.object({
  variantId: z.string().min(1), sku: z.string().nullable(), cantidad: z.number().int().positive(),
  /** «Producto del catálogo — variante · código de tamaño · color en palabras de cliente»: de aquí sale el nombre que ve el cliente. */
  nota: z.string().optional(),
  origenCantidad: z.enum(ORIGENES_CANTIDAD).optional(),
  /** Cómo se llegó a la cantidad («estimado a partir de la foto: 12 flores negras de 5 pétalos»). Trazabilidad; no se muestra. */
  detalleCantidad: z.string().trim().min(1).optional(),
}).strict().refine((material) => material.origenCantidad === undefined || material.origenCantidad === "plan_python" || /estimado a partir de la foto/i.test(material.detalleCantidad ?? ""), {
  message: "Una cantidad contada en la foto lo dice en detalleCantidad («estimado a partir de la foto…»).",
});
const PasoSchema = z.object({ orden: z.number().int().positive(), texto: z.string().min(1), foto: z.string().optional(), videoSeg: z.number().positive().optional() }).strict();
const BaseSchema = z.object({
  id: z.string().regex(/^(deco|ej)-[a-z0-9-]+$/),
  titulo: z.string().min(1), tematica: z.string().min(1), eventos: z.array(z.string().min(1)).min(1),
  edad: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict().nullable(),
  fotos: z.array(FotoSchema).min(1), video: z.url().nullable(),
  piezas: z.array(z.object({ estructura: z.enum(ESTRUCTURAS_OFICIALES_IDS), cantidad: z.number().int().positive() }).strict()),
  materiales: z.array(MaterialSchema), pasos: z.array(PasoSchema), shopifyHandle: z.string().nullable(),
  /** Colores de la decoración (hex), del más presente al menos. Con ellos se dibuja la ilustración cuando no hay foto que la represente. */
  paleta: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(1).max(5).optional(),
  /** false: la foto es de otro kit y no representa esta decoración; la tarjeta muestra la ilustración de colores. */
  fotoRepresentativa: z.boolean().optional(),
  /** Lo añade la búsqueda (no la biblioteca): «cercana» = no es de la temática pedida, sino la más parecida. */
  coincidencia: z.enum(["exacta", "cercana"]).optional(),
}).strict();

export const DecoracionSempertexSchema = z.discriminatedUnion("origen", [
  BaseSchema.extend({ origen: z.enum(["sempertex_shopify", "sempertex_manual"]), id: z.string().regex(/^deco-[a-z0-9-]+$/) }),
  BaseSchema.extend({ origen: z.literal("referencia_real"), id: z.string().regex(/^deco-real-[a-z0-9-]+$/) }),
  BaseSchema.extend({ origen: z.literal("ejemplo"), id: z.string().regex(/^ej-[a-z0-9-]+$/), aviso: z.literal("DATO DE EJEMPLO — no es real") }),
]);

const ZonaSchema = z.object({ pais: z.literal("CO"), departamento: z.string(), ciudad: z.string(), cobertura: z.array(z.string()) }).strict();
const ProveedorBaseSchema = z.object({
  id: z.string().min(1), tipo: z.enum(["decorador_happia", "mbp", "distribuidor", "ecommerce"]), nombre: z.string().min(1),
  /** Lo que mejor hace, en palabras de cliente (p. ej. «Baby showers y bautizos»). */
  especialidad: z.string().min(1).optional(),
  zona: ZonaSchema, contacto: z.string().nullable(), url: z.url(),
}).strict();
export const ProveedorSempertexSchema = z.discriminatedUnion("origen", [
  ProveedorBaseSchema.extend({ origen: z.enum(["directorio_happia", "directorio_mbp", "directorio_distribuidores", "ecommerce"]), id: z.string().regex(/^prov-[a-z0-9-]+$/) }),
  ProveedorBaseSchema.extend({ origen: z.literal("ejemplo"), id: z.string().regex(/^ej-prov-[a-z0-9-]+$/), contacto: z.null(), aviso: z.literal("DATO DE EJEMPLO — no es real") }),
]);

export type DecoracionSempertex = z.infer<typeof DecoracionSempertexSchema>;
export type OrigenCantidad = (typeof ORIGENES_CANTIDAD)[number];
export type ProveedorSempertex = z.infer<typeof ProveedorSempertexSchema>;
