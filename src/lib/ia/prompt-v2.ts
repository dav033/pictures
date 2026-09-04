/**
 * Prompt builder V2 para SceneSpec V2 (Tarea 07.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 10.4-10.5).
 *
 * Serializa un `SceneSpecV2` en un prompt de imagen que:
 *   - Preserva identidad de slot sin IDs internos visibles
 *   - Respeta políticas de visibilidad (visible / support_hidden / context_preserved)
 *   - Aplica políticas de conteo (exact / approximate / representative)
 *   - Incluye restricciones de relación espacial (grafo sección 10.1)
 *   - Nunca produce texto/IDs/SKU visibles en la imagen (sección 10.4)
 */

import type { SceneSpecV2, SceneItemV2 } from "./scene-spec-v2";

export type V2PromptOutput = {
  /** Prompt positivo completo. */
  positive: string;
  /** Fragmentos de negative prompt. */
  negative: string[];
  /** Instrucciones de composición. */
  composition: string[];
  /** Elementos requeridos con cantidad y ubicación. */
  required_elements: string[];
};

// ---------------------------------------------------------------------------
// Construcción del prompt
// ---------------------------------------------------------------------------

function describePlacement(item: SceneItemV2): string {
  const b = item.bbox;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const h = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "center";
  const v = cy < 0.34 ? "upper" : cy > 0.66 ? "lower" : "middle";
  return `${v} ${h} area`;
}

function describeCount(item: SceneItemV2): string {
  switch (item.count_policy) {
    case "exact":
      return item.instance_count === 1
        ? "exactly 1 installation"
        : `exactly ${item.instance_count} physical instances`;
    case "approximate":
      return `approximately ${item.instance_count} instances`;
    case "representative":
      return `a representative sample of ${item.instance_count} instances`;
  }
}

function describeRelationships(item: SceneItemV2): string[] {
  if (!item.relationships.length) return [];
  return item.relationships.map((r) => {
    const target = r.target_slot_id ?? r.target_zone ?? "the scene";
    switch (r.type) {
      case "attached_to": return `physically attached to ${target}`;
      case "supported_by": return `supported by ${target}`;
      case "aligned_with": return `visually aligned with ${target}`;
      case "mirrored_with": return `mirrored on both sides of ${target}`;
      case "repeated_along": return `repeated at regular intervals along ${target}`;
      case "in_front_of": return `positioned in front of ${target}`;
      case "behind": return `positioned behind ${target}`;
      case "overhead_of": return `suspended overhead above ${target}`;
      case "clearance_from": return `with clear space from ${target}`;
      default: return r.note ?? `related to ${target}`;
    }
  });
}

function describeVisibility(item: SceneItemV2): string {
  switch (item.visibility) {
    case "visible": return "fully visible decorative element";
    case "support_hidden": return "structural support — hidden from view";
    case "context_preserved": return "existing venue element — preserve as-is";
  }
}

function describeSource(item: SceneItemV2): string {
  switch (item.source_class) {
    case "purchase": return "catalog product (verified, quotable)";
    case "rental": return "rental item (verified, quotable)";
    case "venue_existing": return "already present at venue — do not add or modify";
    case "context_non_quotable": return "venue context — natural element, do not decorate";
  }
}

function functionLabel(fn: string): string {
  const labels: Record<string, string> = {
    altar_frame: "altar or ceremony focal structure",
    focal_decor: "focal decoration",
    focal_structure_surface: "focal structure surface",
    focal_backdrop: "ceremony backdrop",
    aisle_runner: "aisle runner or path marker",
    aisle_marker: "aisle side markers",
    guest_chair: "guest seating",
    floral_foliage_accent: "floral or foliage accent",
    balloon_accent: "balloon accent",
    ambient_light: "ambient lighting",
    floor_light: "floor-level lighting",
    welcome_signage: "welcome sign or entrance marker",
    plinth_pedestal: "display pedestal or plinth",
    service_support: "service support structure",
    centerpiece: "table centerpiece",
    table_setting: "table setting",
    linen: "table linen or textile",
  };
  return labels[fn] ?? fn.replace(/_/g, " ");
}

/**
 * Construye el prompt de imagen V2 a partir de un SceneSpecV2.
 * Solo incluye ítems visibles — los soportes ocultos y contexto preservado
 * se mencionan en composition_notes pero no como required_elements.
 */
export function buildV2ImagePrompt(spec: SceneSpecV2): V2PromptOutput {
  const visibleItems = spec.items.filter((item) => item.visibility === "visible");
  const hiddenCount = spec.items.filter((item) => item.visibility !== "visible").length;
  const venueItems = spec.items.filter((item) => item.source_class === "venue_existing" || item.source_class === "context_non_quotable");

  // Required elements (section: MUST INCLUDE)
  const requiredElements = visibleItems.map((item) => {
    const parts: string[] = [];

    parts.push(`[${item.slot_id}] ${functionLabel(item.function)}`);
    parts.push(describeCount(item));
    parts.push(`placed in ${describePlacement(item)}`);
    parts.push(`depth layer ${item.depth_layer}`);

    if (item.identity_constraints.length > 0) {
      parts.push(`identity: ${item.identity_constraints.slice(0, 2).join("; ")}`);
    }

    if (item.resolved_colors.length > 0) {
      parts.push(`colors: ${item.resolved_colors.join(", ")}`);
    }

    if (item.match_level) {
      parts.push(`catalog match level: ${item.match_level}; never present this as a stronger match`);
    }

    const relations = describeRelationships(item);
    if (relations.length > 0) {
      parts.push(`spatial: ${relations.join("; ")}`);
    }

    parts.push(`source: ${describeSource(item)}`);

    return parts.join("; ");
  });

  // Composition notes
  const composition: string[] = [
    `Scene: ${spec.event_label ?? "open event"} ${spec.view_id} view with ${visibleItems.length} visible decorative elements and ${hiddenCount} support/venue elements.`,
    `Aspect ratio: ${spec.aspect_ratio}.`,
    "Design one cohesive ceremony installation with clear focal point, visual hierarchy, balanced color, and natural asymmetry.",
    "Build a complete installed event scene with rear backdrop/support, middle decoration, grounded floor contact, and realistic scale.",
    ...spec.composition_notes,
  ];

  if (spec.original_request) composition.push(`Original customer request: ${spec.original_request}`);
  if (spec.palette.length) composition.push(`Approved palette: ${spec.palette.join(", ")}`);
  if (spec.style) composition.push(`Approved style: ${spec.style}`);
  if (spec.confirmed_motifs.length) composition.push(`Confirmed motifs only: ${spec.confirmed_motifs.join(", ")}`);
  if (spec.piece_match_levels.length) composition.push(`Catalog match levels: ${spec.piece_match_levels.map((item) => `${item.piece}=${item.match_level}`).join("; ")}`);
  if (spec.approved_plan.length) composition.push(`Approved plan only: ${spec.approved_plan.join("; ")}`);
  if (spec.approved_materials.length) composition.push(`Approved materials only: ${spec.approved_materials.join("; ")}`);
  composition.push("For an open or unclassified event, express the label through composition and approved colors only; invent no signage, text, props, or accessories.");

  // Venue preservation
  if (spec.preserve_venue.length > 0) {
    composition.push(
      `Preserve existing venue elements: ${spec.preserve_venue.slice(0, 5).join(", ")}.`,
    );
  }

  if (venueItems.length > 0) {
    composition.push(
      `Do not modify or add to: ${venueItems.map((i) => functionLabel(i.function)).join(", ")} — these already exist at the venue.`,
    );
  }

  // Positive prompt
  const positive = [
    "HIGH-QUALITY EVENT DECORATION PHOTOGRAPH:",
    ...requiredElements.slice(0, 3).map((e) => `MUST INCLUDE: ${e}`),
    "",
    ...requiredElements.slice(3).map((e) => `ALSO INCLUDE: ${e}`),
    "",
    "COMPOSITION RULES:",
    ...composition.map((c) => `- ${c}`),
    "",
    "Do not default to a generic balloon arch or isolated product display. Design a coherent ceremony setup.",
  ].join("\n");

  // Negative prompt
  const negative = [
    "catalog product packaging, retail displays, price tags, watermarks",
    "generic balloon arch, empty table, banquet vignette",
    "text, letters, callouts, arrows, captions, SKU codes, logos",
    "flat sticker, cutout edge, pasted rectangle, floating object",
    "garden/park/forest background replacing the venue",
    "unapproved signage, readable text, symbols, props, flowers, furniture, or accessories",
    ...(spec.preserve_venue.length > 0
      ? ["modifying or removing preserved venue elements"]
      : []),
    "mismatched lighting, impossible support, studio shadow",
  ];

  if (spec.text_policy !== "deterministic_overlay") {
    negative.push("any readable text, letters, or signage with legible words");
  }

  return { positive, negative, composition, required_elements: requiredElements };
}
