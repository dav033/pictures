import type { z } from "zod";
import { errorFeedback } from "./acceso";

export type Leido<T> = { valor: T } | { respuesta: Response };

function detalleDe(error: z.ZodError): string[] {
  return error.issues.slice(0, 5).map((incidencia) => `${incidencia.path.join(".") || "(raíz)"}: ${incidencia.message}`);
}

export function validar<T>(esquema: z.ZodType<T>, entrada: unknown, mensaje: string): Leido<T> {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) return { valor: resultado.data };
  return { respuesta: errorFeedback("CUERPO_INVALIDO", mensaje, 400, detalleDe(resultado.error)) };
}

/** Lee un cuerpo JSON respetando un tope de bytes (por la cabecera y por el texto realmente recibido) y lo valida. */
export async function leerJsonValidado<T>(request: Request, esquema: z.ZodType<T>, maxBytes: number): Promise<Leido<T>> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maxBytes) {
    return { respuesta: errorFeedback("CUERPO_DEMASIADO_GRANDE", `El cuerpo supera ${maxBytes} bytes.`, 413) };
  }
  let texto: string;
  try {
    texto = await request.text();
  } catch {
    return { respuesta: errorFeedback("CUERPO_INVALIDO", "No se pudo leer el cuerpo.", 400) };
  }
  if (Buffer.byteLength(texto, "utf8") > maxBytes) {
    return { respuesta: errorFeedback("CUERPO_DEMASIADO_GRANDE", `El cuerpo supera ${maxBytes} bytes.`, 413) };
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { respuesta: errorFeedback("CUERPO_INVALIDO", "El cuerpo debe ser JSON válido.", 400) };
  }
  return validar(esquema, json, "Feedback inválido.");
}
