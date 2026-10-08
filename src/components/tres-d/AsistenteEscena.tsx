"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Sparkles, Undo2 } from "lucide-react";
import type { Escena } from "@/lib/globos3d/escena";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { BOTON, INACTIVO } from "./PanelFlor";

type Accion = { herramienta: string; resumen: string; consulta: boolean };
type Turno = { rol: "usuario" | "asistente"; texto: string };
/** La pieza elegida en el editor (y la raíz del editor solitario): viaja con cada pedido («cámbiale el color» = a esta). */
export type SeleccionIA = { id: string; nombre: string; raizSolitario?: { id: string; nombre: string } | null };
/** Lo que la IA pregunta cuando dos o más piezas encajan: cada opción, al tocarla, se manda como el próximo pedido. */
type Pregunta = { texto: string; opciones: string[] };

const EJEMPLOS = [
  "Un arco orgánico rosado y dorado de 3 m, dos columnas blancas a los lados, una guirnalda en la pared del fondo y flores colgando del techo",
  "Agrega una guirnalda dorada y blanca en la pared del fondo",
  "Haz las columnas más altas, de 2,2 m",
  "Quita las flores del techo",
];

const esRespuesta = (v: unknown): v is { escena: Escena; respuesta: string; acciones: Accion[]; pregunta?: Pregunta } =>
  typeof v === "object" && v !== null && "escena" in v && "respuesta" in v && Array.isArray((v as { acciones?: unknown }).acciones);

const esPregunta = (v: unknown): v is Pregunta =>
  typeof v === "object" && v !== null && typeof (v as { texto?: unknown }).texto === "string" && Array.isArray((v as { opciones?: unknown }).opciones)
  && (v as { opciones: unknown[] }).opciones.every((o) => typeof o === "string");

/** Las opciones de la pregunta como botones (al tocar una, se pide su texto). */
function OpcionesPregunta({ pregunta, pedir, clase }: { pregunta: Pregunta; pedir: (m: string) => Promise<void>; clase: string }) {
  return (
    <div role="group" aria-label={pregunta.texto} className="flex flex-wrap gap-1.5">
      {pregunta.opciones.map((o) => (
        <button key={o} type="button" onClick={() => void pedir(o)} className={clase}>{o}</button>
      ))}
    </div>
  );
}

/**
 * «Pídele a la IA»: escribe lo que quieres y la IA arma o cambia la escena con las herramientas del taller (sumando
 * a lo que hay, sin rehacerlo). Muestra la respuesta y las acciones aplicadas, y «Deshacer lo de la IA» vuelve a la
 * escena de antes de ese mensaje.
 *
 * `compacta`: la barra flotante al pie del visor (una línea); la conversación se abre hacia arriba (Esc la cierra).
 * `seleccion`: la pieza elegida en el editor viaja con cada pedido; si la IA duda entre varias piezas, pregunta y sus
 * opciones salen como botones.
 */
export function AsistenteEscena({ escena, onEscena, compacta = false, seleccion = null }: { escena: Escena; onEscena: (e: Escena) => void; compacta?: boolean; seleccion?: SeleccionIA | null }) {
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [respuesta, setRespuesta] = useState<string | null>(null);
  const [acciones, setAcciones] = useState<Accion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Escena | null>(null);
  const [historial, setHistorial] = useState<Turno[]>([]);
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);
  /** Sube con cada respuesta o error (la barra compacta abre la conversación para verla). */
  const [vueltas, setVueltas] = useState(0);

  const pedir = async (mensaje: string) => {
    const limpio = mensaje.trim();
    if (!limpio || cargando) return;
    setCargando(true); setError(null); setRespuesta(null); setAcciones([]); setPregunta(null);
    const antes = escena;
    try {
      const r = await fetch("/api/escena-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecerasConversacion("3d") },
        body: JSON.stringify({ escena: antes, mensaje: limpio, historial: historial.slice(-6), seleccion: seleccion ? { id: seleccion.id, nombre: seleccion.nombre.slice(0, 120), raizSolitario: seleccion.raizSolitario ?? null } : null }),
      });
      const datos: unknown = await r.json().catch(() => null);
      if (!r.ok || !esRespuesta(datos)) {
        const motivo = typeof datos === "object" && datos !== null && "error" in datos && typeof datos.error === "string" ? datos.error : "No pude hablar con la IA ahora.";
        setError(motivo);
        setVueltas((v) => v + 1);
        return;
      }
      setRespuesta(datos.respuesta);
      setAcciones(datos.acciones);
      setPregunta(esPregunta(datos.pregunta) && datos.pregunta.opciones.length ? datos.pregunta : null);
      setHistorial((h) => [...h, { rol: "usuario" as const, texto: limpio }, { rol: "asistente" as const, texto: datos.respuesta.slice(0, 1400) }].slice(-6));
      if (datos.acciones.some((a) => !a.consulta)) { setPrevia(antes); onEscena(datos.escena); }
      setTexto("");
      setVueltas((v) => v + 1);
    } catch {
      setError("No pude hablar con la IA ahora. Revisa la conexión y vuelve a intentarlo.");
      setVueltas((v) => v + 1);
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

  if (compacta) {
    return <AsistenteCompacto {...{ texto, setTexto, cargando, respuesta, error, cambios, previa, historial, pedir, deshacer, vueltas, pregunta, seleccion }} />;
  }

  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-acento/50" aria-label="Pídele a la IA">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-texto"><Sparkles className="size-4 text-acento" aria-hidden /> Pídele a la IA</h2>
      {seleccion && <p className="text-[0.7rem] text-texto-suave">Sobre la pieza elegida: «{seleccion.nombre}» (si no nombras otra).</p>}
      <form onSubmit={(e) => { e.preventDefault(); void pedir(texto); }} className="flex flex-col gap-2">
        <label htmlFor="escena-ia-texto" className="sr-only">Qué quieres en la escena</label>
        {/* En el teléfono: letra de 16 px (si no, iOS acerca la página al escribir) y alto con tope en dvh (el teclado no la tapa). */}
        <textarea id="escena-ia-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={1000} disabled={cargando} enterKeyHint="send"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void pedir(texto); } }}
          placeholder="Pídele a la IA… «agrega dos columnas doradas a los lados del arco»"
          className="max-h-[30dvh] min-h-20 resize-y rounded-lg bg-superficie-suave p-2 text-base text-texto ring-1 ring-borde placeholder:text-texto-suave disabled:opacity-60 lg:max-h-none lg:text-sm" />
        <button type="submit" disabled={cargando || !texto.trim()} className={`${BOTON} flex items-center justify-center gap-2 bg-taller-primario text-taller-sobre-primario ring-taller-primario disabled:opacity-50`}>
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
        {pregunta && !cargando && <OpcionesPregunta pregunta={pregunta} pedir={pedir} clase={`${BOTON} ${INACTIVO} py-1 text-xs`} />}
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

type PropsCompacto = {
  texto: string; setTexto: (t: string) => void; cargando: boolean; respuesta: string | null; error: string | null;
  cambios: readonly Accion[]; previa: Escena | null; historial: readonly Turno[];
  pedir: (mensaje: string) => Promise<void>; deshacer: () => void; vueltas: number;
  pregunta: Pregunta | null; seleccion: SeleccionIA | null;
};

/** La IA como barra al pie del visor: una línea para pedir; arriba, al abrirse, la conversación, los ejemplos y deshacer. */
function AsistenteCompacto({ texto, setTexto, cargando, respuesta, error, cambios, previa, historial, pedir, deshacer, vueltas, pregunta, seleccion }: PropsCompacto) {
  const [abierta, setAbierta] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  // Al llegar una respuesta (o un error), la conversación se abre para verla.
  const [vistas, setVistas] = useState(vueltas);
  if (vistas !== vueltas) { setVistas(vueltas); setAbierta(true); }
  // Un clic fuera la cierra (la barra queda).
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierta(false); };
    window.addEventListener("pointerdown", fuera, true);
    return () => window.removeEventListener("pointerdown", fuera, true);
  }, [abierta]);
  const hayAlgo = historial.length > 0 || respuesta || error || cargando;
  return (
    <div ref={raiz} className="flex w-full flex-col gap-2" onKeyDown={(e) => { if (e.key === "Escape" && abierta) { e.stopPropagation(); setAbierta(false); } }}>
      {abierta && (
        <section aria-label="Conversación con la IA" className="flex max-h-[min(52dvh,440px)] flex-col gap-2 overflow-y-auto rounded-2xl border border-taller-borde bg-taller-barra/95 p-3 text-sm shadow-[0_10px_30px_var(--sombra)] backdrop-blur">
          {historial.length > 0 && (
            <ol className="flex flex-col gap-1.5" aria-label="Lo que se ha pedido">
              {historial.map((t, i) => (
                <li key={i} className={t.rol === "usuario" ? "self-end rounded-xl bg-taller-elegido px-3 py-1.5 text-taller-texto" : "self-start text-taller-texto-2"}>
                  <span className="sr-only">{t.rol === "usuario" ? "Tú: " : "IA: "}</span>{t.texto}
                </li>
              ))}
            </ol>
          )}
          <div aria-live="polite" className="flex flex-col gap-1">
            {cargando && <p className="flex items-center gap-2 text-taller-suave"><Loader2 className="size-4 animate-spin" aria-hidden /> La IA está armando…</p>}
            {error && <p role="alert" className="rounded-lg bg-taller-tarjeta p-2 text-xs text-taller-texto ring-1 ring-taller-borde">{error}</p>}
            {respuesta && historial[historial.length - 1]?.texto !== respuesta.slice(0, 1400) && <p className="text-taller-texto-2">{respuesta}</p>}
            {pregunta && !cargando && <OpcionesPregunta pregunta={pregunta} pedir={pedir} clase="inline-flex min-h-9 items-center rounded-lg border border-taller-borde px-3 text-xs text-taller-texto hover:bg-taller-encima" />}
            {cambios.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-[0.75rem] text-taller-suave">
                {cambios.map((a, i) => <li key={i}>• {a.resumen}</li>)}
              </ul>
            )}
          </div>
          {previa && !cargando && (
            <button type="button" onClick={deshacer} className="inline-flex min-h-9 items-center justify-center gap-2 self-start rounded-lg border border-taller-borde px-3 text-xs text-taller-texto hover:bg-taller-encima">
              <Undo2 className="size-4" aria-hidden /> Deshacer lo de la IA
            </button>
          )}
          {!hayAlgo && (
            <div className="flex flex-col gap-1">
              <p className="text-[0.75rem] text-taller-suave">Ejemplos (toca uno):</p>
              {EJEMPLOS.map((e) => (
                <button key={e} type="button" onClick={() => setTexto(e)} className="rounded-lg px-2 py-1.5 text-left text-xs text-taller-texto-2 hover:bg-taller-encima">{e}</button>
              ))}
            </div>
          )}
        </section>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void pedir(texto); }}
        className="flex items-center gap-2 rounded-[14px] border border-taller-solitario-borde bg-taller-barra/95 py-1.5 pl-3.5 pr-1.5 shadow-[0_10px_30px_var(--sombra)] backdrop-blur">
        <Sparkles className="size-[18px] shrink-0 text-taller-acento" aria-hidden />
        <label htmlFor="escena-ia-linea" className="sr-only">Pedido a la IA</label>
        <input id="escena-ia-linea" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} disabled={cargando} enterKeyHint="send" autoComplete="off"
          onFocus={() => { if (!texto && !hayAlgo) setAbierta(true); }}
          placeholder={seleccion ? `Pídele a la IA sobre «${seleccion.nombre}»…` : "Pídele a la IA… «haz las columnas de 2,2 m y en dorado»"}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-taller-texto outline-none placeholder:text-taller-suave disabled:opacity-60" />
        <button type="button" onClick={() => setAbierta(!abierta)} aria-expanded={abierta} aria-label={abierta ? "Cerrar la conversación" : "Ver la conversación y los ejemplos"} title={abierta ? "Cerrar (Esc)" : "Conversación y ejemplos"}
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-taller-medio hover:bg-taller-encima hover:text-taller-texto">
          {abierta ? <ChevronDown className="size-4" aria-hidden /> : <ChevronUp className="size-4" aria-hidden />}
        </button>
        <button type="submit" disabled={cargando || !texto.trim()} aria-label="Enviar a la IA"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-taller-primario px-3 text-[13px] font-medium text-taller-sobre-primario hover:bg-taller-primario-hover disabled:opacity-50">
          {cargando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}Pedir
        </button>
      </form>
    </div>
  );
}
