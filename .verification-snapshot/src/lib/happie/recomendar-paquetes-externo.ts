import { apiKeyValida, conEncabezadosCors, encabezadosCors } from "./cors-externo";
import { generarRecomendacion } from "./generar-recomendacion";

/**
 * Handler para el consumidor desde navegador (`recommend-packages` y
 * `recommend-package`): valida la API key de navegador, delega la lógica en
 * `generarRecomendacion` y agrega los headers CORS a la respuesta. No pasa
 * por la cookie de sesión de la app (ver `proxy.ts`).
 */
export async function manejarRecomendacionExterna(
  request: Request,
  maxRecomendaciones: number,
): Promise<Response> {
  const cors = encabezadosCors(request);

  if (!apiKeyValida(request)) {
    return conEncabezadosCors(Response.json({ error: "API key inválida o ausente." }, { status: 401 }), cors);
  }

  const { status, body } = await generarRecomendacion(request, maxRecomendaciones);
  return conEncabezadosCors(Response.json(body, { status }), cors);
}
