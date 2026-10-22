import assert from "node:assert/strict";
import { createScenarioPhoto, uploadScenarioPhoto, assertPhotoBytes } from "./photos";
import { transcribeScenarioVoice } from "./voice";

type Options = {
  origin: string;
  userPassword: string;
  adminPassword: string;
  live: boolean;
  audio: Buffer;
};
type JsonObject = Record<string, unknown>;

async function readJson(response: Response): Promise<JsonObject> {
  const value: unknown = await response.json();
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  return value as JsonObject;
}

async function login(origin: string, username: "user" | "admin", password: string): Promise<string> {
  const response = await fetch(`${origin}/api/asesor/login`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `${username} login failed`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("asesor_session="));
  if (!cookie) throw new Error("Advisor login cookie missing.");
  return cookie;
}

async function getJson(origin: string, endpoint: string, cookie: string): Promise<JsonObject> {
  const response = await fetch(`${origin}${endpoint}`, { headers: { cookie } });
  assert.equal(response.status, 200, `GET ${endpoint} returned ${response.status}`);
  return readJson(response);
}

async function sendTurn(origin: string, cookie: string, conversationId: string, turnId: string, content: string): Promise<JsonObject> {
  const response = await fetch(`${origin}/api/asesor/conversar`, {
    method: "POST", headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify({ conversationId, turnId, content }),
  });
  assert.equal(response.status, 200, `advisor turn returned ${response.status}`);
  const body = await response.text();
  const events = body.split("\n\n").flatMap((block) => {
    const type = block.match(/^event: ([^\n]+)/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    return type && data ? [{ type, data: JSON.parse(data) as JsonObject }] : [];
  });
  const terminal = events.at(-1);
  assert.ok(terminal, "advisor turn returned no SSE event");
  assert.equal(terminal.type, "final", `advisor turn failed: ${String(terminal.data.code ?? terminal.type)}`);
  assert.ok(events.some((event) => event.type === "text"), "advisor turn returned no assistant text");
  return terminal.data;
}

export async function runM2Scenario(options: Options): Promise<{ checks: string[]; conversationId: string }> {
  const checks: string[] = [];
  const userCookie = await login(options.origin, "user", options.userPassword);
  const create = await fetch(`${options.origin}/api/asesor/conversations`, {
    method: "POST", headers: { "content-type": "application/json", origin: options.origin, cookie: userCookie },
    body: JSON.stringify({ id: crypto.randomUUID(), title: "Aceptación M2" }),
  });
  assert.equal(create.status, 201, "conversation creation failed");
  const created = await readJson(create);
  const conversation = created.conversation as JsonObject;
  const conversationId = String(conversation.id);

  const photo = await createScenarioPhoto();
  const message = "M2_START. Estoy organizando un evento corporativo el 14 de noviembre de 2026 a las 18:00 para 24 personas en un salón de Bogotá. La dirección es Dirección de prueba, mi nombre es Contacto de prueba y mi correo es m2@example.invalid. La empresa es Empresa de prueba y el tema inicial es Jardín. Autorizo que me contacten y autorizo compartir mi dirección.";
  const photoTurnId = crypto.randomUUID();
  const photoId = await uploadScenarioPhoto({ origin: options.origin, cookie: userCookie, conversationId, turnId: photoTurnId, content: message, photo });
  const first = await sendTurn(options.origin, userCookie, conversationId, photoTurnId, message);
  assert.ok(first.state, "photo turn returned no brief state");
  await assertPhotoBytes(options.origin, userCookie, photoId, photo);
  const transcript = await transcribeScenarioVoice({
    origin: options.origin, cookie: userCookie, audio: options.audio, contentType: "audio/wav",
  });
  const voiceTurnId = crypto.randomUUID();
  await sendTurn(options.origin, userCookie, conversationId, voiceTurnId, transcript);
  const snapshot = await getJson(options.origin, `/api/asesor/conversations/${conversationId}`, userCookie);
  const messages = snapshot.messages as Array<JsonObject>;
  const photoTurn = messages.find((item) => item.id === photoTurnId);
  const voiceTurn = messages.find((item) => item.id === voiceTurnId);
  assert.ok(photoTurn, "photo message was not persisted");
  assert.equal((photoTurn.attachments as Array<JsonObject>).some((item) => item.id === photoId), true, "photo attachment was not persisted");
  assert.equal(voiceTurn?.content, transcript, "voice transcription was not stored as its exact customer text");
  checks.push(options.live ? "real voice service transcript and original photo persisted in customer messages" : "stubbed voice transcript and original photo persisted in customer messages");

  const reload = await fetch(`${options.origin}/asesor`, { headers: { cookie: userCookie } });
  assert.equal(reload.status, 200, "same-device reload failed");
  const restored = await getJson(options.origin, `/api/asesor/conversations/${conversationId}`, userCookie);
  const restoredMessages = restored.messages as Array<JsonObject>;
  const restoredPhotoTurn = restoredMessages.find((item) => item.id === photoTurnId);
  const restoredVoiceTurn = restoredMessages.find((item) => item.id === voiceTurnId);
  assert.equal(restoredVoiceTurn?.content, transcript, "voice transcript did not survive reload");
  assert.equal((restoredPhotoTurn?.attachments as Array<JsonObject>).some((item) => item.id === photoId), true, "photo did not survive reload");
  await assertPhotoBytes(options.origin, userCookie, photoId, photo);
  checks.push("same-device reload restores transcript and received photo bytes");

  await sendTurn(options.origin, userCookie, conversationId, crypto.randomUUID(), "M2_CORRECT: Terraza azul. Corrige el tema a terraza azul.");
  const correctedData = await getJson(options.origin, `/api/asesor/conversations/${conversationId}`, userCookie);
  const correctedState = correctedData.state as JsonObject;
  const correctedBrief = correctedState.brief as JsonObject;
  assert.match(String(correctedBrief.theme).toLowerCase(), /terraza azul/, "corrected theme was not persisted");
  const regenerated = correctedState.summary as JsonObject | null;
  assert.ok(regenerated, "correction did not regenerate the summary");
  assert.ok(Number(regenerated.version) > Number((restored.state as JsonObject).summarySequence), "correction reused a stale summary version");
  assert.match(String(regenerated.text).toLowerCase(), /terraza azul/, "regenerated summary omitted the corrected theme");
  assert.equal(correctedState.approval, null, "correction did not invalidate approval");
  const summaryEvent = await sendTurn(options.origin, userCookie, conversationId, crypto.randomUUID(), "M2_SUMMARY. Muestra el resumen corregido para que lo revise.");
  const summaryState = summaryEvent.state as JsonObject;
  const summary = summaryState.summary as JsonObject;
  assert.ok(Number.isSafeInteger(summary.version), "corrected summary has no version");
  const approved = await sendTurn(options.origin, userCookie, conversationId, crypto.randomUUID(), `M2_APPROVE version ${summary.version}. Apruebo el resumen versión ${summary.version}.`);
  const approval = (approved.state as JsonObject).approval as JsonObject;
  assert.equal(approval.summaryVersion, summary.version, "current summary was not approved");
  const brief = await getJson(options.origin, `/api/asesor/briefs/${conversationId}`, userCookie);
  assert.equal((brief.approval as JsonObject).summaryVersion, summary.version, "approved brief was not persisted");
  checks.push("corrected brief was proposed and approved at its current version");

  const adminCookie = await login(options.origin, "admin", options.adminPassword);
  const admin = await getJson(options.origin, `/api/asesor/admin/conversations/${conversationId}`, adminCookie);
  const adminConversation = admin.conversation as JsonObject;
  assert.equal(adminConversation.status, "approved");
  const approvedBrief = adminConversation.approvedBrief as JsonObject;
  assert.equal(approvedBrief.version, summary.version, "admin view omitted the approved brief");
  const transcriptMessages = adminConversation.transcript as Array<JsonObject>;
  const adminPhotoTurn = transcriptMessages.find((item) => item.id === photoTurnId);
  const adminVoiceTurn = transcriptMessages.find((item) => item.id === voiceTurnId);
  assert.equal(adminVoiceTurn?.content, transcript, "admin transcript omitted the stored voice transcript");
  assert.equal((adminPhotoTurn?.attachments as Array<JsonObject>).some((item) => item.id === photoId), true, "admin transcript omitted the photo");
  checks.push("admin sees the approved brief, voice transcript, and photo attachment");
  return { checks, conversationId };
}
