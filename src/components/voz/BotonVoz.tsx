"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { MAX_SEGUNDOS_AUDIO } from "@/lib/voz/limites";
import { formatearTiempo } from "./estado-dictado";
import { insertarEnCursor, type Seleccion } from "./insertar-texto";
import { MENSAJES_ERROR_DICTADO } from "./mensajes-voz";
import { useDictado } from "./useDictado";
import { useVozDisponible } from "./useVozDisponible";

type CampoEscribible = HTMLInputElement | HTMLTextAreaElement;

type Props = {
  /** El `id` del campo (input o textarea controlado) donde cae el texto dictado. */
  campoId: string;
  /** El mismo setter con el que el campo guarda lo que se escribe. */
  alTexto: (texto: string) => void;
  deshabilitado?: boolean;
  /** Clases del botón, para que encaje con los de al lado. */
  clase: string;
  /** Colores de la ventanita de estado: el taller y la vista del cliente tienen paletas distintas. */
  variante: "taller" | "cliente";
  /** Hacia dónde sale la ventanita de estado: «abajo» cuando el campo está pegado al borde de arriba de un panel con scroll. */
  ventana?: "arriba" | "abajo";
};

const VENTANA: Record<Props["variante"], string> = {
  taller: "border-taller-borde bg-taller-panel text-taller-texto",
  cliente: "border-borde bg-superficie text-texto",
};
const SEGUNDOS_DE_AVISO_ERROR = 7;

/** Dónde estaba el cursor del campo si lo tenía enfocado; `null` si nunca lo tuvo (el dictado entonces se añade al final). */
function seleccionDe(campo: CampoEscribible | null): Seleccion | null {
  if (!campo || document.activeElement !== campo) return null;
  return { inicio: campo.selectionStart ?? campo.value.length, fin: campo.selectionEnd ?? campo.value.length };
}

/**
 * Micrófono para dictar en un campo de texto: toca, habla, toca otra vez. El texto entra donde estaba el cursor (o al final),
 * el foco no se mueve del campo y Esc cancela. No se dibuja si el servidor no tiene el dictado encendido o el navegador no
 * puede grabar, así que con el dictado apagado la pantalla queda exactamente igual.
 */
export function BotonVoz({ campoId, alTexto, deshabilitado = false, clase, variante, ventana = "arriba" }: Props) {
  const disponible = useVozDisponible();
  const alTextoRef = useRef(alTexto);
  const seleccionInicial = useRef<Seleccion | null>(null);
  const [aviso, setAviso] = useState("");

  const insertar = useCallback((dictado: string) => {
    const campo = document.getElementById(campoId) as CampoEscribible | null;
    if (!campo) return;
    // Si la persona siguió escribiendo mientras se transcribía, manda el cursor de ahora; si ya salió del campo, el de cuando empezó.
    const seleccion = seleccionDe(campo) ?? seleccionInicial.current;
    const { valor, cursor } = insertarEnCursor(campo.value, dictado, seleccion, campo.maxLength > 0 ? campo.maxLength : undefined);
    alTextoRef.current(valor);
    setAviso("Dictado insertado.");
    requestAnimationFrame(() => {
      campo.focus({ preventScroll: true });
      try { campo.setSelectionRange(cursor, cursor); } catch { /* algunos tipos de campo no admiten cursor */ }
    });
  }, [campoId]);

  const { estado, segundos, nivel, alternar, cancelar, descartarError } = useDictado(insertar);
  useEffect(() => { alTextoRef.current = alTexto; });

  const error = estado.fase === "reposo" ? estado.error : null;
  useEffect(() => {
    if (!error) return;
    const reloj = window.setTimeout(descartarError, SEGUNDOS_DE_AVISO_ERROR * 1000);
    return () => window.clearTimeout(reloj);
  }, [error, descartarError]);

  if (!disponible) return null;

  const lado = ventana === "arriba" ? "bottom-full mb-1.5" : "top-full mt-1.5";
  const grabando = estado.fase === "grabando";
  const ocupado = estado.fase === "permiso" || estado.fase === "transcribiendo";
  const estadoTexto = grabando ? "Grabando. Toca de nuevo para terminar." : estado.fase === "permiso" ? "Esperando el permiso del micrófono." : estado.fase === "transcribiendo" ? "Transcribiendo el dictado." : aviso;
  const alPulsar = () => {
    if (estado.fase === "reposo") {
      setAviso("");
      seleccionInicial.current = seleccionDe(document.getElementById(campoId) as CampoEscribible | null);
    }
    alternar();
  };

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={alPulsar}
        // El clic no le quita el foco al campo: el cursor y el teclado del teléfono se quedan donde estaban.
        onMouseDown={(e) => e.preventDefault()}
        aria-label="Dictar"
        aria-pressed={grabando}
        aria-busy={ocupado}
        title={grabando ? "Terminar el dictado (Esc cancela)" : "Dictar con la voz"}
        disabled={deshabilitado || ocupado}
        className={`${clase} ${grabando ? "border-red-500! bg-red-600! text-white! hover:bg-red-700!" : ""}`}
      >
        {ocupado ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : grabando ? <Square className="size-3.5 fill-current" aria-hidden /> : <Mic className="size-4" aria-hidden />}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{estadoTexto}</span>
      {(grabando || estado.fase === "transcribiendo") && (
        <span className={`absolute ${lado} right-0 z-30 flex items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs shadow-lg ${VENTANA[variante]}`}>
          {grabando ? (
            <>
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" aria-hidden />
              <span className="font-mono tabular-nums">{formatearTiempo(segundos)} / {formatearTiempo(MAX_SEGUNDOS_AUDIO)}</span>
              <Nivel nivel={nivel} />
              <button type="button" onClick={cancelar} onMouseDown={(e) => e.preventDefault()} aria-label="Cancelar dictado" title="Cancelar (Esc)" className="grid size-6 place-items-center rounded-full opacity-80 hover:opacity-100">
                <X className="size-3.5" aria-hidden />
              </button>
            </>
          ) : <span>Transcribiendo…</span>}
        </span>
      )}
      {error && (
        <span role="alert" className={`absolute ${lado} right-0 z-30 w-64 max-w-[70vw] rounded-lg border px-2.5 py-1.5 text-left text-xs shadow-lg ${VENTANA[variante]}`}>
          {MENSAJES_ERROR_DICTADO[error]}
        </span>
      )}
    </span>
  );
}

const BARRAS = [0.25, 0.5, 0.8, 0.5, 0.25] as const;

/** Cinco barritas que suben con el volumen de la voz. */
function Nivel({ nivel }: { nivel: number }) {
  return (
    <span className="flex h-4 items-center gap-0.5" aria-hidden>
      {BARRAS.map((forma, i) => (
        <span key={i} className="w-0.5 rounded-full bg-red-500 transition-[height] duration-100" style={{ height: `${Math.round(20 + Math.min(1, nivel * (0.6 + forma)) * 80)}%` }} />
      ))}
    </span>
  );
}
