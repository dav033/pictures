import assert from "node:assert/strict";
import { test } from "node:test";
import { receiveVoiceNote, transcribeVoiceNote, type VoiceNoteDependencies } from "@/lib/asesor/voice-notes";
import type { MessageInput, StoredMessage } from "@/lib/asesor/repository";
import { ErrorVoz } from "@/lib/voz/cliente-vps";
import { MAX_BYTES_AUDIO } from "@/lib/voz/limites";
import { MENSAJES_ERROR_DICTADO, codigoDeEstadoHttp } from "@/components/voz/mensajes-voz";

const audio = new Uint8Array([1, 2, 3]);
const enabled = { habilitada: true, url: "https://voice.test", secreto: "secret" };
const deps = (transcribe: VoiceNoteDependencies["transcribe"], config = enabled): VoiceNoteDependencies => ({ config: () => config, transcribe });
const heard = (texto: string) => async () => ({ texto, duracion_s: 2.5, ms: 900 });

test("a voice note is transcribed with whitespace collapsed", async () => {
  const result = await transcribeVoiceNote({ audio, contentType: "audio/webm;codecs=opus" }, deps(heard("  hola   quiero\nuna fiesta ")));
  assert.deepEqual(result, { status: "transcribed", text: "hola quiero una fiesta", seconds: 2.5 });
});

test("WhatsApp-style audio/ogg; codecs=opus is accepted and sent to the service without parameters", async () => {
  let sent = "";
  const result = await transcribeVoiceNote({ audio, contentType: "audio/ogg; codecs=opus" }, deps(async (_bytes, contentType) => { sent = contentType; return { texto: "ok", duracion_s: 1, ms: 1 }; }));
  assert.equal(result.status, "transcribed");
  assert.equal(sent, "audio/ogg");
});

test("voice notes reject unsupported formats, empty and oversized audio, silence and a disabled service", async () => {
  const never = deps(async () => { throw new Error("must not be called"); });
  assert.deepEqual(await transcribeVoiceNote({ audio, contentType: "video/mp4" }, never), { status: "rejected", code: "unsupported_format" });
  assert.deepEqual(await transcribeVoiceNote({ audio, contentType: null }, never), { status: "rejected", code: "unsupported_format" });
  assert.deepEqual(await transcribeVoiceNote({ audio: new Uint8Array(0), contentType: "audio/webm" }, never), { status: "rejected", code: "empty" });
  assert.deepEqual(await transcribeVoiceNote({ audio: new Uint8Array(MAX_BYTES_AUDIO + 1), contentType: "audio/webm" }, never), { status: "rejected", code: "too_large" });
  assert.deepEqual(await transcribeVoiceNote({ audio, contentType: "audio/webm" }, deps(heard("   "))), { status: "rejected", code: "no_speech" });
  assert.deepEqual(await transcribeVoiceNote({ audio, contentType: "audio/webm" }, deps(heard("hola"), { ...enabled, habilitada: false })), { status: "rejected", code: "not_configured" });
});

test("service failures map to customer-safe codes", async () => {
  const failing = (error: unknown) => deps(async () => { throw error; });
  assert.deepEqual(await transcribeVoiceNote({ audio, contentType: "audio/webm" }, failing(new ErrorVoz("ocupado"))), { status: "rejected", code: "busy" });
  assert.deepEqual(await transcribeVoiceNote({ audio, contentType: "audio/webm" }, failing(new ErrorVoz("tiempo_agotado"))), { status: "rejected", code: "timeout" });
  assert.deepEqual(await transcribeVoiceNote({ audio, contentType: "audio/webm" }, failing(new Error("boom"))), { status: "rejected", code: "failed" });
});

function memoryRepository() {
  const messages: StoredMessage[] = [];
  return {
    messages,
    async listMessages() { return messages; },
    async appendMessage(_conversationId: string, message: MessageInput) {
      if (messages.some((existing) => existing.id === message.id)) return { inserted: false };
      messages.push({ id: message.id, role: message.role, content: message.content, attachments: [], ...(message.inputMode === "voice" ? { inputMode: "voice" as const } : {}) });
      return { inserted: true };
    },
  };
}

test("receiving a voice note stores only the transcript as a voice turn and is idempotent per turn id", async () => {
  const repository = memoryRepository();
  let calls = 0;
  const dependencies = { ...deps(async () => { calls += 1; return { texto: "una fiesta de fútbol", duracion_s: 3, ms: 10 }; }), repository };
  const input = { conversationId: "c1", turnId: "t1", audio, contentType: "audio/webm" };
  assert.deepEqual(await receiveVoiceNote(input, dependencies), { status: "transcribed", text: "una fiesta de fútbol", seconds: 3 });
  assert.deepEqual(repository.messages, [{ id: "t1", role: "user", content: "una fiesta de fútbol", attachments: [], inputMode: "voice" }]);
  const again = await receiveVoiceNote(input, dependencies);
  assert.equal(again.status, "transcribed");
  assert.equal(calls, 1);
  assert.equal(repository.messages.length, 1);
});

test("a turn id already used by a typed message is not overwritten by a voice note", async () => {
  const repository = memoryRepository();
  repository.messages.push({ id: "t1", role: "user", content: "escrito", attachments: [] });
  const result = await receiveVoiceNote({ conversationId: "c1", turnId: "t1", audio, contentType: "audio/webm" }, { ...deps(heard("hola")), repository });
  assert.deepEqual(result, { status: "rejected", code: "failed" });
  assert.equal(repository.messages[0].content, "escrito");
});

test("the browser maps a silent recording (422) to the no-speech message", () => {
  assert.equal(codigoDeEstadoHttp(422), "no_se_entendio");
  assert.match(MENSAJES_ERROR_DICTADO.no_se_entendio, /No se escuchó nada/);
});
