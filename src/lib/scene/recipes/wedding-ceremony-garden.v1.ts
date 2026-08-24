/**
 * Receta inicial `wedding_ceremony_garden@1` (Tarea 01.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 5.4 / "Plan 01,
 * Tarea 01.2" en la sección 11).
 *
 * Implementa la tabla de la sección 5.4: 8 slots para la vista de ceremonia
 * (`ceremony`), cada uno con su zona (sección 5.2), función (sección 5.3),
 * si puede cubrirse con un elemento existente del lugar
 * (`allowed_sources` incluye `venue_existing` cuando la tabla dice "sí"), y
 * dependencias.
 *
 * DECISIÓN DE DISEÑO — prioridad dependiente de perfil (`requiredFromTier`):
 * La columna "Prioridad" de la tabla mezcla formas distintas de expresar
 * obligatoriedad, y la Tarea 01.2 exige explícitamente NO dejarla fija:
 *
 *   - "obligatoria" (estructura/superficie focal, sin sufijo de perfil): la
 *     sección 5.1 describe `focal_only` como "1 zona, focal cubierto"
 *     — la petición explícita de una sola instalación (E2E-3, sección 12:
 *     "solo quiero un arco... nada más") — así que la ÚNICA pieza
 *     verdaderamente obligatoria en `focal_only` es la estructura/superficie
 *     en sí (`requiredFromTier: 0`).
 *   - "decoración focal" también dice "obligatoria" sin sufijo en la tabla,
 *     pero por la misma razón de arriba (un arco aislado, sin decoración
 *     adicional, es un `focal_only` VÁLIDO y completo — E2E-3) su
 *     obligatoriedad real empieza cuando el perfil ya deja de ser "una sola
 *     instalación", es decir desde `balanced_scene` (`requiredFromTier: 1`).
 *     Estructura y decoración juntas SÍ son las dos piezas obligatorias de
 *     "focal cubierto" para `balanced_scene` en adelante.
 *   - "obligatoria en balanced+"/"obligatoria en immersive+" (pasillo,
 *     asientos, acento botánico): se traduce directo a
 *     `requiredFromTier: 1` / `requiredFromTier: 2`.
 *   - "condicional" (iluminación ambiental): NUNCA depende del perfil
 *     solicitado — depende de una condición externa (horario y soporte
 *     compatibles, ver la propia tabla) que esta tarea no resuelve (eso es
 *     RAG/optimizador, Plan 04/05). Aquí queda fija en `"conditional"` para
 *     todos los perfiles (`requiredFromTier: null`).
 *   - "opcional" (bienvenida/señalización, acento de primer plano): nunca se
 *     vuelve `required` por perfil (`requiredFromTier: null`,
 *     `fixedRequirement: "optional"`).
 *
 * `deriveSlotRequirement(def, profileTier)` es la función que aplica esta
 * regla: si `requiredFromTier` es `null`, siempre usa `fixedRequirement`; si
 * no, es `"required"` desde ese tier en adelante y `fixedRequirement` (el
 * valor de "reposo") por debajo.
 *
 * Las columnas "Dependencias" que NO nombran otro slot de la tabla (p. ej.
 * "circulación libre", "exterior/interior compatible", "horario y soporte
 * compatibles", "texto no se fuerza en vista lejana", "no bloquear
 * circulación") se documentan en `dependencyNote` y, cuando el vocabulario
 * espacial de la sección 10.1 lo permite, también como `spatial_constraints`
 * — pero NO se modelan como `dependencies: string[]` porque `dependencies`
 * apunta a `slot_id` de otros slots (regla exigida por la Tarea 01.2), y
 * estas notas no nombran ningún otro slot concreto. La única dependencia que
 * sí nombra otro slot explícitamente es "decoración focal" -> "estructura/
 * superficie compatible", y de forma razonable "asientos visibles" ->
 * "alineación con pasillo" (nombra la delimitación de pasillo).
 */

import type {
  RequestedView,
  SlotRequirement,
  SpatialConstraint,
  SupplySourceClass,
} from "../tipos";

export type SceneRecipeSlotDefinition = {
  slot_id: string;
  /** Vista a la que pertenece este slot (sección 7.2, `SceneView.view_type`). */
  view_type: RequestedView;
  zone: string;
  function: string;
  /**
   * Tier mínimo (índice en `COMPLEXITY_PROFILE_ORDER` de `../recipes.ts`:
   * 0=focal_only, 1=balanced_scene, 2=immersive_scene, 3=full_event) desde
   * el cual este slot es `"required"`. `null` = nunca depende del perfil
   * solicitado (usa siempre `fixedRequirement`).
   */
  requiredFromTier: number | null;
  /**
   * Requirement usado cuando `requiredFromTier` es `null`, o cuando el
   * perfil solicitado todavía no alcanza `requiredFromTier`.
   */
  fixedRequirement: SlotRequirement;
  weight: number;
  min_instances: number;
  max_instances: number;
  allowed_sources: SupplySourceClass[];
  dependencies: string[];
  spatial_constraints: SpatialConstraint[];
  /** Documentación legible de la columna "Dependencias" de la tabla 5.4, incluso cuando no mapea a un slot_id concreto. */
  dependencyNote: string;
};

export type SceneRecipeDefinition = {
  id: string;
  version: number;
  label: string;
  slots: SceneRecipeSlotDefinition[];
};

/** Deriva el `SceneSlot.requirement` final para un slot base de la receta dado un perfil (por su tier). */
export function deriveSlotRequirement(
  def: SceneRecipeSlotDefinition,
  profileTier: number
): SlotRequirement {
  if (def.requiredFromTier === null) {
    return def.fixedRequirement;
  }
  return profileTier >= def.requiredFromTier ? "required" : def.fixedRequirement;
}

export const WEDDING_CEREMONY_GARDEN_V1: SceneRecipeDefinition = {
  id: "wedding_ceremony_garden",
  version: 1,
  label: "Boda — ceremonia de jardín (receta inicial, sección 5.4 del plan)",
  slots: [
    // -------------------------------------------------------------------
    // Fila 1 — estructura o superficie focal (ceremony_focal)
    // -------------------------------------------------------------------
    {
      slot_id: "focal_structure_surface",
      view_type: "ceremony",
      zone: "ceremony_focal",
      function: "altar_frame",
      requiredFromTier: 0, // obligatoria en TODOS los perfiles, incluido focal_only
      fixedRequirement: "required",
      weight: 5,
      min_instances: 1,
      max_instances: 1,
      allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"], // "sí" en la tabla
      dependencies: [],
      spatial_constraints: [],
      dependencyNote: "ninguna",
    },
    // -------------------------------------------------------------------
    // Fila 2 — decoración focal (ceremony_focal)
    // -------------------------------------------------------------------
    {
      slot_id: "focal_decor",
      view_type: "ceremony",
      zone: "ceremony_focal",
      function: "focal_decor",
      requiredFromTier: 1, // obligatoria desde balanced_scene (ver nota de cabecera)
      fixedRequirement: "optional",
      weight: 4,
      min_instances: 1,
      max_instances: 6,
      allowed_sources: ["catalog_sale", "catalog_rental"], // "no" en la tabla: nunca venue_existing
      dependencies: ["focal_structure_surface"],
      spatial_constraints: [
        { relation: "attached_to", target_slot_id: "focal_structure_surface" },
      ],
      dependencyNote: "estructura/superficie compatible",
    },
    // -------------------------------------------------------------------
    // Fila 3 — delimitación de pasillo (ceremony_aisle)
    // -------------------------------------------------------------------
    {
      slot_id: "aisle_delimitation",
      view_type: "ceremony",
      zone: "ceremony_aisle",
      function: "aisle_runner",
      requiredFromTier: 1, // "obligatoria en balanced+"
      fixedRequirement: "optional",
      weight: 3,
      min_instances: 1,
      max_instances: 2,
      allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"], // "sí"
      dependencies: [],
      spatial_constraints: [
        {
          relation: "clearance_from",
          target_zone: "guest_seating",
          note: "circulación libre entre el pasillo y los asientos",
        },
      ],
      dependencyNote: "circulación libre",
    },
    // -------------------------------------------------------------------
    // Fila 4 — asientos visibles (guest_seating)
    // -------------------------------------------------------------------
    {
      slot_id: "guest_seating_visible",
      view_type: "ceremony",
      zone: "guest_seating",
      function: "guest_chair",
      requiredFromTier: 1, // "obligatoria en balanced+"
      fixedRequirement: "optional",
      weight: 3,
      min_instances: 2,
      max_instances: 200,
      allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"], // "sí"
      dependencies: ["aisle_delimitation"],
      spatial_constraints: [
        { relation: "aligned_with", target_slot_id: "aisle_delimitation" },
      ],
      dependencyNote: "alineación con pasillo",
    },
    // -------------------------------------------------------------------
    // Fila 5 — acento botánico o equivalente (focal/pasillo)
    // -------------------------------------------------------------------
    {
      slot_id: "botanical_accent",
      view_type: "ceremony",
      zone: "ceremony_focal", // "focal/pasillo" en la tabla: se ancla al foco por defecto
      function: "floral_foliage_accent",
      requiredFromTier: 2, // "obligatoria en immersive+"
      fixedRequirement: "optional",
      weight: 2,
      min_instances: 1,
      max_instances: 20,
      allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"], // "sí"
      dependencies: [],
      spatial_constraints: [],
      dependencyNote: "exterior/interior compatible",
    },
    // -------------------------------------------------------------------
    // Fila 6 — iluminación ambiental (ambient_overhead)
    // -------------------------------------------------------------------
    {
      slot_id: "ambient_lighting",
      view_type: "ceremony",
      zone: "ambient_overhead",
      function: "ambient_light",
      requiredFromTier: null, // "condicional": nunca depende del perfil solicitado
      fixedRequirement: "conditional",
      weight: 2,
      min_instances: 0,
      max_instances: 10,
      allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"], // "sí"
      dependencies: ["focal_structure_surface"],
      spatial_constraints: [
        { relation: "overhead_of", target_zone: "ceremony_focal" },
        { relation: "supported_by", target_slot_id: "focal_structure_surface" },
      ],
      dependencyNote: "horario y soporte compatibles",
    },
    // -------------------------------------------------------------------
    // Fila 7 — bienvenida/señalización (entrance_welcome)
    // -------------------------------------------------------------------
    {
      slot_id: "welcome_signage",
      view_type: "ceremony",
      zone: "entrance_welcome",
      function: "welcome_signage",
      requiredFromTier: null, // "opcional": nunca depende del perfil solicitado
      fixedRequirement: "optional",
      weight: 1,
      min_instances: 0,
      max_instances: 3,
      allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"], // "sí"
      dependencies: [],
      spatial_constraints: [],
      dependencyNote: "texto no se fuerza en vista lejana",
    },
    // -------------------------------------------------------------------
    // Fila 8 — acento de primer plano (floor_foreground)
    // -------------------------------------------------------------------
    {
      slot_id: "foreground_accent",
      view_type: "ceremony",
      zone: "floor_foreground",
      function: "balloon_accent",
      requiredFromTier: null, // "opcional": nunca depende del perfil solicitado
      fixedRequirement: "optional",
      weight: 1,
      min_instances: 0,
      max_instances: 10,
      allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"], // "sí"
      dependencies: [],
      spatial_constraints: [
        {
          relation: "clearance_from",
          target_zone: "ceremony_aisle",
          note: "no bloquear circulación",
        },
      ],
      dependencyNote: "no bloquear circulación",
    },
  ],
};
