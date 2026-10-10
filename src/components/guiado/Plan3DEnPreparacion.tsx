import { Hourglass } from "lucide-react";

/**
/**
 * Un plan armado por el motor 3D (REQ-007) tiene su vista 3D (fase 3, carpeta `motor3d/`), su imagen realista (fase 4, por
 * `/api/guiada/motor/imagen`) y sus cambios (fase 5, por `/api/guiada/motor/editar`): la tarjeta nunca muestra un dibujo que
 * no es el del plan ni manda el plan a Python. `VistaPlanEnPreparacion` queda solo para el plan 3D que no trae su espec
 * firmada (guardado antes de la fase 3): sin ella tampoco hay imagen ni cambios.
 * Lo que sí tiene: la vista, piezas, globos por color y tamaño, precio, compra, imagen y cambios.
 */
export const TEXTO_VISTA_EN_PREPARACION = "Vista del plan en preparación";
export const TEXTO_NOTA_PLAN_3D = "Puedes mirar tu decoración, cambiar sus colores, tamaños y piezas, ver cuántos globos lleva cada pieza, cuánto cuesta, dónde comprarlo y cómo quedaría en una imagen realista.";

/** Lo que se le dice al cliente cuando pide la imagen de un plan 3D guardado sin su espec firmada (no hay de dónde armarla). */
export const TEXTO_IMAGEN_PLAN_3D = "No puedo dibujar este plan como imagen: se guardó antes de que pudiera. Mientras tanto puedes ver sus globos, su precio y dónde comprarlo, o pedirme un plan nuevo.";

/**
 * Lo que se le dice al cliente cuando su plan del 3D se rehízo entero con Python (el corte del 3D, ya avisado, o un 3D que no
 * pudo): el precio puede moverse bastante, así que se dice sin quitarle importancia (D-023).
 */
export const TEXTO_REHECHO_EN_PYTHON = "Rehice tu plan completo con el método de siempre, así que las cantidades y el precio pueden cambiar respecto al anterior.";

/** El marcador de la vista del plan: una sola vez por tarjeta, bajo las piezas. */
export function VistaPlanEnPreparacion() {
  return (
    <div role="status" data-testid="vista-plan-en-preparacion" className="mt-2.5 flex items-center gap-2.5 rounded-2xl border border-dashed border-borde-suave bg-superficie-suave px-3.5 py-3 text-sm text-texto-suave">
      <Hourglass className="size-4 shrink-0 text-acento" aria-hidden />
      <span>{TEXTO_VISTA_EN_PREPARACION}</span>
    </div>
  );
}

/** Lo que el cliente puede hacer con un plan del motor 3D (y por qué la vista previa puede faltar). */
export function NotaPlan3D() {
  return <p data-testid="nota-plan-3d" role="note" className="rounded-xl bg-acento-suave px-3 py-2 text-xs text-acento">{TEXTO_NOTA_PLAN_3D}</p>;
}

/** La vista del plan 3D no se pudo dibujar (la aprobación venció, la red cayó o el navegador no pudo): el plan y su precio siguen ahí. */
export const TEXTO_VISTA_NO_DISPONIBLE = "No pude dibujar la vista de este plan ahora. Sus globos, su precio y dónde comprarlo siguen aquí.";

export function VistaPlanNoDisponible() {
  return (
    <div role="status" data-testid="vista-plan-no-disponible" className="mt-2.5 flex items-center gap-2.5 rounded-2xl border border-dashed border-borde-suave bg-superficie-suave px-3.5 py-3 text-sm text-texto-suave">
      <Hourglass className="size-4 shrink-0 text-acento" aria-hidden />
      <span>{TEXTO_VISTA_NO_DISPONIBLE}</span>
    </div>
  );
}
