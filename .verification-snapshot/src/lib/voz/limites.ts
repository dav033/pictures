/** Topes del dictado por voz (REQ-009). Los usan el servidor, que los hace cumplir, y el navegador, que avisa antes. */
export const MAX_BYTES_AUDIO = 2 * 1024 * 1024;
export const MAX_SEGUNDOS_AUDIO = 60;

/** Formatos que graban los navegadores con MediaRecorder: Chrome/Firefox (webm, ogg), Safari (mp4). `wav` por compatibilidad con el servicio. */
export const TIPOS_AUDIO_ACEPTADOS = ["audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"] as const;

/** `audio/webm` o `audio/webm;codecs=opus`: el único parámetro que se admite es `codecs` (nada como `;x=json`). */
const FORMA_CONTENT_TYPE = /^([a-z0-9.+-]+\/[a-z0-9.+-]+)\s*(?:;\s*codecs\s*=\s*"?[a-z0-9.,\s-]{1,60}"?\s*)?$/i;

/** El tipo de audio sin parámetros («audio/webm;codecs=opus» → «audio/webm»), o `null` si no es un audio aceptado o trae parámetros raros. */
export function tipoAudioAceptado(contentType: string | null | undefined): string | null {
  const base = FORMA_CONTENT_TYPE.exec((contentType ?? "").trim())?.[1].toLowerCase();
  return base && (TIPOS_AUDIO_ACEPTADOS as readonly string[]).includes(base) ? base : null;
}

export function esTipoAudioAceptado(contentType: string | null | undefined): boolean {
  return tipoAudioAceptado(contentType) !== null;
}
