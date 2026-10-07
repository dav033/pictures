"use client";

import { useState } from "react";
import { LoaderCircle, TriangleAlert, Wand2 } from "lucide-react";
import { useVozCliente } from "../motor/voz-editor";

/**
 * «Volver a la receta» (ADR-0035, paso 1): la salida cuando el armado no se sostiene o el decorador quiere
 * empezar de nuevo. La receta es la columna que el propio motor propone para la pieza (la vista previa con
 * `armado_columna: null`); aquí solo se pide, con una confirmación que dice qué se pierde, y `onReceta` decide qué
 * hacer con ella: el editor la pone de borrador y el bloque con un armado que no se dibuja la guarda en la
 * propuesta. Resuelve el motivo si no se pudo, o `null`.
 */
export function RecetaColumna({ onReceta, deshabilitado = false, perdida }: {
  onReceta: () => Promise<string | null>;
  deshabilitado?: boolean;
  /** Qué se pierde al volver a la receta, en una frase para la confirmación. */
  perdida: string;
}) {
  const [fase, setFase] = useState<"cerrada" | "confirmando" | "pidiendo">("cerrada");
  const [error, setError] = useState<string | null>(null);
  // La receta es del decorador: en la guiada no se ofrece (allí solo hay «Guardar» y «Cancelar»).
  const cliente = useVozCliente();

  async function confirmar(): Promise<void> {
    setFase("pidiendo");
    setError(null);
    const motivo = await onReceta();
    if (motivo === null) {
      setFase("cerrada");
      return;
    }
    setError(motivo);
    setFase("confirmando");
  }

  if (cliente) return null;
  const boton = "ui-button-secondary ui-pressable min-h-11 px-3.5 py-1.5 text-[13px]";
  if (fase === "cerrada") {
    return (
      <div className="space-y-1.5">
        <button type="button" onClick={() => { setError(null); setFase("confirmando"); }} disabled={deshabilitado} data-testid="volver-a-la-receta" className={boton}>
          <Wand2 className="size-3.5" aria-hidden="true" />Volver a la receta
        </button>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Volver a la receta" data-testid="confirmar-receta" className="space-y-2 rounded-xl bg-aviso-suave px-3 py-2.5 text-xs text-aviso">
      <p className="font-medium">¿Volver a la receta? {perdida}</p>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 font-medium text-error">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void confirmar()} disabled={fase === "pidiendo" || deshabilitado} data-testid="confirmar-volver-a-la-receta" className="ui-button-primary ui-pressable min-h-11 px-3.5 text-[13px]">
          {fase === "pidiendo" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          Sí, volver a la receta
        </button>
        <button type="button" onClick={() => setFase("cerrada")} disabled={fase === "pidiendo"} data-testid="cancelar-volver-a-la-receta" className={boton}>
          No, dejarlo como está
        </button>
      </div>
    </div>
  );
}
