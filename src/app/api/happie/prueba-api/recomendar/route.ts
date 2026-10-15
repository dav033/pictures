import { generarRecomendacion } from "@/lib/happie/generar-recomendacion";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { conRegistro } from "@/lib/registro/servidor";

/**
 * Panel de prueba (/happie/prueba): la misma lógica que el webhook de recomendación, pero autenticada con la sesión
 * de la app para que la API key del webhook nunca llegue al navegador. Cada llamada usa la IA.
 */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/happie/prueba-api/recomendar", atenderPOST, { vista: "happie" });

async function atenderPOST(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const { status, body } = await generarRecomendacion(request, 3);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
