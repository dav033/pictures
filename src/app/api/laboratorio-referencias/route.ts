import { buildImagePrompt } from "@/lib/ia/build-image-prompt";
import { imagenDe, resolverProveedor } from "@/lib/ia/registro";
import { buildApprovedSceneSpec } from "@/lib/ia/scene-spec";
import { ErrorIA, type Imagen, type ImagenEtiquetada, type PeticionImagen, type ProveedorId } from "@/lib/ia/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";

export const maxDuration = 120;

type Body = { json: unknown; instruccion?: string; imagenes?: Imagen[]; proveedor?: string; aspecto?: PeticionImagen["aspecto"] };

function parseBlueprint(value: unknown): ReferenceBlueprintV2 {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return ReferenceBlueprintV2Schema.parse(parsed);
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
    const result = await port.generar({ prompt, sceneSpec, inputs, aspecto: body.aspecto ?? "3:2", calidad: "alta", signal: request.signal });
    return Response.json({ imagen: `data:${result.imagen.mime};base64,${result.imagen.base64}`, blueprint, sceneSpec, prompt, proveedor: provider });
  } catch (error) {
    if (error instanceof ErrorIA) return Response.json({ error: error.message, causa: error.causa, proveedor: error.proveedor }, { status: statusDe(error.causa) });
    return Response.json({ error: error instanceof Error ? error.message : "Laboratory generation failed." }, { status: 400 });
  }
}
