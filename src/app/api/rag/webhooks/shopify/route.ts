import { getRagPool } from "@/lib/rag/db";
import { procesarWebhookShopify } from "@/lib/rag/webhooks/procesar";
import { verificarFirmaShopify } from "@/lib/rag/webhooks/verificar";

/**
 * Receptor de webhooks de Shopify (plan Fase 5). Para que Shopify realmente
 * mande algo aquí hace falta crear la suscripción del webhook desde el admin
 * de la tienda (o vía Admin API) apuntando a esta URL, y poner el secreto de
 * firma que Shopify entrega en SHOPIFY_WEBHOOK_SECRET — eso requiere acceso
 * al admin de la tienda real y no se puede hacer desde este repo.
 */
export async function POST(request: Request) {
  const secreto = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secreto) {
    return Response.json({ error: "SHOPIFY_WEBHOOK_SECRET no configurado" }, { status: 503 });
  }

  // Debe leerse como texto ANTES que nada más — la firma se calcula sobre
  // los bytes crudos, no sobre un JSON reserializado (ver verificar.ts).
  const cuerpoCrudo = await request.text();
  const firma = request.headers.get("x-shopify-hmac-sha256");

  if (!verificarFirmaShopify(cuerpoCrudo, firma, secreto)) {
    return Response.json({ error: "firma inválida" }, { status: 401 });
  }

  const webhookId = request.headers.get("x-shopify-webhook-id");
  const topic = request.headers.get("x-shopify-topic");
  if (!webhookId || !topic) {
    return Response.json({ error: "faltan encabezados X-Shopify-Webhook-Id / X-Shopify-Topic" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(cuerpoCrudo);
  } catch {
    return Response.json({ error: "body no es JSON válido" }, { status: 400 });
  }

  try {
    const resultado = await procesarWebhookShopify(getRagPool(), {
      webhookId,
      topic,
      shopifyProductId: body.id != null ? String(body.id) : null,
      body,
    });
    // Siempre 200 ante un resultado ya decidido (duplicado, desactualizado,
    // topic no soportado, rechazo de normalización): Shopify interpreta
    // cualquier no-2xx como "reintenta", y reintentar algo que ya se decidió
    // no cambiaría el resultado — solo generaría reintentos infinitos.
    return Response.json({ status: resultado.status });
  } catch (error) {
    // Error real (DB caída, etc.) — aquí SÍ conviene que Shopify reintente.
    // Fase 4.5: nunca el mensaje crudo del error (puede traer detalle de
    // conexión/consulta) — mismo criterio que ya aplican los webhooks de
    // Happie en webhook-control.ts. Se registra server-side para depurar.
    console.error("[shopify-webhook] error procesando webhook:", error);
    return Response.json({ error: "No se pudo procesar el webhook." }, { status: 500 });
  }
}
