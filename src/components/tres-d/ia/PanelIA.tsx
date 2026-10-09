"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import type { SeleccionIA } from "@/lib/globos3d/cuerpo-escena-ia";
import type { Escena } from "@/lib/globos3d/escena";
import { sugerenciasIA } from "@/lib/globos3d/sugerencias-ia";
import type { AmbitoTurno } from "@/lib/globos3d/turnos-ia";
import { useFotoAdjunta } from "../useFotoAdjunta";
import { ComposicionIA } from "./ComposicionIA";
import { TarjetaComparando, TarjetaEnCurso } from "./TarjetaEnCurso";
import { TarjetaFotoRealista } from "./TarjetaFotoRealista";
import { TarjetaPregunta } from "./TarjetaPregunta";
import { BurbujaPedido, TarjetaTurno } from "./TarjetaTurno";
import type { AsistenteIA } from "./useAsistenteIA";

type Props = {
  ia: AsistenteIA;
  escena: Escena;
  ambito: AmbitoTurno;
  seleccion: SeleccionIA | null;
  /** Teléfono: dentro de la hoja inferior (más compacto; sin la tarjeta de la foto realista, que tiene su botón arriba). */
  enHoja?: boolean;
  alFotoRealista: () => void;
  alElegirPieza: (id: string) => void;
  /** Tras mandar un pedido (en el teléfono, la hoja baja para dejar ver la escena). */
  alEnviado?: () => void;
};

const reducido = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * La pestaña «IA» del panel lateral (D-021, dirección B): la conversación como hilo de tarjetas (cada pedido y lo que hizo la IA,
 * con su lista de cambios y «Deshacer turno»), las preguntas de la IA, lo que está haciendo ahora con «Detener», y abajo donde
 * se escribe el pedido y la foto realista. Nunca tapa el visor.
 */
export function PanelIA({ ia, escena, ambito, seleccion, enHoja = false, alFotoRealista, alElegirPieza, alEnviado }: Props) {
  const fotoIA = useFotoAdjunta();
  const [texto, setTexto] = useState("");
  const hilo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const hayPieza = (id: string) => escena.nodos.some((n) => n.id === id);
  const vacio = ia.turnos.length === 0 && !ia.enCurso;
  const sugerencias = sugerenciasIA(escena, seleccion, 3);
  const botonBorrar = ia.turnos.length > 0 && (
    <button type="button" onClick={ia.borrar} disabled={ia.ocupado} aria-label="Borrar la conversación" title="Borrar la conversación (la escena no cambia)"
      className="grid size-8 shrink-0 place-items-center rounded-lg text-taller-suave hover:bg-taller-encima hover:text-taller-texto disabled:opacity-45"><Trash2 className="size-4" aria-hidden /></button>
  );

  // Al llegar algo nuevo, el hilo baja hasta lo último.
  const novedades = ia.turnos.length + (ia.enCurso?.pasos.length ?? 0) + (ia.enCurso ? 1 : 0);
  useEffect(() => {
    const el = hilo.current;
    const ultimo = el?.lastElementChild;
    if (!el || !(ultimo instanceof HTMLElement)) return;
    // Lo último que llegó se ve desde su comienzo (en la hoja del teléfono una tarjeta puede ser más alta que el hilo).
    const alComienzo = el.scrollTop + ultimo.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    el.scrollTo({ top: Math.min(el.scrollHeight - el.clientHeight, Math.max(0, alComienzo)), behavior: reducido() ? "auto" : "smooth" });
  }, [novedades]);

  const reusar = (pedido: string) => { setTexto(pedido); caja.current?.focus(); };
  const responder = (opcion: string) => {
    alEnviado?.();
    void ia.enviar({ texto: opcion, foto: null, alcance: { seleccion, extras: [], contexto: seleccion ? `sobre «${seleccion.nombre}»` : "escena entera" }, escenaEnteraConElegida: false });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onDrop={fotoIA.alSoltar} onDragOver={fotoIA.alArrastrar} onDragLeave={fotoIA.alSalir}>
      {!enHoja && (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
          <Sparkles className="size-4 text-taller-acento" aria-hidden />
          <h2 className="flex-1 text-[13px] font-semibold text-taller-texto">Asistente de IA</h2>
          {botonBorrar}
        </div>
      )}

      <div ref={hilo} role="log" aria-live="polite" aria-label="Conversación con la IA" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2">
        {vacio && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-taller-suave">
              Pídele un cambio en lenguaje natural: la IA lo hace con las herramientas del taller, te muestra qué cambió y puedes deshacer ese turno sin perder lo que edites a mano. {enHoja ? "" : "Arrastra o pega una foto de una decoración para que la arme."}
            </p>
            <div role="group" aria-label="Sugerencias para esta escena" className="flex flex-col gap-1">
              {sugerencias.slice(0, enHoja ? 2 : 3).map((s) => (
                <button key={s} type="button" onClick={() => { setTexto(s); caja.current?.focus(); }}
                  className="min-h-9 rounded-lg border border-taller-borde bg-taller-tarjeta px-2.5 text-left text-xs text-taller-texto-2 hover:bg-taller-encima">{s}</button>
              ))}
            </div>
          </div>
        )}
        {ia.turnos.map((t) => (
          <div key={t.id} className="flex flex-col gap-2">
            <BurbujaPedido pedido={t.pedido} contexto={t.contexto} foto={t.foto} />
            <TarjetaTurno turno={t} ambitoActual={ambito} viendoAntes={ia.antesId === t.id} hayPieza={hayPieza}
              alDeshacer={ia.deshacer} alVerAntes={ia.verAntes} alApuntar={ia.apuntar} alElegir={alElegirPieza} alReusar={reusar} />
          </div>
        ))}
        {ia.preguntaPendiente && <TarjetaPregunta pregunta={ia.preguntaPendiente} ocupado={ia.ocupado} alResponder={responder} alOtraCosa={() => caja.current?.focus()} />}
        {ia.enCurso && <TarjetaEnCurso enCurso={ia.enCurso} alDetener={ia.detener} />}
        {ia.refinando && !ia.enCurso && <TarjetaComparando progreso={ia.refinando} alDetener={ia.detener} />}
      </div>

      {!enHoja && <div className="shrink-0 px-2.5 pb-2"><TarjetaFotoRealista alAbrir={alFotoRealista} deshabilitado={false} /></div>}
      <ComposicionIA ref={caja} ia={ia} escena={escena} seleccion={seleccion} fotoIA={fotoIA} sugerencias={vacio || enHoja ? [] : sugerencias.slice(0, 2)} accionFinal={enHoja ? botonBorrar : null} enHoja={enHoja} texto={texto} alTexto={setTexto} alEnviado={alEnviado ?? (() => {})} />
    </div>
  );
}
