import "server-only";
import { createHash } from "node:crypto";

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
