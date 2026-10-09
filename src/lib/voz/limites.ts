/** Topes del dictado por voz (REQ-009). Los usan el servidor, que los hace cumplir, y el navegador, que avisa antes. */
export const MAX_BYTES_AUDIO = 2 * 1024 * 1024;
export const MAX_SEGUNDOS_AUDIO = 60;

/** Formatos que graban los navegadores con MediaRecorder: Chrome/Firefox (webm, ogg), Safari (mp4). `wav` por compatibilidad con el servicio. */
export const TIPOS_AUDIO_ACEPTADOS = ["audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"] as const;

/** El tipo sin parámetros: «audio/webm;codecs=opus» → «audio/webm». */
export function tipoBase(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export function esTipoAudioAceptado(contentType: string | null | undefined): boolean {
  return (TIPOS_AUDIO_ACEPTADOS as readonly string[]).includes(tipoBase(contentType));
}
