"use client";

import { forwardRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, Plus, Send, X } from "lucide-react";
import { ALCANCE_INICIAL, MAX_EXTRAS, MAX_TEXTO_PEDIDO, resolverAlcance, type AlcanceIA } from "@/lib/globos3d/alcance-ia";
import type { SeleccionIA } from "@/lib/globos3d/cuerpo-escena-ia";
import type { Escena } from "@/lib/globos3d/escena";
import { costeTexto } from "@/lib/globos3d/turnos-ia";
import { BotonFotoIA, MiniaturaFotoIA } from "../ControlFotoIA";
import type { FotoAdjuntaEstado } from "../useFotoAdjunta";
import type { AsistenteIA } from "./useAsistenteIA";

const FICHA = "inline-flex min-h-8 max-w-full shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px]";
const FICHA_ACTIVA = `${FICHA} bg-taller-elegido font-semibold text-taller-acento`;
const FICHA_GRIS = `${FICHA} border border-taller-borde bg-taller-tarjeta text-taller-suave hover:bg-taller-encima aria-pressed:border-taller-resalte aria-pressed:bg-taller-elegido aria-pressed:text-taller-acento`;

type Props = {
  ia: AsistenteIA;
  escena: Escena;
  /** La pieza elegida en el visor: entra sola como alcance del pedido. */
  seleccion: SeleccionIA | null;
  fotoIA: FotoAdjuntaEstado;
  /** Pedidos sugeridos para esta escena (una fila corta sobre la caja). */
  sugerencias: readonly string[];
  /** Algo al final de la fila de alcance (en el teléfono, «Borrar la conversación»: la hoja no tiene cabecera). */
  accionFinal?: ReactNode;
  /** Teléfono: la hoja es baja, así que la caja va en una sola línea y las fichas se deslizan. */
  enHoja: boolean;
  texto: string;
  alTexto: (t: string) => void;
  alEnviado: () => void;
};

/**
 * Donde se escribe el pedido: las fichas de alcance (pieza elegida, piezas añadidas, escena entera), la caja con adjuntar foto
 * (también se pega o se suelta), lo que suele tardar y las sugerencias según lo que hay en la escena.
 */
export const ComposicionIA = forwardRef<HTMLTextAreaElement, Props>(function ComposicionIA({ ia, escena, seleccion, fotoIA, sugerencias, accionFinal, enHoja, texto, alTexto, alEnviado }, ref) {
  const [alcance, setAlcance] = useState<AlcanceIA>(ALCANCE_INICIAL);
  // La pieza que se soltó con la «×» solo se olvida mientras siga siendo la elegida: al elegir otra, la ficha vuelve.
  if (alcance.descartada && alcance.descartada !== seleccion?.id) setAlcance({ ...alcance, descartada: null });
  const resuelto = resolverAlcance(escena, seleccion, alcance);
  const ocupado = ia.ocupado;
  const disponibles = escena.nodos.filter((n) => n.id !== resuelto.seleccion?.id && !resuelto.extras.some((e) => e.id === n.id));
  const puedeEnviar = !ocupado && (texto.trim().length > 0 || fotoIA.foto !== null);
  const pista = ocupado ? "Trabajando…" : fotoIA.foto ? "Con foto tarda más" : ia.tiempo ? `Suele tardar ${ia.tiempo}` : "Tarda unos segundos";

  const enviar = () => {
    if (!puedeEnviar) return;
    const foto = fotoIA.foto ? { mime: fotoIA.foto.mime, base64: fotoIA.foto.base64 } : null;
    const textoPedido = texto;
    const escenaEnteraConElegida = alcance.escenaEntera && seleccion !== null;
    alTexto("");
    if (foto) fotoIA.quitar();
    setAlcance({ ...alcance, escenaEntera: false, extras: [] });
    alEnviado();
    void ia.enviar({ texto: textoPedido, foto, alcance: resuelto, escenaEnteraConElegida }).then((bien) => {
      // Si falló o se detuvo, lo escrito vuelve a la caja para no perderlo.
      if (!bien) alTexto(textoPedido);
    });
  };
  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); enviar(); }} className="grid shrink-0 gap-2 border-t border-taller-linea bg-taller-barra p-2.5" aria-label="Pedirle algo a la IA">
      {/* Trabajando en el teléfono: solo la caja, para que la hoja deje ver la tarjeta del turno en curso. */}
      {!(enHoja && ocupado) && (
        <div className="flex items-center gap-1.5 overflow-x-auto text-[11.5px] text-taller-suave sm:flex-wrap sm:overflow-visible" role="group" aria-label="Sobre qué trabaja la IA">
          <span className="shrink-0">Sobre:</span>
          {resuelto.seleccion && (
            <span className={FICHA_ACTIVA}>
              <span className="truncate">{resuelto.seleccion.nombre}</span>
              <button type="button" onClick={() => setAlcance({ ...alcance, descartada: resuelto.seleccion?.id ?? null })} aria-label={`Quitar «${resuelto.seleccion.nombre}» del alcance`} className="grid size-5 place-items-center rounded-full hover:bg-taller-encima"><X className="size-3" aria-hidden /></button>
            </span>
          )}
          {resuelto.extras.map((e) => (
            <span key={e.id} className={FICHA_ACTIVA}>
              <span className="truncate">{e.nombre}</span>
              <button type="button" onClick={() => setAlcance({ ...alcance, extras: alcance.extras.filter((x) => x !== e.id) })} aria-label={`Quitar «${e.nombre}» del alcance`} className="grid size-5 place-items-center rounded-full hover:bg-taller-encima"><X className="size-3" aria-hidden /></button>
            </span>
          ))}
          {!alcance.escenaEntera && resuelto.extras.length < MAX_EXTRAS && disponibles.length > 0 && (
            <label className={`${FICHA_GRIS} relative cursor-pointer`}>
              <Plus className="size-3" aria-hidden /> añadir pieza
              <select aria-label="Añadir una pieza al alcance" value="" onChange={(e) => { if (e.target.value) setAlcance({ ...alcance, extras: [...alcance.extras, e.target.value] }); }}
                className="absolute inset-0 size-full cursor-pointer opacity-0">
                <option value="">añadir pieza</option>
                {disponibles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
              </select>
            </label>
          )}
          <button type="button" aria-pressed={alcance.escenaEntera} onClick={() => setAlcance({ ...alcance, escenaEntera: !alcance.escenaEntera })} className={FICHA_GRIS}>Escena entera</button>
          {accionFinal && <span className="ml-auto shrink-0">{accionFinal}</span>}
        </div>
      )}

      {sugerencias.length > 0 && !texto && !ocupado && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sugerencias para esta escena">
          {sugerencias.map((s) => <button key={s} type="button" onClick={() => alTexto(s)} className="min-h-8 rounded-full border border-taller-borde bg-taller-tarjeta px-2.5 text-left text-[11.5px] text-taller-texto-2 hover:bg-taller-encima">{s}</button>)}
        </div>
      )}

      <div className={`grid gap-1.5 rounded-xl border bg-taller-tarjeta p-2 ${fotoIA.encima ? "border-taller-resalte" : "border-taller-borde"}`}>
        <MiniaturaFotoIA estado={fotoIA} clase="flex items-center gap-2 text-xs text-taller-suave" />
        <label htmlFor="ia-pedido" className="sr-only">Qué quieres cambiar en la escena</label>
        <div className={enHoja ? "flex items-end gap-1.5" : "grid gap-1.5"}>
          {/* Letra de 16 px en el teléfono: si no, iOS acerca la página al escribir. */}
          <textarea ref={ref} id="ia-pedido" value={texto} onChange={(e) => alTexto(e.target.value)} onKeyDown={alTeclear} onPaste={fotoIA.alPegar} rows={enHoja ? 1 : 3} maxLength={MAX_TEXTO_PEDIDO} disabled={ocupado} enterKeyHint="send"
            placeholder={fotoIA.foto ? "Di qué hacer con la foto (o envíala tal cual)…" : enHoja ? "Pídele un cambio…" : resuelto.seleccion ? `Pídele un cambio sobre «${resuelto.seleccion.nombre}»…` : "Pídele un cambio… «copia esta columna al otro lado»"}
            className="max-h-[22dvh] min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-base text-taller-texto outline-none placeholder:text-taller-suave disabled:opacity-60 lg:min-h-12 lg:py-0 lg:text-[13px]" />
          <div className="flex items-center gap-2">
            <BotonFotoIA estado={fotoIA} deshabilitado={ocupado} clase="inline-grid size-10 shrink-0 place-items-center rounded-lg border border-taller-borde bg-taller-boton text-taller-texto hover:bg-taller-encima disabled:opacity-45 lg:size-9" />
            <span className={enHoja ? "sr-only" : "min-w-0 flex-1 truncate text-[11px] text-taller-suave"} aria-live="polite">{pista}</span>
            <button type="submit" disabled={!puedeEnviar} aria-label="Enviar a la IA"
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-taller-primario bg-taller-primario px-3 text-[13px] font-medium text-taller-sobre-primario hover:bg-taller-primario-hover disabled:cursor-not-allowed disabled:opacity-45 lg:min-h-9">
              {ocupado ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Send className="size-4" aria-hidden />}
              <span className={enHoja ? "sr-only" : ""}>Enviar</span>
            </button>
          </div>
        </div>
      </div>
      {ia.costeTotalUsd > 0 && !enHoja && <p className="text-[11px] text-taller-suave">Esta conversación: {costeTexto(ia.costeTotalUsd)} estimados en IA de texto.</p>}
    </form>
  );
});
