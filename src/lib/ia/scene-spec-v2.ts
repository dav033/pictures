/**
 * SceneSpec V2 — especificación de imagen para escenas V2 (Tarea 07.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 10).
 *
 * A diferencia del SceneSpec V1 que colapsa categorías a `balloon_structure`,
 * el V2 preserva:
 *   - identidad de slot (qué función/zona cubre cada elemento visible)
 *   - procedencia de fuente (compra/alquiler/existente/contexto)
 *   - relaciones espaciales entre elementos (grafo de la sección 10.1)
 *   - visibilidad diferenciada (visible / support_hidden / context_preserved)
 *   - políticas de conteo (exact / approximate / representative)
 *
 * El generador solo recibe instancias `visible`, `support_hidden` o
 * `context_preserved`. Los soportes ocultos pueden ser necesarios para
 * geometría pero no se promocionan como decoración.
 */

import { z } from "zod";
import type { ResolvedScenePlan, ResolvedItemLine } from "@/lib/scene/resolver";
import type { SpatialConstraint } from "@/lib/scene/tipos";
import { zoneLayout, seatingBBox, visibilityPolicy, type BBox, type SpatialLayoutInstruction, type VisibilityPolicy } from "./scene-layout";

// ---------------------------------------------------------------------------
// Tipos Zod
// ---------------------------------------------------------------------------

export const CountPolicySchema = z.enum(["exact", "approximate", "representative"]);
export type CountPolicy = z.infer<typeof CountPolicySchema>;

export const SceneItemV2Schema = z.object({
  /** slot_id del programa de escena que este ítem cubre. */
  slot_id: z.string().min(1),
  /** item_id del catálogo (verificable, no inventado). */
  item_id: z.string().min(1),
  /** Nombre descriptivo para el generador (sin IDs internos). */
  visual_name: z.string().min(1),
  /** Categoría V3 del ítem (balloon_structure, altar_frame, floral_foliage, etc.). */
  category_v3: z.string().min(1),
  /** Clase de fuente resuelta. */
  source_class: z.enum(["purchase", "rental", "venue_existing", "context_non_quotable"]),
  /** Política de visibilidad (sección 10.2). */
  visibility: z.enum(["visible", "support_hidden", "context_preserved"]),
  /** Cuántas instancias de este ítem aparecen en la escena. */
  instance_count: z.number().int().nonnegative(),
  /** Política de conteo para el generador. */
  count_policy: CountPolicySchema,
  /** Colores resueltos (hasta 8). */
  resolved_colors: z.array(z.string().min(1)).max(8).default([]),
  /** Restricciones de identidad visual (material, forma, acabado). */
  identity_constraints: z.array(z.string().min(1)).max(8).default([]),
  /** Caja de composición en coordenadas normalizadas [0,1]. */
  bbox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }),
  /** Capa de profundidad (1 = fondo, 20 = primer plano). */
  depth_layer: z.number().int().min(0).max(30),
  /** Relaciones espaciales con otros ítems (grafo sección 10.1). */
  relationships: z.array(z.object({
    type: z.enum(["attached_to", "supported_by", "aligned_with", "mirrored_with", "repeated_along", "in_front_of", "behind", "overhead_of", "clearance_from"]),
    target_slot_id: z.string().min(1).optional(),
    target_zone: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  })).max(12).default([]),
  /** Función que cubre este ítem (altar_frame, focal_decor, aisle_runner, etc.). */
  function: z.string().min(1),
  /** Zona del evento donde se ubica. */
  zone: z.string().min(1),
  /** Catalog evidence; absent means no thematic verdict was supplied. */
  match_level: z.enum(["exacto", "adaptable", "fuera_de_catalogo", "exact_event", "thematic"]).optional(),
});

export type SceneItemV2 = z.infer<typeof SceneItemV2Schema>;

export const SceneSpecV2Schema = z.object({
  schema_version: z.literal("scene-spec-v2"),
  /** Hash del plan de escena del que deriva este spec. */
  scene_plan_hash: z.string().min(1),
  /** Vista que este spec representa (ceremony, reception, etc.). */
  view_id: z.string().min(1),
  /** Aspect ratio del canvas. */
  aspect_ratio: z.enum(["3:2", "1:1", "2:3", "16:9"]),
  /** Ítems visibles en esta vista. */
  items: z.array(SceneItemV2Schema).max(30),
  /** Instrucciones de composición para el generador. */
  composition_notes: z.array(z.string().min(1)).max(10).default([]),
  /** Proteger regiones del lugar (foto existente). */
  preserve_venue: z.array(z.string().min(1)).max(30).default([]),
  /** Política de texto en señalización (sección 10.4). */
  text_policy: z.enum(["blank_surface", "graphic_only", "deterministic_overlay"]).default("blank_surface"),
  /** Open-event traceability and visual authority context. */
  event_label: z.string().trim().min(1).max(160).nullable().optional(),
  original_request: z.string().max(1_000).optional(),
  palette: z.array(z.string().min(1)).max(12).default([]),
  style: z.string().max(120).optional(),
  confirmed_motifs: z.array(z.string().min(1)).max(20).default([]),
  piece_match_levels: z.array(z.object({ piece: z.string().min(1), match_level: z.string().min(1) }).strict()).max(40).default([]),
  approved_plan: z.array(z.string().min(1)).max(40).default([]),
  approved_materials: z.array(z.string().min(1)).max(80).default([]),
});

export type SceneSpecV2 = z.infer<typeof SceneSpecV2Schema>;

// ---------------------------------------------------------------------------
// Constructor: ResolvedScenePlan → SceneSpecV2
// ---------------------------------------------------------------------------

/**
 * Construye un `SceneSpecV2` a partir de un plan resuelto para una vista
 * específica. Preserva identidad de slot, fuente y relaciones espaciales.
 *
 * Los slots sin candidato (gaps) se omiten del spec — solo entran ítems con
 * fuente verificable (compra, alquiler o existente).
 */
export function buildSceneSpecV2(
  plan: ResolvedScenePlan,
  viewId: string,
  programSlots: readonly { slot_id: string; view_id: string; function: string; zone: string; spatial_constraints: SpatialConstraint[] }[],
  opts?: {
    aspectRatio?: "3:2" | "1:1" | "2:3" | "16:9";
    eventLabel?: string | null;
    originalRequest?: string;
    palette?: string[];
    style?: string;
    confirmedMotifs?: string[];
    pieceMatchLevels?: Array<{ piece: string; match_level: string }>;
    approvedPlan?: string[];
    approvedMaterials?: string[];
  },
): SceneSpecV2 {
  const aspectRatio = opts?.aspectRatio ?? "3:2";
  const compositionNotes: string[] = [];

  // Filtrar solo slots de esta vista
  const viewSlots = programSlots.filter((s) => s.view_id === viewId);

  const items: SceneItemV2[] = [];

  for (const line of plan.lines) {
    // Omitir gaps
    if (line.item_id.startsWith("gap:")) continue;

    const slot = viewSlots.find((s) => s.slot_id === line.slot_id);
    if (!slot) continue;

    const vis = visibilityPolicy(slot.function, line.source_class);
    if (vis === "support_hidden") {
      compositionNotes.push(`Soporte oculto: ${slot.function} (${line.item_id}) — necesario para geometría, no visible`);
      continue; // soportes ocultos no van al spec visible
    }

    const layout = zoneLayout(slot.zone);

    // Si es guest_seating, dividir en instancias izquierda/derecha
    if (slot.zone === "guest_seating" && line.instance_count >= 2) {
      const totalRows = Math.ceil(line.instance_count / 2);
      for (let i = 0; i < line.instance_count; i++) {
        const side: "left" | "right" = i % 2 === 0 ? "left" : "right";
        const rowIndex = Math.floor(i / 2);
        const bbox = seatingBBox(side, rowIndex, totalRows);
        items.push(buildItem(line, slot, vis, bbox, layout.depthLayer, i));
      }
      continue;
    }

    // Aisle markers: repetir a intervalos
    if (slot.function === "aisle_marker" && line.instance_count > 1) {
      for (let i = 0; i < line.instance_count; i++) {
        const t = i / (line.instance_count - 1);
        const markerBBox: BBox = {
          x: layout.bbox.x + (t * layout.bbox.width * 0.8),
          y: layout.bbox.y + t * layout.bbox.height,
          width: 0.06,
          height: 0.06,
        };
        items.push(buildItem(line, slot, vis, markerBBox, layout.depthLayer, i));
      }
      continue;
    }

    // Default: una instancia en el centro de la zona
    items.push(buildItem(line, slot, vis, layout.bbox, layout.depthLayer, 0));
  }

  return {
    schema_version: "scene-spec-v2",
    scene_plan_hash: plan.program_hash,
    view_id: viewId,
    aspect_ratio: aspectRatio,
    items,
    composition_notes: compositionNotes,
    preserve_venue: plan.lines
      .filter((l) => l.source_class === "venue_existing" || l.source_class === "context_non_quotable")
      .map((l) => l.item_id),
    text_policy: "blank_surface",
    event_label: opts?.eventLabel ?? null,
    original_request: opts?.originalRequest,
    palette: opts?.palette ?? [],
    style: opts?.style,
    confirmed_motifs: opts?.confirmedMotifs ?? [],
    piece_match_levels: opts?.pieceMatchLevels ?? [],
    approved_plan: opts?.approvedPlan ?? [],
    approved_materials: opts?.approvedMaterials ?? [],
  };
}

function buildItem(
  line: ResolvedItemLine,
  slot: { slot_id: string; function: string; zone: string; spatial_constraints: SpatialConstraint[] },
  vis: VisibilityPolicy,
  bbox: BBox,
  depthLayer: number,
  instanceIndex: number,
): SceneItemV2 {
  const relationships = slot.spatial_constraints.map((sc) => ({
    type: sc.relation,
    target_slot_id: sc.target_slot_id,
    target_zone: sc.target_zone,
    note: sc.note,
  }));

  const visualName = instanceIndex > 0
    ? `${slot.function}_${instanceIndex + 1}`
    : slot.function;

  // No incluir item_id en visual_name ni en constraints — es un ID interno
  const identityConstraints: string[] = [];
  if (line.source_class === "purchase") identityConstraints.push("producto de catálogo verificable");
  if (line.source_class === "rental") identityConstraints.push("producto de alquiler");
  if (line.source_class === "venue_existing") identityConstraints.push("elemento existente del lugar, preservar");

  return {
    slot_id: slot.slot_id,
    item_id: line.item_id,
    visual_name: visualName,
    category_v3: "balloon_material", // Se deriva de scene_functions en fase siguiente
    source_class: line.source_class,
    visibility: vis,
    instance_count: line.instance_count,
    count_policy: line.instance_count <= 6 ? "exact" : "approximate",
    resolved_colors: [],
    identity_constraints: identityConstraints,
    bbox,
    depth_layer: depthLayer,
    relationships,
    function: slot.function,
    zone: slot.zone,
  };
}
