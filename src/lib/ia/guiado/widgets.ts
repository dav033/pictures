import { z } from "zod";
import { DecoracionSempertexSchema, ProveedorSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";
import { CotizacionGuiadaSchema, CotizacionPlanGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";

export const WidgetGuiadoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("decoraciones"), decoraciones: z.array(DecoracionSempertexSchema) }).strict(),
  z.object({ tipo: z.literal("seleccion"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("opciones") }).strict(),
  z.object({ tipo: z.literal("uso") }).strict(),
  z.object({ tipo: z.literal("cotizacion"), cotizacion: CotizacionGuiadaSchema.nullable(), uso: z.enum(["negocio", "personal"]), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("pasos"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("proveedores"), proveedores: z.array(ProveedorSempertexSchema) }).strict(),
  z.object({ tipo: z.literal("comprar"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("propuesta"), propuesta: PropuestaComposicionSchema }).strict(),
  z.object({ tipo: z.literal("plan"), plan: PlanGuiadoSchema, cotizacion: CotizacionPlanGuiadoSchema.optional(), imagen: z.string().url().optional(), errorImagen: z.boolean().optional(), compraAbierta: z.boolean().optional() }).strict(),
]);
export type WidgetGuiado = z.infer<typeof WidgetGuiadoSchema>;
