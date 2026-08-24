"use client";

import { useEffect, useState } from "react";
import type { Imagen, ProveedorId } from "@/lib/ia/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { ReferenceReviewPanel, type ReferenceDraft } from "./ReferenceReviewPanel";

type Props = {
  references: Imagen[];
  venue?: Imagen | null;
  proveedor: ProveedorId;
  eventPalette?: string[];
  onDraft: (draft: ReferenceDraft | null) => void;
  onReady: (ready: boolean) => void;
};

export function ReferenceAnalysisController({ references, venue, proveedor, eventPalette, onDraft, onReady }: Props) {
  const [blueprint, setBlueprint] = useState<ReferenceBlueprintV2 | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!references.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the local analysis controller when attachments are removed.
      setBlueprint(null);
      setStatus("idle");
      onDraft(null);
      onReady(true);
      return;
    }

    let cancelled = false;
    // A new attachment must not reuse the previous turn's blueprint while the
    // server analyzes it.
    setBlueprint(null);
    setStatus("analyzing");
    setError(null);
    onDraft(null);
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
        // Los IDs comerciales solo pertenecen al flujo legacy. El modo plan es
        // perceptual y deja la resolución de variantes a buscar_catalogo_rag.
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
    // Parent callbacks intentionally remain outside this dependency list: the
    // controller must not restart an analysis on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references, proveedor]);

  return <ReferenceReviewPanel references={references} venue={venue} eventPalette={eventPalette} blueprint={blueprint} status={status} error={error} />;
}
