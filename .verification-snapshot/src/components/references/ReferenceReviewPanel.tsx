"use client";

import type { Imagen } from "@/lib/ia/nucleo/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { AnalisisFoto } from "@/components/referencia/AnalisisFoto";
import { ColoresSempertex } from "@/components/referencia/ColoresSempertex";
import type { AnalisisColorSempertex } from "@/lib/plan/analisis-color";

export type ReferenceDraft = {
  blueprint: ReferenceBlueprintV2;
  /**
   * Los colores medidos de cada pieza con su referencia Sempertex. Opcional: viaja fuera del blueprint y la
   * bandera `ANALISIS_COLOR_SEMPERTEX_V1` puede estar apagada (lo está en producción).
   */
  analisisColor?: AnalisisColorSempertex | null;
};

type Props = {
  references: Imagen[];
  blueprint: ReferenceBlueprintV2 | null;
  analisisColor?: AnalisisColorSempertex | null;
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
export function ReferenceReviewPanel({ references, blueprint, analisisColor, status, error, onReintentar, reintentando, onElegirEjemplo, className }: Props) {
  if (!references.length || status === "idle") return null;
  const estado = status === "analyzing" ? "analizando" : status === "error" ? "error" : "listo";
  return (
    <>
      <AnalisisFoto
        imagenes={references}
        estado={estado}
        blueprint={status === "ready" ? blueprint : null}
        analisisColor={status === "ready" ? analisisColor : null}
        error={error}
        onReintentar={onReintentar}
        reintentando={reintentando}
        onElegirEjemplo={onElegirEjemplo}
        className={className}
      />
      {status === "ready" ? <ColoresSempertex analisis={analisisColor ?? null} className="mt-4" /> : null}
    </>
  );
}
