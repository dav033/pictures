import { manejarChatWebhook } from "@/lib/happie/conversacion-webhook";
import { conRegistro } from "@/lib/registro/servidor";

/** Chat multi-turno server-to-server para una aplicación externa. */
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/happie/webhook/chat", atenderPOST, { vista: "happie" });

async function atenderPOST(request: Request) {
  return manejarChatWebhook(request);
}
