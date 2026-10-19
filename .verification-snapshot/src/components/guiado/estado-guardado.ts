import { z } from "zod";
import { ACCIONES_IDEA_GUIADA, BriefGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
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
    /** El chip de la idea (D-043): tras recargar, «Reintentar» lo repite por reglas, no con el modelo. */
    accionIdea: z.enum(ACCIONES_IDEA_GUIADA).optional(),
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

/**
 * `envio.accionIdea` NO va dentro de la sesión guardada: un despliegue anterior valida `envio` con un esquema estricto y
 * descartaría la conversación entera por una clave que no conoce. Viaja aparte, bajo otra clave de la sesión del navegador,
 * por id de mensaje: el esquema de arriba (y el de un despliegue anterior) lee igual con o sin ella.
 */
export const CLAVE_ACCIONES_IDEA = "demo_guiado_v2_acciones";
const AccionIdeaSchema = z.enum(ACCIONES_IDEA_GUIADA);
const AccionesCrudasSchema = z.record(z.string(), z.unknown());
type AccionesGuardadas = Record<string, z.infer<typeof AccionIdeaSchema>>;

export function separarAccionesIdea(mensajes: readonly Mensaje[]): { mensajes: Mensaje[]; acciones: AccionesGuardadas } {
  const acciones: AccionesGuardadas = {};
  const limpios = mensajes.map((mensaje): Mensaje => {
    if (!mensaje.envio?.accionIdea) return mensaje;
    const { accionIdea, ...envio } = mensaje.envio;
    acciones[mensaje.id] = accionIdea;
    return { ...mensaje, envio };
  });
  return { mensajes: limpios, acciones };
}

/** Devuelve a cada mensaje su acción; un valor ilegible se ignora (el reintento cae al camino normal). */
export function juntarAccionesIdea(mensajes: readonly Mensaje[], crudo: unknown): Mensaje[] {
  const acciones = AccionesCrudasSchema.safeParse(crudo);
  if (!acciones.success) return [...mensajes];
  return mensajes.map((mensaje) => {
    const accionIdea = AccionIdeaSchema.safeParse(acciones.data[mensaje.id]);
    return accionIdea.success ? { ...mensaje, envio: { ...mensaje.envio, accionIdea: accionIdea.data } } : mensaje;
  });
}

/** Lo que dice la burbuja del asistente mientras llega el plan exacto de una idea (chip «Cuánto cuesta» / «Aprender»). */
export const PREPARANDO_PLAN_IDEA = "Preparo el plan de";

/**
 * Esa burbuja es transitoria: no se guarda mientras el plan viene en camino. Al recargar, la petición del cliente (que lleva su
 * `accionIdea`) queda sin respuesta y vuelve con su «Reintentar» (`turnoSinRespuesta`), en vez de un «Preparo el plan…» eterno.
 */
export function sinEsperaTransitoria(mensajes: readonly Mensaje[], pendienteId: string | null): Mensaje[] {
  return mensajes.filter((mensaje) => !(mensaje.id === pendienteId && mensaje.role === "assistant" && !mensaje.widgets?.length && mensaje.content.startsWith(PREPARANDO_PLAN_IDEA)));
}
