import { analizarReferenciasV2 } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import { crearChatTurnoPython } from "@/lib/ia/amaterasu/chat-python";
import { chatDe, resolverProveedor } from "@/lib/ia/nucleo/registro";
import type { ProveedorId } from "@/lib/ia/nucleo/tipos";
import { REFERENCE_ANALYSIS_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { registrarFalloUi } from "@/lib/errores-ui/traducir-error-servidor";
import { cuerpoExito, leerCuerpo, referenciasEtiquetadas, respuestaError, validarCuerpo } from "./analisis-http";

export const maxDuration = 120;

export async function POST(request: Request) {
  let id: ProveedorId | undefined;
  const requestId = crypto.randomUUID();
  const correlationHeader = request.headers.get("x-correlation-id");
  const correlationId = correlationHeader && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationHeader)
    ? correlationHeader
    : requestId;
  try {
    const body = validarCuerpo(await leerCuerpo(request));
    const cookie = request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1];
    id = resolverProveedor({ override: body.proveedor, cookie });
    // Fase 2 de ADR-0026: flag de capacidad propio de Amaterasu, gradual e
    // independiente de las demás IAs -- ver crearChatTurnoPython.
    const chat = REFERENCE_ANALYSIS_PYTHON_ENABLED
      ? crearChatTurnoPython({ requestId, correlationId })
      : await chatDe(id);
    const references = referenciasEtiquetadas(body.images);
    // La descripción visual no decide productos. El chat resuelve después
    // cada elemento mediante buscar_catalogo_rag contra PostgreSQL validado.
    // `sin_cache` es el "Reintentar" de la UI: pide un análisis nuevo.
    const result = await analizarReferenciasV2(chat, references, [], "perceptual", { requestId, correlationId, superficie: "/api/references/analyze" }, request.signal, { forzarNuevoAnalisis: body.sinCache });
    return Response.json(cuerpoExito(result, references, requestId, id), { headers: { "X-Request-ID": requestId } });
  } catch (error) {
    const { status, body, uiError } = respuestaError(error, requestId);
    registrarFalloUi("/api/references/analyze", uiError);
    return Response.json(body, { status, headers: { "X-Request-ID": requestId } });
  }
}
