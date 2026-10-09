"use client";

import { useId } from "react";
import type { ConfigCalificacion, EstadoCalificacion } from "./controlador-calificacion";
import { ControlNota } from "./ControlNota";
import { PanelPorQue } from "./PanelPorQue";
import { CLASES, type TemaCalificacion } from "./temas";
import { useCalificacionIA, type CalificacionIA as Calificacion } from "./useCalificacionIA";

type Gestos = Omit<Calificacion, "estado">;

/** El texto de la línea de estado: ocupa siempre una línea, así lo que cambia no mueve nada. */
export function textoEstado(e: EstadoCalificacion): { texto: string; error: boolean } {
  if (e.fase === "error") return { texto: "No se pudo guardar.", error: true };
  if (e.fase === "enviando") return { texto: "Guardando…", error: false };
  if (e.gracias) return { texto: "Gracias. Puedes cambiar tu nota.", error: false };
  if (e.deshecho) return { texto: "Lo deshiciste: cuéntanos qué falló.", error: false };
  return { texto: "1 = muy mal · 10 = excelente", error: false };
}

type VistaProps = { tema: TemaCalificacion; compacta?: boolean; estado: EstadoCalificacion; gestos: Gestos };

/** La fila de calificación ya con su estado (separada del hook para poder dibujarla en cualquier estado). */
export function VistaCalificacion({ tema, compacta = false, estado, gestos }: VistaProps) {
  const clases = CLASES[tema];
  const base = useId();
  const etiquetaId = `${base}-etiqueta`;
  const panelId = `${base}-porque`;
  const { texto, error } = textoEstado(estado);
  return (
    <section aria-label="Calificar la respuesta de la IA" className={`${clases.raiz} text-[12px] ${compacta ? "" : "max-w-[34rem]"}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span id={etiquetaId} className={`font-medium ${clases.texto}`}>¿Qué tal quedó?</span>
        <button
          type="button"
          onClick={gestos.alternarPorQue}
          aria-expanded={estado.porQueAbierto}
          aria-controls={estado.porQueAbierto ? panelId : undefined}
          className={`ml-auto min-h-8 rounded px-1 text-[12px] ${clases.enlace} ${clases.foco}`}
        >
          {estado.porQueAbierto ? "Ocultar" : "Contar por qué"}
        </button>
      </div>
      <ControlNota tema={tema} etiquetaId={etiquetaId} nota={estado.nota} alElegir={gestos.calificar} />
      <p role="status" aria-live="polite" className={`mt-1 flex min-h-5 items-center gap-2 text-[11px] ${error ? clases.error : clases.suave}`}>
        <span>{texto}</span>
        {error && <button type="button" onClick={gestos.reintentar} className={`rounded px-1 font-medium underline ${clases.foco}`}>Reintentar</button>}
      </p>
      {estado.porQueAbierto && (
        <PanelPorQue
          tema={tema}
          id={panelId}
          motivos={estado.motivos}
          comentario={estado.comentario}
          deshecho={estado.deshecho}
          alMotivo={gestos.alternarMotivo}
          alComentario={gestos.escribirComentario}
          alEnviar={gestos.enviarPorQue}
          alCerrar={gestos.alternarPorQue}
        />
      )}
    </section>
  );
}

type Props = {
  tema: TemaCalificacion;
  config: ConfigCalificacion;
  /** La persona deshizo o corrigió este turno: se registra y se abre el «por qué» sola. */
  deshecho?: boolean;
  compacta?: boolean;
};

/**
 * La calificación 1 a 10 de un turno de la IA (REQ-010), la misma en el Taller y en los chats del cliente: una fila compacta,
 * siempre visible y que nunca interrumpe, con «Contar por qué» (motivos y comentario) que se abre sola al deshacer o corregir.
 */
export function CalificacionIA({ tema, config, deshecho = false, compacta = false }: Props) {
  const { estado, ...gestos } = useCalificacionIA(config, { deshecho });
  return <VistaCalificacion tema={tema} compacta={compacta} estado={estado} gestos={gestos} />;
}
