import sharp from "sharp";
import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createBriefGetHandler } from "@/lib/asesor/brief";
import { createAsesorRepository } from "@/lib/asesor/repository";

const SAFE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function createThumbnail(mimeType: string, data: Buffer): Promise<string | null> {
  if (!SAFE_IMAGE_TYPES.has(mimeType) || data.length > 6 * 1024 * 1024) return null;
  try {
    const thumbnail = await sharp(data, { limitInputPixels: 40_000_000 })
      .resize({ width: 240, height: 160, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 68 })
      .toBuffer();
    return `data:image/jpeg;base64,${thumbnail.toString("base64")}`;
  } catch {
    console.error("[asesor-brief] thumbnail generation failed");
    return null;
  }
}

export const GET = createBriefGetHandler({ authorize: requireAdvisorRole, repository: createAsesorRepository, thumbnail: createThumbnail });
