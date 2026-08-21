"use client";

import { useEffect, useState } from "react";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import type { Imagen, ProveedorId } from "@/lib/ia/tipos";

export type ReferenceDraft = {
  blueprint: ReferenceBlueprintV2;
  autoProductIds: string[];
};

type Props = {
  references: Imagen[];
  venue?: Imagen | null;
  proveedor: ProveedorId;
  eventPalette?: string[];
  onDraft: (draft: ReferenceDraft | null) => void;
  onReady: (ready: boolean) => void;
};

function labelMatch(type: "exact" | "closest" | "none"): string {
  if (type === "exact") return "Coincidencia exacta";
  if (type === "closest") return "Sustituto más parecido";
  return "Sin producto equivalente";
}

export function ReferenceReviewPanel({ references, venue, proveedor, eventPalette, onDraft, onReady }: Props) {
  const [blueprint, setBlueprint] = useState<ReferenceBlueprintV2 | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!references.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBlueprint(null);
      setStatus("idle");
      onDraft(null);
      onReady(true);
      return;
    }

    let cancelled = false;
    setStatus("analyzing");
    setError(null);
    onReady(false);
    fetch("/api/references/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: references, proveedor }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudieron analizar las referencias.");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const next: ReferenceBlueprintV2 = data.blueprint;
        // Un elemento puede necesitar varios productos (bill_of_materials) —
        // si solo se pide el principal, /api/generate nunca recibe los
        // secundarios y los descarta en la validación de catálogo.
        const autoProductIds = next.elements
          .filter((element) => element.approved)
          .flatMap((element) => [
            element.model_decision?.catalog_product_id,
            ...(element.model_decision?.bill_of_materials?.map((line) => line.catalog_product_id) ?? []),
          ])
          .filter((id): id is string => Boolean(id));
        setBlueprint(next);
        setStatus("ready");
        onDraft({ blueprint: next, autoProductIds: [...new Set(autoProductIds)] });
        onReady(true);
      })
      .catch((reason) => {
        if (cancelled) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : "No se pudo analizar.");
        onDraft(null);
        onReady(false);
      });

    return () => {
      cancelled = true;
    };
    // Parent callbacks intentionally omitted: inline callback updates parent state;
    // including it would restart analysis on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references, proveedor]);

  if (!references.length) return null;

  return (
    <section className="material-panel space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Plan automático de referencias</h2>
        <span className="text-[11px] text-texto-suave">
          {status === "analyzing" ? "Decidiendo…" : status === "ready" ? "Decidido por IA" : status === "error" ? "Error" : "Esperando"}
        </span>
      </div>
      {error && <p className="rounded-lg bg-acento-suave p-2 text-xs text-acento">{error}</p>}
      {blueprint && (
        <>
          <p className="text-xs text-texto-suave">
            IA decide qué incluir, qué omitir y qué sustituto usar. No necesitas aprobar elementos ni colocación.
            {venue ? " El espacio se conserva y la colocación se resuelve automáticamente." : ""}
          </p>
          <div className="space-y-2">
            {blueprint.elements.map((element) => {
              const decision = element.model_decision;
              const incluido = element.approved;
              return (
            <article key={element.element_id} className="material-subpanel p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-medium text-texto">{element.name}</h4>
                      <p className="mt-1 text-[11px] text-texto-suave">{element.category}: {incluido ? "Se incluirá" : "Se omitirá"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${incluido ? "bg-acento-suave text-acento" : "bg-fondo text-texto-suave"}`}>
                      {incluido ? "Incluir" : "Omitir"}
                    </span>
                  </div>
                  {decision && <>
                    <p className="mt-2 text-xs text-texto-suave">{labelMatch(decision.match_type)}: {decision.reason}</p>
                    {incluido && <p className="mt-1 text-[11px] text-texto-suave">Adaptación: {decision.adaptation}</p>}
                    {incluido && decision.bill_of_materials && decision.bill_of_materials.length > 1 && (
                      <ul className="mt-1.5 space-y-0.5 border-l-2 border-borde pl-2">
                        {decision.bill_of_materials.map((linea) => (
                          <li key={linea.catalog_product_id} className="text-[11px] text-texto-suave">
                            {Math.round(linea.share * 100)}% — {linea.role}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>}
                </article>
              );
            })}
          </div>
          <p className="text-[11px] text-texto-suave">
            Color también automático{eventPalette?.length ? ` según evento: ${eventPalette.join(", ")}` : ""}. Si no hay coincidencia segura, IA omite elemento.
          </p>
        </>
      )}
    </section>
  );
}
