/**
 * FLUX.1 Kontext (pro / max) en fal, sin red: `fetch` simulado. Es el camino de «Foto realista» con el lugar «Igual al visor» (2026-10-09).
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-kontext.ts
 * - va a la cola de `flux-pro/kontext/max` (o `kontext` si es pro), con la imagen, la instrucción, la semilla y sin strength;
 * - devuelve la imagen que fal entrega, y un rechazo de fal es un error con su motivo;
 * - los precios (0,04 / 0,08) son los que usa el experimento y la interfaz.
 */
import assert from "node:assert/strict";

process.env.FAL_KEY = "clave-falsa-de-prueba";

type Pedido = { url: string; metodo: string; cuerpo: Record<string, unknown> | null };
const pedidos: Pedido[] = [];
let rechazar = false;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const metodo = init?.method ?? "GET";
  pedidos.push({ url, metodo, cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (metodo === "POST") {
    if (rechazar) return json({ detail: "imagen no valida" }, 422);
    return json({ request_id: "r1", status_url: `${url}/requests/r1/status`, response_url: `${url}/requests/r1` });
  }
  if (url.endsWith("/status")) return json({ status: "COMPLETED" });
  if (url.includes("/requests/r1")) return json({ images: [{ url: "https://v3b.fal.media/files/x.png", content_type: "image/png" }], seed: 7 });
  if (url.startsWith("https://v3b.fal.media/")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  return json({}, 404);
}) as typeof fetch;

async function main() {
  const { generarConFluxKontext, costeKontext } = await import("../../src/lib/ia/kagutsuchi/flux");
  const imagen = { base64: PNG.toString("base64"), mime: "image/jpeg", ancho: 1536, alto: 1024 };

  const max = await generarConFluxKontext("Turn this 3D layout render into a real photograph.", { imagen, variante: "max", seed: 11 });
  assert.equal(max.mime, "image/png");
  assert.equal(Buffer.from(max.base64, "base64").length, PNG.length);
  const envio = pedidos.find((p) => p.metodo === "POST")!;
  assert.equal(envio.url, "https://queue.fal.run/fal-ai/flux-pro/kontext/max");
  assert.equal(envio.cuerpo?.prompt, "Turn this 3D layout render into a real photograph.");
  assert.match(String(envio.cuerpo?.image_url), /^data:image\/jpeg;base64,/);
  assert.equal(envio.cuerpo?.seed, 11);
  assert.equal(envio.cuerpo?.num_images, 1);
  assert.equal("strength" in (envio.cuerpo ?? {}), false, "Kontext no lleva strength");
  assert.equal("aspect_ratio" in (envio.cuerpo ?? {}), false, "sin proporción pedida, la de la imagen");
  console.log("  ✓ max: cola de kontext/max con imagen, instrucción y semilla; devuelve la imagen de fal");

  pedidos.length = 0;
  await generarConFluxKontext("x", { imagen, variante: "pro", aspecto: "16:9" });
  const pro = pedidos.find((p) => p.metodo === "POST")!;
  assert.equal(pro.url, "https://queue.fal.run/fal-ai/flux-pro/kontext");
  assert.equal(pro.cuerpo?.aspect_ratio, "16:9");
  console.log("  ✓ pro: cola de kontext, con la proporción pedida");

  rechazar = true;
  await assert.rejects(generarConFluxKontext("x", { imagen, variante: "max" }), /rechazó la solicitud/);
  console.log("  ✓ un rechazo de fal es un error");

  assert.equal(costeKontext("pro"), 0.04);
  assert.equal(costeKontext("max"), 0.08);
  console.log("  ✓ precios 0,04 y 0,08\n\n4 pruebas ok");
}

main().catch((error) => { console.error(error); process.exit(1); });
