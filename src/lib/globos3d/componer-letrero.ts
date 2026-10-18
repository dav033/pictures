import sharp from "sharp";
import type { CajaLetreroFotoV1 } from "./render-imagen-contrato-v1";

export const BANDERA_COMPOSICION_LETRERO = "RENDER_3D_SIGN_COMPOSITING_ENABLED";
const MAX_PIXELES_IMAGEN = 2048 * 2048;
const MAX_DIMENSION_IMAGEN = 2048;
const MAX_DESENFOQUE_PX = 16;

export type ImagenBase64 = { mime: string; base64: string };
export type ResultadoComposicionLetrero =
  | { estado: "sin_cambio"; imagen: ImagenBase64 }
  | { estado: "compuesta"; imagen: ImagenBase64 }
  | { estado: "fallo"; imagen: ImagenBase64; causa: string };

export function composicionLetreroHabilitada(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[BANDERA_COMPOSICION_LETRERO] === "true";
}

function limitesDeCaja(caja: CajaLetreroFotoV1, ancho: number, alto: number) {
  const left = Math.max(0, Math.floor(caja.x * ancho));
  const top = Math.max(0, Math.floor(caja.y * alto));
  const right = Math.min(ancho, Math.ceil((caja.x + caja.ancho) * ancho));
  const bottom = Math.min(alto, Math.ceil((caja.y + caja.alto) * alto));
  if (right <= left || bottom <= top) throw new Error("empty-sign-box");
  return { left, top, width: right - left, height: bottom - top };
}

export async function validarCapturaConLetreros(
  captura: Buffer,
  cajas: readonly CajaLetreroFotoV1[],
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(captura, { limitInputPixels: MAX_PIXELES_IMAGEN }).metadata();
  const width = metadata.width, height = metadata.height;
  if (!width || !height || width > MAX_DIMENSION_IMAGEN || height > MAX_DIMENSION_IMAGEN) throw new Error("invalid-sign-source-size");
  for (const caja of cajas) {
    const rectangulo = limitesDeCaja(caja, width, height);
    if (rectangulo.width < 2 || rectangulo.height < 2) throw new Error("sign-box-too-small");
  }
  return { width, height };
}

/** Restores only the projected sign areas; a small inward feather avoids a hard rectangular seam. */
export async function conservarLetrerosEnFoto(opciones: {
  imagen: ImagenBase64;
  captura: Buffer;
  cajas: readonly CajaLetreroFotoV1[];
  habilitada: boolean;
}): Promise<ResultadoComposicionLetrero> {
  const { imagen, captura, cajas, habilitada } = opciones;
  if (!habilitada || cajas.length === 0) return { estado: "sin_cambio", imagen };

  try {
    await validarCapturaConLetreros(captura, cajas);
    const base = await sharp(Buffer.from(imagen.base64, "base64"), { limitInputPixels: MAX_PIXELES_IMAGEN })
      .rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (base.info.width > MAX_DIMENSION_IMAGEN || base.info.height > MAX_DIMENSION_IMAGEN || base.info.channels !== 4) throw new Error("invalid-generated-image");

    const origen = await sharp(captura, { limitInputPixels: MAX_PIXELES_IMAGEN })
      .rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (origen.info.channels !== 4) throw new Error("invalid-sign-source");

    for (const caja of cajas) {
      const fuente = limitesDeCaja(caja, origen.info.width, origen.info.height);
      const destino = limitesDeCaja(caja, base.info.width, base.info.height);
      const recorte = await sharp(origen.data, {
        raw: { width: origen.info.width, height: origen.info.height, channels: 4 },
      }).extract(fuente).resize(destino.width, destino.height, { fit: "fill", kernel: "lanczos3" })
        .raw().toBuffer({ resolveWithObject: true });
      const feather = Math.max(1, Math.min(MAX_DESENFOQUE_PX, Math.floor(Math.min(destino.width, destino.height) * 0.1)));

      for (let y = 0; y < destino.height; y += 1) {
        for (let x = 0; x < destino.width; x += 1) {
          const distancia = Math.min(x, y, destino.width - 1 - x, destino.height - 1 - y);
          const mascara = Math.min(1, distancia / feather);
          if (mascara <= 0) continue;
          const indiceOrigen = (y * destino.width + x) * 4;
          const indiceDestino = ((destino.top + y) * base.info.width + destino.left + x) * 4;
          const alphaOrigen = recorte.data[indiceOrigen + 3]!;
          const alphaDestino = base.data[indiceDestino + 3]!;
          const alfaOrigen = (alphaOrigen / 255) * mascara;
          const alfaDestino = alphaDestino / 255;
          const alphaCombinado = alfaOrigen + alfaDestino * (1 - alfaOrigen);
          for (let canal = 0; canal < 3; canal += 1) {
            const colorOrigen = recorte.data[indiceOrigen + canal]!;
            const colorDestino = base.data[indiceDestino + canal]!;
            base.data[indiceDestino + canal] = alphaCombinado
              ? Math.round((colorOrigen * alfaOrigen + colorDestino * alfaDestino * (1 - alfaOrigen)) / alphaCombinado)
              : 0;
          }
          base.data[indiceDestino + 3] = Math.round(alphaCombinado * 255);
        }
      }
    }

    const png = await sharp(base.data, {
      raw: { width: base.info.width, height: base.info.height, channels: 4 },
    }).png().toBuffer();
    return { estado: "compuesta", imagen: { mime: "image/png", base64: png.toString("base64") } };
  } catch (error) {
    return { estado: "fallo", imagen, causa: error instanceof Error ? error.name : "unknown-error" };
  }
}
