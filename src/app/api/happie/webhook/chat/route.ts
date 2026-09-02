import { manejarChatWebhook } from "@/lib/happie/conversacion-webhook";

/** Chat multi-turno server-to-server para una aplicación externa. */
export async function POST(request: Request) {
  return manejarChatWebhook(request);
}
