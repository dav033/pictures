"use client";

import { useEffect, useRef } from "react";
import type { z } from "zod";
import { PropuestaComposicionSchema, type PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { WidgetGuiado } from "@/lib/ia/guiado/widgets";
import { TEXTO_AVISO_DIBUJO_RECALCULO, TITULO_AVISO_SIN_CAMBIO } from "@/lib/guiada-motor/mensajes-cliente";
import { avisosRecalculo } from "./aviso-recalculo";
import { crearEscuchaCorte3d, suscribirCorte3d, TIPO_ACCION_RECALCULAR_3D, type EscuchaCorte3d } from "./aviso-corte-3d";
import type { Mensaje } from "./estado-guardado";
import { falloDelPlan, type FalloDelPlan } from "./fallo-plan";
import { planActualDelPlan } from "./plan-actual";
import { prepararRecalculo3d, TEXTO_RECALCULO_NO_POSIBLE } from "./recalculo-3d";

type Propuesta = z.infer<typeof PropuestaComposicionSchema>;
type WidgetPlan = Extract<WidgetGuiado, { tipo: "plan" }>;
export type AccionRecalcular3d = { tipo: typeof TIPO_ACCION_RECALCULAR_3D; planHash: string; mensajeId: string };

export type EntradaCorte3d = {
  planVigente: { mensajeId: string; widget: WidgetPlan } | null;
  cargandoRef: { readonly current: boolean };
  hayFallo: boolean;
  setFallo: (fallo: FalloDelPlan<AccionRecalcular3d> | null) => void;
  agregar: (nuevos: Mensaje[]) => void;
  pedirFinal: () => void;
  registrarAccion: (evento: string, datos?: Record<string, unknown>) => void;
  aceptarPropuesta: (propuesta: Propuesta, opciones: { mensajeId: string; planAnterior?: PlanActualGuiado }) => Promise<unknown>;
};

const nuevoId = (): string => crypto.randomUUID();

/**
 * El corte del 3D en la vista guiada (P-049): el aviso cuando un plan del 3D deja el 3D y «Recalcular mi plan». Sin
 * estado propio: la vista pasa su plan, su tarjeta de fallo y sus acciones. Lo que no es de la vista (el orden de los
 * avisos y el consentimiento) sale de `avisosRecalculo` y de `aviso-corte-3d`.
 */
export function useCorte3d({ planVigente, cargandoRef, hayFallo, setFallo, agregar, pedirFinal, registrarAccion, aceptarPropuesta }: EntradaCorte3d): { recalcularPlan3d: (planHash: string) => void } {
  // El corte del 3D (P-049): el plan de la pantalla dejó el 3D, así que el aviso va arriba, como el de rehacer (D-023). La
  // escucha se rehace en cada pintado (lee el plan, la tarjeta de fallo y la petición del momento) y se suscribe una sola vez.
  // Mostrarlo lo marca como avisado, como la edición: el siguiente cambio que pida el cliente ya recalcula con Python.
  const alCorte3dRef = useRef<EscuchaCorte3d>(() => undefined);
  useEffect(() => {
    alCorte3dRef.current = crearEscuchaCorte3d({
      avisos: avisosRecalculo,
      estado: () => ({ planVigenteHash: planVigente?.widget.plan.plan_hash ?? null, cargando: cargandoRef.current, hayFallo }),
      mostrar: (planHash, origen) => {
        const mensajeId = planVigente?.mensajeId ?? "";
        registrarAccion("plan.aviso_corte_3d", { mensajeId, plan_hash: planHash, origen });
        setFallo(falloDelPlan<AccionRecalcular3d>({ estado: "fallo", aviso: TEXTO_AVISO_DIBUJO_RECALCULO, titulo: TITULO_AVISO_SIN_CAMBIO, accion: { tipo: TIPO_ACCION_RECALCULAR_3D, planHash, mensajeId }, mensajeId }).fallo);
      },
    });
  });
  useEffect(() => suscribirCorte3d((planHash, origen) => alCorte3dRef.current(planHash, origen)), []);

  /**
   * «Recalcular mi plan» del aviso de corte (P-049): repite el plan con su propuesta por el mismo camino que «Intentar de nuevo»
   * (`aceptarPropuesta` con su plan anterior). El aviso ya dio el consentimiento (`avisosRecalculo`), así que con el 3D cortado
   * el plan se arma con Python. No hay mensaje ni foto del cliente de por medio, pero sí el modelo: `aceptarPropuesta` →
   * `ejecutarPlan` → /api/chat, donde `confirmar_plan_decoracion` resuelve el plan (por eso cuesta y puede tardar).
   */
  function recalcularPlan3d(planHash: string): void {
    const vigente = planVigente;
    if (cargandoRef.current || vigente?.widget.plan.plan_hash !== planHash) return;
    const preparado = prepararRecalculo3d({
      guardada: vigente.widget.propuesta,
      planActual: planActualDelPlan(vigente.widget.plan, vigente.widget.motor),
      piezasDelPlan: vigente.widget.plan.plan.estructuras,
    });
    avisosRecalculo.marcar(planHash);
    setFallo(null);
    if (!preparado) {
      // No se adivina cómo rehacerlo ni se reducen sus piezas sin decirlo: se le dice qué hacer, sin mandar nada.
      agregar([{ id: nuevoId(), role: "assistant", content: TEXTO_RECALCULO_NO_POSIBLE }]);
      pedirFinal();
      registrarAccion("plan.recalcular_3d_sin_propuesta", { mensajeId: vigente.mensajeId, plan_hash: planHash });
      return;
    }
    const idRecalculo = nuevoId();
    agregar([{ id: idRecalculo, role: "assistant", content: "" }]);
    pedirFinal();
    registrarAccion("plan.recalcular_3d", { mensajeId: vigente.mensajeId, plan_hash: planHash, propuestaGuardada: Boolean(vigente.widget.propuesta) });
    void aceptarPropuesta(preparado.propuesta, { mensajeId: idRecalculo, planAnterior: preparado.planAnterior });
  }
  return { recalcularPlan3d };
}
