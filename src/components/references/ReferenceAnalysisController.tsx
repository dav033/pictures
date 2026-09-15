"use client";

import { useEffect, useState } from "react";
import type { Imagen, ProveedorId } from "@/lib/ia/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { CATALOGO_ERRORES_UI_V1, leerUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { tieneElementosAprobados, tieneEstructurasDeGlobos } from "@/lib/ia/reference-structure";
import type { EstadoAnalisisReferencia } from "@/lib/estado/espera-analisis";
import { mensajeErrorCliente } from "@/lib/estado/mensaje-error-cliente";
import { ReferenceReviewPanel, type ReferenceDraft } from "./ReferenceReviewPanel";

type Props = {
  references: Imagen[];
  proveedor: ProveedorId;
  onDraft: (draft: ReferenceDraft | null) => void;
  /**
   * Notified when the customer presses "Reintentar". The retry itself is
   * handled here: it re-sends the photo asking the server to skip its analysis
   * cache, so a failed or unstable first result is not served again (hallazgo #7).
   */
  onReintentar?: () => void;
  /** Opens the example gallery from the "no balloons" and error states. */
  onElegirEjemplo?: () => void;
  /**
   * Analysis lifecycle for the page: "analyzing" while it looks, then "ready"
   * or "error" ("idle" without attachments), so a failed analysis never keeps
   * a chat turn or an approval waiting. `info` comes with "ready": whether
   * anything usable and any balloon structure were seen (server flags, or the
   * same pure rules on the blueprint).
   */
  onEstado: (estado: EstadoAnalisisReferencia, info?: InfoAnalisisReferencia) => void;
  className?: string;
};

export type { EstadoAnalisisReferencia } from "@/lib/estado/espera-analisis";
export type InfoAnalisisReferencia = { tieneElementos: boolean; tieneEstructurasDeGlobos: boolean };

/**
 * Body field that asks `/api/references/analyze` to skip its cache. Owned by
 * the analysis route; see progreso-referencia.md (iteración 4).
 */
const CAMPO_SIN_CACHE = "sin_cache";

export function ReferenceAnalysisController({ references, proveedor, onDraft, onReintentar, onElegirEjemplo, onEstado, className }: Props) {
  const [blueprint, setBlueprint] = useState<ReferenceBlueprintV2 | null>(null);
  const [status, setStatus] = useState<EstadoAnalisisReferencia>("idle");
  const [error, setError] = useState<string | null>(null);
  // Each retry bumps the attempt; the effect below re-runs and skips the cache.
  const [intento, setIntento] = useState(0);
  const [intentoDe, setIntentoDe] = useState(references);
  if (intentoDe !== references) {
    // A new attachment starts over: its first analysis may use the cache.
    setIntentoDe(references);
    setIntento(0);
  }

  useEffect(() => {
    if (!references.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the local analysis controller when attachments are removed.
      setBlueprint(null);
      setStatus("idle");
      onDraft(null);
      onEstado("idle");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    // A new attachment must not reuse the previous turn's blueprint while the
    // server analyzes it.
    setBlueprint(null);
    setStatus("analyzing");
    onEstado("analyzing");
    setError(null);
    onDraft(null);
    fetch("/api/references/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ images: references, proveedor, ...(intento > 0 ? { [CAMPO_SIN_CACHE]: true } : {}) }),
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
        const respuesta = data as { tieneElementos?: unknown; tieneEstructurasDeGlobos?: unknown };
        const info: InfoAnalisisReferencia = {
          tieneElementos: typeof respuesta.tieneElementos === "boolean" ? respuesta.tieneElementos : tieneElementosAprobados(blueprint.data),
          tieneEstructurasDeGlobos: typeof respuesta.tieneEstructurasDeGlobos === "boolean" ? respuesta.tieneEstructurasDeGlobos : tieneEstructurasDeGlobos(blueprint.data),
        };
        return { next: blueprint.data, info };
      })
      .then(({ next, info }) => {
        if (cancelled) return;
        setBlueprint(next);
        setStatus("ready");
        onDraft({ blueprint: next });
        onEstado("ready", info);
      })
      .catch((reason) => {
        if (cancelled) return;
        setStatus("error");
        // Sin red el navegador rechaza con "Failed to fetch": el cliente ve el mensaje de conexión (D4).
        setError(mensajeErrorCliente(reason, "No se pudo analizar tu foto. Inténtalo de nuevo."));
        onDraft(null);
        onEstado("error");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Parent callbacks intentionally remain outside this dependency list: the
    // controller must not restart an analysis on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references, proveedor, intento]);

  function reintentar(): void {
    if (status === "analyzing") return;
    onReintentar?.();
    setIntento((valor) => valor + 1);
  }

  return (
    <ReferenceReviewPanel
      references={references}
      blueprint={blueprint}
      status={status}
      error={error}
      onReintentar={reintentar}
      reintentando={status === "analyzing" && intento > 0}
      onElegirEjemplo={onElegirEjemplo}
      className={className}
    />
  );
}
