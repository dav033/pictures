"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, RotateCcw } from "lucide-react";
import type { HappiaPackage } from "@sempertex/happie-package-ia";
import type { HappieConversationStateV1 } from "@/lib/ia/contracts/happie-v1";
import { ListaRecomendaciones } from "./PaqueteCard";
import { mensajeErrorCliente } from "@/lib/estado/mensaje-error-cliente";

type Mensaje = { rol: "asistente" | "usuario"; texto: string };
type Recomendacion = { url: string; razon: string; paquete?: HappiaPackage };
type Turno =
  | { tipo: "pregunta"; mensaje: string; estado: HappieConversationStateV1 }
  | { tipo: "recomendaciones"; mensaje: string; estado: HappieConversationStateV1; recomendaciones: Recomendacion[]; resumen: string };

const SALUDO = "¡Hola! Soy Happie. Cuéntame qué evento quieres celebrar y te voy haciendo las preguntas que necesito para encontrar el paquete ideal.";

function IconoIA({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5" />
        <circle cx="12" cy="12" r="3.4" />
      </svg>
    </div>
  );
}

/** Reads the server's turn without trusting its shape: a malformed answer is an error, not a crash while rendering. */
function leerTurno(cuerpo: unknown): Turno | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const c = cuerpo as Record<string, unknown>;
  if (typeof c.mensaje !== "string" || typeof c.estado !== "object" || c.estado === null) return null;
  const estado = c.estado as HappieConversationStateV1;
  if (c.tipo === "pregunta") return { tipo: "pregunta", mensaje: c.mensaje, estado };
  if (c.tipo === "recomendaciones" && Array.isArray(c.recomendaciones)) {
    const recomendaciones = c.recomendaciones.filter(
      (r): r is Recomendacion => typeof r === "object" && r !== null && typeof (r as Recomendacion).url === "string" && typeof (r as Recomendacion).razon === "string",
    );
    return { tipo: "recomendaciones", mensaje: c.mensaje, estado, recomendaciones, resumen: typeof c.resumen === "string" ? c.resumen : c.mensaje };
  }
  return null;
}

export function ChatFlow({
  idsEnCarrito,
  onAgregar,
}: {
  idsEnCarrito: Set<string>;
  onAgregar: (paquete: HappiaPackage) => void;
}) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([{ rol: "asistente", texto: SALUDO }]);
  const [estado, setEstado] = useState<HappieConversationStateV1 | undefined>(undefined);
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recomendaciones, setRecomendaciones] = useState<Recomendacion[]>([]);
  const fin = useRef<HTMLDivElement | null>(null);
  const abortar = useRef<AbortController | null>(null);

  useEffect(() => () => abortar.current?.abort(), []);
  useEffect(() => { fin.current?.scrollIntoView?.({ block: "nearest" }); }, [mensajes, cargando, recomendaciones]);

  async function enviar() {
    const texto = entrada.trim();
    if (!texto || cargando) return;
    const control = new AbortController();
    abortar.current = control;
    setMensajes((actuales) => [...actuales, { rol: "usuario", texto }]);
    setEntrada("");
    setCargando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/happie/conversar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mensaje: texto, ...(estado ? { estado } : {}) }),
        signal: control.signal,
      });
      const cuerpo: unknown = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        const detalle = typeof cuerpo === "object" && cuerpo && "error" in cuerpo ? String(cuerpo.error) : "Error desconocido";
        throw new Error(detalle);
      }
      if (abortar.current !== control || control.signal.aborted) return;
      const turno = leerTurno(cuerpo);
      if (!turno) throw new Error("Respuesta inesperada del servidor.");
      setEstado(turno.estado);
      setMensajes((actuales) => [...actuales, { rol: "asistente", texto: turno.mensaje }]);
      setRecomendaciones(turno.tipo === "recomendaciones" ? turno.recomendaciones : []);
    } catch (err) {
      if (control.signal.aborted || abortar.current !== control) return;
      setEntrada(texto);
      setMensajes((actuales) => actuales.slice(0, -1));
      setError(mensajeErrorCliente(err, "No pudimos continuar la conversación. Inténtalo de nuevo."));
    } finally {
      if (abortar.current === control) setCargando(false);
    }
  }

  function reiniciar() {
    abortar.current?.abort();
    setMensajes([{ rol: "asistente", texto: SALUDO }]);
    setEstado(undefined);
    setRecomendaciones([]);
    setEntrada("");
    setError(null);
    setCargando(false);
  }

  const conPaquete = recomendaciones.filter((r): r is Recomendacion & { paquete: HappiaPackage } => r.paquete !== undefined);
  const soloEnlace = recomendaciones.filter((r) => r.paquete === undefined);

  return (
    <div className="flex flex-col gap-5">
      <div role="log" aria-live="polite" aria-label="Conversación con Happie" className="flex flex-col gap-3">
        {mensajes.map((m, indice) => (
          <div key={indice} className={m.rol === "usuario" ? "flex justify-end" : "happie-entra flex items-start gap-3"}>
            {m.rol === "asistente" && (
              <IconoIA className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acento text-sobre-acento" />
            )}
            <p
              className={
                m.rol === "usuario"
                  ? "max-w-[85%] rounded-2xl bg-acento-suave px-4 py-2 text-[15px] text-texto"
                  : "pt-1.5 text-[15px] leading-relaxed text-texto text-pretty"
              }
            >
              {m.texto}
            </p>
          </div>
        ))}
        {cargando && (
          <div className="flex items-center gap-3 text-sm text-texto-suave">
            <Loader2 className="h-4 w-4 animate-spin text-acento" />
            Happie está pensando…
          </div>
        )}
        <div ref={fin} />
      </div>

      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <ListaRecomendaciones recomendaciones={conPaquete} idsEnCarrito={idsEnCarrito} onAgregar={onAgregar} />
      {soloEnlace.length > 0 && (
        <ul className="flex flex-col gap-2">
          {soloEnlace.map((r) => (
            <li key={r.url} className="rounded-xl border border-borde-suave p-3 text-sm">
              <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-acento hover:underline">Ver paquete</a>
              <p className="mt-1 text-texto-suave">{r.razon}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-borde bg-superficie p-4 focus-within:border-acento">
        <IconoIA className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acento-suave text-acento" />
        <textarea
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder="Escribe tu respuesta…"
          rows={2}
          aria-label="Tu mensaje para Happie"
          className="min-w-0 flex-grow resize-none bg-transparent pt-1.5 text-[15px] text-texto outline-none placeholder:text-texto-tenue"
        />
        <button
          type="button"
          aria-label="Enviar mensaje"
          onClick={() => void enviar()}
          disabled={cargando || !entrada.trim()}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-acento text-sobre-acento hover:bg-acento-hover disabled:opacity-40"
        >
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[17px] w-[17px]" strokeWidth={2.4} />}
        </button>
      </div>
      {mensajes.length > 1 && (
        <button type="button" onClick={reiniciar} className="ui-button-ghost inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1.5 text-sm">
          <RotateCcw className="h-3.5 w-3.5" /> Empezar una conversación nueva
        </button>
      )}
    </div>
  );
}
