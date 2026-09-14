"use client";

import type { ModoVista } from "@/lib/estado/modo-vista";

type Props = {
  modo: ModoVista;
  onCambiar: (modo: ModoVista) => void;
};

/**
 * Switch accesible USUARIO/DEV: `role="switch"` con `aria-checked`, operable
 * con Tab y Espacio/Enter (es un <button>) y con foco visible.
 */
export function SwitchModoVista({ modo, onCambiar }: Props) {
  const esDev = modo === "dev";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={esDev}
      data-testid="switch-modo-vista"
      title={esDev ? "Modo dev: se muestran controles y datos técnicos" : "Modo usuario: vista del cliente"}
      onClick={() => onCambiar(esDev ? "usuario" : "dev")}
      className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-medium text-texto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${esDev ? "bg-acento" : "bg-borde"}`}
      >
        <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${esDev ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
      Modo dev
    </button>
  );
}
