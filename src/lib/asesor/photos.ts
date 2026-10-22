import sharp from "sharp";
import type { PhotoKind, PhotoPreference } from "./repository";

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const SUPPORTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const FORMAT_BY_MIME: Record<(typeof SUPPORTED_PHOTO_TYPES)[number], string> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp",
};

export type PreparedPhoto = {
  mimeType: (typeof SUPPORTED_PHOTO_TYPES)[number];
  original: Buffer;
  derivative: Buffer;
  width: number;
  height: number;
};

export function parsePhotoKind(value: unknown): PhotoKind | null {
  return value === "inspiration" || value === "venue" ? value : null;
}

export function parsePhotoPreference(value: unknown): PhotoPreference | null {
  return value === "like" || value === "dislike" || value === "neutral" ? value : null;
}

/** Validates and decodes an image while keeping its received bytes separate from the JPEG derivative. */
export async function prepareAdvisorPhoto(mimeType: string, bytes: Buffer): Promise<PreparedPhoto> {
  if (bytes.length === 0) throw new Error("La foto está vacía. Elige otra imagen.");
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error("La foto supera el máximo permitido de 6 MB.");
  if (!SUPPORTED_PHOTO_TYPES.includes(mimeType as (typeof SUPPORTED_PHOTO_TYPES)[number])) {
    throw new Error("Formato no compatible. Sube una foto JPEG, PNG o WebP.");
  }
  try {
    const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" });
    const metadata = await source.metadata();
    const supportedMime = mimeType as (typeof SUPPORTED_PHOTO_TYPES)[number];
    if (metadata.format !== FORMAT_BY_MIME[supportedMime] || !metadata.width || !metadata.height) {
      throw new Error("La foto no coincide con su formato declarado.");
    }
    const derivative = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 }).toBuffer();
    return { mimeType: supportedMime, original: bytes, derivative, width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("La foto")) throw error;
    throw new Error("No se pudo leer la foto. Puede estar corrupta; prueba con otra imagen.");
  }
}
