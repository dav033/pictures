import "server-only";
import sharp from "sharp";

/**
 * La imagen base de «Ver cómo quedaría» del plan 3D (REQ-007, fase 4): lo que se le da a FLUX como plano que debe conservar.
 *
 * - La captura del navegador es lo único que viene de fuera y son PÍXELES, no texto: aun así se abre con sharp, se comprueba que
 *   sea de verdad un PNG o JPEG de un tamaño y una proporción razonables y se vuelve a codificar (JPEG, lado mayor ≤ 1536 px): sin
 *   metadatos, sin sorpresas de formato y ligera para el viaje a fal.
 * - Sin captura (el navegador no pudo con WebGL), el servidor rasteriza la proyección SVG de la armada (la misma vista de
 *   reserva que ve el cliente), con el patrón de `rasterizar-guia.ts`.
 */
export const LADO_MINIMO_PX = 256;
export const LADO_MAXIMO_PX = 4096;
export const LADO_ENVIADO_PX = 1536;
const PIXELES_MAXIMOS = 16_000_000;
const PROPORCION_MAXIMA = 2;

export type CapturaPreparada = { base64: string; mime: "image/jpeg"; ancho: number; alto: number; bytes: number };
export type RechazoCaptura = { motivo: "formato" | "tamano" | "proporcion" | "ilegible" };

const FONDO = "#e6e6e9";

async function recodificar(origen: Buffer): Promise<CapturaPreparada> {
  const { data, info } = await sharp(origen, { limitInputPixels: PIXELES_MAXIMOS })
    .flatten({ background: FONDO })
    .resize({ width: LADO_ENVIADO_PX, height: LADO_ENVIADO_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  return { base64: data.toString("base64"), mime: "image/jpeg", ancho: info.width, alto: info.height, bytes: data.length };
}

/** Una captura del navegador (data URL ya validada por el esquema), o por qué no sirve. */
export async function prepararCaptura(dataUrl: string): Promise<CapturaPreparada | RechazoCaptura> {
  const partes = /^data:image\/(png|jpeg);base64,([\s\S]+)$/.exec(dataUrl);
  if (!partes) return { motivo: "formato" };
  try {
    const origen = Buffer.from(partes[2]!, "base64");
    const meta = await sharp(origen, { limitInputPixels: PIXELES_MAXIMOS }).metadata();
    if (meta.format !== (partes[1] === "png" ? "png" : "jpeg")) return { motivo: "formato" };
    const { width, height } = meta;
    if (!width || !height || Math.min(width, height) < LADO_MINIMO_PX || Math.max(width, height) > LADO_MAXIMO_PX) return { motivo: "tamano" };
    if (Math.max(width, height) / Math.min(width, height) > PROPORCION_MAXIMA) return { motivo: "proporcion" };
    return await recodificar(origen);
  } catch {
    return { motivo: "ilegible" };
  }
}

/** La proyección SVG de la armada, rasterizada como imagen base (el plan sin captura del navegador). */
export async function capturaDesdeSvg(svg: string): Promise<CapturaPreparada> {
  const png = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  return recodificar(png);
}

export const esRechazo = (valor: CapturaPreparada | RechazoCaptura): valor is RechazoCaptura => "motivo" in valor;
