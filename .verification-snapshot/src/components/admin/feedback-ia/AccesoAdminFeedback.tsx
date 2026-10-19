"use client";

import { useState } from "react";
import type { AccesoAdmin } from "./useFeedbackAdmin";

type Props = {
  acceso: Exclude<AccesoAdmin, "abierto">;
  error: string | null;
  onIngresar: (clave: string) => Promise<void>;
};

/** Pantalla previa del panel: el feedback tiene su propia clave de administrador (ADMIN_PASSWORD), distinta de la del equipo. */
export function AccesoAdminFeedback({ acceso, error, onIngresar }: Props) {
  const [clave, setClave] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (acceso === "no_configurado") {
    return (
      <p className="rounded-xl border border-dashed border-borde p-6 text-sm text-texto-suave">
        El acceso de administrador del feedback no está configurado en este servidor (falta la variable <code>ADMIN_PASSWORD</code>). Mientras tanto el panel permanece cerrado.
      </p>
    );
  }

  return (
    <form
      className="mx-auto max-w-sm rounded-xl border border-borde bg-superficie p-4"
      onSubmit={async (evento) => {
        evento.preventDefault();
        setEnviando(true);
        await onIngresar(clave);
        setEnviando(false);
        setClave("");
      }}
    >
      <h2 className="mb-1 text-sm font-semibold text-texto">Clave de administrador</h2>
      <p className="mb-3 text-xs text-texto-suave">El feedback de la IA guarda pedidos y comentarios de personas; solo se abre con la clave de administrador.</p>
      <input type="password" autoComplete="current-password" className="ui-input" value={clave} onChange={(e) => setClave(e.target.value)} aria-label="Clave de administrador" />
      {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
      <button type="submit" className="ui-button-primary mt-3 w-full" disabled={enviando || clave === ""}>Ingresar</button>
    </form>
  );
}
