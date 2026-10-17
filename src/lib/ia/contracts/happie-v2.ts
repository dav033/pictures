import { z } from "zod";
import { HappieConversationStateV1Schema, HappiePackageV1Schema, HappiePackageItemV1Schema, HappieRecommendationRequestV1Schema } from "./happie-v1";

export const HAPPIE_V2 = "happie.v2" as const;
export const HappieModeSchema = z.enum(["servicios", "paquetes", "mixto"]);
export const HappieQuantitySchema = z.object({
  servicios: z.number().int().min(0).max(20),
  paquetes: z.number().int().min(0).max(20),
}).strict().refine((q) => q.servicios + q.paquetes > 0, "Pide al menos un resultado.");
const citySchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const saleUnitSchema = z.object({ singular: z.string().max(40), plural: z.string().max(40) }).strict();
const chargeModeSchema = z.enum(["event", "unit", "per_person"]);

// Explicit projections prevent additive upstream columns from exposing private data.
export const HappieServiceV2Schema = z.object({
  id: z.string().min(1), name: z.string().nullable(), description: z.string().nullable(),
  total: z.number().finite().nonnegative(), charge_type: z.enum(["total", "per_person"]),
  charge_mode: chargeModeSchema, quantity_editable: z.boolean(), sale_unit: saleUnitSchema.nullable(),
  has_delivery: z.boolean(), image_url: z.string().url().refine((url) => new URL(url).protocol === "https:").nullable(),
  image_focus: z.string().regex(/^(?:100|\d{1,2})% (?:100|\d{1,2})%$/),
  category_name: z.string(), provider_name: z.string(), city: z.string(), city_slug: z.string(),
  rating: z.object({ average: z.number().min(1).max(5), count: z.number().int().positive() }).nullable(),
});
export const HappiePackageV2Schema = HappiePackageV1Schema.omit({ package_items: true }).extend({
  city_id: z.string().optional(), city: z.string().optional(), city_slug: z.string().optional(),
  package_items: z.array(HappiePackageItemV1Schema.extend({
    description: z.string().nullable(), provider_name: z.string().nullable(), category_name: z.string().nullable(),
    charge_mode: chargeModeSchema.optional(), quantity_editable: z.boolean().optional(),
    sale_unit: saleUnitSchema.nullable().optional(), removable: z.boolean().optional(),
  }).strip()),
}).strip();
export const HappiePriceV2Schema = z.object({
  moneda: z.literal("COP"), subtotal: z.number().finite().nonnegative().nullable(), es_final: z.literal(false),
  invitados: z.number().int().positive(), cantidad: z.number().int().positive(), advertencia: z.string(),
}).strict();
export const HappieCatalogRecommendationSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("servicio"), servicio: HappieServiceV2Schema, razon: z.string().min(1).max(1500), precio: HappiePriceV2Schema }).strict(),
  z.object({ tipo: z.literal("paquete"), paquete: HappiePackageV2Schema, razon: z.string().min(1).max(1500), precio: HappiePriceV2Schema,
    url: z.string().url().optional() }).strict(),
]);
const options = { modo: HappieModeSchema.optional(), cantidad: HappieQuantitySchema.optional(), city: citySchema.optional() };
export const HappieRecommendationRequestV2Schema = HappieRecommendationRequestV1Schema.omit({ schema_version: true }).extend({
  schema_version: z.literal(HAPPIE_V2), ...options,
  preferencias: z.array(z.string().trim().min(1).max(300)).max(40).optional(),
}).strict();
export const HappieConversationStateV2Schema = HappieConversationStateV1Schema.extend({
  ...options, serviciosDeseados: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
}).strict();
export const HappieConversationRequestV2Schema = z.object({
  schema_version: z.literal(HAPPIE_V2), mensaje: z.string().trim().min(1).max(4000),
  estado: HappieConversationStateV2Schema.optional(), ...options,
}).strict();
export const HappieRecommendationResponseV2Schema = z.object({
  schema_version: z.literal(HAPPIE_V2), modo: HappieModeSchema,
  cantidad: HappieQuantitySchema,
  recomendaciones: z.array(HappieCatalogRecommendationSchema).max(40),
  servicios: z.array(HappieCatalogRecommendationSchema.options[0]).max(20),
  paquetes: z.array(HappieCatalogRecommendationSchema.options[1]).max(20),
  resumen: z.string().min(1).max(4000),
}).strict();
export const HappieConversationResponseV2Schema = z.discriminatedUnion("tipo", [
  z.object({ schema_version: z.literal(HAPPIE_V2), tipo: z.literal("pregunta"), mensaje: z.string().min(1).max(4000), estado: HappieConversationStateV2Schema }).strict(),
  HappieRecommendationResponseV2Schema.extend({ tipo: z.literal("recomendaciones"), mensaje: z.string().min(1).max(4000), estado: HappieConversationStateV2Schema }).strict(),
]);
export type HappieMode = z.infer<typeof HappieModeSchema>;
export type HappieQuantity = z.infer<typeof HappieQuantitySchema>;
export type HappieCatalogRecommendation = z.infer<typeof HappieCatalogRecommendationSchema>;
export type HappieConversationStateV2 = z.infer<typeof HappieConversationStateV2Schema>;

export function catalogOptions(input: { modo?: HappieMode; cantidad?: HappieQuantity }) {
  const modo = input.modo ?? "mixto";
  const cantidad = HappieQuantitySchema.parse(input.cantidad ?? { servicios: modo === "paquetes" ? 0 : 3, paquetes: modo === "servicios" ? 0 : 3 });
  if ((modo === "servicios" && (cantidad.paquetes !== 0 || cantidad.servicios === 0)) ||
      (modo === "paquetes" && (cantidad.servicios !== 0 || cantidad.paquetes === 0))) {
    throw new Error("Las cantidades deben coincidir con el modo solicitado.");
  }
  return { modo, cantidad };
}
