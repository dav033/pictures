import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BBoxSchema,
  ReferenceBlueprintV2Schema,
  type ReferenceBlueprintV2,
  type ReferenceElement,
} from "./reference-blueprint";

const texto = (max: number) => z.string().trim().min(1).max(max);

const VenueRegionSchema = z
  .object({ region_id: texto(60), bbox: BBoxSchema })
  .strict();

const RelationshipSchema = z
  .object({
    type: z.enum(["behind", "in_front_of", "overlaps", "aligned_with", "supports"]),
    target_element_id: texto(80),
  })
  .strict();

const SceneElementSchema = z
  .object({
    element_id: texto(80),
    name: texto(160),
    category: texto(80),
    source_type: z.enum(["catalog_backed", "reference_only"]),
    source_image_id: texto(40).optional(),
    catalog_product_id: texto(160).optional(),
    // Todos los ids del "bill of materials" cuando el elemento se arma con
    // más de un producto (ej. globos rojos + verdes + dorados para un árbol
    // de globos) — `catalog_product_id` sigue siendo solo el principal, este
    // array es la lista completa que necesita ver el modelo de imagen y la
    // cotización.
    catalog_product_ids: z.array(texto(160)).max(6).optional(),
    required: z.boolean(),
    quantity: z
      .object({ mode: z.enum(["exact", "approximate", "range"]), min: z.number().int().min(0).max(999), max: z.number().int().min(0).max(999) })
      .strict()
      .refine((value) => value.max >= value.min, "quantity.max must be >= quantity.min"),
    target_bbox: BBoxSchema,
    depth_layer: z.number().int().min(0).max(99),
    resolved_colors: z.array(texto(80)).max(8),
    identity_constraints: z.array(texto(220)).max(12),
    relationships: z.array(RelationshipSchema).max(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source_type === "catalog_backed" && !value.catalog_product_id) {
      ctx.addIssue({ code: "custom", path: ["catalog_product_id"], message: "Catalog-backed elements require a catalog_product_id." });
    }
    if (value.source_type === "reference_only" && value.catalog_product_id) {
      ctx.addIssue({ code: "custom", path: ["catalog_product_id"], message: "Reference-only elements cannot contain a catalog_product_id." });
    }
  });

export const SceneSpecSchema = z
  .object({
    schema_version: z.literal("1.0"),
    generation_mode: z.enum(["text_to_image", "edit_venue", "revise_current_result"]),
    canvas: z
      .object({
        aspect_ratio: z.enum(["3:2", "1:1", "2:3", "16:9"]),
        content_rect: BBoxSchema,
      })
      .strict(),
    venue: z
      .object({
        source_image_id: texto(40).optional(),
        preserve: z.array(texto(160)).max(30),
        protected_regions: z.array(VenueRegionSchema).max(80),
        editable_regions: z.array(VenueRegionSchema).max(80),
      })
      .strict(),
    elements: z.array(SceneElementSchema).max(80),
    positive_prompt: z
      .object({
        required_elements: z.array(texto(320)).max(80),
        composition: z.array(texto(320)).max(20),
        venue_preservation: z.array(texto(320)).max(20),
        photorealistic_integration: z.array(texto(320)).max(20),
      })
      .strict(),
    negative_prompt: z
      .object({
        forbidden_elements: z.array(texto(240)).max(100),
        forbidden_venue_changes: z.array(texto(240)).max(30),
        forbidden_compositing_artifacts: z.array(texto(240)).max(30),
      })
      .strict(),
    metadata: z
      .object({
        blueprint_hash: texto(128).optional(),
        created_by: z.enum(["server_default", "user_approval", "revision"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.elements.map((element) => element.element_id));
    for (const element of value.elements) {
      for (const relationship of element.relationships) {
        if (!ids.has(relationship.target_element_id)) {
          ctx.addIssue({ code: "custom", path: ["elements"], message: `Unknown relationship target: ${relationship.target_element_id}` });
        }
      }
      if (value.generation_mode === "edit_venue" && !value.venue.source_image_id) {
        ctx.addIssue({ code: "custom", path: ["venue", "source_image_id"], message: "edit_venue requires a venue source image." });
      }
    }
    const visit = (id: string, path: string[], visiting: Set<string>, visited: Set<string>) => {
      if (visiting.has(id)) {
        ctx.addIssue({ code: "custom", path: ["elements"], message: `Layer relationship cycle: ${[...path, id].join(" -> ")}` });
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      const current = value.elements.find((element) => element.element_id === id);
      for (const relation of current?.relationships ?? []) {
        if (relation.type === "behind" || relation.type === "in_front_of") visit(relation.target_element_id, [...path, id], visiting, visited);
      }
      visiting.delete(id);
      visited.add(id);
    };
    const visited = new Set<string>();
    for (const element of value.elements) visit(element.element_id, [], new Set(), visited);
  });

export type SceneSpec = z.infer<typeof SceneSpecSchema>;
export type SceneElement = SceneSpec["elements"][number];

export const VENUE_PRESERVATION = [
  "camera position",
  "crop and framing",
  "walls and ceiling",
  "floor and floor line",
  "doors and windows",
  "existing furniture",
  "people and architecture",
  "ambient lighting and white balance",
];

export function resolveElementColors(input: {
  override?: string[];
  catalogColors?: string[];
  policy: ReferenceElement["appearance"]["color_policy"];
  eventPalette?: string[];
  observedColors: string[];
}): string[] {
  if (input.override?.length) return input.override.slice(0, 8);
  if (input.catalogColors?.length) return input.catalogColors.slice(0, 8);
  if (input.policy === "adapt_to_event_palette" && input.eventPalette?.length) return input.eventPalette.slice(0, 8);
  if (input.policy === "custom") return input.eventPalette?.slice(0, 8) ?? input.observedColors.slice(0, 8);
  return input.observedColors.slice(0, 8);
}

export function blueprintHash(blueprint: ReferenceBlueprintV2): string {
  return createHash("sha256").update(JSON.stringify(blueprint)).digest("hex");
}

export function sceneSpecHash(sceneSpec: SceneSpec): string {
  return createHash("sha256").update(JSON.stringify(sceneSpec)).digest("hex");
}

/**
 * Une partes con un separador sin cortar a mitad de palabra cuando se pasa
 * del límite — un elemento con 4+ materiales fácilmente supera los 180-220
 * caracteres que acepta cada `identity_constraint`; truncar con `.slice()`
 * a ciegas partía el nombre del último material justo donde importaba.
 */
function joinWithinLimit(parts: string[], limit: number, joiner = "; "): string {
  let result = "";
  for (let i = 0; i < parts.length; i++) {
    const candidate = result ? `${result}${joiner}${parts[i]}` : parts[i];
    const remaining = parts.length - i - 1;
    const reserve = remaining > 0 ? joiner.length + String(remaining).length + 6 : 0;
    if (candidate.length + reserve > limit) {
      return remaining > 0 ? `${result}${joiner}+${remaining} more` : result;
    }
    result = candidate;
  }
  return result;
}

function placementDescription(target: z.infer<typeof BBoxSchema>, category: string): string {
  if (["curtain", "drape", "backdrop", "panel"].includes(category)) return "rear background surface spanning the central decoration area";
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  const horizontal = centerX < 0.34 ? "left" : centerX > 0.66 ? "right" : "center";
  const vertical = centerY < 0.34 ? "upper" : centerY > 0.66 ? "lower" : "middle";
  return `${vertical} ${horizontal} area of the composition`;
}

export function buildApprovedSceneSpec(input: {
  blueprint: ReferenceBlueprintV2;
  aspectRatio: SceneSpec["canvas"]["aspect_ratio"];
  venueImageId?: string;
  targetBoxes: Record<string, z.infer<typeof BBoxSchema>>;
  eventPalette?: string[];
  colorOverrides?: Record<string, string[]>;
  // Un elemento puede necesitar más de un producto real para armarse (ej.
  // árbol de globos = globos rojos + verdes + dorados) — cada entrada es un
  // material del "bill of materials", en orden con el principal primero.
  catalogProducts?: Record<string, Array<{ id: string; name: string; description: string; category: string; colors?: string[]; unitsPerPackage?: number; packageCount?: number; share: number; role: string }>>;
  protectedRegions?: Array<z.infer<typeof VenueRegionSchema>>;
  editableRegions?: Array<z.infer<typeof VenueRegionSchema>>;
  generationMode?: SceneSpec["generation_mode"];
  createdBy?: SceneSpec["metadata"]["created_by"];
  catalogOnly?: boolean;
}): SceneSpec {
  ReferenceBlueprintV2Schema.parse(input.blueprint);
  const elements = input.blueprint.elements
    .filter((element) => element.approved && element.include_policy !== "exclude")
    .map((element) => {
      const target = input.targetBoxes[element.element_id];
      if (!target) throw new Error(`Missing target placement for approved element ${element.element_id}.`);
      const materials = input.catalogProducts?.[element.element_id] ?? [];
      const product = materials[0];
      if (element.source_type === "catalog_backed" && materials.length === 0) {
        throw new Error(`Missing catalog match for ${element.element_id}.`);
      }
      if (input.catalogOnly && element.source_type !== "catalog_backed") {
        throw new Error(`Reference-only element cannot enter image generation: ${element.element_id}.`);
      }
      // `element.name` viene del análisis de la referencia (ej. "Arco orgánico
      // de globos navideño") y es lo único que describe la FORMA objetivo.
      // El nombre del producto de catálogo ("E-Decor Navidad Coronas") es solo
      // un SKU genérico — si reemplaza a `element.name` aquí, la forma se
      // pierde para el resto del scene spec y el prompt solo sabe "usa este
      // producto", nunca "arma esto como un arco".
      const productName = element.name;
      const isMultiMaterial = materials.length > 1;
      return {
        element_id: element.element_id,
        name: productName,
        category: element.category,
        source_type: element.source_type,
        source_image_id: element.source_image_id,
        catalog_product_id: element.source_type === "catalog_backed" ? product?.id : undefined,
        catalog_product_ids: materials.length ? materials.map((material) => material.id) : undefined,
        required: true,
        quantity: element.quantity,
        target_bbox: target,
        depth_layer: element.depth_layer,
        resolved_colors: isMultiMaterial
          ? [...new Set(materials.flatMap((material) => material.colors ?? []))].slice(0, 8)
          : resolveElementColors({
            override: input.colorOverrides?.[element.element_id],
            catalogColors: product?.colors,
            policy: element.appearance.color_policy,
            eventPalette: input.eventPalette ?? input.blueprint.palette.priority,
            observedColors: element.appearance.observed_colors,
          }),
        identity_constraints: [
          // `required_elements` (la sección MUST INCLUDE, lo primero y más
          // pesado que lee el modelo) solo toma los primeros DOS constraints
          // de esta lista — si la forma objetivo cae después de ese corte
          // (como pasaba antes con la descripción genérica del producto en
          // el slot #2), el modelo nunca la ve ahí y termina copiando la
          // silueta de la foto del catálogo en vez de la forma pedida.
          isMultiMaterial
            ? `Required final arrangement/shape for this element: "${productName}", hand-built by combining ${materials.length} catalog materials together — never render only one of them alone (see materials breakdown).`
            : product
              ? `Required final arrangement/shape for this element: "${productName}". Use catalog product "${product.name}" only for balloon/material color, print, size, and texture — its catalog photo may show a different sample arrangement (e.g., a small bouquet, single unit, or flat kit); do not copy that arrangement or overall silhouette.`
              : `Use catalog product exactly: ${productName}.`,
          // Desglose de materiales aparte del resumen de forma (arriba): un
          // solo string con los N materiales fácilmente pasa los 220
          // caracteres que acepta cada constraint y `joinWithinLimit` corta
          // en un límite de entrada completa, nunca a mitad de nombre.
          isMultiMaterial
            ? `Materials breakdown: ${joinWithinLimit(materials.map((material) => `${Math.round(material.share * 100)}% ${material.role} = "${material.name}"`), 210)}.`
            : "",
          // Razonamiento propio del análisis de referencia sobre este match
          // específico (por qué se eligió, y cómo adaptarlo) — hasta ahora
          // solo se mostraba al cliente en el panel de revisión; nunca
          // llegaba al prompt que realmente ve el modelo de imagen.
          element.model_decision?.adaptation ?? "",
          isMultiMaterial
            ? `Catalog colors per material: ${joinWithinLimit(materials.map((material) => `"${material.name}": ${material.colors?.join(", ") || "as shown"}`), 210)}.`
            : `Catalog colors: ${product?.colors?.join(", ") || "as shown in catalog image"}.`,
          isMultiMaterial ? element.appearance.composition : (product?.description ?? ""),
          `Catalog category: ${product?.category ?? element.category}.`,
          isMultiMaterial
            ? `Quoted quantity per material: ${joinWithinLimit(materials.map((material) => `"${material.name}": ${material.packageCount ?? 1}x${material.unitsPerPackage ?? 1}u`), 190)}; use the full combined quantity across all materials.`
            : product?.unitsPerPackage ? `Quoted quantity: ${product.packageCount ?? 1} package(s) of ${product.unitsPerPackage} physical units; use the full quoted quantity in the installation.` : "Use the full quoted package or kit contents; do not reduce it to one isolated sample.",
          "CATALOG COLOR LOCK: preserve supplied catalog color exactly; never recolor this product from the reference palette.",
          "MANDATORY QUOTED CATALOG ITEM: visibly represent this product in the final scene; do not omit or replace it.",
          ...(element.scene_role === "lighting" ? ["Place lighting in the reference backdrop zone behind/around the decoration; do not move it to the ceiling unless the catalog product is explicitly a ceiling light."] : []),
          ...(element.scene_role === "backdrop" ? ["Use this product across the rear backdrop zone, aligned with the reference composition; do not turn it into a different background type."] : []),
          element.appearance.material,
          element.appearance.shape,
          ...element.uncertainties.map((item) => `Do not invent: ${item}`),
        ].filter(Boolean).slice(0, 12).map((constraint) => constraint.slice(0, 180)),
        relationships: element.relationships,
      } satisfies SceneElement;
    });

  const approvedIds = new Set(elements.map((element) => element.element_id));
  const forbidden = input.blueprint.elements
    .filter((element) => !approvedIds.has(element.element_id))
    .map((element) => `${element.name} (${element.category})`);
  const scene: SceneSpec = {
    schema_version: "1.0",
    generation_mode: input.generationMode ?? (input.venueImageId ? "edit_venue" : "text_to_image"),
    canvas: { aspect_ratio: input.aspectRatio, content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: {
      source_image_id: input.venueImageId,
      preserve: VENUE_PRESERVATION,
      protected_regions: input.protectedRegions ?? [],
      editable_regions: input.editableRegions ?? elements.map((element) => ({ region_id: `EDIT_${element.element_id}`, bbox: element.target_bbox })),
    },
    elements,
    positive_prompt: {
      required_elements: elements.map((element) => `${element.name}; MANDATORY VISIBLE CATALOG ITEM; quantity: ${element.quantity.min === element.quantity.max ? `${element.quantity.min} physical units` : `${element.quantity.min}-${element.quantity.max} physical units`}; identity: ${element.identity_constraints.slice(0, 2).join(" ")}; colors: ${element.resolved_colors.join(", ")}; placement: ${placementDescription(element.target_bbox, element.category)}.`.slice(0, 320)),
      composition: [input.blueprint.composition.focal_point, `Density: ${input.blueprint.composition.density}.`, `Symmetry: ${input.blueprint.composition.symmetry}.`, `Keep negative space: ${input.blueprint.composition.negative_space.join(", ") || "as specified by venue"}.`, "Design one cohesive, event-ready installation with a clear focal point, visual hierarchy, balanced color, natural asymmetry, and believable physical support. Any scale variation between balloons must stay within the exact diameters stated for each mandatory element below — never invent a size not listed.", "Treat selected catalog products as ingredients for one party setup, not as isolated objects or a flat product list."],
      // Instrucción concentrada en vez de una lista larga ítem por ítem
      // ("Preserve camera position.", "Preserve floor.", ...): Google
      // documenta que edición-con-preservación funciona mejor con una
      // instrucción directa de "esto es una edición local, no una escena
      // nueva" que con una enumeración exhaustiva de qué no tocar.
      venue_preservation: input.venueImageId
        ? [
            `This is a local edit of the real photo ${input.venueImageId}, not a new scene. Change pixels ONLY inside the editable regions below; every other pixel must come out identical to the source — same camera, crop, architecture (walls, ceiling, floor, doors, windows), furniture, and ambient lighting.`.slice(0, 320),
            `Treat the untouched areas as a hard constraint, not a style reference: do not regenerate, reinterpret, relight, or redraw them even if that would look more polished.`.slice(0, 320),
          ]
        : [],
      photorealistic_integration: ["Act as an event designer: turn the selected products into a polished, creative, usable party installation.", "Render every catalog-backed scene element visibly; each quoted product is mandatory, even when it is a backdrop or small accent.", "Respect the quotation: use every physical unit included in each purchased package or kit. Creative freedom applies to arrangement, grouping, scale, orientation, and support, never to inventing extra products or reducing a package to one sample.", "Treat the product list as ingredients, not a layout: group compatible balloons into an arch, garland, columns, or balanced clusters; vary scale and depth instead of spacing one object per product.", "Use accent kits, signs, and themed props as integrated focal-point details; never show product packaging or a catalog cutout as the decoration.", "Preserve each catalog product's supplied color exactly; reference palette cannot recolor catalog items.", "Place curtain, drape, backdrop, and panel elements as rear background surfaces behind the balloon decoration, spanning their target boxes.", "Place string lights and other lighting elements in the rear backdrop zone behind or around the decoration; never move them to the ceiling unless the catalog product is explicitly a ceiling light.", "Render only supplied catalog products as physical objects from the venue camera angle.", "Match perspective, scale, focus, white balance, light direction, contact shadows, occlusion, and surface contact.", "Use natural overlap and depth between layers; every item must touch, hang from, rest on, or clearly belong to the installation.", "Do not leave loose single balloons floating in empty space when they can be grouped into the main installation.", "Rebuild the scene from catalog products; never reproduce the reference image as a collage."],
    },
    negative_prompt: {
      forbidden_elements: [...forbidden, "extra balloons, garlands, tables, signs, flowers, plants, lights, furniture, people, text, logos, or party props not explicitly approved or beyond quoted package quantities"],
      forbidden_venue_changes: input.venueImageId
        ? [`Do not move, replace, redesign, widen, narrow, repaint, relight, or rebuild any part of ${input.venueImageId} outside the editable regions — treat it as a fixed photo you are drawing on top of, not a description to reinterpret.`.slice(0, 240)]
        : [],
      forbidden_compositing_artifacts: ["No source-image background, rectangular crop, border, halo, studio shadow, flat sticker, cutout edge, pasted rectangle, floating object, impossible support, mismatched sharpness, or mismatched lighting.", "No catalog IDs, labels, callouts, arrows, captions, prices, watermarks, UI, or explanatory text in the output.", "No product cards, packages, catalog boards, isolated floating catalog cutouts, or evenly spaced inventory display.", "If a CATALOG_* image shows retail packaging (box art, QR code, printed icons), its graphic design is not a style cue: never reproduce a legend, color-swatch key, diagram, or pointer arrows in the output.","No catalog color drift: never turn black catalog products blue, blue products black, or silver products blue.", "Do not copy reference product designs; use catalog products only for object identity while preserving reference composition."],
    },
    metadata: { blueprint_hash: blueprintHash(input.blueprint), created_by: input.createdBy ?? "server_default" },
  };
  return SceneSpecSchema.parse(scene);
}
