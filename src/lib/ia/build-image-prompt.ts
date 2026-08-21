import type { SceneSpec } from "./scene-spec";
import {
  buildPositiveEnvironmentCues,
  buildVisualFailureConditions,
  buildVisualSceneLock,
  type VisualContext,
} from "./visual-context";

export type PromptImageInput = {
  image_id: string;
  role: "composition_reference" | "element_reference" | "palette_reference" | "style_reference" | "catalog_product_reference" | "venue_base" | "previous_generated_result";
  allowed_use: string;
};

export type ImagePromptInput = {
  sceneSpec: SceneSpec;
  inputs?: PromptImageInput[];
  revisionInstruction?: string;
  visualContext?: VisualContext;
  /**
   * Bloque "BALLOON SIZE MIX" (plan de tamaños F4) — las proporciones EXACTAS
   * de diámetro que se cotizaron, ya renderizadas como texto por
   * `bloqueMezclaTamanos()`. `undefined` cuando la propuesta no tiene
   * ninguna pieza con diámetro real (ej. solo backdrop/kits) — en ese caso
   * no hay nada que anclar y no se agrega la sección.
   */
  sizeMixBlock?: string;
};

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function placementDescription(target: SceneSpec["elements"][number]["target_bbox"], category: string): string {
  if (["curtain", "drape", "backdrop", "panel"].includes(category)) return "rear background surface spanning the central decoration area";
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  const horizontal = centerX < 0.34 ? "left" : centerX > 0.66 ? "right" : "center";
  const vertical = centerY < 0.34 ? "upper" : centerY > 0.66 ? "lower" : "middle";
  return `${vertical} ${horizontal} area of the composition`;
}

function compactSceneSpec(scene: SceneSpec): string {
  const elementNames = new Map(scene.elements.map((element) => [element.element_id, element.name]));
  return JSON.stringify({
    schema_version: scene.schema_version,
    generation_mode: scene.generation_mode,
    canvas: { aspect_ratio: scene.canvas.aspect_ratio },
    venue: {
      source_image_id: scene.venue.source_image_id,
      preserve: scene.venue.preserve,
      protected_regions: scene.venue.protected_regions.map((region) => region.region_id),
      editable_regions: scene.venue.editable_regions.map((region) => region.region_id),
    },
    elements: scene.elements.map((element) => ({
      name: element.name,
      category: element.category,
      source_type: element.source_type,
      required: element.required,
      quantity: element.quantity,
      resolved_colors: element.resolved_colors,
      identity_constraints: element.identity_constraints,
      placement: placementDescription(element.target_bbox, element.category),
      relationships: element.relationships.map((relationship) => `${relationship.type} ${elementNames.get(relationship.target_element_id) ?? "related element"}`),
    })),
    positive_prompt: scene.positive_prompt,
    negative_prompt: scene.negative_prompt,
  });
}

export function buildImagePrompt({ sceneSpec, inputs = [], revisionInstruction, visualContext, sizeMixBlock }: ImagePromptInput): string {
  const inputMap = inputs.map((input) => `${input.image_id}: ${input.role}; allowed use: ${input.allowed_use}`).join("\n") || "None.";
  const sceneLock = visualContext ? buildVisualSceneLock(visualContext) : "No explicit scene context supplied.";
  const environmentCues = visualContext ? buildPositiveEnvironmentCues(visualContext) : [];
  const failureConditions = visualContext ? buildVisualFailureConditions(visualContext) : [];
  const revision = revisionInstruction?.trim()
    ? `\nREVISION DELTA\n- Apply only this user delta to the existing result: ${revisionInstruction.trim().slice(0, 500)}\n- Preserve automatic element count, scene geometry, and venue identity.`
    : "";
  const task = sceneSpec.generation_mode === "revise_current_result"
    ? "Revise the supplied previous generated result."
    : sceneSpec.generation_mode === "edit_venue"
      ? "Edit the supplied venue photo."
      : "Create a new photorealistic, creative, event-ready party installation following AUTOMATIC_SCENE_SPEC and using the supplied composition reference only as spatial inspiration.";

  return `ROLE
You are a photorealistic event-design image editor.

TASK
${task} Add only the automatically selected decorative elements in AUTOMATIC_SCENE_SPEC. This is one clean photographed scene, never a product board, catalog sheet, collage, or annotated mockup. Make thoughtful event-designer choices: build one convincing installation with a focal point, hierarchy, grouping, depth, atmosphere, and usable floor space${sizeMixBlock ? ", varying scale ONLY within the balloon diameters listed in BALLOON SIZE MIX below" : ", scale variation"}.${revision}

SCENE LOCK — HIGHEST PRIORITY
${sceneLock}
The final image must visibly prove every populated SCENE LOCK field. Mentioning it in reasoning is not enough.

VISIBLE ENVIRONMENT REQUIREMENTS
${list(environmentCues)}

AUTOMATIC FAILURE CONDITIONS
${list(failureConditions)}
If any failure condition appears, correct the scene before returning the image.

SOURCE-OF-TRUTH PRIORITY
1. SCENE LOCK controls requested event, venue, and time of day. If VENUE_01 exists, it controls the real venue architecture while SCENE LOCK still controls compatible event atmosphere and explicit revision requests.
2. AUTOMATIC_SCENE_SPEC controls which elements exist, their colors, quantity, placement, and layers.
3. VENUE_01 controls camera position, crop, architecture, perspective, and ambient light when supplied.
4. CATALOG_* images control product identity only.
5. The analyzed reference blueprint controls composition only: framing, backdrop geometry, lighting placement, density, and spatial relationships. The raw reference image is not a product source and must not add objects.
6. PREVIOUS_RESULT controls the current revision base when present.
If sources conflict, follow this order. Do not resolve conflicts by inventing content.

IMAGE MAP
${inputMap}

ENVIRONMENT AND LIGHTING CONSTRAINTS — NON-NEGOTIABLE
- Translate SCENE LOCK into visible reality, not just decoration: requested space and time are part of scene identity.
- Named space is a hard venue constraint. Render that exact environment faithfully. Do not substitute every request with a generic room or studio backdrop.
- If VENUE_01 is supplied, preserve its real architecture, camera, crop, and perspective. If no VENUE_01 is supplied, construct the named environment with recognizable physical cues instead of inventing an unrelated venue.
- If the context requests night, nocturnal, evening, or atardecer, use the corresponding ambient exposure and artificial event lighting. If it requests day or morning, use daylight. Match the requested time instead of defaulting to bright daylight.
- Always adapt the decoration to the requested venue and time of day; never let a reference image silently override those user constraints.

MUST INCLUDE
${list(sceneSpec.positive_prompt.required_elements)}
${sizeMixBlock ? `\n${sizeMixBlock}\n` : ""}
COMPOSITION AND LAYERS
${list(sceneSpec.positive_prompt.composition)}
${sceneSpec.elements.length ? sceneSpec.elements.map((element) => `- Place ${element.name} in the ${placementDescription(element.target_bbox, element.category)}; preserve physical depth and relationships: ${element.relationships.map((relationship) => `${relationship.type} ${relationship.target_element_id}`).join(", ") || "none"}.`).join("\n") : "- No automatically selected decorative elements."}
- Placement instructions above are invisible metadata. Never draw them.

CREATIVE EVENT DESIGN
- Design one finished party setup, not a row of product objects.
- Treat selected products as ingredients. Group compatible balloons into a cohesive arch, garland, columns, or organic clusters around the main focal point.
- Respect package quantities exactly. If a quoted balloon package contains 12 units, use those 12 units in the installation; creative freedom is only arrangement, grouping, scale, and support.
- Use backdrop and curtain products as the rear stage; use balloon structures and themed accents to frame it; use lighting behind or around the installation to create atmosphere.
- Integrate every mandatory product physically. A kit or package image describes its contents; never render the box or package as the decoration.
- Balance left and right without forcing perfect symmetry. ${sizeMixBlock ? "Vary overlap, depth, and height using only the balloon diameters in BALLOON SIZE MIX — never invent a smaller or larger balloon to fill a gap." : "Vary scale, overlap, depth, and height."} Ground floor pieces and give hanging pieces real strings, hooks, frames, or supports.
- Do not make one isolated floating object per catalog line. Make the result look like a professional decorator made creative choices for a real celebration.
- If no VENUE_01 is supplied, first create a believable party venue appropriate to the event: visible wall or garden structure, floor, depth, ambient light, and realistic installation context. Never output a white studio background or an isolated catalog product.

VENUE PRESERVATION
${list(sceneSpec.positive_prompt.venue_preservation)}
- Keep areas outside automatic editable regions unchanged and empty when no element is specified.

REFERENCE AND PRODUCT IDENTITY
- Reference images were analyzed upstream. Use only the resulting AUTOMATIC_SCENE_SPEC for framing, backdrop position, asymmetry, density, ambient/background palette, and lighting placement; do not recreate any object from the reference unless it is represented by a mandatory catalog item.
- Use each supplied CATALOG_* image as the only visual source for product identity. Re-render that exact catalog product as a physical three-dimensional object from the venue camera angle.
- Every catalog-backed element in AUTOMATIC_SCENE_SPEC is a mandatory quoted line item. Make every one visibly recognizable in the result; never summarize the list into a generic decoration or omit a product.
- Catalog line items are raw materials for the installation, not a literal placement diagram. Preserve product identity and quoted package quantity while adapting grouping, scale, orientation, and support to make a coherent party scene.
- If a catalog image shows packaging, use the product description and category to render the physical contents in the scene; never place the package, card, or catalog photo on the wall.
- The analyzed reference may describe function, approximate placement, density, palette, backdrop geometry, and lighting placement through AUTOMATIC_SCENE_SPEC. Never use it as a product catalog or copy its object designs.
- Catalog color lock: render every catalog product in its supplied catalog color/material. A black product must remain black, a silver product must remain silver, and a blue product must remain blue. Never recolor, blend, or borrow a product color from the composition reference.
- If a reference color differs from a catalog product, keep the catalog product color exactly; adapt only lighting and integration, never the product identity.
- Never copy a source-image border, crop frame, halo, rectangular pasted image, studio shadow, or collage artifact.

OUTPUT FORMAT
- Output one clean photorealistic scene only.
- Never render catalog IDs, product names, prices, arrows, callouts, captions, legends, watermarks, UI, labels, annotations, or explanatory text.
- Never draw placement guides: no colored rectangles, bounding boxes, green or yellow outlines, layer labels, coordinate text, measurement arrows, or callout lines.
- Text may appear only when physically printed on a mandatory catalog product; never add free-floating headings, giant letters, or “HBD” decorations unless that exact catalog product is mandatory.
- Product color verification: before output, check each mandatory catalog item against its catalog image and correct any color drift.

PHOTOREALISTIC INTEGRATION
${list(sceneSpec.positive_prompt.photorealistic_integration)}

MUST NOT INCLUDE
- No decorative object absent from the automatic element allowlist.
${list(sceneSpec.negative_prompt.forbidden_elements)}

FORBIDDEN VENUE CHANGES
${list(sceneSpec.negative_prompt.forbidden_venue_changes)}

FORBIDDEN COMPOSITING ARTIFACTS
${list(sceneSpec.negative_prompt.forbidden_compositing_artifacts)}

FINAL CHECK BEFORE OUTPUT
First verify venue and time of day visibly match SCENE LOCK. Then verify every required element is present exactly once or within its automatic quantity range, every item belongs to one cohesive installation, no object floats without support, forbidden elements are absent, target placement is respected, rear layers remain behind foreground layers, protected venue regions are unchanged, and the result looks photographed in the requested venue rather than composited.

<AUTOMATIC_SCENE_SPEC>
${compactSceneSpec(sceneSpec)}
</AUTOMATIC_SCENE_SPEC>`;
}

export function buildLoraImagePrompt(input: {
  sceneSpec: SceneSpec;
  visualContext: VisualContext;
  revisionInstruction?: string;
}): string {
  const { sceneSpec, visualContext, revisionInstruction } = input;
  const environment = buildPositiveEnvironmentCues(visualContext);
  const elements = sceneSpec.elements.slice(0, 24).map((element) => {
    const quantity = element.quantity.min === element.quantity.max
      ? `${element.quantity.min}`
      : `${element.quantity.min}-${element.quantity.max}`;
    const colors = element.resolved_colors.length ? `, ${element.resolved_colors.join(" and ")}` : "";
    return `${quantity} ${element.name}${colors}, ${placementDescription(element.target_bbox, element.category)}`;
  });

  const sections = [
    visualContext.userRequest ? `Exact user request: ${visualContext.userRequest}` : undefined,
    visualContext.eventType ? `Event: ${visualContext.eventType}` : undefined,
    visualContext.venue ? `Venue: ${visualContext.venue}` : undefined,
    visualContext.timeOfDay ? `Time of day: ${visualContext.timeOfDay}` : undefined,
    visualContext.style ? `Style: ${visualContext.style}` : undefined,
    visualContext.palette.length ? `Palette: ${visualContext.palette.join(", ")}` : undefined,
    ...environment,
    "wide photorealistic event photograph that clearly shows the surrounding venue and its ambient lighting",
    elements.length ? `One cohesive professional installation using exactly these visible ingredients: ${elements.join("; ")}` : "one cohesive professional event installation",
    "realistic scale, physical supports, floor contact, natural depth, cinematic but believable event lighting, no catalog board, no product packaging, no text overlay",
    revisionInstruction?.trim() ? `Revision: ${revisionInstruction.trim().slice(0, 500)}` : undefined,
  ].filter(Boolean);

  return sections.join(". ").slice(0, 3_500);
}
