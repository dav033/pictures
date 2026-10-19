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
      // A development control in the customer's header: discreet until it is on.
      className={`inline-flex h-9 items-center gap-2 rounded-[0.7rem] px-2 text-[0.8125rem] text-texto-suave hover:bg-superficie-2 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${esDev ? "" : "opacity-40"}`}
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${esDev ? "bg-acento" : "bg-superficie-2 ring-1 ring-borde ring-inset"}`}
      >
        <span className={`inline-block size-3 rounded-full transition-transform ${esDev ? "translate-x-3.5 bg-sobre-acento" : "translate-x-0.5 bg-texto-tenue"}`} />
      </span>
      {/* En pantallas angostas el texto queda solo para lectores de pantalla:
          el nombre accesible sigue siendo "Modo dev". */}
      <span className={esDev ? "sr-only min-[520px]:not-sr-only" : "sr-only"}>Modo dev</span>
    </button>
  );
}
