/**
 * Invariantes de dominio para escenas de boda completas.
 *
 * Codifica en código ejecutable las decisiones de
 * `docs/adr/001-scene-program-and-provenance.md` (Tarea 00.2 del plan
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`):
 *
 *   1. "Programa antes de productos"
 *   2. "Sin fuente no se renderiza"
 *   3. "Evento y vista son niveles distintos"
 *   4. "Precio desconocido bloquea aprobación final"
 *
 * más las invariantes de presupuesto (sección 6.3) y anti-alucinación
 * (sección 6.4) que son expresables como funciones puras sin depender de
 * PostgreSQL, un proveedor de imagen ni un LLM.
 *
 * IMPORTANTE — tipos locales mínimos:
 * La Tarea 01.1 (que corre en paralelo a esta) publicará los contratos Zod
 * reales (`EventIntentV2`, `SceneProgramV1`, `SceneSlot`, `SupplyBinding`,
 * `ScenePlanV2`, `ResolvedScenePlanV2`, `SceneCoverageReport`, ...) en
 * `src/lib/scene/tipos.ts`. Este archivo NO depende de esa tarea: define
 * tipos locales mínimos, suficientes para expresar cada regla, y deben
 * conectarse a los contratos Zod reales (`z.infer<...>`) cuando existan,
 * sin cambiar la firma pública de las funciones `assert*`.
 *
 * ACTUALIZACIÓN (Tarea 01.1, ya completada): `SupplySourceClass`,
 * `ContextKind` y `MinimalSupplyBinding` coinciden exactamente con
 * `SupplySourceClass`, `ContextKind` y `SupplyBinding` de
 * `src/lib/scene/tipos.ts` (mismos valores literales, misma forma), así que
 * se reexportan como alias de los tipos reales en vez de duplicarse. El
 * resto de los tipos locales de este archivo (`MinimalSceneInstance`,
 * `MinimalScenePlan`, `MinimalCoverageReport`, `MinimalPipelineEvent`,
 * `MinimalHashSnapshot`, ...) siguen siendo locales a propósito: no tienen
 * todavía un equivalente completo en `tipos.ts` — ese contrato es
 * `ScenePlanV2`/`ResolvedScenePlanV2`/`SceneSpecV2`, y la Tarea 01.1 solo
 * publicó *stubs* mínimos de esos tres (ver `tipos.ts`, sección 7.5), no su
 * forma final. Conectar estos tipos locales a los stubs sería prematuro y
 * probablemente requeriría deshacerse cuando Plan 05/06/07 los completen.
 *
 * Estilo deliberado: cada `assert*` es una función pura respecto de sus
 * argumentos (no llama a PostgreSQL, red, reloj del sistema ni LLM). Si la
 * regla se cumple devuelve `{ ok: true, violations: [] }`. Si la regla se
 * viola, lanza `SceneInvariantViolationError` (un error tipado que además
 * expone `violations: string[]`) en vez de devolver `ok: false` en
 * silencio — así ninguna ruta de generación puede "seguir de largo" sin
 * manejar explícitamente el fallo.
 */

import type {
  ContextKind as RealContextKind,
  SupplyBinding as RealSupplyBinding,
  SupplySourceClass as RealSupplySourceClass,
} from "./tipos";

/** Resultado de una invariante que se cumplió. */
export type InvariantResult = { ok: true; violations: [] };

/**
 * Error tipado lanzado por cualquier `assert*` de este módulo cuando la
 * regla correspondiente se viola. `rule` identifica la invariante y
 * `violations` trae uno o más mensajes legibles, uno por cada problema
 * detectado (una llamada puede violar la misma regla de varias formas a la
 * vez, p. ej. varias instancias sin fuente en el mismo plan).
 */
export class SceneInvariantViolationError extends Error {
  readonly rule: string;
  readonly violations: string[];

  constructor(rule: string, violations: string[]) {
    super(`[scene-invariant:${rule}] ${violations.join("; ")}`);
    this.name = "SceneInvariantViolationError";
    this.rule = rule;
    this.violations = violations;
  }
}

function assertRule(rule: string, violations: string[]): InvariantResult {
  if (violations.length > 0) {
    throw new SceneInvariantViolationError(rule, violations);
  }
  return { ok: true, violations: [] };
}

// ---------------------------------------------------------------------------
// Tipos locales mínimos — SupplySourceClass, ContextKind y
// MinimalSupplyBinding ahora son alias de los contratos Zod reales de
// src/lib/scene/tipos.ts (Tarea 01.1, ya completada); ver nota arriba.
// ---------------------------------------------------------------------------

/** Alias de `SupplySourceClass` real (sección 7.3 del plan). */
export type SupplySourceClass = RealSupplySourceClass;

/**
 * Alias de `ContextKind` real: subconjunto de `context_kind` permitido para
 * `context_non_quotable` (sección 6.4): nunca sillas, mesas, flores
 * arregladas, lámparas decorativas, carteles ni centros de mesa.
 */
export type ContextKind = RealContextKind;

/** Alias de `SupplyBinding` real (sección 7.3 del plan). */
export type MinimalSupplyBinding = RealSupplyBinding;

/** Mapea el `kind` interno de `SupplyBinding` a `SupplySourceClass`. */
export function supplyBindingSourceClass(
  binding: MinimalSupplyBinding
): SupplySourceClass {
  switch (binding.kind) {
    case "sale":
      return "catalog_sale";
    case "rental":
      return "catalog_rental";
    case "venue_existing":
      return "venue_existing";
    case "context_non_quotable":
      return "context_non_quotable";
  }
}

/** Subconjunto mínimo de una instancia de `SceneSpecV2` (sección 7.5). */
export type MinimalSceneInstance = {
  scene_instance_id: string;
  /** Política de visibilidad (sección 10.2). */
  visibility: "visible" | "support_hidden" | "context_preserved";
  supply_binding: MinimalSupplyBinding | null;
};

/** Subconjunto mínimo de un estado comercial de línea (sección 6.2). */
export type MinimalQuoteLineStatus =
  | "PRICED"
  | "QUOTE_REQUIRED"
  | "VENUE_EXISTING"
  | "UNAVAILABLE";

export type MinimalQuoteLine = {
  line_id: string;
  status: MinimalQuoteLineStatus;
  /** Si esta línea corresponde a un slot obligatorio del programa. */
  required: boolean;
};

/**
 * Subconjunto mínimo del estado de aprobación de un `ResolvedScenePlanV2`.
 * `APPROVED`/`VERIFICADO` son equivalentes a efectos de esta invariante:
 * ambos representan "presupuesto verificado", en oposición a una
 * estimación (`DRAFT`/`PARTIAL`) que sí puede mostrarse sin bloquear.
 */
export type MinimalPlanApprovalStatus =
  | "DRAFT"
  | "PARTIAL"
  | "COMPLETE"
  | "BLOCKED"
  | "APPROVED"
  | "VERIFICADO";

export type MinimalScenePlan = {
  status: MinimalPlanApprovalStatus;
  /** Techo de presupuesto en COP, si el usuario lo declaró. */
  budget_ceiling_cop?: number;
  /** Total conocido (líneas `PRICED` + `VENUE_EXISTING` resueltas), en COP. */
  known_total_cop: number;
  lines: MinimalQuoteLine[];
};

/**
 * Subconjunto mínimo de `SceneCoverageReport` que distingue cobertura de
 * evento (qué zonas están planificadas) de cobertura de vista (qué zonas
 * son visibles en un encuadre concreto) — sección 3, "Decisión sobre
 * completo".
 */
export type MinimalCoverageReport = {
  event_coverage: Array<{ zone: string; planned: boolean }>;
  view_coverage: Array<{ view_id: string; zone: string; slot_id: string }>;
};

/**
 * Pasos mínimos y ordenables del pipeline (sección 4, "Arquitectura
 * objetivo"). Un `at` más alto es más tarde; no se asume una unidad de
 * tiempo concreta (puede ser un índice de secuencia o un timestamp).
 */
export type PipelineStepKind =
  | "intent_captured"
  | "program_generated"
  | "product_search"
  | "candidate_selected";

export type MinimalPipelineEvent = { step: PipelineStepKind; at: number };

/**
 * Subconjunto mínimo de un hash de resolución vigente/invalidado (sección
 * 7.5, "hashes mínimos", y sección 6.4, invalidación por cambio de oferta).
 */
export type MinimalHashSnapshot = {
  hash_id: string;
  status: "valid" | "invalid";
  /** `snapshot_id` de cada `CommercialOfferV1` usada en la selección. */
  offer_snapshot_ids: string[];
};

// ---------------------------------------------------------------------------
// 1. "Programa antes de productos"
// ---------------------------------------------------------------------------

/**
 * La intención se expande primero a un `SceneProgramV1` (zonas + funciones
 * + slots) mediante una receta versionada, y solo después se buscan
 * productos candidatos por slot. Nunca al revés.
 *
 * Verifica, sobre una traza de pasos de pipeline, que ningún
 * `product_search` ni `candidate_selected` ocurra antes de
 * `program_generated`.
 */
export function assertProgramBeforeProducts(
  events: MinimalPipelineEvent[]
): InvariantResult {
  const violations: string[] = [];
  const programEvents = events.filter((e) => e.step === "program_generated");
  const productEvents = events.filter(
    (e) => e.step === "product_search" || e.step === "candidate_selected"
  );

  if (productEvents.length > 0 && programEvents.length === 0) {
    violations.push(
      "se buscaron o seleccionaron productos sin que exista un evento program_generated"
    );
  }

  const earliestProgramAt = programEvents.length
    ? Math.min(...programEvents.map((e) => e.at))
    : undefined;

  for (const productEvent of productEvents) {
    if (
      earliestProgramAt !== undefined &&
      productEvent.at < earliestProgramAt
    ) {
      violations.push(
        `evento ${productEvent.step} en at=${productEvent.at} ocurrió antes de program_generated (at=${earliestProgramAt})`
      );
    }
  }

  return assertRule("program-before-products", violations);
}

// ---------------------------------------------------------------------------
// 2. "Sin fuente no se renderiza"
// ---------------------------------------------------------------------------

const ALLOWED_RENDER_SOURCE_CLASSES: readonly SupplySourceClass[] = [
  "catalog_sale",
  "catalog_rental",
  "venue_existing",
  "context_non_quotable",
];

/**
 * Todo objeto decorativo visible en una imagen generada debe tener un
 * `SupplyBinding` verificable (`catalog_sale`, `catalog_rental`,
 * `venue_existing` con evidencia, o `context_non_quotable` limitado a
 * fondo/arquitectura/vegetación natural genérica). Nunca se inventa
 * mobiliario, flores o luces para "completar" visualmente una escena.
 *
 * Se exige `supply_binding` no nulo, de una clase permitida, en toda
 * instancia que el generador vaya a recibir (`visible`, `support_hidden` o
 * `context_preserved` — sección 10.2); una instancia sin binding es, por
 * definición, una invención.
 */
export function assertNoRenderWithoutSource(
  instances: MinimalSceneInstance[]
): InvariantResult {
  const violations: string[] = [];

  for (const instance of instances) {
    if (instance.supply_binding === null) {
      violations.push(
        `instancia ${instance.scene_instance_id} (${instance.visibility}) no tiene supply_binding`
      );
      continue;
    }

    const sourceClass = supplyBindingSourceClass(instance.supply_binding);
    if (!ALLOWED_RENDER_SOURCE_CLASSES.includes(sourceClass)) {
      violations.push(
        `instancia ${instance.scene_instance_id} tiene una clase de fuente no permitida: ${sourceClass}`
      );
    }
  }

  return assertRule("no-render-without-source", violations);
}

// ---------------------------------------------------------------------------
// 3. "Evento y vista son niveles distintos"
// ---------------------------------------------------------------------------

/**
 * La cobertura del evento completo (qué zonas están planificadas) es
 * independiente de la cobertura de una vista específica (qué debe ser
 * visible en un encuadre). Una vista de ceremonia no intenta mostrar la
 * recepción.
 *
 * `viewZoneAllowlist` declara, por `view_id`, qué zonas puede reclamar esa
 * vista (p. ej. `ceremony_view -> ["ceremony_focal", "ceremony_aisle",
 * "guest_seating", ...]`). La invariante falla si:
 *   - `event_coverage`/`view_coverage` no son estructuras separadas (chequeo
 *     estructural mínimo, defensivo ante datos no tipados por Zod aún);
 *   - una entrada de `view_coverage` referencia una zona fuera del
 *     allowlist de su vista (la vista "se filtra" hacia otra zona);
 *   - una entrada de `view_coverage` referencia una zona que ni siquiera
 *     está planificada a nivel de evento.
 */
export function assertEventViewCoverageSeparation(
  coverageReport: MinimalCoverageReport,
  viewZoneAllowlist: Record<string, string[]>
): InvariantResult {
  const violations: string[] = [];

  if (
    !Array.isArray(coverageReport.event_coverage) ||
    !Array.isArray(coverageReport.view_coverage)
  ) {
    violations.push(
      "event_coverage y view_coverage deben ser estructuras separadas y ambas arreglos"
    );
    return assertRule("event-view-coverage-separation", violations);
  }

  const plannedZones = new Set(
    coverageReport.event_coverage
      .filter((entry) => entry.planned)
      .map((entry) => entry.zone)
  );

  for (const entry of coverageReport.view_coverage) {
    const allowlist = viewZoneAllowlist[entry.view_id];
    if (!allowlist) {
      violations.push(
        `vista ${entry.view_id} no tiene allowlist de zonas declarado`
      );
      continue;
    }
    if (!allowlist.includes(entry.zone)) {
      violations.push(
        `vista ${entry.view_id} reclama la zona ${entry.zone}, fuera de su alcance permitido (${allowlist.join(", ")})`
      );
    }
    if (!plannedZones.has(entry.zone)) {
      violations.push(
        `vista ${entry.view_id} reclama la zona ${entry.zone}, que no está planificada a nivel de evento`
      );
    }
  }

  return assertRule("event-view-coverage-separation", violations);
}

// ---------------------------------------------------------------------------
// 4. "Precio desconocido bloquea aprobación final" (+ hard gate 6.3)
// ---------------------------------------------------------------------------

const APPROVED_STATUSES: readonly MinimalPlanApprovalStatus[] = [
  "APPROVED",
  "VERIFICADO",
];

/**
 * Un plan con líneas `QUOTE_REQUIRED` puede mostrarse como estimación,
 * pero nunca puede aprobarse/generar como presupuesto verificado; el hard
 * gate de presupuesto (sección 6.3, invariantes 4 y 5) bloquea la
 * aprobación si el total conocido supera el techo o si faltan precios
 * obligatorios.
 */
export function assertBudgetGateBeforeApproval(
  plan: MinimalScenePlan
): InvariantResult {
  const violations: string[] = [];

  if (!APPROVED_STATUSES.includes(plan.status)) {
    // Una estimación (DRAFT/PARTIAL/COMPLETE/BLOCKED) puede mostrarse sin
    // pasar este gate; el gate solo aplica a estados de aprobación final.
    return assertRule("budget-gate-before-approval", violations);
  }

  const requiredQuoteRequired = plan.lines.filter(
    (line) => line.required && line.status === "QUOTE_REQUIRED"
  );
  if (requiredQuoteRequired.length > 0) {
    violations.push(
      `plan en estado ${plan.status} tiene ${requiredQuoteRequired.length} línea(s) obligatoria(s) QUOTE_REQUIRED: ${requiredQuoteRequired
        .map((l) => l.line_id)
        .join(", ")}`
    );
  }

  const requiredUnavailable = plan.lines.filter(
    (line) => line.required && line.status === "UNAVAILABLE"
  );
  if (requiredUnavailable.length > 0) {
    violations.push(
      `plan en estado ${plan.status} tiene ${requiredUnavailable.length} línea(s) obligatoria(s) UNAVAILABLE: ${requiredUnavailable
        .map((l) => l.line_id)
        .join(", ")}`
    );
  }

  if (
    plan.budget_ceiling_cop !== undefined &&
    plan.known_total_cop > plan.budget_ceiling_cop
  ) {
    violations.push(
      `plan en estado ${plan.status} tiene total conocido ${plan.known_total_cop} COP por encima del techo ${plan.budget_ceiling_cop} COP`
    );
  }

  return assertRule("budget-gate-before-approval", violations);
}

// ---------------------------------------------------------------------------
// 6.4 Invariantes anti-alucinación y revalidación
// ---------------------------------------------------------------------------

const ALLOWED_CONTEXT_KINDS: readonly ContextKind[] = [
  "wall",
  "floor",
  "sky",
  "terrain",
  "ambient_light",
  "natural_vegetation",
];

/**
 * `context_non_quotable` se limita a paredes, piso, cielo, terreno, luz
 * ambiental y vegetación natural; flores arregladas, sillas, mesas,
 * lámparas decorativas, carteles y centros nunca son contexto genérico.
 *
 * Chequeo defensivo en runtime: aunque `MinimalSupplyBinding` ya tipa
 * `context_kind` como unión cerrada, esta función valida datos que pueden
 * llegar sin pasar por ese tipo (p. ej. JSON de un LLM antes de validarse
 * con el Zod real de la Tarea 01.1).
 */
export function assertContextNonQuotableScope(
  binding: MinimalSupplyBinding
): InvariantResult {
  const violations: string[] = [];

  if (binding.kind === "context_non_quotable") {
    const kind = binding.context_kind as string;
    if (!ALLOWED_CONTEXT_KINDS.includes(kind as ContextKind)) {
      violations.push(
        `context_kind "${kind}" no está permitido para context_non_quotable (permitidos: ${ALLOWED_CONTEXT_KINDS.join(", ")})`
      );
    }
  }

  return assertRule("context-non-quotable-scope", violations);
}

/**
 * `venue_existing` requiere una referencia de evidencia (región de foto o
 * confirmación explícita).
 */
export function assertVenueExistingHasEvidence(
  binding: MinimalSupplyBinding
): InvariantResult {
  const violations: string[] = [];

  if (binding.kind === "venue_existing") {
    const evidence = binding.evidence_ref as unknown;
    if (
      typeof evidence !== "string" ||
      evidence.trim().length === 0
    ) {
      violations.push(
        "binding venue_existing no tiene evidence_ref (ni región de foto ni confirmación explícita)"
      );
    }
  }

  return assertRule("venue-existing-has-evidence", violations);
}

/**
 * Un cambio de oferta, precio, modalidad, disponibilidad o snapshot
 * invalida `selection_hash`, `quote_hash` y cualquier aprobación anterior.
 *
 * Compara los `offer_snapshot_ids` que un hash declaró como base
 * (`previousHashes[i].offer_snapshot_ids`) contra los snapshot_ids
 * vigentes ahora mismo para esas mismas ofertas
 * (`currentOfferSnapshotIds`). Si alguno cambió y el hash sigue marcado
 * `valid`, es una violación: el hash debería haberse invalidado.
 */
export function assertHashInvalidationOnOfferChange(
  previousHashes: MinimalHashSnapshot[],
  currentOfferSnapshotIds: string[]
): InvariantResult {
  const violations: string[] = [];
  const currentSet = new Set(currentOfferSnapshotIds);

  for (const hash of previousHashes) {
    const staleSnapshotIds = hash.offer_snapshot_ids.filter(
      (id) => !currentSet.has(id)
    );
    if (staleSnapshotIds.length > 0 && hash.status === "valid") {
      violations.push(
        `hash ${hash.hash_id} sigue "valid" pero ${staleSnapshotIds.length} snapshot(s) de oferta cambiaron: ${staleSnapshotIds.join(", ")}`
      );
    }
  }

  return assertRule("hash-invalidation-on-offer-change", violations);
}
