"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { CotizacionPlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import { resumenPlanGuiado } from "@/lib/ia/guiado/instruccion-plan";
import type { WidgetGuiado } from "@/lib/ia/guiado/widgets";
import { ideasQueSiguenEnPlan } from "../agregar-idea";
import type { Mensaje } from "../estado-guardado";
import { fraseAjuste, nombreLineaCliente } from "../formato";
import { borrarImagenNavegador } from "../imagenes-navegador";
import { planDelMensaje, totalDePlan } from "../plan-del-mensaje";
import { contenidoPlanAjustado, type PlanGuiado } from "./ajuste-plan-guiado";
import type { AjustePublicado } from "./usarAjustePlanGuiado";

type Widget = WidgetGuiado;
type WidgetPlan = Extract<Widget, { tipo: "plan" }>;
type EstadoPublicacion = {
  mensajes: readonly Mensaje[];
  setMensajes: Dispatch<SetStateAction<Mensaje[]>>;
  setImagenesLocales: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  setAnuncio: (anuncio: string) => void;
  recordar: (mensajeId: string, vigente: WidgetPlan, nuevoHash: string) => void;
  decoracionDeLaConversacion: (mensajes: readonly Mensaje[], id: string) => DecoracionSempertex | null;
};

type PublicacionSolicitada = {
  id: number;
  mensajeId: string;
  plan: PlanGuiado;
  vigente: WidgetPlan;
  descripcion: string;
};

/** Apply image and undo effects only after React commits the requested plan. */
export function usePublicarAjustePlan({
  mensajes, setMensajes, setImagenesLocales, setAnuncio, recordar, decoracionDeLaConversacion,
}: EstadoPublicacion) {
  const [pendientes, setPendientes] = useState<readonly PublicacionSolicitada[]>([]);
  const secuencia = useRef(0);
  const ultimaProcesada = useRef(0);

  useEffect(() => {
    const solicitudes = pendientes.filter((solicitud) => solicitud.id > ultimaProcesada.current);
    if (!solicitudes.length) return;
    ultimaProcesada.current = solicitudes.at(-1)!.id;
    for (const solicitud of solicitudes) {
      const actual = planDelMensaje(mensajes.find((mensaje) => mensaje.id === solicitud.mensajeId));
      if (!actual || actual.reemplazado || actual.plan !== solicitud.plan) continue;
      recordar(solicitud.mensajeId, solicitud.vigente, solicitud.plan.plan_hash);
      setImagenesLocales((actuales) => (solicitud.mensajeId in actuales ? Object.fromEntries(Object.entries(actuales).filter(([id]) => id !== solicitud.mensajeId)) : actuales));
      void borrarImagenNavegador(solicitud.mensajeId);
      setAnuncio(`Listo: ${fraseAjuste(solicitud.descripcion)}. Tu plan tiene ${totalDePlan(solicitud.plan)} globos.`);
    }
  }, [mensajes, pendientes, recordar, setAnuncio, setImagenesLocales]);

  return function publicarAjustePlan(mensajeId: string, plan: PlanGuiado, cotizacionCruda: unknown, { descripcion, baseHash }: AjustePublicado): boolean {
    const vigente = planDelMensaje(mensajes.find((mensaje) => mensaje.id === mensajeId));
    if (!vigente || vigente.reemplazado || vigente.plan.plan_hash !== baseHash) return false;
    // Private identity proves this updater installed the plan, even if a queued update already has the same result.
    const planPublicado = { ...plan };
    const precio = CotizacionPlanGuiadoSchema.safeParse(cotizacionCruda);
    const cotizacion = precio.success ? { ...precio.data, lineas: precio.data.lineas.map((linea) => ({ ...linea, nombre: nombreLineaCliente(linea) })) } : undefined;
    const armado = generarPasosPlan(plan);
    const resumen = resumenPlanGuiado(plan);
    const id = ++secuencia.current;
    const procesadas = ultimaProcesada.current;
    setPendientes((actuales) => [...actuales.filter((solicitud) => solicitud.id > procesadas), { id, mensajeId, plan: planPublicado, vigente, descripcion }]);
    setMensajes((actuales) => actuales.map((mensaje) => {
      const actual = mensaje.id === mensajeId ? planDelMensaje(mensaje) : undefined;
      if (!actual || actual.reemplazado || actual.plan.plan_hash !== baseHash) return mensaje;
      // Ningún ajuste rehace el plan con el modelo (quitar una pieza o añadir un color tampoco): los de antes siguen en él.
      const ajustes = [...(actual.ajustes ?? []), descripcion.slice(0, 160)].slice(-4);
      // Las ideas sumadas siguen en el plan mientras quede alguna de sus piezas: al quitar UNA de las dos columnas de una
      // idea, el carrusel volvía a ofrecer «Agregar a mi plan» y la duplicaba (probador 124, hallazgo 11).
      const ideas = ideasQueSiguenEnPlan(actual.ideas ?? [], actual.plan, plan, (id) => decoracionDeLaConversacion(actuales, id));
      const nuevo: WidgetPlan = {
        tipo: "plan", plan: planPublicado, pasos: armado.pasos, motor: actual.motor, ajustes, totalAnterior: totalDePlan(actual.plan),
        ...(cotizacion ? { cotizacion } : {}),
        ...(actual.fotoInspiracion ? { fotoInspiracion: true, ...(actual.referenciaId ? { referenciaId: actual.referenciaId } : {}) } : {}),
        ...(actual.usoCosteo ? { usoCosteo: actual.usoCosteo } : {}),
        ...(actual.compraAbierta ? { compraAbierta: true } : {}),
        // El aviso «Agregué… ahora tiene N globos» no se hereda: el total ya cambió.
        ...(ideas.length ? { ideas } : {}),
        // La imagen era del plan de antes: «Ver cómo quedaría» vuelve a ser la acción principal.
        hechas: (actual.hechas ?? []).filter((hecha) => hecha !== "ver"),
      };
      return { ...mensaje, content: contenidoPlanAjustado(resumen, ajustes), widgets: mensaje.widgets?.map((widget): Widget => (widget.tipo === "plan" ? nuevo : widget)) };
    }));
    return true;
  };
}
