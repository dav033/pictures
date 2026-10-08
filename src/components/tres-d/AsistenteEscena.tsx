"use client";

import { useState } from "react";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import type { Escena } from "@/lib/globos3d/escena";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { BOTON, INACTIVO } from "./PanelFlor";

type Accion = { herramienta: string; resumen: string; consulta: boolean };
type Turno = { rol: "usuario" | "asistente"; texto: string };

const EJEMPLOS = [
  "Un arco orgánico rosado y dorado de 3 m, dos columnas blancas a los lados, una guirnalda en la pared del fondo y flores colgando del techo",
  "Agrega una guirnalda dorada y blanca en la pared del fondo",
  "Haz las columnas más altas, de 2,2 m",
  "Quita las flores del techo",
];

const esRespuesta = (v: unknown): v is { escena: Escena; respuesta: string; acciones: Accion[] } =>
  typeof v === "object" && v !== null && "escena" in v && "respuesta" in v && Array.isArray((v as { acciones?: unknown }).acciones);

/**
 * «Pídele a la IA»: escribe lo que quieres y la IA arma o cambia la escena con las herramientas del taller (sumando
 * a lo que hay, sin rehacerlo). Muestra la respuesta y las acciones aplicadas, y «Deshacer lo de la IA» vuelve a la
 * escena de antes de ese mensaje.
 */
export function AsistenteEscena({ escena, onEscena }: { escena: Escena; onEscena: (e: Escena) => void }) {
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [respuesta, setRespuesta] = useState<string | null>(null);
  const [acciones, setAcciones] = useState<Accion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Escena | null>(null);
  const [historial, setHistorial] = useState<Turno[]>([]);

  const pedir = async (mensaje: string) => {
    const limpio = mensaje.trim();
    if (!limpio || cargando) return;
    setCargando(true); setError(null); setRespuesta(null); setAcciones([]);
    const antes = escena;
    try {
      const r = await fetch("/api/escena-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecerasConversacion("3d") },
        body: JSON.stringify({ escena: antes, mensaje: limpio, historial: historial.slice(-6) }),
      });
      const datos: unknown = await r.json().catch(() => null);
      if (!r.ok || !esRespuesta(datos)) {
        const motivo = typeof datos === "object" && datos !== null && "error" in datos && typeof datos.error === "string" ? datos.error : "No pude hablar con la IA ahora.";
        setError(motivo);
        return;
      }
      setRespuesta(datos.respuesta);
      setAcciones(datos.acciones);
      setHistorial((h) => [...h, { rol: "usuario" as const, texto: limpio }, { rol: "asistente" as const, texto: datos.respuesta.slice(0, 1400) }].slice(-6));
      if (datos.acciones.some((a) => !a.consulta)) { setPrevia(antes); onEscena(datos.escena); }
      setTexto("");
    } catch {
      setError("No pude hablar con la IA ahora. Revisa la conexión y vuelve a intentarlo.");
    } finally {
      setCargando(false);
    }
  };

  const deshacer = () => {
    if (!previa) return;
    onEscena(previa);
    setPrevia(null);
    setRespuesta("Deshice lo último que hizo la IA.");
    setAcciones([]);
  };

  const cambios = acciones.filter((a) => !a.consulta);

  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-acento/50" aria-label="Pídele a la IA">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-texto"><Sparkles className="size-4 text-acento" aria-hidden /> Pídele a la IA</h2>
      <form onSubmit={(e) => { e.preventDefault(); void pedir(texto); }} className="flex flex-col gap-2">
        <label htmlFor="escena-ia-texto" className="sr-only">Qué quieres en la escena</label>
        <textarea id="escena-ia-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={1000} disabled={cargando}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void pedir(texto); } }}
          placeholder="Pídele a la IA… «agrega dos columnas doradas a los lados del arco»"
          className="min-h-20 resize-y rounded-lg bg-superficie-suave p-2 text-sm text-texto ring-1 ring-borde placeholder:text-texto-suave disabled:opacity-60" />
        <button type="submit" disabled={cargando || !texto.trim()} className={`${BOTON} flex items-center justify-center gap-2 bg-acento text-sobre-acento ring-acento disabled:opacity-50`}>
          {cargando ? <><Loader2 className="size-4 animate-spin" aria-hidden /> La IA está armando…</> : "Pedir"}
        </button>
      </form>
      {!cargando && !respuesta && !error && (
        <div className="flex flex-col gap-1">
          <p className="text-[0.7rem] text-texto-suave">Ejemplos (toca uno):</p>
          {EJEMPLOS.map((e) => (
            <button key={e} type="button" onClick={() => setTexto(e)} className={`${BOTON} ${INACTIVO} py-1 text-left text-xs`}>{e}</button>
          ))}
        </div>
      )}
      <div aria-live="polite" className="flex flex-col gap-1">
        {error && <p role="alert" className="rounded-lg bg-superficie-suave p-2 text-xs text-texto ring-1 ring-borde">{error}</p>}
        {respuesta && <p className="text-sm text-texto">{respuesta}</p>}
        {cambios.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[0.7rem] text-texto-suave">
            {cambios.map((a, i) => <li key={i}>• {a.resumen}</li>)}
          </ul>
        )}
      </div>
      {previa && !cargando && (
        <button type="button" onClick={deshacer} className={`${BOTON} ${INACTIVO} flex items-center justify-center gap-2 text-xs`}>
          <Undo2 className="size-4" aria-hidden /> Deshacer lo de la IA
        </button>
      )}
    </section>
  );
}
