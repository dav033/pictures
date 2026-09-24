import { ZodError } from "zod";
import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import { isPythonAdapterError } from "@/lib/ia/nucleo/python-adapter";
import { NonCommercialSourceRejectedError } from "@/lib/generacion/provenance";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { PlanBackendNoDisponibleError } from "@/lib/plan/resolver-backend";
import { PythonPlanMappingError } from "@/lib/plan/python-mapper";
import { PlanEditError } from "@/lib/plan/edicion-error";
import { ProveedorImagenNoDisponibleError } from "@/lib/ia/kagutsuchi/sempertex-lora";
import { construirUiErrorV1, type UiErrorCodeV1, type UiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";

/**
 * Traduce una excepción de servidor al contrato ui-error.v1.
 *
 * Primero clasifica por tipo de error. Los handlers y librerías de generación
 * todavía lanzan `new Error("CODIGO: detalle")` o mensajes fijos; esos se
 * clasifican con las tablas de abajo.
 *
 * Adaptador temporal: las tablas por mensaje existen porque los mensajes ya
 * son un contrato de facto (el smoke `smoke:rutas-python-local` los compara).
 * Se retiran cuando esos puntos lancen errores tipados con `code` y el smoke
 * compare `ui_error.code`. Un mensaje que no está en las tablas cae en
 * ERROR_INTERNO, que es explícito y queda registrado con su mensaje original.
 */

/** Prefijo `CODIGO:` → código de cliente. */
const CODIGOS_POR_PREFIJO: Readonly<Record<string, UiErrorCodeV1>> = {
  LORA_PREFLIGHT_FAILED: "ESTILO_NO_PREPARADO",
  LORA_PLAN_REQUIRED: "ESTILO_REQUIERE_PROPUESTA",
  LORA_LANGUAGE_FAILED: "ESTILO_NO_PREPARADO",
  LORA_MODE_REQUIRED: "ESTILO_NO_PREPARADO",
  LORA_MODE_INVALID: "ESTILO_NO_PREPARADO",
  LORA_SELECTION_INVALID: "ESTILO_NO_PREPARADO",
  LORA_MODE_SELECTION_CONFLICT: "ESTILO_NO_PREPARADO",
  LORA_PRODUCT_VOCABULARY_FAILED: "ESTILO_SIN_PRODUCTOS",
  LORA_DATASET_ALLOWLIST_REJECTED: "ESTILO_SIN_PRODUCTOS",
  APROBACION_REQUERIDA: "APROBACION_REQUERIDA",
  PRESUPUESTO_EXCEDIDO: "PRESUPUESTO_EXCEDIDO",
  REFERENCE_IMAGE_TOO_LARGE: "ADJUNTO_INVALIDO",
  REFERENCE_IMAGE_UNREADABLE: "ADJUNTO_INVALIDO",
  REFERENCE_IMAGE_EMPTY: "ADJUNTO_INVALIDO",
  REFERENCE_IMAGE_TYPE: "ADJUNTO_INVALIDO",
  REFERENCE_IMAGE_DIMENSIONS: "ADJUNTO_INVALIDO",
  REFERENCE_TOO_MANY_IMAGES: "ADJUNTO_INVALIDO",
  REFERENCE_NO_IMAGES: "ADJUNTO_INVALIDO",
};

/**
 * Prefijo con el que el adaptador de Gemini (`PREFIJO_IMAGEN_RECHAZADA` en
 * packages/agente-core/src/gemini/chat.ts) marca un 400 del proveedor sobre
 * una imagen adjunta. Se repite como literal para no importar el adaptador
 * del proveedor desde la traducción de errores.
 */
const PREFIJO_IMAGEN_RECHAZADA = "AI_IMAGE_REJECTED";

/**
 * Texto de cliente específico para los adjuntos de la foto de referencia,
 * más preciso que el genérico de ADJUNTO_INVALIDO (una foto corrupta, vacía
 * o demasiadas fotos recibían "más livianas" o "Recarga la página").
 * Adaptador temporal: se retira cuando ui-error-v1 tenga códigos propios para
 * estos casos, porque su catálogo es el dueño del texto al cliente.
 */
const MENSAJE_ADJUNTO_POR_ORIGEN: Readonly<Record<string, string>> = {
  [PREFIJO_IMAGEN_RECHAZADA]: "No pude leer esa foto. Prueba con otra imagen (JPG, PNG o WebP).",
  REFERENCE_IMAGE_UNREADABLE: "No pude leer esa foto. Prueba con otra imagen (JPG, PNG o WebP).",
  REFERENCE_IMAGE_TOO_LARGE: "La foto es demasiado grande. Prueba con una imagen más liviana o de menor resolución (JPG, PNG o WebP).",
  REFERENCE_IMAGE_EMPTY: "La foto llegó vacía. Vuelve a adjuntarla.",
  REFERENCE_IMAGE_TYPE: "Solo puedo usar fotos JPG, PNG o WebP.",
  REFERENCE_IMAGE_DIMENSIONS: "La foto es muy pequeña o tiene unas medidas que no puedo usar. Prueba con otra imagen.",
  REFERENCE_TOO_MANY_IMAGES: "Puedes adjuntar hasta tres fotos de referencia a la vez.",
  REFERENCE_NO_IMAGES: "Adjunta al menos una foto de referencia.",
};

/**
 * Cualquier otro `LORA_*` (registro, modos, artifacts, allowlists vacías,
 * proveedor) significa para el cliente lo mismo: este estilo no se pudo
 * preparar ahora. Las dos causas de producto tienen entrada propia arriba.
 */
const PREFIJO_LORA = /^LORA_[A-Z_]+$/;

/** Mensajes sin prefijo, por inicio de texto. */
const CODIGOS_POR_INICIO: ReadonlyArray<readonly [string, UiErrorCodeV1]> = [
  ["Plan hash does not match", "PROPUESTA_DESACTUALIZADA"],
  ["Scene specification hash does not match", "PROPUESTA_DESACTUALIZADA"],
  ["Submitted scene specification does not match", "PROPUESTA_DESACTUALIZADA"],
  ["One or more RAG variant IDs could not be validated", "PROPUESTA_DESACTUALIZADA"],
  ["One or more selected catalog products could not be validated", "PROPUESTA_DESACTUALIZADA"],
  ["El plan tiene materiales sin cobertura", "PROPUESTA_INCOMPLETA"],
  ["La estimación de materiales no", "PROPUESTA_INCOMPLETA"],
  ["El prompt no coincide con el plan resuelto", "PROPUESTA_INCOMPLETA"],
  ["Approve at least one element before generating", "PROPUESTA_INCOMPLETA"],
  ["LoRA Sempertex genera desde texto", "ESTILO_NO_ADMITE_FOTOS"],
  ["catalogSnapshotId must not be blank", "SOLICITUD_INVALIDA"],
  ["An ID cannot be present in both productIds and ragVariantIds", "SOLICITUD_INVALIDA"],
  ["El payload de generación es demasiado grande", "ADJUNTO_INVALIDO"],
  ["El conjunto de imágenes supera", "ADJUNTO_INVALIDO"],
  ["Attach between one and three reference images", "ADJUNTO_INVALIDO"],
  ["Only PNG, JPEG, and WebP reference images", "ADJUNTO_INVALIDO"],
  ["A reference image is too large", "ADJUNTO_INVALIDO"],
  ["Reference width is outside", "ADJUNTO_INVALIDO"],
  ["Reference height is outside", "ADJUNTO_INVALIDO"],
  ["Reference payload is too large", "ADJUNTO_INVALIDO"],
];

/** Validación de imágenes de /api/generate: "<campo> no es una imagen válida." etc. */
const MENSAJE_ADJUNTO = /^(?:fotoEspacio|previousGeneratedImage|imagenesReferencia)(?:\[\d+\])?(?::| )/;

function codigoDeErrorIA(error: ErrorIA): UiErrorCodeV1 {
  switch (error.causa) {
    case "cuota":
      return "SERVICIO_OCUPADO";
    case "timeout":
      return "TIEMPO_AGOTADO";
    case "filtrado":
      return "CONTENIDO_NO_PERMITIDO";
    default:
      return "SERVICIO_NO_DISPONIBLE";
  }
}

export interface ClasificacionError {
  code: UiErrorCodeV1;
  codigoOrigen?: string;
  causa?: string;
}

/** Clasificación pura (sin I/O); expuesta para las pruebas de regresión. */
export function clasificarErrorServidor(error: unknown): ClasificacionError {
  if (error instanceof ErrorIA && error.message.startsWith(PREFIJO_IMAGEN_RECHAZADA)) {
    return { code: "ADJUNTO_INVALIDO", codigoOrigen: PREFIJO_IMAGEN_RECHAZADA, causa: error.causa };
  }
  if (error instanceof ProveedorImagenNoDisponibleError) return { code: "VISTA_PREVIA_NO_DISPONIBLE", codigoOrigen: `FAL_${error.status}`, causa: error.causa };
  if (error instanceof ErrorIA) return { code: codigoDeErrorIA(error), codigoOrigen: `AI_${error.causa.toUpperCase()}`, causa: error.causa };
  if (error instanceof NonCommercialSourceRejectedError) return { code: "PRODUCTO_NO_DISPONIBLE", codigoOrigen: "NON_COMMERCIAL_SOURCE", causa: "fuente_no_comercial" };
  if (error instanceof AllowlistProductoVarianteError) return { code: "PROPUESTA_DESACTUALIZADA", codigoOrigen: error.causa, causa: error.causa };
  if (error instanceof PlanBackendNoDisponibleError) return { code: "PROPUESTA_DESACTUALIZADA", codigoOrigen: error.motivo, causa: error.motivo };
  if (error instanceof PythonPlanMappingError) return { code: "ERROR_INTERNO", codigoOrigen: error.code };
  if (isPythonAdapterError(error)) {
    return {
      code: error.retryable ? "SERVICIO_NO_DISPONIBLE" : "ERROR_INTERNO",
      codigoOrigen: error.domainCode ? `${error.code}:${error.domainCode}` : error.code,
    };
  }
  if (!(error instanceof Error)) return { code: "ERROR_INTERNO", codigoOrigen: "NON_ERROR_THROWN" };

  // El código del mensaje gana sobre la clase: PlanEditError también puede
  // llevar un prefijo técnico (LORA_DATASET_ALLOWLIST_REJECTED en plan-editar).
  const mensaje = error.message.trim();
  const prefijo = /^([A-Z][A-Z0-9_]{3,})(?::|\s—|$)/.exec(mensaje)?.[1];
  if (prefijo) {
    const code = CODIGOS_POR_PREFIJO[prefijo];
    if (code) return { code, codigoOrigen: prefijo };
    if (PREFIJO_LORA.test(prefijo)) return { code: "ESTILO_NO_PREPARADO", codigoOrigen: prefijo };
  }
  if (error instanceof PlanEditError) {
    // Causas con código propio: el cliente puede corregir la edición sin pedir otra propuesta.
    if (error.causa === "UNICO_MATERIAL") return { code: "PIEZA_UNICO_MATERIAL", codigoOrigen: error.causa, causa: error.causa };
    if (error.causa === "REEMPLAZO_INCOMPATIBLE") return { code: "REEMPLAZO_NO_COMPATIBLE", codigoOrigen: error.causa, causa: error.causa };
    // Mensajes de PlanEditError ya están redactados para el cliente; el estado
    // decide la acción. 404/409 son cambios de catálogo o de plan base.
    if (error.status === 400 || error.status === 422) {
      return { code: "PROPUESTA_INCOMPLETA", codigoOrigen: error.causa ?? `PLAN_EDIT_${error.status}`, causa: error.causa };
    }
    return { code: "PROPUESTA_DESACTUALIZADA", codigoOrigen: error.causa ?? `PLAN_EDIT_${error.status}`, causa: error.causa };
  }
  for (const [inicio, code] of CODIGOS_POR_INICIO) {
    if (mensaje.startsWith(inicio)) return { code, codigoOrigen: inicio };
  }
  if (MENSAJE_ADJUNTO.test(mensaje)) return { code: "ADJUNTO_INVALIDO", codigoOrigen: "INVALID_IMAGE_INPUT" };
  if (error instanceof SyntaxError) return { code: "SOLICITUD_INVALIDA", codigoOrigen: "INVALID_JSON" };
  if (error instanceof ZodError) return { code: "SOLICITUD_INVALIDA", codigoOrigen: "INVALID_INPUT" };
  return { code: "ERROR_INTERNO", codigoOrigen: prefijo };
}

export function traducirErrorServidor(error: unknown, requestId?: string): UiErrorV1 {
  const clasificacion = clasificarErrorServidor(error);
  const mensaje = error instanceof Error ? error.message : "Se lanzó un valor que no es Error.";
  const uiError = construirUiErrorV1(clasificacion.code, {
    mensaje,
    codigoOrigen: clasificacion.codigoOrigen,
    causa: clasificacion.causa,
    requestId,
  });
  const mensajeAdjunto = clasificacion.code === "ADJUNTO_INVALIDO" && clasificacion.codigoOrigen
    ? MENSAJE_ADJUNTO_POR_ORIGEN[clasificacion.codigoOrigen]
    : undefined;
  // Static strings under the 280-character contract limit: no re-validation needed.
  return mensajeAdjunto ? { ...uiError, mensaje_usuario: mensajeAdjunto } : uiError;
}

/**
 * Registro operativo mínimo del fallo: código estable, código de origen y
 * request_id. Sin prompt, conversación ni imágenes (AGENTS.md). Hoy los fallos
 * previos a la llamada al proveedor no quedan en ninguna tabla; esta línea
 * estructurada es la que permite contarlos en los logs del servidor.
 */
export function registrarFalloUi(superficie: string, uiError: UiErrorV1): void {
  console.warn("[ui-error]", JSON.stringify({
    superficie,
    code: uiError.code,
    codigo_origen: uiError.detalles_dev.codigo_origen ?? null,
    request_id: uiError.request_id ?? null,
  }));
}
