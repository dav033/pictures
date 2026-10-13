"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ConfigCalificacion, EstadoCalificacion } from "./controlador-calificacion";
import { ControlNota } from "./ControlNota";
import { motivosVisibles } from "./motivos-ui";
import { PanelPorQue } from "./PanelPorQue";
import { CLASES, type TemaCalificacion } from "./temas";
import { useCalificacionIA, type CalificacionIA as Calificacion } from "./useCalificacionIA";

type Gestos = Omit<Calificacion, "estado">;

/** El texto de la línea de estado: ocupa siempre una línea, así lo que cambia no mueve nada. */
export function textoEstado(e: EstadoCalificacion): { texto: string; error: boolean } {
  if (e.fase === "ajeno") return { texto: "Calificado desde otro navegador.", error: false };
  if (e.fase === "error") return { texto: "No se pudo guardar.", error: true };
  if (e.fase === "enviando") return { texto: "Guardando…", error: false };
  if (e.gracias) return { texto: "Gracias. Puedes cambiar tu nota.", error: false };
  if (e.deshecho) return { texto: "Lo deshiciste: cuéntanos qué falló.", error: false };
  return { texto: "1 = muy mal · 10 = excelente", error: false };
}

type VistaProps = {
  tema: TemaCalificacion;
  compacta?: boolean;
  /** Una respuesta que ya no es la última del chat: una sola línea hasta que la persona la abre. */
  resumida?: boolean;
  /** El chat produjo una imagen: entonces «La foto realista no coincide» tiene sentido. */
  conImagen?: boolean;
  /** Siempre una sola línea «¿Te sirvió?» hasta que la persona la abre, también en la última respuesta (chat guiado). */
  plegable?: boolean;
  estado: EstadoCalificacion;
  gestos: Gestos;
};

/** Altura mínima de lo tocable: 40 px en el chat del cliente (teléfono), 32 px en el Taller. */
const ALTO_TOQUE: Record<TemaCalificacion, string> = { taller: "min-h-8", cliente: "min-h-10" };

function LineaResumida({ tema, estado, plegable, alAbrir }: { tema: TemaCalificacion; estado: EstadoCalificacion; plegable: boolean; alAbrir: () => void }) {
  const clases = CLASES[tema];
  const alto = ALTO_TOQUE[tema];
  return (
    <p className={`flex ${alto} items-center gap-2 text-[12px] ${clases.suave}`}>
      <span>{estado.nota === null ? (plegable ? "¿Te sirvió?" : "¿Qué tal quedó?") : `Tu nota: ${estado.nota}/10`}</span>
      <button type="button" onClick={alAbrir} aria-expanded={false} className={`${alto} rounded px-2 font-medium ${clases.enlace} ${clases.foco}`}>{estado.nota === null ? "Calificar" : "Cambiar"}</button>
    </p>
  );
}

/** La fila de calificación ya con su estado (separada del hook para poder dibujarla en cualquier estado). */
export function VistaCalificacion({ tema, compacta = false, resumida = false, conImagen = false, plegable = false, estado, gestos }: VistaProps) {
  const clases = CLASES[tema];
  const base = useId();
  const [abierta, setAbierta] = useState(false);
  const raiz = useRef<HTMLElement>(null);
  // Abrir desde la línea desmonta el botón que tenía el foco: se lleva a la parada de la escala para no perderlo.
  useEffect(() => {
    if (abierta) raiz.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, [abierta]);
  const etiquetaId = `${base}-etiqueta`;
  const panelId = `${base}-porque`;
  const { texto, error } = textoEstado(estado);
  const panel = estado.porQueAbierto && (
    <PanelPorQue
      tema={tema}
      id={panelId}
      ofrecidos={motivosVisibles(tema, { conImagen })}
      motivos={estado.motivos}
      comentario={estado.comentario}
      deshecho={estado.deshecho}
      compacto={tema === "cliente"}
      alMotivo={gestos.alternarMotivo}
      alComentario={gestos.escribirComentario}
      alEnviar={gestos.enviarPorQue}
      alCerrar={gestos.alternarPorQue}
    />
  );
  if ((resumida || plegable) && !abierta) {
    return (
      <section aria-label="Calificar la respuesta de la IA" className="text-[12px]">
        <LineaResumida tema={tema} estado={estado} plegable={plegable} alAbrir={() => setAbierta(true)} />
        {error && (
          <p role="status" className={`min-h-5 text-[11px] ${clases.error}`}>
            {texto} <button type="button" onClick={gestos.reintentar} className={`rounded px-1 font-medium underline ${clases.foco}`}>Reintentar</button>
          </p>
        )}
        {panel}
      </section>
    );
  }
  return (
    <section ref={raiz} aria-label="Calificar la respuesta de la IA" className={`${clases.raiz} text-[12px] ${compacta ? "" : "max-w-[34rem]"}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span id={etiquetaId} className={`font-medium ${clases.texto}`}>¿Qué tal quedó?</span>
        <button
          type="button"
          onClick={gestos.alternarPorQue}
          aria-expanded={estado.porQueAbierto}
          aria-controls={estado.porQueAbierto ? panelId : undefined}
          className={`ml-auto ${ALTO_TOQUE[tema]} rounded px-1 text-[12px] ${clases.enlace} ${clases.foco}`}
        >
          {estado.porQueAbierto ? "Ocultar" : "Contar por qué"}
        </button>
      </div>
      <ControlNota tema={tema} etiquetaId={etiquetaId} nota={estado.nota} alElegir={gestos.calificar} />
      <p role="status" aria-live="polite" className={`mt-1 flex min-h-5 items-center gap-2 text-[11px] ${error ? clases.error : clases.suave}`}>
        <span>{texto}</span>
        {error && <button type="button" onClick={gestos.reintentar} className={`rounded px-1 font-medium underline ${clases.foco}`}>Reintentar</button>}
      </p>
      {panel}
    </section>
  );
}

type Props = {
  tema: TemaCalificacion;
  config: ConfigCalificacion;
  /** La persona deshizo o corrigió este turno (`undefined`: no se sabe, el turno es de otra escena): se registra y se abre el «por qué». */
  deshecho?: boolean | undefined;
  /** El turno se produjo en esta página (se registra al terminar); lo restaurado solo consulta su calificación guardada. */
  producido?: boolean;
  compacta?: boolean;
  resumida?: boolean;
  conImagen?: boolean;
  plegable?: boolean;
};

/**
 * La calificación 1 a 10 de un turno de la IA (REQ-010), la misma en el Taller y en los chats del cliente: una fila compacta,
 * siempre visible y que nunca interrumpe, con «Contar por qué» (motivos y comentario) que se abre sola al deshacer o corregir.
 */
export function CalificacionIA({ tema, config, deshecho, producido = false, compacta = false, resumida = false, conImagen = false, plegable = false }: Props) {
  const { estado, ...gestos } = useCalificacionIA(config, { deshecho, producido });
  return <VistaCalificacion tema={tema} compacta={compacta} resumida={resumida} conImagen={conImagen} plegable={plegable} estado={estado} gestos={gestos} />;
}
