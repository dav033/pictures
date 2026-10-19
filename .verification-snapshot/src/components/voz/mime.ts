/** En orden de preferencia: Chrome/Edge/Firefox graban webm u ogg con opus; Safari (iOS y macOS) solo graba mp4. */
export const MIMES_GRABACION = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"] as const;

/** El primer formato que el navegador sabe grabar, o `null` si ninguno (entonces se graba con el que elija el navegador). */
export function elegirMimeGrabacion(soporta: (mime: string) => boolean): string | null {
  return MIMES_GRABACION.find((mime) => soporta(mime)) ?? null;
}
