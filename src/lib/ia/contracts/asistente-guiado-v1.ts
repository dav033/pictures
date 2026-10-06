import { z } from "zod";
import { PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

export const ASISTENTE_GUIADO_VERSION = "asistente-guiado.v1" as const;
const BriefGuiadoSchema = z.object({ evento: z.string().trim().min(1).max(120).optional(), edad: z.number().int().min(0).max(120).optional(), tematica: z.string().trim().min(1).max(160).optional() }).strict();
const EstadoGuiadoSchema = z.object({ decoracionId: z.string().regex(/^(ej|deco)-[a-z0-9-]+$/).optional(), uso: z.enum(["negocio", "personal"]).optional(), opcion: z.enum(["contratar", "costear", "comprar", "aprender"]).optional() }).strict();
const FotoInspiracionSchema = z.object({ base64: z.string().min(1).max(8_000_000), mime: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict();
export const AsistenteGuiadoRequestSchema = z.object({
  schema_version: z.literal(ASISTENTE_GUIADO_VERSION),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) }).strict()).min(1).max(80),
  brief: BriefGuiadoSchema,
  estadoGuiado: EstadoGuiadoSchema.optional(),
  fotoInspiracion: FotoInspiracionSchema.optional(),
}).strict();

export const RespuestaGuiadaSchema = z.object({
  brief: z.object({ evento: z.string().min(1).max(120), edad: z.number().int().min(0).max(120), tematica: z.string().min(1).max(160) }).strict().optional(),
  decoraciones: z.array(z.unknown()).optional(),
  opciones: z.array(z.enum(["contratar", "costear", "comprar", "aprender"])).optional(),
  preguntaUso: z.boolean().optional(),
  cotizacion: z.unknown().optional(),
  uso: z.enum(["negocio", "personal"]).optional(),
  pasos: z.array(z.object({ orden: z.number().int().positive(), texto: z.string().min(1) }).strict()).optional(),
  proveedores: z.array(z.unknown()).optional(),
}).passthrough();

export const ListaMaterialesRequestSchema = z.object({
  schema_version: z.literal("lista-materiales.v1"),
  materiales: z.array(z.object({ variant_id: z.string().min(1).max(160), cantidad: z.number().int().positive().max(100_000) }).strict()).min(1).max(256)
    .refine((lineas) => new Set(lineas.map((linea) => linea.variant_id)).size === lineas.length),
}).strict();
export const ListaMaterialesResultadoSchema = z.object({
  operation_schema_version: z.literal("lista-materiales-result.v1"),
  currency: z.literal("COP"),
  incluye_iva: z.literal(true),
  lineas: z.array(z.object({ variant_id: z.string(), nombre: z.string(), cantidad_necesaria: z.number().int().positive(), unidades_paquete: z.number().int().positive(), paquetes: z.number().int().positive(), precio_paquete: z.number().int().positive(), subtotal: z.number().int().positive(), sobrante: z.number().int().nonnegative() }).strict()),
  total: z.number().int().positive(),
}).strict();
export const CotizacionGuiadaSchema = z.object({
  lineas: z.array(z.object({ id: z.string(), tamano: z.string(), color: z.enum(PALETA_COLORES_V2).optional(), cantidadNecesaria: z.number().int().positive(), disponible: z.boolean(), varianteId: z.string(), nombre: z.string(), precioPaquete: z.number().int().positive(), unidadesPaquete: z.number().int().positive(), paquetes: z.number().int().positive(), subtotal: z.number().int().positive(), sobrante: z.number().int().nonnegative() }).strict()).min(1),
  total: z.number().int().positive(), mermaPorcentaje: z.literal(0), incluyeIva: z.literal(true), complementosSoportados: z.literal(false),
}).strict();

export type AsistenteGuiadoRequest = z.infer<typeof AsistenteGuiadoRequestSchema>;
