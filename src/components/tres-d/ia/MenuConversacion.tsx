"use client";

import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";

const ITEM = "flex min-h-10 w-full items-center rounded-lg px-2.5 text-left text-[13px] text-taller-texto hover:bg-taller-encima";

/**
 * El menú «⋯» de la conversación. «Borrar la conversación» pide confirmar (borra los turnos y sus «Deshacer turno», no la
 * escena). Abre hacia arriba en el teléfono, donde el botón queda al pie de la hoja.
 */
export function MenuConversacion({ alBorrar, deshabilitado, haciaArriba }: { alBorrar: () => void; deshabilitado: boolean; haciaArriba: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false); };
    window.addEventListener("pointerdown", fuera, true);
    return () => window.removeEventListener("pointerdown", fuera, true);
  }, [abierto]);
  const cerrar = () => { setAbierto(false); setConfirmando(false); };
  return (
    <div ref={raiz} className="relative shrink-0" onKeyDown={(e) => { if (e.key === "Escape" && abierto) { e.stopPropagation(); cerrar(); } }}>
      <button type="button" onClick={() => { setAbierto(!abierto); setConfirmando(false); }} disabled={deshabilitado} aria-haspopup="menu" aria-expanded={abierto} aria-label="Más opciones de la conversación"
        className="grid size-10 place-items-center rounded-lg text-taller-suave hover:bg-taller-encima hover:text-taller-texto disabled:opacity-45 lg:size-8"><Ellipsis className="size-4" aria-hidden /></button>
      {abierto && (
        <div role="menu" aria-label="Conversación" className={`absolute right-0 z-40 w-60 rounded-xl border border-taller-borde bg-taller-boton p-1.5 shadow-[0_12px_30px_var(--sombra)] ${haciaArriba ? "bottom-full mb-1" : "top-full mt-1"} max-lg:left-0 max-lg:right-auto`}>
          {confirmando ? (
            <div className="grid gap-1.5 p-1" role="alertdialog" aria-label="Confirmar el borrado">
              <p className="text-xs text-taller-texto">¿Borrar la conversación? La escena no cambia, pero ya no podrás deshacer esos turnos desde aquí.</p>
              <div className="flex gap-1.5">
                <button type="button" autoFocus onClick={() => { cerrar(); alBorrar(); }} className="min-h-10 flex-1 rounded-lg border border-taller-peligro/60 px-2 text-xs font-medium text-taller-peligro hover:bg-taller-encima">Sí, borrar</button>
                <button type="button" onClick={cerrar} className="min-h-10 flex-1 rounded-lg border border-taller-borde px-2 text-xs hover:bg-taller-encima">Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" role="menuitem" autoFocus onClick={() => setConfirmando(true)} className={ITEM}>Borrar la conversación…</button>
          )}
        </div>
      )}
    </div>
  );
}
