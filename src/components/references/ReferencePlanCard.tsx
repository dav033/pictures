"use client";

import { construirCoberturaReferencia, type CoberturaReferencia } from "@/lib/plan/desglose";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";

type Props = {
  blueprint: ReferenceBlueprintV2;
  plan?: PlanResuelto;
};

function estadoLabel(estado: CoberturaReferencia["elementos"][number]["estado"]): string {
  if (estado === "incluido") return "Incluido";
  if (estado === "omitido") return "Omitido";
  return "Pendiente de plan";
}

export function ReferencePlanCard({ blueprint, plan }: Props) {
  const cobertura = construirCoberturaReferencia(blueprint, plan);
  const pendientes = cobertura.elementos.filter((elemento) => elemento.estado === "pendiente").length;

  return (
    <section className="mt-3 max-w-[92%] space-y-3 rounded-xl border border-borde bg-superficie p-3" aria-label="Cobertura de referencias visuales">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-texto">Referencias visuales</p>
          <p className="mt-1 text-xs text-texto-suave">
            {plan ? "Cada elemento está relacionado con el plan comercial." : "Elementos detectados; esperando plan comercial."}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${pendientes ? "bg-amber-100 text-amber-800" : "bg-acento-suave text-acento"}`}>
          {pendientes ? `${pendientes} pendiente${pendientes === 1 ? "" : "s"}` : "Trazable"}
        </span>
      </div>
      <ul className="space-y-2">
        {cobertura.elementos.map((elemento) => (
          <li key={elemento.elementId} className="rounded-lg bg-fondo/70 p-2.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-texto">{elemento.nombre}</p>
                <p className="mt-0.5 text-texto-suave">{elemento.categoria} · {estadoLabel(elemento.estado)}</p>
              </div>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-texto-suave">{elemento.estado}</span>
            </div>
            {elemento.estado === "incluido" && (
              <div className="mt-1 space-y-1 text-texto-suave">
                <p>Estructura: {elemento.estructuraNombre ?? elemento.estructuraId ?? "sin nombre"}</p>
                {plan && elemento.estructuraId && (
                  <ul className="border-l-2 border-borde pl-2">
                    {plan.estructuras
                      .filter((estructura) => estructura.estructura_id === elemento.estructuraId)
                      .flatMap((estructura) => estructura.lineas)
                      .map((linea, indice) => <li key={`${elemento.elementId}:${linea.variant_id}:${indice}`}>{linea.titulo} · {linea.unidades} unidades</li>)}
                  </ul>
                )}
              </div>
            )}
            {elemento.motivo && <p className="mt-1 text-texto-suave">Motivo: {elemento.motivo}</p>}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-texto-suave">Los elementos omitidos no crean líneas de precio. Una variante compartida conserva una sola compra.</p>
    </section>
  );
}
