import { z } from "zod";
import { conRegistro } from "@/lib/registro/servidor";
import { ErrorInterpretacion, MAX_PEDIDO, interpretarPedido } from "@/lib/modulos-estudio/interpretar-ia";

/**
 * Estudio de módulos, US-2: «un dúo de reflex rojo con azul mate» → la configuración (tipo, tamaño y un código del catálogo
 * por globo). Gemini Flash solo separa las palabras (texto → JSON); los códigos salen del catálogo y lo que no existe se
 * devuelve en `desconocidos`. No genera ninguna imagen ni toca el caché. La sesión la exige el proxy de la app.
 */
const CuerpoSchema = z.object({ texto: z.string().min(1).max(MAX_PEDIDO) }).strict();

export const POST = conRegistro("/api/modulos-interpretar", atenderPOST, { vista: "3d" });

async function atenderPOST(request: Request) {
  let cuerpo: unknown;
  try { cuerpo = await request.json(); } catch { return Response.json({ error: "El pedido no llegó en un formato válido." }, { status: 400 }); }
  const leido = CuerpoSchema.safeParse(cuerpo);
  if (!leido.success) return Response.json({ error: `Escribe el pedido en pocas palabras (hasta ${MAX_PEDIDO} caracteres).` }, { status: 400 });
  try {
    const resultado = await interpretarPedido(leido.data.texto, { signal: request.signal });
    return Response.json(resultado.ok
      ? { ok: true, tipo: resultado.config.tipo, formatoId: resultado.config.formatoId, colores: resultado.config.colores, avisos: resultado.avisos }
      : { ok: false, errores: resultado.errores, desconocidos: resultado.desconocidos, avisos: resultado.avisos });
  } catch (error) {
    if (error instanceof ErrorInterpretacion && error.causa === "sin_ia") return Response.json({ error: "La interpretación por texto no está disponible en este servidor." }, { status: 503 });
    return Response.json({ error: "No pude interpretar el pedido ahora. Elige el módulo y los colores a mano." }, { status: 502 });
  }
}
