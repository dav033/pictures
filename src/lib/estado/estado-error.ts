import { uiErrorDesdeChatV1, type AccionUiV1, type UiErrorCodeV1, type UiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";

/** Dónde ocurrió el error visible: decide el título por defecto y qué acciones se pueden ejecutar. */
export type OrigenError = "chat" | "generacion" | "catalogo" | "plan";

export type VarianteEstadoError = "error" | "aviso";

export type PresentacionError = {
  titulo: string;
  /** Siempre el texto redactado de ui-error.v1: nunca el mensaje técnico. */
  mensaje: string;
  /** Principal primero; como máximo dos. */
  acciones: AccionUiV1[];
  /** "aviso": algo no está disponible pero lo demás sigue funcionando (p. ej. la vista previa). */
  variante: VarianteEstadoError;
};

export const ETIQUETA_ACCION_ERROR: Readonly<Record<AccionUiV1, string>> = {
  reintentar: "Reintentar",
  generar_estilo_estandar: "Generar con estilo estándar",
  revisar_propuesta: "Ver propuesta",
  pedir_nueva_propuesta: "Pedir la propuesta de nuevo",
  ajustar_propuesta: "Ajustar propuesta",
  activar_validacion_visual: "Activar revisión de calidad",
  revisar_adjuntos: "Revisar imágenes",
};

const TITULO_POR_CODIGO: Partial<Readonly<Record<UiErrorCodeV1, string>>> = {
  VISTA_PREVIA_NO_DISPONIBLE: "Tu propuesta está lista, pero la imagen no se puede crear ahora",
  ADJUNTO_INVALIDO: "No pude usar tu foto",
  SIN_CONEXION: "Sin conexión",
  TIEMPO_AGOTADO: "Esto tardó más de lo esperado",
  SERVICIO_OCUPADO: "Hay mucha demanda ahora",
  SERVICIO_NO_DISPONIBLE: "No hubo respuesta",
  PRESUPUESTO_EXCEDIDO: "La propuesta supera tu presupuesto",
  OPERACION_CANCELADA: "Creación de la imagen cancelada",
  PROPUESTA_DESACTUALIZADA: "La propuesta cambió",
  IMAGEN_NO_FIEL: "La imagen no quedó fiel",
  CONTENIDO_NO_PERMITIDO: "No pude crear esto así",
};

const TITULO_POR_ORIGEN: Readonly<Record<OrigenError, string>> = {
  chat: "No pude responder",
  generacion: "No se pudo crear la imagen",
  catalogo: "No pude cargar el catálogo",
  plan: "Falta un paso antes de crear la imagen",
};

/** Códigos que no son una falla de la conversación: la propuesta sigue siendo válida. */
const CODIGOS_AVISO: ReadonlySet<UiErrorCodeV1> = new Set(["VISTA_PREVIA_NO_DISPONIBLE", "OPERACION_CANCELADA", "VALIDACION_VISUAL_REQUERIDA"]);

/**
 * Traduce un ui-error.v1 (del servidor o local) a lo que muestra `EstadoError`.
 * Solo se ofrecen acciones que el origen sabe ejecutar, y nunca "Reintentar"
 * en un error que el contrato marca como no reintentable (p. ej. fal sin saldo).
 */
export function presentarError(ui: UiErrorV1, origen: OrigenError, accionesDisponibles: ReadonlySet<AccionUiV1>): PresentacionError {
  const acciones = [ui.accion_sugerida, ...ui.acciones_alternativas]
    .filter((accion): accion is AccionUiV1 => accion !== null && accionesDisponibles.has(accion))
    .filter((accion) => ui.retryable || accion !== "reintentar");
  return {
    titulo: TITULO_POR_CODIGO[ui.code] ?? TITULO_POR_ORIGEN[origen],
    mensaje: ui.mensaje_usuario,
    acciones: [...new Set(acciones)].slice(0, 2),
    variante: CODIGOS_AVISO.has(ui.code) ? "aviso" : "error",
  };
}

/**
 * Texto del cliente cuando el origen marca el error como no reintentable pero
 * el catálogo lo redacta invitando a «intentar de nuevo» (p. ej. un
 * INTERNAL_ERROR del chat con `retryable: false`, E2E real 3).
 */
const MENSAJE_NO_REINTENTABLE_GENERACION: Partial<Readonly<Record<UiErrorCodeV1, string>>> = {
  ERROR_INTERNO: "Algo no salió bien de nuestro lado al crear la imagen. Tu propuesta y su precio quedan guardados.",
  TIEMPO_AGOTADO: "Crear la imagen tardó más de lo esperado. Tu propuesta y su precio quedan guardados.",
};

const MENSAJE_NO_REINTENTABLE: Partial<Readonly<Record<UiErrorCodeV1, string>>> = {
  ERROR_INTERNO: "Algo no salió bien de nuestro lado con este pedido. Prueba contarlo de otra forma.",
  TIEMPO_AGOTADO: "Esto tardó más de lo esperado. Prueba pedirlo de otra forma o con menos detalles.",
  SERVICIO_NO_DISPONIBLE: "El servicio no está disponible por ahora. Tu conversación queda guardada; vuelve más tarde.",
  SERVICIO_OCUPADO: "Hay mucha demanda en este momento. Tu conversación queda guardada; vuelve más tarde.",
  SIN_CONEXION: "No pudimos conectarnos. Revisa tu conexión.",
  OPERACION_CANCELADA: "Cancelaste la creación de la imagen.",
};

/**
 * Aplica el `retryable` que declaró el origen (evento SSE `error`, cuerpo de
 * /api/generate) sobre el ui-error.v1 construido desde el catálogo. Con
 * `false` nunca queda «reintentar» como acción ni un texto que invite a
 * reintentar; la acción sugerida del contrato que no sea reintentar se
 * conserva. Sin el campo, manda el catálogo.
 */
export function respetarReintentable(ui: UiErrorV1, retryable: boolean | undefined, origen: OrigenError = "chat"): UiErrorV1 {
  if (retryable === undefined || retryable === ui.retryable) return ui;
  if (retryable) return { ...ui, retryable: true };
  return {
    ...ui,
    retryable: false,
    accion_sugerida: ui.accion_sugerida === "reintentar" ? null : ui.accion_sugerida,
    acciones_alternativas: ui.acciones_alternativas.filter((accion) => accion !== "reintentar"),
    mensaje_usuario: (origen === "generacion" ? MENSAJE_NO_REINTENTABLE_GENERACION[ui.code] : undefined) ?? MENSAJE_NO_REINTENTABLE[ui.code] ?? ui.mensaje_usuario,
  };
}

/** ui-error.v1 de un evento `error` del chat (o su sobre JSON) respetando su `retryable`. */
export function uiErrorDesdeEventoChat(evento: { code?: string; error?: string; causa?: string; request_id?: string; retryable?: boolean }): UiErrorV1 {
  return respetarReintentable(uiErrorDesdeChatV1(evento), evento.retryable);
}
