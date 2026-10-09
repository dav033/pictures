"use client";

import { MOTIVOS, type MotivoId } from "@/lib/feedback-ia/motivos";
import { CLASES, type TemaCalificacion } from "./temas";

type Props = {
  tema: TemaCalificacion;
  id: string;
  motivos: readonly MotivoId[];
  comentario: string;
  /** El turno se deshizo o se corrigió: la pregunta es qué falló, no qué tal quedó. */
  deshecho: boolean;
  alMotivo: (motivo: MotivoId) => void;
  alComentario: (texto: string) => void;
  alEnviar: () => void;
  alCerrar: () => void;
};

/** El «por qué»: motivos de opción múltiple y una caja para contar qué faltó o qué mejorarías. Todo es opcional. */
export function PanelPorQue({ tema, id, motivos, comentario, deshecho, alMotivo, alComentario, alEnviar, alCerrar }: Props) {
  const clases = CLASES[tema];
  return (
    <form id={id} aria-label="Por qué" onSubmit={(e) => { e.preventDefault(); alEnviar(); }} className={`mt-2 grid gap-2 rounded-lg border p-2.5 ${clases.panel}`}>
      <fieldset className="grid gap-1.5">
        <legend className={`mb-1 text-[12px] font-medium ${clases.texto}`}>{deshecho ? "¿Qué falló? Elige lo que aplique" : "¿Qué pasó? Elige lo que aplique"}</legend>
        <div className="flex flex-wrap gap-1.5">
          {MOTIVOS.map((m) => {
            const elegido = motivos.includes(m.id);
            return (
              <label key={m.id} className={`relative inline-flex min-h-9 cursor-pointer items-center rounded-full border px-2.5 text-[12px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 lg:min-h-7 ${elegido ? clases.chipElegido : clases.chip}`}>
                <input type="checkbox" checked={elegido} onChange={() => alMotivo(m.id)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                {elegido && <span aria-hidden className="mr-1">✓</span>}
                {m.etiqueta}
              </label>
            );
          })}
        </div>
      </fieldset>
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
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" onClick={alCerrar} className={`min-h-9 rounded-md px-3 text-[12px] font-medium lg:min-h-7 ${clases.secundario} ${clases.foco}`}>Cerrar</button>
        <button type="submit" className={`min-h-9 rounded-md px-3 text-[12px] font-semibold lg:min-h-7 ${clases.primario} ${clases.foco}`}>Enviar</button>
      </div>
    </form>
  );
}
