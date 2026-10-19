"use client";

import { Info, RotateCcw } from "lucide-react";
import { EstadoGuardado, type VistaEstadoGuardado } from "../EstadoGuardado";

type Props = {
  /** Cómo va el autoguardado; `null` antes del primer cambio. */
  estado: VistaEstadoGuardado;
  /** La propuesta estaba aprobada y cambió: la imagen espera a "Regenerar visual". */
  avisoRegenerar: boolean;
  /** Hay un patrón en el editor que se puede quitar de la pieza. */
  puedeQuitar: boolean;
  puedeRestablecer: boolean;
  tituloRestablecer: string;
  onQuitar: () => void;
  onRestablecer: () => void;
  /** Se ve la sugerencia de Python sin tocar: todavía no está en la propuesta. Esto la pone tal cual. */
  onUsarSugerencia?: () => void;
  onListo: () => void;
};

/**
 * Pie del editor de patrón: el estado del guardado automático a la izquierda
 * (sin botón "Aplicar"), y "Quitar patrón", "Restablecer" y "Listo". Quitar y
 * restablecer también se guardan solos; "Listo" solo cierra. Una sugerencia
 * que nadie tocó no se guarda sola: se dice y "Usar sugerencia" la pone.
 */
export function PieEditorPatron({ estado, avisoRegenerar, puedeQuitar, puedeRestablecer, tituloRestablecer, onQuitar, onRestablecer, onUsarSugerencia, onListo }: Props) {
  return (
    <footer className="border-t border-borde-suave bg-superficie px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2.5 md:px-6 md:pb-4 md:pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-h-5 min-w-0 basis-full space-y-0.5 sm:flex-1 sm:basis-0">
          <EstadoGuardado estado={estado} data-testid="estado-patron" />
          {onUsarSugerencia && (
            <div data-testid="aviso-sugerencia" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-texto-suave">
              <span className="flex min-w-0 items-start gap-1.5">
                <Info className="mt-px size-3 shrink-0" aria-hidden="true" />Es una sugerencia: entra en tu propuesta cuando la ajustes o la uses.
              </span>
              <button
                type="button"
                onClick={onUsarSugerencia}
                data-testid="usar-sugerencia"
                className="inline-flex min-h-6 shrink-0 items-center rounded-full px-2.5 font-semibold text-acento ring-1 ring-acento/40 ring-inset hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento"
              >
                Usar sugerencia
              </button>
            </div>
          )}
          {avisoRegenerar && (
            <p data-testid="aviso-regenerar" className="flex items-start gap-1.5 text-[11px] text-texto-suave">
              <Info className="mt-px size-3 shrink-0" aria-hidden="true" />La imagen se actualiza cuando pulses Regenerar visual.
            </p>
          )}
        </div>
        <div className="flex w-full items-center gap-1.5 sm:w-auto sm:gap-2">
          {puedeQuitar && (
            <button type="button" onClick={onQuitar} data-testid="quitar-patron" className="h-10 rounded-[0.8rem] px-2.5 text-[13px] font-medium text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento sm:px-3">
              Quitar patrón
            </button>
          )}
          <button
            type="button"
            onClick={onRestablecer}
            disabled={!puedeRestablecer}
            title={tituloRestablecer}
            data-testid="restablecer-patron"
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-[0.8rem] px-2 text-[13px] font-medium text-texto-suave hover:bg-superficie-2 hover:text-texto focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40 sm:px-3"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />Restablecer
          </button>
          <button type="button" onClick={onListo} data-testid="listo-patron" className="ui-button-primary ui-pressable h-10 px-5">
            Listo
          </button>
        </div>
      </div>
    </footer>
  );
}
