"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";

export type PestanaLateral = "pieza" | "ia";
const ORDEN: readonly PestanaLateral[] = ["pieza", "ia"];

type Props = {
  activa: PestanaLateral;
  alCambiar: (p: PestanaLateral) => void;
  pieza: ReactNode;
  ia: ReactNode;
  /** Cuántos turnos lleva la conversación y si la IA está trabajando (para el aviso de la pestaña cuando no se ve). */
  turnos: number;
  trabajando: boolean;
};

const PESTANA = "relative flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 text-[13px] font-medium";

/**
 * El panel derecho del taller con dos pestañas: «Pieza» (el inspector o los parámetros) e «IA» (el asistente). La IA vive aquí
 * y no sobre el visor, así nunca tapa la escena. Las dos quedan montadas (la conversación, lo escrito y la posición del hilo
 * se conservan al cambiar). Pestañas con flechas ←/→, Inicio y Fin como pide el patrón ARIA.
 */
export function PestanasLaterales({ activa, alCambiar, pieza, ia, turnos, trabajando }: Props) {
  // Los turnos que llegaron mientras se veía «Pieza» se avisan en la pestaña hasta que se abre la IA.
  const [vistos, setVistos] = useState(turnos);
  if (activa === "ia" && vistos !== turnos) setVistos(turnos);
  const nuevos = activa === "ia" ? 0 : Math.max(0, turnos - vistos);

  const alTeclado = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = ORDEN.indexOf(activa);
    const destino = e.key === "ArrowRight" ? ORDEN[(i + 1) % ORDEN.length] : e.key === "ArrowLeft" ? ORDEN[(i - 1 + ORDEN.length) % ORDEN.length] : e.key === "Home" ? ORDEN[0] : e.key === "End" ? ORDEN[ORDEN.length - 1] : undefined;
    if (!destino) return;
    e.preventDefault();
    alCambiar(destino);
    document.getElementById(`lado-pestana-${destino}`)?.focus();
  };
  const clase = (p: PestanaLateral) => `${PESTANA} ${activa === p ? "border-taller-resalte text-taller-texto" : "border-transparent text-taller-medio hover:text-taller-texto"}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Panel de la pieza y de la IA" onKeyDown={alTeclado} className="flex shrink-0 border-b border-taller-linea bg-taller-barra">
        <button type="button" role="tab" id="lado-pestana-pieza" aria-selected={activa === "pieza"} aria-controls="lado-panel-pieza" tabIndex={activa === "pieza" ? 0 : -1} onClick={() => alCambiar("pieza")} className={clase("pieza")}>
          Pieza
        </button>
        <button type="button" role="tab" id="lado-pestana-ia" aria-selected={activa === "ia"} aria-controls="lado-panel-ia" tabIndex={activa === "ia" ? 0 : -1} onClick={() => alCambiar("ia")} className={clase("ia")}>
          <Sparkles className="size-4 text-taller-acento" aria-hidden /> IA
          {trabajando && activa !== "ia" && <Loader2 className="size-3.5 animate-spin text-taller-acento motion-reduce:animate-none" aria-label="La IA está trabajando" />}
          {nuevos > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-taller-primario px-1 text-[11px] font-semibold text-taller-sobre-primario" aria-label={`${nuevos} ${nuevos === 1 ? "respuesta nueva" : "respuestas nuevas"}`}>{nuevos}</span>}
        </button>
      </div>
      <div role="tabpanel" id="lado-panel-pieza" aria-labelledby="lado-pestana-pieza" hidden={activa !== "pieza"} className={`min-h-0 flex-1 flex-col overflow-y-auto ${activa === "pieza" ? "flex" : "hidden"}`}>{pieza}</div>
      <div role="tabpanel" id="lado-panel-ia" aria-labelledby="lado-pestana-ia" hidden={activa !== "ia"} className={`min-h-0 flex-1 flex-col ${activa === "ia" ? "flex" : "hidden"}`}>{ia}</div>
    </div>
  );
}
