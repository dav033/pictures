import { createHash } from "node:crypto";
import type { CatalogProduct } from "../catalog/schemas";
import { plegarTexto } from "../taxonomy/v2";
import type { CatalogItemV3, SceneFunctionCandidate } from "../catalog/scene-asset-schema";
import { CatalogItemV3Schema } from "../catalog/scene-asset-schema";
import type { SceneCategoryV3, SceneFunctionV3 } from "../taxonomy/v3";

/**
 * Adaptación explícita de V2 a V3 (PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md
 * §7.3 y Tarea 02.2, "Contratos de activos y taxonomía").
 *
 * IMPORTANTE — esto es una CAPA DE ADAPTACIÓN, no una fuente de verdad
 * nueva. Toma un `CatalogProduct` V2 ya validado (hard data de
 * Shopify/Postgres, `src/lib/rag/catalog/schemas.ts`) y produce un
 * `CatalogItemV3` de identidad física, inferido determinísticamente a partir
 * de texto real del producto (título, tags, `product_type`, categoría V2 ya
 * derivada). Esta función:
 *
 *   - NUNCA inventa una `CommercialOfferV1` (precio, proveedor,
 *     disponibilidad, snapshot). Eso solo puede salir de datos reales de
 *     PostgreSQL/Shopify o de un adaptador de proveedor verificado — nunca
 *     de esta adaptación de texto.
 *   - NUNCA asigna alta confianza a una `scene_functions` sin evidencia
 *     textual real. Si no hay una señal clara en título/tags/tipo, la
 *     función queda fuera del array (mejor "sin función candidata" que una
 *     función inventada).
 *   - Debe poder ejecutarse sobre cualquier producto del catálogo activo
 *     (globos, cortinas, velas, banderolas, etc.) sin lanzar error, incluso
 *     cuando la señal es débil — en ese caso devuelve una categoría de baja
 *     confianza y `scene_functions: []`, no un throw.
 *
 * El resultado siempre incluye `confidence` (qué tan segura es la
 * categorización general, en [0, 1]) y `evidence` (los fragmentos de texto
 * reales que motivaron la inferencia), para que capas posteriores (revisión
 * humana, enriquecimiento con evidencia de la Tarea 03.1) puedan auditar o
 * descartar la inferencia sin tener que confiar ciegamente en ella.
 */

export type AdaptCatalogProductV2ToV3Options = {
  /** Sobrescribe el `item_id` generado por defecto (`productoV2.product_id`). */
  itemId?: string;
  /** Techo deliberado de confianza para inferencia puramente textual (por defecto 0.7). Nunca se reporta como "alta confianza" sin evidencia estructurada real. */
  maxConfidence?: number;
};

export type AdaptCatalogProductV2ToV3Result = {
  item: CatalogItemV3;
  /** Confianza general de la adaptación (categoría + funciones), en [0, 1]. */
  confidence: number;
  /** Fragmentos de texto reales (título/tags/tipo/categoría V2) que sustentan la inferencia. */
  evidence: string[];
};

type CategoryRule = {
  category: SceneCategoryV3;
  confidence: number;
  /** Etiqueta legible de por qué se activó la regla (para `evidence`). */
  reason: string;
  test: (ctx: RuleContext) => boolean;
};

type FunctionRule = {
  function: SceneFunctionV3;
  confidence: number;
  reason: string;
  /** Solo se evalúa si la categoría resuelta coincide (o si `anyCategory` es true). */
  requiresCategory?: SceneCategoryV3;
  test: (ctx: RuleContext) => boolean;
};

type RuleContext = {
  /** Texto plegado (sin acentos, minúsculas) de título + tags + product_type. */
  foldedText: string;
  v2Category: string | null;
};

function hashUrl(url: string): string {
  return createHash("sha256").update(url, "utf-8").digest("hex");
}

function includesWord(foldedText: string, word: string): boolean {
  // `plegarTexto` ya normaliza espacios/acentos; basta un match de substring
  // de palabra completa razonable para evidencia textual determinista.
  return new RegExp(`(?:^|\\s)${word}`, "i").test(foldedText);
}

// ---------------------------------------------------------------------------
// Reglas de categoría — evaluadas en orden; la primera que aplica gana. Los
// matches de texto explícito (p. ej. "cortina") van antes que el mapeo
// genérico de categoría V2, porque son señal más fuerte y específica.
// ---------------------------------------------------------------------------

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "backdrop_surface",
    confidence: 0.65,
    reason: "título/tags contienen 'cortina' (superficie de fondo)",
    test: (ctx) => includesWord(ctx.foldedText, "cortina"),
  },
  {
    category: "plinth_pedestal",
    confidence: 0.6,
    reason: "título/tags contienen 'pedestal' o 'plinto'",
    test: (ctx) => includesWord(ctx.foldedText, "pedestal") || includesWord(ctx.foldedText, "plinto"),
  },
  {
    category: "linen",
    confidence: 0.6,
    reason: "título/tags contienen mantelería/camino de mesa/servilleta",
    test: (ctx) =>
      includesWord(ctx.foldedText, "mantel") ||
      includesWord(ctx.foldedText, "manteleria") ||
      includesWord(ctx.foldedText, "servilleta") ||
      includesWord(ctx.foldedText, "camino de mesa"),
  },
  {
    category: "floor_lighting",
    confidence: 0.5,
    reason: "título/tags contienen 'farol'",
    test: (ctx) => includesWord(ctx.foldedText, "farol"),
  },
  {
    category: "balloon_structure",
    confidence: 0.65,
    reason: "categoría V2 guirnalda_arco o título contiene 'arco'",
    test: (ctx) => ctx.v2Category === "guirnalda_arco" || includesWord(ctx.foldedText, "arco"),
  },
  {
    category: "ambient_lighting",
    confidence: 0.5,
    reason: "categoría V2 vela o título contiene 'vela'",
    test: (ctx) => ctx.v2Category === "vela" || includesWord(ctx.foldedText, "vela"),
  },
  {
    category: "signage",
    confidence: 0.55,
    reason: "categoría V2 banderola_cartel",
    test: (ctx) => ctx.v2Category === "banderola_cartel",
  },
  {
    category: "balloon_material",
    confidence: 0.6,
    reason: "categoría V2 globo_latex/globo_metalizado/globo_numero_letra",
    test: (ctx) =>
      ctx.v2Category === "globo_latex" || ctx.v2Category === "globo_metalizado" || ctx.v2Category === "globo_numero_letra",
  },
  {
    category: "table_setting",
    confidence: 0.3,
    reason: "categoría V2 desechable (ambiguo: puede ser montaje de mesa o insumo genérico)",
    test: (ctx) => ctx.v2Category === "desechable",
  },
  {
    category: "service_support",
    confidence: 0.35,
    reason: "categoría V2 kit/complemento/empaque (insumo operativo, no decoración visible verificada)",
    test: (ctx) => ctx.v2Category === "kit" || ctx.v2Category === "complemento" || ctx.v2Category === "empaque",
  },
];

/** Regla de último recurso: sin ninguna señal reconocible, nunca se inventa una categoría "decorativa" — se cae al bucket menos comprometedor. */
const FALLBACK_CATEGORY: Omit<CategoryRule, "test"> = {
  category: "service_support",
  confidence: 0.15,
  reason: "sin señal textual reconocible; categoría de reserva de baja confianza (no se afirma decoración visible)",
};

// ---------------------------------------------------------------------------
// Reglas de función de escena — pueden activarse varias a la vez (relación
// muchos-a-muchos, ver `taxonomy/v3.ts`). Cada una exige evidencia textual
// propia, no se heredan automáticamente de la categoría resuelta.
// ---------------------------------------------------------------------------

const FUNCTION_RULES: FunctionRule[] = [
  {
    function: "focal_backdrop",
    confidence: 0.6,
    reason: "detectado 'cortina' en título/tags",
    requiresCategory: "backdrop_surface",
    test: (ctx) => includesWord(ctx.foldedText, "cortina"),
  },
  {
    function: "balloon_accent",
    confidence: 0.6,
    reason: "categoría de globo (material)",
    requiresCategory: "balloon_material",
    test: () => true,
  },
  {
    function: "altar_frame",
    confidence: 0.4,
    reason: "arco de globos genérico; no verifica ser estructura de altar dedicada",
    requiresCategory: "balloon_structure",
    test: () => true,
  },
  {
    function: "balloon_accent",
    confidence: 0.5,
    reason: "estructura de globos también sirve como acento de globo",
    requiresCategory: "balloon_structure",
    test: () => true,
  },
  {
    function: "ambient_light",
    confidence: 0.45,
    reason: "vela como fuente de luz ambiental (uso de mesa/superficie no verificado)",
    requiresCategory: "ambient_lighting",
    test: () => true,
  },
  {
    function: "welcome_signage",
    confidence: 0.35,
    reason: "banderola/cartel; no verifica uso como señalización de bienvenida de boda",
    requiresCategory: "signage",
    test: () => true,
  },
  {
    function: "linen",
    confidence: 0.55,
    reason: "mantelería/camino de mesa genérico",
    requiresCategory: "linen",
    test: () => true,
  },
  {
    function: "plinth_pedestal",
    confidence: 0.55,
    reason: "pedestal/plinto detectado en título/tags",
    requiresCategory: "plinth_pedestal",
    test: () => true,
  },
  {
    function: "floor_light",
    confidence: 0.45,
    reason: "farol, típicamente apoyado en el suelo (uso no verificado)",
    requiresCategory: "floor_lighting",
    test: () => true,
  },
];

function buildTaxonomyText(producto: CatalogProduct): string {
  const parts = [producto.title, producto.product_type ?? "", ...producto.tags];
  return plegarTexto(parts.join(" "));
}

function resolveCategory(ctx: RuleContext): { category: SceneCategoryV3; confidence: number; reason: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(ctx)) {
      return { category: rule.category, confidence: rule.confidence, reason: rule.reason };
    }
  }
  return { ...FALLBACK_CATEGORY };
}

function resolveSceneFunctions(
  ctx: RuleContext,
  resolvedCategory: SceneCategoryV3,
  maxConfidence: number,
): SceneFunctionCandidate[] {
  const candidates: SceneFunctionCandidate[] = [];
  for (const rule of FUNCTION_RULES) {
    if (rule.requiresCategory && rule.requiresCategory !== resolvedCategory) continue;
    if (!rule.test(ctx)) continue;
    candidates.push({
      function: rule.function,
      confidence: Math.min(rule.confidence, maxConfidence),
      evidence: rule.reason,
    });
  }
  return candidates;
}

/**
 * Adapta un `CatalogProduct` V2 (Postgres/Shopify, ya validado) a un
 * `CatalogItemV3` parcial. Ver comentario de módulo: capa de adaptación, no
 * fuente de verdad. Nunca lanza para un producto V2 válido — en el peor caso
 * devuelve categoría de reserva de baja confianza y `scene_functions: []`.
 */
export function adaptCatalogProductV2ToV3(
  productoV2: CatalogProduct,
  opciones: AdaptCatalogProductV2ToV3Options = {},
): AdaptCatalogProductV2ToV3Result {
  const maxConfidence = opciones.maxConfidence ?? 0.7;
  const ctx: RuleContext = {
    foldedText: buildTaxonomyText(productoV2),
    v2Category: productoV2.derived.category,
  };

  const { category, confidence: categoryConfidence, reason: categoryReason } = resolveCategory(ctx);
  const cappedCategoryConfidence = Math.min(categoryConfidence, maxConfidence);
  const sceneFunctions = resolveSceneFunctions(ctx, category, maxConfidence);

  const mediaRefs = productoV2.image_urls.map((url, index) => ({
    id: `${productoV2.product_id}-media-${index}`,
    role: (index === 0 ? "identity" : "detail") as "identity" | "detail",
    source_url_hash: hashUrl(url),
  }));

  const item: CatalogItemV3 = {
    item_id: opciones.itemId ?? productoV2.product_id,
    category_v3: category,
    media_refs: mediaRefs,
    scene_functions: sceneFunctions,
    // Sin datos físicos estructurados en V2 hoy: se omite `dimensions` en vez
    // de inventar medidas. La Tarea 03.1 (enriquecimiento con evidencia) es
    // quien puede llenar esto con datos reales de origen.
    compatibility: {},
  };

  // Valida forma antes de devolver: si algún día un campo deja de cumplir el
  // esquema V3 (p. ej. una categoría fuera de la taxonomía), esto debe fallar
  // ruidosamente aquí, no silenciosamente más adelante en el pipeline.
  const parsed = CatalogItemV3Schema.parse(item);

  const evidence = [`categoría V2: ${ctx.v2Category ?? "(sin categoría)"}`, `regla de categoría: ${categoryReason}`, ...sceneFunctions.map((fn) => `función '${fn.function}': ${fn.evidence}`)];

  // Confianza general: promedio simple entre la categoría y las funciones
  // encontradas (si no hay ninguna función candidata, la confianza general
  // no sube más allá de la categoría — no hay evidencia de función real).
  const functionConfidences = sceneFunctions.map((fn) => fn.confidence);
  const overallConfidence =
    functionConfidences.length === 0
      ? cappedCategoryConfidence
      : Math.min(maxConfidence, (cappedCategoryConfidence + functionConfidences.reduce((a, b) => a + b, 0) / functionConfidences.length) / 2);

  return { item: parsed, confidence: overallConfidence, evidence };
}
