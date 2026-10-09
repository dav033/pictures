import { Hourglass } from "lucide-react";

/**
 * Un plan armado por el motor 3D (REQ-007) todavía no tiene su vista 3D (fase 3), ni imagen con IA (fase 4), ni cambios
 * (fase 5): la tarjeta lo dice con honestidad en vez de mostrar un dibujo que no es el del plan o mandar el plan a Python.
 * Lo que sí tiene: piezas, globos por color y tamaño, precio y compra.
 */
export const TEXTO_VISTA_EN_PREPARACION = "Vista del plan en preparación";
export const TEXTO_NOTA_PLAN_3D = "Por ahora puedes ver cuántos globos lleva cada pieza, cuánto cuesta y dónde comprarlo. La imagen de cómo quedaría y los cambios a este plan estarán pronto.";

/** Lo que se le dice al cliente cuando pide la imagen o un cambio de un plan del motor 3D (por chat, por voz o por un botón viejo). */
export const TEXTO_IMAGEN_PLAN_3D = "La imagen de cómo quedaría este plan todavía está en preparación. Mientras tanto puedes ver sus globos, su precio y dónde comprarlo.";
export const TEXTO_EDICION_PLAN_3D = "Los cambios a este plan todavía están en preparación, así que no lo toqué. Si quieres otra cosa, puedo armar un plan nuevo.";

/** Lo que se le dice al cliente cuando su plan del 3D se rehízo entero con el motor de siempre (marcha atrás o un 3D que no pudo). */
export const TEXTO_REHECHO_EN_PYTHON = "Rehice tu plan completo con el motor de siempre, así que algunas cantidades pueden cambiar un poco.";

/** El marcador de la vista del plan: una sola vez por tarjeta, bajo las piezas. */
export function VistaPlanEnPreparacion() {
  return (
    <div role="status" data-testid="vista-plan-en-preparacion" className="mt-2.5 flex items-center gap-2.5 rounded-2xl border border-dashed border-borde-suave bg-superficie-suave px-3.5 py-3 text-sm text-texto-suave">
      <Hourglass className="size-4 shrink-0 text-acento" aria-hidden />
      <span>{TEXTO_VISTA_EN_PREPARACION}</span>
    </div>
  );
}

/** Por qué «Ver cómo quedaría» y «Cambiar algo» están apagados en un plan del motor 3D. */
export function NotaPlan3D() {
  return <p data-testid="nota-plan-3d" role="note" className="rounded-xl bg-acento-suave px-3 py-2 text-xs text-acento">{TEXTO_NOTA_PLAN_3D}</p>;
}
