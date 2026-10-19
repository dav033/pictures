import type { RequestedView, SpatialConstraint, SupplySourceClass } from "../tipos";
import type { SceneRecipeDefinition, SceneRecipeSlotDefinition } from "./wedding-ceremony-garden.v1";

/**
 * Receta abierta compartida por eventos no clasificados. Geometry comes from
 * space/view/complexity; event label is carried as narrative metadata.
 */
function slotsFor(viewType: Extract<RequestedView, "ceremony" | "reception">, environment: "indoor" | "outdoor"): SceneRecipeSlotDefinition[] {
  const prefix = `${environment}_${viewType}`;
  const source: SupplySourceClass[] = ["catalog_sale", "catalog_rental"];
  const relation: SpatialConstraint = { relation: "behind", target_zone: `${viewType}_focal` };
  return [
    {
      slot_id: `${prefix}_focal_structure`, view_type: viewType, zone: `${viewType}_focal`,
      function: "focal_backdrop", requiredFromTier: 0, fixedRequirement: "required", weight: 5,
      min_instances: 1, max_instances: 1, allowed_sources: source, dependencies: [], spatial_constraints: [],
      dependencyNote: "foco dimensionado por espacio y vista",
    },
    {
      slot_id: `${prefix}_backdrop`, view_type: viewType, zone: `${viewType}_backdrop`,
      function: "focal_decor", requiredFromTier: 1, fixedRequirement: "optional", weight: 4,
      min_instances: 1, max_instances: 1, allowed_sources: source, dependencies: [`${prefix}_focal_structure`], spatial_constraints: [relation],
      dependencyNote: "fondo compatible con el espacio",
    },
    {
      slot_id: `${prefix}_side_accent`, view_type: viewType, zone: `${viewType}_sides`,
      function: "balloon_accent", requiredFromTier: 2, fixedRequirement: "optional", weight: 2,
      min_instances: 1, max_instances: 2, allowed_sources: source, dependencies: [`${prefix}_focal_structure`], spatial_constraints: [],
      dependencyNote: "acento solo si complejidad y presupuesto lo permiten",
    },
    {
      slot_id: `${prefix}_table_accent`, view_type: viewType, zone: `${viewType}_foreground`,
      function: "service_support", requiredFromTier: 3, fixedRequirement: "optional", weight: 1,
      min_instances: 1, max_instances: 2, allowed_sources: source, dependencies: [], spatial_constraints: [],
      dependencyNote: "servicio solo si cliente lo solicita y existe candidato real",
    },
  ];
}

function genericRecipe(id: string, label: string, environment: "indoor" | "outdoor"): SceneRecipeDefinition {
  return { id, version: 1, label, slots: [...slotsFor("ceremony", environment), ...slotsFor("reception", environment)] };
}

export const GENERIC_INDOOR_EVENT_V1 = genericRecipe(
  "generic_indoor_event",
  "Evento abierto — composición interior genérica",
  "indoor",
);

export const GENERIC_OUTDOOR_EVENT_V1 = genericRecipe(
  "generic_outdoor_event",
  "Evento abierto — composición exterior genérica",
  "outdoor",
);

export type GenericEventEnvironment = "indoor" | "outdoor";

export function genericRecipeForEnvironment(environment: GenericEventEnvironment): SceneRecipeDefinition {
  return environment === "outdoor" ? GENERIC_OUTDOOR_EVENT_V1 : GENERIC_INDOOR_EVENT_V1;
}
