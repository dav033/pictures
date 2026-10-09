"use client";

import { useState } from "react";
import type { MOTIVOS, MotivoId } from "@/lib/feedback-ia/motivos";
import { CLASES, type TemaCalificacion } from "./temas";

type Motivo = (typeof MOTIVOS)[number];

type Props = {
  tema: TemaCalificacion;
  id: string;
  /** Los motivos que se ofrecen (el chat del cliente no ve los del taller). */
  ofrecidos: readonly Motivo[];
  motivos: readonly MotivoId[];
  comentario: string;
  /** El turno se deshizo o se corrigió: la pregunta es qué falló, no qué tal quedó. */
  deshecho: boolean;
  /** Una sola línea: motivos que se deslizan a un lado y la caja de comentario detrás de «Escribir más» (el teléfono del cliente). */
  compacto: boolean;
  alMotivo: (motivo: MotivoId) => void;
  alComentario: (texto: string) => void;
  alEnviar: () => void;
  alCerrar: () => void;
};

function Chip({ tema, motivo, elegido, alMotivo, deslizable }: { tema: TemaCalificacion; motivo: Motivo; elegido: boolean; alMotivo: (m: MotivoId) => void; deslizable: boolean }) {
  const clases = CLASES[tema];
  return (
    <label className={`relative inline-flex min-h-9 cursor-pointer items-center rounded-full border px-2.5 text-[12px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 lg:min-h-7 ${deslizable ? "shrink-0 snap-start whitespace-nowrap" : ""} ${elegido ? clases.chipElegido : clases.chip}`}>
      <input type="checkbox" checked={elegido} onChange={() => alMotivo(motivo.id)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      {elegido && <span aria-hidden className="mr-1">✓</span>}
      {motivo.etiqueta}
    </label>
  );
}

function Comentario({ tema, comentario, alComentario }: { tema: TemaCalificacion; comentario: string; alComentario: (texto: string) => void }) {
  const clases = CLASES[tema];
  return (
    <label className="grid gap-1">
      <span className={`text-[12px] font-medium ${clases.texto}`}>¿Qué faltó o qué mejorarías?</span>
      <textarea
        value={comentario}
        onChange={(e) => alComentario(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Cuéntanos con tus palabras (opcional)"
        className={`min-h-16 w-full resize-y rounded-md border px-2 py-1.5 text-[16px] leading-snug sm:text-[13px] ${clases.campo} ${clases.foco}`}
      />
    </label>
  );
}

/** El «por qué»: motivos de opción múltiple y una caja para contar qué faltó o qué mejorarías. Todo es opcional. */
export function PanelPorQue({ tema, id, ofrecidos, motivos, comentario, deshecho, compacto, alMotivo, alComentario, alEnviar, alCerrar }: Props) {
  const clases = CLASES[tema];
  const [masAbierto, setMasAbierto] = useState(false);
  const verComentario = !compacto || masAbierto || comentario.length > 0;
  const etiquetaId = `${id}-legend`;
  const botonChico = `min-h-9 rounded-md px-3 text-[12px] font-medium lg:min-h-7 ${clases.foco}`;
  return (
    <form id={id} aria-label="Por qué" onSubmit={(e) => { e.preventDefault(); alEnviar(); }} className={`mt-2 grid gap-2 rounded-lg border ${compacto ? "p-2" : "p-2.5"} ${clases.panel}`}>
      {compacto ? (
        <div className="flex min-w-0 items-center gap-2">
          <span id={etiquetaId} className={`shrink-0 text-[12px] font-medium ${clases.texto}`}>{deshecho ? "¿Qué falló?" : "¿Qué pasó?"}</span>
          <div role="group" aria-labelledby={etiquetaId} className="flex min-w-0 flex-1 snap-x gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {ofrecidos.map((m) => <Chip key={m.id} tema={tema} motivo={m} elegido={motivos.includes(m.id)} alMotivo={alMotivo} deslizable />)}
          </div>
        </div>
      ) : (
        <fieldset className="grid gap-1.5">
          <legend className={`mb-1 text-[12px] font-medium ${clases.texto}`}>{deshecho ? "¿Qué falló? Elige lo que aplique" : "¿Qué pasó? Elige lo que aplique"}</legend>
          <div className="flex flex-wrap gap-1.5">
            {ofrecidos.map((m) => <Chip key={m.id} tema={tema} motivo={m} elegido={motivos.includes(m.id)} alMotivo={alMotivo} deslizable={false} />)}
          </div>
        </fieldset>
      )}
      {verComentario && <Comentario tema={tema} comentario={comentario} alComentario={alComentario} />}
      <div className="flex flex-wrap justify-end gap-1.5">
        {!verComentario && <button type="button" onClick={() => setMasAbierto(true)} className={`mr-auto ${botonChico} ${clases.enlace}`}>Escribir más</button>}
        <button type="button" onClick={alCerrar} className={`${botonChico} ${clases.secundario}`}>Cerrar</button>
        <button type="submit" className={`${botonChico} font-semibold ${clases.primario}`}>Enviar</button>
      </div>
    </form>
  );
}
