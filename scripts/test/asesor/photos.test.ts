import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { prepareAdvisorPhoto, MAX_PHOTO_BYTES } from "@/lib/asesor/photos";
import { runAdvisorTurn } from "@/lib/asesor/agent";
import type { ChatPort, FragmentoChat, Mensaje } from "@/lib/ia/nucleo/tipos";
import type { StoredMessage } from "@/lib/asesor/repository";
import { applyAdvisorTool } from "@/lib/asesor/tools";
import { POST as uploadPhoto } from "@/app/api/asesor/photos/route";
import { GET as readPhoto } from "@/app/api/asesor/photos/[id]/route";

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "#e36b55" } }).png().toBuffer();
}

test("photo validation accepts supported bytes through 6 MB and preserves the received buffer", async () => {
  const valid = await png();
  const exactBoundary = Buffer.concat([valid, Buffer.alloc(MAX_PHOTO_BYTES - valid.length)]);
  const prepared = await prepareAdvisorPhoto("image/png", exactBoundary);
  assert.equal(prepared.original.length, MAX_PHOTO_BYTES);
  assert.deepEqual(prepared.original, exactBoundary);
  assert.equal(prepared.mimeType, "image/png");
  assert.equal((await sharp(prepared.derivative).metadata()).format, "jpeg");
});

test("photo validation rejects unsupported, mismatched, corrupt and oversized inputs with Spanish errors", async () => {
  const valid = await png();
  await assert.rejects(prepareAdvisorPhoto("image/gif", valid), /Formato no compatible/);
  await assert.rejects(prepareAdvisorPhoto("image/jpeg", valid), /no coincide/);
  await assert.rejects(prepareAdvisorPhoto("image/png", Buffer.from("not a picture")), /No se pudo leer la foto/);
  await assert.rejects(prepareAdvisorPhoto("image/png", Buffer.alloc(MAX_PHOTO_BYTES + 1)), /supera el máximo permitido de 6 MB/);
});

test("photo upload and byte reads reject unauthenticated requests before storage access", async () => {
  const form = new FormData();
  form.set("conversationId", "conversation-1");
  form.set("turnId", "96a94134-59d4-46a0-9b07-51e68f91ebbd");
  form.set("content", "Mira esto");
  form.set("kind", "inspiration");
  form.append("photos", new File([new Uint8Array(await png())], "photo.png", { type: "image/png" }));
  const upload = await uploadPhoto(new Request("https://example.test/api/asesor/photos", { method: "POST", body: form, headers: { origin: "https://example.test" } }));
  const read = await readPhoto(new Request("https://example.test/api/asesor/photos/photo-1"), { params: Promise.resolve({ id: "photo-1" }) });
  assert.equal(upload.status, 401);
  assert.equal(read.status, 401);
});

test("the first-look turn contains a JPEG derivative inline and identifies the original attachment", async () => {
  const original = await png();
  const message: StoredMessage = {
    id: "photo-turn", role: "user", content: "Quiero decorar este salón.",
    attachments: [{ id: "attachment-venue-1", mimeType: "image/png", byteSize: original.length, data: original, kind: "venue", confirmed: null, preference: "neutral" }],
  };
  let captured: Mensaje[] = [];
  const chat: ChatPort = {
    id: "gemini", modelo: "fake", async turno() { throw new Error("not used"); },
    async *turnoStream(request) { captured = request.historial; yield { tipo: "texto", delta: "Veo un salón." }; yield { tipo: "fin", texto: "Veo un salón.", llamadas: [], modelo: "fake", uso: { entrada: 1, salida: 1 } } satisfies FragmentoChat; },
  };
  for await (const event of runAdvisorTurn({ chat, messages: [message], turnId: message.id, mutateBrief: async (mutate) => ({ state: mutate(null, 0), version: 1 }), readBrief: async () => null, appendAssistant: async () => undefined })) {
    if (event.type === "error") assert.fail(event.message);
  }
  const user = captured.find((item) => item.rol === "usuario");
  assert.ok(user && user.rol === "usuario");
  assert.match(user.texto, /attachment-venue-1/);
  assert.match(user.texto, /pregunta al cliente si confirma/);
  assert.equal(user.imagenes?.length, 1);
  assert.equal(user.imagenes?.[0]?.id, "attachment-venue-1");
  assert.equal(user.imagenes?.[0]?.mime, "image/jpeg");
  assert.notDeepEqual(Buffer.from(user.imagenes![0]!.base64, "base64"), original);
  assert.deepEqual(message.attachments[0]!.data, original, "the model derivative never replaces the stored original");
});

test("photo feedback is persisted separately for the requested attachment ID", async () => {
  let persisted: { attachmentId: string; confirmed: boolean; preference: string } | null = null;
  const result = await applyAdvisorTool({
    call: { nombre: "record_photo_feedback", args: { attachmentId: "venue-attachment", confirmed: true, preference: "dislike" } },
    operationId: "turn:0:0", currentCustomerText: "Confirmo la lectura, pero no me gusta.",
    mutateBrief: async (mutate) => ({ state: mutate(null, 0), version: 1 }),
    photoIds: new Set(["venue-attachment", "inspiration-attachment"]),
    savePhotoFeedback: async (attachmentId, confirmed, preference) => { persisted = { attachmentId, confirmed, preference }; return true; },
  });
  assert.deepEqual(persisted, { attachmentId: "venue-attachment", confirmed: true, preference: "dislike" });
  assert.match(String((result.result as { message: string }).message), /venue-attachment/);
});
