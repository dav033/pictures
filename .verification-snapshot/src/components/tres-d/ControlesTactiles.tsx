"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsDown, ChevronsUp, Copy, Redo2, RotateCcw, RotateCw, Trash2, Undo2, X } from "lucide-react";
import type { Colocacion } from "@/lib/globos3d/escena";

export type AccionTactil = (key: string, opciones?: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) => void;

const BOTON = "grid size-11 shrink-0 place-items-center rounded-xl bg-superficie/90 text-texto shadow-sm ring-1 ring-borde backdrop-blur active:bg-superficie-2 disabled:opacity-40";

function Boton({ etiqueta, onClick, children, disabled = false }: { etiqueta: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={etiqueta} title={etiqueta} className={BOTON}>
      {children}
    </button>
  );
}

/** Deshacer y rehacer de la escena, a mano del pulgar (arriba a la derecha del visor). */
export function DeshacerTactil({ onDeshacer, onRehacer, puedeDeshacer, puedeRehacer }: {
  onDeshacer: () => void; onRehacer: () => void; puedeDeshacer: boolean; puedeRehacer: boolean;
}) {
  return (
    <div className="absolute right-2 top-2 flex gap-1.5 lg:hidden lg:pointer-coarse:flex">
      <Boton etiqueta="Deshacer" onClick={onDeshacer} disabled={!puedeDeshacer}><Undo2 className="size-5" aria-hidden /></Boton>
      <Boton etiqueta="Rehacer" onClick={onRehacer} disabled={!puedeRehacer}><Redo2 className="size-5" aria-hidden /></Boton>
    </div>
  );
}

/**
 * La alternativa táctil a las flechas, Q/E, RePág/AvPág, Supr, Ctrl+D y Esc para la pieza elegida en la escena.
 * Se ve en teléfono y tablet (y en pantallas táctiles grandes); en escritorio con ratón sigue el teclado.
 */
export function ControlesPieza({ nombre, colocacion, onAccion, enLinea = false }: { nombre: string; colocacion: Colocacion; onAccion: AccionTactil; /** Dentro de la hoja del teléfono (no flotando sobre el visor). */ enLinea?: boolean }) {
  const [largo, setLargo] = useState(false);
  const en = colocacion.en;
  const opciones = { shiftKey: largo };
  // Lo que hace cada flecha depende de dónde está la pieza (igual que con el teclado).
  const vertical = en === "piso" || en === "techo" ? { arriba: "Al fondo", abajo: "Al frente" } : { arriba: "Subir", abajo: "Bajar" };
  const enAncla = en === "ancla";
  // RePág/AvPág: altura del techo, o frente y fondo de lo suelto. En la pared ya lo hacen ↑/↓.
  const altura = en === "techo" ? { mas: "Subir (cuelga menos)", menos: "Bajar (cuelga más)" } : en === "libre" ? { mas: "Hacia el frente", menos: "Hacia el fondo" } : null;
  return (
    <div className={enLinea ? "flex" : "pointer-events-none absolute inset-x-2 bottom-2 flex justify-center lg:hidden lg:pointer-coarse:flex"}>
      <div role="toolbar" aria-label={`Mover ${nombre}`} className={`pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 [scrollbar-width:none] ${enLinea ? "justify-start" : "justify-center apaisado:flex-nowrap apaisado:justify-start apaisado:overflow-x-auto"}`}>
        <Boton etiqueta={enAncla ? "Ancla anterior" : "Mover a la izquierda"} onClick={() => onAccion("ArrowLeft", opciones)}><ArrowLeft className="size-5" aria-hidden /></Boton>
        {!enAncla && <Boton etiqueta={vertical.arriba} onClick={() => onAccion("ArrowUp", opciones)}><ArrowUp className="size-5" aria-hidden /></Boton>}
        {!enAncla && <Boton etiqueta={vertical.abajo} onClick={() => onAccion("ArrowDown", opciones)}><ArrowDown className="size-5" aria-hidden /></Boton>}
        <Boton etiqueta={enAncla ? "Ancla siguiente" : "Mover a la derecha"} onClick={() => onAccion("ArrowRight", opciones)}><ArrowRight className="size-5" aria-hidden /></Boton>
        <Boton etiqueta="Girar a la izquierda" onClick={() => onAccion("q", opciones)}><RotateCcw className="size-5" aria-hidden /></Boton>
        <Boton etiqueta="Girar a la derecha" onClick={() => onAccion("e", opciones)}><RotateCw className="size-5" aria-hidden /></Boton>
        {altura && <Boton etiqueta={altura.mas} onClick={() => onAccion("PageUp", opciones)}><ChevronsUp className="size-5" aria-hidden /></Boton>}
        {altura && <Boton etiqueta={altura.menos} onClick={() => onAccion("PageDown", opciones)}><ChevronsDown className="size-5" aria-hidden /></Boton>}
        <button type="button" onClick={() => setLargo(!largo)} aria-pressed={largo} title="Tamaño del paso: 5 cm y 15° o 25 cm y 45°"
          className={`min-h-11 shrink-0 rounded-xl px-2 font-mono text-xs shadow-sm ring-1 ${largo ? "bg-taller-elegido text-taller-texto ring-taller-resalte" : "bg-superficie/90 text-texto ring-borde backdrop-blur"}`}>
          <span className="sr-only">Paso de </span>{largo ? "25 cm" : "5 cm"}
        </button>
        <Boton etiqueta="Duplicar" onClick={() => onAccion("d", { ctrlKey: true })}><Copy className="size-5" aria-hidden /></Boton>
        <Boton etiqueta="Quitar" onClick={() => onAccion("Delete")}><Trash2 className="size-5" aria-hidden /></Boton>
        <Boton etiqueta="Soltar la pieza" onClick={() => onAccion("Escape")}><X className="size-5" aria-hidden /></Boton>
      </div>
    </div>
  );
}

/** Sección móvil del inspector con las acciones directas para mover la pieza elegida. */
export function PanelControlesPieza({ nombre, colocacion, copiaElegida, onAccion, onAccionCopia }: { nombre: string; colocacion: Colocacion; copiaElegida: boolean; onAccion: AccionTactil; onAccionCopia: AccionTactil }) {
  return (
    <div className="border-t border-taller-linea px-4 py-3">
      <h3 className="taller-rotulo mb-2">Mover con botones</h3>
      <ControlesPieza nombre={nombre} colocacion={colocacion} onAccion={(key, modifiers) => {
        const usarAccionCopia = (copiaElegida || colocacion.en === "sobre") && !modifiers?.ctrlKey && key !== "Escape";
        (usarAccionCopia ? onAccionCopia : onAccion)(key, modifiers);
      }} enLinea />
    </div>
  );
}
