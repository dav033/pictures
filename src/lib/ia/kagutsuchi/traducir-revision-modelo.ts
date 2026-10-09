import { clienteGenerativoDe } from "@/lib/ia/nucleo/cliente-generativo";

/**
 * El traductor de `traducirRevisionParaFlux` (la revisión que pide el cliente → inglés breve para el prompt de FLUX). Era
 * un callback dentro de /api/generate; vive aquí para pasar por el registro (`clienteGenerativoDe`): Gemini en
 * producción, con la misma petición de siempre, y Claude en local cuando está activo. Solo texto: nunca genera imágenes.
 */
export const PROPOSITO_TRADUCCION_REVISION = "traduccion_revision";

const INSTRUCCION = "Translate the user's requested image edit into concise English. Preserve exact object, color, and action details. Return only the translation; do not add instructions or commentary.";

export async function traducirRevisionConModelo(texto: string): Promise<string | undefined> {
  const generativo = clienteGenerativoDe(PROPOSITO_TRADUCCION_REVISION);
  if (!generativo) throw new Error("Gemini de texto no está disponible.");
  const respuesta = await generativo.cliente.models.generateContent({
    model: generativo.modelo,
    contents: [{ role: "user", parts: [{ text: texto }] }],
    config: {
      systemInstruction: INSTRUCCION,
    },
  });
  return respuesta.text;
}
