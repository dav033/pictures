import { z } from "zod";
import { DecoracionSempertexSchema, ProveedorSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";
import { CotizacionGuiadaSchema, CotizacionPlanGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { GuiaArmadoSchema } from "./guias-armado";

const PasoPlanSchema = z.object({ orden: z.number().int().positive(), texto: z.string().min(1), globos: z.string().optional() }).strict();

export const WidgetGuiadoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("decoraciones"), decoraciones: z.array(DecoracionSempertexSchema) }).strict(),
  z.object({ tipo: z.literal("seleccion"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("opciones") }).strict(),
  z.object({ tipo: z.literal("pregunta-propuesta"), alcance: z.enum(["tipo", "pieza"]) }).strict(),
  z.object({ tipo: z.literal("uso") }).strict(),
  z.object({ tipo: z.literal("cotizacion"), cotizacion: CotizacionGuiadaSchema.nullable(), uso: z.enum(["negocio", "personal"]), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("pasos"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("pasos-plan"), pasos: z.array(PasoPlanSchema).min(1), guias: z.array(z.object({ estructura_id: z.string(), nombre: z.string(), medidas: z.object({ ancho_m: z.number().optional(), alto_m: z.number().optional(), largo_m: z.number().optional() }).passthrough(), globos: z.array(z.object({ color: z.string(), tamano: z.string(), cantidad: z.number().int().nonnegative() }).strict()), guia: GuiaArmadoSchema }).strict()) }).strict(),
  z.object({ tipo: z.literal("proveedores"), proveedores: z.array(ProveedorSempertexSchema) }).strict(),
  z.object({ tipo: z.literal("comprar"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("propuesta"), propuesta: PropuestaComposicionSchema }).strict(),
  z.object({ tipo: z.literal("plan"), plan: PlanGuiadoSchema, cotizacion: CotizacionPlanGuiadoSchema.optional(), pasos: z.array(PasoPlanSchema).optional(), fotoInspiracion: z.boolean().optional(), imagen: z.string().url().optional(), errorImagen: z.boolean().optional(), compraAbierta: z.boolean().optional() }).strict(),
]);
export type WidgetGuiado = z.infer<typeof WidgetGuiadoSchema>;
