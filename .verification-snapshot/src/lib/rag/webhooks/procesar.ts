import type { Pool } from "pg";
import { mapaInventarioCDN, normalizarProducto } from "../catalog/normalize";
import { eliminarProducto, obtenerSourceUpdatedAt, upsertProducto } from "../catalog/persist";
import type { ProductoInventarioCDN, ProductoPublico } from "@/lib/shopify/tipos";

export type ResultadoWebhook =
  | { status: "duplicado" }
  | { status: "desactualizado" }
  | { status: "topic_no_soportado" }
  | { status: "rechazado"; motivo: string }
  | { status: "procesado"; accion: "creado_o_actualizado" | "eliminado" };

const TOPICS_PRODUCTO = new Set(["products/create", "products/update"]);

/**
 * Payload de Admin API: `tags` viene como string separado por comas, no como
 * array (a diferencia del JSON público que ya usa el import masivo). Se
 * normaliza aquí, antes de reusar la MISMA canonicalización de Fase 2 — dos
 * formas de entrada, un solo camino de normalización, cero lógica duplicada.
 */
function tagsComoArray(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * inventory_quantity puede venir directo en el payload del webhook si el
 * scope de la app lo incluye. Si no viene, se deja sin cruzar (null) — nunca
 * se inventa un número de inventario que no llegó.
 */
function mapaInventarioDesdePayload(payload: Record<string, unknown>): Map<string, number> {
  const variantes = Array.isArray(payload.variants) ? (payload.variants as Record<string, unknown>[]) : [];
  const productos: ProductoInventarioCDN[] = [
    {
      id: String(payload.id ?? ""),
      handle: String(payload.handle ?? ""),
      variants: variantes
        .filter((v) => typeof v.sku === "string" && typeof v.inventory_quantity === "number")
        .map((v) => ({
          sku: v.sku as string,
          inventoryQuantity: v.inventory_quantity as number,
          barcode: null,
        })),
    },
  ];
  return mapaInventarioCDN(productos);
}

async function marcarLog(
  pool: Pool,
  webhookId: string,
  status: string,
  detail: string | null,
): Promise<void> {
  await pool.query(
    "UPDATE catalog_webhook_log SET status = $2, detail = $3, processed_at = now() WHERE webhook_id = $1",
    [webhookId, status, detail],
  );
}

/**
 * Núcleo de Fase 5 — deliberadamente separado del route handler HTTP para
 * poder probarlo directo, sin servidor, con payloads sintéticos.
 */
export async function procesarWebhookShopify(
  pool: Pool,
  opts: { webhookId: string; topic: string; shopifyProductId: string | null; body: Record<string, unknown> },
): Promise<ResultadoWebhook> {
  // Deduplicación + idempotencia (plan §5.3/§5.4): INSERT ... ON CONFLICT DO
  // NOTHING es atómico — si Shopify reintenta la misma entrega (o dos llegan
  // a la vez), como mucho una gana la carrera y procesa; la otra ve 0 filas
  // devueltas y sale sin tocar nada más.
  const { rows } = await pool.query(
    `INSERT INTO catalog_webhook_log (webhook_id, topic, shopify_product_id, status)
     VALUES ($1, $2, $3, 'received')
     ON CONFLICT (webhook_id) DO NOTHING
     RETURNING webhook_id`,
    [opts.webhookId, opts.topic, opts.shopifyProductId],
  );
  if (rows.length === 0) return { status: "duplicado" };

  try {
    if (!TOPICS_PRODUCTO.has(opts.topic) && opts.topic !== "products/delete") {
      await marcarLog(pool, opts.webhookId, "ignored_unsupported_topic", null);
      return { status: "topic_no_soportado" };
    }

    if (opts.topic === "products/delete") {
      const id = opts.shopifyProductId ?? String(opts.body.id ?? "");
      await eliminarProducto(pool, id);
      await marcarLog(pool, opts.webhookId, "processed", "eliminado");
      return { status: "procesado", accion: "eliminado" };
    }

    // products/create | products/update
    const raw: ProductoPublico = {
      id: Number(opts.body.id),
      title: String(opts.body.title ?? ""),
      handle: String(opts.body.handle ?? ""),
      body_html: (opts.body.body_html as string | null) ?? null,
      product_type: (opts.body.product_type as string | null) ?? null,
      tags: tagsComoArray(opts.body.tags),
      variants: (opts.body.variants as ProductoPublico["variants"]) ?? [],
      images: (opts.body.images as ProductoPublico["images"]) ?? [],
      updated_at: (opts.body.updated_at as string | undefined) ?? undefined,
    };

    const resultado = normalizarProducto(raw, mapaInventarioDesdePayload(opts.body));
    if (!resultado.ok) {
      await pool.query(
        "INSERT INTO catalog_rejections (source_id, reason, raw_payload) VALUES ($1, $2, $3)",
        [resultado.rechazo.source_id, resultado.rechazo.reason, JSON.stringify(resultado.rechazo.raw_payload)],
      );
      await marcarLog(pool, opts.webhookId, "rejected", resultado.rechazo.reason);
      return { status: "rechazado", motivo: resultado.rechazo.reason };
    }

    // Fuera de orden (plan §5.5): Shopify no garantiza que los webhooks
    // lleguen en el orden en que ocurrieron los eventos. Si ya hay algo más
    // reciente guardado, este webhook llegó tarde — se descarta sin pisar.
    const anterior = await obtenerSourceUpdatedAt(pool, resultado.producto.product_id);
    // Comparación por instante real (Date.parse), NUNCA por string: dos
    // timestamps ISO con offsets de zona distintos pueden representar el
    // mismo instante y compararían mal como texto (ej. "-05:00" vs "+00:00").
    if (anterior && resultado.producto.source_updated_at) {
      const tsAnterior = Date.parse(anterior);
      const tsEntrante = Date.parse(resultado.producto.source_updated_at);
      if (!Number.isNaN(tsAnterior) && !Number.isNaN(tsEntrante) && tsEntrante <= tsAnterior) {
        await marcarLog(pool, opts.webhookId, "ignored_stale", `incoming=${resultado.producto.source_updated_at} stored=${anterior}`);
        return { status: "desactualizado" };
      }
    }

    await upsertProducto(pool, resultado.producto, resultado.variantes);
    await marcarLog(pool, opts.webhookId, "processed", "creado_o_actualizado");
    return { status: "procesado", accion: "creado_o_actualizado" };
  } catch (error) {
    await marcarLog(pool, opts.webhookId, "error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
