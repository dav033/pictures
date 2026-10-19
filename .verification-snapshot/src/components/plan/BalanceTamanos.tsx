"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { reglasMezclas, type Mezcla } from "@/lib/plan/mezclas";
import { BarraTamanos, tramosPorTamano } from "./BarraTamanos";
import { useAutoguardado } from "./usarAutoguardado";
import { EstadoGuardado, vistaDeAutoguardado } from "./EstadoGuardado";
import type { PendientesAjustes } from "./cola-ajustes";

/** Mixes from the smallest average balloon to the largest (≈10.5″, 12″, ≈13.7″, ≈20.4″). */
const ESCALA: ReadonlyArray<{ mezcla: Mezcla; etiqueta: string; detalle: string }> = [
  { mezcla: "organica_fina", etiqueta: "Más pequeños", detalle: "Muchos globos chicos que rellenan y pocos grandes de acento" },
  { mezcla: "clasica", etiqueta: "Todos de 12″", detalle: "Un solo tamaño, parejo y ordenado" },
  { mezcla: "organica_gruesa", etiqueta: "Más grandes", detalle: "Menos globos chicos y más volumen" },
  { mezcla: "solo_grandes", etiqueta: "Solo grandes", detalle: "Globos de 18″ y 24″, pocos y llamativos" },
];

/** Arrow keys save after this pause, so stepping through the scale is a single edit. */
const ESPERA_TECLADO_MS = 600;
/** The local step stays on screen while it is not in the plan yet. */
const FASES_PROPIAS = new Set(["esperando", "guardando", "error", "rechazado"]);

type Props = {
  mezcla: Mezcla;
  totalGlobos: number;
  ocupado?: boolean;
  /** Saves another mix; resolves the reason when it was not saved. */
  onGuardar: (mezcla: Mezcla) => Promise<string | null>;
  /** The card's count of unsaved changes: approving waits for this one too. */
  pendientes?: PendientesAjustes;
};

/**
 * Size balance of one piece: a four-step slider from "más pequeños" to "solo
 * grandes" over the existing mixes, with the size bar as a live preview. The
 * preview uses the mix proportions; the resolver counts the real balloons.
 * Releasing the slider (or pausing on the keyboard) saves the new mix.
 */
export function BalanceTamanos({ mezcla, totalGlobos, ocupado = false, onGuardar, pendientes }: Props) {
  const reducir = useReducedMotion();
  const id = useId();
  const enPlan = Math.max(0, ESCALA.findIndex((paso) => paso.mezcla === mezcla));
  const [local, setLocal] = useState<number | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  // Step under the pointer while dragging (`null`: no drag). A drag fires one change per step; only the release saves.
  const punteroRef = useRef<number | null>(null);
  const { estado, control } = useAutoguardado<Mezcla>({
    enPlan: mezcla,
    iguales: (a, b) => a === b,
    esperaMs: ESPERA_TECLADO_MS,
    guardar: onGuardar,
    pendientes,
  });
  const paso = local !== null && (arrastrando || FASES_PROPIAS.has(estado.fase)) ? local : enPlan;
  const elegido = ESCALA[paso]!;
  const proporciones = reglasMezclas().mezclas[elegido.mezcla];
  const tramos = tramosPorTamano(proporciones.map((tamano) => ({ pulgadas: tamano.pulgadas, unidades: Math.max(1, Math.round(totalGlobos * tamano.proporcion)) })));

  // Another edit (or "Deshacer") changed the mix: that is the reference now.
  useEffect(() => {
    control.sincronizar(mezcla);
  }, [control, mezcla]);

  function elegir(indice: number, inmediato: boolean): void {
    setLocal(indice);
    control.cambiar(ESCALA[indice]!.mezcla, { inmediato });
  }

  function soltar(): void {
    const final = punteroRef.current;
    if (final === null) return;
    punteroRef.current = null;
    setArrastrando(false);
    control.cambiar(ESCALA[final]!.mezcla, { inmediato: true });
  }

  return (
    <div className="rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset" data-testid="balance-tamanos">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <label htmlFor={`${id}-balance`} className="text-[13px] font-semibold text-texto">Tamaños de los globos</label>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={elegido.mezcla} initial={reducir ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.18 }} className="text-xs text-texto-suave">
            {elegido.detalle}
          </motion.p>
        </AnimatePresence>
      </div>
      <input
        id={`${id}-balance`}
        type="range"
        min={0}
        max={ESCALA.length - 1}
        step={1}
        value={paso}
        disabled={ocupado}
        onPointerDown={() => {
          punteroRef.current = paso;
          setLocal(paso);
          setArrastrando(true);
        }}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        onLostPointerCapture={soltar}
        onChange={(evento) => {
          const indice = Number(evento.target.value);
          // Dragging only moves the preview; the release saves. Keys (and taps without a drag) save after a pause.
          if (punteroRef.current === null) {
            elegir(indice, false);
            return;
          }
          punteroRef.current = indice;
          setLocal(indice);
        }}
        onKeyDown={(evento: KeyboardEvent<HTMLInputElement>) => {
          if (evento.key.startsWith("Arrow") || evento.key === "Home" || evento.key === "End" || evento.key.startsWith("Page")) punteroRef.current = null;
        }}
        aria-valuetext={elegido.etiqueta}
        className="mt-3 w-full accent-[var(--acento)] disabled:opacity-60"
      />
      <div className="mt-1 grid grid-cols-4 text-[11px] text-texto-suave" aria-hidden="true">
        {ESCALA.map((opcion, indice) => (
          <button
            key={opcion.mezcla}
            type="button"
            tabIndex={-1}
            disabled={ocupado}
            onClick={() => elegir(indice, true)}
            className={`${indice === 0 ? "text-left" : indice === ESCALA.length - 1 ? "text-right" : "text-center"} ${indice === paso ? "font-semibold text-acento" : "hover:text-texto"}`}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <BarraTamanos key={elegido.mezcla} tramos={tramos} variante="detalle" retraso={0} />
      </div>
      <EstadoGuardado estado={vistaDeAutoguardado(estado, "Guardado", control.reintentar)} efimero compacto className="mt-2 min-h-4" data-testid="estado-balance-tamanos" />
    </div>
  );
}
