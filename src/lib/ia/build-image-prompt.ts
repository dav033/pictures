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
  /** Number of catalog photos omitted because the provider input cap was reached. */
  droppedCatalogReferenceCount?: number;
  /** Number of client composition-reference photos omitted because the provider input cap was reached (R6). */
  droppedCompositionReferenceCount?: number;
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
  return JSON.stringify({
    // This is a rendering brief, not the internal scene record. Never expose
    // plan/element/venue identifiers to the image model: they are useful for
    // server-side validation but are a strong prompt for visible callouts.
    rendering_context: {
      aspect_ratio: scene.canvas.aspect_ratio,
      generation_mode: scene.generation_mode,
      preserve_venue: scene.venue.preserve,
      protected_areas: "preserve all non-decoration venue areas",
      editable_areas: "use only the approved placement descriptions below",
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
      relationships: element.relationships.map((relationship) => `${relationship.type} the related approved decoration`),
    })),
    positive_prompt: scene.positive_prompt,
    negative_prompt: scene.negative_prompt,
  });
}

function balloonScaleInstruction(sizeMixBlock?: string): string {
  if (!sizeMixBlock) return "Vary scale, overlap, depth, and height naturally.";
  const diameters = [...sizeMixBlock.matchAll(/\b(\d+(?:\.\d+)?)\s*-inch\b/gi)]
    .map((match) => Number(match[1]))
    .filter((diameter, index, values) => values.indexOf(diameter) === index);
  if (diameters.length === 1) {
    return `SINGLE-DIAMETER HARD CONSTRAINT: every balloon must be exactly ${diameters[0]}-inch (${Math.round(diameters[0] * 2.54 * 10) / 10} cm). Do not vary balloon size for depth, overlap, hierarchy, or visual interest.`;
  }
  return "Vary balloon scale ONLY among the exact quoted diameters and quantities in BALLOON SIZE MIX. Every visible balloon smaller than 12 inches must match a listed, quoted size; never invent a smaller, larger, or intermediate balloon.";
}

function materialEstimateContract(sceneSpec: SceneSpec): string {
  const estimate = sceneSpec.material_estimate;
  if (!estimate) return "No structured material estimate was supplied; do not invent extra balloons beyond the approved scene elements.";
  const balloonTotal = estimate.balloons.reduce((sum, line) => sum + line.design_quantity, 0);
  const sizeLines = new Map<string, number>();
  const colorLines = new Map<string, number>();
  for (const line of estimate.balloons) {
    const size = line.size_inches == null ? "unspecified size" : `${line.size_inches}-inch`;
    sizeLines.set(size, (sizeLines.get(size) ?? 0) + line.design_quantity);
    const color = line.color ?? "catalog color";
    colorLines.set(color, (colorLines.get(color) ?? 0) + line.design_quantity);
  }
  const sizes = [...sizeLines.entries()].map(([size, quantity]) => `${quantity} ${size}`).join(", ");
  const colors = [...colorLines.entries()].map(([color, quantity]) => `${quantity} ${color}`).join(", ");
  const specials = estimate.special_elements.reduce((sum, line) => sum + line.design_quantity, 0);
  return [
    "DESIGN MATERIAL ESTIMATE — SOURCE OF TRUTH",
    `Render approximately ${balloonTotal} installed balloons, not the purchased package capacity.`,
    sizes ? `Installed size distribution: ${sizes}.` : "No round balloon sizes are approved.",
    colors ? `Installed color distribution: ${colors}.` : "Use only the approved catalog colors.",
    specials ? `Also render ${specials} installed special element(s) from the approved list.` : "No special elements are approved.",
    `Physical design: ${estimate.design.type}; ${estimate.design.visual_density} density; ${estimate.design.visual_scale} visual scale; ${estimate.design.installation_length_m == null ? "length not specified" : `${estimate.design.installation_length_m} m installation extent`}.`,
    `Purchase capacity (${estimate.totals.purchase_quantity}) includes waste and closed-package surplus. Waste-adjusted quantity is ${estimate.totals.waste_adjusted_quantity}. Neither surplus nor unused package units may appear in the decoration.`,
    "Perceptual count rule: stay within the same physical scale as the installed estimate; exact object-by-object counting is not required, but do not turn a small/medium estimate into a very large dense installation.",
  ].join("\n");
}

/**
 * A short composition contract is deliberately kept near the beginning of the
 * prompt.  The old prompt had all the right constraints, but they were spread
 * across the scene spec and the creative section; image models consequently
 * tended to satisfy the easiest visual prior (a generic balloon arch plus a
 * banquet table) instead of building the selected products into one finished
 * decoration.  This contract describes the *scene architecture* without
 * inventing any catalog objects.
 */
function decorationCompositionContract(sceneSpec: SceneSpec, visualContext?: VisualContext): string[] {
  const categories = new Set(sceneSpec.elements.map((element) => element.category));
  const hasBackdrop = [...categories].some((category) => ["backdrop", "curtain", "drape", "panel"].includes(category));
  const hasBalloonStructure = categories.has("balloon_structure");
  const hasTableProduct = categories.has("tableware") || categories.has("furniture");
  const hasVenuePhoto = Boolean(sceneSpec.venue.source_image_id);
  const hasExplicitOutdoorVenue = visualContext?.venueKind === "outdoor";
  const layers = [
    "NON-NEGOTIABLE SCENE TYPE: render a complete, installed event decoration in a real venue, with one focal zone and a clear rear-to-foreground composition; this is not a catalog sample, product board, showroom display, or collection of loose objects.",
    hasBackdrop
      ? "Use the approved backdrop/curtain/panel as the rear anchor, spanning behind the complete installation."
      : hasExplicitOutdoorVenue
        ? "Use the named outdoor venue's real architecture, terrain, and open-air depth as the rear anchor; do not invent a backdrop product."
      : "Use the real venue wall, doorway, or architectural feature as the rear anchor; do not invent a backdrop product.",
    hasBalloonStructure
      ? "Build the approved balloon materials into one intentional installation around a focal center (organic garland, arch, column, or clustered frame as appropriate to the named element), with visible attachment and floor contact."
      : "Arrange the approved products as one intentional focal installation with a clear center, rear-to-foreground depth, and visible physical support.",
    "The decoration itself must be the main subject and occupy a deliberate focal zone; it must read immediately as a finished event setup, not as separate samples placed in a venue.",
    "Use a real 3-layer read: rear backdrop or support, middle decorative structure, and grounded floor-level details only when supplied by the catalog or preserved in the venue photo. Make the floor, attachment/support, scale, lighting, depth, and element relationships visible.",
    "Do not turn a single catalog line into an isolated generic balloon arch, a loose garland, or unrelated furniture. Every selected line must contribute to the same coherent installation and be physically attached, hung, framed, or grounded.",
    !hasTableProduct && !hasVenuePhoto
      ? hasExplicitOutdoorVenue
        ? "No generic table, empty table, chairs, dining setup, food, gifts, flowers, or event props: natural vegetation and terrain may appear only as context for the explicitly named outdoor venue, never as added decoration."
        : "No generic table, empty table, chairs, dining setup, food, gifts, flowers, plants, or landscape scenery: none is an approved catalog element."
      : !hasTableProduct
        ? "Do not add a new table, empty table, chairs, or props; preserve only furniture already present in the supplied venue photo."
        : "Use the approved table/furniture only as a supporting layer for the decoration, never as the main subject or an empty event-table cliché.",
    !hasVenuePhoto
      ? hasExplicitOutdoorVenue
        ? "When an outdoor venue is explicitly requested, render that recognizable outdoor place with its real ground, open-air depth, architecture/terrain, and appropriate event lighting; do not substitute an indoor room or a generic unrelated landscape."
        : "When no venue photo or named outdoor venue is supplied, use a neutral real indoor celebration corner with a visible wall, floor, depth, and event lighting; never default to a generic garden, forest, park, or empty landscape background."
      : "Preserve the supplied venue camera and architecture; add the installation to the editable area without replacing the venue with a generic scene.",
    "Treat selected catalog products as installed decoration and raw materials for this one event, never as catalog samples, retail packaging, isolated product cutouts, or evenly spaced inventory.",
    "Only a selected catalog-backed signage product may contain a focal sign or legible printed message; if no signage product is selected, add no sign, banner, lettering, or invented event text.",
    "Never add commercial/event objects absent from the selected catalog allowlist: no generic tables, chairs, centerpieces, gifts, food, flowers, plants, props, signs, lights, or extra balloons.",
  ];
  return layers;
}

function cardinalityContract(sceneSpec: SceneSpec): string {
  const counts = new Map<string, number>();
  for (const element of sceneSpec.elements) {
    const normalized = element.name.toLowerCase();
    const kind = normalized.includes("arco") ? "arches" : normalized.includes("columna") ? "columns" : element.category;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([kind, count]) => `${count} ${kind}`).join(" and ");
  return `CARDINALITY CONTRACT: render exactly ${summary || "zero approved physical instances"}. Each listed instance is distinct, positioned separately, and must not be merged, duplicated, or omitted.`;
}

function colorVarietyContract(sceneSpec: SceneSpec): string[] {
  const balloonStructures = sceneSpec.elements.filter((element) =>
    element.category === "balloon_structure" || /\b(?:arco|columna|guirnalda|balloon)\b/i.test(element.name),
  );
  if (balloonStructures.length === 0) {
    return ["No balloon color mix is approved; do not add balloon structures or colors as atmosphere."];
  }
  return balloonStructures.map((element) => {
    const colors = [...new Set(element.resolved_colors.map((color) => color.trim()).filter(Boolean))];
    if (colors.length < 2) {
      return `${element.name}: MONOCHROME LOCK — use only ${colors[0] ?? "the supplied catalog color"}; do not introduce color variety.`;
    }
    return `${element.name}: APPROVED COLOR VARIETY — use exactly these catalog colors: ${colors.join(", ")}. Distribute them through intentional organic clusters and transitions, preserving any material percentages in the scene spec; avoid flat stripes, random speckles, or one color replacing another. Do not invent, recolor, or borrow any additional color.`;
  });
}

export function buildImagePrompt({ sceneSpec, inputs = [], revisionInstruction, visualContext, sizeMixBlock, droppedCatalogReferenceCount = 0, droppedCompositionReferenceCount = 0 }: ImagePromptInput): string {
  const inputMap = inputs.map((input, index) => `Reference image ${index + 1}: role=${input.role}; allowed use=${input.allowed_use}. The reference label is invisible metadata and must never appear in the image.`).join("\n") || "None.";
  const sceneLock = visualContext ? buildVisualSceneLock(visualContext) : "No explicit scene context supplied.";
  const environmentCues = visualContext ? buildPositiveEnvironmentCues(visualContext) : [];
  const failureConditions = visualContext ? buildVisualFailureConditions(visualContext) : [];
  const compositionContract = decorationCompositionContract(sceneSpec, visualContext);
  const scaleInstruction = balloonScaleInstruction(sizeMixBlock);
  const materialContract = materialEstimateContract(sceneSpec);
  const instanceContract = sceneSpec.elements.length
    ? sceneSpec.elements.map((element, index) => `- EXACTLY ONE physical instance ${index + 1}: render the approved ${element.category} described by “${element.name}”; use only its assigned placement and quantity. This description is invisible metadata; never print or turn it into a sign.`).join("\n")
    : "- No physical decoration instances are approved.";
  const physicalCardinality = cardinalityContract(sceneSpec);
  const colorVariety = colorVarietyContract(sceneSpec);
  const referenceCapacityNotice = droppedCatalogReferenceCount > 0
    ? `CATALOG REFERENCE CAPACITY: ${droppedCatalogReferenceCount} catalog photo(s) could not be attached because the provider input limit was reached. Use the complete catalog metadata and quantities in AUTOMATIC_SCENE_SPEC for those lines; do not invent a substitute product, omit the line, or treat the missing photo as permission to change its color/material.`
    : "CATALOG REFERENCE CAPACITY: all selected catalog product photos fit within the provider limit.";
  const compositionReferenceCapacityNotice = droppedCompositionReferenceCount > 0
    ? `COMPOSITION REFERENCE CAPACITY: ${droppedCompositionReferenceCount} client composition-reference photo(s) could not be attached because the provider input limit was reached. Composition (framing, proportion between structures, density, backdrop geometry, lighting placement) travels only through this text prompt for this generation — do not treat the missing photo as permission to invent a different composition.`
    : "";
  const noVenueInstruction = !sceneSpec.venue.source_image_id
    ? visualContext?.venueKind === "outdoor"
      ? "If no venue photo is supplied, first create the named outdoor venue with recognizable ground, open-air depth, architecture or terrain, and event lighting. Never substitute an indoor room or an unrelated generic landscape."
      : "If no venue photo is supplied, first create a believable neutral indoor party venue appropriate to the event: visible wall, floor, depth, ambient event light, and realistic installation context. Never output a generic garden/forest/park, white studio background, empty table, or isolated catalog product."
    : "If a venue photo is supplied, preserve its real venue and add the installation only in the editable area.";
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
${task} Add only the automatically selected decorative elements in AUTOMATIC_SCENE_SPEC. This is one clean photographed scene, never a product board, catalog sheet, collage, or annotated mockup. Make thoughtful event-designer choices: build one convincing installation with a focal point, hierarchy, grouping, depth, atmosphere, and usable floor space. ${scaleInstruction}${revision}

${physicalCardinality}

${materialContract}

VISUAL TEXT BAN — ABSOLUTE AND NON-NEGOTIABLE
This output is a photograph, not an infographic, presentation board, floor plan, catalog page, or annotated design brief. Render ZERO visible typography unless a selected catalog product is explicitly a signage product with approved printed text. Treat every word, number, unit, dimension, quotation, JSON token, identifier, code, and instruction in this prompt as invisible control metadata. Never transcribe, paraphrase, stylize, or place any of it in the scene. In particular, ignore and never render internal project IDs, source-image IDs, catalog codes, venue codes, edit-region codes, plan hashes, element names, quantities, measurements, coordinate values, captions, or headings. Do not invent lettering, logos, brand marks, watermarks, or phrases on balloons, fabric, walls, arches, or props. If any supplied image contains text, use only its physical material/color identity; do not copy the text.

SCENE LOCK — HIGHEST PRIORITY
${sceneLock}
The final image must visibly prove every populated SCENE LOCK field. Mentioning it in reasoning is not enough.

DECORATION COMPOSITION CONTRACT — HIGHEST PRIORITY AFTER SCENE LOCK
${list(compositionContract)}

VISIBLE ENVIRONMENT REQUIREMENTS
${list(environmentCues)}

AUTOMATIC FAILURE CONDITIONS
${list(failureConditions)}
If any failure condition appears, correct the scene before returning the image.

SOURCE-OF-TRUTH PRIORITY
1. SCENE LOCK controls requested event, venue, and time of day. If a venue photo exists, it controls the real venue architecture while SCENE LOCK still controls compatible event atmosphere and explicit revision requests.
2. AUTOMATIC_SCENE_SPEC controls which elements exist, their colors, quantity, placement, and layers.
3. The supplied venue photo controls camera position, crop, architecture, perspective, and ambient light when supplied.
4. Supplied catalog product images control product identity only.
5. The analyzed reference blueprint controls composition only: framing, backdrop geometry, lighting placement, density, and spatial relationships. The raw reference image is not a product source and must not add objects.
6. PREVIOUS_RESULT controls the current revision base when present.
If sources conflict, follow this order. Do not resolve conflicts by inventing content.

IMAGE MAP
${inputMap}

${referenceCapacityNotice}
${compositionReferenceCapacityNotice}

ENVIRONMENT AND LIGHTING CONSTRAINTS — NON-NEGOTIABLE
- Translate SCENE LOCK into visible reality, not just decoration: requested space and time are part of scene identity.
- Named space is a hard venue constraint. Render that exact environment faithfully. Do not substitute every request with a generic room or studio backdrop.
- If a venue photo is supplied, preserve its real architecture, camera, crop, and perspective. If no venue photo is supplied, construct the named environment with recognizable physical cues instead of inventing an unrelated venue.
- If the context requests night, nocturnal, evening, or atardecer, use the corresponding ambient exposure and artificial event lighting. If it requests day or morning, use daylight. Match the requested time instead of defaulting to bright daylight.
- Always adapt the decoration to the requested venue and time of day; never let a reference image silently override those user constraints.

MUST INCLUDE
${list(sceneSpec.positive_prompt.required_elements)}
COLOR VARIETY / MATERIAL MIX — ONLY WHEN APPROVED
${list(colorVariety)}
INSTANCE CONTRACT — NON-NEGOTIABLE
${instanceContract}
${sizeMixBlock ? `\n${sizeMixBlock}\n` : ""}
COMPOSITION AND LAYERS
${list(sceneSpec.positive_prompt.composition)}
${sceneSpec.elements.length ? sceneSpec.elements.map((element) => `- Place the approved ${element.category} described in the brief in the ${placementDescription(element.target_bbox, element.category)}; preserve physical depth and relationships with the other approved decorations. Do not render this instruction as text.`).join("\n") : "- No automatically selected decorative elements."}
- Placement instructions above are invisible metadata. Never draw them.

CREATIVE EVENT DESIGN
- Design one finished party setup, not a row of product objects, a generic arch, or a furniture vignette.
- Treat selected products as ingredients. Group compatible balloons into a cohesive arch, garland, columns, or organic clusters around the main focal point.
- Respect INSTALLED DESIGN quantities exactly as described in DESIGN MATERIAL ESTIMATE. Package contents, merma, and purchase surplus are procurement data only and must never be rendered as extra decorative units.
- Use backdrop and curtain products as the rear stage; use balloon structures and themed accents to frame it; use lighting behind or around the installation to create atmosphere.
- Integrate every mandatory product physically. A kit or package image describes its contents; never render the box or package as the decoration.
- Balance left and right without forcing perfect symmetry. ${scaleInstruction} Use overlap, depth, and height to create a convincing installation. Ground floor pieces and give hanging pieces real strings, hooks, frames, or supports.
- Do not make one isolated floating object per catalog line. Make the result look like a professional decorator made creative choices for a real celebration, with a focal zone, rear support, floor contact, lighting, hierarchy, scale, and visible relationships between elements.
- ${noVenueInstruction}

VENUE PRESERVATION
${list(sceneSpec.positive_prompt.venue_preservation)}
- Keep areas outside automatic editable regions unchanged and empty when no element is specified.

REFERENCE AND PRODUCT IDENTITY
- Reference images were analyzed upstream. Use only the resulting AUTOMATIC_SCENE_SPEC for framing, backdrop position, asymmetry, density, ambient/background palette, and lighting placement; do not recreate any object from the reference unless it is represented by a mandatory catalog item.
- Use each supplied catalog product image as the only visual source for product identity. Re-render that exact catalog product as a physical three-dimensional object from the venue camera angle.
- Every catalog-backed element in AUTOMATIC_SCENE_SPEC is a mandatory quoted line item. Make every one visibly recognizable in the result; never summarize the list into a generic decoration or omit a product.
- Catalog line items are raw materials for the installation, not a literal placement diagram. Preserve product identity and installed design quantity while adapting grouping, scale, orientation, and support to make a coherent party scene.
- If a catalog image shows packaging, use the product description and category to render the physical contents in the scene; never place the package, card, or catalog photo on the wall.
- The analyzed reference may describe function, approximate placement, density, palette, backdrop geometry, and lighting placement through AUTOMATIC_SCENE_SPEC. Never use it as a product catalog or copy its object designs.
- Catalog color lock: render every catalog product in its supplied catalog color/material. A black product must remain black, a silver product must remain silver, and a blue product must remain blue. Never recolor, blend, or borrow a product color from the composition reference.
- If a reference color differs from a catalog product, keep the catalog product color exactly; adapt only lighting and integration, never the product identity.
- Never copy a source-image border, crop frame, halo, rectangular pasted image, studio shadow, or collage artifact.

OUTPUT FORMAT
- Output one clean photorealistic scene only.
- Render no visible text at all unless an explicitly selected signage product has approved physical lettering. Never render catalog IDs, product names, prices, arrows, callouts, captions, legends, watermarks, UI, labels, annotations, dimensions, measurements, or explanatory text.
- Never draw placement guides: no colored rectangles, bounding boxes, green or yellow outlines, layer labels, coordinate text, measurement arrows, or callout lines.
- Never add free-floating headings, giant letters, logos, brand marks, or event wording. Do not add printed wording to balloons or decorative surfaces unless that exact printed product and wording are explicitly approved.
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
First verify venue and time of day visibly match SCENE LOCK. Then verify every required element is present exactly once or within its automatic quantity range, every item belongs to one cohesive installation, no object floats without support, forbidden elements are absent, target placement is respected, rear layers remain behind foreground layers, protected venue regions are unchanged, there are zero unapproved visible characters/logos/labels, and the result looks photographed in the requested venue rather than composited.

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
  const colorVariety = colorVarietyContract(sceneSpec);
  const materialContract = materialEstimateContract(sceneSpec);

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
    materialContract,
    `COLOR VARIETY / MATERIAL MIX: ${colorVariety.join(" ")}`,
    "realistic scale, physical supports, floor contact, natural depth, cinematic but believable event lighting, no catalog board, no product packaging, absolutely no visible text, logos, labels, or annotations",
    revisionInstruction?.trim() ? `Revision: ${revisionInstruction.trim().slice(0, 500)}` : undefined,
  ].filter(Boolean);

  return sections.join(". ").slice(0, 3_500);
}
