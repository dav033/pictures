import { ErrorImagen } from "@/lib/generacion/pedir-imagen";

/**
 * Qué le dice la guiada al cliente cuando «Ver cómo quedaría» falla, según POR QUÉ falló. Un rechazo del servidor (plan
 * alterado, plan con piezas que no se dibujan, tope del navegador…) no se arregla repitiendo la petición, así que ahí no se
 * ofrece reintentar; solo se reintenta lo que puede pasar solo: la red, el tiempo, un 5xx (502) y el tope global de la hora.
 * Los códigos son los de `imagen-motor.ts` (`CodigoImagenMotor`) y `feedback-ia/acceso.ts`.
 */
export type MensajeErrorImagen = { texto: string; reintentable: boolean };

const SE_PUEDE_REINTENTAR = "La imagen no alcanzó a llegar esta vez. Tu plan sigue guardado: toca «Reintentar imagen».";
const VUELVE_A_PREPARARLO = "Tu plan sigue guardado: vuelve a prepararlo para ver su imagen.";

const POR_CODIGO: Readonly<Record<string, string>> = {
  SESION_REQUERIDA: "Tu sesión venció. Recarga la página para entrar de nuevo y vuelve a pedir la imagen.",
  ORIGEN_NO_PERMITIDO: "Este navegador no puede pedir la imagen desde esta dirección. Abre la página desde su dirección habitual.",
  APROBACION_INVALIDA: `La aprobación de este plan venció o ya no le corresponde. ${VUELVE_A_PREPARARLO}`,
  PLAN_ALTERADO: `Este plan cambió desde que se preparó o es de una versión anterior del dibujo. ${VUELVE_A_PREPARARLO}`,
  PLAN_NO_ES_DEL_MOTOR_3D: `Este plan se armó de otra manera y su imagen no se pide desde aquí. ${VUELVE_A_PREPARARLO}`,
  ESPEC_INVALIDA: `No pude leer este plan para dibujarlo. ${VUELVE_A_PREPARARLO}`,
  CUERPO_INVALIDO: `No pude leer este plan para dibujarlo. ${VUELVE_A_PREPARARLO}`,
  CAPTURA_INVALIDA: "La vista del plan no se pudo leer como imagen. Recarga la página y pídela de nuevo.",
  PLAN_NO_REPRESENTABLE: "Este plan tiene piezas que todavía no se pueden dibujar como imagen. Tu plan y sus cantidades siguen válidos.",
  TOPE_DE_IMAGENES_NAVEGADOR: "Ya pediste varias imágenes en esta hora. Podrás pedir otra más tarde; tu plan sigue guardado.",
};
const SIN_REPETIR_NO_SE_PUDO = "No pude preparar la imagen de este plan y repetirlo daría lo mismo. Tu plan sigue guardado: prueba cambiando alguna pieza.";
const TOPE_GLOBAL = "Se alcanzó el límite de imágenes por hora del servicio. Tu plan sigue guardado: puedes reintentar en un rato con «Reintentar imagen».";
const SIN_CODIGO = "No se pudo dibujar la imagen de este plan. Tu plan sigue guardado.";

export function mensajeErrorImagen(causa: unknown): MensajeErrorImagen {
  if (!(causa instanceof ErrorImagen)) return { texto: SIN_CODIGO, reintentable: false };
  if (causa.clase === "cancelada") return { texto: "Se canceló la imagen.", reintentable: false };
  const { codigo, clase, status } = causa;
  // El tope global de la hora y el 502 del proveedor pasan solos: son lo único del servidor que se ofrece reintentar.
  if (codigo === "TOPE_DE_IMAGENES") return { texto: TOPE_GLOBAL, reintentable: true };
  if (codigo === "NO_SE_PUDO_DIBUJAR") return status === 502 ? { texto: SE_PUEDE_REINTENTAR, reintentable: true } : { texto: SIN_REPETIR_NO_SE_PUDO, reintentable: false };
  const propio = codigo ? POR_CODIGO[codigo] : undefined;
  if (propio) return { texto: propio, reintentable: false };
  if (clase === "rechazo") return { texto: SIN_CODIGO, reintentable: false };
  // Red, tiempo agotado, 5xx o una respuesta cortada: la misma petición puede salir bien.
  return { texto: SE_PUEDE_REINTENTAR, reintentable: true };
}
