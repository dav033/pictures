"use client";

import type { Imagen } from "@/lib/ia/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";

export type ReferenceDraft = {
  blueprint: ReferenceBlueprintV2;
  autoProductIds: string[];
};

type Props = {
  references: Imagen[];
  venue?: Imagen | null;
  eventPalette?: string[];
  blueprint: ReferenceBlueprintV2 | null;
  status: "idle" | "analyzing" | "ready" | "error";
  error: string | null;
};

function labelMatch(type: "exact" | "closest" | "none"): string {
  if (type === "exact") return "Coincidencia exacta";
  if (type === "closest") return "Sustituto más parecido";
  return "Sin producto equivalente";
}

export function ReferenceReviewPanel({ references, venue, eventPalette, blueprint, status, error }: Props) {
  if (!references.length) return null;

  return (
    <section className="material-panel space-y-3" aria-label="Análisis de referencias activo">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Analizando referencias</h2>
        <span className="text-[11px] text-texto-suave" role="status" aria-live="polite">
          {status === "analyzing" ? "Analizando…" : status === "ready" ? "Análisis listo" : status === "error" ? "Error" : "Esperando"}
        </span>
      </div>
      {error && <p className="rounded-lg bg-acento-suave p-2 text-xs text-acento" role="alert">{error}</p>}
      {status === "analyzing" && !blueprint && <p className="text-xs text-texto-suave">Detectando elementos visuales antes de construir el plan comercial…</p>}
      {blueprint && (
        <>
          <p className="text-xs text-texto-suave">
            Elementos detectados; esperando que el plan comercial decida qué incluir y cómo cubrirlo.
            {venue ? " El espacio se conserva como contexto." : ""}
          </p>
          <div className="space-y-2">
            {blueprint.elements.map((element) => {
              const decision = element.model_decision;
              const observado = element.approved;
              return (
                <article key={element.element_id} className="material-subpanel p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-medium text-texto">{element.name}</h4>
                      <p className="mt-1 text-[11px] text-texto-suave">{element.category}: {observado ? "Detectado" : "Descartado por análisis"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${observado ? "bg-acento-suave text-acento" : "bg-fondo text-texto-suave"}`}>
                      {observado ? "Detectado" : "Descartado"}
                    </span>
                  </div>
                  {decision && <p className="mt-2 text-xs text-texto-suave">{labelMatch(decision.match_type)}: {decision.reason}</p>}
                </article>
              );
            })}
          </div>
          <p className="text-[11px] text-texto-suave">
            El análisis visual no cotiza productos. La inclusión comercial se decide en el plan resuelto.
            {eventPalette?.length ? ` Paleta del evento: ${eventPalette.join(", ")}.` : ""}
          </p>
        </>
      )}
    </section>
  );
}
