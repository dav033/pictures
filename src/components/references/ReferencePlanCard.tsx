"use client";

import { construirCoberturaReferencia, type CoberturaReferencia } from "@/lib/plan/desglose";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { ALCANCE_POR_CATEGORIA_REFERENCIA } from "@/lib/rag/taxonomy/alcance-referencia";

type Props = {
  blueprint: ReferenceBlueprintV2;
  plan?: PlanResuelto;
};

function estadoLabel(estado: CoberturaReferencia["elementos"][number]["estado"]): string {
  if (estado === "incluido") return "Incluido";
  if (estado === "emulable_pendiente") return "Emulación propuesta";
  if (estado === "fuera_de_catalogo") return "Fuera de catálogo";
  if (estado === "omitido") return "Omitido";
  return "Pendiente de plan";
}

export function ReferencePlanCard({ blueprint, plan }: Props) {
  const cobertura = construirCoberturaReferencia(blueprint, plan);
  const pendientes = cobertura.elementos.filter((elemento) => elemento.estado === "pendiente" || elemento.estado === "emulable_pendiente").length;
  const incluidos = cobertura.elementos.filter((elemento) => elemento.estado === "incluido");
  const emulables = cobertura.elementos.filter((elemento) => elemento.estado === "emulable_pendiente");
  const fueraDeCatalogo = cobertura.elementos.filter((elemento) => elemento.estado === "fuera_de_catalogo");
  const otros = cobertura.elementos.filter((elemento) => elemento.estado === "pendiente" || elemento.estado === "omitido");

  const grupo = (titulo: string, elementos: typeof cobertura.elementos, descripcion?: string) => {
    if (!elementos.length) return null;
    return (
      <section aria-label={titulo} className="space-y-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-texto">{titulo}</h3>
          {descripcion && <p className="mt-1 text-[11px] text-texto-suave">{descripcion}</p>}
        </div>
        <ul className="space-y-2">
          {elementos.map((elemento) => (
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
              {elemento.estado === "emulable_pendiente" && (
                <p className="mt-1 text-texto-suave">Propuesta adaptable: {elemento.propuesta ?? "puedo reinterpretarlo con globos coordinados"}. No es una coincidencia exacta; confirma si lo incluyo.</p>
              )}
              {elemento.estado === "fuera_de_catalogo" && (
                <div className="mt-1 space-y-1 text-texto-suave">
                  <p>{ALCANCE_POR_CATEGORIA_REFERENCIA[elemento.categoria].nota}</p>
                  {elemento.motivo && <p>Detalle: {elemento.motivo}</p>}
                </div>
              )}
              {elemento.estado !== "emulable_pendiente" && elemento.estado !== "fuera_de_catalogo" && elemento.motivo && <p className="mt-1 text-texto-suave">Motivo: {elemento.motivo}</p>}
            </li>
          ))}
        </ul>
      </section>
    );
  };

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
      <div className="space-y-4">
        {grupo("Lo que voy a armar", incluidos, "Piezas y estructuras ya vinculadas al plan comercial.")}
        {grupo("Puedo emularlo con globos — ¿lo incluyo?", emulables, "La propuesta adapta la función visual; no presenta una tela, mueble o flor como si fuera producto del catálogo.")}
        {grupo("Fuera de mi catálogo", fueraDeCatalogo, "Lo declaro para que no parezca un faltante ni una promesa de compra.")}
        {grupo("Pendiente de decisión", otros, "Aún requiere plan o conserva una decisión de diseño explícita.")}
      </div>
      <p className="text-[11px] text-texto-suave">Los elementos omitidos no crean líneas de precio. Una variante compartida conserva una sola compra.</p>
    </section>
  );
}
