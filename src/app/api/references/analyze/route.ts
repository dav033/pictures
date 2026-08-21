import { analizarReferenciasV2 } from "@/lib/ia/analizar-referencias-v2";
import { chatDe, resolverProveedor } from "@/lib/ia/registro";
import { ErrorIA, type Imagen, type ImagenEtiquetada, type ProveedorId } from "@/lib/ia/tipos";
import { obtenerProductos } from "@/lib/products";
import { productosParaMatchingReferencia } from "@/lib/shopify/consultas";

export const maxDuration = 120;

type Body = { images?: Imagen[]; proveedor?: string };

function statusDe(causa: ErrorIA["causa"]): number {
  if (causa === "sin_llave") return 503;
  if (causa === "cuota") return 429;
  if (causa === "filtrado") return 422;
  if (causa === "timeout") return 504;
  return 502;
}

function validarImagenes(images: Imagen[]): void {
  if (images.length < 1 || images.length > 3) throw new Error("Attach between one and three reference images.");
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  let total = 0;
  for (const image of images) {
    if (!allowed.has(image.mime)) throw new Error("Only PNG, JPEG, and WebP reference images are supported.");
    if (!image.base64 || image.base64.length > 28_000_000) throw new Error("A reference image is too large.");
    if (image.ancho !== undefined && (image.ancho < 128 || image.ancho > 12_000)) throw new Error("Reference width is outside the supported range.");
    if (image.alto !== undefined && (image.alto < 128 || image.alto > 12_000)) throw new Error("Reference height is outside the supported range.");
    total += image.base64.length;
  }
  if (total > 60_000_000) throw new Error("Reference payload is too large.");
}

export async function POST(request: Request) {
  let id: ProveedorId | undefined;
  try {
    const body = await request.json() as Body;
    const images = body.images ?? [];
    validarImagenes(images);
    const cookie = request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1];
    id = resolverProveedor({ override: body.proveedor, cookie });
    const chat = await chatDe(id);
    const references: ImagenEtiquetada[] = images.map((image, index) => ({
      ...image,
      id: `REF_${String(index + 1).padStart(2, "0")}`,
      descripcion: "Reference image pending forensic analysis.",
    }));
    const catalogo = [...obtenerProductos(), ...productosParaMatchingReferencia()]
      .filter((product, index, products) => products.findIndex((candidate) => candidate.id === product.id) === index)
      .slice(0, 240)
      .map(({ id, nombre, categoria, colores, descripcion }) => ({ id, nombre, categoria, colores, descripcion }));
    const result = await analizarReferenciasV2(chat, references, catalogo);
    return Response.json({ blueprint: result.blueprint, metadata: { ...result.metadata, image_dimensions: references.map((image) => ({ image_id: image.id, original: { width: image.originalAncho ?? null, height: image.originalAlto ?? null }, processed: { width: image.ancho ?? null, height: image.alto ?? null } })) }, proveedor: id });
  } catch (error) {
    if (error instanceof ErrorIA) return Response.json({ error: error.message, causa: error.causa, proveedor: error.proveedor }, { status: statusDe(error.causa) });
    return Response.json({ error: error instanceof Error ? error.message : "Reference analysis failed." }, { status: 400 });
  }
}
