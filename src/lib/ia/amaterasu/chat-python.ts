import "server-only";
import type { ChatPort, FragmentoChat, PeticionChat, TurnoChat } from "@/lib/ia/tipos";
import { errorIADeTransportePython } from "@/lib/ia/error-ia-python";
import { llamarPythonReferenceTurn, type PythonReferenceTurnImage } from "@/lib/ia/python-adapter";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Amaterasu's own historial shape (analizar-referencias-v2.ts's `ejecutarPaso`):
 * always exactly one fresh "usuario" message with the reference images and a
 * text instruction, never assistant/tool turns -- each of the two passes
 * (inventory, audit) is an independent call, not a running conversation. This
 * validates that assumption instead of silently mishandling a shape this
 * adapter was never built for.
 */
function mensajeUnicoDeUsuario(historial: PeticionChat["historial"]): Extract<PeticionChat["historial"][number], { rol: "usuario" }> {
  if (historial.length !== 1 || historial[0]!.rol !== "usuario") {
    throw new Error("crearChatTurnoPython solo admite un PeticionChat con un único mensaje de usuario (el uso de Amaterasu); no implementa historial multi-turno.");
  }
  return historial[0] as Extract<PeticionChat["historial"][number], { rol: "usuario" }>;
}

function imagenesPython(mensaje: Extract<PeticionChat["historial"][number], { rol: "usuario" }>): PythonReferenceTurnImage[] {
  return (mensaje.imagenes ?? []).map((imagen) => {
    if (!IMAGE_MIME_TYPES.has(imagen.mime)) {
      throw new Error(`crearChatTurnoPython: tipo de imagen no admitido (${imagen.mime}).`);
    }
    return {
      id: imagen.id ?? "",
      mime: imagen.mime as PythonReferenceTurnImage["mime"],
      base64: imagen.base64,
      descripcion: imagen.descripcion,
    };
  });
}

/**
 * `ChatPort` respaldado por el turno de Gemini que corre en Python
 * (docs/architecture/decisions/0026). Solo implementa `turno()` -- lo único
 * que usa `analizarReferenciasV2` -- y no dedupe bytes de imagen entre la
 * pasada de inventario y la de auditoría como sí hace `crearChatGemini`
 * (diferencia aceptada y documentada en `app/amaterasu/turno.py`).
 */
export function crearChatTurnoPython(opts: { requestId: string; correlationId: string; model?: string }): ChatPort {
  return {
    id: "gemini",
    modelo: opts.model ?? "gemini-3.6-flash",

    async turno(p: PeticionChat): Promise<TurnoChat> {
      const mensaje = mensajeUnicoDeUsuario(p.historial);
      const imagenes = imagenesPython(mensaje);
      try {
        const respuesta = await llamarPythonReferenceTurn({
          systemInstruction: p.sistema,
          message: mensaje.texto,
          images: imagenes,
          tools: p.herramientas.map((herramienta) => ({ name: herramienta.nombre, description: herramienta.descripcion, parametersJsonSchema: herramienta.esquema })),
          ...(p.temperatura !== undefined ? { temperature: p.temperatura } : {}),
          ...(p.maxTokens !== undefined ? { maxOutputTokens: p.maxTokens } : {}),
          ...(opts.model !== undefined ? { model: opts.model } : {}),
          requestId: opts.requestId,
          correlationId: opts.correlationId,
          parentSignal: p.signal,
        });
        return {
          texto: respuesta.text,
          llamadas: respuesta.toolCalls.map((llamada) => ({ nombre: llamada.name, args: llamada.args })),
          uso: {
            entrada: respuesta.usage?.prompt_token_count ?? 0,
            salida: respuesta.usage?.candidates_token_count ?? 0,
            cacheados: respuesta.usage?.cached_content_token_count,
            pensamiento: respuesta.usage?.thoughts_token_count,
          },
          modelo: respuesta.model,
          ...(respuesta.finishReason ? { finishReason: respuesta.finishReason } : {}),
          ...(respuesta.blockReason ? { blockReason: respuesta.blockReason } : {}),
        };
      } catch (error) {
        throw errorIADeTransportePython(error);
      }
    },

    // Amaterasu solo llama a `turno()` (dos pasadas de una sola vuelta, sin
    // streaming); esto lo documenta en vez de fingir soporte no implementado.
    turnoStream(): AsyncIterable<FragmentoChat> {
      throw new Error("crearChatTurnoPython no implementa turnoStream (Amaterasu no lo necesita).");
    },
  };
}
