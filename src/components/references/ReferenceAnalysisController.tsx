"use client";

import { useEffect, useState } from "react";
import type { Imagen, ProveedorId } from "@/lib/ia/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { CATALOGO_ERRORES_UI_V1, leerUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { ReferenceReviewPanel, type ReferenceDraft } from "./ReferenceReviewPanel";

type Props = {
  references: Imagen[];
  proveedor: ProveedorId;
  onDraft: (draft: ReferenceDraft | null) => void;
  onReady: (ready: boolean) => void;
};

export function ReferenceAnalysisController({ references, proveedor, onDraft, onReady }: Props) {
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
    const controller = new AbortController();
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
      signal: controller.signal,
      body: JSON.stringify({ images: references, proveedor }),
    })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok) {
          // ui-error.v1: el cliente ve el mensaje redactado, nunca el texto técnico.
          throw new Error(leerUiErrorV1(data)?.mensaje_usuario ?? CATALOGO_ERRORES_UI_V1.ERROR_INTERNO.mensaje_usuario);
        }
        const blueprint = typeof data === "object" && data !== null && "blueprint" in data
          ? ReferenceBlueprintV2Schema.safeParse(data.blueprint)
          : null;
        if (!blueprint?.success) throw new Error(CATALOGO_ERRORES_UI_V1.ERROR_INTERNO.mensaje_usuario);
        return blueprint.data;
      })
      .then((next) => {
        if (cancelled) return;
        setBlueprint(next);
        setStatus("ready");
        onDraft({ blueprint: next });
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
      controller.abort();
    };
    // Parent callbacks intentionally remain outside this dependency list: the
    // controller must not restart an analysis on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references, proveedor]);

  return <ReferenceReviewPanel references={references} blueprint={blueprint} status={status} error={error} />;
}
