import { manejarRecomendacionWebhook } from "@/lib/happie/recomendar-paquetes-webhook";

/** Versión webhook (server-to-server, sin CORS) — exactamente 1 recomendación. */
export async function POST(request: Request) {
  return manejarRecomendacionWebhook(request, 1);
}
