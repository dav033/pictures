"use client";

import type { Imagen } from "@/lib/ia/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { ALCANCE_POR_CATEGORIA_REFERENCIA, type AlcanceReferencia } from "@/lib/rag/taxonomy/alcance-referencia";

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

const ALCANCE_LABEL: Record<AlcanceReferencia, string> = {
  cubierto: "En catálogo",
  parcial: "Cobertura parcial",
  emulable: "Emulable con globos",
  fuera_de_catalogo: "Fuera de catálogo",
};

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
              const observado = element.approved;
              const alcance = ALCANCE_POR_CATEGORIA_REFERENCIA[element.category];
              return (
                <article key={element.element_id} className="material-subpanel p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-medium text-texto">{element.name}</h4>
                      <p className="mt-1 text-[11px] text-texto-suave">{element.category}: {observado ? "Detectado" : "Descartado por análisis"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${alcance.alcance === "fuera_de_catalogo" ? "bg-fondo text-texto-suave" : "bg-acento-suave text-acento"}`}>
                      {ALCANCE_LABEL[alcance.alcance]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-texto-suave">{alcance.nota}</p>
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
