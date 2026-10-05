"use client";

import { useEffect } from "react";
import { Shapes } from "lucide-react";
import { fichaDeForma, formasDeOficial } from "@/lib/plan/formas-pieza";
import { EstadoGuardado, vistaDeAutoguardado } from "../EstadoGuardado";
import { useAutoguardado } from "../usarAutoguardado";
import type { PendientesAjustes } from "../cola-ajustes";

/**
 * «¿Cómo se arma?» de una pieza que ningún motor arma: el decorador elige entre las formas que su estructura
 * oficial ofrece (una pared orgánica, cuadriculada, en rombos o de malla de links; un aro completo, parcial,
 * con fondo, clásico, doble o en media luna; y así el techo y el centro de mesa).
 *
 * El vocabulario —el id, el `nombre` y la `ayuda` de cada forma— es de `src/lib/plan/formas-pieza.ts`, puerto
 * de las `formas` de `referencias/variantes.ts` del repo dueño. Aquí no se escribe ni un nombre: lo que ve el
 * decorador es lo que dice la lámina, en su orden (de más a menos común).
 *
 * **Guarda una edición del plan** (`accion: "forma"`), como los deslizadores: al elegir, el cambio sale solo
 * y el control dice si quedó. «Como la propone el plan» la quita, y la pieza vuelve a dibujarse con la forma
 * que su oficial implica (`FORMA_POR_OFICIAL` en `app/dibujo_estructura.py`). El dibujo nuevo lo pide el
 * bloque cuando el plan vuelve con la forma puesta: no se adivina aquí.
 *
 * No calcula nada. La forma cambia cómo se dibuja la pieza, no cuántos globos lleva ni lo que cuesta, que
 * siguen siendo los de `plan.py`. Lo que sí hace, como cualquier edición de `estructuras`, es mover
 * `plan_hash`: la propuesta se vuelve a firmar.
 *
 * Sin `useId`: la etiqueta envuelve al `<select>`, así que no hace falta un `id` y ningún control posterior de
 * la tarjeta se desplaza al montar este.
 */

/** Elegir esto quita la forma: la pieza vuelve al respaldo de su estructura oficial. */
const SIN_ELEGIR = "";
/** Mismo `<select>` nativo que los mandos de los motores (`controles-arco.tsx`): teclado y lector de pantalla gratis. */
const CAMPO = "block min-h-11 w-full rounded-xl border border-borde bg-superficie px-3 text-[13px] text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-60";
/** Un clic es una decisión terminada: no hay arrastre que agrupar, así que se guarda al momento. */
const ESPERA_MS = 0;

type Props = {
  /** `estructura_oficial` de la pieza: de ella salen las formas que se ofrecen. */
  oficial: string;
  /** La forma que el plan trae, o `undefined` cuando no eligió ninguna. */
  forma?: string;
  /** Guarda la forma elegida (`null` la quita) y resuelve el motivo si no quedó. */
  onGuardar: (forma: string | null) => Promise<string | null>;
  /** Mientras otro cambio se guarda: el selector no acepta uno nuevo. */
  ocupado?: boolean;
  /** El contador de la tarjeta: aprobar espera también por este control. */
  pendientes?: PendientesAjustes;
};

export function SelectorFormaPieza({ oficial, forma, onGuardar, ocupado = false, pendientes }: Props) {
  const { estado, control } = useAutoguardado<string | null>({
    enPlan: forma ?? null,
    iguales: (a, b) => a === b,
    esperaMs: ESPERA_MS,
    guardar: onGuardar,
    pendientes,
  });
  // Otra edición (o «Deshacer») cambió la forma: esa es la referencia ahora.
  useEffect(() => {
    control.sincronizar(forma ?? null);
  }, [control, forma]);
  const formas = formasDeOficial(oficial);
  // Una oficial sin lámina de formas no ofrece nada que elegir: el bloque queda como estaba.
  if (formas.length === 0) return null;
  const elegida = forma === undefined ? null : fichaDeForma(oficial, forma);
  return (
    <div className="pt-3" data-testid="forma-pieza">
      <label className="block">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-texto">
          <Shapes className="size-4 text-texto-tenue" aria-hidden="true" />¿Cómo se arma?
        </span>
        <select
          value={elegida?.id ?? SIN_ELEGIR}
          disabled={ocupado}
          data-testid="elegir-forma-pieza"
          onChange={(evento) => control.cambiar(evento.target.value === SIN_ELEGIR ? null : evento.target.value, { inmediato: true })}
          className={`mt-1.5 ${CAMPO}`}
        >
          <option value={SIN_ELEGIR}>Como la propone el plan</option>
          {formas.map((ficha) => (
            <option key={ficha.id} value={ficha.id} title={ficha.ayuda}>{ficha.nombre}</option>
          ))}
        </select>
      </label>
      <p className="mt-1.5 text-xs text-texto-suave">
        {elegida
          ? elegida.ayuda
          : "Sin elegir, la pieza se dibuja como su estructura oficial da por hecho. Cambia solo el dibujo: los globos y el precio son los que ya calculó la propuesta."}
      </p>
      <EstadoGuardado estado={vistaDeAutoguardado(estado, "Guardado", control.reintentar)} efimero compacto className="mt-1 min-h-4" data-testid="estado-forma-pieza" />
    </div>
  );
}
