/**
 * Planificador de consultas por slot (Tarea 04.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 9.2 / "Plan 04, Tarea
 * 04.1" en la sección 11).
 *
 * `planSlotQueries` convierte un `SceneProgramV1` YA EXPANDIDO
 * (`src/lib/scene/recipes.ts#expandIntentToProgram`) en una `SlotQuery` POR
 * SLOT — esto es lo que reemplaza, en el flujo real, a la consulta plana
 * única del parser V2 clásico (sección 2.3 del plan: "el parser actual
 * genera una consulta plana por categoría, ocasión, color, forma, tamaño y
 * precio"). Cada `SceneSlot` (foco, pasillo, asientos, acentos, ...) recibe
 * su propia consulta con su propia función/zona/fuentes/preferencias — no
 * una lista compartida.
 *
 * DESVIACIÓN DELIBERADA de la firma "tipo" de la Tarea 04.1
 * (`planSlotQueries(program: SceneProgramV1): SlotQuery[]`) — SEGUNDO
 * PARÁMETRO `intent: EventIntentV2`:
 * La sección 9.2 exige que cada consulta lleve ambiente interior/exterior,
 * paleta, estilo y presupuesto provisional — todos campos de `EventIntentV2`
 * (sección 7.1). `SceneProgramV1` (sección 7.2) NO persiste esos campos: solo
 * guarda un `intent_hash` opaco (huella, no la intención completa) — ver la
 * misma decisión ya tomada y documentada en `src/lib/scene/coverage.ts`
 * (`computeCoverageReport`, tercer parámetro `requestedProfile`, por la razón
 * exacta que ahí se explica). Aquí se repite el mismo patrón por la misma
 * razón: quien ya llamó a `expandIntentToProgram(intent, recipeId)` para
 * obtener el `program` tiene la `intent` completa a mano, así que pedirla
 * explícitamente es más honesto que inventarle un campo nuevo a
 * `SceneProgramV1` que rompería la superficie ya validada por la Tarea 01.1.
 *
 * Campos de la sección 9.2 que quedan deliberadamente VACÍOS en esta tarea
 * (documentado campo por campo más abajo, no un olvido):
 *   - `dimension_range`: `SceneSlot`/`SpatialConstraint` (Tarea 01.1) son
 *     puramente relacionales — ninguno lleva una cota numérica de tamaño
 *     hoy. No hay de dónde derivar un rango real sin inventarlo.
 *   - `mounting_constraints`: viene de `CatalogItemV3.compatibility.mounting`
 *     de un CANDIDATO concreto (sección 7.3) — los candidatos son de la
 *     Tarea 04.2, que corre después de esta.
 *   - `diversity.excluded_item_ids` / `diversity.covered_families`: el plan
 *     los describe EXPLÍCITAMENTE como "vacíos en este punto, se llenan en
 *     la Tarea 04.2 iterativamente" (instrucciones de la Tarea 04.1).
 */

import type { EventIntentV2, SceneProgramV1, SceneSlot, SupplySourceClass } from "@/lib/scene/tipos";

// ---------------------------------------------------------------------------
// SlotQuery — sección 9.2, campo por campo.
// ---------------------------------------------------------------------------

/**
 * Rango de dimensiones físicas aceptables para un candidato de este slot.
 * Ningún campo se llena todavía — ver nota de cabecera ("dimension_range").
 * El tipo existe para que la Tarea 04.2/05 lo complete sin cambiar la forma
 * de `SlotQuery`.
 */
export type SlotDimensionRangeHint = {
  min_width_cm?: number;
  max_width_cm?: number;
  min_height_cm?: number;
  max_height_cm?: number;
  min_depth_cm?: number;
  max_depth_cm?: number;
};

export type SlotStylePreferences = {
  /** `EventIntentV2.palette` (sección 7.1) — PREFERENCIA blanda, nunca sustituye elegibilidad (sección 9.2). */
  palette: string[];
  /** `EventIntentV2.style_terms` (sección 7.1) — misma regla: nunca es filtro duro por sí solo. */
  style_terms: string[];
};

/**
 * Señal de ocasión para RANKING (sección 9.2: "ocasión como señal de ranking
 * para activos genéricos"). `hard_filter` queda fijo en `false` en esta
 * capa: la única forma en que la ocasión se vuelve filtro duro es que un
 * artículo concreto lleve texto/tema impreso incompatible — una propiedad
 * del CANDIDATO (Tarea 04.2), no del slot. Este campo documenta la regla
 * para que la Tarea 04.2 no la reinvente ni la contradiga.
 */
export type SlotOccasionSignal = {
  occasion: "boda";
  hard_filter: false;
  note: string;
};

export type SlotDiversityState = {
  /** IDs de `CatalogItemV3.item_id` a excluir de este slot (paquetes compartidos ya usados en otro slot, etc.). Vacío en esta tarea. */
  excluded_item_ids: string[];
  /** `category_v3` (o `SceneFunctionV3`) ya cubiertas por otros slots del mismo programa, para favorecer variedad. Vacío en esta tarea. */
  covered_families: string[];
};

export type SlotQuery = {
  slot_id: string;
  view_id: string;
  /** Función de escena del slot (sección 5.3 / `SceneSlot.function`). */
  function: string;
  /** Zona del evento del slot (sección 5.2 / `SceneSlot.zone`). */
  zone: string;
  requirement: SceneSlot["requirement"];
  /** Compra/alquiler/existente permitidos para este slot (`SceneSlot.allowed_sources`, sección 6.1). */
  allowed_sources: SupplySourceClass[];
  dimension_range?: SlotDimensionRangeHint;
  /** `EventIntentV2.venue.environment` (sección 7.1) — `undefined` cuando el cliente no lo especificó (nunca se adivina). */
  environment?: "indoor" | "outdoor";
  mounting_constraints?: string[];
  style_preferences: SlotStylePreferences;
  occasion_signal: SlotOccasionSignal;
  /**
   * Reparto proporcional por `weight` sobre `EventIntentV2.budget_cop` total
   * (fórmula documentada en `computeProvisionalSlotBudget`). `undefined`
   * cuando el cliente no dio presupuesto o cuando el programa no tiene peso
   * total positivo — nunca se inventa un monto.
   */
  provisional_budget_cop?: number;
  diversity: SlotDiversityState;
};

// ---------------------------------------------------------------------------
// Presupuesto provisional por slot — fórmula documentada (sección 9.2).
// ---------------------------------------------------------------------------

/**
 * `slot_budget_cop = round(budget_cop * slot.weight / totalWeight)`, donde
 * `totalWeight` es la suma de `weight` de TODOS los slots del programa
 * (todas las zonas/requirements, no solo los obligatorios) — el presupuesto
 * total del evento se reparte sobre el programa completo tal como fue
 * expandido para el perfil solicitado, porque un slot opcional/condicional
 * que SÍ quedó en el programa igual compite por presupuesto si se decide
 * cubrirlo (la decisión de cubrirlo o no es del optimizador, Plan 05 —
 * aquí solo se calcula el reparto provisional, no una asignación final).
 *
 * Devuelve `undefined` cuando `budget_cop` no está definido o cuando
 * `totalWeight` es 0 (todos los slots con peso 0 — caso degenerado; dividir
 * entre cero produciría `NaN`/`Infinity`, nunca un monto inventado).
 */
export function computeProvisionalSlotBudget(
  slot: SceneSlot,
  totalWeight: number,
  budgetCop: number | undefined,
): number | undefined {
  if (budgetCop === undefined || totalWeight <= 0) return undefined;
  return Math.round((budgetCop * slot.weight) / totalWeight);
}

// ---------------------------------------------------------------------------
// Consulta por slot
// ---------------------------------------------------------------------------

function buildSlotQuery(slot: SceneSlot, totalWeight: number, intent: EventIntentV2): SlotQuery {
  return {
    slot_id: slot.slot_id,
    view_id: slot.view_id,
    function: slot.function,
    zone: slot.zone,
    requirement: slot.requirement,
    allowed_sources: slot.allowed_sources,
    dimension_range: undefined,
    environment: intent.venue.environment,
    mounting_constraints: undefined,
    style_preferences: {
      palette: intent.palette,
      style_terms: intent.style_terms,
    },
    occasion_signal: {
      occasion: "boda",
      hard_filter: false,
      note:
        "Señal de ranking, no filtro. Solo se vuelve filtro duro en la Tarea 04.2 si un candidato concreto lleva " +
        "texto/tema impreso incompatible con una boda (sección 9.2).",
    },
    provisional_budget_cop: computeProvisionalSlotBudget(slot, totalWeight, intent.budget_cop),
    diversity: { excluded_item_ids: [], covered_families: [] },
  };
}

/**
 * Construye una `SlotQuery` por cada `SceneSlot` del programa —
 * diferenciada por función/zona/fuentes/presupuesto, nunca una consulta
 * plana compartida (verdad observable que debe demostrar la Tarea 04.1: "una
 * boda en jardín produce consultas diferenciadas para focal, pasillo,
 * asientos y acentos"). Determinista: mismo `program` + misma `intent`
 * producen siempre el mismo arreglo, en el mismo orden que `program.slots`.
 *
 * NO aplica el límite de "máximo ocho slots recuperables por vista" ni
 * paraleliza/cachea consultas (sección 9.3, "Rendimiento") — eso pertenece a
 * la ejecución real de la búsqueda (Tarea 04.2), no a la construcción de la
 * consulta en sí.
 */
export function planSlotQueries(program: SceneProgramV1, intent: EventIntentV2): SlotQuery[] {
  const totalWeight = program.slots.reduce((sum, slot) => sum + slot.weight, 0);
  return program.slots.map((slot) => buildSlotQuery(slot, totalWeight, intent));
}
