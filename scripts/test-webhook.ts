import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { procesarWebhookShopify } from "../src/lib/rag/webhooks/procesar";
import { verificarFirmaShopify } from "../src/lib/rag/webhooks/verificar";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

const SECRETO = "secreto-de-prueba";
const PRODUCT_ID = "999911000001"; // id claramente ficticio, no colisiona con catálogo real
const PEER_PRODUCT_ID = "999911000002";

function firmar(cuerpo: string, secreto: string): string {
  return createHmac("sha256", secreto).update(cuerpo, "utf8").digest("base64");
}

function payloadProducto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: Number(PRODUCT_ID),
    title: "Producto de Prueba Webhook",
    handle: "producto-de-prueba-webhook-999911",
    body_html: "<p>Solo para test-webhook.ts</p>",
    product_type: "Látex",
    tags: "TEST, WEBHOOK", // Admin API: string separado por comas, no array
    updated_at: "2026-01-01T10:00:00-05:00",
    variants: [
      { id: 8888811, title: "R-12 Rojo", option1: "R-12", price: "10000", available: true, grams: 5, sku: "B2B-TEST-WEBHOOK-1" },
    ],
    images: [],
    ...overrides,
  };
}

async function limpiar(pool: Pool) {
  await pool.query("DELETE FROM catalog_products WHERE product_id = ANY($1::text[])", [[PRODUCT_ID, PEER_PRODUCT_ID]]);
  await pool.query("DELETE FROM catalog_webhook_log WHERE shopify_product_id = ANY($1::text[])", [[PRODUCT_ID, PEER_PRODUCT_ID]]);
  await pool.query("DELETE FROM catalog_rejections WHERE source_id = ANY($1::text[])", [[PRODUCT_ID, PEER_PRODUCT_ID]]);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let fallos = 0;
  const reportar = (ok: boolean, nombre: string, detalle: string) => {
    console.log(`[${ok ? "PASS" : "FAIL"}] ${nombre} — ${detalle}`);
    if (!ok) fallos++;
  };

  try {
    await limpiar(pool);

    // --- HMAC ---
    const cuerpo = JSON.stringify(payloadProducto());
    const firmaValida = firmar(cuerpo, SECRETO);
    reportar(verificarFirmaShopify(cuerpo, firmaValida, SECRETO), "HMAC: firma válida aceptada", "");
    reportar(!verificarFirmaShopify(cuerpo, firmaValida, "otro-secreto"), "HMAC: secreto incorrecto rechazado", "");
    reportar(!verificarFirmaShopify(cuerpo + "x", firmaValida, SECRETO), "HMAC: cuerpo alterado invalida la firma", "");
    reportar(!verificarFirmaShopify(cuerpo, null, SECRETO), "HMAC: sin header de firma rechazado", "");
    reportar(!verificarFirmaShopify(cuerpo, "firma-basura-corta", SECRETO), "HMAC: firma malformada rechazada", "");

    // --- products/create ---
    const r1 = await procesarWebhookShopify(pool, {
      webhookId: "wh-1",
      topic: "products/create",
      shopifyProductId: PRODUCT_ID,
      body: payloadProducto(),
    });
    reportar(r1.status === "procesado", "products/create se procesa", JSON.stringify(r1));
    const { rows: creado } = await pool.query("SELECT title, source_updated_at FROM catalog_products WHERE product_id = $1", [PRODUCT_ID]);
    reportar(creado[0]?.title === "Producto De Prueba Webhook", "producto quedó persistido con el título correcto", JSON.stringify(creado[0]));
    const { rows: varianteCreada } = await pool.query(
      `SELECT sku_original, sku_canonical, sku_ambiguous, derived_colors, source_variant_id,
              unidades_paq, unidades_inferidas
         FROM catalog_variants WHERE product_id = $1`,
      [PRODUCT_ID],
    );
    reportar(
      varianteCreada[0]?.sku_original === "B2B-TEST-WEBHOOK-1" &&
        varianteCreada[0]?.sku_canonical === "TEST-WEBHOOK-1" &&
        varianteCreada[0]?.sku_ambiguous === false &&
        JSON.stringify(varianteCreada[0]?.derived_colors) === JSON.stringify(["rojo"]) &&
        varianteCreada[0]?.source_variant_id === "8888811" &&
        varianteCreada[0]?.unidades_paq == null &&
        varianteCreada[0]?.unidades_inferidas === true,
      "legacy writer conserva SKU v2, color same-variant y provenance",
      JSON.stringify(varianteCreada[0]),
    );

    // A second product with the same canonical SKU exercises global collision
    // recomputation; removing the source SKU must clear only this side.
    const peer = await procesarWebhookShopify(pool, {
      webhookId: "wh-peer",
      topic: "products/create",
      shopifyProductId: PEER_PRODUCT_ID,
      body: payloadProducto({
        id: Number(PEER_PRODUCT_ID),
        handle: "producto-de-prueba-webhook-peer-999911",
        variants: [{ id: 8888812, title: "R-12 Rojo", option1: "R-12", price: "11000", available: true, grams: 5, sku: "TEST-WEBHOOK-1" }],
      }),
    });
    reportar(peer.status === "procesado", "producto peer para colisión SKU se procesa", JSON.stringify(peer));
    const collision = await pool.query<{ sku_ambiguous: boolean }>(
      "SELECT sku_ambiguous FROM catalog_variants WHERE variant_id = ANY($1::text[]) ORDER BY variant_id",
      [["8888811", "8888812"]],
    );
    reportar(collision.rows.length === 2 && collision.rows.every((row) => row.sku_ambiguous), "colisión SKU global marca ambos variants como ambiguous", JSON.stringify(collision.rows));

    const skuRemoved = await procesarWebhookShopify(pool, {
      webhookId: "wh-sku-clear",
      topic: "products/update",
      shopifyProductId: PRODUCT_ID,
      body: payloadProducto({
        updated_at: "2026-05-01T10:00:00-05:00",
        variants: [{ id: 8888811, title: "R-12 Rojo", option1: "R-12", price: "10000", available: true, grams: 5, sku: null }],
      }),
    });
    reportar(skuRemoved.status === "procesado", "update que elimina SKU se procesa", JSON.stringify(skuRemoved));
    const afterSkuRemoval = await pool.query<{ sku_original: string | null; sku_canonical: string | null; sku_ambiguous: boolean }>(
      `SELECT sku_original, sku_canonical, sku_ambiguous
         FROM catalog_variants WHERE variant_id = ANY($1::text[])
        ORDER BY variant_id`,
      [["8888811", "8888812"]],
    );
    reportar(
      afterSkuRemoval.rows.length === 2 &&
        afterSkuRemoval.rows[0].sku_original == null &&
        afterSkuRemoval.rows[0].sku_canonical == null &&
        afterSkuRemoval.rows[0].sku_ambiguous === false &&
        afterSkuRemoval.rows[1].sku_canonical === "TEST-WEBHOOK-1" &&
        afterSkuRemoval.rows[1].sku_ambiguous === false,
      "quitar SKU limpia su metadata y recalcula el peer sin falsa ambigüedad",
      JSON.stringify(afterSkuRemoval.rows),
    );

    // --- idempotencia: mismo webhook_id reenviado ---
    const r2 = await procesarWebhookShopify(pool, {
      webhookId: "wh-1", // MISMO id
      topic: "products/create",
      shopifyProductId: PRODUCT_ID,
      body: payloadProducto({ title: "Este título nunca debería aplicarse" }),
    });
    reportar(r2.status === "duplicado", "webhook_id repetido se ignora (idempotencia)", JSON.stringify(r2));
    const { rows: trasReplay } = await pool.query("SELECT title FROM catalog_products WHERE product_id = $1", [PRODUCT_ID]);
    reportar(
      trasReplay[0]?.title === "Producto De Prueba Webhook",
      "el replay NO modificó el producto",
      JSON.stringify(trasReplay[0]),
    );

    // --- fuera de orden: update con updated_at MÁS VIEJO que el guardado ---
    const r3 = await procesarWebhookShopify(pool, {
      webhookId: "wh-2",
      topic: "products/update",
      shopifyProductId: PRODUCT_ID,
      body: payloadProducto({ title: "Título viejo que no debe aplicarse", updated_at: "2025-01-01T10:00:00-05:00" }),
    });
    reportar(r3.status === "desactualizado", "webhook con updated_at más viejo se descarta", JSON.stringify(r3));
    const { rows: trasViejo } = await pool.query("SELECT title FROM catalog_products WHERE product_id = $1", [PRODUCT_ID]);
    reportar(trasViejo[0]?.title === "Producto De Prueba Webhook", "el update viejo NO pisó el dato más reciente", JSON.stringify(trasViejo[0]));

    // --- update real con updated_at MÁS NUEVO ---
    const r4 = await procesarWebhookShopify(pool, {
      webhookId: "wh-3",
      topic: "products/update",
      shopifyProductId: PRODUCT_ID,
      body: payloadProducto({
        title: "Título Actualizado",
        updated_at: "2026-06-01T10:00:00-05:00",
        variants: [{ id: 8888811, title: "R-12 Rojo / PAQUETE X 12", option1: "R-12", option2: null, price: "10000", available: true, grams: 5, sku: "B2B-TEST-WEBHOOK-1" }],
      }),
    });
    reportar(r4.status === "procesado", "update con updated_at más nuevo se aplica", JSON.stringify(r4));
    const { rows: trasNuevo } = await pool.query("SELECT title FROM catalog_products WHERE product_id = $1", [PRODUCT_ID]);
    reportar(trasNuevo[0]?.title === "Título Actualizado", "el título sí se actualizó", JSON.stringify(trasNuevo[0]));
    const { rows: unidadesNuevas } = await pool.query<{ unidades_paq: number | null; unidades_inferidas: boolean }>(
      "SELECT unidades_paq, unidades_inferidas FROM catalog_variants WHERE variant_id = $1",
      ["8888811"],
    );
    reportar(
      unidadesNuevas[0]?.unidades_paq === 12 && unidadesNuevas[0]?.unidades_inferidas === false,
      "update webhook deriva y persiste unidades PAQUETE X N",
      JSON.stringify(unidadesNuevas[0]),
    );

    // --- topic no soportado ---
    const r5 = await procesarWebhookShopify(pool, {
      webhookId: "wh-4",
      topic: "inventory_levels/update",
      shopifyProductId: PRODUCT_ID,
      body: { id: PRODUCT_ID },
    });
    reportar(r5.status === "topic_no_soportado", "topic sin manejador declarado explícitamente (no silencioso)", JSON.stringify(r5));

    // --- producto malformado (sin título) → rechazo con motivo, no crash ---
    const r6 = await procesarWebhookShopify(pool, {
      webhookId: "wh-5",
      topic: "products/update",
      shopifyProductId: PRODUCT_ID,
      body: payloadProducto({ title: "", updated_at: "2026-12-01T10:00:00-05:00" }),
    });
    reportar(r6.status === "rechazado", "producto sin título se rechaza con motivo, no crashea", JSON.stringify(r6));

    // --- products/delete ---
    const r7 = await procesarWebhookShopify(pool, {
      webhookId: "wh-6",
      topic: "products/delete",
      shopifyProductId: PRODUCT_ID,
      body: { id: Number(PRODUCT_ID) },
    });
    reportar(r7.status === "procesado", "products/delete se procesa", JSON.stringify(r7));
    const { rows: trasDelete } = await pool.query("SELECT 1 FROM catalog_products WHERE product_id = $1", [PRODUCT_ID]);
    reportar(trasDelete.length === 0, "producto eliminado de la DB", `filas restantes=${trasDelete.length}`);

    console.log(`\n${fallos === 0 ? "[PASS]" : "[FAIL]"} ${fallos} test(s) fallido(s).`);
    process.exitCode = fallos === 0 ? 0 : 1;
  } finally {
    await limpiar(pool);
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] suite de webhooks falló:", error);
  process.exitCode = 1;
});
