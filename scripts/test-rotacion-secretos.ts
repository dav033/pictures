import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sessionToken } from "../src/lib/auth/session";
import { compararEnTiempoConstante } from "../src/lib/seguridad/comparar-constante";
import { crearTokenAprobacion, verificarTokenAprobacion } from "../src/lib/plan/aprobacion";
import { verificarFirmaShopify } from "../src/lib/rag/webhooks/verificar";
import { apiKeyValida } from "../src/lib/happie/cors-externo";
import { autenticarWebhook } from "../src/lib/happie/recomendar-paquetes-webhook";

/**
 * Fase 4.4 — procedimiento de rotación PROBADO (no solo escrito) para los 5
 * secretos que esta app controla por completo, sin depender de ninguna
 * cuenta de proveedor externo. Cada caso manipula `process.env` en memoria
 * (nunca toca `.env.local` ni reinicia ningún servidor) para probar el ciclo
 * completo: valor viejo funciona -> se rota -> valor viejo deja de servir,
 * valor nuevo funciona. Los otros 4 secretos (GEMINI_API_KEY, FAL_KEY,
 * HAPPIA_API_KEY, DATABASE_URL) necesitan generar una credencial nueva en la
 * consola del proveedor antes de poder probarse — quedan fuera de este
 * script, documentados aparte en el runbook.
 */

function conEnv<T>(clave: string, valor: string | undefined, fn: () => T): T {
  const anterior = process.env[clave];
  if (valor === undefined) delete process.env[clave];
  else process.env[clave] = valor;
  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env[clave];
    else process.env[clave] = anterior;
  }
}

function probarAppPassword(): void {
  const viejo = "contrasena-vieja-de-prueba";
  const nuevo = "contrasena-nueva-de-prueba-distinta";
  // La cookie de sesión es sha256(password) (src/lib/auth/session.ts) — al
  // rotar, el token derivado cambia, así que CUALQUIER cookie emitida con el
  // valor viejo deja de coincidir con `sessionToken(APP_PASSWORD actual)`
  // que usan proxy.ts y login/route.ts. No hace falta revocación aparte.
  const cookieVieja = sessionToken(viejo);
  const cookieNueva = sessionToken(nuevo);
  assert.notEqual(cookieVieja, cookieNueva, "rotar APP_PASSWORD debe invalidar automáticamente la cookie vieja");
  assert.equal(cookieVieja, sessionToken(viejo), "la misma contraseña siempre deriva la misma cookie (determinismo)");
  console.log("[PASS] APP_PASSWORD: rotar invalida automáticamente toda cookie emitida con el valor anterior");
}

function probarPlanApprovalSecret(): void {
  const planHash = "hash-de-prueba-fase-4.4";
  const requestId = "req-de-prueba-fase-4.4";

  const tokenConSecretoViejo = conEnv("PLAN_APPROVAL_SECRET", "secreto-viejo-de-prueba", () =>
    crearTokenAprobacion(planHash, requestId),
  );

  // Con el secreto viejo todavía activo, el token viejo verifica.
  const verificaConViejo = conEnv("PLAN_APPROVAL_SECRET", "secreto-viejo-de-prueba", () =>
    verificarTokenAprobacion(tokenConSecretoViejo, planHash),
  );
  assert.ok(verificaConViejo, "el token debe verificar mientras el secreto no ha rotado");

  // Tras rotar, el mismo token (firmado con el secreto viejo) debe rechazarse.
  const verificaTrasRotar = conEnv("PLAN_APPROVAL_SECRET", "secreto-NUEVO-de-prueba", () =>
    verificarTokenAprobacion(tokenConSecretoViejo, planHash),
  );
  assert.equal(verificaTrasRotar, null, "un token firmado con el secreto viejo debe rechazarse tras rotar");

  // Un token nuevo, firmado y verificado con el secreto nuevo, sí funciona.
  const tokenConSecretoNuevo = conEnv("PLAN_APPROVAL_SECRET", "secreto-NUEVO-de-prueba", () =>
    crearTokenAprobacion(planHash, requestId),
  );
  const verificaNuevo = conEnv("PLAN_APPROVAL_SECRET", "secreto-NUEVO-de-prueba", () =>
    verificarTokenAprobacion(tokenConSecretoNuevo, planHash),
  );
  assert.ok(verificaNuevo, "un token firmado con el secreto nuevo debe verificar con el secreto nuevo");

  console.log("[PASS] PLAN_APPROVAL_SECRET: tras rotar, tokens viejos se rechazan y tokens nuevos verifican");
}

function probarShopifyWebhookSecret(): void {
  const cuerpo = JSON.stringify({ id: 123, title: "Producto de prueba" });
  const secretoViejo = "shopify-secreto-viejo-de-prueba";
  const secretoNuevo = "shopify-secreto-NUEVO-de-prueba";

  // Firma calculada por "Shopify" con el secreto viejo (simulado aquí con
  // la misma función HMAC que usa el verificador, ya que no hay forma de
  // pedirle a Shopify real que firme sin tener el webhook configurado).
  const firmaVieja = createHmac("sha256", secretoViejo).update(cuerpo, "utf8").digest("base64");

  assert.equal(verificarFirmaShopify(cuerpo, firmaVieja, secretoViejo), true, "la firma vieja debe validar contra el secreto viejo");
  assert.equal(verificarFirmaShopify(cuerpo, firmaVieja, secretoNuevo), false, "tras rotar, la firma vieja NO debe validar contra el secreto nuevo");

  const firmaNueva = createHmac("sha256", secretoNuevo).update(cuerpo, "utf8").digest("base64");
  assert.equal(verificarFirmaShopify(cuerpo, firmaNueva, secretoNuevo), true, "una firma nueva, calculada con el secreto nuevo, debe validar");

  console.log("[PASS] SHOPIFY_WEBHOOK_SECRET: tras rotar, firmas viejas se rechazan y firmas nuevas validan");
  console.log("       IMPORTANTE: rotar este valor sin actualizar el mismo secreto en el admin de Shopify");
  console.log("       rompe la sincronización real de catálogo — deben cambiar juntos, no por separado.");
}

function probarHappieExternoApiKey(): void {
  const url = "http://localhost/api/happie/recommend-packages";
  const claveVieja = "happie-externo-vieja-de-prueba";
  const claveNueva = "happie-externo-NUEVA-de-prueba";

  const conClaveVieja = conEnv("HAPPIE_EXTERNO_API_KEY", claveVieja, () =>
    apiKeyValida(new Request(url, { headers: { "x-api-key": claveVieja } })),
  );
  assert.equal(conClaveVieja, true, "la clave vieja debe ser válida antes de rotar");

  const trasRotarConClaveVieja = conEnv("HAPPIE_EXTERNO_API_KEY", claveNueva, () =>
    apiKeyValida(new Request(url, { headers: { "x-api-key": claveVieja } })),
  );
  assert.equal(trasRotarConClaveVieja, false, "tras rotar, la clave vieja debe rechazarse");

  const trasRotarConClaveNueva = conEnv("HAPPIE_EXTERNO_API_KEY", claveNueva, () =>
    apiKeyValida(new Request(url, { headers: { "x-api-key": claveNueva } })),
  );
  assert.equal(trasRotarConClaveNueva, true, "tras rotar, la clave nueva debe aceptarse");

  console.log("[PASS] HAPPIE_EXTERNO_API_KEY: tras rotar, la clave vieja se rechaza y la nueva se acepta");
}

function probarHappieWebhookApiKey(): void {
  const url = "http://localhost/api/happie/webhook/chat";
  // LONGITUD_MINIMA_SECRETO = 32 bytes en recomendar-paquetes-webhook.ts —
  // cualquier valor rotado debe cumplir este mínimo o el webhook completo
  // queda 503 "no configurado", una forma real de romperse al rotar mal.
  const claveVieja = "happie-webhook-vieja-de-prueba-32-bytes-o-mas";
  const claveNueva = "happie-webhook-NUEVA-de-prueba-32-bytes-o-mas";
  assert.ok(Buffer.byteLength(claveVieja, "utf8") >= 32 && Buffer.byteLength(claveNueva, "utf8") >= 32, "fixture inválido: ambas claves deben tener 32+ bytes");

  const conClaveVieja = conEnv("HAPPIE_WEBHOOK_API_KEY", claveVieja, () =>
    autenticarWebhook(new Request(url, { headers: { "x-api-key": claveVieja } })),
  );
  assert.equal(conClaveVieja, null, "null significa autorizado — la clave vieja debe pasar antes de rotar");

  const trasRotarConClaveVieja = conEnv("HAPPIE_WEBHOOK_API_KEY", claveNueva, () =>
    autenticarWebhook(new Request(url, { headers: { "x-api-key": claveVieja } })),
  );
  assert.ok(trasRotarConClaveVieja instanceof Response && trasRotarConClaveVieja.status === 401, "tras rotar, la clave vieja debe devolver 401");

  const trasRotarConClaveNueva = conEnv("HAPPIE_WEBHOOK_API_KEY", claveNueva, () =>
    autenticarWebhook(new Request(url, { headers: { "x-api-key": claveNueva } })),
  );
  assert.equal(trasRotarConClaveNueva, null, "tras rotar, la clave nueva debe autorizar");

  console.log("[PASS] HAPPIE_WEBHOOK_API_KEY: tras rotar, la clave vieja devuelve 401 y la nueva autoriza (null)");
}

function probarComparacionSubyacente(): void {
  // Las 5 pruebas de arriba dependen, en el fondo, de que la comparación de
  // credenciales sea correcta byte a byte — esto ya lo cubre
  // scripts/test-comparar-constante.ts en detalle; aquí solo se confirma
  // que el helper que introdujo Fase 4.5 sigue siendo la pieza compartida.
  assert.equal(compararEnTiempoConstante("a", "a"), true);
  assert.equal(compararEnTiempoConstante("a", "b"), false);
}

function main(): void {
  probarAppPassword();
  probarPlanApprovalSecret();
  probarShopifyWebhookSecret();
  probarHappieExternoApiKey();
  probarHappieWebhookApiKey();
  probarComparacionSubyacente();
  console.log();
  console.log("[PASS] Fase 4.4 — los 5 secretos que esta app controla por completo rotan sin romper");
  console.log("       la verificación del valor nuevo ni dejar colado el valor viejo. Los 4 restantes");
  console.log("       (GEMINI_API_KEY, FAL_KEY, HAPPIA_API_KEY, DATABASE_URL) necesitan generar la");
  console.log("       credencial nueva en la consola del proveedor antes de poder probarse igual.");
}

try {
  main();
} catch (error) {
  console.error("[FAIL] prueba de rotación de secretos —", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
