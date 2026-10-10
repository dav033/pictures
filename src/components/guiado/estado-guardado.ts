import { z } from "zod";
import { BriefGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "@/lib/ia/guiado/widgets";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";

/**
 * Lo que la vista guiada guarda en la sesión del navegador y vuelve a leer al recargar. Los esquemas son estrictos: un despliegue
 * anterior descarta la conversación entera si trae una clave que no conoce, así que toda clave nueva va con `.catch` o solo
 * donde la vista nueva la escribe (ver `propuesta` en `lib/ia/guiado/widgets.ts`).
 */
export const ReferenciaSchema = z.object({ blueprint: ReferenceBlueprintV2Schema, frase: z.string(), aspecto: z.number().positive().optional(), piezas: z.array(z.object({ x: z.number(), y: z.number(), ancho: z.number(), alto: z.number() }).strict()), colores: z.array(z.object({ nombre: z.string(), hex: z.string() }).strict()) }).strict();
const MensajeSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  widgets: z.array(WidgetGuiadoSchema).optional(),
  miniatura: z.string().regex(/^data:image\/jpeg;base64,/).max(80_000).optional(),
  referencia: ReferenciaSchema.optional(),
  notaFoto: z.string().optional(),
  /** La lectura de esta foto ya produjo un plan: «Sí, armémoslo» deja de mostrarse. */
  fotoArmada: z.boolean().optional(),
  /** Un cambio hecho a un plan del 3D (REQ-007, fase 5): el turno con su espec de antes y de después, para calificarlo. */
  edicion3d: z.object({ turnoId: z.string(), antes: z.unknown(), despues: z.unknown() }).strict().optional(),
  /** Respuestas rápidas de una pregunta local (sin modelo). */
  rapidas: z.array(z.string().min(1).max(60)).max(8).optional(),
  destacadas: z.array(z.string().min(1).max(60)).max(4).optional(),
  /** Pregunta local de ciudad: lo que el cliente elija o escriba se convierte en la búsqueda correspondiente. */
  pregunta: z.enum(["ciudad-decorador", "ciudad-distribuidor"]).optional(),
  /**
   * Lo que viajó con este mensaje del cliente además del texto (uso, alcance, pieza pedida): si se queda sin respuesta,
   * «Reintentar» lo repite igual también después de recargar (probador 124, hallazgo 2).
   */
  envio: z.object({
    uso: z.enum(["negocio", "personal"]).optional(),
    alcance: z.enum(["completa", "individual"]).optional(),
    pieza: z.enum(ESTRUCTURAS_OFICIALES_IDS).optional(),
  }).strict().optional(),
}).strict();
export type Mensaje = z.infer<typeof MensajeSchema>;

export const MAX_MENSAJES_GUARDADOS = 80;
export const EstadoGuardadoSchema = z.object({
  mensajes: z.array(MensajeSchema).max(MAX_MENSAJES_GUARDADOS),
  // El brief entero: también lo que dijo el cliente (uso, medida, pieza, lugar…) y el rango de edad que eligió.
  brief: BriefGuiadoSchema.optional(),
  seleccionadaId: z.string().nullable().optional(),
  uso: z.enum(["negocio", "personal"]).nullable().optional(),
}).strict();
