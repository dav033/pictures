"use client";

import { FLOTANTE } from "../ui-taller";

const OPCION = "min-h-10 rounded-lg px-3 text-sm font-medium lg:min-h-8";

/**
 * Sobre el visor mientras se ve la escena de antes de un turno de la IA: un interruptor Antes | Después (Esc también vuelve). Los
 * paneles de los lados quedan inertes mientras tanto: muestran la escena de ahora y no se editan sobre lo que se ve.
 */
export function BannerVerAntes({ numero, alVolver }: { numero: number; alVolver: () => void }) {
  return (
    <div role="group" aria-label={`Escena antes o después del turno ${numero}`} className={`absolute left-1/2 top-16 z-30 flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 rounded-xl p-1 ${FLOTANTE}`}>
      <span className="px-2 text-xs text-taller-suave max-sm:hidden">Turno {numero}</span>
      <button type="button" aria-pressed className={`${OPCION} bg-taller-primario text-taller-sobre-primario`}>Antes</button>
      <button type="button" aria-pressed={false} onClick={alVolver} className={`${OPCION} text-taller-texto hover:bg-taller-encima`} title="Volver a la escena de ahora (Esc)">Después</button>
    </div>
  );
}
