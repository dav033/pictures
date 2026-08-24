/**
 * Contrato de adaptador de fuente de escena (Tarea 03.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, secciones 6, 8.2 y 8.3).
 *
 * ESTE ARCHIVO NO IMPLEMENTA NINGÚN PROVEEDOR REAL. Hoy no existe ningún
 * proveedor de venta/alquiler verificado para mobiliario, floristería,
 * estructuras de altar o iluminación (diagnóstico de la Ola 0, sección 2.2:
 * 0 mobiliario, 0 flores/follaje físicos, 0 iluminación física en el
 * snapshot activo). Lo que se define aquí es el CONTRATO que cualquier
 * adaptador futuro debe cumplir para poder alimentar
 * `catalog_sources` / `catalog_commercial_offers` / `catalog_price_components`
 * (sección 8.2) sin violar los invariantes anti-alucinación de la sección
 * 6.4. Construir un adaptador concreto (Shopify de un proveedor de alquiler,
 * un feed CSV de un florista, etc.) es trabajo posterior, fuera del alcance
 * de esta tarea.
 *
 * Principio rector (sección 6.4): "Venta y alquiler requieren `offer_id`,
 * snapshot, medio de identidad y precio verificable." Un adaptador nunca
 * inventa disponibilidad, precio, ciudad de servicio ni vigencia — o los
 * declara con evidencia verificable, o los deja fuera y la oferta cae en
 * brecha auditada (`scripts/audit-scene-catalog.ts`, `verified-assets.ts`).
 */

import {
  CommercialOfferV1Schema,
  type CatalogItemV3,
  type CommercialOfferV1,
} from "@/lib/rag/catalog/scene-asset-schema";

// ---------------------------------------------------------------------------
// Checklist de incorporación de proveedores (sección 8.3), como datos
// tipados y consultables — no un párrafo de documentación aislado. El
// documento operativo para humanos (`docs/catalog/SCENE_SOURCE_ONBOARDING.md`)
// se deriva de esta misma lista para que ambos no puedan divergir en
// silencio: si se agrega un requisito aquí, el doc debe actualizarse a mano
// citando la misma `key`.
// ---------------------------------------------------------------------------

export type SupplierRequirementKey =
  | "identity_authorization"
  | "reproducible_catalog_feed"
  | "price_or_quote_required"
  | "availability_stock"
  | "validity_window"
  | "service_area_and_rental_period_rules"
  | "deposit_transport_installation_scope"
  | "dimensions_and_mounting"
  | "usable_photos"
  | "unpublish_process";

export type SupplierRequirement = {
  key: SupplierRequirementKey;
  label: string;
  description: string;
  /** `all`: exigido a cualquier proveedor; `rental_only`: solo aplica cuando `source_class === "catalog_rental"`. */
  appliesTo: "all" | "rental_only";
};

/**
 * Lista EXACTA de la sección 8.3: "Para cada proveedor se exige: identidad y
 * autorización de uso; catálogo o feed reproducible; precio o estado
 * `QUOTE_REQUIRED`; disponibilidad/stock cuando aplique; fecha de vigencia;
 * ciudad/área de servicio y reglas de período para alquileres; depósito,
 * transporte, instalación y qué componentes están incluidos; dimensiones y
 * condiciones de montaje; fotos utilizables como referencia; proceso de
 * despublicación."
 */
export const SUPPLIER_ONBOARDING_REQUIREMENTS: readonly SupplierRequirement[] = [
  {
    key: "identity_authorization",
    label: "Identidad y autorización de uso",
    description:
      "Quién es el proveedor (razón social o persona verificable) y evidencia de que autorizó explícitamente usar su " +
      "catálogo/precios en este sistema. Se registra en catalog_sources.provider_name + commercial_policy y respalda " +
      "catalog_sources.status = 'active' (nunca 'active' sin esta verificación).",
    appliesTo: "all",
  },
  {
    key: "reproducible_catalog_feed",
    label: "Catálogo o feed reproducible",
    description:
      "Un origen de datos que se pueda volver a consultar y comparar (API, feed CSV/XML versionado, hoja de cálculo " +
      "con fecha) — nunca una lista verbal o un chat sin registro. Es lo que permite fijar snapshot_id de forma " +
      "verificable en cada sync (ver listOffers más abajo).",
    appliesTo: "all",
  },
  {
    key: "price_or_quote_required",
    label: "Precio o estado QUOTE_REQUIRED",
    description:
      "Cada oferta trae un precio verificable (price_components con unit_sale/package_sale/rental_period) o se marca " +
      "explícitamente QUOTE_REQUIRED (sección 6.2) — nunca un precio inventado ni un estado PRICED sin componente " +
      "de precio que cubra la modalidad (regla ya exigida por CommercialOfferV1Schema).",
    appliesTo: "all",
  },
  {
    key: "availability_stock",
    label: "Disponibilidad/stock cuando aplique",
    description:
      "availability.status (available/limited/unavailable) con availability.checked_at — un proveedor que no puede " +
      "confirmar disponibilidad real debe marcarse 'limited' o 'unavailable', nunca 'available' por defecto.",
    appliesTo: "all",
  },
  {
    key: "validity_window",
    label: "Fecha de vigencia",
    description:
      "valid_from/valid_until de la oferta. Una oferta sin vigencia declarada se trata como vigente solo desde su " +
      "verified_at hasta que se re-verifique; el adaptador debe declarar vigencia explícita en cuanto el proveedor " +
      "la comunique (p. ej. tarifas de temporada).",
    appliesTo: "all",
  },
  {
    key: "service_area_and_rental_period_rules",
    label: "Ciudad/área de servicio y reglas de período para alquileres",
    description:
      "service_area (país, ciudades y/o radio_km) siempre que el proveedor tenga cobertura geográfica limitada. Para " +
      "catalog_rental además rental_period_rules (minimum_periods + period_unit: 'event' | 'day') — sin esto un " +
      "alquiler no puede reconciliarse contra sección 6.3 ('alquiler reconciliado como cantidad × períodos × tarifa').",
    appliesTo: "rental_only",
  },
  {
    key: "deposit_transport_installation_scope",
    label: "Depósito, transporte, instalación y qué componentes están incluidos",
    description:
      "Cada cargo de servicio (depósito reembolsable, transporte, montaje, mano de obra) como su propio " +
      "price_component con type='service_fee' y service_fee_kind explícito — nunca mezclado con el subtotal de " +
      "producto (invariante 3, sección 6.3). El adaptador debe declarar explícitamente qué SÍ incluye el precio base " +
      "del producto/alquiler y qué es un cargo aparte.",
    appliesTo: "all",
  },
  {
    key: "dimensions_and_mounting",
    label: "Dimensiones y condiciones de montaje",
    description:
      "PhysicalDimensions (ancho/alto/profundidad/diámetro/peso) y compatibility.mounting/requires_support/supports " +
      "cuando el proveedor las provea — necesario para el optimizador de compatibilidad (Plan 05) y el grafo espacial " +
      "(sección 10.1). Puede quedar vacío si el proveedor no las tiene, pero nunca inventado.",
    appliesTo: "all",
  },
  {
    key: "usable_photos",
    label: "Fotos utilizables como referencia",
    description:
      "Al menos una imagen con licencia/autorización de uso, mapeada a CatalogItemV3.media_refs con role='identity'. " +
      "Sin al menos una foto de identidad, un item no puede usarse como referencia visual confiable en generación.",
    appliesTo: "all",
  },
  {
    key: "unpublish_process",
    label: "Proceso de despublicación",
    description:
      "Cómo y cuándo el proveedor deja de ofrecer un producto (fin de contrato, agotado permanente, catálogo " +
      "descontinuado) y cómo ese evento llega al adaptador para invocar unpublishOffer(). Ver esa función más abajo: " +
      "despublicar NUNCA borra la fila de oferta ni su auditoría, solo cambia su status y lo registra.",
    appliesTo: "all",
  },
] as const;

export function supplierRequirementsFor(sourceClass: "catalog_sale" | "catalog_rental"): SupplierRequirement[] {
  return SUPPLIER_ONBOARDING_REQUIREMENTS.filter(
    (requirement) => requirement.appliesTo === "all" || (requirement.appliesTo === "rental_only" && sourceClass === "catalog_rental"),
  );
}

// ---------------------------------------------------------------------------
// Validación de forma — nunca se inventa disponibilidad/precio (sección 6.4).
// ---------------------------------------------------------------------------

export class SceneSourceAdapterViolationError extends Error {
  readonly sourceId: string;
  readonly issues: string[];

  constructor(sourceId: string, issues: string[]) {
    super(
      `El adaptador de la fuente "${sourceId}" produjo ${issues.length} oferta(s) inválida(s): ${issues.join(" | ")}`,
    );
    this.name = "SceneSourceAdapterViolationError";
    this.sourceId = sourceId;
    this.issues = issues;
  }
}

/**
 * Valida la FORMA de una oferta recién sincronizada contra
 * `CommercialOfferV1Schema` (que ya exige `offer_id`, `source_ref`
 * completo —`source_id`+`snapshot_id`+`verified_at`— y, para `status:
 * "PRICED"`, al menos un `price_component` que cubra la modalidad). Un
 * adaptador que no puede producir estos campos con evidencia real DEBE dejar
 * la oferta en `status: "UNAVAILABLE"` o directamente omitirla (ver
 * `SceneSourceOfferSyncResult.rejected` más abajo) — nunca rellenar
 * `snapshot_id`/`price_components` con un valor inventado para que este
 * validador pase.
 */
export function validateSyncedOffer(sourceId: string, raw: unknown): CommercialOfferV1 {
  const parsed = CommercialOfferV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new SceneSourceAdapterViolationError(
      sourceId,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Interfaz del adaptador
// ---------------------------------------------------------------------------

export type SceneSourceSyncParams = {
  /** `catalog_sources.source_id` que este adaptador sincroniza. */
  sourceId: string;
  /**
   * Identificador de snapshot que el adaptador debe fijar en CADA oferta
   * producida en esta corrida (`source_ref.snapshot_id`). Se genera fuera
   * del adaptador (p. ej. hash del feed crudo + fecha) para que dos syncs
   * distintos del mismo estado de proveedor sean comparables sin depender de
   * reloj de sistema del adaptador.
   */
  snapshotId: string;
  /** ISO 8601. Se usa como `source_ref.verified_at` cuando el proveedor no trae su propio timestamp de verificación. */
  requestedAt: string;
};

export type SceneSourceRejectedOffer = {
  /** El registro crudo del proveedor tal como llegó — para auditoría, nunca transformado. */
  raw: unknown;
  /** Por qué NO se pudo convertir en una CommercialOfferV1 válida (nunca "se completó con un valor por defecto"). */
  reason: string;
};

export type SceneSourceOfferSyncResult = {
  /**
   * Identidades físicas (sección 7.3) referenciadas por `offers`. Un
   * adaptador puede descubrir items nuevos o reutilizar `item_id` ya
   * conocidos — nunca reasignar un `item_id` existente a un objeto físico
   * distinto.
   */
  items: CatalogItemV3[];
  /** Ofertas ya validadas por `validateSyncedOffer` — listas para persistir en `catalog_commercial_offers`/`catalog_price_components`. */
  offers: CommercialOfferV1[];
  /**
   * Registros del feed del proveedor que NO se pudieron convertir en una
   * oferta válida (falta precio verificable, falta identidad, etc.). Deben
   * reportarse aquí, nunca descartarse en silencio ni "completarse" con un
   * valor supuesto — así el auditor (`scripts/audit-scene-catalog.ts`) puede
   * distinguir "el proveedor no tiene esto" de "el adaptador lo perdió".
   */
  rejected: SceneSourceRejectedOffer[];
};

export type SceneSourceUnpublishResult = {
  offerId: string;
  previousStatus: CommercialOfferV1["status"];
  /** La despublicación SIEMPRE aterriza en UNAVAILABLE — nunca se borra la fila. */
  newStatus: "UNAVAILABLE";
  unpublishedAt: string;
  reason: string;
};

/**
 * Contrato que cualquier adaptador de venta/alquiler futuro debe implementar.
 * Un adaptador está SIEMPRE atado a una `source_class` fija
 * (`catalog_sale` o `catalog_rental`) — `venue_existing`,
 * `context_non_quotable`, `editorial_reference` y `test_only` nunca tienen
 * adaptador: no representan un proveedor con oferta comercial sincronizable
 * (sección 6.1/6.4).
 */
export interface SceneSourceAdapter {
  readonly sourceId: string;
  readonly providerName: string;
  readonly sourceClass: "catalog_sale" | "catalog_rental";

  /**
   * Confirma (o vuelve a confirmar) identidad y autorización de uso del
   * proveedor (primer requisito de la sección 8.3). Un adaptador NUNCA debe
   * dejar `catalog_sources.status = 'active'` sin que esta verificación se
   * haya hecho al menos una vez con evidencia real (contrato, correo de
   * autorización, cuenta de proveedor verificada, etc. — el propio
   * `evidenceRef` es esa evidencia, no una descripción libre).
   */
  verifyIdentity(): Promise<{ verified: boolean; verifiedAt: string; evidenceRef: string }>;

  /**
   * Lista/sincroniza las ofertas vigentes de este `catalog_source` desde el
   * catálogo/feed reproducible del proveedor (segundo requisito de la
   * sección 8.3). Determinista dado el mismo estado real del proveedor: dos
   * llamadas seguidas sin cambios en el proveedor deben producir el mismo
   * conjunto de `offers` (mismo `offer_id`, mismo contenido) salvo por
   * `snapshot_id`/`verified_at`, que sí cambian por ser una nueva corrida.
   */
  listOffers(params: SceneSourceSyncParams): Promise<SceneSourceOfferSyncResult>;

  /**
   * Retira una oferta cuando el proveedor deja de ofrecerla (último
   * requisito de la sección 8.3). Debe:
   *   1. dejar `status: "UNAVAILABLE"` en la oferta (nunca borrar la fila);
   *   2. devolver el estado anterior, para que el llamador pueda escribir
   *      una fila en `catalog_source_audit` con `action: "deactivated"`
   *      (o `"rejected"` si nunca llegó a estar activa) y `previous_state`/
   *      `new_state` reales — el historial de auditoría de la sección 8.2
   *      (`catalog_source_audit`) depende de que este método nunca destruya
   *      la fila original.
   * `unpublishOffer` es responsabilidad del adaptador declarar CUÁNDO ocurre
   * (p. ej. el proveedor lo marcó agotado permanente en su feed); la
   * escritura real en Postgres la hace el llamador con esta información.
   */
  unpublishOffer(offerId: string, reason: string): Promise<SceneSourceUnpublishResult>;
}
