export type GenerationIdSources = {
  productIds: string[];
  ragVariantIds: string[];
};

/**
 * Frontera de autoridad comercial (Tarea 00.3 —
 * PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md §2.2 y §6). Lo de arriba separa
 * RAG de productIds legacy en el borde de generación; esto separa, dentro de
 * esas fuentes, lo que tiene oferta comercial verificada (Postgres/Shopify)
 * de lo que no (seed SQLite, `manualProducts`).
 *
 * `NonCommercialReferenceClass` está alineado en nombre y espíritu con el
 * mismo tipo descrito en el plan §7.3, dentro del contrato Zod formal
 * (`CatalogItemV3`/`SupplyBinding`) que todavía no existe como código — se
 * implementará en la Tarea 02.2. Hasta entonces este union local es la
 * fuente de verdad real.
 */
export type NonCommercialReferenceClass = "editorial_reference" | "test_only";

/** De dónde sale un producto que NO tiene `offer_id` ni snapshot comercial verificado. */
export type NonCommercialProductSource = "seed_demo" | "manual_product";

/** Cómo se pretende usar el producto en la petición actual. */
export type CommercialUsageIntent = "reference" | "commercial_line";

export type RuntimeCommercialEnvironment = "production" | "non_production";

/**
 * Determina si el sistema corre en un entorno donde seed/manual solo pueden
 * usarse como referencia (`non_production`: dev/test/CI) o en producción,
 * donde nunca pueden presentarse como línea comercial verificada. Se basa en
 * `NODE_ENV` — el mismo criterio que ya usa el resto del código
 * (`process.env.NODE_ENV !== "production"` en `api/generate/route.ts`).
 */
export function resolveRuntimeCommercialEnvironment(
  env: { NODE_ENV?: string } = process.env,
): RuntimeCommercialEnvironment {
  return env.NODE_ENV === "production" ? "production" : "non_production";
}

function defaultReferenceClassFor(source: NonCommercialProductSource): NonCommercialReferenceClass {
  // El seed SQLite es un fixture de desarrollo/pruebas (14 productos demo
  // sin proveedor real); las piezas manuales son descripciones que el
  // usuario/frontend agrega a mano en el chat y sirven como referencia de
  // estilo, nunca como inventario verificado.
  return source === "seed_demo" ? "test_only" : "editorial_reference";
}

export type NonCommercialProductClassification = {
  productId: string;
  source: NonCommercialProductSource;
  referenceClass: NonCommercialReferenceClass;
  runtime: RuntimeCommercialEnvironment;
};

/** Lanzado cuando una ruta intenta convertir un producto sin oferta comercial real en una línea comercial verificada en producción. */
export class NonCommercialSourceRejectedError extends Error {
  readonly productId: string;
  readonly source: NonCommercialProductSource;
  readonly referenceClass: NonCommercialReferenceClass;

  constructor(productId: string, source: NonCommercialProductSource, referenceClass: NonCommercialReferenceClass) {
    super(
      `Product "${productId}" comes from a non-commercial source ("${source}") classified as "${referenceClass}". ` +
        `It has no verified commercial offer (offer_id + snapshot) and cannot be used as a commercial line ` +
        `(purchase, rental, or verified plan) in production.`,
    );
    this.name = "NonCommercialSourceRejectedError";
    this.productId = productId;
    this.source = source;
    this.referenceClass = referenceClass;
  }
}

/**
 * Clasifica un producto sin oferta comercial verificada (seed SQLite o
 * `manualProducts`) y decide si el uso pretendido está permitido:
 *
 * - `usage: "reference"` siempre se permite — el producto queda etiquetado
 *   como `editorial_reference`/`test_only` y nunca se presenta como
 *   inventario validado, en ningún entorno.
 * - `usage: "commercial_line"` (compra, alquiler o plan comercialmente
 *   verificable) solo se permite fuera de producción, para no romper el
 *   demo/pruebas locales existentes. En producción lanza
 *   `NonCommercialSourceRejectedError`.
 */
export function classifyNonCommercialProduct(
  productId: string,
  source: NonCommercialProductSource,
  usage: CommercialUsageIntent,
  env: { NODE_ENV?: string } = process.env,
): NonCommercialProductClassification {
  const runtime = resolveRuntimeCommercialEnvironment(env);
  const referenceClass = defaultReferenceClassFor(source);
  if (usage === "commercial_line" && runtime === "production") {
    throw new NonCommercialSourceRejectedError(productId, source, referenceClass);
  }
  return { productId, source, referenceClass, runtime };
}

/**
 * Variante en lote de `classifyNonCommercialProduct` para una sola fuente y
 * un solo uso pretendido (el caso común: todos los `manualProducts` de una
 * petición, o todos los ids de seed resueltos en `productIds`). Lanza en el
 * primer rechazo, con la misma semántica que la versión singular.
 */
export function classifyNonCommercialProducts(
  productIds: readonly string[],
  source: NonCommercialProductSource,
  usage: CommercialUsageIntent,
  env: { NODE_ENV?: string } = process.env,
): NonCommercialProductClassification[] {
  return productIds.map((productId) => classifyNonCommercialProduct(productId, source, usage, env));
}

/**
 * En la frontera de generación cada id debe viajar por una sola fuente.
 * Si una selección vieja conserva un variant_id como productId y el plan lo
 * vuelve a declarar como RAG, la API rechaza la petición. En ese caso la
 * fuente explícita de RAG tiene precedencia.
 */
export function normalizeGenerationSources(
  productIds: readonly string[],
  ragVariantIds: readonly string[],
): GenerationIdSources {
  const uniqueRagVariantIds = [...new Set(ragVariantIds)];
  const ragVariantIdSet = new Set(uniqueRagVariantIds);

  return {
    productIds: [...new Set(productIds)].filter((id) => !ragVariantIdSet.has(id)),
    ragVariantIds: uniqueRagVariantIds,
  };
}

/**
 * Splits ids by validated source metadata. The input order within each source
 * is retained; duplicates are removed at their first occurrence.
 */
export function classifyGenerationIds(
  ids: readonly string[],
  validatedRagVariantIds: ReadonlySet<string>,
): GenerationIdSources {
  const productIds: string[] = [];
  const ragVariantIds: string[] = [];
  const seenProductIds = new Set<string>();
  const seenRagVariantIds = new Set<string>();

  for (const id of ids) {
    if (validatedRagVariantIds.has(id)) {
      if (!seenRagVariantIds.has(id)) {
        seenRagVariantIds.add(id);
        ragVariantIds.push(id);
      }
    } else if (!seenProductIds.has(id)) {
      seenProductIds.add(id);
      productIds.push(id);
    }
  }

  return { productIds, ragVariantIds };
}
