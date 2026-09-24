"use client";

import type { Imagen } from "@/lib/ia/nucleo/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { AnalisisFoto } from "@/components/referencia/AnalisisFoto";

export type ReferenceDraft = {
  blueprint: ReferenceBlueprintV2;
};

type Props = {
  references: Imagen[];
  blueprint: ReferenceBlueprintV2 | null;
  status: "idle" | "analyzing" | "ready" | "error";
  error: string | null;
  onReintentar?: () => void;
  reintentando?: boolean;
  onElegirEjemplo?: () => void;
  className?: string;
};

/**
 * Estado del análisis de la foto de referencia para el cliente final
 * (maqueta FotoAnalisis): escaneo mientras mira, recuadros por pieza con su
 * nombre oficial en español, colores y ambientación. Sin piezas de globos no
 * dice "Listo" (hallazgo #17): explica que no ve globos. El detalle crudo del
 * blueprint solo vive en modo dev.
 */
export function ReferenceReviewPanel({ references, blueprint, status, error, onReintentar, reintentando, onElegirEjemplo, className }: Props) {
  if (!references.length || status === "idle") return null;
  const estado = status === "analyzing" ? "analizando" : status === "error" ? "error" : "listo";
  return (
    <AnalisisFoto
      imagenes={references}
      estado={estado}
      blueprint={status === "ready" ? blueprint : null}
      error={error}
      onReintentar={onReintentar}
      reintentando={reintentando}
      onElegirEjemplo={onElegirEjemplo}
      className={className}
    />
  );
}
