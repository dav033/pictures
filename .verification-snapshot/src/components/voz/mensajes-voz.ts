import type { CodigoErrorDictado } from "./estado-dictado";

export const MENSAJES_ERROR_DICTADO: Record<CodigoErrorDictado, string> = {
  sin_permiso: "No tengo permiso para usar el micrófono. Actívalo en los permisos del navegador.",
  sin_microfono: "No encontré un micrófono en este dispositivo.",
  sin_conexion: "Sin conexión: el dictado necesita internet.",
  muy_corto: "No se alcanzó a oír nada. Mantén el micrófono un poco más.",
  demasiado_largo: "El dictado es demasiado largo (máximo 60 segundos).",
  ocupado: "El dictado está ocupado ahora. Inténtalo de nuevo en unos segundos.",
  demasiados: "Demasiados dictados seguidos. Espera un momento.",
  sesion: "Tu sesión venció. Vuelve a entrar para dictar.",
  no_disponible: "El dictado por voz no está disponible ahora.",
  no_se_entendio: "No se escuchó nada. Inténtalo de nuevo, un poco más cerca del micrófono.",
  fallo: "No se pudo transcribir el dictado. Inténtalo de nuevo.",
};

/** Del estado HTTP de `/api/voz/transcribir` (y el `codigo` que a veces trae) al error que se le muestra a la persona. */
export function codigoDeEstadoHttp(status: number, codigoServidor?: string): CodigoErrorDictado {
  if (codigoServidor === "no_configurada") return "no_disponible";
  if (status === 401) return "sesion";
  if (status === 404) return "no_disponible";
  if (status === 413) return "demasiado_largo";
  if (status === 429) return "demasiados";
  if (status === 503) return "ocupado";
  return "fallo";
}

/** Del error que lanza `getUserMedia` al código del dictado. */
export function codigoDeErrorMicrofono(error: unknown): CodigoErrorDictado {
  const nombre = error instanceof DOMException ? error.name : "";
  if (nombre === "NotAllowedError" || nombre === "SecurityError" || nombre === "PermissionDeniedError") return "sin_permiso";
  if (nombre === "NotFoundError" || nombre === "OverconstrainedError" || nombre === "DevicesNotFoundError") return "sin_microfono";
  return "fallo";
}
