import { manejarRecomendacionWebhook } from "@/lib/happie/recomendar-paquetes-webhook";

/** Versión webhook (server-to-server, sin CORS) — hasta 3 recomendaciones. */
export async function POST(request: Request) {
  return manejarRecomendacionWebhook(request, 3);
}
