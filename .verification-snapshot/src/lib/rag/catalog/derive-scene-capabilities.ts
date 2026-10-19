import type { CatalogProduct } from "./schemas";
import { adaptCatalogProductV2ToV3, type AdaptCatalogProductV2ToV3Options } from "../sources/provenance";
import type { SceneCategoryV3, SceneFunctionV3 } from "../taxonomy/v3";

/**
 * Motor de reglas central del enriquecimiento con evidencia (PLAN_ARQUITECTURA_
 * ESCENA_COMPLETA_RAG.md, Tarea 03.1 dentro de "Plan 03 — Enriquecimiento,
 * proveedores y auditoría de brechas").
 *
 * RELACIÓN CON `src/lib/rag/sources/provenance.ts`:
 * este módulo NO duplica la lógica de inferencia de categoría/función — la
 * reutiliza directamente vía `adaptCatalogProductV2ToV3()`, que ya implementa
 * las reglas deterministas de texto (título/tags/product_type/categoría V2)
 * exigidas por la Tarea 02.2. Lo que agrega esta capa (Tarea 03.1) es la
 * política de "confianza publicable vs. revisión pendiente":
 *
 *   - `adaptCatalogProductV2ToV3()` ya calibra la confianza de cada función
 *     candidata (nunca alta sin evidencia real) y ya deja `scene_functions: []`
 *     cuando no hay ninguna señal reconocible.
 *   - Este módulo decide, candidata por candidata, si esa confianza alcanza
 *     para publicarse como capacidad "cierta" (`derived_from: "derived"`) o si
 *     debe quedar marcada `derived_from: "review"` — persistida y auditable,
 *     pero NUNCA tratada aguas abajo como un hecho comercial verificado. Un
 *     item sin ninguna candidata (`scene_functions: []`) o con una categoría
 *     de reserva de muy baja confianza también se marca `needsReview: true` a
 *     nivel de item, aunque no haya ninguna fila de capacidad que insertar.
 *
 * Nada aquí usa un LLM ni inventa evidencia: `evidence` siempre es el mismo
 * fragmento de texto real (o la etiqueta de regla determinista) que ya
 * produce `provenance.ts`.
 */

/** Confianza mínima de una función candidata para publicarse como "derived" en vez de "review" (plan §5.3 / Tarea 03.1: "sin forzar una función con baja confianza como si fuera cierta"). */
export const MIN_CONFIDENT_FUNCTION_CONFIDENCE = 0.5;

/** Confianza general (categoría + funciones) por debajo de la cual el item entero se marca para revisión, aunque alguna función individual haya cruzado el umbral anterior. */
export const MIN_CONFIDENT_OVERALL_CONFIDENCE = 0.4;

export type DerivedCapabilityStatus = "derived" | "review";

export type DerivedSceneCapability = {
  scene_function: SceneFunctionV3;
  /** En [0, 1], igual a la confianza calibrada por `adaptCatalogProductV2ToV3`. */
  confidence: number;
  /** Fragmento de texto real (o etiqueta de regla determinista) que motivó la función — nunca generado libremente. */
  evidence: string;
  /** "derived": confianza suficiente para tratarse como capacidad publicable. "review": ambigua, debe pasar por revisión humana antes de tratarse como cierta. */
  derived_from: DerivedCapabilityStatus;
};

export type DeriveSceneCapabilitiesResult = {
  /** Igual a `productoV2.product_id` salvo que se pase `options.itemId` — coincide con `catalog_items.item_id` a nivel de producto (sin variante). */
  itemId: string;
  productId: string;
  categoryV3: SceneCategoryV3;
  /** Confianza general combinada de categoría + funciones, tal como la calcula `adaptCatalogProductV2ToV3`. */
  overallConfidence: number;
  capabilities: DerivedSceneCapability[];
  /** true cuando el item completo debe pasar por revisión humana antes de tratarse como enriquecimiento cierto: sin ninguna candidata, confianza general débil, o al menos una candidata ambigua. */
  needsReview: boolean;
  /** Motivos legibles de por qué needsReview es true; vacío cuando needsReview es false. */
  reviewReasons: string[];
};

/**
 * Deriva las funciones de escena candidatas para un producto V2 del catálogo
 * real, con confianza y evidencia trazable, separando explícitamente lo
 * publicable (`derived`) de lo ambiguo (`review`). Determinista: la misma
 * entrada siempre produce exactamente la misma salida (mismo orden, mismos
 * valores) — no depende de reloj, red ni aleatoriedad.
 */
export function deriveSceneCapabilities(
  productoV2: CatalogProduct,
  options: AdaptCatalogProductV2ToV3Options = {},
): DeriveSceneCapabilitiesResult {
  const { item, confidence: overallConfidence } = adaptCatalogProductV2ToV3(productoV2, options);

  const capabilities: DerivedSceneCapability[] = item.scene_functions.map((candidate) => ({
    scene_function: candidate.function,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    derived_from: candidate.confidence >= MIN_CONFIDENT_FUNCTION_CONFIDENCE ? "derived" : "review",
  }));

  const reviewReasons: string[] = [];
  if (capabilities.length === 0) {
    reviewReasons.push("sin candidatas de función de escena: ninguna señal textual reconocible en título/tags/tipo/categoría");
  }
  const ambiguousCount = capabilities.filter((capability) => capability.derived_from === "review").length;
  if (ambiguousCount > 0) {
    reviewReasons.push(
      `${ambiguousCount} de ${capabilities.length} candidata(s) por debajo del umbral de confianza publicable (< ${MIN_CONFIDENT_FUNCTION_CONFIDENCE})`,
    );
  }
  if (overallConfidence < MIN_CONFIDENT_OVERALL_CONFIDENCE) {
    reviewReasons.push(
      `confianza general débil (${overallConfidence.toFixed(2)} < ${MIN_CONFIDENT_OVERALL_CONFIDENCE}), incluida la categoría de reserva sin señal reconocible`,
    );
  }

  return {
    itemId: item.item_id,
    productId: productoV2.product_id,
    categoryV3: item.category_v3,
    overallConfidence,
    capabilities,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
}
