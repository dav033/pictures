import assert from "node:assert/strict";
import sharp from "sharp";

export async function createScenarioPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: "#8cae91" } }).png().toBuffer();
}

export async function uploadScenarioPhoto(input: {
  origin: string;
  cookie: string;
  conversationId: string;
  turnId: string;
  content: string;
  photo: Buffer;
}): Promise<string> {
  const form = new FormData();
  form.set("conversationId", input.conversationId);
  form.set("turnId", input.turnId);
  form.set("content", input.content);
  form.set("kind", "venue");
  form.append("photos", new File([new Uint8Array(input.photo)], "venue.png", { type: "image/png" }));
  const response = await fetch(`${input.origin}/api/asesor/photos`, {
    method: "POST", headers: { cookie: input.cookie, origin: input.origin }, body: form,
  });
  assert.equal(response.status, 201, `photo upload returned ${response.status}`);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error("Photo upload response was invalid.");
  const attachments: unknown = (result as Record<string, unknown>).attachments;
  assert.ok(Array.isArray(attachments) && attachments.length === 1);
  const candidate: unknown = attachments[0];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) throw new Error("Photo upload attachment response was invalid.");
  const attachment = candidate as Record<string, unknown>;
  assert.equal(attachment.mimeType, "image/png");
  assert.equal(attachment.byteSize, input.photo.length);
  return String(attachment.id);
}

export async function assertPhotoBytes(origin: string, cookie: string, photoId: string, expected: Buffer): Promise<void> {
  const response = await fetch(`${origin}/api/asesor/photos/${encodeURIComponent(photoId)}`, { headers: { cookie } });
  assert.equal(response.status, 200, "stored photo could not be reloaded");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, "stored photo bytes changed from the received image");
}
