import { CuerpoSolicitudSchema, generarRecomendacion } from "@/lib/happie/generar-recomendacion";
import { panelPruebaActivo, rechazoDePanel } from "@/lib/happie/panel-prueba";
import { ejecutarWebhook } from "@/lib/happie/webhook-control";
import { conRegistro } from "@/lib/registro/servidor";
import { HAPPIE_CONTRACT_VERSION, HappieErrorV1Schema } from "@/lib/ia/contracts/happie-v1";

/**
 * Panel de prueba (/happie/prueba): la misma lógica y los mismos controles que el webhook de recomendación (límite de
 * tasa, tope de body, plazo de 60 s, errores sobre contrato), pero autenticada con la sesión de la app para que la
 * API key del webhook nunca llegue al navegador. Cada llamada usa la IA.
 */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/happie/prueba-api/recomendar", atenderPOST, { vista: "happie" });

async function atenderPOST(request: Request) {
  if (!panelPruebaActivo()) {
    return Response.json(HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error: "No disponible." }), { status: 404 });
  }
  return ejecutarWebhook(request, "panel-prueba", rechazoDePanel(request, { mutacion: true }), CuerpoSolicitudSchema, (acotada) =>
    generarRecomendacion(acotada, 3),
  );
}
