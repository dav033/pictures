"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import type { SeleccionIA } from "@/lib/globos3d/cuerpo-escena-ia";
import type { Escena } from "@/lib/globos3d/escena";
import { sugerenciasIA } from "@/lib/globos3d/sugerencias-ia";
import type { TurnoPanel } from "@/lib/globos3d/turnos-ia";
import { useFotoAdjunta } from "../useFotoAdjunta";
import { ComposicionIA } from "./ComposicionIA";
import { MenuConversacion } from "./MenuConversacion";
import { TarjetaComparando, TarjetaEnCurso } from "./TarjetaEnCurso";
import { TarjetaFotoRealista } from "./TarjetaFotoRealista";
import { TarjetaPregunta } from "./TarjetaPregunta";
import { BurbujaPedido, TarjetaTurno } from "./TarjetaTurno";
import type { AsistenteIA } from "./useAsistenteIA";

type Props = {
  ia: AsistenteIA;
  escena: Escena;
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
 * se escribe el pedido y la foto realista. Nunca tapa el visor. El hilo solo baja solo si ya estabas al final (si no, avisa).
 */
export function PanelIA({ ia, escena, seleccion, enHoja = false, alFotoRealista, alElegirPieza, alEnviado }: Props) {
  const fotoIA = useFotoAdjunta();
  const [texto, setTexto] = useState("");
  const [hayNuevo, setHayNuevo] = useState(false);
  const hilo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const siguiendo = useRef(true);
  const primera = useRef(true);
  const hayPieza = (id: string) => escena.nodos.some((n) => n.id === id);
  const vacio = ia.turnos.length === 0 && !ia.enCurso;
  const sugerencias = sugerenciasIA(escena, seleccion, 3);
  const menu = ia.turnos.length > 0 && <MenuConversacion alBorrar={ia.borrar} deshabilitado={ia.ocupado} haciaArriba={enHoja} />;

  // Lo último que llegó se ve desde su comienzo (una tarjeta puede ser más alta que el hilo): solo si ya se estaba siguiendo el final.
  const novedades = ia.turnos.length + (ia.enCurso?.pasos.length ?? 0) + (ia.enCurso ? 1 : 0);
  const bajar = (suave: boolean) => {
    const el = hilo.current;
    const ultimo = el?.lastElementChild;
    if (!el || !(ultimo instanceof HTMLElement)) return;
    // Se alinea la tarjeta (no el pedido que la precede): en el teléfono el hilo es bajo y lo que importa es su resumen y sus botones.
    const tarjeta = ultimo.querySelector("article") ?? ultimo;
    const alComienzo = el.scrollTop + tarjeta.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    el.scrollTo({ top: Math.min(el.scrollHeight - el.clientHeight, Math.max(0, alComienzo)), behavior: suave && !reducido() ? "smooth" : "auto" });
    siguiendo.current = true;
    setHayNuevo(false);
  };
  useEffect(() => {
    if (primera.current) { primera.current = false; bajar(false); return; }
    if (siguiendo.current) bajar(true);
    else setHayNuevo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando llega algo nuevo
  }, [novedades]);
  const alDeslizar = () => {
    const el = hilo.current;
    const ultimo = el?.lastElementChild;
    if (!el || !(ultimo instanceof HTMLElement)) return;
    const alFinal = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const comienzoUltimo = ultimo.getBoundingClientRect().top - el.getBoundingClientRect().top;
    siguiendo.current = alFinal || (comienzoUltimo >= 0 && comienzoUltimo < el.clientHeight * 0.5);
    if (siguiendo.current) setHayNuevo(false);
  };

  // Esc detiene a la IA mientras trabaja (la caja está desactivada, así que el foco puede estar en cualquier parte).
  useEffect(() => {
    if (!ia.ocupado) return;
    const alTeclado = (e: KeyboardEvent) => { if (e.key === "Escape") ia.detener(); };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [ia]);

  const alcanceActual = { seleccion, extras: [], contexto: seleccion ? `sobre «${seleccion.nombre}»` : "escena entera" };
  const responder = (opcion: string) => {
    alEnviado?.();
    void ia.enviar({ texto: opcion, foto: null, alcance: alcanceActual, escenaEnteraConElegida: false });
  };
  /** «Volver a intentarlo» lo manda de nuevo; si llevaba foto (que no se guarda), vuelve a la caja para adjuntarla otra vez. */
  const reintentar = (t: TurnoPanel) => {
    if (t.foto) { setTexto(t.pedido); caja.current?.focus(); return; }
    alEnviado?.();
    void ia.enviar({ texto: t.pedido, foto: null, alcance: alcanceActual, escenaEnteraConElegida: false });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onDrop={fotoIA.alSoltar} onDragOver={fotoIA.alArrastrar} onDragLeave={fotoIA.alSalir}>
      {!enHoja && (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-2">
          <Sparkles className="size-4 text-taller-acento" aria-hidden />
          <h2 className="flex-1 text-[13px] font-semibold text-taller-texto">Asistente de IA</h2>
          {menu}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={hilo} onScroll={alDeslizar} role="log" aria-live="polite" aria-label="Conversación con la IA" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2">
          {vacio && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-taller-suave">
                Pídele un cambio en lenguaje natural: la IA lo hace con las herramientas del taller, te muestra qué cambió y puedes deshacer ese turno sin perder lo que edites a mano. {enHoja ? "" : "Arrastra o pega una foto de una decoración para que la arme."}
              </p>
              <div role="group" aria-label="Sugerencias para esta escena" className="flex flex-col gap-1">
                {sugerencias.slice(0, enHoja ? 2 : 3).map((s) => (
                  <button key={s} type="button" onClick={() => { setTexto(s); caja.current?.focus(); }}
                    className="min-h-10 rounded-lg border border-taller-borde bg-taller-tarjeta px-2.5 text-left text-xs text-taller-texto-2 hover:bg-taller-encima">{s}</button>
                ))}
              </div>
            </div>
          )}
          {ia.turnos.map((t, i) => (
            <div key={t.id} className="flex flex-col gap-2">
              <BurbujaPedido pedido={t.pedido} contexto={t.contexto} foto={t.foto} />
              <TarjetaTurno turno={t} estado={ia.estados[t.id]} aviso={ia.avisos[t.id]} esUltimo={i === ia.turnos.length - 1} compacta={enHoja} viendoAntes={ia.antesId === t.id} hayPieza={hayPieza}
                alDeshacer={ia.deshacer} alRehacer={ia.rehacer} alVerAntes={ia.verAntes} alApuntar={ia.apuntar} alElegir={alElegirPieza} alReintentar={reintentar} />
            </div>
          ))}
          {ia.preguntaPendiente && <TarjetaPregunta pregunta={ia.preguntaPendiente} ocupado={ia.ocupado} alResponder={responder} alOtraCosa={() => caja.current?.focus()} />}
          {ia.enCurso && <TarjetaEnCurso enCurso={ia.enCurso} alDetener={ia.detener} />}
          {ia.refinando && !ia.enCurso && <TarjetaComparando progreso={ia.refinando} alDetener={ia.detener} />}
        </div>
        {hayNuevo && (
          <button type="button" onClick={() => bajar(true)} className="absolute bottom-2 left-1/2 inline-flex min-h-10 -translate-x-1/2 items-center gap-1.5 rounded-full border border-taller-resalte bg-taller-barra px-3 text-xs font-medium text-taller-acento shadow-[0_6px_18px_var(--sombra)] lg:min-h-8">
            <ArrowDown className="size-3.5" aria-hidden /> nuevo
          </button>
        )}
      </div>

      <ComposicionIA ref={caja} ia={ia} escena={escena} seleccion={seleccion} fotoIA={fotoIA} sugerencias={vacio || enHoja ? [] : sugerencias.slice(0, 2)} menu={menu} enHoja={enHoja}
        texto={texto} alTexto={setTexto} alEnviado={alEnviado ?? (() => {})} />
      {!enHoja && <TarjetaFotoRealista alAbrir={alFotoRealista} />}
    </div>
  );
}
