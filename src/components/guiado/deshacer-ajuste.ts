import type { WidgetGuiado } from "@/lib/ia/guiado/widgets";

/**
 * Deshacer un ajuste de un plan del motor 3D (REQ-016, P-042). Un ajuste inverso no sirve para deshacer: agrandar y achicar un
 * paso no vuelve a la medida de antes (los pasos se redondean y se acotan) y volver a un color por su nombre puede dar otro
 * código o fundir dos. Por eso la vista guarda el plan que el cliente tenía ANTES de cada ajuste —el mismo plan firmado,
 * con su espec, su hash, su token y su cotización— y deshacer es ponerlo de nuevo: la espec queda idéntica, sin pasar por el
 * servidor ni por el motor.
 *
 * La pila vive en la memoria de la vista y NO se guarda en la sesión del navegador: un plan guardado lleva esquemas estrictos
 * que un despliegue anterior no leería (D-035), y una espec entera por paso pesaría mucho en el almacenamiento. Tras recargar
 * no hay nada que deshacer y se dice así, sin inventar un éxito. Puro (sin React ni red): lo importan la vista y las pruebas.
 */

/** El widget del plan, tal como lo guarda la conversación. */
export type WidgetDelPlan = Extract<WidgetGuiado, { tipo: "plan" }>;

/** Cuántos ajustes seguidos se pueden deshacer: los mismos que «Último ajuste» recuerda en el widget. */
export const MAX_AJUSTES_DESHACER = 4;

/** `previo`: el widget de antes del ajuste; `despuesHash`: el hash del plan que ese ajuste dejó (solo sobre él se deshace). */
type PasoDeshacer = { previo: WidgetDelPlan; despuesHash: string };
export type PilaDeshacer = readonly PasoDeshacer[];

export type ResultadoDeshacer =
  | { ok: true; widget: WidgetDelPlan; pila: PilaDeshacer }
  | { ok: false; codigo: "sin_plan_de_antes" | "plan_cambio" | "aprobacion_vencida"; mensaje: string; pila: PilaDeshacer };

/** La aprobación del plan de antes ya venció (o está por vencer): volver a él dejaría un plan que el servidor ya no acepta. */
const APROBACION_VENCIDA = "No pude deshacer: la aprobación de tu plan de antes ya venció y no podrías seguir con él. Tu plan sigue como está; si lo necesitas, pídeme que lo recalcule.";
/** Margen para que el plan restaurado todavía se pueda usar (pedir la imagen, ajustar, comprar) después de deshacer. */
const MARGEN_APROBACION_MS = 5 * 60 * 1000;

const SIN_PLAN_DE_ANTES = "No pude deshacer: ya no tengo guardado tu plan de antes (se pierde al recargar la página). Tu plan sigue como está.";
const PLAN_CAMBIO = "No pude deshacer: tu plan cambió después de ese ajuste y ya no puedo volver al de antes. Tu plan sigue como está.";

/**
 * El vencimiento (ms) que dice el token de aprobación, solo como pista de interfaz: el servidor es quien lo comprueba de verdad
 * (`verificarTokenAprobacion`). El token es `carga.firma` y la carga es JSON en base64url; sin forma conocida, null.
 */
export function vencimientoDelToken(token: string): number | null {
  try {
    const carga = token.split(".")[0] ?? "";
    const binario = atob(carga.replaceAll("-", "+").replaceAll("_", "/"));
    const texto = new TextDecoder().decode(Uint8Array.from(binario, (letra) => letra.charCodeAt(0)));
    const { expiresAt } = JSON.parse(texto) as { expiresAt?: unknown };
    return typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

/** El paso que se deshace ahora: el último, si el plan que se ve todavía es el que dejó ese ajuste y es del 3D. */
function ultimoPaso(pila: PilaDeshacer, actual: WidgetDelPlan): PasoDeshacer | null {
  const paso = pila.at(-1);
  return paso && actual.motor === "3d" && !actual.reemplazado && paso.despuesHash === actual.plan.plan_hash ? paso : null;
}

/**
 * Guarda el widget de `previo` antes de publicar el plan de `despuesHash`. Solo planes del 3D (la espec y el servidor del 3D
 * son los de P-042) y solo si el ajuste cambió el plan; la pila no pasa de `MAX_AJUSTES_DESHACER` (sale el más viejo).
 */
export function recordarParaDeshacer(pila: PilaDeshacer, previo: WidgetDelPlan, despuesHash: string): PilaDeshacer {
  if (previo.motor !== "3d" || previo.plan.plan_hash === despuesHash) return pila;
  return [...pila, { previo, despuesHash }].slice(-MAX_AJUSTES_DESHACER);
}

/** Si «Deshacer» tiene un plan de antes al que volver sobre el plan que se ve. */
export function puedeDeshacer(pila: PilaDeshacer, actual: WidgetDelPlan): boolean {
  return ultimoPaso(pila, actual) !== null;
}

/**
 * El widget del plan de antes del último ajuste. Vuelve el plan, su cotización, sus pasos, su «Último ajuste» y lo que traía
 * (la propuesta, las ideas sumadas, el total anterior): lo que el cliente veía. Se queda lo que el cliente hizo después y no
 * depende del plan (su uso, la compra abierta, lo ya hecho) y no vuelve la imagen: era de un plan que ya no es el de la
 * tarjeta y «Ver cómo quedaría» vuelve a ser la acción principal, como tras cualquier ajuste.
 */
export function deshacerAjuste(pila: PilaDeshacer, actual: WidgetDelPlan, ahora: number = Date.now()): ResultadoDeshacer {
  const paso = ultimoPaso(pila, actual);
  if (!paso) return pila.length ? { ok: false, codigo: "plan_cambio", mensaje: PLAN_CAMBIO, pila: [] } : { ok: false, codigo: "sin_plan_de_antes", mensaje: SIN_PLAN_DE_ANTES, pila: [] };
  // El token de un plan de antes puede vencer antes que el del plan que se ve (cada ajuste firma uno nuevo): se rechaza sin tocar nada.
  const vence = vencimientoDelToken(paso.previo.plan.approval_token);
  // Los planes más viejos de la pila vencieron todavía antes: no queda nada que restaurar.
  if (vence !== null && vence - ahora < MARGEN_APROBACION_MS) return { ok: false, codigo: "aprobacion_vencida", mensaje: APROBACION_VENCIDA, pila: [] };
  const widget: WidgetDelPlan = { ...paso.previo };
  delete widget.imagen;
  delete widget.errorImagen;
  delete widget.falloImagen;
  delete widget.avisoImagen;
  delete widget.reemplazado;
  // Lo del cliente, tal como está ahora (no como estaba cuando se hizo el ajuste).
  delete widget.usoCosteo;
  delete widget.compraAbierta;
  delete widget.hechas;
  const hechas = (actual.hechas ?? []).filter((hecha) => hecha !== "ver");
  if (actual.usoCosteo) widget.usoCosteo = actual.usoCosteo;
  if (actual.compraAbierta) widget.compraAbierta = true;
  if (hechas.length) widget.hechas = hechas;
  return { ok: true, widget, pila: pila.slice(0, -1) };
}
