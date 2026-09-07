import { z } from "zod";

export const HAPPIE_CONTRACT_VERSION = "happie.v1" as const;

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1);

export const HappiePackageItemV1Schema = z.object({
  id: idSchema,
  total: z.number().int().nonnegative(),
  is_active: z.boolean(),
  package_id: idSchema,
  charge_type: textSchema,
  description: textSchema,
  suggested_start_time: z.string().nullable(),
  provider_name: textSchema.nullable(),
  category_name: textSchema.nullable(),
}).strict();

export const HappiePackageV1Schema = z.object({
  id: idSchema,
  event_type_id: idSchema,
  name: textSchema,
  base_guests: z.number().int().positive(),
  standard_duration_minutes: z.number().int().positive().nullable(),
  conditions: z.string().nullable(),
  restrictions: z.string().nullable(),
  is_active: z.boolean(),
  is_featured: z.boolean(),
  package_items: z.array(HappiePackageItemV1Schema),
}).strict();

export const HappieRecommendationRequestV1Schema = z.object({
  schema_version: z.literal(HAPPIE_CONTRACT_VERSION).optional(),
  tipoEvento: textSchema.max(120),
  invitados: z.number().int().positive().max(100_000),
  presupuesto: z.number().finite().positive(),
  comida: z.boolean().optional(),
  bebida: z.boolean().optional(),
  decoracion: z.boolean().optional(),
  fotografia: z.boolean().optional(),
  preferencias: z.array(textSchema.max(300)).max(20).optional(),
  url: z.string().url().refine((value) => /^https?:$/.test(new URL(value).protocol), "Debe ser una URL HTTP o HTTPS válida.").optional(),
}).strict();

export const HappieDescriptionRequestV1Schema = z.object({
  schema_version: z.literal(HAPPIE_CONTRACT_VERSION).optional(),
  descripcionEvento: textSchema.max(2_000),
}).strict();

export const HappieStructuredRecommendationRequestV1Schema = z.object({
  schema_version: z.literal(HAPPIE_CONTRACT_VERSION).optional(),
  tipoEvento: textSchema.max(120),
  invitados: z.number().int().positive().max(100_000),
  ubicacion: textSchema.max(200),
  necesidades: z.array(textSchema.max(300)).max(20).optional(),
}).strict();

export const HappieRecommendationV1Schema = z.object({
  url: z.string().url(),
  razon: textSchema.max(1_000),
}).strict();

export const HappieRecommendationResponseV1Schema = z.object({
  schema_version: z.literal(HAPPIE_CONTRACT_VERSION),
  recomendaciones: z.array(HappieRecommendationV1Schema).max(3),
  resumen: textSchema.max(2_000),
}).strict();

export const HappiePackageRecommendationV1Schema = z.object({
  paquete: HappiePackageV1Schema,
  razon: textSchema.max(1_000),
}).strict();

export const HappiePackageRecommendationResponseV1Schema = z.object({
  schema_version: z.literal(HAPPIE_CONTRACT_VERSION),
  recomendaciones: z.array(HappiePackageRecommendationV1Schema).max(3),
  resumen: textSchema.max(2_000),
}).strict();

const HAPPIE_SERVICES = ["comida", "bebida", "decoracion", "fotografia"] as const;

export const HappieConversationStateV1Schema = z.object({
  fase: z.enum(["descubrimiento", "detalles", "confirmacion", "finalizado"]),
  tipoEvento: textSchema.max(120).optional(),
  invitados: z.number().int().positive().max(100_000).optional(),
  presupuesto: z.number().finite().positive().optional(),
  servicios: z.array(z.enum(HAPPIE_SERVICES)).max(HAPPIE_SERVICES.length),
  preferencias: z.array(textSchema.max(300)).max(20),
}).strict();

export const HappieConversationRequestV1Schema = z.object({
  schema_version: z.literal(HAPPIE_CONTRACT_VERSION).optional(),
  mensaje: textSchema.max(2_000),
  estado: HappieConversationStateV1Schema.optional(),
  url: z.string().url().optional(),
}).strict();

export const HappieConversationResponseV1Schema = z.discriminatedUnion("tipo", [
  z.object({
    schema_version: z.literal(HAPPIE_CONTRACT_VERSION),
    tipo: z.literal("pregunta"),
    mensaje: textSchema.max(2_000),
    estado: HappieConversationStateV1Schema,
  }).strict(),
  z.object({
    schema_version: z.literal(HAPPIE_CONTRACT_VERSION),
    tipo: z.literal("recomendaciones"),
    mensaje: textSchema.max(2_000),
    estado: HappieConversationStateV1Schema,
    recomendaciones: z.array(HappieRecommendationV1Schema).max(3),
    resumen: textSchema.max(2_000),
  }).strict(),
]);

export const HappieErrorV1Schema = z.object({
  schema_version: z.literal(HAPPIE_CONTRACT_VERSION),
  error: textSchema.max(2_000),
  campos: z.array(z.string().min(1)).optional(),
}).strict();

export type HappieRecommendationRequestV1 = z.infer<typeof HappieRecommendationRequestV1Schema>;
export type HappieRecommendationResponseV1 = z.infer<typeof HappieRecommendationResponseV1Schema>;
export type HappieConversationStateV1 = z.infer<typeof HappieConversationStateV1Schema>;
