import type { Mensaje } from "@/lib/ia/tipos";

/**
 * Final customer text of a chat turn (E2E 2026-09-15). Two regressions:
 *
 * - D2 "turno en blanco": after a SIN_COBERTURA refusal the model ended the turn
 *   with an empty text, no plan and no error, and the chat showed only the
 *   assistant steps. A turn never ends empty: the fallback reuses the last
 *   customer message a plan tool returned (`mensaje_cliente`, already written
 *   for the customer) and asks how to go on; without one it asks the customer to
 *   rephrase.
 * - D3 "cambio afirmado": three refusals and no plan in the turn, yet the model
 *   answered "Cambié todos los detalles plateados por blanco". When no plan was
 *   confirmed in this turn, a first-person claim that a change was applied
 *   ("cambié", "actualicé", "he reemplazado"…) is replaced by an honest text.
 *   The accent is part of the rule: "¿quieres que cambie…?" (subjunctive) is a
 *   question, "cambié" is a claim.
 *
 * Pure: no provider, HTTP, database or environment.
 */

export type EstadoTextoFinal = {
  /** A plan was verified and signed in this turn. */
  planConfirmado: boolean;
  /** A visual selection was confirmed in this turn (legacy selection mode). */
  seleccionConfirmada: boolean;
};

export const TEXTO_PLAN_LISTO = "Ya te armé la propuesta: revisa el desglose en pantalla y dime si la apruebas o qué quieres ajustar.";
export const TEXTO_SELECCION_LISTA = "¡Ya elegí las piezas y se está generando tu visualización! Dame un momento.";
export const TEXTO_SIN_RESPUESTA = "No logré terminar la propuesta en este intento. ¿Me cuentas otra vez qué piezas y colores quieres para intentarlo de nuevo?";
export const PREGUNTA_CONTINUAR = "¿Quieres que lo intente con otras piezas o colores, o prefieres ajustar algo de tu pedido?";
export const TEXTO_CAMBIO_NO_APLICADO = "Todavía no pude aplicar ese cambio a la propuesta.";

/**
 * First-person past claims of an applied change: the preterite with its written
 * accent ("cambié", "quité", "sustituí") or the perfect ("he cambiado").
 */
const AFIRMA_CAMBIO = new RegExp(
  `(?:^|[^\\p{L}])(?:(?:cambi|actualic|reemplac|modifiqu|ajust|quit|agregu|elimin|aument|reduj)é|sustituí|añadí|apliqué)(?:[^\\p{L}]|$)`
  + `|(?:^|[^\\p{L}])(?:ya\\s+)?(?:he|hemos)\\s+(?:cambiado|actualizado|reemplazado|sustituido|modificado|ajustado|quitado|agregado|añadido|aplicado|eliminado)(?:[^\\p{L}]|$)`,
  "iu",
);

/** Whether an assistant text claims, in first person, a change it applied. */
export function afirmaCambioAplicado(texto: string): boolean {
  return AFIRMA_CAMBIO.test(texto);
}

/** Tool results of the current turn: everything after the last customer message. */
function resultadosDelTurno(historial: readonly Mensaje[]): Array<{ nombre: string; resultado: unknown }> {
  let inicio = 0;
  historial.forEach((mensaje, indice) => {
    if (mensaje.rol === "usuario") inicio = indice + 1;
  });
  return historial.slice(inicio).flatMap((mensaje) => (mensaje.rol === "herramienta" ? [{ nombre: mensaje.nombre, resultado: mensaje.resultado }] : []));
}

/** The customer message of the last refused plan/selection tool call of the turn, if any. */
export function ultimoMensajeClienteDelTurno(historial: readonly Mensaje[]): string | null {
  const resultados = resultadosDelTurno(historial);
  for (let indice = resultados.length - 1; indice >= 0; indice -= 1) {
    const resultado = resultados[indice]!.resultado;
    if (!resultado || typeof resultado !== "object") continue;
    const { ok, mensaje_cliente: mensaje } = resultado as { ok?: unknown; mensaje_cliente?: unknown };
    if (ok === false && typeof mensaje === "string" && mensaje.trim()) return mensaje.trim();
  }
  return null;
}

/**
 * Texts written while the plan was still being adjusted ("Estoy buscando una
 * alternativa.") promise work that will not happen once the turn ends: those
 * sentences are dropped, what was found is kept, and the question asks the
 * customer how to go on.
 */
const PROMESA_DE_SEGUIR = /\b(?:estoy|sigo)\s+(?:buscando|ajustando)\b|\ben un momento\b|\benseguida\b/iu;

function sinPromesaDeSeguir(mensaje: string): string {
  return mensaje
    .split(/(?<=[.!?])\s+/u)
    .filter((frase) => frase.trim() && !PROMESA_DE_SEGUIR.test(frase))
    .join(" ")
    .trim();
}

function respaldoConMensaje(historial: readonly Mensaje[], encabezado?: string): string {
  const mensaje = ultimoMensajeClienteDelTurno(historial);
  const detalle = mensaje ? sinPromesaDeSeguir(mensaje) : "";
  const partes = [encabezado, detalle, detalle || encabezado ? PREGUNTA_CONTINUAR : TEXTO_SIN_RESPUESTA].filter((parte): parte is string => Boolean(parte));
  return partes.join(" ");
}

export function textoFinalTurno(texto: string, estado: EstadoTextoFinal, historial: readonly Mensaje[]): string {
  const limpio = texto.trim();
  if (!limpio) {
    if (estado.planConfirmado) return TEXTO_PLAN_LISTO;
    if (estado.seleccionConfirmada) return TEXTO_SELECCION_LISTA;
    return respaldoConMensaje(historial);
  }
  if (!estado.planConfirmado && !estado.seleccionConfirmada && afirmaCambioAplicado(limpio)) {
    return respaldoConMensaje(historial, TEXTO_CAMBIO_NO_APLICADO);
  }
  return texto;
}
