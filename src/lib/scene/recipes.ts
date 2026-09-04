/**
 * Registro de recetas y expansión determinista de intención a programa
 * (Tarea 01.2 — `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, secciones 5.1 y
 * 9.1 (paso 2), "Plan 01, Tarea 01.2" en la sección 11).
 *
 * Este módulo tiene dos responsabilidades:
 *
 *   1. Codificar la tabla de perfiles de complejidad de la sección 5.1
 *      (`PROFILE_COVERAGE_CONDITIONS`) como datos/reglas consultables —no
 *      como texto de prompt— para que `src/lib/scene/coverage.ts` pueda
 *      determinar el `achieved_profile` de una cobertura real sin volver a
 *      parsear la tabla del plan.
 *   2. Registrar recetas versionadas (`SCENE_RECIPE_REGISTRY`) y exponer
 *      `expandIntentToProgram`, la función determinista que convierte una
 *      `EventIntentV2` + un `recipeId` en un `SceneProgramV1` completo
 *      (vistas + slots, con el `requirement` de cada slot ya ajustado al
 *      perfil solicitado).
 */

import { computeIntentHash } from "./hashes";
import {
  WEDDING_CEREMONY_GARDEN_V1,
  deriveSlotRequirement,
  type SceneRecipeDefinition,
} from "./recipes/wedding-ceremony-garden.v1";
import {
  GENERIC_INDOOR_EVENT_V1,
  GENERIC_OUTDOOR_EVENT_V1,
  genericRecipeForEnvironment,
} from "./recipes/generic-event.v1";
import {
  SceneProgramV1Schema,
  type ComplexityProfile,
  type EventIntentV2,
  type SceneProgramV1,
  type SceneSlot,
  type SceneView,
} from "./tipos";

// ---------------------------------------------------------------------------
// 5.1 — Perfiles de complejidad, codificados como datos consultables.
// ---------------------------------------------------------------------------

/** Orden ascendente de perfiles (sección 5.1); el índice es el "tier" usado por toda la receta. */
export const COMPLEXITY_PROFILE_ORDER: readonly ComplexityProfile[] = [
  "focal_only",
  "balanced_scene",
  "immersive_scene",
  "full_event",
];

export function complexityProfileTier(profile: ComplexityProfile): number {
  const tier = COMPLEXITY_PROFILE_ORDER.indexOf(profile);
  if (tier === -1) {
    throw new Error(`Perfil de complejidad desconocido: ${profile}`);
  }
  return tier;
}

/**
 * Condición mínima de una vista de ceremonia completa para un perfil dado
 * (tabla de la sección 5.1). `coverage.ts` la usa exclusivamente para
 * DEGRADAR el `achieved_profile` por debajo del perfil solicitado cuando
 * faltan slots obligatorios — nunca para decidir si el perfil SOLICITADO en
 * sí se alcanzó (eso lo decide directamente `required_gaps`, que ya refleja
 * el `requirement` de cada slot tal como quedó instanciado para ese
 * perfil). Es zonal/de familias (no de cantidad de SKU) a propósito: la
 * verdad observable #1 del plan (sección 1) exige medir complejidad por
 * cobertura de funciones/zonas, nunca por cantidad de artículos.
 */
export type ProfileCoverageCondition = {
  profile: ComplexityProfile;
  /** Número mínimo de zonas distintas con al menos un slot cubierto. */
  minVisibleZones: number;
  /** Zonas que deben tener cobertura sin importar cuántas más haya cubiertas. */
  requiredZones: readonly string[];
  /** Familias semánticas distintas mínimas (nunca cantidad de candidatos/SKU). */
  minDistinctFamilies: number;
  description: string;
};

export const PROFILE_COVERAGE_CONDITIONS: Record<ComplexityProfile, ProfileCoverageCondition> = {
  focal_only: {
    profile: "focal_only",
    minVisibleZones: 1,
    requiredZones: ["ceremony_focal"],
    minDistinctFamilies: 1,
    description: "1 zona, focal cubierto (petición explícita de una sola instalación).",
  },
  balanced_scene: {
    profile: "balanced_scene",
    minVisibleZones: 3,
    requiredZones: ["ceremony_focal", "ceremony_aisle", "guest_seating"],
    minDistinctFamilies: 4,
    description: "focal + pasillo + contexto/asientos; al menos 4 familias semánticas distintas.",
  },
  immersive_scene: {
    profile: "immersive_scene",
    minVisibleZones: 4,
    requiredZones: ["ceremony_focal", "ceremony_aisle", "guest_seating"],
    minDistinctFamilies: 6,
    description: "al menos 4 zonas visibles y 6 familias, con primer plano/medio/fondo.",
  },
  full_event: {
    profile: "full_event",
    // La receta `wedding_ceremony_garden@1` (Tarea 01.2) solo modela la
    // vista de ceremonia; la vista de recepción es una receta futura. Por
    // eso esta condición se limita a lo que la vista de ceremonia puede
    // aportar — full_event nunca se declara alcanzado por esta receta sola
    // (haría falta una segunda vista con sus propios slots núcleo).
    minVisibleZones: 3,
    requiredZones: ["ceremony_focal", "ceremony_aisle", "guest_seating"],
    minDistinctFamilies: 4,
    description:
      "varias vistas; slots núcleo de cada vista cubiertos. Esta receta (Tarea 01.2) solo modela la vista de " +
      "ceremonia, así que full_event no puede declararse alcanzado plenamente con ella sola.",
  },
};

// ---------------------------------------------------------------------------
// Registro de recetas — recipeId compuesto "id@version" -> definición.
// ---------------------------------------------------------------------------

const SCENE_RECIPE_REGISTRY: Record<string, SceneRecipeDefinition> = {
  [`${WEDDING_CEREMONY_GARDEN_V1.id}@${WEDDING_CEREMONY_GARDEN_V1.version}`]: WEDDING_CEREMONY_GARDEN_V1,
  [`${GENERIC_INDOOR_EVENT_V1.id}@${GENERIC_INDOOR_EVENT_V1.version}`]: GENERIC_INDOOR_EVENT_V1,
  [`${GENERIC_OUTDOOR_EVENT_V1.id}@${GENERIC_OUTDOOR_EVENT_V1.version}`]: GENERIC_OUTDOOR_EVENT_V1,
};

/** Selects recipe from space, while preserving wedding recipe only for weddings. */
export function selectSceneRecipeId(intent: EventIntentV2): string {
  if (intent.event_family === "wedding" || (intent.event_family === undefined && intent.event_type === "wedding")) {
    return `${WEDDING_CEREMONY_GARDEN_V1.id}@${WEDDING_CEREMONY_GARDEN_V1.version}`;
  }
  const environment = intent.venue.environment ?? "indoor";
  const recipe = genericRecipeForEnvironment(environment);
  return `${recipe.id}@${recipe.version}`;
}

export function findSceneRecipe(recipeId: string): SceneRecipeDefinition {
  const recipe = SCENE_RECIPE_REGISTRY[recipeId];
  if (!recipe) {
    throw new Error(
      `Receta de escena desconocida: "${recipeId}". Registradas: ${Object.keys(SCENE_RECIPE_REGISTRY).join(", ")}`
    );
  }
  return recipe;
}

export function listRegisteredSceneRecipeIds(): string[] {
  return Object.keys(SCENE_RECIPE_REGISTRY);
}

// ---------------------------------------------------------------------------
// Expansión determinista intención -> programa (sección 9.1, paso 2).
// ---------------------------------------------------------------------------

/**
 * Expande una `EventIntentV2` contra una receta registrada en un
 * `SceneProgramV1` completo. Determinista: mismo `intent` + mismo
 * `recipeId` produce siempre el mismo programa (mismos `slot_id`, mismo
 * orden, sin `Date.now()`/`Math.random()` ni ningún otro estado externo).
 *
 * Solo se generan `SceneView` para los `view_type` que la receta define Y
 * que la intención solicitó (`intent.requested_views`). Un
 * `requested_view` sin slots en esta receta (p. ej. `"reception"` contra
 * `wedding_ceremony_garden@1`, que solo modela `"ceremony"`) se omite en
 * vez de producir una `SceneView` vacía —`SceneViewSchema` exige
 * `zones.min(1)`, y una vista sin zonas no podría cubrir ningún slot de
 * todas formas (ver decisión de diseño de `SceneView` en `tipos.ts`).
 */
export function expandIntentToProgram(intent: EventIntentV2, recipeId: string): SceneProgramV1 {
  const recipe = findSceneRecipe(recipeId);
  const profileTier = complexityProfileTier(intent.complexity_requested);

  const recipeViewTypes = Array.from(new Set(recipe.slots.map((slot) => slot.view_type)));
  const activeViewTypes = recipeViewTypes.filter((viewType) => intent.requested_views.includes(viewType));

  const views: SceneView[] = activeViewTypes.map((viewType) => {
    const zones = Array.from(
      new Set(recipe.slots.filter((slot) => slot.view_type === viewType).map((slot) => slot.zone))
    );
    return { view_id: `${viewType}_view`, view_type: viewType, zones };
  });

  const viewIdByType = new Map(views.map((view) => [view.view_type, view.view_id]));

  // Orden estable: se conserva el orden de declaración de la receta
  // (`recipe.slots`), no el de `Object.keys`/`Set`, para que el mismo
  // intent+receta produzca siempre el mismo arreglo `slots` en el mismo
  // orden (determinismo exigido por la Tarea 01.2).
  const slots: SceneSlot[] = recipe.slots
    .filter((def) => viewIdByType.has(def.view_type))
    .map((def) => ({
      slot_id: def.slot_id,
      view_id: viewIdByType.get(def.view_type)!,
      zone: def.zone,
      function: def.function,
      requirement: deriveSlotRequirement(def, profileTier),
      weight: def.weight,
      min_instances: def.min_instances,
      max_instances: def.max_instances,
      allowed_sources: def.allowed_sources,
      dependencies: def.dependencies,
      spatial_constraints: def.spatial_constraints,
    }));

  const program: SceneProgramV1 = {
    schema_version: "scene-program-v1",
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    intent_hash: computeIntentHash(intent),
    event_label: intent.event_label,
    event_family: intent.event_family,
    original_request: intent.original_request,
    recipe_label: recipe.label,
    composition_basis: {
      space: intent.space,
      requested_views: intent.requested_views,
      complexity: intent.complexity_requested,
      budget_cop: intent.budget_cop,
      requested_structures: intent.requested_structures ?? [],
      guest_count: intent.guest_count,
    },
    views,
    slots,
  };

  // Corrección estructural + determinismo: cualquier violación de las
  // reglas de `SceneProgramV1Schema` (IDs de slot duplicados, `view_id`
  // inexistente, `dependencies` colgantes, ...) debe fallar aquí mismo, no
  // en un consumidor río abajo que reciba un programa mal formado.
  return SceneProgramV1Schema.parse(program);
}
