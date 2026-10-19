import type { GenerarEstructurado } from "@sempertex/happie-package-ia";
import { esquemaRaizParaGoogle } from "@/lib/ia/nucleo/esquema-google";
import { llamarPythonHappieGenerate, type PythonHappieGeneratePurpose } from "@/lib/ia/nucleo/python-adapter";
import type { IdsHappie } from "./telemetria";

/** Mismo techo que ya acota `solicitud.signal` en el camino directo. */
const DEADLINE_HAPPIE_MS = 25_000;

/**
 * `GenerarEstructurado` respaldado por el servicio Python (ADR-0026, fase 5):
 * Python solo hace la llamada a Gemini. El prompt, las partes del mensaje y
 * la validación de la respuesta siguen en quien invoca el puerto.
 */
export function generadorHappiePython(purpose: PythonHappieGeneratePurpose, ids: IdsHappie): GenerarEstructurado {
  return async (solicitud) => {
    const respuesta = await llamarPythonHappieGenerate({
      purpose,
      parts: solicitud.partes,
      systemInstruction: solicitud.instruccionSistema,
      responseJsonSchema: esquemaRaizParaGoogle(solicitud.jsonSchema),
      model: solicitud.modelo,
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      deadlineMs: DEADLINE_HAPPIE_MS,
      parentSignal: solicitud.signal,
    });
    const uso = respuesta.usage;
    return {
      texto: respuesta.text,
      uso: uso ? {
        promptTokenCount: uso.prompt_token_count,
        candidatesTokenCount: uso.candidates_token_count,
        thoughtsTokenCount: uso.thoughts_token_count,
        cachedContentTokenCount: uso.cached_content_token_count,
        toolUsePromptTokenCount: uso.tool_use_prompt_token_count,
      } : undefined,
    };
  };
}
