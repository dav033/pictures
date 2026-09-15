import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";
import {
  AccionUiV1Schema,
  CATALOGO_ERRORES_UI_V1,
  construirUiErrorV1,
  leerUiErrorV1,
  uiErrorDesdeChatV1,
  UiErrorCodeV1Schema,
  UiErrorV1Schema,
  UI_ERROR_CONTRACT_VERSION,
} from "../src/lib/ia/contracts/ui-error-v1";
import { ErrorCodeV1Schema } from "../src/lib/ia/contracts/chat-v1";
import { clasificarErrorServidor, traducirErrorServidor } from "../src/lib/errores-ui/traducir-error-servidor";
import { ErrorIA } from "../src/lib/ia/tipos";
import { PlanEditError } from "../src/lib/plan/edicion-error";
import { PlanBackendNoDisponibleError } from "../src/lib/plan/resolver-backend";
import { AllowlistProductoVarianteError } from "../src/lib/plan/allowlist-producto-variante";
import { NonCommercialSourceRejectedError } from "../src/lib/generacion/provenance";

let casos = 0;
function caso(nombre: string, fn: () => void): void {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

// Patrones que nunca pueden llegar al cliente (docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md, A4).
const PATRONES_PROHIBIDOS: ReadonlyArray<readonly [string, RegExp]> = [
  ["SKU", /\bsku\b/i],
  ["_ID", /_ID\b/i],
  ["LORA_", /LORA_/i],
  ["LoRA/Gemini", /\b(lora|gemini|nano banana|fal)\b/i],
  ["cobertura", /cobertura/i],
  ["límite", /l[ií]mite/i],
  ["error", /\berror\b/i],
  ["MAYÚSCULAS_CON_GUIONES", /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/],
  ["inglés técnico", /\b(hash|payload|prompt|variant|snapshot|allowlist|backend)\b/i],
];

caso("cada código tiene entrada de catálogo válida y sin jerga", () => {
  for (const code of UiErrorCodeV1Schema.options) {
    const entrada = CATALOGO_ERRORES_UI_V1[code];
    assert.ok(entrada, `falta catálogo para ${code}`);
    for (const [nombre, patron] of PATRONES_PROHIBIDOS) {
      assert.doesNotMatch(entrada.mensaje_usuario, patron, `${code} contiene ${nombre}: ${entrada.mensaje_usuario}`);
    }
    assert.ok(entrada.mensaje_usuario.length <= 280);
    assert.ok(!entrada.acciones_alternativas.includes(entrada.accion_sugerida ?? "reintentar") || entrada.accion_sugerida === null, `${code} repite la acción sugerida`);
    for (const accion of entrada.acciones_alternativas) AccionUiV1Schema.parse(accion);
  }
});

caso("construirUiErrorV1 produce un sobre versionado y estricto", () => {
  const requestId = randomUUID();
  const ui = construirUiErrorV1("ESTILO_NO_PREPARADO", { mensaje: "LORA_PREFLIGHT_FAILED: longitud 845 supera límite 750", codigoOrigen: "LORA_PREFLIGHT_FAILED", requestId });
  assert.equal(ui.schema_version, UI_ERROR_CONTRACT_VERSION);
  assert.equal(ui.request_id, requestId);
  assert.equal(ui.accion_sugerida, "reintentar");
  assert.deepEqual(ui.acciones_alternativas, ["generar_estilo_estandar"]);
  assert.equal(ui.detalles_dev.codigo_origen, "LORA_PREFLIGHT_FAILED");
  assert.doesNotMatch(ui.mensaje_usuario, /LORA|límite|845/);
  assert.throws(() => UiErrorV1Schema.parse({ ...ui, extra: true }), ZodError);
  assert.throws(() => UiErrorV1Schema.parse({ ...ui, schema_version: "ui-error.v2" }), ZodError);
});

caso("detalles_dev se acota y un mensaje vacío no rompe el contrato", () => {
  const largo = construirUiErrorV1("ERROR_INTERNO", { mensaje: "x".repeat(5000) });
  assert.equal(largo.detalles_dev.mensaje.length, 2000);
  const vacio = construirUiErrorV1("ERROR_INTERNO", { mensaje: "   " });
  assert.ok(vacio.detalles_dev.mensaje.length > 0);
});

caso("leerUiErrorV1 acepta solo sobres válidos", () => {
  const ui = construirUiErrorV1("TIEMPO_AGOTADO", { mensaje: "timeout" });
  assert.deepEqual(leerUiErrorV1({ error: "x", ui_error: ui }), ui);
  assert.equal(leerUiErrorV1({ error: "LORA_PREFLIGHT_FAILED: x" }), null);
  assert.equal(leerUiErrorV1({ ui_error: { code: "ERROR_INTERNO" } }), null);
  assert.equal(leerUiErrorV1(null), null);
  assert.equal(leerUiErrorV1("texto"), null);
});

caso("todos los códigos del chat (error.v1) tienen traducción explícita", () => {
  for (const code of ErrorCodeV1Schema.options) {
    const ui = uiErrorDesdeChatV1({ code, error: "detalle", request_id: randomUUID() });
    assert.equal(ui.detalles_dev.codigo_origen, code);
    if (code !== "INTERNAL_ERROR" && code !== "TOOL_NOT_FOUND" && code !== "INVALID_TOOL_ARGUMENTS") {
      assert.notEqual(ui.code, "ERROR_INTERNO", `${code} no debería caer en ERROR_INTERNO`);
    }
  }
  assert.equal(uiErrorDesdeChatV1({ code: "AI_TIMEOUT" }).code, "TIEMPO_AGOTADO");
  assert.equal(uiErrorDesdeChatV1({ code: "RAG_UNAVAILABLE", error: "No se pudo conectar al catálogo RAG (PostgreSQL). Verifica DATABASE_URL" }).mensaje_usuario, CATALOGO_ERRORES_UI_V1.SERVICIO_NO_DISPONIBLE.mensaje_usuario);
});

// Mensajes reales que hoy lanza /api/generate (src/app/api/generate/route.ts),
// src/lib/rag/generate-products.ts y /api/references/analyze.
const MENSAJES_REALES: ReadonlyArray<readonly [string, string]> = [
  ["LORA_PREFLIGHT_FAILED: cobertura de colores 2/3; longitud 845 supera límite 750", "ESTILO_NO_PREPARADO"],
  ["LORA_LANGUAGE_FAILED: el prompt contiene texto español sin traducir (globos)", "ESTILO_NO_PREPARADO"],
  ["LORA_MODE_REQUIRED: no se pudo resolver un artifact LoRA registrado para esta generación.", "ESTILO_NO_PREPARADO"],
  ["LORA_MODE_INVALID: modo LoRA inválido.", "ESTILO_NO_PREPARADO"],
  ["LORA_SELECTION_INVALID: selecciona un artifact producto o estructura válido.", "ESTILO_NO_PREPARADO"],
  ["LORA_MODE_SELECTION_CONFLICT: usa un modo o una selección manual, no ambos.", "ESTILO_NO_PREPARADO"],
  ["LORA_ARTIFACT_NOT_READY: training_1", "ESTILO_NO_PREPARADO"],
  ["LORA_PLAN_REQUIRED: 3 tipo(s) sin visual_semantics del plan, inferido(s) por nombre (balloon decoration kit)", "ESTILO_REQUIERE_PROPUESTA"],
  ["LORA_PRODUCT_VOCABULARY_FAILED: no se pudo resolver identidad canónica para 123.", "ESTILO_SIN_PRODUCTOS"],
  ["LORA_DATASET_ALLOWLIST_REJECTED: 4455, 6677", "ESTILO_SIN_PRODUCTOS"],
  ["APROBACION_REQUERIDA: el plan debe aprobarse desde la tarjeta antes de generar.", "APROBACION_REQUERIDA"],
  ["PRESUPUESTO_EXCEDIDO: 900000 COP supera el techo de 500000 COP por 400000 COP.", "PRESUPUESTO_EXCEDIDO"],
  ["IMAGE_QA_REQUIRED: solicita la validación visual antes de generar un plan aprobado.", "VALIDACION_VISUAL_REQUERIDA"],
  ["NON_CONFORME: la imagen no fue observada conforme al plan aprobado — placement failure EST_02_COLUMNAS#2.", "IMAGEN_NO_FIEL"],
  ["Plan hash does not match the validated server plan.", "PROPUESTA_DESACTUALIZADA"],
  ["Scene specification hash does not match the validated scene.", "PROPUESTA_DESACTUALIZADA"],
  ["Submitted scene specification does not match the server-approved scene.", "PROPUESTA_DESACTUALIZADA"],
  ["One or more RAG variant IDs could not be validated: 1, 2.", "PROPUESTA_DESACTUALIZADA"],
  ["El plan tiene materiales sin cobertura en la selección validada; no se generó una imagen incoherente.", "PROPUESTA_INCOMPLETA"],
  ["La estimación de materiales no es válida: x", "PROPUESTA_INCOMPLETA"],
  ["La estimación de materiales no es compatible con la escala solicitada: x", "PROPUESTA_INCOMPLETA"],
  ["El prompt no coincide con el plan resuelto: x", "PROPUESTA_INCOMPLETA"],
  ["Approve at least one element before generating.", "PROPUESTA_INCOMPLETA"],
  ["LoRA Sempertex genera desde texto. Para editar fotos o usar referencias, cambia a Gemini.", "ESTILO_NO_ADMITE_FOTOS"],
  ["fotoEspacio supera el tamaño máximo permitido.", "ADJUNTO_INVALIDO"],
  ["imagenesReferencia[1] debe ser PNG, JPEG o WebP.", "ADJUNTO_INVALIDO"],
  ["El conjunto de imágenes supera el tamaño máximo permitido.", "ADJUNTO_INVALIDO"],
  ["Attach between one and three reference images.", "ADJUNTO_INVALIDO"],
  ["Reference payload is too large.", "ADJUNTO_INVALIDO"],
  ["imageQaRequested debe ser booleano.", "SOLICITUD_INVALIDA"],
  ["An ID cannot be present in both productIds and ragVariantIds: 1.", "SOLICITUD_INVALIDA"],
  ["Algo inesperado sin código", "ERROR_INTERNO"],
  ["UNKNOWN_CODE: algo", "ERROR_INTERNO"],
];

caso("mensajes reales de generación se clasifican con código estable", () => {
  for (const [mensaje, esperado] of MENSAJES_REALES) {
    assert.equal(clasificarErrorServidor(new Error(mensaje)).code, esperado, mensaje);
    const ui = traducirErrorServidor(new Error(mensaje));
    assert.equal(ui.detalles_dev.mensaje, mensaje);
    assert.doesNotMatch(ui.mensaje_usuario, /LORA_|EST_\d|hash|\d{3,}/);
  }
});

// Todos los prefijos LORA_* que lanza src/ (inventario 2026-09-14).
const CODIGOS_LORA_ESTILO = [
  "LORA_APPLICATION_REQUIRED", "LORA_ARTIFACT_NOT_APPROVED", "LORA_ARTIFACT_NOT_FOUND", "LORA_DATASET_ALLOWLIST_EMPTY",
  "LORA_DATASET_CATALOG_UNLINKED", "LORA_EVALUATION_REQUIRED", "LORA_INCOMPATIBLE", "LORA_LANGUAGE_FAILED", "LORA_MODE_DISABLED",
  "LORA_MODE_INVALID", "LORA_MODE_NOT_CONFIGURED", "LORA_MODE_NOT_FOUND", "LORA_MODE_NOT_READY", "LORA_MODE_REQUIRED",
  "LORA_MODE_SELECTION_CONFLICT", "LORA_MULTI_UNSUPPORTED", "LORA_PREFLIGHT_FAILED", "LORA_PROVIDER_URL_MISSING",
  "LORA_REGISTRY_UNAVAILABLE", "LORA_RUN_NOT_COMPLETED", "LORA_SELECTION_INVALID", "LORA_SPECIALIZATION_MISMATCH",
  "LORA_VOCABULARY_ALLOWLIST_EMPTY",
];

caso("todos los LORA_* de estilo dan ESTILO_NO_PREPARADO y los de producto ESTILO_SIN_PRODUCTOS", () => {
  for (const codigo of CODIGOS_LORA_ESTILO) {
    assert.equal(clasificarErrorServidor(new Error(`${codigo}: detalle`)).code, "ESTILO_NO_PREPARADO", codigo);
  }
  for (const codigo of ["LORA_PRODUCT_VOCABULARY_FAILED", "LORA_DATASET_ALLOWLIST_REJECTED"]) {
    assert.equal(clasificarErrorServidor(new Error(`${codigo}: 123`)).code, "ESTILO_SIN_PRODUCTOS", codigo);
  }
});

caso("errores tipados se clasifican por clase, no por texto", () => {
  assert.equal(clasificarErrorServidor(new ErrorIA("cuota", "gemini", "quota", true)).code, "SERVICIO_OCUPADO");
  assert.equal(clasificarErrorServidor(new ErrorIA("timeout", "gemini", "t", true)).code, "TIEMPO_AGOTADO");
  assert.equal(clasificarErrorServidor(new ErrorIA("filtrado", "gemini", "f", false)).code, "CONTENIDO_NO_PERMITIDO");
  assert.equal(clasificarErrorServidor(new ErrorIA("sin_llave", "gemini", "k", false)).code, "SERVICIO_NO_DISPONIBLE");
  assert.equal(clasificarErrorServidor(new PlanBackendNoDisponibleError("PYTHON_NO_SELECCIONADO", "x")).code, "PROPUESTA_DESACTUALIZADA");
  assert.equal(clasificarErrorServidor(new AllowlistProductoVarianteError()).code, "PROPUESTA_DESACTUALIZADA");
  assert.equal(clasificarErrorServidor(new NonCommercialSourceRejectedError("p1", "seed_demo", "editorial_reference")).code, "PRODUCTO_NO_DISPONIBLE");
  assert.equal(clasificarErrorServidor(new PlanEditError(409, "El catálogo cambió.")).code, "PROPUESTA_DESACTUALIZADA");
  assert.equal(clasificarErrorServidor(new PlanEditError(400, "No puedes quitar el único material.")).code, "PROPUESTA_INCOMPLETA");
  // E2E 2026-09-14: "Quitar" on a one-balloon piece said "Hay que ajustar la propuesta…".
  const unico = traducirErrorServidor(new PlanEditError(400, "No se puede quitar el único globo de esta pieza; cámbialo por otro.", "UNICO_MATERIAL"), "00000000-0000-4000-8000-0000000000aa");
  assert.equal(unico.code, "PIEZA_UNICO_MATERIAL");
  assert.equal(unico.mensaje_usuario, "No se puede quitar el único globo de esta pieza; cámbialo por otro.");
  assert.equal(unico.retryable, false);
  assert.equal(unico.detalles_dev.codigo_origen, "UNICO_MATERIAL");
  assert.equal(unico.request_id, "00000000-0000-4000-8000-0000000000aa");
  const incompatible = traducirErrorServidor(new PlanEditError(422, "Esa pieza no puede reemplazar un globo. Elige otro globo.", "REEMPLAZO_INCOMPATIBLE"));
  assert.equal(incompatible.code, "REEMPLAZO_NO_COMPATIBLE");
  assert.match(incompatible.mensaje_usuario, /Elige otro globo/);
  // plan-editar lanza PlanEditError(409, "LORA_DATASET_ALLOWLIST_REJECTED: <variant>"): gana el código del mensaje.
  assert.equal(clasificarErrorServidor(new PlanEditError(409, "LORA_DATASET_ALLOWLIST_REJECTED: 998877")).code, "ESTILO_SIN_PRODUCTOS");
  const zod = z.object({ a: z.string() }).safeParse({});
  assert.ok(!zod.success);
  assert.equal(clasificarErrorServidor(zod.error).code, "SOLICITUD_INVALIDA");
  assert.equal(clasificarErrorServidor("texto lanzado").code, "ERROR_INTERNO");
});

console.log(`\n${casos} casos OK (ui-error.v1)`);
