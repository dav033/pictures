import { buildImagePrompt } from "@/lib/ia/build-image-prompt";
import { imagenDe, resolverProveedor } from "@/lib/ia/registro";
import { buildApprovedSceneSpec } from "@/lib/ia/scene-spec";
import { ErrorIA, type Imagen, type ImagenEtiquetada, type PeticionImagen, type ProveedorId } from "@/lib/ia/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";

export const maxDuration = 120;

type Body = { json: unknown; instruccion?: string; imagenes?: Imagen[]; proveedor?: string; aspecto?: PeticionImagen["aspecto"] };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
}

/** Laboratory-only adapter. Production generation accepts v2 only. */
function adaptV1(value: Record<string, unknown>): ReferenceBlueprintV2 {
  const references = Array.isArray(value.referencias) ? value.referencias : [];
  const elements = references.flatMap((reference) => {
    const source = object(reference);
    const imageId = text(source.id, "REF_01");
    const decorations = Array.isArray(source.decoraciones) ? source.decoraciones : [];
    const anchors = Array.isArray(source.anclas_espaciales) ? source.anclas_espaciales : [];
    return decorations.slice(0, 30).map((decoration, index) => {
      const item = object(decoration);
      const anchor = object(anchors[index] ?? {});
      const categoryName = text(item.elemento, "other").toLowerCase();
      const category = categoryName.includes("cortina") || categoryName.includes("drape") ? "curtain" : categoryName.includes("globo") ? "balloon_structure" : categoryName.includes("flor") ? "floral" : "other";
      return {
        element_id: `${imageId}_E${String(index + 1).padStart(2, "0")}`,
        source_image_id: imageId,
        name: text(item.elemento, "decorative element"),
        category,
        scene_role: "midground" as const,
        detection_confidence: 1,
        visible_evidence: text(item.ubicacion, "Visible in the supplied laboratory reference."),
        reference_bbox: { x: number(anchor.x_pct, 10) / 100, y: number(anchor.y_pct, 10) / 100, width: Math.max(0.01, number(anchor.ancho_pct, 20) / 100), height: Math.max(0.01, number(anchor.alto_pct, 30) / 100) },
        depth_layer: index,
        include_policy: "include" as const,
        approved: true,
        source_type: "reference_only" as const,
        quantity: { mode: "approximate" as const, min: 1, max: 1 },
        appearance: { observed_colors: Array.isArray(item.colores) ? item.colores.filter((color): color is string => typeof color === "string").slice(0, 8) : ["not determinable"], resolved_colors: [], color_policy: "match_reference" as const, material: text(item.material_textura, "material not determinable"), shape: text(item.forma, "shape not determinable") },
        relationships: [],
        uncertainties: Array.isArray(source.incertidumbres) ? source.incertidumbres.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
      };
    });
  });
  const imageIds = references.map((reference) => text(object(reference).id, "REF_01"));
  return ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: imageIds.map((image_id) => ({ image_id, approved_roles: ["composition_reference", "element_reference", "palette_reference"] })),
    elements,
    composition: { focal_point: "laboratory reference composition", density: "moderate", symmetry: "unknown", negative_space: ["as specified by legacy fixture"] },
    palette: { observed: [], priority: [] },
    unresolved_decisions: [],
  });
}

function parseBlueprint(value: unknown): ReferenceBlueprintV2 {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const root = object(parsed);
  if (root.schema_version === "2.0") return ReferenceBlueprintV2Schema.parse(root);
  if (root.version === 1) return adaptV1(root);
  throw new Error("Laboratory accepts Blueprint v2 or legacy v1 fixtures only.");
}

function statusDe(cause: ErrorIA["causa"]): number {
  if (cause === "sin_llave") return 503;
  if (cause === "cuota") return 429;
  if (cause === "filtrado") return 422;
  if (cause === "timeout") return 504;
  return 502;
}

export async function POST(request: Request) {
  let provider: ProveedorId | undefined;
  try {
    const body = await request.json() as Body;
    const blueprint = parseBlueprint(body.json);
    const images = body.imagenes ?? [];
    if (images.length && images.length !== blueprint.source_images.length) throw new Error("Attached images must match source_images count and order.");
    const targetBoxes = Object.fromEntries(blueprint.elements.map((element) => [element.element_id, element.reference_bbox]));
    const sceneSpec = buildApprovedSceneSpec({ blueprint, aspectRatio: body.aspecto ?? "3:2", targetBoxes, generationMode: "text_to_image", createdBy: "user_approval" });
    provider = resolverProveedor({ override: body.proveedor, cookie: request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1] });
    const port = await imagenDe(provider);
    const labelled: ImagenEtiquetada[] = images.map((image, index) => ({ ...image, id: blueprint.source_images[index].image_id, descripcion: "Approved laboratory reference role." }));
    const inputs = labelled.map((image, index) => ({ ...image, role: index === 0 ? "composition_reference" as const : "element_reference" as const, priority: index + 1, allowed_use: "Recreate only approved elements and relationships from the scene specification." }));
    const prompt = buildImagePrompt({ sceneSpec, inputs: inputs.map((input) => ({ image_id: input.id, role: input.role, allowed_use: input.allowed_use })), revisionInstruction: body.instruccion });
    const result = await port.generar({ prompt, sceneSpec, inputs, aspecto: body.aspecto ?? "3:2", calidad: "alta" });
    return Response.json({ imagen: `data:${result.imagen.mime};base64,${result.imagen.base64}`, blueprint, sceneSpec, prompt, proveedor: provider });
  } catch (error) {
    if (error instanceof ErrorIA) return Response.json({ error: error.message, causa: error.causa, proveedor: error.proveedor }, { status: statusDe(error.causa) });
    return Response.json({ error: error instanceof Error ? error.message : "Laboratory generation failed." }, { status: 400 });
  }
}

