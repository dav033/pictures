import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PeticionImagen } from "@/lib/ia/nucleo/tipos";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { CARTA, coloresDeGuia, discosDeGuia, estructuraParaGuia, svgCarta, svgGuia, tamanoGuia } from "./guia-estructura";
import { imageSizeFor, type ImagenGuiaLora } from "./sempertex-lora";

/**
 * La guía de estructura y su carta en PNG (ADR-0033). Solo servidor: `sharp`
 * rasteriza el SVG puro de `guia-estructura.ts` y nada de esto llega al
 * cliente. Tamaño acotado: la guía mide el aspecto de salida con el lado mayor
 * en 1024 px y ningún PNG puede pasar de `MAX_BYTES_GUIA` (unos colores planos
 * pesan decenas de KB; más sería un SVG que no es el nuestro).
 */
export const MAX_BYTES_GUIA = 1_500_000;

export async function rasterizarSvg(svg: string, tamano: { ancho: number; alto: number }): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(svg, "utf8")).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  if (info.width !== tamano.ancho || info.height !== tamano.alto) {
    throw new Error(`GUIA_ESTRUCTURA_INVALIDA: el PNG mide ${info.width}×${info.height} y se esperaba ${tamano.ancho}×${tamano.alto}.`);
  }
  if (data.byteLength > MAX_BYTES_GUIA) throw new Error(`GUIA_ESTRUCTURA_INVALIDA: el PNG pesa ${data.byteLength} bytes (máximo ${MAX_BYTES_GUIA}).`);
  return data;
}

export type GuiaPreparada = {
  estructuraId: string;
  /** La guía primero y la carta después: el orden en que las recibe `/edit`. */
  imagenes: readonly [ImagenGuiaLora, ImagenGuiaLora];
  /** Hash de la guía: lo único de ella que va a registros y telemetría. */
  sha256: string;
  bytes: number;
  colores: readonly string[];
};

/** La guía de la única estructura con armado o patrón del plan, o `null` si la escena no la admite. */
export async function prepararGuiaEstructura(plan: PlanResuelto, aspecto: PeticionImagen["aspecto"]): Promise<GuiaPreparada | null> {
  const estructura = estructuraParaGuia(plan);
  if (!estructura) return null;
  const { discos, sobrePiso } = discosDeGuia(estructura);
  const tamano = tamanoGuia(imageSizeFor(aspecto));
  const colores = coloresDeGuia(discos);
  const [guia, carta] = await Promise.all([rasterizarSvg(svgGuia(discos, sobrePiso, tamano), tamano), rasterizarSvg(svgCarta(colores), CARTA)]);
  return {
    estructuraId: estructura.estructura_id,
    imagenes: [
      { id: "STRUCTURE_GUIDE", role: "structure_guide", base64: guia.toString("base64"), mime: "image/png" },
      { id: "COLOR_CHART", role: "color_chart", base64: carta.toString("base64"), mime: "image/png" },
    ],
    sha256: createHash("sha256").update(guia).digest("hex"),
    bytes: guia.byteLength + carta.byteLength,
    colores,
  };
}
