import "server-only";
import { MODELO_IMAGEN } from "@/lib/gemini";
import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import type { Imagen, ImageInput, ImagenPort, PeticionImagen } from "@/lib/ia/nucleo/tipos";
import { bytesDeBase64 } from "@sempertex/agente-core";
import { idsTelemetria, registrarGemini, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import { errorIADeTransportePython } from "@/lib/ia/nucleo/error-ia-python";
import {
  isPythonAdapterError,
  llamarPythonImageGenerate,
  type PythonImageGenerateInputBlock,
} from "@/lib/ia/nucleo/python-adapter";

/**
 * Maps a failed Python call to the same `ErrorIA` causas the direct Gemini
 * adapter reports (`categorizarError` in imagen.ts). The transport-level
 * `PythonAdapterErrorCode` only tells us "some 5xx/4xx happened"; the actual
 * classification (sin_llave/cuota/filtrado/timeout) travels as `domainCode`,
 * set by `_classify_error` in `app/uzume/interaction.py`.
 */
const CAUSA_POR_DOMAIN_CODE: Readonly<Record<string, ErrorIA["causa"]>> = {
  image_generate_unavailable: "sin_llave",
  image_generate_quota: "cuota",
  image_generate_filtered: "filtrado",
  image_generate_timeout: "timeout",
};

/** Exported for tests (imagen-python.test.ts); not used outside this module otherwise. */
export function errorIADeAdaptador(error: unknown): ErrorIA {
  const causa = isPythonAdapterError(error) && error.domainCode ? CAUSA_POR_DOMAIN_CODE[error.domainCode] : undefined;
  if (causa && isPythonAdapterError(error)) return new ErrorIA(causa, "gemini", error.message, error.retryable);
  return errorIADeTransportePython(error);
}

function seleccionarInputs(p: PeticionImagen): ImageInput[] {
  return p.inputs.slice(0, 14);
}

/**
 * Same labeling as `crearImagenGemini`'s `generar()` in imagen.ts: each
 * reference image is preceded by its own role/allowed_use text block so the
 * model can tell a real venue photo from a product that must look exact from
 * a style-only reference -- Python never sees or decides this, it only
 * forwards the array TypeScript already built.
 */
/** Exported for tests (imagen-python.test.ts); not used outside this module otherwise. */
export function construirInput(p: PeticionImagen): PythonImageGenerateInputBlock[] {
  const input: PythonImageGenerateInputBlock[] = [{ type: "text", text: p.prompt }];
  for (const ref of seleccionarInputs(p)) {
    input.push({
      type: "text",
      text: `Reference image role: ${ref.role}. Allowed use: ${ref.allowed_use}. This description is invisible metadata; do not render any text, label, logo, or identifier from it. ${ref.descripcion}`,
    });
    input.push({ type: "image", data: ref.base64, mimeType: ref.mime as "image/png" | "image/jpeg" | "image/webp" });
  }
  return input;
}

/**
 * `ImagenPort` respaldado por la llamada de Interactions que corre en Python
 * (docs/architecture/decisions/0026, Fase 3). Misma forma pública que
 * `crearImagenGemini` -- el resto de la app no nota la diferencia.
 */
export function crearImagenGeminiPython(): ImagenPort {
  const modelo = MODELO_IMAGEN;
  return {
    id: "gemini",
    modelo,
    capabilities: {
      exactAspectRatios: ["3:2", "1:1", "2:3", "16:9"],
      totalInputImageLimit: 14,
      objectFidelityInputLimit: 5,
      highFidelityInputSupport: true,
      multiTurnSupport: true,
    },
    maxReferencias: 13,

    async generar(p: PeticionImagen) {
      const { requestId, correlationId } = idsTelemetria(p.telemetria);
      const bytesImagenEntrada = p.inputs.reduce((total, image) => total + bytesDeBase64(image.base64), 0);
      const inicio = Date.now();
      try {
        const respuesta = await llamarPythonImageGenerate({
          model: modelo,
          input: construirInput(p),
          ...(p.previousInteractionId ? { previousInteractionId: p.previousInteractionId } : {}),
          aspectRatio: p.aspecto,
          imageSize: p.calidad === "alta" ? "2K" : "1K",
          requestId,
          correlationId,
          parentSignal: p.signal,
        });
        const imagen: Imagen = { base64: respuesta.imageBase64, mime: "image/jpeg" };
        registrarGemini({
          flujo: "generador_imagen",
          capacidad: p.telemetria?.capacidad ?? "imagen_generacion",
          modelo: respuesta.model,
          inicio,
          resultado: "ok",
          contexto: { superficie: "/api/generate", ...p.telemetria },
          usage: respuesta.usage ? {
            promptTokenCount: respuesta.usage.total_input_tokens,
            candidatesTokenCount: respuesta.usage.total_output_tokens,
            thoughtsTokenCount: respuesta.usage.total_thought_tokens,
            cachedContentTokenCount: respuesta.usage.total_cached_tokens,
            toolUsePromptTokenCount: respuesta.usage.total_tool_use_tokens,
          } : undefined,
          bytesImagenEntrada,
        });
        return { imagen, modelo: respuesta.model, ms: Date.now() - inicio, interactionId: respuesta.interactionId ?? undefined };
      } catch (error) {
        registrarGemini({
          flujo: "generador_imagen",
          capacidad: p.telemetria?.capacidad ?? "imagen_generacion",
          modelo,
          inicio,
          resultado: isPythonAdapterError(error) ? resultadoTelemetria(error) : "error",
          contexto: { superficie: "/api/generate", ...p.telemetria },
          bytesImagenEntrada,
        });
        throw errorIADeAdaptador(error);
      }
    },
  };
}
