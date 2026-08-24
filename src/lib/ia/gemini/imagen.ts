import { getGeminiClient, MODELO_IMAGEN } from "@/lib/gemini";
import { ErrorIA } from "../tipos";
import type { Imagen, ImageInput, ImagenPort, PeticionImagen } from "../tipos";

type EntradaGemini =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string };

type RespuestaGemini = {
  id?: string;
  output_image?: { data?: string };
  steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }>;
};

function extraerImagen(respuesta: unknown): string | undefined {
  const datos = respuesta as RespuestaGemini;
  if (datos.output_image?.data) return datos.output_image.data;
  for (const paso of datos.steps ?? []) {
    for (const bloque of paso.content ?? []) {
      if (bloque.type === "image" && bloque.data) return bloque.data;
    }
  }
  return undefined;
}

function categorizarError(error: unknown): ErrorIA {
  const mensaje = error instanceof Error ? error.message : "Error desconocido";
  const m = mensaje.toLowerCase();
  if (m.includes("api key") || m.includes("permission"))
    return new ErrorIA("sin_llave", "gemini", mensaje, false);
  if (m.includes("quota") || m.includes("429")) return new ErrorIA("cuota", "gemini", mensaje, true);
  if (m.includes("safety") || m.includes("blocked")) return new ErrorIA("filtrado", "gemini", mensaje, false);
  if (m.includes("timeout")) return new ErrorIA("timeout", "gemini", mensaje, true);
  return new ErrorIA("desconocido", "gemini", mensaje, true);
}

export function crearImagenGemini(): ImagenPort {
  return {
    id: "gemini",
    modelo: MODELO_IMAGEN,
    capabilities: {
      exactAspectRatios: ["3:2", "1:1", "2:3", "16:9"],
      totalInputImageLimit: 14,
      objectFidelityInputLimit: 5,
      highFidelityInputSupport: true,
      multiTurnSupport: true,
    },
    maxReferencias: 13,

    async generar(p: PeticionImagen) {
      const client = getGeminiClient();
      if (!client) throw new ErrorIA("sin_llave", "gemini", "No hay GEMINI_API_KEY configurada.", false);

      // Cada grupo de imágenes va precedido de su propia etiqueta de texto:
      // sin esto, el modelo recibe un array anónimo de imágenes y no tiene
      // forma de saber cuál es la foto real del espacio, cuál es un producto
      // que debe verse tal cual, y cuál es solo una referencia de estilo que
      // no debe copiarse literal (comprobado: sin etiquetar, una referencia
      // de color no tenía ningún efecto visible en el resultado).
      const input: EntradaGemini[] = [{ type: "text", text: p.prompt }];
      for (const ref of seleccionarInputs(p)) {
        input.push({
          type: "text",
          // Identifiers are server-side bookkeeping. Passing strings such as
          // IMAGE_ID=CATALOG_* to the image model makes them eligible for
          // transcription, so describe the role without exposing the token.
          text: `Reference image role: ${ref.role}. Allowed use: ${ref.allowed_use}. This description is invisible metadata; do not render any text, label, logo, or identifier from it. ${ref.descripcion}`,
        });
        input.push({ type: "image", data: ref.base64, mime_type: ref.mime });
      }

      const inicio = Date.now();
      try {
        const respuesta = await client.interactions.create({
          model: MODELO_IMAGEN,
          input,
          // `store` + `previous_interaction_id` encadenan de verdad esta
          // llamada con la anterior en la misma revisión — antes la única
          // "continuidad" era reenviar la imagen previa como una referencia
          // más con etiqueta de texto; esto le da al modelo memoria real de
          // qué hizo, no solo el resultado final sin el razonamiento.
          store: true,
          ...(p.previousInteractionId ? { previous_interaction_id: p.previousInteractionId } : {}),
          response_format: {
            type: "image",
            mime_type: "image/jpeg",
            aspect_ratio: p.aspecto,
            image_size: p.calidad === "alta" ? "2K" : "1K",
          },
        });

        const b64 = extraerImagen(respuesta);
        if (!b64) throw new Error("Gemini no devolvió imagen.");

        const imagen: Imagen = { base64: b64, mime: "image/jpeg" };
        return { imagen, modelo: MODELO_IMAGEN, ms: Date.now() - inicio, interactionId: (respuesta as RespuestaGemini).id };
      } catch (error) {
        throw categorizarError(error);
      }
    },
  };
}

function seleccionarInputs(p: PeticionImagen): ImageInput[] {
  return p.inputs.slice(0, 14);
}
