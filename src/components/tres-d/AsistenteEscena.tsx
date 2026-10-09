"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Sparkles, Square, Undo2 } from "lucide-react";
import type { Escena } from "@/lib/globos3d/escena";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { construirCuerpoEscenaIA, mensajeDelPedido, type SeleccionIA, type TurnoIA } from "@/lib/globos3d/cuerpo-escena-ia";
import { EncuadreSchema, type Encuadre } from "@/lib/globos3d/encuadre-foto";
import { resumenDeRefinado, type RondaHecha } from "@/lib/globos3d/refinar-foto-cliente";
import { BOTON, INACTIVO } from "./PanelFlor";
import { BotonFotoIA, MiniaturaFotoIA } from "./ControlFotoIA";
import { useFotoAdjunta, type FotoAdjuntaEstado } from "./useFotoAdjunta";
import { useRefinadoFoto, type ProgresoRefinado } from "./useRefinadoFoto";

type Accion = { herramienta: string; resumen: string; consulta: boolean };
type Turno = TurnoIA;
/** La pieza elegida en el editor (y la raíz del editor solitario): viaja con cada pedido («cámbiale el color» = a esta). */
export type { SeleccionIA };
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

/** Lo que devuelve el servidor de la foto al armar la escena y hace falta para compararla después (la lectura y el encuadre de la cámara). */
function datosDeRefinado(v: unknown): { lectura: unknown; encuadre: Encuadre } | null {
  if (typeof v !== "object" || v === null) return null;
  const { aplicada, lectura, encuadre } = v as { aplicada?: unknown; lectura?: unknown; encuadre?: unknown };
  const e = EncuadreSchema.safeParse(encuadre);
  return aplicada === true && lectura && e.success ? { lectura, encuadre: e.data } : null;
}

const esPregunta = (v: unknown): v is Pregunta =>
  typeof v === "object" && v !== null && typeof (v as { texto?: unknown }).texto === "string" && Array.isArray((v as { opciones?: unknown }).opciones)
  && (v as { opciones: unknown[] }).opciones.every((o) => typeof o === "string");

/** Lo que dice la barra mientras trabaja la IA: armando, leyendo la foto o comparando con ella. */
function textoDeProgreso(cargando: boolean, leyendoFoto: boolean, refinando: ProgresoRefinado | null): string {
  if (!cargando && refinando) return `Comparando con la foto… ronda ${refinando.ronda}/${refinando.total}`;
  return leyendoFoto ? "La IA está leyendo la foto…" : "La IA está armando…";
}

/** «Detener»: para la comparación con la foto (lo ya corregido se queda y se puede deshacer por ronda). */
function BotonDetener({ alTocar, clase }: { alTocar: () => void; clase: string }) {
  return (
    <button type="button" onClick={alTocar} className={clase} aria-label="Detener la comparación con la foto">
      <Square className="size-3.5" aria-hidden /> Detener
    </button>
  );
}

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
 * Foto: el botón de la barra adjunta la foto de una decoración (también se pega o se suelta sobre la barra); viaja con el
 * pedido, la IA la lee y arma la escena (o la suma), y «Deshacer lo de la IA» y el historial del taller la deshacen. Tras
 * armarla, hasta 2 rondas automáticas «Comparando con la foto…» (captura de la escena con la cámara de la foto → la IA la
 * compara y corrige): cada ronda se deshace por separado y «Detener» las para.
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
  /** Las escenas de antes de cada cambio de la IA (el pedido y cada ronda de comparación): «Deshacer» quita el último. */
  const [previas, setPrevias] = useState<Escena[]>([]);
  const [historial, setHistorial] = useState<Turno[]>([]);
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);
  /** Sube con cada respuesta o error (la barra compacta abre la conversación para verla). */
  const [vueltas, setVueltas] = useState(0);
  const fotoIA = useFotoAdjunta();
  const [leyendoFoto, setLeyendoFoto] = useState(false);
  const refinado = useRefinadoFoto({
    alRonda: (r: RondaHecha) => {
      setPrevias((p) => [...p, r.antes]);
      onEscena(r.escena);
      setHistorial((h) => [...h, { rol: "asistente" as const, texto: `Ronda ${r.ronda} con la foto: ${r.respuesta}`.slice(0, 1400) }].slice(-6));
      setAcciones((a) => [...a, ...r.cambios.map((c) => ({ ...c, resumen: `Ronda ${r.ronda}: ${c.resumen}` }))]);
    },
    alTerminar: (r) => {
      setRespuesta((anterior) => [anterior, resumenDeRefinado(r)].filter(Boolean).join(" "));
      if (r.motivo === "error") setError(null);
      setVueltas((v) => v + 1);
    },
  });

  const pedir = async (mensaje: string) => {
    const foto = fotoIA.foto ? { mime: fotoIA.foto.mime, base64: fotoIA.foto.base64 } : null;
    const limpio = mensajeDelPedido(mensaje, foto);
    if (!limpio || cargando || refinado.refinando) return;
    setCargando(true); setLeyendoFoto(foto !== null); setError(null); setRespuesta(null); setAcciones([]); setPregunta(null);
    const antes = escena;
    try {
      const r = await fetch("/api/escena-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecerasConversacion("3d") },
        body: JSON.stringify(construirCuerpoEscenaIA({ escena: antes, mensaje: limpio, historial, seleccion, foto })),
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
      setHistorial((h) => [...h, { rol: "usuario" as const, texto: foto ? `${limpio} (con foto)` : limpio },{ rol: "asistente" as const, texto: datos.respuesta.slice(0, 1400) }].slice(-6));
      if (datos.acciones.some((a) => !a.consulta)) { setPrevias((p) => [...p, antes]); onEscena(datos.escena); }
      setTexto("");
      if (foto) fotoIA.quitar();
      setVueltas((v) => v + 1);
      // La escena se armó desde la foto: la compara con ella (hasta 2 rondas) mientras el usuario ve la primera versión.
      const comparable = foto ? datosDeRefinado((datos as { foto?: unknown }).foto) : null;
      if (foto && comparable) void refinado.iniciar({ escena: datos.escena, foto, lectura: comparable.lectura, encuadre: comparable.encuadre });
    } catch {
      setError("No pude hablar con la IA ahora. Revisa la conexión y vuelve a intentarlo.");
      setVueltas((v) => v + 1);
    } finally {
      setCargando(false); setLeyendoFoto(false);
    }
  };

  const deshacer = () => {
    const ultima = previas[previas.length - 1];
    if (!ultima) return;
    onEscena(ultima);
    setPrevias(previas.slice(0, -1));
    setRespuesta(previas.length > 1 ? `Deshice lo último que hizo la IA (quedan ${previas.length - 1} cambios por deshacer).` : "Deshice lo último que hizo la IA.");
    setAcciones([]);
  };

  const cambios = acciones.filter((a) => !a.consulta);
  const ocupado = cargando || refinado.refinando !== null;

  if (compacta) {
    return <AsistenteCompacto {...{ texto, setTexto, cargando, leyendoFoto, respuesta, error, cambios, previas: previas.length, historial, pedir, deshacer, vueltas, pregunta, seleccion, fotoIA, refinando: refinado.refinando, detener: refinado.detener }} />;
  }

  return (
    <section className={`flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ${fotoIA.encima ? "ring-2 ring-acento" : "ring-acento/50"}`} aria-label="Pídele a la IA"
      onDrop={fotoIA.alSoltar} onDragOver={fotoIA.alArrastrar} onDragLeave={fotoIA.alSalir}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-texto"><Sparkles className="size-4 text-acento" aria-hidden /> Pídele a la IA</h2>
      {seleccion && <p className="text-[0.7rem] text-texto-suave">Sobre la pieza elegida: «{seleccion.nombre}» (si no nombras otra).</p>}
      <form onSubmit={(e) => { e.preventDefault(); void pedir(texto); }} className="flex flex-col gap-2">
        <label htmlFor="escena-ia-texto" className="sr-only">Qué quieres en la escena</label>
        {/* En el teléfono: letra de 16 px (si no, iOS acerca la página al escribir) y alto con tope en dvh (el teclado no la tapa). */}
        <textarea id="escena-ia-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={1000} disabled={ocupado} enterKeyHint="send"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void pedir(texto); } }} onPaste={fotoIA.alPegar}
          placeholder="Pídele a la IA… «agrega dos columnas doradas a los lados del arco»"
          className="max-h-[30dvh] min-h-20 resize-y rounded-lg bg-superficie-suave p-2 text-base text-texto ring-1 ring-borde placeholder:text-texto-suave disabled:opacity-60 lg:max-h-none lg:text-sm" />
        <MiniaturaFotoIA estado={fotoIA} clase="flex items-center gap-2 text-xs text-texto-suave" />
        <div className="flex gap-2">
          <BotonFotoIA estado={fotoIA} deshabilitado={ocupado} clase={`${BOTON} ${INACTIVO} grid place-items-center px-3`} />
          <button type="submit" disabled={ocupado || (!texto.trim() && !fotoIA.foto)} className={`${BOTON} flex flex-1 items-center justify-center gap-2 bg-taller-primario text-taller-sobre-primario ring-taller-primario disabled:opacity-50`}>
            {ocupado ? <><Loader2 className="size-4 animate-spin" aria-hidden /> {textoDeProgreso(cargando, leyendoFoto, refinado.refinando)}</> : "Pedir"}
          </button>
          {refinado.refinando && <BotonDetener alTocar={refinado.detener} clase={`${BOTON} ${INACTIVO} flex items-center justify-center gap-2 px-3 text-xs`} />}
        </div>
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
      {previas.length > 0 && !ocupado && (
        <button type="button" onClick={deshacer} className={`${BOTON} ${INACTIVO} flex items-center justify-center gap-2 text-xs`}>
          <Undo2 className="size-4" aria-hidden /> Deshacer lo de la IA{previas.length > 1 ? ` (${previas.length})` : ""}
        </button>
      )}
    </section>
  );
}

type PropsCompacto = {
  texto: string; setTexto: (t: string) => void; cargando: boolean; respuesta: string | null; error: string | null;
  cambios: readonly Accion[]; previas: number; historial: readonly Turno[];
  pedir: (mensaje: string) => Promise<void>; deshacer: () => void; vueltas: number;
  pregunta: Pregunta | null; seleccion: SeleccionIA | null; leyendoFoto: boolean; fotoIA: FotoAdjuntaEstado;
  refinando: ProgresoRefinado | null; detener: () => void;
};

/** La IA como barra al pie del visor: una línea para pedir; arriba, al abrirse, la conversación, los ejemplos y deshacer. */
function AsistenteCompacto({ texto, setTexto, cargando, leyendoFoto, respuesta, error, cambios, previas, historial, pedir, deshacer, vueltas, pregunta, seleccion, fotoIA, refinando, detener }: PropsCompacto) {
  const ocupado = cargando || refinando !== null;
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
  const hayAlgo = historial.length > 0 || respuesta || error || ocupado;
  return (
    <div ref={raiz} className="flex w-full flex-col gap-2" onDrop={fotoIA.alSoltar} onDragOver={fotoIA.alArrastrar} onDragLeave={fotoIA.alSalir} onKeyDown={(e) => { if (e.key === "Escape" && abierta) { e.stopPropagation(); setAbierta(false); } }}>
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
            {ocupado && (
              <p className="flex items-center gap-2 text-taller-suave">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {textoDeProgreso(cargando, leyendoFoto, refinando)}
                {refinando && <BotonDetener alTocar={detener} clase="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-taller-borde px-2.5 text-xs text-taller-texto hover:bg-taller-encima" />}
              </p>
            )}
            {error && <p role="alert" className="rounded-lg bg-taller-tarjeta p-2 text-xs text-taller-texto ring-1 ring-taller-borde">{error}</p>}
            {respuesta && historial[historial.length - 1]?.texto !== respuesta.slice(0, 1400) && <p className="text-taller-texto-2">{respuesta}</p>}
            {pregunta && !cargando && <OpcionesPregunta pregunta={pregunta} pedir={pedir} clase="inline-flex min-h-9 items-center rounded-lg border border-taller-borde px-3 text-xs text-taller-texto hover:bg-taller-encima" />}
            {cambios.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-[0.75rem] text-taller-suave">
                {cambios.map((a, i) => <li key={i}>• {a.resumen}</li>)}
              </ul>
            )}
          </div>
          {previas > 0 && !ocupado && (
            <button type="button" onClick={deshacer} className="inline-flex min-h-9 items-center justify-center gap-2 self-start rounded-lg border border-taller-borde px-3 text-xs text-taller-texto hover:bg-taller-encima">
              <Undo2 className="size-4" aria-hidden /> Deshacer lo de la IA{previas > 1 ? ` (${previas})` : ""}
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
        className={`flex items-center gap-2 rounded-[14px] border bg-taller-barra/95 py-1.5 pl-3.5 pr-1.5 shadow-[0_10px_30px_var(--sombra)] backdrop-blur ${fotoIA.encima ? "border-taller-acento" : "border-taller-solitario-borde"}`}>
        <Sparkles className="size-[18px] shrink-0 text-taller-acento" aria-hidden />
        <MiniaturaFotoIA estado={fotoIA} clase="flex shrink-0 items-center gap-2" />
        <label htmlFor="escena-ia-linea" className="sr-only">Pedido a la IA</label>
        <input id="escena-ia-linea" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} disabled={ocupado} enterKeyHint="send" autoComplete="off"
          onFocus={() => { if (!texto && !hayAlgo) setAbierta(true); }} onPaste={fotoIA.alPegar}
          placeholder={fotoIA.foto ? "Di qué hacer con la foto (o envíala tal cual)…" : seleccion ? `Pídele a la IA sobre «${seleccion.nombre}»…` : "Pídele a la IA… «haz las columnas de 2,2 m y en dorado»"}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-taller-texto outline-none placeholder:text-taller-suave disabled:opacity-60" />
        <BotonFotoIA estado={fotoIA} deshabilitado={ocupado} clase="grid size-9 shrink-0 place-items-center rounded-[10px] text-taller-medio hover:bg-taller-encima hover:text-taller-texto disabled:opacity-50" />
        <button type="button" onClick={() => setAbierta(!abierta)} aria-expanded={abierta} aria-label={abierta ? "Cerrar la conversación" : "Ver la conversación y los ejemplos"} title={abierta ? "Cerrar (Esc)" : "Conversación y ejemplos"}
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-taller-medio hover:bg-taller-encima hover:text-taller-texto">
          {abierta ? <ChevronDown className="size-4" aria-hidden /> : <ChevronUp className="size-4" aria-hidden />}
        </button>
        {refinando && <BotonDetener alTocar={detener} clase="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-taller-borde px-2.5 text-[13px] text-taller-texto hover:bg-taller-encima" />}
        <button type="submit" disabled={ocupado || (!texto.trim() && !fotoIA.foto)} aria-label="Enviar a la IA"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-taller-primario px-3 text-[13px] font-medium text-taller-sobre-primario hover:bg-taller-primario-hover disabled:opacity-50">
          {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{refinando ? `Foto ${refinando.ronda}/${refinando.total}` : "Pedir"}
        </button>
      </form>
    </div>
  );
}
