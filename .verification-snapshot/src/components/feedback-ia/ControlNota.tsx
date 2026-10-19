"use client";

import { useRef, type KeyboardEvent } from "react";
import { CLASES, type TemaCalificacion } from "./temas";

const NOTAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

type Props = {
  tema: TemaCalificacion;
  etiquetaId: string;
  nota: number | null;
  /** Mientras se guarda, la nota se ve pero no se vuelve a mandar encima. */
  alElegir: (nota: number) => void;
};

/**
 * La escala 1 a 10 como grupo de opciones: una sola parada de Tab (la nota elegida, o el 1), flechas / Inicio / Fin mueven el
 * foco y Enter o Espacio eligen (elegir manda la nota, así que las flechas solas no disparan peticiones). Cliente: cinco columnas en dos filas
 * donde no caben diez casillas de 40 px (teléfono) y diez desde 448 px de ancho; Taller: diez columnas. No se mueve nada al elegir.
 */
export function ControlNota({ tema, etiquetaId, nota, alElegir }: Props) {
  const clases = CLASES[tema];
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const parada = nota ?? 1;

  const mover = (hacia: number) => {
    const destino = Math.min(10, Math.max(1, hacia));
    botones.current[destino - 1]?.focus();
  };
  const alTeclado = (e: KeyboardEvent<HTMLButtonElement>, actual: number) => {
    const pasos: Record<string, number> = { ArrowRight: actual + 1, ArrowDown: actual + 1, ArrowLeft: actual - 1, ArrowUp: actual - 1, Home: 1, End: 10 };
    const destino = pasos[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    mover(destino);
  };

  return (
    <div className="@container">
    <div role="radiogroup" aria-labelledby={etiquetaId} className={`grid gap-1 ${tema === "cliente" ? "grid-cols-5 @md:grid-cols-10" : "grid-cols-10"}`}>
      {NOTAS.map((n) => {
        const elegida = nota === n;
        return (
          <button
            key={n}
            ref={(el) => { botones.current[n - 1] = el; }}
            type="button"
            role="radio"
            aria-checked={elegida}
            aria-label={`${n} de 10`}
            tabIndex={n === parada ? 0 : -1}
            onClick={() => alElegir(n)}
            onKeyDown={(e) => alTeclado(e, n)}
            className={`${tema === "cliente" ? "h-10" : "h-9 lg:h-7"} min-w-0 rounded-md border text-[12px] font-semibold tabular-nums transition-colors ${clases.foco} ${elegida ? clases.notaElegida : clases.nota}`}
          >
            {n}
          </button>
        );
      })}
    </div>
    </div>
  );
}
