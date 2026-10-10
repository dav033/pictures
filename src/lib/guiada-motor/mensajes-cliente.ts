/**
 * Las frases «No pude: …» que el cliente lee cuando un cambio del plan 3D no se hace (REQ-007, fase 5). Sin `server-only`:
 * las usan el servidor (la ruta) y el navegador (la vista), que las muestran tal cual. Lo que el motor dice por dentro
 * (códigos de formato, «armado», «paleta», nombres de lista de materiales) se traduce aquí a palabras de cliente; el motivo
 * técnico queda en la auditoría, no en la respuesta.
 */
import { PREFIJO_NO_PUDE } from "@/lib/prefijo-no-pude";

export { PREFIJO_NO_PUDE };

const mayuscula = (texto: string): string => texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);

/**
 * Un plan del 3D ya abierto que deja el 3D (el corte del motor, o una línea que pasó su límite con la bandera en python;
 * P-045) solo puede cambiar recalculándolo entero con Python, y eso puede moverle las cantidades y el precio. El cliente lo
 * lee ANTES de que pase (D-023) y su plan queda como estaba; solo se recalcula si lo pide. Sin jerga: pasan el filtro de
 * `mensajeAjuste` tal cual.
 */
const RECALCULO = "tengo que volver a calcular tu plan completo con el método de siempre, y las cantidades y el precio pueden cambiar. Tu plan sigue como estaba";
/** El botón del aviso: tocarlo es pedir el recálculo. */
export const ETIQUETA_RECALCULAR = "Recalcular mi plan";
export const TITULO_AVISO_RECALCULO = "Antes de cambiar tu plan";
/** Al rehacer el plan (otra propuesta o una idea sumada): el detalle de la tarjeta de aviso, con su botón. */
export const TEXTO_AVISO_RECALCULO = `Para hacer ese cambio ${RECALCULO}. Si quieres que lo recalcule, toca «${ETIQUETA_RECALCULAR}» o vuelve a pedírmelo.`;
/** Al cambiarlo (chat o «Ajustar mi plan»): la respuesta de `/api/guiada/motor/editar`. */
export const TEXTO_EDICION_RECALCULO = `${PREFIJO_NO_PUDE}por ahora no puedo cambiar este plan tal como está: para hacerlo ${RECALCULO}; si quieres que lo recalcule, pídeme que lo arme de nuevo.`;
/**
 * El aviso de recálculo cuando el cliente no pidió ningún cambio (al cargar la conversación o al pedir una vista): el plan no
 * cambia. Dice «o vuelve a pedírmelo» porque leerlo ya cuenta como aviso: el siguiente cambio que pida se recalcula sin otro.
 */
export const TEXTO_AVISO_DIBUJO_RECALCULO = `Tu plan del 3D no se puede mostrar tal como está: ${RECALCULO}. Si quieres que lo recalcule, toca «${ETIQUETA_RECALCULAR}» o vuelve a pedírmelo.`;
/** Al dibujarlo (la armada o la imagen de un plan del 3D cortado): mismo aviso, con el verbo de dibujar. El plan no cambia. */
export const TEXTO_DIBUJO_RECALCULO = `${PREFIJO_NO_PUDE}por ahora no puedo dibujar este plan tal como está: para hacerlo ${RECALCULO}; si quieres que lo recalcule, pídeme que lo arme de nuevo.`;

/** Une las razones de un cambio que no se hizo (cada una ya dicha por el servidor) en una sola frase para el cliente. */
export function unirNoPude(frases: readonly string[]): string {
  return frases.map((frase, indice) => (indice === 0 ? frase : mayuscula(frase.replace(PREFIJO_NO_PUDE, "")))).join(" ");
}

const REGLAS_MOTIVO: ReadonlyArray<readonly [RegExp, string]> = [
  [/tope|pasa de/i, "esa pieza quedaría demasiado grande para el plan; prueba con un tamaño menor"],
  [/color|paleta|fabric|tienda|cobertura/i, "ese color no se puede armar en esa pieza; prueba con otro color"],
  [/medida|metro|diámetro|\balto\b|\bancho\b|\blargo\b/i, "esa medida no se puede armar; prueba con otra"],
];
const MOTIVO_GENERICO = "esa pieza no se puede armar con ese cambio";

/** El motivo técnico que dice el motor, en palabras del cliente (sin la frase «No pude»). Lo desconocido cae al genérico. */
export function motivoParaCliente(motivoTecnico: string): string {
  return REGLAS_MOTIVO.find(([patron]) => patron.test(motivoTecnico))?.[1] ?? MOTIVO_GENERICO;
}

/** La frase «No pude: …» de una lista de motivos técnicos: cada uno en palabras de cliente, sin repetir. */
export function noPudeDeMotivos(motivosTecnicos: readonly string[]): string {
  const frases = [...new Set(motivosTecnicos.map(motivoParaCliente))];
  return `${PREFIJO_NO_PUDE}${frases.join("; ")}.`;
}
