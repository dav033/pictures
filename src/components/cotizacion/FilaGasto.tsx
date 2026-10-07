"use client";

import type { KeyboardEvent } from "react";
import { motion } from "motion/react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { filaEnBlanco, type ErroresFila, type FilaCosto } from "@/lib/cotizacion/borrador-profesional";
import type { SeccionCosto } from "@/lib/cotizacion/profesional";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { DUR, EASE_SALIDA } from "@/components/guiado/animacion/movimiento";
import { MensajesDeError, useEscrituraPesos } from "./Campo";
import { CONCEPTOS_GASTO, EJEMPLO_VALOR, faltaEnFila, pasoCantidad } from "./conceptos-gasto";
import { CLASE_NO_VIGENTE } from "./formato";

type CampoFila = "descripcion" | "costo" | "cantidad";

type Props = {
  seccion: SeccionCosto;
  /** Prefijo de los ids de esta fila (`${seccion}-${clave}-${fila.id}`). */
  base: string;
  titulo: string;
  fila: FilaCosto;
  /** Qué dice cada celda mala de esta fila. */
  errores: ErroresFila;
  /** Ya se salió de la fila: lo que falta se marca en rojo (antes solo se sugiere). */
  tocada: boolean;
  /** Subtotal de Python para esta fila, o `null` si no estuvo en el último cálculo. */
  subtotal: number | null;
  atenuar: boolean;
  onCambiar: (cambios: Partial<FilaCosto>, campo: CampoFila) => void;
  onConcepto: (concepto: string) => void;
  onPaso: (sentido: 1 | -1, texto: string) => void;
  onQuitar: () => void;
  onSalir: () => void;
};

const CAMPO_BASE = "h-11 rounded-lg border text-[15px] text-texto outline-none transition-colors placeholder:text-[13px] placeholder:font-normal placeholder:text-texto-tenue";
const FOCO = "focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento";

/** Enter pasa al campo siguiente de la fila, como en una hoja de cálculo; en el último, se queda. */
function alSiguiente(evento: KeyboardEvent<HTMLInputElement>, siguiente: string): void {
  if (evento.key !== "Enter") return;
  evento.preventDefault();
  document.getElementById(siguiente)?.focus();
}

/**
 * Un gasto: qué es (con ideas de un toque si está en blanco), cuánto vale cada
 * unidad (con «$» y los miles a la vista), cuántas (− / +) y, a la derecha, su
 * total, que es el de Python y cuenta hasta el nuevo valor. Lo que falta se
 * sugiere mientras se escribe y se marca en rojo al salir de la fila.
 */
export function FilaGasto({ seccion, base, titulo, fila, errores, tocada, subtotal, atenuar, onCambiar, onConcepto, onPaso, onQuitar, onSalir }: Props) {
  const { ref: refCosto, eco, alCambiar: alCambiarCosto } = useEscrituraPesos(fila.costo, (texto) => onCambiar({ costo: texto }, "costo"));
  const enBlanco = filaEnBlanco(fila);
  // Un campo vacío de una fila a medias se marca al salir de la fila; uno mal escrito, en cuanto se ve.
  const visible = (campo: CampoFila): string | undefined => {
    const error = errores[campo];
    return error && (tocada || fila[campo].trim() !== "") ? error : undefined;
  };
  const fallos = { descripcion: visible("descripcion"), costo: visible("costo"), cantidad: visible("cantidad") };
  const nombreFila = fila.descripcion.trim() || "este gasto";
  const menos = pasoCantidad(fila.cantidad, -1);
  const mas = pasoCantidad(fila.cantidad, 1);
  const falta = faltaEnFila(errores, fila);
  const id = (campo: CampoFila) => `${base}-${campo}`;
  const describe = (campo: CampoFila, extra: string | null = null) =>
    [fallos[campo] ? `${id(campo)}-error` : null, extra].filter(Boolean).join(" ") || undefined;
  const idEco = `${id("costo")}-eco`;
  const hayFallo = Boolean(fallos.descripcion || fallos.costo || fallos.cantidad);

  return (
    <motion.li
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: DUR.media, ease: EASE_SALIDA }}
      onBlur={(evento) => {
        const destino = evento.relatedTarget;
        if (!(destino instanceof Node) || !evento.currentTarget.contains(destino)) onSalir();
      }}
      data-fila-gasto=""
    >
      <div className={`rounded-xl bg-fondo/70 p-1.5 ring-1 ring-inset transition-shadow focus-within:shadow-[0_0_0_3px_var(--acento-suave)] ${hayFallo ? "ring-error/50" : "ring-borde-suave focus-within:ring-acento/40"}`}>
        <div className="flex items-center gap-1">
          <input
            id={id("descripcion")}
            aria-label={`Descripción (${titulo})`}
            aria-invalid={Boolean(fallos.descripcion)}
            aria-errormessage={fallos.descripcion ? `${id("descripcion")}-error` : undefined}
            aria-describedby={describe("descripcion")}
            value={fila.descripcion}
            maxLength={120}
            autoComplete="off"
            enterKeyHint="next"
            placeholder={`¿Qué es? Ej. ${CONCEPTOS_GASTO[seccion][0]}`}
            onChange={(evento) => onCambiar({ descripcion: evento.target.value }, "descripcion")}
            onKeyDown={(evento) => alSiguiente(evento, id("costo"))}
            className={`${CAMPO_BASE} ${FOCO} min-w-0 flex-1 bg-transparent px-2 font-semibold hover:border-borde-suave focus-visible:bg-superficie ${fallos.descripcion ? "border-error" : "border-transparent"}`}
          />
          <span className="min-w-0 shrink-0 text-right">
            <TotalFila valor={subtotal} atenuar={atenuar} enBlanco={enBlanco} falta={falta} rojo={hayFallo} />
          </span>
          <button
            type="button"
            onClick={onQuitar}
            aria-label={`Quitar ${nombreFila}`}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-texto-tenue transition-colors hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>

        {!fila.descripcion.trim() && (
          <div role="group" aria-label={`Ideas para ${titulo}`} className="flex gap-1.5 overflow-x-auto px-1 pb-1 pt-0.5 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none]">
            {CONCEPTOS_GASTO[seccion].map((concepto) => (
              <button
                key={concepto}
                type="button"
                onClick={() => onConcepto(concepto)}
                className="inline-flex h-9 shrink-0 items-center rounded-full bg-superficie px-3 text-xs font-medium text-texto ring-1 ring-borde ring-inset transition-colors hover:bg-acento-suave hover:ring-acento/40 focus-visible:outline-2 focus-visible:outline-acento"
              >
                {concepto}
              </button>
            ))}
          </div>
        )}

        <div className="mt-0.5 flex items-end gap-2 px-0.5 pb-0.5">
          <div className="min-w-0 flex-1 @xl:max-w-60">
            <label htmlFor={id("costo")} className="mb-0.5 block px-1 text-[11px] font-medium text-texto-suave">Valor por unidad</label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[15px] font-semibold text-texto-tenue">$</span>
              <input
                id={id("costo")}
                ref={refCosto}
                aria-label={`Valor por unidad (${titulo})`}
                aria-invalid={Boolean(fallos.costo)}
                aria-errormessage={fallos.costo ? `${id("costo")}-error` : undefined}
                aria-describedby={describe("costo", eco ? idEco : null)}
                inputMode="numeric"
                enterKeyHint="next"
                autoComplete="off"
                value={fila.costo}
                placeholder={EJEMPLO_VALOR[seccion]}
                onChange={alCambiarCosto}
                onKeyDown={(evento) => alSiguiente(evento, id("cantidad"))}
                className={`${CAMPO_BASE} ${FOCO} w-full bg-superficie pl-7 pr-3 text-right font-semibold tabular-nums ${fallos.costo ? "border-error" : "border-borde"}`}
              />
            </div>
            <p id={idEco} aria-live="polite" className={eco ? "mt-0.5 px-1 text-right text-[11px] tabular-nums text-texto-suave" : "sr-only"}>
              {eco}
            </p>
          </div>
          <span aria-hidden="true" className="pb-3 text-sm text-texto-tenue">×</span>
          <div className="shrink-0">
            <label htmlFor={id("cantidad")} className="mb-0.5 block px-1 text-[11px] font-medium text-texto-suave">Cantidad</label>
            <div className={`flex h-11 items-stretch overflow-hidden rounded-lg border bg-superficie focus-within:border-acento ${fallos.cantidad ? "border-error" : "border-borde"}`}>
              <button
                type="button"
                onClick={() => menos !== null && onPaso(-1, menos)}
                disabled={menos === null}
                aria-label={`Una menos de ${nombreFila}`}
                className="grid w-9 place-items-center text-texto-suave transition-colors hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <input
                id={id("cantidad")}
                aria-label={`Cantidad (${titulo})`}
                aria-invalid={Boolean(fallos.cantidad)}
                aria-errormessage={fallos.cantidad ? `${id("cantidad")}-error` : undefined}
                aria-describedby={describe("cantidad")}
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                value={fila.cantidad}
                placeholder="1"
                onChange={(evento) => onCambiar({ cantidad: evento.target.value }, "cantidad")}
                className="h-full w-11 min-w-0 bg-transparent text-center text-[15px] font-semibold tabular-nums text-texto outline-none placeholder:text-[13px] placeholder:font-normal placeholder:text-texto-tenue focus-visible:bg-acento-suave/60"
              />
              <button
                type="button"
                onClick={() => mas !== null && onPaso(1, mas)}
                disabled={mas === null}
                aria-label={`Una más de ${nombreFila}`}
                className="grid w-9 place-items-center text-texto-suave transition-colors hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {hayFallo && (
          <div className="px-1.5 pb-1 pt-1">
            <MensajesDeError
              mensajes={(["descripcion", "costo", "cantidad"] as const).flatMap((campo) => {
                const texto = fallos[campo];
                return texto ? [{ id: id(campo), texto }] : [];
              })}
            />
          </div>
        )}
      </div>
    </motion.li>
  );
}

/**
 * Lo que va donde irá el total de la fila: el de Python (cuenta hasta el
 * nuevo valor), nada si la fila está en blanco, o en dos palabras lo que le
 * falta. Nunca «—» ni «$ 0» inventados.
 */
function TotalFila({ valor, atenuar, enBlanco, falta, rojo }: { valor: number | null; atenuar: boolean; enBlanco: boolean; falta: string | null; rojo: boolean }) {
  if (valor !== null && !falta) {
    return (
      <span className={`block text-[15px] font-semibold tabular-nums text-texto ${atenuar ? CLASE_NO_VIGENTE : ""}`}>
        <NumeroAnimado valor={valor} formato="pesos" duracion={0.6} />
      </span>
    );
  }
  if (enBlanco) return null;
  // En rojo, como dice la leyenda del precio («revisa lo que está en rojo»); el campo se marca al salir de la fila.
  if (falta) return <span className={`block text-xs text-error ${rojo ? "font-semibold" : "font-medium"}`}>{falta}</span>;
  return <span className="block text-xs text-texto-suave">Por calcular</span>;
}
