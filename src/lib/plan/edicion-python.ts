import "server-only";
import {
  isPythonAdapterError,
  llamarPythonCatalogRecommendations,
  llamarPythonCatalogSelection,
} from "@/lib/ia/python-adapter";
import type { ProductoCandidato } from "@/lib/rag/chat/buscar";
import { candidatoDesdePython } from "@/lib/rag/chat/candidato-python";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import { errorAllowlistDesdePython } from "./allowlist-producto-variante";
import type { ContextoPlan } from "./aprobacion";
import { coloresRealesProducto } from "./colores-producto";
import { PlanEditError } from "./edicion-error";
import { ordenarRecomendacionesPorColor } from "./recomendaciones-orden";
import { PlanBackendNoDisponibleError } from "./resolver-backend";

/** Deadline for the short catalog checks the editor makes while the customer waits. */
export const EDICION_PYTHON_DEADLINE_MS = 5_000;
/** Python may return up to this many variants; Next only orders and bounds them. */
export const RECOMENDACIONES_LIMITE_PYTHON = 100;
/** Display bound, same as the legacy editor. */
export const RECOMENDACIONES_MAX_PRODUCTOS = 12;

const MENSAJE_REFERENCIA_NO_ENCONTRADA = "No se encontró la variante para recomendar alternativas.";

/**
 * Un plan solo se puede editar contra el snapshot firmado con el que se
 * resolvió. `PYTHON_NO_SELECCIONADO` desapareció con el kill switch (ADR-0023
 * paso 5): ya no hay otro backend al que no poder volver.
 */
export function exigirContextoPython(contexto: ContextoPlan): string {
  if (!contexto.catalogSnapshotId) {
    throw new PlanBackendNoDisponibleError("SIN_SNAPSHOT_CATALOGO", "La propuesta aprobada no tiene un snapshot de catálogo disponible; vuelve a pedir la propuesta.");
  }
  return contexto.catalogSnapshotId;
}

/**
 * Admits the customer's explicit editor pick into the same-turn allowlist only
 * after Python validates the exact pair in the signed snapshot. The selection
 * allowlist is intentionally that single pair: the editor choice is not a model
 * pick, and the pair is checked again when the edited plan is resolved.
 *
 * Returns the admitted variant's real colors (Python already answers with the
 * variant's own colors, or the product's when it has exactly one), so the edit
 * can label the material with what it actually buys.
 */
export async function admitirVariantePython(input: {
  variante: { product_id: string; variant_id: string };
  catalogSnapshotId: string;
  whitelist: Map<string, Set<string>>;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { variante } = input;
  let seleccion: Awaited<ReturnType<typeof llamarPythonCatalogSelection>>;
  try {
    seleccion = await llamarPythonCatalogSelection({
      items: [{ product_id: variante.product_id, variant_id: variante.variant_id, quantity: 1 }],
      allowlist: [{ product_id: variante.product_id, variant_ids: [variante.variant_id] }],
      catalogSnapshotId: input.catalogSnapshotId,
      requestId: crypto.randomUUID(),
      correlationId: input.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(input.signal ? { parentSignal: input.signal } : {}),
    });
  } catch (error) {
    throw errorAllowlistDesdePython(error) ?? error;
  }
  const admitida = seleccion.validados.length === 1
    && seleccion.validados[0]!.product_id === variante.product_id
    && seleccion.validados[0]!.variant_id === variante.variant_id;
  if (!admitida) {
    throw new PlanEditError(409, "La variante elegida no está disponible en el catálogo de esta propuesta.", "VARIANTE_NO_ADMITIDA");
  }
  const variantes = input.whitelist.get(variante.product_id) ?? new Set<string>();
  variantes.add(variante.variant_id);
  input.whitelist.set(variante.product_id, variantes);
  const validado = seleccion.validados[0]!;
  return coloresRealesProducto(validado.product_title, validado.colors);
}

/**
 * Recommendations for a Python plan. The reference must belong to the signed
 * allowlist (checked here, from signed data only, before any network call);
 * Python decides which catalog rows are recommendable; Next only orders them by
 * color and bounds the list for display.
 */
export async function recomendarAlternativasPython(input: {
  contexto: ContextoPlan;
  variantId: string;
  catalogAllowlist: CatalogAllowlist | null;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<ProductoCandidato[]> {
  const catalogSnapshotId = exigirContextoPython(input.contexto);
  if (!input.contexto.allowlist.some((entrada) => entrada.variant_ids.includes(input.variantId))) {
    throw new PlanEditError(404, MENSAJE_REFERENCIA_NO_ENCONTRADA, "VARIANTE_REFERENCIA_NO_ENCONTRADA");
  }
  // A LoRA mode without variants authorizes nothing; never send it as "unrestricted".
  if (input.catalogAllowlist && input.catalogAllowlist.variantIds.length === 0) return [];

  let resultado: Awaited<ReturnType<typeof llamarPythonCatalogRecommendations>>;
  try {
    resultado = await llamarPythonCatalogRecommendations({
      referenceVariantId: input.variantId,
      catalogSnapshotId,
      ...(input.catalogAllowlist ? { loraVariantIds: input.catalogAllowlist.variantIds } : {}),
      limit: RECOMENDACIONES_LIMITE_PYTHON,
      requestId: crypto.randomUUID(),
      correlationId: input.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(input.signal ? { parentSignal: input.signal } : {}),
    });
  } catch (error) {
    if (isPythonAdapterError(error) && error.domainCode === "reference_variant_not_found") {
      throw new PlanEditError(404, MENSAJE_REFERENCIA_NO_ENCONTRADA, "VARIANTE_REFERENCIA_NO_ENCONTRADA");
    }
    if (isPythonAdapterError(error) && error.domainCode === "catalog_snapshot_not_found") {
      throw new PlanBackendNoDisponibleError("SIN_SNAPSHOT_CATALOGO", "El snapshot de catálogo de esta propuesta ya no está publicado; vuelve a pedir la propuesta.");
    }
    throw error;
  }
  const ordenados = ordenarRecomendacionesPorColor(
    resultado.candidates.map(candidatoDesdePython),
    { productId: resultado.reference.product_id, colores: resultado.reference.colors },
  );
  return ordenados.slice(0, RECOMENDACIONES_MAX_PRODUCTOS);
}
