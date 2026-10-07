import { manejarRecomendacionWebhook } from "@/lib/happie/recomendar-paquetes-webhook";
import { conRegistro } from "@/lib/registro/servidor";

/** Versión webhook (server-to-server, sin CORS) — hasta 3 recomendaciones. */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/happie/webhook/recommend-packages", atenderPOST, { vista: "happie" });

async function atenderPOST(request: Request) {
  return manejarRecomendacionWebhook(request, 3);
}
