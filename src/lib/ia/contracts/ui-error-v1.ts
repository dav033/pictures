import { z } from "zod";

/**
 * Contrato versionado del error que ve el cliente final (ui-error.v1).
 *
 * Es el único dueño del texto que se muestra al cliente cuando una operación
 * falla: cada `code` estable tiene un mensaje en español claro y las acciones
 * que el cliente puede tomar. Los detalles técnicos viajan aparte, en
 * `detalles_dev`, y solo se muestran en modo dev.
 *
 * Este módulo no depende de código de servidor: lo usan los handlers para
 * construir la respuesta y el navegador para errores locales (red, cancelación)
 * y para traducir el `code` de los eventos SSE del chat.
 */
export const UI_ERROR_CONTRACT_VERSION = "ui-error.v1" as const;

export const UiErrorCodeV1Schema = z.enum([
  "ESTILO_NO_PREPARADO",
  "ESTILO_REQUIERE_PROPUESTA",
  "ESTILO_SIN_PRODUCTOS",
  "ESTILO_NO_ADMITE_FOTOS",
  "APROBACION_REQUERIDA",
  "PROPUESTA_DESACTUALIZADA",
  "PROPUESTA_INCOMPLETA",
  "PRESUPUESTO_EXCEDIDO",
  "VALIDACION_VISUAL_REQUERIDA",
  "IMAGEN_NO_FIEL",
  "PRODUCTO_NO_DISPONIBLE",
  "ADJUNTO_INVALIDO",
  "SOLICITUD_INVALIDA",
  "SERVICIO_NO_DISPONIBLE",
  "SERVICIO_OCUPADO",
  "TIEMPO_AGOTADO",
  "CONTENIDO_NO_PERMITIDO",
  "SIN_CONEXION",
  "OPERACION_CANCELADA",
  "ERROR_INTERNO",
  "VISTA_PREVIA_NO_DISPONIBLE",
]);
export type UiErrorCodeV1 = z.infer<typeof UiErrorCodeV1Schema>;

/**
 * Acciones que el cliente puede pedir desde el aviso de error. Ninguna se
 * ejecuta sola: "generar_estilo_estandar" en particular es una decisión
 * explícita del cliente, nunca un fallback automático.
 */
export const AccionUiV1Schema = z.enum([
  "reintentar",
  "generar_estilo_estandar",
  "revisar_propuesta",
  "pedir_nueva_propuesta",
  "ajustar_propuesta",
  "activar_validacion_visual",
  "revisar_adjuntos",
]);
export type AccionUiV1 = z.infer<typeof AccionUiV1Schema>;

export const DetallesDevV1Schema = z.object({
  /** Mensaje técnico original. Nunca incluye stack traces ni configuración. */
  mensaje: z.string().min(1).max(2000),
  /** Código técnico de origen (p. ej. LORA_PREFLIGHT_FAILED, AI_TIMEOUT). */
  codigo_origen: z.string().min(1).max(120).optional(),
  causa: z.string().min(1).max(120).optional(),
}).strict();
export type DetallesDevV1 = z.infer<typeof DetallesDevV1Schema>;

export const UiErrorV1Schema = z.object({
  schema_version: z.literal(UI_ERROR_CONTRACT_VERSION),
  code: UiErrorCodeV1Schema,
  mensaje_usuario: z.string().min(1).max(280),
  accion_sugerida: AccionUiV1Schema.nullable(),
  acciones_alternativas: z.array(AccionUiV1Schema).max(2),
  retryable: z.boolean(),
  request_id: z.string().uuid().optional(),
  detalles_dev: DetallesDevV1Schema,
}).strict();
export type UiErrorV1 = z.infer<typeof UiErrorV1Schema>;

interface EntradaCatalogo {
  mensaje_usuario: string;
  accion_sugerida: AccionUiV1 | null;
  acciones_alternativas: readonly AccionUiV1[];
  retryable: boolean;
}

/**
 * Texto de cliente por código. Reglas de redacción: español neutro, sin
 * nombres de modelos o proveedores, sin SKU, IDs, códigos, cifras de límites
 * internos ni la palabra "error". Siempre dice qué puede hacer el cliente.
 */
export const CATALOGO_ERRORES_UI_V1: Readonly<Record<UiErrorCodeV1, EntradaCatalogo>> = {
  ESTILO_NO_PREPARADO: {
    mensaje_usuario: "No pudimos preparar la imagen con este estilo.",
    accion_sugerida: "reintentar",
    acciones_alternativas: ["generar_estilo_estandar"],
    retryable: true,
  },
  ESTILO_REQUIERE_PROPUESTA: {
    mensaje_usuario: "Este estilo necesita una propuesta de decoración aprobada. Puedes pedir la propuesta o crear la imagen con el estilo estándar.",
    accion_sugerida: "generar_estilo_estandar",
    acciones_alternativas: ["pedir_nueva_propuesta"],
    retryable: false,
  },
  ESTILO_SIN_PRODUCTOS: {
    mensaje_usuario: "Algunas piezas de tu propuesta todavía no se pueden dibujar con este estilo.",
    accion_sugerida: "generar_estilo_estandar",
    acciones_alternativas: ["ajustar_propuesta"],
    retryable: false,
  },
  ESTILO_NO_ADMITE_FOTOS: {
    mensaje_usuario: "Este estilo no puede usar las fotos que adjuntaste. Con el estilo estándar sí las tenemos en cuenta.",
    accion_sugerida: "generar_estilo_estandar",
    acciones_alternativas: [],
    retryable: false,
  },
  APROBACION_REQUERIDA: {
    mensaje_usuario: "Antes de crear la imagen, revisa y aprueba la propuesta.",
    accion_sugerida: "revisar_propuesta",
    acciones_alternativas: [],
    retryable: false,
  },
  PROPUESTA_DESACTUALIZADA: {
    mensaje_usuario: "La propuesta cambió o el catálogo se actualizó. Pide la propuesta de nuevo para continuar.",
    accion_sugerida: "pedir_nueva_propuesta",
    acciones_alternativas: [],
    retryable: false,
  },
  PROPUESTA_INCOMPLETA: {
    mensaje_usuario: "Hay que ajustar la propuesta antes de crear la imagen.",
    accion_sugerida: "ajustar_propuesta",
    acciones_alternativas: [],
    retryable: false,
  },
  PRESUPUESTO_EXCEDIDO: {
    mensaje_usuario: "La propuesta supera el presupuesto que indicaste.",
    accion_sugerida: "ajustar_propuesta",
    acciones_alternativas: [],
    retryable: false,
  },
  VALIDACION_VISUAL_REQUERIDA: {
    mensaje_usuario: "Para crear la imagen de esta propuesta hay que activar la revisión de calidad.",
    accion_sugerida: "activar_validacion_visual",
    acciones_alternativas: [],
    retryable: false,
  },
  IMAGEN_NO_FIEL: {
    mensaje_usuario: "La imagen no quedó fiel a la propuesta. Podemos intentarlo otra vez.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: true,
  },
  PRODUCTO_NO_DISPONIBLE: {
    mensaje_usuario: "Una de las piezas elegidas ya no está disponible. Elige otra o pide la propuesta de nuevo.",
    accion_sugerida: "pedir_nueva_propuesta",
    acciones_alternativas: [],
    retryable: false,
  },
  ADJUNTO_INVALIDO: {
    mensaje_usuario: "Una de las imágenes adjuntas no se pudo usar. Prueba con fotos JPG, PNG o WebP más livianas.",
    accion_sugerida: "revisar_adjuntos",
    acciones_alternativas: [],
    retryable: false,
  },
  SOLICITUD_INVALIDA: {
    mensaje_usuario: "No pudimos procesar ese cambio. Recarga la página e inténtalo de nuevo.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: false,
  },
  SERVICIO_NO_DISPONIBLE: {
    mensaje_usuario: "El servicio no respondió. Intenta de nuevo en un momento.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: true,
  },
  SERVICIO_OCUPADO: {
    mensaje_usuario: "Hay mucha demanda en este momento. Intenta de nuevo en unos minutos.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: true,
  },
  TIEMPO_AGOTADO: {
    mensaje_usuario: "Esto tardó más de lo esperado. Intenta de nuevo.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: true,
  },
  CONTENIDO_NO_PERMITIDO: {
    mensaje_usuario: "No pudimos crear esto con la descripción actual. Prueba contándolo de otra forma.",
    accion_sugerida: "ajustar_propuesta",
    acciones_alternativas: [],
    retryable: false,
  },
  SIN_CONEXION: {
    mensaje_usuario: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: true,
  },
  OPERACION_CANCELADA: {
    mensaje_usuario: "Cancelaste la creación de la imagen.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: true,
  },
  ERROR_INTERNO: {
    mensaje_usuario: "Algo no salió bien de nuestro lado. Intenta de nuevo.",
    accion_sugerida: "reintentar",
    acciones_alternativas: [],
    retryable: true,
  },
  // The image provider refused the account (no balance or no access). Added to
  // ui-error.v1 as a new code: consumers that do not know it fall back to their
  // local message via `leerUiErrorV1`, so the change is backward compatible.
  VISTA_PREVIA_NO_DISPONIBLE: {
    mensaje_usuario: "La vista previa de la imagen no está disponible por ahora. Tu propuesta y su precio quedan guardados.",
    accion_sugerida: null,
    acciones_alternativas: [],
    retryable: false,
  },
};

const LIMITE_DETALLE_DEV = 2000;

export function construirUiErrorV1(
  code: UiErrorCodeV1,
  detalles: { mensaje: string; codigoOrigen?: string; causa?: string; requestId?: string },
): UiErrorV1 {
  const entrada = CATALOGO_ERRORES_UI_V1[code];
  const mensaje = detalles.mensaje.trim() || entrada.mensaje_usuario;
  return UiErrorV1Schema.parse({
    schema_version: UI_ERROR_CONTRACT_VERSION,
    code,
    mensaje_usuario: entrada.mensaje_usuario,
    accion_sugerida: entrada.accion_sugerida,
    acciones_alternativas: [...entrada.acciones_alternativas],
    retryable: entrada.retryable,
    ...(detalles.requestId ? { request_id: detalles.requestId } : {}),
    detalles_dev: {
      mensaje: mensaje.length > LIMITE_DETALLE_DEV ? `${mensaje.slice(0, LIMITE_DETALLE_DEV - 1)}…` : mensaje,
      ...(detalles.codigoOrigen ? { codigo_origen: detalles.codigoOrigen.slice(0, 120) } : {}),
      ...(detalles.causa ? { causa: detalles.causa.slice(0, 120) } : {}),
    },
  });
}

/**
 * Lee `ui_error` de un cuerpo de respuesta desconocido. Devuelve null si no
 * viene o no cumple el contrato; el consumidor decide qué error local mostrar
 * en ese caso (nunca el texto técnico crudo).
 */
export function leerUiErrorV1(cuerpo: unknown): UiErrorV1 | null {
  if (typeof cuerpo !== "object" || cuerpo === null || !("ui_error" in cuerpo)) return null;
  const parsed = UiErrorV1Schema.safeParse(cuerpo.ui_error);
  return parsed.success ? parsed.data : null;
}

/** Traducción de los códigos del sobre de error del chat (error.v1 / chat.sse.v1). */
const CODIGO_UI_DESDE_CHAT: Readonly<Record<string, UiErrorCodeV1>> = {
  INVALID_JSON: "SOLICITUD_INVALIDA",
  INVALID_INPUT: "SOLICITUD_INVALIDA",
  PAYLOAD_TOO_LARGE: "ADJUNTO_INVALIDO",
  UNAUTHORIZED: "SOLICITUD_INVALIDA",
  INVALID_ORIGIN: "SOLICITUD_INVALIDA",
  AI_KEY_MISSING: "SERVICIO_NO_DISPONIBLE",
  AI_QUOTA: "SERVICIO_OCUPADO",
  AI_FILTERED: "CONTENIDO_NO_PERMITIDO",
  AI_TIMEOUT: "TIEMPO_AGOTADO",
  AI_NETWORK: "SERVICIO_NO_DISPONIBLE",
  AI_PROVIDER: "SERVICIO_NO_DISPONIBLE",
  RAG_UNAVAILABLE: "SERVICIO_NO_DISPONIBLE",
  TOOL_NOT_FOUND: "ERROR_INTERNO",
  INVALID_TOOL_ARGUMENTS: "ERROR_INTERNO",
  CLIENT_CANCELLED: "OPERACION_CANCELADA",
  INTERNAL_ERROR: "ERROR_INTERNO",
};

export function uiErrorDesdeChatV1(evento: { code?: string; error?: string; causa?: string; request_id?: string }): UiErrorV1 {
  const code = (evento.code && CODIGO_UI_DESDE_CHAT[evento.code]) || "ERROR_INTERNO";
  return construirUiErrorV1(code, {
    mensaje: evento.error ?? "El chat devolvió un error sin detalle.",
    codigoOrigen: evento.code,
    causa: evento.causa,
    requestId: evento.request_id,
  });
}
