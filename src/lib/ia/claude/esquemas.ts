import { z } from "zod";
import type { EventoFlujoAnthropic, RespuestaAnthropic } from "./tipos";

/** Validación en el borde de lo que devuelve la API de mensajes (respuesta completa y eventos del flujo SSE). */

/** Los bloques conservan todos sus campos: los de razonamiento se reenvían tal cual en la vuelta siguiente. */
const BloqueSchema = z.looseObject({ type: z.string() });

const UsoSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
  output_tokens_details: z.object({ thinking_tokens: z.number().nullish() }).nullish(),
});

export const RespuestaSchema = z.object({
  id: z.string(),
  model: z.string(),
  content: z.array(BloqueSchema),
  stop_reason: z.string().nullable(),
  usage: UsoSchema,
}) satisfies z.ZodType<RespuestaAnthropic>;

const DeltaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string() }),
  z.object({ type: z.literal("input_json_delta"), partial_json: z.string() }),
  z.object({ type: z.literal("thinking_delta"), thinking: z.string() }),
  z.object({ type: z.literal("signature_delta"), signature: z.string() }),
]);

const EventoSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_start"), message: RespuestaSchema }),
  z.object({ type: z.literal("content_block_start"), index: z.number(), content_block: BloqueSchema }),
  z.object({ type: z.literal("content_block_delta"), index: z.number(), delta: DeltaSchema }),
  z.object({ type: z.literal("content_block_stop"), index: z.number() }),
  z.object({ type: z.literal("message_delta"), delta: z.object({ stop_reason: z.string().nullish() }), usage: UsoSchema.partial().optional() }),
  z.object({ type: z.literal("message_stop") }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("error"), error: z.object({ type: z.string(), message: z.string() }) }),
]);

const TIPOS_CONOCIDOS = new Set(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop", "ping", "error"]);
const DELTAS_CONOCIDOS = new Set(["text_delta", "input_json_delta", "thinking_delta", "signature_delta"]);

/**
 * Un evento del flujo ya parseado como JSON. Devuelve `null` para tipos que este adaptador no usa (la API puede sumar
 * eventos o deltas nuevos sin aviso, p. ej. `citations_delta`); un tipo conocido con forma inválida es un error.
 */
export function eventoDeFlujo(dato: unknown): EventoFlujoAnthropic | null {
  const tipo = typeof dato === "object" && dato !== null && "type" in dato ? (dato as { type: unknown }).type : undefined;
  if (typeof tipo !== "string" || !TIPOS_CONOCIDOS.has(tipo)) return null;
  if (tipo === "content_block_delta") {
    const delta = (dato as { delta?: { type?: unknown } }).delta;
    if (typeof delta?.type === "string" && !DELTAS_CONOCIDOS.has(delta.type)) return null;
  }
  return EventoSchema.parse(dato);
}
