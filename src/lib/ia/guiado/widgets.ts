import { z } from "zod";
import { DecoracionSempertexSchema, ProveedorSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";
import { CotizacionGuiadaSchema, CotizacionPlanGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { GuiaArmadoSchema } from "./guias-armado";

const PasoPlanSchema = z.object({ orden: z.number().int().positive(), texto: z.string().min(1), globos: z.string().optional() }).strict();

/** Acciones del widget «Tu plan». `cambiar` solo se marca como hecha; las otras cinco también las puede abrir el modelo. */
export const AccionPlanGuiadaSchema = z.enum(["ver", "costear", "comprar", "aprender", "contratar", "cambiar"]);
export type AccionPlanGuiada = z.infer<typeof AccionPlanGuiadaSchema>;
const UsoSchema = z.enum(["negocio", "personal"]);

// Los campos de «lo que el cliente ya eligió» son opcionales y aditivos: las sesiones guardadas antes siguen siendo válidas.
export const WidgetGuiadoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("decoraciones"), decoraciones: z.array(DecoracionSempertexSchema), elegidaId: z.string().optional() }).strict(),
  z.object({ tipo: z.literal("seleccion"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("opciones"), elegida: z.enum(["contratar", "costear", "comprar", "aprender"]).optional() }).strict(),
  z.object({ tipo: z.literal("pregunta-propuesta"), alcance: z.enum(["tipo", "pieza"]), elegida: z.string().optional() }).strict(),
  z.object({ tipo: z.literal("uso"), elegido: UsoSchema.optional() }).strict(),
  z.object({ tipo: z.literal("cotizacion"), cotizacion: CotizacionGuiadaSchema.nullable(), uso: UsoSchema, decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("pasos"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("pasos-plan"), pasos: z.array(PasoPlanSchema).min(1), guias: z.array(z.object({ estructura_id: z.string(), nombre: z.string(), medidas: z.object({ ancho_m: z.number().optional(), alto_m: z.number().optional(), largo_m: z.number().optional() }).passthrough(), globos: z.array(z.object({ color: z.string(), tamano: z.string(), cantidad: z.number().int().nonnegative() }).strict()), guia: GuiaArmadoSchema }).strict()) }).strict(),
  z.object({ tipo: z.literal("proveedores"), proveedores: z.array(ProveedorSempertexSchema), solicitadoId: z.string().optional(), ciudad: z.string().optional(), ciudadesDisponibles: z.array(z.string()).optional() }).strict(),
  z.object({ tipo: z.literal("comprar"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("propuesta"), propuesta: PropuestaComposicionSchema, estado: z.enum(["resolviendo", "fallo"]).optional() }).strict(),
  z.object({
    tipo: z.literal("plan"), plan: PlanGuiadoSchema, cotizacion: CotizacionPlanGuiadoSchema.optional(), pasos: z.array(PasoPlanSchema).optional(), fotoInspiracion: z.boolean().optional(),
    /** Con `fotoInspiracion`: el mensaje que trae la lectura de la foto de la que salió el plan (y sus versiones rehechas). */
    referenciaId: z.string().min(1).max(80).optional(),
    imagen: z.union([z.string().url(), z.string().startsWith("/api/guiada-imagen/")]).optional(), errorImagen: z.boolean().optional(), compraAbierta: z.boolean().optional(),
    usoCosteo: UsoSchema.optional(), reemplazado: z.boolean().optional(), totalAnterior: z.number().int().nonnegative().optional(), hechas: z.array(AccionPlanGuiadaSchema).optional(),
    /** Ajustes hechos con «Ajustar mi plan» sobre esta tarjeta («más rosado en el semiarco orgánico»), los últimos primero al final. */
    ajustes: z.array(z.string().min(1).max(160)).max(8).optional(),
    /** Ideas de la biblioteca que el cliente sumó a este plan con «Agregar al plan» (la idea dice «Está en tu plan»). */
    ideas: z.array(z.string().regex(/^(?:deco|ej)-[a-z0-9-]+$/)).max(12).optional(),
    /** La idea que trajo esta versión del plan: «Agregué «Columnas negras y doradas» a tu plan: ahora tiene 188 globos». */
    agregada: z.object({
      titulo: z.string().min(1).max(160), total: z.number().int().nonnegative(),
      /** Si el plan de la idea NO salió exacto, por qué (`avisos-plan-idea.ts`): «Ajustamos un tamaño que no había: 36″ por 24″.». */
      avisos: z.array(z.string().min(1).max(300)).max(4).optional(),
    }).strict().optional(),
  }).strict(),
]);
export type WidgetGuiado = z.infer<typeof WidgetGuiadoSchema>;
