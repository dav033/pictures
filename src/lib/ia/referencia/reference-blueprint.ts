import { createHash } from "node:crypto";
import { z } from "zod";
import { LecturaArmadoSchema } from "../../plan/armado-bouquet";
import { RemateLeidoSchema } from "../../plan/armado-columna";
import { LecturaGuirnaldaSchema } from "../../plan/armado-guirnalda";
import { LecturaConteoSchema } from "../../plan/conteo-referencia";
import { PistaPatronSchema, TAMANOS_LEIDOS } from "../../plan/patron-color";
import { VisualSemanticsSchema } from "../escena/lora-semantics";
import {
  CatalogVisualDescriptorSchema,
  PhysicalFormSchema,
  PhysicalRelationSchema,
  QuantitySemanticsSchema,
  SceneAnchorSchema,
  SceneElementKindSchema,
} from "../escena/scene-visual-contract";

const texto = (max: number) => z.string().trim().min(1).max(max);

export const BBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .strict();

export const ReferenceRoleSchema = z.enum([
  "composition_reference",
  "element_reference",
  "palette_reference",
  "style_reference",
  "catalog_product_reference",
  "venue_base",
]);

const QuantitySchema = z
  .object({
    mode: z.enum(["exact", "approximate", "range"]),
    min: z.number().int().min(0).max(999),
    max: z.number().int().min(0).max(999),
  })
  .strict()
  .refine((value) => value.max >= value.min, "quantity.max must be >= quantity.min");

/**
 * Participación medida de un color del catálogo dentro de la caja del elemento
 * (fase 2.1). `observed_colors` son NOMBRES que el analizador propone y su orden
 * es el orden en que los escribió; esto es la fracción de píxeles, medida.
 */
const MeasuredColorSchema = z
  .object({
    color: texto(40),
    share: z.number().min(0).max(1),
  })
  .strict();

/**
 * Patrón de color que la detección en Python leyó en la foto para este
 * elemento (ADR-0028 §11): la pista del plan sin el id, que aquí es el propio
 * elemento. Es una pista, no una decisión: al confirmar el plan viaja como
 * `pistas_patron` y Python decide si cubre los colores de la estructura o usa
 * el preset. Sus colores son nombres de la paleta del catálogo.
 */
export const PatronColorReferenciaSchema = PistaPatronSchema.omit({ referencia_element_id: true });

/**
 * Una referencia real del catálogo Sempertex medida en los píxeles de la pieza (`color-sempertex.ts`): el
 * código de la lámina, su familia y el color con el que se pide («Satín Rosado»). Es lo que decide **qué
 * globo se compra**: la paleta de 26 palabras funde «Satín Rosado» y «Pastel Mate Rosado» en un solo
 * «rosado», y el plan acababa comprando un Reflex Fucsia para una columna pastel (2026-10-04).
 * `familia_fiable` es falso cuando la foto no permitió decidir la familia (dos referencias casi iguales, o
 * el analizador no dijo el acabado): entonces solo cuenta el color.
 */
export const ReferenciaMedidaSchema = z
  .object({
    codigo: z.string().regex(/^[0-9]{3}$/),
    familia: texto(20),
    /** El color de la lámina en español, sin la familia («Rosado», «Plata»). */
    nombre: texto(60),
    /** Familia y color, como se pide el globo («Satín Rosado»). */
    nombre_completo: texto(80),
    /** Parte de la pieza que ocupa, de 0 a 1. */
    parte: z.number().min(0).max(1),
    familia_fiable: z.boolean(),
  })
  .strict();

const AppearanceSchema = z
  .object({
    observed_colors: z.array(texto(80)).max(8),
    /** Opcional: las referencias Sempertex medidas en la pieza, de mayor a menor parte (`ReferenciaMedidaSchema`). */
    referencias_medidas: z.array(ReferenciaMedidaSchema).max(5).optional(),
    /**
     * Opcional: los blueprints anteriores a la fase 2.1 y las referencias que
     * no traen píxeles (una descripción sin foto) no la tienen. Ordenada de
     * mayor a menor participación.
     */
    measured_colors: z.array(MeasuredColorSchema).max(12).optional(),
    resolved_colors: z.array(texto(80)).max(8),
    color_policy: z.enum(["match_reference", "adapt_to_event_palette", "custom"]),
    material: texto(160),
    shape: texto(160),
    // Cómo se arma físicamente el elemento cuando necesita más de un material
    // (ej. "60% globos rojos en la base, 30% verdes subiendo, 10% acentos
    // dorados en la punta") — sin esto, un elemento multi-material solo tenía
    // una `shape` de texto libre sin desglose real de proporciones.
    composition: texto(240).default("single uniform material"),
    /** Opcional: solo con la detección encendida y en estructuras de globos donde leyó un patrón. */
    patron_color: PatronColorReferenciaSchema.optional(),
    /**
     * Opcional: qué corona una columna de la foto (ADR-0039). Lo lee la misma
     * llamada que el patrón de color y solo en columnas. Va **aparte** de
     * `patron_color` a propósito: el remate no es una disposición de color (una
     * columna de un solo color puede llevar su globo igual) y `patron_color`
     * viaja dentro del plan firmado, donde una lectura no tiene sitio. Al
     * confirmar el plan viaja a la receta del motor, que decide si la usa.
     */
    remate_columna: RemateLeidoSchema.optional(),
    /**
     * Opcional: qué tamaños de globo tiene la pieza en la foto (`TAMANOS_LEIDOS`).
     * Aquí y no dentro de `patron_color` por la misma razón que el remate: no es
     * una disposición de color, y una pieza de un solo color —que no deja
     * `patron_color`— tiene tamaños que se ven igual de bien. Al confirmar el
     * plan viaja en su propia pista y elige la mezcla, que es lo que se compra.
     */
    tamanos_leidos: z.enum(TAMANOS_LEIDOS).optional(),
    /**
     * Hacia dónde se va la pieza y cuánto, en **fracción de su altura**: negativo
     * a la izquierda. Sale de `curves_toward` y `top_overhang` del análisis, que
     * el modelo ya contesta para cada estructura, con las cifras del propio
     * prompt (`inclinacionDe`). Se guarda aquí porque el motor orgánico sí sabe
     * inclinar una pieza (`forma.inclinacionM` de la columna, `pendienteM` y
     * `carga` de la guirnalda) y hasta ahora nadie se lo decía: todas salían
     * rectas (2026-10-03).
     */
    inclinacion: z.number().min(-1).max(1).optional(),
    /**
     * La pieza entera es de este color, dicho por quien miró la foto. Es lo que
     * decide que el plan compre **un** material en vez de tres.
     *
     * Hace falta porque `observed_colors` no distingue el color de un globo de
     * su reflejo: un cromado es un espejo y devuelve los marrones y los rosas de
     * la pared y del piso. Una columna de dorado cromado acababa comprando
     * dorado, café y oro rosa a tercios (2026-10-03). La lectura sí sabe
     * separarlos, y esto es lo que dice.
     */
    color_unico: z.string().trim().min(1).max(80).optional(),
    /**
     * Opcional: cómo está armado un bouquet de la foto (ADR-0030). Solo con la
     * lectura encendida y en bouquets. Es una pista: al confirmar el plan viaja
     * como `pistas_armado` y Python decide si la usa.
     */
    armado_bouquet: LecturaArmadoSchema.optional(),
    /**
     * Opcional: cuántos globos tiene la pieza según la foto (ADR-0031). Solo con
     * la lectura encendida y en estructuras de globos. Es una lectura: ningún
     * plan la usa todavía.
     */
    conteo: LecturaConteoSchema.optional(),
    /**
     * Opcional: cómo está armada una guirnalda de la foto (ADR-0032, E4). Solo
     * con la lectura encendida. Es una pista: al confirmar el plan viaja como
     * `pistas_guirnalda` y Python decide si la usa, sin tocar la cantidad.
     */
    armado_guirnalda: LecturaGuirnaldaSchema.optional(),
  })
  .strict();

const RelationshipSchema = z
  .object({
    type: z.enum(["behind", "in_front_of", "overlaps", "aligned_with", "supports"]),
    target_element_id: texto(80),
  })
  .strict();

// Una línea de material del "bill of materials": qué producto real, qué rol
// cumple en el armado (ej. "base verde", "acentos dorados"), y qué fracción
// de la cantidad total del elemento representa. `catalog_product_id` en
// `CatalogResolutionSchema` sigue siendo el material principal (primer/mayor
// share) para no romper el código que solo lee un id — `bill_of_materials`
// es la lista completa cuando el elemento necesita más de un material.
const MaterialLineSchema = z
  .object({
    catalog_product_id: texto(160),
    role: texto(160),
    share: z.number().min(0).max(1),
  })
  .strict();

const CatalogResolutionSchema = z
  .object({
    action: z.enum(["include", "omit"]),
    catalog_product_id: texto(160).optional(),
    match_type: z.enum(["exact", "closest", "none"]),
    reason: texto(260),
    adaptation: texto(260),
    // Un plan puede expandir hasta 6 materiales declarados por 4 tamaños
    // físicos en una estructura; conservar todas las variantes evita perder
    // la mezcla real de tamaños antes de construir el scene spec.
    bill_of_materials: z.array(MaterialLineSchema).max(24).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "include" && value.match_type !== "none" && !value.catalog_product_id) {
      ctx.addIssue({ code: "custom", path: ["catalog_product_id"], message: "Included catalog matches require a product id." });
    }
    if (value.action === "omit" && value.catalog_product_id) {
      ctx.addIssue({ code: "custom", path: ["catalog_product_id"], message: "Omitted elements cannot select a catalog product." });
    }
  });

export const ReferenceElementSchema = z
  .object({
    element_id: texto(80),
    source_image_id: texto(40),
    name: texto(160),
    category: z.enum([
      "curtain",
      "drape",
      "backdrop",
      "panel",
      "balloon_structure",
      "plinth",
      "furniture",
      "floral",
      "signage",
      "lighting",
      "tableware",
      "other",
    ]),
    scene_role: z.enum(["backdrop", "midground", "foreground", "accent", "lighting"]),
    detection_confidence: z.number().min(0).max(1),
    visible_evidence: texto(320),
    reference_bbox: BBoxSchema,
    depth_layer: z.number().int().min(0).max(99),
    include_policy: z.enum(["include", "exclude", "ask"]),
    approved: z.boolean(),
    source_type: z.enum(["catalog_backed", "reference_only"]),
    quantity: QuantitySchema,
    appearance: AppearanceSchema,
    relationships: z.array(RelationshipSchema).max(12),
    // Semántica tipada del plan. Opcional para blueprints antiguos y referencias
    // externas que todavía no pasan por el compilador LoRA v2.
    visual_semantics: VisualSemanticsSchema.optional(),
    element_kind: SceneElementKindSchema.optional(),
    quantity_semantics: QuantitySemanticsSchema.optional(),
    physical_form: PhysicalFormSchema.optional(),
    catalog_visual: CatalogVisualDescriptorSchema.optional(),
    physical_relations: z.array(PhysicalRelationSchema).max(2).optional(),
    resolved_finishes: z.array(texto(80)).max(8).optional(),
    uncertainties: z.array(texto(180)).max(8),
    model_decision: CatalogResolutionSchema.optional(),
  })
  .strict();

const SourceImageSchema = z
  .object({
    image_id: texto(40),
    approved_roles: z.array(ReferenceRoleSchema).min(1).max(6),
    /**
     * Ancho entre alto de la foto como se ve (orientación EXIF aplicada). Las `reference_bbox` son fracciones de
     * ESTA foto: sin su proporción, la guía de escena las estiraba sobre un lienzo de otra forma. Opcional: los
     * blueprints anteriores no la traen.
     */
    aspect_ratio: z.number().min(0.1).max(10).optional(),
  })
  .strict();

const CompositionSchema = z
  .object({
    focal_point: texto(240),
    density: z.enum(["sparse", "moderate", "dense", "unknown"]),
    symmetry: z.enum(["symmetric", "asymmetric", "unknown"]),
    negative_space: z.array(texto(120)).max(12),
  })
  .strict();

const PaletteSchema = z
  .object({
    observed: z.array(texto(80)).max(12),
    priority: z.array(texto(80)).max(8),
  })
  .strict();

const DecisionSchema = z
  .object({
    decision_id: texto(60),
    element_id: texto(80),
    question: texto(240),
  })
  .strict();

export const ReferenceBlueprintV2Schema = z
  .object({
    schema_version: z.literal("2.0"),
    source_images: z.array(SourceImageSchema).min(1).max(10),
    elements: z.array(ReferenceElementSchema).max(80),
    composition: CompositionSchema,
    palette: PaletteSchema,
    unresolved_decisions: z.array(DecisionSchema).max(40),
    anchors: z.array(SceneAnchorSchema).max(16).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const imageIds = new Set(value.source_images.map((image) => image.image_id));
    const elementIds = new Set<string>();
    for (const element of value.elements) {
      if (!imageIds.has(element.source_image_id)) {
        ctx.addIssue({ code: "custom", path: ["elements"], message: `Unknown source image: ${element.source_image_id}` });
      }
      if (elementIds.has(element.element_id)) {
        ctx.addIssue({ code: "custom", path: ["elements"], message: `Duplicate element id: ${element.element_id}` });
      }
      elementIds.add(element.element_id);
      if (element.source_type === "catalog_backed" && !element.approved) {
        ctx.addIssue({ code: "custom", path: ["elements"], message: "Catalog-backed element must be approved before generation." });
      }
      if (element.approved && element.include_policy === "exclude") {
        ctx.addIssue({ code: "custom", path: ["elements"], message: "Excluded element cannot be approved." });
      }
    }
    for (const element of value.elements) {
      for (const relation of element.relationships) {
        if (!elementIds.has(relation.target_element_id)) {
          ctx.addIssue({ code: "custom", path: ["elements"], message: `Unknown relationship target: ${relation.target_element_id}` });
        }
      }
    }
    detectLayerCycles(value.elements, ctx);
  });

export type ReferenceBlueprintV2 = z.infer<typeof ReferenceBlueprintV2Schema>;
export type ReferenceElement = z.infer<typeof ReferenceElementSchema>;
export type ReferenceBBox = z.infer<typeof BBoxSchema>;
export type MaterialLine = z.infer<typeof MaterialLineSchema>;
export type PatronColorReferencia = z.infer<typeof PatronColorReferenciaSchema>;

export function stableElementId(sourceImageId: string, index: number): string {
  return `${sourceImageId}_E${String(index + 1).padStart(2, "0")}`;
}

export function analysisCacheKey(parts: {
  model: string;
  schemaVersion?: string;
  systemPromptHash: string;
  images: Array<{ image_id: string; mime: string; base64: string }>;
}): string {
  const hash = createHash("sha256")
    .update(parts.model)
    .update(parts.schemaVersion ?? "2.0")
    .update(parts.systemPromptHash);
  for (const image of parts.images) hash.update(image.image_id).update(image.mime).update(image.base64);
  return hash.digest("hex");
}

function bboxIntersection(a: ReferenceBBox, b: ReferenceBBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

/**
 * Installed material units an element declares, or `undefined` when its
 * quantity counts identical pieces (`physical_instances`: the reference
 * analysis, "2 columns") instead of balloons. Plan and catalog blueprints omit
 * `quantity_semantics` and keep material units.
 */
export function unidadesMaterialDeElemento(element: Pick<ReferenceBlueprintV2["elements"][number], "quantity" | "quantity_semantics">): number | undefined {
  if (element.quantity_semantics === "physical_instances") return undefined;
  return element.quantity.max || element.quantity.min || undefined;
}

/** Fraction of `inner`'s area that lies inside `outer` (1 = fully contained). */
export function bboxContainment(inner: ReferenceBBox, outer: ReferenceBBox): number {
  const area = inner.width * inner.height;
  return area ? bboxIntersection(inner, outer) / area : 0;
}

function detectLayerCycles(elements: ReferenceElement[], ctx: z.RefinementCtx): void {
  const edges = new Map(elements.map((element) => [element.element_id, element.relationships
    .filter((relation) => relation.type === "behind" || relation.type === "in_front_of")
    .map((relation) => relation.target_element_id)]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) {
      ctx.addIssue({ code: "custom", path: ["elements"], message: `Layer relationship cycle: ${[...path, id].join(" -> ")}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) visit(next, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const element of elements) visit(element.element_id, []);
}
