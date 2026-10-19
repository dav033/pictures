import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import { isPythonAdapterError, type PythonAdapterErrorCode } from "@/lib/ia/nucleo/python-adapter";

/**
 * Maps a failed Next -> Python call (transport, auth, deadline) to the same
 * `ErrorIA` causas the direct Gemini adapter reports (`categorizarError` in
 * packages/agente-core/src/gemini/chat.ts), so the ChatPort callers --
 * Amaterasu's retry-on-malformed loop, Omoikane's tool loop and the chat
 * route's SSE error mapping -- do not need to know which path ran. Provider
 * failures that Python forwards with their original status are NOT mapped
 * here: they go through `categorizarError` itself.
 */
export function errorIADeTransportePython(error: unknown): ErrorIA {
  if (error instanceof ErrorIA) return error;
  if (!isPythonAdapterError(error)) {
    return new ErrorIA("desconocido", "gemini", error instanceof Error ? error.message : "Error desconocido", true);
  }
  const causaPorCodigo: Partial<Record<PythonAdapterErrorCode, ErrorIA["causa"]>> = {
    PYTHON_BACKEND_NOT_CONFIGURED: "sin_llave",
    PYTHON_AUTH_FAILED: "sin_llave",
    PYTHON_SCOPE_DENIED: "sin_llave",
    PYTHON_BACKEND_TIMEOUT: "timeout",
    PYTHON_REQUEST_CANCELLED: "timeout",
    PYTHON_PAYLOAD_TOO_LARGE: "desconocido",
  };
  const causa = causaPorCodigo[error.code] ?? "desconocido";
  return new ErrorIA(causa, "gemini", error.message, error.retryable);
}
