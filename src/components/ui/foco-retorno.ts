"use client";

import { useRef } from "react";

/**
 * Focus return for Radix dialogs opened from page state instead of a
 * `Dialog.Trigger`. Radix restores focus to the element focused when the
 * content mounted; in development React runs mount effects twice and that
 * element ends up being one inside the dialog, so closing left focus on
 * <body>. This remembers the opener outside the dialog and focuses it on close
 * (falling back to Radix when it is gone, e.g. a closed menu item).
 */
export function useFocoDeRetorno(): { onOpenAutoFocus: () => void; onCloseAutoFocus: (evento: Event) => void } {
  const origen = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const activo = document.activeElement;
      if (activo instanceof HTMLElement && activo !== document.body && !activo.closest("[role='dialog']")) origen.current = activo;
    },
    onCloseAutoFocus: (evento) => {
      const destino = origen.current;
      origen.current = null;
      if (!destino?.isConnected) return;
      evento.preventDefault();
      destino.focus();
    },
  };
}
