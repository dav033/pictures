import assert from "node:assert/strict";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { CATALOGO_ERRORES_UI_V1, UiErrorCodeV1Schema } from "../../src/lib/ia/contracts/ui-error-v1";
import { clasificarErrorServidor, traducirErrorServidor } from "../../src/lib/errores-ui/traducir-error-servidor";
import { generarConSempertexLora, ProveedorImagenNoDisponibleError, type LoraApplication } from "../../src/lib/ia/kagutsuchi/sempertex-lora";

/**
 * fal.ai without balance answers the queue submission with 403 ("User is
 * locked. Reason: Exhausted balance"). It used to reach the customer as
 * ERROR_INTERNO "Intenta de nuevo" with retryable true, so the page offered a
 * retry that could never work. The proposal and its price are already saved, so
 * the customer must get a clear, non-retryable message instead.
 * Deterministic, no network: fetch is simulated.
 * Run: npx tsx --conditions=react-server scripts/test/test-fal-sin-saldo.ts
 */

configurarPersistenciaTelemetria(undefined);

const LORA: LoraApplication = { artifactId: "debug-artifact", specialization: "structure", path: "https://example.invalid/debug-lora.safetensors", trigger: "eventdecor_style_v2", scale: 0.8 };
const MENSAJE = "La vista previa de la imagen no está disponible por ahora. Tu propuesta y su precio quedan guardados.";

async function falConRespuesta(status: number, cuerpo: unknown): Promise<{ error: unknown; llamadas: number }> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-key-never-sent";
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas += 1;
    return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await generarConSempertexLora("eventdecor_style_v2, a balloon arch", "3:2", [], { loras: [LORA] });
    return { error: undefined, llamadas };
  } catch (error) {
    return { error, llamadas };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalKey;
  }
}

async function main(): Promise<void> {
  // 1. The catalog entry is stable, clear and non-retryable.
  assert.ok(UiErrorCodeV1Schema.options.includes("VISTA_PREVIA_NO_DISPONIBLE"), "stable ui-error code");
  const entrada = CATALOGO_ERRORES_UI_V1.VISTA_PREVIA_NO_DISPONIBLE;
  assert.equal(entrada.mensaje_usuario, MENSAJE);
  assert.equal(entrada.retryable, false);
  assert.equal(entrada.accion_sugerida, null, "retrying cannot fix an exhausted balance");
  console.log("[PASS] ui-error: VISTA_PREVIA_NO_DISPONIBLE no reintentable con mensaje claro");

  // 2. 403 without balance: typed provider error, one call, no retry.
  const sinSaldo = await falConRespuesta(403, { detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." });
  assert.ok(sinSaldo.error instanceof ProveedorImagenNoDisponibleError, `typed error, got ${String(sinSaldo.error)}`);
  assert.equal(sinSaldo.error.causa, "saldo_agotado");
  assert.equal(sinSaldo.error.status, 403);
  assert.equal(sinSaldo.llamadas, 1, "the adapter does not retry a rejected submission");
  const ui = traducirErrorServidor(sinSaldo.error, "00000000-0000-4000-8000-000000000001");
  assert.equal(ui.code, "VISTA_PREVIA_NO_DISPONIBLE");
  assert.equal(ui.retryable, false);
  assert.equal(ui.mensaje_usuario, MENSAJE);
  assert.equal(ui.accion_sugerida, null);
  assert.equal(ui.detalles_dev.causa, "saldo_agotado");
  assert.doesNotMatch(ui.mensaje_usuario, /fal|403|saldo|balance/i, "no provider detail reaches the customer");
  console.log("[PASS] fal 403 sin saldo → VISTA_PREVIA_NO_DISPONIBLE, retryable false");

  // 3. Other access rejections (402 payment required, 401 bad key) are not retryable either.
  for (const [status, causa] of [[402, "saldo_agotado"], [401, "acceso_denegado"], [403, "acceso_denegado"]] as const) {
    const resultado = await falConRespuesta(status, status === 402 ? { detail: "Payment required" } : { detail: "Forbidden" });
    assert.ok(resultado.error instanceof ProveedorImagenNoDisponibleError, `${status}: typed error`);
    assert.equal(resultado.error.causa, causa, `${status}: cause`);
    assert.equal(clasificarErrorServidor(resultado.error).code, "VISTA_PREVIA_NO_DISPONIBLE");
  }
  console.log("[PASS] fal 401/402/403 → no reintentable");

  // 4. A transient provider failure keeps its previous classification.
  const caida = await falConRespuesta(503, { detail: "Service Unavailable" });
  assert.ok(caida.error instanceof Error && !(caida.error instanceof ProveedorImagenNoDisponibleError), "503 is not an access rejection");
  assert.notEqual(clasificarErrorServidor(caida.error).code, "VISTA_PREVIA_NO_DISPONIBLE");
  console.log("[PASS] fal 503 no se confunde con falta de saldo");
}

main().catch((error: unknown) => {
  console.error("[FAIL] fal sin saldo", error);
  process.exitCode = 1;
});
