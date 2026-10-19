"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { BTN_ICO } from "./ui-taller";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  /** Lo que va a la derecha del título (acciones del diálogo). */
  acciones?: ReactNode;
  /** Ancho máximo: cajón angosto a la derecha («cajon») o ventana grande centrada («grande»). */
  forma?: "cajon" | "grande" | "mediano";
  children: ReactNode;
};

const FORMA: Readonly<Record<NonNullable<Props["forma"]>, string>> = {
  cajon: "ml-auto mr-0 h-dvh max-h-dvh w-full max-w-[min(560px,100vw)] rounded-none sm:rounded-l-2xl",
  grande: "m-auto h-[min(92dvh,980px)] w-[min(1180px,100vw)] max-w-[100vw] rounded-none sm:rounded-2xl max-sm:h-dvh max-sm:max-h-dvh",
  mediano: "m-auto max-h-[min(92dvh,900px)] w-[min(720px,100vw)] max-w-[100vw] rounded-none sm:rounded-2xl max-sm:h-dvh max-sm:max-h-dvh",
};

/**
 * Diálogo modal del taller sobre el `<dialog>` nativo: el navegador atrapa el foco dentro, Esc lo cierra y al cerrarse
 * el foco vuelve a donde estaba. Va dentro de `.taller-3d` (hereda su paleta).
 */
export function DialogoTaller({ abierto, onCerrar, titulo, acciones, forma = "mediano", children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    else if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} aria-label={titulo} onCancel={(e) => { e.preventDefault(); onCerrar(); }} onClose={() => { if (abierto) onCerrar(); }}
      onClick={(e) => { if (e.target === ref.current) onCerrar(); }}
      className={`${FORMA[forma]} flex-col overflow-hidden border border-taller-borde bg-taller-panel p-0 text-taller-texto shadow-[0_18px_40px_var(--sombra)] backdrop:bg-overlay open:flex`}>
      {abierto && (
        <>
          <header className="flex shrink-0 items-center gap-2 border-b border-taller-linea px-4 py-3">
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{titulo}</h2>
            {acciones}
            <button type="button" onClick={onCerrar} aria-label="Cerrar" title="Cerrar (Esc)" className={BTN_ICO}><X className="size-4" aria-hidden /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </>
      )}
    </dialog>
  );
}
