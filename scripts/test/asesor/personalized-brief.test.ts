import { test } from "node:test";
import assert from "node:assert/strict";
import { PersonalizedBriefSchema, personalizedBriefRows } from "../../../src/lib/asesor/personalizado/brief";
import { runPersonalizedTurn } from "../../../src/lib/asesor/personalizado/agent";
import type { ChatPort } from "@sempertex/agente-core";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import sharp from "sharp";
import { createPersonalizedPdf } from "../../../src/lib/asesor/personalizado/pdf";
import { approvePersonalizedBrief, completePersonalizedTurn, initialPersonalizedState } from "../../../src/lib/asesor/personalizado/state";

test("the personalized brief keeps customer details and marks unknown facts as pending", () => {
  const brief = PersonalizedBriefSchema.parse({ event: "  Fiesta de 80 personas  ", colors: "lila y dorado" });
  const rows = personalizedBriefRows(brief);
  assert.equal(rows.find((row) => row.label === "Evento")?.value, "Fiesta de 80 personas");
  assert.equal(rows.find((row) => row.label === "Colores")?.value, "lila y dorado");
  assert.equal(rows.find((row) => row.label === "Fecha")?.value, "Pendiente");
  assert.equal(PersonalizedBriefSchema.safeParse({ unexpected: true }).success, false);
});

test("approval includes the reviewed photos and a later correction requires a new approval", () => {
  const photoId = "b7c41694-675f-44a5-af50-e1fc88f3c3e5";
  const initial = initialPersonalizedState();
  assert.throws(() => approvePersonalizedBrief(initial, undefined, []), /TURN_PENDING/);
  const first = completePersonalizedTurn(initial, "turn-1", PersonalizedBriefSchema.parse({ event: "Fiesta" }), "Cuéntame más");
  assert.throws(() => approvePersonalizedBrief(first, "turn-2", [photoId]), /TURN_PENDING/);
  const approved = approvePersonalizedBrief(first, "turn-1", [photoId]);
  assert.deepEqual(approved.approvedPhotoIds, [photoId]);
  const corrected = completePersonalizedTurn(approved, "turn-2", PersonalizedBriefSchema.parse({ event: "Boda" }), "Anotado");
  assert.equal(corrected.approved, false);
  assert.deepEqual(corrected.approvedPhotoIds, []);
});

test("personalized turns reject invalid model updates instead of accepting fabricated fields", async () => {
  const response = { texto: "Cuéntame de tu evento", llamadas: [{ nombre: "actualizar_brief", args: { unexpected: true } }], uso: { entrada: 1, salida: 1 }, modelo: "test" };
  const chat: ChatPort = { id: "gemini", modelo: "test", turno: async () => response, async *turnoStream() {} };
  await assert.rejects(runPersonalizedTurn(chat, [{ rol: "usuario", texto: "Quiero una fiesta" }], PersonalizedBriefSchema.parse({}), new AbortController().signal));
});

test("the advisor stores explicit event details and obtains a reply after a tool-only response", async () => {
  const nextBrief = PersonalizedBriefSchema.parse({ event: "Cumpleaños", guests: "80 personas", colors: "lila" });
  let calls = 0;
  const chat: ChatPort = { id: "gemini", modelo: "test", async turno() {
    calls++;
    return { texto: calls === 1 ? "" : "¿Qué decoración imaginas?", llamadas: calls === 1 ? [{ nombre: "actualizar_brief", args: nextBrief }] : [], uso: { entrada: 1, salida: 1 }, modelo: "test" };
  }, async *turnoStream() {} };
  const result = await runPersonalizedTurn(chat, [{ rol: "usuario", texto: "Cumpleaños para 80, en lila" }], PersonalizedBriefSchema.parse({}), new AbortController().signal);
  assert.equal(result.brief.guests, "80 personas");
  assert.equal(result.brief.colors, "lila");
  assert.equal(result.text, "¿Qué decoración imaginas?");
  assert.equal(calls, 2);
});

test("empty fields in a model update do not erase earlier customer details", async () => {
  const current = PersonalizedBriefSchema.parse({ event: "Cumpleaños", guests: "80 personas", city: "Barranquilla" });
  const proposed = PersonalizedBriefSchema.parse({ colors: "lila" });
  const chat: ChatPort = { id: "gemini", modelo: "test", async turno() {
    return { texto: "Anoté el color.", llamadas: [{ nombre: "actualizar_brief", args: proposed }], uso: { entrada: 1, salida: 1 }, modelo: "test" };
  }, async *turnoStream() {} };
  const result = await runPersonalizedTurn(chat, [{ rol: "usuario", texto: "Me gusta el lila" }], current, new AbortController().signal);
  assert.equal(result.brief.event, "Cumpleaños");
  assert.equal(result.brief.guests, "80 personas");
  assert.equal(result.brief.city, "Barranquilla");
  assert.equal(result.brief.colors, "lila");
});

test("a customer correction replaces the previous event details", async () => {
  const current = PersonalizedBriefSchema.parse({ event: "Cumpleaños", guests: "50 personas", city: "Barranquilla" });
  const proposed = { ...current, guests: "80 personas" };
  const chat: ChatPort = { id: "gemini", modelo: "test", async turno() {
    return { texto: "Actualicé el número de invitados.", llamadas: [{ nombre: "actualizar_brief", args: proposed }], uso: { entrada: 1, salida: 1 }, modelo: "test" };
  }, async *turnoStream() {} };
  const result = await runPersonalizedTurn(chat, [{ rol: "usuario", texto: "Serán 80 invitados" }], current, new AbortController().signal);
  assert.equal(result.brief.guests, "80 personas");
  assert.equal(result.brief.city, "Barranquilla");
});

test("the approved PDF contains reference images and handles long event details", async () => {
  const image = await sharp({ create: { width: 32, height: 20, channels: 3, background: "#b4befe" } }).png().toBuffer();
  const pdf = await createPersonalizedPdf(PersonalizedBriefSchema.parse({ event: "Celebración", decoration: "elemento ".repeat(200) }), [{ mimeType: "image/png", data: image }]);
  const document = await PDFDocument.load(pdf);
  assert.ok(document.getPageCount() >= 2);
  const imageCounts = document.getPages().map((page) => page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.keys().length ?? 0);
  assert.ok(imageCounts.some((count) => count > 0), "a reference image must be embedded in the PDF");
});
