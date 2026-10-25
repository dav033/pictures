import { ErrorVoz, type RespuestaVps } from "@/lib/voz/cliente-vps";
import type { ConfigVoz } from "@/lib/voz/config";
import { MAX_BYTES_AUDIO, tipoAudioAceptado } from "@/lib/voz/limites";
import type { AsesorRepository } from "./repository";

/**
 * Customer voice notes for the advisor, independent of the channel. The web composer uses it today through
 * `/api/asesor/voice-notes`; a WhatsApp webhook can reuse it as is: download the media (audio/ogg; codecs=opus), call
 * `receiveVoiceNote`, then run the advisor turn with the returned text. The audio is never stored: only its transcript,
 * saved as the customer's message with `inputMode: "voice"`.
 */

export type VoiceNoteError = "unsupported_format" | "too_large" | "empty" | "no_speech" | "not_configured" | "busy" | "timeout" | "failed";
export type VoiceNoteResult = { status: "transcribed"; text: string; seconds: number } | { status: "rejected"; code: VoiceNoteError };
export type VoiceNoteDependencies = {
  config: () => ConfigVoz;
  transcribe: (audio: Uint8Array, contentType: string, config: ConfigVoz) => Promise<RespuestaVps>;
};

/** Spanish text the customer sees for each failure, on any channel. */
export const VOICE_NOTE_MESSAGES: Record<VoiceNoteError, string> = {
  unsupported_format: "Ese formato de audio no se puede escuchar. Envía una nota de voz normal.",
  too_large: "La nota de voz es demasiado larga (máximo 60 segundos).",
  empty: "No llegó audio en la nota de voz.",
  no_speech: "No se escuchó nada en la nota de voz. Inténtalo de nuevo, un poco más cerca del micrófono.",
  not_configured: "Las notas de voz no están disponibles ahora. Escribe tu mensaje, por favor.",
  busy: "Estamos escuchando muchas notas a la vez. Inténtalo de nuevo en unos segundos.",
  timeout: "La nota de voz tardó demasiado en transcribirse. Inténtalo de nuevo.",
  failed: "No pudimos escuchar la nota de voz. Inténtalo de nuevo o escribe tu mensaje.",
};

const FROM_SERVICE: Record<ErrorVoz["codigo"], VoiceNoteError> = {
  no_configurada: "not_configured", ocupado: "busy", demasiado_largo: "too_large", servicio: "failed", tiempo_agotado: "timeout",
};

/** Validates and transcribes one voice note (Spanish, Whisper on the VPS). Limits: the dictation ones, 2 MB and 60 s. */
export async function transcribeVoiceNote(input: { audio: Uint8Array; contentType: string | null }, deps: VoiceNoteDependencies): Promise<VoiceNoteResult> {
  const config = deps.config();
  if (!config.habilitada) return { status: "rejected", code: "not_configured" };
  const contentType = tipoAudioAceptado(input.contentType);
  if (!contentType) return { status: "rejected", code: "unsupported_format" };
  if (input.audio.byteLength === 0) return { status: "rejected", code: "empty" };
  if (input.audio.byteLength > MAX_BYTES_AUDIO) return { status: "rejected", code: "too_large" };
  try {
    const result = await deps.transcribe(input.audio, contentType, config);
    const text = result.texto.replace(/\s+/g, " ").trim();
    return text ? { status: "transcribed", text, seconds: result.duracion_s } : { status: "rejected", code: "no_speech" };
  } catch (error) {
    return { status: "rejected", code: error instanceof ErrorVoz ? FROM_SERVICE[error.codigo] : "failed" };
  }
}

/**
 * Transcribes a voice note and stores it as the customer's turn `turnId` (idempotent: the same turn is not stored twice).
 * The caller then runs the advisor turn with `text` and the same `turnId`.
 */
export async function receiveVoiceNote(
  input: { conversationId: string; turnId: string; audio: Uint8Array; contentType: string | null },
  deps: VoiceNoteDependencies & { repository: Pick<AsesorRepository, "appendMessage" | "listMessages"> },
): Promise<VoiceNoteResult> {
  const existing = (await deps.repository.listMessages(input.conversationId)).find((message) => message.id === input.turnId);
  if (existing) return existing.role === "user" && existing.inputMode === "voice" ? { status: "transcribed", text: existing.content, seconds: 0 } : { status: "rejected", code: "failed" };
  const result = await transcribeVoiceNote(input, deps);
  if (result.status !== "transcribed") return result;
  await deps.repository.appendMessage(input.conversationId, { id: input.turnId, role: "user", content: result.text, inputMode: "voice" });
  return result;
}
