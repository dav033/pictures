"use client";

import type { Imagen } from "@/lib/ia/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { resumenReferenciaCliente } from "@/lib/plan/presentacion-cliente";

export type ReferenceDraft = {
  blueprint: ReferenceBlueprintV2;
};

type Props = {
  references: Imagen[];
  blueprint: ReferenceBlueprintV2 | null;
  status: "idle" | "analyzing" | "ready" | "error";
  error: string | null;
};

/**
 * Estado del análisis de la foto de referencia para el cliente final. Antes
 * listaba cada elemento detectado con su nombre en inglés, la categoría interna
 * y el alcance comercial; ese detalle ahora solo vive en el plan y en modo dev.
 * Aquí queda un aviso corto y, cuando hay estructuras de globos detectadas, sus
 * nombres oficiales en español para que el cliente confirme que se entendió.
 */
export function ReferenceReviewPanel({ references, blueprint, status, error }: Props) {
  if (!references.length || status === "idle") return null;
  const vistas = status === "ready" && blueprint ? resumenReferenciaCliente(blueprint) : null;
  const texto = status === "analyzing"
    ? "Estoy mirando tu foto de referencia…"
    : status === "ready"
      ? "Listo, usaré tu foto como referencia para el diseño."
      : null;

  return (
    <section className="material-panel space-y-1.5" aria-label="Foto de referencia">
      {texto && <p className="text-xs text-texto" role="status" aria-live="polite">{texto}</p>}
      {error && <p className="rounded-lg bg-acento-suave p-2 text-xs text-acento" role="alert">{error}</p>}
      {vistas && <p className="text-xs text-texto-suave">{vistas}</p>}
    </section>
  );
}
