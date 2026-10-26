import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { prepareAdvisorPhoto, MAX_PHOTO_BYTES } from "@/lib/asesor/photos";
import { runAdvisorTurn } from "@/lib/asesor/agent";
import type { ChatPort, FragmentoChat, Mensaje } from "@/lib/ia/nucleo/tipos";
import type { StoredMessage } from "@/lib/asesor/repository";
import { createAsesorRepository } from "@/lib/asesor/repository";
import type { AsesorDb } from "@/lib/asesor/db";
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
  let persisted: { attachmentId: string; confirmed: boolean | null; preference: string | null } | null = null;
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

test("Postgres bytea writes and reads the original bytes and photo metadata unchanged", async () => {
  const bytes = Buffer.from([0, 255, 17, 34, 128]);
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const rowsFor = <T>(text: string): T[] => {
    if (text.includes("FROM messages")) return [{ id: "turn-1", role: "user" as const, content: "Foto" }] as T[];
    if (text.includes("FROM attachments") && text.includes("JOIN messages")) return [{ id: "photo-1", message_id: "turn-1", mime_type: "image/png", byte_size: bytes.length, data: bytes, photo_kind: "venue", confirmed: true, preference: "dislike" }] as T[];
    return [];
  };
  const query = async <T>(text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: rowsFor<T>(text), rowCount: 1 };
  };
  const db: AsesorDb = {
    query,
    async connect() {
      return {
        query,
        release() {},
      };
    },
  };
  const repository = createAsesorRepository(db);
  await repository.appendMessage("conversation-1", { id: "turn-1", role: "user", content: "Foto", attachments: [{ id: "photo-1", mimeType: "image/png", data: bytes, kind: "venue", confirmed: true, preference: "dislike" }] });
  const written = calls.find((call) => call.text.includes("INSERT INTO attachments"));
  assert.deepEqual(written?.values?.[4], bytes);
  assert.deepEqual(written?.values?.slice(5), ["venue", true, "dislike"]);
  const message = (await repository.listMessages("conversation-1"))[0]!;
  assert.deepEqual(message.attachments[0]?.data, bytes);
  assert.deepEqual({ kind: message.attachments[0]?.kind, confirmed: message.attachments[0]?.confirmed, preference: message.attachments[0]?.preference }, { kind: "venue", confirmed: true, preference: "dislike" });
});

import { customerEvidence, keepWithEvidence } from "../../../src/lib/asesor/photo-evidence";

test("the customer's own words decide what is stored about a photo", () => {
  assert.deepEqual(customerEvidence("Sí, es esa. Me encanta el arco blanco y negro"), { confirmed: true, corrected: false, likes: true, dislikes: false });
  assert.equal(customerEvidence("No, en realidad es más bien rosa").corrected, true);
  assert.equal(customerEvidence("No, en realidad es más bien rosa").confirmed, false);
  assert.equal(customerEvidence("no me gusta el fondo rojo").dislikes, true);
  assert.equal(customerEvidence("no me gusta el fondo rojo").likes, false);
  const mixed = customerEvidence("Me encanta el arco blanco y negro, pero el fondo rojo no me gusta");
  assert.ok(mixed.likes && mixed.dislikes, "a liked part and a disliked part in one message are both heard");
  assert.equal(customerEvidence("Somos 15 en Barranquilla").likes, false, "an unrelated message supports nothing");
  assert.deepEqual(keepWithEvidence(["el arco blanco y negro", "las flores amarillas"], "Me encanta el arco blanco y negro"), { accepted: ["el arco blanco y negro"], rejected: ["las flores amarillas"] });
});

test("the server stores only what the customer's last message supports, and the reading needs the customer's confirmation again", async () => {
  const saved: Array<{ confirmed: boolean | null; preference: string | null; keep?: string[] }> = [];
  const run = (text: string, args: Record<string, unknown>) => applyAdvisorTool({
    call: { nombre: "record_photo_feedback", args: { attachmentId: "p1", ...args } }, operationId: `t:${saved.length}:0`, currentCustomerText: text,
    mutateBrief: async (mutate) => ({ state: mutate(null, 0), version: 1 }), photoIds: new Set(["p1"]),
    savePhotoFeedback: async (_id, confirmed, preference, keep) => { saved.push({ confirmed, preference, ...(keep ? { keep } : {}) }); return true; },
  });
  // The model claims a like the customer never said: nothing is stored and the advisor is told to ask.
  const unsupported = await run("Somos 15 en Barranquilla", { confirmed: true, preference: "like", keep: ["el arco blanco y negro"] });
  assert.deepEqual(saved, []);
  assert.match(String((unsupported.result as { message: string }).message), /NO se guardó.*Pregúntaselo/);
  const supported = await run("Sí, es esa. Me encanta el arco blanco y negro, eso lo quiero sí o sí", { confirmed: true, preference: "like", keep: ["el arco blanco y negro", "las flores amarillas"] });
  assert.deepEqual(saved.at(-1), { confirmed: true, preference: "like", keep: ["el arco blanco y negro"] });
  assert.match(String((supported.result as { message: string }).message), /conservar: el arco blanco y negro/);
  assert.match(String((supported.result as { message: string }).message), /NO se guardó.*conservar «las flores amarillas»/);
  const reading = await applyAdvisorTool({
    call: { nombre: "record_photo_reading", args: { attachmentId: "p1", style: "arco orgánico clásico", colors: ["blanco", "negro"], elements: ["arco de globos"] } }, operationId: "t:9:0", currentCustomerText: "mira esta foto",
    mutateBrief: async (mutate) => ({ state: mutate(null, 0), version: 1 }), photoIds: new Set(["p1"]),
    savePhotoReading: async (id, value) => { assert.equal(id, "p1"); assert.deepEqual(value, { style: "arco orgánico clásico", colors: ["blanco", "negro"], elements: ["arco de globos"] }); return true; },
  });
  assert.match(String((reading.result as { message: string }).message), /pendiente de su confirmación/);
  const stranger = await applyAdvisorTool({
    call: { nombre: "record_photo_reading", args: { attachmentId: "otra-conversacion", style: "x", colors: [], elements: [] } }, operationId: "t:10:0", currentCustomerText: "x",
    mutateBrief: async (mutate) => ({ state: mutate(null, 0), version: 1 }), photoIds: new Set(["p1"]), savePhotoReading: async () => true,
  });
  assert.match(String((stranger.result as { message: string }).message), /No se pudo asociar la lectura/);
});
